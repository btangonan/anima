/**
 * logger.test.js
 *
 * Tests for pxLog in logger.js.
 * pxLog is fire-and-forget (invoke catch(() => {})), so the main contract is:
 *   1. Does not throw when invoke fails
 *   2. Calls invoke('js_log') with a msg containing the level and parts
 *   3. Timestamp is embedded in the correct position
 */
import { beforeEach, afterEach, test, expect, vi } from 'vitest';

// ── Tauri shim ────────────────────────────────────────────────────────────────

const _mockInvoke = vi.fn();

window.__TAURI__ = {
  shell: { Command: { create: vi.fn() } },
  core: { invoke: _mockInvoke },
  path: { homeDir: vi.fn() },
  dialog: { open: vi.fn() },
  event: { listen: vi.fn() },
};

// ── Module loader ─────────────────────────────────────────────────────────────

async function loadLogger() {
  return import('../src/logger.js?t=' + Math.random());
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── pxLog does not throw ──────────────────────────────────────────────────────

test('pxLog does not throw when invoke resolves', async () => {
  _mockInvoke.mockResolvedValue(null);
  const { pxLog } = await loadLogger();
  expect(() => pxLog('INFO', 'test message')).not.toThrow();
  await Promise.resolve(); // flush microtasks
});

test('pxLog does not throw when invoke rejects', async () => {
  _mockInvoke.mockRejectedValue(new Error('invoke failed'));
  const { pxLog } = await loadLogger();
  expect(() => pxLog('ERROR', 'test failure')).not.toThrow();
  await Promise.resolve();
});

// ── pxLog calls js_log with correct format ────────────────────────────────────

test('pxLog calls invoke("js_log") with level in msg', async () => {
  _mockInvoke.mockResolvedValue(null);
  const { pxLog } = await loadLogger();

  pxLog('SPAWN', 'starting process');
  await Promise.resolve();

  expect(_mockInvoke).toHaveBeenCalledWith('js_log', expect.objectContaining({
    msg: expect.stringContaining('[SPAWN]'),
  }));
  expect(_mockInvoke).toHaveBeenCalledWith('js_log', expect.objectContaining({
    msg: expect.stringContaining('starting process'),
  }));
});

test('pxLog joins multiple parts with space', async () => {
  _mockInvoke.mockResolvedValue(null);
  const { pxLog } = await loadLogger();

  pxLog('MSG→', 'id:abc123', '"hello world"');
  await Promise.resolve();

  const call = _mockInvoke.mock.calls.find(c => c[0] === 'js_log');
  expect(call).toBeTruthy();
  const msg = call[1].msg;
  expect(msg).toContain('id:abc123');
  expect(msg).toContain('"hello world"');
});

test('pxLog embeds HH:MM:SS.mmm timestamp', async () => {
  _mockInvoke.mockResolvedValue(null);
  const { pxLog } = await loadLogger();

  pxLog('TEST', 'timestamp check');
  await Promise.resolve();

  const call = _mockInvoke.mock.calls.find(c => c[0] === 'js_log');
  const msg = call[1].msg;
  // Format: "HH:MM:SS.mmm [LEVEL] parts"
  expect(msg).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}/);
});

test('pxLog works with no extra parts', async () => {
  _mockInvoke.mockResolvedValue(null);
  const { pxLog } = await loadLogger();
  expect(() => pxLog('INIT')).not.toThrow();
  await Promise.resolve();
  const call = _mockInvoke.mock.calls.find(c => c[0] === 'js_log');
  expect(call[1].msg).toContain('[INIT]');
});
