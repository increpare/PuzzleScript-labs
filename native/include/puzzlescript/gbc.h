#ifndef PUZZLESCRIPT_GBC_H
#define PUZZLESCRIPT_GBC_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#if !defined(PS_GBC_FREESTANDING)
#include "puzzlescript/puzzlescript.h"
#else
typedef struct ps_audio_event {
    int32_t seed;
} ps_audio_event;

typedef enum ps_input {
    PS_INPUT_UP = 0,
    PS_INPUT_LEFT = 1,
    PS_INPUT_DOWN = 2,
    PS_INPUT_RIGHT = 3,
    PS_INPUT_ACTION = 4,
    PS_INPUT_TICK = 5
} ps_input;

typedef enum ps_full_state_mode {
    PS_FULL_STATE_MODE_LEVEL = 0,
    PS_FULL_STATE_MODE_TITLE = 1,
    PS_FULL_STATE_MODE_MESSAGE = 2
} ps_full_state_mode;

typedef struct ps_step_result {
    bool changed;
    bool won;
    bool transitioned;
    bool restarted;
    size_t audio_event_count;
    const ps_audio_event* audio_events;
    size_t ui_audio_event_count;
    const ps_audio_event* ui_audio_events;
} ps_step_result;
#endif

#ifdef __cplusplus
extern "C" {
#endif

#define PS_GBC_SCREEN_WIDTH 160
#define PS_GBC_SCREEN_HEIGHT 144
#define PS_GBC_SCREEN_TILE_WIDTH 20
#define PS_GBC_SCREEN_TILE_HEIGHT 18
#define PS_GBC_VIEWPORT_WIDTH 10
#define PS_GBC_VIEWPORT_HEIGHT 9
#define PS_GBC_RENDERED_CELL_WIDTH 16
#define PS_GBC_RENDERED_CELL_HEIGHT 16
#define PS_GBC_MAX_OBJECTS 32
#define PS_GBC_MAX_COLLISION_LAYERS 32
#define PS_GBC_MAX_MOVEMENT_LAYERS 6
#define PS_GBC_NO_MOVEMENT_LAYER 0xffU
#define PS_GBC_NO_SOUND 0xffU
#define PS_GBC_MAX_AUDIO_EVENTS 8
#define PS_GBC_MAX_UNDO 4
#define PS_GBC_MAX_BOARD_CELLS 90
#define PS_GBC_GAME_ABI_VERSION 16
#define PS_GBC_RULE_GROUP_COUNT_MASK 0x1fffU
#define PS_GBC_RULE_GROUP_INPUT_LAYOUT_MASK 0x6000U
#define PS_GBC_RULE_GROUP_INPUT_QUARTET 0x2000U
#define PS_GBC_RULE_GROUP_INPUT_VERTICAL 0x4000U
#define PS_GBC_RULE_GROUP_INPUT_HORIZONTAL 0x6000U
#define PS_GBC_RULE_GROUP_SINGLE_PASS 0x8000U
/* Exporters reserve this much for the private session struct and alignment. */
#define PS_GBC_SESSION_OVERHEAD_BUDGET 256

typedef enum ps_gbc_level_kind {
    PS_GBC_LEVEL_BOARD = 0,
    PS_GBC_LEVEL_MESSAGE = 1
} ps_gbc_level_kind;

typedef enum ps_gbc_perf_phase {
    PS_GBC_PERF_SNAPSHOT = 0,
    PS_GBC_PERF_SETUP = 1,
    PS_GBC_PERF_EARLY_RULES = 2,
    PS_GBC_PERF_MOVEMENT = 3,
    PS_GBC_PERF_LATE_RULES = 4,
    PS_GBC_PERF_COMMANDS = 5,
    PS_GBC_PERF_WIN = 6,
    PS_GBC_PERF_PHASE_COUNT = 7
} ps_gbc_perf_phase;

typedef enum ps_gbc_perf_schedule_counter {
    PS_GBC_PERF_GROUP_INVOCATIONS = 0,
    PS_GBC_PERF_GROUP_PASSES = 1,
    PS_GBC_PERF_REPEAT_PASSES = 2,
    PS_GBC_PERF_RULE_VISITS = 3,
    PS_GBC_PERF_REPEAT_RULE_VISITS = 4,
    PS_GBC_PERF_CHANGING_PASSES = 5,
    PS_GBC_PERF_REPEAT_CHANGING_PASSES = 6,
    PS_GBC_PERF_SCHEDULE_COUNT = 7
} ps_gbc_perf_schedule_counter;

typedef enum ps_gbc_named_sound {
    PS_GBC_SOUND_CANCEL = 0,
    PS_GBC_SOUND_CLOSEMESSAGE = 1,
    PS_GBC_SOUND_ENDGAME = 2,
    PS_GBC_SOUND_ENDLEVEL = 3,
    PS_GBC_SOUND_RESTART = 4,
    PS_GBC_SOUND_SHOWMESSAGE = 5,
    PS_GBC_SOUND_STARTGAME = 6,
    PS_GBC_SOUND_STARTLEVEL = 7,
    PS_GBC_SOUND_TITLESCREEN = 8,
    PS_GBC_SOUND_UNDO = 9,
    PS_GBC_NAMED_SOUND_COUNT = 10
} ps_gbc_named_sound;

enum {
    PS_GBC_PATTERN_OBJECTS_PRESENT = 1U << 0,
    PS_GBC_PATTERN_OBJECTS_MISSING = 1U << 1,
    PS_GBC_PATTERN_MOVEMENTS_PRESENT = 1U << 2,
    PS_GBC_PATTERN_MOVEMENTS_MISSING = 1U << 3,
    PS_GBC_PATTERN_HAS_REPLACEMENT = 1U << 4,
    PS_GBC_REPLACEMENT_CLEAR_MOVEMENT_LAYERS = 1U << 5,
    PS_GBC_PATTERN_NEVER_MATCH = 1U << 6
};

enum {
    PS_GBC_COMMAND_AGAIN = 1U << 0,
    PS_GBC_COMMAND_CANCEL = 1U << 1,
    PS_GBC_COMMAND_CHECKPOINT = 1U << 2,
    PS_GBC_COMMAND_RESTART = 1U << 3,
    PS_GBC_COMMAND_WIN = 1U << 4,
    PS_GBC_COMMAND_MESSAGE = 1U << 5
};

#define PS_GBC_RULE_OBJECT_PRESENCE_PRECHECK (1U << 7)
#define PS_GBC_RULE_PLAYER_CELL_ANCHOR (1U << 6)

typedef struct ps_gbc_pattern {
    uint32_t objects_present;
    uint32_t objects_missing;
    uint32_t movements_present;
    uint32_t movements_missing;
    uint32_t objects_clear;
    uint32_t objects_set;
    uint32_t movements_clear;
    uint32_t movements_set;
    uint32_t movement_layer_mask;
    uint8_t flags;
} ps_gbc_pattern;

typedef struct ps_gbc_pattern_reference {
    uint16_t byte_offset;
} ps_gbc_pattern_reference;

#define PS_GBC_PATTERN_REFERENCE(index) \
    {(uint16_t)((uint16_t)(index) * (uint16_t)sizeof(ps_gbc_pattern))}

typedef struct ps_gbc_rule {
    ps_gbc_pattern_reference first_pattern;
    uint8_t pattern_count;
    uint8_t direction;
    uint8_t commands;
    uint8_t first_sound;
    uint8_t sound_count;
    const char* message;
} ps_gbc_rule;

typedef struct ps_gbc_rule_group {
    uint16_t first_rule;
    uint16_t rule_count;
    int16_t loop_target;
} ps_gbc_rule_group;

typedef struct ps_gbc_win_condition {
    int8_t quantifier;
    uint8_t aggregate_filter1;
    uint8_t aggregate_filter2;
    uint32_t filter1;
    uint32_t filter2;
} ps_gbc_win_condition;

typedef struct ps_gbc_object {
    const char* name;
    uint8_t layer;
    uint8_t movement_layer;
    uint8_t sprite_width;
    uint8_t sprite_height;
    uint8_t palette;
    const uint8_t* sprite_pixels;
    uint64_t transparent_pixels;
} ps_gbc_object;

typedef struct ps_gbc_level {
    ps_gbc_level_kind kind;
    uint16_t width;
    uint16_t height;
    const void* cells;
    const char* message;
} ps_gbc_level;

typedef struct ps_gbc_sound_mask {
    uint32_t object_mask;
    uint32_t movement_mask;
    uint8_t sound_id;
} ps_gbc_sound_mask;

typedef struct ps_gbc_game_view {
    uint16_t abi_version;
    uint32_t source_hash;
    const char* title;
    const char* author;
    uint8_t object_count;
    uint8_t layer_count;
    uint8_t movement_layer_count;
    uint8_t movement_bytes_per_cell;
    uint8_t object_bytes_per_cell;
    uint8_t undo_capacity;
    uint8_t viewport_width;
    uint8_t viewport_height;
    uint8_t cell_width;
    uint8_t cell_height;
    uint16_t level_count;
    uint16_t max_level_cells;
    uint16_t pattern_count;
    uint16_t rule_count;
    uint16_t early_group_count;
    uint16_t late_group_count;
    uint16_t win_condition_count;
    uint8_t sound_count;
    uint8_t rule_sound_count;
    uint8_t creation_sound_count;
    uint8_t destruction_sound_count;
    uint8_t movement_sound_count;
    uint8_t movement_failure_sound_count;
    uint32_t player_mask;
    uint32_t background_mask;
    const uint32_t* layer_masks;
    const uint8_t* movement_collision_layers;
    const ps_gbc_object* objects;
    const ps_gbc_level* levels;
    const ps_gbc_pattern* patterns;
    const ps_gbc_rule* rules;
    const ps_gbc_rule_group* early_groups;
    const ps_gbc_rule_group* late_groups;
    const ps_gbc_win_condition* win_conditions;
    const int32_t* sound_seeds;
    const uint8_t* named_sound_ids;
    const uint8_t* rule_sound_ids;
    const ps_gbc_sound_mask* creation_sounds;
    const ps_gbc_sound_mask* destruction_sounds;
    const ps_gbc_sound_mask* movement_sounds;
    const ps_gbc_sound_mask* movement_failure_sounds;
    const uint16_t* background_palettes;
    const uint8_t* palette_remap;
    const uint16_t* ui_palette;
    bool run_rules_on_level_start;
    bool no_action;
    bool no_undo;
    bool no_restart;
} ps_gbc_game_view;

typedef struct ps_gbc_session ps_gbc_session;

typedef bool (*ps_gbc_snapshot_read)(
    void* context,
    uint8_t slot,
    void* data,
    uint16_t byte_count
);

typedef bool (*ps_gbc_snapshot_write)(
    void* context,
    uint8_t slot,
    const void* data,
    uint16_t byte_count
);

typedef struct ps_gbc_snapshot_io {
    void* context;
    ps_gbc_snapshot_read read;
    ps_gbc_snapshot_write write;
} ps_gbc_snapshot_io;

typedef struct ps_gbc_status {
    ps_full_state_mode mode;
    uint16_t current_level;
    uint16_t width;
    uint16_t height;
    bool can_undo;
    bool pending_again;
    bool completed;
    const char* message;
} ps_gbc_status;

size_t ps_gbc_session_required_bytes(const ps_gbc_game_view* game);
ps_gbc_session* ps_gbc_session_init(
    void* arena,
    size_t arena_size,
    const ps_gbc_game_view* game,
    const ps_gbc_snapshot_io* snapshots
);
bool ps_gbc_load_level(ps_gbc_session* session, uint16_t level_index);
ps_step_result ps_gbc_step(ps_gbc_session* session, ps_input input);
bool ps_gbc_undo(ps_gbc_session* session);
bool ps_gbc_restart(ps_gbc_session* session);
void ps_gbc_status_get(const ps_gbc_session* session, ps_gbc_status* status);
uint32_t ps_gbc_cell_objects(const ps_gbc_session* session, int16_t x, int16_t y);
const uint8_t* ps_gbc_dirty_cells(const ps_gbc_session* session);
void ps_gbc_clear_dirty_cells(ps_gbc_session* session);
bool ps_gbc_first_player_position(const ps_gbc_session* session, int16_t* x, int16_t* y);
const void* ps_gbc_board(const ps_gbc_session* session);
const ps_gbc_game_view* ps_gbc_game(const ps_gbc_session* session);

#ifdef __cplusplus
}
#endif

#endif
