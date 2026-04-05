# STATE.md — Working State (re-read after compaction)
## Updated: 2026-04-05 15:15

### Active Work
- **Oracle fixes**: Fixed oracle_query reqId camelCase bug (voice.js + session-lifecycle.js). Removed companion bubble entirely — oracle commentary goes to ORACLE log tab only.
- **MCP permission gate**: Shipped anima_gate.py + --permission-prompt-tool. Approval dialog standalone (#approval-overlay). Replaces bypassPermissions.
- **Cross-session leak**: Fixed 3 IPC paths (MCP gate, hook gate, lint) — all gated by ANIMA_SESSION env var
- **Launch prep**: README complete, audit clean — waiting on GIF + screenshots + testing MCP gate in Anima

### Key IDs / Paths
- `main` = `979cbeb` (Why Anima? section, 2026-04-05) — oracle fixes + bubble removal uncommitted
- buddy.json: `~/.config/pixel-terminal/buddy.json`
- Feed: `~/.local/share/pixel-terminal/vexil_feed.jsonl`
- App name: **Anima** | Bundle ID: `com.bradleytangonan.anima`
- gemini-memory: `pixel_terminal` (~148 entries)
- MCP gate: `src-tauri/mcp/anima_gate.py` (NDJSON stdio server)
- MCP config: written at runtime to `/tmp/anima_mcp_config.json`

### Decisions This Session
- Replaced --permission-mode bypassPermissions with --permission-mode default + --permission-prompt-tool mcp__anima__approve
- NDJSON framing (not Content-Length) for Claude Code MCP stdio transport
- Session-scoped IPC via ANIMA_SESSION env var passed in Command.create env option
- is_anima_session() rewritten from broken ps approach to os.environ.get('ANIMA_SESSION')
- memory_lint.py gated by ANIMA_SESSION to prevent cross-session lint leaks
- --settings '{"hooks":{}}' is the safe way to test without hooks (never mv hooks dir)
- Companion bubble removed entirely — oracle commentary goes to ORACLE log tab only, approval dialog is standalone #approval-overlay
- oracle_query invoke fixed: req_id → reqId (Tauri v2 camelCase convention)

### Blockers
- MCP gate untested in live Anima session (built + compiles, needs manual test)
- ensureMcpConfig() hardcodes ~/Projects/pixel-terminal path — needs Tauri resource bundling for prod

### Last Session Snapshot
Date: 2026-04-05
Open actions (MERGED — from 2 sessions):
- [ ] Test MCP permission gate in live Anima session (write to ~/Desktop/ to trigger) — context: gate built but never tested end-to-end
- [ ] Record demo GIF (30-45s: session start → companion → Vexil bubble → nim tick) — context: hero asset, repo can't convert without it
- [ ] Take 3 screenshots (docs/screenshots/session-card, familiar-card, vexil-bubble) — context: README images placeholder
- [ ] `npm run tauri build` → v0.1.0-alpha GitHub Release with .dmg attached — context: install path broken without release binary
- [ ] awesome-claude-code PR submission — context: 36.5K stars, highest-leverage single action
- [ ] Tauri resource bundling for anima_gate.py — context: hardcoded dev path won't work in production .app bundle
- [ ] Commit oracle fixes + bubble removal — context: reqId fix, bubble stripped, approval dialog standalone
Decisions: 8 | Fixes: 5
Next: → Commit oracle + bubble changes, then test MCP permission gate end-to-end in Anima
