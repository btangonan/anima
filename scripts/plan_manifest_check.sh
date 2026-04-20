#!/usr/bin/env bash
# plan_manifest_check.sh — deterministic plan-to-manifest parity checker
#
# Walks the phase task tables of an anima-s-tier plan markdown, extracts
# backticked path tokens per the v14 bullet-#7 contract, does the same for
# the final "Files this plan creates / modifies" table, and fails with
# `only-in-phase: <path>` / `only-in-manifest: <path>` lines when the two
# sets diverge.
#
# Usage:  scripts/plan_manifest_check.sh <plan.md>

set -euo pipefail

PLAN="${1:-}"
if [[ -z "$PLAN" || ! -f "$PLAN" ]]; then
  echo "usage: $0 <plan.md>" >&2
  exit 2
fi

tmpdir="$(mktemp -d -t plan-manifest-XXXXXX)"
trap 'rm -rf "$tmpdir"' EXIT

# (a) Path collection: grep backticked tokens of the form `path.ext` or
#     `path.ext (annotation)`; strip the annotation.
extract_backticked_paths() {
  grep -oE '`[^` ]+\.[a-z]+( *\([^)]*\))?`' || true
}

strip_wrapping() {
  sed -E 's/^`//; s/`$//; s/ *\([^)]*\)$//'
}

# (b) Brace expansion: `tests/{a,b}.rs` -> tests/a.rs, tests/b.rs.
expand_braces() {
  awk '
    {
      line = $0
      while (match(line, /{[^{}]*}/)) {
        pre = substr(line, 1, RSTART - 1)
        mid = substr(line, RSTART + 1, RLENGTH - 2)
        post = substr(line, RSTART + RLENGTH)
        n = split(mid, arr, ",")
        out = ""
        for (i = 1; i <= n; i++) {
          if (i > 1) out = out "\n"
          out = out pre arr[i] post
        }
        # restart with first expansion if there are nested groups; but this
        # contract only supports single-level, so emit each and stop.
        n2 = split(out, lines, "\n")
        for (j = 1; j <= n2; j++) print lines[j]
        next
      }
      print line
    }
  '
}

# (c) Filename filter — keep set.
keep_filter() {
  grep -E '^(tests/|scripts/|src-tauri/tests/)|\.exp$|\.test\.js$|\.test\.sh$' || true
}

# (c) Exclusion — applied after keep-filter.
exclude_filter() {
  grep -vE '^tests/spikes/|^tests/fixtures/permission_tool_name_v1\.txt$' || true
}

# Extract phase task rows (| P<digit>.<name> | ...) before the manifest section.
awk '
  /^## Files this plan creates \/ modifies/ { exit }
  /^\| P[0-9]+\.[A-Za-z0-9]+ \|/ { print }
' "$PLAN" > "$tmpdir/phase_rows.txt"

# Extract manifest table rows inside the final section (| P<digit> | ...).
awk '
  /^## Files this plan creates \/ modifies/ { in_section=1; next }
  in_section && /^## [A-Za-z]/ { in_section=0 }
  in_section && /^\| P[0-9]+ \|/ { print }
' "$PLAN" > "$tmpdir/manifest_rows.txt"

process_rows() {
  local input="$1" output="$2"
  if [[ ! -s "$input" ]]; then
    : > "$output"
    return
  fi
  extract_backticked_paths < "$input" \
    | strip_wrapping \
    | expand_braces \
    | keep_filter \
    | exclude_filter \
    | sort -u > "$output"
}

process_rows "$tmpdir/phase_rows.txt"    "$tmpdir/phase_set.txt"
process_rows "$tmpdir/manifest_rows.txt" "$tmpdir/manifest_set.txt"

only_in_phase=$(comm -23 "$tmpdir/phase_set.txt" "$tmpdir/manifest_set.txt" || true)
only_in_manifest=$(comm -13 "$tmpdir/phase_set.txt" "$tmpdir/manifest_set.txt" || true)

exit_code=0
if [[ -n "$only_in_phase" ]]; then
  while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    echo "only-in-phase: $p"
  done <<< "$only_in_phase"
  exit_code=1
fi

if [[ -n "$only_in_manifest" ]]; then
  while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    echo "only-in-manifest: $p"
  done <<< "$only_in_manifest"
  exit_code=1
fi

exit $exit_code
