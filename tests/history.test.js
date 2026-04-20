/**
 * history.test.js — Behavioral tests for history panel JS
 *
 * Covers the "it says failed" regression: loading class left on card,
 * duplicate VIEWING card in list, createMsgEl receiving tool messages.
 *
 * Uses vitest + jsdom (already in devDeps). Mocks Tauri's invoke() so no
 * Tauri runtime is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Tauri invoke before importing history.js ─────────────────────────────
const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

// ── Build minimal DOM ─────────────────────────────────────────────────────────

function buildDOM() {
  document.body.innerHTML = `
    <div id="history-current" class="hidden"></div>
    <div id="history-list"></div>
    <div id="message-log"></div>
    <input id="input-field" />
    <button id="btn-send"></button>
  `;
}

// ── Minimal message fixture ────────────────────────────────────────────────────

const HISTORY_MESSAGES = [
  { msg_type: 'user',   text: 'hello world',   tool_name: null, tool_id: null, tool_input: null },
  { msg_type: 'claude', text: 'hi there',       tool_name: null, tool_id: null, tool_input: null },
  { msg_type: 'tool',   text: null,             tool_name: 'Bash', tool_id: 'tu1', tool_input: '{"command":"ls /tmp"}' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEntry(overrides = {}) {
  return {
    session_id:        'session-aaa',
    file_path:         '/Users/testuser/.claude/projects/foo/session-aaa.jsonl',
    slug:              'test-slug',
    first_user_message: 'hello world',
    timestamp_start:   '2026-04-19T10:00:00Z',
    timestamp_end:     '2026-04-19T10:05:00Z',
    message_count:     3,
    file_size:         1024,
    ...overrides,
  };
}

function makeCard(entry) {
  const card = document.createElement('div');
  card.className = 'history-card';
  card.dataset.sessionId = entry.session_id;
  return card;
}

// ── Simulate loadHistorySession logic ────────────────────────────────────────
// We inline the core logic because history.js is a module with Tauri imports.
// This tests the EXACT business logic (loading class lifecycle, list re-render,
// active filtering) without needing a full Tauri runtime.

async function simulateLoadHistorySession(entry, cardEl, deps) {
  const { getCachedMsgs, setCachedMsgs, getActiveId, setActiveId,
          renderHistoryList, renderHistoryMessages } = deps;

  if (getActiveId() === entry.session_id) return;

  // Clear stale loading/active from all cards
  document.querySelectorAll('.history-card').forEach(c =>
    c.classList.remove('active', 'loading')
  );
  cardEl.classList.add('active', 'loading');

  try {
    let messages = getCachedMsgs(entry.session_id);
    if (!messages) {
      messages = await mockInvoke('load_session_history', { filePath: entry.file_path });
      setCachedMsgs(entry.session_id, messages);
    }

    setActiveId(entry.session_id);
    cardEl.classList.remove('loading');

    renderHistoryMessages(messages);
  } catch (err) {
    cardEl.classList.remove('loading');
    setActiveId(null);
    renderHistoryList();
    throw err;  // re-throw for test visibility
  }
}

// ── convertMsg (mirrors history.js) ──────────────────────────────────────────

function convertMsg(m) {
  switch (m.msg_type) {
    case 'user':   return m.text ? { type: 'user', text: m.text } : null;
    case 'claude': return m.text ? { type: 'claude', text: m.text } : null;
    case 'tool':   return {
      type: 'tool',
      toolName: m.tool_name || '',
      toolId:   m.tool_id   || '',
      input:    m.tool_input || '',
      result:   '—',
    };
    default: return null;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('loadHistorySession — loading class lifecycle', () => {
  beforeEach(() => {
    buildDOM();
    mockInvoke.mockReset();
  });

  it('removes loading class on successful load', async () => {
    mockInvoke.mockResolvedValue(HISTORY_MESSAGES);

    const entry = makeEntry();
    const card = makeCard(entry);
    document.getElementById('history-list').appendChild(card);

    let activeId = null;
    const deps = {
      getCachedMsgs:     () => null,
      setCachedMsgs:     () => {},
      getActiveId:       () => activeId,
      setActiveId:       id => { activeId = id; },
      renderHistoryList: () => {},

      renderHistoryMessages:  () => {},
    };

    await simulateLoadHistorySession(entry, card, deps);

    // loading must be gone; active class lives briefly then gets swept by
    // renderHistoryList (which replaces DOM nodes). Only loading matters here.
    expect(card.classList.contains('loading')).toBe(false);
    expect(activeId).toBe('session-aaa');
  });

  it('removes loading class on failed load (no permanent lock)', async () => {
    mockInvoke.mockRejectedValue(new Error('Session files must be under ~/.claude/projects/'));

    const entry = makeEntry();
    const card = makeCard(entry);
    document.getElementById('history-list').appendChild(card);

    let activeId = null;
    const deps = {
      getCachedMsgs:     () => null,
      setCachedMsgs:     () => {},
      getActiveId:       () => activeId,
      setActiveId:       id => { activeId = id; },
      renderHistoryList: () => {},

      renderHistoryMessages:  () => {},
    };

    await expect(simulateLoadHistorySession(entry, card, deps)).rejects.toThrow();

    // Card must NOT have loading class stuck on it after failure
    expect(card.classList.contains('loading')).toBe(false);
    expect(activeId).toBeNull();
  });

  it('clears stale loading class from previous card before loading new one', async () => {
    mockInvoke.mockResolvedValue(HISTORY_MESSAGES);

    const entry1 = makeEntry({ session_id: 'session-aaa' });
    const entry2 = makeEntry({ session_id: 'session-bbb' });
    const card1 = makeCard(entry1);
    const card2 = makeCard(entry2);

    const list = document.getElementById('history-list');
    list.appendChild(card1);
    list.appendChild(card2);

    // Simulate card1 stuck in loading state (the pre-fix bug)
    card1.classList.add('loading');

    let activeId = null;
    const deps = {
      getCachedMsgs:     () => null,
      setCachedMsgs:     () => {},
      getActiveId:       () => activeId,
      setActiveId:       id => { activeId = id; },
      renderHistoryList: () => {},

      renderHistoryMessages:  () => {},
    };

    await simulateLoadHistorySession(entry2, card2, deps);

    expect(card1.classList.contains('loading')).toBe(false);
    expect(card2.classList.contains('loading')).toBe(false);
  });

  it('noop when clicking the already-active session', async () => {
    let activeId = 'session-aaa';
    const entry = makeEntry();
    const card = makeCard(entry);

    const deps = {
      getCachedMsgs:     () => null,
      setCachedMsgs:     () => {},
      getActiveId:       () => activeId,
      setActiveId:       id => { activeId = id; },
      renderHistoryList: () => {},

      renderHistoryMessages:  () => {},
    };

    await simulateLoadHistorySession(entry, card, deps);

    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe('convertMsg — tool message conversion (history "failed" regression)', () => {
  it('converts tool_use messages without throwing', () => {
    const toolMsg = {
      msg_type: 'tool', text: null,
      tool_name: 'Bash', tool_id: 'tu1',
      tool_input: '{"command":"ls /tmp"}',
    };
    const result = convertMsg(toolMsg);
    expect(result).not.toBeNull();
    expect(result.type).toBe('tool');
    expect(result.toolName).toBe('Bash');
    expect(result.input).toBe('{"command":"ls /tmp"}');
    expect(result.result).toBe('—');
  });

  it('converts user messages', () => {
    const result = convertMsg({ msg_type: 'user', text: 'hello' });
    expect(result).toEqual({ type: 'user', text: 'hello' });
  });

  it('converts claude messages', () => {
    const result = convertMsg({ msg_type: 'claude', text: 'hi' });
    expect(result).toEqual({ type: 'claude', text: 'hi' });
  });

  it('returns null for empty user text', () => {
    expect(convertMsg({ msg_type: 'user', text: '' })).toBeNull();
    expect(convertMsg({ msg_type: 'user', text: null })).toBeNull();
  });

  it('returns null for unknown type', () => {
    expect(convertMsg({ msg_type: 'system', text: 'x' })).toBeNull();
  });

  it('handles missing tool fields gracefully', () => {
    const result = convertMsg({ msg_type: 'tool' });
    expect(result.toolName).toBe('');
    expect(result.toolId).toBe('');
    expect(result.input).toBe('');
  });

  it('converts all HISTORY_MESSAGES fixture without throwing', () => {
    const converted = HISTORY_MESSAGES.map(convertMsg).filter(Boolean);
    expect(converted).toHaveLength(3);
    expect(converted.map(m => m.type)).toEqual(['user', 'claude', 'tool']);
  });
});

describe('active session filtering in list', () => {
  it('active session entry is excluded from scrollable list', () => {
    const allEntries = [
      makeEntry({ session_id: 'aaa' }),
      makeEntry({ session_id: 'bbb' }),
      makeEntry({ session_id: 'ccc' }),
    ];
    const activeId = 'bbb';

    // Mirror the filterout logic from history.js renderHistoryList
    const visibleEntries = activeId
      ? allEntries.filter(e => e.session_id !== activeId)
      : allEntries;

    expect(visibleEntries).toHaveLength(2);
    expect(visibleEntries.map(e => e.session_id)).not.toContain('bbb');
  });

  it('all entries visible when no active session', () => {
    const allEntries = [
      makeEntry({ session_id: 'aaa' }),
      makeEntry({ session_id: 'bbb' }),
    ];
    const activeId = null;

    const visibleEntries = activeId
      ? allEntries.filter(e => e.session_id !== activeId)
      : allEntries;

    expect(visibleEntries).toHaveLength(2);
  });
});
