#!/usr/bin/env bash
# scripts/capture_permission_prompts.sh
#
# Regenerates tests/fixtures/permission_prompts_v1.txt by running
# `claude --permission-mode default --print` against each of the six fixture
# tool scenarios (Bash, Read, Write, Edit, MCP tool, permission-mode change)
# in a pty and capturing the exact prompt strings emitted.
#
# Usage:
#   bash scripts/capture_permission_prompts.sh            # capture + write fixture
#   bash scripts/capture_permission_prompts.sh --dry-run  # capture + print only
#
# The fixture is committed, not regenerated in CI. Run this script by hand
# whenever a claude CLI version drift causes the regex runner tests to fail —
# the unmatched-line diagnostic shows which prompts changed.

set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then DRY_RUN=1; fi

if ! command -v claude >/dev/null 2>&1; then
  echo "FAIL: claude CLI not found on PATH" >&2
  exit 1
fi

if ! command -v expect >/dev/null 2>&1; then
  echo "FAIL: expect(1) not installed — brew install expect (macOS) or apt install expect" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="${REPO_ROOT}/tests/fixtures/permission_prompts_v1.txt"
TMP="$(mktemp -t anima_prompts.XXXXXX)"
trap 'rm -f "${TMP}"' EXIT

capture_prompt() {
  local user_prompt="$1"
  expect -c "
    set timeout 20
    log_user 0
    spawn claude --permission-mode default --print -p \"${user_prompt}\"
    expect {
      -re {([^\r\n]*\\(y/n\\))} {
        puts \$expect_out(1,string)
        send \"n\r\"
        exit 0
      }
      timeout { puts stderr \"timeout waiting for prompt\"; exit 1 }
      eof     { puts stderr \"eof without prompt\"; exit 1 }
    }
  " 2>/dev/null
}

# Six canonical scenarios. Any addition here must also be reflected in the
# Tcl + JS runner alternates in tests/integration/permission_prompt_regex.*
: > "${TMP}"
capture_prompt "use the Bash tool to run: ls /tmp"                                  >> "${TMP}" || true
capture_prompt "use the Read tool to read /etc/hosts"                               >> "${TMP}" || true
capture_prompt "use the Write tool to create /tmp/animafixture.txt with text hello" >> "${TMP}" || true
capture_prompt "use the Edit tool to change 'a' to 'b' in /tmp/animafixture.txt"    >> "${TMP}" || true
capture_prompt "use any mcp tool; for example mcp__anima_test__approve"             >> "${TMP}" || true
capture_prompt "switch permission mode to acceptEdits"                              >> "${TMP}" || true

LINES=$(grep -c . "${TMP}" || true)
if [[ "${LINES}" -lt 1 ]]; then
  echo "FAIL: captured zero prompts — claude CLI version may no longer emit these strings" >&2
  exit 1
fi

if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "=== dry run ===" >&2
  cat "${TMP}"
  exit 0
fi

cp "${TMP}" "${FIXTURE}"
echo "wrote ${LINES} prompt(s) to ${FIXTURE}"
echo ""
echo "next steps:"
echo "  1. review diff: git diff ${FIXTURE}"
echo "  2. run vitest  tests/integration/permission_prompt_regex.test.js"
echo "  3. run expect  tests/integration/permission_prompt_regex.exp"
echo "  4. if either fails, update the alternates in the .test.js AND .exp files"
echo "     in the SAME commit as the fixture — drift is loud, not silent."
