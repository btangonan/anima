# Session Checkpoint — pixel-terminal (Anima)
**Date**: 2026-04-04 (Session 3)
**Branch**: `refactor/rust-daemon-port` off `main` (`57c9f8f`)

## Decisions Made
- Squash-merged `security/pr1-hardening` → `main` as `57c9f8f` (80+ commits → 1 clean commit)
- **4-PR daemon→Rust migration plan** confirmed and Gemini-graded (B→A):
  - PR A: audit fixes (shipped)
  - PR B: `sync_buddy` Tauri command + 1000 test vector parity suite
  - PR C: daemon→Rust (event routing + oracle via `invoke`, `Arc<Mutex>`, mpsc, Semaphore)
  - PR D: remove Python fallback after C is stable
- Auth deferred: keep `claude -p` via `tauri-plugin-shell` — direct `reqwest` requires undocumented OAuth token extraction from `~/.claude.json`
- PR B parity strategy: generate 1000 UUID→buddy vectors from Bun, commit as `tests/fixtures/buddy_vectors.json`, assert exact match in `cargo test`

## Fixes Applied
- **Companion Gap 2**: `sync_real_buddy.ts` HATS aligned to `ascii-sprites.js` — removed `'party'`/`'cowboy'` (no renderer), added `'propeller'`/`'tinyduck'`
- **Companion Gap 3**: Oracle trait line (species/voice/peak_stat) now built once, shared across both sessions and no-sessions branches; guard broadened to `if buddy_species or buddy_voice or peak_stat`
- **PR A — OOM guard**: `get_file_size` Rust command added; `attachments.js` rejects > 20MB before IPC read
- **PR A — Path traversal**: `vexil_master.py:_read_file_context` uses `is_relative_to()` with Python < 3.9 fallback
- **PR A — Inode rotation**: `vexil_master.py` main() tracks feed inode, resets `feed_offset` on rotation
- **PR A — rollStat comment**: Fixed misleading "3d10 extremes" → accurate "2d10 average, triangular"
- **PR A — CI**: `.github/workflows/test.yml` — Vitest + cargo test on push/PR to main

## Progress
- PR #1 squash-merged to `main` — Anima v0.1 shipped
- PR #2 open: `btangonan/pixel-terminal#2` — 15/15 Vitest + 15/15 cargo test
- Gemini arch review: `docs/ARCH_REVIEW_2026-04-04.md` — Tauri/Rust ✓, daemon = liability, polyglot sprawl
- Full migration plan documented with concurrency design (Gemini-reviewed, grade A)

## Tips & Gotchas
- `gemini-2.5-pro-preview-03-25` is expired (404) — use `gemini-2.5-pro`
- `gemini-2.0-flash` deprecated for new users — use `gemini-2.5-flash` or `gemini-2.5-pro`
- `claude -p` inherits credentials automatically — direct `reqwest` requires undocumented token extraction, defer to future PR
- Companion EYES: `['dot','star','x','circle','at','degree']` — must match `EYE_CHARS` in `ascii-sprites.js`
- Companion HATS: `['none','crown','tophat','propeller','halo','wizard','beanie','tinyduck']` — must match `HATS` object in `ascii-sprites.js`

## Open Questions
- [ ] What is the exact token format in `~/.claude.json` for OAuth? (needed for future direct API)
- [ ] Should `sync_buddy` run at `setup()` or `RunEvent::Ready`? (Ready fires after dock icon — may matter for ordering)

## Blockers
- [ ] Manual smoke test: drag file > 20MB into chat — confirm error token, no hang (blocks PR #2 merge)
- [ ] Confirm vexil feed path used in production: `~/.local/share/pixel-terminal/vexil_feed.jsonl`

## Memories Logged
- 6 new memories → `pixel_terminal`
- 1 new memory → `claude_global_knowledge` (Gemini model IDs)

## Next Session Suggested Start
→ Drag a file > 20MB into chat to smoke-test the OOM guard → merge PR #2 → start PR B (`sync_buddy` Tauri command + test vector generation)
