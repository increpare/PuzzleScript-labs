# More interpreter passes: selective replacement words

12 November 2026. Another **3.5% reduction in replay CPU time across the
731-case suite**, and **12.3% on the complete ENIGMASH recording**, beyond the
previous interpreter optimizations. The accepted change updates only the mask
words a static replacement can affect.

| Workload | Previous interpreter | Final | Less CPU time |
|---|---:|---:|---:|
| Full 731-case suite | 1347.451 ms | 1300.640 ms | 3.5% |
| Complete ENIGMASH recording | 2377.115 ms | 2084.824 ms | 12.3% |
| Selene's Labyrinth | 144.212 ms | 115.201 ms | 20.1% |
| ENIGMASH, corpus recording | 49.618 ms | 42.983 ms | 13.4% |
| VEXT EDIT B | 25.521 ms | 23.035 ms | 9.7% |

The per-case gate covers **105 cases with baseline CPU time at least 1 ms**.
None increased by 0.25 ms or more; the largest increase was 0.201 ms. This is a
timing tolerance, rather than a claim that every individual case improved.
All case medians are included in the JSON.

## Accepted implementation

The fresh sample put matching and replacement at the top of the profile.
Replacement assembly contained word loops, repeated nullable-mask checks and
writes even for words whose clear/set masks were entirely zero.

The source compiler and IR loader now derive two small bitmaps from a static
replacement's masks. The interpreter visits those words, records the ones that
actually changed, and uses the existing sparse setters to maintain cell indices,
line/board summaries and dirty flags. It accumulates creation/destruction masks
only for changed words. Scratch words outside the plan are never read.

The bitmaps support eight object words and sixteen movement words. The plan is
used when there are at least four words total and at most half are active.
Dynamic, random, dense and larger replacements retain their existing path;
rigid rules also retain their existing application path. Plan construction is
outside replay timing.

Packing the old flags into one byte leaves room for the bitmaps in the existing
flags/padding area. On this ARM64 host, `Replacement` remains **104 bytes** and
`Pattern` remains **232 bytes**. There are no per-pattern bitmap allocations.

Assembly inspection exposed a second problem: the compiler initially inlined
the selective updater, enlarging the ordinary replacement function from 2600
to 2910 instructions. An explicit noinline annotation keeps its stack arrays
and branches separate. The final common function is 2624 instructions, with a
372-instruction selective helper. The final build passes the case gate above.

The parity test also found a sound-tracking edge case: the old accumulator grows
a nonempty short sound mask to the full object width on an object change. The
new path preserves that behavior, including destruction-only changes, while
leaving empty masks and no-op replacements alone.

## Other passes evaluated

- **Direct one-word matcher:** replaced runtime word loops with scalar tests
  for one-word objects and movements. Its two-run screening result was
  effectively flat on the suite and slightly slower on ENIGMASH. Removed.
- **Local OR/AND reductions for rebuilt summaries:** reduced accumulator
  loads/stores and allowed vector reductions. The generic version helped the
  suite in screening but did not improve the long recording. Restricting it
  to one-word masks was flat on the suite. Both versions were removed.
- **Skipping inactive movement layers:** used bit scans while retaining layer
  order. A four-run comparison against selective replacements alone showed
  slightly more instructions and no additional replay improvement. Removed.

The initial selective-update sketches and their measurements are archived as
experiments. The final implementation includes both the sound-mask fix and
the noinline annotation.

## Measurement and validation

ARM64 Mac, macOS 26.6.2, Apple Clang 21; Release `-O3`, LTO, `-march=native`,
64-bit masks, `PS_PATTERN_MATCH_KERNEL=anchor-cache`, tuning enabled. The
baseline is a frozen copy of the previous optimized interpreter, including
all four changes from the preceding study.

Four independent processes per variant alternate forward/reverse order. Each
process replays the corpus three times or the complete ENIGMASH recording once.
Tables use median CPU time per replay, with compilation, loading and final
serialization excluded. Normal playable undo is enabled. Runtime profiling
counters are disabled and verified as zero by the benchmark runner.

Whole-process hardware counts, including compilation, fall **3.0% in retired
instructions on the suite** and **14.8% on ENIGMASH**. These are separate from
the replay CPU measurements.

- All 731 replay cases pass with both 64-bit and 32-bit masks.
- Seven relevant CTests pass with 64-bit masks; five pass with 32-bit masks.
- Twenty-seven JS trace comparisons pass, totaling 990 snapshots across native
  64-bit compilation, native 32-bit compilation and JS-exported IR (32-bit).
- The new parity test compares selective and ordinary replacements on randomized
  boards with poisoned scratch buffers, repeats replacements to check no-ops,
  and checks indices, summaries, dirty flags and empty/short/full sound masks.
- New and existing focused checks pass under AddressSanitizer and UBSan.
- The replacement checks pass with object-mask refcounts forced on and off.
- The native runtime counter contract and disabled-tuning syntax checks pass.

Removing temporary experiment switches produces identical enabled preprocessed
C++ for both mask widths. The final rebuilt CLI also has byte-identical `__text`
to the executable used by the trace checks: **2,160,120 bytes**, SHA-256
`a9e4f8382d6db3bb2933a2e0cff151903d9ffd6cf102b24225cfcfc0fb67c7ef`.

## Reproduction and artifacts

The existing `PS_INTERPRETER_TUNING` switch controls the new path along with the
previous changes. For this incremental measurement, use the frozen executables
under `build/interpreter-passes-20261112/`, or rebuild the saved source snapshot
for the previous version.

```sh
python3 native/tests/benchmark_interpreter.py \
  --binary baseline=build/interpreter-passes-20261112/baseline \
  --binary final=build/interpreter-passes-20261112/final \
  --out build/interpreter-passes-comparison --runs 4 --repeat 3 \
  --extra-corpus build/asm-mask-experiment/enigmash.json
```

On macOS, add `--hardware-counters` for process instructions and cycles.
[Raw results and hashes](2026-11-12-interpreter-passes.json) include the accepted
comparison and the earlier screening passes. Sampled stacks, disassembly,
source snapshots/diffs and test logs are in `build/interpreter-passes-20261112/`.
