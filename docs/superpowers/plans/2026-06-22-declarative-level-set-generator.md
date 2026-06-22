# Declarative Level-Set Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `puzzlescript_generator` with multi-block level-set specs that run until killed, keep per-block hardest solvable levels ranked by MIS four-lane difficulty, and atomically emit a complete playable game to `--out`.

**Architecture:** Split the monolithic generator into focused modules while preserving the existing `(INIT LEVEL)` JSON mode unchanged. **Level-set mode is selected by `--out`** (not by `===` separators — a one-block spec has no separators). Extract MIS difficulty into shared `native/src/search/difficulty.{hpp,cpp}`. Hot path: **portfolio-only** solve per sample; **lazy supplemental** four-lane assessment only when a candidate clears the keeper admission bar. Reuse existing sharded dedupe with bounded eviction. Serialize keeper mutation and output writes under mutexes; derive per-sample RNG from block seed ⊕ sample id (no shared `Rng`).

**Tech Stack:** C++17, `puzzlescript_native` / `puzzlescript_compiler`, `ps_solve_*` API, CMake/ctest, Node smoke harness.

**Spec:** `docs/superpowers/specs/2026-06-22-declarative-level-set-generator-design.md`

**Note:** `max_expanded` is already on `ps_solve_options` — no prerequisite work needed.

---

## File map

| File | Responsibility |
|---|---|
| `native/src/search/difficulty.hpp` | Shared MIS types + `assessGeneratedLevelDifficulty()` |
| `native/src/search/difficulty.cpp` | Portfolio primary + optional supplemental trio |
| `native/src/generator/keeper.hpp` | **Single `Keeper` type** (shared by scheduler + output writer) |
| `native/src/generator/duration_parse.{hpp,cpp}` | `parseDurationMs("1h30m")` |
| `native/src/generator/spec_parser.{hpp,cpp}` | Multi/single-block parse, `dimensions` grid synthesis |
| `native/src/generator/generation_rules.{hpp,cpp}` | `prob`, `choose N-M`, `applyProgram()` |
| `native/src/generator/level_rows.{hpp,cpp}` | Column-major `levelTemplateToRows()`, solution grouping |
| `native/src/generator/output_writer.{hpp,cpp}` | LEVELS replacement, debounced atomic write |
| `native/src/generator/block_scheduler.{hpp,cpp}` | Keeper set, dedupe eviction, pass loop, workers |
| `native/src/generator/main.cpp` | CLI routing: legacy JSON vs level-set (`--out`) |
| `native/tests/generator_difficulty_assessment.cpp` | Shared module smoke (min-invariant) |
| `native/tests/generator_block_keepers.cpp` | Keeper insertion + dedupe eviction |
| `src/tests/run_generator_levelset_smoke.js` | **Replay test validates glyphs first** |

---

### Task 1: Shared MIS difficulty module

**Files:**
- Create: `native/src/search/difficulty.hpp`, `native/src/search/difficulty.cpp`
- Test: `native/tests/generator_difficulty_assessment.cpp`

- [ ] **Step 1: Write the failing test** (module smoke — not bridge parity; equivalence is by construction after Task 2)

```cpp
// native/tests/generator_difficulty_assessment.cpp
#include "runtime/core.hpp"
#include "search/difficulty.hpp"
#include <algorithm>
#include <cassert>

int main() {
    auto loaded = loadSokobanFixture();
    puzzlescript::search::DifficultyOptions opts;
    opts.timeoutMs = 500;
    opts.runSupplemental = true;
    const auto result = puzzlescript::search::assessGeneratedLevelDifficulty(
        loaded, fixedLevelTemplate(), opts);
    assert(result.solved);
    const auto lanes = {
        result.breakdown.expandedPortfolio,
        result.breakdown.expandedGreedy,
        result.breakdown.expandedWeightedAStar,
        result.breakdown.expandedBfs};
    assert(result.breakdown.difficulty == *std::min_element(lanes.begin(), lanes.end()));
    return 0;
}
```

- [ ] **Step 2: Run test — expect FAIL** (link error)

- [ ] **Step 3: Implement** — `DifficultyOptions::runSupplemental` gates supplemental lanes (default `false` for hot path callers). When `true`, run Greedy / Weighted A\* / BFS with `max_expanded = supplementalCap` (default `primaryExpanded + 6`).

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(native): add shared MIS difficulty assessment module"
```

---

### Task 2: MIS bridge delegates to shared difficulty

**Files:**
- Modify: `tools/puzzlescriptmis-app/src/native_bridge/DifficultyAssessment.cpp`

- [ ] **Step 1:** Thin adapter: `vvvs` → `LevelTemplate`, call shared module, map solution types. Bridge supplemental gating unchanged.

- [ ] **Step 2:** Run existing `native_bridge_smoke` — must pass.

- [ ] **Step 3: Commit**

---

### Task 3: Duration parser

**Files:**
- Create: `native/src/generator/duration_parse.{hpp,cpp}`
- Test: `native/tests/generator_duration_parse.cpp`

- [ ] Parse `30s`, `1m`, `1h30m`, `500ms`; throw on empty/invalid.

- [ ] **Commit**

---

### Task 4: Multi-block spec parser

**Files:**
- Create: `native/src/generator/spec_parser.{hpp,cpp}`
- Test: `native/tests/generator_spec_parser.cpp`

- [ ] **Step 1: Test single-block spec without `===`**

```cpp
const std::string singleBlock = R"(
dimensions: 3x2
take: 1
name: solo

choose 1 [ no wall ] -> [ player ]
)";
const auto blocks = parseLevelSetSpec(singleBlock, game);
assert(blocks.size() == 1);
```

- [ ] **Step 2: Implement**

```cpp
struct BlockHeader {
    int32_t width = 0;
    int32_t height = 0;
    size_t take = 1;
    std::string name;
    std::optional<uint64_t> seed;
};

struct BlockSpec {
    BlockHeader header;
    LevelTemplate initLevel;
    std::vector<std::string> ruleLines;
};

std::vector<BlockSpec> parseLevelSetSpec(const std::string& text, const Game& game);
LegacySpec parseLegacySpec(const std::string& text); // existing (INIT LEVEL) path
```

Parsing:
- Optional `===` separators between blocks (leading/trailing ignored). **No separators → one block.**
- Header keys: `dimensions` (required), `take`, `name`, `seed` only (**no `weight` in v1**).
- `synthesizeBackgroundGrid(game, W, H)` — every cell gets `game.backgroundId`.

- [ ] **Commit**

---

### Task 5: Generation rules + `prob` / `choose N-M`

**Files:**
- Create: `native/src/generator/generation_rules.{hpp,cpp}`
- Modify: `native/src/generator/main.cpp` (move-only first; legacy smoke must pass)
- Test: `native/tests/generator_generation_rules.cpp`

- [ ] Move existing rule engine unchanged, then add `ProbRule` and `choose N-M`.

- [ ] **Commit**

---

### Task 6: Canonical `Keeper` type (before output writer)

**Files:**
- Create: `native/src/generator/keeper.hpp`

- [ ] **Step 1: Define once — all later tasks include this header**

```cpp
#pragma once
#include "runtime/core.hpp"
#include <cstdint>
#include <string>
#include <vector>

namespace puzzlescript::generator {

struct Keeper {
    uint64_t levelHash = 0;
    int64_t difficulty = 0;              // four-lane min (stored after supplemental)
    int64_t expandedPortfolio = 0;       // primary lane count (admission gate + ranking tie-break)
    uint64_t sampleSeed = 0;
    size_t blockIndex = 0;
    std::string blockName;
    std::string dimensionsLabel;         // e.g. "3x2"
    std::vector<ps_input> solution;
    LevelTemplate level;
};

inline std::string dimensionsLabel(int32_t width, int32_t height) {
    return std::to_string(width) + "x" + std::to_string(height);
}

} // namespace
```

- [ ] **Commit**

```bash
git commit -m "feat(generator): add canonical Keeper type for level-set mode"
```

---

### Task 7: Level row rendering + solution comments

**Files:**
- Create: `native/src/generator/level_rows.{hpp,cpp}`
- Test: `native/tests/generator_level_rows.cpp`

- [ ] **Step 1: Document column-major indexing**

Grid matches existing generator convention: `tile = x * level.height + y` (width × height). Row output iterates `y` outer, `x` inner.

- [ ] **Step 2: `levelTemplateToRows`** — **new code**, no existing glyph helper to reuse (JSON mode uses `objectNamesForCell`, not legend glyphs). Walk `game.glyphOrder` / `game.glyphMaskTable`; pick first glyph whose mask ⊆ cell objects. Fallback: first non-background object glyph, else `.`.

- [ ] **Step 3: `formatGroupedSolution`** — compact `U/D/L/R/A`, groups of 4 separated by spaces; omit `A` when game has `noaction`.

- [ ] **Commit**

---

### Task 8: Output writer

**Files:**
- Create: `native/src/generator/output_writer.{hpp,cpp}`
- Test: `native/tests/generator_output_writer.cpp`

- [ ] **Step 1: `replaceLevelsSection`**

Find `LEVELS` line (case-insensitive). Keep through `LEVELS` and optional `=======` separator. **Replace everything after that to EOF** — `LEVELS` is the last PuzzleScript section in practice; avoids mis-detecting words inside level messages.

- [ ] **Step 2: `renderGameWithLevels`**

```cpp
std::string renderGameWithLevels(
    const std::string& gameSource,
    const Game& game,
    const std::vector<Keeper>& keepersInOrder);  // from keeper.hpp
```

Per keeper:
```
(block: {blockName} ({dimensionsLabel})  difficulty: {difficulty}  seed: {sampleSeed})
(solution: UUDL RARU LULA)
<row lines>

```

- [ ] **Step 3: `writeGameAtomically`** — temp file, fsync, rename; throw on failure.

- [ ] **Step 4: `OutputCoordinator` with debounced writes**

```cpp
class OutputCoordinator {
public:
    void notifyImprovement(/* snapshot keepers */);
    void flush();  // block boundary + shutdown — always immediate
private:
    std::mutex writeMutex_;
    std::optional<std::string> pendingContent_;
    TimePoint lastWrite_{};
    static constexpr int64_t kDebounceMs = 500;
};
```

`notifyImprovement` renders under `writeMutex_`, sets pending; schedules write if `now - lastWrite >= kDebounceMs`. `flush()` writes pending immediately (used when block pass ends and on SIGINT/SIGTERM after cancel).

- [ ] **Commit**

---

### Task 9: Keeper insertion + bounded global dedupe

**Files:**
- Create: `native/src/generator/block_scheduler.hpp` (state types)
- Create: `native/tests/generator_block_keepers.cpp`

- [ ] **Step 1: Reuse existing 3-part dedupe** (from `main.cpp:1298-1312`)

```cpp
struct GlobalDedupe {
    std::array<std::mutex, 64> mutexes;
    std::array<std::unordered_set<uint64_t>, 64> sets;
    std::array<std::deque<uint64_t>, 64> order;  // eviction queue — required for run-forever
};

bool insertGlobalDedupe(GlobalDedupe& dedupe, uint64_t hash, size_t dedupeMax);
```

Port `insertDedupe` verbatim: on shard full, evict front of `order` from `sets`.

- [ ] **Step 2: `BlockState` — thread-safe fields**

```cpp
struct BlockState {
    BlockSpec spec;
    GenerationProgram program;
    std::vector<Keeper> keepers;       // guarded by keeperMutex
    std::mutex keeperMutex;
    std::atomic<uint64_t> nextSampleId{0};
    int64_t inactivityTimeoutMs = 60000;
    TimePoint idleSince;               // updated under keeperMutex
    // NO shared Rng — workers derive sampleSeed per sample
};
```

- [ ] **Step 3: `tryInsertKeeper`** (under `block.keeperMutex`)

Admission uses **four-lane `difficulty`** for displacement; stores `expandedPortfolio` from the portfolio pass for future lazy gating.

- [ ] **Step 4: Unit tests** — dedupe eviction at cap, keeper displacement by difficulty.

- [ ] **Commit**

---

### Task 10: Scheduler — lazy supplemental, concurrency, pass loop

**Files:**
- Create: `native/src/generator/block_scheduler.cpp`
- Modify: `native/src/generator/main.cpp` (dispatch only)

- [ ] **Step 1: Per-worker sample seed** (matches existing JSON mode)

```cpp
const uint64_t sampleId = block.nextSampleId.fetch_add(1);
const uint64_t blockSeed = block.spec.header.seed.value_or(globalSeed ^ blockIndexSalt);
const uint64_t sampleSeed = splitmix64(blockSeed ^ (sampleId + 0x9e3779b97f4a7c15ULL));
Rng rng(sampleSeed);  // local to worker, not shared
```

- [ ] **Step 2: Hot path — portfolio only**

```cpp
DifficultyOptions primaryOpts;
primaryOpts.timeoutMs = options.solverTimeoutMs;
primaryOpts.runSupplemental = false;
const auto primary = assessGeneratedLevelDifficulty(loadedGame, candidateLevel, primaryOpts);
if (!primary.solved) continue;
if (!insertGlobalDedupe(globalDedupe, levelHash, dedupeMax)) continue;

// Lazy supplemental gate (matches MIS generation.cpp pattern)
const bool mightAdmit = [&] {
    std::lock_guard lock(block.keeperMutex);
    if (block.keepers.size() < block.spec.header.take) return true;
    const Keeper& weakest = *std::min_element(block.keepers.begin(), block.keepers.end(),
        [](const Keeper& a, const Keeper& b) { return a.difficulty < b.difficulty; });
    return primary.breakdown.expandedPortfolio > weakest.expandedPortfolio;
}();
if (!mightAdmit) continue;

DifficultyOptions fullOpts = primaryOpts;
fullOpts.runSupplemental = true;
const auto assessed = assessGeneratedLevelDifficulty(loadedGame, candidateLevel, fullOpts);
// build Keeper with assessed.breakdown.difficulty, assessed.solution, primary.breakdown.expandedPortfolio
```

- [ ] **Step 3: Improvement → debounced write**

Under `keeperMutex`: `tryInsertKeeper`. On accept/displace: reset `idleSince`, call `outputCoordinator.notifyImprovement(snapshotAllKeepers())`. **`snapshotAllKeepers` copies keeper vectors under each block's mutex** — no render inside worker without coordinator lock.

- [ ] **Step 4: `runBlockUntilIdle` + `runLevelSetForever`**

Workers stop when `now - idleSince >= τ` or cancel. After block: `outputCoordinator.flush()`, `τ *= 2`, next block.

- [ ] **Step 5: Manual smoke** — `--jobs 2`, verify no crash, output valid.

- [ ] **Commit**

---

### Task 11: CLI routing + signal handling

**Files:**
- Modify: `native/src/generator/main.cpp`

- [ ] **Step 1: Mode detection by `--out`**

```cpp
// Level-set mode ⟺ --out provided. Mutually exclusive with --json-out.
const bool levelSetMode = !options.outPath.empty();
if (levelSetMode && !options.jsonOut.empty())
    throw std::runtime_error("Cannot combine --out with --json-out");
if (levelSetMode)
    runLevelSet(...);
else
    runLegacyJson(...);  // existing path unchanged
```

Single-block spec (`dimensions:` header, no `===`) works because mode does not depend on separators.

- [ ] **Step 2: Flags** — `--out PATH` (required for level-set), `--inactivity-start DURATION` (default `1m`, same `τ₀` for every block).

- [ ] **Step 3: SIGINT/SIGTERM** — set cancel; finish in-flight atomic write via `outputCoordinator.flush()`; exit 0.

- [ ] **Step 4: Legacy smoke** — `ctest -R puzzlescript_generator_smoke`

- [ ] **Commit**

---

### Task 12: Integration tests (replay validates glyphs)

**Files:**
- Create: `src/tests/generator_presets/sokoban_levelset_tiny.gen`
- Create: `src/tests/run_generator_levelset_smoke.js`

- [ ] **Step 1: Replay-first test order**

1. Short run → `--out` exists.
2. **Solution replay** — parse `(solution: …)`, replay inputs, assert win. **This is the glyph correctness gate** — if `levelTemplateToRows` transposes or picks wrong glyphs, replay fails immediately.
3. Compile output in Node harness.
4. SIGTERM crash-safety — valid game remains.

- [ ] **Step 2: Register ctest** (`TIMEOUT 60`)

- [ ] **Commit**

---

### Task 13: CMake wiring + `main.cpp` trim

- [ ] Add all new sources + test executables to `native/CMakeLists.txt`.

- [ ] Trim `main.cpp` to CLI + legacy loop + level-set dispatch.

- [ ] Full gate: `ctest --test-dir build -R "generator_"`

- [ ] **Commit**

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| Multi-block spec (`===` optional) | Task 4 |
| Headers: `dimensions`, `take`, `name`, `seed` | Task 4 |
| `prob P`, `choose N-M` | Task 5 |
| Round-robin + doubling `τ` | Task 10 |
| `--out` level-set mode | Task 11 |
| Lazy supplemental (generation) | Task 10 |
| Four-lane min on keepers + comments | Tasks 1, 10 |
| Bounded global dedupe | Task 9 |
| Per-block `take` | Task 9 |
| Atomic debounced output | Task 8 |
| Legacy JSON mode preserved | Task 11 |
| Replay + compile tests | Task 12 |

**Deferred:** `weight`; `INIT LEVEL` + `dimensions`; multi-cell `prob`; `min-difficulty`; auto-retire exhausted blocks.

---

## Design decisions (review fixes)

| Issue | Resolution |
|---|---|
| Four-lane on every sample | Portfolio-only hot path; supplemental only when `expandedPortfolio` beats admission bar |
| Duplicate `Keeper` types | Single `keeper.hpp` before output writer (Task 6) |
| Unbounded dedupe | Port `sets` + `order` + `mutexes` + `dedupeMax` eviction |
| `--jobs` races | Per-sample derived seeds; `keeperMutex`; `OutputCoordinator::writeMutex` |
| Single-block mis-routed | Mode = `--out` present, not `===` count |
| Write storm | 500ms debounce + mandatory `flush()` on block end / shutdown |
| Column-major grid | Explicit `x * height + y` in Task 7 |
| Glyph helper | New code; Task 12 replay is correctness gate |
| `weight` | Cut from v1 (spec header table already omits it) |
| `max_expanded` prerequisite | Already landed |
| Parity test name | `generator_difficulty_assessment` (module smoke) |
| LEVELS splice | Replace from separator to EOF |

---

## Self-review notes

- **Task order:** `Keeper` (Task 6) precedes output writer (Task 8) and scheduler (Task 10).
- **Risk:** Glyph selection — replay test in Task 12 is the hard gate; fix Task 7 before declaring Task 12 done.
- **Risk:** Task 5 move-only refactor must pass legacy smoke before new rule forms.
