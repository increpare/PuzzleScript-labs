# Vanilla gameplay adapter schema

The oracle is pinned to official vanilla commit
`57f9f6cba69f6aa52ed738d5aee1d709d0037648`. The native files are hash-checked
before loading. No production source changes are proposed.

For integration into PuzzleScript-labs, those sources are packaged unchanged in
[`vanilla/`](vanilla/README.md). Every adapter source read uses that directory,
including producer discovery and isolated native-function checks. The manifest records SHA-256 hashes for all 22 files, including the input/output
source used by session checks. Refreshes copy every file from the exact pinned
commit before recomputing those hashes. The packaging regression checks
that the host loads these fixtures independently of the labs `src/` tree.

The original copied labs adapter read fields absent from vanilla.
Direct native compilation of the pushing example gives these semantic fields:

| Native value | Fields containing runtime behavior |
| --- | --- |
| Cell predicate | `objectsPresent`, `objectsMissing`, `anyObjectsPresent`, `movementsPresent`, `movementsMissing`, `replacement` |
| Cell replacement | `objectsClear`, `objectsSet`, `movementsClear`, `movementsSet`, `movementsLayerMask`, `randomEntityMask`, `randomDirMask` |
| Rule | `direction`, `patterns`, `hasReplacements`, `lineNumber`, `ellipsisCount`, `groupNumber`, `rigid`, `commands`, `isRandom` |

Vanilla also stores generated matcher/replacement functions and acceleration
masks. Those supply the original comparison results; the candidate uses direct
TypeScript execution.

Vanilla's compiler expands property and movement inference into concrete rules
before constructing these values. It has no `propertyBindingsArr`,
`aggregateBindingsArr`, `inferredPropertyBindings`, `inferredPropertySources`,
`inferredAggregateBindings`, `layerCoupledMovementMasks`,
`layerCoupledMovementReplacements` or `anyMovementsPresent` fields. The copied
adapter's reads of those labs extensions fail before gameplay comparison starts.
The native compiler constructs its cell predicates in `rulesToMask`, and
`new CellPattern` receives precisely the five predicate fields plus replacement.

The adapted oracle translates every actual vanilla semantic field into concrete
predicates and edits, and rejects unknown native fields rather than silently
dropping them. Adapter tests include
deliberately injected unsupported fields. Every existing per-input/AGAIN state,
rule phase, RNG, sound and corpus expectation comparison remains required.

The user explicitly approved this adaptation and removal of the unused inherited
labs runtime surface. `CellPattern` now contains required/forbidden objects and
movements plus `anyObjects`; rules apply static replacement edits directly.
There are no runtime captures, sinks, conditional edits, movement disjunctions or
recursive cell alternatives. Vanilla expands property and movement choices into
concrete rules before gameplay. The unused adapter option and movement-set
helpers, and capture-enum context plumbing, have also been removed.

The cleanup removes 51 exclusively unsupported API tests: 36 capture tests,
three movement-disjunction/alternative tests, three conditional replacement tests
and nine capture/sink/conditional rule tests. Shared behavior remains covered:
the overlap, zero-step and snapshot tests now use static edits; the random-layer
test still checks that spawning cannot extend static rigid responsibility.
All source compiler, native application/turn/session, unknown-field injection,
ellipsis, InPlace and issue #1206 regressions remain. Exact tuple cardinality is
still checked before replacement writes: a failed live recheck returns unchanged
state, while an unchecked tuple with the wrong row count throws before cloning,
as it did when that guard lived in the removed capture helper.

Historical cleanup verification at the previous `5a94bde1` authority, from `typescript/`:

| Check | Result |
| --- | --- |
| `npm test` (includes strict `npm run build`) | 1,092 tests passed |
| Matching, replacement, rules, scheduling, turn, session, all oracle, zero-step and adapter suites | 319 tests passed |
| Declaration, source, Unicode, rule compilation and orientation suites | 586 tests passed |
| `node examples/{movement,matching,turn,session}.mjs` (run separately) | All four exited zero |
| `node test/corpus.cjs --session <filter>` with `random`, `rigid body test 2`, `ellipsis`, `again + message combo`, `undo test`, `restart test` | 21 fixtures, 778 observations/operations, 23 level loads |
| Native-recovered InPlace standalone session with tick, undo, restart and sound command | Five observations/operations, one level load |

The separate InPlace replay retains the native `Unexpected direction: 16`
recovery diagnostics. A static audit compiled all 478 simulation sources and
decoded 99,076 rules, 231,021 cells and 203,985 replacements with the native field
allowlists active. No removed runtime fields appeared in the decoded game graph
or candidate `src/`, generated JavaScript and examples. Generated capture files
left by an earlier build were removed as well. Production JavaScript and the
oracle source hashes are unchanged.

Before this cleanup, the complete 478-game standalone replay passed: 20,034 session
observations/candidate operations and 525 level loads, exit status zero. This
validates candidate gameplay using native-compiled game data; independent
source-to-session compilation remains a separate gate. The cleanup reruns the
bounded subset above rather than the complete native-compiled replay. Vanilla
applyRules returns no change flag, so the adapter observes the actual native
applyRuleGroup decisions, including changes subsequently overwritten in a phase.
Player-mode compatibility tests load the original debug_off.js in a separate
process rather than mutating the native IDE constant.
