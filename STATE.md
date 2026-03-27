# STATE.md — Working State (re-read after compaction)
## Updated: 2026-03-27

### Active Work
- Slash command autocomplete dropdown in pixel-terminal input bar
- Fixed recursive subdirectory scanning in lib.rs (sm:, sw:, sc: namespaces)
- Next fix: dropdown should trigger when `/command` appears mid-message, not just at start

### Key IDs
- Collection: pixel_terminal (gemini-memory)
- Tauri command: read_slash_commands (src-tauri/src/lib.rs)

### Decisions This Session
- Use `position: fixed` + JS-measured coordinates for slash menu (not absolute/flow)
- Custom Tauri command with std::fs beats tauri-plugin-fs for slash command reads
- Never disable inputs/buttons in terminal UX — ambient indicators only (rule added to RULES.md)
- Rotating words only during 'working' status, not 'waiting' (init phase)
- `_pinToBottom` flag: auto-scroll respects user scroll position

### Blockers
- None

### Last Session Snapshot
Date: 2026-03-27
Open actions:
- [ ] Fix slash menu to trigger mid-message (when `/word` appears anywhere, not just start of input) — context: current regex only matches `^/`
- [ ] Test full slash command list in dev: sm:introspect, sm:audit, sm:debug, sw:critic — context: subdirectory fix just landed
Decisions: 8 | Fixes: 6
Next: → Fix slash menu trigger to detect `/word` anywhere in input value
