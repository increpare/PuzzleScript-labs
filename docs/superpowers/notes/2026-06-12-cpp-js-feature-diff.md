# JS→native feature diff manifest

**Date:** 2026-06-12  
**Baseline:** `docs/superpowers/notes/2026-06-12-cpp-js-parity-baseline.md` (commit `c48a1ebd`)  
**Scope:** Last 50 commits touching `src/js/{parser,compiler,engine}.js`, `src/tests/{run_solver_tests_js,ps_static_analysis,solver_static_opt}.js`

---

## 1. Executive summary

- **Highest priority — runtime/compiler movement semantics (Phase 2):** JS has landed 5c-3 property-inference plumbing (`layerCoupledMovementMasks`, `inferredPropertyBindings`, `inferredPropertySources`) plus post-A.1 rule-group pruning (`readMovements`/`writeMovements`/`forceAlwaysRun` slots [14–18]). Native lowering/runtime has **none** of these symbols; `rule_plan_parity_tests` already fails on `ellipsisPropagationBug2` (`movements_set_bits`), and 94/469 `js_parity_tests` trace replays diverge (orthogonal/perpendicular movement cases dominate).
- **Compiler diagnostics (Phase 1):** JS commits `9141d45e` (duplicate `no X` → warning) and `c48a1ebd`/`e9621ec7` (`namesSet`/`abbrevNamesSet` + `ensureNameMembershipSets`) are not mirrored. Native still linear-scans `names`/`abbrevNames` and has no duplicate-cell diagnostic in `lower_to_runtime.cpp` (grep: no “same object more than once” path).
- **Empty-LHS / force-always-run (Phase 2 blocker):** JS `1b5f129f` flags `[] -> […]` rules via `classifyForceAlwaysRun` → `Rule.forceAlwaysRun`; engine skips mask pruning when set. Native `applyRuleGroup` (`core.cpp`) only gates on `ruleCanPossiblyMatch(rule.ruleMask)` — zero-mask empty-LHS rules are skipped forever.
- **Solver heuristics (Phase 4):** JS default `'auto'` router + 35 named heuristics, `buildStaticDeadCellsCache`/`getStaticDeadCells`, `regionIsolationPenalty`, version-keyed distance fields (`filter1TargetVersion`, `playerTargetVersion`). Native hard-codes `"winconditions"` in `solver/main.cpp` with no `--heuristic` flag and no target-version cache machinery.
- **Stretch (Phase 6):** Entire `ps_static_analysis.js` (~2.5k LOC) and `solver_static_opt.js` (inert/cosmetic/merge/action passes) have **zero** native mirror (`rg` over `native/` finds no matches).

---

## 2. Compiler/parser behavioral commits

| Commit | Summary | Native status | Native file(s) to touch |
|--------|---------|---------------|-------------------------|
| `c48a1ebd` | `ensureNameMembershipSets()` in `rulesToArray`/`loadFile`; `copyState` preserves `namesSet`/`abbrevNamesSet` when unset | **partial** — `abbrevNamesContainGlyph` / `namesVectorContains` work but O(n); no `unordered_set` mirrors; incremental-parse snapshot parity N/A | `native/src/compiler/types/parser_state.hpp`, `parser.cpp` |
| `9141d45e` | Duplicate `no TOKEN` in one cell → `logWarning` (redundant), not `logError`; recovers solver games that previously `compile_error` | **missing** — no equivalent diagnostic in native rule lowering | `native/src/compiler/lower_to_runtime.cpp` (cell parse loop ~L974) or shared `compile_diagnostics.cpp` |
| `e9621ec7` | Seal `namesSet`/`abbrevNamesSet` at SOUNDS/LEVELS transitions for O(1) legend membership | **partial** — behavior OK via vectors; Sets absent | `parser_state.hpp`, `parser.cpp` (`appendAbbrevNames` sites) |
| `10b11d88` | Module-level `Set`s for `keyword_array`, metadata keyword arrays | **done** (equivalent) — `isLegendKeywordName`, `kSectionKeywordLongestFirst`, metadata duplicate checks | `parser.cpp` (no change needed for correctness) |
| `9c63d810` | `logErrorCacheable` dedups urgent loop-guard errors unconditionally | **N/A (native)** — diagnostics are compile-time only; solver does not accumulate JS `errorStrings` | — |
| `299681bf` | 5c-3 movement-aware property capture in `rulesToMask` / `computePropertyCoalescingPlan` | **missing** — no `inferredPropertyBindings`, `layerCoupledMovementMasks` in native lowering | `lower_to_runtime.cpp`, `rule_text.cpp` |
| `70af75a9` | Disable 5c-3 plan-level `sinkDirsOk` (Voitex regression); strict `dir !== ''` gate restored | **missing** — native never had 5c-3 plan | same as above |
| `56484ae9` | Coalesce property-binding sinks with RHS direction modifiers (5c-3) | **missing** | `lower_to_runtime.cpp` |
| `0affb8c0` | Coalesce property-attached aggregate inference | **missing** | `lower_to_runtime.cpp` |
| `bdecb449` | Coalesce local property aggregate sinks | **missing** | `lower_to_runtime.cpp` |
| `b0d51f5c` | Read `inferredPropertyBindings` from `CellReplacement` row slots (not pattern-only) | **missing** | `lower_to_runtime.cpp`, `core.hpp` (`Replacement` struct) |
| `b8db7046` | `computeWriteMovements` includes `layerCoupledMovementReplacements` | **missing** — native has per-replacement `movementsSet` masks but no coupled/inferred write aggregation | `lower_to_runtime.cpp` |
| `bf903b61` | `computeReadMovements` per rule → slot [14] | **missing** — native uses aggregate `ruleMask` / `ruleMovementMask` only | `lower_to_runtime.cpp`, `core.hpp` (`Rule` struct) |
| `cf376815` | `computeReadObjects` / `writeObjects` per rule → slots [15] | **partial** — `rule.ruleMask` ≈ read-objects union; no distinct write-objects bitvec | `lower_to_runtime.cpp`, `core.hpp` |
| `634df135` | `computeWriteMovements` per rule → slot [16] | **missing** | `lower_to_runtime.cpp`, `core.hpp` |
| `1b5f129f` | `classifyForceAlwaysRun`: empty LHS (`readObjects`+`readMovements` zero) → `force=true`, reason `empty-LHS` | **missing** — zero `ruleMask` causes runtime skip | `lower_to_runtime.cpp`, `core.cpp` (`applyRuleGroup`) |
| `d76e6529` | Revert A.1 incremental `applyRuleGroupPruned`; **kept** slots [14–18] + inner-loop pruning in `applyRuleGroup` | **missing** — native full scan every inner-loop iteration | `core.cpp` (`applyRuleGroup` ~L3583) |
| `c885fa07` | Property overwrite invariants + canonical direction fixes (static-analysis-facing) | **missing** (analysis only) | Phase 6 `native/src/analysis/` |

---

## 3. Engine/runtime commits

| Commit | Summary | Native status | Native file(s) to touch |
|--------|---------|---------------|-------------------------|
| `299681bf` | Runtime apply for `inferredPropertyBindings` (`dirMode`/`dirMask` on captured layers) | **missing** | `native/src/runtime/core.cpp` (`applyReplacement` / movement write path ~L2278) |
| `56484ae9` | Engine consumer for coalesced property-binding direction metadata | **missing** | `core.cpp` |
| `1b5f129f` | `Rule.forceAlwaysRun` bypasses `readObjects ∩ priorObjects` prune | **missing** | `core.cpp` (`applyRuleGroup`) |
| `bf903b61`–`634df135` | Inner-loop prune uses `readMovements`/`writeMovements`/`writeObjects` accumulators | **missing** | `core.cpp` |
| `1a0df2d6` | Fix rigid replace-function cache key collision (embed `LAYER_COUNT` + rigid group index) | **partial** — native uses compiled/specialized paths, not JS `generateReplaceFunction` cache; verify rigid group embedding in `compiled_rules_codegen.cpp` | `compiled_rules_codegen.cpp`, `compiled_rules.cpp` |
| `3d8149d8` | `processInput` early-return when `textMode \|\| titleScreen \|\| !level` | **partial** — native routes text/title to `interpretedTurn` (`core.cpp` ~L5519) rather than no-op false; semantics differ for solver stepping | `core.cpp` (`ps_step` / `interpretedTurn`) |
| `9c63d810` | `restoreSnapshot` guards `restoreRandomState(null)` for non-random games | **partial** — native `restoreSnapshot` checks `restoreRandomState` flag (`core.cpp` ~L4014); solver path uses `PreparedLevel` without JS parser error accumulation | `core.cpp` |
| `964e1b38` | Skip `backupLevel` snapshot when `!state.rigid` | **missing** (perf) | `core.cpp` |
| `e65c408d` | Fused `restore()` + row/col mask rebuild via `level.rowColMasksValid` | **missing** (perf) | `core.cpp` |
| `71eaf375` | `checkWin` without per-tile closures | **missing** (perf) | `core.cpp` (win scan) |
| `8e500060` | Avoid allocating empty `RuleMatchResult` in scan hot path | **missing** (perf) | `core.cpp` / generated rules |
| `266e2cbf` | Shape-generic `cellPatternMatch` / `cellRowMatches` codegen | **partial** — native has separate interpreted + compiled paths | `compiled_rules_codegen.cpp` |
| `ce003543` | Dynamic `movementsClear` reads in replace codegen | **partial** — native compiled replace reads masks at runtime | `compiled_rules_codegen.cpp` |

**Rule-plan IR export gap (baseline failure):** `ellipsisPropagationBug2` — native CLI (`main.cpp` ~L3908) always emits `movements_set_bits` from `repl.movementsSet`; JS oracle (`puzzlescript_ir.js` `movementBitPairs`) omits bits when 5c-3 inference routes movement through `inferredPropertyBindings` instead of direct `movementsSet`. Root cause is compiler lowering divergence, not JSON serializer alone.

---

## 4. Solver-only features

| Feature | JS location | Native status |
|---------|-------------|---------------|
| `'auto'` heuristic router (`autoHeuristic`) | `run_solver_tests_js.js` L2457–2494 | **missing** — hard-coded `"winconditions"` (`solver/main.cpp` L1297, L1611) |
| 35 named heuristics (`SOLVER_HEURISTICS` set, `HEURISTIC_FUNCTIONS` table) | `run_solver_tests_js.js` L30–67, L2505–2542 | **missing** — only baseline distance heuristic in `search_common.hpp` `winConditionHeuristicScore` |
| Static dead-cell cache (`staticDeadCellsCache`, `getStaticDeadCells`, `inferStaticBlockerMask`) | `run_solver_tests_js.js` L771, L1161, L1763 | **missing** |
| `deadPositionPenalty` / `allOnDeadPositionHeuristic` (A3, +14 solves @250ms) | `run_solver_tests_js.js` L1840, L2204 | **missing** |
| `regionIsolationPenalty` (D2) | `run_solver_tests_js.js` L1864 | **missing** |
| Version-keyed distance-field cache (R1: `filter1TargetVersion`, `filter2TargetVersion`, `cachedDistanceField`) | `run_solver_tests_js.js` L662–898, L2044 | **missing** — native recomputes `matchingDistanceField` each score (`search_common.hpp` L241) |
| Player-position cache (R3: `getPlayerPositions.__solverCached`, `playerTargetVersion`) | `run_solver_tests_js.js` L665–692 | **missing** |
| `--solver-heuristic` / `--portfolio-heuristics` CLI | `run_solver_tests_js.js` corpus driver | **missing** — native usage string has no `--heuristic` (`solver/main.cpp` L483) |
| `--jobs N` parallel corpus sharding | `run_solver_tests_js.js` (R6) | **done** — native parses `--jobs auto\|N\|1` (`solver/main.cpp` L496) |
| Solver error-state reset per level attempt (`resetParserErrorState` in `solveLevel`) | `run_solver_tests_js.js` (R7, `9c63d810`) | **N/A** — native solver does not drive JS parser diagnostics |
| Fused restore + mask rebuild (R2) | `engine.js` + solver hook in `run_solver_tests_js.js` | **missing** |
| `--solver-opt` static optimization passes | `solver_static_opt.js` via `createSolverOptimizationHook` | **missing** |
| Solve-count parity gate | planned Phase 7 | **missing** |

**Note on baseline solver delta:** At 1000 ms timeout native reports **887 solved vs JS 762** (+125). Native is faster/heuristic-different, not necessarily more correct; JS `'auto'` + R1–R3 perf stack expands fewer nodes in the same wall clock. Parity work should compare expanded-node counts and solution paths, not solve count alone.

---

## 5. Static analysis / solver opt (entirely missing in native)

| Subsystem | JS entry points | Lines (approx.) | Needed for |
|-----------|-----------------|-----------------|------------|
| Static analysis core | `ps_static_analysis.js`: `analyzeSource`, `tagRule`, `buildObjects`, `buildProperties` | ~2536 | Rule/object tagging, mergeability, cosmetic detection, action-unnecessary proofs |
| Static analysis CLI/tests | `ps_static_analysis_node.js`, `fuzz_static_contracts.js`, `static_analysis_*_node.js` | ~3500+ test LOC | Regression gates (`make static_analysis_*`) |
| Solver static opt | `solver_static_opt.js`: `createSolverOptimizationHook`, `passInertPrune`, `passCosmeticPrune`, `passCosmeticRules`, `passMerge`, `passActionNoop` | ~1289 | `--solver-opt inert,cosmetic,merge,action` corpus parity |
| Compiler hook | `compiler.js` `pluginOptimizationHook` after `rulesToArray` | hook only | Applies opt passes before `generateSoundData` |

**Minimal native port surface (Phase 6):** emit `ps-static-analysis-v1` / `ps_tagged`-compatible JSON for: `inert_command_only`, `cosmetic` object tags, `mergeability` candidates, `action_unnecessary` proof — then wire `solver_static_opt` equivalents. `IMPLEMENTATION_CHECKLIST.md` has no static-analysis section (only compact-state inert omission, unrelated).

---

## 6. Recommended sync order

Aligned with `docs/superpowers/plans/2026-06-12-cpp-js-parity-sync.md`:

1. **Phase 1 Task 1.1** — `namesSet`/`abbrevNamesSet` + keyword-glyph legend (`compiler_keyword_names_node.js`, `a distant sunset.txt`).
2. **Phase 1 Task 1.2** — duplicate-`no` warning (`9141d45e`, `processRuleString` duplicate-cell loop).
3. **Phase 2 (movement semantics)** — port 5c-3 lowering (`inferredPropertyBindings`, `layerCoupledMovement*`) and `movements_set_bits` rule-plan parity (`ellipsisPropagationBug2`); then `forceAlwaysRun` / slots [14–18] pruning.
4. **Phase 2 gate** — drive `js_parity_tests` trace replay from 375/469 → 469/469; keep `simulation_tests` green.
5. **Phase 3** — expand `solver_parity_smoke` to weighted-A* + `'auto'`; verify step/undo/RNG semantics (`restoreSnapshot`, text-mode guards).
6. **Phase 4 Task 4.1–4.5** — `--heuristic` CLI, static dead-cell cache (A3), region isolation (D2), version-keyed distance fields (R1), `'auto'` router.
7. **Phase 5** — engine perf ports safe for native (`rowColMasksValid`, player-position cache, `checkWin` scan, rigid snapshot skip).
8. **Phase 6 (stretch)** — `ps_static_analysis` minimal facts + `solver_static_opt` passes + native `--solver-opt`.
9. **Phase 7** — automated solve-count parity gate (`solver_solve_count_parity`).

**Defer:** Full 2.5k-line static analysis port until Phase 2 simulation replay is green. Re-enable JS 5c-3 plan-level permissiveness (`70af75a9` revert) only after native movement apply matches JS on focused fixtures.

---

## Verification commands

```bash
# Re-audit commit list
git log --oneline -50 -- src/js/compiler.js src/js/parser.js src/js/engine.js \
  src/tests/run_solver_tests_js.js src/tests/ps_static_analysis.js src/tests/solver_static_opt.js

# Native grep spot-checks
rg -l "namesSet|abbrevNamesSet" native/src/compiler/ || echo "namesSet: missing"
rg -l "inferredProperty|layerCoupled|forceAlways" native/src/ || echo "5c-3/A.1 slots: missing"
rg -l "static_analysis|solver_static_opt" native/ || echo "static analysis: missing"

# Parity gates
make rule_plan_parity_tests
make js_parity_tests
make solver_tests_js SOLVER_TIMEOUT_MS=1000 SOLVER_OUTPUT_ARGS="--quiet --json --no-solutions"
make solver_tests_cpp SOLVER_TIMEOUT_MS=1000 SOLVER_OUTPUT_ARGS="--quiet --json --no-solutions"
```
