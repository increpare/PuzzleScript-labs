# Upstream week ports, 23 October 2026

Ports from upstream commits integrated during 16–23 October, through b44aa265, onto Labs baseline 15435f72. The wide editor palette branch is excluded; the existing palette layout is retained.

## Changes retained

- JavaScript: cursor-based lazy-generation queue, predicate-driven selective word loads, shape-shared sparse deterministic replacements, and direct single-cell application. Sparse writes retain change flags, complete-cell Zobrist hooks, sound masks and board summaries. Capture bindings and verbose debugging retain their existing path.
- C++: distinct one-cell matches skip redundant interpreter rechecks. Generated rule-group/full-turn row helpers use sparse object/movement writes for masks at least three words wide with at most half their words touched. Existing compiled matcher predicates already skip unused words. The compact-kernel helper variants and generic interpreter mask loops are unchanged.
- Correctness: commented loop markers, recording resets after title/message transitions, escaped test dumps, scoped Base64 counters, and case-insensitive .htm imports. IDE remains mutable because MIS and the fuzzer assign it.
- Native diagnostics: the 17 new/updated upstream cases now pass independently, including loop pairing, malformed movement cells, ellipses, random modifiers/spawns, missing sound declarations, numeric dimensions, redundant negative layer tests and long ASCII titles. Non-ASCII title truncation still requires native font-table parity.
- Player: upstream mobile controls, settings and board placement; editor preview expansion adapted to the CM6 public focus API; audio buttons survive sound-availability changes; text glyphs are reused until state, dimensions, foreground color or scanline mode changes.
- Build: SWC and Lightning CSS, restored per-file source maps, explicit separators between concatenated scripts, separate standalone bundle without the GitHub loader, release filtering, and CGI sources moved to server/. The awaited build, CM6 bundle check, source-copy MIS workers and Brotli settings are retained.

CM5 editor changes, palette experiments, gallery deletions and personal deployment changes were excluded. The rendering follow-up's glyph-cache changes were ported without its CM5-specific editor layout changes.

## Measurements

All performance comparisons use before/after/after/before ordering on the same Windows x64 machine. JavaScript uses Node 22.12.0; native uses Visual Studio 2022 Release, 64-bit mask words. Benchmarks ran sequentially, with one solver job, weighted A*, and a 125 ms per-level deadline. Both solver suites contain 2,790 entries: 1,346 board levels and 1,444 message entries.

| Measurement | Before | After | Change |
| --- | ---: | ---: | ---: |
| Complete JS fixture suite, 794 cases | 12.540 s | 11.545 s | -7.9% |
| JS fixture input processing | 9.479 s | 8.571 s | -9.6% |
| JS solver matched cohort, 393 levels | 12.099 s | 11.312 s | -6.5% |
| Native solver matched cohort, 481 levels | 11.848 s | 11.598 s | -2.1% |
| Generated C++ source, 234 linked files | 210,546,566 bytes | 207,822,312 bytes | -1.3% |

Cohorts require a solve in all four runs, identical expanded/generated counts, every run below 100 ms, and a baseline mean of at least 2 ms. Timings are sums of per-level means. These are measured aggregate improvements, not promises that every game gets faster.

Deadline-sensitive solve counts were JS 485/494/492/477 and native 716/710/708/697 in execution order. All runs had zero errors and unchanged exhausted counts (JS 36, native 7). Repeated native controls for the apparent slowdowns used the same search work. Median Cakemonsters level 33 was 104 ms before and 103 ms after; the other five controls were essentially flat (differences of 0–1 ms). No large native speedup is claimed.

The JS fixture comparison swaps only engine.js and globalVariables.js back to the saved baseline. Fixtures, compiler fixes and other files are identical between variants. Native comparisons use the saved baseline generated solver and regenerated candidate with the same 200,000-line per-source cap and the same linked sources/profiles.

Detailed cohort rows, run totals and control samples are in [the measurement data](2026-10-23-upstream-week-ports.json).

## Validation

- 794 source JS fixtures and 794 SWC-minified fixtures pass, with random-solver replay and sparse-path canaries.
- 473 native gameplay fixtures pass; 724 distinct native solutions across the runs replay without generated backends.
- 507 distinct JS solutions replay successfully using the baseline engine.
- All 17 changed native diagnostic fixtures pass after adding unique source comments and running in an empty directory. This bypasses the pre-existing exact-fixture diagnostic lookup; corpus lookup results alone are not counted as validation.
- Full static-analysis fixture suite passes.
- Sparse native setters match full-width setters for cell indices, sound masks, summaries and dirty caches, with untouched input words deliberately poisoned.
- 16 source/release browser layouts pass: phone, landscape, desktop light/dark, standalone exports, settings, audio, held-key release, CM6 focus, level-editor palette toggling and glyph reuse/repaint.
- 199 CM6/release checks pass; one symlink-only check is explicitly skipped because Windows denies symlink creation. npm invocation is now Windows-compatible.
- Release build succeeds; 234 Brotli sidecars verify.

Native validation uses the isolated CMake harness from the preceding solver work, linking tracked compiler/runtime/test sources. The tracked native/CMakeLists.txt was empty at baseline; this port does not repair that unrelated build configuration.
