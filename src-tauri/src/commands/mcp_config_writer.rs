//! P2.A — per-session MCP config writer.
//!
//! Writes `~/.local/share/pixel-terminal/sessions/<session_id>/mcp.json`
//! with a UNIQUE per-session server key `anima_<sid8>` (first 8 hex chars
//! of session_id). The prompt-tool flag Claude receives is mechanically
//! `mcp__anima_<sid8>__approve` — the middle segment MUST equal the
//! server-config key or Claude invokes an MCP server that doesn't exist
//! and the gate is never called (silent audit-log collapse).
//!
//! Naming contract (proven in src-tauri/tests/mcp_config_naming.rs):
//!     tool_flag == format!("mcp__{}__approve", server_key)

use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigInfo {
    pub path: String,
    pub server_key: String,
    pub tool_flag: String,
}

pub fn derive_names(session_id: &str) -> Result<(String, String, String), String> {
    let hex_only: String = session_id.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if hex_only.len() < 8 {
        return Err(format!(
            "session_id has fewer than 8 hex chars: {}",
            session_id
        ));
    }
    let sid8 = hex_only[..8].to_string();
    let server_key = format!("anima_{}", sid8);
    let tool_flag = format!("mcp__{}__approve", server_key);
    Ok((sid8, server_key, tool_flag))
}

#[tauri::command]
pub fn write_mcp_config(
    session_id: String,
    gate_command: String,
    gate_args: Vec<String>,
) -> Result<McpConfigInfo, String> {
    let (_sid8, server_key, tool_flag) = derive_names(&session_id)?;

    let home = std::env::var("HOME").map_err(|_| "HOME env not set".to_string())?;
    let session_dir = PathBuf::from(&home)
        .join(".local/share/pixel-terminal/sessions")
        .join(&session_id);
    fs::create_dir_all(&session_dir).map_err(|e| format!("create session dir: {}", e))?;

    let config_path = session_dir.join("mcp.json");

    let config = serde_json::json!({
        "mcpServers": {
            &server_key: {
                "command": gate_command,
                "args": gate_args,
                "env": { "ANIMA_SESSION": &session_id }
            }
        }
    });

    let serialized = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("serialize mcp config: {}", e))?;
    fs::write(&config_path, serialized + "\n").map_err(|e| format!("write mcp config: {}", e))?;

    debug_assert_eq!(tool_flag, format!("mcp__{}__approve", server_key));

    Ok(McpConfigInfo {
        path: config_path.to_string_lossy().to_string(),
        server_key,
        tool_flag,
    })
}
