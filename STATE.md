# STATE.md — Working State (re-read after compaction)
## Updated: 2026-04-04

### Active Work
- **PR B in progress**: `feat/sync-buddy-rust` — port `sync_real_buddy.ts` to Rust `sync_buddy` Tauri command
- PR C queued: daemon→Rust (event routing + oracle via invoke, ~1-2 weeks)
- Launch prep blocked on PR B+C completion

### Key IDs / Paths
- `main` = `a008019` (PR A audit wins merged, 2026-04-04)
- `feat/sync-buddy-rust` = off main — PR B branch, no commits yet
- buddy.json: `~/.config/pixel-terminal/buddy.json`
- Feed: `~/.local/share/pixel-terminal/vexil_feed.jsonl`
- App name: **Anima** | Bundle ID: `com.bradleytangonan.anima`

### Decisions This Session
- Squash-merged PR #1 → main (80+ commits → 1 clean commit `57c9f8f`)
- 4-PR daemon→Rust plan: A(audit)→B(sync_buddy)→C(daemon)→D(cleanup)
- Auth deferred: `claude -p` via `tauri-plugin-shell` (reqwest deferred — OAuth token undocumented)
- PR B parity: 1000 test vectors from Bun, commit as fixture, validate in `cargo test`
- PR C concurrency: `Arc<Mutex<DaemonState>>`, mpsc(32), Semaphore(2), timeout(30s)
- Companion gaps 1-3 all closed (EYES, HATS, oracle trait injection)

### Blockers
- PR #2 merge blocked on manual smoke test: drag file > 20MB into chat, confirm error token appears

### Last Session Snapshot
Date: 2026-04-04 (Session 3 end)
Open actions:
- [x] Smoke test > 20MB attachment — PASSED, toast works
- [x] Merge PR #2 — done, main = a008019
- [ ] Confirm vexil daemon feed path: `~/.local/share/pixel-terminal/vexil_feed.jsonl`
- [ ] PR B: sync_buddy Tauri command in commands/companion.rs + wyhash crate + 1000 test vectors
- [ ] Launch prep: Demo GIF, README rewrite, v0.1.0-alpha .dmg, awesome-claude-code PR
Decisions: 6 | Fixes: 8 | Progress: 3
Next: → PR B — generate test vectors from sync_real_buddy.ts, port to Rust, validate parity
