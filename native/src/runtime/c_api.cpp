#include "runtime/core.hpp"
#include "runtime/compiled_rules.hpp"
#include "runtime/c_api_internal.hpp"
#include "runtime/layout_metrics.hpp"
#include "runtime/locality_survey.hpp"

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>
#include <vector>

using puzzlescript::SpecializedCompactTurnOutcome;
using puzzlescript::SpecializedCompactTurnBackend;
using puzzlescript::Error;
using puzzlescript::FullState;
using puzzlescript::Game;
using puzzlescript::LoadedGame;
using puzzlescript::kMaskWordBits;
using puzzlescript::MaskWordUnsigned;
using puzzlescript::RuntimeStepOptions;

namespace {

ps_error* makeError(std::unique_ptr<Error> error) {
    if (!error) {
        return nullptr;
    }
    auto* wrapper = new ps_error();
    wrapper->impl = std::move(error);
    return wrapper;
}

char* duplicateString(const std::string& value) {
    char* buffer = new char[value.size() + 1];
    std::memcpy(buffer, value.c_str(), value.size() + 1);
    return buffer;
}

struct CompactOracleState {
    std::vector<puzzlescript::MaskWord> objects;
    std::vector<puzzlescript::MaskWord> movementWords;
    puzzlescript::RandomState randomState;
};

CompactOracleState compactOracleStateFromFullState(const FullState& session) {
    CompactOracleState state;
    state.randomState = session.levelState.rng;
    state.movementWords = session.scratch.liveMovements;
    state.objects = session.levelState.board.objects;
    return state;
}

bool compactOracleStatesEqual(const CompactOracleState& lhs, const CompactOracleState& rhs) {
    return lhs.objects == rhs.objects
        && lhs.movementWords == rhs.movementWords
        && lhs.randomState.s == rhs.randomState.s
        && lhs.randomState.i == rhs.randomState.i
        && lhs.randomState.j == rhs.randomState.j
        && lhs.randomState.valid == rhs.randomState.valid;
}

void debugCompactOracleStateMismatch(const CompactOracleState& compact, const CompactOracleState& interpreter) {
    if (std::getenv("PS_COMPACT_ORACLE_DEBUG") == nullptr) {
        return;
    }
    if (compact.objects != interpreter.objects) {
        const size_t count = std::min(compact.objects.size(), interpreter.objects.size());
        size_t printed = 0;
        for (size_t index = 0; index < count; ++index) {
            if (compact.objects[index] != interpreter.objects[index]) {
                std::cerr << "compact oracle objects mismatch index=" << index
                          << " compact=" << compact.objects[index]
                          << " interpreter=" << interpreter.objects[index]
                          << "\n";
                if (++printed >= 16) {
                    return;
                }
            }
        }
        if (compact.objects.size() != interpreter.objects.size()) {
            std::cerr << "compact oracle objects size mismatch compact=" << compact.objects.size()
                      << " interpreter=" << interpreter.objects.size()
                      << "\n";
        }
        return;
    }
    if (compact.movementWords != interpreter.movementWords) {
        const size_t count = std::min(compact.movementWords.size(), interpreter.movementWords.size());
        for (size_t index = 0; index < count; ++index) {
            if (compact.movementWords[index] != interpreter.movementWords[index]) {
                std::cerr << "compact oracle movementWords mismatch index=" << index
                          << " compact=" << compact.movementWords[index]
                          << " interpreter=" << interpreter.movementWords[index]
                          << "\n";
                return;
            }
        }
        std::cerr << "compact oracle movementWords size mismatch compact=" << compact.movementWords.size()
                  << " interpreter=" << interpreter.movementWords.size()
                  << "\n";
        return;
    }
    std::cerr << "compact oracle random state mismatch\n";
}

bool equivalentCompactOracleStepResult(const ps_step_result& lhs, const ps_step_result& rhs) {
    const bool terminal = lhs.won || rhs.won || lhs.restarted || rhs.restarted || lhs.transitioned || rhs.transitioned;
    return lhs.changed == rhs.changed
        && lhs.won == rhs.won
        && lhs.restarted == rhs.restarted
        && (terminal || lhs.transitioned == rhs.transitioned);
}

} // namespace

bool ps_load_ir_json(const char* json_utf8, size_t json_size, ps_game** out_game, ps_error** out_error) {
    if (out_error) {
        *out_error = nullptr;
    }
    if (!json_utf8 || !out_game) {
        if (out_error) {
            *out_error = makeError(std::make_unique<Error>("ps_load_ir_json received null input"));
        }
        return false;
    }

    LoadedGame loadedGame;
    if (auto error = puzzlescript::loadGameFromJson(std::string_view(json_utf8, json_size), loadedGame)) {
        if (out_error) {
            *out_error = makeError(std::move(error));
        }
        return false;
    }

    auto* wrapper = new ps_game();
    wrapper->impl = std::move(loadedGame);
    *out_game = wrapper;
    return true;
}

bool ps_game_clone(const ps_game* game, ps_game** out_game, ps_error** out_error) {
    if (out_error) {
        *out_error = nullptr;
    }
    if (!out_game) {
        return false;
    }
    *out_game = nullptr;
    if (!game || !game->impl.information) {
        if (out_error) {
            *out_error = makeError(std::make_unique<Error>("ps_game_clone received null input"));
        }
        return false;
    }

    auto* wrapper = new ps_game();
    wrapper->impl = game->impl;
    *out_game = wrapper;
    return true;
}

ps_step_result ps_full_state_turn(ps_full_state* state, ps_input input) {
    if (!state) {
        return ps_step_result{};
    }
    state->lastTurnResult = puzzlescript::turnResult(*state->impl, input, RuntimeStepOptions{});
    return state->lastTurnResult.core;
}

ps_step_result ps_full_state_turn_with_options(ps_full_state* state, ps_input input, bool solver_mode) {
    if (!state) {
        return ps_step_result{};
    }
    RuntimeStepOptions options{};
    options.solverMode = solver_mode;
    if (solver_mode) {
        options.emitAudio = false;
    }
    state->lastTurnResult = puzzlescript::turnResult(*state->impl, input, options);
    return state->lastTurnResult.core;
}

bool ps_full_state_set_layer_cell_object_ids(
    ps_full_state* state,
    const int32_t* layer_cell_object_ids,
    size_t count,
    ps_error** out_error
) {
    if (out_error) {
        *out_error = nullptr;
    }
    if (!state || !state->impl || !state->impl->game || !layer_cell_object_ids) {
        if (out_error) {
            *out_error = makeError(std::make_unique<Error>("ps_full_state_set_layer_cell_object_ids received null input"));
        }
        return false;
    }

    FullState& impl = *state->impl;
    const Game& game = *impl.game;
    const int32_t width = currentLevelWidth(impl);
    const int32_t height = currentLevelHeight(impl);
    const int32_t layerCount = game.layerCount;
    if (width <= 0 || height <= 0 || layerCount <= 0) {
        if (out_error) {
            *out_error = makeError(std::make_unique<Error>("Cannot seed a PuzzleScript state without an active rectangular level"));
        }
        return false;
    }

    const size_t required = static_cast<size_t>(layerCount) * static_cast<size_t>(width) * static_cast<size_t>(height);
    if (count != required) {
        if (out_error) {
            *out_error = makeError(std::make_unique<Error>("Layer cell object id count does not match the active level dimensions"));
        }
        return false;
    }

    const int32_t tileCount = width * height;
    puzzlescript::MaskVector objects(static_cast<size_t>(tileCount * game.strideObject), 0);
    for (int32_t layer = 0; layer < layerCount; ++layer) {
        for (int32_t y = 0; y < height; ++y) {
            for (int32_t x = 0; x < width; ++x) {
                const size_t inputOffset = static_cast<size_t>(layer * width * height + y * width + x);
                const int32_t objectId = layer_cell_object_ids[inputOffset];
                if (objectId < 0) {
                    continue;
                }
                if (objectId >= game.objectCount) {
                    if (out_error) {
                        *out_error = makeError(std::make_unique<Error>("Layer cell object id is outside the compiled game object table"));
                    }
                    return false;
                }
                const puzzlescript::ObjectDef& object = game.objectsById[static_cast<size_t>(objectId)];
                if (object.layer != layer) {
                    if (out_error) {
                        *out_error = makeError(std::make_unique<Error>("Layer cell object id does not belong to the requested collision layer"));
                    }
                    return false;
                }
                const int32_t tileIndex = x * height + y;
                const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(objectId));
                const size_t objectOffset = static_cast<size_t>(tileIndex * game.strideObject + static_cast<int32_t>(word));
                if (objectOffset < objects.size()) {
                    objects[objectOffset] |= puzzlescript::maskBit(static_cast<uint32_t>(objectId));
                }
            }
        }
    }

    puzzlescript::setPersistentBoardObjectsFromCellMajor(impl, objects);
    impl.meta.restart.objects = objects;
    impl.scratch.liveMovements.assign(static_cast<size_t>(tileCount * game.strideMovement), 0);
    impl.scratch.rigidGroupIndexMasks.assign(impl.scratch.liveMovements.size(), 0);
    impl.scratch.rigidMovementAppliedMasks.assign(impl.scratch.liveMovements.size(), 0);
    impl.meta.undoStack.clear();
    impl.meta.pendingAgain = false;
    impl.meta.winning = false;

    std::fill(impl.scratch.dirtyObjectRows.begin(), impl.scratch.dirtyObjectRows.end(), 1);
    std::fill(impl.scratch.dirtyObjectColumns.begin(), impl.scratch.dirtyObjectColumns.end(), 1);
    std::fill(impl.scratch.dirtyMovementRows.begin(), impl.scratch.dirtyMovementRows.end(), 1);
    std::fill(impl.scratch.dirtyMovementColumns.begin(), impl.scratch.dirtyMovementColumns.end(), 1);
    impl.scratch.dirtyObjectBoard = true;
    impl.scratch.dirtyMovementBoard = true;
    impl.scratch.objectCellIndexDirty = true;
    impl.scratch.anyMasksDirty = true;
    return true;
}

ps_step_result ps_full_state_turn_compiled_compact(
    ps_full_state* state,
    ps_input input,
    bool solver_mode,
    bool* out_handled
) {
    if (out_handled) {
        *out_handled = false;
    }
    if (!state) {
        return ps_step_result{};
    }
    RuntimeStepOptions options{};
    options.solverMode = solver_mode;
    if (solver_mode) {
        options.emitAudio = false;
    }
    bool handled = false;
    state->lastTurnResult = puzzlescript::TurnResult{};
    state->lastTurnResult.core = puzzlescript::compiledCompactPrimaryTurn(*state->impl, input, options, &handled);
    if (out_handled) {
        *out_handled = handled;
    }
    return state->lastTurnResult.core;
}

bool ps_full_state_create(const ps_game* game, ps_full_state** out_state, ps_error** out_error) {
    if (out_error) {
        *out_error = nullptr;
    }
    if (!game || !out_state) {
        if (out_error) {
            *out_error = makeError(std::make_unique<Error>("ps_full_state_create received null input"));
        }
        return false;
    }
    auto* wrapper = new ps_full_state();
    wrapper->impl = puzzlescript::createFullState(game->impl);
    *out_state = wrapper;
    return true;
}

bool ps_full_state_create_with_loaded_level_seed(
    const ps_game* game,
    const char* loaded_level_seed_utf8,
    ps_full_state** out_state,
    ps_error** out_error
) {
    if (out_error) {
        *out_error = nullptr;
    }
    if (!game || !out_state) {
        if (out_error) {
            *out_error = makeError(std::make_unique<Error>("ps_full_state_create_with_loaded_level_seed received null input"));
        }
        return false;
    }
    if (!loaded_level_seed_utf8) {
        return ps_full_state_create(game, out_state, out_error);
    }
    auto* wrapper = new ps_full_state();
    wrapper->impl = puzzlescript::createFullStateWithLoadedLevelSeed(game->impl, loaded_level_seed_utf8);
    *out_state = wrapper;
    return true;
}

bool ps_full_state_clone(const ps_full_state* state, ps_full_state** out_state, ps_error** out_error) {
    if (out_error) {
        *out_error = nullptr;
    }
    if (!state || !out_state) {
        if (out_error) {
            *out_error = makeError(std::make_unique<Error>("ps_full_state_clone received null input"));
        }
        return false;
    }
    auto* wrapper = new ps_full_state();
    wrapper->impl = std::make_unique<FullState>(*state->impl);
    *out_state = wrapper;
    return true;
}

void ps_full_state_destroy(ps_full_state* state) {
    delete state;
}

void ps_full_state_set_unit_testing(ps_full_state* state, bool enabled) {
    if (state == nullptr || !state->impl) {
        return;
    }
    state->impl->meta.suppressRuleMessages = enabled;
}

bool ps_full_state_load_level(ps_full_state* state, int32_t level_index, ps_error** out_error) {
    if (out_error) {
        *out_error = nullptr;
    }
    if (!state) {
        if (out_error) {
            *out_error = makeError(std::make_unique<Error>("ps_full_state_load_level received null state"));
        }
        return false;
    }
    if (auto error = puzzlescript::loadLevel(*state->impl, level_index)) {
        if (out_error) {
            *out_error = makeError(std::move(error));
        }
        return false;
    }
    return true;
}

bool ps_full_state_compact_turn_oracle_check(
    const ps_full_state* state,
    ps_input input,
    ps_compact_turn_oracle_info* out_info
) {
    if (out_info) {
        *out_info = ps_compact_turn_oracle_info{};
        out_info->matched = true;
    }
    if (state == nullptr || !state->impl || !state->impl->game) {
        return false;
    }
    const FullState& original = *state->impl;
    if (original.meta.titleScreen || original.meta.textMode) {
        return true;
    }
    const SpecializedCompactTurnBackend* backend = original.game->specializedCompactTurn;
    if (backend == nullptr || backend->step == nullptr || !backend->support.wholeTurnSupported) {
        return true;
    }

    CompactOracleState compact = compactOracleStateFromFullState(original);
    puzzlescript::PersistentLevelState compactLevelState;
    compactLevelState.board.objects = compact.objects;
    compactLevelState.rng = compact.randomState;
    puzzlescript::Scratch compactScratch;
    compactScratch.liveMovements = compact.movementWords;
    puzzlescript::SpecializedCompactTurnContext context{
        puzzlescript::LevelDimensions{currentLevelWidth(original), currentLevelHeight(original)},
        original.meta.currentLevelIndex,
    };
    RuntimeStepOptions options{};
    options.emitAudio = false;
    options.againPolicy = puzzlescript::AgainPolicy::Drain;
    const SpecializedCompactTurnOutcome compactOutcome = backend->step(
        *original.game,
        compactLevelState,
        compactScratch,
        context,
        input,
        options
    );
    if (compactOutcome.handled) {
        compact.objects = compactLevelState.board.objects;
        compact.movementWords = compactScratch.liveMovements;
        compact.randomState = compactLevelState.rng;
    }

    FullState interpreter = original;
    ps_step_result interpreterResult = interpretedTurn(interpreter, input, options);

    bool matched = compactOutcome.handled
        && equivalentCompactOracleStepResult(compactOutcome.result, interpreterResult);
    bool stateChecked = false;
    const bool terminal = compactOutcome.result.won
        || interpreterResult.won
        || compactOutcome.result.restarted
        || interpreterResult.restarted
        || compactOutcome.result.transitioned
        || interpreterResult.transitioned;
    if (matched
        && !terminal
        && currentLevelWidth(interpreter) == currentLevelWidth(original)
        && currentLevelHeight(interpreter) == currentLevelHeight(original)) {
        stateChecked = true;
        const CompactOracleState interpreterState = compactOracleStateFromFullState(interpreter);
        matched = compactOracleStatesEqual(compact, interpreterState);
        if (!matched) {
            debugCompactOracleStateMismatch(compact, interpreterState);
        }
    }

    if (out_info) {
        out_info->attempted = true;
        out_info->handled = compactOutcome.handled;
        out_info->matched = matched;
        out_info->state_checked = stateChecked;
        out_info->compact_result = compactOutcome.result;
        out_info->interpreter_result = interpreterResult;
    }
    return true;
}

bool ps_full_state_pending_again(const ps_full_state* state) {
    return state && state->impl->meta.pendingAgain;
}

bool ps_full_state_undo(ps_full_state* state) {
    return state ? puzzlescript::undo(*state->impl) : false;
}

bool ps_full_state_restart(ps_full_state* state) {
    return state ? puzzlescript::restart(*state->impl) : false;
}

bool ps_full_state_advance_level(ps_full_state* state, ps_error** out_error) {
    if (out_error) {
        *out_error = nullptr;
    }
    if (!state) {
        if (out_error) {
            *out_error = makeError(std::make_unique<Error>("ps_full_state_advance_level received null state"));
        }
        return false;
    }
    if (auto error = puzzlescript::advanceLevel(*state->impl)) {
        if (out_error) {
            *out_error = makeError(std::move(error));
        }
        return false;
    }
    return true;
}

void ps_full_state_status(const ps_full_state* state, ps_full_state_status_info* out_status) {
    if (!state || !out_status) {
        return;
    }
    out_status->mode = state->impl->meta.titleScreen
        ? PS_FULL_STATE_MODE_TITLE
        : (state->impl->meta.textMode ? PS_FULL_STATE_MODE_MESSAGE : PS_FULL_STATE_MODE_LEVEL);
    out_status->current_level_index = state->impl->meta.currentLevelIndex;
    out_status->has_current_level_target = state->impl->meta.currentLevelTarget.has_value();
    out_status->current_level_target = state->impl->meta.currentLevelTarget.value_or(0);
    out_status->width = currentLevelWidth(*state->impl);
    out_status->height = currentLevelHeight(*state->impl);
    out_status->title_mode = state->impl->meta.titleMode;
    out_status->title_selection = state->impl->meta.titleSelection;
    out_status->can_undo = !state->impl->meta.undoStack.empty();
    out_status->winning = state->impl->meta.winning;
    out_status->title_screen = state->impl->meta.titleScreen;
    out_status->text_mode = state->impl->meta.textMode;
    out_status->title_selected = state->impl->meta.titleSelected;
    out_status->message_selected = state->impl->meta.messageSelected;
}

const char* ps_full_state_message_text(const ps_full_state* state) {
    if (!state || !state->impl) {
        return "";
    }
    const auto& prepared = state->impl->meta;
    if (!prepared.messageText.empty()) {
        return prepared.messageText.c_str();
    }
    if (prepared.textMode && prepared.level.isMessage) {
        return prepared.level.message.c_str();
    }
    return "";
}

bool ps_full_state_cell_has_object(const ps_full_state* state, int32_t x, int32_t y, int32_t object_id) {
    if (!state || !state->impl || object_id < 0) {
        return false;
    }
    const FullState& impl = *state->impl;
    if (x < 0 || y < 0 || x >= currentLevelWidth(impl) || y >= currentLevelHeight(impl)) {
        return false;
    }
    if (object_id >= impl.game->objectCount) {
        return false;
    }
    const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(object_id));
    if (word >= impl.game->wordCount) {
        return false;
    }
    const int32_t tileIndex = x * currentLevelHeight(impl) + y;
    const size_t offset = static_cast<size_t>(tileIndex * impl.game->strideObject + word);
    if (offset >= impl.levelState.board.objects.size()) {
        return false;
    }
    return (impl.levelState.board.objects[offset] & puzzlescript::maskBit(static_cast<uint32_t>(object_id))) != 0;
}

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

bool ps_full_state_first_player_position(const ps_full_state* state, int32_t* out_x, int32_t* out_y) {
    if (out_x) {
        *out_x = 0;
    }
    if (out_y) {
        *out_y = 0;
    }
    if (!state || !state->impl) {
        return false;
    }
    const FullState& impl = *state->impl;
    if (impl.game->playerMask == puzzlescript::kNullMaskOffset || currentLevelWidth(impl) <= 0 || currentLevelHeight(impl) <= 0) {
        return false;
    }
    const puzzlescript::MaskWord* playerMask = impl.game->maskArena.data() + impl.game->playerMask;
    std::vector<int32_t> playerObjectIds;
    playerObjectIds.reserve(static_cast<size_t>(impl.game->objectCount));
    for (int32_t objectId = 0; objectId < impl.game->objectCount; ++objectId) {
        const uint32_t maskWord = puzzlescript::maskWordIndex(static_cast<uint32_t>(objectId));
        const uint32_t bit = static_cast<uint32_t>(objectId % static_cast<int32_t>(puzzlescript::kMaskWordBits));
        if (maskWord < impl.game->wordCount && (playerMask[maskWord] & puzzlescript::maskBit(bit)) != 0) {
            playerObjectIds.push_back(objectId);
        }
    }
    const int32_t tileCount = currentLevelWidth(impl) * currentLevelHeight(impl);
    for (int32_t tile_index = 0; tile_index < tileCount; ++tile_index) {
        const size_t tileBase = static_cast<size_t>(tile_index * impl.game->strideObject);
        bool containsPlayer = impl.game->playerMaskAggregate;
        if (impl.game->playerMaskAggregate) {
            for (int32_t objectId : playerObjectIds) {
                const size_t offset = tileBase + puzzlescript::maskWordIndex(static_cast<uint32_t>(objectId));
                if (offset >= impl.levelState.board.objects.size()
                    || (impl.levelState.board.objects[offset] & puzzlescript::maskBit(static_cast<uint32_t>(objectId))) == 0) {
                    containsPlayer = false;
                    break;
                }
            }
        } else {
            containsPlayer = false;
            for (int32_t objectId : playerObjectIds) {
                const size_t offset = tileBase + puzzlescript::maskWordIndex(static_cast<uint32_t>(objectId));
                if (offset < impl.levelState.board.objects.size()
                    && (impl.levelState.board.objects[offset] & puzzlescript::maskBit(static_cast<uint32_t>(objectId))) != 0) {
                    containsPlayer = true;
                    break;
                }
            }
        }
        if (!containsPlayer) {
            continue;
        }
        if (out_x) {
            *out_x = tile_index / currentLevelHeight(impl);
        }
        if (out_y) {
            *out_y = tile_index % currentLevelHeight(impl);
        }
        return true;
    }
    return false;
}

uint64_t ps_full_state_hash64(const ps_full_state* state) {
    return state ? puzzlescript::hashFullState64(*state->impl) : 0;
}

ps_hash128 ps_full_state_hash128(const ps_full_state* state) {
    return state ? puzzlescript::hashFullState128(*state->impl) : ps_hash128{};
}

char* ps_full_state_serialize_test_string(const ps_full_state* state) {
    if (!state) {
        return nullptr;
    }
    return duplicateString(puzzlescript::serializeTestString(*state->impl));
}

char* ps_full_state_export_snapshot(const ps_full_state* state) {
    if (!state) {
        return nullptr;
    }
    return duplicateString(puzzlescript::exportSnapshot(*state->impl));
}

size_t ps_full_state_list_inputs(const ps_full_state*, ps_input* output, size_t capacity) {
    return puzzlescript::listInputs(output, capacity);
}

bool ps_benchmark_full_state_clone_hash(const ps_full_state* state, uint32_t iterations, uint32_t thread_count, ps_benchmark_result* out_result, ps_error** out_error) {
    if (out_error) {
        *out_error = nullptr;
    }
    if (!state || !out_result) {
        if (out_error) {
            *out_error = makeError(std::make_unique<Error>("ps_benchmark_full_state_clone_hash received null input"));
        }
        return false;
    }
    if (auto error = puzzlescript::benchmarkCloneHash(*state->impl, iterations, thread_count, *out_result)) {
        if (out_error) {
            *out_error = makeError(std::move(error));
        }
        return false;
    }
    return true;
}

void ps_runtime_counters_set_enabled(bool enabled) {
    puzzlescript::setRuntimeCountersEnabled(enabled);
}

void ps_runtime_counters_reset(void) {
    puzzlescript::resetRuntimeCounters();
}

void ps_runtime_counters_snapshot(ps_runtime_counters* out_counters) {
    if (out_counters) {
        *out_counters = puzzlescript::snapshotRuntimeCounters();
    }
}

int32_t ps_game_level_count(const ps_game* game) {
    return game && game->impl.information ? static_cast<int32_t>(game->impl.information->levels.size()) : 0;
}

int32_t ps_game_object_count(const ps_game* game) {
    return game && game->impl.information ? game->impl.information->objectCount : 0;
}

int32_t ps_game_layer_count(const ps_game* game) {
    return game && game->impl.information ? game->impl.information->layerCount : 0;
}

int32_t ps_game_glyph_count(const ps_game* game) {
    return game && game->impl.information ? static_cast<int32_t>(game->impl.information->glyphOrder.size()) : 0;
}

static const std::vector<Game::NamedMaskEntry>* legendTableForKind(const Game& game, ps_legend_kind kind) {
    switch (kind) {
    case PS_LEGEND_SYNONYM:
        return &game.synonymMaskTable;
    case PS_LEGEND_AGGREGATE:
        return &game.aggregateMaskTable;
    case PS_LEGEND_PROPERTY:
        return &game.propertyMaskTable;
    default:
        return nullptr;
    }
}

static size_t writeObjectIdsFromMask(
    const Game& impl,
    puzzlescript::MaskOffset maskOffset,
    int32_t* output,
    size_t capacity
) {
    const size_t offset = static_cast<size_t>(maskOffset);
    const size_t wordCount = static_cast<size_t>(impl.wordCount);
    if (maskOffset == puzzlescript::kNullMaskOffset
        || offset > impl.maskArena.size()
        || wordCount > impl.maskArena.size() - offset) {
        return 0;
    }

    const puzzlescript::MaskWord* mask = impl.maskArena.data() + offset;
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
    return writeObjectIdsFromMask(impl, glyphMaskOffset, output, capacity);
}

int32_t ps_game_legend_count(const ps_game* game, ps_legend_kind kind) {
    if (!game || !game->impl.information) {
        return 0;
    }
    const std::vector<Game::NamedMaskEntry>* table = legendTableForKind(*game->impl.information, kind);
    return table == nullptr ? 0 : static_cast<int32_t>(table->size());
}

const char* ps_game_legend_name(const ps_game* game, ps_legend_kind kind, int32_t legend_index) {
    if (!game || !game->impl.information || legend_index < 0) {
        return "";
    }
    const std::vector<Game::NamedMaskEntry>* table = legendTableForKind(*game->impl.information, kind);
    if (table == nullptr || static_cast<size_t>(legend_index) >= table->size()) {
        return "";
    }
    return (*table)[static_cast<size_t>(legend_index)].name.c_str();
}

size_t ps_game_legend_object_ids(const ps_game* game, ps_legend_kind kind, int32_t legend_index, int32_t* output, size_t capacity) {
    if (!game || !game->impl.information || legend_index < 0) {
        return 0;
    }
    const Game& impl = *game->impl.information;
    const std::vector<Game::NamedMaskEntry>* table = legendTableForKind(impl, kind);
    if (table == nullptr || static_cast<size_t>(legend_index) >= table->size()) {
        return 0;
    }
    return writeObjectIdsFromMask(impl, (*table)[static_cast<size_t>(legend_index)].offset, output, capacity);
}

uint32_t ps_game_word_count(const ps_game* game) {
    return game && game->impl.information ? game->impl.information->wordCount : 0;
}

int32_t ps_game_stride_object(const ps_game* game) {
    return game && game->impl.information ? game->impl.information->strideObject : 0;
}

int32_t ps_game_stride_movement(const ps_game* game) {
    return game && game->impl.information ? game->impl.information->strideMovement : 0;
}

uint64_t ps_game_mask_arena_words(const ps_game* game) {
    return game && game->impl.information ? game->impl.information->maskArena.size() : 0;
}

uint64_t ps_game_mask_arena_bytes(const ps_game* game) {
    return game && game->impl.information
        ? game->impl.information->maskArena.size() * sizeof(puzzlescript::MaskWord)
        : 0;
}

static uint64_t countRuleGroups(const std::vector<std::vector<puzzlescript::Rule>>& groups) {
    uint64_t count = 0;
    for (const std::vector<puzzlescript::Rule>& group : groups) {
        count += group.size();
    }
    return count;
}

uint64_t ps_game_rule_count(const ps_game* game) {
    return game && game->impl.information ? countRuleGroups(game->impl.information->rules) : 0;
}

uint64_t ps_game_late_rule_count(const ps_game* game) {
    return game && game->impl.information ? countRuleGroups(game->impl.information->lateRules) : 0;
}

uint64_t ps_game_unique_mask_count(const ps_game* game) {
    if (!game || !game->impl.information) {
        return 0;
    }
    return computeGameLayoutMetrics(*game->impl.information).uniqueMaskCount;
}

double ps_game_mask_arena_utilization(const ps_game* game) {
    if (!game || !game->impl.information) {
        return 0.0;
    }
    return computeGameLayoutMetrics(*game->impl.information).maskArenaUtilization;
}

double ps_game_mask_reference_span_ratio(const ps_game* game) {
    if (!game || !game->impl.information) {
        return 0.0;
    }
    return computeGameLayoutMetrics(*game->impl.information).maskReferenceSpanRatio;
}

bool ps_game_layout_metrics(const ps_game* game, ps_game_layout_info* out_info) {
    if (!out_info) {
        return false;
    }
    *out_info = ps_game_layout_info{};
    if (!game || !game->impl.information) {
        return false;
    }
    const puzzlescript::GameLayoutMetrics metrics = computeGameLayoutMetrics(*game->impl.information);
    out_info->object_count = metrics.objectCount;
    out_info->layer_count = metrics.layerCount;
    out_info->word_count = metrics.wordCount;
    out_info->stride_object = metrics.strideObject;
    out_info->stride_movement = metrics.strideMovement;
    out_info->mask_arena_words = metrics.maskArenaWords;
    out_info->mask_arena_bytes = metrics.maskArenaBytes;
    out_info->rule_count = metrics.ruleCount;
    out_info->late_rule_count = metrics.lateRuleCount;
    out_info->mask_slot_count = metrics.maskSlotCount;
    out_info->unique_mask_count = metrics.uniqueMaskCount;
    out_info->mask_arena_utilization = metrics.maskArenaUtilization;
    out_info->mask_reference_span_words = metrics.maskReferenceSpanWords;
    out_info->mask_reference_span_ratio = metrics.maskReferenceSpanRatio;
    out_info->first_board_level_index = metrics.firstBoardLevelIndex;
    out_info->first_board_width = metrics.firstBoardWidth;
    out_info->first_board_height = metrics.firstBoardHeight;
    out_info->board_objects_bytes = metrics.boardObjectsBytes;
    return true;
}

void ps_locality_survey_set_enabled(bool enabled) {
    puzzlescript::setLocalitySurveyEnabled(enabled);
}

void ps_locality_survey_reset(void) {
    puzzlescript::resetLocalitySurvey();
}

bool ps_locality_survey_snapshot(ps_locality_survey_info* out_info) {
    if (!out_info) {
        return false;
    }
    const puzzlescript::LocalitySurveySnapshot snapshot = puzzlescript::snapshotLocalitySurvey();
    out_info->mask_arena_accesses = snapshot.maskArenaAccesses;
    out_info->mask_arena_unique_cache_lines = snapshot.maskArenaUniqueCacheLines;
    return true;
}

const char* ps_game_foreground_color(const ps_game* game) {
    return game && game->impl.information ? game->impl.information->foregroundColor.c_str() : "";
}

const char* ps_game_background_color(const ps_game* game) {
    return game && game->impl.information ? game->impl.information->backgroundColor.c_str() : "";
}

bool ps_game_has_metadata(const ps_game* game, const char* key_utf8) {
    if (!game || !game->impl.information || !key_utf8) {
        return false;
    }
    return game->impl.information->metadata.values.find(key_utf8) != game->impl.information->metadata.values.end();
}

const char* ps_game_metadata_value(const ps_game* game, const char* key_utf8) {
    if (!game || !game->impl.information || !key_utf8) {
        return "";
    }
    const auto it = game->impl.information->metadata.values.find(key_utf8);
    return it == game->impl.information->metadata.values.end() ? "" : it->second.c_str();
}

bool ps_game_sound_seed(const ps_game* game, const char* sound_name_utf8, int32_t* out_seed) {
    if (out_seed) {
        *out_seed = 0;
    }
    if (!game || !game->impl.information || !sound_name_utf8) {
        return false;
    }
    const auto it = game->impl.information->sfxEvents.find(sound_name_utf8);
    if (it == game->impl.information->sfxEvents.end()) {
        return false;
    }
    if (out_seed) {
        *out_seed = it->second;
    }
    return true;
}

bool ps_game_object_info(const ps_game* game, int32_t object_id, ps_object_info* out_info) {
    if (!game || !game->impl.information || !out_info || object_id < 0 || object_id >= game->impl.information->objectCount) {
        return false;
    }
    const auto& object = game->impl.information->objectsById[static_cast<size_t>(object_id)];
    out_info->name = object.name.c_str();
    out_info->id = object.id;
    out_info->layer = object.layer;
    out_info->color_count = object.colors.size();
    out_info->sprite_height = static_cast<int32_t>(object.sprite.size());
    out_info->sprite_width = object.sprite.empty() ? 0 : static_cast<int32_t>(object.sprite.front().size());
    return true;
}

const char* ps_game_object_color(const ps_game* game, int32_t object_id, size_t color_index) {
    if (!game || !game->impl.information || object_id < 0 || object_id >= game->impl.information->objectCount) {
        return "";
    }
    const auto& colors = game->impl.information->objectsById[static_cast<size_t>(object_id)].colors;
    return color_index < colors.size() ? colors[color_index].c_str() : "";
}

int32_t ps_game_object_sprite_value(const ps_game* game, int32_t object_id, int32_t x, int32_t y) {
    if (!game || !game->impl.information || object_id < 0 || object_id >= game->impl.information->objectCount || x < 0 || y < 0) {
        return -1;
    }
    const auto& sprite = game->impl.information->objectsById[static_cast<size_t>(object_id)].sprite;
    if (static_cast<size_t>(y) >= sprite.size() || static_cast<size_t>(x) >= sprite[static_cast<size_t>(y)].size()) {
        return -1;
    }
    return sprite[static_cast<size_t>(y)][static_cast<size_t>(x)];
}

const char* ps_error_message(const ps_error* error) {
    return error && error->impl ? error->impl->message.c_str() : "";
}

void ps_free_error(ps_error* error) {
    delete error;
}

void ps_free_game(ps_game* game) {
    delete game;
}

void ps_string_free(char* string_value) {
    delete[] string_value;
}
