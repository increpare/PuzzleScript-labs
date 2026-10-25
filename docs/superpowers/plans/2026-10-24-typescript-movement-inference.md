# Movement Inference Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with TDD,
> followed by spec and quality reviews. Begin after oriented name expansion is
> reviewed. Do not introduce runtime property bindings or packed representations.

**Goal:** Expand named movement families and infer RHS movements in native order.

**Architecture:** A pure pass over OrientedRule records uses an explicit ordered
work list. Each partial rule retains ordinary choice evidence while expanding;
the evidence is local to compilation and never reaches executable rules. Keep
duplicate paths until the later source-group deduplication pass.

**Tech Stack:** Strict TypeScript, numeric RuleQualifier enums, named terms,
arrays and ordinary inference records.

## Files and API

- Create `typescript/src/rule-movements.ts`:

  ```ts
  export function expandRuleMovements(rules: readonly OrientedRule[]): {
    readonly rules: readonly OrientedRule[];
    readonly diagnostics: readonly SourceDiagnostic[];
    readonly abortsCompilation: boolean;
  };
  ```

- Add `typescript/test/legacy-rule-movements.cjs` and
  `typescript/test/rule-movements.test.mjs`.
- Keep private movement-choice evidence descriptive: entity name, original
  family, selected qualifier and source row/cell. No positional tuple encodings,
  concatenated dictionary identities or runtime capture fields are needed.

## Native contract

Native `concretizeMovingRule` in `src/js/compiler.js` is the authority.

1. Process every input rule separately, preserving input order. Start its work
   list with that rule. For each pending partial variant, inspect EVERY LHS cell
   in row/cell order. In each eligible cell choose only its FIRST family term.
2. For each choice, append a child cloned from the same unchanged parent. Do not
   successively modify the parent while considering other cells. If any child
   was appended, remove that parent; otherwise retain it as a completed rule.
   Preserve the native work-list order, including duplicate paths. A generic
   Cartesian product or depth-first recursion gives different observable order.
3. In the chosen LHS cell replace ALL terms sharing that exact name and family.
   Also replace all matching terms in the corresponding RHS cell if present.
   Other entities/families/cells are unchanged at this step.
4. Ordered choices: Horizontal/HorizontalParallel/HorizontalPerpendicular are
   Left, Right; Vertical/VerticalParallel/VerticalPerpendicular are Up, Down;
   Orthogonal is Up, Down, Left, Right; Moving adds Action last. Keep inference
   identities distinct even when their concrete options coincide.
5. Retain each chosen entity/family's first selected qualifier and count of
   distinct expansion cells. Several matching terms in one cell are one event.
   For each family alone count ALL expansion events, including different entities
   in the same cell. Evidence is copied into each child; do not share mutable
   evidence between branches.
6. After expansion, first infer RHS entity/family pairs whose count is one,
   visiting pairs in first-encounter order. Then infer a family across remaining
   RHS entities only when that family has exactly one expansion event. Preserve
   local replacements from step3 even when global inference is ambiguous.
7. If any RHS family remains, diagnose the FIRST remaining family in the FIRST
   affected variant's row/cell/term order. Emit native's exact ambiguous movement
   error once per original input rule, set abortsCompilation true and retain its
   variants. Continue subsequent input rules, preserving their diagnostics/order.
   Do not silently discard invalid variants or infer by member-set equality.
   The final compiler still runs property and spawn inference before honoring
   this abort flag; native checks it after the whole expansion pipeline.
8. Return only ordinary OrientedRule records. Source/group/flags/commands and
   source evidence remain intact. No inference bookkeeping survives in outputs.

## Test-first sequence

- [x] Observe an API/native-backed failure before implementation.
- [x] Native oracle parses original source, runs the actual preceding declaration,
  syntax, negative, orientation and name stages, then snapshots rules and calls
  concretizeMovingRule per input. Capture ONLY movement-stage raw diagnostics
  and invalid state. Candidate independently runs the typed preceding stages and
  this pass. Freeze inputs and guard all native producers during candidate work.
- [x] Check all families, including separate parallel/perpendicular identities
  produced by every orientation, and Moving's Action option.
- [x] Check local RHS transport, unique same-entity inference elsewhere, unique
  family inference across entities, ambiguous repeated cells and repeated same
  terms in a cell. Distinct entities in one cell count separately for a family.
- [x] Check that equal chosen directions at multiple inference sites remain
  ambiguous globally; equality of values does not change occurrence counts.
- [x] Check exact intermediate duplicate order, not just final distinct results.
  After the LATER deduplication pass `[horizontal A|vertical B]` leaves
  Left/Up, Right/Up, Left/Down, Right/Down; the same two qualifiers in one cell
  leave Left/Up, Left/Down, Right/Up, Right/Down. This stage must first agree with
  native's complete duplicate-producing sequence that yields those results.
- [x] Check family terms on RHS only, first-error selection, multiple source
  rules, command-only RHS, late syntax suppression, property name strings,
  aggregate-appended order and duplicate member terms. No property inference yet.
- [x] Add corruptions that use a Cartesian product, merge family identities,
  infer multiple sites with equal chosen values, reorder work, mutate input,
  leak private inference fields or call a native producer; each must be rejected.
- [x] Compare all 478 simulation sources with exact input/output order, counts,
  raw diagnostics, invalid state and provenance identities. Report unexpected
  native malformed-shape exceptions before broadening recovery types.
- [x] Run strict build, focused preceding-stage/new tests and full npm test.
  Native production files/hashes and the long gameplay replay remain untouched.
- [x] Obtain spec then quality approval and commit the bounded pass.

Next: property expansion/inference, then spawn-stationary inference and semantic
deduplication. Object member choice order and repeated equal variants remain
visible until those later stages finish.

Reviewed implementation: `8df7a91e`. Spec and quality reviews pass. Strict build
and all 1,072 package tests pass; the movement suite passes 64 tests and the
preceding-stage suite passes 401. All 478 source fixtures compare 16,577 syntax
rules, 25,985 named inputs and 30,005 ordered movement variants exactly, with
zero movement diagnostics or aborts. Source/command/origin identities and the
stage-local abort boundary remain checked. Native production files are unchanged.
