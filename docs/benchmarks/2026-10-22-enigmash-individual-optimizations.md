# ENIGMASH: independent optimization measurements

22 October 2026. Follow-up to `2026-10-22-enigmash-profile.md`.
No production engine changes. Each variant enables exactly one of the original
three prototypes, with no combined variants in the main comparison.

## Main results

Node v25.8.1 on the same local Mac. ENIGMASH uses the intact separately supplied
game file, the recorded seed, and all 109 recorded inputs including automatic
`again` turns. The suite is the 471 recorded simulations in
`src/tests/run_tests_node.js --sim-only`; this checkout has no `testsuite.js`.

| Variant alone | ENIGMASH playback | Time saved | Suite playback | Time saved | Complete suite run |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 11.950s | — | 6.401s | — | 8.780s |
| Sparse replacements | 9.019s | 24.5% | 5.988s | 6.5% | 8.828s (+0.5%) |
| Fused single-cell scans | 9.258s | 22.5% | 6.270s | 2.0% | 8.747s (-0.4%) |
| Single-pass singleton groups | 10.298s | 13.8% | 6.067s | 5.2% | 8.477s (-3.4%) |

Positive percentages in the time-saved columns mean lower elapsed time.
Complete-suite percentages are elapsed-time changes, so negative is better.
The complete run includes compilation, prototype installation, playback and
expected-state validation. Playback includes undo, restart and nested `again`
lookahead, counted once. It excludes compilation, prototype setup and final
serialization/validation. Startup rules inside compilation remain in compilation
time and use the baseline engine in all variants.

Each suite value is the median of five fresh processes per variant. Variant
order rotates each round; benchmark processes run serially. ENIGMASH values
are medians of three fresh processes per variant. Metrics are medianed separately,
so columns need not add exactly. The fused suite gain is small relative to
run-to-run variation: playback improves in four of five paired suite rounds.
Sparse and single-pass playback improve in all five pairs.

All 471 simulations pass in every measured variant and round: 9,420 successful
suite test executions. All 12 ENIGMASH runs reproduce the exact recorded final
state. Tests retain the standard runner's recorded sound checks where present.

An additional untouched CLI sanity run with
`--sim-only --profile --profile-runs=3 --profile-json` returns 8.51s, 8.51s and
8.47s. The instrumented baseline above is the comparison for the instrumented
variants; do not mix its numbers with that separate sanity run. These follow-up
individual measurements are Node results, not new Chromium/WebKit claims.

## 1. Sparse replacements

This is the strongest standalone ENIGMASH improvement and gives a meaningful
suite playback gain. It is not currently a cold-suite wall-time improvement.
The original prototype builds replacement source strings and functions eagerly
after normal compilation, even for patterns never exercised by a short recording.
Median suite installation cost is **545ms**, exceeding much of the **413ms**
playback saving. This also overstates a production compiler's necessary startup
cost: the prototype installs a second path after the ordinary compile.

The largest cold whole-test penalties concentrate in large expanded rule sets:

| Recording | Baseline complete test | Sparse complete test | Sparse setup |
| --- | ---: | ---: | ---: |
| `vertebrae` | 242.5ms | 297.1ms | 35.1ms |
| `VEXT EDIT` | 164.3ms | 204.0ms | 36.8ms |
| `gallery: censored version of NSFW game pornography for beginners` | 166.7ms | 215.7ms | 46.5ms |

There are also smaller playback regressions, separate from installation:

| Recording | Baseline playback | Sparse playback | Change | Slower paired runs |
| --- | ---: | ---: | ---: | ---: |
| `vertebrae` | 115.37ms | 125.39ms | +8.7% | 5/5 |
| `gallery game: Broken Abacus` | 10.54ms | 12.40ms | +17.6% | 5/5 |
| `increpare game: robot arm` | 20.39ms | 22.01ms | +7.9% | 4/5 |

The generated-function cache in the original probe is recreated at every
compile. `vertebrae` installs 8,609 eligible pattern replacements across 69
function shapes, against 4 object and 16 movement words per cell. Broken Abacus
has 322 eligible patterns and six shapes but only four total words per cell.
More function variants and lost function reuse can outweigh cheaper operations
in a short recording, especially where the original function is already hot.

A focused experiment replayed six candidate recordings 20 times each, comparing
medians after dropping the first three repetitions of each game. Changing only
function-cache lifetime to persist across compiles moved:

- `vertebrae`: original sparse 87.86ms -> shared-cache 85.37ms;
  focused baseline 86.52ms.
- Broken Abacus: 7.96ms -> 7.65ms; focused baseline 7.57ms.
- Robot arm: 17.26ms -> 16.57ms; focused baseline 16.27ms.

This supports function reuse/JIT warm-up as an important cause of the regressions,
rather than sparse word updates inherently costing more. It is not proof of the
exact fraction attributable to each JIT mechanism. A second control looked up
cached functions by affected-word shape *before constructing the source string*;
on the repeated six-game workload it reduced setup from 955ms to 265ms. Its
playback differences were mixed. This is a compile/setup improvement, not an
additional runtime speed claim.

Useful wins elsewhere: `gallery game: at the hedges of time` playback falls
693.1 -> 471.5ms (-32.0%); `VEXT EDIT B` falls 269.2 -> 224.9ms (-16.5%).

Recommendation: retain the optimization, but use persistent shape-keyed function
reuse and lazy or compiler-integrated generation before judging startup cost.

## 2. Fused single-cell scans

This helps dense matches much more than sparse ones. Baseline diagnostic
counters, collected separately from timings, show:

| Work within eligible unary rules | ENIGMASH | Voitex Rasteriser 2 | Robot arm |
| --- | ---: | ---: | ---: |
| Rule visits | 115,286 | 830 | 18,949 |
| Candidate cells tested | 324,792,496 | 72,204 | 88,333 |
| Matches | 25,987,094 | 96 | 743 |
| Candidate rechecks | 25,949,364 | 0 | 286 |

The counters include internal speculative turns but exclude initial compilation.
They measure work, not elapsed time. ENIGMASH's fused path removes roughly
26 million rechecks and avoids writing that many entries into match lists.
Voitex already has no rechecks to remove and only 96 matches to put in lists.
Generating and warming a larger fused scanner has much less opportunity to pay
for itself there. Sparse candidate games also retain essentially all scan work.

Cold suite playback regressions:

| Recording | Baseline | Fused | Change | Slower paired runs |
| --- | ---: | ---: | ---: | ---: |
| `vertebrae` | 115.37ms | 120.00ms | +4.0% | 4/5 |
| `SWIMMING TIME!` | 35.89ms | 38.57ms | +7.5% | 5/5 |
| `Voitex Rasteriser 2 [2nd Demake of Vertex Dispenser Puzzle Mode]` | 11.52ms | 13.68ms | +18.7% | 5/5 |
| `increpare game: robot arm` | 20.39ms | 22.12ms | +8.5% | 5/5 |

Focused warm replay confirms the Voitex and robot-arm regressions with the
original per-compile cache. Changing only to persistent function reuse moves:

| Focused playback median | Baseline | Original fused | Shared-cache fused |
| --- | ---: | ---: | ---: |
| `vertebrae` | 86.52ms | 93.15ms | 89.30ms |
| Robot arm | 16.27ms | 18.09ms | 16.52ms |
| Voitex Rasteriser 2 | 4.66ms | 5.38ms | 4.28ms |
| `SWIMMING TIME!` | 31.71ms | 31.48ms | 30.29ms |

Thus SWIMMING TIME's cold regression is not a persistent warmed-playback
regression in this focused check. Voitex reverses into a gain when function
identity is reused; robot arm becomes close to neutral; vertebrae still needs
attention. Reusing generated functions is a more useful next step than simply
adding more emitted code.

A control that unrolled the fused scanner's mask filters did **not** fix the
aggregate focused workload: playback rose 3.298s -> 3.439s. The hypothesis that
generic mask-filter loops alone explain the regressions is not supported.

Separate full-suite V8 deoptimization traces also show more optimization churn
with the original fused probe: 845 inner-loop OSR exits versus 337 in baseline,
and 149 versus 73 insufficient-feedback named-access bailouts. Treat these as
supporting evidence, not counts that directly quantify time lost. Tracing was
disabled in the headline timing runs.

An apparent +43% cold slowdown in `10 layers 50 objects` should not be presented
as its unary rules getting slower: it has **zero eligible fused rules**. In the
focused warm check its difference shrinks to about 0.05ms. Suite order, JIT state
and measurement variation affect these small tests.

Useful gains elsewhere: `Cute Train` 179.2 -> 156.6ms (-12.6%);
`gallery game: at the hedges of time` 693.1 -> 647.0ms (-6.7%).

Recommendation: keep investigating, with persistent function reuse and a
selective path for workloads where match-list/recheck cost can justify it.
The original broad prototype's ~2% suite playback gain is too small to overlook
its named regressions.

## 3. Single-pass singleton groups

This has the best cold whole-suite outcome of the three original prototypes:
roughly 5.2% lower playback time and 3.4% lower complete-run time. Its median
setup cost is only 16ms across the suite.

The clearest cold playback regression is `vertebrae`, 115.37 -> 119.28ms
(+3.4%, slower in four of five pairs). It does not survive the focused warm
check: baseline 86.52ms, single-pass 85.24ms. There is no comparable persistent
large slowdown established by these tests. Robot arm is approximately neutral
when warmed: 16.27 -> 16.52ms.

There is still overhead to address: the experiment wraps *every* rule-group
dispatch with an eligibility Set lookup, while vertebrae has only 60 eligible
groups out of 542. Unchanged groups save no confirmation scan, so dispatch
overhead can matter where productive eligible groups are rare. A compile-time
flag consumed inside the existing dispatcher would avoid this external wrapper.
Using a flag in a diagnostic control gave mixed per-game results and modestly
reduced total focused playback; it does not isolate a complete explanation of
the cold vertebrae result.

The investigation also found a separate prototype inefficiency: its fast path
bypasses the existing input-specialized empty-group check. Voitex has 198 such
inactive visits out of 420 eligible singleton-group visits in the baseline
counter run. Preserve that skip in production. The counter is zero for the
other focused active cases, so it does not explain their timing changes.

Useful gains elsewhere: `gallery: season finale` 338.0 -> 303.3ms (-10.3%);
`gallery game: at the hedges of time` 693.1 -> 639.8ms (-7.7%).

Recommendation: this is the easiest first candidate for a broad default,
provided the proof stays narrow and the implementation retains input
specialization and debugger/solver bookkeeping. Sparse replacements are the
larger ENIGMASH-specific gain. Fused scans need the most tuning before a broad
default.

## Reproduction and raw results

All scripts and results are in the ignored local directory
`build/enigmash-profile/2026-10-22/individual/`:

- `suite-summary.json`: every test's medians, relative/absolute changes,
  paired slowdown counts, stride/board/rule metadata and eligibility counts.
- `suite-<round>-<variant>.json`: all five raw suite rounds.
- `enigmash-summary.json` and `enigmash-<round>-<variant>.json`: three raw rounds.
- `focus-*` and `control-*`: 20 repetitions per candidate game and cache,
  mask-filter, input-specialization and dispatch controls.
- `diagnostic-*-counters.json`: work counters, including per-source-line details.
- `diagnostic-*-deopts.log`: V8 traces with current test-name markers.
- `standard-runner-profile.json`: untouched CLI sanity profile.

The wrapper runs the actual standard Node test runner with its source files,
fixtures, replay and validation logic. It installs one prototype after each
compile, times outermost playback actions, and resets the single-pass wrapper
between games so dispatch wrappers cannot accumulate. Prototype setup is
reported separately. It does not change game sources or production engine code.

```sh
ARTIFACTS=build/enigmash-profile/2026-10-22/individual
BENCH_ROUNDS=5 node "$ARTIFACTS/run-matrix.cjs"
BENCH_MODE=enigmash BENCH_ROUNDS=3 node "$ARTIFACTS/run-matrix.cjs"
node "$ARTIFACTS/summarize.cjs"
node "$ARTIFACTS/summarize.cjs" enigmash
node "$ARTIFACTS/run-controls.cjs"
node "$ARTIFACTS/run-diagnostics.cjs"
```

Run benchmarks serially. The initial focused matrix also uses `BENCH_FOCUS`
pointing to the absolute `focus.json` path, `BENCH_REPEATS=20`, and
`BENCH_MODE=focus BENCH_ROUNDS=1`. Focus controls discard the first three repeats
when interpreting warmed medians; complete cold-suite medians discard no tests.
