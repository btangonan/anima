//! oracle.rs — Companion oracle (persistent subprocess)
//!
//! Keeps a long-lived `claude` subprocess for oracle queries, paying the ~10s
//! cold start once at spawn. Subsequent queries take ~1-2s (API round-trip only).
//! Auto-respawns if the process dies.

use std::collections::HashMap;
use std::sync::Arc;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex as TokioMutex, Notify};

use super::daemon::{
    expand_home, now_s, load_buddy, load_companion,
    str_val, coalesce, buddy_traits, DaemonShared, ConvoEntry,
};

// ── Persistent oracle subprocess ─────────────────────────────────────────────

struct OracleProc {
    stdin:  tokio::process::ChildStdin,
    rx:     mpsc::Receiver<String>,    // receives stdout lines from reader task
    _child: Child,                      // held to keep process alive
}

pub struct OraclePool {
    proc:   TokioMutex<Option<OracleProc>>,
    ready:  Notify,
}

impl OraclePool {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            proc:  TokioMutex::new(None),
            ready: Notify::new(),
        })
    }

    /// Spawn the persistent claude subprocess. Called once from daemon_loop.
    pub async fn spawn(&self) {
        if let Some(op) = self.try_spawn().await {
            *self.proc.lock().await = Some(op);
            self.ready.notify_waiters();
            println!("[oracle] persistent subprocess ready");
        }
    }

    async fn try_spawn(&self) -> Option<OracleProc> {
        let claude = which_claude().await?;
        let mut cmd = Command::new(&claude);
        cmd.args([
            "--input-format", "stream-json",
            "--output-format", "stream-json",
            "--verbose",
            "--model", "claude-haiku-4-5-20251001",
            "--no-session-persistence",
            "--permission-mode", "default",
            "--settings", r#"{"hooks":{}}"#,
            // No --system-prompt here — personality is injected per-query via
            // build_oracle_system() so it stays current as sessions change.
        ]);
        cmd.stdin(std::process::Stdio::piped())
           .stdout(std::process::Stdio::piped())
           .stderr(std::process::Stdio::null());

        let mut child = match cmd.spawn() {
            Ok(c)  => c,
            Err(e) => { eprintln!("[oracle] spawn error: {e}"); return None; }
        };

        let stdout = child.stdout.take()?;
        let stdin  = child.stdin.take()?;

        // Background reader: drains stdout lines into a channel
        let (tx, rx) = mpsc::channel::<String>(64);
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let line = line.trim().to_string();
                if line.is_empty() { continue; }
                if tx.send(line).await.is_err() { break; }
            }
        });

        // Drain init events (system prompts, etc.) — don't block, just clear for 2s
        let drain_rx_ref = &rx;
        // We can't drain rx here since we're moving it. The caller will drain on first query.

        Some(OracleProc { stdin, rx, _child: child })
    }

    /// Send a query and wait for the result. Returns the reply text.
    pub async fn query(&self, prompt: &str, system_context: &str, timeout_secs: u64) -> Option<String> {
        let mut guard = self.proc.lock().await;

        // If no process, try to respawn
        if guard.is_none() {
            drop(guard);
            self.spawn().await;
            guard = self.proc.lock().await;
        }

        let op = guard.as_mut()?;

        // Build the user message with context baked in
        let content = if system_context.is_empty() {
            prompt.to_string()
        } else {
            format!("[Context: {system_context}]\n\n{prompt}")
        };

        let msg = serde_json::json!({
            "type": "user",
            "message": { "role": "user", "content": content }
        });
        let line = format!("{}\n", msg);

        // Write to stdin
        if op.stdin.write_all(line.as_bytes()).await.is_err() {
            eprintln!("[oracle] stdin write failed — process dead, will respawn");
            *guard = None;
            return None;
        }
        if op.stdin.flush().await.is_err() {
            *guard = None;
            return None;
        }

        // Read until we get a "result" event
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(timeout_secs);
        loop {
            match tokio::time::timeout_at(deadline, op.rx.recv()).await {
                Err(_) => {
                    eprintln!("[oracle] query timeout ({timeout_secs}s)");
                    return None;
                }
                Ok(None) => {
                    eprintln!("[oracle] subprocess stdout closed — will respawn");
                    *guard = None;
                    return None;
                }
                Ok(Some(line)) => {
                    if let Ok(evt) = serde_json::from_str::<Value>(&line) {
                        if evt["type"].as_str() == Some("result") {
                            let result = evt["result"].as_str().unwrap_or("").trim().to_string();
                            if result.is_empty() || result == "SKIP" { return None; }
                            return Some(result);
                        }
                        // Skip other event types (system, assistant, content_block_*, rate_limit_event)
                    }
                }
            }
        }
    }
}

async fn which_claude() -> Option<String> {
    match Command::new("which").arg("claude").output().await {
        Ok(o) if o.status.success() => {
            let path = String::from_utf8_lossy(&o.stdout).trim().to_string();
            println!("[oracle] claude at: {path}");
            Some(path)
        }
        _ => { eprintln!("[oracle] WARNING: 'claude' not on PATH"); None }
    }
}

// ── Oracle system-prompt builder ──────────────────────────────────────────────

pub(crate) fn build_oracle_system(sessions: &[Value]) -> String {
    let companion = load_companion();
    let buddy     = load_buddy();
    let name = coalesce(str_val(&companion, "name"), str_val(&buddy, "name"), "Vexil");
    let raw_personality = coalesce(str_val(&companion, "personality"), str_val(&buddy, "personality"), "");
    let (trait_line, fallback) = buddy_traits(&buddy);
    let personality = if raw_personality.is_empty() { &fallback } else { raw_personality };

    if sessions.is_empty() {
        let mut ctx = format!("{personality}\n\n");
        if !trait_line.is_empty() { ctx.push_str(&trait_line); ctx.push('\n'); }
        ctx.push_str(&format!("You are {name}. No sessions open — you're blind right now. Tell the user to press + to open a project folder. One sentence."));
        return ctx;
    }

    let sessions_str: Vec<String> = sessions.iter().map(|s| {
        format!("{} ({})", str_val(s, "name"), str_val(s, "cwd"))
    }).collect();

    let mut ctx = format!("{personality}\n\n");
    ctx.push_str(&format!("You are {name}, watching Claude Code sessions.\nOpen sessions: {}.\n", sessions_str.join("; ")));
    if !trait_line.is_empty() { ctx.push_str(&trait_line); ctx.push('\n'); }
    ctx.push_str("\nAnswer directly from what you know. Be opinionated and specific. 2 sentences max. Cut to the insight, not the description.");
    ctx
}

// ── Core oracle call (uses persistent subprocess) ────────────────────────────

pub(crate) async fn run_oracle(
    message:  String,
    history:  Vec<Value>,
    sessions: Vec<Value>,
    ra_snap:  HashMap<String, Vec<(f64, String, String)>>,
    cv_snap:  HashMap<String, Vec<ConvoEntry>>,
    oracle:   &Arc<OraclePool>,
) -> Option<String> {
    let now = now_s();

    let mut activity_lines = Vec::new();
    for (sid, acts) in &ra_snap {
        let filtered: Vec<&(f64, String, String)> = acts.iter()
            .filter(|(ts, _, _)| now - ts < 300.0).collect();
        let recent: Vec<String> = filtered.iter().rev().take(4).rev()
            .map(|(_, t, h)| if h.is_empty() { t.clone() } else { format!("{t}({h})") })
            .collect();
        if !recent.is_empty() {
            activity_lines.push(format!("  session {}: {}", &sid[..sid.len().min(8)], recent.join(", ")));
        }
    }

    let mut convo_lines = Vec::new();
    if let Some((_, turns)) = cv_snap.iter().max_by(|a, b| {
        let at = a.1.last().map(|e| e.0).unwrap_or(0.0);
        let bt = b.1.last().map(|e| e.0).unwrap_or(0.0);
        at.partial_cmp(&bt).unwrap_or(std::cmp::Ordering::Equal)
    }) {
        let last2: Vec<&ConvoEntry> = turns.iter().rev().take(2).collect::<Vec<_>>().into_iter().rev().collect();
        for (_, um, tt) in last2 {
            if !um.is_empty() { convo_lines.push(format!("USER: {}", &um[..um.len().min(300)])); }
            if !tt.is_empty() { convo_lines.push(format!("CLAUDE: {}", &tt[..tt.len().min(600)])); }
        }
    }

    let companion = load_companion();
    let buddy     = load_buddy();
    let name = coalesce(str_val(&companion, "name"), str_val(&buddy, "name"), "Vexil");

    // Build context string (injected per-query since system prompt is fixed at spawn)
    let mut ctx = build_oracle_system(&sessions);
    if !activity_lines.is_empty() { ctx.push_str(&format!("\nRecent tool activity:\n{}\n", activity_lines.join("\n"))); }
    if !convo_lines.is_empty()    { ctx.push_str(&format!("Recent session conversation:\n{}\n", convo_lines.join("\n"))); }

    // Build conversation with history
    let mut history_str = String::new();
    for turn in &history {
        let role = if turn["role"].as_str() == Some("user") { "USER" } else { &name.to_uppercase() };
        history_str.push_str(&format!("{role}: {}\n", turn["content"].as_str().unwrap_or("")));
    }

    let prompt = if history_str.is_empty() {
        message
    } else {
        format!("{history_str}USER: {message}")
    };

    oracle.query(&prompt, &ctx, 15).await
}

// ── Startup check (kept for daemon commentary path) ──────────────────────────

pub(crate) async fn check_claude_path() -> bool {
    match Command::new("which").arg("claude").output().await {
        Ok(o) if o.status.success() => {
            println!("[daemon] claude at: {}", String::from_utf8_lossy(&o.stdout).trim());
            true
        }
        _ => { eprintln!("[daemon] WARNING: 'claude' not on PATH — commentary disabled"); false }
    }
}

// ── Tauri command ─────────────────────────────────────────────────────────────

/// Called directly from voice.js via invoke('oracle_query', {...}).
#[tauri::command]
pub async fn oracle_query(
    message:  String,
    history:  Vec<Value>,
    req_id:   u64,
    sessions: Vec<Value>,
    state:    tauri::State<'_, Arc<DaemonShared>>,
) -> Result<Value, String> {
    // Snapshot activity/convo without holding the lock during the claude call
    let (ra_snap, cv_snap) = {
        let st = state.state.lock().map_err(|e| e.to_string())?;
        let ra: HashMap<String, Vec<(f64, String, String)>> = st.recent_activity.iter()
            .map(|(k, v)| (k.clone(), v.iter().map(|(ts, t, h, _, _)| (*ts, t.clone(), h.clone())).collect()))
            .collect();
        let cv: HashMap<String, Vec<ConvoEntry>> = st.session_convo.iter()
            .map(|(k, v)| (k.clone(), v.iter().cloned().collect()))
            .collect();
        (ra, cv)
    };

    let reply = run_oracle(message, history, sessions, ra_snap, cv_snap, &state.oracle).await
        .ok_or_else(|| "oracle unreachable".to_string())?;

    println!("[oracle] query → \"{}\"", &reply[..reply.len().min(80)]);
    Ok(serde_json::json!({"msg": reply, "req_id": req_id}))
}
