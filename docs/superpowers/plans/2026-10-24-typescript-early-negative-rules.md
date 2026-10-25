# Early Negative Rule Requirements Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with TDD,
> then independent spec and quality reviews. Begin after the object/layer lexical
> dependency is reviewed in the vanilla port worktree.

**Goal:** Express native's observable early negative-requirement normalization
using named terms, object sets and unnamed layer membership.

**Architecture:** A pure pass consumes recovered RuleSyntax records and returns
new records plus diagnostics. Preserve raw name distinctions, ordered deletions
and source identities. It runs before orientation/atomization and is required
for compatibility, including random candidate weighting and spawn intent.

**Tech Stack:** Strict TypeScript, readonly named terms, ordinary Set/Map values,
existing declaration namespaces and native test-only syntax/mask producers.

## Verified unlayered recovery dependency

Read-only probes found two native behaviors before the pass was committed:

- With Wall unlayered and Background the first raw layer assignment,
  `[Player]->[Wall no Background]` diagnoses a contradiction: the native lookup
  of Wall shares Background's effective requirement.
- With layers `Background, Wall`, `Player`, `Background` and Crate unlayered,
  `[Crate no Wall]->[Crate]` removes No Wall and warns with empty occupancy labels.
  Native counts the unlayered positive as covering layer zero but does not give
  that coverage a numeric diagnostic label.

Preserve these with ordinary domain data. Add an `ObjectLookup` interface to
`declaration-model.ts` containing `objects: ReadonlySet<GameObject>` and
`includesUnavailableObject: boolean`. Add `objectLookups` to ResolvedDeclarations
with separate `concrete: ReadonlyMap<GameObject, ObjectLookup>` and
`named: ReadonlyMap<string, ObjectLookup>` maps. Reuse the resolver's existing
lookupObject/unlayeredLookup/hasRawAssignments and namedObjects plus internal
missingLookupRequirements. An unavailable member means no canonical cell can
contain it; an OR lookup with other members is not itself necessarily impossible.
Raw concrete requirements remain independent from name-namespace overrides.

The early pass compares these explicit object sets/unavailable flags, retaining
the source-ordered named lookup for exclusions. Keep layer coverage in a Set
separate from warning labels, so unlayered positive recovery can cover zero without
inventing an occupier name. Check these new projections in the declaration oracle,
including overwritten first assignments, zero assignments and namespace collisions.
This dependency introduces no ids, slots, masks or packed representations.

## Files and API

- Create `typescript/src/rule-negatives.ts`:

```ts
export function checkEarlyNegativeTerms(
  rules: readonly RuleSyntax[],
  declarations: ResolvedDeclarations,
): {
  readonly rules: readonly RuleSyntax[];
  readonly diagnostics: readonly SourceDiagnostic[];
};
```

- Add `typescript/test/rule-negatives.test.mjs` and test-only
  `typescript/test/legacy-rule-negatives.cjs`.
- Use existing numeric RuleQualifier.No; no new runtime state or encoded masks.

## Native contract

For EACH rule, in this order:

1. Diagnose RHS positive-concrete-object / negative-name overlap. Recognize raw
   concrete names only on the positive side, even if the same name also exists
   in another namespace. Exclude aliases, properties and aggregates from positive
   occupancy here. Resolve negative membership through the source-ordered named
   object lookup. Do this before deleting any exclusions.
2. Remove RHS `no X` if the corresponding LHS cell contains the same RAW name
   qualified by No. This is one forward sweep: deleting a term skips the next
   shifted term. Preserve that ordered behavior, rather than filter/fixed-point.
3. Remove redundant LHS negatives whose possible layers are all occupied by
   disjoint positive requirements. Occupancy priority is single-layer property,
   concrete object, then aggregate; do not follow concrete synonyms here.
   Negative membership uses the source-ordered named-object lookup. Keep ordered
   occupancy labels for the native warning. LHS deletion DOES revisit the shifted
   position, unlike the RHS sweep.

No cells, rows, rules or directions are removed by this pass. Syntax already
decided whether each rule was directional; do not decide again afterward. Do not
move this cleanup after synonym substitution or into generic variant dedup.

## Test-first sequence

- [x] Observe a failing API/native-backed test before implementation.
- [x] Native oracle: parse actual native tuples, generate final native declaration
  members/masks, recover every non-null ordinary syntax rule with the native
  predecessor list, snapshot before/after `checkSuperfluousCoincidences`, and
  record only this pass's raw diagnostics. Native representations stay test-only.
  Candidate input comes from independent reader/resolver/syntax recovery, frozen;
  guard native producers during candidate work.
- [x] Test RHS contradictions before deletion and positive raw-name distinctions:
  `[Player]->[Player no Player]` diagnoses, while
  `[AliasPlayer]->[AliasPlayer no Player]` has no early contradiction from the
  alias. Property and aggregate positives are not broadened into this check.
- [x] Test adjacent RHS negatives:
  `[no Player no Crate]->[no Player no Crate]` leaves RHS `no Crate` after removing
  `no Player`. LHS redundant negatives must instead revisit shifted terms.
- [x] Test concrete/property/aggregate occupancy, disjointness, covered versus
  uncovered layers, duplicate occupancy labels, missing name masks and the
  same-name collision priority. Compare exact retained term order and warnings.
- [x] Add the verified random-weight precursor fixture with Player/Wall/Crate on
  one layer and board PP:

  ```text
  random horizontal [Player no Wall|Player no Crate]->message row
  + [Player]->message single
  ```

  Both LHS negatives disappear here. Replacing positive Player with the concrete
  synonym AliasPlayer retains them. Later dedup gives three versus four random
  candidates; this pass must preserve the different ordered named outputs now.
- [x] Add the verified spawn-intent precursor: same-layer Player/Crate/Wall,
  Other on another layer, conflicting `Player=Other`, rule
  `[Player no Wall]->[Crate]`. The early pass removes noWall before the synonym
  changes the positive object's layer. Later spawn-stationary inference must see
  that result. Do not substitute aliases prematurely to simplify this test.
- [x] Compare the pass for all 478 simulation sources, with exact named outputs,
  flags/groups/source identity/directions unchanged. Include deliberately broken
  candidates that remove alias exclusions, remove both adjacent RHS negatives,
  check contradictions after deletion, or mutate the input.
- [x] Run strict build, new focused tests and preceding syntax/declaration suites,
  then full npm test. No long gameplay replay or native source/hash changes.
  Report any concrete unlayered recovery mismatch before adding new declaration
  metadata; do not reintroduce packed representations to mimic it.
- [x] Obtain spec then quality approval and commit the bounded pass.

Next: emit orientation variants, resolve relative qualifiers, reverse permitted
Up/Left rows, then expand aggregates and substitute synonyms. The separate rule
vocabulary preserves the name and member order needed by that stage.

Reviewed implementation: `ba292d64`. Spec and quality reviews pass. Strict build
and all 958 package tests pass; the focused source/declaration/syntax/negative
suites pass 380 tests. All 478 native-backed source comparisons cover 16,754
captured tuples, 16,577 ordinary rules and 39 pass-only diagnostics. Quality review
also checked 1,500 deterministic boundary probes. Both verified unlayered recovery
cases are preserved using explicit object lookup data; native sources unchanged.
