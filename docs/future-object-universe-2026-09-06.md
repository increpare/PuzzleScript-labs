# Remaining future objects: implementation and collection survey

The solver can now prove that an object type, and the mechanics depending on it, have become permanently unavailable from the current state. The implementation reuses the existing conservative object-creation closure; it does not infer roles such as crates or targets from names.

This first implementation supplies a reusable JS analyser, a per-level single-player certificate, an observational survey, and an **opt-in JS dead-end pruning consumer** (`--solver-future-prune`). It does not yet delete rules dynamically or enable a native/MIS consumer. Timing results do not justify a default-on decision.

## Coverage and meaning

The survey reads the bundled solver tests, good-games collection and demos. It removes exact duplicate source contents: **456 files become 228 distinct source versions**, containing **1,444 playable levels**. Versions differing in source text remain separate; this is not semantic deduplication of game titles. All 228 sources analysed and all surveyed levels completed without harness/proof-check errors. Six sources with rule-driven restart/checkpoint commands use a conservative fallback.

Each level is observed at initialization, explored for up to **64 BFS state expansions**, and played for up to **40 deterministic random-walk inputs**. These explorations do not prune dead states: doing so would bias the evidence and prevent checking their descendants. The final run has no wall-time cutoff, so source ordering and fixed seeds determine the sample independently of shard CPU contention. A separate sample replays all **280 source-hash-matched cached solutions**.

| Finding | Levels |
|---|---:|
| At least one irreversible loss of future object types | **473** across **63 source versions** |
| Loss during level initialization | **88** |
| Loss on the first player input | **101** |
| Loss on later inputs | **393** |
| Observed loss leaving a provably unwinnable state | **63** across **10 source versions** |
| Observed extinction proved necessary on any winning continuation | **138** across **22 source versions** |
| Irreversible loss observed along a winning path | **140** |
| Already provably impossible at the settled initial state | **2** |

These categories overlap. “Necessary” is conditional on a winning continuation existing; it does not assert that the level is solvable. “Observed on a winning path” is evidence of compatibility, not necessity. “Prevents completion” classifies the resulting branch, not the entire original level, and need not establish that the branch was winnable before the transition.

| Sample | Transitions / boundaries | Loss observations | Loss observations ending in certified dead states |
|---|---:|---:|---:|
| Initialization | 1,444 | 88 | 0 |
| Bounded BFS exploration | 414,784 | 6,141 | 1,682 |
| Deterministic walks | 56,753 | 369 | 44 |
| Cached winning traces | 8,767 | 89 | 0 |
| Total | **481,748** | **6,687** | **1,726** |

About 1.39% of all sampled boundaries/transitions lost future types; on cached winning traces it was about 1.02% of inputs. These are frequencies in the specified samples, not an unbiased probability over every reachable state or over human play. Repeated observations of the same kind of loss are counted separately. Unaffected levels may contain losses deeper than this exploration.

## Examples

- **Any hole is a goal:** initialization removes `Player_Neck_base` and `player_body_base`, disabling two rules in an observed case. **Drop Swap** removes `Init` at startup. **Two-Step Pete** loses `laststart` on the first input of cached solutions. This confirms the suspected setup-only mechanics.
- **Bring the ice cube to the goal without exposing it to heat:** on source level 1, `right, up, right, right` loses the last possible `icecube` and certifies failure.
- **Chaos Wizard:** losing `Player` can also make `Charge` and other spell types impossible. One observed loss disables 38 rules. The analyser reasons about the whole creation chain, not just the visible disappearance.
- **Midas:** one observed branch loses `Target` and consequently the future possibilities of `Lovebase` and `Love`, disabling nine rules and ruling out completion.
- **Cake Monsters:** removal of the last `RedCake` is a necessary extinction and occurs on winning paths. Other cake colours receive the same reasoning.
- **Garten der Medusen:** particular directional Medusa types must disappear. **Chevron Lodger** has observed required extinction of `Crate_top`; **The Far Away Danish Pastry is always Delicio** has required extinction of `Fruit`.

The complete per-game table follows below. Raw JSON retains level indices, source hashes, source aliases, input witnesses, lost types, newly disabled rule counts, and classifications. Source level indices include message entries and are zero-based, matching the existing solver API.

## What is proved

The compiled plan records each rule's necessary positive object requirements and possible object creations. From currently present types, a fixed-point closure admits every creation whose requirements might be satisfiable. It deliberately forgets positions, negative conditions, multiplicity and movement requirements. This makes the result an over-approximation: inclusion does not prove that an object is constructible; exclusion proves that it cannot be constructed within the supported scope.

The analysis includes command-only rules when checking alternate explicit wins. A reachable explicit `win` command prevents declaring the formal win conditions the only route to success. Rules requiring impossible types cannot supply that alternate route. Games with rule-driven restart/checkpoint commands fail closed because a restored board could reintroduce missing types. External undo/restart and transitions to another level are outside the certificate scope.

The initial consumer recognizes:

- `SOME` conditions whose source or target filter is permanently unavailable.
- `ALL A ON B` where B is unavailable and an A filter instance must persist because of existing count facts. It preserves the possibility of winning by removing all A.
- Bare `NO A` conditions where an A instance must persist.

Properties use ANY semantics and aggregates use ALL semantics. Positive counts for several types do not establish that an aggregate exists on one cell. An aggregate containing every object type is also not the implicit ANY-all-objects target of a bare condition; a focused regression test now pins down this distinction in the static win-condition representation.

Required absence is reported separately from necessary extinction. If a type must be absent to win but can be recreated, disappearance of its creation capability has not been proved necessary. The stronger classification additionally uses an existing non-increasing-count fact, a currently positive count and the absence of an alternate explicit-win route.

## The single-player aside

Of the 1,444 levels, **1,133** have exactly one player object instance in the raw template and **1,124** have one after startup settles. The new certificate establishes exactly one throughout supported forward play for **567 levels**: about half of the observed settled-single-player levels, or 39% of all levels.

The certificate combines the current count with conservation. It also supports a player property whose interchangeable forms have a proved conserved sum exactly covering the player types. It counts object instances, not occupied cells, so two overlapping player objects cannot masquerade as one.

Thus a per-level guarantee is practical; a whole-game guarantee is unnecessary. The remaining coverage gap is mainly a question for stronger conservation proofs and supported reset semantics. This change emits the certificate but does not yet add a new player-position execution specialization. The solver already has player-position caching, and GBC has a separate native single-player certificate, so another fast path should be measured against those existing consumers.

## Solver experiment

The optional JS consumer leaves engine state intact and discards only states with a certified impossible winning continuation. Both ordinary search and the shared portfolio path can use it. Unsupported reset/checkpoint games retain normal search. Structural solver-opt passes and the specialized push/naive lanes are currently excluded from flag combinations rather than applying facts to a different object model.

Creation plans are compiled once and relaxed closures are cached by presence. The solver additionally caches the complete dead-end verdict by an exact board-wide presence mask. This is valid because the implemented predicates distinguish zero from positive counts only; any future numeric resource bounds must extend the cache key. Occupied-bit counting avoids scanning every declared object type on every tile. All these solver/performance decisions have explanatory source comments.

Exhaustive BFS comparisons covered all player placements and seed subsets on a four-cell line, under both a `SOME Prize` goal and a `NO Seed` goal: **128 cases**, identical solve/exhaustion results and minimum input lengths, and ordinary replay validation. Expanded states fell **845 to 829**, with **20 pruned states**. This is a focused correctness/work-reduction test, not a general speed benchmark.

Five games with observed dead branches were then tested in separate serial processes, alternating baseline and candidate order, at 250 ms per level: Chaos Wizard, Coincounter, Gobble Rush, Midas and LED Challenge. The set has 73 playable levels plus 28 message entries.

| Pair | Baseline solves | Future-prune solves | Pruned states |
|---|---:|---:|---:|
| 1 | 27 | 30 | 17,850 |
| 2 | 29 | 26 | 16,501 |
| 3 | 29 | 29 | 17,689 |

Verdict-cache hit rates were approximately 99%. Root/static analysis and cold startup are included in the recorded process wall times. Despite removing real branches, the solve-count evidence is mixed and wall time does not show a consistent gain. Keep the flag experimental. The earlier uncached-verdict probe is retained separately and is not a controlled timing comparison against the final version.

The strongest next implementation target suggested by this survey is to reuse phase certificates to specialize the active rule plan, especially after startup cleanup. The current report already identifies which rules become impossible; it does not yet apply that transformation. Native/MIS consumption should follow a validated, beneficial consumer rather than automatically duplicating this prototype.

## Validation and reproduction

Passed: focused future-universe tests (including ANY/ALL, vacuity, explicit wins, reset fallback, transformed player roles and high-bit/multi-word counting); 128 BFS differential cases; existing analyser tests; focused runtime-contract tests; static optimizer tests; hash-projection tests; fixture canonical-parity tests. The full existing runtime-contract run passed 470 cases, with 15 legacy sources reported as analysis-unavailable. The final fixed-expansion survey checked future-type containment, single-player preservation and absence of winning descendants of certified dead states; it reported no violations and all 280 cached solutions won.

The full static fixture runner still stops at the existing `static-ellipsis-row-rewrite-erases` expectation (`Star.static`: expected false, got true). The identical failure was reproduced in the untouched master baseline. Its malformed-rule fixture was left unchanged. This is disclosed separately from the passing suites; the entire static fixture suite is not claimed green.

From the repository root:

```text
node src/tests/future_object_universe_node.js
node src/tests/solver_future_prune_node.js
node src/tests/survey_future_object_universe.js --out build/future-universe-survey.json
node src/tests/compare_future_prune.js build/future-prune-comparison.json 3
```

The survey also accepts `--shard I --shards N`. Merge the outputs with `summarize_future_universe_survey.js output.json shard-0.json ...`. The final data was collected with four shards, 64 expansions, 40 walk inputs and no wall-time cap. All game sources remain unchanged.

## Per-game results

Counts below are numbers of levels. Initialization/first/later categories overlap; dead means an observed resulting branch is proved unable to finish. Required means an observed necessary extinction, not proof that the entire level has a solution. Winning means an irreversible loss was seen on a sampled winning path. Only affected source versions are listed.

| Source | Affected | Init | First | Later | Dead | Required | Winning |
|---|---:|---:|---:|---:|---:|---:|---:|
| againexample | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| blockfaker | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| lovendpieces | 1 | 0 | 0 | 1 | 0 | 1 | 1 |
| lunar_lockout | 4 | 0 | 0 | 4 | 4 | 0 | 0 |
| nekopuzzle | 10 | 0 | 0 | 10 | 0 | 10 | 10 |
| 8 happy snakes | 1 | 0 | 0 | 1 | 0 | 1 | 0 |
| a clear view of the sky | 13 | 0 | 0 | 13 | 0 | 0 | 7 |
| Any hole is a goal | 35 | 35 | 0 | 1 | 0 | 0 | 1 |
| atlas shrank | 12 | 0 | 12 | 8 | 0 | 0 | 1 |
| BIAXIAL INVASION OF SATURN | 12 | 0 | 0 | 12 | 0 | 0 | 0 |
| Bring the ice cube to the goal without exposing it to heat | 1 | 0 | 0 | 1 | 1 | 0 | 0 |
| byyourside | 2 | 0 | 0 | 2 | 0 | 0 | 2 |
| cakemonsters | 33 | 0 | 18 | 33 | 0 | 23 | 2 |
| castlemouse | 10 | 0 | 4 | 10 | 0 | 0 | 9 |
| chaos wizard | 22 | 0 | 22 | 22 | 16 | 19 | 0 |
| Chevron Lodger | 3 | 0 | 0 | 3 | 0 | 3 | 3 |
| CODEX LUBRICUS | 17 | 0 | 3 | 17 | 0 | 17 | 0 |
| coincounter | 9 | 0 | 1 | 9 | 6 | 2 | 3 |
| collapse | 2 | 0 | 1 | 2 | 0 | 0 | 0 |
| color chained | 11 | 0 | 2 | 11 | 0 | 0 | 2 |
| constellationz | 1 | 0 | 0 | 1 | 1 | 0 | 0 |
| cratopia | 4 | 3 | 0 | 1 | 0 | 0 | 4 |
| der hydra krypta | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| dropswap | 5 | 5 | 0 | 5 | 0 | 0 | 0 |
| dungeon janitor | 1 | 0 | 0 | 1 | 0 | 0 | 1 |
| easyenigma | 14 | 9 | 11 | 12 | 0 | 5 | 12 |
| Garten der Medusen | 4 | 0 | 2 | 4 | 0 | 4 | 1 |
| gobble_rush | 20 | 0 | 3 | 20 | 20 | 0 | 1 |
| head skuller | 4 | 0 | 0 | 4 | 0 | 0 | 4 |
| heroes_of_sokoban | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| i want to grind myself into dust | 3 | 3 | 0 | 0 | 0 | 0 | 0 |
| icecrates | 4 | 3 | 0 | 2 | 0 | 0 | 1 |
| kishoutenketsu | 3 | 0 | 0 | 3 | 0 | 2 | 0 |
| led challenge | 4 | 0 | 1 | 4 | 4 | 0 | 0 |
| ledchallenge | 4 | 0 | 1 | 4 | 4 | 0 | 0 |
| Legend of Swixero | 2 | 0 | 0 | 2 | 0 | 0 | 0 |
| m c eschers armageddon | 2 | 0 | 0 | 2 | 0 | 2 | 2 |
| match three billiards | 1 | 0 | 0 | 1 | 0 | 0 | 1 |
| mazezam | 30 | 0 | 0 | 30 | 0 | 0 | 0 |
| midas | 6 | 0 | 1 | 6 | 5 | 0 | 0 |
| no don't eat that | 4 | 0 | 0 | 4 | 0 | 4 | 1 |
| no forbidden symbols | 1 | 0 | 0 | 1 | 0 | 1 | 1 |
| paint everything everywhere | 20 | 20 | 0 | 0 | 0 | 0 | 0 |
| Pocket Gopher - Root-Shoot Nibbler | 3 | 0 | 0 | 3 | 0 | 0 | 0 |
| ponies jumping synchronously | 7 | 0 | 1 | 7 | 2 | 0 | 4 |
| push | 21 | 0 | 3 | 21 | 0 | 2 | 2 |
| realtime dog mountain rescue | 3 | 3 | 0 | 0 | 0 | 0 | 0 |
| Recondite Star Sector Sigma | 7 | 0 | 0 | 7 | 0 | 7 | 7 |
| Resin-Caster | 10 | 0 | 0 | 10 | 0 | 10 | 10 |
| riverpuzzle | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| slot machine | 1 | 0 | 0 | 1 | 0 | 0 | 1 |
| smother | 11 | 0 | 1 | 11 | 0 | 1 | 1 |
| sokobond demake | 14 | 0 | 3 | 14 | 0 | 3 | 14 |
| sum three horizontally to 8 | 10 | 0 | 1 | 10 | 0 | 0 | 5 |
| take heart lass | 5 | 0 | 0 | 5 | 0 | 0 | 0 |
| The Far Away Danish Pastry is always Delicio | 2 | 0 | 0 | 2 | 0 | 2 | 2 |
| the red ring of immortality | 1 | 0 | 0 | 1 | 0 | 0 | 1 |
| the_saga_of_the_candy_scroll | 6 | 0 | 1 | 6 | 0 | 6 | 3 |
| tiny treasure hunt | 7 | 7 | 0 | 5 | 0 | 0 | 0 |
| tunnel rat | 2 | 0 | 0 | 2 | 0 | 0 | 0 |
| Two-Step Pete | 8 | 0 | 8 | 2 | 0 | 0 | 7 |
| Vexatious Match 3 | 2 | 0 | 0 | 2 | 0 | 0 | 0 |
| Yellow Box | 13 | 0 | 0 | 13 | 0 | 13 | 13 |
