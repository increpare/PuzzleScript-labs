# PuzzleScript+MIS generator benchmark set (27 September 2026)

A frozen set of levels for measuring the web level generator
(`src/js/mis/mis_generator.js`), and a baseline run of every generator on it.
Tool: `src/tests/mis_generator_seed_survey_node.js`.

## How the set was built

1. **Seeds** (`src/tests/mis_generator_seeds.json`): every level in
   `src/tests/solver_tests` that the native solver (WebAssembly,
   one job) solves in under 500 ms. That gives 716 levels from 116 games.
   Games with random rules, or whose native and JS object tables differ, are
   skipped.
2. **Survey**: every generator the app derives for the game (move, walls-N,
   pair, backward, no, mix) ran for 3 s on every seed. That's 3,710 runs
   (random seed 7).
3. **Cull** (`src/tests/mis_generator_bench_seeds.json`):
   - drop 91 levels with solver effort ≤ 10. They're too trivial to improve on.
   - drop 95 levels where no generator found anything harder.
   - keep at most **6 levels per game** (the cap). Prefer levels where more
     generators found harder levels, then the larger lift (top-8 mean effort ÷
     seed effort). This dropped 144 levels.

Result: **386 levels from 97 games**. 40 games are at the cap, the median game
has 4 levels, and the top 10 games hold 16% of the levels. Seed effort ranges
from 11 to 13,908 (median 272). The median board has 65 cells.

## Baseline run

Every generator on every benchmark level, 3 s each, on 4 threads (~26 min). It
used a different random seed (11) from the survey the cull was based on, so the
numbers aren't inflated by the selection. Compact results:
`2026-09-27-mis-generator-bench.json`.

| | Full seed set (seed 7) | Benchmark set (seed 7, used for selection) | **Benchmark set (seed 11)** |
| --- | ---: | ---: | ---: |
| Runs finding a harder level | 52% | 64% | **58%** |
| Levels with a productive generator | 584/716 (82%) | 386/386 | **348/386 (90%)** |

By generator type, on the seed-11 run:

| Generator | Runs | Found harder | Median lift when found | Median solvable % | Harder / min | New solvable / min |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| move | 385 | 71% | 1.32 | 50% | 232 | 834 |
| walls | 923 | 61% | 1.24 | 54% | 265 | 1,349 |
| mix | 364 | 54% | 1.43 | 9% | 191 | 1,218 |
| pair | 197 | 51% | 1.18 | 20% | 80 | 682 |
| no | 91 | 48% | 2.06 | 40% | 542 | 918 |
| backward | 145 | 33% | 1.08 | 85% | 43 | 1,684 |

Notes:
- The set is stable. From seed 7 to seed 11, 240 runs stopped finding harder
  levels and 127 started. The 38 levels that found nothing on the rerun were
  marginal before too, with a median of 2 harder finds across all their
  generators. Three games had no productive level on the rerun: *paint
  everything everywhere*, *big dog and little dog* and *witch lifter*.
- 3 of 2,108 runs hung (native turns aren't preemptible): *match three
  billiards* (2) and *der hydra krypta* (1).
- Harder / min is dominated by small, fast games: *m c eschers armageddon*
  averages 2,522/min. Compare generators with the per-run columns, not the
  per-minute totals.
- *backward* rarely makes levels harder. It keeps the solution valid by
  design, so almost everything it makes is solvable.
- *no* finds harder levels less often, but gives the biggest lift when it
  does.

## Reproducing

```sh
node src/tests/mis_generator_seed_survey_node.js seeds                        # step 1
node src/tests/mis_generator_seed_survey_node.js survey --out survey.json      # step 2
node src/tests/mis_generator_seed_survey_node.js cull survey.json --cap 6      # step 3
node src/tests/mis_generator_seed_survey_node.js survey \
  --seeds src/tests/mis_generator_bench_seeds.json --seed 11 --out bench.json  # baseline
node src/tests/mis_generator_seed_survey_node.js report bench.json
```
