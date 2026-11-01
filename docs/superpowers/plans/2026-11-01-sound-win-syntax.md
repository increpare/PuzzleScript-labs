# Authoritative sound and win syntax implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development, with parent-owned independent oracle tests and two-stage review.

**Goal:** Compile sounds and wins from their single accepted typed interpretation.

**Architecture:** Source visits produce typed recovered definitions; the reader
binds exact tokens to authored identities; the compiler resolves domain objects
without interpreting word arrays. Raw source remains evidence.

**Tech Stack:** Strict TypeScript, numeric unions/enums, Node tests and pinned
vanilla source/compiler oracles.

## 1. Red native evidence (parent)

- [x] Add `typescript/test/sound-win-syntax-oracle.test.mjs` using the existing
  `createGameDataOracle` and canonical types. Four tests call
  `oracle.compareFixture({name,source})` for the examples in the design.
- [x] Run `node --test typescript/test/sound-win-syntax-oracle.test.mjs` before
  production edits, and save the four actual compiled-data assertion failures.

## 2. Single syntax construction (implementation agent)

- [x] Write `typescript/test/sound-win-syntax.test.mjs` with raw-read-forbidden
  compiler calls and tree replacement checks. Follow the `forbidRead` pattern in
  `rule-frontend.test.mjs`: block each entry's words and document source, then
  call compileSounds/compileWinConditions. Watch the current compiler fail.
- [x] Write a strict temporary `.mts` contract test importing the new definition
  types. Reject missing complete event seed, missing object target, reading SFX
  index on a simple event, and reading Named target name on Everywhere. Watch it
  fail for the missing API before adding production modules.
- [x] Add small sound and win syntax/model modules with the exact numeric
  discriminated shapes and required evidence described in the design. Example:
  a Named win target requires its lexical token; Everywhere has no token field.
  A recovered sound seed names its last accepted term explicitly.
- [x] Enrich `source-scan-state.ts` sound phases to carry partial typed syntax.
  Modify `source-lexical.ts` to retain actual sound definitions and actual native
  win captures at their source visits. Remove redundant event-only result data
  and derive rule sound vocabulary from the retained definition stream.
- [x] Replace `SourceSound` and `SourceWinCondition` pseudo-semantic shapes in
  `source-model.ts` with authored evidence plus required recovered definitions.
  In `source-reader.ts`, bind these definitions once, remove `readSound` and
  `readWinCondition` raw grammar and migrate helper evidence as needed.
- [x] In `source-game-data.ts`, switch over typed recovered definitions. Remove
  leadingSoundEvent, raw sound word/verb/direction regex acceptance, word-count
  win inference and duplicate parser checks. Preserve domain diagnostics,
  canonical identity, seed spelling, expansion order and checkpoint timing.
- [x] Migrate existing model-facing tests, retaining every meaningful provenance,
  native timing and source-evidence assertion. Do not edit native adapters or
  comparisons. Build and run focused syntax, reader/parser, scanner, game-data,
  source-compiler and sound-vocabulary tests. No commit; report to parent.

## 3. Verification and integration (parent)

- [x] Independently review the changed data flow and new native evidence. Request
  spec review first, then correctness/readability review; resolve findings.
- [x] Run the complete strict suite and bounded generated per-move sample with a
  fresh seed. Keep native producers/comparisons unchanged; no exhaustive replay.
- [x] Update README, READABILITY, this audit and the broad completion checklist
  with actual evidence. Do not mark the overall goal complete.
- [x] Commit and fast-forward clean local master, then build and run focused
  integration checks. Preserve unrelated local work; do not push it.
  Integrated as `98a79dd3`; primary build and all 48 integration tests passed.

## Verification audit

- The original four error-free native examples failed in the independent game
  data oracle before production edits:
  `/private/tmp/ps-sound-win-syntax-native-red.log`.
- Expanded baseline: 15 sources checked through both game-data and complete
  compilation oracles, **14 failed / 16 passed**, exposing seven port differences:
  `/private/tmp/ps-sound-win-syntax-all-stages-red.log`.
- Boundary red: all four raw-read/tree-mutation tests failed as expected:
  `/private/tmp/ps-sound-win-syntax-boundary-red.log`. The missing type API also
  failed before production code: `/private/tmp/ps-sound-win-syntax-types-red.log`.
- Quality review found a further ownership gap: `) sounds sfx0 123` and
  `) rules Player move 123` retained scanner definitions which authored heading
  classification discarded. All four new data/full-compiler assertions failed:
  `/private/tmp/ps-sound-win-reader-heading-red.log`. Both heading checks now
  require existing logical-SOL evidence, including the comment-context check.
  Capped walks still preserve later raw source entries with null definitions.
- Final native file: **34 passed**, including all nine constructed port
  differences at both game-data and complete compiler boundaries. These are
  TypeScript differences; no upstream bug report is inferred from them.
- Final focused run: **272 passed**, with original corpus cases excluded from
  that short run; log `/private/tmp/ps-sound-win-heading-ownership-green.log`.
  Separate migrated affected suites passed all **230 tests**, including their
  embedded original source comparisons.
- Final complete strict suite: **2,045 passed**, no failures, covering all
  original parser/compiler sources and executable rules. Log:
  `/private/tmp/ps-sound-win-syntax-final-full.log`.
- Final bounded sample: **128 games**, **880 observations and operations**,
  **128 loads**; no exclusions, mismatches, exceptions or timeouts. Seed:
  `accepted-sound-win-final-2026-11-01`; report:
  `/private/tmp/ps-sound-win-syntax-final-campaign.json`.
- Spec review approved. Quality review approved after the ownership fix, checking
  122 focused tests and 64 further native comment/SOL/heading comparisons. Exact
  target/verb/direction/seed token identity and expanding Unicode spans are tested.
- Native source, producers, adapters and comparisons remain unchanged. Reader-only
  sound/win diagnostic guesses were removed; actual native diagnostic visits and
  compiler checkpoints remain covered. No exhaustive gameplay replay or server
  was started. The broader frontend goal remains active.
