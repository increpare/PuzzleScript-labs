#pragma once

#include "puzzlescript/gbc.h"

typedef ps_gbc_session* (*ps_gbc_session_init_fn)(
    void*,
    size_t,
    const ps_gbc_game_view*,
    const ps_gbc_snapshot_io*);
typedef bool (*ps_gbc_load_level_fn)(ps_gbc_session*, uint16_t);
typedef void (*ps_gbc_step_fn)(
    ps_gbc_session*, ps_input, ps_step_result*);
typedef void (*ps_gbc_defer_wins_fn)(ps_gbc_session*, bool);
typedef bool (*ps_gbc_advance_level_fn)(ps_gbc_session*);
typedef bool (*ps_gbc_undo_fn)(ps_gbc_session*);
typedef bool (*ps_gbc_restart_fn)(ps_gbc_session*);
typedef void (*ps_gbc_status_get_fn)(
    const ps_gbc_session*, ps_gbc_status*);
typedef uint32_t (*ps_gbc_cell_objects_fn)(
    const ps_gbc_session*, int16_t, int16_t);
typedef const uint8_t* (*ps_gbc_dirty_cells_fn)(const ps_gbc_session*);
typedef bool (*ps_gbc_has_dirty_cells_fn)(const ps_gbc_session*);
typedef void (*ps_gbc_clear_dirty_cells_fn)(ps_gbc_session*);
typedef bool (*ps_gbc_first_player_position_fn)(
    const ps_gbc_session*, int16_t*, int16_t*);
typedef const void* (*ps_gbc_board_fn)(const ps_gbc_session*);

typedef struct ps_gbc_game_descriptor {
    uint8_t game_bank;
    uint16_t session_bytes;
    const ps_gbc_game_view* game;
    const ps_gbc_render_object* render_objects;
    uint8_t render_object_count;
    const uint32_t* precomposed_masks;
    const uint8_t* precomposed_palettes;
    const uint8_t* precomposed_tiles;
    uint8_t precomposed_count;
    ps_gbc_session_init_fn session_init;
    ps_gbc_load_level_fn load_level;
    ps_gbc_step_fn step;
    ps_gbc_defer_wins_fn defer_wins;
    ps_gbc_advance_level_fn advance_level;
    ps_gbc_undo_fn undo;
    ps_gbc_restart_fn restart;
    ps_gbc_status_get_fn status_get;
    ps_gbc_cell_objects_fn cell_objects;
    ps_gbc_dirty_cells_fn dirty_cells;
    ps_gbc_has_dirty_cells_fn has_dirty_cells;
    ps_gbc_clear_dirty_cells_fn clear_dirty_cells;
    ps_gbc_first_player_position_fn first_player_position;
    ps_gbc_board_fn board;
} ps_gbc_game_descriptor;
