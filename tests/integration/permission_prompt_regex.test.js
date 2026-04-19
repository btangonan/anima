import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, '../fixtures/permission_prompts_v1.txt');

// P2.G2 — JS engine fixture runner.
// Guards that every captured CLI prompt in permission_prompts_v1.txt matches at
// least one of the four positive-match alternates that the PTY harness uses.
// The Tcl runner (permission_prompt_regex.exp + _tcl.test.js) proves the same
// regex set matches under Tcl word-boundary semantics. Both runners must pass
// before the PTY harness is graded.
const ALTERNATES = [
  /Allow [^\n]*\b(Bash|Read|Write|Edit|mcp__[A-Za-z0-9_]+__[A-Za-z0-9_]+)\b[^\n]*\?\s*\(y\/n\)/,
  /allow .{0,40}\b(bash|read|write|edit|mcp__[a-z0-9_]+__[a-z0-9_]+)\b[^\n]{0,80}\(y\/n\)/i,
  /approve.{0,40}\b(bash|read|write|edit|mcp__[a-z0-9_]+__[a-z0-9_]+)\b[^\n]{0,80}\(y\/n\)/i,
  /allow .{0,40}permission[- ]mode[^\n]{0,80}\(y\/n\)/i,
];

function fixtureLines() {
  return readFileSync(FIXTURE, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

test('every fixture prompt matches at least one JS alternate', () => {
  const lines = fixtureLines();
  expect(lines.length).toBeGreaterThan(0);
  const unmatched = [];
  for (const line of lines) {
    const hit = ALTERNATES.some((re) => re.test(line));
    if (!hit) unmatched.push(line);
  }
  expect(unmatched, `unmatched fixture lines:\n${unmatched.join('\n')}`).toEqual([]);
});

test('fixture covers Bash, Read, Write, Edit, MCP, permission-mode tokens', () => {
  const lines = fixtureLines().join('\n');
  expect(lines).toMatch(/\bBash\b/);
  expect(lines).toMatch(/\bRead\b/);
  expect(lines).toMatch(/\bWrite\b/);
  expect(lines).toMatch(/\bEdit\b/);
  expect(lines).toMatch(/mcp__[A-Za-z0-9_]+__[A-Za-z0-9_]+/);
  expect(lines).toMatch(/permission[- ]mode/i);
});
