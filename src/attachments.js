// ── File Attachments ─────────────────────────────────────

import { $, esc } from './dom.js';

// Per-session store: Map<sessionId, Attachment[]>
// Attachment: { id, name, path, mimeType, data, isImage, status: 'staged'|'sent' }
const store = new Map();

let _getActiveSessionId = null;

export function initAttachments({ getActiveSessionId }) {
  _getActiveSessionId = getActiveSessionId;
  wireDragDrop();
  wireContextMenu();
  wireClearBtn();
  // Re-render when active session changes
  document.addEventListener('pixel:session-changed', () => {
    renderAttachmentTokens();
    renderAttachmentPanel();
  });
}

export function getStagedAttachments(sessionId) {
  return (store.get(sessionId) || []).filter(a => a.status === 'staged');
}

export function markAttachmentsSent(sessionId) {
  const atts = store.get(sessionId);
  if (!atts) return;
  atts.forEach(a => { if (a.status === 'staged') a.status = 'sent'; });
  renderAttachmentTokens();
  renderAttachmentPanel();
}

// ── File reading ─────────────────────────────────────────

function guessMimeType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' };
  return map[ext] || 'text/plain';
}

async function readFileData(file) {
  const mimeType = file.type || guessMimeType(file.name);
  const isImage = mimeType.startsWith('image/');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('FileReader failed'));
    if (isImage) {
      reader.onload = () => {
        const result = reader.result;
        const b64 = result.includes(',') ? result.split(',')[1] : result;
        resolve({ mimeType, data: b64, isImage: true });
      };
      reader.readAsDataURL(file);
    } else {
      reader.onload = () => resolve({ mimeType, data: reader.result, isImage: false });
      reader.readAsText(file);
    }
  });
}

async function stageFile(sessionId, file) {
  let fileData;
  try { fileData = await readFileData(file); } catch { return; }

  const att = {
    id: crypto.randomUUID(),
    name: file.name,
    path: file.path || '',  // Tauri provides .path on OS-dropped File objects
    mimeType: fileData.mimeType,
    data: fileData.data,
    isImage: fileData.isImage,
    status: 'staged',
  };
  if (!store.has(sessionId)) store.set(sessionId, []);
  store.get(sessionId).push(att);
  renderAttachmentTokens();
  renderAttachmentPanel();
}

// ── Drag & Drop ──────────────────────────────────────────

function wireDragDrop() {
  const el = $.chatView;
  const indicator = document.getElementById('drop-indicator');

  el.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    el.classList.add('drag-over');
    indicator?.classList.remove('hidden');
  });

  el.addEventListener('dragover', (e) => {
    const hasFiles = e.dataTransfer?.types?.includes('Files');
    const hasInternal = e.dataTransfer?.types?.includes('application/x-pixel-attachment');
    if (!hasFiles && !hasInternal) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = hasInternal ? 'move' : 'copy';
  });

  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget)) {
      el.classList.remove('drag-over');
      indicator?.classList.add('hidden');
    }
  });

  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    el.classList.remove('drag-over');
    indicator?.classList.add('hidden');
    const sessionId = _getActiveSessionId?.();
    if (!sessionId) return;

    // Internal re-drag: re-stage a panel item
    const internalId = e.dataTransfer.getData('application/x-pixel-attachment');
    if (internalId) {
      const att = (store.get(sessionId) || []).find(a => a.id === internalId);
      if (att) att.status = 'staged';
      renderAttachmentTokens();
      renderAttachmentPanel();
      return;
    }

    // OS file drop
    const files = [...(e.dataTransfer.files || [])];
    for (const file of files) await stageFile(sessionId, file);
  });
}

// ── Token rendering (above input textarea) ───────────────

export function renderAttachmentTokens() {
  const sessionId = _getActiveSessionId?.();
  const container = document.getElementById('attachment-tokens');
  if (!container) return;
  const staged = sessionId ? getStagedAttachments(sessionId) : [];
  if (staged.length === 0) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }
  container.classList.remove('hidden');
  container.innerHTML = staged.map(a =>
    `<span class="att-token" data-id="${a.id}">` +
    `<span class="att-tok-icon">${a.isImage ? '◈' : '◇'}</span>` +
    `<span class="att-tok-name">${esc(a.name)}</span>` +
    `<span class="att-tok-rm" data-id="${a.id}">×</span>` +
    `</span>`
  ).join('');

  container.querySelectorAll('.att-tok-rm').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sid = _getActiveSessionId?.();
      if (!sid) return;
      const atts = store.get(sid);
      if (atts) {
        const idx = atts.findIndex(a => a.id === btn.dataset.id);
        if (idx !== -1) atts.splice(idx, 1);
      }
      renderAttachmentTokens();
      renderAttachmentPanel();
    });
  });
}

// ── Attachment panel (sidebar) ───────────────────────────

export function renderAttachmentPanel() {
  const sessionId = _getActiveSessionId?.();
  const container = document.getElementById('attachments-panel');
  if (!container) return;
  const atts = sessionId ? (store.get(sessionId) || []) : [];
  if (atts.length === 0) {
    container.innerHTML = '<div class="att-empty">drop files here</div>';
    return;
  }
  container.innerHTML = atts.map(a =>
    `<div class="att-item att-${a.status}" data-id="${a.id}" data-path="${esc(a.path)}" draggable="true">` +
    `<span class="att-item-icon">${a.isImage ? '▣' : '▤'}</span>` +
    `<span class="att-item-name" title="${esc(a.name)}">${esc(a.name)}</span>` +
    `${a.status === 'staged' ? '<span class="att-item-badge">queued</span>' : ''}` +
    `</div>`
  ).join('');

  container.querySelectorAll('.att-item').forEach(el => {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-pixel-attachment', el.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showCtxMenu(e.clientX, e.clientY, el.dataset.id, el.dataset.path);
    });
  });
}

// ── Context menu ─────────────────────────────────────────

let _ctx = null;

function showCtxMenu(x, y, attachmentId, path) {
  const menu = document.getElementById('attachment-ctx-menu');
  if (!menu) return;
  _ctx = { attachmentId, path };
  menu.style.left = Math.min(x, window.innerWidth - 160) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - 90) + 'px';
  menu.classList.remove('hidden');
}

function hideCtxMenu() {
  document.getElementById('attachment-ctx-menu')?.classList.add('hidden');
  _ctx = null;
}

function wireContextMenu() {
  document.addEventListener('mousedown', (e) => {
    const menu = document.getElementById('attachment-ctx-menu');
    if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target)) hideCtxMenu();
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ctx]');
    if (!btn || !_ctx) return;
    const action = btn.dataset.ctx;
    const sid = _getActiveSessionId?.();

    if (action === 'reveal') {
      const p = _ctx.path;
      if (p) {
        window.__TAURI__.opener.revealItemInDir(p).catch(() => {
          window.__TAURI__.shell.Command.create('open', ['-R', p]).execute().catch(() => {});
        });
      }
    } else if (action === 'reattach' && sid) {
      const att = (store.get(sid) || []).find(a => a.id === _ctx.attachmentId);
      if (att) att.status = 'staged';
      renderAttachmentTokens();
      renderAttachmentPanel();
    } else if (action === 'remove' && sid) {
      const atts = store.get(sid);
      if (atts) {
        const idx = atts.findIndex(a => a.id === _ctx.attachmentId);
        if (idx !== -1) atts.splice(idx, 1);
      }
      renderAttachmentTokens();
      renderAttachmentPanel();
    }
    hideCtxMenu();
  });
}

// ── Clear button ─────────────────────────────────────────

function wireClearBtn() {
  document.getElementById('btn-clear-attachments')?.addEventListener('click', () => {
    const sid = _getActiveSessionId?.();
    if (!sid) return;
    // Only clear sent items; leave staged in place
    const atts = store.get(sid);
    if (atts) {
      const remaining = atts.filter(a => a.status === 'staged');
      store.set(sid, remaining);
    }
    renderAttachmentPanel();
  });
}
