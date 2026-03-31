// ── Message rendering + scroll ─────────────────────────────

import { $, esc, mdParse, toolIcon, toolHint } from './dom.js';
import { sessions, sessionLogs, getActiveSessionId } from './session.js';

const WORKING_MSGS = [
  'thinking', 'scheming', 'deliberating', 'gallivanting', 'pondering',
  'contemplating', 'ruminating', 'cogitating', 'hypothesizing', 'spelunking',
  'wrangling', 'untangling', 'cross-referencing', 'noodling', 'vibing',
  'consulting the void', 'reading the entrails', 'asking nicely',
  'summoning context', 'doing its thing',
];
let _workingTimer = null;
let _workingMsgIdx = 0;

// rAF-coalesced scroll — only scrolls if user hasn't manually scrolled up
let _scrollPending = false;
let _pinToBottom = true;

export function setPinToBottom(val) { _pinToBottom = val; }
export function getPinToBottom() { return _pinToBottom; }

export function scheduleScroll(force = false) {
  if (!force && !_pinToBottom) return;
  if (_scrollPending) return;
  _scrollPending = true;
  requestAnimationFrame(() => {
    _scrollPending = false;
    if ($.messageLog) $.messageLog.lastElementChild?.scrollIntoView({ block: 'end' });
  });
}

export function updateWorkingCursor(status) {
  if (!$.messageLog) return;
  let cur = document.getElementById('working-cursor');
  if (status === 'working') {
    if (!cur) {
      cur = document.createElement('div');
      cur.id = 'working-cursor';
      $.messageLog.appendChild(cur);
      scheduleScroll();
    }
    // Build cursor structure once, update text node only — avoid innerHTML re-parsing every 3s
    if (!cur.firstChild) {
      const glyph = document.createElement('span');
      glyph.className = 'cursor-blink';
      glyph.textContent = '\u258b';
      cur.appendChild(glyph);
      cur.appendChild(document.createTextNode(''));
    }
    const textNode = cur.lastChild;
    const setMsg = () => {
      textNode.textContent = ' ' + WORKING_MSGS[_workingMsgIdx++ % WORKING_MSGS.length] + '\u2026';
    };
    setMsg();
    clearInterval(_workingTimer);
    _workingTimer = setInterval(setMsg, 3000);
  } else {
    clearInterval(_workingTimer);
    _workingTimer = null;
    cur?.remove();
  }
}

export function pushMessage(id, msg) {
  const data = sessionLogs.get(id);
  if (!data) return null;
  data.messages.push(msg);
  if (getActiveSessionId() === id) {
    if ($.messageLog) {
      // Insert BEFORE the working cursor so cursor stays at bottom
      const cursor = document.getElementById('working-cursor');
      const el = createMsgEl(msg);
      el.classList.add('msg-new');
      if (cursor) $.messageLog.insertBefore(el, cursor);
      else $.messageLog.appendChild(el);
      scheduleScroll();
      return el;
    }
  }
  return null;
}

export function renderMessageLog(id) {
  if (!$.messageLog) return;
  $.messageLog.innerHTML = ''; // cursor gets wiped here — restore below
  const data = sessionLogs.get(id);
  if (data) {
    // DocumentFragment: build all elements off-DOM, single reflow on append
    const frag = document.createDocumentFragment();
    for (const msg of data.messages) frag.appendChild(createMsgEl(msg));
    $.messageLog.appendChild(frag);
  }
  // Always restore cursor to match current session status
  const s = sessions.get(id);
  if (s && s.status === 'working') {
    updateWorkingCursor(s.status);
  }
  scheduleScroll();
}

export function createMsgEl(msg) {
  const el = document.createElement('div');
  el.className = `msg ${msg.type}`;

  if (msg.type === 'user') {
    el.innerHTML = `<div class="msg-bubble">${esc(msg.text)}</div>`;

  } else if (msg.type === 'claude') {
    // Cache parsed HTML — msg.text is immutable after creation
    if (!msg._html) {
      const normalized = msg.text.replace(/\n\n(?=[ \t]*(?:\d+[.)]\s|[-*+]\s))/g, '\n');
      msg._html = mdParse(normalized);
    }
    el.innerHTML = `<div class="msg-bubble">${msg._html}</div>`;
    // Orange for the last paragraph regardless of trailing hr/empty nodes
    const paras = el.querySelectorAll('.msg-bubble p');
    if (paras.length) paras[paras.length - 1].style.color = '#e8820c';

  } else if (msg.type === 'tool') {
    const icon = toolIcon(msg.toolName);
    // Cache hint — msg.input is immutable after creation
    if (msg._hint === undefined) msg._hint = toolHint(msg.toolName, msg.input);
    const hint = msg._hint;
    const hasResult = msg.result !== null && msg.result !== undefined;
    const status = hasResult ? '\u2713' : '\u2026';
    el.dataset.toolId = msg.toolId;
    el.innerHTML = `<div class="tool-line">${icon} <span class="tool-name">${esc(msg.toolName)}</span>${hint ? ` <span class="tool-hint">${esc(hint)}</span>` : ''} <span class="tool-status">${status}</span></div>`;

  } else if (msg.type === 'system-msg') {
    el.innerHTML = `<div class="system-label">${esc(msg.text)}</div>`;

  } else if (msg.type === 'error') {
    el.innerHTML = `<div class="error-msg">${esc(msg.text)}</div>`;
  } else if (msg.type === 'warn') {
    el.innerHTML = `<div class="warn-msg">${esc(msg.text)}</div>`;
  }

  return el;
}
