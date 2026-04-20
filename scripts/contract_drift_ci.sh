#!/usr/bin/env bash
# contract_drift_ci.sh — nightly hook-event schema drift detector
#
# Spawns `claude --include-hook-events` against a canned prompt, captures
# every hook_event frame, groups frames by (subtype, hook_event), extracts
# the key set of each group, and diffs against the fixture at
# tests/fixtures/hook_events_v1.jsonl.
#
# Drift output is appended to the drift log; the script exits non-zero
# when the fixture and live capture differ so CI can surface it.
#
# Requirements: jq, claude (v2.1.x).
# Usage: scripts/contract_drift_ci.sh [--prompt "..."] [--fixture path]

set -euo pipefail

PROMPT='use the Bash tool to run: echo hello'
FIXTURE="$(cd "$(dirname "$0")/.." && pwd)/tests/fixtures/hook_events_v1.jsonl"
DRIFT_LOG="${HOME}/.local/share/pixel-terminal/contract-drift.log"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt)  PROMPT="$2"; shift 2 ;;
    --fixture) FIXTURE="$2"; shift 2 ;;
    --drift-log) DRIFT_LOG="$2"; shift 2 ;;
    -h|--help)
      sed -n 's/^# \{0,1\}//p' "$0" | head -20
      exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

command -v jq >/dev/null    || { echo "jq not installed" >&2; exit 2; }
command -v claude >/dev/null || { echo "claude CLI not on PATH" >&2; exit 2; }
[[ -f "$FIXTURE" ]]          || { echo "fixture missing: $FIXTURE" >&2; exit 2; }

mkdir -p "$(dirname "$DRIFT_LOG")"

CAPTURE_DIR="$(mktemp -d -t anima-drift-XXXXXX)"
trap 'rm -rf "$CAPTURE_DIR"' EXIT

LIVE_STREAM="$CAPTURE_DIR/live.jsonl"
LIVE_KEYS="$CAPTURE_DIR/live_keys.txt"
FIXTURE_KEYS="$CAPTURE_DIR/fixture_keys.txt"
DIFF_OUT="$CAPTURE_DIR/diff.txt"

echo "[contract-drift] capturing live stream..." >&2
claude --print \
  --output-format stream-json \
  --include-hook-events \
  -p "$PROMPT" \
  > "$LIVE_STREAM" 2>/dev/null || {
    echo "[contract-drift] claude exited non-zero; continuing with partial capture" >&2
  }

extract_keys() {
  local src="$1"
  local dst="$2"
  jq -r '
    select(.type == "hook_event" or .hook_event != null)
    | {
        route: ((.subtype // "none") + "|" + (.hook_event // "none")),
        keys: (. | to_entries | map(.key) | sort | join(","))
      }
    | "\(.route)\t\(.keys)"
  ' "$src" | sort -u > "$dst"
}

extract_keys "$LIVE_STREAM" "$LIVE_KEYS"
extract_keys "$FIXTURE" "$FIXTURE_KEYS"

if diff -u "$FIXTURE_KEYS" "$LIVE_KEYS" > "$DIFF_OUT"; then
  echo "[contract-drift] no drift detected" >&2
  exit 0
fi

STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
{
  echo ""
  echo "========== drift $STAMP =========="
  echo "fixture: $FIXTURE"
  echo "prompt:  $PROMPT"
  echo "---- diff (fixture ← left, live ← right) ----"
  cat "$DIFF_OUT"
  echo "========== end $STAMP =========="
} >> "$DRIFT_LOG"

echo "[contract-drift] drift detected; appended to $DRIFT_LOG" >&2
exit 1
