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
