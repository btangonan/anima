# STATE.md — Working State (re-read after compaction)
## Updated: 2026-03-31 05:10

### Active Work
- App icon squircle issue — macOS not applying rounded corners to Cmd+Tab icon
- Icons rebuilt as RGBA from pixel logo PNG (3x NEAREST), Tauri compiles OK
- Session card highlight: white bar + white gradient (left-fading)
- Sidebar bg changed to --bg (#080808), search icon + session filtering added
- #session-panel wrapper fixes layout jump on LIVE/HISTORY tab switch
- History broken fixed: missing `invoke` import in history.js
- Sprite Y offsets changed to centering formula

### Key IDs
- Collection: pixel_terminal (gemini-memory)
- --bg: #080808, --bg2: #0e0e0e
- --logo-orange: #db7656, --logo-green: #7bb54f

### Decisions This Session
- Active session card: white accent border + white gradient fading left
- Sidebar bg = --bg (same as message log) per user request
- #session-panel wrapper for stable layout across tab switches
- History search bar hidden by default, toggled via search icon
- SPRITE_Y_OFFSETS: centering formula round(((16-vis_height)/2 - top) × 3)
- Icons must be RGBA for Tauri generate_context!() macro

### Blockers
- macOS squircle not applying to app icon in Cmd+Tab (active debug)
- Production .app PATH fix (deferred)

### Last Session Snapshot
Date: 2026-03-31
Open actions (MERGED — from 7 sessions):
- [ ] Fix macOS app icon squircle in Cmd+Tab
- [ ] Production PATH fix — context: get_shell_path() Rust + cached invoke
- [ ] Full A/B test: drop image, ask dimensions → verify zero Bash commands
- [ ] Per-animal hue subsets (ANIMAL_HUES map) *(auto-recovered)*
Decisions: 29 | Fixes: 19
Next: → Fix macOS squircle icon
