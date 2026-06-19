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

enum class LegendKind {
    Synonym,
    Aggregate,
    Property
};

struct LegendInfo {
    std::string name;
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

enum class NativeSolveStatus {
    Solved,
    Exhausted,
    Timeout,
    Error
};

struct NativeSolveResult {
    NativeSolveStatus status = NativeSolveStatus::Error;
    uint64_t expanded = 0;
    uint64_t generated = 0;
    int64_t elapsedMs = 0;
    std::vector<ps_input> solution;
    std::string error;
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
    std::vector<LegendInfo> legends(LegendKind kind) const;
    std::string metadataValue(const std::string& key) const;

    bool createState();
    bool loadLevel(int32_t levelIndex);
    bool step(ps_input input, bool* outWon, bool* outChanged = nullptr);
    bool undo();
    bool restart();

    Status status() const;
    LayerGrid currentLayerGrid() const;
    NativeSolveResult solveLayerGrid(const LayerGrid& grid, int64_t timeoutMs) const;

private:
    struct CompileResultDeleter { void operator()(ps_compile_result* value) const { ps_free_compile_result(value); } };
    struct CompilerResultDeleter { void operator()(ps_compiler_result* value) const { ps_compiler_result_free(value); } };
    struct GameDeleter { void operator()(const ps_game* value) const { ps_free_game(const_cast<ps_game*>(value)); } };
    struct StateDeleter { void operator()(ps_full_state* value) const { ps_full_state_destroy(value); } };
    struct ErrorDeleter { void operator()(ps_error* value) const { ps_free_error(value); } };

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
