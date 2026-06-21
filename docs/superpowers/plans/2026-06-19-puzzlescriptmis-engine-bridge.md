# PuzzleScript+MIS Engine Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first standalone PuzzleScript+MIS milestone by vendoring the permitted openFrameworks app and replacing its compile/play engine path with PuzzleScript-labs native compiler/runtime libraries.

**Architecture:** Keep PuzzleScript+MIS as the app shell under `tools/puzzlescriptmis-app/`. Add a small native runtime C API for efficient board snapshots, then add a `NativeGameBridge` that owns native handles and a `NativeGameFacade` that fills the existing PuzzleScript+MIS `Game` display cache while play commands run through the native engine. Disable transformer/generator entry points with a clear not-yet-wired state for this milestone.

**Tech Stack:** C++17, CMake, openFrameworks, PuzzleScript-labs `puzzlescript_compiler` and `puzzlescript_native` static libraries, existing PuzzleScript+MIS source layout.

---

## File Structure

- Create `tools/puzzlescriptmis-app/`: vendored PuzzleScript+MIS source, excluding packaged binaries and generated object/build directories.
- Create `tools/puzzlescriptmis-app/UPSTREAM.md`: upstream commit, permission note, and vendoring exclusions.
- Create `tools/puzzlescriptmis-app/config.make`: local openFrameworks build config that includes native headers and links native static libraries.
- Create `tools/puzzlescriptmis-app/scripts/build_native_deps.sh`: builds `puzzlescript_native` and `puzzlescript_compiler` before the openFrameworks app build.
- Create `tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.h`.
- Create `tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.cpp`.
- Create `tools/puzzlescriptmis-app/src/native_bridge/NativeGameFacade.h`.
- Create `tools/puzzlescriptmis-app/src/native_bridge/NativeGameFacade.cpp`.
- Create `tools/puzzlescriptmis-app/tests/native_bridge_smoke.cpp`.
- Modify `native/include/puzzlescript/puzzlescript.h`: add layer count and current-board layer snapshot APIs.
- Modify `native/src/runtime/c_api.cpp`: implement those APIs.
- Modify `native/tests/player_api_tests.cpp`: cover snapshot APIs.
- Modify root `CMakeLists.txt`: add the bridge smoke test executable after `add_subdirectory(native)`.
- Modify `tools/puzzlescriptmis-app/src/visualsandide.cpp`: use native compile facade and disable transformer/generator UI entry points.
- Modify `tools/puzzlescriptmis-app/src/global.cpp`: load levels through native facade.
- Modify `tools/puzzlescriptmis-app/src/keyHandling.cpp`: route play input, undo, and restart through native facade; leave solver key inert.
- Modify `tools/puzzlescriptmis-app/src/generation.cpp`: make generation start/stop/status no-op for this milestone.

## Task 1: Vendor PuzzleScript+MIS App Source

**Files:**
- Create: `tools/puzzlescriptmis-app/`
- Create: `tools/puzzlescriptmis-app/UPSTREAM.md`
- Modify: `.gitignore`

- [ ] **Step 1: Fetch upstream source**

Run:

```bash
rm -rf /tmp/puzzlescriptmis-vendor
git clone --depth 1 https://github.com/bvoq/puzzlescriptmis.git /tmp/puzzlescriptmis-vendor
git -C /tmp/puzzlescriptmis-vendor rev-parse HEAD
```

Expected: clone succeeds and prints one commit SHA. Save that SHA for `UPSTREAM.md`.

- [ ] **Step 2: Vendor source without shipped binaries/build output**

Run:

```bash
mkdir -p tools/puzzlescriptmis-app
rsync -a /tmp/puzzlescriptmis-vendor/ tools/puzzlescriptmis-app/ \
  --exclude '.git/' \
  --exclude 'bin/' \
  --exclude 'obj/' \
  --exclude 'bscwriteup3/build/' \
  --exclude 'bscwriteup3/.texpadtmp/' \
  --exclude 'bscwriteup3/.ttttex/' \
  --exclude 'src/a.out' \
  --exclude 'src/a.out.dSYM/'
```

Expected: `tools/puzzlescriptmis-app/src/ofApp.cpp`, `tools/puzzlescriptmis-app/Makefile`, and `tools/puzzlescriptmis-app/data/font/` exist.

- [ ] **Step 3: Add upstream record**

Create `tools/puzzlescriptmis-app/UPSTREAM.md`:

```markdown
# PuzzleScript+MIS Upstream

This directory vendors the permitted PuzzleScript+MIS openFrameworks application from:

https://github.com/bvoq/puzzlescriptmis

Vendored source commit: `1ddb2ea43374ff19cb630783e35332c09dddbf45`

Stephen has permission from the upstream author to use this code for this engine-bridge work.

The vendored copy intentionally excludes packaged binaries and generated build output:

- `bin/`
- `obj/`
- `src/a.out`
- `src/a.out.dSYM/`
- temporary TeX build directories under `bscwriteup3/`

The first milestone keeps the openFrameworks front-end and replaces the PuzzleScript parser/runtime path with PuzzleScript-labs native libraries.
```

If Step 1 prints a different SHA because upstream moved before implementation starts, use the SHA printed by Step 1 in this file.

- [ ] **Step 4: Ignore local openFrameworks build artifacts**

Add these lines to `.gitignore` if they are not already covered:

```gitignore
/tools/puzzlescriptmis-app/bin/
/tools/puzzlescriptmis-app/obj/
/tools/puzzlescriptmis-app/.vscode/
/tools/puzzlescriptmis-app/Debug/
/tools/puzzlescriptmis-app/Release/
```

- [ ] **Step 5: Commit vendored app source**

Run:

```bash
git add .gitignore tools/puzzlescriptmis-app
git commit -m "vendor: add puzzlescriptmis app shell"
```

Expected: commit succeeds and includes source/project files but no `bin/` or `obj/` binaries.

## Task 2: Add Native Board Snapshot And Glyph C APIs

**Files:**
- Modify: `native/include/puzzlescript/puzzlescript.h`
- Modify: `native/src/runtime/c_api.cpp`
- Modify: `native/tests/player_api_tests.cpp`

- [ ] **Step 1: Add failing API usage test**

In `native/tests/player_api_tests.cpp`, add this handle and helper after `serializedState`:

```cpp
struct GameHandle {
    const ps_game* game = nullptr;
    ~GameHandle() { ps_free_game(const_cast<ps_game*>(game)); }
};

int32_t findObjectIdByName(const ps_game* game, const char* name) {
    const int32_t objectCount = ps_game_object_count(game);
    for (int32_t objectId = 0; objectId < objectCount; ++objectId) {
        ps_object_info info{};
        require(ps_game_object_info(game, objectId, &info), "object info lookup failed");
        if (std::strcmp(info.name, name) == 0) {
            return objectId;
        }
    }
    return -1;
}
```

Then add this test function before `runCompiledCompactSolverFreshScratchRegression`:

```cpp
void runLayerCellSnapshotApiTest() {
    CompileHandle compiled;
    require(ps_compile_source(kSource, std::strlen(kSource), &compiled.result), "snapshot api compile failed");
    GameHandle gameHandle{ps_compile_result_game(compiled.result)};
    const ps_game* game = gameHandle.game;
    require(game != nullptr, "snapshot api compile produced no game");

    const int32_t layerCount = ps_game_layer_count(game);
    require(layerCount >= 2, "snapshot api expected at least two layers");

    SessionHandle session;
    ps_error* error = nullptr;
    require(ps_full_state_create(game, &session.state, &error), "snapshot api state create failed");

    ps_full_state_status_info status{};
    ps_full_state_status(session.state, &status);
    require(status.width == 2, "snapshot api expected width 2");
    require(status.height == 1, "snapshot api expected height 1");

    const size_t required = ps_full_state_layer_cell_object_ids(session.state, nullptr, 0);
    require(required == static_cast<size_t>(layerCount * status.width * status.height), "snapshot api required size mismatch");

    std::vector<int32_t> cells(required, -99);
    const size_t written = ps_full_state_layer_cell_object_ids(session.state, cells.data(), cells.size());
    require(written == required, "snapshot api written size mismatch");

    const int32_t playerId = findObjectIdByName(game, "player");
    require(playerId >= 0, "snapshot api did not find player object");

    ps_object_info playerInfo{};
    require(ps_game_object_info(game, playerId, &playerInfo), "snapshot api player info failed");
    const size_t playerCellOffset = static_cast<size_t>(playerInfo.layer * status.width * status.height);
    require(cells[playerCellOffset] == playerId, "snapshot api expected player in first cell on player layer");

    const int32_t glyphCount = ps_game_glyph_count(game);
    require(glyphCount > 0, "snapshot api expected glyphs");
    bool sawPlayerGlyph = false;
    for (int32_t glyphIndex = 0; glyphIndex < glyphCount; ++glyphIndex) {
        const char* glyph = ps_game_glyph_name(game, glyphIndex);
        const size_t glyphRequired = ps_game_glyph_object_ids(game, glyphIndex, nullptr, 0);
        std::vector<int32_t> glyphObjectIds(glyphRequired, -1);
        ps_game_glyph_object_ids(game, glyphIndex, glyphObjectIds.data(), glyphObjectIds.size());
        if (std::strcmp(glyph, "P") == 0 || std::strcmp(glyph, "p") == 0) {
            sawPlayerGlyph = true;
            require(glyphObjectIds.size() == 1, "snapshot api expected P glyph to map one object");
            require(glyphObjectIds[0] == playerId, "snapshot api expected P glyph to map player");
        }
    }
    require(sawPlayerGlyph, "snapshot api did not find player glyph");
}
```

Call it from `main()` near the existing API tests:

```cpp
runLayerCellSnapshotApiTest();
```

- [ ] **Step 2: Verify the test fails to compile**

Run:

```bash
cmake --build build --target puzzlescript_cpp_player_api_tests
```

Expected: compile fails because `ps_game_layer_count`, `ps_game_glyph_count`, `ps_game_glyph_name`, `ps_game_glyph_object_ids`, and `ps_full_state_layer_cell_object_ids` are not declared.

- [ ] **Step 3: Declare the C API**

In `native/include/puzzlescript/puzzlescript.h`, add these declarations after `ps_game_object_count`:

```cpp
int32_t ps_game_layer_count(const ps_game* game);
int32_t ps_game_glyph_count(const ps_game* game);
const char* ps_game_glyph_name(const ps_game* game, int32_t glyph_index);
size_t ps_game_glyph_object_ids(const ps_game* game, int32_t glyph_index, int32_t* output, size_t capacity);
```

Add this declaration after `ps_full_state_cell_has_object`:

```cpp
size_t ps_full_state_layer_cell_object_ids(const ps_full_state* state, int32_t* output, size_t capacity);
```

Contract: return the required flattened size `layer_count * width * height`; when `output` is non-null, write native object ids or `-1` for empty cells in layer-major order:

```text
offset = layer * width * height + y * width + x
```

- [ ] **Step 4: Implement the C API**

In `native/src/runtime/c_api.cpp`, add this function after `ps_game_object_count`:

```cpp
int32_t ps_game_layer_count(const ps_game* game) {
    return game && game->impl.information ? game->impl.information->layerCount : 0;
}

int32_t ps_game_glyph_count(const ps_game* game) {
    return game && game->impl.information ? static_cast<int32_t>(game->impl.information->glyphOrder.size()) : 0;
}

const char* ps_game_glyph_name(const ps_game* game, int32_t glyph_index) {
    if (!game || !game->impl.information || glyph_index < 0) {
        return "";
    }
    const auto& glyphs = game->impl.information->glyphOrder;
    if (static_cast<size_t>(glyph_index) >= glyphs.size()) {
        return "";
    }
    return glyphs[static_cast<size_t>(glyph_index)].c_str();
}

size_t ps_game_glyph_object_ids(const ps_game* game, int32_t glyph_index, int32_t* output, size_t capacity) {
    if (!game || !game->impl.information || glyph_index < 0) {
        return 0;
    }
    const Game& impl = *game->impl.information;
    if (static_cast<size_t>(glyph_index) >= impl.glyphOrder.size()) {
        return 0;
    }

    const std::string& glyph = impl.glyphOrder[static_cast<size_t>(glyph_index)];
    puzzlescript::MaskOffset glyphMaskOffset = puzzlescript::kNullMaskOffset;
    for (const auto& entry : impl.glyphMaskTable) {
        if (entry.name == glyph) {
            glyphMaskOffset = entry.offset;
            break;
        }
    }
    if (glyphMaskOffset == puzzlescript::kNullMaskOffset) {
        return 0;
    }

    const puzzlescript::MaskWord* mask = impl.maskArena.data() + glyphMaskOffset;
    size_t required = 0;
    for (int32_t objectId = 0; objectId < impl.objectCount; ++objectId) {
        const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(objectId));
        if (word >= impl.wordCount) {
            continue;
        }
        if ((mask[word] & puzzlescript::maskBit(static_cast<uint32_t>(objectId))) == 0) {
            continue;
        }
        if (output && required < capacity) {
            output[required] = objectId;
        }
        ++required;
    }
    return required;
}
```

Add this function after `ps_full_state_cell_has_object`:

```cpp
size_t ps_full_state_layer_cell_object_ids(const ps_full_state* state, int32_t* output, size_t capacity) {
    if (!state || !state->impl || !state->impl->game) {
        return 0;
    }
    const FullState& impl = *state->impl;
    const int32_t width = currentLevelWidth(impl);
    const int32_t height = currentLevelHeight(impl);
    const int32_t layerCount = impl.game->layerCount;
    if (width <= 0 || height <= 0 || layerCount <= 0) {
        return 0;
    }

    const size_t required = static_cast<size_t>(layerCount) * static_cast<size_t>(width) * static_cast<size_t>(height);
    if (!output || capacity == 0) {
        return required;
    }

    const size_t writable = std::min(required, capacity);
    std::fill(output, output + writable, -1);

    const int32_t tileCount = width * height;
    for (int32_t tileIndex = 0; tileIndex < tileCount; ++tileIndex) {
        const int32_t x = tileIndex / height;
        const int32_t y = tileIndex % height;
        const size_t tileBase = static_cast<size_t>(tileIndex * impl.game->strideObject);

        for (int32_t objectId = 0; objectId < impl.game->objectCount; ++objectId) {
            const auto& object = impl.game->objectsById[static_cast<size_t>(objectId)];
            if (object.layer < 0 || object.layer >= layerCount) {
                continue;
            }
            const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(objectId));
            if (word >= impl.game->wordCount) {
                continue;
            }
            const size_t objectOffset = tileBase + word;
            if (objectOffset >= impl.levelState.board.objects.size()) {
                continue;
            }
            if ((impl.levelState.board.objects[objectOffset] & puzzlescript::maskBit(static_cast<uint32_t>(objectId))) == 0) {
                continue;
            }
            const size_t outOffset = static_cast<size_t>(object.layer * width * height + y * width + x);
            if (outOffset < writable) {
                output[outOffset] = objectId;
            }
        }
    }

    return required;
}
```

- [ ] **Step 5: Run the native API test**

Run:

```bash
cmake --build build --target puzzlescript_cpp_player_api_tests
./build/native/puzzlescript_cpp_player_api_tests
```

Expected: build succeeds and test exits with status 0.

- [ ] **Step 6: Commit the API expansion**

Run:

```bash
git add native/include/puzzlescript/puzzlescript.h native/src/runtime/c_api.cpp native/tests/player_api_tests.cpp
git commit -m "feat: expose native board snapshots and glyphs"
```

## Task 3: Add OpenFrameworks-Independent NativeGameBridge

**Files:**
- Create: `tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.h`
- Create: `tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.cpp`
- Create: `tools/puzzlescriptmis-app/tests/native_bridge_smoke.cpp`
- Modify: `CMakeLists.txt`

- [ ] **Step 1: Create the bridge header**

Create `tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.h`:

```cpp
#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "puzzlescript/compiler.h"
#include "puzzlescript/puzzlescript.h"

namespace psbridge {

struct Diagnostic {
    int32_t line = -1;
    std::string message;
};

struct ObjectInfo {
    int32_t nativeId = -1;
    int32_t displayId = 0;
    int32_t layer = -1;
    std::string name;
    std::vector<std::string> colors;
    int32_t spriteWidth = 0;
    int32_t spriteHeight = 0;
    std::vector<int32_t> sprite;
};

struct GlyphInfo {
    std::string glyph;
    std::vector<int32_t> displayObjectIds;
};

struct Status {
    ps_full_state_mode mode = PS_FULL_STATE_MODE_LEVEL;
    int32_t currentLevelIndex = 0;
    int32_t width = 0;
    int32_t height = 0;
    bool canUndo = false;
    bool winning = false;
    std::string messageText;
};

struct LayerGrid {
    int32_t layerCount = 0;
    int32_t width = 0;
    int32_t height = 0;
    std::vector<int32_t> displayObjectIds;
};

class NativeGameBridge {
public:
    NativeGameBridge();
    ~NativeGameBridge();

    NativeGameBridge(const NativeGameBridge&) = delete;
    NativeGameBridge& operator=(const NativeGameBridge&) = delete;

    bool compileSource(const std::string& source);
    bool hasGame() const;
    const Diagnostic& lastDiagnostic() const;

    int32_t levelCount() const;
    int32_t objectCount() const;
    int32_t layerCount() const;
    std::vector<ObjectInfo> objects() const;
    std::vector<GlyphInfo> glyphs() const;

    bool createState();
    bool loadLevel(int32_t levelIndex);
    bool step(ps_input input, bool* outWon);
    bool undo();
    bool restart();

    Status status() const;
    LayerGrid currentLayerGrid() const;

private:
    struct CompileResultDeleter {
        void operator()(ps_compile_result* value) const { ps_free_compile_result(value); }
    };
    struct CompilerResultDeleter {
        void operator()(ps_compiler_result* value) const { ps_compiler_result_free(value); }
    };
    struct GameDeleter {
        void operator()(const ps_game* value) const { ps_free_game(const_cast<ps_game*>(value)); }
    };
    struct StateDeleter {
        void operator()(ps_full_state* value) const { ps_full_state_destroy(value); }
    };
    struct ErrorDeleter {
        void operator()(ps_error* value) const { ps_free_error(value); }
    };

    using CompileResultPtr = std::unique_ptr<ps_compile_result, CompileResultDeleter>;
    using CompilerResultPtr = std::unique_ptr<ps_compiler_result, CompilerResultDeleter>;
    using GamePtr = std::unique_ptr<const ps_game, GameDeleter>;
    using StatePtr = std::unique_ptr<ps_full_state, StateDeleter>;
    using ErrorPtr = std::unique_ptr<ps_error, ErrorDeleter>;

    const ps_game* game() const;
    void setError(const char* message, int32_t line = -1);

    CompileResultPtr compileResult_;
    GamePtr game_;
    StatePtr state_;
    Diagnostic lastDiagnostic_;
};

ps_input toNativeInput(int moveDir);

} // namespace psbridge
```

- [ ] **Step 2: Create the bridge implementation**

Create `tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.cpp`:

```cpp
#include "native_bridge/NativeGameBridge.h"

#include <algorithm>

namespace psbridge {

NativeGameBridge::NativeGameBridge() = default;
NativeGameBridge::~NativeGameBridge() = default;

void NativeGameBridge::setError(const char* message, int32_t line) {
    lastDiagnostic_.line = line;
    lastDiagnostic_.message = message ? message : "Unknown native PuzzleScript error";
}

const ps_game* NativeGameBridge::game() const {
    return game_.get();
}

bool NativeGameBridge::compileSource(const std::string& source) {
    ps_compile_result* raw = nullptr;
    if (!ps_compile_source(source.data(), source.size(), &raw)) {
        compileResult_.reset(raw);
        game_.reset();
        state_.reset();
        CompilerResultPtr diagnostics(ps_compiler_compile_source_diagnostics(source.data(), source.size()));
        for (size_t index = 0; diagnostics && index < ps_compiler_result_diagnostic_count(diagnostics.get()); ++index) {
            const ps_diagnostic* diagnostic = ps_compiler_result_diagnostic(diagnostics.get(), index);
            if (diagnostic && diagnostic->severity == PS_DIAG_ERROR) {
                setError(diagnostic->message, diagnostic->line);
                return false;
            }
        }
        ErrorPtr error(compileResult_ ? const_cast<ps_error*>(ps_compile_result_error(compileResult_.get())) : nullptr);
        setError(ps_error_message(error.get()));
        return false;
    }

    compileResult_.reset(raw);
    game_.reset(ps_compile_result_game(compileResult_.get()));
    state_.reset();
    lastDiagnostic_ = Diagnostic{};
    if (!game_) {
        setError("Native compile succeeded but produced no game");
        return false;
    }
    return createState();
}

bool NativeGameBridge::hasGame() const {
    return game() != nullptr;
}

const Diagnostic& NativeGameBridge::lastDiagnostic() const {
    return lastDiagnostic_;
}

int32_t NativeGameBridge::levelCount() const {
    return game() ? ps_game_level_count(game()) : 0;
}

int32_t NativeGameBridge::objectCount() const {
    return game() ? ps_game_object_count(game()) : 0;
}

int32_t NativeGameBridge::layerCount() const {
    return game() ? ps_game_layer_count(game()) : 0;
}

std::vector<ObjectInfo> NativeGameBridge::objects() const {
    std::vector<ObjectInfo> out;
    const ps_game* compiledGame = game();
    if (!compiledGame) {
        return out;
    }

    const int32_t count = ps_game_object_count(compiledGame);
    out.reserve(static_cast<size_t>(count));
    for (int32_t objectId = 0; objectId < count; ++objectId) {
        ps_object_info info{};
        if (!ps_game_object_info(compiledGame, objectId, &info)) {
            continue;
        }

        ObjectInfo object;
        object.nativeId = objectId;
        object.displayId = objectId + 1;
        object.layer = info.layer;
        object.name = info.name ? info.name : "";
        object.spriteWidth = info.sprite_width;
        object.spriteHeight = info.sprite_height;
        for (size_t colorIndex = 0; colorIndex < info.color_count; ++colorIndex) {
            object.colors.push_back(ps_game_object_color(compiledGame, objectId, colorIndex));
        }
        object.sprite.reserve(static_cast<size_t>(std::max(0, object.spriteWidth * object.spriteHeight)));
        for (int32_t y = 0; y < object.spriteHeight; ++y) {
            for (int32_t x = 0; x < object.spriteWidth; ++x) {
                object.sprite.push_back(ps_game_object_sprite_value(compiledGame, objectId, x, y));
            }
        }
        out.push_back(std::move(object));
    }
    return out;
}

std::vector<GlyphInfo> NativeGameBridge::glyphs() const {
    std::vector<GlyphInfo> out;
    const ps_game* compiledGame = game();
    if (!compiledGame) {
        return out;
    }

    const int32_t count = ps_game_glyph_count(compiledGame);
    out.reserve(static_cast<size_t>(count));
    for (int32_t glyphIndex = 0; glyphIndex < count; ++glyphIndex) {
        GlyphInfo glyph;
        glyph.glyph = ps_game_glyph_name(compiledGame, glyphIndex);
        const size_t required = ps_game_glyph_object_ids(compiledGame, glyphIndex, nullptr, 0);
        std::vector<int32_t> nativeIds(required, -1);
        ps_game_glyph_object_ids(compiledGame, glyphIndex, nativeIds.data(), nativeIds.size());
        glyph.displayObjectIds.reserve(nativeIds.size());
        for (int32_t nativeId : nativeIds) {
            if (nativeId >= 0) {
                glyph.displayObjectIds.push_back(nativeId + 1);
            }
        }
        out.push_back(std::move(glyph));
    }
    return out;
}

bool NativeGameBridge::createState() {
    const ps_game* compiledGame = game();
    if (!compiledGame) {
        setError("Cannot create native state without a compiled game");
        return false;
    }
    ps_full_state* rawState = nullptr;
    ps_error* rawError = nullptr;
    if (!ps_full_state_create(compiledGame, &rawState, &rawError)) {
        ErrorPtr error(rawError);
        setError(ps_error_message(error.get()));
        state_.reset();
        return false;
    }
    state_.reset(rawState);
    return true;
}

bool NativeGameBridge::loadLevel(int32_t levelIndex) {
    if (!state_) {
        return false;
    }
    ps_error* rawError = nullptr;
    if (!ps_full_state_load_level(state_.get(), levelIndex, &rawError)) {
        ErrorPtr error(rawError);
        setError(ps_error_message(error.get()));
        return false;
    }
    return true;
}

bool NativeGameBridge::step(ps_input input, bool* outWon) {
    if (outWon) {
        *outWon = false;
    }
    if (!state_) {
        return false;
    }
    const ps_step_result result = ps_full_state_turn(state_.get(), input);
    if (outWon) {
        *outWon = result.won;
    }
    return true;
}

bool NativeGameBridge::undo() {
    return state_ && ps_full_state_undo(state_.get());
}

bool NativeGameBridge::restart() {
    return state_ && ps_full_state_restart(state_.get());
}

Status NativeGameBridge::status() const {
    Status out;
    if (!state_) {
        return out;
    }
    ps_full_state_status_info raw{};
    ps_full_state_status(state_.get(), &raw);
    out.mode = raw.mode;
    out.currentLevelIndex = raw.current_level_index;
    out.width = raw.width;
    out.height = raw.height;
    out.canUndo = raw.can_undo;
    out.winning = raw.winning;
    out.messageText = ps_full_state_message_text(state_.get());
    return out;
}

LayerGrid NativeGameBridge::currentLayerGrid() const {
    LayerGrid out;
    if (!state_) {
        return out;
    }
    const Status current = status();
    out.layerCount = layerCount();
    out.width = current.width;
    out.height = current.height;

    const size_t required = ps_full_state_layer_cell_object_ids(state_.get(), nullptr, 0);
    std::vector<int32_t> nativeIds(required, -1);
    ps_full_state_layer_cell_object_ids(state_.get(), nativeIds.data(), nativeIds.size());

    out.displayObjectIds.resize(nativeIds.size(), 0);
    for (size_t index = 0; index < nativeIds.size(); ++index) {
        out.displayObjectIds[index] = nativeIds[index] < 0 ? 0 : nativeIds[index] + 1;
    }
    return out;
}

ps_input toNativeInput(int moveDir) {
    switch (moveDir) {
        case 0b0000001: return PS_INPUT_UP;
        case 0b0000010: return PS_INPUT_DOWN;
        case 0b0000100: return PS_INPUT_LEFT;
        case 0b0001000: return PS_INPUT_RIGHT;
        case 0b0010000: return PS_INPUT_ACTION;
        default: return PS_INPUT_TICK;
    }
}

} // namespace psbridge
```

- [ ] **Step 3: Add bridge smoke test**

Create `tools/puzzlescriptmis-app/tests/native_bridge_smoke.cpp`:

```cpp
#include <cstring>
#include <cstdlib>
#include <iostream>
#include <string>

#include "native_bridge/NativeGameBridge.h"

namespace {

constexpr const char* kSource = R"(title Bridge Smoke

========
OBJECTS
========

Background
black

Player
white

=======
LEGEND
=======

. = Background
P = Player

================
COLLISIONLAYERS
================

Background
Player

======
RULES
======

[ > Player | Background ] -> [ Background | Player ]

=======
LEVELS
=======

P.
)";

void require(bool condition, const char* message) {
    if (!condition) {
        std::cerr << message << "\n";
        std::exit(1);
    }
}

} // namespace

int main() {
    psbridge::NativeGameBridge bridge;
    require(bridge.compileSource(kSource), bridge.lastDiagnostic().message.c_str());
    require(bridge.levelCount() == 1, "expected one level");
    require(bridge.objectCount() >= 2, "expected at least two objects");
    require(bridge.layerCount() >= 2, "expected at least two layers");

    psbridge::LayerGrid grid = bridge.currentLayerGrid();
    require(grid.width == 2, "expected width 2");
    require(grid.height == 1, "expected height 1");
    require(!grid.displayObjectIds.empty(), "expected display object ids");

    bool won = false;
    require(bridge.step(PS_INPUT_RIGHT, &won), "right step failed");
    grid = bridge.currentLayerGrid();
    require(grid.width == 2, "expected width 2 after step");
    require(grid.height == 1, "expected height 1 after step");

    require(bridge.undo(), "undo failed");
    require(bridge.restart(), "restart failed");
    return 0;
}
```

- [ ] **Step 4: Wire bridge smoke into CMake**

Modify root `CMakeLists.txt` so the native guard contains both `add_subdirectory(native)` and the bridge smoke target:

```cmake
if(PUZZLESCRIPT_BUILD_NATIVE)
  add_subdirectory(native)

  add_executable(puzzlescriptmis_native_bridge_smoke
    tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.cpp
    tools/puzzlescriptmis-app/tests/native_bridge_smoke.cpp
  )

  target_include_directories(puzzlescriptmis_native_bridge_smoke
    PRIVATE
      ${CMAKE_CURRENT_SOURCE_DIR}/tools/puzzlescriptmis-app/src
  )

  target_link_libraries(puzzlescriptmis_native_bridge_smoke
    PRIVATE
      puzzlescript_native
      puzzlescript_compiler
  )

  add_test(
    NAME puzzlescriptmis_native_bridge_smoke
    COMMAND puzzlescriptmis_native_bridge_smoke
  )
endif()
```

- [ ] **Step 5: Run the bridge smoke test**

Run:

```bash
cmake -S . -B build
cmake --build build --target puzzlescriptmis_native_bridge_smoke
./build/puzzlescriptmis_native_bridge_smoke
```

Expected: smoke executable exits with status 0.

- [ ] **Step 6: Commit bridge core**

Run:

```bash
git add CMakeLists.txt tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.* tools/puzzlescriptmis-app/tests/native_bridge_smoke.cpp
git commit -m "feat: add puzzlescriptmis native bridge"
```

## Task 4: Add PuzzleScript+MIS NativeGameFacade Display Cache

**Files:**
- Create: `tools/puzzlescriptmis-app/src/native_bridge/NativeGameFacade.h`
- Create: `tools/puzzlescriptmis-app/src/native_bridge/NativeGameFacade.cpp`

- [ ] **Step 1: Create facade header**

Create `tools/puzzlescriptmis-app/src/native_bridge/NativeGameFacade.h`:

```cpp
#pragma once

#include "macros.h"

struct Game;
class Logger;

namespace nativebridge {

bool compileSourceLines(const vector<string>& sourceLines, Game& displayGame, Logger& logger);
bool loadLevel(int levelIndex, Game& displayGame, Logger& logger);
bool step(short moveDir, Game& displayGame, bool& won, Logger& logger);
bool undo(Game& displayGame);
bool restart(Game& displayGame);
bool canUndo();
bool isAtRestartState(const Game& displayGame);
string lastMessageText();

} // namespace nativebridge
```

- [ ] **Step 2: Create facade implementation**

Create `tools/puzzlescriptmis-app/src/native_bridge/NativeGameFacade.cpp`:

```cpp
#include "native_bridge/NativeGameFacade.h"

#include "colors.h"
#include "game.h"
#include "logError.h"
#include "native_bridge/NativeGameBridge.h"

namespace nativebridge {
namespace {

psbridge::NativeGameBridge bridge;
vector<psbridge::ObjectInfo> cachedObjects;

string joinLines(const vector<string>& lines) {
    string out;
    for (const string& line : lines) {
        out += line;
        out += '\n';
    }
    return out;
}

ofColor parseHexColor(const string& value) {
    if (value.size() == 7 && value[0] == '#') {
        return ofColor::fromHex(static_cast<int>(std::stoul(value.substr(1), nullptr, 16)));
    }
    auto found = colors::palette.find(value);
    if (found != colors::palette.end()) {
        return found->second;
    }
    return ofColor(255, 255, 255, 255);
}

short textureForObject(const psbridge::ObjectInfo& object) {
    const int width = object.spriteWidth > 0 ? object.spriteWidth : 1;
    const int height = object.spriteHeight > 0 ? object.spriteHeight : 1;

    ofPixels pixels;
    pixels.allocate(width, height, OF_PIXELS_RGBA);

    uint64_t hash = INITIAL_HASH;
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            const size_t spriteIndex = static_cast<size_t>(y * width + x);
            const int colorIndex = spriteIndex < object.sprite.size() ? object.sprite[spriteIndex] : -1;
            ofColor color(0, 0, 0, 0);
            if (colorIndex >= 0 && static_cast<size_t>(colorIndex) < object.colors.size()) {
                color = parseHexColor(object.colors[static_cast<size_t>(colorIndex)]);
            }
            pixels.setColor(x, y, color);
            hash = FNV64(color.getHex(), hash);
            hash = FNV64(color.a, hash);
        }
    }

    auto existing = colors::textureMap.find(hash);
    if (existing != colors::textureMap.end()) {
        return existing->second;
    }

    ofTexture texture;
    texture.allocate(pixels);
    texture.setTextureMinMagFilter(GL_NEAREST, GL_NEAREST);
    const short textureIndex = static_cast<short>(colors::textures.size());
    colors::textures.push_back(texture);
    colors::textureMap[hash] = textureIndex;
    return textureIndex;
}

vvvs makeStateFromGrid(const psbridge::LayerGrid& grid) {
    vvvs state;
    if (grid.layerCount <= 0 || grid.width <= 0 || grid.height <= 0) {
        return state;
    }
    state.assign(
        static_cast<size_t>(grid.layerCount),
        vector<vector<short>>(static_cast<size_t>(grid.height), vector<short>(static_cast<size_t>(grid.width), 0))
    );

    for (int layer = 0; layer < grid.layerCount; ++layer) {
        for (int y = 0; y < grid.height; ++y) {
            for (int x = 0; x < grid.width; ++x) {
                const size_t offset = static_cast<size_t>(layer * grid.width * grid.height + y * grid.width + x);
                if (offset < grid.displayObjectIds.size()) {
                    state[static_cast<size_t>(layer)][static_cast<size_t>(y)][static_cast<size_t>(x)] =
                        static_cast<short>(grid.displayObjectIds[offset]);
                }
            }
        }
    }
    return state;
}

void refreshDisplayObjects(Game& displayGame) {
    cachedObjects = bridge.objects();
    displayGame.objPrimaryName.clear();
    displayGame.objTexture.clear();
    displayGame.objLayer.clear();
    displayGame.synonyms.clear();
    displayGame.aggregates.clear();
    displayGame.properties.clear();
    displayGame.definedNames.clear();
    displayGame.playerIndices.clear();
    displayGame.synsWithSingleCharName.clear();
    displayGame.aggsWithSingleCharName.clear();

    displayGame.objPrimaryName.push_back("no_object");
    displayGame.objTexture.push_back(0);
    displayGame.objLayer.push_back(-1);

    for (const psbridge::ObjectInfo& object : cachedObjects) {
        displayGame.objPrimaryName.push_back(object.name);
        displayGame.objTexture.push_back(textureForObject(object));
        displayGame.objLayer.push_back(static_cast<short>(object.layer));
        displayGame.synonyms[object.name] = static_cast<short>(object.displayId);
        displayGame.definedNames.insert(object.name);
        if (object.name == "player") {
            displayGame.playerIndices.push_back({static_cast<short>(object.displayId), static_cast<short>(object.layer)});
        }
    }
    displayGame.layerCount = bridge.layerCount();

    for (const psbridge::GlyphInfo& glyph : bridge.glyphs()) {
        if (glyph.glyph.size() != 1 || glyph.displayObjectIds.empty()) {
            continue;
        }
        if (glyph.displayObjectIds.size() == 1) {
            const short displayId = static_cast<short>(glyph.displayObjectIds.front());
            displayGame.synonyms[glyph.glyph] = displayId;
            displayGame.synsWithSingleCharName.push_back({glyph.glyph, displayId});
        } else {
            vector<short> aggregate;
            aggregate.reserve(glyph.displayObjectIds.size());
            for (int32_t displayId : glyph.displayObjectIds) {
                aggregate.push_back(static_cast<short>(displayId));
            }
            displayGame.aggregates[glyph.glyph] = aggregate;
            displayGame.aggsWithSingleCharName.push_back({glyph.glyph, aggregate});
        }
    }
}

void refreshCurrentState(Game& displayGame) {
    const psbridge::Status status = bridge.status();
    const psbridge::LayerGrid grid = bridge.currentLayerGrid();
    displayGame.currentLevelIndex = status.currentLevelIndex;
    displayGame.currentState = makeStateFromGrid(grid);
    displayGame.currentLevelWidth = status.width;
    displayGame.currentLevelHeight = status.height;
}

} // namespace

bool compileSourceLines(const vector<string>& sourceLines, Game& displayGame, Logger& logger) {
    logger.reset();
    if (!bridge.compileSource(joinLines(sourceLines))) {
        const psbridge::Diagnostic& diagnostic = bridge.lastDiagnostic();
        logger.logError(diagnostic.message, diagnostic.line);
        return false;
    }

    refreshDisplayObjects(displayGame);
    displayGame.levels.clear();
    const int levelCount = bridge.levelCount();
    displayGame.levels.resize(static_cast<size_t>(levelCount));
    for (int levelIndex = 0; levelIndex < levelCount; ++levelIndex) {
        if (bridge.loadLevel(levelIndex)) {
            displayGame.levels[static_cast<size_t>(levelIndex)] = makeStateFromGrid(bridge.currentLayerGrid());
        }
    }
    if (levelCount > 0) {
        bridge.loadLevel(0);
        refreshCurrentState(displayGame);
        displayGame.beginStateAfterStationaryMove = displayGame.currentState;
    }
    displayGame.undoStates.clear();
    return true;
}

bool loadLevel(int levelIndex, Game& displayGame, Logger& logger) {
    if (!bridge.loadLevel(levelIndex)) {
        logger.logError(bridge.lastDiagnostic().message, bridge.lastDiagnostic().line);
        return false;
    }
    refreshCurrentState(displayGame);
    displayGame.beginStateAfterStationaryMove = displayGame.currentState;
    displayGame.undoStates.clear();
    return true;
}

bool step(short moveDir, Game& displayGame, bool& won, Logger& logger) {
    won = false;
    if (!bridge.step(psbridge::toNativeInput(moveDir), &won)) {
        logger.logError(bridge.lastDiagnostic().message, bridge.lastDiagnostic().line);
        return false;
    }
    refreshCurrentState(displayGame);
    return true;
}

bool undo(Game& displayGame) {
    if (!bridge.undo()) {
        return false;
    }
    refreshCurrentState(displayGame);
    return true;
}

bool restart(Game& displayGame) {
    if (!bridge.restart()) {
        return false;
    }
    refreshCurrentState(displayGame);
    return true;
}

bool canUndo() {
    return bridge.status().canUndo;
}

bool isAtRestartState(const Game& displayGame) {
    return displayGame.currentState == displayGame.beginStateAfterStationaryMove;
}

string lastMessageText() {
    return bridge.status().messageText;
}

} // namespace nativebridge
```

- [ ] **Step 3: Add facade files to bridge smoke build**

Modify root `CMakeLists.txt` target `puzzlescriptmis_native_bridge_smoke` so it still compiles only the openFrameworks-independent bridge:

```cmake
add_executable(puzzlescriptmis_native_bridge_smoke
  tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.cpp
  tools/puzzlescriptmis-app/tests/native_bridge_smoke.cpp
)
```

Do not add `NativeGameFacade.cpp` to the CMake smoke target because it depends on openFrameworks types.

- [ ] **Step 4: Commit facade files**

Run:

```bash
git add tools/puzzlescriptmis-app/src/native_bridge/NativeGameFacade.*
git commit -m "feat: adapt native bridge to puzzlescriptmis display cache"
```

## Task 5: Wire openFrameworks Build To Native Libraries

**Files:**
- Create: `tools/puzzlescriptmis-app/config.make`
- Create: `tools/puzzlescriptmis-app/scripts/build_native_deps.sh`
- Modify: `tools/puzzlescriptmis-app/addons.make`

- [ ] **Step 1: Add native dependency build script**

Create `tools/puzzlescriptmis-app/scripts/build_native_deps.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${APP_DIR}/../.." && pwd)"

cmake -S "${REPO_ROOT}" -B "${REPO_ROOT}/build"
cmake --build "${REPO_ROOT}/build" --target puzzlescript_native puzzlescript_compiler
```

Run:

```bash
chmod +x tools/puzzlescriptmis-app/scripts/build_native_deps.sh
tools/puzzlescriptmis-app/scripts/build_native_deps.sh
```

Expected: native static libraries build successfully.

- [ ] **Step 2: Add openFrameworks config.make**

Create `tools/puzzlescriptmis-app/config.make`:

```make
PUZZLESCRIPT_ROOT = ../..
PUZZLESCRIPT_BUILD = $(PUZZLESCRIPT_ROOT)/build/native

PROJECT_INCLUDES += $(PUZZLESCRIPT_ROOT)/native/include
PROJECT_INCLUDES += $(PUZZLESCRIPT_ROOT)/tools/puzzlescriptmis-app/src

PROJECT_LDFLAGS += $(PUZZLESCRIPT_BUILD)/libpuzzlescript_compiler.a
PROJECT_LDFLAGS += $(PUZZLESCRIPT_BUILD)/libpuzzlescript_native.a
PROJECT_LDFLAGS += -pthread
```

Keep `OF_ROOT` unset here so existing openFrameworks users can provide it via environment or their normal openFrameworks project layout.

- [ ] **Step 3: Confirm addon list still contains ofxGui**

Ensure `tools/puzzlescriptmis-app/addons.make` contains:

```make
ofxGui
```

- [ ] **Step 4: Try an openFrameworks compile**

Run:

```bash
tools/puzzlescriptmis-app/scripts/build_native_deps.sh
make -C tools/puzzlescriptmis-app Debug
```

Expected: if openFrameworks is available, compile reaches C++ errors from unconverted call sites or succeeds. If `OF_ROOT` is missing, record the missing `OF_ROOT` message and continue with CMake bridge tests; do not block native bridge work on local openFrameworks installation.

- [ ] **Step 5: Commit build wiring**

Run:

```bash
git add tools/puzzlescriptmis-app/config.make tools/puzzlescriptmis-app/scripts/build_native_deps.sh tools/puzzlescriptmis-app/addons.make
git commit -m "build: link puzzlescriptmis app to native core"
```

## Task 6: Replace Compile/Level Loading Path With Native Facade

**Files:**
- Modify: `tools/puzzlescriptmis-app/src/visualsandide.cpp`
- Modify: `tools/puzzlescriptmis-app/src/global.cpp`
- Modify: `tools/puzzlescriptmis-app/src/game.cpp`

- [ ] **Step 1: Include facade in UI files**

Add this include to both files:

```cpp
#include "native_bridge/NativeGameFacade.h"
```

- [ ] **Step 2: Update `initEditor` to compile with native facade**

In `tools/puzzlescriptmis-app/src/visualsandide.cpp`, replace:

```cpp
successes = parseGame(levelEditorString, exploitationString, gbl::currentGame, logger::levelEdit, logger::generator);
```

with:

```cpp
successes.first = nativebridge::compileSourceLines(levelEditorString, gbl::currentGame, logger::levelEdit);
successes.second = false;
logger::generator.reset();
logger::generator.logWarning("Transformer/generator is not yet wired to the native engine.", 0);
```

Replace:

```cpp
assert(successes.first && successes.second);
```

with:

```cpp
assert(successes.first);
```

- [ ] **Step 3: Update `switchToLeftEditor` recompilation**

In `switchToLeftEditor`, replace the block beginning with:

```cpp
successes = parseGame(levelEditorString, exploitationString, gbl::currentGame, logger::levelEdit, logger::generator);
if(successes.first && !successes.second && newmode != MODE_EXPLOITATION) {
    exploitationString = emptyExploitationString;
    successes = parseGame(levelEditorString, exploitationString, gbl::currentGame, logger::levelEdit, logger::generator);
}
if(successes.first && successes.second) restartGenerating = true;
```

with:

```cpp
successes.first = nativebridge::compileSourceLines(levelEditorString, gbl::currentGame, logger::levelEdit);
successes.second = false;
logger::generator.reset();
logger::generator.logWarning("Transformer/generator is not yet wired to the native engine.", 0);
restartGenerating = false;
```

- [ ] **Step 4: Keep exploitation mode from requiring generator success**

Replace:

```cpp
if((gbl::mode == MODE_LEVEL_EDITOR && !successes.first) || (gbl::mode == MODE_EXPLOITATION && !successes.second)) {
```

with:

```cpp
if(!successes.first) {
```

- [ ] **Step 5: Update `switchToLevel`**

In `tools/puzzlescriptmis-app/src/global.cpp`, replace the body of `switchToLevel` with:

```cpp
void switchToLevel(int level, Game & game) {
    cout << "SWITCHING TO LEVEL " << level << endl;
    logger::levelEdit.reset();
    if (!nativebridge::loadLevel(level, game, logger::levelEdit)) {
        cout << "Failed to switch native level: " << logger::levelEdit.lastErrorStr << endl;
        return;
    }
    game.currentMessageIndex = 0;
}
```

- [ ] **Step 6: Make `Game::updateLevelState` display-cache-only**

In `tools/puzzlescriptmis-app/src/game.cpp`, replace `Game::updateLevelState` with:

```cpp
void Game::updateLevelState(vvvs newCurrentState, int index) {
    if (index >= 0 && index < levels.size()) {
        levels[static_cast<size_t>(index)] = newCurrentState;
    }
    if (index == currentLevelIndex) {
        currentState = newCurrentState;
        currentLevelHeight = currentState.empty() ? 0 : static_cast<int>(currentState[0].size());
        currentLevelWidth = (currentState.empty() || currentState[0].empty()) ? 0 : static_cast<int>(currentState[0][0].size());
        beginStateAfterStationaryMove = currentState;
        undoStates.clear();
    }
}
```

This keeps level-editor clicks updating the visible display cache while avoiding the old PuzzleScript+MIS engine.

- [ ] **Step 7: Run bridge/native tests**

Run:

```bash
cmake --build build --target puzzlescriptmis_native_bridge_smoke puzzlescript_cpp_player_api_tests
./build/puzzlescriptmis_native_bridge_smoke
./build/native/puzzlescript_cpp_player_api_tests
```

Expected: both executables exit with status 0.

- [ ] **Step 8: Commit compile/load conversion**

Run:

```bash
git add tools/puzzlescriptmis-app/src/visualsandide.cpp tools/puzzlescriptmis-app/src/global.cpp tools/puzzlescriptmis-app/src/game.cpp
git commit -m "feat: compile puzzlescriptmis games with native engine"
```

## Task 7: Route Play Input, Undo, Restart Through Native Facade

**Files:**
- Modify: `tools/puzzlescriptmis-app/src/keyHandling.cpp`
- Modify: `tools/puzzlescriptmis-app/src/visualsandide.cpp`
- Modify: `tools/puzzlescriptmis-app/src/generation.cpp`

- [ ] **Step 1: Include facade in key handling**

Add:

```cpp
#include "native_bridge/NativeGameFacade.h"
```

to `tools/puzzlescriptmis-app/src/keyHandling.cpp`.

- [ ] **Step 2: Replace play movement**

In the `MODE_PLAYING` branch for movement keys, replace:

```cpp
bool winning = move(dir, gbl::currentGame);
```

with:

```cpp
bool winning = false;
nativebridge::step(dir, gbl::currentGame, winning, logger::levelEdit);
```

Remove the solver cache update block inside `if(winning)`. Replace it with:

```cpp
if(winning) {
    keyQueue.push({KEY_WIN,300});
}
```

- [ ] **Step 3: Replace undo**

Replace:

```cpp
if(gbl::mode == MODE_PLAYING)
    undo(gbl::currentGame);
```

with:

```cpp
if(gbl::mode == MODE_PLAYING)
    nativebridge::undo(gbl::currentGame);
```

- [ ] **Step 4: Replace restart and enter-play setup**

Replace:

```cpp
restart(gbl::currentGame);
```

with:

```cpp
nativebridge::restart(gbl::currentGame);
```

In the branch that enters play mode from editor mode, remove the old stationary move setup:

```cpp
move(STATIONARY_MOVE, gbl::currentGame);
if(gbl::currentGame.undoStates.size() > 0) gbl::currentGame.undoStates.pop_back();
gbl::currentGame.beginStateAfterStationaryMove = gbl::currentGame.currentState;
```

and replace it with:

```cpp
nativebridge::restart(gbl::currentGame);
gbl::currentGame.beginStateAfterStationaryMove = gbl::currentGame.currentState;
```

- [ ] **Step 5: Make solve key inert for milestone one**

At the start of the `KEY_SOLVE` case, add:

```cpp
cout << "Native solver is not wired into PuzzleScript+MIS yet." << endl;
break;
```

- [ ] **Step 6: Update play UI undo/restart checks**

In `tools/puzzlescriptmis-app/src/visualsandide.cpp`, replace:

```cpp
gbl::currentGame.beginStateAfterStationaryMove == gbl::currentGame.currentState
```

with:

```cpp
nativebridge::isAtRestartState(gbl::currentGame)
```

Replace:

```cpp
if(gbl::currentGame.undoStates.size()<1) ofSetColor(0x55);
if(gbl::currentGame.undoStates.size()>=1 && ofGetAppPtr()->mouseX >= xUndo
```

with:

```cpp
if(!nativebridge::canUndo()) ofSetColor(0x55);
if(nativebridge::canUndo() && ofGetAppPtr()->mouseX >= xUndo
```

- [ ] **Step 7: Make generation no-op**

In `tools/puzzlescriptmis-app/src/generation.cpp`, replace `startGenerating`, `stopGenerating`, and `stillTransforming` with:

```cpp
void startGenerating() {
    cout << "Transformer/generator is not yet wired to the native engine." << endl;
}

void stopGenerating() {
}

bool stillTransforming() {
    return false;
}
```

- [ ] **Step 8: Run native tests and openFrameworks compile**

Run:

```bash
cmake --build build --target puzzlescriptmis_native_bridge_smoke puzzlescript_cpp_player_api_tests
./build/puzzlescriptmis_native_bridge_smoke
./build/native/puzzlescript_cpp_player_api_tests
tools/puzzlescriptmis-app/scripts/build_native_deps.sh
make -C tools/puzzlescriptmis-app Debug
```

Expected: CMake tests pass. The openFrameworks compile should succeed when `OF_ROOT` is available; if it fails on remaining references to old solver/generator state, update those references to no-op UI text and rerun.

- [ ] **Step 9: Commit play routing**

Run:

```bash
git add tools/puzzlescriptmis-app/src/keyHandling.cpp tools/puzzlescriptmis-app/src/visualsandide.cpp tools/puzzlescriptmis-app/src/generation.cpp
git commit -m "feat: play puzzlescriptmis levels with native engine"
```

## Task 8: Final Verification And Notes

**Files:**
- Modify: `tools/puzzlescriptmis-app/UPSTREAM.md`

- [ ] **Step 1: Run repository native regression checks**

Run:

```bash
cmake --build build --target puzzlescriptmis_native_bridge_smoke puzzlescript_cpp_player_api_tests
./build/puzzlescriptmis_native_bridge_smoke
./build/native/puzzlescript_cpp_player_api_tests
make simulation_tests_cpp
```

Expected: all commands pass.

- [ ] **Step 2: Run app build if openFrameworks is available**

Run:

```bash
tools/puzzlescriptmis-app/scripts/build_native_deps.sh
make -C tools/puzzlescriptmis-app Debug
```

Expected with openFrameworks installed: app build succeeds.

Expected without openFrameworks installed or without `OF_ROOT`: command fails with an openFrameworks path/configuration error. Record this in the final response and keep CMake bridge/native tests as the verified automated path.

- [ ] **Step 3: Add milestone note**

Append this section to `tools/puzzlescriptmis-app/UPSTREAM.md`:

```markdown
## Native Engine Bridge Milestone

The first native bridge milestone routes PuzzleScript source compilation, level loading, board display snapshots, player input, undo, and restart through PuzzleScript-labs native libraries.

Transformer, generator, and solver UI entry points are intentionally disabled until their native-backed implementations are designed and ported.
```

- [ ] **Step 4: Commit final notes**

Run:

```bash
git add tools/puzzlescriptmis-app/UPSTREAM.md
git commit -m "docs: document puzzlescriptmis native bridge milestone"
```

- [ ] **Step 5: Summarize verification**

Prepare a final implementation summary with:

```text
- Vendored app source path.
- Native bridge files added.
- Native API added.
- Compile/play UI paths converted.
- Generator/transformer/solver intentionally disabled.
- Verification commands and results.
- Whether openFrameworks app build was run or blocked by local OF_ROOT setup.
```
