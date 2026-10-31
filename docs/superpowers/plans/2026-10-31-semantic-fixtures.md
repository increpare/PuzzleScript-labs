# Semantic fixtures implementation plan

**Goal:** Deliver readable, hand-specified game fixtures usable by the existing JS
suite and by the TypeScript per-move oracle; investigate any disagreement.

**Architecture:** Family manifests and `.ps` files under
`src/tests/semantic-fixtures/`, a small CommonJS loader/exporter beside them, and
a TypeScript test using the existing independently compiled session oracle.

- [x] Inspect current runners, schema and native serializer; reuse the isolated
  worktree on a fresh branch based on labs master `3367a2d4`.
- [x] Record the user-approved fixture format and expected-value discipline.
- [x] Write failing loader/export tests; implement schema validation and the
  legacy board serializer, including asymmetric two-dimensional boards.
- [x] Author independent families in parallel: property/movement inference;
  matching/ellipses; random/history/commands. Parent authors movement/rigid cases.
- [x] Validate each expected outcome and source diagnostics. Keep any discrepancy
  as a minimal reproducer with original expectations and an investigation record.
- [x] Add deterministic export/check wiring and generated `testdata.js` entries;
  run them on the labs engine. Add per-input TS/pinned-vanilla verification for
  all new fixtures, with unchanged producer guards and oracle hashes.
- [x] Review coverage, expected values and discrepancy classification. Run the
  full appropriate headless suites and confirm reproducible exports.
- [x] Document how to read, run and contribute fixtures. Release commits contain
  the reviewed corpus and harness without unrelated source changes.

## Final evidence

- 52 authored `.ps` games and 140 portable `testdata.js` entries: inference 28,
  matching 30, history 30, movement/rigid 46, random rule groups 6.
- Pinned vanilla: 140/140 pass, zero compilation errors. Two singleton-random
  warnings are intentional and documented.
- New per-input/AGAIN oracle cases: 140 fixtures, 370 observations/operations,
  140 loads. Focused suite: 146 tests plus four loader/export tests pass. Negative
  checks reject wrong boards, recorded sounds and audible simple-sound sequences.
- Full strict TypeScript suite: **1,749 passed**, zero failed/skipped/cancelled,
  exit zero; `/private/tmp/semantic-typescript-release.log`.
- Full labs simulation/diagnostic suite: **934 passed** (613 simulation,
  321 compilation), zero failed/errors, exit zero;
  `/private/tmp/semantic-labs-release.log`. Auxiliary/UI/browser tests were not
  part of this headless engine change.
- Independent harness and expectation reviews approved after adding direct
  phantom-ban/audible-command assertions, random-prefixed groups, checkpoint
  cancellation and ellipsis row-boundary controls. The final Up+Down source-level
  control was separately reviewed and native/TS verified.
- All 4,475,906 original bytes of labs `testdata.js` remain an identical prefix.
  Export `--check` and idempotence tests pass. Production engines, frozen vanilla
  fixtures, oracle source hashes and existing per-move adapters are unchanged.

## Exploration result

No JS/TypeScript gameplay discrepancy was found in the completed new cases. A
separate accepted-source crash was reduced to one Player cell and two Action
inputs: late randomdir leaves Right pending, then Action creates an unsupported
combined request. Pinned vanilla and labs throw TypeError; TypeScript reports the
unsupported Right/Action combination. The game has zero errors/warnings and an
early-rule control succeeds. Its report, source and verifying runner are in
`src/tests/semantic-fixtures/repros/late-player-randomdir.*`; the crashing case is
not disguised as a passing legacy fixture. No engine fix was applied.

Release follows the already authorized labs-master workflow, with remote SHA
verification and preservation of the primary checkout's state.
