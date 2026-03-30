/**
 * Pixel Terminal — app.js (bootstrap)
 * Wires all modules together. No business logic lives here.
 */

import { $, initDOM, autoResize, showConfirm } from './dom.js';
import {
  sessions, getActiveSessionId, IDENTITY_SEQ_KEY
} from './session.js';
import {
  spawnClaude, sendMessage, pickFolder,
  expandSlashCommand, warnIfUnknownCommand, setLifecycleDeps
} from './session-lifecycle.js';
import { pushMessage, updateWorkingCursor, setPinToBottom, renderMessageLog } from './messages.js';
import { handleEvent, setStatus, setEventDeps } from './events.js';
import { renderSessionCard, updateSessionCard, setActiveSession, showEmptyState } from './cards.js';
import { initVoice, isSettingsOpen, setSettingsOpen, settingsUpdate } from './voice.js';
import {
  loadSlashCommands, getSlashCommands, showSlashMenu, hideSlashMenu,
  moveSlashSelection, getSlashToken, getFlagToken,
  acceptActiveSlashItem, getSlashActiveIdx
} from './slash-menu.js';

const { invoke } = window.__TAURI__.core;

// ── Wire cross-module deps ────────────────────────────────
setLifecycleDeps({
  renderSessionCard,
  setActiveSession,
  pushMessage,
  setStatus,
  handleEvent,
  updateWorkingCursor,
  showEmptyState,
  get slashCommands() { return getSlashCommands(); },
  hideSlashMenu,
});

setEventDeps({
  expandSlashCommand,
  warnIfUnknownCommand,
});

// ── Bootstrap ─────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  initDOM();

  // One-time cleanup: remove stale flags that shouldn't persist across sessions
  localStorage.removeItem('alwaysOn');
  localStorage.removeItem('omiListening');
  localStorage.setItem(IDENTITY_SEQ_KEY, JSON.stringify({ idx: Math.floor(Math.random() * 1000) }));

  loadSlashCommands();
  initVoice();

  // Animate working badge: per-session phase cycles "" "." ".." "..." every 400ms
  setInterval(() => {
    sessions.forEach((s, id) => {
      if (s.status === 'working' && !s.unread) {
        s._dotsPhase = (s._dotsPhase + 1) % 4;
        const el = document.getElementById(`card-status-${id}`);
        if (el) el.textContent = '.'.repeat(s._dotsPhase);
      }
    });
  }, 400);

  // Open links in system browser
  $.messageLog.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#')) return;
    e.preventDefault();
    window.__TAURI__.opener.openUrl(href);
  });

  // Track scroll position
  $.messageLog.addEventListener('scroll', () => {
    setPinToBottom($.messageLog.scrollTop + $.messageLog.clientHeight >= $.messageLog.scrollHeight - 40);
  });

  // ── Sidebar resize ──────────────────────────────────────
  const sidebar = $.sidebar;
  const resizeHandle = $.sidebarResize;
  let _resizing = false, _resizeStartX = 0, _resizeStartW = 0;
  let _resizeRafId = null, _resizeW = 0;
  resizeHandle.addEventListener('mousedown', (e) => {
    _resizing = true;
    _resizeStartX = e.clientX;
    _resizeStartW = sidebar.offsetWidth;
    resizeHandle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!_resizing) return;
    _resizeW = Math.max(80, Math.min(340, _resizeStartW + (e.clientX - _resizeStartX)));
    if (!_resizeRafId) {
      _resizeRafId = requestAnimationFrame(() => {
        sidebar.style.width = _resizeW + 'px';
        _resizeRafId = null;
      });
    }
  });
  window.addEventListener('mouseup', () => {
    if (!_resizing) return;
    _resizing = false;
    if (_resizeRafId) { cancelAnimationFrame(_resizeRafId); _resizeRafId = null; sidebar.style.width = _resizeW + 'px'; }
    resizeHandle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  // Sidebar vertical resize (session list / voice log)
  const sessionList = $.sessionList;
  const hResizeHandle = $.sidebarHResize;
  let _hResizing = false, _hStartY = 0, _hStartH = 0;
  let _hRafId = null, _hH = 0;
  hResizeHandle.addEventListener('mousedown', (e) => {
    _hResizing = true;
    _hStartY = e.clientY;
    _hStartH = sessionList.offsetHeight;
    hResizeHandle.classList.add('dragging');
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!_hResizing) return;
    const sidebarH = sidebar.offsetHeight;
    _hH = Math.max(60, Math.min(sidebarH - 120, _hStartH + (e.clientY - _hStartY)));
    if (!_hRafId) {
      _hRafId = requestAnimationFrame(() => {
        sessionList.style.flex = 'none';
        sessionList.style.height = _hH + 'px';
        _hRafId = null;
      });
    }
  });
  window.addEventListener('mouseup', () => {
    if (!_hResizing) return;
    _hResizing = false;
    if (_hRafId) { cancelAnimationFrame(_hRafId); _hRafId = null; sessionList.style.height = _hH + 'px'; }
    hResizeHandle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem('sidebar-session-list-h', _hH);
  });
  const _savedH = localStorage.getItem('sidebar-session-list-h');
  if (_savedH) { sessionList.style.flex = 'none'; sessionList.style.height = _savedH + 'px'; }

  // ── Button wiring ───────────────────────────────────────
  $.btnNewSession.addEventListener('click', pickFolder);
  showEmptyState();

  $.btnSend.addEventListener('click', () => {
    const text = $.inputField.value;
    if (!text.trim() || !getActiveSessionId()) return;
    $.inputField.value = '';
    $.inputField.style.height = '';
    setPinToBottom(true);
    hideSlashMenu();
    sendMessage(getActiveSessionId(), text);
  });

  // ── Input handling ──────────────────────────────────────
  $.inputField.addEventListener('keydown', (e) => {
    const menuVisible = !$.slashMenu.classList.contains('hidden');
    if (menuVisible) {
      if (e.key === 'ArrowDown')  { e.preventDefault(); moveSlashSelection(1); return; }
      if (e.key === 'ArrowUp')    { e.preventDefault(); moveSlashSelection(-1); return; }
      if (e.key === 'Tab') { e.preventDefault(); acceptActiveSlashItem(); return; }
      if (e.key === 'Enter' && !e.shiftKey && getSlashActiveIdx() >= 0) {
        e.preventDefault(); acceptActiveSlashItem(); return;
      }
      if (e.key === 'Escape') { e.preventDefault(); hideSlashMenu(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = $.inputField.value;
      if (!text.trim() || !getActiveSessionId()) return;
      $.inputField.value = '';
      $.inputField.style.height = '';
      setPinToBottom(true);
      hideSlashMenu();
      sendMessage(getActiveSessionId(), text);
    }
  });

  $.inputField.addEventListener('input', (e) => {
    autoResize(e.target);
    const token = getSlashToken(e.target) || getFlagToken(e.target);
    if (token) { showSlashMenu(token); } else { hideSlashMenu(); }
  });

  // Click outside slash menu
  document.addEventListener('mousedown', (e) => {
    if (!$.slashMenu.classList.contains('hidden') &&
        !$.slashMenu.contains(e.target) && e.target !== $.inputField) {
      hideSlashMenu();
    }
  });

  // ── Keyboard shortcuts ──────────────────────────────────
  // Esc — cancel active Claude operation
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$.slashMenu.classList.contains('hidden')) return;
    if (!$.confirmOverlay?.classList.contains('hidden')) return;
    if (isSettingsOpen()) { setSettingsOpen(false); settingsUpdate(); return; }
    if (getActiveSessionId()) {
      const s = sessions.get(getActiveSessionId());
      if (s && s.child && (s.status === 'working' || s.status === 'waiting')) {
        e.preventDefault();
        s._interrupting = true;
        try { s.child.kill(); } catch (_) {}
        s.child = null;
        clearTimeout(s._idleTimer);
        pushMessage(getActiveSessionId(), { type: 'system-msg', text: 'Interrupted \u2014 restarting\u2026' });
        setStatus(getActiveSessionId(), 'waiting');
        s._restarting = true;
        spawnClaude(getActiveSessionId());
      }
    }
  });

  // Cmd+1-5 to switch sessions
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '5') {
      e.preventDefault();
      const ids = [...sessions.keys()];
      const target = ids[parseInt(e.key) - 1];
      if (target) setActiveSession(target);
    }
  });

  // ── Window close ────────────────────────────────────────
  const appWindow = window.__TAURI__.window.getCurrentWindow();
  let _forceClose = false;
  appWindow.onCloseRequested(async (event) => {
    if (_forceClose) return;
    event.preventDefault();
    const count = sessions.size;
    const msg = count > 0
      ? `Close Pixel Terminal? ${count} session${count > 1 ? 's' : ''} will be terminated.`
      : 'Close Pixel Terminal?';
    const ok = await showConfirm(msg);
    if (ok) {
      _forceClose = true;
      for (const [id] of sessions) {
        try { sessions.get(id)?.child?.kill(); } catch (_) {}
      }
      appWindow.close();
    }
  });

  // ── About dialog ────────────────────────────────────────
  const { listen: tauriListen } = window.__TAURI__.event;
  $.aboutClose?.addEventListener('click', () => {
    $.aboutOverlay?.classList.add('hidden');
  });
  $.aboutOverlay?.addEventListener('click', (e) => {
    if (e.target === $.aboutOverlay) $.aboutOverlay.classList.add('hidden');
  });
  tauriListen('show-about', () => {
    $.aboutOverlay?.classList.remove('hidden');
  });
});
