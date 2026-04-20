# Synthetic Plan Fixture — missing-manifest case

This fixture exercises the plan-manifest parity checker. Phase P1 claims to
create `tests/integration/orphan_phase_test.test.js`, but the final manifest
table omits it. The checker MUST exit 1 and emit
`only-in-phase: tests/integration/orphan_phase_test.test.js`.

## Phase 1 — Setup

| Task ID | Description | Files |
|---------|-------------|-------|
| P1.A | Write orphan test | `tests/integration/orphan_phase_test.test.js` |
| P1.B | Update script | `scripts/example_helper.sh` |

## Phase 2 — Finish

| Task ID | Description | Files |
|---------|-------------|-------|
| P2.A | Add exp fixture | `tests/fixtures/example.exp` |

## Files this plan creates / modifies

| Phase | Path |
|-------|------|
| P1 | `scripts/example_helper.sh` |
| P2 | `tests/fixtures/example.exp` |

## Notes

This section exists purely to terminate the manifest table when scanning.
