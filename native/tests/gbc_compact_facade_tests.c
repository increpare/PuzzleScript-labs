#include "generated_game.h"

#include "puzzlescript/gbc.h"
#include "puzzlescript/gbc_compact_facade.h"

#include <assert.h>
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
    const uint16_t dirty_cell = 5U;

    if (arena_bytes < PS_GBC_GENERATED_SESSION_BYTES) {
        arena_bytes = PS_GBC_GENERATED_SESSION_BYTES;
    }
    arena = (uint8_t*)malloc(arena_bytes);
    g_snapshots = (uint8_t*)calloc(snapshot_bytes, 1U);
    assert(arena != NULL && g_snapshots != NULL);

    session = ps_gbc_session_init(
        arena, arena_bytes, &ps_gbc_generated_game, &snapshot_io);
    assert(session != NULL);

    ps_gbc_status_get(session, &status);
    cell_count = ps_gbc_facade_cell_count(session);
    assert(cell_count == (uint16_t)(status.width * status.height));
    assert(cell_count > dirty_cell);

    before = ps_gbc_facade_get_objects(session, 0U);
    ps_gbc_facade_set_objects(session, 0U, before | 1U);
    assert(ps_gbc_facade_get_objects(session, 0U) == (before | 1U));
    assert(ps_gbc_facade_cell_has_any(session, 0U, 1U));
    assert(!ps_gbc_facade_cell_has_all(session, 0U, before | 1U | 2U));

    ps_gbc_facade_set_objects(session, 0U, 0x5U);
    assert(ps_gbc_facade_cell_has_any(session, 0U, 0x1U));
    assert(ps_gbc_facade_cell_has_any(session, 0U, 0x4U));
    assert(!ps_gbc_facade_cell_has_any(session, 0U, 0x2U));
    assert(ps_gbc_facade_cell_has_all(session, 0U, 0x5U));
    assert(!ps_gbc_facade_cell_has_all(session, 0U, 0x7U));

    movement_before = ps_gbc_facade_get_movements(session, 0U);
    ps_gbc_facade_set_movements(session, 0U, movement_before | 0x3U);
    assert(ps_gbc_facade_get_movements(session, 0U) == (movement_before | 0x3U));

    ps_gbc_clear_dirty_cells(session);
    assert(!dirty_bit_set(session, dirty_cell));
    ps_gbc_facade_mark_dirty(session, dirty_cell);
    assert(dirty_bit_set(session, dirty_cell));

    free(g_snapshots);
    free(arena);
    puts("gbc_compact_facade_tests: ok");
    return 0;
}
