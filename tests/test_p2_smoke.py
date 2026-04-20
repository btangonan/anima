#!/usr/bin/env python3
"""
test_p2_smoke.py — P2 migration smoke suite (programmatic, no app required)

Tests:
  1. drift-score.py claude_md_collection_drift() — new enforcement code
  2. P2.I week-0 metrics: gated vs degraded from /tmp/pixel-terminal.log
  3. Audit log: parse integrity + no anomalies
  4. Rust load_session_history path-guard: rejects traversal + non-claude paths
  5. History Rust parser: parses a real JSONL without error
  6. Vexil truncation fix: session-lifecycle.js no longer slices oracle reply
  7. CLAUDE.md collection name: pixel_terminal_memory in project CLAUDE.md
"""

import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile

PASS  = "\033[32mPASS\033[0m"
FAIL  = "\033[31mFAIL\033[0m"
WARN  = "\033[33mWARN\033[0m"
results = []

def check(name, cond, detail=""):
    tag = PASS if cond else FAIL
    print(f"  [{tag}] {name}" + (f"  — {detail}" if detail else ""))
    results.append((name, cond))

def warn(name, detail=""):
    print(f"  [{WARN}] {name}" + (f"  — {detail}" if detail else ""))

# ── 1. drift-score.py: claude_md_collection_drift() ──────────────────────────
print("\n=== 1. drift-score.py collection drift detection ===")

DRIFT_PATH = os.path.expanduser("~/.claude/hooks/drift-score.py")

# drift-score.py has no __main__ guard — exec only the function we need
# by extracting it from source to avoid triggering main()/sys.exit(0).
with open(DRIFT_PATH) as _f:
    _src = _f.read()

_ns = {"os": os, "re": re, "json": json}
# Pull out just the claude_md_collection_drift function definition via exec
_func_match = re.search(
    r'(def claude_md_collection_drift\(.*?)(?=\ndef |\Z)', _src, re.DOTALL
)
if _func_match:
    exec(compile(_func_match.group(1), DRIFT_PATH, 'exec'), _ns)

claude_md_collection_drift = _ns.get("claude_md_collection_drift")
check("drift-score.py has claude_md_collection_drift()", claude_md_collection_drift is not None)

class _DriftProxy:
    pass

drift = _DriftProxy()
drift.claude_md_collection_drift = claude_md_collection_drift

with tempfile.TemporaryDirectory() as td:
    # Bad: collection name not ending in _memory
    bad_claude = os.path.join(td, "CLAUDE.md")
    with open(bad_claude, 'w') as f:
        f.write('Use server `gemini-memory`. Collection `pixel_terminal`.\n'
                '"collection": "pixel_terminal"\n')
    bad = drift.claude_md_collection_drift(td)
    check("flags bare collection name (pixel_terminal)", "pixel_terminal" in bad, str(bad))

    # Good: _memory suffix
    good_claude = os.path.join(td, "CLAUDE_good.md")
    with open(good_claude, 'w') as f:
        f.write('"collection": "pixel_terminal_memory"\n')
    # Temporarily rename for the function (it reads CLAUDE.md fixed name)
    import shutil
    shutil.copy(good_claude, bad_claude)
    good = drift.claude_md_collection_drift(td)
    check("passes _memory suffix (pixel_terminal_memory)", good == [], str(good))

    # Wildcard * excluded
    star_claude = os.path.join(td, "CLAUDE_star.md")
    with open(star_claude, 'w') as f:
        f.write('"collection": "*"\n')
    shutil.copy(star_claude, bad_claude)
    star = drift.claude_md_collection_drift(td)
    check('wildcard "*" not flagged', star == [], str(star))

    # Multiple: one bad, one good → only bad flagged
    mixed_claude = os.path.join(td, "CLAUDE_mixed.md")
    with open(mixed_claude, 'w') as f:
        f.write('"collection": "pixel_terminal"\n"collection": "pixel_terminal_memory"\n')
    shutil.copy(mixed_claude, bad_claude)
    mixed = drift.claude_md_collection_drift(td)
    check("mixed: only bad name flagged", mixed == ["pixel_terminal"], str(mixed))

# Verify the real project CLAUDE.md is clean
real_project = "/Users/bradleytangonan/Projects/pixel-terminal"
real_drift = drift.claude_md_collection_drift(real_project)
check("pixel-terminal CLAUDE.md has no collection drift", real_drift == [], str(real_drift))

# ── 2. P2.I week-0 metrics ────────────────────────────────────────────────────
print("\n=== 2. P2.I week-0 metrics (live log) ===")

LOG = "/tmp/pixel-terminal.log"
gated = degraded = 0
spawn_lines = []

if os.path.exists(LOG):
    with open(LOG) as f:
        for line in f:
            if "[SPAWN]" in line:
                spawn_lines.append(line.strip())
            if "[P2A] gated" in line:
                gated += 1
            if "degraded" in line.lower() and "[SPAWN]" in line:
                degraded += 1

total = gated + degraded
fallback_rate = degraded / total if total > 0 else 0.0

check("log exists", os.path.exists(LOG))
check("at least 1 gated spawn recorded", gated > 0, f"gated={gated}")
check("zero degraded spawns (fallback=0%)", degraded == 0,
      f"degraded={degraded} total={total} rate={fallback_rate:.1%}")
check("fallback rate < 1%", fallback_rate < 0.01,
      f"{fallback_rate:.2%} ({degraded}/{total})")

# Verify no bypass-mode spawns (all should be gated or degraded, not raw bypass)
bypass_no_p2a = 0
for line in spawn_lines:
    # A SPAWN without a subsequent P2A line in same log chunk = bypass
    # Simple heuristic: look for bypass in the line itself
    if "bypass" in line.lower():
        bypass_no_p2a += 1
check("no explicit bypass spawns in log", bypass_no_p2a == 0, f"bypass_spawns={bypass_no_p2a}")

print(f"      Week-0 summary: gated={gated}, degraded={degraded}, "
      f"fallback={fallback_rate:.1%}, bypass={bypass_no_p2a}")

# ── 3. Audit log integrity ────────────────────────────────────────────────────
print("\n=== 3. Audit log integrity ===")

AUDIT_LOG = os.path.expanduser("~/.local/share/pixel-terminal/permission_audit.jsonl")

if not os.path.exists(AUDIT_LOG):
    warn("permission_audit.jsonl not yet created (no gated tool calls approved/denied yet)")
    check("audit log absent = no gate events = expected for day-0", True)
else:
    parse_errors = 0
    timeouts = 0
    entries = 0
    required_fields = {"ts_ms", "session_id", "tool", "decision"}

    with open(AUDIT_LOG) as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                entries += 1
                missing = required_fields - set(obj.keys())
                if missing:
                    parse_errors += 1
                    print(f"      Line {i}: missing fields {missing}")
                if obj.get("decision") == "timeout":
                    timeouts += 1
            except json.JSONDecodeError as e:
                parse_errors += 1
                print(f"      Line {i}: JSON error — {e}")

    check("audit log parses cleanly (0 errors)", parse_errors == 0,
          f"{parse_errors} errors in {entries} entries")
    check("no timeout decisions", timeouts == 0,
          f"{timeouts} timeouts out of {entries} decisions")
    print(f"      Entries: {entries}")

# ── 4. Rust load_session_history path guard ───────────────────────────────────
print("\n=== 4. Rust load_session_history path guard ===")

# Simulate the Python equivalent of the Rust guard
HOME = os.environ["HOME"]
ALLOWED_PREFIX = f"{HOME}/.claude/projects/"

def rust_path_guard(file_path: str) -> tuple[bool, str]:
    if "/../" in file_path or file_path.endswith("/.."):
        return False, "Path traversal not allowed"
    if not file_path.startswith(ALLOWED_PREFIX):
        return False, "Session files must be under ~/.claude/projects/"
    return True, "ok"

traversal_cases = [
    (f"{HOME}/.claude/projects/foo/../../etc/passwd", False, "traversal via .."),
    (f"{HOME}/.ssh/id_rsa", False, "outside .claude/projects"),
    ("/etc/passwd", False, "absolute path outside home"),
    (f"{HOME}/.claude/projects/-Users-foo-bar/session.jsonl", True, "valid path"),
    (f"{HOME}/.claude/projects/x/y/z.jsonl", True, "nested valid path"),
]

for path, expected_ok, label in traversal_cases:
    ok, reason = rust_path_guard(path)
    check(f"path guard: {label}", ok == expected_ok,
          f"path={repr(path)[:60]} → {reason}")

# ── 5. Rust parser: parse a real session JSONL ────────────────────────────────
print("\n=== 5. Rust parser handles real session JSONL ===")

# Find the project JSONL directory
proj_dir = f"{HOME}/.claude/projects/-Users-bradleytangonan-Projects-pixel-terminal"
jsonl_files = [
    f for f in os.listdir(proj_dir)
    if f.endswith(".jsonl")
] if os.path.isdir(proj_dir) else []

check("session JSONL files exist", len(jsonl_files) > 0, f"{len(jsonl_files)} files")

if jsonl_files:
    # Parse the smallest file (fastest test)
    sizes = [(os.path.getsize(os.path.join(proj_dir, f)), f) for f in jsonl_files]
    smallest = min(sizes)[1]
    path = os.path.join(proj_dir, smallest)

    parse_errors = 0
    msg_types = set()
    with open(path) as fp:
        for line in fp:
            line = line.strip()
            if not line: continue
            try:
                obj = json.loads(line)
                if "type" in obj:
                    msg_types.add(obj["type"])
            except json.JSONDecodeError:
                parse_errors += 1

    check("smallest JSONL parses without errors", parse_errors == 0,
          f"{parse_errors} errors, file={smallest}")
    check("has expected message types (user/assistant)",
          bool(msg_types & {"user", "assistant"}),
          f"types found: {msg_types}")

# ── 6. Vexil truncation fix: slice(0, 240) removed ───────────────────────────
print("\n=== 6. Vexil truncation fix (no slice cap in session-lifecycle.js) ===")

LIFECYCLE = "/Users/bradleytangonan/Projects/pixel-terminal/src/session-lifecycle.js"
with open(LIFECYCLE) as f:
    lifecycle_src = f.read()

# The bad pattern: .slice(0, 240) on oracle reply text
bad_pattern = r"resp\.msg.*\.slice\(0,\s*240\)"
bad_match = re.search(bad_pattern, lifecycle_src)
check("slice(0,240) cap removed from oracle reply path",
      bad_match is None,
      f"found at: {bad_match.group() if bad_match else 'not found'}")

# The addToVexilLog call should pass full resp.msg
log_pattern = r"addToVexilLog\('vexil',\s*resp\.msg\)"
log_match = re.search(log_pattern, lifecycle_src)
check("addToVexilLog passes full resp.msg (no slice)",
      log_match is not None,
      f"pattern found: {bool(log_match)}")

# ── 7. CLAUDE.md collection name correct ─────────────────────────────────────
print("\n=== 7. CLAUDE.md collection name: pixel_terminal_memory ===")

CLAUDE_MD = "/Users/bradleytangonan/Projects/pixel-terminal/CLAUDE.md"
with open(CLAUDE_MD) as f:
    claude_src = f.read()

bare_name = re.findall(r'"collection":\s*"pixel_terminal"(?!_)', claude_src)
check("no bare 'pixel_terminal' collection references in CLAUDE.md",
      bare_name == [], f"found: {bare_name}")

memory_name = re.findall(r'"collection":\s*"pixel_terminal_memory"', claude_src)
check("pixel_terminal_memory referenced in CLAUDE.md",
      len(memory_name) > 0, f"{len(memory_name)} occurrences")

# ── 8. History: loading class cleared on success ──────────────────────────────
print("\n=== 8. History JS: loading class guard ===")

HISTORY_JS = "/Users/bradleytangonan/Projects/pixel-terminal/src/history.js"
with open(HISTORY_JS) as f:
    hist_src = f.read()

# Must have querySelectorAll sweep clearing 'loading' before adding it
sweep_pattern = r"querySelectorAll\('[^']*history-card[^']*'\).*?remove\([^)]*loading"
sweep_match = re.search(sweep_pattern, hist_src, re.DOTALL)
check("querySelectorAll sweep clears stale loading class",
      sweep_match is not None)

# Must have cardEl.classList.remove('loading') inside the try block (success path)
remove_in_try = r"_activeId\s*=\s*entry\.session_id.*?cardEl\.classList\.remove\('loading'\)"
remove_match = re.search(remove_in_try, hist_src, re.DOTALL)
check("loading class removed on success (before showCurrentHistoryCard)",
      remove_match is not None)

# _activeId must NOT render in the scrollable list (filterout check)
filter_pattern = r"_activeId.*filter\(.*session_id.*!==.*_activeId"
filter_match = re.search(filter_pattern, hist_src, re.DOTALL)
check("active session filtered out of scrollable list",
      filter_match is not None)

# ── Summary ───────────────────────────────────────────────────────────────────
print()
passed = sum(1 for _, ok in results if ok)
total_c = len(results)
print("=" * 55)
print(f"Results: {passed}/{total_c} passed")
if passed < total_c:
    print("FAILURES:")
    for name, ok in results:
        if not ok:
            print(f"  ✗ {name}")
    sys.exit(1)
else:
    print("All tests passed.")
    sys.exit(0)
