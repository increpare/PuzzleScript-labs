# Solver and generator improvements — 6 September 2026

The first implementation pass removes the legacy native generator's private
search engine, corrects candidate assessment, and makes the compiled generator
usable on Windows. JavaScript search heuristics are unchanged. Source comments
and individual commit messages explain each performance or solver change.

The branch was synchronized with `origin/master` at `528bdf78`. The 63 upstream
commits after the original `049248de` audit baseline changed Pocket Card hardware
only; they did not invalidate the solver/generator findings or measurements.

## Implemented

| Change | Why it matters |
| --- | --- |
| Correct MIS `option` probability arithmetic and use the selected alternative's probability | Integer division made almost every fractional probability behave like certainty. |
| Preserve primary timeout, exhaustion and error status through difficulty assessment and the MIS bridge | A timeout remains unknown and eligible for retry; it is no longer misreported as an engine error. |
| Reuse the first primary solve in level-set assessment | A qualifying candidate now runs one primary plus three supplemental searches, instead of paying for a second primary. |
| Compare primary effort with the keeper's final difficulty | Primary is an upper bound on the minimum of the four solver costs. A keeper with primary 1000/final 10 must not exclude a candidate with primary 500/final 100. |
| Reject known solved duplicates before primary assessment | Repeated boards no longer consume another primary budget. Timeouts remain retryable; simultaneous uncached duplicates can still perform duplicate work. |
| Replace legacy generator search with the shared native C API | Removes roughly 300 lines of duplicate search/projection code and shares compact storage, exact search-state equality, maintained portfolio policies and replay verification. |
| Replay generated solutions with normal runtime semantics | Search success is accepted only when the returned inputs win on the actual candidate and the same gameplay seed. Startup AGAIN wins are recognized, including last-level completion. |
| Preserve original game source when attaching compiled backends | Replacing the LEVELS section previously changed the lookup hash, silently losing linked specialization. Recipe boards are lowered separately and checked for compatible object/layer layout. |
| Repair MSVC code generation and backend linkage | Portable bit scanning and weak-link alternatives allow generated kernels to compile and coexist with null fallbacks. |
| Repair level-set interruption smoke and default benchmark mode selection | The interruption probe had malformed arguments and could miss early process exit. The legacy benchmark now explicitly reports level-set recipes as skipped. |

The legacy generator exports its separate generation and gameplay seeds and
identifies the shared solver in JSON. Backend fields report attachment, not
measured execution hits. A partial specialization may still fall back to the
interpreter.

## Measurements

Windows x64, MSVC Release `/O2`, 64-bit masks, one candidate worker, seed 11,
200 candidates per preset, three repetitions, 50 ms per solve. These comparisons
isolate shared-solver integration without linked kernels; they precede the
source-identity and Windows backend fixes. Baseline and changed runs were
sequential, not interleaved. Raw per-run counters and timings are retained in
[the benchmark data](benchmarks/2026-09-06-generator-shared-solver.json).

| Strategy / preset | Baseline median candidates/s | Shared solver | Change | Solves across 600 attempts, before → after |
| --- | ---: | ---: | ---: | ---: |
| Portfolio / room scatter | 40.07 | 47.79 | +19.3% | 31 → 30 |
| Portfolio / transform pairs | 33.13 | 36.64 | +10.6% | 3 → 3 |
| BFS / room scatter | 45.21 | 44.79 | −0.9% | 9 → 8 |
| BFS / transform pairs | 38.36 | 38.09 | −0.7% | 3 → 3 |

The portfolio throughput improvement does **not** establish a general engine
speedup or improved solve rate. The fixed-strategy BFS control is effectively
flat/slightly slower. Compact storage avoids copying full runtime scratch on
every edge, but exact duplicate checking, replay and other policy differences
also have costs. The measured default gain belongs to the integrated search
policy and reduced redundant work. Repeated samples are not independent puzzle
populations, and deadline-bound outcomes vary between runs.

Removing a duplicate primary saves one search per qualifying level-set candidate;
the early cache saves one primary per hit. These are structural work reductions,
not measured corpus-wide multipliers. No compiled-versus-interpreted speed ratio
is claimed in this pass.

## Validation and compatibility

- All 470 JavaScript game simulation tests pass; the JS/native solver parity
  smoke passes its 16 fixtures.
- Native probability, difficulty-status/call-count, keeper admission and cache,
  generated-solution replay, and partial-backend linkage regressions pass.
- Legacy generator smoke and JSONL-event tests pass with and without linked
  Sokoban kernels. Coverage includes differing recipe boards, message-first
  source games, fixed-seed jobs and repeated searches.
- Level-set and remix smoke tests pass with linked kernels, including output
  generation and interruption handling.
- Original-source Sokoban code is emitted, compiled and linked with MSVC x64;
  the generator reports rulegroup, full-turn and native compact attachment.
  A 32-candidate smoke run returns four replay-validated solutions.
- The default legacy benchmark runs both compatible presets and explicitly
  records the level-set recipe exclusion.

The C `ps_solve_options` struct gains an optional borrowed `random_seed` field;
clients must rebuild. Default seeding remains unchanged. Recorded gameplay seeds
reproduce the validated stream; they are not evidence of solvability for every
random seed.

The legacy default portfolio and its effort scores change. Scores should carry
a solver version and configuration when compared across runs. They are measures
of solver effort, not an invariant or human difficulty rating. Recipe lowering
now incurs one additional compilation per run to preserve parser semantics and
source identity. MSVC x86, GCC/Clang, and the full openFrameworks MIS GUI were
not built in this pass; MIS probability and shared assessment were tested
through standalone native targets.

## Next implementation priorities

1. **Completed in the second pass: bounded, interruptible assessment.** The
   generated-board C API now polls a borrowed cancellation callback before work,
   between search edges and during replay. Its seeded portfolio also honors
   `max_expanded`. Shared difficulty assessment carries one deadline across all
   lanes and marks interrupted refinement, which is never admitted as a completed
   difficulty score. Both native generator modes and MIS stop/request flags are
   wired through; inactive work no longer waits out every solver timeout.

   Level-set `--samples` is a total budget divided across blocks; started
   candidates finish when sample slots run out. Explicit `--time-ms` applies
   across the run. Interrupted candidates release dedupe claims for retry.
   `--out` and `--json-out` can produce both the game and a run summary. Strategy
   and event options unsupported by level-set assessment fail clearly. The
   progress reporter wakes at shutdown, and signal handlers only set a lock-free
   flag rather than flushing a mutex-protected writer.

   `run_generator_benchmark.js --mode level-set` now measures compatible recipes
   separately, with per-run deadlines and an outer watchdog. Three 200-sample
   runs of the tiny preset each produced 100 samples per block, two retained
   keepers and zero interrupted assessments. Their end-to-end durations were
   224/212/211 ms on this machine with compiled Sokoban kernels. This is a new
   bounded-run baseline, **not a speedup comparison**; see
   [the recorded runs](benchmarks/2026-09-06-generator-levelset-bounded.json).

   Tests cover all five solver strategies, cancellation before and during
   search/replay, shared lane budgets, seven samples distributed 4/3 with eight
   workers, zero samples, and 120 ms run limits with 60-second solver budgets.
   Existing parity, keeper, difficulty, legacy/event, level-set and remix checks
   pass. C API clients must rebuild for the callback fields. Runtime turns and
   startup rule drains remain non-preemptible, so these are cooperative
   deadlines, not hard real-time guarantees. The full MIS GUI was not built.
2. **Implemented for level-set generation and MIS: shared exact lane evaluation.**
   See [the cache and push-search report](evaluation-cache-and-push-search.md).
   Complete boards, gameplay seeds and assessment budgets identify cached work;
   concurrent workers share pending searches, and unknown/error results retry.
   The legacy single-recipe generator retains its separate dedupe policy.
3. **Separate profiling from search decisions.** Both JS and native portfolio
   policies should make the same decisions with detailed timing enabled or
   disabled. Use cheap, consistently sampled measurements and record the chosen
   schedule before comparing optimizations.
4. **Prototype implemented; production routing remains pending.** A separate
   `puzzlescript_push_solver` accepts a strictly certified standard Sokoban
   subset, passes 1,920 exhaustive small-board differential checks and replays
   solutions in native and JS runtimes. See the report linked above.

   **Certify puzzle structure before specializing search.** A conservative
   Sokoban-like detector can enable push-space search, player-region
   canonicalization, reverse-push reachability and deadlock tables. Fall back to
   general search when rules can teleport, create/destroy objects, depend on
   movement history, or otherwise violate the model. Check solutions by normal
   replay and compare small search spaces exhaustively before enabling pruning.
5. **Generate a varied collection rather than only maximizing search effort.**
   Maintain separate quality/diversity buckets for dimensions, solution length,
   interaction patterns and structural features. Mutate proven-solvable parents,
   replay their known solutions as a cheap first check, then re-solve when needed.
   Use reverse construction only for rules whose inverse transitions are known;
   validate forward afterwards. Score difficulty with several solvers and test
   robustness to gameplay seeds for stochastic games.

These later search and generation policies remain proposals. They should be
judged on a representative held-out corpus with fixed budgets, replay success,
memory usage, solve rate and generated-level diversity; higher node counts alone
are not evidence of better puzzles.
