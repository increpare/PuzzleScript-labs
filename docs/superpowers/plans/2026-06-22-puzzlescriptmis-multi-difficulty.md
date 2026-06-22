# PuzzleScript+MIS Multi-Difficulty Assessment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore MIS difficulty as `min(WeightedAStar, Greedy, BFS)` standalone expanded counts, while keeping adaptive **portfolio** (`jobs=1`) as the primary solvability search.

**Architecture:** Portfolio finds solutions fast under timeout; `assessDifficulty()` then runs three **standalone** strategy calls (Greedy, Weighted A\*, BFS) with `max_expanded = primaryExpanded + 6` for honest per-lane counts. Generation uses lazy supplemental gating; level UI always refines. Single thread per worker, one `CandidateSolverContext`.

**Tech Stack:** C++17, native `runSearch` / `runAdaptivePortfolioSearch`, PuzzleScript MIS openFrameworks bridge, CMake/ctest.

**Spec:** `docs/superpowers/specs/2026-06-22-puzzlescriptmis-multi-difficulty-design.md`

---

## File map

| File | Responsibility |
|---|---|
| `native/include/puzzlescript/puzzlescript.h` | `max_expanded` on `ps_solve_options` |
| `native/src/solver/main.cpp` | Expansion cap in `runSearch`; thread through API |
| `tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.h/.cpp` | `solveLayerGrid(..., strategy, maxExpanded)` |
| `tools/puzzlescriptmis-app/src/native_bridge/DifficultyAssessment.h/.cpp` | **New** — portfolio primary + standalone trio |
| `tools/puzzlescriptmis-app/src/native_bridge/NativeGameFacade.h/.cpp` | Facade wrappers |
| `tools/puzzlescriptmis-app/src/levelSolve.h/.cpp` | Running → Refining → Solved phases |
| `tools/puzzlescriptmis-app/src/generation.cpp` | Lazy supplemental + min ranking |
| `tools/puzzlescriptmis-app/src/visualsandide.cpp` | Three-way difficulty display |
| `tools/puzzlescriptmis-app/tests/native_bridge_smoke.cpp` | Strategy, cap, assess tests |

---

### Task 1: Native `max_expanded` cap

**Files:**
- Modify: `native/include/puzzlescript/puzzlescript.h`
- Modify: `native/src/solver/main.cpp`

- [ ] **Step 1: Add field to public options**

```cpp
uint64_t max_expanded;  // 0 = unlimited
```

Set `max_expanded = 0` in `ps_solve_default_options()`.

- [ ] **Step 2: Thread through solve entry**

Pass `effective.max_expanded` from `ps_solve_level_layer_cell_object_ids` into `runSearch` (and portfolio paths that delegate to `runSearch` for standalone strategies).

- [ ] **Step 3: Enforce cap in `runSearch`**

At top of `while (!frontier.empty())`, after timeout/cancel checks:

```cpp
if (maxExpanded > 0 && result.expanded >= maxExpanded) {
    result.status = "timeout";
    break;
}
```

- [ ] **Step 4: Build**

```bash
cmake --build build --target puzzlescript_native
```

Expected: clean build.

---

### Task 2: Bridge strategy + maxExpanded parameters

**Files:**
- Modify: `tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.h`
- Modify: `tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.cpp`
- Modify: `tools/puzzlescriptmis-app/tests/native_bridge_smoke.cpp`

- [ ] **Step 1: Extend signature**

```cpp
NativeSolveResult solveLayerGrid(
    const LayerGrid& grid,
    int64_t timeoutMs,
    ps_solve_strategy strategy = PS_SOLVE_STRATEGY_PORTFOLIO,
    uint64_t maxExpanded = 0) const;
```

Default **portfolio** preserves current MIS primary behavior.

- [ ] **Step 2: Implementation**

Set `options.strategy`, `options.portfolio_jobs = 1`, `options.max_expanded = maxExpanded`.

- [ ] **Step 3: Smoke tests**

Keep existing test asserting primary candidate solve uses `portfolio` strategy.

Add:

```cpp
NativeSolveResult greedy = bridge.solveLayerGrid(grid, 5000, PS_SOLVE_STRATEGY_GREEDY);
require(greedy.status == NativeSolveStatus::Solved, "greedy solves fixture");
require(greedy.strategy.find("greedy") != std::string::npos, "greedy strategy label");

NativeSolveResult capped = bridge.solveLayerGrid(grid, 5000, PS_SOLVE_STRATEGY_BFS, 1);
require(capped.status == NativeSolveStatus::Timeout, "max_expanded=1 times out");
require(capped.expanded <= 1, "max_expanded respected");
```

- [ ] **Step 4: Run smoke**

```bash
cmake --build build --target puzzlescriptmis_native_bridge_smoke
./build/tools/puzzlescriptmis-app/tests/puzzlescriptmis_native_bridge_smoke
```

Expected: PASS.

---

### Task 3: `assessDifficulty` helper

**Files:**
- Create: `tools/puzzlescriptmis-app/src/native_bridge/DifficultyAssessment.h`
- Create: `tools/puzzlescriptmis-app/src/native_bridge/DifficultyAssessment.cpp`
- Modify: `tools/puzzlescriptmis-app/src/native_bridge/NativeGameFacade.h/.cpp`
- Modify: MIS app build files for new `.cpp`

- [ ] **Step 1: Types** — see spec (`DifficultyBreakdown`, `DifficultyAssessmentOptions`, `DifficultyAssessmentResult` with `primaryStrategy`, `supplementalRan`).

- [ ] **Step 2: Implement `assessDifficulty`**

```cpp
DifficultyAssessmentResult assessDifficulty(
    CandidateSolverContext& context,
    const vvvs& state,
    const DifficultyAssessmentOptions& options);
```

Logic:

1. **Primary:** `PS_SOLVE_STRATEGY_PORTFOLIO`, `portfolio_jobs=1`, `maxExpanded=0`, `primaryTimeoutMs`.
2. Not solved → return early.
3. Store `primaryExpanded`, `primaryStrategy`, portfolio `solution`.
4. If `!runSupplemental` → `breakdown.difficulty = primaryExpanded`; return.
5. `cap = supplementalCap >= 0 ? supplementalCap : (primaryExpanded + 6)`; set `supplementalRan = true`.
6. Run standalone **Greedy**, **Weighted A\***, **BFS** via `solveLayerGrid(..., strategy, cap)` with long timeout (60000 ms).
7. On each **solved** supplemental run, set lane expanded; track running min.
8. Set `breakdown.difficulty` to min of successful supplemental counts; if none succeed, fallback to `primaryExpanded`.

Optional callback or split into `assessPrimary` + `assessSupplemental` for incremental UI snapshots.

- [ ] **Step 3: Facade export**

```cpp
DifficultyAssessmentResult assessDifficulty(
    CandidateSolverContext& context,
    const vvvs& state,
    long long primaryTimeoutMs,
    bool runSupplemental,
    long long supplementalCap = -1);
```

- [ ] **Step 4: Smoke test**

Assert solvable fixture: portfolio primary succeeds; with `runSupplemental=true`, all three lane fields populated (or `-1` if cap too tight) and `difficulty <= primaryExpanded` when any supplemental solves.

---

### Task 4: Level UI multi-phase solve

**Files:**
- Modify: `tools/puzzlescriptmis-app/src/levelSolve.h`
- Modify: `tools/puzzlescriptmis-app/src/levelSolve.cpp`
- Modify: `tools/puzzlescriptmis-app/src/visualsandide.cpp`

- [ ] **Step 1: Extend `Snapshot`** — add `Refining` phase; per-lane expanded fields; `difficulty` / `difficultyAlgorithm`.

- [ ] **Step 2: Rewrite `solvingLoop`**

Prefer inline steps for incremental UI:

1. Portfolio solve with doubling timeout → publish `Running` snapshot (portfolio expanded visible optionally).
2. On solve → `Refining`; run Greedy standalone → publish; run WA\* → publish; run BFS → publish.
3. Compute min → `Solved`.

Or call `assessDifficulty` with progress callbacks.

- [ ] **Step 3: Restore display**

```cpp
displayStrR = "Difficulty "
    + (info.expandedGreedy < 0 ? questionMarkStr : to_string(info.expandedGreedy)) + " (Greedy) "
    + (info.expandedWeightedAStar < 0 ? questionMarkStr : to_string(info.expandedWeightedAStar)) + " (WeightedAStar) "
    + (info.expandedBfs < 0 ? questionMarkStr : to_string(info.expandedBfs)) + " (BFS)";
```

Left side: solution size from portfolio primary. "Shortest solution size" only when standalone BFS supplemental succeeded.

- [ ] **Step 4: Manual check** — build MIS app; verify three counts animate in.

---

### Task 5: Generation lazy supplemental + min ranking

**Files:**
- Modify: `tools/puzzlescriptmis-app/src/generation.cpp`

- [ ] **Step 1: Lazy gate**

```cpp
static bool shouldRunSupplemental(long long primaryExpanded,
    const set<pair<float,vvvs>>& neighborhood) {
    if (neighborhood.size() < 4) return true;
    const long long fourthPlace = -neighborhood.rbegin()->first;
    return primaryExpanded >= fourthPlace;
}
```

- [ ] **Step 2: Replace solve block**

```cpp
auto assessed = assessDifficulty(*solverContext, candidateState, {
    .primaryTimeoutMs = timeToSolve,
    .runSupplemental = shouldRunSupplemental(...),  // under generatorMutex after primary known
});
const long long score = assessed.supplementalRan
    ? assessed.breakdown.difficulty
    : assessed.primaryExpanded;
auto p = make_pair(-score, candidateState);
```

- [ ] **Step 3: Throughput estimate** — keep using `primaryExpanded` + elapsed from portfolio primary.

- [ ] **Step 4: Verify** — transforms produce curated levels; harder candidates still surface.

---

### Task 6: Final verification

- [ ] Run `puzzlescriptmis_native_bridge_smoke`
- [ ] Build MIS app (`make -C tools/puzzlescriptmis-app`)
- [ ] Confirm portfolio primary test still passes; supplemental assess test passes

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| `max_expanded` native cap | Task 1 |
| Strategy + portfolio default on bridge | Task 2 |
| Portfolio primary in `assessDifficulty` | Task 3 |
| Standalone trio supplemental | Task 3 |
| Level UI three-way + Refining | Task 4 |
| Generation lazy supplemental | Task 5 |
| Rank by min when refined; portfolio fallback | Task 5 |
| Single-thread sequential | Tasks 3–5 |
