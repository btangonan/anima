//! anima_gate — sidecar binary.
//!
//! Stdio MCP server used with `--permission-prompt-tool`. Session-scoped via
//! ANIMA_SESSION env. Delegates to pixel_terminal_lib::mcp_gate.

use pixel_terminal_lib::mcp_gate::{
    audit::AuditCtx, default_ipc_dir, default_session_id, run, GatePaths,
};

fn main() -> std::io::Result<()> {
    let ipc_dir = default_ipc_dir()?;
    let session_id = default_session_id();
    let paths = GatePaths::for_session(&ipc_dir, &session_id);
    let audit_ctx = AuditCtx::from_env(&ipc_dir);
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    run(stdin.lock(), &mut out, &paths, Some(&audit_ctx))
}
