# Authoritative sound and win syntax implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development, with parent-owned independent oracle tests and two-stage review.

**Goal:** Compile sounds and wins from their single accepted typed interpretation.

**Architecture:** Source visits produce typed recovered definitions; the reader
binds exact tokens to authored identities; the compiler resolves domain objects
without interpreting word arrays. Raw source remains evidence.

**Tech Stack:** Strict TypeScript, numeric unions/enums, Node tests and pinned
vanilla source/compiler oracles.

## 1. Red native evidence (parent)

- [ ] Add `typescript/test/sound-win-syntax-oracle.test.mjs` using the existing
  `createGameDataOracle` and canonical types. Four tests call
  `oracle.compareFixture({name,source})` for the examples in the design.
- [ ] Run `node --test typescript/test/sound-win-syntax-oracle.test.mjs` before
  production edits, and save the four actual compiled-data assertion failures.

## 2. Single syntax construction (implementation agent)

- [ ] Write `typescript/test/sound-win-syntax.test.mjs` with raw-read-forbidden
  compiler calls and tree replacement checks. Follow the `forbidRead` pattern in
  `rule-frontend.test.mjs`: block each entry's words and document source, then
  call compileSounds/compileWinConditions. Watch the current compiler fail.
- [ ] Write a strict temporary `.mts` contract test importing the new definition
  types. Reject missing complete event seed, missing object target, reading SFX
  index on a simple event, and reading Named target name on Everywhere. Watch it
  fail for the missing API before adding production modules.
- [ ] Add small sound and win syntax/model modules with the exact numeric
  discriminated shapes and required evidence described in the design. Example:
  a Named win target requires its lexical token; Everywhere has no token field.
  A recovered sound seed names its last accepted term explicitly.
- [ ] Enrich `source-scan-state.ts` sound phases to carry partial typed syntax.
  Modify `source-lexical.ts` to retain actual sound definitions and actual native
  win captures at their source visits. Remove redundant event-only result data
  and derive rule sound vocabulary from the retained definition stream.
- [ ] Replace `SourceSound` and `SourceWinCondition` pseudo-semantic shapes in
  `source-model.ts` with authored evidence plus required recovered definitions.
  In `source-reader.ts`, bind these definitions once, remove `readSound` and
  `readWinCondition` raw grammar and migrate helper evidence as needed.
- [ ] In `source-game-data.ts`, switch over typed recovered definitions. Remove
  leadingSoundEvent, raw sound word/verb/direction regex acceptance, word-count
  win inference and duplicate parser checks. Preserve domain diagnostics,
  canonical identity, seed spelling, expansion order and checkpoint timing.
- [ ] Migrate existing model-facing tests, retaining every meaningful provenance,
  native timing and source-evidence assertion. Do not edit native adapters or
  comparisons. Build and run focused syntax, reader/parser, scanner, game-data,
  source-compiler and sound-vocabulary tests. No commit; report to parent.

## 3. Verification and integration (parent)

- [ ] Independently review the changed data flow and new native evidence. Request
  spec review first, then correctness/readability review; resolve findings.
- [ ] Run the complete strict suite and bounded generated per-move sample with a
  fresh seed. Keep native producers/comparisons unchanged; no exhaustive replay.
- [ ] Update README, READABILITY, this audit and the broad completion checklist
  with actual evidence. Do not mark the overall goal complete.
- [ ] Commit and fast-forward clean local master, then build and run focused
  integration checks. Preserve unrelated local work; do not push it.
