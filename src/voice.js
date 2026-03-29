// ── Voice bridge (Omi + PTT + always-on + settings) ────────

import { $ } from './dom.js';
import { sessions, getActiveSessionId } from './session.js';
import { sendMessage } from './session-lifecycle.js';
import { pushMessage } from './messages.js';
import { setActiveSession } from './cards.js';

const { Command } = window.__TAURI__.shell;
const { invoke } = window.__TAURI__.core;
const { listen: tauriListen } = window.__TAURI__.event;

// ── State ──────────────────────────────────────────────────
let omiConnected = false;
let omiListening = true; // always start listening
let voiceSource = localStorage.getItem('voiceSource') || 'ble';
let alwaysOn = false;
let pttActive = false;
let settingsOpen = false;

// ── Public getters ─────────────────────────────────────────
export function isSettingsOpen() { return settingsOpen; }
export function setSettingsOpen(val) { settingsOpen = val; }

// ── Voice log ──────────────────────────────────────────────
const MAX_VOICE_LOG = 200;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function appendVoiceLog(text, ts, dispatched) {
  if (!$.voiceLog || !text) return;
  const entry = document.createElement('div');
  entry.className = 'voice-entry' + (dispatched ? ' dispatched' : '');
  entry.innerHTML = `<span class="ts">${escapeHtml(ts || '')}</span>${dispatched ? '\u25b6 ' : ''}${escapeHtml(text)}`;
  $.voiceLog.appendChild(entry);
  while ($.voiceLog.children.length > MAX_VOICE_LOG) $.voiceLog.removeChild($.voiceLog.firstChild);
  $.voiceLog.scrollTop = $.voiceLog.scrollHeight;
}

// ── Indicator updates ──────────────────────────────────────
function _omiIndicatorUpdate() {
  if (!$.omiIndicator) return;
  $.omiIndicator.classList.remove('connected');
  if (omiConnected) {
    $.omiIndicator.classList.add('connected');
    $.omiIndicator.title = 'Omi connected \u2014 click for settings (fn = push to talk)';
  } else {
    $.omiIndicator.title = 'Omi voice bridge disconnected \u2014 click for settings';
  }
}

function _showDotStatus(msg) {
  if (!$.omiIndicator) return;
  const prev = $.omiIndicator.title;
  $.omiIndicator.title = msg;
  setTimeout(() => { $.omiIndicator.title = prev; }, 2500);
}

function _alwaysOnUpdate() {
  if (!$.alwaysOnBtn) return;
  if (alwaysOn) {
    $.alwaysOnBtn.classList.add('active');
    $.alwaysOnBtn.title = 'Always-on mic active \u2014 click to return to trigger mode (Ctrl+Shift+A)';
  } else {
    $.alwaysOnBtn.classList.remove('active');
    $.alwaysOnBtn.title = 'Always-on mic off \u2014 no "hey pixel" needed when on (Ctrl+Shift+A)';
  }
}

function _pttIndicatorUpdate() {
  if (!$.omiIndicator) return;
  if (pttActive) {
    $.omiIndicator.classList.add('ptt');
  } else {
    $.omiIndicator.classList.remove('ptt');
  }
}

function _settingsUpdate() {
  if (!$.settingsPanel) return;
  $.settingsPanel.classList.toggle('hidden', !settingsOpen);
  $.settingsBtn?.classList.toggle('open', settingsOpen);
  $.voiceSourceBle?.classList.toggle('active', voiceSource === 'ble');
  $.voiceSourceMic?.classList.toggle('active', voiceSource === 'mic');
}

export { _settingsUpdate as settingsUpdate };

// ── Actions ────────────────────────────────────────────────
function toggleOmiListening() {
  omiListening = !omiListening;
  _omiIndicatorUpdate();
  try { invoke('set_omi_listening', { enabled: omiListening }); } catch (_) {}
}

function toggleAlwaysOn() {
  alwaysOn = !alwaysOn;
  _alwaysOnUpdate();
  try { invoke('set_voice_mode', { mode: alwaysOn ? 'always_on' : 'trigger_mode' }); } catch (_) {}
}

function _isPttKey(e) {
  return e.key === 'Fn' || e.code === 'Fn' || e.code === 'AltRight';
}

function _switchVoiceSource(source) {
  voiceSource = source;
  localStorage.setItem('voiceSource', voiceSource);
  _settingsUpdate();
  _omiIndicatorUpdate();
  const label = source === 'ble' ? 'BLE pendant' : 'Mac mic';
  appendVoiceLog(`Switching to ${label} \u2014 reconnecting...`, new Date().toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'}), false);
  try { invoke('switch_voice_source', { source }); } catch (_) {}
}

function resolveSession(ref) {
  if (ref == null) return getActiveSessionId();
  if (typeof ref === 'number') {
    const keys = [...sessions.keys()];
    return keys[ref - 1] || getActiveSessionId();
  }
  const needle = String(ref).toLowerCase();
  for (const [id, s] of sessions) {
    if (s.name.toLowerCase().includes(needle)) return id;
  }
  return getActiveSessionId();
}

// ── Init (called once from bootstrap) ──────────────────────
export function initVoice() {
  // Omi indicator click
  $.omiIndicator?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (omiConnected) {
      _showDotStatus('Voice bridge connected');
    } else {
      const home = await window.__TAURI__.path.homeDir();
      const script = `${home}Projects/pixel-terminal/launch.command`;
      Command.create('open', [script]).execute().catch(() => {
        _showDotStatus('Run launch.command to connect');
      });
    }
  });

  // Ctrl+Shift+O — toggle listening
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'O') {
      e.preventDefault();
      toggleOmiListening();
    }
  });

  // Omi command events
  tauriListen('omi:command', (event) => {
    const { type, text, session, ts, dispatched } = event.payload;
    if (type === 'transcript') {
      if (omiConnected && omiListening) appendVoiceLog(text, ts, dispatched);
      return;
    }
    if (!omiListening) return;
    const targetId = resolveSession(session ?? null);
    if (!targetId) return;
    if (type === 'prompt') {
      sendMessage(targetId, text);
    } else if (type === 'switch') {
      setActiveSession(targetId);
    } else if (type === 'list_sessions') {
      const lines = [...sessions.entries()]
        .map(([_, s], i) => `${i + 1}. ${s.name} [${s.status}]`)
        .join('\n');
      pushMessage(getActiveSessionId(), { type: 'system-msg', text: `Omi sessions:\n${lines}` });
    }
  });

  // Clear voice log button
  $.btnClearVoiceLog?.addEventListener('click', () => {
    if ($.voiceLog) $.voiceLog.innerHTML = '';
  });

  // Connection events
  tauriListen('omi:connected', () => {
    omiConnected = true;
    _omiIndicatorUpdate();
    try { invoke('set_omi_listening', { enabled: omiListening }); } catch (_) {}
    try { invoke('set_voice_mode', { mode: alwaysOn ? 'always_on' : 'trigger_mode' }); } catch (_) {}
  });

  tauriListen('omi:disconnected', () => {
    omiConnected = false;
    _omiIndicatorUpdate();
  });

  // Always-on toggle
  $.alwaysOnBtn?.addEventListener('click', toggleAlwaysOn);
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'A') {
      e.preventDefault();
      toggleAlwaysOn();
    }
  });
  _alwaysOnUpdate();

  // PTT (push-to-talk)
  document.addEventListener('keydown', (e) => {
    if (!_isPttKey(e)) return;
    if (pttActive) return;
    if (!omiConnected) return;
    pttActive = true;
    try { invoke('ptt_start'); } catch (_) {}
    _pttIndicatorUpdate();
  });
  document.addEventListener('keyup', (e) => {
    if (!_isPttKey(e)) return;
    if (!pttActive) return;
    pttActive = false;
    try { invoke('ptt_release'); } catch (_) {}
    _pttIndicatorUpdate();
  });

  // Settings panel
  $.settingsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsOpen = !settingsOpen;
    _settingsUpdate();
  });
  document.addEventListener('click', () => {
    if (settingsOpen) { settingsOpen = false; _settingsUpdate(); }
  });
  $.settingsPanel?.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  $.voiceSourceBle?.addEventListener('click', () => _switchVoiceSource('ble'));
  $.voiceSourceMic?.addEventListener('click', () => _switchVoiceSource('mic'));
  _settingsUpdate();
}
