# SemanticProgram Contract (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the `SemanticProgram` contract end-to-end on a minimal subset (resolved objects + collision layers) — a C++ contract type, builder, and serializer; a CLI emitter; a JS shape emitter; and a canonicalized JS↔C++ parity diff — without rewiring the lowerer.

**Architecture:** This is the additive first slice of migration steps 2-3 from [the design doc](../specs/2026-06-20-puzzlescript-js-cpp-modular-refactor-design.md). The C++ producer is intentionally a *projection over the already-lowered `Game`* (`buildSemanticProgram(const Game&)`), not a new resolution pass — the contract type, its serializer, and the cross-language diff harness are the durable assets, and a later slice swaps the producer for the real semantic builder while keeping the contract unchanged. The JS side stays light: a view over the existing compiled `state`, no engine restructuring.

**Tech Stack:** C++17 (`puzzlescript_compiler` static lib, CLI `puzzlescript_cpp`), Node.js (JS oracle export scripts), CMake/CTest, bash.

**Scope (deliberately minimal).** Slice 1 carries only `objects` (id, name, layer) and `collision_layers` (object-id lists). These are the semantically central, faithfully-resolvable fields present on both sides, and they validate the highest-value parity property: that JS and C++ assign object ids and layers identically. **Explicitly deferred to later slices on the same contract:** resolved legends (synonym/aggregate/property → id sets), levels, win conditions, rules, metadata, sounds, colors, sprites. The point of slice 1 is to prove the machinery, not to be complete.

**Prerequisite facts (verified against the tree at plan time):**
- The CLI already compiles source → `LoadedGame` via `puzzlescript::compiler::parseSource` + `lowerToRuntimeGame` in its `--emit-ir-json` path (`native/src/cli/main.cpp` ~line 6555). The new `--emit-semantic-program` mirrors that exactly.
- `puzzlescript::Game` (alias of `GameInformation`, `native/src/runtime/core.hpp`) exposes the resolved data: `objectsById` (vector of `ObjectDef{ name; id; layer; colors; sprite; }`) and `collisionLayers` (`std::vector<std::vector<std::string>>`, layer → object names).
- JS: after `compile(command, source, seed)` runs in `export_ir_json.js`, the global `state` holds `state.idDict` (id→name), `state.objects[name].layer`, and `state.collisionLayers` (layer → names). Object ids are assigned densely by iterating `collisionLayers` (`src/js/compiler.js:50-65`).
- The existing ParserState parity harness is the pattern to mirror: `export_ir_json.js … --snapshot-phase parser` (JS) vs `puzzlescript_cpp compile … --emit-parser-state` (C++), diffed by `scripts/diff_parser_state_against_js.sh`. CMake registers `puzzlescript_cpp_parser_state_smoke` and `puzzlescript_cpp_parser_state_diff_smoke` for these.
- The CLI binary used by the diff harness is `build/native/puzzlescript_cpp` (top-level build dir).

---

## File Structure

- **Create** `native/src/compiler/types/semantic_program.hpp` — the `SemanticProgram` / `SemanticObject` contract structs (mirrors `types/parser_state.hpp`).
- **Create** `native/src/compiler/semantic_program.hpp` — declares `buildSemanticProgram(const Game&)` and `serializeSemanticProgramJson(const SemanticProgram&)`.
- **Create** `native/src/compiler/semantic_program.cpp` — projection builder + compact JSON serializer (self-contained JSON-escape helper; a shared `json_writer.hpp` is a future dedup, out of scope here).
- **Create** `native/tests/compiler_semantic_program.cpp` — focused builder/serializer unit test (mirrors `compiler_keyword_names.cpp`).
- **Create** `src/tests/js_oracle/lib/puzzlescript_semantic_program.js` — JS shape emitter `buildSemanticProgramSnapshot(state)` (mirrors `lib/puzzlescript_parser_snapshot.js`).
- **Create** `scripts/diff_semantic_program_against_js.sh` — canonicalized JS↔C++ parity diff.
- **Modify** `native/src/cli/main.cpp` — add `--emit-semantic-program` flag + emit block + usage text.
- **Modify** `src/tests/js_oracle/export_ir_json.js` — add `--snapshot-phase semantic`.
- **Modify** `native/CMakeLists.txt` — add the new compiler source, the test exe, and two CTest cases.

---

## Task 1: C++ SemanticProgram contract type + projection builder

**Files:**
- Create: `native/src/compiler/types/semantic_program.hpp`
- Create: `native/src/compiler/semantic_program.hpp`
- Create: `native/src/compiler/semantic_program.cpp`
- Create: `native/tests/compiler_semantic_program.cpp`
- Modify: `native/CMakeLists.txt`

- [ ] **Step 1: Write the failing builder test**

Create `native/tests/compiler_semantic_program.cpp`:

```cpp
#include <cassert>
#include <fstream>
#include <sstream>
#include <string>

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "compiler/semantic_program.hpp"

namespace {

std::string readFixture(const char* relPath) {
    std::ifstream in(relPath);
    std::stringstream buffer;
    buffer << in.rdbuf();
    return buffer.str();
}

} // namespace

int main() {
    const std::string source = readFixture("src/demo/sokoban_basic.txt") + "\n";
    assert(!source.empty());

    puzzlescript::compiler::DiagnosticSink diagnostics;
    const auto state = puzzlescript::compiler::parseSource(source, diagnostics);
    puzzlescript::LoadedGame loadedGame;
    auto error = puzzlescript::compiler::lowerToRuntimeGame(state, loadedGame);
    assert(!error);
    assert(loadedGame.information);

    const auto program = puzzlescript::compiler::buildSemanticProgram(*loadedGame.information);

    // Objects: non-empty, ids strictly ascending from 0, every object on a real layer.
    assert(!program.objects.empty());
    assert(program.objects.front().id == 0);
    for (size_t i = 0; i < program.objects.size(); ++i) {
        assert(program.objects[i].layer >= 0);
        if (i > 0) {
            assert(program.objects[i].id > program.objects[i - 1].id);
        }
    }
    // Collision layers exist and reference only real object ids.
    assert(!program.collisionLayers.empty());
    for (const auto& layer : program.collisionLayers) {
        for (int32_t id : layer) {
            assert(id >= 0);
        }
    }

    const std::string json = puzzlescript::compiler::serializeSemanticProgramJson(program);
    assert(json.find("\"semantic_program\"") != std::string::npos);
    assert(json.find("\"collision_layers\"") != std::string::npos);

    return 0;
}
```

- [ ] **Step 2: Create the contract structs**

Create `native/src/compiler/types/semantic_program.hpp`:

```cpp
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace puzzlescript::compiler {

struct SemanticObject {
    int32_t id = -1;
    std::string name;
    int32_t layer = -1;
};

// Slice 1 of the SemanticProgram contract: resolved object identity + collision
// layers. Extended in later slices with legends, levels, win conditions, rules,
// and metadata. Serialized form is versioned via schemaVersion.
struct SemanticProgram {
    int32_t schemaVersion = 1;
    std::vector<SemanticObject> objects;                 // sorted by id ascending
    std::vector<std::vector<int32_t>> collisionLayers;   // per layer: object ids
};

} // namespace puzzlescript::compiler
```

- [ ] **Step 3: Declare the builder and serializer**

Create `native/src/compiler/semantic_program.hpp`:

```cpp
#pragma once

#include <string>

#include "compiler/types/semantic_program.hpp"
#include "runtime/core.hpp"

namespace puzzlescript::compiler {

// Projects a resolved SemanticProgram out of an already-lowered runtime Game.
// (Slice 1 producer; a later slice replaces this with the real semantic builder
// while keeping the contract type and serializer unchanged.)
SemanticProgram buildSemanticProgram(const puzzlescript::Game& game);

std::string serializeSemanticProgramJson(const SemanticProgram& program);

} // namespace puzzlescript::compiler
```

- [ ] **Step 4: Implement the builder and serializer**

Create `native/src/compiler/semantic_program.cpp`:

```cpp
#include "compiler/semantic_program.hpp"

#include <algorithm>
#include <cstdio>
#include <string_view>
#include <unordered_map>

namespace puzzlescript::compiler {
namespace {

void appendJsonString(std::string& out, std::string_view value) {
    out += '"';
    for (char ch : value) {
        switch (ch) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (static_cast<unsigned char>(ch) < 0x20) {
                    char buf[7];
                    std::snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned char>(ch));
                    out += buf;
                } else {
                    out += ch;
                }
        }
    }
    out += '"';
}

} // namespace

SemanticProgram buildSemanticProgram(const puzzlescript::Game& game) {
    SemanticProgram program;
    program.schemaVersion = 1;

    std::unordered_map<std::string, int32_t> nameToId;
    program.objects.reserve(game.objectsById.size());
    nameToId.reserve(game.objectsById.size());
    for (const auto& object : game.objectsById) {
        program.objects.push_back(SemanticObject{object.id, object.name, object.layer});
        nameToId.emplace(object.name, object.id);
    }
    std::sort(program.objects.begin(), program.objects.end(),
              [](const SemanticObject& a, const SemanticObject& b) { return a.id < b.id; });

    program.collisionLayers.reserve(game.collisionLayers.size());
    for (const auto& layer : game.collisionLayers) {
        std::vector<int32_t> ids;
        ids.reserve(layer.size());
        for (const auto& name : layer) {
            const auto it = nameToId.find(name);
            ids.push_back(it == nameToId.end() ? -1 : it->second);
        }
        program.collisionLayers.push_back(std::move(ids));
    }

    return program;
}

std::string serializeSemanticProgramJson(const SemanticProgram& program) {
    std::string out;
    out += "{\"schema_version\":";
    out += std::to_string(program.schemaVersion);
    out += ",\"semantic_program\":{\"objects\":[";
    for (size_t i = 0; i < program.objects.size(); ++i) {
        if (i != 0) {
            out += ',';
        }
        const auto& object = program.objects[i];
        out += "{\"id\":";
        out += std::to_string(object.id);
        out += ",\"name\":";
        appendJsonString(out, object.name);
        out += ",\"layer\":";
        out += std::to_string(object.layer);
        out += '}';
    }
    out += "],\"collision_layers\":[";
    for (size_t i = 0; i < program.collisionLayers.size(); ++i) {
        if (i != 0) {
            out += ',';
        }
        out += '[';
        const auto& layer = program.collisionLayers[i];
        for (size_t j = 0; j < layer.size(); ++j) {
            if (j != 0) {
                out += ',';
            }
            out += std::to_string(layer[j]);
        }
        out += ']';
    }
    out += "]}}";
    return out;
}

} // namespace puzzlescript::compiler
```

- [ ] **Step 5: Wire the source and test into CMake**

In `native/CMakeLists.txt`, add to `PUZZLESCRIPT_COMPILER_SOURCES` (after `src/compiler/rule_text.cpp`):
```cmake
  src/compiler/semantic_program.cpp
```

Then add a test executable next to the other `compiler_*` tests (e.g. after the `compiler_keyword_names` block, ~line 375):
```cmake
add_executable(compiler_semantic_program
  tests/compiler_semantic_program.cpp
)

target_link_libraries(compiler_semantic_program
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)

target_include_directories(compiler_semantic_program
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME compiler_semantic_program
  COMMAND compiler_semantic_program
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)
```

- [ ] **Step 6: Build and run the test (red → green)**

Run:
```bash
cmake -S . -B build
cmake --build build --target compiler_semantic_program -j
ctest --test-dir build -R '^compiler_semantic_program$' --output-on-failure
```
Expected: builds, and `1/1 ... compiler_semantic_program ... Passed`. (If you ran the build before creating `semantic_program.cpp`/`.hpp`, the compile fails with "semantic_program.hpp: No such file" / undefined `buildSemanticProgram` — that is the red state.)

- [ ] **Step 7: Commit**

```bash
git add native/src/compiler/types/semantic_program.hpp native/src/compiler/semantic_program.hpp native/src/compiler/semantic_program.cpp native/tests/compiler_semantic_program.cpp native/CMakeLists.txt
git commit -m "feat(native): add SemanticProgram contract + projection builder (slice 1)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: CLI `--emit-semantic-program`

**Files:**
- Modify: `native/src/cli/main.cpp`
- Modify: `native/CMakeLists.txt`

- [ ] **Step 1: Add the flag, guard, and emit block**

In `native/src/cli/main.cpp`:

(a) Add the include near the other compiler includes used by the IR path:
```cpp
#include "compiler/semantic_program.hpp"
```

(b) Next to `bool emitParserState = false;` (~line 6501), add:
```cpp
    bool emitSemanticProgram = false;
```

(c) Next to the `--emit-parser-state` arg handling, add a branch:
```cpp
        } else if (arg == "--emit-semantic-program") {
            emitSemanticProgram = true;
```

(d) Update the "nothing requested" guard:
```cpp
    if (!emitParserState && !emitDiagnostics && !emitRuntimeIr) {
```
to:
```cpp
    if (!emitParserState && !emitDiagnostics && !emitRuntimeIr && !emitSemanticProgram) {
```

(e) After the `if (emitRuntimeIr) { … }` block, add the emit block (mirrors the IR path's parse+lower):
```cpp
    if (emitSemanticProgram) {
        puzzlescript::compiler::DiagnosticSink diagnostics;
        const auto parserState = puzzlescript::compiler::parseSource(source, diagnostics);
        puzzlescript::LoadedGame loadedGame;
        if (auto error = puzzlescript::compiler::lowerToRuntimeGame(parserState, loadedGame)) {
            std::cerr << error->message << "\n";
            return 1;
        }
        if (!loadedGame.information) {
            std::cerr << "Failed to lower source to a runtime game.\n";
            return 1;
        }
        const auto program = puzzlescript::compiler::buildSemanticProgram(*loadedGame.information);
        std::cout << puzzlescript::compiler::serializeSemanticProgramJson(program) << "\n";
    }
```

(f) Update the two usage strings (the `compile … --emit-parser-state` example line and the `Usage: … [--emit-parser-state] [--emit-ir-json]` line) to also mention `[--emit-semantic-program]`.

- [ ] **Step 2: Register the CLI smoke test**

In `native/CMakeLists.txt`, next to `puzzlescript_cpp_parser_state_smoke` (~line 859), add:
```cmake
add_test(
  NAME puzzlescript_cpp_semantic_program_smoke
  COMMAND puzzlescript_cpp compile ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt --emit-semantic-program
)
set_tests_properties(puzzlescript_cpp_semantic_program_smoke PROPERTIES PASS_REGULAR_EXPRESSION "\"semantic_program\"")
```

- [ ] **Step 3: Build and run the smoke test**

Run:
```bash
cmake -S . -B build
cmake --build build --target puzzlescript_cpp -j
ctest --test-dir build -R '^puzzlescript_cpp_semantic_program_smoke$' --output-on-failure
```
Expected: `Passed`. Spot-check the payload:
```bash
build/native/puzzlescript_cpp compile src/demo/sokoban_basic.txt --emit-semantic-program
```
Expected: a single JSON line containing `"schema_version":1`, an `"objects"` array of `{"id":…,"name":…,"layer":…}`, and a `"collision_layers"` array of id arrays.

- [ ] **Step 4: Commit**

```bash
git add native/src/cli/main.cpp native/CMakeLists.txt
git commit -m "feat(native): add puzzlescript_cpp compile --emit-semantic-program

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: JS SemanticProgram shape emitter

**Files:**
- Create: `src/tests/js_oracle/lib/puzzlescript_semantic_program.js`
- Modify: `src/tests/js_oracle/export_ir_json.js`

- [ ] **Step 1: Create the JS shape emitter**

Create `src/tests/js_oracle/lib/puzzlescript_semantic_program.js`:

```js
'use strict';

// View over the compiled global `state` that mirrors the C++ SemanticProgram
// projection (slice 1: objects + collision layers). Kept deliberately thin —
// no engine restructuring, just a read of the already-resolved model.
function buildSemanticProgramSnapshot(state) {
    const nameToId = {};
    for (let id = 0; id < state.idDict.length; id++) {
        nameToId[state.idDict[id]] = id;
    }

    const objects = [];
    for (let id = 0; id < state.idDict.length; id++) {
        const name = state.idDict[id];
        const object = state.objects[name];
        objects.push({ id, name, layer: object.layer });
    }

    const collision_layers = state.collisionLayers.map(function (layer) {
        return layer.map(function (name) {
            return name in nameToId ? nameToId[name] : -1;
        });
    });

    return {
        schema_version: 1,
        semantic_program: { objects, collision_layers },
    };
}

module.exports = { buildSemanticProgramSnapshot };
```

- [ ] **Step 2: Hook the `semantic` snapshot phase into the exporter**

In `src/tests/js_oracle/export_ir_json.js`:

(a) Add the require next to the other lib requires (top of file):
```js
const { buildSemanticProgramSnapshot } = require('./lib/puzzlescript_semantic_program');
```

(b) Immediately after the `compile(command, …)` try/finally block and before `const document = {` (~line 110), add:
```js
    if (options.snapshotPhase === 'semantic') {
        const snapshot = buildSemanticProgramSnapshot(state);
        const payload = JSON.stringify(snapshot, null, 2);
        if (outputFile) {
            fs.mkdirSync(path.dirname(outputFile), { recursive: true });
            fs.writeFileSync(outputFile, `${payload}\n`, 'utf8');
        } else {
            process.stdout.write(`${payload}\n`);
        }
        return;
    }
```

(c) Update the `usage()` string to include `semantic` in the `--snapshot-phase` list.

- [ ] **Step 3: Verify the JS emitter produces a well-formed shape**

Run:
```bash
node src/tests/js_oracle/export_ir_json.js src/demo/sokoban_basic.txt --snapshot-phase semantic
```
Expected: pretty-printed JSON with `schema_version`, `semantic_program.objects` (each `{id,name,layer}`), and `semantic_program.collision_layers` (arrays of ids). Confirm the object count and layer assignments look sane for sokoban (a handful of objects across a few layers).

- [ ] **Step 4: Commit**

```bash
git add src/tests/js_oracle/lib/puzzlescript_semantic_program.js src/tests/js_oracle/export_ir_json.js
git commit -m "feat(js-oracle): emit SemanticProgram shape via --snapshot-phase semantic

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Canonicalized JS↔C++ parity diff + CTest gate

**Files:**
- Create: `scripts/diff_semantic_program_against_js.sh`
- Modify: `native/CMakeLists.txt`

- [ ] **Step 1: Create the parity diff script**

Create `scripts/diff_semantic_program_against_js.sh` (then `chmod +x` it):

```bash
#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/diff_semantic_program_against_js.sh <source.txt>" >&2
  exit 1
fi

SOURCE_FILE="$1"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

JS_RAW="$TMP_DIR/js-raw.json"
CPP_RAW="$TMP_DIR/cpp-raw.json"
JS_OUT="$TMP_DIR/js-canon.json"
CPP_OUT="$TMP_DIR/cpp-canon.json"

node "$ROOT_DIR/src/tests/js_oracle/export_ir_json.js" "$SOURCE_FILE" "$JS_RAW" --snapshot-phase semantic
"$ROOT_DIR/build/native/puzzlescript_cpp" compile "$SOURCE_FILE" --emit-semantic-program > "$CPP_RAW"

# Canonicalize (recursively sort object keys) so JSON formatting and key order
# differences are ignored; only the resolved content is compared.
canon() {
  node -e 'const fs=require("fs");const sort=v=>Array.isArray(v)?v.map(sort):(v&&typeof v==="object"?Object.keys(v).sort().reduce((a,k)=>{a[k]=sort(v[k]);return a},{}):v);process.stdout.write(JSON.stringify(sort(JSON.parse(fs.readFileSync(process.argv[1],"utf8"))),null,2));' "$1"
}

canon "$JS_RAW" > "$JS_OUT"
canon "$CPP_RAW" > "$CPP_OUT"

diff -u "$JS_OUT" "$CPP_OUT"
```

- [ ] **Step 2: Run the diff manually (the real parity check)**

Ensure the CLI is built (`cmake --build build --target puzzlescript_cpp -j`), then run:
```bash
bash scripts/diff_semantic_program_against_js.sh src/demo/sokoban_basic.txt
echo "exit=$?"
```
Expected: no diff output and `exit=0` — JS and C++ agree on object ids, names, layers, and collision-layer membership. If they differ, the diff names the divergence (e.g. an id or layer mismatch); that is a real parity bug to fix in the producer before proceeding, not a test to loosen.

- [ ] **Step 3: Register the parity CTest gate**

In `native/CMakeLists.txt`, next to `puzzlescript_cpp_parser_state_diff_smoke` (~line 865), add:
```cmake
add_test(
  NAME puzzlescript_cpp_semantic_program_diff_smoke
  COMMAND bash ${PUZZLESCRIPT_REPO_ROOT}/scripts/diff_semantic_program_against_js.sh ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt
)
```

- [ ] **Step 4: Run the gate and the full suite**

Run:
```bash
cmake -S . -B build
ctest --test-dir build -R 'semantic_program' --output-on-failure
ctest --test-dir build --output-on-failure
```
Expected: `puzzlescript_cpp_semantic_program_smoke`, `compiler_semantic_program`, and `puzzlescript_cpp_semantic_program_diff_smoke` all pass, and the full suite stays green (no regressions).

- [ ] **Step 5: Commit**

```bash
git add scripts/diff_semantic_program_against_js.sh native/CMakeLists.txt
git commit -m "test(native): gate SemanticProgram JS<->C++ parity (slice 1)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (against the design doc):** The design requires `SemanticProgram` as "the clean post-parser contract," a JS "shape over its existing single-pass compile" used "only at the boundaries that are oracle-diffed," and a "JS `SemanticProgram` shape vs C++ `SemanticProgram`" parity test (Testing section). Slice 1 delivers all of those for the objects+layers subset: Task 1 (contract type + producer + serializer), Task 3 (JS shape over the existing compiled `state`), Task 4 (the parity diff). The design's "no lowerer rewire yet" intent is honored — the producer is a projection over `Game`. Remaining contract content (legends, levels, win conditions, rules, metadata) is explicitly deferred to follow-on slices, consistent with the writing-plans scope guidance that each plan produce working, testable software on its own.

**Placeholder scan:** No TBD/TODO/"handle errors appropriately" placeholders. Every code step ships complete code; every command states expected output. The deferred-fields note is an intentional scope statement, not a placeholder.

**Type/name consistency across tasks:** `SemanticProgram` / `SemanticObject` (Task 1 struct) → `buildSemanticProgram` / `serializeSemanticProgramJson` (Task 1 funcs, used identically in Task 2 CLI) → JSON keys `schema_version`, `semantic_program`, `objects` (`id`/`name`/`layer`), `collision_layers` (Task 1 serializer, matched field-for-field by Task 3's `buildSemanticProgramSnapshot`) → diffed in Task 4. The C++ serializer and JS emitter intentionally need not match byte-for-byte: the diff script canonicalizes both (recursive key sort + re-stringify), so only resolved content is compared.

**Risk notes:**
- The parity diff is the load-bearing check. If object-id assignment differs between JS and C++, Task 4 fails loudly — which is the desired behavior, since id-assignment parity is exactly what this contract exists to guard. Do not loosen the diff to make it pass; fix the producer.
- `appendJsonString` is duplicated (a copy exists in `parser.cpp`). This is accepted for slice 1 to avoid touching the proven ParserState serializer; extracting a shared `compiler/json_writer.hpp` is a future cleanup.
- The builder reads `game.objectsById` / `game.collisionLayers` directly; it sorts objects by `id` rather than assuming `objectsById` is id-indexed, so it is robust to either ordering.
