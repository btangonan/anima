// ── Slash command / flag autocomplete menu ──────────────────

import { $, esc, autoResize } from './dom.js';

const { invoke } = window.__TAURI__.core;

let _slashCommands = [];    // loaded from ~/.claude/skills/ + commands/
let _skillFlags    = [];    // --flags extracted from skills' argument-hint fields
let _lastLoad      = 0;     // TTL timestamp for auto-reload

// ── BUILTIN_SLASH_COMMANDS sync checklist ────────────────────────────────
// Source of truth: `claude --help` (no programmatic slash-command registry exists).
// Sync cadence: quarterly, or when a new Anthropic CLI release is announced.
// Last manually synced: 2026-04-18.
// To re-sync: run `claude --help`, diff slash commands, add/remove entries below.
// Per-skill flags are auto-extracted from skill SKILL.md `argument-hint:` fields
// at runtime (see _doLoad below) — only top-level CLI commands need manual sync.
const BUILTIN_SLASH_COMMANDS = [
  // Anima-handled (local)
  { name: 'clear', description: 'Clear conversation and restart session' },
  { name: 'cost', description: 'Show token usage for this session' },
  { name: 'compact', description: 'Summarize conversation to save context' },
  { name: 'help', description: 'List all available commands' },
  { name: 'model', description: 'Switch Claude model (restarts session)' },
  { name: 'effort', description: 'Set reasoning effort level' },
  { name: 'fallback', description: 'Set fallback model for overload (e.g., sonnet)' },
  { name: 'perf', description: 'Show performance stats (TTFT, tok/s, rate limits)' },
  // Claude Code native (passed through to CLI)
  { name: 'init', description: 'Initialize CLAUDE.md in the project' },
  { name: 'add-dir', description: 'Add a directory to the session context' },
  { name: 'mcp', description: 'Manage MCP servers' },
  { name: 'permissions', description: 'View or change permission settings' },
  { name: 'doctor', description: 'Diagnose Claude Code configuration issues' },
  { name: 'status', description: 'Show session status and context' },
  { name: 'review', description: 'Review recent code changes' },
  { name: 'bug', description: 'Report a bug or issue' },
  { name: 'terminal-setup', description: 'Configure terminal integration' },
  { name: 'vim', description: 'Toggle vim keybindings' },
  { name: 'config', description: 'View or update configuration' },
  { name: 'login', description: 'Log in to your Anthropic account' },
  { name: 'logout', description: 'Log out of your Anthropic account' },
  { name: 'fast', description: 'Toggle fast mode (same model, faster output)' },
  { name: 'resume', description: 'Resume a previous session' },
  { name: 'agents', description: 'Manage custom agents' },
  { name: 'output-style', description: 'Configure output style' },
];
let _slashActiveIdx = -1;   // keyboard-highlighted row
let _activeToken   = null;  // token that opened the menu

const FLAG_ITEMS = [
  { name: 'seq',        description: 'sequential-thinking MCP \u2014 structured multi-step reasoning' },
  { name: 'think',      description: 'pause and reason carefully before responding' },
  { name: 'think-hard', description: '--think + --seq combined' },
  { name: 'ultrathink', description: '--think-hard + explicit plan before acting' },
  { name: 'uc',         description: 'ultra-compressed output' },
  { name: 'no-mcp',     description: 'disable all MCP servers' },
  { name: 'grade',      description: 'grade current plan (use with /sm:introspect)' },
  { name: 'quick',      description: 'fast bootstrap \u2014 skip memory queries' },
  { name: 'cold',       description: 'fresh start, skip project memory' },
  { name: 'retro',      description: 'end-of-session retro (use with /checkpoint)' },
  { name: 'dry-run',    description: 'show what would happen without writing' },
  { name: 'state-only', description: 'write STATE.md only (use with /checkpoint)' },
  { name: 'brief',      description: 'meeting/pitch brief mode (use with /research)' },
];

async function _doLoad() {
  try {
    _slashCommands = await invoke('read_slash_commands');
    // Collect unique --flags declared by skills via frontmatter `flags:`,
    // excluding flags already present in the hardcoded FLAG_ITEMS list.
    const existingFlagNames = new Set(FLAG_ITEMS.map(f => f.name));
    const seen = new Set(existingFlagNames);
    _skillFlags = [];
    for (const cmd of _slashCommands) {
      for (const flag of (cmd.flags || [])) {
        const bare = flag;
        if (!seen.has(bare)) {
          seen.add(bare);
          _skillFlags.push({ name: bare, description: `--${bare} flag (/${cmd.name})` });
        }
      }
    }
  } catch (_) {
    _slashCommands = [];
    _skillFlags = [];
  }
}

export async function loadSlashCommands() {
  // TTL: re-scan at most once per second so hot internal callers are safe.
  if (Date.now() - _lastLoad < 1000) return;
  _lastLoad = Date.now();
  await _doLoad();
}

// Force-refresh bypasses the 1s TTL — used by the user-visible menu-open path
// so mid-session skill adds appear without restart or menu toggle.
export async function loadSlashCommandsForce() {
  _lastLoad = Date.now();
  await _doLoad();
}

export function getSlashCommands() { return [...BUILTIN_SLASH_COMMANDS, ..._slashCommands]; }
export function isBuiltinCommand(name) { return BUILTIN_SLASH_COMMANDS.some(c => c.name === name); }

// Async stale-render guard: every showSlashMenu() call increments _menuVersion.
// After awaiting the force-refresh, we abort if a newer call has superseded us.
let _menuVersion = 0;

export function showSlashMenu(token) {
  // On the open edge, force-refresh skills/commands so mid-session adds appear
  // immediately. Render synchronously with whatever's cached, then re-render
  // once the refresh completes — only if no newer call has superseded us.
  const isOpening = $.slashMenu.classList.contains('hidden');
  const myVersion = ++_menuVersion;
  if (isOpening) {
    loadSlashCommandsForce().then(() => {
      // Stale-render guard: only re-render if we're still the latest call.
      if (myVersion !== _menuVersion) return;
      // Re-render with fresh data, but only if menu is still visible for this token.
      if (!$.slashMenu.classList.contains('hidden') && _activeToken === token) {
        _renderMenu(token);
      }
    }).catch(() => {});
  }

  _renderMenu(token);
}

function _renderMenu(token) {
  _activeToken = token;
  const menu = $.slashMenu;
  const q = token.query.toLowerCase();

  let matches, prefix;
  if (token.type === 'flag') {
    const allFlags = [...FLAG_ITEMS, ..._skillFlags];
    matches = allFlags.filter(f =>
      f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q)
    );
    prefix = '--';
  } else {
    const allCommands = [...BUILTIN_SLASH_COMMANDS, ..._slashCommands];
    matches = allCommands.filter(c =>
      c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
    );
    prefix = '/';
  }

  if (!matches.length) { hideSlashMenu(); return; }

  // Position flush against the top of the input bar, right of the sidebar
  const inputBar = $.inputBar;
  const sidebar  = $.sidebar;
  const rect = inputBar.getBoundingClientRect();
  menu.style.bottom = (window.innerHeight - rect.top) + 'px';
  menu.style.left   = (sidebar.offsetWidth + 1) + 'px'; // +1 for resize handle

  _slashActiveIdx = -1;
  menu.innerHTML = matches.map((c, i) =>
    `<div class="slash-item" data-idx="${i}" data-name="${esc(c.name)}">` +
    `<span class="slash-item-name">${prefix}${esc(c.name)}</span>` +
    `<span class="slash-item-desc">${esc(c.description)}</span>` +
    `</div>`
  ).join('');

  menu.querySelectorAll('.slash-item').forEach(el => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault(); // don't blur input
      acceptSlashItem(el.dataset.name);
    });
  });

  menu.classList.remove('hidden');
}

export function hideSlashMenu() {
  $.slashMenu.classList.add('hidden');
  _slashActiveIdx = -1;
}

export function moveSlashSelection(delta) {
  const menu = $.slashMenu;
  const items = menu.querySelectorAll('.slash-item');
  if (!items.length) return;
  items[_slashActiveIdx]?.classList.remove('active');
  _slashActiveIdx = Math.max(0, Math.min(items.length - 1, _slashActiveIdx + delta));
  const active = items[_slashActiveIdx];
  active.classList.add('active');
  active.scrollIntoView({ block: 'nearest' });
}

// Returns { start, end, query, type:'slash' } for a /word at cursor, or null.
// Only matches if / is at start of input or preceded by a space (not mid-URL).
export function getSlashToken(input) {
  const val = input.value;
  const pos = input.selectionStart;
  let slashPos = -1;
  for (let i = pos - 1; i >= 0; i--) {
    if (val[i] === '/') {
      if (i === 0 || val[i - 1] === ' ') { slashPos = i; break; }
    } else if (val[i] === ' ') {
      break;
    }
  }
  if (slashPos === -1) return null;
  const query = val.slice(slashPos + 1, pos);
  if (query.includes(' ')) return null;
  return { start: slashPos, end: pos, query, type: 'slash' };
}

// Returns { start, end, query, type:'flag' } for a --word at cursor, or null.
// Only matches if -- is at start of input or preceded by a space.
export function getFlagToken(input) {
  const val = input.value;
  const pos = input.selectionStart;
  if (pos < 2) return null;
  let dashPos = -1;
  for (let i = pos - 1; i >= 1; i--) {
    if (val[i] === '-' && val[i - 1] === '-') {
      if (i - 1 === 0 || val[i - 2] === ' ') { dashPos = i - 1; break; }
    } else if (val[i] === ' ') {
      break;
    }
  }
  if (dashPos === -1) return null;
  const query = val.slice(dashPos + 2, pos);
  if (query.includes(' ') || query.startsWith('-')) return null;
  return { start: dashPos, end: pos, query, type: 'flag' };
}

export function acceptSlashItem(name) {
  const input = $.inputField;
  const token = _activeToken;
  const prefix = token?.type === 'flag' ? '--' : '/';
  if (token) {
    const val = input.value;
    const newVal = val.slice(0, token.start) + prefix + name + ' ' + val.slice(token.end);
    input.value = newVal;
    const newPos = token.start + prefix.length + name.length + 1;
    input.setSelectionRange(newPos, newPos);
  } else {
    input.value = prefix + name + ' ';
  }
  input.focus();
  hideSlashMenu();
  autoResize(input);
}

export function acceptActiveSlashItem() {
  const menu = $.slashMenu;
  const items = menu.querySelectorAll('.slash-item');
  const idx = _slashActiveIdx >= 0 ? _slashActiveIdx : 0;
  if (items[idx]) acceptSlashItem(items[idx].dataset.name);
}

export function getSlashActiveIdx() { return _slashActiveIdx; }
