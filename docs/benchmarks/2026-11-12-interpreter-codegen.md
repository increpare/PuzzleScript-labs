# Interpreter profiling: eliminate copies exposed by the assembly

12 November 2026. The interpreter now uses **31.3% less replay CPU time across
the 731-case suite** and **18.6% less on the complete ENIGMASH recording**.
These are additional gains over the preceding `anchor-cache` interpreter,
measured against a frozen copy of that executable.

The changes are portable C++. Native CMake builds enable them by default;
`PS_INTERPRETER_TUNING=OFF` retains the old operations as a profiling control.
Direct builds also enable tuning by default. No specialized rule backend or
handwritten assembly was added.

The [next profiling passes](2026-11-12-interpreter-passes.md) use this version
as their baseline and add another 3.5% reduction across the suite and 12.3% on
the complete ENIGMASH recording.

| Replay workload | Previous interpreter | Snapshot change alone | All four changes | CPU time reduction |
|---|---:|---:|---:|---:|
| Full 731-case suite | 1963.402 ms | 1431.519 ms | 1349.140 ms | 31.3% |
| Complete ENIGMASH recording | 2927.876 ms | 2459.004 ms | 2381.958 ms | 18.6% |

Selected cases from the same full-suite runs:

| Case | Previous | Tuned | CPU time reduction |
|---|---:|---:|---:|
| collapse long | 157.213 ms | 69.069 ms | 56.1% |
| paint everything everywhere! | 3.481 ms | 1.463 ms | 58.0% |
| Karamell | 9.156 ms | 5.116 ms | 44.1% |
| gallery: vacuum | 5.641 ms | 3.832 ms | 32.1% |
| netrunner test | 5.175 ms | 5.013 ms | 3.1% |

All **132 cases with baseline replay CPU time of at least 1 ms improved** in
the median. Smaller cases are retained in the raw results but are too brief
for useful individual timing conclusions.

## What the profile and assembly exposed

1. **Undo snapshots copied the undo history, then cleared it.** The sample
   attributed substantial memory copying and allocation to `MetaGameState`'s
   copy constructor beneath `makeUndoSnapshot`. The linked assembly confirmed
   the full-state copy followed by destruction of the copied history. Metadata
   now lives in a `MetaGameStateData` subobject, which snapshot assignment copies
   directly. Ordinary state copies still retain their history. Both fresh
   snapshots and reused turn-start snapshots use the new assignment.
2. **Five-bit direction reads allocated full vectors.** Aggregate movement
   matching called `movementFieldAtLayer` four times, each copying a complete
   mask just to extract one field. The old linked layer matcher contained four
   allocator calls; the new matcher contains none. A bounded pointer read
   loads one word, or two when the field crosses a word boundary. It preserves
   zero extension at the mask's end and works with both mask widths.
3. **Movement resolution copied masks before rejecting collisions.** It now
   checks the target first. Successful moves allocate two writable masks,
   rather than four masks; blocked moves allocate none in this helper. Audio
   reads the original source through a pointer before either cell setter runs.
   The extra display mask is constructed only when movement debugging is on.
4. **Replacement scratch buffers called out-of-line `resize` repeatedly.**
   The assembly showed four calls on the common replacement path, even when
   sizes were already correct. Explicit size checks avoid those calls while
   still resizing when needed.

The combined replay improvement beyond snapshot changes alone is another
5.8% on the suite and 3.1% on the complete recording. The aggregate-heavy
cases make the direction-field change particularly visible.

A separate horizontal match-sort experiment converted tile indices to integer
sort keys to avoid divisions inside comparisons. Its two-process screening
comparison increased full-suite CPU time by 3.7%, so it was removed. The
individual copy/call experiments and their screening measurements remain in
the accompanying JSON; the default contains the four changes above.

## Measurement

ARM64 Mac, macOS 26.6.2, Apple Clang 21.0.0; Release `-O3`, LTO,
`-march=native`, 64-bit masks, `PS_PATTERN_MATCH_KERNEL=anchor-cache` throughout.
Four independent processes per variant, alternating forward/reverse order.
Each process replays the whole suite three times, or the complete ENIGMASH
recording once. The table uses the median CPU time per pass.
The replays use normal playable undo, so the snapshot gain depends on history
length.

`--cpu-timers --jobs 1` times replay separately from source compilation, session
creation, level loading and final serialization. Runtime counters, profiling
atomics and trace checking are disabled during timing. `/usr/bin/time -lp`
also reports **15.9% fewer retired instructions on the suite** and **9.9% fewer
on ENIGMASH**. Those counts cover the entire process, including compilation,
and are a separate measurement from replay CPU time.

After adding explanatory comments and rebuilding for validation, the executable's
`__text` section remained byte-identical to the measured tuned executable:
2,155,952 bytes, SHA-256
`e4f09cca6929da084f3c65bb190155d2adb913c7625d73ecc2c4cf6fea2f1c20`.

## Validation

- All 731 replay cases pass with both 64-bit and 32-bit masks.
- Six relevant CTests pass in the 64-bit build; four in the 32-bit build,
  including player API, cached AGAIN, sparse replacement and the new interpreter
  checks. The 64-bit run also checks matcher kernels and line-cache behavior.
- Twenty-seven JS trace comparisons pass: nine recordings through the native
  64-bit compiler, native 32-bit compiler and JS-exported IR reader (32-bit),
  totaling 990 snapshots. These include rigid/random rules, ellipses, property
  clearing, AGAIN/message, undo, ENIGMASH, Netrunner and Vacuum.
- New tests check movement fields against an independent bit-by-bit reference,
  every five-bit value across boundaries, null/empty/truncated masks, large
  invalid layer indices, snapshot reuse, movement sounds, blocked pushes,
  action input using the same source/target cell, and undo.
- The new checks pass with AddressSanitizer and UndefinedBehaviorSanitizer.
- `native_runtime_counters_node.js` passes against the rebuilt native solver.

## Reproduction

For a current-source comparison, build two otherwise identical Release trees,
with `PS_INTERPRETER_TUNING=OFF` and `ON`, keeping
`PS_PATTERN_MATCH_KERNEL=anchor-cache` and the same mask width. The metadata
subobject organization exists in both modes; the control restores the former
copying, field-reading, movement and resize operations. The published baseline
was frozen before this follow-up rather than rebuilt from that control.

```sh
python3 native/tests/benchmark_interpreter.py \
  --binary baseline=build/interpreter-before/native/puzzlescript_cpp \
  --binary tuned=build/interpreter-after/native/puzzlescript_cpp \
  --out build/interpreter-comparison --runs 4 --repeat 3
```

Add `--extra-corpus path/to/recording.json` for a second workload and, on macOS,
`--hardware-counters` for process instruction/cycle counts. The runner checks
every replay result, rejects enabled runtime counters and verifies that the
binaries do not change during measurement.

[Raw results and provenance](2026-11-12-interpreter-codegen.json) include all
731 case medians, process measurements, hashes and screening results. Local
executables, source snapshots, sampled stacks, disassembly and validation logs
are under `build/interpreter-codegen-20261112/`.
