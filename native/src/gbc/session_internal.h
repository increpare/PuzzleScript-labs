#pragma once

#include "puzzlescript/gbc.h"

#if defined(PS_GBC_GENERATED_BUILD)
#include "generated_game.h"
#if !defined(PS_GBC_GENERATED_ABI_VERSION) \
    || PS_GBC_GENERATED_ABI_VERSION != PS_GBC_GAME_ABI_VERSION
#error "generated GBC data ABI does not match the runtime"
#endif
#endif

#if !defined(PS_GBC_GENERATED_OBJECT_PRESENCE_PRECHECK_COUNT) \
    || PS_GBC_GENERATED_OBJECT_PRESENCE_PRECHECK_COUNT != 0U
#define PS_GBC_HAS_OBJECT_PRESENCE_PRECHECK 1
#else
#define PS_GBC_HAS_OBJECT_PRESENCE_PRECHECK 0
#endif

#if !defined(PS_GBC_GENERATED_PLAYER_CELL_ANCHOR_COUNT) \
    || PS_GBC_GENERATED_PLAYER_CELL_ANCHOR_COUNT != 0U
#define PS_GBC_HAS_PLAYER_CELL_ANCHORS 1
#else
#define PS_GBC_HAS_PLAYER_CELL_ANCHORS 0
#endif

#if defined(PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL) \
    && PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL == 1U
typedef uint8_t ps_gbc_presence_mask;
#elif defined(PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL) \
    && PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL == 2U
typedef uint16_t ps_gbc_presence_mask;
#else
typedef uint32_t ps_gbc_presence_mask;
#endif

struct ps_gbc_session {
    const ps_gbc_game_view* game;
    uint8_t* board;
    uint8_t* movements;
    uint8_t* dirty_bits;
#if PS_GBC_HAS_PLAYER_CELL_ANCHORS
    uint8_t* player_cells;
    uint8_t player_cell_count;
#endif
    uint8_t match_cells[PS_GBC_MAX_BOARD_CELLS];
    ps_gbc_snapshot_io snapshots;
    uint16_t width;
    uint16_t height;
    uint16_t current_level;
    uint16_t undo_head;
    uint16_t undo_count;
    uint8_t mode;
    bool checkpoint_valid;
    bool pending_again;
    bool completed;
    bool defer_win;
    bool suppress_audio;
    uint8_t audio_count;
    uint8_t ui_audio_count;
#if !defined(PS_GBC_FREESTANDING)
    uint8_t audio_kinds[PS_GBC_MAX_AUDIO_EVENTS];
#endif
    ps_audio_event audio_events[PS_GBC_MAX_AUDIO_EVENTS];
    ps_audio_event ui_audio_events[PS_GBC_MAX_AUDIO_EVENTS];
    uint32_t created_objects;
    uint32_t destroyed_objects;
#if PS_GBC_HAS_OBJECT_PRESENCE_PRECHECK
    ps_gbc_presence_mask present_objects;
#endif
    const char* message;
};

#if defined(PS_GBC_FREESTANDING)
_Static_assert(
    sizeof(struct ps_gbc_session) <= PS_GBC_SESSION_OVERHEAD_BUDGET,
    "PS_GBC_SESSION_OVERHEAD_BUDGET is too small"
);
#endif
