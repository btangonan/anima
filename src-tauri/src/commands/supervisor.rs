//! P2.G Tauri bindings for the MCP-gate supervisor.
//!
//! JS calls `supervisor_record_gate_crash` from session-lifecycle.js's close
//! handler whenever it observes a claude subprocess exit while running in
//! `gated` permission mode. The command returns the updated circuit snapshot
//! so the caller can decide whether to retry `gated` or downshift to
//! `--permission-mode default` on the next spawn.
//!
//! `supervisor_circuit_state` is a pure query — no side effects. Used by
//! the modal / status banner to show the degraded-mode indicator.

use crate::mcp_gate::supervisor::{now_secs, CircuitSnapshot, SupervisorState};
use tauri::State;

#[tauri::command]
pub fn supervisor_record_gate_crash(
    state: State<'_, SupervisorState>,
    session_id: String,
) -> CircuitSnapshot {
    state.record_crash(&session_id, now_secs())
}

#[tauri::command]
pub fn supervisor_circuit_state(
    state: State<'_, SupervisorState>,
    session_id: String,
) -> CircuitSnapshot {
    state.snapshot(&session_id, now_secs())
}

#[tauri::command]
pub fn supervisor_reset(
    state: State<'_, SupervisorState>,
    session_id: String,
) {
    state.reset(&session_id);
}
