import { test, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, 'permission_prompt_regex.exp');

// P2.G2 v11 preflight hardening — check for `expect` BEFORE any spawn.
// If expect is missing, the interpreter can't start, so the in-script
// `which expect` check inside the .exp file is unreachable. Skip from
// Node directly so the skip path works on hosts without expect.
function hasExpect() {
  if (existsSync('/usr/bin/expect')) return true;
  if (existsSync('/opt/homebrew/bin/expect')) return true;
  try {
    execSync('which expect', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const EXPECT_AVAILABLE = hasExpect();

test.skipIf(!EXPECT_AVAILABLE)(
  'Tcl regex runner: every fixture line matches ≥1 Tcl alternate (v10 engine parity)',
  () => {
    const result = spawnSync('expect', [SCRIPT], { encoding: 'utf8', timeout: 15000 });
    if (result.error) throw result.error;
    // exit 77 = defensive in-script skip (should be unreachable post-preflight).
    if (result.status === 77) {
      console.warn(
        `Tcl runner reported exit 77 post-preflight — ${SCRIPT} in-script check fired ` +
        'despite Node preflight passing. Investigate.'
      );
      return; // treat as skip, not fail
    }
    // exit 0 = all match; anything else = failure (with diagnostic on stdout).
    expect(
      result.status,
      `Tcl runner exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    ).toBe(0);
    expect(result.stdout).toMatch(/^PASS:/m);
  },
);

test.skipIf(EXPECT_AVAILABLE)(
  'Tcl regex runner skipped (expect binary not installed on this host)',
  () => {
    // No-op body — presence of this test documents why the Tcl runner was skipped.
    expect(EXPECT_AVAILABLE).toBe(false);
  },
);
