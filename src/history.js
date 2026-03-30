// ── Session History ─────────────────────────────────────────
// Browse, search, and view past Claude Code sessions from JSONL files.
// Read-only. Reuses createMsgEl() from messages.js for rendering.

import { $ } from './dom.js';

const { invoke } = window.__TAURI__.core;

// DI — set by app.js via setHistoryDeps()
let _deps = {
  renderMessageLog: null,
  createMsgEl: null,
  sessions: null,
  getActiveSessionId: null,
};

export function setHistoryDeps(deps) {
  _deps = { ..._deps, ...deps };
}

// ── State ───────────────────────────────────────────────────
let _entries = [];       // cached scan results (SessionHistoryEntry[])
let _filtered = [];      // after search filter
let _activeId = null;    // session_id of currently viewed history entry
let _cachedMsgs = {};    // session_id → SessionHistoryMessage[] (avoid re-fetch)
let _scannedCwd = null;  // cwd last scanned (to avoid duplicate scans)
let _searchTimer = null;

// ── Public API ──────────────────────────────────────────────

export function initHistory() {
  // Tab click handlers
  document.querySelectorAll('.session-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab === 'hist') showHistoryTab();
      else showLiveTab();
    });
  });

  // Search input
  if ($.historySearch) {
    $.historySearch.addEventListener('input', (e) => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => filterHistory(e.target.value.trim()), 300);
    });
  }
}

/** Scan history for the given project cwd. Idempotent — skips if already scanned. */
export async function scanHistory(cwd) {
  if (_scannedCwd === cwd) return;
  _scannedCwd = cwd;

  try {
    const raw = await invoke('scan_session_history', { projectPath: cwd });
    // Filter out sessions currently live
    const liveIds = new Set(_deps.sessions ? [..._deps.sessions.keys()] : []);
    _entries = raw.filter(e => !liveIds.has(e.session_id));
    _filtered = _entries;
    renderHistoryList(_filtered);
  } catch (err) {
    console.error('[history] scan failed:', err);
  }
}

/** Force a re-scan (refresh button, or after a session ends). */
export async function refreshHistory(cwd) {
  _scannedCwd = null;
  await scanHistory(cwd);
}

export function showHistoryTab() {
  // Activate tab button
  document.querySelectorAll('.session-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === 'hist');
  });
  $.sessionList?.classList.add('hidden');
  $.historyView?.classList.remove('hidden');
}

export function showLiveTab() {
  document.querySelectorAll('.session-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === 'live');
  });
  $.historyView?.classList.add('hidden');
  $.sessionList?.classList.remove('hidden');
  exitHistoryView();
}

export function exitHistoryView() {
  if (!_activeId) return;
  _activeId = null;

  // Re-enable input
  if ($.inputField) {
    $.inputField.disabled = false;
    $.inputField.placeholder = 'Message Claude Code...';
  }
  if ($.btnSend) $.btnSend.disabled = false;

  // Remove active highlight from history cards
  document.querySelectorAll('.history-card').forEach(c => c.classList.remove('active'));

  // Restore the live session's message log
  const activeId = _deps.getActiveSessionId?.();
  if (activeId && _deps.renderMessageLog) {
    _deps.renderMessageLog(activeId);
  }
}

// ── Rendering ───────────────────────────────────────────────

function renderHistoryList(entries) {
  if (!$.historyList) return;
  $.historyList.innerHTML = '';

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = 'no past sessions';
    $.historyList.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const entry of entries) {
    frag.appendChild(createHistoryCard(entry));
  }
  $.historyList.appendChild(frag);
}

function createHistoryCard(entry) {
  const card = document.createElement('div');
  card.className = 'history-card';
  card.dataset.sessionId = entry.session_id;

  const name = entry.slug
    || (entry.first_user_message ? entry.first_user_message.slice(0, 42) : null)
    || (entry.session_id.slice(0, 8) + '…');

  const date = entry.timestamp_start ? formatDate(entry.timestamp_start) : '';
  const preview = entry.first_user_message ? entry.first_user_message.slice(0, 80) : '';
  const size = formatSize(entry.file_size);

  card.innerHTML = `
    <div class="history-card-name">${escHtml(name)}</div>
    <div class="history-card-meta">
      <span class="history-card-date">${escHtml(date)}</span>
      <span class="history-card-size">${escHtml(size)}</span>
    </div>
    ${preview ? `<div class="history-card-preview">${escHtml(preview)}</div>` : ''}
  `;

  card.addEventListener('click', () => loadHistorySession(entry, card));
  return card;
}

// ── Load full session ────────────────────────────────────────

async function loadHistorySession(entry, cardEl) {
  if (_activeId === entry.session_id) return;

  // Mark loading
  document.querySelectorAll('.history-card').forEach(c => c.classList.remove('active'));
  cardEl.classList.add('active', 'loading');

  try {
    let messages = _cachedMsgs[entry.session_id];
    if (!messages) {
      messages = await invoke('load_session_history', { filePath: entry.file_path });
      _cachedMsgs[entry.session_id] = messages;
    }

    _activeId = entry.session_id;
    cardEl.classList.remove('loading');

    // Disable input
    if ($.inputField) {
      $.inputField.disabled = true;
      $.inputField.placeholder = 'read-only history';
    }
    if ($.btnSend) $.btnSend.disabled = true;

    // Render messages into the log
    renderHistoryMessages(messages);

  } catch (err) {
    console.error('[history] load failed:', err);
    cardEl.classList.remove('loading');
    _activeId = null;
  }
}

function renderHistoryMessages(messages) {
  if (!$.messageLog || !_deps.createMsgEl) return;
  $.messageLog.innerHTML = '';

  // Convert SessionHistoryMessage → internal msg format for createMsgEl
  const frag = document.createDocumentFragment();
  for (const m of messages) {
    const msg = convertMsg(m);
    if (msg) frag.appendChild(_deps.createMsgEl(msg));
  }
  $.messageLog.appendChild(frag);
  $.messageLog.lastElementChild?.scrollIntoView({ block: 'end' });
}

function convertMsg(m) {
  switch (m.msg_type) {
    case 'user':
      return m.text ? { type: 'user', text: m.text } : null;
    case 'claude':
      return m.text ? { type: 'claude', text: m.text } : null;
    case 'tool':
      return {
        type: 'tool',
        toolName: m.tool_name || '',
        toolId: m.tool_id || '',
        input: m.tool_input || '',
        result: '—',  // history: mark as complete
      };
    default:
      return null;
  }
}

// ── Search ───────────────────────────────────────────────────

function filterHistory(query) {
  if (!query) {
    _filtered = _entries;
  } else {
    const q = query.toLowerCase();
    _filtered = _entries.filter(e =>
      (e.slug && e.slug.toLowerCase().includes(q)) ||
      (e.first_user_message && e.first_user_message.toLowerCase().includes(q)) ||
      (e.timestamp_start && formatDate(e.timestamp_start).toLowerCase().includes(q))
    );
  }
  renderHistoryList(_filtered);
}

// ── Utilities ────────────────────────────────────────────────

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch (_) {
    return iso || '';
  }
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
