# Static-tag consumers in the native solver

The generated matcher now preserves dynamic property/movement semantics, native transient projection requires unconditional cleanup, and every solver entry point can omit a proved redundant ACTION input. Win-relevance pruning can retain generated execution through separately keyed solver profiles.

## Correctness repairs

- Generated rules use runtime row helpers for dynamic bindings, layer-coupled movement predicates and dynamic replacements. Multi-row rules needing tuple-wide bindings use the interpreter. The scheduling regression test covers these cases in addition to the existing scheduling certificates.
- A native transient certificate requires an unconditional, deterministic, command-free late single-cell clearer. Conditional clearers, late recreation and random/dynamic late effects block the certificate. Objects present in authored starting boards remain excluded.
- The repaired generated solver solved 713 levels in the initial full-corpus screen; all 713 replayed in the ordinary interpreter. Native projection also solved 713, with no solved-to-exhausted regressions and all solutions replayable. These were separate 125 ms runs, not a performance comparison.

## ACTION pruning

CLI searches consume `movement_action/action_unnecessary` only when its status is `proved` and its boolean value is true. The native analyzer also derives a narrower game-scoped proof: ACTION cannot produce an object change, cardinal movement, semantic command or RNG effect. This proof is valid for injected boards, without relying on authored-level absence or cosmetic equivalence.

The generated-board C API caches game-scoped hints once per immutable game handle. Copies share the cache and concurrent initialization is synchronized. It deliberately does not apply authored-level projection facts to arbitrary injected boards. All search strategies receive the hints. `PUZZLESCRIPT_SOLVER_ACTION_PRUNING=0` disables the reduction for paired measurements; the JSON result exposes `action_input_pruned`.

The paired run used the same Release executable, weighted A*, one worker and a 125 ms deadline across all 184 games / 1,346 playable levels. Pruning off/on solved 718/726 levels with zero errors. On 80 common eligible solved levels, paths, expansions and unique-state counts were identical; simulations fell from 709,170 to 567,379 (20.0%). Deadline solve counts fluctuate and are not a speedup estimate.

A second off/on/on/off trial supplied existing JS proofs for 33 newly eligible games at 250 ms. The common eligible solved cohorts retained identical paths and search work. Simulation time fell 17.9% and 20.9% in the two paired comparisons, with 20.0% fewer simulations. The union of all ACTION trials contained 740 distinct solutions, all independently replayed using the ordinary interpreter with no generated backend.

## Compiled win-relevance profiles

Generate normal backends and additional solver profiles together:

```sh
puzzlescript_cpp compile-rules src/tests/solver_tests \
  --emit-cpp-dir build/solver-profiles \
  --emit-sources-list build/solver-profiles.txt \
  --solver-static-analysis-hints build/static-analysis-hints.json \
  --max-rows 99 --max-generated-lines-per-source 200000
```

Link the complete source list. `--emit-cpp` also supports combined normal/solver output. Regenerate after changing either game sources or hints. The hints have the existing `{ "games": { "file.txt": report } }` shape; a standalone report is also accepted for a single game.

At runtime, opt in with the same hints:

```sh
puzzlescript_solver src/tests/solver_tests \
  --static-analysis-hints build/static-analysis-hints.json \
  --solver-opt win-relevance
```

The compiler and solver share the proof parser and pruning implementation. Every expanded rule on a source line must be proved irrelevant before the line is removed. Random groups are preserved, as are group indices and loop tables. The corpus produces 51 solver profiles removing 608 runtime rules with the tested code-size cap.

Solver profiles use a separate registry, keyed by source hash and a versioned pruning hash. Attachment also checks the exact original `(phase, group, rule)` triples, including a forced-hash-collision regression test. Normal player lookup cannot select a solver profile. Missing or mismatched profiles clear the ordinary compiled backends and retain interpreter execution of the pruned rules. Profiles cannot be exported under ordinary runtime-IR cache keys or combined with compact-only generation.

The linked regression fixture checks both single-file and sharded output: ordinary player execution retains cosmetic rule effects, the solver profile omits them, and both reach the original win condition. Additional proof-gate tests reject candidate facts, unmapped IDs and partial source-line proofs.

Generation also fixes an existing unset-optional bug: using only `--max-generated-lines-per-source` must not apply an unspecified compiled-rule cap. Combined source lists are written once, so unchanged regeneration preserves timestamps (`wrote=0`).

The full-corpus off/on/on/off comparison used the same executable and supplied hints in every run. Pruning removed 664 runtime rules across 54 corpus filenames; duplicate sources share profiles. Generated execution remained attached for 53 of those games. Easyenigma exceeded the generation cap and used the interpreter fallback. Unpruned games retained their original backends.

| Paired result | First off/on | Reverse-order off/on |
| --- | ---: | ---: |
| Solved levels | 719 / 720 | 722 / 725 |
| Exhausted levels | 7 / 7 | 7 / 7 |
| Identical-work solved levels | 689 | 695 |
| Simulation time, all identical-work solves | 11,192.71 / 10,399.21 ms | 11,077.78 / 10,739.66 ms |
| Reduction, all identical-work solves | 7.1% | 3.1% |
| Identical-work solves in pruned games retaining compiled execution | 83 | 85 |
| Simulation time, that compiled cohort | 1,324.52 / 918.34 ms | 1,411.24 / 1,032.59 ms |
| Reduction, that compiled cohort | 30.7% | 26.8% |

Both pairs had zero errors and no solved-to-exhausted regressions. Pruning changed search work on some levels, so these timing cohorts require the same solution, expansions, unique-state count and simulation count. The union of all four runs contained 734 distinct solutions; all replayed in the ordinary interpreter with original rules and no generated backends. These are simulation-time gains on completed identical-work searches, not a claim that the deadline-limited corpus finishes 3–7% sooner.

[Paired measurements](2026-10-23-static-tag-solver-consumers.json) record the cohort sums and replay counts.

## Validation

- `src/tests/compiled_rules_scheduling_node.js`: 17 generator fixtures.
- `src/tests/compiled_solver_profiles_node.js`: generation, registry isolation and proof gates.
- `native/tests/solver_static_tags.cpp`: transient and ACTION certificate canaries.
- `native/tests/solver_generated_replay.cpp`: generated-board solution replay, required ACTION and concurrent cache tests.
- `native/tests/solver_compiled_profiles.cpp`: exact identity, collision, random-group and player-isolation checks.
- `native/tests/solver_compiled_profile_replay.cpp`: linked generated normal/solver execution.
- `native/tests/solver_solution_replay.cpp`: independent corpus solution replay without generated backends.

Measurements use MSVC 2022 x64 Release, 64-bit masks, weighted A*, one worker, and the default full-state generated turn path. Native projection remains opt-in. Per-level reachability specialization and candidate mechanic-profile heuristics remain future work.

The tracked `native/CMakeLists.txt` was empty at the baseline, so native validation used an isolated CMake harness linking the tracked runtime, compiler and test sources. No unrelated build-system repair is included.
