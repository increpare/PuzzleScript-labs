# TypeScript compatibility boundary implementation plan

> Execute inline in the existing isolated worktree. The user approved the design
> in the preceding discussion; continue without another approval checkpoint.

**Goal:** Make historical exceptions and observable scan order explicit without
changing vanilla behavior.

**Architecture:** One versioned compatibility module and one coordinate-order
module. Keep current game field shapes and independent oracle comparisons.

**Tech stack:** TypeScript strict build, Node tests and the pinned vanilla oracle.

- [x] Inspect the eight findings, native source, adapters and existing tests.
- [x] Record the approved design and reuse the clean labs-based worktree.
- [x] Add `test/compatibility-boundary.test.mjs` and `test/scan-order.test.mjs`;
  run them against the old build and observe the missing module failures.
- [x] Create `src/compatibility-vanilla-5a94bde1.ts` with the extracted restore,
  rigid-owner and movement exceptions, using domain values and explicit comments
  about unavoidable layout dependence. Move compatibility field declarations
  there; preserve their public shape and existing adapter schemas.
- [x] Create `src/scan-order.ts` with `positionsByRow`, `positionsByColumn` and
  `matchingPositions`; update movement, player input, matching and level scans.
- [x] Simplify `scheduling.ts` by removing `consecutiveFailures`. Document the
  permissive Cell and batch-write contracts; add a source-session conflict case.
- [x] Build, run new and focused tests, then the complete strict suite. Check
  focused random/rigid/undo/restart per-move replays and standalone examples.
- [x] Document the boundary, actual ordering and compatibility limits in README;
  review the diff. Release commits contain only approved package/docs changes.

Tests: `npm --prefix typescript run build`, then
`node --test typescript/test/compatibility-boundary.test.mjs typescript/test/scan-order.test.mjs`,
`npm --prefix typescript test`, and
`node typescript/test/corpus.cjs --session <fixture filter>` from the repository
root. The full suite already passed 1,583 tests on base `307bc7d0`.

## Results

- Six new boundary/order tests first fail on missing modules, then pass.
- Focused behavior/oracle suites pass 152 checks before the additional diagnosed
  source-conflict regression; that regression passes in the final full suite.
- Final strict build and suite: **1,590 passed**, zero failed, skipped or cancelled,
  exit zero; `/private/tmp/typescript-compatibility-full.log`.
- Targeted per-input replay: random (3 games / 33 observations), rigid body test 2
  (1 / 169), undo test (2 / 67), restart test (1 / 67). Totals: **7 games,
  336 observations/operations, 9 loads**, all exit zero. Logs use the
  `/private/tmp/typescript-compatibility-*-corpus.log` paths.
- Standalone source example and trace exit zero; all six documented player and
  crate positions are checked. Native-free standalone execution also passes in
  the full suite.
- Independent read-only review reports no actionable findings. Review checked
  behavior preservation, module boundary, scan order, scheduling and the new
  source-conflict oracle regression.
- Native fixtures and their hashes are unchanged. The complete 478-game replay
  belongs to the prior completion checkpoint; this cleanup reruns the targeted
  corpus above, without presenting the earlier replay as a new run.

Release: commit and integrate through the previously authorized labs-master
workflow, verifying the remote SHA and preserving primary-checkout edits.
