# SemanticProgram Contract (Slice 6: Sound Events) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `SemanticProgram` contract with resolved global sound events — the `sfx0..9` / lifecycle (`startgame`, `endlevel`, `undo`, …) event→seed map — on both the C++ projection and the JS shape, validated by the existing corpus parity gate.

**Architecture:** Additive extension of the slice-1..5 contract, structurally identical to metadata. The C++ producer copies `Game::sfxEvents` (already a `std::map<std::string,int32_t>`); the JS shape copies `state.sfx_Events`, normalizing its string seed values to integers. Emitted as a nested `sounds.events` JSON object so the canonicalizing diff handles key order, and so later slices can add object/movement-keyed sfx under the same `sounds` key. No lowerer changes; the engine is untouched.

**Tech Stack:** C++17 (`puzzlescript_compiler`), Node.js (JS oracle), CMake/CTest.

**Scope.** Slice 6 adds only the global `sounds.events` name→seed map. **Deferred to slice 7 (its own plan):** the object/movement-keyed sfx — `sfxCreationMasks`, `sfxDestructionMasks`, per-layer `sfxMovementMasks`, `sfxMovementFailureMasks` (`SoundMaskEntry { objectMask; directionMask; directionMaskWidth; seed }`) — which involve object-mask decode, direction-mask decode, per-layer indexing, and a legacy `directionMaskWidth` quirk. **Also deferred:** rules.

**Prerequisite facts (verified against the tree at plan time):**
- C++ `Game::sfxEvents` is `std::map<std::string,int32_t>` (`native/src/runtime/core.hpp:513`), filled by the lowerer when a sound entry's first token is a `SOUNDEVENT`: `game->sfxEvents[first.text] = parseSeed(seedToken.text)` (`native/src/compiler/lower_to_runtime.cpp:4717-4728`).
- JS `state.sfx_Events` (`src/js/compiler.js:4641,4689,4820`) is a `{name: seed}` object, where **seed is a string** (the raw token text, e.g. `"83744503"`).
- Empirically across the 161 conforming corpus games: 122 have sound events (447 total); event names observed are `sfx0..sfx9, startgame, startlevel, endlevel, endgame, restart, undo, cancel, showmessage, closemessage`. All seeds are canonical integer strings in the range 123413–99909509 — **none exceed `INT32_MAX`** — so emitting them as normalized integers on both sides is lossless and parity-clean.
- A minimal `SOUNDS` fixture with `sfx0 12345678` / `endlevel 87654321` compiles cleanly on both sides (`errorCount 0`, C++ `--emit-ir-json` exit 0) and yields JS `sfx_Events = {"sfx0":"12345678","endlevel":"87654321"}`.
- sokoban_basic has an empty `SOUNDS` section, so its `sfxEvents` is empty.

---

## File Structure

- **Modify** `native/src/compiler/types/semantic_program.hpp` — add a `SemanticSounds` struct (with `events`) and a `sounds` field.
- **Modify** `native/src/compiler/semantic_program.cpp` — copy `sfxEvents` in `buildSemanticProgram`; emit `sounds.events` in the serializer.
- **Modify** `src/tests/js_oracle/lib/puzzlescript_semantic_program.js` — build `sounds.events` with integer-normalized seeds; emit it in the snapshot.
- **Modify** `native/tests/compiler_semantic_program.cpp` — assert sokoban has no events, plus an inline fixture with real events.

---

## Task 1: Resolved sound events

**Files:**
- Modify: `native/src/compiler/types/semantic_program.hpp`
- Modify: `native/src/compiler/semantic_program.cpp`
- Modify: `native/tests/compiler_semantic_program.cpp`
- Modify: `src/tests/js_oracle/lib/puzzlescript_semantic_program.js`

- [ ] **Step 1: Extend the unit test with sound-event assertions (red)**

In `native/tests/compiler_semantic_program.cpp`, after the metadata assertions (before the `const std::string json = ...` line), add:

```cpp
    // Sounds: sokoban_basic has an empty SOUNDS section.
    assert(program.sounds.events.empty());
```

and extend the JSON-shape assertions:

```cpp
    assert(json.find("\"sounds\"") != std::string::npos);
    assert(json.find("\"events\"") != std::string::npos);
```

Then, alongside the existing inline homepage fixture block (before `return 0;`), add a sound fixture that exercises real event→seed mapping (sokoban has none):

```cpp
    // Sound events resolve name -> integer seed (sokoban declares no sounds, so
    // cover the real mapping with an explicit fixture; JS stores seeds as
    // strings, so the snapshot normalizes them to integers).
    {
        const std::string soundSource =
            "title T\n"
            "\n"
            "========\nOBJECTS\n========\n\n"
            "Background\nblack\n\n"
            "Player\nblue\n\n"
            "=======\nLEGEND\n=======\n\n"
            ". = Background\n"
            "P = Player\n\n"
            "=======\nSOUNDS\n=======\n\n"
            "sfx0 12345678\n"
            "endlevel 87654321\n\n"
            "================\nCOLLISIONLAYERS\n================\n\n"
            "Background\nPlayer\n\n"
            "======\nRULES\n======\n\n"
            "==============\nWINCONDITIONS\n==============\n\n"
            "=======\nLEVELS\n=======\n\n"
            "P\n";
        puzzlescript::compiler::DiagnosticSink soundDiagnostics;
        const auto soundState = puzzlescript::compiler::parseSource(soundSource, soundDiagnostics);
        puzzlescript::LoadedGame soundGame;
        auto soundError = puzzlescript::compiler::lowerToRuntimeGame(soundState, soundGame);
        assert(!soundError);
        assert(soundGame.information);
        const auto soundProgram = puzzlescript::compiler::buildSemanticProgram(*soundGame.information);
        assert(soundProgram.sounds.events.size() == 2);
        assert(soundProgram.sounds.events.count("sfx0") && soundProgram.sounds.events.at("sfx0") == 12345678);
        assert(soundProgram.sounds.events.count("endlevel") && soundProgram.sounds.events.at("endlevel") == 87654321);
    }
```

- [ ] **Step 2: Add the SemanticSounds struct + contract field**

In `native/src/compiler/types/semantic_program.hpp`, add `SemanticSounds` after `SemanticWinCondition`:

```cpp
struct SemanticSounds {
    std::map<std::string, int32_t> events;  // sound-event name -> seed
};
```

and add a field to `SemanticProgram` (after `metadata`):

```cpp
    SemanticSounds sounds;
```

Update the struct comment to list sounds (events) as now included and note object/movement sfx remain deferred.

- [ ] **Step 3: Copy sound events in the projection**

In `native/src/compiler/semantic_program.cpp`, in `buildSemanticProgram` after the metadata loop and before `return program;`, add:

```cpp
    program.sounds.events = game.sfxEvents;
```

- [ ] **Step 4: Emit sounds in the serializer**

In `native/src/compiler/semantic_program.cpp`, add a sound-events serializer in the anonymous namespace (note: values are JSON **numbers**, unlike metadata's string values):

```cpp
void appendSoundEventsObject(std::string& out, const std::map<std::string, int32_t>& events) {
    out += '{';
    bool first = true;
    for (const auto& [name, seed] : events) {
        if (!first) {
            out += ',';
        }
        first = false;
        appendJsonString(out, name);
        out += ':';
        out += std::to_string(seed);
    }
    out += '}';
}
```

Then emit it in `serializeSemanticProgramJson`. Replace:

```cpp
    out += ",\"metadata\":";
    appendMetadataObject(out, program.metadata);
    out += "}}";
    return out;
```

with:

```cpp
    out += ",\"metadata\":";
    appendMetadataObject(out, program.metadata);
    out += ",\"sounds\":{\"events\":";
    appendSoundEventsObject(out, program.sounds.events);
    out += "}}}";
    return out;
```

(The trailing `}}}` closes the `sounds` object, the `semantic_program` object, and the root.)

- [ ] **Step 5: Build and run the unit test (green)**

Run:
```bash
cmake --build build --target compiler_semantic_program -j
ctest --test-dir build -R '^compiler_semantic_program$' --output-on-failure
```
Expected: `Passed`. (Building before Step 2 fails to compile — `program.sounds` undefined — the red state.)

- [ ] **Step 6: Resolve sound events on the JS side**

In `src/tests/js_oracle/lib/puzzlescript_semantic_program.js`, inside `buildSemanticProgramSnapshot`, after the metadata block, add (JS seeds are strings — normalize to integers to match the C++ `int32_t`):

```js
    const soundEvents = {};
    for (const name of Object.keys(state.sfx_Events || {})) {
        soundEvents[name] = parseInt(state.sfx_Events[name], 10);
    }
    const sounds = { events: soundEvents };
```

Then extend the returned snapshot. Change:

```js
    return {
        schema_version: 1,
        semantic_program: { objects, collision_layers, legends, levels, win_conditions, metadata },
    };
```

to:

```js
    return {
        schema_version: 1,
        semantic_program: { objects, collision_layers, legends, levels, win_conditions, metadata, sounds },
    };
```

- [ ] **Step 7: Validate JS↔C++ sound parity over the corpus**

Run:
```bash
cmake --build build --target puzzlescript_cpp -j
bash scripts/diff_semantic_program_against_js.sh src/demo/sokoban_basic.txt; echo "sokoban exit=$?"
node src/tests/semantic_program_parity_corpus_node.js build/native/puzzlescript_cpp src/tests/solver_tests
```
Expected: sokoban `exit=0`, and the corpus runner still reports `conforming + parity-matched: 161` with `parity failures: 0` — now including `sounds.events` (122 games, 447 seeds).

If a conforming game reports a parity failure, triage as in prior slices. Likely sources: (a) an event whose first token JS classifies as a `SOUNDEVENT` but C++ does not (or vice versa), so it lands in the global map on one side only, or (b) a seed string that doesn't round-trip through `parseInt`/`parseSeed` identically (the probe found none, but a malformed seed could). Inspect `sounds.events` in both outputs; classify as emitter bug vs real compiler divergence. Do not loosen the gate.

- [ ] **Step 8: Run the full semantic test set and commit**

Run:
```bash
ctest --test-dir build -R 'semantic_program' --output-on-failure
```
Expected: all four semantic_program tests pass. Then:

```bash
git add native/src/compiler/types/semantic_program.hpp native/src/compiler/semantic_program.cpp native/tests/compiler_semantic_program.cpp src/tests/js_oracle/lib/puzzlescript_semantic_program.js
git commit -m "feat(native): resolve sound events in SemanticProgram contract (slice 6)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Subsequent slices (roadmap, not part of this plan)

- **Slice 7 — object/movement sfx:** `sfxCreationMasks` / `sfxDestructionMasks` (object-mask + seed), per-layer `sfxMovementMasks` (object-mask + direction-mask + seed), and `sfxMovementFailureMasks`, under the same `sounds` key. Research points: the `SoundMaskEntry::directionMaskWidth` legacy-width quirk and decoding the direction mask to a canonical set of direction names; reuses `decodeMaskObjectIds` for the object masks.
- **Rules (much later):** deferred until a semantic rule representation exists; the lowered `Rule` is far below the contract's altitude and needs its own design.

---

## Self-Review

**Spec coverage:** The design doc lists "metadata effects" / sounds among what `SemanticProgram` resolves. Task 1 adds the global sound-event map, gated JS↔C++ by the existing corpus harness. Object/movement sfx and rules remain scoped out (roadmap).

**Placeholder scan:** No TBD/TODO placeholders; every code step is complete and every command states expected output. Step 7's triage branch is the proven empirical-validation procedure, not a placeholder.

**Type/name consistency:** `SemanticSounds { events }` with `events` a `std::map<std::string,int32_t>` (Step 2) is filled from `game.sfxEvents` (Step 3), serialized as `sounds.events` with **integer** values by `appendSoundEventsObject` (Step 4), matched by the JS `sounds.events` built with `parseInt`-normalized seeds (Step 6), and asserted via `program.sounds.events` (Step 1). Emitting an object lets the canonicalizing corpus diff sort keys.

**Risk notes:**
- The only representation subtlety is the seed type: JS stores strings, C++ stores `int32_t`. Both sides emit integers (`parseInt` on JS, raw int on C++), which is lossless because the probe confirmed all 447 corpus seeds are canonical integer strings within `INT32_MAX`. If a future game used a seed beyond `INT32_MAX`, C++ would truncate while JS would not — Step 7's gate would surface it; that case does not occur in the corpus and is out of scope.
- `appendSoundEventsObject` mirrors `appendMetadataObject` but emits numeric values; kept separate because the value type differs (a shared helper would need to branch on value type).
- Nesting under `sounds.events` (rather than a flat `sound_events`) lets slice 7 add `creation`/`destruction`/`movement`/`movement_failure` under the same key without restructuring the contract.
