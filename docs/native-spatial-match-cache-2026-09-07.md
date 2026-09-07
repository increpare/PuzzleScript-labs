# Native spatial match cache experiment — 7 September 2026

The prototype saves **5.6%, 5.7%, and 9.5%** of whole-process time against the clean PR #13 allocation-improved baseline, at identical search work across 1,346 levels from 184 games. It remains **opt-in**, `PS_SPATIAL_MATCH_CACHE=ON`; normal builds do not include its runtime machinery. The subsequent [250 ms deadline battery](native-spatial-match-cache-250ms-2026-09-07.md) finds **no solve-count improvement**: 754→753, 752→746, and 753→753, with no consistent gains and one consistent loss. The throughput result does not meet this deadline acceptance criterion.

## What is reused

The interpreter remembers the matching start positions of a fixed-length pattern row during one early- or late-rule phase. When rules change cells, a journal records the tile, object/movement plane, and changed-bit signature. Only starts whose predicates overlap those changes need to be tested again. Positions are stored in the original scan order, and consumers still receive a snapshot and perform the existing overlap revalidation.

The signatures include positive, negative, stationary, and disjunctive predicates. Mask words are OR-folded into one word: collisions cause extra checks, never suppressed checks. Layer-coupled movement predicates conservatively depend on all object and movement bits. Read signatures are ruleset data, calculated lazily once per row while that game remains active; they require no per-level invariant analysis. Expiration of the game's weak owner clears this metadata even if an allocator reuses its old address.

Board-dependent results expire at every phase boundary. Nothing is added to `FullState`, copied into solver nodes, or shared across sibling boards. Movement resolution, rigid retries, undo/restart, and the next level therefore cannot inherit matches from an earlier phase. Generated specialized rule groups and nested execution use the ordinary matcher. Ellipsis matching is unchanged. Each thread owns its own scratch cache.

The first collection and broad invalidations use the existing indexed matcher. A cheap admission check also bypasses caching when the first pattern has one required object with at most four indexed occurrences. That is a choice between two equivalent matching algorithms using existing counts, not a restriction on player count or game genre. The change journal is bounded; overflow invalidates all entries before discarding history.

## Measurements

MSVC Release, x64, 64-bit masks, native interpreter and production BFS. Baseline is commit `7a6cabb7` from PR #13, **already including** the allocation/tuple improvements. It is not the pre-day baseline. Each level has a deterministic limit of 100 expansions, with a 60-second error guard. Every win is replayed through the player runtime. Runs are serial, alternating order after warmup. Whole-process time includes compilation, setup, search, and replay.

| Final prototype vs clean baseline | Baseline | Cache | Time saved |
|---|---:|---:|---:|
| Pair 1 | 50.525 s | 47.675 s | 5.6% |
| Pair 2 | 49.861 s | 47.035 s | 5.7% |
| Pair 3 | 51.606 s | 46.685 s | 9.5% |

All 1,346 result rows agree exactly in each pair: status, expanded/generated/unique/duplicate/frontier counts, and full solution. Binary and corpus hashes are in the archived clean-baseline report. The wider third-pair difference is retained rather than selectively discarded; three pairs do not establish a precise universal speedup.

The development sequence matters:

| Variant | Comparison | Three paired time savings |
|---|---|---|
| V1: every changed cell invalidates every offset | Same executable, cache off/on | 4.1%, 6.0%, 0.9% |
| V2: filter by predicate read signatures | Same executable, cache off/on | 5.3%, 5.6%, 10.5% |
| V3: also bypass cheap rare anchors | Clean PR #13 executable vs candidate | 5.6%, 5.7%, 9.5% |

These separate batches do **not** isolate V3's incremental speed effect over V2. V3 bypasses about 14.2 million collections and repairs 40.4 million positions; the final clean-baseline comparison is the evidence for its net effect. V1's two initial 20-expansion pairs were mixed (6.4% slower, 6.0% faster), motivating the longer fixed-work check.

There are much larger local gains, alongside regressions. In the **V2 diagnostic batch**, summed per-game time across three pairs fell about 65% for `car crash`, 48% for `BIAXIAL INVASION OF SATURN`, 38% for `a clear view of the sky`, and 18% for `tiny treasure hunt`. Conversely, `robot arm` was about 7.5% slower and `paint everything everywhere` about 6.1% slower. These are selected diagnostic examples, not the corpus-wide result, and they must not be presented as final V3 per-game measurements. Rare-anchor admission is intended to reduce cheap-match overhead; it does not prove every affected game stops regressing.

Read filtering reduced repaired positions from 75,916,347 to 43,533,109 at identical work (42.7%). This is a mechanism measurement; the timing table, rather than fewer checks alone, establishes the speed improvement.

## Correctness checks

- All 470 recorded native gameplay cases pass with each corrected variant.
- Six existing tuple regressions cover enumeration order, overlap invalidation, captures, empty matches, and ellipsis fallback, in both player and solver modes with undo/restart.
- Four added propagation cases run cache off/on, in player/solver modes, across all directions, non-square boards, and mask-word boundaries; they assert actual cache reuse.
- Native player API tests pass.
- The default cache-disabled configuration also builds and passes all 470 gameplay cases and the six tuple regressions.
- A separate `PS_SPATIAL_MATCH_VERIFY=ON` build reruns the uncached collector after **every** cached collection and compares the complete ordered vectors. All 470 gameplay cases and the focused tests pass. Its full corpus run at 100 expansions verifies **15,510,591** reused lists with no discrepancy and reproduces all 1,346 baseline solver results, including win replays.
- The same-executable comparison runner passes a full-corpus one-expansion smoke check.

The first prototype exposed a real invalidation bug: coalescing consecutive changes to one tile is unsafe when a collector consumes the first event before the next write. Eleven gameplay recordings failed. Every actual change now gets its own event; the complete suite and intermediate-list oracle pass after the correction. The code comment preserves this reason so future compression does not reintroduce the bug.

Timing builds have the fresh-scan oracle disabled. Verification timings are not performance results. The later deadline battery is documented separately above. No generator performance run was performed, and 32-bit-mask/platform-specific builds have not been validated for this experiment.

## Reproduction and evidence

Build the usual native targets with `-DPS_MASK_WORD_BITS=64 -DPS_SPATIAL_MATCH_CACHE=ON -DPS_SPATIAL_MATCH_VERIFY=OFF`; keep generated rule sources empty for the interpreter comparison. Retain a separate clean `7a6cabb7` build. Substitute the executable paths appropriate to the local generator/configuration:

```text
node src/tests/compare_native_fixed_work.js BASELINE_EXE CANDIDATE_EXE src/tests/solver_tests build/spatial-clean.json 3 100
node src/tests/compare_native_spatial_cache.js CANDIDATE_EXE src/tests/solver_tests build/spatial-modes.json 3 100
```

For the intermediate oracle, rebuild with `PS_SPATIAL_MATCH_VERIFY=ON`, then run:

```text
puzzlescript_cpp simulation-testdata src/tests/resources/testdata.js --quiet
runtime_match_tuples
puzzlescript_cpp_player_api_tests
solver_fixed_work_bench src/tests/solver_tests 100 cache-on
```

The [compressed evidence archive](benchmarks/2026-09-07-spatial-match-cache.json.gz) contains exact report/log text with SHA-256 hashes, the V1/V2 development patches, their shared experimental header, the original same-executable orchestration script, and hashes of the retained V1/V2/V3 timing executables. V3 source is this commit with verification disabled. The archive also retains the ordered-list verification results and runner smoke report.

The follow-up deadline battery did not improve overall solves. Further work would need to reduce collection/dispatch and journal overhead, potentially using these dependency signatures to schedule affected rows directly. That remains an untested direction; the current experiment does not implement a persistent spatial dependency graph and should stay disabled by default.
