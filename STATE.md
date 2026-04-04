# STATE.md — Working State (re-read after compaction)
## Updated: 2026-04-04

### Active Branch
`feat/familiar-card-phase2` — pushed, latest commit `e67afa3`

### Uncommitted Changes
None — all session work committed and pushed.

### Shipped This Session (2026-04-04)

#### Familiar Name Generator
- Syllable combiner in `src/session.js`: 61 starts × 35 ends = 2135 combos
- 5 thematic pools: Asian Folklore, Polynesian, Tolkien/Elven, Valyrian, Cyber-Pet
- Blocklist: `Aegon`, `Radon`, `Torys`, `Finbit` (4 entries — upstream pool fixes handle the rest)
- `rollFamiliarBones(path, rerollCount=0)` — appends `-rN` suffix to seed for re-rolls
- Name shown in profile card header as title; species shown as TYPE field

#### @nim@ Currency System (`src/nim.js`)
- Global balance in `localStorage['pixel-nim-balance']`
- `NIM_PER_TOKENS = 1000` — 1 nim per 1000 tokens spent
- `REROLL_NIM_COST = 0` — gate open for testing; change this one constant to charge
- `accrueNimForSession(s)` hooked into `events.js` 'result' case after `s.tokens` commits
- `_nimTokensAccrued: 0` on session shape prevents double-counting on session restart

#### Re-roll Mechanic
- `getFamiliarRerollCount(cwd)` / `incrementFamiliarReroll(cwd)` — localStorage per project path
- Re-roll button in profile card footer — disabled+locked when balance < cost
- `showRerollConfirm(sessionId)` — confirm dialog with cost / balance / "lost forever" warning
- On confirm: spends nim, increments reroll count, re-rolls familiar, refreshes sidebar, reopens profile card
- `_buildSpriteWrap(wrap, id)` helper — single source of truth for sidebar sprite DOM

#### Cleanup
- Familiar name label removed from sidebar session cards (profile card only)
- `.familiar-name` CSS rule removed

### Pending / Next
- **Live test** the re-roll flow in the actual app — unverified
- **Oracle bug fixes**: src/voice.js + launch.command — still uncommitted from prior session
- **Production PATH fix**: `get_shell_path()` Rust command for .app Dock launch
- **Nim accrual display**: show nim balance somewhere in UI (sidebar footer? settings?)
- **PR**: merge `feat/familiar-card-phase2` → main when re-roll is verified

### Key IDs
- Collection: `pixel_terminal` (gemini-memory)
- Branch: `feat/familiar-card-phase2`
- buddy.json: `~/.config/pixel-terminal/buddy.json`
- Type scale: `--fs-lg(13) --fs-base(12) --fs-sm(11) --fs-xs(10)`
- Log: `/tmp/pixel-terminal.log`
- `FAMILIAR_SALT = 'pixel-familiar-2026'`

### Key Files
- `src/nim.js` — @nim@ currency primitives (new this session)
- `src/session.js` — rollFamiliarBones, name pools, reroll helpers
- `src/cards.js` — profile card, confirm dialog, _buildSpriteWrap
- `src/events.js` — nim accrual hook in 'result' case

### Decisions
- Nim is global (not per-session) — earned across all sessions, spent on any familiar
- Re-roll determinism: same path + same count = same familiar forever
- Blocklist rotates ends (no extra rng() calls) to avoid shifting stat seeds
- REROLL_NIM_COST lives in nim.js as a single constant — one file change to gate
- Name labels not shown in sidebar — profile card only
