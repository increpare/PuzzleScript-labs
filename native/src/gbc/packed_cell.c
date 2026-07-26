#include "puzzlescript/gbc_packed_cell.h"

#include <stddef.h>

uint32_t ps_gbc_packed_cell_read(
    const void* board,
    uint16_t cell,
    uint8_t bytes_per_cell
) {
    const uint8_t* bytes;
    uint32_t result = 0U;
    uint8_t index;
    if (board == NULL
        || (bytes_per_cell != 1U
            && bytes_per_cell != 2U
            && bytes_per_cell != 4U)) {
        return 0U;
    }
    bytes = (const uint8_t*)board
        + (uint16_t)(cell * bytes_per_cell);
    for (index = 0U; index < bytes_per_cell; ++index) {
        result |= (uint32_t)bytes[index] << (uint8_t)(index * 8U);
    }
    return result;
}
