#include "native_bridge/NativeGameBridge.h"

#include <algorithm>
#include <cstddef>
#include <string>
#include <utility>

namespace psbridge {
namespace {

std::string safeString(const char* value) {
    return value == nullptr ? std::string{} : std::string(value);
}

int32_t toDisplayObjectId(int32_t nativeId) {
    return nativeId < 0 ? 0 : nativeId + 1;
}

int32_t toNativeObjectId(int32_t displayId) {
    return displayId <= 0 ? -1 : displayId - 1;
}

std::string displayGlyphName(const char* glyph) {
    std::string value = safeString(glyph);
    if (value.size() == 1 && value[0] >= 'a' && value[0] <= 'z') {
        value[0] = static_cast<char>(value[0] - 'a' + 'A');
    }
    return value;
}

ps_legend_kind toNativeLegendKind(LegendKind kind) {
    switch (kind) {
    case LegendKind::Synonym:
        return PS_LEGEND_SYNONYM;
    case LegendKind::Aggregate:
        return PS_LEGEND_AGGREGATE;
    case LegendKind::Property:
        return PS_LEGEND_PROPERTY;
    }
    return PS_LEGEND_SYNONYM;
}

} // namespace

NativeGameBridge::NativeGameBridge() = default;
NativeGameBridge::~NativeGameBridge() = default;

bool NativeGameBridge::compileSource(const std::string& source) {
    ps_compile_result* rawResult = nullptr;
    const bool compiled = ps_compile_source(source.data(), source.size(), &rawResult);
    compileResult_.reset(rawResult);
    game_.reset();
    state_.reset();
    lastDiagnostic_ = {};

    if (!compiled) {
        CompilerResultPtr diagnostics(ps_compiler_compile_source_diagnostics(source.data(), source.size()));
        if (diagnostics) {
            const size_t count = ps_compiler_result_diagnostic_count(diagnostics.get());
            for (size_t index = 0; index < count; ++index) {
                const ps_diagnostic* diagnostic = ps_compiler_result_diagnostic(diagnostics.get(), index);
                if (diagnostic != nullptr && diagnostic->severity == PS_DIAG_ERROR) {
                    setError(diagnostic->message, diagnostic->line);
                    return false;
                }
            }
        }

        if (compileResult_) {
            ErrorPtr error(const_cast<ps_error*>(ps_compile_result_error(compileResult_.get())));
            if (error) {
                setError(ps_error_message(error.get()));
                return false;
            }
        }

        setError("PuzzleScript compilation failed");
        return false;
    }

    game_.reset(ps_compile_result_game(compileResult_.get()));
    if (!game_) {
        setError("PuzzleScript compilation did not produce a game");
        return false;
    }

    if (!createState()) {
        return false;
    }

    lastDiagnostic_ = {};
    return true;
}

bool NativeGameBridge::hasGame() const {
    return game_ != nullptr;
}

const Diagnostic& NativeGameBridge::lastDiagnostic() const {
    return lastDiagnostic_;
}

int32_t NativeGameBridge::levelCount() const {
    return hasGame() ? ps_game_level_count(game()) : 0;
}

int32_t NativeGameBridge::objectCount() const {
    return hasGame() ? ps_game_object_count(game()) : 0;
}

int32_t NativeGameBridge::layerCount() const {
    return hasGame() ? ps_game_layer_count(game()) : 0;
}

std::vector<ObjectInfo> NativeGameBridge::objects() const {
    std::vector<ObjectInfo> values;
    if (!hasGame()) {
        return values;
    }

    const int32_t count = objectCount();
    values.reserve(static_cast<size_t>(std::max(count, 0)));
    for (int32_t objectId = 0; objectId < count; ++objectId) {
        ps_object_info nativeInfo{};
        if (!ps_game_object_info(game(), objectId, &nativeInfo)) {
            continue;
        }

        ObjectInfo value;
        value.nativeId = nativeInfo.id;
        value.displayId = toDisplayObjectId(value.nativeId);
        value.layer = nativeInfo.layer;
        value.name = safeString(nativeInfo.name);
        value.spriteWidth = nativeInfo.sprite_width;
        value.spriteHeight = nativeInfo.sprite_height;

        value.colors.reserve(nativeInfo.color_count);
        for (size_t colorIndex = 0; colorIndex < nativeInfo.color_count; ++colorIndex) {
            value.colors.push_back(safeString(ps_game_object_color(game(), objectId, colorIndex)));
        }

        if (value.spriteWidth > 0 && value.spriteHeight > 0) {
            value.sprite.reserve(static_cast<size_t>(value.spriteWidth) * static_cast<size_t>(value.spriteHeight));
            for (int32_t y = 0; y < value.spriteHeight; ++y) {
                for (int32_t x = 0; x < value.spriteWidth; ++x) {
                    value.sprite.push_back(ps_game_object_sprite_value(game(), objectId, x, y));
                }
            }
        }

        values.push_back(std::move(value));
    }
    return values;
}

std::vector<GlyphInfo> NativeGameBridge::glyphs() const {
    std::vector<GlyphInfo> values;
    if (!hasGame()) {
        return values;
    }

    const int32_t count = ps_game_glyph_count(game());
    values.reserve(static_cast<size_t>(std::max(count, 0)));
    for (int32_t glyphIndex = 0; glyphIndex < count; ++glyphIndex) {
        GlyphInfo value;
        value.glyph = displayGlyphName(ps_game_glyph_name(game(), glyphIndex));

        const size_t required = ps_game_glyph_object_ids(game(), glyphIndex, nullptr, 0);
        std::vector<int32_t> nativeIds(required, -1);
        if (required > 0) {
            const size_t written = ps_game_glyph_object_ids(game(), glyphIndex, nativeIds.data(), nativeIds.size());
            nativeIds.resize(std::min(required, written));
        }

        value.displayObjectIds.reserve(nativeIds.size());
        for (int32_t nativeId : nativeIds) {
            value.displayObjectIds.push_back(toDisplayObjectId(nativeId));
        }

        values.push_back(std::move(value));
    }
    return values;
}

std::vector<LegendInfo> NativeGameBridge::legends(LegendKind kind) const {
    std::vector<LegendInfo> values;
    if (!hasGame()) {
        return values;
    }

    const ps_legend_kind nativeKind = toNativeLegendKind(kind);
    const int32_t count = ps_game_legend_count(game(), nativeKind);
    values.reserve(static_cast<size_t>(std::max(count, 0)));
    for (int32_t legendIndex = 0; legendIndex < count; ++legendIndex) {
        LegendInfo value;
        value.name = safeString(ps_game_legend_name(game(), nativeKind, legendIndex));

        const size_t required = ps_game_legend_object_ids(game(), nativeKind, legendIndex, nullptr, 0);
        std::vector<int32_t> nativeIds(required, -1);
        if (required > 0) {
            const size_t written = ps_game_legend_object_ids(game(), nativeKind, legendIndex, nativeIds.data(), nativeIds.size());
            nativeIds.resize(std::min(required, written));
        }

        value.displayObjectIds.reserve(nativeIds.size());
        for (int32_t nativeId : nativeIds) {
            value.displayObjectIds.push_back(toDisplayObjectId(nativeId));
        }

        values.push_back(std::move(value));
    }
    return values;
}

std::string NativeGameBridge::metadataValue(const std::string& key) const {
    if (!hasGame()) {
        return {};
    }
    return safeString(ps_game_metadata_value(game(), key.c_str()));
}

bool NativeGameBridge::createState() {
    if (!hasGame()) {
        setError("Cannot create state without a compiled game");
        return false;
    }

    ps_full_state* rawState = nullptr;
    ps_error* rawError = nullptr;
    if (!ps_full_state_create(game(), &rawState, &rawError)) {
        ErrorPtr error(rawError);
        setError(error ? ps_error_message(error.get()) : "Failed to create PuzzleScript state");
        return false;
    }

    state_.reset(rawState);
    lastDiagnostic_ = {};
    return true;
}

bool NativeGameBridge::loadLevel(int32_t levelIndex) {
    if (!state_) {
        setError("Cannot load level without an active state");
        return false;
    }

    ps_error* rawError = nullptr;
    if (!ps_full_state_load_level(state_.get(), levelIndex, &rawError)) {
        ErrorPtr error(rawError);
        setError(error ? ps_error_message(error.get()) : "Failed to load PuzzleScript level");
        return false;
    }

    lastDiagnostic_ = {};
    return true;
}

bool NativeGameBridge::step(ps_input input, bool* outWon, bool* outChanged) {
    if (outWon != nullptr) {
        *outWon = false;
    }
    if (outChanged != nullptr) {
        *outChanged = false;
    }
    if (!state_) {
        setError("Cannot step without an active state");
        return false;
    }

    const ps_step_result result = ps_full_state_turn(state_.get(), input);
    if (outWon != nullptr) {
        *outWon = result.won;
    }
    if (outChanged != nullptr) {
        *outChanged = result.changed;
    }
    lastDiagnostic_ = {};
    return true;
}

bool NativeGameBridge::undo() {
    if (!state_) {
        setError("Cannot undo without an active state");
        return false;
    }
    const bool result = ps_full_state_undo(state_.get());
    if (!result) {
        setError("PuzzleScript undo failed");
    } else {
        lastDiagnostic_ = {};
    }
    return result;
}

bool NativeGameBridge::restart() {
    if (!state_) {
        setError("Cannot restart without an active state");
        return false;
    }
    const bool result = ps_full_state_restart(state_.get());
    if (!result) {
        setError("PuzzleScript restart failed");
    } else {
        lastDiagnostic_ = {};
    }
    return result;
}

Status NativeGameBridge::status() const {
    Status value;
    if (!state_) {
        return value;
    }

    ps_full_state_status_info nativeStatus{};
    ps_full_state_status(state_.get(), &nativeStatus);
    value.mode = nativeStatus.mode;
    value.currentLevelIndex = nativeStatus.current_level_index;
    value.width = nativeStatus.width;
    value.height = nativeStatus.height;
    value.canUndo = nativeStatus.can_undo;
    value.winning = nativeStatus.winning;
    value.messageText = safeString(ps_full_state_message_text(state_.get()));
    return value;
}

LayerGrid NativeGameBridge::currentLayerGrid() const {
    LayerGrid grid;
    if (!state_ || !hasGame()) {
        return grid;
    }

    const Status stateStatus = status();
    grid.layerCount = layerCount();
    grid.width = stateStatus.width;
    grid.height = stateStatus.height;

    const size_t required = ps_full_state_layer_cell_object_ids(state_.get(), nullptr, 0);
    std::vector<int32_t> nativeIds(required, -1);
    if (required > 0) {
        const size_t written = ps_full_state_layer_cell_object_ids(state_.get(), nativeIds.data(), nativeIds.size());
        nativeIds.resize(std::min(required, written));
    }

    grid.displayObjectIds.reserve(nativeIds.size());
    for (int32_t nativeId : nativeIds) {
        grid.displayObjectIds.push_back(toDisplayObjectId(nativeId));
    }

    return grid;
}

std::unique_ptr<NativeGameBridge> NativeGameBridge::createSolverBridge() const {
    if (!hasGame()) {
        return nullptr;
    }

    ps_game* rawGame = nullptr;
    ps_error* rawError = nullptr;
    if (!ps_game_clone(game(), &rawGame, &rawError)) {
        ErrorPtr error(rawError);
        return nullptr;
    }

    std::unique_ptr<NativeGameBridge> solverBridge(new NativeGameBridge());
    solverBridge->game_.reset(rawGame);
    if (!solverBridge->createState()) {
        return nullptr;
    }

    const int32_t levelIndex = state_ ? status().currentLevelIndex : 0;
    if (!solverBridge->loadLevel(levelIndex)) {
        return nullptr;
    }
    return solverBridge;
}

NativeSolveResult NativeGameBridge::solveLayerGrid(
    const LayerGrid& grid,
    int64_t timeoutMs,
    ps_solve_strategy strategy,
    uint64_t maxExpanded) const {
    NativeSolveResult result;

    if (!hasGame()) {
        result.error = "Cannot solve without a compiled game";
        return result;
    }
    if (grid.width <= 0 || grid.height <= 0 || grid.layerCount != layerCount()) {
        result.error = "Candidate grid dimensions do not match the compiled game";
        return result;
    }
    const size_t expectedCells = static_cast<size_t>(grid.layerCount) * static_cast<size_t>(grid.width) * static_cast<size_t>(grid.height);
    if (grid.displayObjectIds.size() != expectedCells) {
        result.error = "Candidate grid cell count does not match its dimensions";
        return result;
    }

    const int32_t levelIndex = state_ ? status().currentLevelIndex : 0;
    std::vector<int32_t> nativeIds;
    nativeIds.reserve(grid.displayObjectIds.size());
    for (int32_t displayId : grid.displayObjectIds) {
        nativeIds.push_back(toNativeObjectId(displayId));
    }

    ps_solve_options options = ps_solve_default_options();
    options.timeout_ms = std::max<int64_t>(1, timeoutMs);
    options.strategy = strategy;
    options.portfolio_jobs = 1;
    options.max_expanded = maxExpanded;

    ps_solve_result* rawSolveResult = nullptr;
    ps_error* rawError = nullptr;
    if (!ps_solve_level_layer_cell_object_ids(
            game(),
            levelIndex,
            nativeIds.data(),
            nativeIds.size(),
            &options,
            &rawSolveResult,
            &rawError)) {
        ErrorPtr error(rawError);
        result.error = error ? ps_error_message(error.get()) : "Failed to run native solver";
        return result;
    }
    SolveResultPtr solveResult(rawSolveResult);
    if (!solveResult) {
        result.error = "Native solver returned no result";
        return result;
    }

    switch (solveResult->status) {
    case PS_SOLVE_STATUS_SOLVED:
        result.status = NativeSolveStatus::Solved;
        break;
    case PS_SOLVE_STATUS_EXHAUSTED:
        result.status = NativeSolveStatus::Exhausted;
        break;
    case PS_SOLVE_STATUS_TIMEOUT:
        result.status = NativeSolveStatus::Timeout;
        break;
    case PS_SOLVE_STATUS_ERROR:
    default:
        result.status = NativeSolveStatus::Error;
        break;
    }
    result.expanded = solveResult->expanded;
    result.generated = solveResult->generated;
    result.elapsedMs = solveResult->elapsed_ms;
    result.strategy = safeString(solveResult->strategy);
    result.heuristic = safeString(solveResult->heuristic);
    result.error = safeString(solveResult->error);
    if (solveResult->solution != nullptr && solveResult->solution_count > 0) {
        result.solution.assign(
            solveResult->solution,
            solveResult->solution + solveResult->solution_count);
    }
    if (result.status == NativeSolveStatus::Error && result.error.empty()) {
        result.error = "Native solver failed";
    }

    return result;
}

const ps_game* NativeGameBridge::game() const {
    return game_.get();
}

void NativeGameBridge::setError(const char* message, int32_t line) {
    lastDiagnostic_.line = line;
    lastDiagnostic_.message = safeString(message);
    if (lastDiagnostic_.message.empty()) {
        lastDiagnostic_.message = "Unknown PuzzleScript native bridge error";
    }
}

ps_input toNativeInput(int moveDir) {
    switch (moveDir) {
    case 0b0000001:
        return PS_INPUT_UP;
    case 0b0000010:
        return PS_INPUT_DOWN;
    case 0b0000100:
        return PS_INPUT_LEFT;
    case 0b0001000:
        return PS_INPUT_RIGHT;
    case 0b0010000:
        return PS_INPUT_ACTION;
    default:
        return PS_INPUT_TICK;
    }
}

} // namespace psbridge
