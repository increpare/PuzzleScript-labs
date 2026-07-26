#include "cart_launcher.h"
#include "puzzlescript/gbc_cart.h"

#include <stdbool.h>
#include <stdio.h>

static int require_true(bool condition, const char* message) {
    if (condition) return 0;
    fprintf(stderr, "gbc_cart_launcher: %s\n", message);
    return 1;
}

int main(void) {
    ps_gbc_cart_launcher launcher;
    int failed = 0;

    ps_gbc_cart_launcher_init(&launcher, 46U);
    failed |= require_true(
        launcher.selected == 0U
            && launcher.first_visible == 0U
            && launcher.game_count == 46U,
        "initial selection was not the first game");

    ps_gbc_cart_launcher_move(&launcher, -1);
    failed |= require_true(
        launcher.selected == 45U && launcher.first_visible == 40U,
        "moving above the first game did not wrap to the final page");

    ps_gbc_cart_launcher_move(&launcher, 1);
    failed |= require_true(
        launcher.selected == 0U && launcher.first_visible == 0U,
        "moving below the last game did not wrap to the first page");

    ps_gbc_cart_launcher_page(&launcher, 1);
    failed |= require_true(
        launcher.selected == PS_GBC_CART_PAGE_SIZE
            && launcher.first_visible == PS_GBC_CART_PAGE_SIZE,
        "page down did not preserve the selected row");

    ps_gbc_cart_launcher_move(&launcher, 1);
    ps_gbc_cart_launcher_page(&launcher, 1);
    failed |= require_true(
        launcher.selected == 17U && launcher.first_visible == 16U,
        "a second page down did not preserve the selected row");

    ps_gbc_cart_launcher_page(&launcher, -1);
    failed |= require_true(
        launcher.selected == 9U && launcher.first_visible == 8U,
        "page up did not preserve the selected row");

    ps_gbc_cart_launcher_init(&launcher, 3U);
    ps_gbc_cart_launcher_page(&launcher, -1);
    failed |= require_true(
        launcher.selected == 0U && launcher.first_visible == 0U,
        "paging a short single-page list did not remain stable");

    ps_gbc_cart_launcher_init(&launcher, 0U);
    ps_gbc_cart_launcher_move(&launcher, 1);
    ps_gbc_cart_launcher_page(&launcher, 1);
    failed |= require_true(
        launcher.selected == 0U && launcher.first_visible == 0U,
        "an empty launcher did not remain stable");

    return failed;
}
