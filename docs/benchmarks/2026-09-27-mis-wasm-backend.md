# PuzzleScript+MIS web prototype: native solver as WebAssembly (27 September 2026)

The web prototype (`src/mis.html`) can run either the JS engine solver or the
native C++ compiler and solver built with Emscripten
(`native/wasm/build_mis_wasm.sh`). This records the profile that shaped the
build and the resulting speeds.

Machine: 4 vCPU Intel Xeon @ 2.1 GHz. Emscripten 6.0.10, `-O3
-fwasm-exceptions`, no SIMD. Node 22.22. Chromium 141 (Playwright 1194). x86
reference: the same sources and glue built with clang `-O3` (no LTO, no
`-march=native`), via `native/wasm/build_mis_bench_native.sh`.

Raw rows: [2026-09-27-mis-wasm-backend.json](2026-09-27-mis-wasm-backend.json)
(`node src/tests/mis_backend_bench_node.js --json`).

## Corpus

The first 99/10/4/8/4 playable levels of sokoban_basic, microban,
twolittlecrates1, ALL GREEN TO BLUE and lunar_lockout. Each strategy is capped
at 300,000 states expanded and 20 s. Throughput is aggregated over solves where
every compared backend finished.

## Correctness

- The x86 and wasm builds expanded exactly the same number of states in all
  90 solved runs.
- Native and JS BFS agree on the optimal length in 19/19 cases where both
  finished. There were no solvable/unsolvable contradictions.
- Native solutions replay to a win on the JS engine
  (`src/tests/mis_core_node.js`).
- Native tests pass after the solver changes: `generator_difficulty_contract`,
  `solver_generated_replay`, `compiled_backend_linkage`, the
  `puzzlescriptmis_*` bridge tests, solver smoke (16 cases) and generator smoke.

## Profile-driven changes

A CPU profile of the first wasm build (`LINK_EXTRA=--profiling-funcs`,
`node --cpu-prof`) showed **~32% of samples in clock reads**: WASI
`clock_time_get`, `performance.now`, BigInt conversion and the wasm→JS call.
The solver reads `steady_clock` about 20 times per search edge: roughly 60
`ScopedTimer` sites, plus a deadline poll on every edge.

1. Under `__EMSCRIPTEN__`, the solver's `Clock` calls `emscripten_get_now()`
   directly instead of going through WASI (32% → 17% of samples).
2. In C API builds only (`PUZZLESCRIPT_SOLVER_C_API`), every timer except the
   step timer is a no-op. The C API returns no timing breakdown; the step timer
   stays because the portfolio's weighted-A* lock reads it, so search decisions
   are unchanged. The CLI solver is untouched.
3. In C API builds, the deadline clock is read on every 16th poll. The cancel
   callback is still checked every turn, which `solver_generated_replay`
   asserts.
4. Single-strategy solves use compact node storage. Otherwise BFS keeps a full
   runtime state (~10 KB) per node and hit wasm32's heap limit
   (`std::bad_alloc`) after ~200k states.

After these changes, clock-related samples are 3.3%. The profile is now engine
work: `rebuildMasks` 30%, `executeTurn` 19%, visited-set lookup 5%.

Rejected: `-msimd128` was ~5% slower. The masks here are one or two 64-bit
words, so autovectorised loops only add setup.

## States expanded per second (Node 22)

| Strategy | Solves | x86 native | wasm (first build) | wasm (final) | JS engine | x86 ÷ wasm | wasm ÷ JS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BFS | 19 | 57,899 | 28,711 | **47,085** | 13,783 | 1.23 | 3.4 |
| Weighted A* | 23 | 59,018 | 30,410 | **44,910** | 12,275 | 1.31 | 3.7 |
| Greedy | 22 | 59,173 | 28,469 | **46,013** | 10,727 | 1.29 | 4.3 |
| Portfolio | 24 | 55,571 | 27,794 | **42,451** | — | 1.31 | — |

Full MIS difficulty assessment, where both solved: JS 19.1 s vs native 5.8 s
(×3.3). Simplify on the first level of each game: the same objects removed
with the same shortest length, and native was 1–3.6× faster on the larger
levels.

## In the browser

Chromium's V8 runs the JS engine solver about **2× faster than Node 22**
(29k vs 12k states/s on the same 300k-state BFS), while wasm runs at about the
same speed in both (42k states/s). So the browser gap is smaller than the
Node table suggests:

| Solve (inside a Chromium worker) | Native (wasm) | JS |
| --- | ---: | ---: |
| microban #9 BFS, 300k-state cap | 7.1 s | 10.2 s |
| ALL GREEN TO BLUE #3 BFS (29.9k states) | 0.81 s | 1.19 s |
| lunar_lockout #7 weighted A* | 0.67 s (19.7k states) | 1.14 s (30.5k states) |

End to end in the UI: 20 s of generation, 2 generator workers, candidates
assessed per second.

| Scenario | JS | Native | Gain |
| --- | ---: | ---: | ---: |
| Sokoban level 1, add/remove Wall | 251 | 339 | 1.35× |
| Microban level 5, a bit of everything | 252 | 326 | 1.3× |
| ALL GREEN TO BLUE level 3 (92-move level), shuffle | 1.0 | 3.3 | 3.3× |

Small levels are dominated by fast "unsolvable" proofs, where per-candidate
setup counts. Larger levels see the full solver advantage. The generator scales
across workers: 3 native workers reached ~600 candidates/s on the Sokoban
scenario, against ~290 for 3 JS workers.

Two UI fixes came out of this profiling:
- Level-health background solves now pause while the transformer runs. They
  were competing for cores: JS throughput went 186 → 251 candidates/s.
- Worker slices yield via `MessageChannel`, avoiding the 4 ms nested
  `setTimeout` clamp.

## Remaining differences

- Effort numbers differ between backends. Native uses the shared MIS metric
  from `native/src/search/difficulty.cpp` (portfolio + capped greedy / weighted
  A* / BFS); the JS path uses its own A* / greedy / BFS lanes.
- The transform language still runs in JS for both backends. It accounts for
  1–3% of per-candidate time.
- "Tighten" (adding walls) uses the JS path; the native simplifier only
  removes objects.
