# Property and Spawn Intent Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with TDD,
> then spec and quality reviews. Begin after movement inference is reviewed.

**Goal:** Expand/infer property names and infer stationary intent for new objects.

**Architecture:** Pure passes retain ordered OrientedRule terms. Properties remain
named alternatives when local use on one collision layer needs no disambiguation;
otherwise emit concrete variants. Spawn inference follows, before deduplication
or lowering. Runtime captures and inferred sinks are not part of vanilla semantics.

**Tech Stack:** Strict TypeScript, ordered rule records, numeric qualifiers,
declaration vocabulary and canonical unnamed-layer membership.

## Files and API

- Create `typescript/src/rule-properties.ts`:

  ```ts
  export function expandRuleProperties(
    rules: readonly OrientedRule[],
    declarations: ResolvedDeclarations,
  ): { readonly rules: readonly OrientedRule[]; readonly diagnostics: readonly SourceDiagnostic[] };
  ```

- Create `typescript/src/rule-spawns.ts`:

  ```ts
  export function inferSpawnedStationary(
    rules: readonly OrientedRule[],
    declarations: ResolvedDeclarations,
  ): readonly OrientedRule[];
  ```

- Add `typescript/test/legacy-rule-properties.cjs` and
  `typescript/test/rule-properties.test.mjs`.

## Property contract

Native `concretizePropertyRule` and its named helpers are the authority.

1. Expand `No P` into No terms for EVERY member in property dictionary order,
   preserving duplicates and origins. Visit every LHS cell and corresponding RHS
   cell when RHS exists. This transformation precedes property transport analysis.
2. A property's identity is its raw name, including promoted aliases with equal
   members. RandomObject terms do not participate in property occurrence lookup
   or property substitution. Other qualifiers do participate.
3. Mark a property transported if any participating RHS occurrence lacks that
   same property name in its corresponding LHS cell. Such a property must expand
   at ALL participating LHS cells. A present singleLayerProperties key allows
   other properties to remain as named predicates, including a key with undefined
   layer under malformed declaration recovery. Multi-layer properties expand even
   for local `[P]->[P]` use.
4. Start an ordered work list per input rule. In each partial variant select the
   FIRST eligible property in the FIRST eligible LHS cell, skipping retained
   single-layer properties. Emit one child per ordered member, replacing every
   participating occurrence of that property in the selected LHS cell and its
   corresponding RHS cell. Remove the parent; preserve duplicates and work order.
   Unlike movement expansion, choose only ONE cell per parent step.
5. Retain the first chosen member and count expanded cells for each property
   name. One cell with several matching terms is one choice event. If that name
   expanded exactly once, substitute it throughout remaining participating RHS
   terms. Distinct aliases remain distinct inference names.
6. After all variants, find remaining RHS properties marked transported. Native
   remembers the LAST such name in variant/row/cell/term order, emits one exact
   ambiguity error for this input rule and returns NO variants for it. Continue
   later input rules. This is not the movement pass's invalid-state behavior.
7. Empty properties can yield no branches; `No` of an empty property disappears.
   Do not invent members, merge duplicates or infer from equal chosen values.
   Preserve source/group/flags/commands/evidence and do not retain choice metadata.

## Spawn contract

Native `makeSpawnedObjectsStationary` and `getPossibleObjectsFromCell` are the
authority. Skip late rules. For every RHS cell, collect possible concrete LHS
objects from its corresponding cell: raw concrete names first, otherwise property
members. Include ALL qualifiers, including negative terms, and skip unknown
concrete members. Use actual object layers, including undefined recovery values.

Only an Unspecified RHS qualifier is eligible. Leave property names unchanged;
leave a concrete name already among possible LHS objects unchanged. If its actual
layer occurs among the possible LHS layers, also leave it unchanged. Otherwise
set its qualifier to Stationary. Other qualifiers and unknown names are untouched.
Keep source evidence when changing a qualifier. Do not assume a negative term
cannot affect spawn intent, or replace actual object identity with named lookup
fallbacks from the earlier negative pass.

## Test-first sequence

- [x] Observe missing API/native-backed tests fail before implementation.
- [x] Native oracle independently parses source and runs all preceding native
  stages through movement expansion. Snapshot before/after property inference,
  capture ONLY its raw diagnostics, then snapshot after native spawn inference.
  Candidate runs typed preceding passes independently under native producer guards.
  Freeze inputs and compare exact ordered records and provenance at every boundary.
- [x] Cover single-layer retention versus multi-layer expansion, local and
  transported properties, duplicate members, distinct equal-member aliases,
  multiple terms in one cell and several property names in a cell.
- [x] Multi-layer `[P|P]->[P|P]` must yield AA, AB, BA, BB. Coexisting members
  remain separate variants; do not capture just the first matching member.
- [x] One expanded cell permits remote RHS inference; multiple cells plus an
  unmatched RHS occurrence diagnose and remove all variants, even if some selected
  members coincide. Check LAST ambiguous name selection and later input rules.
- [x] Cover No expansion, empty property recovery, RandomObject preservation,
  movement-family choices already resolved, aggregate-appended order and late rules.
- [x] Cover spawn qualifier distinctions, concrete-versus-property name priority,
  possible layers contributed by negative terms, different-layer/new-layer spawns,
  unknown/unlayered names and unchanged explicit movement/Stationary qualifiers.
- [x] Run the full conflicting-alias spawn precursor: Player/Crate/Wall on one
  layer, Other elsewhere, `Player=Other`, `[Player no Wall]->[Crate]`.
  Early negatives must disappear before name substitution; Crate then becomes
  Stationary. Compare the complete ordered typed pipeline with native.
- [x] Corruptions must detect first-member capture, cross-alias inference,
  duplicate collapse, wrong work order, first-versus-last diagnostic selection,
  ignoring negative LHS layers, runtime-binding leakage, mutation and native calls.
- [x] Compare all 478 simulation sources, with exact variant counts/order,
  property diagnostics and spawn qualifiers. Report new malformed shape crashes
  before changing recovery types. Keep cycle probes in bounded child processes.
- [x] Strict build, focused preceding/new suites, full npm test, whitespace check.
  No native source/hash changes or long gameplay replay rerun at this stage.
- [x] Obtain spec then quality approval and commit the bounded stage.

Next: semantic duplicate normalization, validation/lowering into direct runtime
predicates/edits, then surviving groups, rigid ownership and loop maps.

## Reviewed checkpoint

Implementation `4eafc126` passed independent spec and quality reviews. Strict
noEmit and all 71 property/spawn tests passed in each review, including all 478
source fixtures and 106,273 ordered variants. The complete package passed
1,143 tests. Genuine empty-property and invalid cross-kind recovery boundaries
are documented in `typescript/test/repros/rule-properties-recovery-report.txt`;
the RHS-only empty-property test verifies removal in this pass rather than
counting LHS cleanup performed earlier. Production JavaScript and oracle hashes
remain unchanged.
