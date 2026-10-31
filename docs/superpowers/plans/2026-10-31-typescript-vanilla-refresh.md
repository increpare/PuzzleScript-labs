# TypeScript vanilla reference refresh plan

**Goal:** Advance the exact independent reference and its oracle from 5a94bde1 to
57f9f6cb, including upstream regression cases and full per-move verification.

**Architecture:** Refresh immutable test fixtures; change only corresponding
domain algorithms and diagnostics. Keep researched historical behaviors opt-in
and make the current revision the default authority.

- [x] Inspect upstream sync, the six changed oracle files and native algorithm
  diffs. Isolate on origin/master 631fee59, excluding unpublished a304a3e6.
- [x] Rename compatibility module/imports and refresh all oracle bytes/hashes.
  Run targeted tests against the new authority to capture failures.
- [x] Update parser/lexical diagnostics, rule validation and game-data diagnostics
  in parallel with rigid ownership and speculative checkpoint handling.
- [x] Update semantic expectations and explicitly assert diagnostics on formerly
  accepted late-randomdir sources. Preserve meaningful authored sound/ban checks.
- [x] Resolve exact compiler/oracle projections and all independent regression
  failures without weakening comparisons or dropping coverage.
- [x] Run the strict suite and full refreshed compiler fixtures. Run all recorded
  source-compiled sessions with per-input/AGAIN/RNG/history/effect comparisons.
- [x] Independently review implementation and oracle authority; update docs and
  provenance. Commit only the reference update and its tests/documents.

The primary checkout contains an unrelated unpublished cached-AGAIN commit. Do
not publish or rewrite that commit as part of this reference update.

## Verification

- All 22 oracle files and the license independently match the exact upstream Git
  objects; every manifest hash matches. The original Labs testdata prefix is
  unchanged by this branch.
- Independent review found no actionable issues and separately passed 84 focused
  tests. Rigid-owner transitions are observed through actual native replacements.
- All 140 authored fixtures pass in native vanilla, TypeScript and the branch's
  Labs engine. The 19 recovery cases require their explicit late-movement error.
- The complete Labs runner passes 976 tests plus its three additional Node checks.
- The strict TypeScript suite passes all 1,768 tests. Exact full-source comparison
  covers 335 compiler fixtures, 492 simulation sources and 99,192 final rules.
- Full recorded session verification uses four independent Node processes,
  partitioning the 492 fixtures by original index modulo four and calling the
  unchanged `createSessionOracle(...).compareFixture` for every fixture. No inputs,
  AGAIN observations, history/effects checks or final expectations are skipped.
  Replay logs are `/private/tmp/typescript-refresh-replay-{0,1,2,3}.log`.
- All four replay processes exit zero: 492 fixtures, 20,076 observations and
  candidate operations, and 539 level loads. Original fixture indices and titles
  were checked against the source corpus; repeated titles remain separate cases.
- All five runnable examples exit zero. The generated semantic export is current,
  and both working and staged diffs pass whitespace checks.

The primary checkout has since added a second cached-AGAIN commit, `fba2000a`.
Its Labs-specific RNG expectations must remain separate from the vanilla defaults
when integrating; this branch does not publish either cached-AGAIN commit.
