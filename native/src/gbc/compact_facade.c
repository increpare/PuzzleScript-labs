#if (defined(__SDCC) || defined(GBDK)) \
    && !defined(PS_GBC_GENERATED_FACADE_WRAPPER)
#pragma bank 2
#endif

#include "puzzlescript/gbc_compact_facade.h"

#include "session_internal.h"

static uint8_t ps_gbc_facade_object_width(const ps_gbc_game_view* game) {
#if defined(PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL)
    (void)game;
    return PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL;
#else
    return game->object_bytes_per_cell;
#endif
}

static uint8_t ps_gbc_facade_movement_width(const ps_gbc_game_view* game) {
#if defined(PS_GBC_BENCH_WIDE_MOVEMENTS)
    (void)game;
    return 4U;
#else
    return game->movement_bytes_per_cell;
#endif
}

static uint32_t ps_gbc_facade_board_get(const ps_gbc_session* session, uint16_t cell) {
#if defined(PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL)
#if PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL == 1U
    return session->board[cell];
#elif PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL == 2U
    return ((const uint16_t*)session->board)[cell];
#else
    return ((const uint32_t*)session->board)[cell];
#endif
#else
    const uint8_t width = ps_gbc_facade_object_width(session->game);
    if (width == 1U) return session->board[cell];
    if (width == 2U) return ((const uint16_t*)session->board)[cell];
    return ((const uint32_t*)session->board)[cell];
#endif
}

static void ps_gbc_facade_board_set(
    ps_gbc_session* session,
    uint16_t cell,
    uint32_t objects
) {
#if defined(PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL)
#if PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL == 1U
    session->board[cell] = (uint8_t)objects;
#elif PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL == 2U
    ((uint16_t*)session->board)[cell] = (uint16_t)objects;
#else
    ((uint32_t*)session->board)[cell] = objects;
#endif
#else
    const uint8_t width = ps_gbc_facade_object_width(session->game);
    if (width == 1U) {
        session->board[cell] = (uint8_t)objects;
    } else if (width == 2U) {
        ((uint16_t*)session->board)[cell] = (uint16_t)objects;
    } else {
        ((uint32_t*)session->board)[cell] = objects;
    }
#endif
}

static uint32_t ps_gbc_facade_movement_get(const ps_gbc_session* session, uint16_t cell) {
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
    const uint8_t width = ps_gbc_facade_movement_width(session->game);
    if (width == 1U) return session->movements[cell];
    if (width == 2U) return ((const uint16_t*)session->movements)[cell];
    return ((const uint32_t*)session->movements)[cell];
#endif
}

static void ps_gbc_facade_movement_set(
    ps_gbc_session* session,
    uint16_t cell,
    uint32_t movements
) {
#if defined(PS_GBC_BENCH_WIDE_MOVEMENTS)
    ((uint32_t*)session->movements)[cell] = movements;
#elif defined(PS_GBC_GENERATED_MOVEMENT_BYTES_PER_CELL)
#if PS_GBC_GENERATED_MOVEMENT_BYTES_PER_CELL == 1U
    session->movements[cell] = (uint8_t)movements;
#elif PS_GBC_GENERATED_MOVEMENT_BYTES_PER_CELL == 2U
    ((uint16_t*)session->movements)[cell] = (uint16_t)movements;
#else
    ((uint32_t*)session->movements)[cell] = movements;
#endif
#else
    const uint8_t width = ps_gbc_facade_movement_width(session->game);
    if (width == 1U) {
        session->movements[cell] = (uint8_t)movements;
    } else if (width == 2U) {
        ((uint16_t*)session->movements)[cell] = (uint16_t)movements;
    } else {
        ((uint32_t*)session->movements)[cell] = movements;
    }
#endif
}

uint16_t ps_gbc_facade_cell_count(const ps_gbc_session* session) {
    if (session == NULL) return 0U;
    return (uint16_t)(session->width * session->height);
}

uint32_t ps_gbc_facade_get_objects(const ps_gbc_session* session, uint16_t cell) {
    if (session == NULL) return 0U;
    return ps_gbc_facade_board_get(session, cell);
}

void ps_gbc_facade_set_objects(
    ps_gbc_session* session,
    uint16_t cell,
    uint32_t objects
) {
    if (session == NULL) return;
    ps_gbc_facade_board_set(session, cell, objects);
}

uint32_t ps_gbc_facade_get_movements(const ps_gbc_session* session, uint16_t cell) {
    if (session == NULL) return 0U;
    return ps_gbc_facade_movement_get(session, cell);
}

void ps_gbc_facade_set_movements(
    ps_gbc_session* session,
    uint16_t cell,
    uint32_t movements
) {
    if (session == NULL) return;
    ps_gbc_facade_movement_set(session, cell, movements);
}

void ps_gbc_facade_mark_dirty(ps_gbc_session* session, uint16_t cell) {
    if (session == NULL) return;
    session->dirty_bits[cell >> 3U] |= (uint8_t)(1U << (cell & 7U));
}

bool ps_gbc_facade_cell_has_any(
    const ps_gbc_session* session,
    uint16_t cell,
    uint32_t mask
) {
    if (session == NULL || mask == 0U) return false;
    return (ps_gbc_facade_board_get(session, cell) & mask) != 0U;
}

bool ps_gbc_facade_cell_has_all(
    const ps_gbc_session* session,
    uint16_t cell,
    uint32_t mask
) {
    if (session == NULL) return false;
    return (ps_gbc_facade_board_get(session, cell) & mask) == mask;
}
