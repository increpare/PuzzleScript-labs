#include "generated_game.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static uint8_t* g_snapshots;

static bool snapshot_read(void* context, uint8_t slot, void* data, uint16_t byte_count) {
    const ps_gbc_game_view* game = (const ps_gbc_game_view*)context;
    memcpy(
        data,
        g_snapshots + (size_t)slot * game->max_level_cells * game->object_bytes_per_cell,
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
        g_snapshots + (size_t)slot * game->max_level_cells * game->object_bytes_per_cell,
        data,
        byte_count);
    return true;
}

int main(void) {
    uint8_t* arena;
    ps_gbc_session* session;
    ps_step_result result;
    ps_gbc_snapshot_io snapshots;
    const size_t snapshot_bytes =
        (size_t)(ps_gbc_generated_game.undo_capacity + 1U)
        * ps_gbc_generated_game.max_level_cells
        * ps_gbc_generated_game.object_bytes_per_cell;
    if (ps_gbc_generated_game.layer_count != 4U
        || ps_gbc_generated_game.movement_layer_count != 2U
        || ps_gbc_generated_game.movement_bytes_per_cell != 2U
        || ps_gbc_generated_game.movement_collision_layers[0] != 1U
        || ps_gbc_generated_game.movement_collision_layers[1] != 2U) {
        fprintf(stderr, "action movement compact layout differs\n");
        return 1;
    }
    arena = (uint8_t*)malloc(PS_GBC_GENERATED_SESSION_BYTES);
    g_snapshots = (uint8_t*)calloc(snapshot_bytes, 1U);
    if (arena == NULL || g_snapshots == NULL) {
        free(g_snapshots);
        free(arena);
        return 1;
    }
    snapshots.context = (void*)&ps_gbc_generated_game;
    snapshots.read = snapshot_read;
    snapshots.write = snapshot_write;
    session = ps_gbc_session_init(
        arena, PS_GBC_GENERATED_SESSION_BYTES, &ps_gbc_generated_game, &snapshots);
    if (session == NULL) {
        fprintf(stderr, "action movement session failed\n");
        free(g_snapshots);
        free(arena);
        return 1;
    }
    result = ps_gbc_step(session, PS_INPUT_ACTION);
    if (!result.changed
        || (ps_gbc_cell_objects(session, 0, 0) & (1U << 1U)) == 0U
        || (ps_gbc_cell_objects(session, 1, 0) & (1U << 2U)) == 0U
        || (ps_gbc_cell_objects(session, 1, 0) & (1U << 3U)) == 0U) {
        fprintf(stderr, "action-only high movement lane did not feed the following rule\n");
        free(g_snapshots);
        free(arena);
        return 1;
    }
    if (!ps_gbc_undo(session)
        || (ps_gbc_cell_objects(session, 1, 0) & (1U << 3U)) != 0U) {
        fprintf(stderr, "action movement undo differs\n");
        free(g_snapshots);
        free(arena);
        return 1;
    }
    free(g_snapshots);
    free(arena);
    return 0;
}
