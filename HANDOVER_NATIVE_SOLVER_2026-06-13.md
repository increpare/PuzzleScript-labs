# Native Solver Handover - 2026-06-13

## Goal

Continue restoring and improving the native C++ solver until every level solved by the JavaScript solver under the same timeout is also solved by native C++ within that timeout, ideally with a large speed margin.

Current broad state from the latest comparable focused work:

- Native C++ is ahead of the saved JS corpus in aggregate (`cpp_after_anyhole_perf_fix.json`: 860 solved vs `js.json`: 772 solved at 1000 ms).
- There are still JS-solved/native-missed individual levels. After the latest safe fixes, the focused JS-solved/native-missed list dropped by two more levels.
- A parallel full-corpus run is not comparable to `solver_timeout_curve.js` because the timeout curve script uses `--jobs 1`; parallel runs create CPU contention and undercount solved levels.

## Files Modified

Primary files touched by the current work:

- `native/src/compiler/lower_to_runtime.cpp`
- `native/src/cli/main.cpp`
- `native/src/runtime/core.cpp`
- `native/src/runtime/core.hpp`

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
  - Result: `20/20` tests passed.
- `ReadLints` on modified native files
  - Result: no linter errors.

## Current Remaining Focused Misses

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

Focused native solver run:

```sh
build/native/puzzlescript_solver src/tests/solver_tests --timeout-ms 1000 --jobs 1 --strategy portfolio --game "karamell.txt" --level 1 --json --quiet
```

Generate a comparable native timeout-curve style corpus result:

```sh
build/native/puzzlescript_solver src/tests/solver_tests --timeout-ms 1000 --jobs 1 --strategy portfolio --json --quiet > build/solver-timeout-curve/cpp_current.json
```

Note: `--jobs auto` is useful for rough signals but is not comparable to the timeout curve, which uses `--jobs 1`.

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

Portfolio currently does:

- BFS for `timeoutMs / 6`
- Weighted A* for the remaining budget using default `astarWeight` (`2`)

Findings:

- `alternatey.txt` level 6 solves with pure BFS in ~477 ms, but portfolio misses because BFS only gets ~166 ms.
- `Two-Step Pete.txt` level 15 solves with greedy or weighted A* weight 3, but default portfolio misses.
- `Varifocal Nightmare.txt`, `Xorro The Chaos Warden.txt`, `the_saga_of_the_candy_scroll.txt`, and `whaleworld.txt` can be recovered by changing A* weight, especially `w=1`.
- A naive portfolio switch to `w=1` recovered several focused misses but caused broad regressions, for example `Legend of Swixero.txt` level 9.

Do not hardcode `w=1` globally. It was tried and reverted.

Better directions:

- Adaptive portfolio based on cheap game/rule/level features.
- Small strategy probes that share state are ideal, but current searches do not share frontiers/visited sets.
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

The safe fixes are in the working tree and verified by CTest and focused replays. The unsafe row-mask optimization and naive portfolio `w=1` experiment were both reverted.
