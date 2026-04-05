# Architecture

## Overview

Anima is a Tauri v2 desktop app targeting macOS 13+. The stack is intentionally minimal: Rust backend, vanilla JS frontend, no framework, no bundler.

```
┌─────────────────────────────────────────────────┐
│  WKWebView (vanilla JS)                         │
│  app.js · companion.js · voice.js · nim.js      │
│  Cards · Session history · Flag autocomplete    │
└────────────────┬────────────────────────────────┘
                 │ Tauri invoke / emit
┌────────────────▼────────────────────────────────┐
│  Rust backend (src-tauri/src/)                  │
│                                                 │
│  commands/                                      │
│    daemon.rs   — cross-session watcher          │
│    companion.rs — buddy sync (wyhash)           │
│    file_io.rs  — path-safe read/write           │
│    history.rs  — JSONL session browser          │
│    misc.rs     — child process mgmt             │
│                                                 │
│  ws_bridge.rs  — WebSocket ↔ Omi voice API      │
└────────────────┬────────────────────────────────┘
                 │ tokio::process::Command
┌────────────────▼────────────────────────────────┐
│  claude -p (subprocess)                         │
│  One process per oracle call.                   │
│  Semaphore(2) caps concurrent calls.            │
└─────────────────────────────────────────────────┘
```

## Cross-session watcher (daemon.rs)

The watcher is a Tokio async loop started at app launch. It polls `~/.local/share/pixel-terminal/vexil_feed.jsonl` — Claude Code's session event feed — on a 1-second tick.

For each event it:
1. Classifies the tool call (read / write / other)
2. Appends to a per-session tool sequence deque (max 20 entries)
3. Runs pattern detection: `retry_loop` (same tool 3× in a row), `read_heavy` (5 reads in 90s, session age >120s)
4. If a pattern fires, spawns a `commentary_worker` that calls `claude -p` with the companion persona and emits the result to the frontend via Tauri event

Orientation suppression: patterns are muted for the first 120 seconds of a session to avoid firing on normal project exploration.

## Companion sync (companion.rs)

Species is derived from the project path using a deterministic hash chain: wyhash (Zig-compatible seed) → Mulberry32 PRNG → weighted species table. The implementation mirrors the original TypeScript exactly — 1000 test vectors in `tests/fixtures/sync_buddy_vectors.json` guard against drift.

## Path security (file_io.rs)

All file reads and writes go through `expand_and_validate_path()`, which rejects traversal attempts and enforces an allowlist:
- `~/.config/pixel-terminal/`
- `~/.local/share/pixel-terminal/`
- `~/.claude/projects/`
- `~/.claude.json` (exact path)
- `~/Projects/`
- `/tmp/`

## Voice bridge (ws_bridge.rs)

A Tokio WebSocket server on `127.0.0.1:9876`. The Omi app connects here and sends transcription events. Push-to-talk state is managed via Tauri commands (`ptt_start`, `ptt_release`). The bridge handles reconnection and session multiplexing.
