# Runtime/Compiler Decoupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `puzzlescript_native` runtime library link standalone with no parser/compiler symbols, by moving the source→game compile C API out of the runtime translation unit into the compiler library, guarded by a runtime-only link test.

**Architecture:** Today `native/src/runtime/c_api.cpp` implements `ps_compile_source` and its `ParserState`→`Game` glyph-publishing helpers, so it references `puzzlescript::compiler::parseSource` / `lowerToRuntimeGame`. That forces every runtime-only embedder (the SDL player, a snapshot/IR loader, the MIS bridge's runtime half) to drag in the whole compiler. We move that compile code into a new compiler-library translation unit `native/src/compiler/source_c_api.cpp`, leaving the runtime library free of compiler references. The dependency becomes strictly one-directional (compiler → runtime), which already holds for the rest of the compiler library.

**Tech Stack:** C++17, CMake (static libraries `puzzlescript_native` and `puzzlescript_compiler`), CTest.

**Scope note (deliberate):** This slice moves the compile C API *implementation* so the runtime library links standalone. It does **not** re-home the C declarations from `include/puzzlescript/puzzlescript.h` into `compiler.h` — that ripples into every caller (`cli/main.cpp`, the MIS bridge) and is a separate follow-up slice. The success criterion here is purely "`puzzlescript_native` links with no compiler symbols," which is achieved by moving the implementations.

**Prerequisite facts (verified against the tree at plan time):**
- Only `native/src/runtime/c_api.cpp` references the compiler in the runtime library; `compiled_rules.cpp`, `core.cpp`, `hash.cpp`, `json.cpp`, `simd.cpp`, and `solver/c_api.cpp` have zero compiler references.
- The mask helpers `maskHasAnyBit` / `setMaskBit` / `orMaskInto` / `storeMaskWords` and `resolveParserGlyphMask` / `publishParserGlyphs` are used **only** by `ps_compile_source`; nothing else in the runtime library uses them.
- `attachLinkedCompiledRules(Game&, std::string_view)` is a runtime symbol declared in `native/src/runtime/compiled_rules.hpp`.
- `struct ps_game` / `ps_compile_result` / `ps_error` are defined in the shared header `native/src/runtime/c_api_internal.hpp`.
- `CompileResult` is defined in `native/src/runtime/core.hpp:648` (a runtime type).
- The compiler library already references runtime symbols (e.g. `lower_to_runtime.cpp`), so compiler → runtime is an existing, acyclic dependency.

---

## File Structure

- **Create** `native/src/compiler/source_c_api.cpp` — the moved compile C API (`ps_compile_source`, `ps_compile_result_game`, `ps_compile_result_error`, `ps_free_compile_result`) plus the private glyph-publishing helpers. Compiled into `puzzlescript_compiler`.
- **Create** `native/tests/runtime_standalone_link.cpp` — a test that links **only** `puzzlescript_native` and exercises a runtime-only entry point. It is the regression guard: if compiler-coupled code ever leaks back into a runtime translation unit, this target fails to link.
- **Modify** `native/src/runtime/c_api.cpp` — remove the two compiler `#include`s, the now-unused `using puzzlescript::CompileResult;`, the glyph helpers, and the four `ps_compile_*` functions. Keep `ps_load_ir_json` and `ps_game_clone`.
- **Modify** `native/CMakeLists.txt` — add `src/compiler/source_c_api.cpp` to the compiler sources, make `puzzlescript_compiler` PUBLIC-link `puzzlescript_native`, and register the `runtime_standalone_link` test executable (linking only `puzzlescript_native`).

---

## Task 1: Decouple the runtime library from the compiler

This is one atomic change committed once. The runtime-only link guard is written first and observed failing (proving the coupling) before the move; the commit happens only after everything is green.

**Files:**
- Create: `native/tests/runtime_standalone_link.cpp`
- Create: `native/src/compiler/source_c_api.cpp`
- Modify: `native/src/runtime/c_api.cpp`
- Modify: `native/CMakeLists.txt`

- [ ] **Step 1: Write the runtime-only link guard test**

Create `native/tests/runtime_standalone_link.cpp`:

```cpp
#include <cassert>
#include <cstring>

#include "puzzlescript/puzzlescript.h"

// This test links ONLY puzzlescript_native (no puzzlescript_compiler). It exists
// to guarantee the runtime library is self-contained: a consumer that loads and
// steps runtime state (precompiled IR or a snapshot) must not need parser or
// compiler symbols. If ps_compile_source or any other compiler-coupled code
// leaks back into the runtime translation units, this target fails to LINK with
// undefined symbols (puzzlescript::compiler::parseSource / lowerToRuntimeGame).
int main() {
    ps_game* game = nullptr;
    ps_error* error = nullptr;
    const char* notJson = "{ this is not valid IR json";
    const bool loaded = ps_load_ir_json(notJson, std::strlen(notJson), &game, &error);
    assert(!loaded);          // invalid IR must fail to load
    assert(game == nullptr);  // no game produced on failure
    if (error != nullptr) {
        ps_free_error(error);
    }
    return 0;
}
```

- [ ] **Step 2: Register the guard test in CMake (linking only the runtime lib)**

In `native/CMakeLists.txt`, after the `compiler_compact_turn_support` test block (around line 480, before the `if(TARGET PkgConfig::SDL2)` SDL player smoke test), add:

```cmake
add_executable(runtime_standalone_link
  tests/runtime_standalone_link.cpp
)

target_link_libraries(runtime_standalone_link
  PRIVATE
    puzzlescript_native
)

add_test(
  NAME runtime_standalone_link
  COMMAND runtime_standalone_link
)
```

Note: this target intentionally links **only** `puzzlescript_native` and does **not** add `src` to its include path — it relies solely on the PUBLIC `include/puzzlescript/puzzlescript.h` that `puzzlescript_native` exposes.

- [ ] **Step 3: Configure and build the guard target — observe the link FAILURE (red)**

Run:
```bash
cmake -S . -B build
cmake --build build --target runtime_standalone_link
```
Expected: a link error proving the coupling, of the form:
```
Undefined symbols for architecture <arch>:
  "puzzlescript::compiler::parseSource(...)", referenced from:
      ps_compile_source(...) in libpuzzlescript_native.a(c_api.cpp.o)
  "puzzlescript::compiler::lowerToRuntimeGame(...)", referenced from:
      ps_compile_source(...) in libpuzzlescript_native.a(c_api.cpp.o)
ld: symbol(s) not found
```
This is the red state: the runtime library cannot link without the compiler because `c_api.cpp` defines `ps_compile_source`.

- [ ] **Step 4: Create the compiler-side compile C API translation unit**

Create `native/src/compiler/source_c_api.cpp` with the exact moved code:

```cpp
// Source-to-runtime-game compile C API.
//
// This lives in the COMPILER library (not the runtime library) so the runtime
// library puzzlescript_native stays standalone: a consumer that only loads and
// steps runtime state must not pull in parser/compiler symbols. The guard is
// native/tests/runtime_standalone_link.cpp.

#include "runtime/core.hpp"
#include "runtime/compiled_rules.hpp"
#include "runtime/c_api_internal.hpp"

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"

#include "puzzlescript/puzzlescript.h"

#include <algorithm>
#include <memory>
#include <set>
#include <string>
#include <string_view>
#include <vector>

using puzzlescript::CompileResult;
using puzzlescript::Error;
using puzzlescript::Game;
using puzzlescript::LoadedGame;

namespace {

bool maskHasAnyBit(const std::vector<puzzlescript::MaskWord>& mask) {
    return std::any_of(mask.begin(), mask.end(), [](puzzlescript::MaskWord word) {
        return word != 0;
    });
}

void setMaskBit(std::vector<puzzlescript::MaskWord>& mask, int32_t objectId) {
    if (objectId < 0) {
        return;
    }
    const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(objectId));
    if (word >= mask.size()) {
        return;
    }
    mask[static_cast<size_t>(word)] |= puzzlescript::maskBit(static_cast<uint32_t>(objectId));
}

void orMaskInto(std::vector<puzzlescript::MaskWord>& target, const std::vector<puzzlescript::MaskWord>& source) {
    const size_t count = std::min(target.size(), source.size());
    for (size_t index = 0; index < count; ++index) {
        target[index] |= source[index];
    }
}

puzzlescript::MaskOffset storeMaskWords(Game& game, const std::vector<puzzlescript::MaskWord>& words) {
    const auto offset = static_cast<puzzlescript::MaskOffset>(game.maskArena.size());
    game.maskArena.insert(game.maskArena.end(), words.begin(), words.end());
    return offset;
}

std::vector<puzzlescript::MaskWord> resolveParserGlyphMask(
    const Game& game,
    const puzzlescript::compiler::ParserState& parserState,
    const std::string& name,
    std::set<std::string>& visiting
) {
    std::vector<puzzlescript::MaskWord> mask(static_cast<size_t>(game.wordCount), 0);
    if (!visiting.insert(name).second) {
        return mask;
    }

    if (parserState.objects.find(name) != parserState.objects.end()) {
        for (const auto& object : game.objectsById) {
            if (object.name == name) {
                setMaskBit(mask, object.id);
                break;
            }
        }
        visiting.erase(name);
        return mask;
    }

    for (const auto& entry : parserState.legendSynonyms) {
        if (entry.name == name && !entry.items.empty()) {
            mask = resolveParserGlyphMask(game, parserState, entry.items.front(), visiting);
            visiting.erase(name);
            return mask;
        }
    }

    for (const auto& entry : parserState.legendAggregates) {
        if (entry.name != name) {
            continue;
        }
        for (const auto& item : entry.items) {
            orMaskInto(mask, resolveParserGlyphMask(game, parserState, item, visiting));
        }
        visiting.erase(name);
        return mask;
    }

    visiting.erase(name);
    return mask;
}

void publishParserGlyphs(Game& game, const puzzlescript::compiler::ParserState& parserState) {
    game.glyphOrder.clear();
    game.glyphMaskTable.clear();
    game.glyphOrder.reserve(parserState.abbrevNames.size());
    game.glyphMaskTable.reserve(parserState.abbrevNames.size());

    for (const std::string& name : parserState.abbrevNames) {
        std::set<std::string> visiting;
        std::vector<puzzlescript::MaskWord> mask = resolveParserGlyphMask(game, parserState, name, visiting);
        if (!maskHasAnyBit(mask)) {
            continue;
        }
        game.glyphOrder.push_back(name);
        game.glyphMaskTable.push_back({name, storeMaskWords(game, mask)});
    }
}

} // namespace

bool ps_compile_source(const char* source_utf8, size_t source_size, ps_compile_result** out_result) {
    if (!out_result) {
        return false;
    }
    auto* wrapper = new ps_compile_result();
    wrapper->impl = std::make_unique<CompileResult>();
    try {
        puzzlescript::compiler::DiagnosticSink diagnostics;
        const auto state = puzzlescript::compiler::parseSource(
            source_utf8 == nullptr ? std::string_view{} : std::string_view(source_utf8, source_size),
            diagnostics
        );
        // For now, treat any lowering failure as a compile error. (Once lowering
        // is implemented, we can choose to gate on diagnostic severity.)
        LoadedGame loadedGame;
        if (auto error = puzzlescript::compiler::lowerToRuntimeGame(state, loadedGame)) {
            wrapper->impl->error = std::move(error);
            *out_result = wrapper;
            return false;
        }
        if (loadedGame.information) {
            publishParserGlyphs(*std::const_pointer_cast<Game>(loadedGame.information), state);
            puzzlescript::attachLinkedCompiledRules(
                *std::const_pointer_cast<Game>(loadedGame.information),
                source_utf8 == nullptr ? std::string_view{} : std::string_view(source_utf8, source_size)
            );
        }
        wrapper->impl->loadedGame = std::move(loadedGame);
        *out_result = wrapper;
        return true;
    } catch (const std::exception& e) {
        wrapper->impl->error = std::make_unique<Error>(e.what());
        *out_result = wrapper;
        return false;
    }
}

const ps_game* ps_compile_result_game(const ps_compile_result* result) {
    if (!result || !result->impl || !result->impl->loadedGame.information) {
        return nullptr;
    }
    auto* wrapper = new ps_game();
    wrapper->impl = result->impl->loadedGame;
    return wrapper;
}

const ps_error* ps_compile_result_error(const ps_compile_result* result) {
    if (!result || !result->impl || !result->impl->error) {
        return nullptr;
    }
    auto* wrapper = new ps_error();
    wrapper->impl = std::make_unique<Error>(result->impl->error->message);
    return wrapper;
}

void ps_free_compile_result(ps_compile_result* result) {
    delete result;
}
```

- [ ] **Step 5: Strip the moved code from the runtime translation unit**

Edit `native/src/runtime/c_api.cpp`:

(a) Remove the two compiler includes (currently lines 13-14, note the leading space):
```cpp
 #include "compiler/lower_to_runtime.hpp"
 #include "compiler/parser.hpp"
```

(b) Remove the now-unused using declaration (line 16):
```cpp
using puzzlescript::CompileResult;
```

(c) Remove the entire glyph-helper block — the six functions from `maskHasAnyBit` through `publishParserGlyphs` (currently lines 44-134). The block to delete starts at:
```cpp
bool maskHasAnyBit(const std::vector<puzzlescript::MaskWord>& mask) {
```
and ends at the closing brace of `publishParserGlyphs`, immediately before:
```cpp
struct CompactOracleState {
```
Leave `makeError` and `duplicateString` (above the block) and `CompactOracleState` (below it) intact.

(d) Remove `ps_compile_source` in its entirety (currently lines 238-273), the block beginning:
```cpp
bool ps_compile_source(const char* source_utf8, size_t source_size, ps_compile_result** out_result) {
```
through its closing brace.

(e) Remove `ps_compile_result_game` (currently lines 275-282), the block beginning:
```cpp
const ps_game* ps_compile_result_game(const ps_compile_result* result) {
```
through its closing brace. **Keep** `ps_game_clone` immediately below it.

(f) Remove `ps_compile_result_error` and `ps_free_compile_result` (currently lines 305-316), the blocks beginning:
```cpp
const ps_error* ps_compile_result_error(const ps_compile_result* result) {
```
through the closing brace of:
```cpp
void ps_free_compile_result(ps_compile_result* result) {
    delete result;
}
```

After these edits, `native/src/runtime/c_api.cpp` must contain zero occurrences of `compiler/`, `compiler::`, `parseSource`, or `lowerToRuntimeGame`. Verify with:
```bash
grep -nE 'compiler/|compiler::|parseSource|lowerToRuntimeGame' native/src/runtime/c_api.cpp
```
Expected: no output.

- [ ] **Step 6: Wire the new source into the compiler library and declare the dependency**

In `native/CMakeLists.txt`, add the new file to `PUZZLESCRIPT_COMPILER_SOURCES` (the `set(...)` currently at lines 73-85). Insert after `src/compiler/c_api.cpp`:
```cmake
  src/compiler/source_c_api.cpp
```

Then, immediately after the `target_compile_definitions(puzzlescript_compiler ...)` block (currently ending around line 129), add an explicit compiler → runtime link so the compiler library's new runtime-symbol references are expressed in the build graph:
```cmake
target_link_libraries(puzzlescript_compiler
  PUBLIC
    puzzlescript_native
)
```
This is valid because `puzzlescript_native` is defined earlier (line 98) and the dependency is acyclic (runtime never references the compiler after this change).

- [ ] **Step 7: Rebuild the guard target — observe it links (green)**

Run:
```bash
cmake -S . -B build
cmake --build build --target runtime_standalone_link
```
Expected: clean build, no undefined-symbol errors. Then run it:
```bash
ctest --test-dir build -R runtime_standalone_link --output-on-failure
```
Expected: `1/1 Test #...: runtime_standalone_link ... Passed`.

- [ ] **Step 8: Build everything and run the full test suite (no regressions)**

Run:
```bash
cmake --build build
ctest --test-dir build --output-on-failure
```
Expected: the full build succeeds (including `puzzlescript_cpp`, `puzzlescript_solver`, `puzzlescript_generator`, `puzzlescript_cpp_player_api_tests`, and `puzzlescriptmis_native_bridge_smoke`, all of which link both libraries and still resolve `ps_compile_source` from the compiler library), and all CTest cases pass.

- [ ] **Step 9: Commit**

```bash
git add native/src/compiler/source_c_api.cpp native/src/runtime/c_api.cpp native/tests/runtime_standalone_link.cpp native/CMakeLists.txt
git commit -m "refactor(native): move compile C API into compiler lib so runtime links standalone

Move ps_compile_source and its ParserState->Game glyph helpers out of
runtime/c_api.cpp into compiler/source_c_api.cpp, leaving puzzlescript_native
free of parser/compiler symbols. Add runtime_standalone_link, a test that links
only puzzlescript_native, as a regression guard.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (against the design doc's Lowerer And Runtime Core / Native Library Shape):** The design requires "`ps_compile_source` moves out of the runtime-only boundary" and "a consumer that embeds only runtime state loading/stepping should not need parser/compiler symbols." Task 1 moves `ps_compile_source` (and its compile-result siblings + helpers) into the compiler library and proves the runtime links standalone via `runtime_standalone_link`. The broader staged-contract and executor-mode goals are explicitly out of this slice (they are separate plans).

**Placeholder scan:** No TBD/TODO/"handle errors appropriately" placeholders. Every code step shows complete code; every command shows expected output. The one inline comment retained inside `ps_compile_source` ("Once lowering is implemented...") is copied verbatim from the existing source, not a plan placeholder.

**Type consistency:** Symbol names match the verified tree — `ps_compile_source`, `ps_compile_result_game`, `ps_compile_result_error`, `ps_free_compile_result`, `publishParserGlyphs`, `resolveParserGlyphMask`, `attachLinkedCompiledRules`, `CompileResult`, `LoadedGame`, `Game`, and the `ps_game`/`ps_compile_result`/`ps_error` structs from `c_api_internal.hpp`. `ps_load_ir_json`, `ps_free_error`, and `ps_game_clone` remain in the runtime TU.

**Risk note:** The only behavioral surface that changes is *where* the four `ps_compile_*` symbols are defined, not *what* they do — the bodies are moved verbatim. Existing consumers link both libraries, so they are unaffected. If `target_link_libraries(puzzlescript_compiler PUBLIC puzzlescript_native)` produces a link-order warning on any consumer that also lists both libraries explicitly, it is benign (duplicate static-lib references are de-duplicated by the linker).
