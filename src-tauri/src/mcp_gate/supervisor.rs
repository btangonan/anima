//! P2.G — fail-closed supervisor for the MCP gate subprocess.
//!
//! Owns the circuit-breaker + exponential-backoff decision for permission-gate
//! restart attempts. Session-lifecycle (JS) records a crash whenever it
//! observes the claude subprocess exit while running in `gated` permission
//! mode; the supervisor then decides whether the next spawn should retry
//! `gated` or downshift to fail-closed `--permission-mode default`.
//!
//! Contract:
//!   - Sliding window: CRASH_WINDOW_SECS (60 s)
//!   - Threshold:      CRASH_THRESHOLD   (3)
//!   - Circuit open when crashes_in_window >= threshold.
//!   - Open → next session spawn uses `--permission-mode default`
//!            (NOT `bypassPermissions` — fail-closed, not fail-open).
//!   - Backoff: exponential from BASE_BACKOFF_MS, doubling per crash,
//!              capped at MAX_BACKOFF_MS.
//!
//! State is in-memory keyed by session_id. Crash tracking is ephemeral —
//! a Claude session that survives a restart starts fresh. No disk persistence.
//! The supervisor is intentionally a pure state machine: it makes decisions,
//! it does NOT spawn subprocesses (session-lifecycle.js owns that).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub const CRASH_WINDOW_SECS: u64 = 60;
pub const CRASH_THRESHOLD: usize = 3;
pub const BASE_BACKOFF_MS: u64 = 250;
pub const MAX_BACKOFF_MS: u64 = 8_000;

/// One session's crash history + circuit state.
#[derive(Debug, Default, Clone)]
pub struct CrashTracker {
    crashes: Vec<u64>, // unix seconds, sorted ascending
}

impl CrashTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a crash at `now_secs`. Drops any existing timestamps older
    /// than the sliding window so the vec stays bounded.
    pub fn record_crash(&mut self, now_secs: u64) {
        self.purge_old(now_secs);
        self.crashes.push(now_secs);
    }

    /// Number of crashes inside the sliding window ending at `now_secs`.
    pub fn crashes_in_window(&self, now_secs: u64) -> usize {
        let floor = now_secs.saturating_sub(CRASH_WINDOW_SECS);
        self.crashes.iter().filter(|t| **t >= floor).count()
    }

    /// True once the circuit breaker has tripped — caller should fail-closed
    /// to `--permission-mode default` on the next spawn.
    pub fn is_circuit_open(&self, now_secs: u64) -> bool {
        self.crashes_in_window(now_secs) >= CRASH_THRESHOLD
    }

    /// Exponential backoff in ms for the Nth crash in the current window.
    /// 1 crash → 250 ms, 2 → 500 ms, 3 → 1000 ms, ... capped at 8 s.
    /// Zero crashes → 0 ms (no wait; the first attempt is free).
    pub fn backoff_ms(&self, now_secs: u64) -> u64 {
        let n = self.crashes_in_window(now_secs);
        if n == 0 {
            return 0;
        }
        // n=1 → BASE, n=2 → BASE*2, n=3 → BASE*4, ...
        let shift = (n as u32).saturating_sub(1).min(20); // cap shift to avoid overflow
        let candidate = BASE_BACKOFF_MS.saturating_mul(1u64 << shift);
        candidate.min(MAX_BACKOFF_MS)
    }

    /// Call after a successful gated-mode session has been stable for more
    /// than one window. Resets the circuit so future transient failures
    /// don't immediately re-trip.
    pub fn reset(&mut self) {
        self.crashes.clear();
    }

    fn purge_old(&mut self, now_secs: u64) {
        let floor = now_secs.saturating_sub(CRASH_WINDOW_SECS);
        self.crashes.retain(|t| *t >= floor);
    }
}

/// Session-keyed crash-tracker registry. Held as Tauri state.
#[derive(Default)]
pub struct SupervisorState {
    pub trackers: Mutex<HashMap<String, CrashTracker>>,
}

/// Externally-observable circuit state for a session. Returned to JS via
/// the `supervisor_circuit_state` command.
#[derive(Debug, serde::Serialize)]
pub struct CircuitSnapshot {
    pub open: bool,
    pub crashes: usize,
    pub backoff_ms: u64,
}

impl SupervisorState {
    pub fn record_crash(&self, session_id: &str, now_secs: u64) -> CircuitSnapshot {
        let mut map = self.trackers.lock().expect("supervisor mutex poisoned");
        let entry = map.entry(session_id.to_string()).or_default();
        entry.record_crash(now_secs);
        CircuitSnapshot {
            open: entry.is_circuit_open(now_secs),
            crashes: entry.crashes_in_window(now_secs),
            backoff_ms: entry.backoff_ms(now_secs),
        }
    }

    pub fn snapshot(&self, session_id: &str, now_secs: u64) -> CircuitSnapshot {
        let map = self.trackers.lock().expect("supervisor mutex poisoned");
        match map.get(session_id) {
            Some(t) => CircuitSnapshot {
                open: t.is_circuit_open(now_secs),
                crashes: t.crashes_in_window(now_secs),
                backoff_ms: t.backoff_ms(now_secs),
            },
            None => CircuitSnapshot { open: false, crashes: 0, backoff_ms: 0 },
        }
    }

    pub fn reset(&self, session_id: &str) {
        let mut map = self.trackers.lock().expect("supervisor mutex poisoned");
        if let Some(t) = map.get_mut(session_id) {
            t.reset();
        }
    }
}

pub fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_tracker_has_zero_crashes_and_closed_circuit() {
        let t = CrashTracker::new();
        assert_eq!(t.crashes_in_window(1000), 0);
        assert!(!t.is_circuit_open(1000));
        assert_eq!(t.backoff_ms(1000), 0);
    }

    #[test]
    fn one_crash_is_below_threshold_but_has_backoff() {
        let mut t = CrashTracker::new();
        t.record_crash(1000);
        assert_eq!(t.crashes_in_window(1000), 1);
        assert!(!t.is_circuit_open(1000));
        assert_eq!(t.backoff_ms(1000), BASE_BACKOFF_MS);
    }

    #[test]
    fn two_crashes_double_backoff_still_closed() {
        let mut t = CrashTracker::new();
        t.record_crash(1000);
        t.record_crash(1001);
        assert_eq!(t.crashes_in_window(1001), 2);
        assert!(!t.is_circuit_open(1001));
        assert_eq!(t.backoff_ms(1001), BASE_BACKOFF_MS * 2);
    }

    #[test]
    fn three_crashes_opens_circuit() {
        let mut t = CrashTracker::new();
        t.record_crash(1000);
        t.record_crash(1001);
        t.record_crash(1002);
        assert!(t.is_circuit_open(1002));
        assert_eq!(t.crashes_in_window(1002), 3);
        assert_eq!(t.backoff_ms(1002), BASE_BACKOFF_MS * 4);
    }

    #[test]
    fn crashes_outside_window_do_not_count() {
        let mut t = CrashTracker::new();
        // Three crashes 120s ago
        t.record_crash(1000);
        t.record_crash(1001);
        t.record_crash(1002);
        // Query at 1122 — window is [1062, 1122], all three are out
        assert_eq!(t.crashes_in_window(1122), 0);
        assert!(!t.is_circuit_open(1122));
    }

    #[test]
    fn circuit_reopens_with_fresh_crashes_after_window_passes() {
        let mut t = CrashTracker::new();
        // Old flurry
        t.record_crash(1000);
        t.record_crash(1001);
        t.record_crash(1002);
        assert!(t.is_circuit_open(1002));
        // 5 min later, circuit is closed again
        assert!(!t.is_circuit_open(1300));
        // New flurry
        t.record_crash(1300);
        t.record_crash(1301);
        t.record_crash(1302);
        assert!(t.is_circuit_open(1302));
    }

    #[test]
    fn backoff_caps_at_max() {
        let mut t = CrashTracker::new();
        for i in 0..25 {
            t.record_crash(1000 + i);
        }
        assert_eq!(t.backoff_ms(1024), MAX_BACKOFF_MS);
    }

    #[test]
    fn reset_clears_all_crashes() {
        let mut t = CrashTracker::new();
        t.record_crash(1000);
        t.record_crash(1001);
        t.record_crash(1002);
        assert!(t.is_circuit_open(1002));
        t.reset();
        assert!(!t.is_circuit_open(1002));
        assert_eq!(t.crashes_in_window(1002), 0);
    }

    #[test]
    fn record_crash_purges_old_timestamps() {
        let mut t = CrashTracker::new();
        for i in 0..10 {
            t.record_crash(1000 + i);
        }
        // Record one far in the future — purge should drop the old 10
        t.record_crash(5000);
        assert_eq!(t.crashes_in_window(5000), 1);
    }

    #[test]
    fn supervisor_state_record_returns_snapshot() {
        let s = SupervisorState::default();
        let snap = s.record_crash("sess-a", 1000);
        assert_eq!(snap.crashes, 1);
        assert!(!snap.open);
        assert_eq!(snap.backoff_ms, BASE_BACKOFF_MS);

        let snap = s.record_crash("sess-a", 1001);
        assert_eq!(snap.crashes, 2);

        let snap = s.record_crash("sess-a", 1002);
        assert_eq!(snap.crashes, 3);
        assert!(snap.open);
    }

    #[test]
    fn supervisor_state_is_session_scoped() {
        let s = SupervisorState::default();
        s.record_crash("sess-a", 1000);
        s.record_crash("sess-a", 1001);
        s.record_crash("sess-a", 1002);
        let a = s.snapshot("sess-a", 1002);
        let b = s.snapshot("sess-b", 1002);
        assert!(a.open);
        assert!(!b.open);
        assert_eq!(a.crashes, 3);
        assert_eq!(b.crashes, 0);
    }

    #[test]
    fn supervisor_state_snapshot_of_unknown_session_is_empty() {
        let s = SupervisorState::default();
        let snap = s.snapshot("unknown", 1000);
        assert!(!snap.open);
        assert_eq!(snap.crashes, 0);
        assert_eq!(snap.backoff_ms, 0);
    }

    #[test]
    fn supervisor_state_reset_closes_circuit_for_session() {
        let s = SupervisorState::default();
        s.record_crash("sess", 1000);
        s.record_crash("sess", 1001);
        s.record_crash("sess", 1002);
        assert!(s.snapshot("sess", 1002).open);
        s.reset("sess");
        assert!(!s.snapshot("sess", 1002).open);
    }
}
