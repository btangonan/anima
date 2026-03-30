# STATE.md — Working State (re-read after compaction)
## Updated: 2026-03-30 08:45

### Active Work
- Character selection order fix COMPLETE: 0-degree originals first (shuffled), hue variants second (shuffled)
- All P0+P1 performance parity fixes COMPLETE

### Key IDs
- Collection: pixel_terminal (gemini-memory)
- localStorage key: 'pixel-terminal-identity-seq-v8'

### Decisions This Session
- Character selection: BASE_ANIMAL_COUNT=12, shuffle base then hue per cycle, stored as seq[] in localStorage
- bypassPermissions required for -p pipeline mode
- content_block_delta/start/stop handlers + rAF for streaming
- Image dims pre-computed from canvas before resize
- Production .app PATH fix deferred to packaging

### Blockers
- Production .app PATH: needs $SHELL -l -c env on launch (defer until app packaging)

### Last Session Snapshot
Date: 2026-03-30
Open actions:
- [x] Character selection order — 0-hue first per cycle, shuffled within each group ✓
- [ ] Production PATH fix — context: get_shell_path() Rust + cached invoke; only needed for .app distribution
- [ ] Full A/B test: drop image, ask dimensions → verify instant answer, zero Bash commands
- [ ] Per-animal hue subsets (ANIMAL_HUES) — carried from prior sessions *(auto-recovered)*
Decisions: 7 | Fixes: 5
Next: → test new character selection by opening multiple sessions; verify original-color animals appear before any hue variants
