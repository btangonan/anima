#!/usr/bin/env python3
"""
test_gate_idempotency.py — Programmatic smoke test for pixel_gate.py

Tests:
  1. _stable_req_id is deterministic (same call → same ID)
  2. _stable_req_id is tool-semantic (only semantic fields matter; volatile fields ignored)
  3. _stable_req_id differs across different calls
  4. Rate-limit retry fast-path: second gate invocation with pre-written response exits immediately
  5. Duplicate pending request: second invocation skips write, goes straight to poll path
  6. needs_ask coverage: gated and ungated Bash commands
"""

import hashlib
import importlib.util
import json
import os
import sys
import tempfile
import time
import subprocess

# ── Load pixel_gate as a module (without executing main) ──────────────────────
GATE_PATH = os.path.expanduser("~/.claude/hooks/pixel_gate.py")

spec = importlib.util.spec_from_file_location("pixel_gate", GATE_PATH)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

# ── Helpers ───────────────────────────────────────────────────────────────────
PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"
results = []

def check(name, condition, detail=""):
    tag = PASS if condition else FAIL
    print(f"  [{tag}] {name}" + (f"  — {detail}" if detail else ""))
    results.append((name, condition))

# ── Test 1: Determinism ───────────────────────────────────────────────────────
print("\n=== 1. _stable_req_id determinism ===")

inp_bash = {"command": "ls /tmp"}
id1 = gate._stable_req_id("session-abc", "Bash", inp_bash)
id2 = gate._stable_req_id("session-abc", "Bash", inp_bash)
check("same input → same ID", id1 == id2, f"id={id1}")
check("ID has gate- prefix", id1.startswith("gate-"), id1)
check("ID digest is 16 hex chars", len(id1) == 21, f"len={len(id1)}")  # "gate-" + 16

# ── Test 2: Semantic stability (volatile fields ignored) ──────────────────────
print("\n=== 2. Semantic stability across Bash retries ===")

inp_with_extras = {"command": "ls /tmp", "_retry": True, "_ts": 99999}
id_with_extras = gate._stable_req_id("session-abc", "Bash", inp_with_extras)
# Bash only uses {"command"}, so extra keys should NOT affect it
# (they won't because we only extract inp.get("command"))
check("volatile fields don't affect Bash ID", id1 == id_with_extras,
      f"base={id1}  extras={id_with_extras}")

# ── Test 3: Different calls produce different IDs ─────────────────────────────
print("\n=== 3. Different calls → different IDs ===")

id_ls_tmp  = gate._stable_req_id("session-abc", "Bash", {"command": "ls /tmp"})
id_ls_home = gate._stable_req_id("session-abc", "Bash", {"command": "ls ~"})
id_diff_session = gate._stable_req_id("session-xyz", "Bash", {"command": "ls /tmp"})

check("different command → different ID", id_ls_tmp != id_ls_home)
check("different session → different ID", id_ls_tmp != id_diff_session)

# Edit vs Bash
id_edit = gate._stable_req_id("session-abc", "Edit", {
    "file_path": "/tmp/test.txt",
    "old_string": "a",
    "new_string": "b",
    "replace_all": False,
})
check("Bash vs Edit → different ID", id_ls_tmp != id_edit)

# ── Test 4: Rate-limit retry fast-path ────────────────────────────────────────
print("\n=== 4. Rate-limit retry fast-path (pre-written APPROVED response) ===")

HOOK_INPUT_BASH = json.dumps({
    "tool_name": "Bash",
    "tool_input": {"command": "sudo echo hi"},
    "session_id": "test-session-001",
})

with tempfile.TemporaryDirectory() as td:
    gate_req  = os.path.join(td, "pixel_hook_gate.json")
    gate_resp = os.path.join(td, "pixel_hook_gate_response.json")
    alive     = os.path.join(td, "pixel_terminal_alive")

    # Touch alive file so is_terminal_alive() passes
    open(alive, 'w').close()

    # Pre-compute the stable req_id for this call
    expected_id = gate._stable_req_id("test-session-001", "Bash", {"command": "sudo echo hi"})

    # Write a pre-existing APPROVED response for this req_id
    with open(gate_resp, 'w') as f:
        json.dump({"id": expected_id, "approved": True}, f)

    # Patch IPC paths to our temp dir
    orig_req  = gate.GATE_REQUEST
    orig_resp = gate.GATE_RESPONSE
    orig_alive = gate.ALIVE_FILE
    gate.GATE_REQUEST  = gate_req
    gate.GATE_RESPONSE = gate_resp
    gate.ALIVE_FILE    = alive

    gate.GATE_REQUEST  = orig_req
    gate.GATE_RESPONSE = orig_resp
    gate.ALIVE_FILE    = orig_alive

    # Use wrapper so subprocess sees patched constants (fresh process ignores in-process patches)
    wrapper4 = os.path.join(td, "run_gate4.py")
    with open(wrapper4, 'w') as wf:
        wf.write(f"""
import importlib.util, sys
spec = importlib.util.spec_from_file_location("pixel_gate", {GATE_PATH!r})
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)
g.GATE_REQUEST  = {gate_req!r}
g.GATE_RESPONSE = {gate_resp!r}
g.ALIVE_FILE    = {alive!r}
g.main()
""")

    env = {**os.environ, "ANIMA_SESSION": "test-session-001"}
    t0 = time.time()
    result = subprocess.run(
        [sys.executable, wrapper4],
        input=HOOK_INPUT_BASH,
        capture_output=True, text=True,
        env=env,
        timeout=5,
    )
    elapsed = time.time() - t0

    try:
        out = json.loads(result.stdout)
        decision = out["hookSpecificOutput"]["permissionDecision"]
        reason   = out["hookSpecificOutput"]["permissionDecisionReason"]
    except Exception as e:
        decision = f"PARSE_ERROR: {e} stdout={result.stdout!r}"
        reason = ""

    check("fast-path exits with allow", decision == "allow", f"decision={decision}")
    check("fast-path reason mentions prior invocation", "prior" in reason.lower(), reason)
    check("fast-path exits in < 1s (no poll wait)", elapsed < 1.0, f"{elapsed:.2f}s")
    check("gate_response file consumed (unlinked)", not os.path.exists(gate_resp))

# ── Test 5: DENY fast-path ────────────────────────────────────────────────────
print("\n=== 5. Rate-limit retry fast-path (pre-written DENIED response) ===")

with tempfile.TemporaryDirectory() as td:
    gate_req  = os.path.join(td, "pixel_hook_gate.json")
    gate_resp = os.path.join(td, "pixel_hook_gate_response.json")
    alive     = os.path.join(td, "pixel_terminal_alive")
    open(alive, 'w').close()

    expected_id = gate._stable_req_id("test-session-001", "Bash", {"command": "sudo echo hi"})
    with open(gate_resp, 'w') as f:
        json.dump({"id": expected_id, "approved": False}, f)

    env = {**os.environ, "ANIMA_SESSION": "test-session-001"}
    # Patch gate paths via subprocess env — use wrapper that overwrites constants
    # (subprocess runs fresh process, so we patch via monkeypatching in a wrapper)
    wrapper = os.path.join(td, "run_gate.py")
    with open(wrapper, 'w') as wf:
        wf.write(f"""
import importlib.util, sys, json
spec = importlib.util.spec_from_file_location("pixel_gate", {GATE_PATH!r})
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)
g.GATE_REQUEST  = {gate_req!r}
g.GATE_RESPONSE = {gate_resp!r}
g.ALIVE_FILE    = {alive!r}
g.main()
""")

    t0 = time.time()
    result = subprocess.run(
        [sys.executable, wrapper],
        input=HOOK_INPUT_BASH,
        capture_output=True, text=True,
        env=env,
        timeout=5,
    )
    elapsed = time.time() - t0

    try:
        out = json.loads(result.stdout)
        decision = out["hookSpecificOutput"]["permissionDecision"]
    except Exception as e:
        decision = f"PARSE_ERROR: {e} stdout={result.stdout!r}"

    check("deny fast-path exits with deny", decision == "deny", f"decision={decision}")
    check("deny fast-path exits in < 1s", elapsed < 1.0, f"{elapsed:.2f}s")

# ── Test 6: Non-Anima session → pass-through ──────────────────────────────────
print("\n=== 6. Non-Anima session → silent pass-through (exit 0, no output) ===")

env_no_anima = {k: v for k, v in os.environ.items() if k != "ANIMA_SESSION"}
result = subprocess.run(
    [sys.executable, GATE_PATH],
    input=HOOK_INPUT_BASH,
    capture_output=True, text=True,
    env=env_no_anima,
    timeout=5,
)
check("exit code 0", result.returncode == 0, f"rc={result.returncode}")
check("no stdout output", result.stdout.strip() == "", f"stdout={result.stdout!r}")

# ── Test 7: needs_ask coverage ────────────────────────────────────────────────
print("\n=== 7. needs_ask: gated vs pass-through commands ===")

gated = [
    ("Bash", {"command": "sudo rm -rf /"}),
    ("Bash", {"command": "ssh user@host"}),
    ("Bash", {"command": "gcloud run deploy my-svc"}),
    ("Bash", {"command": "curl -X DELETE https://api.example.com/resource"}),
    ("Edit", {"file_path": "/Users/bradleytangonan/.claude/settings.json"}),
    ("CronCreate", {"description": "daily backup"}),
]
not_gated = [
    ("Bash", {"command": "ls /tmp"}),
    ("Bash", {"command": "echo hello"}),
    ("Bash", {"command": "git status"}),
    ("Bash", {"command": "npm run build"}),
    ("Edit", {"file_path": "/Users/bradleytangonan/Projects/pixel-terminal/src/main.js"}),
]

for tool, inp in gated:
    ask, msg = gate.needs_ask(tool, inp)
    cmd_or_path = inp.get("command") or inp.get("file_path") or inp.get("description")
    check(f"GATED   {tool}: {str(cmd_or_path)[:50]}", ask, msg or "(no msg)")

for tool, inp in not_gated:
    ask, _ = gate.needs_ask(tool, inp)
    cmd_or_path = inp.get("command") or inp.get("file_path") or ""
    check(f"ALLOWED {tool}: {str(cmd_or_path)[:50]}", not ask)

# ── Test 8: needs_ask — sensitive-policy branches (Codex gap) ────────────────
print("\n=== 8. needs_ask: sensitive policy branches ===")

sensitive_gated = [
    # Therapy isolation: therapy archive + professional tool in same command
    ("Bash", {"command": "python3 notebooklm.py --source chatgpt-archive/therapy/session1.txt"},
     "therapy isolation: chatgpt-archive/therapy near notebooklm"),
    ("Bash", {"command": "nlm add chatgpt-archive/therapy/notes.txt"},
     "therapy isolation: chatgpt-archive/therapy near nlm"),
    # Figma write operations (not read/scan/export)
    ("mcp__figma__set_text_content", {"nodeId": "123", "text": "hello"},
     "Figma write: set_text_content"),
    ("mcp__figma__create_frame", {"name": "MyFrame"},
     "Figma write: create_frame"),
    # Figma read — must NOT be gated
    # Telegram
    ("mcp__telegram__telegram_send_message", {"chat_id": "123", "text": "hi"},
     "Telegram send_message"),
    # NotebookLM therapy source
    ("mcp__notebooklm__source_add", {"file_path": "/tmp/therapy/ifs-session.txt"},
     "NotebookLM therapy source"),
    # CronDelete
    ("CronDelete", {"id": "backup-job"},
     "CronDelete backup-job"),
    # Edit targeting .claude.json (root config)
    ("Edit", {"file_path": "/Users/bradleytangonan/.claude.json"},
     "Edit .claude.json"),
]

sensitive_allowed = [
    # Figma reads/scan/export must pass through
    ("mcp__figma__get_document_info", {}, "Figma get_document_info"),
    ("mcp__figma__scan_text_nodes", {}, "Figma scan_text_nodes"),
    ("mcp__figma__export_node_as_image", {}, "Figma export_node_as_image"),
    # NotebookLM non-therapy source
    ("mcp__notebooklm__source_add", {"file_path": "/tmp/research.txt"},
     "NotebookLM non-therapy source"),
    # Bash with localhost curl mutation (allowed — localhost exempt)
    ("Bash", {"command": "curl -X POST http://localhost:8080/api/data"},
     "curl POST to localhost (allowed)"),
    # Bash deleting non-data files (no email/calendar/drive keyword)
    ("Bash", {"command": "rm /tmp/scratch.txt"},
     "rm /tmp/scratch (allowed)"),
]

for tool, inp, label in sensitive_gated:
    ask, msg = gate.needs_ask(tool, inp)
    check(f"GATED   {label}", ask, msg or "(no msg)")

for tool, inp, label in sensitive_allowed:
    ask, _ = gate.needs_ask(tool, inp)
    check(f"ALLOWED {label}", not ask)

# ── Test 9: skip_write path (duplicate pending request) ───────────────────────
print("\n=== 9. skip_write: same request already pending → no second write ===")

with tempfile.TemporaryDirectory() as td:
    gate_req  = os.path.join(td, "pixel_hook_gate.json")
    gate_resp = os.path.join(td, "pixel_hook_gate_response.json")
    alive     = os.path.join(td, "pixel_terminal_alive")
    open(alive, 'w').close()

    expected_id = gate._stable_req_id("test-session-002", "Bash", {"command": "sudo echo hi"})
    req_ts = int(time.time())

    # Write a live pending request for the SAME req_id (not yet expired)
    with open(gate_req, 'w') as f:
        json.dump({
            "id": expected_id,
            "tool": "Bash",
            "msg": "System config: sudo echo hi",
            "expires": req_ts + 60,
            "ts": req_ts,
        }, f)

    # Write an approved response immediately so the poll finds it fast
    with open(gate_resp, 'w') as f:
        json.dump({"id": expected_id, "approved": True}, f)

    wrapper9 = os.path.join(td, "run_gate9.py")
    with open(wrapper9, 'w') as wf:
        wf.write(f"""
import importlib.util, sys, json, os
spec = importlib.util.spec_from_file_location("pixel_gate", {GATE_PATH!r})
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)
g.GATE_REQUEST  = {gate_req!r}
g.GATE_RESPONSE = {gate_resp!r}
g.ALIVE_FILE    = {alive!r}
g.POLL_S        = 0.05   # fast poll for test
g.main()
""")

    mtime_before = os.path.getmtime(gate_req)
    env = {**os.environ, "ANIMA_SESSION": "test-session-002"}
    t0 = time.time()
    result = subprocess.run(
        [sys.executable, wrapper9],
        input=json.dumps({"tool_name": "Bash", "tool_input": {"command": "sudo echo hi"}}),
        capture_output=True, text=True,
        env=env, timeout=5,
    )
    elapsed = time.time() - t0

    try:
        out = json.loads(result.stdout)
        decision = out["hookSpecificOutput"]["permissionDecision"]
    except Exception as e:
        decision = f"PARSE_ERROR: {e}"

    mtime_after = os.path.getmtime(gate_req) if os.path.exists(gate_req) else None

    check("skip_write: exits with allow", decision == "allow", f"decision={decision}")
    check("skip_write: gate_req mtime unchanged (no re-write)",
          mtime_after is None or abs((mtime_after or 0) - mtime_before) < 0.1,
          f"before={mtime_before:.3f} after={mtime_after}")
    check("skip_write: exits in < 2s", elapsed < 2.0, f"{elapsed:.2f}s")

# ── Test 10: timeout path (fast via POLL_S + TIMEOUT_S monkeypatch) ───────────
print("\n=== 10. Timeout path: no response → deny after TIMEOUT_S ===")

with tempfile.TemporaryDirectory() as td:
    gate_req  = os.path.join(td, "pixel_hook_gate.json")
    gate_resp = os.path.join(td, "pixel_hook_gate_response.json")
    alive     = os.path.join(td, "pixel_terminal_alive")
    open(alive, 'w').close()

    # No response file — gate should timeout and deny
    wrapper10 = os.path.join(td, "run_gate10.py")
    with open(wrapper10, 'w') as wf:
        wf.write(f"""
import importlib.util, sys
spec = importlib.util.spec_from_file_location("pixel_gate", {GATE_PATH!r})
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)
g.GATE_REQUEST  = {gate_req!r}
g.GATE_RESPONSE = {gate_resp!r}
g.ALIVE_FILE    = {alive!r}
g.TIMEOUT_S     = 0.3   # 300ms timeout for fast test
g.POLL_S        = 0.05  # 50ms poll interval
g.main()
""")

    env = {**os.environ, "ANIMA_SESSION": "test-session-003"}
    t0 = time.time()
    result = subprocess.run(
        [sys.executable, wrapper10],
        input=json.dumps({"tool_name": "Bash", "tool_input": {"command": "sudo echo hi"}}),
        capture_output=True, text=True,
        env=env, timeout=5,
    )
    elapsed = time.time() - t0

    try:
        out = json.loads(result.stdout)
        decision = out["hookSpecificOutput"]["permissionDecision"]
        reason   = out["hookSpecificOutput"]["permissionDecisionReason"]
    except Exception as e:
        decision = f"PARSE_ERROR: {e}"
        reason = ""

    check("timeout: exits with deny", decision == "deny", f"decision={decision}")
    check("timeout: reason mentions timeout", "timeout" in reason.lower(), reason)
    check("timeout: completes in 0.3–2.0s", 0.25 < elapsed < 2.0, f"{elapsed:.2f}s")
    check("timeout: gate_req file cleaned up", not os.path.exists(gate_req))

# ── Summary ───────────────────────────────────────────────────────────────────
print()
passed = sum(1 for _, ok in results if ok)
total  = len(results)
print(f"{'='*50}")
print(f"Results: {passed}/{total} passed")
if passed < total:
    print("FAILURES:")
    for name, ok in results:
        if not ok:
            print(f"  ✗ {name}")
    sys.exit(1)
else:
    print("All tests passed.")
    sys.exit(0)
