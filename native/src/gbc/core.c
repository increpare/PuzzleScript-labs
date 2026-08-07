#if defined(PS_GBC_GENERATED_BUILD)
#include "generated_namespace.h"
#endif

#include "puzzlescript/gbc.h"

#if defined(PS_GBC_GENERATED_BUILD)
#include "generated_game.h"
#if !defined(PS_GBC_GENERATED_ABI_VERSION) \
    || PS_GBC_GENERATED_ABI_VERSION != PS_GBC_GAME_ABI_VERSION
#error "generated GBC data ABI does not match the runtime"
#endif
#endif

#include "session_internal.h"
#include "specialized_turn.h"

#if defined(PS_GBC_FREESTANDING)
#include "puzzlescript/gbc_bank_access.h"
#endif

#include <string.h>

#if defined(PS_GBC_GENERATED_PACKED_PATTERNS)
typedef ps_gbc_generated_pattern ps_gbc_runtime_pattern;
typedef ps_gbc_generated_object_mask ps_gbc_runtime_object_mask;
typedef ps_gbc_generated_movement_mask ps_gbc_runtime_movement_mask;
#else
typedef ps_gbc_pattern ps_gbc_runtime_pattern;
typedef uint32_t ps_gbc_runtime_object_mask;
typedef uint32_t ps_gbc_runtime_movement_mask;
#endif

#if defined(PS_GBC_GENERATED_PACKED_RULES)
typedef ps_gbc_generated_rule ps_gbc_runtime_rule;
#else
typedef ps_gbc_rule ps_gbc_runtime_rule;
#endif

#define PS_GBC_GROUP_PASSES 200
#define PS_GBC_RULE_LOOPS 200

static bool ps_gbc_board_differs_from_turn_start(
    ps_gbc_session* session,
    uint16_t board_bytes
) {
    uint16_t index;
    if (board_bytes == 0U
        || session->again_probe == NULL) {
        return true;
    }
    if (!session->snapshots.read(
            session->snapshots.context,
            (uint8_t)session->undo_head,
            session->again_probe,
            board_bytes)) {
        return true;
    }
    for (index = 0U; index < board_bytes; ++index) {
        if (session->board[index] != session->again_probe[index]) return true;
    }
    return false;
}

#if !defined(PS_GBC_GENERATED_SOUND_COUNT) \
    || PS_GBC_GENERATED_SOUND_COUNT != 0U
#define PS_GBC_HAS_AUDIO 1
#else
#define PS_GBC_HAS_AUDIO 0
#endif

#if !defined(PS_GBC_GENERATED_CREATION_SOUND_COUNT) \
    || PS_GBC_GENERATED_CREATION_SOUND_COUNT != 0U
#define PS_GBC_HAS_CREATION_AUDIO 1
#else
#define PS_GBC_HAS_CREATION_AUDIO 0
#endif

#if !defined(PS_GBC_GENERATED_DESTRUCTION_SOUND_COUNT) \
    || PS_GBC_GENERATED_DESTRUCTION_SOUND_COUNT != 0U
#define PS_GBC_HAS_DESTRUCTION_AUDIO 1
#else
#define PS_GBC_HAS_DESTRUCTION_AUDIO 0
#endif

#if !defined(PS_GBC_GENERATED_MOVEMENT_SOUND_COUNT) \
    || PS_GBC_GENERATED_MOVEMENT_SOUND_COUNT != 0U
#define PS_GBC_HAS_MOVEMENT_AUDIO 1
#else
#define PS_GBC_HAS_MOVEMENT_AUDIO 0
#endif

#if !defined(PS_GBC_GENERATED_MOVEMENT_FAILURE_SOUND_COUNT) \
    || PS_GBC_GENERATED_MOVEMENT_FAILURE_SOUND_COUNT != 0U
#define PS_GBC_HAS_MOVEMENT_FAILURE_AUDIO 1
#else
#define PS_GBC_HAS_MOVEMENT_FAILURE_AUDIO 0
#endif

#if !defined(PS_GBC_GENERATED_RULE_SOUND_COUNT) \
    || PS_GBC_GENERATED_RULE_SOUND_COUNT != 0U
#define PS_GBC_HAS_RULE_AUDIO 1
#else
#define PS_GBC_HAS_RULE_AUDIO 0
#endif

#if !defined(PS_GBC_GENERATED_RULE_MESSAGE_COUNT) \
    || PS_GBC_GENERATED_RULE_MESSAGE_COUNT != 0U
#define PS_GBC_HAS_RULE_MESSAGES 1
#else
#define PS_GBC_HAS_RULE_MESSAGES 0
#endif

#if defined(PS_GBC_PERF_PHASES)
extern void ps_gbc_perf_phase_begin(uint8_t phase);
extern void ps_gbc_perf_phase_end(uint8_t phase);
#define PS_GBC_PERF_BEGIN(phase) ps_gbc_perf_phase_begin((uint8_t)(phase))
#define PS_GBC_PERF_END(phase) ps_gbc_perf_phase_end((uint8_t)(phase))
#else
#define PS_GBC_PERF_BEGIN(phase) ((void)(phase))
#define PS_GBC_PERF_END(phase) ((void)(phase))
#endif

#if defined(PS_GBC_PERF_SCHEDULES)
extern uint16_t gPerfScheduleCounts[PS_GBC_PERF_SCHEDULE_COUNT];
extern bool gPerfPhaseEnabled;
#define PS_GBC_PERF_COUNT(counter) \
    do { \
        if (gPerfPhaseEnabled) ++gPerfScheduleCounts[(uint8_t)(counter)]; \
    } while (0)
#else
#define PS_GBC_PERF_COUNT(counter) ((void)(counter))
#endif

enum {
    PS_GBC_AUDIO_CANTMOVE = 0U,
    PS_GBC_AUDIO_CANMOVE = 1U,
    PS_GBC_AUDIO_CREATE = 2U,
    PS_GBC_AUDIO_DESTROY = 3U,
    PS_GBC_AUDIO_SFX = 4U,
    PS_GBC_AUDIO_UI = 5U
};

#if !defined(PS_GBC_FREESTANDING)
static const char kAudioKindCantmove[] = "cantmove";
static const char kAudioKindCanmove[] = "canmove";
static const char kAudioKindCreate[] = "create";
static const char kAudioKindDestroy[] = "destroy";
static const char kAudioKindSfx[] = "sfx";
static const char kAudioKindUi[] = "ui";
#endif

#if !defined(PS_GBC_FREESTANDING)
static const char* ps_gbc_audio_kind_name(uint8_t kind) {
    switch (kind) {
        case PS_GBC_AUDIO_CANTMOVE: return kAudioKindCantmove;
        case PS_GBC_AUDIO_CANMOVE: return kAudioKindCanmove;
        case PS_GBC_AUDIO_CREATE: return kAudioKindCreate;
        case PS_GBC_AUDIO_DESTROY: return kAudioKindDestroy;
        case PS_GBC_AUDIO_SFX: return kAudioKindSfx;
        default: return kAudioKindUi;
    }
}
#endif

#if PS_GBC_HAS_AUDIO
static void ps_gbc_audio_append(
    ps_gbc_session* session,
    uint8_t sound_id,
    uint8_t kind,
    bool ui
) {
    ps_audio_event* events;
    uint8_t* count;
    uint8_t index;
    int32_t seed;
    if (session->suppress_audio || sound_id == PS_GBC_NO_SOUND
        || sound_id >= session->game->sound_count) return;
    seed = session->game->sound_seeds[sound_id];
    events = ui ? session->ui_audio_events : session->audio_events;
    count = ui ? &session->ui_audio_count : &session->audio_count;
#if defined(PS_GBC_FREESTANDING)
    /*
     * Seed identity is all the hardware player observes. Deduplicating it
     * directly avoids retaining the host-only event categories in scarce
     * WRAM and fixed-bank code.
     */
    (void)kind;
    for (index = 0U; index < *count; ++index) {
        if (events[index].seed == seed) return;
    }
#else
    if (ui || kind == PS_GBC_AUDIO_CANMOVE || kind == PS_GBC_AUDIO_CANTMOVE) {
        for (index = 0U; index < *count; ++index) {
            if (events[index].seed == seed
                && (ui || session->audio_kinds[index] == kind)) return;
        }
    }
#endif
    if (*count >= PS_GBC_MAX_AUDIO_EVENTS) return;
    events[*count].seed = seed;
#if !defined(PS_GBC_FREESTANDING)
    events[*count].kind = ps_gbc_audio_kind_name(kind);
#endif
#if !defined(PS_GBC_FREESTANDING)
    if (!ui) session->audio_kinds[*count] = kind;
#endif
    ++*count;
}

static void ps_gbc_audio_append_named(
    ps_gbc_session* session,
    ps_gbc_named_sound sound
) {
    if (session->game->named_sound_ids == NULL
        || sound >= PS_GBC_NAMED_SOUND_COUNT) return;
    ps_gbc_audio_append(
        session, session->game->named_sound_ids[sound], PS_GBC_AUDIO_UI, true);
}

static void ps_gbc_audio_result(
    ps_gbc_session* session,
    ps_step_result* result
) {
    result->audio_event_count = session->audio_count;
    result->audio_events =
        session->audio_count == 0U ? NULL : session->audio_events;
    result->ui_audio_event_count = session->ui_audio_count;
    result->ui_audio_events =
        session->ui_audio_count == 0U ? NULL : session->ui_audio_events;
}
#endif


static size_t ps_gbc_align4(size_t value) {
    return (value + 3U) & ~(size_t)3U;
}

static uint8_t* ps_gbc_align_pointer(uint8_t* value) {
    uintptr_t address = (uintptr_t)value;
    address = (address + 3U) & ~(uintptr_t)3U;
    return (uint8_t*)address;
}

static uint8_t ps_gbc_object_width(const ps_gbc_game_view* game) {
#if defined(PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL)
    (void)game;
    return PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL;
#else
    return game->object_bytes_per_cell;
#endif
}

static size_t ps_gbc_board_bytes(const ps_gbc_game_view* game) {
    return (size_t)game->max_level_cells * ps_gbc_object_width(game);
}

static uint8_t ps_gbc_movement_width(const ps_gbc_game_view* game) {
#if defined(PS_GBC_BENCH_WIDE_MOVEMENTS)
    (void)game;
    return 4U;
#else
    return game->movement_bytes_per_cell;
#endif
}

static size_t ps_gbc_movement_bytes(const ps_gbc_game_view* game) {
    return (size_t)game->max_level_cells * ps_gbc_movement_width(game);
}

static size_t ps_gbc_cell_bitset_bytes(const ps_gbc_game_view* game) {
    return ((size_t)game->max_level_cells + 7U) / 8U;
}

#if PS_GBC_HAS_PLAYER_CELL_ANCHORS
static void ps_gbc_track_player_cell(
    ps_gbc_session* session,
    uint8_t cell,
    uint32_t objects
) {
    uint8_t index = 0U;
    uint8_t shift;
    if ((objects & session->game->player_mask) == 0U) return;
    while (index < session->player_cell_count
        && session->player_cells[index] < cell) ++index;
    if (index < session->player_cell_count
        && session->player_cells[index] == cell) return;
    shift = session->player_cell_count;
    while (shift > index) {
        session->player_cells[shift] = session->player_cells[shift - 1U];
        --shift;
    }
    session->player_cells[index] = cell;
    ++session->player_cell_count;
}
#endif

/*
 * Generated cartridges specialize board access at preprocessing time. Keep
 * the host-library fallback dynamic so one test binary can exercise all widths.
 */
#if defined(PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL)
#if PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL == 1U
#define ps_gbc_board_get(session, cell) ((session)->board[(cell)])
#define ps_gbc_board_set(session, cell, objects) \
    ((session)->board[(cell)] = (uint8_t)(objects))
#elif PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL == 2U
#define ps_gbc_board_get(session, cell) (((const uint16_t*)(session)->board)[(cell)])
#define ps_gbc_board_set(session, cell, objects) \
    (((uint16_t*)(session)->board)[(cell)] = (uint16_t)(objects))
#else
#define ps_gbc_board_get(session, cell) (((const uint32_t*)(session)->board)[(cell)])
#define ps_gbc_board_set(session, cell, objects) \
    (((uint32_t*)(session)->board)[(cell)] = (objects))
#endif
#else
static uint32_t ps_gbc_board_get(const ps_gbc_session* session, uint16_t cell) {
    const uint8_t width = ps_gbc_object_width(session->game);
    if (width == 1U) return session->board[cell];
    if (width == 2U) return ((const uint16_t*)session->board)[cell];
    return ((const uint32_t*)session->board)[cell];
}

static void ps_gbc_board_set(ps_gbc_session* session, uint16_t cell, uint32_t objects) {
    const uint8_t width = ps_gbc_object_width(session->game);
    if (width == 1U) {
        session->board[cell] = (uint8_t)objects;
    } else if (width == 2U) {
        ((uint16_t*)session->board)[cell] = (uint16_t)objects;
    } else {
        ((uint32_t*)session->board)[cell] = objects;
    }
}
#endif

static void ps_gbc_mark_dirty(ps_gbc_session* session, uint16_t cell) {
    session->dirty_bits[cell >> 3U] |= (uint8_t)(1U << (cell & 7U));
}

static void ps_gbc_mark_all_dirty(ps_gbc_session* session) {
    memset(session->dirty_bits, 0xff, ps_gbc_cell_bitset_bytes(session->game));
}

static uint32_t ps_gbc_movement_get(const ps_gbc_session* session, uint16_t cell) {
#if defined(PS_GBC_BENCH_WIDE_MOVEMENTS)
    return ((const uint32_t*)session->movements)[cell];
#elif defined(PS_GBC_GENERATED_MOVEMENT_BYTES_PER_CELL)
#if PS_GBC_GENERATED_MOVEMENT_BYTES_PER_CELL == 1U
    return session->movements[cell];
#elif PS_GBC_GENERATED_MOVEMENT_BYTES_PER_CELL == 2U
    return ((const uint16_t*)session->movements)[cell];
#else
    return ((const uint32_t*)session->movements)[cell];
#endif
#else
    const uint8_t width = ps_gbc_movement_width(session->game);
    if (width == 1U) return session->movements[cell];
    if (width == 2U) return ((const uint16_t*)session->movements)[cell];
    return ((const uint32_t*)session->movements)[cell];
#endif
}

static void ps_gbc_movement_set(ps_gbc_session* session, uint16_t cell, uint32_t movement) {
#if defined(PS_GBC_BENCH_WIDE_MOVEMENTS)
    ((uint32_t*)session->movements)[cell] = movement;
#elif defined(PS_GBC_GENERATED_MOVEMENT_BYTES_PER_CELL)
#if PS_GBC_GENERATED_MOVEMENT_BYTES_PER_CELL == 1U
    session->movements[cell] = (uint8_t)movement;
#elif PS_GBC_GENERATED_MOVEMENT_BYTES_PER_CELL == 2U
    ((uint16_t*)session->movements)[cell] = (uint16_t)movement;
#else
    ((uint32_t*)session->movements)[cell] = movement;
#endif
#else
    const uint8_t width = ps_gbc_movement_width(session->game);
    if (width == 1U) {
        session->movements[cell] = (uint8_t)movement;
    } else if (width == 2U) {
        ((uint16_t*)session->movements)[cell] = (uint16_t)movement;
    } else {
        ((uint32_t*)session->movements)[cell] = movement;
    }
#endif
}

static bool ps_gbc_game_valid(const ps_gbc_game_view* game) {
    uint8_t movement_layer;
    uint8_t object_id;
    if (game == NULL || game->abi_version != PS_GBC_GAME_ABI_VERSION) return false;
    if (game->object_count == 0U || game->object_count > PS_GBC_MAX_OBJECTS) return false;
    if ((game->object_count <= 8U && game->object_bytes_per_cell != 1U)
        || (game->object_count >= 9U && game->object_count <= 16U
            && game->object_bytes_per_cell != 2U)
        || (game->object_count >= 17U && game->object_bytes_per_cell != 4U)) return false;
    if (game->layer_count == 0U || game->layer_count > PS_GBC_MAX_COLLISION_LAYERS) return false;
    if (game->movement_layer_count == 0U
        || game->movement_layer_count > PS_GBC_MAX_MOVEMENT_LAYERS) return false;
#if defined(PS_GBC_BENCH_WIDE_MOVEMENTS)
    if (ps_gbc_movement_width(game) != 4U) return false;
#else
    if ((game->movement_layer_count <= 1U && game->movement_bytes_per_cell != 1U)
        || (game->movement_layer_count >= 2U && game->movement_layer_count <= 3U
            && game->movement_bytes_per_cell != 2U)
        || (game->movement_layer_count >= 4U && game->movement_bytes_per_cell != 4U)) return false;
#endif
    if (game->undo_capacity == 0U || game->undo_capacity > PS_GBC_MAX_UNDO) return false;
    if (game->level_count == 0U || game->max_level_cells == 0U
        || game->max_level_cells > PS_GBC_MAX_BOARD_CELLS) return false;
    if (game->viewport_width == 0U || game->viewport_width > PS_GBC_VIEWPORT_WIDTH) return false;
    if (game->viewport_height == 0U || game->viewport_height > PS_GBC_VIEWPORT_HEIGHT) return false;
    if (game->layer_masks == NULL || game->movement_collision_layers == NULL
        || game->objects == NULL || game->levels == NULL) return false;
    for (movement_layer = 0U;
         movement_layer < game->movement_layer_count;
         ++movement_layer) {
        uint8_t previous;
        if (game->movement_collision_layers[movement_layer] >= game->layer_count) return false;
        for (previous = 0U; previous < movement_layer; ++previous) {
            if (game->movement_collision_layers[previous]
                == game->movement_collision_layers[movement_layer]) return false;
        }
    }
    for (object_id = 0U; object_id < game->object_count; ++object_id) {
        const ps_gbc_object* object = &game->objects[object_id];
        if (object->layer >= game->layer_count) return false;
        if (object->movement_layer != PS_GBC_NO_MOVEMENT_LAYER
            && (object->movement_layer >= game->movement_layer_count
                || game->movement_collision_layers[object->movement_layer]
                    != object->layer)) return false;
    }
    if (game->pattern_count != 0U && game->patterns == NULL) return false;
    if (game->rule_count != 0U && game->rules == NULL) return false;
    if (game->early_group_count != 0U && game->early_groups == NULL) return false;
    if (game->late_group_count != 0U && game->late_groups == NULL) return false;
    if (game->win_condition_count != 0U && game->win_conditions == NULL) return false;
    if (game->sound_count != 0U && game->sound_seeds == NULL) return false;
    if (game->named_sound_ids == NULL) return false;
    if (game->rule_sound_count != 0U && game->rule_sound_ids == NULL) return false;
    if (game->creation_sound_count != 0U && game->creation_sounds == NULL) return false;
    if (game->destruction_sound_count != 0U
        && game->destruction_sounds == NULL) return false;
    if (game->movement_sound_count != 0U && game->movement_sounds == NULL) return false;
    if (game->movement_failure_sound_count != 0U
        && game->movement_failure_sounds == NULL) return false;
    if (game->background_palettes == NULL || game->palette_remap == NULL
        || game->ui_palette == NULL) return false;
    return true;
}

size_t ps_gbc_session_required_bytes(const ps_gbc_game_view* game) {
    size_t board_bytes;
    size_t movement_bytes;
    size_t result;
    if (!ps_gbc_game_valid(game)) return 0U;
    board_bytes = ps_gbc_board_bytes(game);
    movement_bytes = ps_gbc_movement_bytes(game);
    result = ps_gbc_align4(sizeof(ps_gbc_session));
    result += board_bytes;
    result += board_bytes;
    result = ps_gbc_align4(result);
    result += movement_bytes;
#if PS_GBC_HAS_PLAYER_CELL_ANCHORS
    result += game->max_level_cells;
#endif
    result += ps_gbc_cell_bitset_bytes(game);
    return result + 3U;
}

static void ps_gbc_clear_transient(ps_gbc_session* session) {
    memset(session->movements, 0, ps_gbc_movement_bytes(session->game));
    session->pending_again = false;
    session->undo_head = 0U;
    session->undo_count = 0U;
}

static void ps_gbc_run_rules_on_level_start(ps_gbc_session* session);

static bool ps_gbc_copy_level_cells(
    const void* source,
    void* destination,
    uint16_t byte_count
) {
#if defined(PS_GBC_FREESTANDING)
    if (ps_gbc_level_cells_read != NULL) {
        return ps_gbc_level_cells_read(source, destination, byte_count);
    }
#endif
    memcpy(destination, source, byte_count);
    return true;
}

static bool ps_gbc_load_board(ps_gbc_session* session, uint16_t level_index) {
    const ps_gbc_level* level = &session->game->levels[level_index];
    size_t cells;
    size_t bytes;
    if (level->kind != PS_GBC_LEVEL_BOARD || level->cells == NULL) return false;
    cells = (size_t)level->width * (size_t)level->height;
    if (cells == 0U || cells > session->game->max_level_cells) return false;
    bytes = cells * ps_gbc_object_width(session->game);
    if (!ps_gbc_copy_level_cells(level->cells, session->board, (uint16_t)bytes)) {
        return false;
    }
    if (bytes < ps_gbc_board_bytes(session->game)) {
        memset((uint8_t*)session->board + bytes, 0, ps_gbc_board_bytes(session->game) - bytes);
    }
    session->width = level->width;
    session->height = level->height;
#if PS_GBC_HAS_PLAYER_CELL_ANCHORS
    session->player_cell_count = 0U;
    for (size_t cell = 0U; cell < cells; ++cell) {
        if ((ps_gbc_board_get(session, (uint16_t)cell)
                & session->game->player_mask) != 0U) {
            session->player_cells[session->player_cell_count++] = (uint8_t)cell;
        }
    }
#endif
#if PS_GBC_HAS_OBJECT_PRESENCE_PRECHECK
    session->present_objects = 0U;
    for (size_t cell = 0U; cell < cells; ++cell) {
        session->present_objects |= (ps_gbc_presence_mask)ps_gbc_board_get(
            session, (uint16_t)cell);
    }
#endif
    session->mode = (uint8_t)PS_FULL_STATE_MODE_LEVEL;
    session->message = NULL;
    session->checkpoint_valid = false;
    ps_gbc_clear_transient(session);
    ps_gbc_mark_all_dirty(session);
    ps_gbc_run_rules_on_level_start(session);
    return true;
}

bool ps_gbc_load_level(ps_gbc_session* session, uint16_t level_index) {
    const ps_gbc_level* level;
    if (session == NULL || level_index >= session->game->level_count) return false;
    session->current_level = level_index;
    session->completed = false;
    level = &session->game->levels[level_index];
    if (level->kind == PS_GBC_LEVEL_MESSAGE) {
        session->width = 0U;
        session->height = 0U;
        session->mode = (uint8_t)PS_FULL_STATE_MODE_MESSAGE;
        session->message = level->message;
#if PS_GBC_HAS_PLAYER_CELL_ANCHORS
        session->player_cell_count = 0U;
#endif
#if PS_GBC_HAS_OBJECT_PRESENCE_PRECHECK
        session->present_objects = 0U;
#endif
        ps_gbc_clear_transient(session);
        ps_gbc_clear_dirty_cells(session);
        return true;
    }
    return ps_gbc_load_board(session, level_index);
}

ps_gbc_session* ps_gbc_session_init(
    void* arena,
    size_t arena_size,
    const ps_gbc_game_view* game,
    const ps_gbc_snapshot_io* snapshots
) {
    ps_gbc_session* session;
    uint8_t* cursor;
    size_t board_bytes;
    size_t movement_bytes;
    size_t required;
    if (arena == NULL || snapshots == NULL || snapshots->read == NULL || snapshots->write == NULL) {
        return NULL;
    }
    required = ps_gbc_session_required_bytes(game);
    if (required == 0U || arena_size < required) return NULL;
    cursor = ps_gbc_align_pointer((uint8_t*)arena);
    session = (ps_gbc_session*)cursor;
    memset(session, 0, sizeof(*session));
    cursor += ps_gbc_align4(sizeof(*session));
    board_bytes = ps_gbc_board_bytes(game);
    movement_bytes = ps_gbc_movement_bytes(game);
    session->game = game;
    session->snapshots = *snapshots;
    session->board = cursor;
    cursor += board_bytes;
    session->again_probe = cursor;
    cursor += board_bytes;
    cursor = ps_gbc_align_pointer(cursor);
    session->movements = cursor;
    cursor += movement_bytes;
#if PS_GBC_HAS_PLAYER_CELL_ANCHORS
    session->player_cells = cursor;
    cursor += game->max_level_cells;
#endif
    session->dirty_bits = cursor;
    if (!ps_gbc_load_level(session, 0U)) return NULL;
    return session;
}

#if !defined(PS_GBC_HAS_SPECIALIZED_TURN)

static int8_t ps_gbc_delta(const ps_gbc_session* session, uint8_t direction) {
    switch (direction) {
        case 1U: return -1;
        case 2U: return 1;
        case 4U: return -(int8_t)session->height;
        case 8U: return (int8_t)session->height;
        default: return 0;
    }
}

static bool ps_gbc_pattern_matches(
    const ps_gbc_session* session,
    const ps_gbc_runtime_pattern* pattern,
    uint8_t cell
) {
    ps_gbc_runtime_object_mask objects;
    ps_gbc_runtime_movement_mask movements;
    const uint8_t flags = pattern->flags;
    if ((flags & PS_GBC_PATTERN_NEVER_MATCH) != 0U) return false;
    objects = ps_gbc_board_get(session, cell);
    if ((flags & PS_GBC_PATTERN_OBJECTS_PRESENT) != 0U
        && (objects & pattern->objects_present) != pattern->objects_present) return false;
    if ((flags & PS_GBC_PATTERN_OBJECTS_MISSING) != 0U
        && (objects & pattern->objects_missing) != 0U) return false;
    if (pattern->objects_any != 0U
        && (objects & pattern->objects_any) == 0U) return false;
    if (pattern->objects_any2 != 0U
        && (objects & pattern->objects_any2) == 0U) return false;
    if ((flags & (PS_GBC_PATTERN_MOVEMENTS_PRESENT
            | PS_GBC_PATTERN_MOVEMENTS_MISSING)) == 0U) return true;
    movements = ps_gbc_movement_get(session, cell);
    if ((flags & PS_GBC_PATTERN_MOVEMENTS_PRESENT) != 0U
        && (movements & pattern->movements_present) != pattern->movements_present) return false;
    if ((flags & PS_GBC_PATTERN_MOVEMENTS_MISSING) != 0U
        && (movements & pattern->movements_missing) != 0U) return false;
    return true;
}

static bool ps_gbc_patterns_match_at(
    const ps_gbc_session* session,
    const ps_gbc_runtime_pattern* pattern,
    uint8_t pattern_count,
    uint8_t start,
    int8_t delta
) {
    uint8_t cell = start;
    uint8_t index;
    for (index = 0U; index < pattern_count; ++index, ++pattern) {
        if (!ps_gbc_pattern_matches(session, pattern, cell)) return false;
        cell = (uint8_t)((int16_t)cell + delta);
    }
    return true;
}

static bool ps_gbc_rule_matches_at(
    const ps_gbc_session* session,
    const ps_gbc_runtime_rule* rule,
    uint8_t start,
    int8_t delta
) {
    const ps_gbc_runtime_pattern* pattern = (const ps_gbc_runtime_pattern*)(
        (const uint8_t*)session->game->patterns + rule->first_pattern.byte_offset);
    return ps_gbc_patterns_match_at(
        session, pattern, rule->pattern_count, start, delta);
}

static uint8_t ps_gbc_collect_pattern_matches(
    ps_gbc_session* session,
    const ps_gbc_runtime_pattern* patterns,
    uint8_t pattern_count,
    uint8_t direction,
    int8_t delta,
    uint8_t* out_cells,
    bool use_player_anchor
) {
    uint8_t count = 0U;
    uint8_t x;
    uint8_t y;
    uint8_t xmin = 0U;
    uint8_t xmax = (uint8_t)session->width;
    uint8_t ymin = 0U;
    uint8_t ymax = (uint8_t)session->height;
    uint8_t cell;
    uint8_t column_advance;
    if (pattern_count == 0U || delta == 0) return 0U;
    if (direction == 1U) ymin = (uint8_t)(pattern_count - 1U);
    else if (direction == 2U) ymax = (uint8_t)(ymax - (pattern_count - 1U));
    else if (direction == 4U) xmin = (uint8_t)(pattern_count - 1U);
    else if (direction == 8U) xmax = (uint8_t)(xmax - (pattern_count - 1U));
    else return 0U;
#if PS_GBC_HAS_PLAYER_CELL_ANCHORS
    if (use_player_anchor) {
        uint8_t player_index;
        for (player_index = 0U;
             player_index < session->player_cell_count;
             ++player_index) {
            const uint8_t player_cell = session->player_cells[player_index];
            const uint8_t player_x = (uint8_t)(player_cell / session->height);
            const uint8_t player_y = (uint8_t)(
                player_cell - player_x * session->height);
            if (player_x < xmin || player_x >= xmax
                || player_y < ymin || player_y >= ymax) continue;
            if (ps_gbc_patterns_match_at(
                    session, patterns, pattern_count, player_cell, delta)) {
                out_cells[count] = player_cell;
                ++count;
            }
        }
        return count;
    }
#else
    (void)use_player_anchor;
#endif
    cell = (uint8_t)(xmin * session->height + ymin);
    column_advance = (uint8_t)(session->height - (ymax - ymin));
    for (x = xmin; x < xmax; ++x) {
        for (y = ymin; y < ymax; ++y) {
            if (ps_gbc_patterns_match_at(
                    session, patterns, pattern_count, cell, delta)) {
                out_cells[count] = cell;
                ++count;
            }
            ++cell;
        }
        cell = (uint8_t)(cell + column_advance);
    }
    return count;
}

static uint8_t ps_gbc_collect_matches(
    ps_gbc_session* session,
    const ps_gbc_runtime_rule* rule,
    int8_t delta
) {
    const ps_gbc_runtime_pattern* patterns = (const ps_gbc_runtime_pattern*)(
        (const uint8_t*)session->game->patterns + rule->first_pattern.byte_offset);
    return ps_gbc_collect_pattern_matches(
        session,
        patterns,
        rule->pattern_count,
        rule->direction,
        delta,
        session->match_cells,
#if PS_GBC_HAS_PLAYER_CELL_ANCHORS
        (rule->commands & PS_GBC_RULE_PLAYER_CELL_ANCHOR) != 0U
#else
        false
#endif
    );
}

static bool ps_gbc_apply_replacement(
    ps_gbc_session* session,
    const ps_gbc_runtime_pattern* pattern,
    uint8_t cell
) {
    ps_gbc_runtime_object_mask objects;
    ps_gbc_runtime_movement_mask movements;
    ps_gbc_runtime_movement_mask original_movements;
    ps_gbc_runtime_object_mask next_objects;
    ps_gbc_runtime_movement_mask next_movements;
    if ((pattern->flags & PS_GBC_PATTERN_HAS_REPLACEMENT) == 0U) return false;
    objects = ps_gbc_board_get(session, cell);
    movements = ps_gbc_movement_get(session, cell);
    original_movements = movements;
    next_objects = (objects & ~pattern->objects_clear) | pattern->objects_set;
#if PS_GBC_HAS_CREATION_AUDIO
    if (!session->suppress_audio) {
        session->created_objects |= next_objects & ~objects;
    }
#endif
#if PS_GBC_HAS_DESTRUCTION_AUDIO
    if (!session->suppress_audio) {
        session->destroyed_objects |= objects & ~next_objects;
    }
#endif
    if ((pattern->flags & PS_GBC_REPLACEMENT_CLEAR_MOVEMENT_LAYERS) != 0U) {
        movements &= ~pattern->movement_layer_mask;
    }
    next_movements = (movements & ~pattern->movements_clear) | pattern->movements_set;
    if (pattern->objects_coupled != 0U && pattern->coupled_dir != 0U) {
        const uint32_t present = (uint32_t)objects & pattern->objects_coupled;
        if (present != 0U) {
            uint8_t object_index;
            for (object_index = 0U;
                 object_index < session->game->object_count;
                 ++object_index) {
                const uint32_t bit = 1U << object_index;
                uint8_t movement_layer;
                if ((present & bit) == 0U) continue;
                movement_layer = session->game->objects[object_index].movement_layer;
                if (movement_layer == PS_GBC_NO_MOVEMENT_LAYER
                    || movement_layer >= PS_GBC_MAX_MOVEMENT_LAYERS) {
                    continue;
                }
                next_movements &= ~((uint32_t)0x1fU << (5U * movement_layer));
                next_movements |= (uint32_t)pattern->coupled_dir
                    << (5U * movement_layer);
            }
        }
    }
#if PS_GBC_HAS_OBJECT_PRESENCE_PRECHECK
    session->present_objects |= (ps_gbc_presence_mask)next_objects;
#endif
#if PS_GBC_HAS_PLAYER_CELL_ANCHORS
    ps_gbc_track_player_cell(session, cell, next_objects);
#endif
    ps_gbc_board_set(session, cell, next_objects);
    ps_gbc_movement_set(session, cell, next_movements);
    if (next_objects != objects) ps_gbc_mark_dirty(session, cell);
    return next_objects != objects || next_movements != original_movements;
}

static bool ps_gbc_apply_pattern_replacements(
    ps_gbc_session* session,
    const ps_gbc_runtime_pattern* pattern,
    uint8_t pattern_count,
    uint8_t start,
    int8_t delta
) {
    uint8_t cell = start;
    uint8_t pattern_index;
    bool changed = false;
    for (pattern_index = 0U; pattern_index < pattern_count; ++pattern_index, ++pattern) {
        changed = ps_gbc_apply_replacement(session, pattern, cell) || changed;
        cell = (uint8_t)((int16_t)cell + delta);
    }
    return changed;
}

static bool ps_gbc_apply_rule(
    ps_gbc_session* session,
    const ps_gbc_runtime_rule* rule,
    ps_gbc_commands* commands
) {
    const ps_gbc_runtime_pattern* patterns;
    int8_t delta;
    bool changed = false;
#if PS_GBC_HAS_OBJECT_PRESENCE_PRECHECK
    if ((rule->commands & PS_GBC_RULE_OBJECT_PRESENCE_PRECHECK) != 0U) {
        const ps_gbc_runtime_pattern* first_pattern = (const ps_gbc_runtime_pattern*)(
            (const uint8_t*)session->game->patterns + rule->first_pattern.byte_offset);
        const ps_gbc_presence_mask required_objects =
            (ps_gbc_presence_mask)first_pattern->objects_present;
        if ((session->present_objects & required_objects)
            != required_objects) return false;
    }
#endif
    patterns = (const ps_gbc_runtime_pattern*)(
        (const uint8_t*)session->game->patterns + rule->first_pattern.byte_offset);
    delta = ps_gbc_delta(session, rule->direction);
    if (rule->row_count >= 2U) {
        uint8_t row1_starts[PS_GBC_MAX_BOARD_CELLS];
        const uint8_t row0_len = rule->row0_pattern_count;
        const uint8_t row1_len = (uint8_t)(rule->pattern_count - row0_len);
        const ps_gbc_runtime_pattern* row1_patterns = patterns + row0_len;
        uint8_t row0_count;
        uint8_t row1_count;
        uint8_t row0_index;
        uint8_t row1_index;
        bool first_tuple = true;
        if (row0_len == 0U || row1_len == 0U
            || (uint8_t)(row0_len + row1_len) != rule->pattern_count) {
            return false;
        }
        row0_count = ps_gbc_collect_pattern_matches(
            session,
            patterns,
            row0_len,
            rule->direction,
            delta,
            session->match_cells,
#if PS_GBC_HAS_PLAYER_CELL_ANCHORS
            (rule->commands & PS_GBC_RULE_PLAYER_CELL_ANCHOR) != 0U
#else
            false
#endif
        );
        row1_count = ps_gbc_collect_pattern_matches(
            session,
            row1_patterns,
            row1_len,
            rule->direction,
            delta,
            row1_starts,
            false);
        if (row0_count == 0U || row1_count == 0U) return false;
        commands->flags |= rule->commands;
#if PS_GBC_HAS_RULE_MESSAGES
        if ((rule->commands & PS_GBC_COMMAND_MESSAGE) != 0U) {
            commands->message = rule->message;
        }
#endif
#if PS_GBC_HAS_RULE_AUDIO
        if (rule->sound_count != 0U && session->game->rule_sound_ids != NULL) {
            uint8_t sound_index;
            for (sound_index = 0U; sound_index < rule->sound_count; ++sound_index) {
                const uint16_t reference =
                    (uint16_t)rule->first_sound + sound_index;
                if (reference >= session->game->rule_sound_count) break;
                ps_gbc_audio_append(
                    session,
                    session->game->rule_sound_ids[reference],
                    PS_GBC_AUDIO_SFX,
                    true);
            }
        }
#endif
        for (row0_index = 0U; row0_index < row0_count; ++row0_index) {
            for (row1_index = 0U; row1_index < row1_count; ++row1_index) {
                const uint8_t start0 = session->match_cells[row0_index];
                const uint8_t start1 = row1_starts[row1_index];
                bool still_matches = true;
                if (!first_tuple) {
                    if (!ps_gbc_patterns_match_at(
                            session, patterns, row0_len, start0, delta)
                        || !ps_gbc_patterns_match_at(
                            session, row1_patterns, row1_len, start1, delta)) {
                        still_matches = false;
                    }
                }
                if (still_matches) {
                    changed = ps_gbc_apply_pattern_replacements(
                        session, patterns, row0_len, start0, delta) || changed;
                    changed = ps_gbc_apply_pattern_replacements(
                        session, row1_patterns, row1_len, start1, delta) || changed;
                }
                first_tuple = false;
            }
        }
        return changed;
    }
    {
        const uint8_t match_count = ps_gbc_collect_matches(session, rule, delta);
        const uint8_t* const match_cells = session->match_cells;
        uint8_t match_index;
        if (match_count == 0U) return false;
        commands->flags |= rule->commands;
#if PS_GBC_HAS_RULE_MESSAGES
        if ((rule->commands & PS_GBC_COMMAND_MESSAGE) != 0U) {
            commands->message = rule->message;
        }
#endif
#if PS_GBC_HAS_RULE_AUDIO
        if (rule->sound_count != 0U && session->game->rule_sound_ids != NULL) {
            uint8_t sound_index;
            for (sound_index = 0U; sound_index < rule->sound_count; ++sound_index) {
                const uint16_t reference =
                    (uint16_t)rule->first_sound + sound_index;
                if (reference >= session->game->rule_sound_count) break;
                ps_gbc_audio_append(
                    session,
                    session->game->rule_sound_ids[reference],
                    PS_GBC_AUDIO_SFX,
                    true);
            }
        }
#endif
        for (match_index = 0U; match_index < match_count; ++match_index) {
            const uint8_t start = match_cells[match_index];
            if (!ps_gbc_rule_matches_at(session, rule, start, delta)) continue;
            changed = ps_gbc_apply_pattern_replacements(
                session, patterns, rule->pattern_count, start, delta) || changed;
        }
    }
    return changed;
}

static bool ps_gbc_apply_group(
    ps_gbc_session* session,
    const ps_gbc_rule_group* group,
    uint8_t input_direction,
    ps_gbc_commands* commands
) {
    const ps_gbc_runtime_rule* const rules =
        (const ps_gbc_runtime_rule*)session->game->rules;
    uint16_t first_rule = group->first_rule;
    uint16_t rule_count = group->rule_count & PS_GBC_RULE_GROUP_COUNT_MASK;
    const uint16_t input_layout =
        group->rule_count & PS_GBC_RULE_GROUP_INPUT_LAYOUT_MASK;
    const uint16_t pass_limit =
        (group->rule_count & PS_GBC_RULE_GROUP_SINGLE_PASS) != 0U
            ? 1U
            : PS_GBC_GROUP_PASSES;
    uint16_t pass;
    bool ever_changed = false;
    PS_GBC_PERF_COUNT(PS_GBC_PERF_GROUP_INVOCATIONS);
    if (input_layout != 0U) {
        uint16_t block_size;
        uint8_t block;
        if (input_layout == PS_GBC_RULE_GROUP_INPUT_QUARTET) {
            block_size = rule_count >> 2U;
            if (input_direction == 1U) block = 0U;
            else if (input_direction == 2U) block = 1U;
            else if (input_direction == 4U) block = 2U;
            else if (input_direction == 8U) block = 3U;
            else return false;
        } else {
            block_size = rule_count >> 1U;
            if (input_layout == PS_GBC_RULE_GROUP_INPUT_VERTICAL) {
                if (input_direction == 1U) block = 0U;
                else if (input_direction == 2U) block = 1U;
                else return false;
            } else {
                if (input_direction == 4U) block = 0U;
                else if (input_direction == 8U) block = 1U;
                else return false;
            }
        }
        first_rule = (uint16_t)(first_rule + (uint16_t)block * block_size);
        rule_count = block_size;
    }
    for (pass = 0U; pass < pass_limit; ++pass) {
        uint16_t rule_index;
        bool changed = false;
        PS_GBC_PERF_COUNT(PS_GBC_PERF_GROUP_PASSES);
        if (pass != 0U) PS_GBC_PERF_COUNT(PS_GBC_PERF_REPEAT_PASSES);
        for (rule_index = 0U; rule_index < rule_count; ++rule_index) {
            PS_GBC_PERF_COUNT(PS_GBC_PERF_RULE_VISITS);
            if (pass != 0U) PS_GBC_PERF_COUNT(PS_GBC_PERF_REPEAT_RULE_VISITS);
            changed = ps_gbc_apply_rule(
                session,
                &rules[first_rule + rule_index],
                commands) || changed;
        }
        if (!changed) break;
        PS_GBC_PERF_COUNT(PS_GBC_PERF_CHANGING_PASSES);
        if (pass != 0U) {
            PS_GBC_PERF_COUNT(PS_GBC_PERF_REPEAT_CHANGING_PASSES);
        }
        ever_changed = true;
    }
    return ever_changed;
}

static bool ps_gbc_apply_groups(
    ps_gbc_session* session,
    const ps_gbc_rule_group* groups,
    uint16_t group_count,
    uint8_t input_direction,
    ps_gbc_commands* commands
) {
    uint16_t group_index = 0U;
    uint16_t loop_count = 0U;
    bool propagated = false;
    bool changed = false;
    while (group_index < group_count) {
        bool group_changed = ps_gbc_apply_group(
            session, &groups[group_index], input_direction, commands);
        changed = changed || group_changed;
        propagated = propagated || group_changed;
        if (propagated && groups[group_index].loop_target >= 0) {
            group_index = (uint16_t)groups[group_index].loop_target;
            propagated = false;
            if (++loop_count > PS_GBC_RULE_LOOPS) break;
        } else {
            ++group_index;
        }
    }
    return changed;
}

static bool ps_gbc_seed_player_movement(ps_gbc_session* session, uint8_t direction) {
    uint16_t cell;
    const uint16_t cells = (uint16_t)(session->width * session->height);
    bool seeded = false;
    if (direction == 0U || session->game->player_mask == 0U) return false;
    for (cell = 0U; cell < cells; ++cell) {
        uint32_t players = ps_gbc_board_get(session, cell) & session->game->player_mask;
        uint8_t object_id = 0U;
        while (players != 0U) {
            if ((players & 1U) != 0U) {
                const uint8_t movement_layer =
                    session->game->objects[object_id].movement_layer;
                uint32_t movement;
                if (movement_layer == PS_GBC_NO_MOVEMENT_LAYER) {
                    players >>= 1U;
                    ++object_id;
                    continue;
                }
                movement = ps_gbc_movement_get(session, cell);
                movement |= (uint32_t)direction << (5U * movement_layer);
                ps_gbc_movement_set(session, cell, movement);
                seeded = true;
            }
            players >>= 1U;
            ++object_id;
        }
    }
    return seeded;
}

#endif /* !PS_GBC_HAS_SPECIALIZED_TURN */

static uint8_t ps_gbc_input_direction(ps_input input) {
    switch (input) {
        case PS_INPUT_UP: return 1U;
        case PS_INPUT_DOWN: return 2U;
        case PS_INPUT_LEFT: return 4U;
        case PS_INPUT_RIGHT: return 8U;
        case PS_INPUT_ACTION: return 16U;
        default: return 0U;
    }
}

static void ps_gbc_direction_delta(uint8_t direction, int8_t* dx, int8_t* dy) {
    *dx = 0;
    *dy = 0;
    if (direction == 1U) *dy = -1;
    else if (direction == 2U) *dy = 1;
    else if (direction == 4U) *dx = -1;
    else if (direction == 8U) *dx = 1;
}

#if PS_GBC_HAS_CREATION_AUDIO || PS_GBC_HAS_DESTRUCTION_AUDIO \
    || PS_GBC_HAS_MOVEMENT_AUDIO || PS_GBC_HAS_MOVEMENT_FAILURE_AUDIO
static void ps_gbc_audio_mask_matches(
    ps_gbc_session* session,
    const ps_gbc_sound_mask* entries,
    uint8_t count,
    uint32_t objects,
    uint32_t movements,
    uint8_t kind
) {
    uint8_t index;
    if (session->suppress_audio || entries == NULL || objects == 0U) return;
    for (index = 0U; index < count; ++index) {
        const ps_gbc_sound_mask* entry = &entries[index];
        if ((objects & entry->object_mask) == 0U) continue;
        if (entry->movement_mask != 0U
            && (movements & entry->movement_mask) == 0U) continue;
        ps_gbc_audio_append(session, entry->sound_id, kind, false);
    }
}
#endif

bool ps_gbc_resolve_movements(ps_gbc_session* session) PS_GBC_CORE_RUNTIME_NONBANKED {
    uint16_t cell;
    const uint16_t cells = (uint16_t)(session->width * session->height);
    bool moved_any = false;
    bool moved_pass = true;
    while (moved_pass) {
        moved_pass = false;
        for (cell = 0U; cell < cells; ++cell) {
            uint8_t layer;
            uint32_t movement = ps_gbc_movement_get(session, cell);
            if (movement == 0U) continue;
            for (layer = 0U; layer < session->game->movement_layer_count; ++layer) {
                const uint8_t collision_layer =
                    session->game->movement_collision_layers[layer];
                const uint8_t direction =
                    (uint8_t)((movement >> (5U * layer)) & 0x1fU);
                int8_t dx;
                int8_t dy;
                int16_t x;
                int16_t y;
                int16_t target_x;
                int16_t target_y;
                uint16_t target;
                uint32_t moving;
                if (direction == 0U) continue;
                if (direction == 16U) {
                    movement &= ~((uint32_t)0x1fU << (5U * layer));
                    ps_gbc_movement_set(session, cell, movement);
                    continue;
                }
                ps_gbc_direction_delta(direction, &dx, &dy);
                if (dx == 0 && dy == 0) continue;
                x = (int16_t)(cell / session->height);
                y = (int16_t)(cell % session->height);
                target_x = (int16_t)(x + dx);
                target_y = (int16_t)(y + dy);
                if (target_x < 0 || target_x >= (int16_t)session->width
                    || target_y < 0 || target_y >= (int16_t)session->height) continue;
                target = (uint16_t)(target_x * session->height + target_y);
                const uint32_t target_objects = ps_gbc_board_get(session, target);
                const uint32_t source_objects = ps_gbc_board_get(session, cell);
                if ((target_objects & session->game->layer_masks[collision_layer]) != 0U) {
                    continue;
                }
                moving = source_objects & session->game->layer_masks[collision_layer];
                if (moving == 0U) {
                    movement &= ~((uint32_t)0x1fU << (5U * layer));
                    ps_gbc_movement_set(session, cell, movement);
                    continue;
                }
#if PS_GBC_HAS_MOVEMENT_AUDIO
                if (session->game->movement_sound_count != 0U) {
                    ps_gbc_audio_mask_matches(
                        session,
                        session->game->movement_sounds,
                        session->game->movement_sound_count,
                        source_objects,
                        (uint32_t)direction << (5U * layer),
                        PS_GBC_AUDIO_CANMOVE);
                }
#endif
                ps_gbc_board_set(
                    session,
                    cell,
                    source_objects & ~session->game->layer_masks[collision_layer]);
#if PS_GBC_HAS_PLAYER_CELL_ANCHORS
                ps_gbc_track_player_cell(session, (uint8_t)target, target_objects | moving);
#endif
                ps_gbc_board_set(session, target, target_objects | moving);
                ps_gbc_mark_dirty(session, cell);
                ps_gbc_mark_dirty(session, target);
                movement &= ~((uint32_t)0x1fU << (5U * layer));
                ps_gbc_movement_set(session, cell, movement);
                moved_pass = true;
                moved_any = true;
            }
        }
    }
#if PS_GBC_HAS_MOVEMENT_FAILURE_AUDIO
    if (session->game->movement_failure_sound_count != 0U) {
        for (cell = 0U; cell < cells; ++cell) {
            const uint32_t movement = ps_gbc_movement_get(session, cell);
            if (movement == 0U) continue;
            ps_gbc_audio_mask_matches(
                session,
                session->game->movement_failure_sounds,
                session->game->movement_failure_sound_count,
                ps_gbc_board_get(session, cell),
                movement,
                PS_GBC_AUDIO_CANTMOVE);
        }
    }
#endif
    memset(session->movements, 0, ps_gbc_movement_bytes(session->game));
    return moved_any;
}

#if !defined(PS_GBC_HAS_SPECIALIZED_TURN) \
    || !defined(PS_GBC_GENERATED_SPECIALIZED_WON) \
    || !PS_GBC_GENERATED_SPECIALIZED_WON

static bool ps_gbc_filter_matches(uint32_t filter, bool aggregate, uint32_t cell) {
    return aggregate ? (cell & filter) == filter : (cell & filter) != 0U;
}

static bool ps_gbc_won(const ps_gbc_session* session) {
    uint16_t condition_index;
    uint16_t cells;
    if (session->game->win_condition_count == 0U) return false;
    cells = (uint16_t)(session->width * session->height);
    for (condition_index = 0U;
         condition_index < session->game->win_condition_count;
         ++condition_index) {
        const ps_gbc_win_condition* condition =
            &session->game->win_conditions[condition_index];
        uint16_t cell;
        bool passed = condition->quantifier != 0;
        if (condition->quantifier == 0) passed = false;
        for (cell = 0U; cell < cells; ++cell) {
            const bool first = ps_gbc_filter_matches(
                condition->filter1,
                condition->aggregate_filter1 != 0U,
                ps_gbc_board_get(session, cell));
            const bool second = ps_gbc_filter_matches(
                condition->filter2,
                condition->aggregate_filter2 != 0U,
                ps_gbc_board_get(session, cell));
            if (condition->quantifier == -1 && first && second) {
                passed = false;
                break;
            }
            if (condition->quantifier == 0 && first && second) {
                passed = true;
                break;
            }
            if (condition->quantifier == 1 && first && !second) {
                passed = false;
                break;
            }
        }
        if (!passed) return false;
    }
    return true;
}

#endif /* interpreter win check */

static void ps_gbc_commit_undo(ps_gbc_session* session) {
    session->undo_head = (uint16_t)((session->undo_head + 1U) % session->game->undo_capacity);
    if (session->undo_count < session->game->undo_capacity) ++session->undo_count;
}

bool ps_gbc_undo(ps_gbc_session* session) {
    uint16_t cells;
    uint16_t bytes;
    if (session == NULL || session->mode != PS_FULL_STATE_MODE_LEVEL
        || session->game->no_undo || session->undo_count == 0U) return false;
    session->undo_head = (uint16_t)(
        (session->undo_head + session->game->undo_capacity - 1U)
        % session->game->undo_capacity);
    cells = (uint16_t)(session->width * session->height);
    bytes = (uint16_t)(cells * ps_gbc_object_width(session->game));
    if (!session->snapshots.read(
            session->snapshots.context,
            (uint8_t)session->undo_head,
            session->board,
            bytes)) return false;
    --session->undo_count;
    session->pending_again = false;
    ps_gbc_mark_all_dirty(session);
    return true;
}

bool ps_gbc_restart(ps_gbc_session* session) {
    const ps_gbc_level* level;
    uint16_t cells;
    uint16_t bytes;
    if (session == NULL || session->mode != PS_FULL_STATE_MODE_LEVEL
        || session->game->no_restart) return false;
    cells = (uint16_t)(session->width * session->height);
    bytes = (uint16_t)(cells * ps_gbc_object_width(session->game));
    if (session->checkpoint_valid) {
        if (!session->snapshots.read(
                session->snapshots.context,
                session->game->undo_capacity,
                session->board,
                bytes)) return false;
    } else {
        level = &session->game->levels[session->current_level];
        if (!ps_gbc_copy_level_cells(level->cells, session->board, bytes)) {
            return false;
        }
    }
#if PS_GBC_HAS_OBJECT_PRESENCE_PRECHECK
    session->present_objects = 0U;
    for (uint16_t cell = 0U; cell < cells; ++cell) {
        session->present_objects |= (ps_gbc_presence_mask)ps_gbc_board_get(session, cell);
    }
#endif
    ps_gbc_clear_transient(session);
    ps_gbc_mark_all_dirty(session);
    ps_gbc_run_rules_on_level_start(session);
    return true;
}

static bool ps_gbc_advance(ps_gbc_session* session) {
    if ((uint16_t)(session->current_level + 1U) >= session->game->level_count) {
        session->completed = true;
        session->pending_again = false;
        return false;
    }
    return ps_gbc_load_level(session, (uint16_t)(session->current_level + 1U));
}

bool ps_gbc_advance_level(ps_gbc_session* session) {
    if (session == NULL || session->completed) return false;
    return ps_gbc_advance(session);
}

#if !defined(PS_GBC_HAS_SPECIALIZED_TURN)

bool ps_gbc_apply_early_rule_groups(
    ps_gbc_session* session,
    uint8_t direction,
    ps_gbc_commands* commands
) {
    PS_GBC_PERF_BEGIN(PS_GBC_PERF_EARLY_RULES);
    const bool changed = ps_gbc_apply_groups(
        session,
        session->game->early_groups,
        session->game->early_group_count,
        direction,
        commands);
    PS_GBC_PERF_END(PS_GBC_PERF_EARLY_RULES);
    return changed;
}

bool ps_gbc_apply_late_rule_groups(
    ps_gbc_session* session,
    uint8_t direction,
    ps_gbc_commands* commands
) {
    PS_GBC_PERF_BEGIN(PS_GBC_PERF_LATE_RULES);
    const bool changed = ps_gbc_apply_groups(
        session,
        session->game->late_groups,
        session->game->late_group_count,
        direction,
        commands);
    PS_GBC_PERF_END(PS_GBC_PERF_LATE_RULES);
    return changed;
}

bool ps_gbc_apply_rules_and_movement(
    ps_gbc_session* session,
    uint8_t direction,
    ps_gbc_commands* commands
) {
    bool early_changed;
    bool moved;
    bool late_changed;
    early_changed = ps_gbc_apply_early_rule_groups(session, direction, commands);
    PS_GBC_PERF_BEGIN(PS_GBC_PERF_MOVEMENT);
    moved = ps_gbc_resolve_movements(session);
    PS_GBC_PERF_END(PS_GBC_PERF_MOVEMENT);
    late_changed = ps_gbc_apply_late_rule_groups(session, direction, commands);
    return early_changed || moved || late_changed;
}

bool ps_gbc_apply_turn_phases(
    ps_gbc_session* session,
    uint8_t direction,
    ps_gbc_commands* commands
) {
    bool seeded;
    bool rest;
    PS_GBC_PERF_BEGIN(PS_GBC_PERF_SETUP);
    memset(session->movements, 0, ps_gbc_movement_bytes(session->game));
    session->pending_again = false;
    seeded = ps_gbc_seed_player_movement(session, direction);
    PS_GBC_PERF_END(PS_GBC_PERF_SETUP);
    rest = ps_gbc_apply_rules_and_movement(session, direction, commands);
    return seeded || rest;
}

#endif /* !PS_GBC_HAS_SPECIALIZED_TURN */

#if !defined(PS_GBC_HAS_SPECIALIZED_TURN)
bool ps_gbc_specialized_apply_turn_phases(
    ps_gbc_session* session,
    uint8_t direction,
    ps_gbc_commands* commands,
    bool* out_changed
) PS_GBC_SPECIALIZED_TURN_BANKED {
    (void)session;
    (void)direction;
    (void)commands;
    if (out_changed != NULL) *out_changed = false;
    return false;
}
#endif

static void ps_gbc_finish_turn(
    ps_gbc_session* session,
    const ps_gbc_commands* commands,
    bool changed,
    uint16_t board_bytes,
    bool level_start,
    ps_step_result* result
) {
    PS_GBC_PERF_BEGIN(PS_GBC_PERF_COMMANDS);
    if ((commands->flags & PS_GBC_COMMAND_CANCEL) != 0U) {
        (void)session->snapshots.read(
            session->snapshots.context,
            (uint8_t)session->undo_head,
            session->board,
            board_bytes);
#if PS_GBC_HAS_AUDIO
        session->audio_count = 0U;
        session->ui_audio_count = 0U;
        session->created_objects = 0U;
        session->destroyed_objects = 0U;
        if (!level_start) {
            ps_gbc_audio_append_named(session, PS_GBC_SOUND_CANCEL);
            ps_gbc_audio_result(session, result);
        }
#endif
        PS_GBC_PERF_END(PS_GBC_PERF_COMMANDS);
        return;
    }
#if PS_GBC_HAS_CREATION_AUDIO
    if (session->game->creation_sound_count != 0U) {
        ps_gbc_audio_mask_matches(
            session,
            session->game->creation_sounds,
            session->game->creation_sound_count,
            session->created_objects,
            0U,
            PS_GBC_AUDIO_CREATE);
    }
#endif
#if PS_GBC_HAS_DESTRUCTION_AUDIO
    if (session->game->destruction_sound_count != 0U) {
        ps_gbc_audio_mask_matches(
            session,
            session->game->destruction_sounds,
            session->game->destruction_sound_count,
            session->destroyed_objects,
            0U,
            PS_GBC_AUDIO_DESTROY);
    }
#endif
    if (!level_start
        && (commands->flags & PS_GBC_COMMAND_RESTART) != 0U
        && !session->game->no_restart) {
        if (!ps_gbc_restart(session)) {
            PS_GBC_PERF_END(PS_GBC_PERF_COMMANDS);
            return;
        }
        changed = true;
        result->restarted = true;
#if PS_GBC_HAS_AUDIO
        ps_gbc_audio_append_named(session, PS_GBC_SOUND_RESTART);
#endif
    }
    /* Decide again before commit_undo while undo_head still holds turn start. */
    {
        /* Level-start passes ignore win/restart/undo but still honor again:
         * ps_gbc_run_rules_on_level_start writes the turn-start snapshot at
         * undo_head precisely so the net-change compare below is valid here. */
        const bool want_again =
            (commands->flags & PS_GBC_COMMAND_MESSAGE) == 0U
            && (commands->flags & PS_GBC_COMMAND_AGAIN) != 0U
            && changed
            && !result->restarted
            && ps_gbc_board_differs_from_turn_start(session, board_bytes);
        if (changed && !result->restarted && !level_start) {
            ps_gbc_commit_undo(session);
        }
        if ((commands->flags & PS_GBC_COMMAND_CHECKPOINT) != 0U) {
            session->checkpoint_valid = session->snapshots.write(
                session->snapshots.context,
                session->game->undo_capacity,
                session->board,
                board_bytes);
        }
        PS_GBC_PERF_END(PS_GBC_PERF_COMMANDS);
        PS_GBC_PERF_BEGIN(PS_GBC_PERF_WIN);
        result->changed = changed;
        if ((commands->flags & PS_GBC_COMMAND_MESSAGE) != 0U) {
            session->mode = (uint8_t)PS_FULL_STATE_MODE_MESSAGE;
            session->message = commands->message;
            session->pending_again = false;
#if PS_GBC_HAS_AUDIO
            ps_gbc_audio_append_named(session, PS_GBC_SOUND_SHOWMESSAGE);
#endif
        }
        if (!level_start
            && ((commands->flags & PS_GBC_COMMAND_WIN) != 0U
#if defined(PS_GBC_GENERATED_SPECIALIZED_WON) && PS_GBC_GENERATED_SPECIALIZED_WON \
    && defined(PS_GBC_HAS_SPECIALIZED_TURN) && PS_GBC_HAS_SPECIALIZED_TURN
                || ps_gbc_specialized_won(session)
#else
                || ps_gbc_won(session)
#endif
                )) {
            result->won = true;
            if (!session->defer_win) {
                result->transitioned = ps_gbc_advance(session);
            }
        } else if (want_again) {
            /* Match JS/native again probe: only continue when the board's net
             * state differs from turn start. Cyclical late rules (e.g. clear
             * then redraw shadows) plus []->again must not infinite-loop.
             * Compare runs only when again is requested. */
            session->pending_again = true;
        }
    }
    PS_GBC_PERF_END(PS_GBC_PERF_WIN);
#if PS_GBC_HAS_AUDIO
    if (!level_start) ps_gbc_audio_result(session, result);
#endif
}

ps_step_result ps_gbc_step(ps_gbc_session* session, ps_input input) {
    ps_step_result result;
    ps_gbc_commands commands;
    uint8_t direction;
    bool changed;
    uint16_t cells;
    uint16_t board_bytes;
    memset(&result, 0, sizeof(result));
    memset(&commands, 0, sizeof(commands));
    if (session == NULL || session->completed) return result;
#if PS_GBC_HAS_AUDIO
    session->audio_count = 0U;
    session->ui_audio_count = 0U;
    session->created_objects = 0U;
    session->destroyed_objects = 0U;
#endif
    if (session->mode == PS_FULL_STATE_MODE_MESSAGE) {
        if (input != PS_INPUT_TICK) {
            result.transitioned = ps_gbc_advance(session);
            result.changed = result.transitioned;
#if PS_GBC_HAS_AUDIO
            ps_gbc_audio_append_named(session, PS_GBC_SOUND_CLOSEMESSAGE);
            ps_gbc_audio_result(session, &result);
#endif
        }
        return result;
    }
    direction = ps_gbc_input_direction(input);
    if (input == PS_INPUT_ACTION && session->game->no_action) direction = 0U;
    if (input == PS_INPUT_TICK && !session->pending_again) direction = 0U;
    cells = (uint16_t)(session->width * session->height);
    board_bytes = (uint16_t)(cells * ps_gbc_object_width(session->game));
    PS_GBC_PERF_BEGIN(PS_GBC_PERF_SNAPSHOT);
    if (!session->snapshots.write(
            session->snapshots.context,
            (uint8_t)session->undo_head,
            session->board,
            board_bytes)) {
        PS_GBC_PERF_END(PS_GBC_PERF_SNAPSHOT);
        return result;
    }
    PS_GBC_PERF_END(PS_GBC_PERF_SNAPSHOT);
    changed = false;
#if defined(PS_GBC_HAS_SPECIALIZED_TURN)
    (void)ps_gbc_specialized_apply_turn_phases(
        session, direction, &commands, &changed);
#else
    if (!ps_gbc_specialized_apply_turn_phases(
            session, direction, &commands, &changed)) {
        changed = ps_gbc_apply_turn_phases(session, direction, &commands);
    }
#endif
    ps_gbc_finish_turn(
        session, &commands, changed, board_bytes, false, &result);
    return result;
}

void ps_gbc_defer_wins(ps_gbc_session* session, bool defer) {
    if (session != NULL) session->defer_win = defer;
}

static void ps_gbc_run_rules_on_level_start(ps_gbc_session* session) {
    ps_gbc_commands commands;
    uint16_t cells;
    uint16_t board_bytes;
    bool changed;
    ps_step_result ignored;
    if (session == NULL
        || session->mode != (uint8_t)PS_FULL_STATE_MODE_LEVEL
        || !session->game->run_rules_on_level_start) {
        return;
    }
    memset(&commands, 0, sizeof(commands));
    memset(&ignored, 0, sizeof(ignored));
    cells = (uint16_t)(session->width * session->height);
    board_bytes = (uint16_t)(cells * ps_gbc_object_width(session->game));
    if (!session->snapshots.write(
            session->snapshots.context,
            (uint8_t)session->undo_head,
            session->board,
            board_bytes)) {
        return;
    }
#if PS_GBC_HAS_AUDIO
    session->suppress_audio = true;
#endif
    changed = false;
#if defined(PS_GBC_HAS_SPECIALIZED_TURN)
    (void)ps_gbc_specialized_apply_turn_phases(
        session, 0U, &commands, &changed);
#else
    if (!ps_gbc_specialized_apply_turn_phases(
            session, 0U, &commands, &changed)) {
        changed = ps_gbc_apply_turn_phases(session, 0U, &commands);
    }
#endif
    ps_gbc_finish_turn(
        session, &commands, changed, board_bytes, true, &ignored);
#if PS_GBC_HAS_AUDIO
    session->suppress_audio = false;
#endif
}

void ps_gbc_status_get(const ps_gbc_session* session, ps_gbc_status* status) {
    if (status == NULL) return;
    memset(status, 0, sizeof(*status));
    if (session == NULL) return;
    status->mode = (ps_full_state_mode)session->mode;
    status->current_level = session->current_level;
    status->width = session->width;
    status->height = session->height;
    status->can_undo = session->undo_count != 0U && !session->game->no_undo;
    status->pending_again = session->pending_again;
    status->completed = session->completed;
    status->message = session->message;
}

uint32_t ps_gbc_cell_objects(const ps_gbc_session* session, int16_t x, int16_t y) {
    if (session == NULL || session->mode != PS_FULL_STATE_MODE_LEVEL
        || x < 0 || y < 0 || x >= (int16_t)session->width || y >= (int16_t)session->height) {
        return 0U;
    }
    return ps_gbc_board_get(
        session,
        (uint16_t)x * session->height + (uint16_t)y);
}

const uint8_t* ps_gbc_dirty_cells(const ps_gbc_session* session) {
    return session == NULL ? NULL : session->dirty_bits;
}

bool ps_gbc_has_dirty_cells(const ps_gbc_session* session) {
    const uint8_t* dirty;
    uint8_t remaining;
    if (session == NULL) return false;
    dirty = session->dirty_bits;
    remaining = (uint8_t)ps_gbc_cell_bitset_bytes(session->game);
    while (remaining-- != 0U) {
        if (*dirty++ != 0U) return true;
    }
    return false;
}

void ps_gbc_clear_dirty_cells(ps_gbc_session* session) {
    if (session == NULL) return;
    memset(session->dirty_bits, 0, ps_gbc_cell_bitset_bytes(session->game));
}

bool ps_gbc_first_player_position(const ps_gbc_session* session, int16_t* x, int16_t* y) {
    uint16_t cell;
    uint16_t cells;
    if (session == NULL || x == NULL || y == NULL
        || session->mode != PS_FULL_STATE_MODE_LEVEL) return false;
    cells = (uint16_t)(session->width * session->height);
    for (cell = 0U; cell < cells; ++cell) {
        if ((ps_gbc_board_get(session, cell) & session->game->player_mask) != 0U) {
            *x = (int16_t)(cell / session->height);
            *y = (int16_t)(cell % session->height);
            return true;
        }
    }
    return false;
}

const void* ps_gbc_board(const ps_gbc_session* session) {
    return session == NULL ? NULL : session->board;
}

const ps_gbc_game_view* ps_gbc_game(const ps_gbc_session* session) {
    return session == NULL ? NULL : session->game;
}
