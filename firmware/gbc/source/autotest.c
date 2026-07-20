#pragma bank 1

#include <gb/cgb.h>
#include <gb/gb.h>

#include "audio.h"
#if defined(PS_GBC_PERF_BENCH)
#include "benchmark.h"
#endif
#include "generated_game.h"
#include "puzzlescript/gbc.h"
#include "text.h"
#include "tile_cache.h"

#include <string.h>

#define SCREEN_TILES \
    (PS_GBC_SCREEN_TILE_WIDTH * PS_GBC_SCREEN_TILE_HEIGHT)
#define AUTOTEST_MAGIC 0x54434250UL
#define RENDER_AUTOTEST_MAGIC 0x52434250UL
#define PERF_MAGIC 0x46434250UL
#define PERF_PHASE_MAGIC 0x32434250UL
#define PERF_INTERACTION_MAGIC 0x49434250UL
#define FRAME_DUMP_MAGIC 0x46474250UL
#define AUDIO_AUTOTEST_MAGIC 0x41434250UL
#define AUDIO_AUTOTEST_OFFSET 128U
#define PERF_ITERATIONS 128U
#define PERF_RENDER_ITERATIONS 4U

extern uint8_t gTileMap[SCREEN_TILES];
extern uint8_t gAttributes[SCREEN_TILES];
extern ps_gbc_session* gSession;
void renderBoard(void);

#if !defined(PS_GBC_AUTOTEST_LOGIC_ONLY)
extern uint16_t gDisplayBlankCount;
extern uint16_t gTileUploadMismatches;
#endif

#if defined(PS_GBC_PERF_BENCH)
extern uint32_t gPerfPhaseTicks[PS_GBC_PERF_PHASE_COUNT];
extern bool gPerfPhaseEnabled;
void perfTimerInitialize(void);
void perfTimerStart(void);
uint32_t perfTimerStop(void);
void perfTimerShutdown(void);
#endif

static void writeSram8(uint16_t offset, uint8_t value) {
    *((volatile uint8_t*)(0xa000U + offset)) = value;
}

static void writeSram16(uint16_t offset, uint16_t value) {
    writeSram8(offset, (uint8_t)value);
    writeSram8((uint16_t)(offset + 1U), (uint8_t)(value >> 8U));
}

static void writeSram32(uint16_t offset, uint32_t value) {
    uint8_t index;
    for (index = 0U; index < 4U; ++index) {
        writeSram8((uint16_t)(offset + index), (uint8_t)(value >> (index * 8U)));
    }
}

#if !defined(PS_GBC_PERF_BENCH) \
    && !defined(PS_GBC_AUTOTEST_LOGIC_ONLY)
static uint16_t countNonzero(const uint8_t* data, uint16_t size) {
    uint16_t count = 0U;
    while (size-- != 0U) {
        if (*data++ != 0U) ++count;
    }
    return count;
}

static uint16_t countVramNonzero(uint8_t bank, uint16_t size) {
    volatile const uint8_t* data = (volatile const uint8_t*)0x8000U;
    uint16_t count = 0U;
    VBK_REG = bank;
    while (size-- != 0U) {
        if (*data++ != 0U) ++count;
    }
    VBK_REG = VBK_BANK_0;
    return count;
}

static uint16_t countHardwareMapMismatches(
    const uint8_t* expected,
    uint8_t bank
) {
    volatile const uint8_t* tile_map =
        (volatile const uint8_t*)(
            (LCDC_REG & LCDCF_BG9C00) != 0U ? 0x9c00U : 0x9800U);
    uint16_t mismatches = 0U;
    uint8_t y;
    VBK_REG = bank;
    for (y = 0U; y < 18U; ++y) {
        uint8_t x;
        for (x = 0U; x < 20U; ++x) {
            if (tile_map[(uint16_t)y * 32U + x]
                != expected[(uint16_t)y * 20U + x]) {
                ++mismatches;
            }
        }
    }
    VBK_REG = VBK_BANK_0;
    return mismatches;
}

static uint16_t readBkgPaletteColor(uint8_t palette, uint8_t color) {
    const uint8_t index = (uint8_t)(palette * 8U + color * 2U);
    uint8_t low;
    uint8_t high;
    BCPS_REG = index;
    low = BCPD_REG;
    BCPS_REG = (uint8_t)(index + 1U);
    high = BCPD_REG;
    return (uint16_t)low | ((uint16_t)high << 8U);
}

static void dumpFrameToSram(uint8_t bank) {
    volatile uint8_t* destination;
    uint16_t offset = 0U;
    uint16_t screen_cell;
    DISPLAY_OFF;
    ENABLE_RAM_MBC5;
    SWITCH_RAM_MBC5(bank);
    destination = (volatile uint8_t*)0xa000U;
#define WRITE_FRAME_BYTE(value) destination[offset++] = (uint8_t)(value)
    WRITE_FRAME_BYTE(FRAME_DUMP_MAGIC);
    WRITE_FRAME_BYTE(FRAME_DUMP_MAGIC >> 8U);
    WRITE_FRAME_BYTE(FRAME_DUMP_MAGIC >> 16U);
    WRITE_FRAME_BYTE(FRAME_DUMP_MAGIC >> 24U);
    WRITE_FRAME_BYTE(1U);
    WRITE_FRAME_BYTE(0U);
    WRITE_FRAME_BYTE(SCREEN_TILES);
    WRITE_FRAME_BYTE(SCREEN_TILES >> 8U);
    for (screen_cell = 0U; screen_cell < SCREEN_TILES; ++screen_cell) {
        WRITE_FRAME_BYTE(gTileMap[screen_cell]);
    }
    for (screen_cell = 0U; screen_cell < SCREEN_TILES; ++screen_cell) {
        WRITE_FRAME_BYTE(gAttributes[screen_cell]);
    }
    for (screen_cell = 0U; screen_cell < SCREEN_TILES; ++screen_cell) {
        const uint8_t tile = gTileMap[screen_cell];
        volatile const uint8_t* source;
        uint8_t byte;
        VBK_REG = (gAttributes[screen_cell] & 0x08U) != 0U
            ? VBK_BANK_1 : VBK_BANK_0;
        source = (volatile const uint8_t*)(
            (tile < 128U ? 0x9000U : 0x8000U)
            + (uint16_t)tile * 16U);
        for (byte = 0U; byte < 16U; ++byte) {
            WRITE_FRAME_BYTE(source[byte]);
        }
    }
    for (screen_cell = 0U; screen_cell < 32U; ++screen_cell) {
        const uint16_t color =
            readBkgPaletteColor(
                (uint8_t)(screen_cell >> 2U),
                (uint8_t)(screen_cell & 3U));
        WRITE_FRAME_BYTE(color);
        WRITE_FRAME_BYTE(color >> 8U);
    }
#undef WRITE_FRAME_BYTE
    DISABLE_RAM_MBC5;
    VBK_REG = VBK_BANK_0;
    DISPLAY_ON;
}

static uint16_t countPaletteMismatches(
    const uint16_t* expected,
    uint8_t first_palette,
    uint8_t palette_count
) {
    uint16_t mismatches = 0U;
    uint8_t palette;
    for (palette = 0U; palette < palette_count; ++palette) {
        uint8_t color;
        for (color = 0U; color < 4U; ++color) {
            if (readBkgPaletteColor(
                    (uint8_t)(first_palette + palette),
                    color)
                != expected[(uint16_t)palette * 4U + color]) {
                ++mismatches;
            }
        }
    }
    return mismatches;
}
#endif

void runAutotest(void) BANKED {
    int16_t initial_x = -1;
    int16_t initial_y = -1;
    int16_t final_x = -1;
    int16_t final_y = -1;
    ps_step_result result;
#if defined(PS_GBC_PERF_BENCH)
    {
        uint16_t iteration;
        uint32_t timer_ticks;
        uint32_t render_ticks;
        uint32_t composition_ticks;
        uint32_t tile_upload_ticks;
        uint32_t map_upload_ticks;
        uint32_t palette_upload_ticks;
        uint32_t repeated_text_ticks;
        perf_interaction interaction;
        uint8_t phase;
        if (!perfLoadFirstBoard()) {
            showText("BENCHMARK ERROR", false);
            for (;;) vsync();
        }
        (void)ps_gbc_first_player_position(gSession, &initial_x, &initial_y);
        memset(gPerfPhaseTicks, 0, sizeof(gPerfPhaseTicks));
        gPerfPhaseEnabled = true;
        perfTimerInitialize();
        perfTimerStart();
        for (iteration = 0U; iteration < PERF_ITERATIONS; ++iteration) {
            result = ps_gbc_step(
                gSession,
                (iteration & 1U) == 0U ? PS_INPUT_RIGHT : PS_INPUT_LEFT);
        }
        timer_ticks = perfTimerStop();
        gPerfPhaseEnabled = false;
        (void)ps_gbc_first_player_position(gSession, &final_x, &final_y);
        render_ticks = perfMeasureRender();
        composition_ticks = perfMeasureComposition();
        tile_upload_ticks = perfMeasureTileUpload();
        map_upload_ticks = perfMeasureMapUpload();
        palette_upload_ticks = perfMeasurePaletteUpload();
        repeated_text_ticks = perfMeasureRepeatedText();
        perfMeasureInteraction(&interaction);
        perfTimerShutdown();
        ENABLE_RAM_MBC5;
        SWITCH_RAM_MBC5(3U);
        writeSram32(16U, 0U);
        writeSram16(20U, 1U);
        writeSram16(22U, PERF_ITERATIONS);
        writeSram32(24U, timer_ticks);
        writeSram8(28U, 0U);
        writeSram8(29U, 0U);
#if defined(PS_GBC_BENCH_WIDE_MOVEMENTS)
        writeSram8(30U, 4U);
#else
        writeSram8(30U, ps_gbc_generated_game.movement_bytes_per_cell);
#endif
        writeSram8(31U, result.changed ? 1U : 0U);
        writeSram32(32U, 0U);
        writeSram16(36U, 1U);
        writeSram16(38U, PERF_ITERATIONS);
        writeSram16(40U, PERF_RENDER_ITERATIONS);
        writeSram16(42U, PS_GBC_PERF_PHASE_COUNT);
        for (phase = 0U; phase < PS_GBC_PERF_PHASE_COUNT; ++phase) {
            writeSram32(
                (uint16_t)(44U + (uint16_t)phase * 4U),
                gPerfPhaseTicks[phase]);
        }
        writeSram32(72U, render_ticks);
        writeSram32(76U, composition_ticks);
        writeSram32(80U, tile_upload_ticks);
        writeSram32(84U, map_upload_ticks);
        writeSram32(88U, palette_upload_ticks);
        writeSram32(92U, repeated_text_ticks);
        writeSram32(100U, interaction.initial_render_ticks);
        writeSram32(104U, interaction.walk_logic_ticks);
        writeSram32(108U, interaction.walk_render_ticks);
        writeSram32(112U, interaction.push_logic_ticks);
        writeSram32(116U, interaction.push_render_ticks);
        writeSram32(96U, PERF_INTERACTION_MAGIC);
        writeSram32(32U, PERF_PHASE_MAGIC);
        writeSram32(16U, PERF_MAGIC);
        DISABLE_RAM_MBC5;
    }
#elif defined(PS_GBC_AUTOTEST_LOGIC_ONLY)
    {
        uint16_t first_board;
        for (first_board = 0U;
             first_board < ps_gbc_generated_game.level_count;
             ++first_board) {
            if (ps_gbc_generated_game.levels[first_board].kind
                == PS_GBC_LEVEL_BOARD) {
                (void)ps_gbc_load_level(gSession, first_board);
                break;
            }
        }
        (void)ps_gbc_first_player_position(gSession, &initial_x, &initial_y);
        result = ps_gbc_step(gSession, PS_INPUT_RIGHT);
        audioPlayEvents(&result);
        (void)ps_gbc_first_player_position(gSession, &final_x, &final_y);
    }
#else
    uint16_t title_map_nonzero;
    uint16_t title_tile_nonzero;
    uint16_t title_palette_mismatches;
    uint16_t title_background;
    uint16_t title_foreground;
    uint16_t title_map_mismatches;
    uint16_t board_tile_nonzero;
    uint16_t board_attributes_nonzero;
    uint16_t board_map_mismatches;
    uint16_t board_attribute_mismatches;
    uint16_t board_palette_mismatches;
    uint16_t incremental_blank_count;
    uint16_t incremental_lcd_on;
    uint16_t cell_width;
    uint16_t cell_height;
    uint16_t board_pixel_width;
    uint16_t board_pixel_height;
    uint16_t tile_upload_mismatches;
    uint16_t first_board;
    ps_gbc_status render_status;
    for (first_board = 0U;
         first_board < ps_gbc_generated_game.level_count;
         ++first_board) {
        if (ps_gbc_generated_game.levels[first_board].kind
            == PS_GBC_LEVEL_BOARD) {
            (void)ps_gbc_load_level(gSession, first_board);
            break;
        }
    }
    (void)ps_gbc_first_player_position(gSession, &initial_x, &initial_y);
    showText(ps_gbc_generated_game.title, true);
    DISPLAY_OFF;
    title_map_nonzero = countNonzero(gTileMap, sizeof(gTileMap));
    title_tile_nonzero =
        countVramNonzero(VBK_BANK_0, TEXT_TILE_COUNT * 16U);
    title_palette_mismatches =
        countPaletteMismatches(ps_gbc_generated_game.ui_palette, 0U, 1U);
    title_background = readBkgPaletteColor(0U, 0U);
    title_foreground = readBkgPaletteColor(0U, 3U);
    title_map_mismatches =
        countHardwareMapMismatches(gTileMap, VBK_BANK_0);
    DISPLAY_ON;
    dumpFrameToSram(0U);
    renderBoard();
    DISPLAY_OFF;
    board_tile_nonzero =
        (uint16_t)(countVramNonzero(VBK_BANK_0, 256U * 16U)
            + countVramNonzero(
                VBK_BANK_1,
                (PS_GBC_BOARD_TILE_LIMIT - 256U) * 16U));
    board_attributes_nonzero = countNonzero(gAttributes, sizeof(gAttributes));
    board_map_mismatches =
        countHardwareMapMismatches(gTileMap, VBK_BANK_0);
    board_attribute_mismatches =
        countHardwareMapMismatches(gAttributes, VBK_BANK_1);
    board_palette_mismatches =
        countPaletteMismatches(
            ps_gbc_generated_game.background_palettes,
            0U,
            8U);
    DISPLAY_ON;
    result = ps_gbc_step(gSession, PS_INPUT_RIGHT);
    audioPlayEvents(&result);
    (void)ps_gbc_first_player_position(gSession, &final_x, &final_y);
    incremental_blank_count = gDisplayBlankCount;
    renderBoard();
    incremental_blank_count =
        (uint16_t)(gDisplayBlankCount - incremental_blank_count);
    incremental_lcd_on = (LCDC_REG & LCDCF_ON) != 0U ? 1U : 0U;
    dumpFrameToSram(2U);
    ps_gbc_status_get(gSession, &render_status);
    cell_width = PS_GBC_RENDERED_CELL_WIDTH;
    cell_height = PS_GBC_RENDERED_CELL_HEIGHT;
    board_pixel_width = (uint16_t)(render_status.width * cell_width);
    board_pixel_height = (uint16_t)(render_status.height * cell_height);
    tile_upload_mismatches = gTileUploadMismatches;
    showText("VERTEX DISPENSER / [OK]?", false);
    dumpFrameToSram(1U);
#endif
    ENABLE_RAM_MBC5;
    SWITCH_RAM_MBC5(3U);
    writeSram32(0U, 0U);
    writeSram16(4U, 1U);
    writeSram8(6U, (uint8_t)initial_x);
    writeSram8(7U, (uint8_t)initial_y);
    writeSram8(8U, (uint8_t)final_x);
    writeSram8(9U, (uint8_t)final_y);
    writeSram8(10U, result.changed ? 1U : 0U);
    writeSram8(11U, result.won ? 1U : 0U);
    writeSram32(12U, ps_gbc_generated_game.source_hash);
#if !defined(PS_GBC_PERF_BENCH) \
    && !defined(PS_GBC_AUTOTEST_LOGIC_ONLY)
    writeSram32(16U, 0U);
    writeSram16(20U, 1U);
    writeSram16(22U, title_map_nonzero);
    writeSram16(24U, title_tile_nonzero);
    writeSram16(26U, title_palette_mismatches);
    writeSram16(28U, title_background);
    writeSram16(30U, title_foreground);
    writeSram16(32U, title_map_mismatches);
    writeSram16(34U, board_tile_nonzero);
    writeSram16(36U, board_attributes_nonzero);
    writeSram16(38U, board_map_mismatches);
    writeSram16(40U, board_attribute_mismatches);
    writeSram16(42U, board_palette_mismatches);
    writeSram16(44U, incremental_blank_count);
    writeSram16(46U, incremental_lcd_on);
    writeSram16(48U, cell_width);
    writeSram16(50U, cell_height);
    writeSram16(52U, board_pixel_width);
    writeSram16(54U, board_pixel_height);
    writeSram16(56U, tile_upload_mismatches);
    writeSram32(16U, RENDER_AUTOTEST_MAGIC);
#endif
    writeSram32(AUDIO_AUTOTEST_OFFSET, 0U);
    writeSram16((uint16_t)(AUDIO_AUTOTEST_OFFSET + 4U), 1U);
    writeSram8(
        (uint16_t)(AUDIO_AUTOTEST_OFFSET + 6U),
        (uint8_t)result.audio_event_count);
    writeSram8(
        (uint16_t)(AUDIO_AUTOTEST_OFFSET + 7U),
        (uint8_t)result.ui_audio_event_count);
    writeSram16(
        (uint16_t)(AUDIO_AUTOTEST_OFFSET + 8U),
        gAudioPlayCount);
    writeSram32(
        (uint16_t)(AUDIO_AUTOTEST_OFFSET + 10U),
        (uint32_t)gAudioLastSeed);
    writeSram8((uint16_t)(AUDIO_AUTOTEST_OFFSET + 14U), NR52_REG);
    writeSram8((uint16_t)(AUDIO_AUTOTEST_OFFSET + 15U), NR50_REG);
    writeSram8((uint16_t)(AUDIO_AUTOTEST_OFFSET + 16U), NR51_REG);
    writeSram8((uint16_t)(AUDIO_AUTOTEST_OFFSET + 17U), NR12_REG);
    writeSram8((uint16_t)(AUDIO_AUTOTEST_OFFSET + 18U), NR22_REG);
    writeSram8((uint16_t)(AUDIO_AUTOTEST_OFFSET + 19U), NR42_REG);
    writeSram8((uint16_t)(AUDIO_AUTOTEST_OFFSET + 20U), NR43_REG);
    writeSram32(AUDIO_AUTOTEST_OFFSET, AUDIO_AUTOTEST_MAGIC);
    writeSram32(0U, AUTOTEST_MAGIC);
    DISABLE_RAM_MBC5;
    for (;;) vsync();
}
