#include "cart_launcher.h"

#include "puzzlescript/gbc_cart.h"

#if defined(PS_GBC_FREESTANDING)
#pragma bank 1
#endif

static void reveal_selection(
    ps_gbc_cart_launcher* launcher
) PS_GBC_CART_LAUNCHER_BANKED {
    launcher->first_visible = (uint8_t)(
        launcher->selected
        - launcher->selected % PS_GBC_CART_PAGE_SIZE);
}

void ps_gbc_cart_launcher_init(
    ps_gbc_cart_launcher* launcher,
    uint8_t game_count
) PS_GBC_CART_LAUNCHER_BANKED {
    launcher->selected = 0U;
    launcher->first_visible = 0U;
    launcher->game_count = game_count;
}

void ps_gbc_cart_launcher_move(
    ps_gbc_cart_launcher* launcher,
    int8_t direction
) PS_GBC_CART_LAUNCHER_BANKED {
    if (launcher->game_count == 0U || direction == 0) return;
    if (direction < 0) {
        launcher->selected = launcher->selected == 0U
            ? (uint8_t)(launcher->game_count - 1U)
            : (uint8_t)(launcher->selected - 1U);
    } else {
        launcher->selected = (uint8_t)(launcher->selected + 1U);
        if (launcher->selected >= launcher->game_count) {
            launcher->selected = 0U;
        }
    }
    reveal_selection(launcher);
}

void ps_gbc_cart_launcher_page(
    ps_gbc_cart_launcher* launcher,
    int8_t direction
) PS_GBC_CART_LAUNCHER_BANKED {
    uint8_t page_count;
    uint8_t page;
    uint8_t row;
    if (launcher->game_count == 0U || direction == 0) return;
    page_count = (uint8_t)(
        (launcher->game_count + PS_GBC_CART_PAGE_SIZE - 1U)
        / PS_GBC_CART_PAGE_SIZE);
    page = (uint8_t)(
        launcher->first_visible / PS_GBC_CART_PAGE_SIZE);
    row = (uint8_t)(launcher->selected - launcher->first_visible);
    if (direction < 0) {
        page = page == 0U ? (uint8_t)(page_count - 1U)
                         : (uint8_t)(page - 1U);
    } else {
        page = (uint8_t)(page + 1U);
        if (page >= page_count) page = 0U;
    }
    launcher->first_visible =
        (uint8_t)(page * PS_GBC_CART_PAGE_SIZE);
    launcher->selected =
        (uint8_t)(launcher->first_visible + row);
    if (launcher->selected >= launcher->game_count) {
        launcher->selected = (uint8_t)(launcher->game_count - 1U);
    }
}

uint8_t ps_gbc_cart_launcher_background_pixel(
    const ps_gbc_launcher_card* card,
    uint8_t x,
    uint8_t y
) PS_GBC_CART_LAUNCHER_BANKED {
    const uint8_t shift = (uint8_t)(7U - (x & 7U));
    const uint8_t offset = (uint8_t)((y & 7U) * 2U);
    return (uint8_t)(
        ((card->background_tile_2bpp[offset] >> shift) & 1U)
        | (((card->background_tile_2bpp[offset + 1U] >> shift) & 1U) << 1U));
}

uint8_t ps_gbc_cart_launcher_border_plane(
    uint8_t background_plane,
    bool scroll_plane,
    bool selected,
    bool final_tile
) PS_GBC_CART_LAUNCHER_BANKED {
    if (!final_tile) {
        return selected ? 0xffU : background_plane;
    }
    return (uint8_t)(
        (selected ? 0xf8U : (background_plane & 0xf8U))
        | (background_plane & 0x04U)
        | (scroll_plane ? 0x03U : 0U));
}

uint16_t ps_gbc_cart_launcher_tile_data_address(
    uint8_t tile,
    bool unsigned_mode
) PS_GBC_CART_LAUNCHER_BANKED {
    if (unsigned_mode) {
        return (uint16_t)(0x8000U + ((uint16_t)tile << 4U));
    }
    if (tile < 128U) {
        return (uint16_t)(0x9000U + ((uint16_t)tile << 4U));
    }
    return (uint16_t)(
        0x8800U + ((uint16_t)(tile - 128U) << 4U));
}

bool ps_gbc_cart_launcher_decode_progress(
    uint16_t saved_level,
    uint8_t level_count,
    bool* completed,
    uint8_t* level
) PS_GBC_CART_LAUNCHER_BANKED {
    if (completed == NULL || level == NULL) return false;
    if (saved_level == PS_GBC_CART_SAVE_COMPLETED) {
        *completed = true;
        *level = 0U;
        return true;
    }
    if (saved_level >= level_count) return false;
    *completed = false;
    *level = (uint8_t)saved_level;
    return true;
}

static char* append_number(char* output, uint8_t value) {
    if (value >= 100U) {
        *output++ = (char)('0' + value / 100U);
        value %= 100U;
        *output++ = (char)('0' + value / 10U);
    } else if (value >= 10U) {
        *output++ = (char)('0' + value / 10U);
    }
    *output++ = (char)('0' + value % 10U);
    return output;
}

void ps_gbc_cart_launcher_format_progress(
    const ps_gbc_launcher_card* card,
    bool has_save,
    bool completed,
    uint8_t level,
    char output[8]
) PS_GBC_CART_LAUNCHER_BANKED {
    char* cursor = output;
    uint8_t board = 0U;
    uint8_t index;
    if (completed) {
        output[0] = 'D';
        output[1] = 'O';
        output[2] = 'N';
        output[3] = 'E';
        output[4] = '\0';
        return;
    }
    if (!has_save || card->board_level_count == 0U) {
        output[0] = '-';
        output[1] = '-';
        output[2] = '\0';
        return;
    }
    for (index = 0U; index <= level; ++index) {
        if ((card->level_is_board_bits[index >> 3U]
                & (uint8_t)(1U << (index & 7U))) != 0U) {
            ++board;
        }
        if (index == 0xffU) break;
    }
    if (board == 0U) board = 1U;
    cursor = append_number(cursor, board);
    *cursor++ = '/';
    cursor = append_number(cursor, card->board_level_count);
    *cursor = '\0';
}

uint8_t ps_gbc_cart_launcher_progress_variant(
    const ps_gbc_launcher_card* card,
    bool has_save,
    bool completed,
    uint8_t level
) PS_GBC_CART_LAUNCHER_BANKED {
    uint8_t board = 0U;
    uint8_t index;
    if (card == NULL || !has_save) return 0U;
    if (completed) {
        return (uint8_t)(card->board_level_count + 1U);
    }
    if (card->board_level_count == 0U
        || level >= card->level_count) {
        return 0U;
    }
    for (index = 0U; index <= level; ++index) {
        if ((card->level_is_board_bits[index >> 3U]
                & (uint8_t)(1U << (index & 7U))) != 0U) {
            ++board;
        }
        if (index == 0xffU) break;
    }
    if (board == 0U) board = 1U;
    if (board > card->board_level_count) {
        board = card->board_level_count;
    }
    return board;
}

uint8_t ps_gbc_cart_launcher_transfer_plan(
    uint16_t first_screen_tile,
    bool unsigned_mode,
    ps_gbc_launcher_transfer_span spans[2]
) PS_GBC_CART_LAUNCHER_BANKED {
    uint16_t screen_tile = first_screen_tile;
    uint8_t source_tile = 0U;
    uint8_t remaining = 40U;
    uint8_t span_count = 0U;
    if (spans == NULL || first_screen_tile > 472U) return 0U;
    while (remaining != 0U) {
        const uint8_t tile = (uint8_t)screen_tile;
        uint16_t bank_available =
            256U - (screen_tile & 0xffU);
        uint8_t tile_count = remaining;
        if (bank_available < tile_count) {
            tile_count = (uint8_t)bank_available;
        }
        if (!unsigned_mode && tile < 128U) {
            const uint8_t signed_available =
                (uint8_t)(128U - tile);
            if (signed_available < tile_count) {
                tile_count = signed_available;
            }
        }
        if (span_count >= 2U || tile_count == 0U) return 0U;
        spans[span_count].vram_bank =
            (uint8_t)(screen_tile >> 8U);
        spans[span_count].tile = tile;
        spans[span_count].source_tile = source_tile;
        spans[span_count].tile_count = tile_count;
        ++span_count;
        screen_tile += tile_count;
        source_tile = (uint8_t)(source_tile + tile_count);
        remaining = (uint8_t)(remaining - tile_count);
    }
    return span_count;
}
