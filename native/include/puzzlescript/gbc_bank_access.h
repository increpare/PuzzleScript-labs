#pragma once

#include <stdbool.h>
#include <stdint.h>

typedef uint8_t (*ps_gbc_current_bank_fn)(void* context);
typedef void (*ps_gbc_switch_bank_fn)(void* context, uint8_t bank);

typedef struct ps_gbc_bank_access {
    void* context;
    ps_gbc_current_bank_fn current_bank;
    ps_gbc_switch_bank_fn switch_bank;
} ps_gbc_bank_access;

bool ps_gbc_bank_copy(
    const ps_gbc_bank_access* access,
    uint8_t source_bank,
    const void* source,
    void* destination,
    uint16_t byte_count);

bool ps_gbc_bank_copy_string(
    const ps_gbc_bank_access* access,
    uint8_t source_bank,
    const char* source,
    char* destination,
    uint16_t capacity);

/* Optional freestanding hook: when non-NULL, level cell payloads are read
 * through this instead of memcpy (cells may live in a sibling ROM bank). */
typedef bool (*ps_gbc_level_cells_read_fn)(
    const void* source,
    void* destination,
    uint16_t byte_count);
/* Optional freestanding hook: when non-NULL, rule pattern slices are read
 * through this (pattern tables may live in a sibling ROM bank). */
typedef bool (*ps_gbc_pattern_slice_read_fn)(
    const void* source,
    void* destination,
    uint16_t byte_count);
#if defined(PS_GBC_FREESTANDING)
extern ps_gbc_level_cells_read_fn ps_gbc_level_cells_read;
extern ps_gbc_pattern_slice_read_fn ps_gbc_pattern_slice_read;
/* Single WRAM scratch for rule pattern slices (not per-game banked .o). */
#define PS_GBC_PATTERN_SLICE_MAX_BYTES 128U
extern uint8_t ps_gbc_pattern_slice_buf[PS_GBC_PATTERN_SLICE_MAX_BYTES];
#endif
