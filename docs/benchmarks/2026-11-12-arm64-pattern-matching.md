# Native matcher profiling: compiler assembly to cached line checks

12 November 2026. **The native CMake default is now `anchor-cache`.** Replay
CPU time falls **6.8% across the 731-case suite** and **13.6% on the complete
ENIGMASH recording**. The gain comes from evaluating a row/column precondition
once per anchored candidate collection, while preserving the original scalar
matcher, early exits, line rejection, candidate order and rule behavior.

Handwritten instruction-only variants remain profiling controls. None earned a
place in the default. The earlier conclusion that the first fused assembly
trial should remain opt-in is retained in the accompanying historical data;
this follow-up continued from the compiler's actual optimized output.

The subsequent [interpreter codegen study](2026-11-12-interpreter-codegen.md)
uses this cached matcher as its baseline and measures a further 31.3% reduction
in full-suite replay CPU time.

## Measured result

ARM64 Mac, macOS 26.6.2, Apple Clang 21.0.0. Release `-O3`, LTO,
`-march=native`, 64-bit masks. Four separate processes per variant, alternating
forward/reverse variant order. Each corpus process executes all 731 cases three
times; the complete recording executes once per process. Runtime counters are
disabled and verified zero.

Numbers below are the median replay **process CPU time**, excluding source
compilation, session creation, level loading and final serialization. The
individual-game rows use the same four corpus runs and recorded input sequences.

| Workload | Original | Cached line checks | CPU time reduction |
| --- | ---: | ---: | ---: |
| Complete 731-case suite, one pass | 2,082.29 ms | 1,940.39 ms | **6.8%** |
| Complete ENIGMASH recording | 3,381.48 ms | 2,923.07 ms | **13.6%** |
| Netrunner recording | 6.20 ms | 5.20 ms | **16.1%** |
| Vacuum recording | 6.27 ms | 5.60 ms | **10.6%** |

All 731 cases were inspected individually. Among cases taking at least 1 ms
of baseline replay CPU time, none increased by 0.25 ms or more in the median of
these four runs. This is an explicit measured threshold, not a guarantee about
every input, processor or sub-millisecond case.

The host became heavily oversubscribed during the investigation: zero idle CPU
and more than 60 runnable processes. Wall time could differ substantially even
between byte-identical binaries. The new `--cpu-timers` option therefore uses
`std::clock()` around the replay phase itself, requires `--jobs 1`, and reports
`profile.replay_cpu_ms` plus per-case CPU timing in JSON. It does not enable
atomic runtime counters. Existing wall timers remain available; CPU timing is
`null` unless requested.

## Where the speedup comes from

A fresh native CPU profile placed `collectRowMatchesInto`,
`lineSatisfiesRowPreconditions`, `applyReplacementAt` and `rowStillMatchesAt`
among the leading engine leaf stacks. The original anchored collectors called
`lineSatisfiesRowPreconditions` for every candidate, although all candidates on
the same line share its answer while that collection is running.

The default now uses a reusable array of generation-tagged results:

- Each collection gets a fresh even generation. The low bit stores acceptance
  or rejection, so both outcomes can be cached in one 32-bit entry.
- The first candidate on a row/column computes the existing precondition. Later
  candidates reuse it before running the original exact cell/row matcher.
- Generations change between collections, so results cannot cross rule, board,
  movement, undo or level changes. The board is not mutated during collection.
- The buffer grows only when needed and is retained in the session's scratch
  storage. There is no allocation or full-array clear per rule. Generation
  wraparound clears stale entries before restarting.
- Session copies drop this ephemeral cache; moves preserve its storage. The
  cache is absent from hashes, snapshots and persistent search state.

The cache uses four-byte entries. Its size tracks the largest required width
or height, and its vector capacity is reused, plus the small generation/container
state.
Movement anchors and object anchors both use it. Non-anchored scanning and the
original rule-order, mask-rebuild, replacement, RNG and `again` logic are kept.

## Why simply removing the filter was insufficient

Removing every anchored line prefilter initially cut replay CPU time by 11.2%
on the corpus and 19.4% on ENIGMASH, but regressed two cases. The filter was
preventing substantial useless exact-matcher work:

| Case | Original candidate tests | Without line filters |
| --- | ---: | ---: |
| Netrunner | 65,157 | 790,089 |
| Vacuum | 184,139 | 483,396 |

Caching retains those useful rejections. Both previously regressing games now
improve. An alternative that skips filters for small anchor sets and caches
larger sets measured 7.2% less corpus CPU and 12.7% less ENIGMASH CPU. The small
tradeoff did not justify adding that heuristic to the default; always caching
preserves the baseline's candidate and exact-pattern work.

## Assembly controls and compiler baseline

The untouched `original` and `copy` controls produced a **byte-identical
2,155,116-byte `__text` section**, SHA-256:

```text
86a6b7a960442ade4d5985dee4d522482edb7ef8341e2b915b04b525898dbb56
```

The follow-up retained Clang's scalar `BICS`/`TST` predicates and early exits,
then tested whole handwritten scalar loops. A read-only variant uses bounded
memory operands instead of a global `memory` clobber, allowing the compiler to
retain unrelated loaded values. This follows the dependency model described in
[GCC's extended assembly documentation](https://gcc.gnu.org/onlinedocs/gcc/Extended-Asm.html).
The bounded array type allocates no array; it describes the memory read by the
assembly. Zero-length inputs return before constructing that type.

A separate four-process comparison, before introducing the line cache, measured:

| Variant | Corpus CPU per pass | Complete ENIGMASH CPU |
| --- | ---: | ---: |
| Original | 2,142.24 ms | 3,485.15 ms |
| Read-only early-exit assembly | 2,208.94 ms | 3,457.17 ms |
| Remove anchored line filters | 1,902.10 ms | 2,808.65 ms |
| Assembly plus filter removal | 1,961.33 ms | 2,919.12 ms |

Instruction-only assembly did not provide a convincing overall gain. The first
fused/vector experiment also lost early rejection: it made a favorable isolated
four-word test 2.9 times faster while making immediate rejection slower. Fused
C++ already supplied most of that isolated improvement. Sparse-mask-list trials
were also rejected and their runtime/compiler metadata was removed.

These measurements belong to separate paired phases; compare variants within
their own phase rather than subtracting times across phases or machine loads.

## Validation

The final implementation passes:

- All **731 existing native replay cases** with both 64-bit and 32-bit masks.
- **27 JS-oracle trace comparisons, 990 snapshots total**: nine recordings
  through the 64-bit native compiler, 32-bit native compiler and 32-bit JS-IR
  reader. Cases cover rigid movement, randomness, ellipsis, property deletion,
  messages with `again`, undo, ENIGMASH, Netrunner and Vacuum.
- The native player API, cached-`again`, solver runtime-counter and mask-kernel
  checks. The final cache keeps baseline matching/rejection work intact.
- Cache invalidation, growth, generation wraparound, copy and move checks under
  AddressSanitizer and UndefinedBehaviorSanitizer.
- Randomized mask-kernel comparisons and protected-page tail checks, including
  aliased inputs, for the assembly controls. Sanitizers also pass.

JS-exported IR contains 32-bit masks and must use the 32-bit reader, as the
repository's Makefile does. An initial extra probe used the 64-bit reader and
failed at its initial snapshot for two wide-mask games; those probes were
corrected to the supported 32-bit configuration. The JSON records that setup
correction separately from the 27 passing supported checks.

## Reproduction

New native CMake builds default to `PS_PATTERN_MATCH_KERNEL=anchor-cache`.
Existing build caches can select it explicitly:

```sh
cmake -S . -B build -DPS_PATTERN_MATCH_KERNEL=anchor-cache
cmake --build build --target puzzlescript_cpp puzzlescript_solver
```

Direct non-CMake builds retain their existing baseline unless they explicitly
select a matcher. No generated WASM, desktop package or firmware was replaced.

For the repeated comparison, run from the repository root:

```sh
python3 native/tests/benchmark_pattern_match.py \
  --out build/matcher-comparison --skip-microbench
```

The runner builds isolated original/cached/adaptive executables, checks kernel
and cache invariants, alternates replay order, verifies expected end states and
saves per-case CPU/wall timings, logs, compiler/source identities and executable
hashes. Use `--kernels` for other controls, `--build-dir` to reuse an isolated
build, and `--extra-corpus` to add a replay dataset. `--hardware-counters` is an
optional macOS measurement and may require additional OS permissions.

The complete intact ENIGMASH recording is already available locally at
`build/asm-mask-experiment/enigmash.json`, prepared from the existing ignored
recording and intact source. Add `--extra-corpus` with that path to include it;
no new game source was added to the repository.

Build the optional checks with `-DPS_BUILD_MASK_EXPERIMENTS=ON` and run
`pattern_match_kernels`, `line_precondition_cache_tests` or their CTest entries.
The kernel executable accepts `--bench` for the isolated microbenchmark.

[Compact measurements and validation data](2026-11-12-arm64-pattern-matching.json)
are checked in alongside this report. Full local logs are in the ignored
`build/asm-mask-experiment/` directory: `early/` for the identical-code control,
`qualified/` for the instruction/filter comparison, `cache-qualified/` for the
final repeated measurements, and `final-traces/` for supported trace checks.
