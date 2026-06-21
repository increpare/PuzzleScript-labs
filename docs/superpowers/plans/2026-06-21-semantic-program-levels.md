# SemanticProgram Contract (Slice 3: Resolved Levels) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `SemanticProgram` contract with resolved levels — each level template as its dimensions, message flag, and a per-cell grid of resolved object ids (background fill included) — on both the C++ projection and the JS shape, validated by the existing corpus parity gate.

**Architecture:** Additive extension of the slice-1/2 contract (objects, collision layers, legends). The C++ producer decodes the already-lowered `LevelTemplate.objects` cell masks; the JS shape decodes the compiled `state.levels` cell bitvecs. Both engines store level cells **column-major** (`tileIndex = x*height + y`) and bake the background object into every empty-background cell during compile, so reading the templates aligns. No lowerer changes; the engine is untouched. This slice also consolidates the mask-decode into one reusable helper (addressing a prior audit note).

**Tech Stack:** C++17 (`puzzlescript_compiler`), Node.js (JS oracle), CMake/CTest.

**Scope.** Slice 3 adds only levels. Each level is `{ is_message, message, width, height, cells }` where `cells` is a row-major (`y` outer, `x` inner) array of `width*height` entries, each the sorted set of object ids present in that cell. Message screens emit `{ is_message: true, message, width: 0, height: 0, cells: [] }`. **Deferred to later slices on the same contract:** win conditions, metadata, sounds, rules.

**Prerequisite facts (verified against the tree at plan time):**
- C++ `Game::levels` is `std::vector<LevelTemplate>` where `LevelTemplate { bool isMessage; std::string message; int32_t lineNumber; int32_t width; int32_t height; MaskVector objects; }` (`native/src/runtime/core.hpp`). Cell masks are column-major: `objects[(x*height + y) * strideObject + word]`, and `strideObject == wordCount`.
- The C++ lowerer fills the background object into every cell whose background layer is empty (`native/src/compiler/lower_to_runtime.cpp:1175-1191`), and uses `tileIndex = x*height + y` (`:1194`) — identical to JS `levelFromString` (`src/js/compiler.js`: `o.objects[STRIDE_OBJ * (i*height + j) + w]`, `i`=x, `j`=y, plus the `levelBackgroundMask` ior loop).
- JS `state.levels` (after `levelsToArray`) is an array of either a `Level` object (`.objects` `Int32Array`, `.width`, `.height`) for grids, or `{ message }` for message screens. `Level` cell index is column-major (`level.js`: `colIndex=(index/height)|0; rowIndex=index%height`). A cell bit is `objects[cellIndex*STRIDE_OBJ + (id>>5)] & (1 << (id&31))`.
- sokoban_basic has 2 grid levels (level 0 is width 6, height 7), no message screens; every cell contains the background object (id 0) because of the background fill, and each level has exactly one player cell.
- `decodeMaskObjectIds` (added in slice 2, `native/src/compiler/semantic_program.cpp`) already decodes a `game.maskArena` offset to ascending ids; this slice refactors its inner loop into a pointer-based helper reused for level cells.

---

## File Structure

- **Modify** `native/src/compiler/types/semantic_program.hpp` — add `SemanticLevel` struct and a `levels` field.
- **Modify** `native/src/compiler/semantic_program.cpp` — extract `decodeMaskWordsObjectIds`; decode level cells in `buildSemanticProgram`; emit `levels` in the serializer.
- **Modify** `src/tests/js_oracle/lib/puzzlescript_semantic_program.js` — `levelList(state)`; emit `levels` in the snapshot.
- **Modify** `native/tests/compiler_semantic_program.cpp` — assert sokoban's two levels (dims, background fill, one player cell).

---

## Task 1: Resolved levels

**Files:**
- Modify: `native/src/compiler/types/semantic_program.hpp`
- Modify: `native/src/compiler/semantic_program.cpp`
- Modify: `native/tests/compiler_semantic_program.cpp`
- Modify: `src/tests/js_oracle/lib/puzzlescript_semantic_program.js`

- [ ] **Step 1: Extend the unit test with level assertions (red)**

In `native/tests/compiler_semantic_program.cpp`, after the legend assertions (before the `const std::string json = ...` line), add:

```cpp
    // Resolved levels: sokoban_basic has 2 grid level templates (no messages),
    // level 0 is 6x7. Background fill means every cell contains the background
    // object, and each level has exactly one player cell.
    assert(program.levels.size() == 2);

    int32_t backgroundId = -1;
    int32_t playerId = -1;
    for (const auto& object : program.objects) {
        if (object.name == "background") backgroundId = object.id;
        if (object.name == "player") playerId = object.id;
    }
    assert(backgroundId >= 0 && playerId >= 0);

    assert(!program.levels[0].isMessage);
    assert(program.levels[0].width == 6);
    assert(program.levels[0].height == 7);

    for (const auto& level : program.levels) {
        assert(!level.isMessage);
        assert(level.cells.size() == static_cast<size_t>(level.width) * static_cast<size_t>(level.height));
        int playerCells = 0;
        for (const auto& cell : level.cells) {
            assert(std::find(cell.begin(), cell.end(), backgroundId) != cell.end());
            if (std::find(cell.begin(), cell.end(), playerId) != cell.end()) {
                ++playerCells;
            }
        }
        assert(playerCells == 1);
    }
```

Also extend the JSON-shape assertions:

```cpp
    assert(json.find("\"levels\"") != std::string::npos);
    assert(json.find("\"cells\"") != std::string::npos);
```

- [ ] **Step 2: Add the SemanticLevel struct + contract field**

In `native/src/compiler/types/semantic_program.hpp`, add `SemanticLevel` after `SemanticLegend`:

```cpp
struct SemanticLevel {
    bool isMessage = false;
    std::string message;
    int32_t width = 0;
    int32_t height = 0;
    // Row-major (y outer, x inner) cells; each cell is the sorted set of object
    // ids present (background included). Empty for message screens.
    std::vector<std::vector<int32_t>> cells;
};
```

and add a field to `SemanticProgram` (after `properties`):

```cpp
    std::vector<SemanticLevel> levels;
```

Update the struct comment to list levels as now included.

- [ ] **Step 3: Extract the reusable decoder and decode level cells**

In `native/src/compiler/semantic_program.cpp`, add a pointer-based decoder in the anonymous namespace (above `decodeMaskObjectIds`):

```cpp
std::vector<int32_t> decodeMaskWordsObjectIds(
    const puzzlescript::MaskWord* mask,
    uint32_t wordCount,
    int32_t objectCount
) {
    std::vector<int32_t> ids;
    for (int32_t objectId = 0; objectId < objectCount; ++objectId) {
        const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(objectId));
        if (word >= wordCount) {
            continue;
        }
        if ((mask[word] & puzzlescript::maskBit(static_cast<uint32_t>(objectId))) != 0) {
            ids.push_back(objectId);  // ascending by construction
        }
    }
    return ids;
}
```

and refactor the body of `decodeMaskObjectIds` to delegate to it (keep its signature and bounds checks):

```cpp
std::vector<int32_t> decodeMaskObjectIds(const puzzlescript::Game& game, puzzlescript::MaskOffset offset) {
    if (offset == puzzlescript::kNullMaskOffset) {
        return {};
    }
    const size_t base = static_cast<size_t>(offset);
    const size_t wordCount = static_cast<size_t>(game.wordCount);
    if (base > game.maskArena.size() || wordCount > game.maskArena.size() - base) {
        return {};
    }
    return decodeMaskWordsObjectIds(game.maskArena.data() + base, game.wordCount, game.objectCount);
}
```

Then in `buildSemanticProgram`, after the legend assignments and before `return program;`, add:

```cpp
    program.levels.reserve(game.levels.size());
    for (const auto& tmpl : game.levels) {
        SemanticLevel level;
        level.isMessage = tmpl.isMessage;
        level.message = tmpl.message;
        if (!tmpl.isMessage) {
            level.width = tmpl.width;
            level.height = tmpl.height;
            level.cells.reserve(static_cast<size_t>(tmpl.width) * static_cast<size_t>(tmpl.height));
            for (int32_t y = 0; y < tmpl.height; ++y) {
                for (int32_t x = 0; x < tmpl.width; ++x) {
                    const int32_t tileIndex = x * tmpl.height + y;  // column-major
                    const size_t base = static_cast<size_t>(tileIndex) * static_cast<size_t>(game.strideObject);
                    if (base + static_cast<size_t>(game.wordCount) <= tmpl.objects.size()) {
                        level.cells.push_back(decodeMaskWordsObjectIds(
                            tmpl.objects.data() + base, game.wordCount, game.objectCount));
                    } else {
                        level.cells.emplace_back();
                    }
                }
            }
        }
        program.levels.push_back(std::move(level));
    }
```

- [ ] **Step 4: Emit levels in the serializer**

In `native/src/compiler/semantic_program.cpp`, add a level-array serializer in the anonymous namespace:

```cpp
void appendLevelArray(std::string& out, const std::vector<SemanticLevel>& levels) {
    out += '[';
    for (size_t i = 0; i < levels.size(); ++i) {
        if (i != 0) {
            out += ',';
        }
        const auto& level = levels[i];
        out += "{\"is_message\":";
        out += level.isMessage ? "true" : "false";
        out += ",\"message\":";
        appendJsonString(out, level.message);
        out += ",\"width\":";
        out += std::to_string(level.width);
        out += ",\"height\":";
        out += std::to_string(level.height);
        out += ",\"cells\":[";
        for (size_t c = 0; c < level.cells.size(); ++c) {
            if (c != 0) {
                out += ',';
            }
            out += '[';
            for (size_t j = 0; j < level.cells[c].size(); ++j) {
                if (j != 0) {
                    out += ',';
                }
                out += std::to_string(level.cells[c][j]);
            }
            out += ']';
        }
        out += "]}";
    }
    out += ']';
}
```

Then change the end of `serializeSemanticProgramJson`. Replace:

```cpp
    out += ",\"properties\":";
    appendLegendArray(out, program.properties);
    out += "}}}";
    return out;
```

with:

```cpp
    out += ",\"properties\":";
    appendLegendArray(out, program.properties);
    out += "},\"levels\":";
    appendLevelArray(out, program.levels);
    out += "}}";
    return out;
```

- [ ] **Step 5: Build and run the unit test (green)**

Run:
```bash
cmake --build build --target compiler_semantic_program -j
ctest --test-dir build -R '^compiler_semantic_program$' --output-on-failure
```
Expected: `Passed`. (Building before Step 2 fails to compile — `SemanticLevel`/`program.levels` undefined — the red state.)

- [ ] **Step 6: Decode levels on the JS side**

In `src/tests/js_oracle/lib/puzzlescript_semantic_program.js`, add `levelList` above `buildSemanticProgramSnapshot`:

```js
function levelList(state) {
    return state.levels.map(function (level) {
        if (level.objects === undefined) {
            return { is_message: true, message: level.message || '', width: 0, height: 0, cells: [] };
        }
        const width = level.width;
        const height = level.height;
        const stride = level.objects.length / (width * height);
        const cells = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const base = (x * height + y) * stride;  // column-major
                const ids = [];
                for (let objectId = 0; objectId < state.idDict.length; objectId++) {
                    if ((level.objects[base + (objectId >> 5)] & (1 << (objectId & 31))) !== 0) {
                        ids.push(objectId);
                    }
                }
                cells.push(ids);
            }
        }
        return { is_message: false, message: '', width: width, height: height, cells: cells };
    });
}
```

Then extend the snapshot. Change:

```js
    return {
        schema_version: 1,
        semantic_program: { objects, collision_layers, legends },
    };
```

to:

```js
    const levels = levelList(state);

    return {
        schema_version: 1,
        semantic_program: { objects, collision_layers, legends, levels },
    };
```

- [ ] **Step 7: Validate JS↔C++ level parity over the corpus**

Run:
```bash
cmake --build build --target puzzlescript_cpp -j
bash scripts/diff_semantic_program_against_js.sh src/demo/sokoban_basic.txt; echo "sokoban exit=$?"
time node src/tests/semantic_program_parity_corpus_node.js build/native/puzzlescript_cpp src/tests/solver_tests
```
Expected: sokoban `exit=0`, and the corpus runner still reports `conforming + parity-matched: 161` with `parity failures: 0` — now including `levels`. The runner may take noticeably longer (level grids are large); if it exceeds the CTest timeout in Step 8, raise `semantic_program_parity_corpus`'s `TIMEOUT` in `native/CMakeLists.txt` accordingly.

If a conforming game reports a parity failure, triage it as in prior slices — inspect the game's `levels` in both outputs (`--snapshot-phase semantic` vs `--emit-semantic-program`). Likely sources: (a) a column-major/row-major mix-up (cells transposed — width/height swapped or `x*height+y` miswritten), (b) background-fill edge cases (a level using an explicit background-layer glyph), or (c) message-text trimming differences. Classify as emitter bug vs real compiler divergence vs new invariant; do not loosen the gate.

- [ ] **Step 8: Run the full semantic test set and commit**

Run:
```bash
ctest --test-dir build -R 'semantic_program' --output-on-failure
```
Expected: all four semantic_program tests pass. Then:

```bash
git add native/src/compiler/types/semantic_program.hpp native/src/compiler/semantic_program.cpp native/tests/compiler_semantic_program.cpp src/tests/js_oracle/lib/puzzlescript_semantic_program.js
git commit -m "feat(native): resolve levels in SemanticProgram contract (slice 3)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Subsequent slices (roadmap, not part of this plan)

- **Slice 4 — win conditions:** `Game::winConditions` (`{ quantifier; filter1; filter2; aggr1; aggr2 }`, masks decode via the same `decodeMaskObjectIds`) vs JS `state.winconditions` + `lookupWinConditionMask`. Research point: mapping the JS quantifier token (`no`/`some`/`all`/`any`) to the C++ `quantifier` int consistently.
- **Slice 5 — metadata + sounds:** `Game::metadata` / `sfxEvents` vs JS `state.metadata` / sound seeds.
- **Rules (much later):** deferred until a semantic rule representation exists.

---

## Self-Review

**Spec coverage:** The design doc lists "levels" among what `SemanticProgram` resolves. Task 1 adds resolved level templates (dims + message + per-cell object-id grid) gated JS↔C++ by the existing corpus harness. Win conditions / metadata / rules remain scoped out (roadmap), consistent with one self-contained testable unit per plan.

**Placeholder scan:** No TBD/TODO placeholders; every code step is complete and every command states expected output. Step 7's triage branch is the proven empirical-validation procedure, not a placeholder.

**Type/name consistency:** `SemanticLevel { isMessage; message; width; height; cells }` (Step 2) is populated in `buildSemanticProgram` (Step 3), serialized by `appendLevelArray` under keys `is_message`/`message`/`width`/`height`/`cells` (Step 4), matched field-for-field by JS `levelList` (Step 6), and asserted via `program.levels` (Step 1). Both sides decode column-major (`x*height + y`) and rely on background-filled templates. The shared `decodeMaskWordsObjectIds` is used by both the legend decode and the level-cell decode.

**Risk notes:**
- The highest-risk bug class is a cell-order mix-up (transpose). The unit test guards it directly: sokoban level 0 is asserted `width==6, height==7` (not square, so a transpose flips them) and the player-in-exactly-one-cell check would also break under a bad index. The corpus gate is the broad validator.
- Message-level coverage may be thin in the solver corpus (mostly playable levels); message-text parity is therefore less exercised by the gate. If message divergence is a concern later, add a fixture with a message screen.
- Performance: decoding every cell over every object id is `O(width*height*objectCount)` per level; fine at corpus scale but the runner will slow — Step 7/8 covers raising the CTest timeout if needed rather than narrowing coverage.
