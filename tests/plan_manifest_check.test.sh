#!/usr/bin/env bash
# plan_manifest_check.test.sh — negative-fixture tests for the parity checker.
#
# Asserts that scripts/plan_manifest_check.sh exits 1 and emits the correct
# diagnostic line for each synthetic fixture. Exits 0 on success.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK="$ROOT/scripts/plan_manifest_check.sh"
FIX_DIR="$ROOT/tests/fixtures"

fail=0

run_case() {
  local label="$1" fixture="$2" expect_line="$3"
  local out
  out="$(bash "$CHECK" "$fixture" 2>&1 || true)"
  local code=$?
  # shellcheck disable=SC2181
  # capture the actual exit code separately because `|| true` masks it
  bash "$CHECK" "$fixture" >/dev/null 2>&1
  code=$?
  if [[ $code -ne 1 ]]; then
    echo "FAIL [$label]: expected exit 1, got $code"
    fail=1
    return
  fi
  if ! grep -Fxq "$expect_line" <<< "$out"; then
    echo "FAIL [$label]: expected diagnostic line not found"
    echo "  expected: $expect_line"
    echo "  got:"
    sed 's/^/    /' <<< "$out"
    fail=1
    return
  fi
  echo "OK   [$label]"
}

run_case \
  "missing-manifest" \
  "$FIX_DIR/plan_manifest_missing_manifest.md" \
  "only-in-phase: tests/integration/orphan_phase_test.test.js"

run_case \
  "missing-phase" \
  "$FIX_DIR/plan_manifest_missing_phase.md" \
  "only-in-manifest: tests/integration/orphan_manifest_test.test.js"

if [[ $fail -ne 0 ]]; then
  echo "plan_manifest_check.test.sh: FAILED"
  exit 1
fi
echo "plan_manifest_check.test.sh: all cases passed"
exit 0
