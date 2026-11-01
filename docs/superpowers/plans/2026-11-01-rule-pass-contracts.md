# Rule-pass qualifier contracts implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Parent owns lowering-oracle precondition coverage, independent review and final integration.

**Goal:** Make valid rule-stage guarantees statically usable and lowering exhaustive.

**Architecture:** Small finite qualifier unions parameterize existing plain
records. Movement success/diagnostic results share the current runtime schema.
Shape-preserving later passes retain the narrowed domain; no brands or new AST.

**Tech Stack:** Strict TypeScript, existing numeric enums and Node/native oracles.

## 1. Contract red (implementation agent)

- [x] Create `typescript/test/rule-pass-types.test.mjs` with the strict temporary
  `.mts` pattern. Positive examples construct SourceQualifier, OrientedRule and
  MovementRule and run successful movement→property→spawn→duplicates→lowering.
  Negative clauses reject internal families as source qualifiers, relatives as
  oriented terms, movement families as MovementRule, broad orientation input to
  lowering and un-narrowed movement results. Watch the missing API fail first.
- [x] Add semantic checks that success contains only atomic terms and invalid
  movement retains unresolved families for property diagnostics. Keep existing
  native movement/property/spawn visitation assertions; observe meaningful red
  for unsafe runtime family lowering or missing stage contract before changes.

## 2. Production types and transitions (implementation agent)

- [x] In `source-rule-model.ts`, add the finite unions, generic term/cell/rows and
  DirectedNamedRule; make SourceQualifier RuleSyntax rows, distinct OrientedRule
  and MovementRule aliases, and discriminated movement result with the existing
  `abortsCompilation` field. Do not add runtime fields or assertions.
- [x] Narrow `source-model.ts` authored qualifier values and `source-rules.ts`
  qualifier map/pending payload to SourceQualifier; project that type through
  `rule-syntax.ts` and early negative helpers in `rule-negatives.ts`.
- [x] In `rule-orientations.ts`, return the oriented domain exhaustively without
  relative passthrough, preserving directions, reversals, extra rows and throws.
  Keep name/aggregate/synonym helpers typed to their actual oriented domain.
- [x] In `rule-movements.ts`, type family/choice evidence, replace silent family
  fallback with exhaustive classification/lookup, retain the invalid output and
  prove successful outputs atomic without broad casts.
- [x] In `rule-properties.ts`, preserve Q through the actual transforming helpers
  and result. In `rule-spawns.ts`, return Q|Stationary. In `rule-duplicates.ts`,
  preserve original record subtype while retaining native duplicate behavior.
- [x] In `source-rule-compiler.ts`, branch before the common finishing helper,
  preserving all property/spawn visits before invalid return and syntax checks.
  Narrow expanded result and lowerSourceRules input to MovementRule.
- [x] In `rule-lowering.ts`, require MovementRule and make movement lookup handle
  its actual qualifier domain exhaustively. Preserve all source diagnostics and
  compatibility behavior; unsupported stage qualifiers never silently no-op.
- [x] Build, run focused contracts/stages/compiler sequencing checks, and report
  stable API/readiness. Do not edit native fixtures or parent lowering adapter;
  no commit or exhaustive gameplay replay.

## 3. Independent boundary coverage (parent)

- [x] Add a candidate successful-movement precondition in
  `legacy-rule-lowering.cjs`; preserve its complete native comparison, schemas,
  corpus and artificial atomic stage-boundary fixtures.
- [x] Add a regression proving invalid movement output cannot silently pass the
  standalone lowering adapter, while property/compiler invalid-continuation
  checks still run and retain native diagnostics.
- [x] Inspect exact record schemas and compile without assertion-based escapes;
  review meaningful narrowing and correct preservation through later passes.

## 4. Verification and integration (parent)

- [x] Request spec review, then correctness/readability review; resolve findings.
- [x] Run complete strict suite and fresh bounded per-move sample. Update README,
  READABILITY, this audit and the broad completion checklist with actual results.
- [x] Commit and integrate into clean local master; build and verify focused
  primary checks. Keep the overall goal active for the transformation/readability
  audit; preserve unrelated prepared-AGAIN runtime work.
  Integrated as `d245dcac`; primary build and all eight integration checks passed.

## Verification audit

- New missing-API and unsupported-runtime-qualifier regressions failed first:
  `/private/tmp/ps-rule-pass-contracts-red.log`.
- Strict tests exposed a nested variance hole: plain readonly aliases rejected
  individual term narrowing but accepted broader cells, rows and directed rules.
  Explicit covariant readonly interfaces reject all four, without runtime data.
  Red: `/private/tmp/ps-rule-pass-variance-red.log`; isolated reproduction:
  `/private/tmp/ps-rule-pass-variance-repro.mjs`. Parent independently reproduced
  before/after behavior with the installed compiler in a separate small module.
- Standalone lower-oracle precondition failed for the expected missing exception,
  then passed: `/private/tmp/ps-rule-pass-lowering-precondition-red.log` and
  corresponding `-green.log`. Its property/spawn visits and all existing native
  comparisons and artificial atomic boundaries remain intact.
- Focused stages/contracts: **605 passed**, no failures;
  `/private/tmp/ps-rule-pass-focused.log`. Parent independently passed the six new
  type/runtime contract tests.
- Final full strict suite: **2,062 passed**, no failures; log:
  `/private/tmp/ps-rule-pass-contracts-full.log`.
- Fresh bounded differential sample: **128 games**, **895 observations and
  operations**, **128 loads**, with no exclusions, mismatches, exceptions or
  timeouts. Seed: `rule-pass-contracts-2026-11-01`; report:
  `/private/tmp/ps-rule-pass-contracts-campaign.json`.
- Spec and quality reviews approved. Additional probes reject broad qualifiers
  through mapped/spread/rebuilt arrays, singleton families and complete nested
  property/spawn/duplicate/lowering calls. Native tests retain the syntax and
  movement→property→spawn checkpoint order and source/term identity.
- No native producer/projection or runtime record schema changed. No whole-array
  assertion, fake name-resolution stage or silent movement fallback remains in
  this slice. No exhaustive gameplay replay or server was started. The overall
  goal remains active for transformation and final readability audits.
