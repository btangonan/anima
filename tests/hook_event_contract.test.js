// Contract test: each canonical hook event in hook_events_v1.jsonl must
// parse without throwing and produce at least one action (render, log,
// state update, or card refresh) when passed through the classifier.
//
// If this test fails, either:
//  (a) the fixture drifted from the real CLI stream (regenerate via
//      scripts/contract_drift_ci.sh), or
//  (b) the classifier dropped a branch (check src/hook-events.js).

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyHookEvent } from '../src/hook-events.js';

const FIXTURE_PATH = join(__dirname, 'fixtures', 'hook_events_v1.jsonl');

function loadFixture() {
  const raw = readFileSync(FIXTURE_PATH, 'utf-8');
  return raw.split('\n').filter(Boolean).map((line, i) => {
    try {
      return { line: i + 1, event: JSON.parse(line) };
    } catch (err) {
      throw new Error(`fixture line ${i + 1} is not valid JSON: ${err.message}`);
    }
  });
}

function planIsEmpty(plan) {
  return plan.renders.length === 0 &&
         plan.logs.length === 0 &&
         plan.stateUpdates === null &&
         plan.updateCard === false;
}

const NON_RENDERING_EVENTS = new Set([
  // PostToolUse in fixture line 7 has stdout but `decision=allow` is absent and
  // stdout has visible content — the generic hook_response path renders it.
  // UserPromptSubmit has no dedicated handler today (fixture line 14) and is
  // in the KNOWN set, so it produces no actions. This is a known non-render.
  'UserPromptSubmit',
]);

describe('hook_event_contract', () => {
  const entries = loadFixture();

  test('fixture is non-empty', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  test('every fixture line has subtype or hook_event', () => {
    for (const { line, event } of entries) {
      const hasRoute = Boolean(event.subtype || event.hook_event);
      expect(hasRoute, `line ${line} lacks subtype/hook_event`).toBe(true);
    }
  });

  test('classifier does not throw on any fixture line', () => {
    for (const { line, event } of entries) {
      expect(() => classifyHookEvent(event), `line ${line}`).not.toThrow();
    }
  });

  test('every rendering hook event produces at least one action', () => {
    for (const { line, event } of entries) {
      const hookEvent = event.hook_event;
      if (NON_RENDERING_EVENTS.has(hookEvent)) continue;
      const plan = classifyHookEvent(event);
      const empty = planIsEmpty(plan);
      expect(empty, `line ${line} (hook_event=${hookEvent}) produced no action — classifier may have dropped a branch`).toBe(false);
    }
  });

  test('PreCompact schedules a card refresh', () => {
    const plan = classifyHookEvent({ subtype: 'hook_started', hook_event: 'PreCompact' });
    expect(plan.updateCard).toBe(true);
  });

  test('PostCompact resets compaction state', () => {
    const plan = classifyHookEvent({ subtype: 'hook_response', hook_event: 'PostCompact' });
    expect(plan.stateUpdates).toMatchObject({
      _compactionWarned: false,
      _compactionDetected: false,
      _contextBaseline: null,
    });
  });

  test('Notification with unknown subtype logs UNKNOWN-HOOK', () => {
    const plan = classifyHookEvent({
      hook_event: 'Notification',
      notification_type: 'future_kind',
      message: 'fresh subtype',
    });
    expect(plan.logs.some(l => l.tag === 'UNKNOWN-HOOK')).toBe(true);
  });

  test('internal tools skip PreToolUse render', () => {
    const plan = classifyHookEvent(
      { subtype: 'hook_started', hook_event: 'PreToolUse', tool_name: 'TodoWrite', tool_input: { todos: [] } },
      { isInternalTool: (n) => n === 'TodoWrite' },
    );
    expect(plan.renders.length).toBe(0);
  });

  test('unknown hook_event logs UNKNOWN-HOOK', () => {
    const plan = classifyHookEvent({ subtype: 'hook_started', hook_event: 'FutureEvent' });
    expect(plan.logs.some(l => l.tag === 'UNKNOWN-HOOK')).toBe(true);
  });

  test('malformed input returns empty plan, not throw', () => {
    expect(() => classifyHookEvent(null)).not.toThrow();
    expect(() => classifyHookEvent(undefined)).not.toThrow();
    expect(() => classifyHookEvent('not-an-object')).not.toThrow();
  });
});
