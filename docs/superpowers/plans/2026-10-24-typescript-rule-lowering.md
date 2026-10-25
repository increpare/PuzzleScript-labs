# Direct Rule Lowering Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with TDD,
> followed by spec and quality reviews. Begin after runtime surface cleanup and
> semantic duplicate normalization are reviewed. Parent handles review dispatch.

**Goal:** Compile named variants into ordinary cell conditions and transactions,
preserving native validation and survivor order without packed representations.

**Architecture:** Walk source rules, rows, cells and terms in native order. Build
sets of objects and explicit layer movement requests. Keep an overlapping-layer
conflict beside the lowered rule until the subsequent group formation pass;
native validates the rest of such a rule before dropping it from its group.

**Tech Stack:** Strict TypeScript, canonical GameObject identities, unnamed layer
indices, numeric qualifiers, CellPattern and CellEdits.

## Files and API

Create `typescript/src/rule-lowering.ts`, exporting these ordinary records:

```ts
export interface LoweredRule {
  readonly namedRule: OrientedRule;
  readonly executable: ExecutableRule;
  readonly overlap: readonly [string, string] | null;
}
export function lowerRules(
  rules: readonly OrientedRule[], declarations: ResolvedDeclarations,
): { readonly rules: readonly LoweredRule[]; readonly diagnostics: readonly SourceDiagnostic[] };
```

The executable's rigidGroup is initially null; subsequent surviving schedule
formation assigns actual early group indices. It retains source line, direction,
ordered rows, replacements and original command identities. hasReplacements is
the original RHS row count being nonzero, even if every cell replacement is null.
No runtime choice/capture metadata or obsolete named directions are introduced.

Add `typescript/test/legacy-rule-lowering.cjs` and
`typescript/test/rule-lowering.test.mjs`. The test-only native host independently
parses source, runs all preceding native passes including duplicate removal,
captures raw lowering diagnostics and invokes actual rulesToMask. Decode every
semantic predicate/replacement field and retain unknown-field rejection. The
candidate runs typed preceding passes with native producers disabled. Share ONE
canonical declaration result through all candidate stages.

## LHS conditions and validation

Native rulesToMask is the authority. Do not replace its sequential validation
with an unordered validation sweep.

- A raw concrete name has priority for layer selection, using its actual layer
  or recovery layer zero. Its object condition uses the FINAL named object lookup,
  which may differ after a conflicting legend declaration. A retained property
  uses its known single-layer entry and an anyObjects set. Missing layer reports
  the exact native error and skips that term. Do not reuse early-negative raw
  object lookup classification blindly.
- No adds every named member to forbiddenObjects without occupying a layer.
  Every other ordinary positive occupies a layer, including repeated aliases of
  the same object. A collision records the LAST ordered uppercase name pair as
  overlap. It does not remove the rule at this point.
- Stationary forbids all five movements. Cardinal/Action qualifiers require the
  corresponding movement. LHS RandomDirection preserves the native Up-and-Left
  conjunction; RandomObject reports an error and otherwise contributes nothing.
- Ellipsis is recognized by qualifier. A mixed LHS ellipsis cell reports and
  immediately removes the entire rule, skipping later validation. A lone edge
  ellipsis reports but removes the rule only after all its cells are processed.
  A lone inner ellipsis becomes Ellipsis and checks its corresponding RHS shape.
- Required/forbidden object intersection reports the exact ordered uppercase
  overlap warning, then immediately removes the rule. Order names by canonical
  native object choice order. Do not continue later cells or RHS diagnostics.
- Preserve source evidence and keep exact diagnostic ordering, severity and
  countsAsError. Raw and final object lookups include the reviewed orphan identity
  where malformed declarations require it; do not collapse it into a same-name
  current object or a never-match condition.

## RHS transactions

- Validate unmatched/mixed RHS ellipsis in native order, then stop RHS terms at
  the first ellipsis qualifier. Concrete positives add the RAW concrete object's
  lookup requirement and vacate its actual layer. No clears FINAL named lookup
  members. Retained properties preserve objects and can edit layer intent.
- Every explicit positive qualifier resets that layer's intent; Stationary also
  clears all five movements, RandomDirection records a direction draw, and an
  ordinary movement adds that request. Unspecified retains intent unless later
  concrete-layer or occupancy clearing resets it.
- Track deterministic RHS occupants separately from random candidates. Preserve
  native conflicts, suppression when overlap is already present, and ordered
  random-versus-deterministic warnings. Do not silently discard conflicting writes.
- Union RandomObject named candidates, deduplicate by object identity, and return
  them in declarations.objectChoiceOrder. Diagnose unknown names, singleton
  warnings and layer conflict warnings exactly. Runtime singleton entity draws
  remain required. A random candidate's layer is dynamic, follows
  getObjectIntentLayer for an orphan, and does not extend static rigidLayers.
  An ordinary concrete unlayered RHS still uses recovery layer zero.
- When any required LHS object is not included in RHS additions, clear ALL LHS
  required objects; additions still win. Apply the same whole-required-set rule
  for movement clearing. Express these as sets and ordinary membership tests.
- A positive LHS layer with no positive deterministic RHS occupant is vacated
  and its movement reset. Concrete LHS layers absent from concrete RHS layers
  also reset intent, even if a retained RHS property occupies the layer.
- rigidLayers equals the complete set of these statically reset layers, including
  explicit qualifiers. A replacement is null only if all seven native semantic
  edit categories are empty. Retain removal/reset fields even when additions make
  a transaction appear ineffective; runtime changed flags handle actual state.

Use vacateLayers for whole-layer deletion. The independent comparison must expand
those layers into concrete removal sets in its TEST-ONLY projection before
comparing native objectsClear, rather than forcing the candidate to spell every
vacated layer as a hidden representation. Compare movement collections by their
set meaning and also verify canonical order at public boundaries.

## Test-first sequence

- [x] Add a missing-API native-backed test and observe it fail before implementing.
- [x] Compare basic creation/removal, No, retained single-layer Any, Stationary,
  Action, randomdir and random objects, exact transaction/reset/rigid fields,
  command-only rules and hasReplacements with null actual replacements.
- [x] Cover explicit versus preserved movement, omitted LHS layers, properties
  versus concrete layer tracking, whole-required-set clearing, same-layer
  conflicting additions, repeated positives, suppression after earlier conflicts,
  singleton draws and sorted distinct random candidates.
- [x] Cover native diagnostic order and deletion timing with mixed/edge/mismatched
  ellipses, LHS contradictions, last overlap labels, RHS conflicts and missing
  layers. Distinguish source-derived cases from explicit stage-boundary edits.
  Keep cyclic malformed declaration probes in fixed-timeout children.
- [x] Freeze source, declarations and input rules; check immutable input state,
  canonical object/source/command identity and absence of native producer calls.
  Add deliberate corruptions for the substantive behaviors above, rather than
  tests mirroring helper implementation details.
- [x] Compare all 478 source fixtures after the complete independent preceding
  pipeline, with exact ordered survivors, predicates, edits, overlap labels and
  raw lowering diagnostics. Report counts and cover the writable orphan recovery.
- [x] Strict build, focused new/preceding compiler suites and full npm test;
  whitespace and unchanged native source/hash checks. The later complete
  source-to-session replay remains required, not rerun at this isolated boundary.
- [x] Self-review and commit; obtain parent-managed spec then quality approval.

Next: remove overlapping variants within surviving early/late groups, validate
ellipsis counts, assign rigid ownership compatibility and build loop schedules.

## Constructed orphan-requirement probe (resolved dependency)

Parent independently confirmed a malformed source boundary before implementation:
start with `test/scenarios.mjs` movementSource, rule `[ Player ] -> [ Player ]`,
and replace collision layers `Background` / `Player, Crate, Wall` with
`Background` / `Background` / `Crate, Wall`. Native retains both Background raw
assignments, with only the second being its final identity; Player is unlayered.
After actual rulesToMask, the LHS requires the old, unowned first assignment.
This is a constructed recovery test, not a discovered shipped-game failure.

Do not silently project that requirement away. Also do not assume the existing
gameplay decoder's idDict entry for an obsolete assignment is a canonical source
object: it can share a name with the final object while having different native
behavior. A malformed random RHS can potentially write obsolete assignments, so
a never-match projection would lose observable behavior.

The dependency is now reviewed at f595af1b. GameObject.orphanedFrom explicitly
links the writable orphan to its current declaration; rawObjectLookups and
namedObjects contain its real identity, and getObjectIntentLayer follows the link
for dynamic intent. The full strict package passes 1,176 tests. Resume the parked
lowering files against these APIs and add native-backed source-lowering coverage.
See `typescript/test/repros/orphaned-object-bug-report.md` for the requested report.

## Reviewed checkpoint

Implementation 5ae26738 passed independent spec then quality review. Strict build
and full npm test pass 1,279 tests. Both reviewers independently passed all 103
lowering tests, including all 478 source fixtures: 99,448 duplicate survivors ->
99,327 lowered rules, 251 overlap records and 143 raw diagnostics. Quality review
also passed 1,500 seeded boundary comparisons. All 21 pinned native hashes remain
unchanged. Actual source-lowered orphan application checks preserve RNG state,
same-name identities, player intent, physical movement and win outcomes.

The zero-layer manual-stage crash is deliberately outside this task: real native
loadFile returns null before lowering in that case. Whole-source assembly retains
that guard; no special internal crash branch was added here. No full standalone
session replay was repeated at this isolated stage. Surviving schedule formation
is the next dependency before source rule orchestration.
