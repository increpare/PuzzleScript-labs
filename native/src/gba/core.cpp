#include "puzzlescript/gba.h"

#include <cstring>
#include <new>

struct ps_gba_session {
    const ps_gba_game_view* game = nullptr;
    ps_full_state_mode mode = PS_FULL_STATE_MODE_TITLE;
    uint16_t currentLevel = 0;
    uint16_t width = 0;
    uint16_t height = 0;
    uint32_t activeWordCount = 0;
    uint32_t maxWordCount = 0;
    uint32_t* board = nullptr;
    uint32_t* restart = nullptr;
    uint32_t* turnSnapshot = nullptr;
    uint32_t* probeSnapshot = nullptr;
    uint32_t* objectCellIndex = nullptr;
    uint32_t objectCellIndexWordCapacity = 0;
    uint32_t* undo = nullptr;
    ps_gba_rng_state rng{};
    ps_gba_rng_state restartRng{};
    ps_gba_rng_state* undoRng = nullptr;
    uint8_t undoStart = 0;
    uint8_t undoCount = 0;
    bool completed = false;
    bool pendingAgain = false;
    bool resetKernelScratch = true;
    bool ruleMessage = false;
    const char* message = nullptr;
    ps_audio_event audio[4]{};
    size_t audioCount = 0;
    ps_audio_event uiAudio[4]{};
    size_t uiAudioCount = 0;
};

namespace {

constexpr size_t alignUp(size_t value, size_t alignment) {
    return (value + alignment - 1U) & ~(alignment - 1U);
}

uint32_t levelWordCount(const ps_gba_game_view* game, const ps_gba_level& level) {
    return static_cast<uint32_t>(level.width) * static_cast<uint32_t>(level.height)
        * game->object_word_count;
}

uint32_t* undoSlot(ps_gba_session* session, uint8_t slot) {
    return session->undo + static_cast<size_t>(slot) * session->maxWordCount;
}

const uint32_t* cellWords(const ps_gba_session* session, int32_t x, int32_t y) {
    if (session == nullptr || session->mode != PS_FULL_STATE_MODE_LEVEL || x < 0 || y < 0
        || x >= session->width || y >= session->height) {
        return nullptr;
    }
    // The native compact kernel uses PuzzleScript's canonical column-major
    // tile order. Keep that order in EWRAM and translate coordinates here.
    const size_t cell = static_cast<size_t>(x) * session->height + static_cast<size_t>(y);
    return session->board + cell * session->game->object_word_count;
}

bool testObject(const uint32_t* words, int32_t objectId) {
    if (words == nullptr || objectId < 0) return false;
    return (words[static_cast<uint32_t>(objectId) >> 5U]
        & (uint32_t{1} << (static_cast<uint32_t>(objectId) & 31U))) != 0;
}

bool matchesMask(const uint32_t* words, const uint32_t* mask, uint16_t wordCount) {
    if (words == nullptr || mask == nullptr) return false;
    for (uint16_t word = 0; word < wordCount; ++word) {
        if ((words[word] & mask[word]) != 0) return true;
    }
    return false;
}

void seedRng(ps_gba_rng_state* rng, const char* seed) {
    for (uint16_t index = 0; index < 256; ++index) rng->s[index] = static_cast<uint8_t>(index);
    rng->i = 0;
    rng->j = 0;
    const size_t seedLength = seed == nullptr ? 0 : std::strlen(seed);
    rng->valid = seedLength != 0;
    if (!rng->valid) return;
    uint16_t j = 0;
    for (uint16_t index = 0; index < 256; ++index) {
        j = static_cast<uint16_t>((j + rng->s[index]
            + static_cast<uint8_t>(seed[index % seedLength])) & 0xffU);
        const uint8_t tmp = rng->s[index];
        rng->s[index] = rng->s[j];
        rng->s[j] = tmp;
    }
}

void clearStepEvents(ps_gba_session* session) {
    session->audioCount = 0;
    session->uiAudioCount = 0;
}

void emitNamedUiAudio(ps_gba_session* session, const char* name) {
    if (name == nullptr || session->uiAudioCount >= (sizeof(session->uiAudio) / sizeof(session->uiAudio[0]))) return;
    for (uint16_t sound = 0; sound < session->game->sound_count; ++sound) {
        if (std::strcmp(session->game->sounds[sound].name, name) == 0) {
            session->uiAudio[session->uiAudioCount++] = ps_audio_event{session->game->sounds[sound].seed, "sfx"};
            return;
        }
    }
}

bool hasMetadata(const ps_gba_game_view* game, const char* key) {
    if (game == nullptr || key == nullptr) return false;
    for (uint16_t index = 0; index < game->metadata_count; ++index) {
        if (std::strcmp(game->metadata[index].key, key) == 0) return true;
    }
    return false;
}

void applyKernelOutputs(ps_gba_session* session, const ps_gba_kernel_result& kernel) {
    for (uint8_t sound = 0; sound < kernel.sound_count; ++sound) {
        emitNamedUiAudio(session, kernel.sound_names[sound]);
    }
    session->pendingAgain = kernel.pending_again;
    if (kernel.checkpoint) {
        std::memcpy(session->restart, session->board, session->activeWordCount * sizeof(uint32_t));
        session->restartRng = session->rng;
    }
    if (kernel.message != nullptr) {
        session->mode = PS_FULL_STATE_MODE_MESSAGE;
        session->message = kernel.message;
        session->ruleMessage = true;
        session->pendingAgain = false;
    }
}

void runRulesOnLevelStart(ps_gba_session* session) {
    if (session == nullptr || session->mode != PS_FULL_STATE_MODE_LEVEL
        || !hasMetadata(session->game, "run_rules_on_level_start")) return;
    const ps_gba_kernel_result kernel = session->game->turn_kernel(
        session->board, session->activeWordCount,
        session->turnSnapshot, session->probeSnapshot, session->maxWordCount,
        session->objectCellIndex, session->objectCellIndexWordCapacity,
        session->width, session->height,
        session->currentLevel, PS_INPUT_TICK, &session->rng, session->resetKernelScratch, true);
    session->resetKernelScratch = false;
    if (kernel.handled && !kernel.discard) applyKernelOutputs(session, kernel);
}

void pushUndo(ps_gba_session* session) {
    if (session->game->no_undo || session->activeWordCount == 0) return;
    uint8_t slot = 0;
    if (session->undoCount < session->game->undo_capacity) {
        slot = static_cast<uint8_t>((session->undoStart + session->undoCount) % session->game->undo_capacity);
        ++session->undoCount;
    } else {
        slot = session->undoStart;
        session->undoStart = static_cast<uint8_t>((session->undoStart + 1U) % session->game->undo_capacity);
    }
    std::memcpy(undoSlot(session, slot), session->board, session->activeWordCount * sizeof(uint32_t));
    session->undoRng[slot] = session->rng;
}

void discardLatestUndo(ps_gba_session* session) {
    if (!session->game->no_undo && session->undoCount > 0) --session->undoCount;
}

bool loadLevelInternal(ps_gba_session* session, uint16_t levelIndex,
    const char* seed, bool resetRandomState) {
    if (session == nullptr || levelIndex >= session->game->level_count) return false;
    const ps_gba_level& level = session->game->levels[levelIndex];
    session->currentLevel = levelIndex;
    session->undoStart = 0;
    session->undoCount = 0;
    session->pendingAgain = false;
    session->resetKernelScratch = true;
    session->message = level.message;
    session->ruleMessage = false;
    if (resetRandomState) seedRng(&session->rng, seed);
    session->restartRng = session->rng;
    if (level.kind == PS_GBA_LEVEL_MESSAGE) {
        session->mode = PS_FULL_STATE_MODE_MESSAGE;
        session->width = 0;
        session->height = 0;
        session->activeWordCount = 0;
        return true;
    }
    const uint32_t words = levelWordCount(session->game, level);
    if (level.object_words == nullptr || words > session->maxWordCount) return false;
    session->mode = PS_FULL_STATE_MODE_LEVEL;
    session->width = level.width;
    session->height = level.height;
    session->activeWordCount = words;
    session->message = nullptr;
    std::memcpy(session->board, level.object_words, words * sizeof(uint32_t));
    std::memcpy(session->restart, level.object_words, words * sizeof(uint32_t));
    runRulesOnLevelStart(session);
    return true;
}

bool advanceLevel(ps_gba_session* session) {
    const uint16_t next = static_cast<uint16_t>(session->currentLevel + 1U);
    if (next >= session->game->level_count) {
        session->mode = PS_FULL_STATE_MODE_TITLE;
        session->completed = true;
        session->width = 0;
        session->height = 0;
        session->activeWordCount = 0;
        session->undoCount = 0;
        session->message = nullptr;
        session->ruleMessage = false;
        session->pendingAgain = false;
        session->resetKernelScratch = true;
        return true;
    }
    // PuzzleScript preserves the random stream across ordinary level and
    // message transitions.  Only an explicit direct level load establishes a
    // new seed.
    return loadLevelInternal(session, next, nullptr, false);
}

ps_step_result makeResult(ps_gba_session* session, bool changed, bool won,
    bool transitioned, bool restarted) {
    ps_step_result result{};
    result.changed = changed;
    result.won = won;
    result.transitioned = transitioned;
    result.restarted = restarted;
    result.audio_event_count = session->audioCount;
    result.audio_events = session->audioCount == 0 ? nullptr : session->audio;
    result.ui_audio_event_count = session->uiAudioCount;
    result.ui_audio_events = session->uiAudioCount == 0 ? nullptr : session->uiAudio;
    return result;
}

} // namespace

size_t ps_gba_session_required_bytes(const ps_gba_game_view* game) {
    if (game == nullptr || game->object_word_count == 0 || game->max_level_cells == 0) return 0;
    const size_t words = static_cast<size_t>(game->max_level_cells) * game->object_word_count;
    if (game->undo_capacity == 0 || game->undo_capacity > PS_GBA_UNDO_CAPACITY) return 0;
    const size_t stateCopies = 4U + game->undo_capacity;
    const size_t storageWords = words * stateCopies + game->object_cell_index_word_count;
    const size_t boardBytes = storageWords * sizeof(uint32_t);
    const size_t rngOffset = alignUp(
        alignUp(sizeof(ps_gba_session), alignof(uint32_t)) + boardBytes,
        alignof(ps_gba_rng_state));
    return rngOffset + game->undo_capacity * sizeof(ps_gba_rng_state);
}

ps_gba_session* ps_gba_session_init(void* arena, size_t arenaSize, const ps_gba_game_view* game) {
    const size_t required = ps_gba_session_required_bytes(game);
    if (arena == nullptr || required == 0 || arenaSize < required
        || game->abi_version != PS_GBA_GAME_ABI_VERSION
        || game->runtime_profile != PS_GBA_RUNTIME_GENERATED_COMPACT
        || game->turn_kernel == nullptr) {
        return nullptr;
    }
    auto* session = new (arena) ps_gba_session();
    session->game = game;
    session->maxWordCount = static_cast<uint32_t>(game->max_level_cells) * game->object_word_count;
    session->objectCellIndexWordCapacity = game->object_cell_index_word_count;
    const size_t storageOffset = alignUp(sizeof(ps_gba_session), alignof(uint32_t));
    auto* storage = reinterpret_cast<uint32_t*>(reinterpret_cast<uint8_t*>(arena) + storageOffset);
    session->board = storage;
    session->restart = storage + session->maxWordCount;
    session->turnSnapshot = session->restart + session->maxWordCount;
    session->probeSnapshot = session->turnSnapshot + session->maxWordCount;
    session->objectCellIndex = session->probeSnapshot + session->maxWordCount;
    session->undo = session->objectCellIndex + session->objectCellIndexWordCapacity;
    const size_t boardBytes = (static_cast<size_t>(session->maxWordCount)
        * (4U + game->undo_capacity) + session->objectCellIndexWordCapacity) * sizeof(uint32_t);
    const size_t rngOffset = alignUp(storageOffset + boardBytes, alignof(ps_gba_rng_state));
    session->undoRng = reinterpret_cast<ps_gba_rng_state*>(reinterpret_cast<uint8_t*>(arena) + rngOffset);
    std::memset(storage, 0, required - storageOffset);
    seedRng(&session->rng, "native");
    session->restartRng = session->rng;
    return session;
}

bool ps_gba_load_level(ps_gba_session* session, uint16_t levelIndex) {
    return loadLevelInternal(session, levelIndex, "native", true);
}

bool ps_gba_load_level_with_seed(ps_gba_session* session, uint16_t levelIndex, const char* seed) {
    return loadLevelInternal(session, levelIndex, seed, true);
}

ps_step_result ps_gba_step(ps_gba_session* session, ps_input input) {
    if (session == nullptr) return ps_step_result{};
    clearStepEvents(session);
    if (session->mode == PS_FULL_STATE_MODE_TITLE) {
        if (input == PS_INPUT_ACTION && session->game->level_count > 0 && ps_gba_load_level(session, 0))
            return makeResult(session, true, false, true, false);
        return makeResult(session, false, false, false, false);
    }
    if (session->mode == PS_FULL_STATE_MODE_MESSAGE) {
        if (input == PS_INPUT_ACTION) {
            if (session->ruleMessage) {
                session->mode = PS_FULL_STATE_MODE_LEVEL;
                session->message = nullptr;
                session->ruleMessage = false;
                return makeResult(session, true, false, true, false);
            }
            if (advanceLevel(session)) return makeResult(session, true, false, true, false);
        }
        return makeResult(session, false, false, false, false);
    }
    if (input == PS_INPUT_ACTION && session->game->no_action)
        return makeResult(session, false, false, false, false);

    const bool wasPendingAgain = session->pendingAgain;
    const bool recordsUndo = input != PS_INPUT_TICK && !session->game->no_undo;
    if (recordsUndo) pushUndo(session);
    const ps_gba_kernel_result kernel = session->game->turn_kernel(
        session->board, session->activeWordCount,
        session->turnSnapshot, session->probeSnapshot, session->maxWordCount,
        session->objectCellIndex, session->objectCellIndexWordCapacity,
        session->width, session->height,
        session->currentLevel, input, &session->rng, session->resetKernelScratch, false);
    session->resetKernelScratch = false;
    if (!kernel.handled || kernel.discard) {
        if (recordsUndo) discardLatestUndo(session);
        session->pendingAgain = false;
        return makeResult(session, false, false, false, false);
    }
    for (uint8_t sound = 0; sound < kernel.sound_count; ++sound) emitNamedUiAudio(session, kernel.sound_names[sound]);
    if (recordsUndo && !kernel.changed) discardLatestUndo(session);

    bool transitioned = false;
    if (kernel.restarted) {
        std::memcpy(session->board, session->restart, session->activeWordCount * sizeof(uint32_t));
        session->rng = session->restartRng;
        session->pendingAgain = false;
        session->resetKernelScratch = true;
    } else if (kernel.won) {
        session->pendingAgain = false;
        transitioned = advanceLevel(session);
    } else {
        session->pendingAgain = kernel.pending_again;
        if (kernel.checkpoint) {
            std::memcpy(session->restart, session->board, session->activeWordCount * sizeof(uint32_t));
            session->restartRng = session->rng;
        }
        if (kernel.message != nullptr) {
            session->mode = PS_FULL_STATE_MODE_MESSAGE;
            session->message = kernel.message;
            session->ruleMessage = true;
            session->pendingAgain = false;
        }
    }
    // The generated kernel caches row/column/board masks between calls.  An
    // `again` probe can finish with the canonical board restored while those
    // derived caches still describe the probe.  Rebuild them before the next
    // real input; this is especially important after run_rules_on_level_start.
    if (input == PS_INPUT_TICK && wasPendingAgain && !session->pendingAgain) {
        session->resetKernelScratch = true;
    }
    // A terminal command/transition is a visible state change even when the
    // rule itself did not modify a board cell.  This matches the native player
    // result contract for command-only `win` levels and cutscenes.
    return makeResult(session,
        kernel.changed || kernel.won || transitioned || kernel.restarted,
        kernel.won, transitioned, kernel.restarted);
}

bool ps_gba_undo(ps_gba_session* session) {
    if (session == nullptr || session->game->no_undo || session->mode != PS_FULL_STATE_MODE_LEVEL
        || session->undoCount == 0) return false;
    const uint8_t slot = static_cast<uint8_t>(
        (session->undoStart + session->undoCount - 1U) % session->game->undo_capacity);
    std::memcpy(session->board, undoSlot(session, slot), session->activeWordCount * sizeof(uint32_t));
    session->rng = session->undoRng[slot];
    --session->undoCount;
    session->pendingAgain = false;
    session->resetKernelScratch = true;
    clearStepEvents(session);
    return true;
}

bool ps_gba_restart(ps_gba_session* session) {
    if (session == nullptr || session->game->no_restart || session->mode != PS_FULL_STATE_MODE_LEVEL)
        return false;
    pushUndo(session);
    std::memcpy(session->board, session->restart, session->activeWordCount * sizeof(uint32_t));
    session->rng = session->restartRng;
    session->pendingAgain = false;
    session->resetKernelScratch = true;
    clearStepEvents(session);
    runRulesOnLevelStart(session);
    return true;
}

void ps_gba_status_get(const ps_gba_session* session, ps_gba_status* status) {
    if (status == nullptr) return;
    *status = ps_gba_status{};
    if (session == nullptr) return;
    status->mode = session->mode;
    status->current_level = session->currentLevel;
    status->width = session->width;
    status->height = session->height;
    status->can_undo = !session->game->no_undo && session->undoCount > 0;
    status->pending_again = session->pendingAgain;
    status->completed = session->completed;
    status->message = session->message;
}

void ps_gba_random_state_get(const ps_gba_session* session, ps_gba_rng_state* state) {
    if (state == nullptr) return;
    *state = session == nullptr ? ps_gba_rng_state{} : session->rng;
}

bool ps_gba_cell_has_object(const ps_gba_session* session, int32_t x, int32_t y, int32_t objectId) {
    if (session == nullptr || objectId < 0 || objectId >= session->game->object_count) return false;
    return testObject(cellWords(session, x, y), objectId);
}

bool ps_gba_first_player_position(const ps_gba_session* session, int32_t* x, int32_t* y) {
    if (session == nullptr || x == nullptr || y == nullptr || session->mode != PS_FULL_STATE_MODE_LEVEL
        || session->game->player_mask == nullptr) return false;
    for (int32_t row = 0; row < session->height; ++row) {
        for (int32_t column = 0; column < session->width; ++column) {
            if (matchesMask(cellWords(session, column, row), session->game->player_mask,
                    session->game->object_word_count)) {
                *x = column;
                *y = row;
                return true;
            }
        }
    }
    return false;
}

const uint32_t* ps_gba_board_words(const ps_gba_session* session) {
    return session == nullptr || session->mode != PS_FULL_STATE_MODE_LEVEL ? nullptr : session->board;
}

const ps_gba_game_view* ps_gba_game(const ps_gba_session* session) {
    return session == nullptr ? nullptr : session->game;
}
