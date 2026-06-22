# SemanticProgram Sounds — Object/Movement SFX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the `sounds` contract with the object/movement-keyed sfx — `creation`, `destruction`, `movement`, and `movement_failure` masks — each resolved to object ids (+ direction names + layer for movement), finishing the resolved game model.

**Architecture:** Projects the lowered `Game`'s `sfxCreationMasks`/`sfxDestructionMasks`/`sfxMovementMasks`/`sfxMovementFailureMasks` into the `SemanticSounds` struct, reusing the existing `decodeMaskObjectIds` for object masks and adding a small direction-mask decoder. The JS oracle decodes the corresponding `state.sfx_*Masks` BitVecs. Same projection pattern and corpus gate as every prior slice. The runtime `Game` is untouched.

**Tech Stack:** C++17 (`puzzlescript_compiler`), Node.js (JS oracle), CMake/CTest.

**Prerequisite facts (verified against the tree):**
- C++ (`native/src/runtime/core.hpp`): `SoundMaskEntry { MaskOffset objectMask; MaskOffset directionMask; uint32_t directionMaskWidth; int32_t seed; }`. `Game` holds `std::vector<SoundMaskEntry> sfxCreationMasks; sfxDestructionMasks; std::vector<std::vector<SoundMaskEntry>> sfxMovementMasks; std::vector<SoundMaskEntry> sfxMovementFailureMasks;`. Creation/destruction entries have a null `directionMask`.
- Direction bit layout (`native/src/compiler/lower_to_runtime.cpp` `soundDirectionMask`): `up=1, down=2, left=4, right=8, ___action____=16` — i.e. within a layer's 5-bit movement slot, bit0=up, bit1=down, bit2=left, bit3=right, bit4=action. The movement `directionMask` is shifted by `5 * layer` (`shiftedDirectionMask.ishiftor(directionMask, 5*targetLayer)` in `compiler.js`).
- JS (`src/js/compiler.js`): `state.sfx_CreationMasks`/`sfx_DestructionMasks` entries are `{ objectMask: BitVec, seed }`; `state.sfx_MovementMasks` is per-layer (`collisionLayers.map(()=>[])`), entries `{ objectMask, directionMask (shifted), layer, seed }`; `state.sfx_MovementFailureMasks` is flat with the same entry shape.
- `decodeMaskObjectIds(game, offset)` (`native/src/compiler/semantic_program.cpp`) decodes an object mask to ascending ids; `appendIntArray`/`appendJsonString` exist.
- The corpus gate `semantic_program_parity_corpus_node.js` auto-covers new `sounds` sub-fields.

---

## File Structure

- **Modify** `native/src/compiler/types/semantic_program.hpp` — add `SemanticSfxEntry`; extend `SemanticSounds`.
- **Modify** `native/src/compiler/semantic_program.cpp` — decode the four sfx categories; serialize them under `sounds`.
- **Modify** `src/tests/js_oracle/lib/puzzlescript_semantic_program.js` — emit the four sfx categories.
- **Modify** `native/tests/compiler_semantic_program.cpp` — assert an explicit creation+movement sfx fixture.

---

## Task 1: Resolved object/movement sfx

**Files:**
- Modify: `native/src/compiler/types/semantic_program.hpp`
- Modify: `native/src/compiler/semantic_program.cpp`
- Modify: `native/tests/compiler_semantic_program.cpp`
- Modify: `src/tests/js_oracle/lib/puzzlescript_semantic_program.js`

- [ ] **Step 1: Extend the contract types**

In `native/src/compiler/types/semantic_program.hpp`, add `SemanticSfxEntry` above `SemanticSounds`, and extend `SemanticSounds`:

```cpp
struct SemanticSfxEntry {
    std::vector<int32_t> objectIds;        // sorted ascending
    std::vector<std::string> directions;   // sorted; movement/movement_failure only, else empty
    int32_t layer = -1;                    // movement/movement_failure target layer; -1 otherwise
    int32_t seed = 0;
};

struct SemanticSounds {
    std::map<std::string, int32_t> events;  // name -> seed
    std::vector<SemanticSfxEntry> creation;
    std::vector<SemanticSfxEntry> destruction;
    std::vector<SemanticSfxEntry> movement;          // flattened layer-then-source order
    std::vector<SemanticSfxEntry> movementFailure;
};
```

- [ ] **Step 2: Decode the sfx masks (C++)**

In `native/src/compiler/semantic_program.cpp`, add a direction decoder in the anonymous namespace. The movement `directionMask` is shifted by `5*layer`; extract the 5 bits at that slot and map to names:

```cpp
std::vector<std::string> decodeSfxDirections(
    const puzzlescript::Game& game, puzzlescript::MaskOffset offset, uint32_t width, int32_t layer) {
    std::vector<std::string> dirs;
    if (offset == puzzlescript::kNullMaskOffset || layer < 0) {
        return dirs;
    }
    const size_t base = static_cast<size_t>(offset);
    if (base + width > game.maskArena.size()) {
        return dirs;
    }
    const puzzlescript::MaskWord* mask = game.maskArena.data() + base;
    static const char* kNames[5] = {"up", "down", "left", "right", "action"};
    for (int32_t k = 0; k < 5; ++k) {
        const uint32_t bit = static_cast<uint32_t>(5 * layer + k);
        const uint32_t word = puzzlescript::maskWordIndex(bit);
        if (word >= width) {
            continue;
        }
        if ((mask[word] & puzzlescript::maskBit(bit)) != 0) {
            dirs.push_back(kNames[k]);
        }
    }
    return dirs;
}

SemanticSfxEntry toSfxEntry(const puzzlescript::Game& game, const puzzlescript::SoundMaskEntry& e, int32_t layer) {
    SemanticSfxEntry out;
    out.objectIds = decodeMaskObjectIds(game, e.objectMask);
    out.layer = layer;
    out.seed = e.seed;
    if (layer >= 0) {
        out.directions = decodeSfxDirections(game, e.directionMask, e.directionMaskWidth, layer);
    }
    return out;
}
```

In `buildSemanticProgram`, after `program.sounds.events = game.sfxEvents;`:

```cpp
    for (const auto& e : game.sfxCreationMasks) {
        program.sounds.creation.push_back(toSfxEntry(game, e, -1));
    }
    for (const auto& e : game.sfxDestructionMasks) {
        program.sounds.destruction.push_back(toSfxEntry(game, e, -1));
    }
    for (int32_t layer = 0; layer < static_cast<int32_t>(game.sfxMovementMasks.size()); ++layer) {
        for (const auto& e : game.sfxMovementMasks[static_cast<size_t>(layer)]) {
            program.sounds.movement.push_back(toSfxEntry(game, e, layer));
        }
    }
    for (const auto& e : game.sfxMovementFailureMasks) {
        // movement-failure entries carry their own layer via the directionMask shift;
        // the JS side stores `layer` on the entry — read it from the lowered entry's
        // associated layer if available, else decode the highest set 5-bit slot.
        program.sounds.movementFailure.push_back(toSfxEntry(game, e, /*layer from entry*/ -1));
    }
```

> Implementation note: `sfxMovementFailureMasks` is flat in C++ but each JS entry carries a `layer`. Confirm where the layer is recoverable on the C++ side (the lowered entry, or by `directionMask` bit position `/5`). If the C++ `SoundMaskEntry` for movement-failure does not retain the layer, derive it from the lowest set bit of `directionMask` (`bitPosition / 5`). The corpus gate (Step 6) arbitrates.

- [ ] **Step 3: Serialize the sfx categories (C++)**

In `native/src/compiler/semantic_program.cpp`, add an entry-array serializer in the anonymous namespace:

```cpp
void appendSfxArray(std::string& out, const std::vector<SemanticSfxEntry>& entries) {
    out += '[';
    for (size_t i = 0; i < entries.size(); ++i) {
        if (i != 0) {
            out += ',';
        }
        const auto& e = entries[i];
        out += "{\"object_ids\":";
        appendIntArray(out, e.objectIds);
        out += ",\"directions\":[";
        for (size_t d = 0; d < e.directions.size(); ++d) {
            if (d != 0) {
                out += ',';
            }
            appendJsonString(out, e.directions[d]);
        }
        out += "],\"layer\":";
        out += std::to_string(e.layer);
        out += ",\"seed\":";
        out += std::to_string(e.seed);
        out += "}";
    }
    out += ']';
}
```

In `serializeSemanticProgramJson`, extend the `sounds` object (currently `"sounds":{"events":...}`):

```cpp
    out += ",\"sounds\":{\"events\":";
    appendSoundEventsObject(out, program.sounds.events);
    out += ",\"creation\":";
    appendSfxArray(out, program.sounds.creation);
    out += ",\"destruction\":";
    appendSfxArray(out, program.sounds.destruction);
    out += ",\"movement\":";
    appendSfxArray(out, program.sounds.movement);
    out += ",\"movement_failure\":";
    appendSfxArray(out, program.sounds.movementFailure);
    out += "}";
```

(Adjust the surrounding braces so `sounds` closes before `,"rules":`.)

- [ ] **Step 4: Assert an explicit sfx fixture (C++)**

In `native/tests/compiler_semantic_program.cpp`, sokoban has no sounds (`program.sounds.creation.empty()` etc.). Add, alongside the inline sound-events fixture, a fixture with a creation and a directional movement sound (verify it compiles via `--emit-semantic-program` first):

```cpp
    {
        const std::string sfxSource =
            "title T\n\n========\nOBJECTS\n========\n\n"
            "Background\nblack\n\nPlayer\nblue\n\nCrate\nbrown\n\n"
            "=======\nLEGEND\n=======\n\n. = Background\nP = Player\n* = Crate\n\n"
            "=======\nSOUNDS\n=======\n\nCrate create 11111111\nPlayer move up 22222222\n\n"
            "================\nCOLLISIONLAYERS\n================\n\nBackground\nPlayer, Crate\n\n"
            "======\nRULES\n======\n\n==============\nWINCONDITIONS\n==============\n\n"
            "=======\nLEVELS\n=======\n\nP*\n";
        puzzlescript::compiler::DiagnosticSink d;
        const auto st = puzzlescript::compiler::parseSource(sfxSource, d);
        puzzlescript::LoadedGame g;
        assert(!puzzlescript::compiler::lowerToRuntimeGame(st, g));
        assert(g.information);
        const auto p = puzzlescript::compiler::buildSemanticProgram(*g.information);
        assert(p.sounds.creation.size() == 1 && p.sounds.creation[0].seed == 11111111);
        assert(p.sounds.creation[0].objectIds.size() == 1);   // crate
        assert(p.sounds.creation[0].directions.empty() && p.sounds.creation[0].layer == -1);
        assert(p.sounds.movement.size() == 1 && p.sounds.movement[0].seed == 22222222);
        assert(p.sounds.movement[0].objectIds.size() == 1);   // player
        assert((p.sounds.movement[0].directions == std::vector<std::string>{"up"}));
        assert(p.sounds.movement[0].layer >= 0);
    }
```

Add JSON-shape assertions with the others: `assert(json.find("\"creation\"") != std::string::npos);` and `assert(json.find("\"movement\"") != std::string::npos);`.

- [ ] **Step 5: Emit the sfx categories (JS)**

In `src/tests/js_oracle/lib/puzzlescript_semantic_program.js`, extend the `sounds` object. Decode each entry's `objectMask` BitVec to ids and the `directionMask` to names (the 5-bit slot at `5*layer`):

```js
    function decodeBitVec(mask, count) {
        const ids = [];
        if (mask && mask.data) {
            for (let id = 0; id < count; id++) {
                if ((mask.data[id >> 5] & (1 << (id & 31))) !== 0) ids.push(id);
            }
        }
        return ids;
    }
    function sfxEntry(e) {
        const names = ['up', 'down', 'left', 'right', 'action'];
        const dirs = [];
        const layer = (e.layer === undefined) ? -1 : e.layer;
        if (layer >= 0 && e.directionMask && e.directionMask.data) {
            for (let k = 0; k < 5; k++) {
                const bit = 5 * layer + k;
                if ((e.directionMask.data[bit >> 5] & (1 << (bit & 31))) !== 0) dirs.push(names[k]);
            }
        }
        return {
            object_ids: decodeBitVec(e.objectMask, state.idDict.length),
            directions: dirs,
            layer: layer,
            seed: e.seed,
        };
    }
    const sounds = {
        events: soundEvents,
        creation: (state.sfx_CreationMasks || []).map(sfxEntry),
        destruction: (state.sfx_DestructionMasks || []).map(sfxEntry),
        movement: (state.sfx_MovementMasks || []).reduce(function (acc, layerList) {
            return acc.concat(layerList.map(sfxEntry));
        }, []),
        movement_failure: (state.sfx_MovementFailureMasks || []).map(sfxEntry),
    };
```

(Replace the existing `const sounds = { events: soundEvents };`.)

- [ ] **Step 6: Build, test, and gate**

```bash
cmake -S . -B build
cmake --build build --target puzzlescript_cpp compiler_semantic_program -j
ctest --test-dir build -R 'semantic_program' --output-on-failure
node src/tests/semantic_program_parity_corpus_node.js build/native/puzzlescript_cpp src/tests/solver_tests
```
Expected: `Passed`, and the corpus runner `conforming + parity-matched: 161` / `parity failures: 0` now including all four sfx categories. Triage any failure by inspecting `sounds.creation/movement/...` in both outputs; the likely points are the movement-failure layer recovery (Step 2 note) and the direction-bit slot mapping. Do not loosen the gate.

- [ ] **Step 7: Commit**

```bash
git add native/src/compiler/types/semantic_program.hpp native/src/compiler/semantic_program.cpp native/tests/compiler_semantic_program.cpp src/tests/js_oracle/lib/puzzlescript_semantic_program.js
git commit -m "feat(native): resolve object/movement sfx in SemanticProgram contract

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** Completes the sounds half deferred from the sound-events slice — creation/destruction (object ids + seed) and movement/movement-failure (object ids + direction names + layer + seed). With this, the resolved game model is fully parity-gated.

**Placeholder scan:** Complete code throughout. The one implementation note (movement-failure layer recovery, Task 1 Step 2) is a confirm-against-the-code point with a concrete fallback (`bitPosition/5`), arbitrated by the corpus gate — the proven pattern from the rules slices, not a vague requirement.

**Type consistency:** `SemanticSfxEntry { objectIds; directions; layer; seed }` is built by `toSfxEntry`/`decodeSfxDirections`, serialized by `appendSfxArray` under `object_ids`/`directions`/`layer`/`seed`, matched by the JS `sfxEntry`. Direction names use the same 5-name `{up,down,left,right,action}` slot order on both sides, derived from the C++ `soundDirectionMask` bit values.

**Risk note:** The only nontrivial parity surface is the direction-mask slot decode (the `directionMaskWidth` quirk + the `5*layer` shift) and the movement-failure layer. Both are flagged and gate-arbitrated. Object-mask and seed parity reuse already-proven machinery (`decodeMaskObjectIds`, the sound-events int seeds).
