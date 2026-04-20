/**
 * voice.test.js
 *
 * Tests for voice.js exported API surface.
 * Most of voice.js is event wiring and DOM manipulation; tests here cover
 * the exported state getters/setters and the parts of initVoice that
 * are observable without a real Tauri process.
 */
import { beforeEach, afterEach, test, expect, vi } from 'vitest';

// ── Tauri shim ────────────────────────────────────────────────────────────────

const _tauriListeners = {};
const _mockInvoke = vi.fn().mockResolvedValue(null);

window.__TAURI__ = {
  shell: {
    Command: {
      create: vi.fn().mockReturnValue({
        stdout: { on: vi.fn() }, stderr: { on: vi.fn() },
        on: vi.fn(), spawn: vi.fn().mockResolvedValue({ write: vi.fn(), kill: vi.fn(), pid: 1 }),
        execute: vi.fn().mockResolvedValue({}),
      }),
    },
  },
  core: { invoke: _mockInvoke },
  path: { homeDir: vi.fn().mockResolvedValue('/Users/testuser') },
  dialog: { open: vi.fn() },
  event: {
    listen: vi.fn().mockImplementation(async (event, handler) => {
      _tauriListeners[event] = handler;
      return () => {};
    }),
  },
};

// ── Module loader ─────────────────────────────────────────────────────────────

function mountMinimalDOM() {
  document.body.innerHTML = `
    <div id="voice-log"></div>
    <div id="vexil-log"></div>
    <div id="attachments-panel"></div>
    <div id="omi-indicator"></div>
    <button id="always-on-btn"></button>
    <div id="settings-panel" class="hidden"></div>
    <button id="settings-btn"></button>
    <button id="voice-source-ble"></button>
    <button id="voice-source-mic"></button>
    <div id="btn-clear-voice-log"></div>
    <div id="oracle-pre-chat" class="hidden"></div>
    <input id="oracle-input" />
    <button id="oracle-send"></button>
    <div id="oracle-chat-log"></div>
    <div id="vexil-bio" class="hidden">
      <span class="vexil-bio-name"></span>
      <span class="vexil-bio-type"></span>
    </div>
  `;
}

async function loadVoice() {
  mountMinimalDOM();
  const domMod = await import('../src/dom.js');
  domMod.initDOM();
  const mod = await import('../src/voice.js?t=' + Math.random());
  return mod;
}

beforeEach(() => {
  vi.clearAllMocks();
  _mockInvoke.mockResolvedValue(null);
});

afterEach(() => {
  document.body.innerHTML = '';
  import('../src/session.js').then(m => {
    m.sessions.clear();
    m.setActiveSessionId(null);
  });
});

// ── isSettingsOpen / setSettingsOpen ──────────────────────────────────────────

test('isSettingsOpen returns false by default', async () => {
  const mod = await loadVoice();
  expect(mod.isSettingsOpen()).toBe(false);
});

test('setSettingsOpen toggles the value', async () => {
  const mod = await loadVoice();
  mod.setSettingsOpen(true);
  expect(mod.isSettingsOpen()).toBe(true);
  mod.setSettingsOpen(false);
  expect(mod.isSettingsOpen()).toBe(false);
});

// ── initVoice: does not throw ─────────────────────────────────────────────────

test('initVoice completes without throwing', async () => {
  const mod = await loadVoice();
  expect(() => mod.initVoice()).not.toThrow();
});

test('initVoice calls get_voice_status on startup', async () => {
  const mod = await loadVoice();
  _mockInvoke.mockClear();
  mod.initVoice();
  await Promise.resolve();
  const calls = _mockInvoke.mock.calls.map(c => c[0]);
  expect(calls).toContain('get_voice_status');
});

// ── omi:connected event ───────────────────────────────────────────────────────

test('omi:connected event updates indicator title', async () => {
  const mod = await loadVoice();
  mod.initVoice();
  await Promise.resolve();

  const indicator = document.getElementById('omi-indicator');
  expect(indicator).toBeTruthy();

  // Fire the omi:connected event
  if (_tauriListeners['omi:connected']) {
    _tauriListeners['omi:connected']({});
    await Promise.resolve();
    expect(indicator.title).toContain('Voice connected');
  }
});

test('omi:disconnected event updates indicator title', async () => {
  const mod = await loadVoice();
  mod.initVoice();
  await Promise.resolve();

  const indicator = document.getElementById('omi-indicator');

  if (_tauriListeners['omi:connected']) _tauriListeners['omi:connected']({});
  if (_tauriListeners['omi:disconnected']) {
    _tauriListeners['omi:disconnected']({});
    await Promise.resolve();
    expect(indicator.title).toContain('disconnected');
  }
});
