# PuzzleScript+MIS web generator: profile from engine to product (27 September 2026)

This profiles the browser level generator (`src/js/mis/mis_generator.js`,
run by the Web Workers) at four scales: the engine's inner loop, a single
solver call, a worker's generation loop, and the whole browser session. It
then looks at the measure a designer cares about: **levels harder than the one
being edited, per minute**. Each finding led to a change, measured with the
same harnesses.

Machine: 4 vCPU Xeon @ 2.1 GHz; Node 22 for single-thread profiles; Chromium
141 (Playwright) for end-to-end. Scenarios: Sokoban level 1 with *Add/remove
Wall*; Microban level 5 with *A bit of everything*, *Add/remove Wall* and
*Shuffle movers*; ALL GREEN TO BLUE levels 3 and 5.

Tools added:

| Tool | Scale |
| --- | --- |
| `misw_counters_enable` / `misw_counters_text` (wasm glue over `ps_runtime_counters`) | engine: per-state mask rebuilds, cells scanned, rule visits |
| `LINK_EXTRA=--profiling-funcs native/wasm/build_mis_wasm.sh` + `node --cpu-prof` | engine: self time per C++ function |
| `src/tests/mis_generator_profile_node.js` | solve (fixed ms + µs/state fit), loop (time per phase), macro (outcomes, cross-worker repeats, harder/min) |
| `native/wasm/mis_wasm_bench_native.cpp` + `--dump-grids` | same grids through x86: identical-result gate and speed |
| Playwright runs of `src/mis.html` (`?genWorkers=N&backend=…`) | session: candidates/s, harder-than-current, main-thread long tasks |

## 1. Engine: per-state cost

Runtime counters on the Sokoban scenario showed that **each expanded state
scanned ~1,110 cells to rebuild row/column masks**, about 26 full passes over
a 42-cell board, against ~5 rule visits and ~4 pattern tests. The solver
prepares each child (`prepareSolverChildFullStateFromParent`), and each
expansion's parent, by clearing every mask cache and marking the whole board
dirty. So each expansion paid about five full rebuilds even though its scratch
state held a sibling board only a few cells different.

Change: `puzzlescript::retargetSessionBoard()` in `native/src/runtime/core.cpp`.
When the reusable scratch session is warm (same game and dimensions, caches
built), it rewrites only the differing cells through `setCellObjectsFromWords`,
the engine's own incremental write path. That keeps masks, the object cell
index and refcounts exact. It then clears movements via `clearMovementState`.
Otherwise the solver falls back to the old full reset. Both solver paths use
it.

| Per expanded state | Before | After |
| --- | ---: | ---: |
| Mask-rebuild cells scanned | 1,110 | **177** |
| Movement-mask rescans | 516 | **0** |
| `rebuildMasks` share of CPU samples (wasm) | 30% | **8%** |
| x86 states/s, 100-solve corpus | 61,159 | **73,495** (+20%) |
| wasm µs per state in generation (fit) | 17.7 | **12.9** |

Correctness gates, all passing after the change:
- The 100-solve corpus returns identical status, states expanded and solution
  length on every solve.
- `puzzlescript_cpp test simulation-corpus`: 470/470.
- CTest: `generator_difficulty_*`, `solver_generated_replay`,
  `compiled_backend_linkage` and the `puzzlescriptmis_*` bridge tests (7/7).
- Solver smoke (16 cases), generator smoke, solver search modes, portfolio
  regression, and solver determinism (5 runs).

The end-of-turn `markAllMasksDirty` in `executeTurn` now runs only on restarts
and level changes. On its own it made no measurable difference, because the
solver's per-edge reset dominated.

Also checked, not changed: skipping the redundant `clearMovementState` when
movements are already clean. Some paths write movements without clearing the
"clean" flag, so relying on it is unsafe. `executeTurn` (rule matching and
movement) is now the top function, at 23%.

## 2. One solver call

A least-squares fit of primary-solve time against states expanded gives
**~0.1 ms fixed + 13–19 µs per state (wasm)**, versus ~52 µs per state for
the JS engine in Node. Setup per call is negligible; cost is entirely per
state. On small levels about 95% of candidates are unsolvable, at ~120 states
each.

## 3. The worker loop

Phase shares before changes (native, Sokoban walls / Microban mix / Microban
shuffle / AG2B L3): **refinement 41 / 19 / 40 / 52%**, unsolvable proofs
48 / 75 / 26 / 35%, transform + dedupe 1–21%. Refinement re-ran the primary
search from scratch, then the lanes, then a BFS of up to 20k states, for every
candidate that might place. The time budget was also set from that whole
refinement, so it drifted to 2–15 s.

Changes, in `mis_generator.js`:
- One assessment per candidate. `assessGeneratedLevelDifficulty`'s
  `supplementalGate` (exposed as `misw_assess`'s `gateMinExpanded`; JS
  `refineGate`) runs the lanes only when the primary count can reach the
  shortlist floor.
- The shortest-length BFS proof runs only for admitted candidates.
- The budget is set from the primary solve's time, as in the original MIS.

The same seeds found identical top-8s, at 268→291 and 1.7→2.5 candidates/s
(Sokoban, AG2B).

Cross-worker repeats: independent workers assessed the same board 0.1% of the
time on high-variety transforms, and 59% on *Shuffle movers*. That transform's
space was already exhausted, so hash-sharding (`--shard`) kept distinct boards
per second the same (~430 per 12 s). It isn't enabled in the app.

## 4. Browser session

Chromium, 20 s of generation, candidates assessed per second:

| Scenario | Start (native ×2) | Engine + loop fixes ×2 | + cores−1 workers (×3) | JS ×2 |
| --- | ---: | ---: | ---: | ---: |
| Sokoban walls | 339 | 357 | **610** | 289 |
| Microban mix | 326 | 423 | **815** | 280 |
| AG2B L3 shuffle | 3.3 | 2.6 | **5.0** | 1.6 |

The main thread had no long tasks while generating. Level-health solves now
pause during generation, and the focus worker is idle then, so the app runs
`hardwareConcurrency − 1` generator workers (`?genWorkers=N` overrides).

## 5. Product: harder levels per minute

The transform's mutation size mattered more than any engine speedup. Scaling
every `choose` count (one thread, 10 s):

| Harder-than-current per minute | ×⅛ | ×¼ | ×½ | ×1 (preset) | ×2 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Sokoban, Add/remove Wall | 84 | **1,734** | 1,338 | 696 | 156 |
| Microban, A bit of everything | **60** | 42 | 6 | 6 | 0 |
| Microban, Add/remove Wall | 102 | **438** | 294 | 54 | 6 |

Large steps are mostly unsolvable; tiny ones run out of distinct boards. The
best size depends on the level and transform, so the generator now chooses it
online. A UCB bandit over five scales of every `choose` count is rewarded per
second of work for harder-than-base finds, plus a bonus for shortlist
entries. Adaptive vs the preset as written vs the best fixed size in
hindsight (one thread, 20 s):

| Scenario | Preset | Best fixed | Adaptive |
| --- | ---: | ---: | ---: |
| Microban, Add/remove Wall | 78/min | 531 | **549** |
| Microban, A bit of everything | 15 | 54 | **66** |
| Microban, Shuffle movers | 15 | 15 | **21** |
| AG2B L5, mix | 0 (best effort 990) | 0 | **6 (best 8,508)** |
| Sokoban, Add/remove Wall | 726 | 957 | 753 (keeps the preset size, which finds harder levels: top-8 mean 820 vs 575) |

In the browser with 3 workers, Sokoban's harder-than-current finds per 20 s
went 312 → **748**, and Microban mix 6–8 → **15–16**. The meter shows the
favoured step size.

## Where the time goes now

Sokoban walls, adaptive, native: refinement lanes 57%, shortest-length proofs
12%, unsolvable proofs 29%, transform 1%. The lanes are the MIS difficulty
metric itself: greedy, weighted A* and BFS, each capped at primary + 6
states. Further gains would come from:
- **Engine:** `executeTurn`, the remaining cleared-bit row rescans, and
  per-edge allocation (~5% malloc/free).
- **Loop:** proving the shortest length lazily when a card is viewed.
- **Product:** the same bandit over which preset to run, not just its step
  size.
