#include "puzzlescript/gbc_packed_cell.h"

#include <assert.h>
#include <stdint.h>
#include <stdio.h>

int main(void) {
    const uint8_t one_byte[] = {0x11U, 0xabU};
    const uint8_t two_bytes[] = {0x34U, 0x12U, 0xefU, 0xcdU};
    const uint8_t four_bytes[] = {
        0x04U, 0x03U, 0x02U, 0x01U,
        0xefU, 0xcdU, 0xabU, 0x89U
    };

    assert(ps_gbc_packed_cell_read(one_byte, 1U, 1U) == 0xabU);
    assert(ps_gbc_packed_cell_read(two_bytes, 1U, 2U) == 0xcdefU);
    assert(ps_gbc_packed_cell_read(four_bytes, 1U, 4U) == 0x89abcdefUL);
    assert(ps_gbc_packed_cell_read(NULL, 0U, 1U) == 0U);
    assert(ps_gbc_packed_cell_read(one_byte, 0U, 3U) == 0U);

    puts("gbc_packed_cell: ok");
    return 0;
}
