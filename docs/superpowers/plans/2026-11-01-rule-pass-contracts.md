# Rule-pass qualifier contracts implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Parent owns lowering-oracle precondition coverage, independent review and final integration.

**Goal:** Make valid rule-stage guarantees statically usable and lowering exhaustive.

**Architecture:** Small finite qualifier unions parameterize existing plain
records. Movement success/diagnostic results share the current runtime schema.
Shape-preserving later passes retain the narrowed domain; no brands or new AST.

**Tech Stack:** Strict TypeScript, existing numeric enums and Node/native oracles.

## 1. Contract red (implementation agent)

- [ ] Create `typescript/test/rule-pass-types.test.mjs` with the strict temporary
  `.mts` pattern. Positive examples construct SourceQualifier, OrientedRule and
  MovementRule and run successful movement→property→spawn→duplicates→lowering.
  Negative clauses reject internal families as source qualifiers, relatives as
  oriented terms, movement families as MovementRule, broad orientation input to
  lowering and un-narrowed movement results. Watch the missing API fail first.
- [ ] Add semantic checks that success contains only atomic terms and invalid
  movement retains unresolved families for property diagnostics. Keep existing
  native movement/property/spawn visitation assertions; observe meaningful red
  for unsafe runtime family lowering or missing stage contract before changes.

## 2. Production types and transitions (implementation agent)

- [ ] In `source-rule-model.ts`, add the finite unions, generic term/cell/rows and
  DirectedNamedRule; make SourceQualifier RuleSyntax rows, distinct OrientedRule
  and MovementRule aliases, and discriminated movement result with the existing
  `abortsCompilation` field. Do not add runtime fields or assertions.
- [ ] Narrow `source-model.ts` authored qualifier values and `source-rules.ts`
  qualifier map/pending payload to SourceQualifier; project that type through
  `rule-syntax.ts` and early negative helpers in `rule-negatives.ts`.
- [ ] In `rule-orientations.ts`, return the oriented domain exhaustively without
  relative passthrough, preserving directions, reversals, extra rows and throws.
  Keep name/aggregate/synonym helpers typed to their actual oriented domain.
- [ ] In `rule-movements.ts`, type family/choice evidence, replace silent family
  fallback with exhaustive classification/lookup, retain the invalid output and
  prove successful outputs atomic without broad casts.
- [ ] In `rule-properties.ts`, preserve Q through the actual transforming helpers
  and result. In `rule-spawns.ts`, return Q|Stationary. In `rule-duplicates.ts`,
  preserve original record subtype while retaining native duplicate behavior.
- [ ] In `source-rule-compiler.ts`, branch before the common finishing helper,
  preserving all property/spawn visits before invalid return and syntax checks.
  Narrow expanded result and lowerSourceRules input to MovementRule.
- [ ] In `rule-lowering.ts`, require MovementRule and make movement lookup handle
  its actual qualifier domain exhaustively. Preserve all source diagnostics and
  compatibility behavior; unsupported stage qualifiers never silently no-op.
- [ ] Build, run focused contracts/stages/compiler sequencing checks, and report
  stable API/readiness. Do not edit native fixtures or parent lowering adapter;
  no commit or exhaustive gameplay replay.

## 3. Independent boundary coverage (parent)

- [ ] Add a candidate successful-movement precondition in
  `legacy-rule-lowering.cjs`; preserve its complete native comparison, schemas,
  corpus and artificial atomic stage-boundary fixtures.
- [ ] Add a regression proving invalid movement output cannot silently pass the
  standalone lowering adapter, while property/compiler invalid-continuation
  checks still run and retain native diagnostics.
- [ ] Inspect exact record schemas and compile without assertion-based escapes;
  review meaningful narrowing and correct preservation through later passes.

## 4. Verification and integration (parent)

- [ ] Request spec review, then correctness/readability review; resolve findings.
- [ ] Run complete strict suite and fresh bounded per-move sample. Update README,
  READABILITY, this audit and the broad completion checklist with actual results.
- [ ] Commit and integrate into clean local master; build and verify focused
  primary checks. Keep the overall goal active for the transformation/readability
  audit; preserve unrelated prepared-AGAIN runtime work.
