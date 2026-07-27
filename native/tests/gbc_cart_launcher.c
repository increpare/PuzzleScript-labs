#include "cart_launcher.h"
#include "puzzlescript/gbc_cart.h"

#include <stdbool.h>
#include <stdio.h>
#include <string.h>

static int require_true(bool condition, const char* message) {
    if (condition) return 0;
    fprintf(stderr, "gbc_cart_launcher: %s\n", message);
    return 1;
}

int main(void) {
    ps_gbc_cart_launcher launcher;
    ps_gbc_launcher_card card = {0};
    int failed = 0;

    failed |= require_true(
        sizeof(card.palette) == 8U
            && sizeof(card.background_tile_2bpp) == 16U
            && sizeof(card.player_pixels) == 64U
            && sizeof(card.level_is_board_bits) == 32U,
        "launcher card ABI does not carry the themed row assets");

    card.background_tile_2bpp[0] = 0x80U;
    card.background_tile_2bpp[1] = 0x40U;
    failed |= require_true(
        ps_gbc_cart_launcher_background_pixel(&card, 0U, 0U) == 1U
            && ps_gbc_cart_launcher_background_pixel(&card, 1U, 0U) == 2U
            && ps_gbc_cart_launcher_background_pixel(&card, 2U, 0U) == 0U,
        "launcher background tile did not decode as GBC 2bpp");

    failed |= require_true(
        ps_gbc_cart_launcher_border_plane(
            0x55U, false, false, false) == 0x55U
            && ps_gbc_cart_launcher_border_plane(
                0x55U, false, true, false) == 0xffU
            && ps_gbc_cart_launcher_border_plane(
                0x55U, false, true, true) == 0xfcU
            && ps_gbc_cart_launcher_border_plane(
                0x55U, true, false, true) == 0x57U,
        "launcher selection lines did not preserve the themed final pixels");

    failed |= require_true(
        ps_gbc_cart_launcher_tile_data_address(0U, false) == 0x9000U
            && ps_gbc_cart_launcher_tile_data_address(
                127U, false) == 0x97f0U
            && ps_gbc_cart_launcher_tile_data_address(
                128U, false) == 0x8800U
            && ps_gbc_cart_launcher_tile_data_address(
                255U, false) == 0x8ff0U
            && ps_gbc_cart_launcher_tile_data_address(
                0U, true) == 0x8000U
            && ps_gbc_cart_launcher_tile_data_address(
                255U, true) == 0x8ff0U,
        "launcher selection updater did not follow the active tile-data mode");

    {
        bool completed = false;
        uint8_t level = 0xffU;
        failed |= require_true(
            ps_gbc_cart_launcher_decode_progress(
                PS_GBC_CART_SAVE_COMPLETED,
                2U,
                &completed,
                &level)
                && completed
                && level == 0U,
            "completed SRAM progress did not decode as DONE");
        completed = true;
        failed |= require_true(
            ps_gbc_cart_launcher_decode_progress(
                1U,
                2U,
                &completed,
                &level)
                && !completed
                && level == 1U,
            "ordinary SRAM progress did not decode as a level");
        failed |= require_true(
            !ps_gbc_cart_launcher_decode_progress(
                2U,
                2U,
                &completed,
                &level),
            "an out-of-range SRAM level was accepted");
    }

    {
        char progress[8];
        ps_gbc_launcher_card empty_card = {0};
        ps_gbc_launcher_transfer_span spans[2] = {{0}};
        uint8_t span_count;
        card.level_count = 3U;
        card.board_level_count = 2U;
        card.level_is_board_bits[0] = 0x05U;
        ps_gbc_cart_launcher_format_progress(
            &card, false, false, 0U, progress);
        failed |= require_true(
            strcmp(progress, "--") == 0,
            "missing save did not render as --");
        ps_gbc_cart_launcher_format_progress(
            &card, true, false, 1U, progress);
        failed |= require_true(
            strcmp(progress, "1/2") == 0,
            "saved message level did not rank preceding board levels");
        ps_gbc_cart_launcher_format_progress(
            &card, true, true, 1U, progress);
        failed |= require_true(
            strcmp(progress, "DONE") == 0,
            "completed game did not render as DONE");
        failed |= require_true(
            ps_gbc_cart_launcher_progress_variant(
                &card, false, false, 0U) == 0U
                && ps_gbc_cart_launcher_progress_variant(
                    &card, true, false, 1U) == 1U
                && ps_gbc_cart_launcher_progress_variant(
                    &card, true, false, 2U) == 2U
                && ps_gbc_cart_launcher_progress_variant(
                    &card, true, true, 0U) == 3U,
            "launcher progress did not select the pre-rendered variant");
        empty_card.level_count = 1U;
        failed |= require_true(
            ps_gbc_cart_launcher_progress_variant(
                &empty_card, true, true, 0U) == 1U,
            "a completed zero-board game did not select DONE");

        span_count = ps_gbc_cart_launcher_transfer_plan(
            120U, false, spans);
        failed |= require_true(
            span_count == 2U
                && spans[0].vram_bank == 0U
                && spans[0].tile == 120U
                && spans[0].source_tile == 0U
                && spans[0].tile_count == 8U
                && spans[1].vram_bank == 0U
                && spans[1].tile == 128U
                && spans[1].source_tile == 8U
                && spans[1].tile_count == 32U,
            "signed launcher tiles did not split at tile 128");

        span_count = ps_gbc_cart_launcher_transfer_plan(
            240U, false, spans);
        failed |= require_true(
            span_count == 2U
                && spans[0].vram_bank == 0U
                && spans[0].tile == 240U
                && spans[0].source_tile == 0U
                && spans[0].tile_count == 16U
                && spans[1].vram_bank == 1U
                && spans[1].tile == 0U
                && spans[1].source_tile == 16U
                && spans[1].tile_count == 24U,
            "launcher tiles did not split at the VRAM bank boundary");

        span_count = ps_gbc_cart_launcher_transfer_plan(
            280U, false, spans);
        failed |= require_true(
            span_count == 1U
                && spans[0].vram_bank == 1U
                && spans[0].tile == 24U
                && spans[0].source_tile == 0U
                && spans[0].tile_count == 40U,
            "a launcher row wholly in VRAM bank 1 was split");

        span_count = ps_gbc_cart_launcher_transfer_plan(
            120U, true, spans);
        failed |= require_true(
            span_count == 1U
                && spans[0].vram_bank == 0U
                && spans[0].tile == 120U
                && spans[0].source_tile == 0U
                && spans[0].tile_count == 40U,
            "unsigned launcher tiles split at the signed boundary");
    }

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
