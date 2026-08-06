#pragma bank 1

#include <gb/cgb.h>
#include <gb/gb.h>

#include "benchmark.h"
#include "game_dispatch.h"

#include <string.h>

#if defined(PS_GBC_PERF_BENCH)
#define SCREEN_TILES \
    (PS_GBC_SCREEN_TILE_WIDTH * PS_GBC_SCREEN_TILE_HEIGHT)
#define PERF_RENDER_ITERATIONS 4U
#define PERF_RENDER_DETAIL_MAGIC 0x44434250UL
#define PERF_RENDER_DETAIL_OFFSET 192U
#define PERF_RENDER_DETAIL_SAMPLE_BYTES 30U

static uint16_t gBackgroundPalettes[32];

static void perfWriteSram8(uint16_t offset, uint8_t value) {
    *((volatile uint8_t*)(0xa000U + offset)) = value;
}

static void perfWriteSram16(uint16_t offset, uint16_t value) {
    perfWriteSram8(offset, (uint8_t)value);
    perfWriteSram8((uint16_t)(offset + 1U), (uint8_t)(value >> 8U));
}

static void perfWriteSram32(uint16_t offset, uint32_t value) {
    uint8_t index;
    for (index = 0U; index < 4U; ++index) {
        perfWriteSram8(
            (uint16_t)(offset + index),
            (uint8_t)(value >> (index * 8U)));
    }
}

static void perfPublishRenderSample(
    uint16_t offset,
    const perf_render_sample* sample
) {
    uint8_t index;
    for (index = 0U; index < PS_GBC_PERF_RENDER_PHASE_COUNT; ++index) {
        perfWriteSram32(
            (uint16_t)(offset + (uint16_t)index * 4U),
            sample->phase_ticks[index]);
    }
    offset = (uint16_t)(
        offset + PS_GBC_PERF_RENDER_PHASE_COUNT * sizeof(uint32_t));
    for (index = 0U; index < PS_GBC_PERF_RENDER_COUNTER_COUNT; ++index) {
        perfWriteSram16(
            (uint16_t)(offset + (uint16_t)index * 2U),
            sample->counts[index]);
    }
}

static void perfPublishRenderDetail(const perf_interaction* interaction) {
    ENABLE_RAM_MBC5;
    SWITCH_RAM_MBC5(3U);
    perfWriteSram32(PERF_RENDER_DETAIL_OFFSET, 0U);
    perfWriteSram16((uint16_t)(PERF_RENDER_DETAIL_OFFSET + 4U), 1U);
    perfWriteSram16(
        (uint16_t)(PERF_RENDER_DETAIL_OFFSET + 6U),
        PS_GBC_PERF_RENDER_PHASE_COUNT);
    perfWriteSram16(
        (uint16_t)(PERF_RENDER_DETAIL_OFFSET + 8U),
        PS_GBC_PERF_RENDER_COUNTER_COUNT);
    perfWriteSram16((uint16_t)(PERF_RENDER_DETAIL_OFFSET + 10U), 0U);
    perfPublishRenderSample(
        (uint16_t)(PERF_RENDER_DETAIL_OFFSET + 12U),
        &interaction->initial_render);
    perfPublishRenderSample(
        (uint16_t)(
            PERF_RENDER_DETAIL_OFFSET
            + 12U
            + PERF_RENDER_DETAIL_SAMPLE_BYTES),
        &interaction->walk_render);
    perfPublishRenderSample(
        (uint16_t)(
            PERF_RENDER_DETAIL_OFFSET
            + 12U
            + PERF_RENDER_DETAIL_SAMPLE_BYTES * 2U),
        &interaction->push_render);
    perfWriteSram32(PERF_RENDER_DETAIL_OFFSET, PERF_RENDER_DETAIL_MAGIC);
    DISABLE_RAM_MBC5;
}

static void perfMeasureRenderSample(
    uint32_t* ticks,
    perf_render_sample* sample
) {
    memset(gPerfRenderPhaseTicks, 0, sizeof(gPerfRenderPhaseTicks));
    memset(gPerfRenderCounts, 0, sizeof(gPerfRenderCounts));
    gPerfRenderEnabled = true;
    perfTimerStart();
    renderBoard();
    *ticks = perfTimerStop();
    gPerfRenderEnabled = false;
    memcpy(
        sample->phase_ticks,
        gPerfRenderPhaseTicks,
        sizeof(sample->phase_ticks));
    memcpy(
        sample->counts,
        gPerfRenderCounts,
        sizeof(sample->counts));
}

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
        memset(result, 0, sizeof(*result));
        perfPublishRenderDetail(result);
        return;
    }
    perfMeasureRenderSample(
        &result->initial_render_ticks,
        &result->initial_render);
    perfTimerStart();
    (void)psd_step(gSession, PS_INPUT_DOWN);
    result->walk_logic_ticks = perfTimerStop();
    perfMeasureRenderSample(
        &result->walk_render_ticks,
        &result->walk_render);
    perfTimerStart();
    (void)psd_step(gSession, PS_INPUT_RIGHT);
    result->push_logic_ticks = perfTimerStop();
    perfMeasureRenderSample(
        &result->push_render_ticks,
        &result->push_render);
    perfPublishRenderDetail(result);
}
#endif

#if defined(PS_GBC_CART_BENCHMARK)
static uint16_t gCartBenchGameIndex;
static uint16_t gCartBenchTargetBoard;
static uint32_t gCartBenchUserTurns;
static uint32_t gCartBenchRedraws;
static uint32_t gCartBenchLogicTicks;
static uint32_t gCartBenchRenderTicks;
static uint32_t gCartBenchMaxTurnTicks;
static uint32_t gCartBenchTurnLogicTicks;
static uint32_t gCartBenchTurnRenderTicks;
static bool gCartBenchTurnActive;
static bool gCartBenchPublished;

static void cartBenchWrite32(
    volatile uint8_t* destination,
    uint16_t offset,
    uint32_t value
) {
    uint8_t byte;
    for (byte = 0U; byte < 4U; ++byte) {
        destination[(uint16_t)(offset + byte)] =
            (uint8_t)(value >> (byte * 8U));
    }
}

static void cartBenchFinalizeTurn(void) {
    uint32_t turn_ticks;
    if (!gCartBenchTurnActive) return;
    ++gCartBenchUserTurns;
    turn_ticks = gCartBenchTurnLogicTicks + gCartBenchTurnRenderTicks;
    if (turn_ticks > gCartBenchMaxTurnTicks) {
        gCartBenchMaxTurnTicks = turn_ticks;
    }
    gCartBenchTurnLogicTicks = 0U;
    gCartBenchTurnRenderTicks = 0U;
    gCartBenchTurnActive = false;
}

static void cartBenchPublish(bool won) {
    volatile uint8_t* destination;
    uint8_t byte;
    if (gCartBenchPublished) return;
    ENABLE_RAM_MBC5;
    SWITCH_RAM_MBC5(CART_BENCH_SRAM_BANK);
    destination = (volatile uint8_t*)(
        0xa000U + CART_BENCH_SRAM_OFFSET);
    cartBenchWrite32(destination, 0U, 0U);
    destination[4U] = CART_BENCH_VERSION;
    destination[5U] = 0U;
    destination[6U] = (uint8_t)gCartBenchGameIndex;
    destination[7U] = (uint8_t)(gCartBenchGameIndex >> 8U);
    cartBenchWrite32(destination, 8U, gCartBenchUserTurns);
    cartBenchWrite32(destination, 12U, gCartBenchRedraws);
    cartBenchWrite32(destination, 16U, gCartBenchLogicTicks);
    cartBenchWrite32(destination, 20U, gCartBenchRenderTicks);
    cartBenchWrite32(destination, 24U, gCartBenchMaxTurnTicks);
    destination[28U] = won ? 1U : 0U;
    for (byte = 29U; byte < CART_BENCH_RECORD_BYTES; ++byte) {
        destination[byte] = 0U;
    }
    /* Commit marker last: all preceding fixed-width fields are now durable. */
    cartBenchWrite32(destination, 0U, CART_BENCH_MAGIC);
    DISABLE_RAM_MBC5;
    gCartBenchPublished = true;
}

void cartBenchInitialize(uint16_t game_index) BANKED {
    volatile uint8_t* destination;
    volatile uint8_t* request;
    gCartBenchGameIndex = game_index;
    gCartBenchUserTurns = 0U;
    gCartBenchRedraws = 0U;
    gCartBenchLogicTicks = 0U;
    gCartBenchRenderTicks = 0U;
    gCartBenchMaxTurnTicks = 0U;
    gCartBenchTurnLogicTicks = 0U;
    gCartBenchTurnRenderTicks = 0U;
    gCartBenchTurnActive = false;
    gCartBenchPublished = false;
    ENABLE_RAM_MBC5;
    SWITCH_RAM_MBC5(CART_BENCH_SRAM_BANK);
    request = (volatile uint8_t*)(
        0xa000U + CART_BENCH_REQUEST_OFFSET);
    gCartBenchTargetBoard = (uint16_t)(
        (uint16_t)request[0U] | ((uint16_t)request[1U] << 8U));
    if (gCartBenchTargetBoard == 0xffffU) {
        gCartBenchTargetBoard = 0U;
    }
    destination = (volatile uint8_t*)(
        0xa000U + CART_BENCH_SRAM_OFFSET);
    /* An interrupted boot must never leave an earlier valid record. */
    cartBenchWrite32(destination, 0U, 0U);
    DISABLE_RAM_MBC5;
    perfTimerInitialize();
}

bool cartBenchLoadFirstBoard(void) BANKED {
    const ps_gbc_game_view* game = ps_gbc_active_game_view();
    uint16_t level_index;
    uint16_t board_ordinal = 0U;
    ps_gbc_level level;
    if (game == NULL) return false;
    for (level_index = 0U;
         level_index < game->level_count;
         ++level_index) {
        if (ps_gbc_active_rom_copy(
                game->levels + level_index,
                &level,
                sizeof(level))
            && level.kind == PS_GBC_LEVEL_BOARD) {
            if (board_ordinal == gCartBenchTargetBoard) {
                return psd_load_level(gSession, level_index);
            }
            ++board_ordinal;
        }
    }
    return false;
}

void cartBenchBeginUserTurn(void) BANKED {
    cartBenchFinalizeTurn();
    gCartBenchTurnActive = true;
}

bool cartBenchHasActiveTurn(void) BANKED {
    return gCartBenchTurnActive;
}

void cartBenchAccumulateLogic(uint32_t ticks) BANKED {
    gCartBenchLogicTicks += ticks;
    gCartBenchTurnLogicTicks += ticks;
}

void cartBenchRender(void) BANKED {
    uint32_t ticks;
    perfTimerStart();
    renderBoard();
    ticks = perfTimerStop();
    gCartBenchRenderTicks += ticks;
    gCartBenchTurnRenderTicks += ticks;
    ++gCartBenchRedraws;
}

void cartBenchFinish(bool won) BANKED {
    cartBenchFinalizeTurn();
    cartBenchPublish(won);
}

bool cartBenchHasPublished(void) BANKED {
    return gCartBenchPublished;
}

void cartBenchShutdown(void) BANKED {
    perfTimerShutdown();
}
#endif
