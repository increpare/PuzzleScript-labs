#pragma once

#include <stdint.h>

uint32_t ps_gbc_packed_cell_read(
    const void* board,
    uint16_t cell,
    uint8_t bytes_per_cell);
