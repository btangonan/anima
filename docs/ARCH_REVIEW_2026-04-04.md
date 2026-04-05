# Architecture Review — Anima (pixel-terminal)
**Date**: 2026-04-04
**Reviewer**: Gemini 2.5 Pro (independent, no prior context)
**Questions asked**: Is Tauri/Rust right? Is the Python daemon sound? Is the app well-sized?

---

## Q1: Is Tauri + Rust the right call, or over-engineered?

**Verdict: Correct call. Not over-engineered.**

For a desktop overlay/companion app, the primary non-functional requirements are low resource usage and a small footprint. The app must feel "invisible" until it's needed.

- **Tauri vs. Electron**: Electron would bundle a full Chromium + Node.js runtime — 150MB+ binary, 200MB+ RAM idle. For an app running constantly in the background, unacceptable. Tauri's WKWebView + Rust backend delivers ~5-10MB binary and minimal idle RAM.
- **Tauri vs. pure web app**: Non-starter. Core functionality requires reading local files (`~/.claude.json`, JSONL feeds), running background processes, and existing as a persistent overlay. Browser sandbox makes this impossible.

The choice demonstrates a mature understanding of the problem domain. Performance gains and lean footprint are critical wins for a companion app.

---

## Q2: Is the Python daemon architecture sound?

**Verdict: Not sound. Biggest architectural liability in the stack.**

`vexil_master.py` runs as a separate process, communicates via JSONL files, and spawns `claude -p` subprocesses per commentary. Three problems:

1. **Fragile IPC**: JSONL file on disk is brittle — race conditions, file locking, incomplete writes on crash, notification delays. "Dead drop" communication lacks robustness of direct IPC.
2. **Process management hell**: App is now a distributed system on the user's machine. What happens if the daemon crashes? Does the main app know? Can it restart it? Significant complexity and failure modes.
3. **Inefficient subprocessing**: Spawning `claude -p` per commentary wastes CPU, introduces latency, and creates a hard dependency on an external CLI that could change its API.

**Recommended fix**: Fold daemon logic entirely into the Rust backend.
- Kill `vexil_master.py`
- Re-implement file watching in a Rust background thread (`notify` crate)
- Replace `claude -p` subprocesses with direct API calls via `reqwest` (async, type-safe, no external CLI dependency)
- Use `tokio::mpsc` for in-process message passing

**Fallback** (if Python is non-negotiable): manage as sidecar via `stdio` — structured two-way communication over stdin/stdout. Better than file-based but still inferior to pure Rust.

---

## Q3: Is the app well-sized?

**Verdict: ~3-4k LOC is appropriate. Structure is the problem, not size.**

The issue is polyglot sprawl:

- **Four runtimes for 4k LOC**: Rust + vanilla JS + Python + TypeScript/Bun. Each introduces its own toolchain, runtime, and dependency management.
- **`sync_real_buddy.ts`**: Logic (read JSON, hash data, write JSON) is trivial to implement as a Rust command. No reason to run Bun for this.
- **Anemic Rust backend**: ~5 command files, mostly acting as a UI bridge. Rust's concurrency and system programming strengths are wasted while the most critical background tasks live in a peripheral Python script.
- **Core logic in the periphery**: The application "brain" (session watching, AI invocation) lives in `vexil_master.py`, not in the core process. Core logic should live in the core process.

The app feels like a collection of scripts glued together rather than a cohesive application.

---

## Summary — Action Items

| Priority | Item | Effort |
|----------|------|--------|
| High | Port `vexil_master.py` to Rust background thread + `reqwest` API calls | ~1-2 weeks |
| High | Fold `sync_real_buddy.ts` into a Tauri command | ~1 day |
| Medium | Replace file-based IPC with `tokio::mpsc` channels | Part of daemon port |
| Low | Reduce runtime count to Rust + JS only | Achieved by above |

**Foundation verdict**: Solid. Tauri + WKWebView + Rust + vanilla JS + SQLite are all correct choices. The peripheral scripts are prototype-era accretions that need to be integrated properly.
