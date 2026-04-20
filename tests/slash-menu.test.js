import { beforeEach, test, expect } from 'vitest';

// slash-menu.js touches window.__TAURI__.core at module load — stub before importing.
beforeEach(() => {
  global.window.__TAURI__ = { core: { invoke: async () => [] } };
});

async function getSlashMenu() {
  return import('../src/slash-menu.js?t=' + Date.now());
}

// Regression guard for the BUILTIN_SLASH_COMMANDS sync checklist (T2.3).
// If any of these stable built-ins disappear from the array, the manual
// quarterly sync has gone wrong — fail loudly here rather than silently
// dropping autocomplete entries users rely on.
test('BUILTIN_SLASH_COMMANDS contains stable built-in subset', async () => {
  const { getSlashCommands, isBuiltinCommand } = await getSlashMenu();
  const STABLE_BUILTINS = ['help', 'clear', 'compact', 'model', 'cost', 'config', 'login'];
  for (const name of STABLE_BUILTINS) {
    expect(isBuiltinCommand(name), `built-in "${name}" missing`).toBe(true);
  }
  // Sanity: getSlashCommands returns these even before any disk load.
  const all = getSlashCommands();
  for (const name of STABLE_BUILTINS) {
    expect(all.some((c) => c.name === name), `getSlashCommands missing "${name}"`).toBe(true);
  }
});
