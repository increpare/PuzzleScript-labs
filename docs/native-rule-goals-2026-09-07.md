# Ruleset-derived victory guidance: bounded native experiment

The opt-in `--solver-heuristic rule-goals` produces two consistent additional
solves below 250 ms on the affected corpus slice. This is targeted progress,
not a general solver breakthrough. Auto remains the default.

This branch starts at `master` commit
`fb1fd820ecf6c106708a7dc60015c57f09bd9b8d`. It contains none of the allocation,
spatial-cache, or portfolio-diagnostic changes from PRs #13–#15. Both benchmark
arms use the same executable and unchanged interpreter, differing only in the
selected heuristic. The previous diagnostic findings motivated the experiment;
its implementation does not depend on that branch.

## What changed

The existing heuristic returns zero when a game has no explicit WINCONDITIONS.
A plain SOME goal whose witness object is created at completion often gives a
constant absent-object penalty instead. Neither signal tells the search how to
approach a victory rule.

`RuleGoalPlan` reads positive object requirements from command victories and
constant object-producing replacements. For a plain, non-aggregate SOME goal,
it follows producers up to three levels; for command victories it follows
required-object producers up to two. A row retains its direction, cell offsets,
and board-boundary constraints. Required objects in a cell are conjunctive;
property alternatives are disjunctive; independently matched rows contribute
separate minima. Producer effects stay anchored to their output cell.

At each search state, obstacle-free Manhattan distance fields estimate the
cost of satisfying those patterns. A producer costs one relaxed production
plus its required-object costs. This is not a number of input turns. Identical
expressions are interned and unused dependencies removed, avoiding redundant
board scans without changing scores. The survey compared compacted and original
plans on 1,632 initial/arbitrarily perturbed boards with identical results.

No object names or crate/target/player-count assumptions appear in this logic.
The immutable plan is shared by owning ruleset identity across levels and solver
workers. Its cache holds weak ruleset owners, removes expired entries, and does
not mistake a reused address for the same ruleset. Per-search storage consists
of board-sized distance fields; no per-level rule-flow analysis is added.

The native generator has a separate search implementation. This change does
not wire the new heuristic into generation or measure generator throughput.
The plan/context split makes ruleset reuse possible when that integration is
evaluated separately.

## Limits of the approximation

The estimate relaxes negative predicates, deletes, action and movement guards,
cross-cell binding correlations, early/late execution order, and rigid failures.
Ellipsis patterns, random rules, random entity producers, and rules issuing
cancel/restart are omitted. A dynamic property replacement can still supply a
known constant object effect; its binding correlations remain relaxed.

Consequently, neither zero nor the finite missing-producer fallback proves
anything about victory or impossibility. Scores only order queues; they never
prune states or replace the real engine. Cyclic producer references terminate
through the depth limit. This experiment is not an admissible heuristic and
does not preserve shortest solutions: for example, `midas` source index 25
changes from a 10-input solution to a 13-input solution while solving faster.

Mixed/aggregate goals and explicit ALL/NO/ON conditions fall back to Auto.
Command victories mixed with explicit conditions also fall back. The serial
portfolio retains Auto for its BreadthFirst profile: its first 35,000 expansions
ignore heuristic ordering, and eagerly computing the new score caused a real
deadline regression. Explicit weighted-A*/greedy searches can still use the
new heuristic for those games. Parallel portfolio lanes are independently
ranked and are not subject to this serial-profile fallback.

This does not solve the difficult `witch lifter` case. Its temporary `has_won`
marker is produced and then conditionally removed by later rules; relaxing that
ordering removes the constraints that matter. It remains a timeout on the hard
levels. Supporting it needs an analysis of surviving victory predicates, not
more optimistic marker-distance scoring.

## Coverage and results

Survey: 184 games, 1,346 playable corpus levels. Sixteen games / 102 levels have
supported goal shapes. Twelve games / 47 levels use the new score in the serial
portfolio; four games / 55 levels use its breadth-first fallback. Coverage is
structural eligibility, not a claim that every eligible game gets useful guidance.

Measured plan setup for all 184 rulesets totals **7.672 ms**, maximum **1.002 ms**
for one ruleset. These are single survey measurements, not a stable performance
distribution. Both benchmark arms warm the plan before level deadlines, as
appropriate for repeated-level use. A cold CLI search charges its first plan
construction to that level's deadline.

Three serial, alternating Auto/rule-goals pairs at **strictly less than 250 ms**:

| Pair | Auto | Rule goals | Difference |
|---|---:|---:|---:|
| 1 | 20 | 22 | +2 |
| 2, reversed order | 20 | 23 | +3 |
| 3 | 20 | 22 | +2 |

Two consistent gains, zero consistent losses. The one extra solve in pair 2
was `Any hole is a goal` index 23, which uses the unchanged Auto fallback; it is
timing variation and is not credited to the new scoring.

Selected results below use zero-based source indices, including message entries.
Times are medians of the final three pairs; timeout expansion counts vary with
the deadline. Reported elapsed time includes loading, search, and independent
player-runtime victory replay. Compilation and warmed ruleset setup are excluded.

| Game / source index | Auto | Rule goals | Expanded states |
|---|---:|---:|---|
| Hole-Stuffer / 1 | 3 timeouts | 203 ms | 2,516–2,938 before timeout → 2,219 to a replayed win |
| midas / 29 | 3 timeouts | 165 ms | 1,928–2,479 before timeout → 794 to a replayed win |
| castlecloset / 0 | 183 ms | 8 ms | 2,695 → 55 |
| midas / 2 | 22 ms | 3 ms | 318 → 39 |
| midas / 25 | 171 ms | 124 ms | 1,609 → 774; solution becomes longer |

The fixed expansion reductions on common solves are more persuasive than small
timing changes. The scope remains small: this is not a new full-corpus battery
result, a held-out evaluation, or evidence of a broad gain at one/three seconds.

Exploratory results are retained, not silently discarded:

- Initial portfolio pair before expression compaction: 21 → 23.
- Initial fixed weighted-A* pair: 21 → 22. It adds one `Any hole is a goal`
  solve but does not justify replacing the portfolio wholesale.
- Three pairs after compaction but before the breadth-first fallback:
  21 → 23, 20 → 21, 20 → 22. `cratopia` index 5 performs the same 764
  expansions but slows from 67–88 ms to 229–250 ms, including one timeout.
  That observation motivated the ruleset-profile fallback before final reruns.

The final measurements informed no further heuristic tuning. The fallback was
chosen after examining exploratory results; no claim of independent holdout
validation is made.

## Validation and reproduction

- Focused native tests: action-only victories, producer chains, OR/AND masks,
  independent rows, negative-guard relaxation, absent cyclic producers,
  unsupported ellipsis/cancel and ALL/NO/ON fallback, cache identity, and object
  IDs across mask-word boundaries.
- CLI smoke with the opt-in heuristic: BFS/weighted-A*/portfolio, compact/full
  state storage, command and producer victories. All wins replayed.
- Existing solver smoke: all 16 cases pass; deterministic smoke passes five
  serial repeats plus its automatic-worker check.
- Existing native gameplay: 470/470 pass.
- Every solved result in all benchmark arms passes the production independent
  replay; no compile/level/replay errors occurred.
- No JS solver battery was run. Tests here used 64-bit object masks.

Build Release targets `puzzlescript_solver`, `rule_goals`, and `rule_goal_bench`.
The benchmark target is excluded from the normal build. Example commands:

```text
node src/tests/run_rule_goal_smoke.js build/native/Release/puzzlescript_solver.exe
node src/tests/run_rule_goal_bench.js build/native/Release/rule_goal_bench.exe src/tests/solver_tests build/rule-goals-repeat
node src/tests/summarize_rule_goal_bench.js build/rule-goals-repeat build/rule-goals-repeat-summary.json
```

The runner strips PUZZLESCRIPT environment overrides, hashes the binary and every
surveyed source, records run order, and asserts identical case lists and expected
native execution/storage modes. It uses one worker, compact nodes, exact state
keys, and the existing portfolio. No previous experimental runtime is linked.

Artifacts:

- `benchmarks/2026-09-07-rule-goals.json`: final per-level comparison.
- `benchmarks/2026-09-07-rule-goals-survey.jsonl`: coverage, setup, and score checks.
- `benchmarks/2026-09-07-rule-goals-evidence.json.gz`: raw final/exploratory runs,
  source/binary hashes, replayed solutions, and validation logs.

The next useful extension is better treatment of negative and late-phase victory
constraints, with a bounded analysis reused across levels. First measure whether
it exposes a real signal on currently flat games. Keep this experiment opt-in
until broader benefit and acceptable scoring costs are established.
