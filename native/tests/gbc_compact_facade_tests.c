#include "generated_game.h"

#include "puzzlescript/gbc.h"
#include "puzzlescript/gbc_compact_facade.h"

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

static bool dirty_bit_set(const ps_gbc_session* session, uint16_t cell) {
    const uint8_t* dirty = ps_gbc_dirty_cells(session);
    return dirty != NULL
        && (dirty[cell >> 3U] & (uint8_t)(1U << (cell & 7U))) != 0U;
}

int main(void) {
    size_t arena_bytes = ps_gbc_session_required_bytes(&ps_gbc_generated_game);
    const size_t snapshot_bytes = (size_t)(ps_gbc_generated_game.undo_capacity + 1U)
        * ps_gbc_generated_game.max_level_cells
        * ps_gbc_generated_game.object_bytes_per_cell;
    const ps_gbc_snapshot_io snapshot_io = {
        (void*)&ps_gbc_generated_game,
        snapshot_read,
        snapshot_write
    };
    uint8_t* arena;
    ps_gbc_session* session;
    ps_gbc_status status;
    uint16_t cell_count;
    uint32_t before;
    uint32_t movement_before;
    uint32_t objects;
    const uint16_t dirty_cell = 5U;

    if (arena_bytes < PS_GBC_GENERATED_SESSION_BYTES) {
        arena_bytes = PS_GBC_GENERATED_SESSION_BYTES;
    }
    arena = (uint8_t*)malloc(arena_bytes);
    g_snapshots = (uint8_t*)calloc(snapshot_bytes, 1U);
    if (arena == NULL || g_snapshots == NULL) {
        fprintf(stderr, "compact facade arena allocation failed\n");
        free(g_snapshots);
        free(arena);
        return 1;
    }
    session = ps_gbc_session_init(
        arena, arena_bytes, &ps_gbc_generated_game, &snapshot_io);
    if (session == NULL) {
        fprintf(stderr, "compact facade session init failed\n");
        free(g_snapshots);
        free(arena);
        return 1;
    }

    ps_gbc_status_get(session, &status);
    cell_count = ps_gbc_facade_cell_count(session);
    if (cell_count != (uint16_t)(status.width * status.height)) {
        fprintf(
            stderr,
            "compact facade cell_count mismatch: %u != %u\n",
            cell_count,
            (unsigned)(status.width * status.height));
        free(g_snapshots);
        free(arena);
        return 1;
    }
    if (cell_count <= dirty_cell) {
        fprintf(
            stderr,
            "compact facade cell_count too small for dirty test: %u\n",
            cell_count);
        free(g_snapshots);
        free(arena);
        return 1;
    }

    before = ps_gbc_facade_get_objects(session, 0U);
    ps_gbc_facade_set_objects(session, 0U, before | 1U);
    objects = ps_gbc_facade_get_objects(session, 0U);
    if (objects != (before | 1U)) {
        fprintf(
            stderr,
            "compact facade set objects failed: 0x%x != 0x%x\n",
            objects,
            before | 1U);
        free(g_snapshots);
        free(arena);
        return 1;
    }
    if (!ps_gbc_facade_cell_has_any(session, 0U, 1U)) {
        fprintf(stderr, "compact facade has_any missed expected bit\n");
        free(g_snapshots);
        free(arena);
        return 1;
    }
    if (ps_gbc_facade_cell_has_all(session, 0U, before | 1U | 2U)) {
        fprintf(stderr, "compact facade has_all accepted extra mask\n");
        free(g_snapshots);
        free(arena);
        return 1;
    }

    ps_gbc_facade_set_objects(session, 0U, 0x5U);
    if (!ps_gbc_facade_cell_has_any(session, 0U, 0x1U)
        || !ps_gbc_facade_cell_has_any(session, 0U, 0x4U)) {
        fprintf(stderr, "compact facade has_any failed on 0x5U pattern\n");
        free(g_snapshots);
        free(arena);
        return 1;
    }
    if (ps_gbc_facade_cell_has_any(session, 0U, 0x2U)) {
        fprintf(stderr, "compact facade has_any saw absent bit\n");
        free(g_snapshots);
        free(arena);
        return 1;
    }
    if (!ps_gbc_facade_cell_has_all(session, 0U, 0x5U)) {
        fprintf(stderr, "compact facade has_all failed on exact mask\n");
        free(g_snapshots);
        free(arena);
        return 1;
    }
    if (ps_gbc_facade_cell_has_all(session, 0U, 0x7U)) {
        fprintf(stderr, "compact facade has_all accepted superset mask\n");
        free(g_snapshots);
        free(arena);
        return 1;
    }

    movement_before = ps_gbc_facade_get_movements(session, 0U);
    ps_gbc_facade_set_movements(session, 0U, movement_before | 0x3U);
    if (ps_gbc_facade_get_movements(session, 0U) != (movement_before | 0x3U)) {
        fprintf(stderr, "compact facade set movements failed\n");
        free(g_snapshots);
        free(arena);
        return 1;
    }

    ps_gbc_clear_dirty_cells(session);
    if (dirty_bit_set(session, dirty_cell)) {
        fprintf(stderr, "compact facade dirty bit set before mark_dirty\n");
        free(g_snapshots);
        free(arena);
        return 1;
    }
    ps_gbc_facade_mark_dirty(session, dirty_cell);
    if (!dirty_bit_set(session, dirty_cell)) {
        fprintf(stderr, "compact facade mark_dirty did not set bit\n");
        free(g_snapshots);
        free(arena);
        return 1;
    }

    free(g_snapshots);
    free(arena);
    puts("gbc_compact_facade_tests: ok");
    return 0;
}
