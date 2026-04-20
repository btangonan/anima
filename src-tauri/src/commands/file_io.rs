use std::fs;
use std::io::Write;

/// Validate and expand a path for use in IPC file commands.
/// Expands leading `~/`. Enforces a strict allowlist of paths the app
/// legitimately accesses — everything else is rejected.
///
/// Allowed prefixes (directories):
///   ~/Projects/                          — project files, attachment reads
///   ~/.config/pixel-terminal/            — buddy.json, project-chars.json
///   ~/.local/share/pixel-terminal/       — vexil_feed.jsonl, oracle_query.json
///   /tmp/                                — vexil IPC files, hook gate, alive marker
///
/// Allowed exact paths:
///   ~/.claude.json                       — companion reads Claude config
pub(crate) fn expand_and_validate_path(path: &str) -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME env not set".to_string())?;

    // Block obvious traversal sequences before expansion
    if path.contains("/../") || path.ends_with("/..") || path.starts_with("../") {
        return Err("Path traversal not allowed".to_string());
    }

    // Expand leading ~/
    let expanded = if path.starts_with("~/") {
        format!("{}/{}", home, &path[2..])
    } else if path == "~" {
        home.clone()
    } else {
        path.to_string()
    };

    // Require absolute path after expansion
    if !expanded.starts_with('/') {
        return Err("Relative paths not allowed".to_string());
    }

    // Strict allowlist — only paths the app has legitimate business accessing
    let allowed_dirs = [
        format!("{}/Projects/", home),
        format!("{}/.config/pixel-terminal/", home),
        format!("{}/.local/share/pixel-terminal/", home),
    ];
    let allowed_exact = [
        format!("{}/.claude.json", home),
    ];

    let in_allowed_dir = allowed_dirs.iter().any(|d| expanded.starts_with(d.as_str()));
    let is_allowed_exact = allowed_exact.iter().any(|e| expanded == e.as_str());
    let in_tmp = expanded.starts_with("/tmp/");

    if !in_allowed_dir && !is_allowed_exact && !in_tmp {
        return Err(format!("Path outside allowed prefixes: {}", path));
    }

    // Canonicalize to resolve symlinks — prevents traversal via a symlink inside an
    // allowed directory that points outside it (e.g. ~/Projects/evil -> ~/.ssh/id_rsa).
    // Only runs when the path already exists; new files (writes) are covered by the
    // string allowlist above.
    // Note: on macOS /tmp is a symlink to /private/tmp, so we canonicalize /tmp itself
    // before comparing to handle that transparently.
    let pb = std::path::PathBuf::from(&expanded);
    if pb.exists() {
        let canonical = std::fs::canonicalize(&pb)
            .map_err(|e| format!("canonicalize failed: {e}"))?;
        let canon_tmp = std::fs::canonicalize("/tmp")
            .unwrap_or_else(|_| std::path::PathBuf::from("/tmp"));
        let canon_ok = allowed_dirs.iter().any(|d| canonical.starts_with(d.as_str()))
            || allowed_exact.iter().any(|e| canonical == std::path::Path::new(e.as_str()))
            || canonical.starts_with(&canon_tmp);
        if !canon_ok {
            return Err(format!("Path resolves outside allowed prefixes: {}", path));
        }
        return Ok(canonical);
    }

    Ok(pb)
}

fn encode_base64(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    let mut iter = input.chunks_exact(3);
    for chunk in iter.by_ref() {
        let (b0, b1, b2) = (chunk[0] as usize, chunk[1] as usize, chunk[2] as usize);
        out.push(TABLE[(b0 >> 2) & 0x3f] as char);
        out.push(TABLE[((b0 << 4) | (b1 >> 4)) & 0x3f] as char);
        out.push(TABLE[((b1 << 2) | (b2 >> 6)) & 0x3f] as char);
        out.push(TABLE[b2 & 0x3f] as char);
    }
    match iter.remainder() {
        [b0] => {
            let b0 = *b0 as usize;
            out.push(TABLE[(b0 >> 2) & 0x3f] as char);
            out.push(TABLE[(b0 << 4) & 0x3f] as char);
            out.push_str("==");
        }
        [b0, b1] => {
            let (b0, b1) = (*b0 as usize, *b1 as usize);
            out.push(TABLE[(b0 >> 2) & 0x3f] as char);
            out.push(TABLE[((b0 << 4) | (b1 >> 4)) & 0x3f] as char);
            out.push(TABLE[(b1 << 2) & 0x3f] as char);
            out.push('=');
        }
        _ => {}
    }
    out
}

/// Read a file as a base64-encoded string (for images/binary).
#[tauri::command]
pub fn read_file_as_base64(path: String) -> Result<String, String> {
    let safe = expand_and_validate_path(&path)?;
    let bytes = fs::read(&safe).map_err(|e| e.to_string())?;
    Ok(encode_base64(&bytes))
}

/// Read ANY file as base64 — no path allowlist.
/// Safe for user-initiated drag-drop (user explicitly chose the file).
#[tauri::command]
pub fn read_file_as_base64_any(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(encode_base64(&bytes))
}

/// Return the byte size of a file without reading its contents.
#[tauri::command]
pub fn get_file_size(path: String) -> Result<u64, String> {
    let safe = expand_and_validate_path(&path)?;
    fs::metadata(&safe)
        .map(|m| m.len())
        .map_err(|e| e.to_string())
}

/// Return the byte size of ANY file path — no allowlist, metadata only (no content read).
/// Safe to expose: fs::metadata never reads file contents, only inode/stat data.
/// Used by the attachment OOM guard for drag-dropped files from anywhere on disk.
#[tauri::command]
pub fn get_file_size_any(path: String) -> Result<u64, String> {
    fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| e.to_string())
}

/// Read a file as UTF-8 text.
#[tauri::command]
pub fn read_file_as_text(path: String) -> Result<String, String> {
    let safe = expand_and_validate_path(&path)?;
    fs::read_to_string(&safe).map_err(|e| e.to_string())
}

/// Read ANY file as UTF-8 text — no path allowlist.
/// Safe for user-initiated drag-drop (user explicitly chose the file).
#[tauri::command]
pub fn read_file_as_text_any(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write UTF-8 text to a file (creates parent dirs if needed).
#[tauri::command]
pub fn write_file_as_text(path: String, content: String) -> Result<(), String> {
    let safe = expand_and_validate_path(&path)?;
    if let Some(parent) = safe.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&safe, content.as_bytes()).map_err(|e| e.to_string())
}

/// Atomically append a single line to a file (O_APPEND — safe for concurrent writers).
#[tauri::command]
pub fn append_line_to_file(path: String, line: String) -> Result<(), String> {
    let safe = expand_and_validate_path(&path)?;
    if let Some(parent) = safe.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&safe)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{}", line).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home() -> String {
        std::env::var("HOME").unwrap_or_else(|_| "/tmp/testhome".to_string())
    }

    // ── Traversal rejection ───────────────────────────────────────────────────

    #[test]
    fn rejects_dotdot_in_middle() {
        let p = format!("{}/.config/pixel-terminal/../../etc/passwd", home());
        let r = expand_and_validate_path(&p);
        assert!(r.is_err(), "expected rejection for /../ traversal");
    }

    #[test]
    fn rejects_dotdot_tilde_shorthand() {
        let r = expand_and_validate_path("~/.config/pixel-terminal/../../../etc/passwd");
        assert!(r.is_err());
    }

    #[test]
    fn rejects_leading_dotdot() {
        let r = expand_and_validate_path("../etc/passwd");
        assert!(r.is_err());
    }

    #[test]
    fn rejects_trailing_dotdot() {
        let p = format!("{}/.config/pixel-terminal/..", home());
        let r = expand_and_validate_path(&p);
        assert!(r.is_err());
    }

    // ── Relative path rejection ───────────────────────────────────────────────

    #[test]
    fn rejects_bare_relative_path() {
        let r = expand_and_validate_path("etc/passwd");
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("Relative paths"));
    }

    // ── Allowlist acceptance ──────────────────────────────────────────────────

    #[test]
    fn accepts_config_dir() {
        let p = format!("{}/.config/pixel-terminal/buddy.json", home());
        let r = expand_and_validate_path(&p);
        // File won't exist but the allowlist check should pass — err is fs, not security
        match r {
            Ok(_) => {} // file exists (unlikely in CI), accepted
            Err(e) => {
                // Acceptable failures: file doesn't exist, canonicalize error
                // Unacceptable: path guard rejection message
                assert!(!e.contains("outside allowed"), "allowlisted path was rejected: {e}");
            }
        }
    }

    #[test]
    fn accepts_local_share_dir() {
        let p = format!("{}/.local/share/pixel-terminal/vexil_feed.jsonl", home());
        let r = expand_and_validate_path(&p);
        match r {
            Ok(_) => {}
            Err(e) => assert!(!e.contains("outside allowed"), "allowlisted path was rejected: {e}"),
        }
    }

    #[test]
    fn accepts_projects_dir() {
        let p = format!("{}/Projects/myapp/src/main.rs", home());
        let r = expand_and_validate_path(&p);
        match r {
            Ok(_) => {}
            Err(e) => assert!(!e.contains("outside allowed"), "allowlisted path was rejected: {e}"),
        }
    }

    #[test]
    fn accepts_tmp_prefix() {
        let r = expand_and_validate_path("/tmp/pixel_test_file.json");
        match r {
            Ok(_) => {}
            Err(e) => assert!(!e.contains("outside allowed"), "/tmp path was rejected: {e}"),
        }
    }

    #[test]
    fn accepts_claude_json_exact() {
        let p = format!("{}/.claude.json", home());
        let r = expand_and_validate_path(&p);
        match r {
            Ok(_) => {}
            Err(e) => assert!(!e.contains("outside allowed"), ".claude.json exact path rejected: {e}"),
        }
    }

    // ── Allowlist rejection ───────────────────────────────────────────────────

    #[test]
    fn rejects_ssh_dir() {
        let p = format!("{}/.ssh/id_rsa", home());
        let r = expand_and_validate_path(&p);
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("outside allowed"));
    }

    #[test]
    fn rejects_etc_passwd() {
        let r = expand_and_validate_path("/etc/passwd");
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("outside allowed"));
    }

    #[test]
    fn rejects_claude_dir_itself() {
        // ~/.claude/ is NOT in the allowlist (only ~/.claude.json exact path is)
        let p = format!("{}/.claude/settings.json", home());
        let r = expand_and_validate_path(&p);
        // This SHOULD be rejected — Anima should not be able to read Claude's settings
        assert!(r.is_err(), "~/.claude/ should be outside allowed prefixes");
    }

    #[test]
    fn rejects_home_dir_itself() {
        let r = expand_and_validate_path("~");
        assert!(r.is_err());
    }

    // ── Tilde expansion ───────────────────────────────────────────────────────

    #[test]
    fn tilde_slash_expands_correctly() {
        let p = "~/.config/pixel-terminal/test.json";
        let r = expand_and_validate_path(p);
        match r {
            Ok(pb) => {
                let s = pb.to_string_lossy();
                assert!(s.starts_with('/'), "expanded path must be absolute");
                assert!(!s.contains('~'), "tilde must be expanded");
            }
            Err(e) => assert!(!e.contains("outside allowed"), "tilde expansion failed allowlist: {e}"),
        }
    }
}
