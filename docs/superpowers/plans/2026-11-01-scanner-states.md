# Explicit scanner states implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for implementation and two-stage review. The parent owns independent oracle characterization and integration.

**Goal:** Make each scanner transition express its PuzzleScript grammar concept.

**Architecture:** A small numeric-discriminated state vocabulary accompanies the
existing direct token readers. Explicit heading descriptors replace ordinal
section lookup. Native visit timing remains the behavior authority.

**Tech Stack:** Strict TypeScript, Node test runner, pinned vanilla parser oracle.

## 1. Native characterization (parent)

- [x] Add `typescript/test/scanner-states.test.mjs`, using
  `createSourceParserOracle({...sourceTypes, ...parser})` and `compareFixture`.
  Cover metadata comment tails, midline heading consumption, legend comment
  phase preservation, rule separator phases, rule/level messages, unmatched
  closes, incomplete sound events, sound failed recovery, LEVELS separators,
  comment-only grid boundaries, revisited sections and error/issue caps.
- [x] Run the characterization before production edits:
  `node --test typescript/test/scanner-states.test.mjs`.
  These are preservation tests; retain explicit native registrations/event and
  message checks so both empty outputs cannot accidentally satisfy the cases.

## 2. Typed scanner implementation (implementation agent)

- [x] Add `typescript/test/source-scan-state-types.test.mjs` following the existing
  temporary `.mts`/strict `tsc` pattern. Import the missing state vocabulary,
  construct real valid section states, and use `@ts-expect-error` to reject a
  rule section with an object phase and a sound seed state without its event.
  Confirm the test fails for the missing API before writing production code.
- [x] Create `typescript/src/source-scan-state.ts` with the phase enums and
  `SourceScanState` section union described in the design. Example contract:
  `const rules: SourceScanState = { section: SourceSectionKind.Rules,
  phase: RulePhase.Prelude };`. Sound payloads are a separate discriminated
  union; there is no optional universal payload bag.
- [x] Replace `tokenIndex`, `ObjectPart`, `SoundRole`, sounds-history length
  checks and `soundFailed` in `typescript/src/source-lexical.ts`. Direct switches
  spell out phase transitions; no modulo arithmetic, broad type casts, generic
  transition framework, numeric phase compatibility adapter or dead counters.
- [x] Name physical-line initialization, logical comment resumption and native
  line finalization explicitly. Preserve mutation/diagnostic/cap timing.
- [x] Declare explicit section descriptors in the new module. Use them in the
  scanner and `typescript/src/source-reader.ts`; remove the reader's duplicate
  name mapping and section-enum arithmetic. Keep public `sourceSectionNames`
  compatibility only if needed, derived from the descriptors.
- [x] Build and run the new type test plus focused source-reader/parser,
  accepted-declaration, legend and Unicode tests; report results, no commit.

## 3. Review and integration (parent)

- [x] Review the production diff against every state transition and design
  requirement. Request spec review, then code-quality review, and resolve both.
- [x] Run `npm --prefix typescript test` and a bounded generated per-move sample
  using a new seed. Do not restart exhaustive runtime replay.
- [x] Update README, READABILITY and the full frontend completion checklist with
  actual results. Keep the broad goal active; sounds/wins and rule pass contracts
  remain separate required work.
- [ ] `git diff --check`, commit this checkpoint and fast-forward local master
  only while primary is clean and still on the known base. Build and run a
  focused integration smoke check. Do not publish unrelated local commits.

## Verification audit

- Before production edits, all 32 native preservation cases passed:
  `/private/tmp/ps-scanner-states-before.log`.
- The new type contract first failed for the missing state vocabulary:
  `/private/tmp/puzzlescript-scan-types-red.log`.
- Self-review found the leading-unmatched-close win initialization seam. The
  independent new case failed, then passed after preserving native's Subject
  recovery phase: `/private/tmp/ps-scanner-leading-close-red.log`.
- Final focused run: 34 passed (33 native cases and the type contract).
- Final complete strict suite: **1,998 passed**, no failures, including the
  unchanged original parser/compiler corpus. Log:
  `/private/tmp/ps-scanner-states-final-full.log`.
- Final generated differential sample: **128 games**, **939 observations and
  operations**, **128 loads**; no exclusions, mismatches, exceptions or timeouts.
  Seed: `scanner-states-final-2026-11-01`; report:
  `/private/tmp/ps-scanner-states-final-campaign.json`.
- Spec review, then correctness/readability review approved. Quality review also
  compared 70 sources in both stop modes against the prior scanner: all 140
  outputs matched, including registrations, retained maps and stopping behavior.
  One malformed source threw in both versions and the pinned native parser.
- Native probes for the next sound/win boundary found four existing TypeScript
  differences with zero native parser errors: `sfx0 sounds 123`,
  `Player move rules 123`, `all Player (c) on Crate` and
  `(c)all Player on Crate`. Probes and full reproducing sources are saved in
  `/private/tmp/ps-sound-win-baseline-probes.json`; they are port differences,
  not reports of new vanilla bugs. They remain for the next syntax refactor.
- No native oracle producer or comparison changed. No exhaustive gameplay replay
  or server was started. The broader frontend goal remains active.
