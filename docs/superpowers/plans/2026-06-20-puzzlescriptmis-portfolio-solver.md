# PuzzleScript+MIS Portfolio Solver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PuzzleScript+MIS generated-level scoring use the native PuzzleScript-labs adaptive portfolio solver in-process.

**Architecture:** Compile the existing native solver implementation into `puzzlescript_native` with the CLI `main` disabled for that target, expose a small C API for solving a seeded candidate grid, and replace `NativeGameBridge::solveLayerGrid`'s temporary BFS with that API. The solver API seeds a `FullState` from layer-cell-object ids, then runs the existing single-thread portfolio path with `portfolioJobs = 1`.

**Tech Stack:** C++17, CMake, PuzzleScript native runtime/compiler libraries, openFrameworks PuzzleScript+MIS bridge tests.

---

### Task 1: Add Portfolio Metadata Test

**Files:**
- Modify: `tools/puzzlescriptmis-app/tests/native_bridge_smoke.cpp`
- Modify: `tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.h`

- [ ] **Step 1: Write the failing test**

Add a strategy assertion to the existing generated-candidate solver smoke test:

```cpp
assertTrue(solved.status == psbridge::NativeSolveStatus::Solved, "solvable edited grid solves");
assertTrue(!solved.solution.empty(), "solvable edited grid returns solution inputs");
assertTrue(solved.strategy == "portfolio", "generated grid solve uses native portfolio strategy");
```

Add the field the test expects to `NativeSolveResult`:

```cpp
std::string strategy;
std::string heuristic;
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
ctest --test-dir build -R puzzlescriptmis_native_bridge_smoke --output-on-failure
```

Expected: FAIL because `NativeSolveResult::strategy` is empty while the bridge still uses local BFS.

- [ ] **Step 3: Commit**

```bash
git add tools/puzzlescriptmis-app/tests/native_bridge_smoke.cpp tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.h
git commit -m "Test puzzlescriptmis portfolio solver scoring path"
```

### Task 2: Expose Runtime C API Internals

**Files:**
- Create: `native/src/runtime/c_api_internal.hpp`
- Modify: `native/src/runtime/c_api.cpp`

- [ ] **Step 1: Create internal wrapper header**

Move the opaque C wrapper definitions into a private header so the solver C API can access `ps_game::impl`:

```cpp
#pragma once

#include "runtime/core.hpp"

#include <memory>

struct ps_game {
    puzzlescript::LoadedGame impl;
};

struct ps_full_state {
    std::unique_ptr<puzzlescript::FullState> impl;
    puzzlescript::TurnResult lastTurnResult;
};

struct ps_compile_result {
    std::unique_ptr<puzzlescript::CompileResult> impl;
};

struct ps_error {
    std::unique_ptr<puzzlescript::Error> impl;
};
```

- [ ] **Step 2: Include the header from `c_api.cpp`**

Replace the four local struct definitions in `native/src/runtime/c_api.cpp` with:

```cpp
#include "runtime/c_api_internal.hpp"
```

- [ ] **Step 3: Build native library**

Run:

```bash
cmake --build build --target puzzlescript_native
```

Expected: build succeeds with no wrapper redefinition errors.

- [ ] **Step 4: Commit**

```bash
git add native/src/runtime/c_api.cpp native/src/runtime/c_api_internal.hpp
git commit -m "Share native C API wrapper internals"
```

### Task 3: Add Native Solve C API

**Files:**
- Modify: `native/include/puzzlescript/puzzlescript.h`
- Modify: `native/src/solver/main.cpp`
- Modify: `native/CMakeLists.txt`

- [ ] **Step 1: Add public solve types**

Add C API declarations to `native/include/puzzlescript/puzzlescript.h`:

```cpp
typedef enum ps_solve_status {
    PS_SOLVE_STATUS_SOLVED = 0,
    PS_SOLVE_STATUS_EXHAUSTED = 1,
    PS_SOLVE_STATUS_TIMEOUT = 2,
    PS_SOLVE_STATUS_ERROR = 3
} ps_solve_status;

typedef enum ps_solve_strategy {
    PS_SOLVE_STRATEGY_PORTFOLIO = 0,
    PS_SOLVE_STRATEGY_BFS = 1,
    PS_SOLVE_STRATEGY_WEIGHTED_ASTAR = 2,
    PS_SOLVE_STRATEGY_WEIGHTED_ASTAR_DEEP = 3,
    PS_SOLVE_STRATEGY_GREEDY = 4
} ps_solve_strategy;

typedef struct ps_solve_options {
    int64_t timeout_ms;
    ps_solve_strategy strategy;
    uint32_t portfolio_jobs;
    bool exact_state_keys;
    bool compact_node_storage;
    bool full_node_storage;
    bool compact_turn_oracle;
    bool compact_turn_search;
    int32_t astar_weight;
} ps_solve_options;

typedef struct ps_solve_result {
    ps_solve_status status;
    uint64_t expanded;
    uint64_t generated;
    uint64_t unique_states;
    uint64_t duplicates;
    uint64_t max_frontier;
    int64_t elapsed_ms;
    const ps_input* solution;
    size_t solution_count;
    const char* strategy;
    const char* heuristic;
    const char* error;
} ps_solve_result;

ps_solve_options ps_solve_default_options(void);
bool ps_solve_level_layer_cell_object_ids(
    const ps_game* game,
    int32_t level_index,
    const int32_t* layer_cell_object_ids,
    size_t count,
    const ps_solve_options* options,
    ps_solve_result** out_result,
    ps_error** out_error);
void ps_solve_result_free(ps_solve_result* result);
```

- [ ] **Step 2: Add seeded portfolio entry point in solver implementation**

In `native/src/solver/main.cpp`, add helpers under a `PUZZLESCRIPT_SOLVER_C_API` compile definition:

```cpp
std::unique_ptr<FullState> createSeededSolverSession(
    const puzzlescript::LoadedGame& loadedGame,
    const std::string& gameName,
    int32_t levelIndex,
    const int32_t* layerCellObjectIds,
    size_t count,
    Result& result);

Result solveSeededLevel(
    const puzzlescript::LoadedGame& loadedGame,
    const std::string& gameName,
    int32_t levelIndex,
    const int32_t* layerCellObjectIds,
    size_t count,
    int64_t timeoutMs,
    Strategy strategy,
    uint32_t workerId,
    bool exactStateKeys,
    bool compactNodeStorage,
    bool fullNodeStorage,
    bool compactTurnOracle,
    bool compactTurnSearch,
    int32_t astarWeight,
    size_t portfolioJobs);
```

`createSeededSolverSession` should call `createLoadedSession`, validate `count == layerCount * width * height`, build a cell-major object mask like `ps_full_state_set_layer_cell_object_ids`, reset movement/dirty scratch fields, and return the seeded session.

`solveSeededLevel` should mirror `solveLevel`, but pass the seeded initial session into `runSearch`/`runAdaptivePortfolioSearch`.

- [ ] **Step 3: Add `FullState` overloads for search**

Add overloads:

```cpp
Result runSearchFromInitial(..., std::unique_ptr<FullState> initial, ...);
Result runAdaptivePortfolioSearchFromInitial(..., std::unique_ptr<FullState> initial, ...);
```

The overloads should contain the current search bodies after the `createLoadedSession` call. Existing `runSearch` and `runAdaptivePortfolioSearch` should keep their signatures and call the new overloads after creating the normal level session.

- [ ] **Step 4: Add C result conversion**

Map native `Result` to `ps_solve_result`:

```cpp
PS_SOLVE_STATUS_SOLVED     <- result.status == "solved"
PS_SOLVE_STATUS_TIMEOUT    <- result.status == "timeout" || result.status == "cancelled"
PS_SOLVE_STATUS_EXHAUSTED  <- result.status == "exhausted"
PS_SOLVE_STATUS_ERROR      <- any other status
```

Convert solution strings `up`, `left`, `down`, `right`, `action`, and `tick` back to `ps_input`.

- [ ] **Step 5: Disable solver CLI main inside native library**

Wrap the CLI `main` in `native/src/solver/main.cpp`:

```cpp
#ifndef PUZZLESCRIPT_SOLVER_NO_MAIN
int main(int argc, char** argv) {
    ...
}
#endif
```

In `native/CMakeLists.txt`, add `src/solver/main.cpp` to `PUZZLESCRIPT_NATIVE_SOURCES` and set source-specific compile definitions for the `puzzlescript_native` target:

```cmake
set_source_files_properties(
  src/solver/main.cpp
  PROPERTIES COMPILE_DEFINITIONS "PUZZLESCRIPT_SOLVER_NO_MAIN=1;PUZZLESCRIPT_SOLVER_C_API=1")
```

- [ ] **Step 6: Build API**

Run:

```bash
cmake --build build --target puzzlescript_native puzzlescript_solver
```

Expected: both targets build; solver executable still has its CLI main, and `puzzlescript_native` exports the solve API.

- [ ] **Step 7: Commit**

```bash
git add native/include/puzzlescript/puzzlescript.h native/src/solver/main.cpp native/CMakeLists.txt
git commit -m "Expose native portfolio solver API"
```

### Task 4: Switch PuzzleScript+MIS Bridge To Portfolio API

**Files:**
- Modify: `tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.cpp`
- Modify: `tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.h`

- [ ] **Step 1: Replace local BFS call**

Change `NativeGameBridge::solveLayerGrid` to:

```cpp
ps_solve_options options = ps_solve_default_options();
options.timeout_ms = timeoutMs;
options.strategy = PS_SOLVE_STRATEGY_PORTFOLIO;
options.portfolio_jobs = 1;

ps_solve_result* rawSolveResult = nullptr;
ps_error* rawError = nullptr;
if (!ps_solve_level_layer_cell_object_ids(
        game(),
        levelIndex,
        nativeIds.data(),
        nativeIds.size(),
        &options,
        &rawSolveResult,
        &rawError)) {
    ...
}
```

Map `ps_solve_result` to `NativeSolveResult`, including `strategy`, `heuristic`, and `solution`.

- [ ] **Step 2: Remove bridge-local BFS scaffolding**

Delete the local `Node`, `frontier`, `visited`, manual `ps_full_state_clone`, `ps_full_state_turn_with_options`, and `reconstructSolution` use from `solveLayerGrid`.

- [ ] **Step 3: Run bridge test**

Run:

```bash
ctest --test-dir build -R puzzlescriptmis_native_bridge_smoke --output-on-failure
```

Expected: PASS and the strategy assertion reports `portfolio`.

- [ ] **Step 4: Commit**

```bash
git add tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.cpp tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.h
git commit -m "Use portfolio solver for puzzlescriptmis scoring"
```

### Task 5: Verify App Build

**Files:**
- No source edits expected.

- [ ] **Step 1: Run focused native tests**

Run:

```bash
ctest --test-dir build -R 'puzzlescriptmis_native_bridge_smoke|puzzlescriptmis_transformer_wiring_static|puzzlescript_cpp_player_api_tests' --output-on-failure
```

Expected: all tests pass.

- [ ] **Step 2: Run openFrameworks build**

Run:

```bash
make -C tools/puzzlescriptmis-app OF_ROOT=/Users/stephenlavelle/Documents/GitHub/of_v0.12.1_osx_release Debug
```

Expected: app builds and links against the updated native library.

- [ ] **Step 3: Check diff hygiene**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intentional files are modified or the tree is clean after commits.
