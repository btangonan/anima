# Synthetic Plan Fixture — missing-phase case

This fixture exercises the plan-manifest parity checker. The final manifest
table lists `tests/integration/orphan_manifest_test.test.js`, but no phase
row references it. The checker MUST exit 1 and emit
`only-in-manifest: tests/integration/orphan_manifest_test.test.js`.

## Phase 1 — Setup

| Task ID | Description | Files |
|---------|-------------|-------|
| P1.A | Write helper | `scripts/example_helper.sh` |

## Phase 2 — Finish

| Task ID | Description | Files |
|---------|-------------|-------|
| P2.A | Add exp fixture | `tests/fixtures/example.exp` |

## Files this plan creates / modifies

| Phase | Path |
|-------|------|
| P1 | `scripts/example_helper.sh` |
| P1 | `tests/integration/orphan_manifest_test.test.js` |
| P2 | `tests/fixtures/example.exp` |

## Notes

Section terminator.
