# SemanticProgram Contract (Slice 2: Resolved Legends) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `SemanticProgram` contract with resolved legends — every synonym, aggregate, and property legend resolved to its sorted set of base object ids — on both the C++ projection and the JS shape, validated by the existing corpus parity gate.

**Architecture:** Additive extension of the slice-1 contract (objects + collision layers). The C++ producer decodes the already-lowered legend mask tables (`synonymMaskTable` / `aggregateMaskTable` / `propertyMaskTable`) into id sets — the same decode the runtime C API's `ps_game_legend_object_ids` uses. The JS shape recursively resolves `state.synonymsDict` / `aggregatesDict` / `propertiesDict` to base object ids. The corpus gate from slice 1 (`semantic_program_parity_corpus_node.js`) automatically covers the new field, so the empirical JS↔C++ check comes for free. No lowerer changes; the engine is untouched.

**Tech Stack:** C++17 (`puzzlescript_compiler`), Node.js (JS oracle), CMake/CTest.

**Scope.** Slice 2 adds only legends. Each legend is `{ name, object_ids }` where `object_ids` is the sorted set of base object ids the legend covers (the union mask — identical for synonyms, aggregates, and properties; kind is preserved by which of the three arrays it lands in). **Deferred to later slices on the same contract:** levels, win conditions, metadata, sounds, rules.

**Prerequisite facts (verified against the tree at plan time):**
- C++ legend tables live on `Game` (`native/src/runtime/core.hpp`): `synonymMaskTable`, `aggregateMaskTable`, `propertyMaskTable`, each `std::vector<Game::NamedMaskEntry>` where `NamedMaskEntry { std::string name; MaskOffset offset; }`, sorted by name at load. The mask at `offset` (width `game.wordCount`) holds the legend's object-id bits.
- The runtime decode pattern (`writeObjectIdsFromMask`, `native/src/runtime/c_api.cpp`) iterates `objectId` `0..game.objectCount`, testing `mask[maskWordIndex(objectId)] & maskBit(objectId)`, yielding **ascending** ids. The slice-2 builder mirrors this.
- JS resolved legend dicts (`src/js/compiler.js`, after `resolveDictionaryCrossReferences`): `state.synonymsDict` (name→name), `state.aggregatesDict` (name→[names]), `state.propertiesDict` (name→[names]). A JS synonym whose target is an aggregate/property is folded into that dict, so the three dicts' key sets mirror the three C++ tables.
- Ground-truth fixture: sokoban_basic has `synonymsDict = {".":"background","#":"wall","p":"player","*":"crate","o":"target"}`, `aggregatesDict = {"@":["crate","target"]}`, `propertiesDict = {}`, with `idDict = [background(0), target(1), player(2), wall(3), crate(4)]`. So the `@` aggregate must resolve to `[1,4]` (target, crate) on both sides.
- `buildSemanticProgram` already decodes masks elsewhere via `puzzlescript::maskWordIndex` / `maskBit` / `MaskWord` / `MaskOffset` / `kNullMaskOffset` (all in `runtime/core.hpp`, included transitively).
- The corpus gate (`semantic_program_parity_corpus_node.js`) canonicalizes both snapshots and compares all fields, so adding `legends` to both emitters is automatically gated over the 161 conforming games.

---

## File Structure

- **Modify** `native/src/compiler/types/semantic_program.hpp` — add `SemanticLegend` struct and three `std::vector<SemanticLegend>` fields.
- **Modify** `native/src/compiler/semantic_program.cpp` — decode legend masks in `buildSemanticProgram`; emit `legends` in the serializer.
- **Modify** `src/tests/js_oracle/lib/puzzlescript_semantic_program.js` — recursive legend resolver; emit `legends` in the snapshot.
- **Modify** `native/tests/compiler_semantic_program.cpp` — assert resolved legends (the `@` aggregate → `{target, crate}`).

---

## Task 1: Resolved legends

**Files:**
- Modify: `native/src/compiler/types/semantic_program.hpp`
- Modify: `native/src/compiler/semantic_program.cpp`
- Modify: `native/tests/compiler_semantic_program.cpp`
- Modify: `src/tests/js_oracle/lib/puzzlescript_semantic_program.js`

- [ ] **Step 1: Extend the unit test with legend assertions (red)**

In `native/tests/compiler_semantic_program.cpp`, after the existing collision-layer assertions (before the `const std::string json = ...` line), add:

```cpp
    // Resolved legends: sokoban has 5 synonyms and the aggregate "@" = Crate and
    // Target. Each legend resolves to a sorted set of base object ids; "@" must
    // resolve to {target, crate} on both the C++ and JS sides.
    assert(program.synonyms.size() == 5);
    assert(program.properties.empty());

    int32_t crateId = -1;
    int32_t targetId = -1;
    for (const auto& object : program.objects) {
        if (object.name == "crate") crateId = object.id;
        if (object.name == "target") targetId = object.id;
    }
    assert(crateId >= 0 && targetId >= 0);

    const puzzlescript::compiler::SemanticLegend* atLegend = nullptr;
    for (const auto& legend : program.aggregates) {
        if (legend.name == "@") atLegend = &legend;
    }
    assert(atLegend != nullptr);
    const std::vector<int32_t> expectedAt{
        std::min(crateId, targetId),
        std::max(crateId, targetId),
    };
    assert(atLegend->objectIds == expectedAt);
```

Add `#include <algorithm>` (for `std::min`/`std::max`) and `#include <vector>` to the test's includes if not already present.

- [ ] **Step 2: Add the SemanticLegend struct + contract fields**

In `native/src/compiler/types/semantic_program.hpp`, add `SemanticLegend` after `SemanticObject`:

```cpp
struct SemanticLegend {
    std::string name;
    std::vector<int32_t> objectIds;  // base object ids, sorted ascending
};
```

and add three fields to `SemanticProgram` (after `collisionLayers`):

```cpp
    std::vector<SemanticLegend> synonyms;    // sorted by name
    std::vector<SemanticLegend> aggregates;  // sorted by name
    std::vector<SemanticLegend> properties;  // sorted by name
```

- [ ] **Step 3: Decode legend masks in the builder**

In `native/src/compiler/semantic_program.cpp`, inside the anonymous namespace (next to `appendJsonString`), add the mask decoder and a table-to-legends helper:

```cpp
std::vector<int32_t> decodeMaskObjectIds(const puzzlescript::Game& game, puzzlescript::MaskOffset offset) {
    std::vector<int32_t> ids;
    if (offset == puzzlescript::kNullMaskOffset) {
        return ids;
    }
    const size_t base = static_cast<size_t>(offset);
    const size_t wordCount = static_cast<size_t>(game.wordCount);
    if (base > game.maskArena.size() || wordCount > game.maskArena.size() - base) {
        return ids;
    }
    const puzzlescript::MaskWord* mask = game.maskArena.data() + base;
    for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
        const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(objectId));
        if (word >= game.wordCount) {
            continue;
        }
        if ((mask[word] & puzzlescript::maskBit(static_cast<uint32_t>(objectId))) != 0) {
            ids.push_back(objectId);  // ascending by construction
        }
    }
    return ids;
}

std::vector<SemanticLegend> buildLegends(
    const puzzlescript::Game& game,
    const std::vector<puzzlescript::Game::NamedMaskEntry>& table
) {
    std::vector<SemanticLegend> legends;
    legends.reserve(table.size());
    for (const auto& entry : table) {
        legends.push_back(SemanticLegend{entry.name, decodeMaskObjectIds(game, entry.offset)});
    }
    std::sort(legends.begin(), legends.end(),
              [](const SemanticLegend& a, const SemanticLegend& b) { return a.name < b.name; });
    return legends;
}
```

Then in `buildSemanticProgram`, after the `collisionLayers` loop and before `return program;`, add:

```cpp
    program.synonyms = buildLegends(game, game.synonymMaskTable);
    program.aggregates = buildLegends(game, game.aggregateMaskTable);
    program.properties = buildLegends(game, game.propertyMaskTable);
```

- [ ] **Step 4: Emit legends in the serializer**

In `native/src/compiler/semantic_program.cpp`, add a legend-array serializer in the anonymous namespace:

```cpp
void appendLegendArray(std::string& out, const std::vector<SemanticLegend>& legends) {
    out += '[';
    for (size_t i = 0; i < legends.size(); ++i) {
        if (i != 0) {
            out += ',';
        }
        out += "{\"name\":";
        appendJsonString(out, legends[i].name);
        out += ",\"object_ids\":[";
        for (size_t j = 0; j < legends[i].objectIds.size(); ++j) {
            if (j != 0) {
                out += ',';
            }
            out += std::to_string(legends[i].objectIds[j]);
        }
        out += "]}";
    }
    out += ']';
}
```

Then change the end of `serializeSemanticProgramJson`. Replace:

```cpp
    out += "]}}";
    return out;
```

with:

```cpp
    out += "],\"legends\":{\"synonyms\":";
    appendLegendArray(out, program.synonyms);
    out += ",\"aggregates\":";
    appendLegendArray(out, program.aggregates);
    out += ",\"properties\":";
    appendLegendArray(out, program.properties);
    out += "}}}";
    return out;
```

- [ ] **Step 5: Build and run the unit test (green)**

Run:
```bash
cmake --build build --target compiler_semantic_program -j
ctest --test-dir build -R '^compiler_semantic_program$' --output-on-failure
```
Expected: `Passed`. (If you build before Step 2, the test fails to compile — `SemanticLegend`/`program.aggregates` undefined — which is the red state.)

- [ ] **Step 6: Resolve legends on the JS side**

In `src/tests/js_oracle/lib/puzzlescript_semantic_program.js`, add a recursive resolver and emit legends. Add these helpers above `buildSemanticProgramSnapshot`:

```js
function resolveLegendObjectIds(state, nameToId, name, visiting) {
    if (name in nameToId) {
        return [nameToId[name]];
    }
    if (visiting.has(name)) {
        return [];
    }
    visiting.add(name);
    let ids = [];
    if (state.synonymsDict && name in state.synonymsDict) {
        ids = ids.concat(resolveLegendObjectIds(state, nameToId, state.synonymsDict[name], visiting));
    } else if (state.aggregatesDict && name in state.aggregatesDict) {
        for (const member of state.aggregatesDict[name]) {
            ids = ids.concat(resolveLegendObjectIds(state, nameToId, member, visiting));
        }
    } else if (state.propertiesDict && name in state.propertiesDict) {
        for (const member of state.propertiesDict[name]) {
            ids = ids.concat(resolveLegendObjectIds(state, nameToId, member, visiting));
        }
    }
    visiting.delete(name);
    return Array.from(new Set(ids)).sort((a, b) => a - b);
}

function legendList(state, nameToId, dict) {
    return Object.keys(dict || {})
        .map(function (name) {
            return { name: name, object_ids: resolveLegendObjectIds(state, nameToId, name, new Set()) };
        })
        .sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
}
```

Then extend the returned snapshot. Change:

```js
    return {
        schema_version: 1,
        semantic_program: { objects, collision_layers },
    };
```

to:

```js
    const legends = {
        synonyms: legendList(state, nameToId, state.synonymsDict),
        aggregates: legendList(state, nameToId, state.aggregatesDict),
        properties: legendList(state, nameToId, state.propertiesDict),
    };

    return {
        schema_version: 1,
        semantic_program: { objects, collision_layers, legends },
    };
```

- [ ] **Step 7: Validate JS↔C++ legend parity over the corpus**

Run:
```bash
cmake --build build --target puzzlescript_cpp -j
bash scripts/diff_semantic_program_against_js.sh src/demo/sokoban_basic.txt; echo "sokoban exit=$?"
node src/tests/semantic_program_parity_corpus_node.js build/native/puzzlescript_cpp src/tests/solver_tests
```
Expected: sokoban `exit=0`, and the corpus runner still reports `conforming + parity-matched: 161` with `parity failures: 0` — now including the `legends` field. The 23 non-conforming games stay skipped (legends don't change the single-layer invariant).

If a conforming game now reports a parity failure, triage it the way slice 1's id divergence was handled — inspect the game's `legends` in both outputs:
```bash
node src/tests/js_oracle/export_ir_json.js "<game>" /tmp/js.json --snapshot-phase semantic
build/native/puzzlescript_cpp compile "<game>" --emit-semantic-program > /tmp/cpp.json
```
and classify the difference as (a) an emitter bug (resolver vs mask decode disagree on the same legend — fix the emitter), (b) a real JS↔C++ compiler divergence the contract correctly surfaced (record it), or (c) a new invariant to mandate at the test layer. Do not loosen the gate to make it pass.

- [ ] **Step 8: Run the full semantic test set and commit**

Run:
```bash
ctest --test-dir build -R 'semantic_program' --output-on-failure
```
Expected: all four semantic_program tests pass. Then:

```bash
git add native/src/compiler/types/semantic_program.hpp native/src/compiler/semantic_program.cpp native/tests/compiler_semantic_program.cpp src/tests/js_oracle/lib/puzzlescript_semantic_program.js
git commit -m "feat(native): resolve legends in SemanticProgram contract (slice 2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Subsequent slices (roadmap, not part of this plan)

Each follows the identical proven pattern — extend the C++ struct + builder + serializer, extend the JS snapshot, and the corpus gate covers it automatically. Plan and land them one at a time:

- **Slice 3 — levels:** per-level resolved object-id grid + dimensions + message flag (`Game::levels` / `LevelTemplate` vs JS `state.levels`). The grid representation difference (C++ bitmask board vs JS per-cell) is the research point.
- **Slice 4 — win conditions:** resolved win conditions (`Game::winConditions` vs JS `state.winconditions`), each as quantifier + resolved object-id operands.
- **Slice 5 — metadata + sounds:** `Game::metadata` / `sfxEvents` vs JS `state.metadata` / sound seeds.
- **Rules (much later):** deferred until a semantic rule representation exists; the lowered `Rule` is far below the contract's altitude and needs its own design.

---

## Self-Review

**Spec coverage:** The design doc lists "legends, properties, aggregates" among what `SemanticProgram` resolves. Task 1 adds all three as resolved object-id sets, gated JS↔C++ by the existing corpus harness. Levels/win-conditions/metadata/rules remain explicitly scoped out (roadmap above), consistent with the writing-plans rule that each plan be a self-contained, testable unit.

**Placeholder scan:** No TBD/TODO placeholders. Every code step ships complete code; commands state expected output. Step 7's triage branch is a deliberate empirical-validation procedure (mirroring how slice 1's divergence was handled), not a placeholder — the expected path is a clean pass, and the branch documents what to do if the contract surfaces real drift.

**Type/name consistency:** `SemanticLegend { name; objectIds }` (Step 2) is populated by `buildLegends`/`decodeMaskObjectIds` (Step 3), serialized by `appendLegendArray` under JSON keys `legends.{synonyms,aggregates,properties}` with `{name, object_ids}` (Step 4), matched field-for-field by the JS `legendList`/`resolveLegendObjectIds` emitting the same keys (Step 6), and asserted via `program.aggregates` / `program.synonyms` / `program.properties` (Step 1). The canonicalizing corpus diff means the C++ compact JSON and JS pretty JSON need not match byte-for-byte — only resolved content.

**Risk notes:**
- The JS resolver re-derives id sets from the dicts while C++ decodes the lowered mask; these should agree (both = union of base object ids), but Step 7's corpus run is the real validator. The most likely divergence source is synonym/aggregate/property *kind classification* (which of the three arrays a legend lands in) if the C++ lowerer folds synonyms-of-aggregates differently than JS — Step 7 will surface it as a name appearing in different arrays.
- `decodeMaskObjectIds` mirrors `writeObjectIdsFromMask` exactly (ascending ids, same bounds checks), so the C++ id ordering matches the runtime C API and needs no separate sort.
