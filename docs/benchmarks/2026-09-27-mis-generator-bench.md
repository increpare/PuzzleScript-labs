# PuzzleScript+MIS generator benchmark set (27 September 2026)

A frozen set of levels for measuring the web level generator
(`src/js/mis/mis_generator.js`), a baseline run of every generator on it, and
a profile of where the benchmark's time goes. Tool:
`src/tests/mis_generator_seed_survey_node.js`.

## How the set was built

1. **Seeds** (`src/tests/mis_generator_seeds.json`): every level in
   `src/tests/solver_tests` that the native solver (WebAssembly, one job)
   solves in under 500 ms. That gives 716 levels from 116 games. Games with
   random rules, or whose native and JS object tables differ, are skipped.
2. **Survey**: every generator the app derives for the game (move, walls-N,
   pair, backward, no, mix) ran on every seed for 3 s. That's 3,710 runs,
   with random seed 7.
3. **Rejudge the slow levels.** A fixed 3 s was unfair to slow games. Runs
   that judged fewer than 10 candidates found a harder level on 68% of
   levels, against 91–99% for faster runs. So every level the survey found
   unproductive, or where a run hung, was rerun with a **candidate budget**:
   run until 30 candidates are judged, for at least 3 s and at most 30 s
   (`survey --rejudge survey.json`). That was 96 levels. **57 of them found
   harder levels once they had enough time.**
4. **Cull** (`src/tests/mis_generator_bench_seeds.json`, `cull --cap 4 --pick spread`):
   - 88 levels with solver effort ≤ 10 were dropped (too trivial to improve on).
   - 20 levels with a hung run were dropped. That's a native turn that can't
     be interrupted, which costs the full deadline and measures nothing.
     That was *paint everything everywhere* 14, *castlemouse* 3, and one each from *constellationz*, *der hydra krypta* and *match three billiards*.
   - 27 levels where no generator found a harder level were dropped.
   - Each game keeps at most **4** levels, **spread over its difficulty**: the
     easiest, the hardest, and evenly spaced levels between, by seed solver
     effort. Choosing the most productive levels instead would favour levels
     that got lucky in one run, and ones where generators already succeed.
     That leaves less room to measure improvements. 262 levels were dropped
     by the cap.

Result: **319 levels from 103 games**. 60 games are at the cap, and the top 10
games hold 13% of the levels. Seed effort ranges from 11 to 23,540 (median
450). The median board has 72 cells.

## Baseline run

Every generator on every benchmark level with the candidate budget. It used a
fresh random seed (11), not the one used for selection. Compact results with
per-phase times are in `2026-09-27-mis-generator-bench.json`.

- **62% of runs** found a harder level. That's 1,722 runs in 113 min on 4
  threads, 3 of which hung.
- **299 of 319 levels (94%)** had at least one productive generator. Only
  *big dog and little dog* and *pipe puffer* had no productive level.

| Generator | Runs | Found harder | Median lift when found | Median solvable % | Mean s/run |
| --- | ---: | ---: | ---: | ---: | ---: |
| move | 318 | 75% | 1.32 | 51% | 15.6 |
| walls | 743 | 67% | 1.36 | 60% | 14.6 |
| mix | 298 | 57% | 1.56 | 13% | 14.1 |
| no | 75 | 53% | 1.67 | 40% | 17.4 |
| pair | 165 | 52% | 1.46 | 23% | 16.0 |
| backward | 120 | 31% | 1.09 | 92% | 15.7 |

Compare generators by the per-run columns. With a candidate budget, slow
games run longer, so harder-levels-per-minute is not comparable with the
fixed-3-s survey.

## Profile: where the benchmark's time goes

| | |
| --- | --- |
| Total | 452 thread-minutes (113 min on 4 threads) |
| Median run | 7.6 s |
| Runs stopped at 3 s (30 candidates judged by then) | 37% |
| Runs hitting 30 s before 30 candidates | 31% of runs, **64% of the time** |
| Hung runs | 3 (*a distant sunset* 2, *match three billiards* 1): 1% |
| Top 10 games by time | 28% (*castlecloset*, *manic_ammo*, *chaos wizard*, *cooperacing*, *castlemouse*, …) |
| Seed baseline assessment | 4% |

Generator phases, as a share of generator time:

| Phase | All runs | Runs hitting 30 s |
| --- | ---: | ---: |
| Primary solve that timed out | 33% | 41% |
| Difficulty lanes (refine) | 28% | 26% |
| Shortest-length proof (BFS) | 20% | 18% |
| Primary solve proving unsolvable | 12% | 8% |
| Transform | 6% | 7% |
| Primary solve that solved | 1% | 0% |

The slow runs are dominated by **timeouts at the generator's solver budget
cap**. The per-candidate budget starts at 200 ms and doubles on each timeout
until something solves, up to 5 s (`maxBudgetMs`). In 371 of the 539 runs
that hit 30 s, it ended at the 5 s cap. Only 15% of those runs' candidates
time out, but they take 41% of the time, and the generator learns nothing
from them. The same happens in the app on slow games. Options:
- Start the budget from the seed's own solve time instead of doubling up
  from 200 ms.
- Lower the cap relative to the seed's solve time.
- Retry parked timeouts less often.

Cheaper benchmark tiers, from the recorded run times: capping runs at 15 s
would take ~64 min, and at 10 s ~48 min. Slow games would then judge fewer
candidates.

## Reproducing

```sh
S=src/tests/mis_generator_seed_survey_node.js
node $S seeds                                               # step 1
node $S survey --seconds 3 --out survey.json                # step 2 (fixed 3 s)
node $S survey --rejudge survey.json --out rejudged.json    # step 3 (candidate budget)
node $S cull rejudged.json                                  # step 4 (cap 4, spread)
node $S survey --seeds src/tests/mis_generator_bench_seeds.json --seed 11 --out bench.json
node $S report bench.json
```
