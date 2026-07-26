#pragma bank 1

#include <gb/cgb.h>
#include <gb/gb.h>

#include "benchmark.h"
#include "game_dispatch.h"

#define SCREEN_TILES \
    (PS_GBC_SCREEN_TILE_WIDTH * PS_GBC_SCREEN_TILE_HEIGHT)
#define PERF_RENDER_ITERATIONS 4U

static uint16_t gBackgroundPalettes[32];

bool perfLoadFirstBoard(void) BANKED {
    const ps_gbc_game_view* game = ps_gbc_active_game_view();
    uint16_t level;
    if (game == NULL) return false;
    for (level = 0U; level < game->level_count; ++level) {
        ps_gbc_level level_view;
        if (!ps_gbc_active_rom_copy(
                game->levels + level,
                &level_view,
                sizeof(level_view))) {
            return false;
        }
        if (level_view.kind == PS_GBC_LEVEL_BOARD) {
            return psd_load_level(gSession, level);
        }
    }
    return false;
}

static void perfComposeBoard(void) {
    const ps_gbc_game_view* game = ps_gbc_active_game_view();
    ps_gbc_status status;
    uint8_t offset_x;
    uint8_t offset_y;
    uint8_t screen_y;
    psd_status_get(gSession, &status);
    if (game == NULL || status.mode != PS_FULL_STATE_MODE_LEVEL) return;
    offset_x = (uint8_t)((PS_GBC_VIEWPORT_WIDTH - status.width) / 2U);
    offset_y = (uint8_t)((PS_GBC_VIEWPORT_HEIGHT - status.height) / 2U);
    for (screen_y = 0U; screen_y < PS_GBC_VIEWPORT_HEIGHT; ++screen_y) {
        uint8_t screen_x;
        for (screen_x = 0U; screen_x < PS_GBC_VIEWPORT_WIDTH; ++screen_x) {
            const uint16_t screen_cell =
                (uint16_t)screen_y * PS_GBC_VIEWPORT_WIDTH + screen_x;
            uint32_t objects = game->background_mask;
            if (screen_x >= offset_x && screen_x < (uint8_t)(offset_x + status.width)
                && screen_y >= offset_y && screen_y < (uint8_t)(offset_y + status.height)) {
                objects = psd_cell_objects(
                    gSession,
                    (int16_t)(screen_x - offset_x),
                    (int16_t)(screen_y - offset_y));
            }
            (void)screen_cell;
            (void)composeTile(objects);
        }
    }
}

uint32_t perfMeasureRender(void) BANKED {
    uint32_t ticks = 0U;
    uint8_t iteration;
    renderBoard();
    for (iteration = 0U; iteration < PERF_RENDER_ITERATIONS; ++iteration) {
        (void)psd_step(
            gSession,
            (iteration & 1U) == 0U ? PS_INPUT_RIGHT : PS_INPUT_LEFT);
        perfTimerStart();
        renderBoard();
        ticks += perfTimerStop();
    }
    return ticks;
}

uint32_t perfMeasureComposition(void) BANKED {
    uint8_t iteration;
    uint32_t ticks;
    perfTimerStart();
    for (iteration = 0U; iteration < PERF_RENDER_ITERATIONS; ++iteration) {
        perfComposeBoard();
    }
    ticks = perfTimerStop();
    return ticks;
}

uint32_t perfMeasureTileUpload(void) BANKED {
    uint8_t iteration;
    uint32_t ticks;
    DISPLAY_OFF;
    perfTimerStart();
    for (iteration = 0U; iteration < PERF_RENDER_ITERATIONS; ++iteration) {
        uint16_t screen_cell;
        for (screen_cell = 0U; screen_cell < SCREEN_TILES; ++screen_cell) {
            VBK_REG = screen_cell >= 256U ? VBK_BANK_1 : VBK_BANK_0;
            set_bkg_data((uint8_t)screen_cell, 1U, gTileBytes);
        }
    }
    ticks = perfTimerStop();
    VBK_REG = VBK_BANK_0;
    DISPLAY_ON;
    return ticks;
}

uint32_t perfMeasureMapUpload(void) BANKED {
    uint8_t iteration;
    uint32_t ticks;
    DISPLAY_OFF;
    perfTimerStart();
    for (iteration = 0U; iteration < PERF_RENDER_ITERATIONS; ++iteration) {
        VBK_REG = VBK_BANK_0;
        set_bkg_tiles(0U, 0U, 20U, 18U, gTileMap);
        VBK_REG = VBK_BANK_1;
        set_bkg_tiles(0U, 0U, 20U, 18U, gAttributes);
    }
    ticks = perfTimerStop();
    VBK_REG = VBK_BANK_0;
    DISPLAY_ON;
    return ticks;
}

uint32_t perfMeasurePaletteUpload(void) BANKED {
    const ps_gbc_game_view* game = ps_gbc_active_game_view();
    uint8_t iteration;
    uint32_t ticks;
    if (game == NULL
        || !ps_gbc_active_rom_copy(
            game->background_palettes,
            gBackgroundPalettes,
            sizeof(gBackgroundPalettes))) {
        return 0U;
    }
    DISPLAY_OFF;
    perfTimerStart();
    for (iteration = 0U; iteration < PERF_RENDER_ITERATIONS; ++iteration) {
        set_bkg_palette(0U, 8U, gBackgroundPalettes);
    }
    ticks = perfTimerStop();
    DISPLAY_ON;
    return ticks;
}

uint32_t perfMeasureRepeatedText(void) BANKED {
    uint32_t ticks;
    showGameTitleText();
    perfTimerStart();
    showGameTitleText();
    ticks = perfTimerStop();
    return ticks;
}

void perfMeasureInteraction(perf_interaction* result) BANKED {
    if (!perfLoadFirstBoard()) {
        result->initial_render_ticks = 0U;
        result->walk_logic_ticks = 0U;
        result->walk_render_ticks = 0U;
        result->push_logic_ticks = 0U;
        result->push_render_ticks = 0U;
        return;
    }
    perfTimerStart();
    renderBoard();
    result->initial_render_ticks = perfTimerStop();
    perfTimerStart();
    (void)psd_step(gSession, PS_INPUT_DOWN);
    result->walk_logic_ticks = perfTimerStop();
    perfTimerStart();
    renderBoard();
    result->walk_render_ticks = perfTimerStop();
    perfTimerStart();
    (void)psd_step(gSession, PS_INPUT_RIGHT);
    result->push_logic_ticks = perfTimerStop();
    perfTimerStart();
    renderBoard();
    result->push_render_ticks = perfTimerStop();
}
