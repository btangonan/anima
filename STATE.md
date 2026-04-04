# STATE.md — Working State (re-read after compaction)
## Updated: 2026-04-04

### Active Branch
`feat/ascii-buddies-gitgraph` — pushed, all changes committed

### Shipped This Session (2026-04-03/04)

#### ASCII Familiar System
- `session.js`: SpriteRenderer/ANIMALS/getNextIdentity removed; `rollFamiliarBones()` (FNV-1a + Mulberry32), `assignFamiliarHue()`, `releaseFamiliarHue()`, `FAMILIAR_SPECIES` (18) added
- `session-lifecycle.js`: createSession rolls familiar on spawn, killSession releases hue
- `cards.js`: session cards render `<pre class="familiar-pre">` via `renderFrame()`; `updateFamiliarDisplay()` exported
- `history.js`: SpriteRenderer replaced with ASCII pre in live pin
- `app.js`: 400ms tick cycles `s._familiarFrame` + calls `updateFamiliarDisplay()`
- `companion.js`: stale project-chars.json re-assignment block removed; JS override of tab text to 'BUDDY' removed
- `styles.css`: `.sprite-wrap` 48→60px; `.sprite-wrap pre.familiar-pre` added; session card familiars color → `var(--accent)` (white, matches project name)

#### Vexil Buddy Panel Unification → ORACLE
- `index.html`: wrapped panel in `#vexil-panel`; bio above log as flex row; BUDDY tab → ORACLE
- `styles.css`: outer border in companion-hue (45%); active tab hue-colored; bio row layout; timestamps [HH:MM]; `#vexil-panel` flex basis 0→40% (fixes shrunken log area)
- `voice.js`: `fmtTs()` reformats timestamps to `[HH:MM]`
- `companion.js`: removed `bio.classList.remove('hidden')`; removed JS override setting tab text to 'BUDDY' (was overwriting ORACLE on every init)

#### Other Fixes
- `launch.command`: duplicate export guard; fingerprint hashes all changed files; WebKit NetworkCache cleared on launch (correct path: `~/Library/Caches/pixel-terminal/WebKit/NetworkCache`)
- `events.js`: rate limit surfaces as system-msg in chat log
- `vexil_master.py`: `session_born` dict + 120s suppression for `read_heavy`
- `styles.css`: companion hue `#FF4422 → #CC7D5E` (warm terracotta)
- `buddy.json`: hue updated to `#CC7D5E`
- `CLAUDE.md`: retrieval order rule hardened — memory before files, mandatory

#### START HERE Banner
- Whale sprite replaced with random ASCII familiar walking left↔right
- `styles.css`: walker track 36→56px height, 9→15px font

### Pending
- **Vexil size in bio row**: Vexil ASCII art at 10px — needs to be more visually dominant vs session card familiars (6px). User said: "god creature master familiar." Layout approach not locked.
- **warn_near_limit root cause**: Restored lint warning. Real fix is writing memory docs <200 chars (schema discipline), not code.
- **Anthropic third-party policy** (April 4 12PM PT): pixel-terminal uses Claude Code CLI directly, not affected.

### Key IDs
- Collection: `pixel_terminal` (gemini-memory)
- Branch: `feat/ascii-buddies-gitgraph`
- buddy.json: `~/.config/pixel-terminal/buddy.json` (hue: #CC7D5E, species: duck, reportingMode: dev)
- Type scale: `--fs-lg(13) --fs-base(12) --fs-sm(11) --fs-xs(10)`
- Familiar hue palette: `['#FFDD44', '#FF8C42', '#40E0D0', '#FF6EC7']`

### Decisions
- Vexil = observer only, no direct chat input
- Session familiars: white (#fff, matches project name); Vexil: orange (#CC7D5E)
- Tab label = ORACLE (not BUDDY). Set in HTML only — JS must not override.
- `read_heavy` suppressed for first 120s — orientation reads are expected
- WebKit NetworkCache (not WebKit data dir) is what needs clearing for HTML changes to land
