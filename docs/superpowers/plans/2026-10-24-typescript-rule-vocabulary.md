# Ordered Rule Vocabulary Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with TDD,
> followed by independent spec and quality reviews. Continue in the vanilla port
> worktree after the zero-step rule task.

**Goal:** Give the independent rule compiler the separate, ordered normalized
namespaces that vanilla actually uses, including property inference identities.

**Architecture:** Expose the resolver's existing normalized synonym, property and
aggregate maps as readable name data. Keep ordered member arrays and separate
namespaces even when malformed source reuses a name. Compute the single-layer
property classification directly from canonical object layer assignments.

**Tech Stack:** Strict TypeScript, ReadonlyMap and readonly string arrays, native
compiler dictionaries observed only by the existing test adapter.

## Files and public contract

- Modify `typescript/src/declaration-model.ts` to define `RuleVocabulary` and add
  `ResolvedDeclarations.ruleNames`.
- Modify `typescript/src/declarations.ts` to return this data after normalization.
- Extend `typescript/test/legacy-declaration-oracle.cjs` to compare the new data
  directly with the native dictionaries produced by `generateExtraMembers`.
- Extend `typescript/test/declarations.test.mjs` and
  `typescript/test/declaration-oracle.test.mjs` with ordered and corruption cases.

```ts
export interface RuleVocabulary {
  readonly synonyms: ReadonlyMap<string, string>;
  readonly properties: ReadonlyMap<string, readonly string[]>;
  readonly aggregates: ReadonlyMap<string, readonly string[]>;
  /** Presence means all members have the same layer, even if none is assigned. */
  readonly singleLayerProperties: ReadonlyMap<string, number | undefined>;
}
```

The strings here are language names, including unresolved recovered names, not
encoded object storage. Terms must retain property names even if two properties
have identical members: vanilla infers them independently. Do not derive this
data from `names`, `namedObjects`, `namedAggregates` or `soundTargets`; those have
different precedence, ordering or recovery contracts.

## Test-first sequence

- [x] Add a focused test that `ruleNames` exists and exposes object aliases,
  property aliases, aggregate aliases and duplicate member order. Run it and
  observe the missing-property failure.
- [x] Add the interface and return ordered copies of the resolver's final
  `synonymValues`, `propertyValues`, `aggregateValues`. Visit names with the
  existing `dictionaryIterationNames` helper. Member values must stay strings,
  including unresolved targets; do not filter them into canonical objects.
- [x] Add a single-layer classification test for properties sharing a layer,
  crossing layers, containing an unknown object, and containing only unlayered
  known objects. Native checks that every object exists and compares layer
  values; all-undefined layers still create a present key with undefined value.
- [x] Build `singleLayerProperties` from the final properties in dictionary order.
  Compare `objectLayers.get(concrete.get(name))` values without coercing missing
  assignments to layer zero. Do not classify an empty property.
- [x] Add direct native/candidate comparison fields to the existing declaration
  oracle: `Object.entries` for synonyms/properties/aggregates and
  `propertiesSingleLayer`. Candidate maps must compare entry order, member order,
  duplicates, and key presence separately from the value undefined.
- [x] Add focused namespace-collision, duplicate declaration, forward synonym and
  numeric-key fixtures. Existing regression fixtures are useful: `P=A or B;
  P=C`, object-name collisions, `One=Two;Two=Three;Three=A`, and numeric aliases
  `3=2;2=1;1=A`. They must expose all dictionaries independently of preferred names.
- [x] Add corruption checks that removing a colliding namespace, reversing
  property members, reversing dictionary entries, or dropping an undefined-layer
  classification key fails. Keep the existing canonical identity/provenance
  checks and JS-producer guards.
- [x] Run `npm run build`, then
  `node --test test/declarations.test.mjs test/declaration-oracle.test.mjs`, which
  also compares all 478 simulation sources. Run the full `npm test` after those
  pass. Do not rerun the standalone session corpus for this declaration-only task.
- [x] Obtain spec then quality review and commit the bounded implementation.

This is a prerequisite for source-rule inference, not a replacement for it.
No native source or oracle manifest changes are needed.

Implemented in `3788641e`. Strict build and all 690 package tests pass. Independent
spec and quality reviewers approved the implementation; the spec reviewer reran
all 79 declaration tests, including every simulation source, and the quality
reviewer reran 10 targeted vocabulary/oracle checks.
