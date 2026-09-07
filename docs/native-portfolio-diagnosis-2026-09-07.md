# Native portfolio diagnosis: keep the scheduler, improve the goal signal

This bounded investigation does **not** justify disabling the portfolio's timing-based lock or replacing the portfolio with one fixed strategy. The clearer next experiment is to derive heuristic guidance from rules that lead to victory. No production scheduling, heuristic, or runtime defaults change in this branch.

## Frozen sample and controls

Select 32 levels from 32 distinct games/source hashes, eight per baseline difficulty stratum: easy, near 250 ms, solved within 3 seconds but not 250 ms, and timeouts at both budgets. Selection uses only archived PR #13 baseline observations, a fixed SHA-256 ordering, and one level per game; no ablation results enter selection. Each stratum is split four/four into discovery and validation games. No scheduling policy was fitted on either partition.

This is a deliberately stratified diagnostic sample, **not** an estimate of corpus-wide solve rates. The selected cases and selection provenance are retained in [JSON](benchmarks/2026-09-07-portfolio-cases.json) and [TSV](benchmarks/2026-09-07-portfolio-cases.tsv).

Use the allocation-improved `7a6cabb7` runtime, MSVC x64 Release, 64-bit masks, one worker, no spatial cache or generated turn kernels. All strategies use compact node storage, the same `auto` heuristic, and the actual production search and player-runtime solution replay. Compilation is outside each level's deadline. Strict solves require `status == solved && elapsed_ms < budget`.

The `solver_portfolio_diagnosis` executable compiles observation hooks and a lock-disable control. `solver_portfolio_reference` compiles the same driver without those hooks. Production targets define neither the hooks nor the override. Removing the diagnostic preprocessor blocks and whitespace reproduces the original production solver source exactly.

## Results

Quiet runs use rotating/reversed configuration order after smoke warmups. Recording traces is a separate operation because instrumentation can perturb a clock-dependent decision.

| Configuration | 250 ms repeat 1 | Repeat 2 | Repeat 3 | 1 second, exploratory single pass |
|---|---:|---:|---:|---:|
| Uninstrumented production portfolio | 15 | 16 | 14 | 20 |
| Diagnostic build, normal portfolio | 15 | 15 | 16 | 20 |
| Portfolio without timing lock | 15 | 15 | 14 | 20 |
| Fixed weighted A*, weight 2 | 13 | 13 | 13 | 20 |
| Fixed weighted A*, weight 8 | 13 | 13 | 13 | 17 |
| Fixed greedy | 12 | 12 | 12 | 17 |
| Fixed BFS | 12 | 12 | 10 | 16 |

Every count is out of 32. The one-second pass was added after examining the primary results to check deeper searches; it is exploratory and not repeated acceptance evidence. All results are in the [compressed evidence archive](benchmarks/2026-09-07-portfolio-diagnosis-evidence.json.gz), with exact output hashes and stderr.

At 250 ms, disabling the lock has no consistent per-level gains or losses relative to the normal diagnostic portfolio. None of the four fixed strategies consistently solves a level that the portfolio consistently misses. Fixed strategies do consistently lose some levels. Their union of consistent solves contains 14 cases, while the normal diagnostic portfolio consistently solves 15; these are not claims about the full corpus or an implementable omniscient selector.

The conclusion is also unpromising on the reserved validation games: normal portfolio solves 7/7/8 of 16, no-lock 7/7/6, fixed weight-2 and weight-8 each 7/7/7, greedy 6/6/6, and BFS 6/6/4. The uninstrumented reference varies 7/8/6 on this partition. Small differences around the deadline are within the observed reference variation; do not attribute them precisely to the probes or lock policy.

## What the lock actually does

Once at least 128 nodes have been expanded, eligible portfolio profiles can lock to their **first weighted-A* lane** if accumulated simulation time per generated successor exceeds 50 microseconds. This lane can be named `wa3`, `wa2`, or `wa8`, depending on the profile. A shallow BFS probe may remain available. The condition can become true much later than expansion 128.

In the separate 250 ms trace, four cases lock:

| Game, zero-based source level | Lock expansion | Measured microseconds/successor |
|---|---:|---:|
| it dies in the light, 2 | 128 | 61.6 |
| sacrament of the river god, 3 | 128 | 278.1 |
| paint everything everywhere, 37 | 128 | 122.5 |
| witch lifter, 9 | 1,133 | 50.08 |

All four time out in both explanatory traces. Disabling the lock changes which lanes run for `sacrament of the river god` and `paint everything everywhere`; `it dies in the light` and `witch lifter` remain entirely in their initial `wa3` slice even without locking. The lock therefore cannot be assumed to change the explored sequence immediately whenever it fires.

Fifteen of 32 normal traces expand nodes from just one lane. Some configured slices are large enough to consume the entire short deadline. That alone is not evidence of a bug: fixed-strategy comparisons do not support forcing more frequent switching. Crucially, the portfolio shares nodes and expanded-state bookkeeping already; these are not independent searches repeating all work.

The diagnosis credits work to the lane that **selected** the node. The existing lock can change the active lane before that node's successors are generated, so simply reading the current lane at successor time would misattribute work. It records bounded switch events, expansions, generated/retained/duplicate/no-op successors, existing simulation timer deltas, parent/child heuristic comparisons, and improvements in the best observed score. Event timestamps are collected only at switches.

## The more actionable gap: goals that the heuristic cannot see

`HeuristicContext::score` returns zero whenever the compiled `winConditions` array is empty. Such games can still win through a rule's `win` command. The full-corpus baseline metadata contains **13 games and 42 playable levels with no explicit win conditions**; only 10 of those levels pass the strict cutoff in the referenced 250 ms baseline observation. The archive retains these observations and the originating output hash. This is an addressable coverage count, not a prediction of extra solves; no proof is made that every remaining level is solvable.

Examples from the sample:

- `castlecloset` issues `win` from `[ Action Player | Car ]`. All accepted nonwinning states in the trace have heuristic zero. It nevertheless solves, so a flat heuristic does not imply failure.
- `cratopia` and `witch lifter` also use victory commands and start/remain at heuristic zero. Both time out in the 250 ms trace.
- `midas` has `SOME Love`, but rules create `Love` as the final consequence of reaching the target. All accepted nonwinning states in its trace score 80.
- `Any hole is a goal` has `SOME headafter_1`, also created by rules at completion. Its accepted nonwinning states likewise score 80, although this case solves.

These five cases have no score variation among accepted nonwinning successors in the trace. Across the 16 normal-portfolio trace timeouts, nine spend at least the last 90% of expansions without improving the globally best observed heuristic. Some successful searches also have long stretches like this; this statistic suggests where to inspect, but does not prove stagnation caused the timeout or that a new heuristic will help.

There is a specific trap in `witch lifter`: `has_won` is produced, conditionally removed by later checks, and finally consumed by a `win` rule within the late phase. Merely treating `has_won` as a target object in settled search states supplies no useful signal. A goal model needs the rules that produce it and their execution order, not just the final marker's name.

## Decision and next experiment

Keep the existing scheduler and PR #13 runtime. This sample does not support removing the lock, selecting one fixed strategy globally, or adding more weight variants. It does not establish the cause of the earlier spatial-cache deadline result, because that cache was not enabled in this investigation.

The next bounded experiment should build **ruleset-derived goal guidance**, starting with victory-command predicates and predicates that create terminal goal objects. Reuse the ruleset plan across levels. Begin with explicitly supported rule shapes and fall back when unsupported; do not jump to a complete planner or assume a game genre. Handle transient movement/action predicates and late-rule ordering explicitly. Approximate scores may order search, but must not certify impossibility or prune branches.

Measure whether the new signal reduces expansions to known solutions, then test deadline solves on held-out games. A score with more variation is not itself a success criterion. The source-level gaps here justify that experiment; they do not promise a speedup.

## Validation and reproduction

- Both diagnostic and uninstrumented reference targets build successfully.
- At a 64-expansion cap (before locking can affect subsequent expansion selection), tracing and quiet execution produce identical result counts and complete solutions for all 32 cases.
- With locking disabled at a 256-expansion cap, tracing and quiet execution again agree on all 32. Neither check hits its wall watchdog.
- Each traced case asserts that per-lane expansion and successor counts equal the production totals. Normal lock events satisfy expansion ≥128 and observed cost >50 microseconds; no-lock traces have no lock events. No switch events were dropped.
- Every returned solution goes through the production player's replay check. No level/replay errors or unexpected generated kernels occur.
- Quiet and trace runs, warmups, exact hashes, selection data, and detailed [250 ms summary](benchmarks/2026-09-07-portfolio-diagnosis.json) are preserved. The archive is round-tripped against every recorded output hash.

Build `solver_portfolio_diagnosis` and `solver_portfolio_reference` with the ordinary native Release configuration. The targets are excluded from the default build. With the checked-in frozen sample:

```text
node src/tests/run_portfolio_diagnosis.js DIAGNOSTIC_EXE REFERENCE_EXE src/tests/solver_tests docs/benchmarks/2026-09-07-portfolio-cases build/portfolio-study
node src/tests/summarize_portfolio_diagnosis.js build/portfolio-study docs/benchmarks/2026-09-07-portfolio-cases.json build/portfolio-summary.json
node src/tests/run_portfolio_diagnosis.js DIAGNOSTIC_EXE REFERENCE_EXE src/tests/solver_tests docs/benchmarks/2026-09-07-portfolio-cases build/portfolio-study-1000 1000 1
```

To recreate selection rather than use the frozen cases, `select_portfolio_diagnosis_cases.js` takes the archived 250 ms baseline directory, the earlier PR #13 three-second directory, the corpus, and an output prefix. The 250 ms input uses `before-N` records; the three-second input uses `after-N` records because those are the allocation-improved PR #13 binaries.
