/// ws_bridge.rs — WebSocket bridge between voice clients and pixel-terminal.
///
/// Listens on ws://127.0.0.1:9876. Supports multiple concurrent clients:
///   - OmiWebhook (cloud path via Omi pendant → phone → webhook)
///   - pixel_voice_bridge.py (local mic or direct BLE path)
///
/// Incoming JSON commands from any client are emitted as Tauri events to the frontend.
/// Outgoing state_sync and mute/unmute directives are broadcast to ALL connected clients.
/// omi:connected fires when the first client connects; omi:disconnected when the last leaves.

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::Message;

const WS_PORT: u16 = 9876;

/// Shared state: broadcast senders to all connected WS clients,
/// plus the current mute and always-on flags.
pub struct OmiBridgeState {
    pub ws_clients: Mutex<Vec<mpsc::UnboundedSender<String>>>,
    pub muted: Arc<AtomicBool>,
    pub always_on: Arc<AtomicBool>,
}

impl OmiBridgeState {
    /// Broadcast a message to all clients, pruning dead senders.
    pub async fn broadcast(&self, msg: &str) {
        let mut clients = self.ws_clients.lock().await;
        clients.retain(|tx| tx.send(msg.to_string()).is_ok());
    }
}

/// Called from lib.rs setup(). Registers state and starts the server loop.
pub fn init<R: tauri::Runtime>(app: &mut tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
    let muted = Arc::new(AtomicBool::new(false));
    let always_on = Arc::new(AtomicBool::new(false));
    app.manage(OmiBridgeState {
        ws_clients: Mutex::new(Vec::new()),
        muted,
        always_on,
    });
    tauri::async_runtime::spawn(server_loop(app.handle().clone()));
    Ok(())
}

async fn server_loop<R: tauri::Runtime>(app: AppHandle<R>) {
    let addr = format!("127.0.0.1:{WS_PORT}");
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[omi-bridge] Failed to bind {addr}: {e}");
            return;
        }
    };
    eprintln!("[omi-bridge] Listening on ws://{addr}");

    loop {
        let (stream, peer) = match listener.accept().await {
            Ok(pair) => pair,
            Err(e) => {
                eprintln!("[omi-bridge] Accept error: {e}");
                continue;
            }
        };

        // Spawn each client as an independent task — does not block accept loop
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            handle_client(stream, peer.to_string(), app_clone).await;
        });
    }
}

async fn handle_client<R: tauri::Runtime>(
    stream: tokio::net::TcpStream,
    peer: String,
    app: AppHandle<R>,
) {
    eprintln!("[omi-bridge] Client connected from {peer}");

    let ws = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("[omi-bridge] Handshake failed ({peer}): {e}");
            return;
        }
    };

    let (mut write, mut read) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // Register this client and emit omi:connected if it's the first.
    // Hold a single lock across the is_empty check + push to avoid TOCTOU
    // race where two concurrent connects both see was_empty==true.
    {
        let state = app.state::<OmiBridgeState>();
        let mut clients = state.ws_clients.lock().await;
        let was_empty = clients.is_empty();
        clients.push(tx.clone());
        drop(clients);

        // Send current mute state so this client syncs immediately
        let is_muted = state.muted.load(Ordering::SeqCst);
        let mute_msg = serde_json::json!({
            "type": if is_muted { "mute" } else { "unmute" }
        });
        let _ = tx.send(mute_msg.to_string());

        // Send always-on state if active
        if state.always_on.load(Ordering::SeqCst) {
            let ao_msg = serde_json::json!({ "type": "always_on" });
            let _ = tx.send(ao_msg.to_string());
        }

        if was_empty {
            let _ = app.emit("omi:connected", ());
        }
    }

    // Write task: drain channel → WS sink
    let write_task = tauri::async_runtime::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if write.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    // Read loop: incoming JSON → Tauri event "omi:command"
    while let Some(result) = read.next().await {
        match result {
            Ok(Message::Text(text)) => {
                if let Ok(val) = serde_json::from_str::<Value>(&text) {
                    let _ = app.emit("omi:command", val);
                }
            }
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {}
        }
    }

    // Client disconnected.
    // Abort write task and await it so rx is actually dropped before we check is_closed().
    // Without the await, abort() is async-cooperative and rx may still be alive during retain().
    write_task.abort();
    let _ = write_task.await; // drive task to completion so rx is dropped
    drop(tx);                  // drop our local clone too

    // Hold a single lock across retain() + len() to avoid TOCTOU where another
    // client connects between the two operations and suppresses omi:disconnected.
    {
        let state = app.state::<OmiBridgeState>();
        let mut clients = state.ws_clients.lock().await;
        clients.retain(|t| !t.is_closed());
        let remaining = clients.len();
        drop(clients);
        eprintln!("[omi-bridge] Client {peer} disconnected ({remaining} remaining)");
        if remaining == 0 {
            let _ = app.emit("omi:disconnected", ());
        }
    }
}

/// Tauri command: called from app.js whenever session list changes.
/// Broadcasts state_sync to ALL connected clients.
#[tauri::command]
pub async fn sync_omi_sessions(
    state: tauri::State<'_, OmiBridgeState>,
    sessions: Vec<serde_json::Value>,
    active: Option<String>,
) -> Result<(), String> {
    let msg = serde_json::json!({
        "type": "state_sync",
        "sessions": sessions,
        "active": active
    });
    state.broadcast(&msg.to_string()).await;
    Ok(())
}

/// Tauri command: toggle always-on mode (skip "hey pixel" trigger).
/// "always_on" → voice bridge dispatches all speech directly.
/// "trigger_mode" → voice bridge requires "hey pixel" trigger (default).
#[tauri::command]
pub async fn set_voice_mode(
    state: tauri::State<'_, OmiBridgeState>,
    mode: String,
) -> Result<(), String> {
    state.always_on.store(mode == "always_on", Ordering::SeqCst);
    let msg = serde_json::json!({ "type": mode });
    state.broadcast(&msg.to_string()).await;
    Ok(())
}

/// Tauri command: called from app.js when the user toggles the Omi listen switch.
/// Stores mute state and broadcasts mute/unmute to ALL connected clients.
#[tauri::command]
pub async fn set_omi_listening(
    state: tauri::State<'_, OmiBridgeState>,
    enabled: bool,
) -> Result<(), String> {
    state.muted.store(!enabled, Ordering::SeqCst);
    let msg = serde_json::json!({
        "type": if enabled { "unmute" } else { "mute" }
    });
    state.broadcast(&msg.to_string()).await;
    Ok(())
}
