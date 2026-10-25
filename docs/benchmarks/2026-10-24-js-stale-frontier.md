Keep stale-frontier skipping enabled in the JavaScript solver. When a shorter
path replaces a queued state, the older entry retains its snapshot and parent
chain but no longer needs expansion. A stable visited record identifies the
current path without rehashing the board on each pop. Hash collisions retain
separate exact-state records. BFS, weighted/greedy searches, push-space search
and the adaptive portfolio use the same check.

Four serial full-corpus runs used weighted A*, one worker, a 125 ms deadline,
and disabled/enabled/enabled/disabled ordering. Each run covered 2,790 entries:
1,346 playable levels and 1,444 messages. The base was `0c891237`.

| Measure, on all 491 levels solved in every run | Disabled mean | Enabled mean | Change |
| --- | ---: | ---: | ---: |
| Expanded nodes | 205,652 | 200,675 | -2.42% |
| Generated transitions | 989,941 | 965,789 | -2.44% |
| Search time | 16,403 ms | 15,126 ms | -7.79% |
| Simulation time | 12,400 ms | 11,362 ms | -8.37% |

All 491 solutions were identical across all four runs. The 4,977 saved
expansions exactly matched obsolete entries on those levels. All 524 distinct
solutions from the enabled runs replayed through the saved pre-change runner.
Deadline solve counts were 508/512/521/502; these are timing-sensitive results,
not a deterministic solve-count improvement.

A separate control compared the unchanged runner with the enabled version on
30 levels that never reopen a state. Three fresh processes per variant each
performed one warmup and six measured repetitions. Both expanded 18,142 nodes
and generated 88,012 transitions per repetition. Mean wall time was 3,726.10
versus 3,740.75 ms (+0.39%); after subtracting measured compilation time it was
3,659.87 versus 3,676.16 ms (+0.45%). This small bookkeeping cost is outweighed
by the measured work reduction. The four corpus trials establish a useful
gain, without estimating a narrow confidence interval for the timing change.

`frontier_pops`, `stale_frontier_entries`, and `stale_pops` distinguish queue
traffic, detected obsolete entries, and entries actually skipped. Set
`PUZZLESCRIPT_SOLVER_SKIP_STALE=0` for the disabled control; the benchmark-store
configuration records the setting. For example, run the following command in
each of the four configurations above:

```sh
node src/tests/run_solver_tests_js.js src/tests/solver_tests --strategy weighted-astar --jobs 1 --timeout-ms 125 --quiet --json
```

Validation passed all 794 ordinary JS fixtures and the auxiliary random-replay,
sparse-path and stale-frontier tests. The latter covers collision separation,
old-parent reconstruction, disabled skipping, and real reopening searches with
both visited representations. [Aggregates and per-game results](2026-10-24-js-stale-frontier.json)
are retained alongside this report.
