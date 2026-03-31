// ── Event handler + status ─────────────────────────────────

import { $, mdParse, toolHint } from './dom.js';
import { sessions, sessionLogs, getActiveSessionId } from './session.js';
import { pushMessage, updateWorkingCursor, scheduleScroll } from './messages.js';
import { updateSessionCard } from './cards.js';

// Tools that are Claude Code internal scaffolding — never show in UI
const INTERNAL_TOOLS = new Set([
  'ToolSearch','TodoWrite','TodoRead','AskUserQuestion',
  'TaskCreate','TaskUpdate','TaskList','TaskGet','TaskStop','TaskOutput',
  'ExitPlanMode','EnterPlanMode','NotebookEdit',
  'RemoteTrigger','CronCreate','CronDelete','CronList',
  'ListMcpResourcesTool','ReadMcpResourceTool',
  'EnterWorktree','ExitWorktree',
]);
function isInternalTool(name) {
  return name.startsWith('mcp__') || INTERNAL_TOOLS.has(name);
}

export function setStatus(id, status) {
  const s = sessions.get(id);
  if (!s || s.status === status) return;
  if (status === 'working') s._dotsPhase = 0; // always start from "" on new working transition
  s.status = status;
  updateSessionCard(id);
  if (getActiveSessionId() === id) updateWorkingCursor(status);
}

export function handleEvent(id, event) {
  const s = sessions.get(id);
  if (!s) return;

  switch (event.type) {

    // ── Low-level streaming events (--verbose / stream-json) ──────────────
    // These fire incrementally as Claude generates. We stream text live and
    // show tool invocations immediately. The high-level 'assistant' event
    // arrives later with the full aggregated content — we use it only for
    // final state (usage, tool inputs) and skip anything already rendered.

    case 'content_block_start': {
      const blk = event.content_block;
      if (blk?.type === 'text') {
        // Prepare per-block stream state; message pushed on first delta
        s._streamText = '';
        s._streamMsg = null;
        s._streamEl = null;
      } else if (blk?.type === 'tool_use' && !isInternalTool(blk.name)) {
        // Show tool name immediately — input arrives later via 'assistant'
        const toolMsg = { type: 'tool', toolName: blk.name, toolId: blk.id, input: '', result: null };
        pushMessage(id, toolMsg);
        if (!s._streamedToolIds) s._streamedToolIds = new Set();
        s._streamedToolIds.add(blk.id);
        s.toolPending[blk.id] = true;
      }
      break;
    }

    case 'content_block_delta': {
      const delta = event.delta;
      if (delta?.type !== 'text_delta' || !delta.text) break;
      s._streamText = (s._streamText || '') + delta.text;

      if (!s._streamMsg) {
        // First delta — create the message and capture its DOM element
        s._streamMsg = { type: 'claude', text: s._streamText };
        s._streamEl = pushMessage(id, s._streamMsg);
        s._didStreamText = true;
      } else {
        // Accumulate in memory at full API speed.
        // Coalesce DOM writes at ~60fps — same pattern terminal emulators use.
        // Without this: O(n) textContent= on every delta, style recalc every time.
        s._streamMsg.text = s._streamText;
        s._streamMsg._html = null; // invalidate markdown cache
        if (!s._streamRafId) {
          s._streamRafId = requestAnimationFrame(() => {
            s._streamRafId = null;
            if (!s._streamMsg) return; // block_stop already fired
            let bubble = s._streamEl?.querySelector('.msg-bubble');
            if (!bubble && getActiveSessionId() === id) {
              const msgs = $.messageLog?.querySelectorAll('.msg.claude');
              if (msgs?.length) { s._streamEl = msgs[msgs.length - 1]; bubble = s._streamEl.querySelector('.msg-bubble'); }
            }
            if (bubble) { bubble.textContent = s._streamMsg.text; scheduleScroll(); }
          });
        }
      }
      setStatus(id, 'working');
      break;
    }

    case 'content_block_stop': {
      // Cancel any pending rAF flush — we're about to do a full markdown render anyway
      if (s._streamRafId) { cancelAnimationFrame(s._streamRafId); s._streamRafId = null; }

      // Block complete — re-render streamed text with full markdown
      if (s._streamMsg && s._streamEl) {
        const bubble = s._streamEl.querySelector('.msg-bubble');
        if (bubble) {
          const normalized = s._streamMsg.text.replace(/\n\n(?=[ \t]*(?:\d+[.)]\s|[-*+]\s))/g, '\n');
          s._streamMsg._html = mdParse(normalized);
          bubble.innerHTML = s._streamMsg._html;
          const paras = bubble.querySelectorAll('p');
          if (paras.length) paras[paras.length - 1].style.color = '#e8820c';
        }
      }
      // Clear per-block state; _didStreamText and _streamedToolIds persist until 'assistant'
      s._streamText = null;
      s._streamMsg = null;
      s._streamEl = null;
      break;
    }

    // ── High-level aggregated event (fires after all content_block_stop) ──

    case 'assistant': {
      // Cancel any pending idle debounce — Claude is still going
      clearTimeout(s._idleTimer);
      if (event.message?.usage) {
        s._lastMsgUsage = event.message.usage;
        const u = event.message.usage;
        // Only count input+output — cache_read recurs every turn (already-counted context),
        // causing exponential inflation. cache_creation has the same problem.
        s._liveTokens = (u.input_tokens || 0) + (u.output_tokens || 0);
      }
      const blocks = event.message?.content || [];

      // Skip text push if already streamed incrementally via content_block_delta
      if (!s._didStreamText) {
        const texts = blocks.filter(b => b.type === 'text').map(b => b.text);
        if (texts.length) pushMessage(id, { type: 'claude', text: texts.join('\n') });
      }
      s._didStreamText = false;

      for (const b of blocks) {
        if (b.type === 'tool_use') {
          const input = typeof b.input === 'object'
            ? JSON.stringify(b.input, null, 2)
            : String(b.input || '');
          if (!isInternalTool(b.name)) {
            if (s._streamedToolIds?.has(b.id)) {
              // Already shown — backfill the real input and re-render hint
              const data = sessionLogs.get(id);
              const toolMsg = data
                ? data.messages.findLast(m => m.type === 'tool' && m.toolId === b.id)
                : null;
              if (toolMsg) {
                toolMsg.input = input;
                toolMsg._hint = undefined; // force recompute
                if (getActiveSessionId() === id) {
                  const toolEl = $.messageLog?.querySelector(`[data-tool-id="${b.id}"]`);
                  if (toolEl) {
                    const hint = toolHint(b.name, input);
                    const hintEl = toolEl.querySelector('.tool-hint');
                    if (hintEl) { hintEl.textContent = hint || ''; }
                    else if (hint) {
                      const span = document.createElement('span');
                      span.className = 'tool-hint';
                      span.textContent = hint;
                      toolEl.querySelector('.tool-status')?.before(span);
                    }
                  }
                }
              }
            } else {
              pushMessage(id, { type: 'tool', toolName: b.name, toolId: b.id, input, result: null });
            }
          }
          s.toolPending[b.id] = true;
        }
      }
      s._streamedToolIds = null;

      setStatus(id, 'working'); // no-op if already working — so always refresh card for live tokens
      updateSessionCard(id);
      break;
    }

    case 'user': {
      const blocks = event.message?.content || [];
      for (const b of blocks) {
        if (b.type === 'tool_result') {
          const resultText = typeof b.content === 'string'
            ? b.content
            : JSON.stringify(b.content);
          const data = sessionLogs.get(id);
          // tool_use always precedes tool_result — scan from end, no reverse copy needed
          const toolMsg = data
            ? data.messages.findLast(m => m.type === 'tool' && m.toolId === b.tool_use_id)
            : null;
          if (toolMsg) {
            toolMsg.result = resultText;
            if (getActiveSessionId() === id) {
              // Targeted update: swap just the status glyph instead of rebuilding all messages
              const toolEl = $.messageLog?.querySelector(`[data-tool-id="${b.tool_use_id}"]`);
              if (toolEl) {
                toolEl.querySelector('.tool-status').textContent = '\u2713';
              }
            }
          }
          delete s.toolPending[b.tool_use_id];
        }
      }
      break;
    }

    case 'result': {
      // Prefer result.usage (per-turn total); fall back to live tokens already shown
      const u = event.usage || s._lastMsgUsage;
      if (u) s.tokens += (u.input_tokens || 0) + (u.output_tokens || 0);
      else s.tokens += s._liveTokens; // result.usage absent and no assistant usage either
      s._liveTokens = 0;
      s._lastMsgUsage = null;
      // Debounce: Claude may immediately start another turn after result.
      // Wait 400ms before going idle so the cursor doesn't flicker between turns.
      clearTimeout(s._idleTimer);
      s._idleTimer = setTimeout(() => {
        setStatus(id, 'idle');
        if (getActiveSessionId() !== id) {
          s.unread = true;
          updateSessionCard(id);
        }
      }, 400);
      break;
    }

    case 'system':
      if (event.subtype === 'init') {
        pushMessage(id, { type: 'system-msg', text: `Ready \u00b7 ${event.model || 'claude'}` });
        // After ESC restart, always go idle regardless of status.
        // Otherwise: don't clobber 'working' if user queued a message before init.
        if (s._restarting || s.status !== 'working') setStatus(id, 'idle');
        s._restarting = false;
        // Flush message queued before Claude was ready.
        // pushMessage here so it appears AFTER "Ready" in the log.
        if (s._pendingMsg && s.child) {
          const { expandSlashCommand } = _eventDeps;
          const { warnIfUnknownCommand } = _eventDeps;
          const msg = s._pendingMsg;
          s._pendingMsg = null;
          if (warnIfUnknownCommand(id, msg)) break;
          pushMessage(id, { type: 'user', text: msg }); // show original
          expandSlashCommand(msg).then(expanded => {
            if (!s.child) return;
            return s.child.write(JSON.stringify({ type: 'user', message: { role: 'user', content: expanded } }) + '\n');
          }).catch(() => {
            pushMessage(id, { type: 'error', text: 'Failed to send \u2014 please resend your message' });
            setStatus(id, 'idle');
          });
        }
      }
      break;

    case 'rate_limit_event':
      // CLI retries automatically — don't add a permanent log entry (looks like an error).
      // Flash badge to 'waiting' for 3s so there's ambient feedback without alarming the user.
      setStatus(id, 'waiting');
      clearTimeout(s._rateLimitTimer);
      s._rateLimitTimer = setTimeout(() => {
        if (s.status === 'waiting') setStatus(id, 'working');
      }, 3000);
      break;
  }
}

// Deps injected from app.js to break circular import with session-lifecycle
let _eventDeps = { expandSlashCommand: null, warnIfUnknownCommand: null };
export function setEventDeps(deps) { _eventDeps = deps; }
