# Level Simplifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native `simplifyLevel` library primitive that removes redundant objects while preserving BFS optimal solution length, plus a standalone `puzzlescript-simplify` binary that loads any game, simplifies its levels, and writes a new file. Covered by unit + smoke tests.

**Architecture:** New `native/src/search/simplify.{hpp,cpp}` module in `puzzlescript_native`, reusing `levelTemplateToLayerCellObjectIds`, `levelTemplateFromLayerCellObjectIds`, `ps_solve_level_layer_cell_object_ids` (BFS), and runtime `loadLevelTemplate` + `turn` for replay/trace. The standalone `puzzlescript-simplify` binary links the primitive plus the existing `level_rows`/`output_writer` formatters; **no generator dependency** (the keeper-admission hook is deferred — see spec §10).

**Tech Stack:** C++17, `puzzlescript_native`, `ps_solve_*` C API, CMake/ctest, Node smoke harness.

**Spec:** `docs/superpowers/specs/2026-06-23-level-simplifier-design.md`

---

## File map

| File | Responsibility |
|---|---|
| `native/src/search/simplify.hpp` | Public `SimplifyOptions`, `SimplifyResult`, `simplifyLevel()` |
| `native/src/search/simplify.cpp` | BFS helper, replay, trace, candidate classification, batch + single-pass deletion |
| `native/CMakeLists.txt` | Add `simplify.cpp` to `PUZZLESCRIPT_NATIVE_SOURCES`; register unit test; add `puzzlescript_simplify` executable + smoke test |
| `native/tests/simplify_level.cpp` | Unit tests (redundant, blocking, spawn, idempotency, batch, bisection) |
| `native/src/simplify/main.cpp` | `puzzlescript-simplify` binary: load, simplify all levels, write file |
| `Makefile` | `make simplify IN=… OUT=…` wrapper |
| `src/tests/run_simplify_smoke.js` | End-to-end binary smoke on a stock demo game |

---

### Task 1: Public API skeleton + capped BFS solve helper

**Files:**
- Create: `native/src/search/simplify.hpp`
- Create: `native/src/search/simplify.cpp` (partial)
- Modify: `native/CMakeLists.txt` (add source to `PUZZLESCRIPT_NATIVE_SOURCES`)
- Test: `native/tests/simplify_level.cpp` (partial)

- [ ] **Step 1: Add header**

```cpp
// native/src/search/simplify.hpp
#pragma once

#include "runtime/core.hpp"
#include "puzzlescript/puzzlescript.h"

#include <cstdint>
#include <vector>

namespace puzzlescript::search {

struct SimplifyOptions {
    int64_t bfsTimeoutMs = 5000;
    uint64_t bfsMaxExpanded = 0;   // 0 = derive per-trial cap from baseline
    double bfsExpandedFactor = 2.0;
    bool useTraceBatch = true;
};

struct SimplifyResult {
    LevelTemplate level;
    int32_t optimalLength = -1;
    int64_t baselineExpanded = -1;
    int32_t objectsRemoved = 0;
    int32_t candidatesTried = 0;
    int32_t replayRejections = 0;
    int32_t bfsRejections = 0;
    int32_t bfsCalls = 0;
    bool complete = false;
};

SimplifyResult simplifyLevel(
    const LoadedGame& loadedGame,
    const LevelTemplate& level,
    const std::vector<ps_input>& referenceSolution,
    const SimplifyOptions& options);

} // namespace puzzlescript::search
```

- [ ] **Step 2: Write failing test for BFS length on sokoban fixture**

```cpp
// native/tests/simplify_level.cpp
#undef NDEBUG

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "runtime/compiled_rules.hpp"
#include "search/difficulty.hpp"
#include "search/simplify.hpp"

#include <cassert>
#include <fstream>
#include <sstream>
#include <string>

namespace {

std::string readFixture(const char* relPath) {
    std::ifstream in(relPath);
    std::stringstream buffer;
    buffer << in.rdbuf();
    return buffer.str();
}

puzzlescript::LoadedGame loadSokobanFixture() {
    const std::string source = readFixture("src/demo/sokoban_basic.txt") + "\n";
    puzzlescript::compiler::DiagnosticSink diagnostics;
    const auto state = puzzlescript::compiler::parseSource(source, diagnostics);
    puzzlescript::LoadedGame loadedGame;
    if (auto error = puzzlescript::compiler::lowerToRuntimeGame(state, loadedGame)) {
        throw std::runtime_error(error->message);
    }
    if (loadedGame.information) {
        puzzlescript::attachLinkedCompiledRules(
            *std::const_pointer_cast<puzzlescript::Game>(loadedGame.information), source);
    }
    return loadedGame;
}

int32_t countOccupiedCells(const puzzlescript::Game& game, const puzzlescript::LevelTemplate& level) {
    const std::vector<int32_t> grid = puzzlescript::search::levelTemplateToLayerCellObjectIds(game, level);
    int32_t count = 0;
    for (int32_t cell : grid) {
        if (cell >= 0) {
            ++count;
        }
    }
    return count;
}

} // namespace

int main() {
    const puzzlescript::LoadedGame loaded = loadSokobanFixture();
    const puzzlescript::LevelTemplate& level = loaded.information->levels.front();

    puzzlescript::search::DifficultyOptions diffOpts;
    diffOpts.timeoutMs = 5000;
    diffOpts.runSupplemental = true;
    const auto assessed = puzzlescript::search::assessGeneratedLevelDifficulty(loaded, level, diffOpts);
    assert(assessed.solved);
    assert(assessed.breakdown.expandedBfs >= 0);

    puzzlescript::search::SimplifyOptions simpOpts;
    simpOpts.bfsTimeoutMs = 5000;
    const auto result = puzzlescript::search::simplifyLevel(loaded, level, assessed.solution, simpOpts);
    assert(result.complete);
    assert(result.optimalLength == static_cast<int32_t>(assessed.solution.size())
        || result.optimalLength > 0);
    return 0;
}
```

- [ ] **Step 3: Register test in `native/CMakeLists.txt`** (mirror `generator_difficulty_assessment` target; link `puzzlescript_compiler` + `puzzlescript_native`; set `WORKING_DIRECTORY` to repo root).

- [ ] **Step 4: Run test — expect FAIL** (link error / `complete == false` stub)

```bash
cmake --build build/native --target simplify_level
ctest --test-dir build/native -R simplify_level --output-on-failure
```

- [ ] **Step 5: Implement `bfsSolve` (capped, returns expanded) + baseline stub in `simplify.cpp`**

```cpp
// native/src/search/simplify.cpp (core helper)
namespace puzzlescript::search {
namespace {

struct BfsSolveAttempt {
    bool solved = false;
    int32_t length = -1;
    int64_t expanded = -1;
};

// maxExpanded == 0 means uncapped (used for the baseline solve).
BfsSolveAttempt bfsSolve(
    const ps_game* game,
    int32_t width,
    int32_t height,
    const std::vector<int32_t>& layerGrid,
    int64_t timeoutMs,
    uint64_t maxExpanded) {
    BfsSolveAttempt attempt;
    ps_solve_options solveOptions = ps_solve_default_options();
    solveOptions.timeout_ms = std::max<int64_t>(1, timeoutMs);
    solveOptions.strategy = PS_SOLVE_STRATEGY_BFS;
    solveOptions.portfolio_jobs = 1;
    solveOptions.max_expanded = maxExpanded;

    ps_solve_result* rawResult = nullptr;
    ps_error* rawError = nullptr;
    if (!ps_solve_level_layer_cell_object_ids(
            game, width, height, layerGrid.data(), layerGrid.size(),
            &solveOptions, &rawResult, &rawError)) {
        ps_free_error(rawError);
        return attempt;
    }
    std::unique_ptr<ps_solve_result, decltype(&ps_solve_result_free)> result(rawResult, ps_solve_result_free);
    attempt.expanded = static_cast<int64_t>(result->expanded);
    if (result->status == PS_SOLVE_STATUS_SOLVED) {
        attempt.solved = true;
        attempt.length = static_cast<int32_t>(result->solution_count);
    }
    return attempt;
}

// BFS optimal-length equivalence is undefined under randomness; fail closed.
bool gameUsesRandom(const Game& game) {
    for (const auto& group : game.rules) {
        for (const auto& rule : group) {
            if (rule.isRandom) return true;
        }
    }
    for (const auto& group : game.lateRules) {
        for (const auto& rule : group) {
            if (rule.isRandom) return true;
        }
    }
    return false;
}

} // namespace

SimplifyResult simplifyLevel(
    const LoadedGame& loadedGame,
    const LevelTemplate& level,
    const std::vector<ps_input>& referenceSolution,
    const SimplifyOptions& options) {
    SimplifyResult result;
    result.level = level;
    if (!loadedGame.information) {
        return result;
    }
    if (gameUsesRandom(*loadedGame.information)) {
        return result;   // complete stays false: non-deterministic, skip
    }
    const std::vector<int32_t> layerGrid =
        levelTemplateToLayerCellObjectIds(*loadedGame.information, level);
    if (layerGrid.empty()) {
        return result;
    }

    ps_game gameWrapper;
    gameWrapper.impl = loadedGame;
    // Baseline runs uncapped (timeout-bounded) to establish the true optimal depth.
    const BfsSolveAttempt baseline = bfsSolve(
        &gameWrapper, level.width, level.height, layerGrid,
        options.bfsTimeoutMs, options.bfsMaxExpanded);
    ++result.bfsCalls;
    if (!baseline.solved) {
        return result;
    }
    result.complete = true;
    result.optimalLength = baseline.length;
    result.baselineExpanded = baseline.expanded;

    // Per-trial expansion cap (spec §7): legitimate same-length removals expand
    // ~baseline or fewer; shortcut-openers terminate early. Cap hit => reject.
    const uint64_t trialMaxExpanded = options.bfsMaxExpanded != 0
        ? options.bfsMaxExpanded
        : static_cast<uint64_t>(std::max<double>(
              1.0, static_cast<double>(baseline.expanded) * options.bfsExpandedFactor));
    (void)referenceSolution;
    (void)trialMaxExpanded;
    return result;
}

} // namespace puzzlescript::search
```

Add `#include "search/simplify.hpp"`, `#include "search/difficulty.hpp"`, `#include "runtime/c_api_internal.hpp"`, `<memory>`.

- [ ] **Step 6: Add `src/search/simplify.cpp` to `PUZZLESCRIPT_NATIVE_SOURCES` in `native/CMakeLists.txt`**

- [ ] **Step 7: Run test — expect PASS** (baseline-only stub)

- [ ] **Step 8: Commit**

```bash
git add native/src/search/simplify.hpp native/src/search/simplify.cpp \
  native/tests/simplify_level.cpp native/CMakeLists.txt
git commit -m "feat(native): add simplify module skeleton with BFS baseline"
```

---

### Task 2: Solution replay helper

**Files:**
- Modify: `native/src/search/simplify.cpp`
- Test: `native/tests/simplify_level.cpp`

- [ ] **Step 1: Add failing replay assertion to test**

```cpp
// Append inside main(), before simplifyLevel call:
puzzlescript::search::SimplifyOptions replayOpts;
replayOpts.bfsTimeoutMs = 5000;
const auto replayProbe = puzzlescript::search::simplifyLevel(loaded, level, assessed.solution, replayOpts);
assert(replayProbe.complete);
```

(Replay is internal; we validate indirectly in Task 4. For Task 2, add a `simplify_level` test-only hook or test replay via a package-visible test helper.)

**Preferred approach:** add `namespace puzzlescript::search::detail { bool replaySolution(...); }` declared only in a test header `native/src/search/simplify_test_access.hpp` included by the test, or export `replaySolution` in `simplify.hpp` with a comment `// test/internal`. Simpler v1: keep `replaySolution` in anonymous namespace and add this test case in Task 4 when deletion logic exists.

For Task 2, implement the helper and verify with a temporary `assert` inside `simplifyLevel` behind `#ifndef NDEBUG` — **instead**, add to `simplify.hpp`:

```cpp
bool replaySolutionWins(
    const LoadedGame& loadedGame,
    const LevelTemplate& level,
    const std::vector<ps_input>& inputs);
```

Document as test/support surface; generator does not call it.

- [ ] **Step 2: Implement `replaySolutionWins`**

```cpp
bool replaySolutionWins(
    const LoadedGame& loadedGame,
    const LevelTemplate& level,
    const std::vector<ps_input>& inputs) {
    if (!loadedGame.information || inputs.empty()) {
        return false;
    }
    auto session = createFullStateWithLoadedLevelSeed(loadedGame, "simplify-replay");
    session->meta.suppressRuleMessages = true;
    // solverMode = true so replay matches the BFS solver's win/checkpoint/command
    // semantics — otherwise the gate may diverge from the gate it filters for.
    constexpr RuntimeStepOptions stepOptions{
        .playableUndo = false,
        .emitAudio = false,
        .solverMode = true,
        .againPolicy = AgainPolicy::Drain,
    };
    if (auto error = loadLevelTemplate(*session, level, 0, stepOptions)) {
        return false;
    }
    for (const ps_input input : inputs) {
        const ps_step_result step = turn(*session, input, stepOptions);
        if (step.won || session->meta.currentLevelIndex != 0) {
            return true;
        }
    }
    return session->meta.winning;
}
```

Includes: `"runtime/core.hpp"` (already), use `puzzlescript::turn`.

- [ ] **Step 3: Extend test**

```cpp
assert(puzzlescript::search::replaySolutionWins(loaded, level, assessed.solution));
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(native): add solution replay helper for simplifier"
```

---

### Task 3: Solution trace + candidate classification

**Files:**
- Modify: `native/src/search/simplify.cpp`

- [ ] **Step 1: Add internal types**

```cpp
struct CellKey {
    int32_t layer;
    int32_t x;
    int32_t y;
    bool operator==(const CellKey& o) const {
        return layer == o.layer && x == o.x && y == o.y;
    }
};

struct CellKeyHash {
    size_t operator()(const CellKey& k) const {
        return static_cast<size_t>(k.layer * 73856093 ^ k.x * 19349663 ^ k.y * 83492791);
    }
};

struct DeletionCandidate {
    int32_t layer;
    int32_t x;
    int32_t y;
    int32_t objectId;
    int32_t sortTier;
};

struct SolutionTrace {
    std::unordered_set<CellKey, CellKeyHash> envelope;
    std::unordered_set<int32_t> changedLayers;
};
```

- [ ] **Step 2: Implement `buildSolutionTrace`**

After `loadLevelTemplate`, snapshot `layerGrid` into `std::vector<int32_t> before`. For each input:
1. `turn`
2. `collectPlayerPositions(session)` → map tile index to `(layer, x, y)` for player layer(s); insert into envelope (all layers where player appears)
3. Snapshot grid `after`; for every cell where `before[i] != after[i]`, decode `(layer, x, y)` and insert into envelope; record `layer` in `changedLayers`
4. Copy `after` → `before`

Use `level.width`, `level.height`, `game.layerCount` for index decode (same row-major layout as `levelTemplateToLayerCellObjectIds`).

- [ ] **Step 3: Implement `findPlayerSpawnCells`**

Load fresh session with level template (no inputs). `collectPlayerPositions` → convert to `CellKey` set on player collision layer(s). Exclude these from candidates.

- [ ] **Step 4: Implement `classifyCandidates`**

Walk `layerGrid`; for each `objectId >= 0` whose cell is not in the player spawn
set, build a `DeletionCandidate`. When `useTraceBatch` and the trace envelope is
non-empty, split candidates into two vectors (**do not drop either**):
- **`outsideEnvelope`** — cell not in the envelope. Batch-removed in phase 1.
- **`insideEnvelope`** — cell in the envelope. Assign `sortTier` for ordering:
  - `1` = on a layer not in `changedLayers`
  - `2` = ≥3 background neighbors (4-neighbor, same layer)
  - `3` = default

  Sort `insideEnvelope` by `(sortTier, layer, y, x)`.

When `useTraceBatch` is false (or the envelope is empty), `outsideEnvelope` is
empty and every candidate goes into `insideEnvelope`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(native): add simplifier trace and candidate enumeration"
```

---

### Task 4: Batch + single-pass deletion (`simplifyLevel` complete)

**Files:**
- Modify: `native/src/search/simplify.cpp`
- Modify: `native/tests/simplify_level.cpp`

- [ ] **Step 1: Add test helpers to build custom levels**

```cpp
// Mirror the proven helper in generator_microban_stamp_repro.cpp: object names
// in `idDict`/`ObjectDef.name` preserve the authored case, so lowercase both
// sides and pass a lowercase query ("crate", not "Crate").
int32_t objectIdByName(const puzzlescript::Game& game, const std::string& lowerName) {
    for (int32_t id = 0; id < game.objectCount; ++id) {
        std::string name = game.idDict[static_cast<size_t>(id)];
        for (char& ch : name) {
            ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
        }
        if (name == lowerName) {
            return id;
        }
    }
    return -1;
}

puzzlescript::LevelTemplate levelWithExtraCrate(
    const puzzlescript::Game& game,
    const puzzlescript::LevelTemplate& base,
    int32_t layer,
    int32_t x,
    int32_t y,
    int32_t crateId) {
    std::vector<int32_t> grid = puzzlescript::search::levelTemplateToLayerCellObjectIds(game, base);
    const size_t offset = static_cast<size_t>(layer * base.width * base.height + y * base.width + x);
    grid[offset] = crateId;
    return puzzlescript::search::levelTemplateFromLayerCellObjectIds(
        game, base.width, base.height, grid);
}
```

- [ ] **Step 2: Add redundant-crate test**

Use `sokoban_basic` level 0 (`####..` / `#.O#..` / …). Add isolated crate at top-right interior wall cell that BFS/trace will show is deletable. After simplify:

```cpp
const int32_t crateId = objectIdByName(*loaded.information, "crate");
const auto cluttered = levelWithExtraCrate(*loaded.information, level, /*layer=*/2, /*x=*/1, /*y=*/1, crateId);
const int32_t before = countOccupiedCells(*loaded.information, cluttered);
const auto simplified = puzzlescript::search::simplifyLevel(loaded, cluttered, assessed.solution, simpOpts);
assert(simplified.complete);
assert(simplified.objectsRemoved >= 1);
assert(countOccupiedCells(*loaded.information, simplified.level) < before);
```

Tune `(layer, x, y)` during implementation so the crate is truly redundant (may need `(2, 0, 0)` etc. — pick a walled corner cell not on the solution trace). Placing it **outside** the trace envelope exercises the phase-1 batch path; assert `result.bfsCalls` stays small (≈ baseline + 1).

- [ ] **Step 3: Add blocking-shortcut test**

Build a small 5×5 custom `layerGrid` inline (not from fixture file):

```text
######
#....#
#P.B.#   B = blocker crate, . = floor, O = target, * = push crate
#.*O.#
#....#
######
```

Construct programmatically with object IDs from fixture. Solve with BFS to get `referenceSolution` and `optimalLength`. The blocker cell `(layer=2, x=3, y=1)` should:
- pass replay when removed (reference path still wins)
- fail BFS length check (optimal becomes shorter)

Add 2–3 extra off-path decorative objects to the same custom level so the
outside-envelope batch contains both safe decorations *and* the blocker. This
exercises phase-1 bisection: the decorations are removed, the blocker is kept.

```cpp
// blocker kept, decorations removed (bisection isolated the outlier)
assert(simplified.objectsRemoved == decorationCount);
assert(/* blocker still present at (layer=2, x=3, y=1) */);
```

- [ ] **Step 4: Add idempotency test**

```cpp
const auto second = puzzlescript::search::simplifyLevel(loaded, simplified.level, assessed.solution, simpOpts);
assert(second.objectsRemoved == 0);
```

- [ ] **Step 5: Implement batch + single-pass deletion in `simplifyLevel`**

A `tryRemoveSet(cells)` helper does one replay+capped-BFS check of the working
grid with every cell in `cells` cleared, and commits to the working grid on
success. Both phases call it; correctness comes from the gates, always evaluated
against the live working grid.

```cpp
// Gate one trial: clear `cells` from workingGrid, replay-then-capped-BFS.
// Commit (and rebuild result.level) on pass. trialMaxExpanded from §4.1.
bool tryRemoveSet(workingGrid, cells, ...) {
    auto trialGrid = workingGrid;
    for (const auto& c : cells) trialGrid[offset(c)] = -1;
    auto trialLevel = levelTemplateFromLayerCellObjectIds(game, w, h, trialGrid);
    if (!referenceSolution.empty()
        && !replaySolutionWins(loadedGame, trialLevel, referenceSolution)) {
        ++result.replayRejections; return false;
    }
    const auto bfs = bfsSolve(&gameWrapper, w, h, trialGrid,
                              options.bfsTimeoutMs, trialMaxExpanded);
    ++result.bfsCalls;
    if (!bfs.solved || bfs.length != optimalLength) { ++result.bfsRejections; return false; }
    workingGrid = std::move(trialGrid);
    result.level = std::move(trialLevel);
    result.objectsRemoved += static_cast<int32_t>(cells.size());
    return true;
}

// Accept the maximal safe subset of `cells` (delta-debug).
void bisect(cells) {
    if (cells.empty()) return;
    if (tryRemoveSet(workingGrid, cells, ...)) return;   // whole set safe
    if (cells.size() == 1) return;                       // single outlier: keep it
    const size_t mid = cells.size() / 2;
    bisect({cells.begin(), cells.begin() + mid});
    bisect({cells.begin() + mid, cells.end()});          // after first half's accepts
}

SimplifyResult simplifyLevel(...) {
    // baseline BFS (uncapped) → optimalLength, baselineExpanded, trialMaxExpanded
    //   if !solved: return {level, complete=false}
    // trace = referenceSolution.empty() ? {} : buildSolutionTrace(...)
    // playerSpawns = findPlayerSpawnCells(...)
    // (outside, inside) = classifyCandidates(workingGrid, trace, playerSpawns, options)

    // Phase 1: batch the outside-envelope set (one BFS if all safe; bisect otherwise)
    // if (!outside.empty()) { result.candidatesTried += outside.size(); bisect(outside); }

    // Phase 2: single forward pass over inside-envelope — NO restart
    // for (const auto& c : inside) {
    //     ++result.candidatesTried;
    //     tryRemoveSet(workingGrid, {c}, ...);   // counters handled inside
    // }
    // return result;
}
```

No outer repeat / restart: each accept is verified against the cumulative
working grid, so the final board is always directly proven optimal. Phase 2 is a
single linear pass.

- [ ] **Step 6: Run tests — expect PASS**

```bash
ctest --test-dir build/native -R simplify_level --output-on-failure
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(native): implement greedy level simplifier"
```

---

### Task 5: Standalone `puzzlescript-simplify` binary

**Files:**
- Create: `native/src/simplify/main.cpp`
- Modify: `native/CMakeLists.txt` (new `puzzlescript_simplify` executable)
- Reuse: `native/src/generator/level_rows.cpp` (`levelTemplateToRows`, `formatGroupedSolution`), `native/src/generator/output_writer.cpp` (`replaceLevelsSection`)

- [ ] **Step 1: Add the CMake target** (mirror `puzzlescript_solver`/`puzzlescript_generator`)

```cmake
add_executable(puzzlescript_simplify
  src/simplify/main.cpp
  src/generator/level_rows.cpp
  src/generator/output_writer.cpp
)
target_link_libraries(puzzlescript_simplify PRIVATE puzzlescript_native puzzlescript_compiler)
target_include_directories(puzzlescript_simplify PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
```

Add `target_sources(puzzlescript_simplify PRIVATE ${PS_COMPILED_RULES_SOURCE_ABS_LIST})` inside the existing `if(PS_COMPILED_RULES_SOURCES)` block (mirror solver/generator). `simplify.cpp` ships in `puzzlescript_native`, so the binary gets it via the lib link.

- [ ] **Step 2: Implement `main.cpp` — arg parse + simplify every level**

Args: `<in.ps> --out <out.ps>` plus `--solver-timeout-ms` (default 2000), `--simplify-timeout-ms` (default 5000), `--bfs-expanded-factor` (default 2.0). Compile via parser + `lowerToRuntimeGame` + `attachLinkedCompiledRules` (same loader as `native/tests/simplify_level.cpp`).

```cpp
int runSimplify(const Options& options, const std::string& gameSource) {
    auto loadedGame = compileGame(gameSource);     // parse + lower + attach rules
    const Game& game = *loadedGame.information;

    std::ostringstream levelBody;
    const bool includeAction = game.metadata.values.find("noaction") == game.metadata.values.end();
    size_t playableIndex = 0;
    for (const LevelTemplate& level : game.levels) {
        if (level.isMessage) {                       // preserve message screens verbatim
            levelBody << "message " << level.message << "\n\n";
            continue;
        }
        ++playableIndex;

        DifficultyOptions diffOpts;
        diffOpts.timeoutMs = options.solverTimeoutMs;
        const auto assessed = assessGeneratedLevelDifficulty(loadedGame, level, diffOpts);

        LevelTemplate outLevel = level;              // default: emit unchanged
        std::vector<ps_input> solution = assessed.solution;
        int32_t removed = 0;
        if (!assessed.solved) {
            std::cerr << "level " << playableIndex << ": skipped (unsolved)\n";
        } else {
            SimplifyOptions simpOpts;
            simpOpts.bfsTimeoutMs = options.simplifyTimeoutMs;
            simpOpts.bfsExpandedFactor = options.bfsExpandedFactor;
            const auto simplified = simplifyLevel(loadedGame, level, assessed.solution, simpOpts);
            if (simplified.complete && simplified.objectsRemoved > 0) {
                outLevel = simplified.level;
                removed = simplified.objectsRemoved;
                const auto re = assessGeneratedLevelDifficulty(loadedGame, outLevel, diffOpts);
                if (re.solved) solution = re.solution;   // accurate (solution:) comment
            }
            std::cerr << "level " << playableIndex << ": removed " << removed
                      << ", optimal " << solution.size() << '\n';
        }

        if (!solution.empty()) {
            levelBody << "(solution: " << formatGroupedSolution(solution, includeAction) << ")\n";
        }
        for (const std::string& row : levelTemplateToRows(game, outLevel)) levelBody << row << '\n';
        levelBody << '\n';
    }

    writeAtomic(options.outPath, replaceLevelsSection(gameSource, levelBody.str()));
    return 0;
}
```

Robustness invariants (spec §6.2 / §8):
- **Never throws on a hard level** — unsolved levels are emitted unchanged and
  the walk continues.
- A **random game** is handled inside `simplifyLevel` (returns `complete = false`),
  so each level falls through to "emit unchanged" — no special-casing, but log it
  once at startup if `gameUsesRandom`.
- **Only the `LEVELS` section changes**; `replaceLevelsSection` preserves the
  prelude and all other sections. Message screens are re-emitted as
  `message <text>` from `LevelTemplate.message`.

- [ ] **Step 3: Manual smoke**

```bash
cmake --build build/native --target puzzlescript_simplify
./build/native/puzzlescript_simplify src/demo/sokoban_basic.txt --out /tmp/sokoban_simplified.txt
```

- [ ] **Step 4: Commit**

```bash
git add native/src/simplify/main.cpp native/CMakeLists.txt
git commit -m "feat(simplify): add puzzlescript-simplify binary"
```

---

### Task 6: Makefile target + Node smoke test

**Files:**
- Modify: `Makefile`
- Create: `src/tests/run_simplify_smoke.js`
- Modify: `native/CMakeLists.txt` (register ctest)

- [ ] **Step 1: Add Makefile target**

```makefile
.PHONY: simplify
simplify:
	@if [ -z "$(IN)" ] || [ -z "$(OUT)" ]; then \
		echo "Usage: make simplify IN=path/to/game.txt OUT=path/to/out.txt"; \
		exit 2; \
	fi
	@$(PUZZLESCRIPT_SIMPLIFY) "$(IN)" --out "$(OUT)" \
		--simplify-timeout-ms $(or $(SIMPLIFY_TIMEOUT_MS),5000) \
		--solver-timeout-ms $(or $(SOLVER_TIMEOUT_MS),2000)
```

Define `PUZZLESCRIPT_SIMPLIFY` next to the existing `PUZZLESCRIPT_GENERATOR` Makefile var, pointing at the built `puzzlescript_simplify` binary.

- [ ] **Step 2: Create `src/tests/run_simplify_smoke.js`**

Pattern from `run_generator_remix_smoke.js`, but drive the dedicated binary on a
stock demo game:
1. Run: `puzzlescript_simplify src/demo/sokoban_basic.txt --out <tmp>`
2. Assert the output is a complete game: every non-`LEVELS` section is
   byte-identical to the input, and the level count is unchanged.
3. For each level: parse `(solution: …)`, replay via
   `replaySolutionOnCurrentCompiledState`, assert win at the same BFS depth as
   the corresponding input level; assert object count does not increase.
4. Assert at least one level shrank (sokoban_basic has removable clutter) and
   that any message screens are preserved verbatim.

- [ ] **Step 3: Register ctest**

```cmake
add_test(
  NAME puzzlescript_simplify_smoke
  COMMAND ${NODE} ${REPO_ROOT}/src/tests/run_simplify_smoke.js
          $<TARGET_FILE:puzzlescript_simplify>
          ${REPO_ROOT}/src/demo/sokoban_basic.txt
)
set_tests_properties(puzzlescript_simplify_smoke PROPERTIES TIMEOUT 60)
```

- [ ] **Step 4: Run smoke — expect PASS**

```bash
ctest --test-dir build/native -R simplify --output-on-failure
```

- [ ] **Step 5: Commit**

```bash
git add Makefile src/tests/run_simplify_smoke.js native/CMakeLists.txt
git commit -m "test: add puzzlescript-simplify smoke harness"
```

---

### Task 7: Update spec status + docs

**Files:**
- Modify: `docs/superpowers/specs/2026-06-23-level-simplifier-design.md`

- [ ] **Step 1: Change header status to `implemented` after all tasks pass**

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: mark level simplifier spec implemented"
```

---

## Spec coverage checklist

| Spec section | Task |
|---|---|
| §3 Equivalence criterion (BFS length) | Task 4 |
| §4.1 Baseline BFS | Task 1 |
| §4.2 Candidate set + trace classification | Task 3 |
| §4.3 Candidate ordering (inside phase) | Task 3 |
| §4.4 Batch + single-pass deletion + replay gate | Task 2, 4 |
| §4.5 Clearing semantics | Task 4 (`layerGrid[offset] = -1`) |
| §5 API | Task 1 |
| §2/§8 Random-game fail-closed | Task 1 (`gameUsesRandom` guard) |
| §6.2 `puzzlescript-simplify` binary | Task 5 |
| §6.3 Makefile | Task 6 |
| §8 Error handling | Task 4 (per-deletion reject) + Task 5 (binary pass-through) |
| §9 Unit tests | Task 4 |
| §9 Integration smoke | Task 6 |

## Verification commands (full suite)

```bash
cmake --build build/native --target simplify_level puzzlescript_simplify
ctest --test-dir build/native -R 'simplify_level|puzzlescript_simplify' --output-on-failure
make simplify IN=src/demo/sokoban_basic.txt OUT=/tmp/sokoban_simplified.txt
```
