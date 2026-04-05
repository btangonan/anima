# PRE_AUDIT_SUMMARY — Anima (pixel-terminal)
**Date**: 2026-04-05 | **Auditor**: Claude Sonnet 4.6 + Gemini 3.1 Pro adversarial (Stage 9 complete)

---

## Repo Shape
- **Type**: Single repo — Tauri v2 desktop app (macOS)
- **Languages**: Rust 2355 LOC · JS/ESM 5388 LOC · CSS 4454 LOC · Python 30 LOC
- **IPC surface**: 23 Tauri commands across 5 modules
- **Infrastructure**: JSONL daemon feed · claude CLI subprocess · WebSocket bridge (Omi) · localStorage

---

## Maturity Scores (Stage 8 + Stage 9 revisions)

| Dimension | Score | Notes |
|---|---|---|
| LOC Discipline | **1/3** | 11 files >300 LOC; daemon.rs=782, companion.js=683 |
| Validation Coverage | **1/3** ⬇️ *revised* | Path allowlist bypassable via symlinks; register_child_pid self-defeats SpawnedPids |
| Secrets Hygiene | **2/3** | No hardcoded secrets; env-based; no secret manager or CI scan |
| State & Persistence | **1/3** | localStorage + JSONL; in-memory daemon state lost on restart; no idempotency |
| Errors/Retry/Idempotency | **2/3** | Result<T,String>; 3 mutex unwrap()s; no retry/backoff |
| Testing/CI | **2/3** | 28 tests, 2-job CI; ~10% JS coverage of critical modules; no coverage gate |

**Total: 9/18 — DEVELOPING** *(revised down from 10/18 after Gemini adversarial)*

---

## Top Risks (merged Claude + Gemini findings)

### RISK-1 🔴 CRITICAL — `register_child_pid` Defeats Its Own Security *(Gemini-new)*
`misc.rs:125-127`: `register_child_pid` and `unregister_child_pid` are `#[tauri::command]` — directly callable from JS. Any XSS in the WebView (e.g., from Claude-generated malicious content) can register an arbitrary PID and then kill it via `send_signal`. The SpawnedPids mechanism is self-defeating.
**Fix**: Remove `#[tauri::command]` from both. Track PIDs on the Rust side when spawning — never trust the frontend for this.

### RISK-2 🔴 CRITICAL — Symlink Traversal Bypass in Path Allowlist *(Gemini-new)*
`file_io.rs:48`: `expand_and_validate_path()` uses `starts_with()` string prefix check. A symlink inside `~/Projects/` pointing to `~/.ssh/id_rsa` passes the check but returns sensitive content.
**Fix**: `std::fs::canonicalize(&expanded)` before the prefix check. All 15 existing path tests should still pass (valid paths canonicalize to themselves).

### RISK-3 🔴 LOC Explosion + Untested Critical Paths *(Claude)*
`daemon.rs` (782), `companion.js` (683), `session-lifecycle.js` (492), `events.js` (418), `app.js` (413) — all >300 LOC AND completely untested. Bugs here go undetected until user impact.

### RISK-4 🟡 In-Memory DaemonState Lost on Restart *(Claude)*
`DaemonShared` (recent_activity, tool_sequences, session_convo) lives in `Arc<Mutex<>>` only. App crash or restart silently wipes oracle context. No recovery path.

### RISK-5 🟡 CSS Monolith Partially Split — Root File Still Active *(Claude)*
`src/styles.css` (1967 LOC) still loaded alongside `src/styles/*.css`. Split is incomplete — cascade ambiguity and dead-rule risk.

### RISK-6 🟡 `unsafe-inline` in CSP *(Claude)*
`tauri.conf.json` `script-src 'self' 'unsafe-inline'` — inline script execution allowed, degrading CSP to near-useless for XSS mitigation.

### RISK-7 🟡 3 Remaining `unwrap()` on Mutex Locks *(Claude)*
`misc.rs:127,133,146` — mutex lock unwrap()s in production code. If a thread panics while holding the lock, subsequent calls panic-propagate.

### RISK-8 🟡 TOCTOU PID Reuse *(Gemini)*
`send_signal` acts on raw PIDs. If a child exits and OS recycles the PID, a delayed signal could hit an unrelated process.
**Fix**: Manage `Child` handles in Rust, not raw PIDs.

---

## Top 3 Strengths

1. **ws_bridge.rs cancellation** — `write_task.abort()` + `await` correctly drives the task to completion before dropping the receiver. Rare to see this done right.
2. **Content sanitization pipeline** — DOMPurify for markdown + `esc()` for user-controlled strings. No raw innerHTML of untrusted content detected.
3. **CI gates both runtimes** — Vitest + cargo test on every push/PR. All 28 tests passing.

---

## 2-PR Minimum Fix Plan (updated with Gemini findings)

### PR-G: Security Fixes — PID Registration + Path Canonicalize + Mutex Unwraps
**Scope**: `misc.rs` (remove IPC from register/unregister_child_pid, migrate to Rust-side registration), `file_io.rs` (add canonicalize before prefix check), `misc.rs:127,133,146` (unwrap → unwrap_or_else).
**Acceptance**: All existing 15 path tests pass. register_child_pid no longer in invoke_handler. Build clean.

### PR-H: Split daemon.rs (782 → <300 LOC)
**Scope**: Extract `oracle.rs` (call_claude, run_oracle, oracle_query) + `patterns.rs` (check_tool_patterns, commentary_worker) from daemon.rs.
**Acceptance**: daemon.rs <300 LOC. All 10 daemon_patterns tests pass. CI green.

---

## Stage 9 — Gemini Adversarial Review Summary
- **Pass 1 (blind)**: 2 CRITICALs (register_child_pid, symlink traversal), 1 WARNING (TOCTOU), 1 NOTE (ObjC leak)
- **Pass 2 (adversarial)**: DISAGREE on Validation Coverage 2/3 → 1/3 (upheld after rebuttal)
- **Claude rebuttal**: Conceded — both bypass mechanisms confirmed by code inspection
- **Net delta**: Validation Coverage revised from 2→1, total 10→9/18. 2 new CRITICALs added to risk list.
