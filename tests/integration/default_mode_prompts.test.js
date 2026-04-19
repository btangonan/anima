import { test, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, 'default_mode_prompts.exp');

// P2.G — PTY harness vitest wrapper (v11 preflight hardened).
// Node-side preflight checks for `expect` AND `claude` BEFORE spawning. If
// either binary is missing, skip from Node directly (vitest marks the test
// as skipped rather than failed). The in-script checks inside .exp are
// defensive only; they cannot fire if the `expect` interpreter itself is
// missing (can't start the script to run them).
//
// Environment caveat: claude's PreToolUse hooks fire BEFORE the CLI's own
// permission prompt. If $HOME/.claude/settings.json declares a PreToolUse
// hook matching Bash, the harness will see claude exit without prompting.
// The .exp script detects this and exits 77 (skip). For a release-gate
// smoke, run in an isolated $HOME.

function hasBinary(name) {
  if (existsSync(`/usr/bin/${name}`)) return true;
  if (existsSync(`/opt/homebrew/bin/${name}`)) return true;
  try {
    execSync(`which ${name}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function hasHostBashHooks() {
  const settingsPath = `${process.env.HOME || ''}/.claude/settings.json`;
  if (!existsSync(settingsPath)) return false;
  try {
    const raw = execSync(`cat ${JSON.stringify(settingsPath)}`, { encoding: 'utf8' });
    return /"PreToolUse"/.test(raw) && /Bash/.test(raw);
  } catch {
    return false;
  }
}

const HAS_EXPECT = hasBinary('expect');
const HAS_CLAUDE = hasBinary('claude');
const HAS_HOST_HOOKS = hasHostBashHooks();
// Opt-in: spawning claude costs API credits + ~30s per run. Unit test runs
// (`npm test`) should skip by default. Set ANIMA_RUN_PTY_TESTS=1 locally
// before running this specific file (e.g. P2.G grading, release gate).
const OPTED_IN = process.env.ANIMA_RUN_PTY_TESTS === '1';
const RUNNABLE = OPTED_IN && HAS_EXPECT && HAS_CLAUDE && !HAS_HOST_HOOKS;

// P2.G acceptance #6 depends on the P2.G2 fixture runners passing first (JS
// engine AND Tcl engine). The vitest runner will naturally schedule them
// alongside this file; we document the dependency in the test name rather
// than enforce it in code because reading the fixture runner status from
// inside vitest would require a cross-test channel vitest doesn't expose.

test.skipIf(!RUNNABLE)(
  'default-mode PTY harness: claude prompts for tool use and accepts "n" deny',
  () => {
    // 60s outer timeout — PTY script has 30s expect timeout, give claude
    // cold-start headroom on top (first-run auth check, model load, etc.).
    const result = spawnSync('expect', [SCRIPT], { encoding: 'utf8', timeout: 60000 });
    if (result.error) throw result.error;
    if (result.status === 77) {
      console.warn(
        `PTY harness reported exit 77 post-preflight — ${SCRIPT} in-script check fired ` +
        'despite Node preflight passing. Investigate.'
      );
      return; // treat as skip
    }
    expect(
      result.status,
      `PTY harness exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    ).toBe(0);
    expect(result.stdout).toMatch(/^PASS:/m);
  },
  90000, // 90s test-level timeout — gives spawnSync room on top of its 60s
);

test.skipIf(RUNNABLE)(
  'default-mode PTY harness skipped (set ANIMA_RUN_PTY_TESTS=1 to enable; requires expect + claude; host PreToolUse hooks block it)',
  () => {
    expect(RUNNABLE).toBe(false);
    if (!OPTED_IN) console.warn('ANIMA_RUN_PTY_TESTS not set — PTY harness opt-in required (costs API credits).');
    if (!HAS_EXPECT) console.warn('expect binary missing — install via `brew install expect`');
    if (!HAS_CLAUDE) console.warn('claude CLI missing — install via `npm i -g @anthropic-ai/claude-code`');
    if (HAS_HOST_HOOKS) console.warn(
      'host $HOME/.claude/settings.json declares PreToolUse hooks matching Bash — they will intercept ' +
      'before the CLI prompt fires. Run from an isolated $HOME to exercise this harness (release-gate only).'
    );
  },
);
