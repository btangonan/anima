import { beforeEach, afterEach, test, expect, vi } from 'vitest';

window.__TAURI__ = {
  shell: { Command: { create: vi.fn() } },
  core: { invoke: vi.fn().mockResolvedValue(null) },
  path: { homeDir: vi.fn().mockResolvedValue('/Users/testuser') },
  dialog: { open: vi.fn() },
  event: { listen: vi.fn().mockResolvedValue(() => {}) },
  opener: { revealItemInDir: vi.fn() },
};
window.__ANIMA_PERMISSION_MODE__ = 'bypass';
window.requestAnimationFrame = vi.fn((cb) => cb());
globalThis.requestAnimationFrame = window.requestAnimationFrame;

window.marked = {
  setOptions: vi.fn(),
  parse: vi.fn((text) => `<p>${text}</p>`),
};
window.DOMPurify = {
  sanitize: vi.fn((html) => html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')),
};

const domMod = await import('../src/dom.js');
const sessionMod = await import('../src/session.js');
const msgMod = await import('../src/messages.js');

const { $, initDOM } = domMod;
const { sessionLogs, sessions, setActiveSessionId, getActiveSessionId } = sessionMod;
const { createMsgEl, pushMessage } = msgMod;

async function loadMessages() {
  const sessionMod = await import('../src/session.js');
  const msgMod = await import('../src/messages.js?t=' + Math.random());
  return { sessionMod, msgMod };
}

function setupDOM() {
  document.body.innerHTML = '<div id="message-log"></div>';
  initDOM();
}

function teardownDOM() {
  document.body.innerHTML = '';
  $.messageLog = null;
}

beforeEach(() => {
  setupDOM();
  vi.clearAllMocks();
});

afterEach(() => {
  teardownDOM();
  sessions.clear();
  sessionLogs.clear();
  setActiveSessionId(null);
});

test('createMsgEl: user message', () => {
  const msg = { type: 'user', text: 'hello world' };
  const el = createMsgEl(msg);
  expect(el.className).toContain('user');
  expect(el.querySelector('.msg-bubble')).toBeTruthy();
  expect(el.querySelector('.msg-bubble').textContent).toBe('hello world');
});

test('createMsgEl: user message escapes HTML', () => {
  const msg = { type: 'user', text: '<script>alert(1)</script>' };
  const el = createMsgEl(msg);
  expect(el.innerHTML).not.toContain('<script>');
  expect(el.textContent).toBe('<script>alert(1)</script>');
});

test('createMsgEl: claude message', () => {
  const msg = { type: 'claude', text: 'hi there' };
  const el = createMsgEl(msg);
  expect(el.className).toContain('claude');
  expect(el.querySelector('.msg-bubble')).toBeTruthy();
  expect(el.querySelector('.msg-bubble').innerHTML).not.toBe('');
});

test('createMsgEl: tool message (non-MCP)', () => {
  const msg = { type: 'tool', toolName: 'Read', toolId: 'tool-1', input: '/path/to/file', result: null };
  const el = createMsgEl(msg);
  expect(el.dataset.toolId).toBe('tool-1');
  expect(el.querySelector('.tool-name').textContent).toContain('Read');
  expect(el.querySelector('.tool-status').textContent).toBe('…');
});

test('createMsgEl: tool message with result (completed)', () => {
  const msg = { type: 'tool', toolName: 'Read', toolId: 'tool-2', input: '', result: 'output text' };
  const el = createMsgEl(msg);
  expect(el.querySelector('.tool-status').textContent).toBe('✓');
});

test('createMsgEl: MCP tool message', () => {
  const msg = { type: 'tool', toolName: 'mcp__firecrawl__scrape', toolId: 'mcp-1', input: '', result: null };
  const el = createMsgEl(msg);
  expect(el.querySelector('.tool-mcp-badge')).toBeTruthy();
  expect(el.querySelector('.tool-name').textContent.startsWith('mcp__')).toBe(false);
  expect(el.querySelector('.tool-name').textContent).toContain('firecrawl__scrape');
});

test('createMsgEl: system-msg', () => {
  const msg = { type: 'system-msg', text: 'Ready · claude-sonnet-4-6' };
  const el = createMsgEl(msg);
  expect(el.querySelector('.system-label')).toBeTruthy();
  expect(el.textContent).toContain('Ready');
});

test('createMsgEl: error', () => {
  const msg = { type: 'error', text: 'something broke' };
  const el = createMsgEl(msg);
  expect(el.className).toContain('error');
  expect(el.querySelector('.error-msg').textContent).toContain('something broke');
});

test('createMsgEl: warn', () => {
  const msg = { type: 'warn', text: 'low memory' };
  const el = createMsgEl(msg);
  expect(el.querySelector('.warn-msg').textContent).toContain('low memory');
});

test('createMsgEl: hook-event', () => {
  const msg = { type: 'hook-event', hookName: 'PreToolUse', eventType: 'pre', payload: '{"tool":"Read"}' };
  const el = createMsgEl(msg);
  expect(el.querySelector('details.hook-event')).toBeTruthy();
  expect(el.querySelector('summary').textContent).toContain('PreToolUse');
});

test('createMsgEl: seq-think', () => {
  const msg = { type: 'seq-think', text: 'reasoning · step 1' };
  const el = createMsgEl(msg);
  expect(el.querySelector('.seq-think-label').textContent).toContain('reasoning');
});

test('pushMessage appends msg to sessionLogs regardless of DOM', () => {
  const id = 'inactive-session';
  sessionLogs.set(id, { messages: [] });
  setActiveSessionId('different-session');
  const result = pushMessage(id, { type: 'claude', text: 'hi' });
  expect(sessionLogs.get(id).messages.length).toBe(1);
  expect(sessionLogs.get(id).messages[0].text).toBe('hi');
  expect(result).toBeNull();
});

test('pushMessage creates DOM element and returns it when session is active', () => {
  const id = 'active-session';
  sessionLogs.set(id, { messages: [] });
  setActiveSessionId(id);
  const result = pushMessage(id, { type: 'user', text: 'hello' });
  expect(result).toBeInstanceOf(HTMLElement);
  expect($.messageLog.querySelectorAll('.msg').length).toBe(1);
});

test('pushMessage inserts BEFORE working cursor when cursor exists', () => {
  const id = 'cursor-session';
  sessionLogs.set(id, { messages: [] });
  setActiveSessionId(id);
  const cursor = document.createElement('div');
  cursor.id = 'working-cursor';
  $.messageLog.appendChild(cursor);
  pushMessage(id, { type: 'user', text: 'new msg' });
  expect($.messageLog.lastChild.id).toBe('working-cursor');
  expect($.messageLog.firstChild.classList.contains('msg')).toBe(true);
});

test('pushMessage returns null when sessionLogs has no entry for id', () => {
  const result = pushMessage('unknown-id', { type: 'user', text: 'hi' });
  expect(result).toBeNull();
});
