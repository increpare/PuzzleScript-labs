# SemanticProgram Contract (Slice 5: Resolved Metadata) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `SemanticProgram` contract with resolved metadata — the game's key→value metadata pairs as a string map — on both the C++ projection and the JS shape, validated by the existing corpus parity gate.

**Architecture:** Additive extension of the slice-1..4 contract. The C++ producer copies `Game::metadata.values` (already a `std::map<std::string,std::string>` of raw pairs); the JS shape copies the compiled `state.metadata` map. Both derive from the same parsed metadata pairs (already proven equal by the ParserState parity contract), so the only divergence is that JS `twiddleMetaData` rewrites `flickscreen`/`zoomscreen` into coordinate arrays — those two keys are excluded on both sides. Emitted as a JSON object so the canonicalizing diff handles key order. No lowerer changes; the engine is untouched.

**Tech Stack:** C++17 (`puzzlescript_compiler`), Node.js (JS oracle), CMake/CTest.

**Scope.** Slice 5 adds only the metadata key→value string map, excluding `flickscreen`/`zoomscreen` (camera config that JS resolves to coord arrays while C++ keeps raw). **Deferred:** resolved hex colors (`foregroundColor`/`fgcolor` diverge — C++ keeps the raw `text_color` string, JS resolves to hex; the raw color strings are already in the metadata map as `text_color`/`background_color`), `flickscreen`/`zoomscreen` as typed coords, sounds (`sfxEvents` + object/movement-keyed sfx masks — its own slice), and rules.

**Prerequisite facts (verified against the tree at plan time):**
- C++ `Game::metadata` is `GameMetadata { std::vector<std::string> pairs; std::map<std::string,std::string> values; std::map<std::string,int32_t> lines; }` (`native/src/runtime/core.hpp`). The lowerer fills `values[key] = rawValue` for every parsed pair (`native/src/compiler/lower_to_runtime.cpp:637-639`).
- JS `state.metadata` (after `twiddleMetaData`, `src/js/compiler.js:4272-4330`) is a `{key: value}` map of the raw pairs, except `flickscreen` and `zoomscreen` are rewritten to `[w,h]` int arrays via `getCoords`. No other key is transformed; no value is empty/undefined.
- Empirically across the 161 conforming corpus games, the only non-string metadata value is `flickscreen` (5 games); keys observed: `again_interval, author, background_color, color_palette, debug, flickscreen, homepage, key_repeat_interval, noaction, norepeat_action, norestart, noundo, realtime_interval, require_player_movement, run_rules_on_level_start, text_color, title, verbose_logging, youtube`.
- The underlying parsed metadata pairs are already validated equal JS↔C++ by `scripts/diff_parser_state_against_js.sh` (`parser_state` snapshot), so excluding the two transformed keys makes the resolved map parity-clean by construction.
- Ground-truth fixture: sokoban_basic's metadata is exactly `{title: "Simple Block Pushing Game", author: "David Skinner", homepage: "www.puzzlescript.net"}` (no flickscreen).

---

## File Structure

- **Modify** `native/src/compiler/types/semantic_program.hpp` — add a `metadata` map field (`#include <map>`).
- **Modify** `native/src/compiler/semantic_program.cpp` — copy filtered metadata in `buildSemanticProgram`; emit a `metadata` JSON object in the serializer.
- **Modify** `src/tests/js_oracle/lib/puzzlescript_semantic_program.js` — build the filtered `metadata` object; emit it in the snapshot.
- **Modify** `native/tests/compiler_semantic_program.cpp` — assert sokoban's three metadata entries.

---

## Task 1: Resolved metadata

**Files:**
- Modify: `native/src/compiler/types/semantic_program.hpp`
- Modify: `native/src/compiler/semantic_program.cpp`
- Modify: `native/tests/compiler_semantic_program.cpp`
- Modify: `src/tests/js_oracle/lib/puzzlescript_semantic_program.js`

- [ ] **Step 1: Extend the unit test with metadata assertions (red)**

In `native/tests/compiler_semantic_program.cpp`, after the win-condition assertions (before the `const std::string json = ...` line), add:

```cpp
    // Metadata: sokoban_basic declares title/author/homepage (no flickscreen).
    assert(program.metadata.size() == 3);
    assert(program.metadata.count("title") && program.metadata.at("title") == "Simple Block Pushing Game");
    assert(program.metadata.count("author") && program.metadata.at("author") == "David Skinner");
    assert(program.metadata.count("homepage") && program.metadata.at("homepage") == "www.puzzlescript.net");
```

and extend the JSON-shape assertions:

```cpp
    assert(json.find("\"metadata\"") != std::string::npos);
```

- [ ] **Step 2: Add the metadata field**

In `native/src/compiler/types/semantic_program.hpp`, add `#include <map>` to the includes, then add a field to `SemanticProgram` (after `winConditions`):

```cpp
    std::map<std::string, std::string> metadata;  // raw key->value, excludes flickscreen/zoomscreen
```

Update the struct comment to list metadata as now included.

- [ ] **Step 3: Copy filtered metadata in the projection**

In `native/src/compiler/semantic_program.cpp`, add `#include <map>` if not already present. In `buildSemanticProgram`, after the win-conditions loop and before `return program;`, add:

```cpp
    for (const auto& [key, value] : game.metadata.values) {
        // flickscreen/zoomscreen are rewritten to coord arrays on the JS side
        // (twiddleMetaData); exclude them so the resolved map stays parity-clean.
        if (key == "flickscreen" || key == "zoomscreen") {
            continue;
        }
        program.metadata.emplace(key, value);
    }
```

- [ ] **Step 4: Emit metadata in the serializer**

In `native/src/compiler/semantic_program.cpp`, add a metadata-object serializer in the anonymous namespace:

```cpp
void appendMetadataObject(std::string& out, const std::map<std::string, std::string>& metadata) {
    out += '{';
    bool first = true;
    for (const auto& [key, value] : metadata) {
        if (!first) {
            out += ',';
        }
        first = false;
        appendJsonString(out, key);
        out += ':';
        appendJsonString(out, value);
    }
    out += '}';
}
```

Then emit it in `serializeSemanticProgramJson`. Replace:

```cpp
    out += ",\"win_conditions\":";
    appendWinConditionArray(out, program.winConditions);
    out += "}}";
    return out;
```

with:

```cpp
    out += ",\"win_conditions\":";
    appendWinConditionArray(out, program.winConditions);
    out += ",\"metadata\":";
    appendMetadataObject(out, program.metadata);
    out += "}}";
    return out;
```

- [ ] **Step 5: Build and run the unit test (green)**

Run:
```bash
cmake --build build --target compiler_semantic_program -j
ctest --test-dir build -R '^compiler_semantic_program$' --output-on-failure
```
Expected: `Passed`. (Building before Step 2 fails to compile — `program.metadata` undefined — the red state.)

- [ ] **Step 6: Build the filtered metadata on the JS side**

In `src/tests/js_oracle/lib/puzzlescript_semantic_program.js`, inside `buildSemanticProgramSnapshot`, after the `win_conditions` line, add:

```js
    const metadata = {};
    for (const key of Object.keys(state.metadata)) {
        if (key === 'flickscreen' || key === 'zoomscreen') {
            continue;
        }
        metadata[key] = state.metadata[key];
    }
```

Then extend the returned snapshot. Change:

```js
    return {
        schema_version: 1,
        semantic_program: { objects, collision_layers, legends, levels, win_conditions },
    };
```

to:

```js
    return {
        schema_version: 1,
        semantic_program: { objects, collision_layers, legends, levels, win_conditions, metadata },
    };
```

- [ ] **Step 7: Validate JS↔C++ metadata parity over the corpus**

Run:
```bash
cmake --build build --target puzzlescript_cpp -j
bash scripts/diff_semantic_program_against_js.sh src/demo/sokoban_basic.txt; echo "sokoban exit=$?"
node src/tests/semantic_program_parity_corpus_node.js build/native/puzzlescript_cpp src/tests/solver_tests
```
Expected: sokoban `exit=0`, and the corpus runner still reports `conforming + parity-matched: 161` with `parity failures: 0` — now including `metadata`.

If a conforming game reports a parity failure, triage as in prior slices. The most likely source is a metadata key that JS resolves to a non-string and C++ keeps raw (beyond flickscreen/zoomscreen) — inspect the diverging `metadata` object in both outputs and either add the key to the exclusion list on both sides or classify it as a real divergence. Do not loosen the gate.

- [ ] **Step 8: Run the full semantic test set and commit**

Run:
```bash
ctest --test-dir build -R 'semantic_program' --output-on-failure
```
Expected: all four semantic_program tests pass. Then:

```bash
git add native/src/compiler/types/semantic_program.hpp native/src/compiler/semantic_program.cpp native/tests/compiler_semantic_program.cpp src/tests/js_oracle/lib/puzzlescript_semantic_program.js
git commit -m "feat(native): resolve metadata in SemanticProgram contract (slice 5)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Subsequent slices (roadmap, not part of this plan)

- **Slice 6 — sounds:** `Game::sfxEvents` (name→seed map) first, then the object/movement-keyed `sfxCreationMasks` / `sfxDestructionMasks` / `sfxMovementMasks` (mask + seed + direction) vs the JS sound representation. More involved than metadata; warrants its own plan.
- **Resolved colors (optional):** `foreground_color`/`background_color` as hex would require resolving the raw `text_color`/`background_color` to hex on the C++ side to match JS `fgcolor`/`bgcolor`; deferred.
- **Rules (much later):** deferred until a semantic rule representation exists.

---

## Self-Review

**Spec coverage:** The design doc lists "metadata effects" among what `SemanticProgram` resolves. Task 1 adds the resolved metadata key→value map, gated JS↔C++ by the existing corpus harness. Sounds and rules remain scoped out (roadmap).

**Placeholder scan:** No TBD/TODO placeholders; every code step is complete and every command states expected output. Step 7's triage branch is the proven empirical-validation procedure, not a placeholder.

**Type/name consistency:** `SemanticProgram::metadata` is a `std::map<std::string,std::string>` (Step 2), filled from `game.metadata.values` minus the two camera keys (Step 3), serialized as a JSON object by `appendMetadataObject` under key `metadata` (Step 4), matched by the JS `metadata` object built with the identical exclusion (Step 6), and asserted via `program.metadata` (Step 1). Emitting an object (not array) lets the canonicalizing corpus diff sort keys, so iteration order is irrelevant.

**Risk notes:**
- The exclusion list (`flickscreen`, `zoomscreen`) is exactly the set of keys `twiddleMetaData` transforms; the corpus probe confirmed `flickscreen` is the only non-string value present, and the same two keys are excluded symmetrically on both sides. If a future JS change transforms another key, Step 7's gate surfaces it as that key's value diverging.
- Resolved hex colors are intentionally out of scope because C++ stores the raw `text_color`/`background_color` string while JS resolves to hex — the raw strings are still covered (they appear unmodified in the metadata map), so no color information is lost, only the hex form is deferred.
- Metadata values can contain arbitrary text (titles, URLs); `appendJsonString` escapes them and the canon diff parses both sides, so escaping differences cannot cause false divergence.
