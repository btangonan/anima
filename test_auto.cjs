'use strict';
const fs = require('fs');
const ROOT = '/Users/bradleytangonan/Projects/pixel-terminal';

let pass = 0, fail = 0;
function check(label, cond) {
  const ok = !!cond;
  console.log((ok ? '✓' : '✗') + ' ' + label);
  ok ? pass++ : fail++;
}

// ── Pre-flight ─────────────────────────────────────────────
check('/bin/test executable', fs.existsSync('/bin/test'));
check('.pixel-terminal sentinel exists', fs.existsSync(ROOT + '/.pixel-terminal'));
check('sentinel file non-empty', fs.readFileSync(ROOT + '/.pixel-terminal', 'utf8').trim().length > 0);

const capsRaw = fs.readFileSync(ROOT + '/src-tauri/capabilities/default.json', 'utf8');
const caps = JSON.parse(capsRaw);
check('capabilities JSON valid', !!caps);

const spawnEntry = caps.permissions.find(p => p.identifier === 'shell:allow-spawn');
const execEntry  = caps.permissions.find(p => p.identifier === 'shell:allow-execute');
check('shell:allow-spawn has claude → /opt/homebrew/bin/claude', spawnEntry?.allow?.some(a => a.name === 'claude' && a.cmd === '/opt/homebrew/bin/claude'));
check('shell:allow-execute has test → /bin/test', execEntry?.allow?.some(a => a.name === 'test' && a.cmd === '/bin/test'));

// ── Dead code gone ─────────────────────────────────────────
check('src/main.js deleted', !fs.existsSync(ROOT + '/src/main.js'));
check('src/sprites/ deleted', !fs.existsSync(ROOT + '/src/sprites'));
check('src/sprites_old/ deleted', !fs.existsSync(ROOT + '/src/sprites_old'));

// ── app.js structural checks ──────────────────────────────
const src = fs.readFileSync(ROOT + '/src/app.js', 'utf8');
check('scheduleScroll() defined', src.includes('function scheduleScroll('));
check('_scrollPending flag', src.includes('_scrollPending'));
check('DocumentFragment in renderMessageLog', src.includes('createDocumentFragment'));
check('.msg-new added in pushMessage', src.includes("el.classList.add('msg-new')"));
check('isSelfDirectory() defined', src.includes('async function isSelfDirectory'));
check('--disallowed-tools includes Bash', src.includes('Edit,Write,MultiEdit,NotebookEdit,Bash'));
check('readOnly on session object', src.includes('readOnly: !!opts.readOnly'));
check('(read-only) system message', src.includes("opts.readOnly ? ' (read-only)' : ''"));
check('showConfirm okLabel param', src.includes("function showConfirm(message, okLabel = 'terminate')"));
check('confirm-ok textContent dynamic', src.includes("document.getElementById('confirm-ok').textContent = okLabel"));
check('path-walk root fallback', src.includes("|| '/'"));
check('console.warn in isSelfDirectory', src.includes('console.warn('));
check('no direct scrollTop assignments outside scheduleScroll', (() => {
  // Remove the scheduleScroll function body, then check no remaining log.scrollTop
  const withoutFn = src.replace(/function scheduleScroll\(\)[^}]+\}/, '');
  return !withoutFn.includes('log.scrollTop = log.scrollHeight');
})());

// ── styles.css checks ─────────────────────────────────────
const css = fs.readFileSync(ROOT + '/src/styles.css', 'utf8');
check('.msg base class has no animation property', (() => {
  const msgBlock = css.match(/\.msg\s*\{([^}]*)\}/);
  return msgBlock ? !msgBlock[1].includes('animation') : false;
})());
check('.msg-new class exists with fadeIn', css.includes('.msg-new') && css.includes('fadeIn'));
check('@keyframes fadeIn defined', css.includes('@keyframes fadeIn'));

// ── Omi toggle checks ─────────────────────────────────────
const html = fs.readFileSync(ROOT + '/src/index.html', 'utf8');
const appjs = fs.readFileSync(ROOT + '/src/app.js', 'utf8');
check('omi-indicator is a <button>', html.includes('<button id="omi-indicator"'));
check('omi-indicator has aria-label', html.includes('aria-label="Toggle Omi listening"'));
check('omi-indicator.connected.muted style exists', css.includes('#omi-indicator.connected.muted'));
check('amber muted color (#f5a623)', css.includes('#f5a623'));
check('omiListening localStorage key', appjs.includes("localStorage.getItem('omiListening')"));
check('toggleOmiListening function defined', appjs.includes('function toggleOmiListening('));
check('Ctrl+Shift+O keyboard shortcut', appjs.includes("e.key === 'O'") && appjs.includes('e.ctrlKey && e.shiftKey'));
check('JS-side omi:command guard (if !omiListening)', appjs.includes('if (!omiListening) return'));
check('omiConnected state variable', appjs.includes('let omiConnected = false'));
check('set_omi_listening invoked', appjs.includes("invoke('set_omi_listening'"));
check('mute state re-sent on omi:connected', (() => {
  const idx = appjs.indexOf("tauriListen('omi:connected'");
  return idx !== -1 && appjs.slice(idx, idx + 300).includes('set_omi_listening');
})());

// ── Logic unit tests ──────────────────────────────────────
console.log('');
console.log('── Path-walk logic ──');
const pathParent = dir => dir.replace(/\/[^/]+$/, '') || '/';
const pathTests = [
  ['/Users/brad/Projects/pixel-terminal/src', '/Users/brad/Projects/pixel-terminal'],
  ['/Users/brad/Projects/pixel-terminal',     '/Users/brad/Projects'],
  ['/pixel-terminal',                          '/'],
  ['/',                                        '/'],
  ['/a',                                       '/'],
];
for (const [dir, expected] of pathTests) {
  const result = pathParent(dir);
  check('parent("' + dir + '") → "' + result + '"', result === expected);
}

console.log('');
console.log('── esc() XSS safety ──');
const esc = str => String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const escTests = [
  ['<script>alert(1)</script>', '&lt;script&gt;alert(1)&lt;/script&gt;'],
  ['a & b',                     'a &amp; b'],
  ['say "hi"',                  'say &quot;hi&quot;'],
  [null,                        ''],
  [undefined,                   ''],
];
for (const [input, expected] of escTests) {
  check('esc("' + input + '")', esc(input) === expected);
}

console.log('');
console.log('── toolHint extraction ──');
const toolHint = (name, inputStr) => {
  try {
    const obj = JSON.parse(inputStr);
    if (obj.file_path) return obj.file_path.replace(/.*\//, '');
    if (obj.path)      return obj.path.replace(/.*\//, '');
    if (obj.pattern)   return obj.pattern;
    if (obj.command)   return String(obj.command).slice(0, 60);
    if (obj.query_texts) return obj.query_texts[0]?.slice(0, 50);
    if (obj.url)       return obj.url.replace(/^https?:\/\//, '').slice(0, 50);
    const first = Object.values(obj).find(v => typeof v === 'string');
    return first ? first.slice(0, 50) : '';
  } catch (_) { return String(inputStr || '').slice(0, 50); }
};
const hintTests = [
  ['Read',  '{"file_path":"/src/app.js"}',          'app.js'],
  ['Read',  '{"path":"/src/styles.css"}',            'styles.css'],
  ['Bash',  '{"command":"git status"}',              'git status'],
  ['Grep',  '{"pattern":"*.js"}',                    '*.js'],
  ['Fetch', '{"url":"https://example.com/path"}',    'example.com/path'],
  ['X',     'not-json',                              'not-json'],
  ['X',     '{}',                                    ''],
];
for (const [name, input, expected] of hintTests) {
  const result = toolHint(name, input);
  check('toolHint(' + name + ',"' + input.slice(0,20) + '...") → "' + result + '"', result === expected);
}

// ── Summary ───────────────────────────────────────────────
console.log('');
console.log('══════════════════════════════════════');
console.log('Total: ' + (pass + fail) + ' checks — ' + pass + ' passed, ' + fail + ' failed');
if (fail === 0) {
  console.log('✓ All automated checks pass');
  console.log('');
  console.log('Remaining manual steps (need running app):');
  console.log('  Step 2 — Core session: create session, send message, tool calls');
  console.log('  Step 3 — Self-edit protection: warning dialog, read-only mode, Bash block');
  console.log('  Step 4 — Performance: 10+ tool calls, session switch, scroll-up behavior');
  console.log('  Step 5 — Session management: kill, escape, window close');
  console.log('  Step 6 — Sidebar resize');
  console.log('');
  console.log('Run: npm run tauri dev — then follow TEST_CHECKLIST.md Steps 2-6');
} else {
  console.log('✗ Fix failures before proceeding to manual tests');
}
process.exit(fail > 0 ? 1 : 0);
