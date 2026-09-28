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
cap**. The per-candidate budget starts at 200 ms, doubles on each timeout until
something solves, and follows 7× the admitted candidates' solve time, up to 5 s
(`maxBudgetMs`). In 371 of the 539 runs that hit 30 s, it ended at the 5 s cap.
Only 15% of those runs' candidates time out, but they take 41% of the time.

The default run length is now 15 s: the recorded run times put a full run at
~64 min (10 s: ~48 min).

## Are the timeouts wasted? (No)

A per-candidate trace (`survey --trace`) shows each candidate's budget, primary
solve time, outcome and effort. It covered the 181 benchmark levels whose runs
hit the time limit, with the *move* and *mix* generators at 15 s (347 runs,
9,178 solved candidates, 873 harder than the seed):

- Timeouts take **72%** of primary solve time.
- Retries of parked timeouts take 53%. A parked board is retried whenever the
  budget grows, typically at 1.5–2× the budget it timed out at. The retries
  solved 94 candidates, 61 of them harder than the seed (7% of all harder
  finds).
- Timed-out solves overrun their budget by ~10% (a turn can't be interrupted).
- Harder-than-seed candidates usually solve fast. Their solve time ÷ the
  seed's is 1.3× at the median and 7.9× at p90. But 4% take over 20×, and they
  are disproportionately the hardest.

Two fixes, measured on the same levels and seed against two runs of the
current generator:

| vs current generator | Time | Harder levels found | Top-8 mean effort | Best level | Runs with better / worse top-8 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Current, repeated (noise floor) | 0% | ±2% | ×0.95–1.05 | ×0.95–1.05 | 63 / 64 |
| Budget from the seed: start 7×, cap 20× (≥ 1 s) | −5% | +5–7% | **×0.88–0.92** | ×0.91–0.96 | **74 / 112, 79 / 109** |
| Retry parked timeouts only at 2× their budget | −2–3% | +10–12% | ×0.92–0.95 | ×0.97–1.00 | 89 / 90, 87 / 88 |

On these slow levels the slow solves are where the best levels come from,
so capping them makes the levels found less hard. Retrying less often finds
more harder levels but not better ones. That test covered only slow levels,
though. Over all kinds of level, the benchmark score below found the
seed-relative budget **+9.5% better**, because it fills more of the shortlist,
and it is now the default (`seedPrimaryMs`; off with `seedBudget: false`, or
survey `--no-seed-budget`). Retrying less often stays an option
(`retryGrowth`, survey `--retry-growth R`).

## Benchmark score: is generation getting better?

`src/tests/mis_generator_bench_node.js` (or `make mis_generator_bench`) answers
one question with one number: does a change make the generator better, by any
route? That covers faster solving, better choices of what to try, or dropping
dead ends sooner.

- **Fixed time per level.** `calibrate` froze each level's time into the
  manifest (`benchSeconds`): the time the current generator needed to judge 30
  candidates in the 30 s baseline, clamped to 3–15 s. The median is 9.5 s.
  Every version gets the same time, so a faster engine or a smarter loop has
  the same time to do more with. (The candidate budget used for culling would
  hide a speedup on the third of runs that stop at 30 candidates.)
- **Score.** For each run, *lift* = shortlist value ÷ seed effort. The
  shortlist value is the mean effort over its 8 slots, with an empty slot
  counting as 0, and lift is floored at 1/16. The score is the geometric mean
  of lift, averaged per game first. It rewards what the designer sees: a full
  shortlist of hard levels. Harder-levels-per-run and candidates/s are
  reported beside it to show why the score moved.
- **Side by side.** Variants run at the same time on the same machine,
  interleaved, each on jobs ÷ variants threads. A variant can be another
  checkout (`"src"`: e.g. a worktree of the commit to compare against),
  generator options (`"gen"`), or an artificial slowdown. Each is compared with
  the first variant run by run (same level, generator, repeat and random seed).
  The change comes with a 95% confidence interval from resampling games.
- **Sizes.** The full set is 319 levels, 263 thread-minutes per variant: an A/B
  takes ~2.2 h on 4 cores. `--quick` is one level per game (103 levels, 90
  thread-minutes per variant). With per-run overheads, a quick 4-variant run
  took 1 h 50 min on 4 cores.
- **Deterministic mode (`--work`).** Budgets count solver states (50 per ms of
  the level's time) instead of time, and the solver makes no timing-based
  decisions, so identical code gives identical results. It measures the loop's
  choices with no timing noise; engine speed shows only in the timed mode.
  This needed a states cap for the primary solve and a `deterministic` solve
  option. The portfolio solver switches to weighted A* when its measured step
  time exceeds 0.05 ms per generated state. That is a clock-based decision,
  so without the flag the same level can be searched differently under load,
  or on wasm vs x86. The flag turns the switch off.

### Validation (quick set, timed, 4 variants side by side)

| Variant vs current | Score | 95% CI | Verdict | Runs better / worse | Candidates/s |
| --- | ---: | --- | --- | ---: | ---: |
| Same code again (A/A) | +1.0% | −2.9% … +5.8% | no significant change | 106 / 113 | −6% |
| Solver 1.5× slower | **−20.0%** | −24.5% … −15.5% | WORSE | 55 / 276 | −39% |
| Seed-relative budget | **+9.5%** | +2.5% … +17.1% | BETTER | 155 / 133 | −8% |

- The A/A comparison is null, and a slower engine is clearly detected. In work
  mode, identical code gave identical runs, and the 1.5× slowdown scored
  exactly the same, as it should (`mis_core_node.js` checks reproducibility).
- The seed-relative budget scores better overall. The same runs split by how
  fast the seed solves:

  | Seed solve time | Score | Mean effort of levels found |
  | --- | ---: | ---: |
  | < 30 ms (293 runs) | +8.5% | +0.4% |
  | 30–150 ms (143) | +10.3% | +3.8% |
  | ≥ 150 ms (151) | +3.2% | −6.9% |

  Capping the per-candidate budget near the seed's own solve time stops it
  growing to 5 s. More candidates get judged in the same time, which fills
  more of the shortlist. Only on the slowest levels are the levels it finds
  less hard. The earlier A/B used only those levels and the mean effort of
  levels found, hence its opposite verdict. **It is now the default.**
  Confirmed with `make mis_generator_bench MIS_BENCH_REF=8016cf0` (quick set,
  the commit before the switch vs after): **+10.3% [+3.6%, +18.2%], better**;
  runs better / worse 146 / 120; candidates/s −5%. The
  generator uses it whenever the caller passes the seed's solve time
  (`seedPrimaryMs`); the app's workers, the survey and the benchmark all do.
  `seedBudget: false` turns it off. An older generator ignores
  `seedPrimaryMs`, so benchmarking an older commit keeps that commit's own
  behaviour.

Results: `2026-09-27-mis-generator-bench-validation.json`.

## Lazy proofs and parents from the best finds (28 September)

Quick set, timed, 4 variants side by side, run from commit a03cf88
(`2026-09-28-mis-generator-lazy-elite.json`):

| Variant vs eager (old behaviour) | Score | 95% CI | Candidates/s | Drift (tiles) |
| --- | ---: | --- | ---: | ---: |
| eager: BFS shortest-length proof for every admitted candidate | – | – | – | 3.4 |
| **lazy**: no proofs in the generator (now the default) | **+14.7%** | +7.9% … +22.1% | +16% | 3.5 |
| elite30: lazy + mutate from the best finds, seed 30% | +17.4% | +7.5% … +27.0% | +23% | 4.9 |
| elite70: lazy + mutate from the best finds, seed 70% | +20.6% | +11.8% … +30.6% | +23% | 4.0 |

- **Lazy proofs:** the proofs only set the move count on the cards, so
  skipping them is pure throughput. The app now proves the cards on screen,
  one at a time on its otherwise idle background worker. Cards show ≈ for a
  few seconds, then the exact count.
- **Parents from the best finds** (`parents: 'elite'`, `seedShare`) vs lazy
  alone: +2.4% [−4.2%, +9.2%] and +5.1% [−3.0%, +14.8%], no significant change.
  It helps on fast levels (3 s runs: +14% / +12%), where many rounds let
  difficulty build up. It hurts slightly on the slowest ones (15 s: −5% / −3%).
  The best level found is 3–7% less hard, and the shortlist drifts further
  from the seed. Benchmark runs last 3–15 s, while a designer generates for
  minutes, so it got a longer-horizon test (below).
- **At 4× the time** (`--time-scale 4`, move and walls transforms, 12–60 s
  runs; `2026-09-28-mis-generator-elite-4x.json`), elite70 vs lazy:
  **+13.1% [+6.2%, +21.2%], better**. Runs better / worse: 173 / 56. By speed:
  +18% on fast levels, +15% on middle ones, +5% on the slowest. The best
  level found is 9% harder. Drift is 4.3 vs 3.3 tiles. **It is now the default**
  (`parents: 'elite'`, `seedShare` 0.7; `parents: 'seed'` for the old
  behaviour).
- Not built: rejecting hopeless candidates before solving. Unsolvable proofs
  are ~12% of generation time (they're cheap: ~120 states each), so the gain
  is capped low. A safe filter also needs per-game analysis of which objects
  rules can create or destroy.

## Reproducing

```sh
S=src/tests/mis_generator_seed_survey_node.js
node $S seeds                                               # step 1
node $S survey --seconds 3 --out survey.json                # step 2 (fixed 3 s)
node $S survey --rejudge survey.json --out rejudged.json    # step 3 (candidate budget)
node $S cull rejudged.json                                  # step 4 (cap 4, spread)
node $S survey --seeds src/tests/mis_generator_bench_seeds.json --seed 11 --out bench.json
node $S report bench.json
node $S survey --seeds slow_seeds.json --generator '^(move|mix)' --trace --seed 11 --out trace.json   # candidate trace
B=src/tests/mis_generator_bench_node.js
node $B calibrate bench30s.json                                   # freeze benchSeconds (from a candidate-budget survey)
node $B run --quick --variant current --variant 'slow15={"slowdown":1.5}' --out validate.json
make mis_generator_bench MIS_BENCH_REF=<commit>                  # this checkout vs <commit>, quick set
make mis_generator_bench MIS_BENCH_REF=<commit> MIS_BENCH_ARGS="--quick --work"
```
