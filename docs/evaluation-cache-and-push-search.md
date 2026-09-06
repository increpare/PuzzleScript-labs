# Shared candidate evaluation and a conservative push-search prototype

## Shared evaluation

`search::DifficultyEvaluator` owns a compiled game and its initial session state.
Each solver lane is keyed by the complete layer grid, dimensions, gameplay seed,
strategy, heuristic, expansion cap and requested time budget. Hash collisions are
resolved by equality. Caches are process-local, so runtime versions cannot mix.

Completed solved/exhausted lanes retain their outcome, solution and work counts.
Timeouts, errors and interrupted work are not retained, including capped lanes.
The same board can therefore be retried at the same or a larger budget. Difficulty
gates and progress callbacks execute separately for each assessment, even on a
cache hit. Reported elapsed/work fields describe the original search, not lookup
time. They are measurements of solver effort, not intrinsic puzzle difficulty.

Identical concurrent lane requests share one search. A cancelled waiter exits
without cancelling its owner; a cancelled owner releases the entry so a live
waiter can retry. Exceptions also release pending entries. The deadline callback
stops cached searches independently of their configured policy budget, keeping
portfolio scheduling consistent with the cache key. Cancellation is cooperative
between runtime turns, as in the existing solver.

LRU eviction takes constant expected time. Defaults are 4,096 lane entries and
32 MiB of estimated retained key/result storage. The bound excludes the owned
compiled game, active solver work, pending keys and allocator overhead. If all
entry slots are pending, another distinct request runs without cache admission.
For level-set generation, `--dedupe-max` sets the lane-entry ceiling; the 32 MiB
retention budget still applies. No persisted cache is introduced.

Native level-set workers share an evaluator. MIS bridges share one across cloned
worker contexts; recompilation installs a fresh evaluator without invalidating
old workers. The headless test compiles the production MIS bridge, candidate
conversion and difficulty adapter and replays editor-encoded moves through its
gameplay bridge. The openFrameworks GUI itself was not built here.

The former level-set hash-only suppression is gone. Exact keeper comparison is
per block, including a second check under its lock at admission. A board seen by
one recipe block no longer prevents another block from considering it. Legacy
single-recipe generation still uses its existing sample-seeded solve adapter and
dedupe policy; this change does not claim cache reuse there.

Level-set JSON includes `evaluation_cache`: `hits`, `searches` (owner attempts),
`waits` (5 ms wait iterations, not unique waiters), `entries` and `retained_bytes`.
Existing `totals.solver_searches` continues to count candidate assessments;
`totals.deduped` now counts exact duplicates of retained keepers in that block.

**Initial cache-only measurement, superseded by the follow-up below:** three
[recorded 200-sample runs](benchmarks/2026-09-06-generator-evaluation-cache.json)
each reused 32 lanes, performed 182 lane attempts, retained two keepers and had
no interrupted assessments. End-to-end times were 220/215/212 ms. The earlier
bounded-run baseline was 224/212/211 ms: this small preset does **not** demonstrate
a wall-clock speedup. Reuse and correctness improve, but generation overhead,
scheduling and tiny searches dominate this example.

## Follow-up: measured improvements against GitHub master

The coordinator still slept for up to 50 ms after each level-set block finished,
and the legacy generator could sleep for 250 ms after completing a sample quota.
Workers now notify a condition variable when they finish. The completion updates
and waiting predicates synchronize through a mutex to prevent lost wakeups.
External stop polling remains bounded; legacy deadlines wake at the deadline
instead of the next dashboard tick. Already-admitted samples still finish.

The [paired generator comparison](benchmarks/2026-09-06-generator-master-comparison.json)
uses a fresh build of master `fb1fd820`, matching MSVC Release flags, 64-bit masks
and the same linked Sokoban kernels. Each case has a warmup per executable and
five alternating before/after pairs. Times include process startup, compilation,
generation, solving, output writing and shutdown. Seed 11, 50 ms solver budgets
and 60-second run limits are identical.

| Recipe / samples / workers | Master median | Updated median | Speedup | Identical retained output |
| --- | ---: | ---: | ---: | --- |
| Level-set / 200 / 1 | 215 ms | 117 ms | 1.84x | Yes |
| Level-set / 2,000 / 1 | 888 ms | 595 ms | 1.49x | Yes |
| Level-set / 200 / 4 | 146 ms | 56 ms | 2.61x | No: scheduling varies |
| Legacy / 20 / 1 | 545 ms | 374 ms | 1.46x | Yes |
| Legacy / 200 / 1 | 3,424 ms | 3,242 ms | 1.06x | Yes |

Output equality includes boards, scores and solution sequences, not merely
keeper counts. The parallel case has two keepers in every run but different
output hashes in both versions; do not describe it as an identical-output
comparison. These timings demonstrate a real gain for bounded jobs; completion
wakeups alone do not accelerate steady-state search during an unbounded run.

The independent [push comparison](benchmarks/2026-09-06-microban-push-comparison.json)
covers Microban levels 3–10 from the unchanged repository source, excluding the
first two prototype fixtures. At 500 ms per level, the normal native portfolio
solves 7/8 and push search solves 8/8 in each of five alternating pairs. Median
whole-batch process time falls from **1,428 ms to 190 ms (7.51x)**. Every distinct
solution from either solver passes JavaScript replay outside the measured
interval; native replay is included. This establishes a benefit on eight further
standard Sokoban levels, not broad coverage of arbitrary PuzzleScript mechanics.
The push implementation remains opt-in through its dedicated executable and
does not change generator difficulty scores.

Reproduce with:

```sh
node src/tests/compare_generator_performance.js BASE_GENERATOR NEW_GENERATOR generator-comparison.json 5
node src/tests/compare_push_performance.js NATIVE_SOLVER PUSH_SOLVER push-comparison.json 5
```

The generator benchmark hashes each binary and records output hashes and full
per-run counters. The push benchmark stores outcomes, expansion counts, solution
lengths and solution hashes. Hardware and compiler settings should accompany
new records; these scripts do not enforce machine-specific timing thresholds.

## Push-search experiment

Build `puzzlescript_push_solver` and run:

```sh
puzzlescript_push_solver src/demo/sokoban_basic.txt 0 5000
```

Arguments are source file, optional zero-based native level index, and optional
total timeout in milliseconds. JSON reports eligibility, outcome, expanded
states, push count, numeric native inputs, and a fallback/limit reason. Input
encoding is `0=up, 1=left, 2=down, 3=right, 4=action, 5=tick`.

Eligibility requires exactly the five standard named Sokoban objects, the single
standard push rule, conventional three-layer collision layout, one standard
ALL-on win condition, cosmetic metadata only, exactly one player, and equal
nonzero crate/target counts. Boards are limited to 4,096 cells. This deliberately
rejects valid variations; unsupported games use the existing generic assessor
with the remaining deadline, rather than being declared unsolvable.

For eligible games, BFS expands pushes. Walking reachability finds legal pushing
positions; the smallest reachable player cell represents the entire reachable
region in exact visited keys. Crate positions are sorted. Parent edges retain
actual walking paths so solutions still consist of ordinary inputs. Reverse
reachability from targets supplies sound static dead squares for this restricted
rule set. It ignores other crates, which makes the test conservative.

The prototype minimizes pushes, not total keypresses. It caps stored search
nodes at 200,000; budget limits return TIMEOUT/unknown. Every solution is replayed
using the ordinary native interpreter before returning SOLVED. Initially won
boards use an action input to trigger the runtime win check. The first two demo
solutions also pass JavaScript replay. The first demo expands 19 push states and
finds an eight-push solution; that is not an apples-to-apples node-speed comparison
with input-space search.

This is a separate experimental executable/library. It is not enabled in normal
solver portfolios or generator scoring. Before promoting it, measure eligible
coverage and fixed-budget results on held-out multi-crate games, extend negative
and multi-crate differential checks, and decide how to report push-space effort
without changing the meaning of existing difficulty scores.

## Verification

- Forced hash collisions, LRU and byte/entry limits, timeout retry, exceptions,
  eight concurrent requests doing one computation, independently cancelled
  waiters, and retry after owner cancellation.
- Real difficulty assessor: seed/board/dimension/budget isolation, primary reuse,
  supplemental reuse, per-request gates, cancellation and fresh cache isolation.
- Production MIS bridge/adapter: successful assessment, four completed lane hits
  across clones, progress stages, replay, cancellation, malformed grids, stale
  object IDs and recompilation isolation.
- Push search: 1,920 exhaustive one-crate boards covering every floor mask and
  legal placement in a 3x2 interior. Solved **and exhausted** outcomes match exact
  native input-space BFS. Two ordinary multi-crate demo levels solve and replay;
  node limits and unsupported-rule/metadata/multiple-player fallbacks are tested.
- Existing generated replay, JS/native solver parity, difficulty, keeper,
  exhaustion, generator budget, legacy event, level-set and remix checks.

Validated on Windows/MSVC Release with linked 64-bit-mask Sokoban kernels for
generator tests. These checks do not establish general PuzzleScript correctness,
other-platform build coverage, or a broad end-to-end speedup.
