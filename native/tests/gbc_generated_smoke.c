#include "generated_game.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static uint8_t* gSnapshots;

static bool snapshot_read(void* context, uint8_t slot, void* data, uint16_t byte_count) {
    const ps_gbc_game_view* game = (const ps_gbc_game_view*)context;
    memcpy(
        data,
        gSnapshots + (size_t)slot * game->max_level_cells * game->object_bytes_per_cell,
        byte_count);
    return true;
}

static bool snapshot_write(
    void* context,
    uint8_t slot,
    const void* data,
    uint16_t byte_count
) {
    const ps_gbc_game_view* game = (const ps_gbc_game_view*)context;
    memcpy(
        gSnapshots + (size_t)slot * game->max_level_cells * game->object_bytes_per_cell,
        data,
        byte_count);
    return true;
}

int main(void) {
    size_t arena_bytes = ps_gbc_session_required_bytes(&ps_gbc_generated_game);
    uint8_t* arena;
    const size_t snapshot_bytes = (size_t)(ps_gbc_generated_game.undo_capacity + 1U)
        * ps_gbc_generated_game.max_level_cells
        * ps_gbc_generated_game.object_bytes_per_cell;
    const ps_gbc_snapshot_io snapshot_io = {
        (void*)&ps_gbc_generated_game,
        snapshot_read,
        snapshot_write
    };
    ps_gbc_session* session;
    int16_t x = -1;
    int16_t y = -1;
    ps_step_result result;
    if (arena_bytes < PS_GBC_GENERATED_SESSION_BYTES) {
        arena_bytes = PS_GBC_GENERATED_SESSION_BYTES;
    }
    arena = (uint8_t*)malloc(arena_bytes);
    gSnapshots = (uint8_t*)calloc(snapshot_bytes, 1U);
    if (arena == NULL || gSnapshots == NULL) {
        fprintf(stderr, "generated GBC arena allocation failed\n");
        free(gSnapshots);
        free(arena);
        return 1;
    }
    session = ps_gbc_session_init(
        arena, arena_bytes, &ps_gbc_generated_game, &snapshot_io);
    if (session == NULL || !ps_gbc_first_player_position(session, &x, &y)) {
        fprintf(stderr, "generated GBC game cannot start\n");
        free(gSnapshots);
        free(arena);
        return 1;
    }
    if (x != 2 || y != 3) {
        fprintf(stderr, "generated GBC level orientation is wrong: %d,%d\n", x, y);
        free(gSnapshots);
        free(arena);
        return 1;
    }
    result = ps_gbc_step(session, PS_INPUT_RIGHT);
    if (!result.changed || !ps_gbc_first_player_position(session, &x, &y)
        || x != 3 || y != 3) {
        fprintf(stderr, "generated GBC movement differs: %d,%d\n", x, y);
        free(gSnapshots);
        free(arena);
        return 1;
    }
    if (!ps_gbc_undo(session)
        || !ps_gbc_first_player_position(session, &x, &y)
        || x != 2 || y != 3) {
        fprintf(stderr, "generated GBC undo differs: %d,%d\n", x, y);
        free(gSnapshots);
        free(arena);
        return 1;
    }
    free(gSnapshots);
    free(arena);
    return 0;
}
