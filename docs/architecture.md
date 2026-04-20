# Architecture

## Overview

Anima is a Tauri v2 desktop app targeting macOS 13+. The stack is intentionally minimal: Rust backend, vanilla JS frontend, no framework, no bundler.

```
┌───────────────────────────────────────────────────────────────┐
│  WKWebView (vanilla JS)                                       │
│  app.js · companion.js · voice.js · nim.js · session.js      │
│  hook-events.js · permission-modal.js · settings-ui.js       │
│  Cards · Session history · Slash menu · Flag autocomplete     │
└────────────────────────┬──────────────────────────────────────┘
                         │ Tauri invoke / emit
┌────────────────────────▼──────────────────────────────────────┐
│  Rust backend (src-tauri/src/)                                │
│                                                               │
│  commands/                                                    │
│    daemon.rs        — cross-session watcher + oracle          │
│    oracle.rs        — OraclePool subprocess management        │
│    patterns.rs      — tool-pattern detection + commentary     │
│    ethology.rs      — companion behavior traits               │
│    companion.rs     — buddy sync (wyhash)                     │
│    supervisor.rs    — Tauri bindings for MCP gate supervisor  │
│    history.rs       — JSONL session browser                   │
│    file_io.rs       — path-safe read/write                    │
│    misc.rs          — slash-command & child process mgmt      │
│    mcp_config_writer.rs — session-scoped MCP server config    │
│                                                               │
│  mcp_gate/                                                    │
│    mod.rs           — stdio MCP server (permission gate)      │
│    supervisor.rs    — circuit breaker (crash → downshift)     │
│    audit.rs         — permission audit log                    │
│    storage.rs       — persistent allow-always grants          │
│                                                               │
│  ws_bridge.rs  — WebSocket ↔ Omi voice API                    │
└────────────────────────┬──────────────────────────────────────┘
                         │ tokio::process::Command
┌────────────────────────▼──────────────────────────────────────┐
│  claude -p (subprocess)                                       │
│  One process per oracle call.                                 │
│  Semaphore(2) caps concurrent calls.                          │
│                                                               │
│  Permission mode (P2, per-session):                           │
│    bypass  — --dangerously-skip-permissions                   │
│    default — --permission-mode default                        │
│    gated   — --permission-prompt-tool mcp__anima_<sid8>__… + │
│              a per-session mcp_gate subprocess                │
└───────────────────────────────────────────────────────────────┘
```

## Cross-session watcher (daemon.rs + patterns.rs)

The watcher is a Tokio async loop started at app launch. It polls `~/.local/share/pixel-terminal/vexil_feed.jsonl` — Claude Code's session event feed — on a 1-second tick.

Pattern detection lives in `patterns.rs`. For each event it:
1. Classifies the tool call (read / write / other) via `classify_tool()`
2. Appends to a per-session tool sequence deque (max 20 entries)
3. Runs pattern detection: `retry_loop` (same tool 3× in a row), `read_heavy` (5 reads in 90s, session age >120s)
4. If a pattern fires, spawns a `commentary_worker` that calls `claude -p` with the companion persona and emits the result to the frontend via Tauri event

Orientation suppression: patterns are muted for the first 120 seconds of a session to avoid firing on normal project exploration. Internal-tool events (reads of Anima's own files) are suppressed by a denylist in `patterns.rs`.

## Permission gate (mcp_gate/)

P2 introduces three permission modes, selectable from the Settings UI and persisted to `~/.config/pixel-terminal/settings.json`:

| Mode | Claude flag | Safety |
|---|---|---|
| `bypass` | `--dangerously-skip-permissions` | No prompt — every tool auto-allows |
| `default` | `--permission-mode default` | Claude Code's built-in allow list |
| `gated` | `--permission-prompt-tool mcp__anima_<sid8>__approve` + session MCP config | Full UI approval per tool call |

**Gated mode flow:**
1. `session-lifecycle.js` writes a session-scoped MCP config (via `mcp_config_writer.rs`) naming the gate server.
2. A per-session `mcp_gate` subprocess (Rust, stdio NDJSON JSON-RPC) starts alongside the claude subprocess.
3. On each tool call, claude invokes the gate tool. `mcp_gate/mod.rs` checks persistent grants (`storage.rs`); on a cache miss it writes a request file and polls for a UI response.
4. `permission-modal.js` in the frontend shows a 4-button modal (allow once / allow always / deny / deny+pause); the response is written back to the IPC file.
5. `allow_always` responses are persisted to `~/.local/share/pixel-terminal/permissions.json` (keyed by tool + input pattern).
6. All gate decisions are appended to `permission_audit.jsonl` by `audit.rs`.

**Circuit breaker (supervisor.rs):**
If the gate subprocess crashes mid-session, `supervisor_record_gate_crash` increments a crash counter. Above threshold the circuit opens: the next session spawn downshifts to `default` mode and shows a degraded-mode banner in the UI. `supervisor_reset` clears the circuit after the user acknowledges.

## Hook event classifier (hook-events.js)

`hook-events.js` is a pure function module extracted from `events.js`. It takes a single stream-json frame and returns a declarative action plan (`renders`, `logs`, `stateUpdates`, `updateCard`). The dispatcher in `events.js` applies the plan. Separation makes the decision tree testable without mocking DOM, Tauri, or session state.

Classified hook events: `PreCompact`, `PostCompact`, `SessionStart`, `Notification`, `PostToolUseFailure`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStart`, `SubagentStop`.

## Companion sync (companion.rs)

Species is derived from the project path using a deterministic hash chain: wyhash (Zig-compatible seed) → Mulberry32 PRNG → weighted species table. The implementation mirrors the original TypeScript exactly — 1000 test vectors in `tests/fixtures/sync_buddy_vectors.json` guard against drift.

`ethology.rs` provides the companion's behavioral traits — observation style and voice cadence shaped by the companion's real species ethology (owl, cat, dragon, etc.).

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

## Slash-command registry (misc.rs)

`read_slash_commands()` walks `~/.claude/skills/` and `~/.claude/commands/` and parses YAML frontmatter (`name`, `description`, `flags`). Results are deduplicated — a skill entry with `override: true` wins over a same-named commands entry. The parsed list is sent to the frontend to populate the `flags:` autocomplete in the slash menu.

---

## Anima vs Claude Code Desktop (2026-04-15)

Claude Code Desktop was released as a Code tab inside the Claude Desktop app (Electron/Chromium). Comparison:

| Capability | Anima | Claude Code Desktop |
|---|---|---|
| Runtime | Tauri (Rust + native WebView) | Electron (Chromium) |
| Memory footprint | Low | High |
| Project context on start | ✓ (hooks, MCP, env pre-loaded) | Cold start |
| Custom UI / branding | ✓ (Oracle, UNR aesthetic) | Fixed |
| Permission gate UI | ✓ (gated mode, 4-button modal, allow-always) | ✗ |
| Hook system | ✓ | ✓ |
| Parallel sessions + auto worktrees | ✗ | ✓ |
| Side chats | ✗ | ✓ |
| Visual diff review | ✗ | ✓ |
| Live app preview pane | ✗ | ✓ |
| Computer use (screen control) | ✗ | ✓ |
| PR monitoring | ✗ | ✓ |
| Dispatch (phone → desktop) | ✗ | ✓ |
| Scheduled tasks | ✗ | ✓ |
| Connectors (GitHub/Slack/Linear) | ✗ | ✓ |

**Why Anima is faster for this workflow:** Tauri vs Electron, plus all MCP servers and hooks load at start rather than cold. Desktop's speed advantage only surfaces for parallel worktree sessions.

**Computer use not needed:** The tool stack (gws, gauth.py, MCP servers) has programmatic API access to everything. Computer use is for GUI scraping when no API exists — not relevant here.

**Capability gap to watch:** Parallel sessions + auto Git worktrees. This is a Claude Code feature that will eventually reach CLI. No need to switch UIs for it.
