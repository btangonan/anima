# STATE.md — Working State (re-read after compaction)
## Updated: 2026-04-04

### Active Work
- PR #2 open (`refactor/rust-daemon-port`, `f9d2298`) — awaiting smoke test then merge to main
- PR B next: `sync_buddy` Tauri command (port sync_real_buddy.ts to Rust) + 1000 test vectors
- PR C queued: daemon→Rust (event routing + oracle via invoke, ~1-2 weeks)
- Launch prep blocked on PR B+C completion

### Key IDs / Paths
- `main` = `57c9f8f` (Anima v0.1 squash, 2026-04-04)
- `refactor/rust-daemon-port` = `f9d2298` (PR A audit wins) — PR #2 open
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
Date: 2026-04-04 (Session 3)
Open actions (MERGED — from 2 sessions):
- [ ] Smoke test > 20MB attachment — confirm error token, no hang (blocks PR #2 merge)
- [ ] Confirm vexil daemon feed path: `~/.local/share/pixel-terminal/vexil_feed.jsonl`
- [ ] Merge PR #2 after smoke test
- [ ] PR B: sync_buddy Tauri command + 1000 test vectors (UUID→buddy fixture)
- [ ] Launch prep: Demo GIF, README rewrite, v0.1.0-alpha .dmg, awesome-claude-code PR
Decisions: 6 | Fixes: 7 | Progress: 2
Next: → smoke test > 20MB file drag → merge PR #2 → start PR B
