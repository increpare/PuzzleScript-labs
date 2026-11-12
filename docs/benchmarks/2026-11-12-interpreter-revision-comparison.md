# C++ interpreter: bdbb7f2 versus a564e3a

Measured 2026-11-12 on macOS ARM64. These are whole-revision comparisons using
unmodified source snapshots, with the interpreted runtime and no generated game backends.

- Baseline: `bdbb7f2601fc0848e59026781f1505bd77d216bd`.
- HEAD frozen at study start: `a564e3a415a07196a70e9f331cbc5ccbbde41035`.
- Four separate runs per revision and workload, sequential, in alternating order:
  old/head, head/old, old/head, head/old. Values below are medians.
- Same Apple Clang 21 toolchain, Release `-O3`, LTO, `-march=native`, 64-bit masks.
  Revision-specific interpreter defaults are retained.

## Results

CPU time is end-to-end child-process user+system time, including startup, source
compilation, execution and output. Native replay/search phase clocks are wall time.

| Workload | Baseline CPU seconds | HEAD CPU seconds | Change |
| --- | ---: | ---: | ---: |
| Full simulation suite, 731 cases | 3.273 | 2.497 | 23.7% less CPU |
| Full solver corpus, 250 ms per level | 164.565 | 162.572 | 1.2% less CPU |
| Standard generator benchmark, two presets × 200 samples | 6.515 | 6.643 | 2.0% more CPU |

The simulation replay phase falls from
**2.114 s to
1.337 s
(36.7% less time,
1.58× throughput)**.
All 731 cases pass in every run of both revisions. This is the native simulation
replay suite, rather than the JS suite, diagnostics, or the complete CTest build.

## Solver: deadlines obscure some of the gain

Each sweep visits 2,790 entries: 1,346 playable levels and 1,444 messages. There
are no solver errors or generated-backend hits. The 250 ms cap means hundreds of
unresolved levels consume their full allowance on either revision; total sweep
time is not a fixed-work measure of interpreter speed.

| Solver metric | Baseline | HEAD |
| --- | ---: | ---: |
| Solved levels, median (range) | 800.5 (797–803) | 804.5 (802–809) |
| Whole-sweep wall seconds | 166.263 | 164.698 |
| Generated successors per CPU second, median | 114,920 | 116,683 |
| Search time on 785 levels with identical reported work | 27.470 s | 26.494 s |
| Interpreter step time on those same levels | 21.226 s | 20.261 s |

The fixed reported-work cohort is solved in **every** run of both revisions,
with identical expanded/generated counts, solution moves, selected strategy and
heuristic. Its summed search time drops **3.6%**;
summed step time drops **4.5%**. These are medians
of per-run sums. They exclude source compilation/loading and the unsolved tail.
Matching these fields is not a claim that every internal search event is identical.

For a less startup-dominated subset, the 529 matching levels with
at least 100 expansions show 1.7% less
search time and 2.7% less step time.
The broader 788-level cohort solved in every run, without requiring
matching work, shows 3.7% less search time.

## Generation: no demonstrated speedup on these presets

The standard benchmark uses `sokoban_basic.txt` with `sokoban_room_scatter.gen`
and `sokoban_transform_pairs.gen`. Each preset runs 200 samples, seed 11, one
worker, portfolio solving, a 50 ms solver cap and top 10 retention. Each run
finishes all 200 attempts before the 60 s global deadline.

The two-preset total is **2.0% more CPU time**
on HEAD, with the same median
13 solved samples out of 400.
This supports a roughly flat/slightly slower result for these workloads. Per-sample
deadlines affect the amount of search completed even with a fixed generation
seed, so these timings should not be treated as an equal-work microbenchmark.

As a separate level-set-mode check, `sokoban_levelset_tiny.gen` completes 200
attempts, with 196 searches, four duplicate skips and two keepers on both versions.
Median CPU time is 39.50 ms versus
38.87 ms. This is too short for a useful speedup claim
and is excluded from the standard generator total.

## Variation and phase breakdown

| Workload | Baseline CPU seconds, min–max | HEAD CPU seconds, min–max | Baseline median wall seconds | HEAD median wall seconds |
| --- | ---: | ---: | ---: | ---: |
| Simulation | 3.268–3.297 | 2.496–2.499 | 3.286 | 2.513 |
| Solver | 163.131–164.750 | 160.756–162.920 | 166.263 | 164.698 |
| Generator (both presets) | 5.900–6.571 | 6.548–6.730 | 6.878 | 7.128 |

| Simulation phase, median milliseconds | Baseline | HEAD |
| --- | ---: | ---: |
| Fixture read/parse | 34 | 34 |
| Game source compilation | 863.5 | 927.5 |
| Session creation | 1 | 2 |
| Level loading | 194.5 | 135 |
| Replay | 2113.5 | 1337 |
| Serialization | 35 | 35 |

These phase timers are coarse wall clocks, not CPU timers; their medians need
not sum to a process median. External wall timing includes process startup/reaping
and up to about 50 ms of polling delay. CPU timing avoids that delay and host
scheduling pauses. No builds or other study workloads ran concurrently.

## Inputs and controls

The replay fixture, entire solver corpus tree, Sokoban source and all three
generator presets are byte-identical across the revisions. The old replay
fixture reader cannot directly consume the JavaScript fixture (it reports
`simdjson: NUMBER_ERROR`). The unchanged fixture was evaluated once with HEAD's
tracked `src/tests/js_oracle/export_testdata_json.js` helper, then JSON-serialized.
Both unmodified binaries consume that **same** JSON file. This measures the
interpreter without mixing in fixture-reader compatibility.

Both snapshots were built with:

```sh
cmake -S SOURCE -B BUILD -DCMAKE_BUILD_TYPE=Release \
  -DPS_MASK_WORD_BITS=64 -DPS_ENABLE_LTO=ON -DPS_ENABLE_MARCH_NATIVE=ON \
  -DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE=
cmake --build BUILD --target puzzlescript_cpp puzzlescript_solver puzzlescript_generator -j4
```

Measured commands (paths abbreviated):

```sh
puzzlescript_cpp test simulation-corpus simulation-corpus.json \
  --jobs 1 --repeat 1 --turn-executor interpreter --quiet \
  --top-slow-cases 10000 --json-summary-out RESULT.json
puzzlescript_solver src/tests/solver_tests --timeout-ms 250 --jobs 1 \
  --strategy portfolio --no-solutions --quiet --json
puzzlescript_generator src/demo/sokoban_basic.txt PRESET.gen \
  --samples 200 --time-ms 60000 --jobs 1 --seed 11 \
  --solver-timeout-ms 50 --solver-strategy portfolio --quiet \
  --top-k 10 --json-out RESULT.json
```

The tiny level-set run replaces `--top-k 10` with `--out GENERATED.txt`.
The native default summary timers remain enabled for solver reporting; runtime
profiling counters are disabled. No generated rule, full-turn or compact-turn
backend is linked or attached. Solver and generator source files are unchanged
between these revisions, but compiler/runtime changes include correctness fixes
as well as optimizations. This is a revision comparison, not isolated attribution
to one optimization or a guarantee about other games and machines.

The adjacent JSON contains all 40 trial records, exact commands, medians/ranges,
cohort totals, input and binary hashes, and raw-output hashes. Full raw logs,
per-level solver results, immutable source snapshots, binaries, normalization
input and the runner/analysis scripts remain in
`build/revision-bench-bdbb7f2-a564e3a/` (ignored build artifacts).

## Largest baseline replay cases

These are the eight recordings with the highest baseline median replay time,
selected before considering their speedup. Values are native phase wall milliseconds.

| Recording | Baseline | HEAD | Time reduction |
| --- | ---: | ---: | ---: |
| gallery game: at the hedges of time | 194.5 | 161.5 | 17.0% |
| collapse long | 173.5 | 69 | 60.2% |
| Selene's Labyrinth | 172.5 | 120 | 30.4% |
| Cute Train | 139 | 56 | 59.7% |
| gallery: Spikes 'n' Stuff | 108 | 68.5 | 36.6% |
| gallery: skipping stones to lonely homes | 90 | 76 | 15.6% |
| Car Crash | 76 | 56 | 26.3% |
| gallery: Rose | 69 | 42 | 39.1% |

## Follow-up: why the workloads benefit differently

The large replay number combines an undo-history fix with game-dependent rule
and movement optimizations. It should not be read as a uniform improvement in
every interpreter turn.

The old `makeUndoSnapshot` and `assignUndoSnapshot` copied `session.meta`,
including its entire accumulated undo stack, and then cleared that copied stack.
The optimized versions copy metadata without history. Normal player replays
accumulate history, so the old wasted copying grows with the session. The
solver explicitly sets `playableUndo=false`, disables audio, drains AGAIN, and
clears undo history during state materialization. The generator calls that same
solver through its C API. Those searches therefore largely avoid the history
cost before this optimization.

To test that mechanism, a common probe was linked separately against the exact
old and HEAD native/compiler libraries. It replays three recordings with default
player options, either retaining undo normally or clearing it before each turn.
There are four alternating processes per version/control, each with ten timed
replays and one untimed warmup; compilation, level loading and serialization
are excluded. No deadlines or search are involved. The selected recordings have
no undo inputs. Every replay matches the original expected final board; the
turn counts and final session digests agree across revisions and controls.

| Recording | History control | Baseline CPU ms | HEAD CPU ms | Change |
| --- | --- | ---: | ---: | ---: |
| Cute Train | Normal player history | 125.291 | 55.802 | 55.5% less time |
| Cute Train | History cleared each turn | 55.732 | 56.565 | 1.5% more time |
| Karamell | Normal player history | 9.024 | 4.805 | 46.7% less time |
| Karamell | History cleared each turn | 7.861 | 4.819 | 38.7% less time |
| Selene's Labyrinth | Normal player history | 170.146 | 113.233 | 33.4% less time |
| Selene's Labyrinth | History cleared each turn | 169.238 | 112.975 | 33.2% less time |

Cute Train's large gain disappears when the accumulated history is removed.
Selene's Labyrinth and Karamell retain substantial gains, demonstrating that the
changes also accelerate actual rule/movement processing on some games. Clearing
history is a causal control, not a supported replacement for playable undo, and
can also affect prepared-AGAIN cache eligibility. These figures supplement the
original CLI measurements rather than replacing them.

The generator's two standard presets both use the same simple Sokoban game.
Inspecting its compiled rules finds one object word, one movement word, four
direction-expanded rules, zero layer-coupled movement masks and zero selective
replacement plans. The selective updater requires at least four total mask words;
the direct movement-field optimization addresses patterns this game lacks.
Consequently several optimized paths never activate in that benchmark. Other
core changes can still affect it; the original measurements demonstrate no net
generator improvement.

Across the solver's 184 games,
135 use single-word object and movement masks,
19 have any selective replacement plans, and
20 have layer-coupled movement masks.
These are static counts by game, not CPU-weighted dynamic usage.

The stopwatch also hides gains on unresolved levels. For the two probe games
present in the solver corpus, the original four full-corpus runs show:

| Game | Median generated successors, baseline | HEAD | Median solved levels, baseline / HEAD |
| --- | ---: | ---: | ---: |
| cute train.txt | 806 | 837 | 0 / 0 |
| karamell.txt | 7071.5 | 11644.5 | 1 / 1 |

Karamell generates about 65% more successors under the same 250 ms per-level
caps, while its solve count remains unchanged. This is a capped-search throughput
observation, not an equal-state microbenchmark: the search can reach different
states and portfolio phases. It explains why a useful improvement need not
shorten the full solver sweep or change its solve count.

Probe source, binaries, build commands, all 48 process records and game
inspections remain under `build/revision-bench-bdbb7f2-a564e3a/history-probe/`
(source at `../history_probe.cpp`). Results and hashes are also included in the
adjacent report JSON. Production source and the original measured binaries
were not changed by this follow-up.
