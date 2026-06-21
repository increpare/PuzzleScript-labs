# SemanticProgram Contract (Slice 4: Resolved Win Conditions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `SemanticProgram` contract with resolved win conditions — each condition as its quantifier plus the resolved object-id sets and aggregate flags of its two filters — on both the C++ projection and the JS shape, validated by the existing corpus parity gate. Also consolidate the contract's int-array JSON emission into one shared helper (retiring a prior audit note).

**Architecture:** Additive extension of the slice-1/2/3 contract. The C++ producer decodes the already-lowered `Game::winConditions` filter masks with the existing `decodeMaskObjectIds`; the JS shape decodes the compiled `state.winconditions` filter bitvecs. Both engines use the identical quantifier encoding (`-1` = no, `0` = some, `1` = all) and the same `{filter1, filter2, aggr1, aggr2}` structure, defaulting `filter2` to the all-objects mask when there is no `on Y` clause. No lowerer changes; the engine is untouched.

**Tech Stack:** C++17 (`puzzlescript_compiler`), Node.js (JS oracle), CMake/CTest.

**Scope.** Slice 4 adds only win conditions. Each is `{ quantifier, object_ids_1, aggregate_1, object_ids_2, aggregate_2 }`, emitted in source-declaration order (no sort — both sides preserve order). **Deferred to later slices:** metadata, sounds, rules.

**Prerequisite facts (verified against the tree at plan time):**
- C++ `Game::winConditions` is `std::vector<WinCondition>` where `WinCondition { int32_t quantifier; MaskOffset filter1; MaskOffset filter2; int32_t lineNumber; bool aggr1; bool aggr2; }` (`native/src/runtime/core.hpp`). The lowerer sets `quantifier` to `-1` for `no`, `1` for `all`, `0` otherwise, resolves `filter1` from `tokens[1]`, and `filter2` from `tokens[3]` or the `"\nall\n"` all-objects sentinel when absent (`native/src/compiler/lower_to_runtime.cpp:4624-4671`).
- JS `state.winconditions` (after `processWinConditions`) is an array of `[num, mask1, mask2, lineNumber, aggregate1, aggregate2]` with the same `num` mapping (`no`=-1, `all`=1, else 0), and `mask2` defaulting to `lookupWinConditionMask(state, "\nall\n")` (`src/js/compiler.js:4343-4382`). `state.objectMasks["\nall\n"]` is registered as the all-objects mask (`compiler.js:4230`), so the JS default matches the C++ `allObjectsMask`.
- `mask1`/`mask2` are `BitVec`s with a 32-bit-word `.data` array; a bit is `mask.data[id >> 5] & (1 << (id & 31))`. The error path returns `mask: 0`.
- Ground-truth fixture: sokoban_basic's `all Target on Crate` resolves to `[1, {target}, {crate}, 84, false, false]` with `idDict = [background(0), target(1), player(2), wall(3), crate(4)]` — i.e. `quantifier 1`, `object_ids_1 = [1]`, `object_ids_2 = [4]`, both aggregate flags false.
- `decodeMaskObjectIds(game, offset)` (slice 2/3, `native/src/compiler/semantic_program.cpp`) already decodes a `game.maskArena` offset to ascending object ids — used directly for both win-condition filters.

---

## File Structure

- **Modify** `native/src/compiler/types/semantic_program.hpp` — add `SemanticWinCondition` struct and a `winConditions` field.
- **Modify** `native/src/compiler/semantic_program.cpp` — add a shared `appendIntArray`; build win conditions in `buildSemanticProgram`; emit `win_conditions` in the serializer; route existing int-array emission through `appendIntArray`.
- **Modify** `src/tests/js_oracle/lib/puzzlescript_semantic_program.js` — `winConditionList(state)`; emit `win_conditions` in the snapshot.
- **Modify** `native/tests/compiler_semantic_program.cpp` — assert sokoban's single win condition.

---

## Task 1: Resolved win conditions

**Files:**
- Modify: `native/src/compiler/types/semantic_program.hpp`
- Modify: `native/src/compiler/semantic_program.cpp`
- Modify: `native/tests/compiler_semantic_program.cpp`
- Modify: `src/tests/js_oracle/lib/puzzlescript_semantic_program.js`

- [ ] **Step 1: Extend the unit test with win-condition assertions (red)**

In `native/tests/compiler_semantic_program.cpp`, after the level assertions (before the `const std::string json = ...` line), add (`crateId` and `targetId` are already computed in the legend assertions above):

```cpp
    // Win conditions: sokoban_basic has "all Target on Crate" => quantifier 1
    // (all), filter1 = {target}, filter2 = {crate}, no aggregates.
    assert(program.winConditions.size() == 1);
    const auto& win = program.winConditions[0];
    assert(win.quantifier == 1);
    assert((win.objectIds1 == std::vector<int32_t>{targetId}));
    assert((win.objectIds2 == std::vector<int32_t>{crateId}));
    assert(!win.aggregate1 && !win.aggregate2);
```

and extend the JSON-shape assertions:

```cpp
    assert(json.find("\"win_conditions\"") != std::string::npos);
    assert(json.find("\"quantifier\"") != std::string::npos);
```

- [ ] **Step 2: Add the SemanticWinCondition struct + contract field**

In `native/src/compiler/types/semantic_program.hpp`, add `SemanticWinCondition` after `SemanticLevel`:

```cpp
struct SemanticWinCondition {
    int32_t quantifier = 0;            // -1 = no, 0 = some, 1 = all
    std::vector<int32_t> objectIds1;   // sorted ascending
    bool aggregate1 = false;
    std::vector<int32_t> objectIds2;   // sorted; all objects when there is no "on Y" clause
    bool aggregate2 = false;
};
```

and add a field to `SemanticProgram` (after `levels`):

```cpp
    std::vector<SemanticWinCondition> winConditions;  // source-declaration order
```

Update the struct comment to list win conditions as now included.

- [ ] **Step 3: Build win conditions in the projection**

In `native/src/compiler/semantic_program.cpp`, in `buildSemanticProgram` after the levels loop and before `return program;`, add:

```cpp
    program.winConditions.reserve(game.winConditions.size());
    for (const auto& condition : game.winConditions) {
        SemanticWinCondition out;
        out.quantifier = condition.quantifier;
        out.objectIds1 = decodeMaskObjectIds(game, condition.filter1);
        out.aggregate1 = condition.aggr1;
        out.objectIds2 = decodeMaskObjectIds(game, condition.filter2);
        out.aggregate2 = condition.aggr2;
        program.winConditions.push_back(std::move(out));
    }
```

- [ ] **Step 4: Add the shared int-array helper, route emission through it, and serialize win conditions**

In `native/src/compiler/semantic_program.cpp`, add `appendIntArray` to the anonymous namespace (right after `appendJsonString`):

```cpp
void appendIntArray(std::string& out, const std::vector<int32_t>& values) {
    out += '[';
    for (size_t i = 0; i < values.size(); ++i) {
        if (i != 0) {
            out += ',';
        }
        out += std::to_string(values[i]);
    }
    out += ']';
}
```

Route the three existing int-array emitters through it (retires the prior audit note that this pattern was copied three times):

- In `appendLegendArray`, replace the `object_ids` inner loop body — change:
  ```cpp
        out += ",\"object_ids\":[";
        for (size_t j = 0; j < legends[i].objectIds.size(); ++j) {
            if (j != 0) {
                out += ',';
            }
            out += std::to_string(legends[i].objectIds[j]);
        }
        out += "]}";
  ```
  to:
  ```cpp
        out += ",\"object_ids\":";
        appendIntArray(out, legends[i].objectIds);
        out += "}";
  ```

- In `appendLevelArray`, replace the per-cell inner loop — change:
  ```cpp
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
  ```
  to:
  ```cpp
        for (size_t c = 0; c < level.cells.size(); ++c) {
            if (c != 0) {
                out += ',';
            }
            appendIntArray(out, level.cells[c]);
        }
  ```

- In `serializeSemanticProgramJson`, replace the inline `collision_layers` element loop — change:
  ```cpp
        out += '[';
        const auto& layer = program.collisionLayers[i];
        for (size_t j = 0; j < layer.size(); ++j) {
            if (j != 0) {
                out += ',';
            }
            out += std::to_string(layer[j]);
        }
        out += ']';
  ```
  to:
  ```cpp
        appendIntArray(out, program.collisionLayers[i]);
  ```

Add the win-condition serializer in the anonymous namespace:

```cpp
void appendWinConditionArray(std::string& out, const std::vector<SemanticWinCondition>& conditions) {
    out += '[';
    for (size_t i = 0; i < conditions.size(); ++i) {
        if (i != 0) {
            out += ',';
        }
        const auto& condition = conditions[i];
        out += "{\"quantifier\":";
        out += std::to_string(condition.quantifier);
        out += ",\"object_ids_1\":";
        appendIntArray(out, condition.objectIds1);
        out += ",\"aggregate_1\":";
        out += condition.aggregate1 ? "true" : "false";
        out += ",\"object_ids_2\":";
        appendIntArray(out, condition.objectIds2);
        out += ",\"aggregate_2\":";
        out += condition.aggregate2 ? "true" : "false";
        out += '}';
    }
    out += ']';
}
```

Then emit it in `serializeSemanticProgramJson`. Replace:

```cpp
    out += "},\"levels\":";
    appendLevelArray(out, program.levels);
    out += "}}";
    return out;
```

with:

```cpp
    out += "},\"levels\":";
    appendLevelArray(out, program.levels);
    out += ",\"win_conditions\":";
    appendWinConditionArray(out, program.winConditions);
    out += "}}";
    return out;
```

- [ ] **Step 5: Build and run the unit test (green)**

Run:
```bash
cmake --build build --target compiler_semantic_program -j
ctest --test-dir build -R '^compiler_semantic_program$' --output-on-failure
```
Expected: `Passed`. (Building before Step 2 fails to compile — `SemanticWinCondition`/`program.winConditions` undefined — the red state.) The int-array refactor changes no output, so the unit test's existing legend/level assertions must still pass.

- [ ] **Step 6: Resolve win conditions on the JS side**

In `src/tests/js_oracle/lib/puzzlescript_semantic_program.js`, add `winConditionList` above `buildSemanticProgramSnapshot`:

```js
function winConditionList(state) {
    function decodeMask(mask, objectCount) {
        const ids = [];
        if (mask && mask.data) {
            for (let id = 0; id < objectCount; id++) {
                if ((mask.data[id >> 5] & (1 << (id & 31))) !== 0) {
                    ids.push(id);
                }
            }
        }
        return ids;
    }
    const objectCount = state.idDict.length;
    return state.winconditions.map(function (condition) {
        return {
            quantifier: condition[0],
            object_ids_1: decodeMask(condition[1], objectCount),
            aggregate_1: condition[4],
            object_ids_2: decodeMask(condition[2], objectCount),
            aggregate_2: condition[5],
        };
    });
}
```

Then extend the snapshot. Change:

```js
    const levels = levelList(state);

    return {
        schema_version: 1,
        semantic_program: { objects, collision_layers, legends, levels },
    };
```

to:

```js
    const levels = levelList(state);
    const win_conditions = winConditionList(state);

    return {
        schema_version: 1,
        semantic_program: { objects, collision_layers, legends, levels, win_conditions },
    };
```

- [ ] **Step 7: Validate JS↔C++ win-condition parity over the corpus**

Run:
```bash
cmake --build build --target puzzlescript_cpp -j
bash scripts/diff_semantic_program_against_js.sh src/demo/sokoban_basic.txt; echo "sokoban exit=$?"
node src/tests/semantic_program_parity_corpus_node.js build/native/puzzlescript_cpp src/tests/solver_tests
```
Expected: sokoban `exit=0`, and the corpus runner still reports `conforming + parity-matched: 161` with `parity failures: 0` — now including `win_conditions`.

If a conforming game reports a parity failure, triage as in prior slices. Likely sources: (a) the aggregate flag classification (`aggr1`/`aggr2`) differing between the C++ lowerer and JS `lookupWinConditionMask` for the same term, or (b) the `"\nall\n"` default filter2 resolving differently. Inspect `win_conditions` in both outputs; classify as emitter bug vs real compiler divergence vs new invariant. Do not loosen the gate.

- [ ] **Step 8: Run the full semantic test set and commit**

Run:
```bash
ctest --test-dir build -R 'semantic_program' --output-on-failure
```
Expected: all four semantic_program tests pass. Then:

```bash
git add native/src/compiler/types/semantic_program.hpp native/src/compiler/semantic_program.cpp native/tests/compiler_semantic_program.cpp src/tests/js_oracle/lib/puzzlescript_semantic_program.js
git commit -m "feat(native): resolve win conditions in SemanticProgram contract (slice 4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Subsequent slices (roadmap, not part of this plan)

- **Slice 5 — metadata + sounds:** `Game::metadata` / `sfxEvents` vs JS `state.metadata` / sound seeds. Mostly string/number key-value parity; no mask decode.
- **Rules (much later):** deferred until a semantic rule representation exists; the lowered `Rule` is far below the contract's altitude and needs its own design.

---

## Self-Review

**Spec coverage:** The design doc lists "win conditions" among what `SemanticProgram` resolves. Task 1 adds them as quantifier + resolved filter id-sets + aggregate flags, gated JS↔C++ by the existing corpus harness. Metadata/rules remain scoped out (roadmap).

**Placeholder scan:** No TBD/TODO placeholders; every code step is complete and every command states expected output. Step 7's triage branch is the proven empirical-validation procedure, not a placeholder.

**Type/name consistency:** `SemanticWinCondition { quantifier; objectIds1; aggregate1; objectIds2; aggregate2 }` (Step 2) is populated in `buildSemanticProgram` (Step 3), serialized by `appendWinConditionArray` under keys `quantifier`/`object_ids_1`/`aggregate_1`/`object_ids_2`/`aggregate_2` (Step 4), matched field-for-field by JS `winConditionList` reading `condition[0,1,2,4,5]` (Step 6), and asserted via `program.winConditions` (Step 1). The quantifier is emitted as the raw int (`-1`/`0`/`1`) that both engines already store, so there is no string-mapping divergence risk. Win conditions are emitted in source order on both sides (no sort).

**Risk notes:**
- The only classification that could diverge is `aggregate1`/`aggregate2` (whether a filter term is an aggregate) — the same kind of synonym/aggregate/property classification that slice 2 already proved parity-clean across 124 aggregate-bearing games, so this is low risk; the corpus gate confirms.
- The default `filter2` (`"\nall\n"`) decodes to the full object-id set on both sides, so `object_ids_2` is large for `on`-less conditions but consistent; verified that JS registers `objectMasks["\nall\n"]` as the all-objects mask matching the C++ `allObjectsMask`.
- The `appendIntArray` refactor changes no serialized bytes (same `[a,b,c]` form); the unit test's legend/level assertions and the corpus gate (179k cells, all legends) guard it.
