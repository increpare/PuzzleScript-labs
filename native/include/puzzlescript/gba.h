#ifndef PUZZLESCRIPT_GBA_H
#define PUZZLESCRIPT_GBA_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "puzzlescript/puzzlescript.h"

#ifdef __cplusplus
extern "C" {
#endif

#define PS_GBA_SCREEN_WIDTH 240
#define PS_GBA_SCREEN_HEIGHT 160
#define PS_GBA_UNDO_CAPACITY 32
#define PS_GBA_GAME_ABI_VERSION 5
#define PS_GBA_MAX_SPRITE_PIXELS 32

typedef enum ps_gba_level_kind {
    PS_GBA_LEVEL_BOARD = 0,
    PS_GBA_LEVEL_MESSAGE = 1,
} ps_gba_level_kind;

typedef enum ps_gba_runtime_profile {
    PS_GBA_RUNTIME_UNSUPPORTED = 0,
    PS_GBA_RUNTIME_GENERATED_COMPACT = 1,
} ps_gba_runtime_profile;

typedef struct ps_gba_rng_state {
    uint8_t s[256];
    uint8_t i;
    uint8_t j;
    bool valid;
} ps_gba_rng_state;

typedef struct ps_gba_kernel_result {
    bool handled;
    bool changed;
    bool won;
    bool restarted;
    bool transitioned;
    bool pending_again;
    bool checkpoint;
    bool discard;
    const char* message;
    uint8_t sound_count;
    const char* sound_names[4];
} ps_gba_kernel_result;

typedef ps_gba_kernel_result (*ps_gba_turn_kernel)(
    uint32_t* board_words,
    uint32_t board_word_count,
    uint16_t width,
    uint16_t height,
    uint16_t level_index,
    ps_input input,
    ps_gba_rng_state* rng,
    bool reset_scratch,
    bool level_start
);

typedef struct ps_gba_object {
    const char* name;
    int16_t layer;
    uint8_t sprite_width;
    uint8_t sprite_height;
    const uint8_t* sprite_pixels;
    /* Bit N is set when sprite_pixels[N] is transparent. */
    uint32_t transparent_pixels;
} ps_gba_object;

typedef struct ps_gba_level {
    ps_gba_level_kind kind;
    uint16_t width;
    uint16_t height;
    const uint32_t* object_words;
    const char* message;
} ps_gba_level;

typedef struct ps_gba_metadata {
    const char* key;
    const char* value;
} ps_gba_metadata;

typedef struct ps_gba_sound {
    const char* name;
    int32_t seed;
    uint16_t sample_id;
} ps_gba_sound;

typedef struct ps_gba_game_view {
    uint32_t abi_version;
    uint64_t source_hash;
    const char* title;
    const char* author;
    uint16_t foreground_color;
    uint16_t background_color;
    uint16_t palette_count;
    const uint16_t* palette;
    uint16_t object_count;
    uint16_t object_word_count;
    const ps_gba_object* objects;
    uint16_t level_count;
    uint16_t max_level_cells;
    uint8_t undo_capacity;
    const ps_gba_level* levels;
    uint16_t metadata_count;
    const ps_gba_metadata* metadata;
    uint16_t sound_count;
    const ps_gba_sound* sounds;
    ps_gba_runtime_profile runtime_profile;
    const uint32_t* player_mask;
    ps_gba_turn_kernel turn_kernel;
    bool no_action;
    bool no_undo;
    bool no_restart;
    uint16_t title_image_width;
    uint16_t title_image_height;
    const uint8_t* title_image_pixels;
} ps_gba_game_view;

typedef struct ps_gba_session ps_gba_session;

typedef struct ps_gba_status {
    ps_full_state_mode mode;
    uint16_t current_level;
    uint16_t width;
    uint16_t height;
    bool can_undo;
    bool pending_again;
    bool completed;
    const char* message;
} ps_gba_status;

size_t ps_gba_session_required_bytes(const ps_gba_game_view* game);
ps_gba_session* ps_gba_session_init(void* arena, size_t arena_size, const ps_gba_game_view* game);
bool ps_gba_load_level(ps_gba_session* session, uint16_t level_index);
bool ps_gba_load_level_with_seed(ps_gba_session* session, uint16_t level_index, const char* seed);
ps_step_result ps_gba_step(ps_gba_session* session, ps_input input);
bool ps_gba_undo(ps_gba_session* session);
bool ps_gba_restart(ps_gba_session* session);
void ps_gba_status_get(const ps_gba_session* session, ps_gba_status* status);
void ps_gba_random_state_get(const ps_gba_session* session, ps_gba_rng_state* state);
bool ps_gba_cell_has_object(const ps_gba_session* session, int32_t x, int32_t y, int32_t object_id);
bool ps_gba_first_player_position(const ps_gba_session* session, int32_t* x, int32_t* y);
const uint32_t* ps_gba_board_words(const ps_gba_session* session);
const ps_gba_game_view* ps_gba_game(const ps_gba_session* session);

#ifdef __cplusplus
}
#endif

#endif
