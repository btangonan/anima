// ── Pure hook-event classifier ──────────────────────────────────────────
//
// Takes a single stream-json frame and returns an action plan describing
// what the dispatcher in events.js should render / log / mutate.
//
// Extracted from events.js so the decision tree is testable without
// mocking DOM, Tauri, or session state (see tests/hook_event_contract.test.js).
//
// Contract: the classifier is pure — no side effects, no global reads. The
// dispatcher applies the returned actions. Callers pass an options bag with
// `isInternalTool(name) → bool` so the classifier stays independent of the
// INTERNAL_TOOLS set's exact membership.

const KNOWN_HOOK_EVENTS = new Set([
  'PreCompact', 'PostCompact', 'SessionStart', 'Notification',
  'PostToolUseFailure', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit',
  'Stop', 'SubagentStart', 'SubagentStop',
]);

function emptyPlan() {
  return { renders: [], logs: [], stateUpdates: null, updateCard: false };
}

export function classifyHookEvent(event, opts = {}) {
  const isInternalTool = opts.isInternalTool || (() => false);
  const plan = emptyPlan();
  if (!event || typeof event !== 'object') return plan;

  const { subtype, hook_event: hookEvent } = event;

  if (subtype === 'hook_started' && hookEvent === 'PreCompact') {
    plan.logs.push({ tag: 'COMPACT', text: 'PreCompact \u2014 context compressing' });
    plan.renders.push({ type: 'system-msg', text: 'Context compacting\u2026' });
    plan.updateCard = true;
  }

  if (subtype === 'hook_response' && hookEvent === 'PostCompact') {
    plan.logs.push({ tag: 'COMPACT', text: 'PostCompact \u2014 recovery injected by hook' });
    plan.renders.push({ type: 'system-msg', text: 'Context recovered. Resuming.' });
    plan.stateUpdates = {
      _compactionWarned: false,
      _compactionDetected: false,
      _contextBaseline: null,
    };
    plan.updateCard = true;
  }

  if (subtype === 'hook_started' && hookEvent === 'SessionStart') {
    const ctx = event.additional_context || event.additionalContext;
    if (ctx && String(ctx).trim()) {
      plan.renders.push({ type: 'hook-event', hookName: 'SessionStart', eventType: 'context', payload: String(ctx) });
    }
  }

  if (subtype === 'hook_started' && hookEvent === 'SubagentStart') {
    const agentName = event.subagent_type || event.agentType || event.subagent_name || 'subagent';
    const desc = event.description || event.prompt_preview || '';
    const body = desc ? `${agentName}\n\n${String(desc).slice(0, 400)}` : agentName;
    plan.renders.push({ type: 'hook-event', hookName: 'SubagentStart', eventType: agentName, payload: body });
    plan.logs.push({ tag: 'SUBAGENT', text: `start:${agentName}` });
  }

  if (subtype === 'hook_response' && hookEvent === 'SubagentStop') {
    const agentName = event.subagent_type || event.agentType || event.subagent_name || 'subagent';
    const tokens = event.tokens_used || event.tokensUsed || null;
    const dur = event.duration_ms || event.durationMs || null;
    const parts = [agentName];
    if (tokens) parts.push(`${tokens} tok`);
    if (dur) parts.push(`${(dur/1000).toFixed(1)}s`);
    plan.renders.push({ type: 'hook-event', hookName: 'SubagentStop', eventType: agentName, payload: parts.join(' \u00b7 ') });
    plan.logs.push({ tag: 'SUBAGENT', text: `stop:${agentName}` });
  }

  if (subtype === 'hook_started' && hookEvent === 'PreToolUse') {
    const toolName = event.tool_name || event.toolName;
    if (toolName && !isInternalTool(toolName)) {
      let inputPreview = '';
      try {
        const inp = event.tool_input || event.toolInput;
        if (inp) inputPreview = typeof inp === 'string' ? inp : JSON.stringify(inp).slice(0, 240);
      } catch (_) { inputPreview = ''; }
      if (inputPreview) {
        plan.renders.push({ type: 'hook-event', hookName: 'PreToolUse', eventType: toolName, payload: inputPreview });
      }
    }
  }

  if (subtype === 'hook_response' && hookEvent === 'Stop') {
    const reason = event.stop_reason || event.stopReason || '';
    if (reason) {
      plan.renders.push({ type: 'system-msg', text: `\u25a0 stop \u00b7 ${String(reason).slice(0, 120)}` });
    }
    plan.logs.push({ tag: 'STOP', text: reason || '(no reason)' });
  }

  if (hookEvent === 'Notification') {
    const ntype = event.notification_type || event.notificationType
                || event.subtype_detail || (event.payload && event.payload.type) || null;
    const rawText = event.message || event.text || (event.payload && JSON.stringify(event.payload));
    if (rawText) {
      let glyph = '\u25cb';
      if (ntype === 'permission_prompt') glyph = '\u26a0';
      else if (ntype === 'idle_prompt') glyph = '\u23f1';
      else if (ntype === 'auth_success') glyph = '\u2713';
      else if (ntype === 'elicitation_dialog') glyph = '\u2699';
      else if (ntype) {
        plan.logs.push({ tag: 'UNKNOWN-HOOK', text: `Notification subtype:${ntype}` });
      }
      plan.renders.push({ type: 'system-msg', text: `${glyph} ${String(rawText).slice(0, 240)}` });
    }
  }

  if (subtype === 'hook_response' && hookEvent === 'PostToolUseFailure') {
    const hookName = event.hook_name || event.hookName || 'unknown';
    const errText = event.stderr || event.error || JSON.stringify(event.payload || {});
    plan.renders.push({ type: 'hook-event', hookName, eventType: 'PostToolUseFailure', payload: String(errText) });
  }

  if (subtype === 'hook_response' &&
      hookEvent !== 'PostCompact' &&
      hookEvent !== 'PostToolUseFailure' &&
      hookEvent !== 'SubagentStop' &&
      hookEvent !== 'Stop' &&
      hookEvent !== 'SessionStart') {
    const decision = event.permission_decision || event.permissionDecision;
    const stderr = event.stderr;
    const stdout = event.stdout;
    const hasVisible = (decision && decision !== 'allow') ||
                       (stderr && String(stderr).trim()) ||
                       (stdout && String(stdout).trim());
    if (hasVisible) {
      const hookName = event.hook_name || event.hookName || 'hook';
      const payload = JSON.stringify({ decision, stderr, stdout }, (k, v) => v == null ? undefined : v, 2);
      plan.renders.push({ type: 'hook-event', hookName, eventType: hookEvent || 'response', payload });
    }
  }

  if ((subtype === 'hook_started' || subtype === 'hook_response') &&
      hookEvent &&
      !KNOWN_HOOK_EVENTS.has(hookEvent)) {
    plan.logs.push({ tag: 'UNKNOWN-HOOK', text: `hook_event:${hookEvent} keys:${Object.keys(event).join(',')}` });
  }

  return plan;
}

export const __testing = { KNOWN_HOOK_EVENTS };
