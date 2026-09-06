# Reuse future-object analysis across candidate levels

The JS future-object consumer now owns its analysis at ruleset scope. It no longer rebuilds the creation plan and empties its verdict cache for every candidate level. The main per-level certificate is conservation of player count combined with an actual settled count of one.

## Ownership and cost

- The solver requests only `count_layer_invariants` and `linear_count_invariants` for this feature. It no longer requests the full collection of fact families, including `per_level_object_universe`. Other enabled consumers can still request their own families.
- `getFutureObjectSession(report, runtimeState)` reuses one name-based analysis plan per immutable report and one runtime binding per compiled object-ID table. Different ID assignments never share raw bitset verdicts. Weak ownership allows obsolete compilations to be collected.
- Each binding retains a bounded 256-entry dead-end verdict cache. Different board dimensions, arrangements and positive counts can share a verdict because the implemented dead-end proofs depend only on zero versus positive counts. A second bounded cache retains relaxed creation closures at ruleset scope.
- Cache misses decode the presence bitset instead of recounting every occupied object on every tile. Numeric resource bounds would require a richer cache key; synthetic presence counts are never used for player certification.
- `analyzer.certifyPlayerCount(actualCount)` applies the conservation proof without a future-object query. A generator that already maintains the actual count can call this directly. `session.certifyPlayer(board, stride)` is a convenience wrapper that counts just player object instances; the current JS solver uses it once after startup settles.

The solver records `future_ruleset_setups`, `future_player_count` and `future_single_player_certified`. Its 128-level differential fixture now reports **two setups**, one for each of its two games, and 128 certified single-player starts. A one-player level and a two-player level may share a dead-end verdict but cannot share the single-player certificate.

This change does not introduce a new player-position execution fast path. It establishes and exposes the cheap level-specific certificate without repeating the ruleset proof. Native/MIS consumption is still future work; this change is in the JS reference consumer and reusable analysis API.

## Analysis-only batch measurements

Five serial alternating pairs follow warmups. Each measured batch starts with a cold session and visits 1,000 candidate boards. Candidates cycle through a game's existing templates with cyclic tile shifts; population patterns therefore recur. This deliberately models reuse across different arrangements, not a diverse random population distribution. Boards are prepared outside the timed batch.

The fresh path reproduces the old per-level plan/count/inspect work. The shared path retains its plan/cache and additionally performs the real player-count check on each candidate. Every candidate's dead-end verdict and player certificate is compared against the full-analysis reference before timing.

| Ruleset | Old batch median | Shared batch median | Creation closures, old -> shared |
|---|---:|---:|---:|
| Chaos Wizard | 351.49 ms | 2.74 ms | 1,000 -> 12 |
| Cake Monsters | 551.80 ms | 3.74 ms | 1,000 -> 29 |
| Drop Swap | 1,798.17 ms | 3.30 ms | 1,000 -> 4 |

Every batch reduces plan construction from 1,000 times to once. These are **analysis costs**, not solver or generator speedups. Workloads with many distinct presence sets will have more misses; eviction affects cost only.

Static analysis itself is measured separately, including its existing compile/validation gate:

| Ruleset | Full families median | Required families median |
|---|---:|---:|
| Chaos Wizard | 61.25 ms | 42.99 ms |
| Cake Monsters | 45.23 ms | 20.49 ms |
| Drop Swap | 69.28 ms | 29.87 ms |

## End-to-end solver comparison

Compare previous PR revision `1c7c0f55` against the new implementation, both with `--solver-future-prune`. Three serial alternating pairs use separate Node processes and the same five-game focused sample: Chaos Wizard, Coincounter, Gobble Rush, Midas and LED Challenge. Each playable level has a 250 ms budget. Process wall time includes startup, compilation and static analysis.

| Pair | Previous solves | Shared solves | Previous wall | Shared wall |
|---|---:|---:|---:|---:|
| 1 | 27 | 29 | 13,896 ms | 13,331 ms |
| 2 | 28 | 29 | 13,930 ms | 13,151 ms |
| 3 | 29 | 29 | 13,157 ms | 12,948 ms |

The median process time improves by about **5.4%**, with five reusable sessions instead of rebuilding for each playable level. All runs have 101 entries (73 playable and 28 messages), no compile/level errors and no replay rejections. This is encouraging evidence for the refactor, not proof that future pruning should be enabled by default. The comparison is against the previous pruning implementation, not against pruning disabled, and is not a native generation benchmark.

## Remaining recurring cost

Search still scans the board to construct exact object presence at checked states. Sharing plans and caches does not remove that scan. An incremental population implementation could update presence only on zero crossings, but would have to cover all writes and wholesale restoration, including rigid rollback and solver snapshots. The engine's existing broad rule-matching masks can retain removed bits during a turn, so substituting them as exact populations would hide precisely the extinctions being measured.

## Validation and reproduction

Passed: focused future-object/session tests; 128 exhaustive BFS comparisons with unchanged solvability and minimum input lengths (845 baseline expansions versus 829 with pruning); portfolio agreement and replay checks; existing analyser, static-optimizer, hash-projection and focused runtime-contract tests. Session tests cover different dimensions/counts, restored populations, cache eviction, changed rulesets, remapped/high-word IDs, interchangeable player forms and zero/one/two-player distinctions. Player certification is explicitly checked to make zero future-object queries.

The historical full static-fixture failure documented in `future-object-universe-2026-09-06.md` is unchanged; this refactor does not claim to fix or rerun that unrelated failing suite.

```text
node src/tests/future_object_universe_node.js
node src/tests/solver_future_prune_node.js
node src/tests/benchmark_future_ruleset_reuse.js build/future-ruleset-reuse.json 1000 5
node src/tests/compare_future_ruleset_solver.js /path/to/checkout-at-1c7c0f55 build/future-ruleset-solver.json 3
```

Raw measurements are in `docs/benchmarks/2026-09-06-future-ruleset-reuse.json` and `docs/benchmarks/2026-09-06-future-ruleset-solver.json`. Timed experiments ran serially without the validation suites running alongside them.
