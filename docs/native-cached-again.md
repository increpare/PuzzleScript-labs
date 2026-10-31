# Native cached AGAIN

This extends the [JavaScript port](cached-again.md) to the C++ interpreter and
generated native compact turn backend, starting from Labs `a304a3e6`. That
baseline already isolated speculative RNG; this change reuses the speculative
simulation as well. It does not introduce another random-sequence change.

## Implementation

A Yield continuation retains the simulated board, RNG, movement/rigid state,
queued commands and interpreter audio after late rules, before effects commit.
The next TICK validates the source board, RNG, execution options and relevant
session metadata, restores the prepared simulation and enters the existing
effect path. Undo history, sounds, messages, checkpoint, restart and win effects
therefore belong to the actual turn. Rejected lookahead remains private.

Cache storage belongs to the session's scratch state and reuses vector capacity
across a chain. Copying a session drops its cache so solver siblings cannot
share mutable pending work. Undo, restart, level/board replacement, changed
source state and incompatible input/options invalidate it. Source keys compare
state values rather than relying on a board hash. Undo history is not copied
into the cache; the key includes its depth and the relevant metagame values.

Both the generated backend's direct API and the session wrapper exercise the
cache. Drain keeps its existing single-simulation path. Existing Defer behavior
is unchanged. External board/snapshot storage configurations used by GBA keep
the previous RNG-isolated probe path; firmware caching is outside this change.
Native compact configurations with custom output hooks also retain their old
probe path, because those external hooks cannot be replayed as session effects.
The separate GBC C generator is unchanged.

Generated replay applies changed cells through the normal incremental index
helpers. Probe rollback uses the inverse changes, except after a rigid retry,
where the original full restore repairs any stale derived indexes. Omitted
generic masks are marked dirty at the backend boundary for wrapper callers.
These details matter: an initial full-rebuild replay was slower than baseline;
sparse replay and rollback remove that overhead without copying all scratch.

## Measurements

Baseline `a304a3e6` versus this change, Apple clang 21.0.0, arm64, matching
Release flags, 32-bit mask words, LTO and native-architecture tuning disabled.
Nine alternating paired process samples, each with seven timed repetitions
after warmups. Runtime counters are disabled during timing. Each workload has
10,000 cells and 100 visible turns; these are synthetic simulation CPU times,
excluding compilation and animation intervals.

| Player workload | Interpreter before → after | Paired speedup | Generated before → after | Paired speedup |
| --- | ---: | ---: | ---: | ---: |
| Deterministic AGAIN | 21.82 → 15.14 ms | 1.46× | 14.84 → 6.07 ms | 2.49× |
| Random AGAIN | 22.30 → 15.34 ms | 1.45× | 15.16 → 6.17 ms | 2.45× |
| Rigid AGAIN | 22.00 → 15.21 ms | 1.45× | 17.32 → 8.98 ms | 1.95× |
| Ordinary turns | 4.93 → 4.32 ms | 1.14× | 1.61 → 1.59 ms | 1.02× |

Compact solver controls range from 0.97–1.00×; interpreter solver controls are
1.15–1.16× in this run. Those controls do not avoid any rule evaluations; the
interpreter timing ratios include gains unrelated to avoided lookahead work.
The simulation counts establish reuse separately. Full board/RNG/turn-count
FNV-1a64 checksums match across every baseline/candidate sample; hashing occurs
outside the timed region.

The 100-turn AGAIN cases perform 101 simulations rather than 200. Actual early
rule-group invocations are **600 → 303** for the deterministic interpreter;
generated rule applications are **400 → 202**. Random and rigid variants also
match Drain's work exactly. Probe profiling now includes actual generated rule
work, which the previous counter scope suppressed. Timing counters retain
their existing attribution. Cache payload reuse and copy isolation are checked
directly; no claim is made that all turn processing is allocation-free.

All samples, counts and source/artifact hashes are in the
[measurement data](benchmarks/2026-10-31-native-cached-again.json).

## Validation

- Thirteen mandatory native compact fixture kernels, with both interpreter and
  raw/wrapped generated execution. Count regressions fail against the baseline.
  Coverage includes deterministic/random/rigid chains, accepted and rejected
  random probes, deferred audio/messages/checkpoint/restart/win/cancel, exact
  cached-versus-uncached output/RNG/undo comparisons, copies, buffer reuse,
  input/options/board/RNG invalidation and backend switching.
- Partial rigid rollback regression: removing only the generated retry guard
  fails with a stale object-cell index; restoring the guard passes. The test
  reconstructs counts/indexes from the board and checks subsequent inputs.
  A mixed negative/directional fixture similarly fails when only the ALL-mask
  dirty-marker clauses are removed, then passes with them restored; its oracle
  reconstructs both orientations of generic ALL masks from the board.
- Focused tests pass in native 32-bit, native 64-bit, and an Emscripten harness
  linked against the actual MIS runtime objects and generated 64-bit kernels.
- Source JS **976/976** plus auxiliary regressions; CM6 generated-assets check
  and `make mis_tests` pass. Native normalized diagnostics **344/344**.
- Native gameplay **631/632**, identical to baseline. The existing failure is
  checkpoint-history undo of arrival, unchanged by this work.
- MIS WebAssembly and release assets rebuilt; **257 Brotli sidecars** verify,
  and the release WASM matches the source artifact. No preview or deployment.

The final selected native suite passes **121/121**, including GBA/GBC generated
smokes. A native build with external output hooks also verifies no speculative
sound, one committed sound and the uncached fallback.

The full native CTest run initially passed 119/126 under a 90-second cap. Two
hardcoded compiler-path checks pass after providing their expected build path.
Four remaining failures reproduce on the baseline: parser-state names, rule
plan `ponies`, alternatey level-4 trace, and the raw diagnostics fixture's JSON
parsing. The normalized diagnostics run above passes. The eligible solution-cache
host test exceeded the cap while exporting/building its host games; it is not
claimed as passing. These older checks and expectations remain unchanged.

## Reproduction

```sh
cmake -S . -B build/native-cached-again -DCMAKE_BUILD_TYPE=Release \
  -DPS_ENABLE_LTO=OFF -DPS_ENABLE_MARCH_NATIVE=OFF -DPS_MASK_WORD_BITS=32
cmake --build build/native-cached-again --target cached_again_tests -j 4
ctest --test-dir build/native-cached-again -R cached_again_tests --output-on-failure
python3 native/tests/benchmark_cached_again.py BASELINE_TEST_BINARY CANDIDATE_TEST_BINARY
```

For timing, compile the same test harness and its generated compact fixture
kernels against each runtime version. Use separate build directories: retaining
an older test binary while overwriting its runtime libraries is insufficient.
The benchmark disables runtime counters, warms both implementations and runs
nine paired samples in alternating process order. Each sample times seven
100-turn runs on 10,000 tiles after internal warmups. Compilation and animation
delay are excluded. Checksums must match across all samples and implementations.
