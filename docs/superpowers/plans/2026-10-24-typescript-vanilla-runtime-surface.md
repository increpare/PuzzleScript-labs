# Vanilla Runtime Surface Cleanup Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development, followed
> by spec and quality reviews. Begin after reviewed source movement/property/spawn
> inference produces vanilla's concrete variants. This is an authorized cleanup
> of inherited labs-only machinery, not a change to production JavaScript.

**Goal:** Make runtime rule types and execution contain only behavior vanilla
actually compiles, removing unused dynamic capture/sink/conditional machinery.

**Architecture:** Vanilla compiles movement/property inference into concrete
variants, with retained single-layer Any object predicates. The current vanilla
adapters always supply empty fields for the inherited extra runtime features.
Remove those fields and paths; keep ordinary direct predicates and cell edits.

**Tech Stack:** Strict TypeScript, direct cells/object sets/layer movements,
existing per-phase/per-turn/session differential checks and native schema guards.

## Files and intended changes

- `typescript/src/rule-model.ts`: remove CellPattern.anyMovements and alternatives.
  Retain required/forbidden objects and movements plus anyObjects groups.
- `typescript/src/execution-model.ts`: remove LayerReference, PropertySink,
  capturedLayer, runtime binding imports, ExecutableRule.bindings and replacement
  propertySinks/removedProperties/aggregateSinks/conditionalMovements. Keep
  CellReplacement.edits and rigidLayers, and all scheduling/execution state.
- `typescript/src/captures.ts`: remove the module once all vanilla call sites and
  inherited-only tests are removed. Keep no first-matching-member runtime capture.
- `typescript/src/rules.ts`: remove captureBindings/capturedEdits and apply each
  static replacement.edits directly. Preserve tuple rechecks, ordered live writes,
  commands, random draws, movement edits, rigid marks and all return state.
- `typescript/src/replacement.ts`: remove conditionalMovements and conditional
  predicate execution; preserve all static edits, random choices and draw order.
- `typescript/src/matching.ts`: remove disjunctive movement and conditional
  alternative matching paths; preserve direct conjunction/anyObjects semantics,
  ordered matches, gaps, InPlace handling and fixed-gap rechecks.
- Update native test adapters, test builders, examples and documentation to the
  smaller types. Read actual references with rg before editing. Remove only tests
  dedicated exclusively to unsupported labs runtime features; retain all vanilla
  source/data/gameplay tests and every meaningful common-state regression.

Some tests mix shared vanilla behavior with unsupported capture features. Rewrite
their shared part rather than deleting the whole case: in rules.test.mjs keep
live overlapping-row writes, and keep the random-layer part of the test that
dynamic layers do not extend static rigid provenance. Preserve every native-backed
application/turn/session/corpus case regardless of whether its name mentions
inference or properties. Remove captures.test.mjs only after confirming its direct
API is gone and common tuple/ellipsis/InPlace checks remain in matching/rules tests.

## Test adapter contract

`test/legacy-execution.cjs` currently supplies empty bindings and sinks and
conditional arrays. `test/legacy-patterns.cjs` supplies empty anyMovements and
alternatives for native CellPattern. Remove those EMPTY candidate output fields,
not any native field reads or unknown-field rejection. Preserve full native
semantic schema checks described in `test/VANILLA-ADAPTER-AUDIT.md`.

The legacy pattern decoder's option helper exists for inherited runtime binding
features; remove it if no actual vanilla call remains. Remove obsolete
MovementPredicateKind context plumbing only after checking every adapter. Do not
weaken completeness checks to make the simpler runtime pass.

## Required invariants

- Retained single-layer properties are ordinary anyObjects sets plus layer intent.
  Concrete source variants remain distinct until semantic source-group dedup.
- Random objects/directions use the same ordered draws, including singleton
  entity draws and rounded-to-one edge cases already covered by tests.
- Replacement additions still win removals, including conflicting writes on a
  layer. Command queuing and changed flags retain all per-phase observations.
- InPlace cells share a live board position, repeated tuples recheck live state,
  and zero-step ellipsis searches retain their finite failure behavior.
- Preserve issue #1206 exactly: rigid ownership compatibility transitions,
  cell-wide ownership guard, null owners, retry bans and the unmatched-group
  regression remain unchanged and tested. Do not simplify the known bug away.
- Native production files and oracle-source hashes remain unchanged.

## Verification sequence

- [x] Inspect all references and establish which fields are always empty in the
  pinned vanilla decoder. Record any actual vanilla producer before deleting it.
- [x] Preserve the existing vanilla tests as the behavioral baseline; no new
  tests that merely assert deleted implementation details are needed.
- [x] Remove unsupported types and execution paths, update adapters/builders and
  examples, and remove only exclusively inherited-feature tests.
- [x] Strict build, focused matching/replacement/rules/turn/session/oracle suites,
  all source compiler tests, and full npm test. Run all four examples.
- [x] Run a meaningful standalone differential session subset covering random,
  rigid, ellipsis/InPlace, undo/restart/AGAIN and commands. The final complete
  source-compiled 478-game replay remains required after integration; do not run
  the same 40-minute native-compiled replay unnecessarily during this cleanup.
- [x] Audit that no binding/sink/conditional/labs-only fields remain in candidate
  runtime or vanilla adapter outputs. Keep unknown native field regressions.
- [x] Obtain spec then quality approval and commit the bounded simplification.

Next: lower validated named variants directly into these smaller runtime types,
then build surviving groups, rigid ownership compatibility and loop maps.

## Reviewed checkpoint

Implementation `20a11892` passed independent spec and quality reviews. Both
strict build and all 1,092 remaining tests passed; 51 exclusively unsupported
API cases were removed. Spec review independently repeated all tests, all four
examples, the bounded 22-fixture/783-observation/24-load session check and the
478-source decoder audit (99,076 rules, 231,021 cells, 203,985 replacements).
Quality review additionally passed fresh strict noEmit, 154 focused tests and
pre-clone malformed-tuple checks. Its fresh temporary compilation matched all
32 current build modules and found no stale extras. Native field allowlists,
unknown-field injection tests, issue #1206 and shared static regressions remain.
Production JavaScript and oracle-source hashes are unchanged. See the detailed
commands and coverage in `typescript/test/VANILLA-ADAPTER-AUDIT.md`.
