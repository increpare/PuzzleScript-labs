# Native C++ Interpreter Optimization Plan — handoff

Written 2026-07-03. Standalone handoff plan for optimizing the C++ *interpreted*
runtime (`native/src/runtime/`) and its solver. The interpreter is the practical
production path: game-agnostic, no per-game codegen/compile latency. The
compiled tier (specialized backends) is the throughput calibration ceiling, not
the target.

This is the native companion to
`docs/solver-forensics/2026-07-03-anonymous-game-500ms-optimization-plan.md`
(JS-first diagnosis of the same investigation; also contains this content as a
section). Facts below are from code inspection and the forensics artifacts;
impact estimates are inferences pending the counter experiments (NX1).

## Context for a cold start

- Runtime core: `native/src/runtime/core.cpp` (~7.6k lines), `core.hpp`
- Solver: `native/src/solver/main.cpp`; heuristics backlog:
  `native/src/solver/HEURISTICS_IMPLEMENTATION.md`
- Build: CMake in `native/` (Release: `-O3`, LTO on, `-march=native` on)
- Runtime counters already plumbed: `ps_runtime_counters_set_enabled/reset/snapshot`
  (`native/src/runtime/c_api.cpp:716-724`), counter fields like
  `maskRebuildCalls`, `candidateCellsTested`, `patternTests`, `rulesVisited`,
  `rulesSkippedByMask`, `specializedRulegroup*`
- JS/native parity + coverage harnesses: `src/tests/run_solver_parity_smoke.js`,
  `src/tests/run_solver_compact_parity.js`, `src/tests/native_solver_js_coverage_node.js`
- Env knobs honored by native runtime/solver: `PUZZLESCRIPT_INPUT_SPECIALIZATION`,
  `PUZZLESCRIPT_INCREMENTAL_PRUNE` (see `applyRuleGroup`)
- Sync/design notes: `native/PLAN.md`, `native/SYNC_WITH_JS_PLAN.md`
- Prior profiling (memory note, HDA solver profiling 2026-06-16): step = 82-90%
  of time; **malloc ≈23%** + clock ≈14% overhead; HDA scales only ~45% at 8
  threads (allocator cross-thread-free contention, not duplicate explosion);
  deadline batching + buffer pool landed in PR #3 recovering only ~2-4%.

Benchmark game (worst-case step-cost canary): the snakebird-style game in
`build/solver-forensics/anonymous-js-first-500ms/input-corpus/` — 251 objects,
82 collision layers, 551 rule lines, large levels (median ~506 cells, max
2385). Native interpreter: 717µs/generated; native compiled: 62–77µs; JS:
2115µs (summary.json in the same dir). Corpus @500ms (historical): JS 710 →
C++ interp 842 → C++ compiled 917 → HDA compiled 1003 (of 1346 playable).

## What the interpreter already does well

Do not redo these; they're in place and working:

- 64-bit mask words (this game: 4 object + 9 movement words vs 8+17 in JS
  32-bit words); all per-game masks in a contiguous `Game::maskArena`
  accessed by offset (`core.hpp:34-112`)
- Per-object cell bitboards with incremental maintenance (`objectCellBits`,
  `objectCellCounts` via `setObjectCellIndexBit`, `core.cpp:2291-2324`) —
  object-anchored scans walk set bits with ctz and get O(1) selectivity counts
- Rarest-anchor selection for object-anchored rows (`chooseRowAnchor`)
- Dirty-row/col/board mask rebuilds (`rebuildMasks`, `core.cpp:5300-5520`)
- `ruleCanPossiblyMatch` checks both board object AND movement masks
  (`core.cpp:4439-4454`)
- Input specialization per rule (`Rule::activeInputsMask`), incremental prune
  inner-loop guard, single-row match scratch buffer
  (`singleRowMatchScratch`, `core.cpp:4526`)
- Solver: compact node storage (`PersistentLevelState`), Zobrist hashing
  (`PUZZLESCRIPT_VERIFY_ZOBRIST` assert mode), partially batched deadline
  checks (`solver/main.cpp:3170` comment: removes ~5 of ~6 per-expansion
  `Clock::now()` reads)

## Observed hot-path issues (facts, with code refs)

- **F1 — `rebuildMasks` after every successful rule application.**
  `applyRuleGroup` calls `rebuildMasks(session)` at group entry and after each
  apply (`core.cpp:5087, 5158`). Rebuild is dirty-line-tracked, but any
  *cleared* bit dirties the cell's whole row + column + board
  (`setCellObjectsFromWords`, `core.cpp:2333-2362`; set-only updates are
  OR'd in place), and rebuilding a dirty line re-ORs width×strideObject (and
  movement equivalents). On propagation-chain games (blocked/vertebra chains
  in the benchmark game) this runs at fixpoint frequency — O(chain ×
  line-rescan). Counters exist to quantify: `maskRebuildCalls`,
  `maskRebuildDirtyCalls`, `maskRebuildRows/Columns`.
- **F2 — movement-anchor selection does full-grid scans and heap allocation
  per call.** `chooseMovementRowAnchor` (`core.cpp:3755-3802`) allocates a
  `MaskVector` per pattern per call and ORs together masks that are
  **state-independent** (pattern movementsPresent + anyMovements +
  layer-coupled), then `movementOverlapCount` (`core.cpp:3721-3741`) scans
  all tiles × strideMovement just to *count* selectivity. The
  movement-anchored iteration itself also walks every tile
  (`core.cpp:3837-3846`) rather than only moving tiles.
- **F3 — incremental prune is movement-blind, same as JS.** The guard
  (`core.cpp:5108-5128`) skips a rule only when `readMovementsZero &&
  !readObjectsOverlapPrior`. `incrementalPriorMovements` is accumulated and
  swapped (`core.cpp:5152-5179`) but never consulted. Identical shape to
  `src/js/engine.js:3092` — fix both engines together, cross-checked by the
  parity harness.
- **F4 — per-cell match loops over all stride words.** `matchesPatternAt`
  (always_inline) loops `objectWordCount` (4 here) and `movementWordCount`
  (9 here) words per present/missing/any check, though a given pattern mask
  is typically nonzero in one word.
- **F5 — multi-row rules allocate per tryApply.** The single-row path uses
  `singleRowMatchScratch` (`core.cpp:4526`), but the multi-row path builds
  `std::vector<std::vector<RowMatch>>` + per-row vectors returned by value
  (`core.cpp:4620-4649`). The benchmark game's 48 `[ start ] [ … ]` rules and
  the `[ HeadX edgeX ] [ > Player ]` family hit the allocating path.
  Consistent with the HDA profiling: malloc ≈23% of time, cross-thread frees
  capping HDA at ~45% scaling; the fresh single-game data agrees — HDA x8
  interpreter reports 1020µs/generated vs single-threaded portfolio's 717µs
  (summary.json).
- **F6 — board layout is cell-major, column-major** (`tileIndex = x*height+y`);
  horizontal line scans stride by `height × words`. A row of a 61-wide level
  touches 61 scattered ~104-byte cell records.

## Proposals, prioritized

- **N1 — moving-tiles bitboard (low-level; likely largest single win).**
  Maintain a tile bitboard "any movement bits set", updated in
  `setCellMovements`, exactly analogous to `objectCellBits`. Then
  movement-anchor selectivity = popcount (kills `movementOverlapCount` grid
  scans) and movement-anchored iteration walks set bits via ctz instead of
  all tiles (`core.cpp:3837`). Most turns have few movers and movement rules
  are the hottest class. Localized, low risk; validate with parity + sim
  suites.
- **N2 — hoist static movement-anchor masks to lowering time (trivial).**
  The per-pattern movement union in `chooseMovementRowAnchor` is
  state-independent; precompute into `maskArena` at lowering, deleting the
  per-call alloc + OR-building. Zero semantic risk.
- **N3 — movement-aware incremental prune (both engines).**
  Consult `incrementalPriorMovements` in the guard (`core.cpp:5108-5128`).
  Soundness caveats: clears must be covered by write masks;
  stationary/`no X` requirements must be covered by read masks. Land JS
  (`engine.js:3092`) + native together; lean on the parity harness.
- **N4 — cheapen or defer `rebuildMasks`.** In rising ambition:
  (a) rebuild once per fixpoint iteration instead of per application (audit
  which same-iteration reads need freshness); (b) rebuild-on-read — only
  rebuild a dirty line when a match actually consults it; (c) per-line
  per-object-bit reference counts enabling O(changed-bits) decremental
  updates (memory ≈ (height+width) × objectCount × 2B — tens of KB, fine).
  Gate on F1 counter numbers first.
- **N5 — sparse word iteration in `matchesPatternAt`.** Precompute per-mask
  nonzero-word spans (first/last word or tiny word-id list); loop only
  those. Near-free for stride-1 games, ~4-9x fewer word ops on wide games.
  Also order pattern checks by measured selectivity.
- **N6 — allocator work for the solver/HDA (metal).** Link mimalloc (or
  jemalloc) and measure — cross-thread-free contention is its home turf;
  then per-thread arenas/freelists for node `FullState` /
  `PersistentLevelState` if needed. Scratch-ify the multi-row match vectors
  (F5) like `singleRowMatchScratch`. Directly targets the measured 23%
  malloc + HDA scaling ceiling.
- **N7 — word-plane (SoA) board layout experiment (representation).** Store
  objects as per-word planes (all tiles' word w contiguous). Pattern checks
  touch only planes with nonzero masks → wide-stride games degrade to
  ~stride-1 cost; `rebuildMasks` becomes long vectorizable runs. Bigger
  refactor; prototype behind a compile-time flag like
  `PS_INTERPRETER_OBJECT_CELL_INDEX` and let counters decide. Overlaps N5 —
  do N5 first, it's 10x cheaper to build.
- **N8 — feed solver-scoped static opts into the native compile
  (high-level).** The JS passes (`src/tests/solver_static_opt.js`:
  inert/cosmetic/merge) shrink object count, **collision layers** (→ both
  strides), and rule count. Native compiles from source, so a
  source-to-source emit (or shared IR) serves interpreter and codegen tiers
  alike. Check `native/src/simplify` and `native/src/search/simplify.*` for
  existing scaffolding before building new.
- **N9 — group dependency static analysis (high-level).**
  (a) Groups whose writes cannot feed their own reads need no confirm pass:
  currently even a single-fire group re-matches every rule once more to
  detect quiescence — provable single-pass groups halve their match work.
  (b) The JS "A.2 outer-loop group skip" (wired, disabled;
  `engine.js:3154-3156`) has the same native analog via cumulative changed
  masks — making it sound once benefits both engines.
- **N10 — solver-level hygiene.** Compact node storage default-on where
  parity-clean; finish deadline-check batching (clock was 14% in the HDA
  profile); keep detail timing off in production runs.

## Experiments (run in this order)

- **NX1 — counter attribution run** (~1h). Enable `ps_runtime_counters`, run
  the benchmark game + a ~50-game corpus slice, dump `maskRebuildCalls/Rows`,
  `candidateCellsTested`, `patternTests`, `rulesVisited/SkippedByMask`,
  `specializedRulegroup*`. Success: a ranked cost attribution that picks
  between N1/N4/N5/N7. **This precedes any build-out.**
- **NX2 — mimalloc link test** (~1h). Relink the solver with mimalloc, rerun
  HDA x8 on the benchmark game + corpus slice. Success: HDA step_ms drops
  materially (target: close part of the 45%→linear scaling gap). Failure:
  contention is not allocator-internal → invest in arenas (N6b) instead.
- **NX3 — N2 + N1 prototype** (~1 day). Static anchor masks + moving-tiles
  bitboard behind a flag; parity suite + `us_per_generated` on the benchmark
  game and corpus slice. Expect the benchmark game to improve most
  (movement-heavy, big grids); corpus-neutral is acceptable, corpus-negative
  is not.
- **NX4 — N3 paired JS/native landing** (~1-2 days). Same design as the JS
  plan's X5 (env-flagged guard extension, full sim fixtures, paired 250ms
  corpus compare), plus a native parity run.

## Do not do yet

- **N4c (refcounted line masks) or N7 (SoA layout) before NX1** — both are
  multi-day refactors whose payoff is unproven until counters attribute the
  time.
- **SIMD hand-tuning of mask loops** — `-O3 -march=native` + LTO is already
  on; word counts are 4-9; N5/N7 change the loop shape first. Revisit only
  with a profile showing vectorization failure.
- **Rewriting the interpreter around the compiled tier's design** — the
  compiled tier exists and is measured; the interpreter's value is
  game-agnosticism and zero compile latency. Keep improvements
  representation-level, not per-game.
- **HDA topology changes (work stealing, sharding) before NX2** — the
  profiling evidence points at the allocator, not the search distribution.
- **Trusting historical compiled/corpus artifacts for regression math** —
  refresh before tight claims (see JS plan X7).

## Expected outcome (inference)

Benchmark game: 717µs/step plausibly → 150-300µs with N1+N2+N3+N4+N5
compounding — roughly halfway to the compiled tier's 62-77µs while staying
game-agnostic. Corpus @500ms: interpreter 842 (historical) moving toward the
compiled portfolio's 917. HDA: NX2/N6 is the lever for the 8-thread scaling
ceiling, independent of per-step wins.
