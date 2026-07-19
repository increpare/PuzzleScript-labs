#include "generated_game.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static uint32_t* g_snapshots;

static bool snapshot_read(void* context, uint8_t slot, uint32_t* cells, uint16_t count) {
    const ps_gbc_game_view* game = (const ps_gbc_game_view*)context;
    memcpy(cells, g_snapshots + (size_t)slot * game->max_level_cells,
        (size_t)count * sizeof(uint32_t));
    return true;
}

static bool snapshot_write(
    void* context,
    uint8_t slot,
    const uint32_t* cells,
    uint16_t count
) {
    const ps_gbc_game_view* game = (const ps_gbc_game_view*)context;
    memcpy(g_snapshots + (size_t)slot * game->max_level_cells, cells,
        (size_t)count * sizeof(uint32_t));
    return true;
}

int main(void) {
    uint8_t* arena;
    ps_gbc_session* session;
    ps_step_result result;
    ps_gbc_snapshot_io snapshots;
    const size_t snapshot_cells =
        (size_t)(ps_gbc_generated_game.undo_capacity + 1U)
        * ps_gbc_generated_game.max_level_cells;
    if (ps_gbc_generated_game.layer_count != 4U
        || ps_gbc_generated_game.movement_layer_count != 2U
        || ps_gbc_generated_game.movement_bytes_per_cell != 2U
        || ps_gbc_generated_game.movement_collision_layers[0] != 1U
        || ps_gbc_generated_game.movement_collision_layers[1] != 2U) {
        fprintf(stderr, "action movement compact layout differs\n");
        return 1;
    }
    arena = (uint8_t*)malloc(PS_GBC_GENERATED_SESSION_BYTES);
    g_snapshots = (uint32_t*)calloc(snapshot_cells, sizeof(uint32_t));
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
