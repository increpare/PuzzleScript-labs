# Five further interpreter codegen passes

12 November 2026. **Five additional passes completed; no new engine changes
retained.** The longer comparisons rejected the marginal candidates. The
original interpreter source and its executable code have been restored.

The baseline is commit `a564e3a4`, including the previous matcher, snapshot,
movement-field and selective replacement-word improvements. These measurements
start from that optimized version.

## The five passes

1. **Enumerate set object bits when finding collision layers.** The optimized
   assembly still scanned every object ID, shifting/testing a mask bit for each
   one. The experiment iterated nonzero words with trailing-zero bit scans,
   preserving object bounds, layer sorting and duplicate removal. Two-process
   screening reduced suite CPU time by 0.8% and was flat on the long recording.
   The effect was too small to justify keeping this change.
2. **Reuse the movement-mask buffer within a resolve call.** Line-mapped assembly
   showed `operator new` and `memcpy` beneath the per-moving-cell vector
   constructor. The experiment retained one vector through the successful and
   failed-movement scans. Screening was flat: suite CPU time increased 0.1%,
   while the recording decreased 0.1%. Rejected.
3. **Reuse writable source/destination masks during movement.** The existing
   getter constructs owning vectors. The experiment retained a pair of buffers
   across movement attempts, including aggregate-player movement, and copied
   current cell words into them. Screening suggested 0.7% less suite time and
   1.2% less recording time. The longer comparison reduced those to about 0.5%
   each and increased Selene's Labyrinth by 0.635 ms, failing the case gate.
4. **Guard the remaining dynamic/rigid scratch resizes.** Optimized assembly
   still called libc++ `vector::resize` at steady-state sizes. Explicit size
   checks covered nine additional source sites, including shared initialization
   lambdas. Screening suggested 0.6% less suite time and no recording gain.
   The longer comparison found only 0.3% less suite time, with Hedges increasing
   1.563 ms and Selene increasing 0.511 ms. Rejected.
5. **Unroll early-exit mask matching by two words.** The linked assembly used a
   decrement and loop branch for each word. The first experiment retained a
   rejection after each word while halving loop iterations, but generated extra
   32-bit index arithmetic and was flat in replay. A pointer-increment revision
   removed that index bookkeeping; replay CPU time nevertheless increased 1.9%
   on the suite and 0.7% on the recording. Both revisions were rejected.

Each pass has a saved source snapshot, compiled executable, assembly excerpt
and replay measurements under `build/interpreter-five-more-20261112/`.

## Longer comparison

Four independent processes per variant, alternating forward/reverse order.
Each process replays the 731-case suite three times or the complete ENIGMASH
recording once. Values below are median replay CPU milliseconds per pass.

| Variant | Suite | Complete ENIGMASH | Suite reduction |
|---|---:|---:|---:|
| Optimized baseline | 1329.746 | 2110.877 | — |
| Source/destination buffer reuse | 1323.200 | 2101.055 | 0.49% |
| Extra resize checks | 1326.294 | 2106.375 | 0.26% |
| Both changes | 1321.849 | 2106.146 | 0.59% |

The combined candidate reduced whole-process retired instructions by 0.61% on
the suite and increased them by 0.04% on ENIGMASH. These process counts include
compilation; replay timings exclude compilation, loading and serialization.

The established case gate rejects increases of at least 0.25 ms among cases
with baseline replay CPU time of at least 1 ms. There were 105 qualifying cases.
The combined candidate increased Hedges by **2.104 ms** and Selene by
**1.247 ms**, so its small aggregate gain did not qualify it for the default.

## Evidence and restored state

- ARM64 Mac, macOS 26.6.2, Apple Clang 21; Release `-O3`, LTO,
  `-march=native`, 64-bit masks, `PS_PATTERN_MATCH_KERNEL=anchor-cache`,
  `PS_INTERPRETER_TUNING=ON`.
- Inspected the linked executable disassembly and line-mapped `-O3` compiler
  assembly for helpers that LTO had inlined into larger interpreter functions.
- Audited all **80 timed replay processes**: every requested replay passed,
  and runtime profiling counters were zero. The six screening variants include
  two implementations of pass 5; the longer comparison covers four variants.
- All five baseline production-source hashes match after restoration.
- Rebuilt the normal native CLI. Its `__text` matches the frozen baseline
  byte for byte: **2,160,120 bytes**, SHA-256
  `a9e4f8382d6db3bb2933a2e0cff151903d9ffd6cf102b24225cfcfc0fb67c7ef`.
- The restored CLI passes a fresh **731/731** replay run.

No experimental switches, buffer changes, matching loops or new engine tests
remain in the production worktree. This pass adds the measurement record.

[Raw measurements, case medians and audit data](2026-11-12-interpreter-five-more.json)
include all five pass records, screening runs, the longer comparison and
restoration hashes. The saved `baseline-O3.s`, `baseline.s`, per-pass assembly
excerpts and variant source snapshots provide the local codegen evidence.
