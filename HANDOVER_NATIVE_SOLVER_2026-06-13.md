# Native Solver Handover - 2026-06-13

## Goal

Continue restoring and improving the native C++ solver until every level solved by the JavaScript solver under the same timeout is also solved by native C++ within that timeout, ideally with a large speed margin.

Current broad state from the latest comparable focused work:

- Native C++ is ahead of the saved JS corpus in aggregate (`cpp_after_anyhole_perf_fix.json`: 860 solved vs `js.json`: 772 solved at 1000 ms).
- Earlier runs still had JS-solved/native-missed individual levels. The latest comparable check reports zero native misses against the saved JS-solved set.
- A parallel full-corpus run is not comparable to `solver_timeout_curve.js` because the timeout curve script uses `--jobs 1`; parallel runs create CPU contention and undercount solved levels.

Update from the continuation pass:

- Comparable native full-corpus run now has zero JS-solved/native-missed levels against `build/solver-timeout-curve/js.json`.
- Latest comparable native results (`build/solver-js-coverage-native-v3/native.json`) totals: 2790 levels, 892 solved, 446 timeout, 8 exhausted, 1444 skipped message, 0 errors.
- Comparison command result: `native_solver_js_coverage passed js_solved=779 native_solved=779 native_errors=0 timeout_ms=1000 strategy=portfolio jobs=1`.
- Full native build passed, and `ctest --test-dir build --output-on-failure` passed 41/41 tests after adding solver coverage regression tests.

Update after the canonical-source / portfolio follow-up:

- Canonicalizing through JS semantic JSON and decanonicalizing back to PuzzleScript is not currently a free speed win for native C++.
- It exposed two different issues:
  - `limerick.txt` stayed JS-equivalent but canonical source shape pushed native into the wrong BFS-first portfolio profile.
  - `smother.txt` changed JS solver behavior after the semantic round-trip, so that is a canonicalizer/decanonicalizer semantic-parity issue rather than a native speed issue.
- Native portfolio now records its feature vector in JSON (`portfolio_profile`, rule counts, win-condition shape, etc.) so profile choices can be audited.
- Latest comparable native results (`build/solver-js-coverage-native-v5/native.json`) totals: 2790 levels, 894 solved, 444 timeout, 8 exhausted, 1444 skipped message, 0 errors.
- The v5 run still passes the JS coverage gate: `native_solver_js_coverage passed js_solved=779 native_solved=779 native_errors=0 timeout_ms=1000 strategy=portfolio jobs=1`.
- Follow-up v6 chooser refinement treats sound commands as portfolio-inert and gates the simple BFS shortcut on no late rules. This removes the remaining raw/canonical native profile changes across the full corpus.
- Latest v6 raw coverage run still passes the JS coverage gate: `native_solver_js_coverage passed js_solved=779 native_solved=779 native_errors=0 timeout_ms=1000 strategy=portfolio jobs=1`.
- Latest v6 raw/canonical native comparison has zero `portfolio_profile` changes; remaining native status changes are `smother.txt#6/#8/#32`, matching JS semantic round-trip drift rather than native chooser behavior.

## Files Modified

Primary files touched by the current work:

- `native/src/compiler/lower_to_runtime.cpp`
- `native/src/cli/main.cpp`
- `native/src/runtime/core.cpp`
- `native/src/runtime/core.hpp`
- `native/src/search/search_common.hpp`
- `native/src/solver/main.cpp`
- `native/CMakeLists.txt`
- `Makefile`
- `native/tests/compiler_row_any_masks.cpp`
- `native/tests/compiler_row_missing_masks.cpp`
- `src/tests/native_solver_js_coverage_node.js`
- `src/tests/run_native_solver_js_coverage.js`
- `src/tests/run_solver_portfolio_regression.js`

Unrelated untracked files currently present:

- `.claude/worktrees/`
- `docs/superpowers/specs/2026-06-13-supercharged-js-solver-design.md`

Do not assume those untracked files belong to the native solver fixes.

## What Was Fixed

### Dynamic Replacement Storage

`Replacement` was carrying several `std::vector` fields inline for rare dynamic replacement cases. These were moved behind `ReplacementDynamic` in `native/src/runtime/core.hpp`, with `Replacement::dynamic` as a `std::shared_ptr`.

This reduces common-case pattern/replacement size and recovered performance on several timeout regressions, especially around `Any hole is a goal.txt`.

Related updates were made in:

- `native/src/runtime/core.cpp`
- `native/src/compiler/lower_to_runtime.cpp`
- `native/src/cli/main.cpp`

### Hot Path Runtime Cleanup

`matchesPatternAt` was made a leaner fast path:

- Advanced movement checks moved into `matchesAdvancedMovementPatternAt`.
- `matchesPatternAt` is explicitly forced inline.
- `PUZZLESCRIPT_INCREMENTAL_PRUNE` lookup is cached instead of calling `getenv` repeatedly.

### `karamell.txt` Correctness Fix

`karamell.txt` level 1 was a native correctness/parity failure:

- JS solved it in about 891 ms.
- Native exhausted after only 4 states.

Root cause:

- Native lowering froze RHS aggregate movement replacements like `moving motile` to a concrete `up` mask after canonicalizing directional rules.
- JS instead emits a dynamic `replacement_aggregate_name: "moving"` and captures the actual movement direction/layer from the matched property alias.

Fixes:

- Layer-coupled RHS aggregate directions now emit `replacementAggregateName` instead of `replacementMovementMask`.
- Native lowering now emits rule-level `PropertyBinding` records for layer-coupled properties.
- IR JSON export now includes `property_bindings`.

Verification:

- `karamell.txt` level 1 native replay passed all JS snapshots: `trace_diff_passed snapshots=48`.
- Native solver now solves it under 1000 ms, around 632-700 ms in focused runs.
- This also recovered `i am a gust of wind.txt` level 7 in the focused miss set.

## Verification Already Run

These passed after the safe fixes:

- `build/native/puzzlescript_cpp run "src/tests/solver_tests/karamell.txt" --headless --level 1 --native-compile --inputs-file /tmp/karamell_l1_solution_numeric.json`
  - Result: `trace_diff_passed snapshots=48`
- `build/native/puzzlescript_cpp run "src/tests/solver_tests/paint everything everywhere.txt" --headless --level 17 --native-compile --inputs-file /tmp/paint_l17_solution_numeric.json`
  - Result: `trace_diff_passed snapshots=249`
- `build/native/puzzlescript_solver src/tests/solver_tests --timeout-ms 1000 --jobs 1 --strategy portfolio --game "karamell.txt" --level 1 --json --quiet`
  - Result: solved, about 632 ms in the last focused run.
- `ctest --test-dir build --output-on-failure`
  - Earlier result before later regression tests were registered: `20/20` tests passed.
- `ReadLints` on modified native files
  - Result: no linter errors.
- `node src/tests/native_solver_js_coverage_node.js`
  - Result: `native_solver_js_coverage_node passed`.
- `node src/tests/run_native_solver_js_coverage.js build/native/puzzlescript_solver src/tests/solver_tests --js-results build/solver-timeout-curve/js.json --native-results build/solver-timeout-curve/cpp_current.json`
  - Result: `native_solver_js_coverage passed js_solved=772 native_solved=772 native_errors=0`.
- `make solver_js_coverage_cpp SOLVER_JS_COVERAGE_JS_RESULTS=build/solver-timeout-curve/js.json SOLVER_JS_COVERAGE_NATIVE_RESULTS=build/solver-timeout-curve/cpp_current.json`
  - Result: same zero-miss coverage check through the Make wrapper.
- `ctest --test-dir build --output-on-failure`
  - Result: `37/37` tests passed.

## Regression Tests Added

The current pass adds explicit tests for the main native/JS incongruities that came up during solver catch-up:

- `native_solver_js_coverage_node` unit-tests the comparison logic so native `exhausted`, `timeout`, or missing results are all treated as failures when JS solved that same game/level.
- `make solver_js_coverage_cpp` runs the general gate: every JS-solved corpus level at the chosen timeout must also be native-solved. It can run both solvers or reuse saved JSON with `SOLVER_JS_COVERAGE_JS_RESULTS=...` and `SOLVER_JS_COVERAGE_NATIVE_RESULTS=...`.
- `PS_ENABLE_SLOW_SOLVER_COVERAGE_TESTS=ON` adds the full corpus JS-coverage gate to CTest as `puzzlescript_solver_js_coverage_full`. It is opt-in because it runs both solvers over `src/tests/solver_tests` at 1000 ms.
- New trace replay CTest cases cover `alternatey.txt` level 4 and `expand also avoid the flames.txt` level 1, which guard native execution parity on levels that were part of the solver recovery work.
- `solver_timeout_curve_denominator_node` guards the curve renderer against comparing series with different playable-level denominators, which is what made the old `936` C++ curve look directly comparable to current JS/native runs.

## Current Remaining Focused Misses

Historical note: this list is stale after the continuation pass above. The current comparable full-corpus diff reports `js_solved_native_missed 0`.

Starting from the saved `build/solver-timeout-curve/js.json` and `cpp_after_anyhole_perf_fix.json`, rerunning the old JS-solved/native-missed set after the safe fixes left 13 focused native misses under `--timeout-ms 1000 --jobs 1 --strategy portfolio`:

- `Muraphilic Monophobic Multiban.txt` level 1
- `Two-Step Pete.txt` level 15
- `Yellow Box.txt` level 31
- `alternatey.txt` level 6
- `collapse.txt` level 2
- `die schoene steinmetzin.txt` level 5
- `expand also avoid the flames.txt` level 1
- `paint everything everywhere.txt` level 17
- `unewton.txt` level 4
- plus some strategy-sensitive cases depending on portfolio weight experiments, such as `Varifocal Nightmare.txt`, `Xorro The Chaos Warden.txt`, `the_saga_of_the_candy_scroll.txt`, and `whaleworld.txt`.

Important: do a fresh rerank before acting, because timings around 1000 ms are noisy.

## Useful Commands

Build:

```sh
make -j8 build/native/puzzlescript_cpp build/native/puzzlescript_solver
```

Run native tests:

```sh
ctest --test-dir build --output-on-failure
```

Run the thorough local correctness gate, including JS/native solver coverage:

```sh
make all_tests_thorough
```

Focused native solver run:

```sh
build/native/puzzlescript_solver src/tests/solver_tests --timeout-ms 1000 --jobs 1 --strategy portfolio --game "karamell.txt" --level 1 --json --quiet
```

Generate a comparable native timeout-curve style corpus result:

```sh
build/native/puzzlescript_solver src/tests/solver_tests --timeout-ms 1000 --jobs 1 --strategy portfolio --json --quiet > build/solver-timeout-curve/cpp_current.json
```

Note: `--jobs auto` is useful for rough signals but is not comparable to the timeout curve, which uses `--jobs 1`.

Run the JS-solved/native-solved coverage gate:

```sh
make solver_js_coverage_cpp SOLVER_JS_COVERAGE_TIMEOUT_MS=1000 SOLVER_JS_COVERAGE_JOBS=1 SOLVER_JS_COVERAGE_STRATEGY=portfolio
```

Reuse saved JSON for a quick coverage check:

```sh
make solver_js_coverage_cpp SOLVER_JS_COVERAGE_JS_RESULTS=build/solver-timeout-curve/js.json SOLVER_JS_COVERAGE_NATIVE_RESULTS=build/solver-timeout-curve/cpp_current.json
```

Build a cross-strategy native solver instrumentation pack:

```sh
make solver_instrumentation_pack SOLVER_INSTRUMENTATION_NATIVE_RESULTS=build/solver-timeout-curve/cpp_current.json SOLVER_INSTRUMENTATION_MANIFESTS=src/tests/solver_focus_group.json
```

Useful knobs:

- `SOLVER_INSTRUMENTATION_MAX_TARGETS=24`
- `SOLVER_INSTRUMENTATION_RUNS=1`
- `SOLVER_INSTRUMENTATION_DRY_RUN=true`
- `SOLVER_INSTRUMENTATION_OUT_DIR=build/native/solver_instrumentation_pack`

The pack writes:

- `manifest.json`: selected regression/hotspot/near-timeout targets
- `portfolio.json`, `bfs.json`, `wa2.json`, `wa3.json`, `wa8.json`, `greedy.json`: raw per-strategy benchmark results with runtime counters
- `summary.json`: per-strategy totals and per-target best strategy

Initial pack from saved results on 24 targets, before portfolio-profile tuning:

- `portfolio`: 6 solved
- `bfs`: 6 solved
- `wa2`: 11 solved
- `wa3`: 11 solved
- `wa8`: 9 solved
- `greedy`: 8 solved

Thirteen portfolio timeouts were solved by another single strategy in the pack, reinforcing that smarter portfolio scheduling was a high-value target.

Current portfolio-profile result after tuning:

- `make solver_js_coverage_cpp SOLVER_JS_COVERAGE_JS_RESULTS=build/solver-timeout-curve/js.json SOLVER_JS_COVERAGE_TIMEOUT_MS=1000 SOLVER_JS_COVERAGE_JOBS=1 SOLVER_JS_COVERAGE_STRATEGY=portfolio SOLVER_JS_COVERAGE_OUT_DIR=build/solver-js-coverage-native-v3`
- Result: `native_solver_js_coverage passed js_solved=779 native_solved=779 native_errors=0 timeout_ms=1000 strategy=portfolio jobs=1`
- Refreshed 24-target pack: `build/native/solver_instrumentation_pack_native_v3_portfolio.json`
- Pack result: `portfolio` solved 15/24 at 1000 ms, up from 6/24 before profile tuning and 11/24 after the first profile pass.
- Per-sample benchmark artifacts now include solver-reported `strategy`, `heuristic`, and `astar_weight`, so profile choices such as `mixed:auto:weighted-first` / `portfolio:wa2` are visible in the JSON.

Follow-up portfolio result after canonical-source investigation:

- `make solver_js_coverage_cpp SOLVER_JS_COVERAGE_JS_RESULTS=build/solver-timeout-curve/js.json SOLVER_JS_COVERAGE_TIMEOUT_MS=1000 SOLVER_JS_COVERAGE_JOBS=1 SOLVER_JS_COVERAGE_STRATEGY=portfolio SOLVER_JS_COVERAGE_OUT_DIR=build/solver-js-coverage-native-v5`
- Result: `native_solver_js_coverage passed js_solved=779 native_solved=779 native_errors=0 timeout_ms=1000 strategy=portfolio jobs=1`
- Totals vs v3: 894 solved vs 892 solved, 444 timeout vs 446 timeout, no solved-status losses.
- Newly solved relative to v3: `mazezam.txt#23`, `paint everything everywhere.txt#39`.
- `solver_portfolio_regression_tests` now guards:
  - canonical-roundtripped `limerick.txt#3` remains native-solved when JS solves it.
  - raw `kettle.txt#25` stays native-solved via BFS-first portfolio.
  - canonical-roundtripped `Legend of Swixero.txt#5` stays cheap after sound-command stripping.
- The simple no-command BFS shortcut is now restricted to all-win-condition games, which prevents canonical `limerick` (`some player on exit`) from falling into BFS-first solely because canonicalization removed non-semantic sound commands.
- BFS-first profiles are exempt from the slow-step weighted-A* lock; otherwise true BFS-friendly games such as `BIAXIAL INVASION OF SATURN` can be pulled away from BFS.

Further v6 refinement:

- Portfolio `commandRuleCount` is retained for diagnostics, but chooser decisions use `semanticCommandRuleCount`; `sfx...` commands are inert.
- The simple BFS shortcut now also requires `lateRuleCount == 0`.
- This fixed canonical `Legend of Swixero.txt#5`, which had been JS-equivalent but expanded ~36k native nodes after canonicalization because stripped sound commands moved it into BFS-first. It now solves via `portfolio:wa2` in ~5-6 ms / 366 expansions.
- Full raw-vs-canonical native v6 profile comparison: 0 profile changes.

## Next Best Work

### 1. Safe Row/Column Any-Mask Optimization

`paint everything everywhere.txt` level 17 is still a huge runtime hotspot:

- Rough focused profile before any unsafe optimization: ~94M pattern tests for only ~111 expanded nodes.
- Almost all time is in rule simulation (`step_ms`).
- Hot rules are around lines `254` through `264`.

An attempted optimization OR'd `anyObjectsPresent` / `anyMovementsPresent` into existing row masks, but this was incorrect and was reverted.

Why it was wrong:

- Existing row-mask checks mean "all these bits must be present in the line".
- `anyObjectsPresent` means "at least one of these alternatives must be present".

Correct direction:

- Add separate row/column "any overlap" masks or per-pattern row preconditions.
- Use `(lineMask & anyMask) != 0` semantics for property/aggregate alternatives.
- Keep existing required row masks unchanged.
- Verify immediately with the `paint` level 17 JS replay (`249` snapshots).

### 2. Smarter Portfolio Scheduling

Native portfolio now uses cheap native-lowered game features to choose one of four profiles:

- `balanced`: original small interleaved slices.
- `weighted-first`: long WA2 slice, then WA8/greedy/BFS.
- `high-weight-first`: long WA8 slice, then greedy/WA2/BFS.
- `breadth-first`: long BFS slice, then WA2/greedy/WA8.

The profile selector deliberately uses structural facts rather than filenames:

- `run_rules_on_level_start`
- `noaction` / action-input availability
- `again`
- random replacement usage
- rule count
- command-rule count
- movement/object write approximations
- plain vs non-plain wincondition shape

Recovered examples include:

- WA-first instead of broad BFS-first: `diesinthelight.txt#1`, `the_saga_of_the_candy_scroll.txt#18/#20/#31/#55/#58/#112/#116`, `unewton.txt#4`.
- BFS-first: `Vexatious Match 3.txt#4`, `Match-Maker.txt#9`, `kettle.txt#19/#22`, `a clear view of the sky.txt#24`.
- High-weight-first: `ALL GREEN TO BLUE.txt#11`, `Van-to-Mobile-Living-Space-Conversion Window.txt#21`, `crate guardian.txt#9`.
- Noaction/again WA-first: `The sponge what lights up the seafloor.txt#5`, `diesinthelight.txt#1`.

Do not broaden the BFS-first predicates casually. A previous broad gate regressed `Attractor Net.txt#3`, `i am a gust of wind.txt#7`, `limerick.txt#3/#7/#9`, `make way.txt#1`, and `no heroes necessary.txt#9`; those recover when command-bearing/no-level-start games stay WA-first.

Do not hardcode `w=1` globally. It was tried and reverted.

Better directions:

- Keep enriching native features, but prefer facts that come from lowering/metadata over game names.
- It is acceptable to add a JS-produced annotation sidecar for C++ runner preprocessing later; current pass intentionally used native-available facts first.
- Small strategy probes that share state are still attractive, but current searches do not share frontiers/visited sets.
- Consider trying multiple A* weights only when cheap probes suggest it, not unconditionally.

### 3. Runtime Profiling for Low-Expansion Timeouts

Low-expansion, high-time examples indicate simulation cost rather than search cost:

- `paint everything everywhere.txt` level 17: ~48 nodes in 1000 ms under portfolio.
- `expand also avoid the flames.txt` level 1: a few hundred nodes in 1000 ms.
- `collapse.txt` level 2: ~1200 nodes in 1000 ms.

Use:

```sh
build/native/puzzlescript_solver src/tests/solver_tests --timeout-ms 5000 --jobs 1 --strategy portfolio --game "paint everything everywhere.txt" --level 17 --profile-runtime-counters --json --quiet
```

Be aware runtime counters print a text line before JSON.

## Avoid These Pitfalls

- Do not compare `--jobs auto` corpus counts against timeout-curve counts.
- Do not keep broad portfolio changes without checking near-timeout solved levels for regressions.
- Do not OR property/aggregate `any` masks into existing required row masks.
- Do not remove correctness/parity metadata just for speed; several recovered games rely on it.
- Do not revert unrelated untracked files.

## Current Safe State

The safe fixes are in the working tree and verified by CTest, focused replays, focused solver guards, and a comparable single-job full-corpus diff. The unsafe row-mask optimization and naive portfolio `w=1` experiment were both reverted; the landed row-mask work uses separate required/missing/any preconditions and full candidate verification.
