#include <gb/cgb.h>
#include <gb/gb.h>

#include "generated_game.h"
#include "puzzlescript/gbc.h"
#include "tile_cache.h"
#if defined(PS_GBC_PERF_BENCH)
#include "benchmark.h"
#endif

#include <string.h>

#define SCREEN_TILES (PS_GBC_VIEWPORT_WIDTH * PS_GBC_VIEWPORT_HEIGHT)
#define SNAPSHOT_RAM_BANK 1U
#define SAVE_MAGIC 0x43424750UL
#define SAVE_VERSION 1U
#define AUTOTEST_MAGIC 0x54434250UL
#define RENDER_AUTOTEST_MAGIC 0x52434250UL
#define PERF_MAGIC 0x46434250UL
#define PERF_PHASE_MAGIC 0x32434250UL
#define PERF_INTERACTION_MAGIC 0x49434250UL
#define PERF_ITERATIONS 128U
#define PERF_RENDER_ITERATIONS 4U
#define NO_RENDERED_LEVEL 0xffffU
#define VRAM_STATE_UNKNOWN 0U
#define VRAM_STATE_TEXT 1U
#define VRAM_STATE_BOARD 2U

#if defined(PS_GBC_PERF_BENCH)
/*
 * Keep the arena allocation identical between compact and forced-wide
 * benchmark ROMs. The extra space is the worst-case 1-byte to 4-byte movement
 * expansion for a full 20x18 board.
 */
static uint8_t gSessionArena[
    PS_GBC_GENERATED_SESSION_BYTES + PS_GBC_MAX_BOARD_CELLS * 3U
];
#else
static uint8_t gSessionArena[PS_GBC_GENERATED_SESSION_BYTES];
#endif
uint8_t gTileBytes[16];
uint8_t gTileMap[SCREEN_TILES];
uint8_t gAttributes[SCREEN_TILES];
uint8_t gSourcePixels[64];
ps_gbc_session* gSession;
static bool gTitleScreen;
static uint16_t gRenderedLevel = NO_RENDERED_LEVEL;
static uint8_t gVramState = VRAM_STATE_UNKNOWN;
#if defined(PS_GBC_AUTOTEST)
static uint16_t gDisplayBlankCount;
#endif
#if defined(PS_GBC_PERF_BENCH)
static volatile uint16_t gPerfTimerOverflows;
static uint32_t gPerfPhaseStart[PS_GBC_PERF_PHASE_COUNT];
static uint32_t gPerfPhaseTicks[PS_GBC_PERF_PHASE_COUNT];
static bool gPerfPhaseEnabled;

static void perfTimerInterrupt(void) {
    ++gPerfTimerOverflows;
}

static uint32_t perfTimerTicks(void) {
    uint16_t overflows;
    uint8_t timer;
    disable_interrupts();
    overflows = gPerfTimerOverflows;
    timer = TIMA_REG;
    if ((IF_REG & TIM_IFLAG) != 0U) {
        ++overflows;
        timer = TIMA_REG;
    }
    enable_interrupts();
    return ((uint32_t)overflows << 8U) | timer;
}

static void perfTimerInitialize(void) {
    disable_interrupts();
    add_TIM(perfTimerInterrupt);
    set_interrupts(TIM_IFLAG);
    TMA_REG = 0U;
}

void perfTimerStart(void) {
    disable_interrupts();
    gPerfTimerOverflows = 0U;
    TIMA_REG = 0U;
    IF_REG &= (uint8_t)~TIM_IFLAG;
    TAC_REG = (uint8_t)(TACF_START | TACF_4KHZ);
    enable_interrupts();
}

uint32_t perfTimerStop(void) {
    uint32_t ticks;
    disable_interrupts();
    TAC_REG = TACF_STOP;
    ticks = ((uint32_t)gPerfTimerOverflows << 8U) | TIMA_REG;
    if ((IF_REG & TIM_IFLAG) != 0U) ticks += 256U;
    return ticks;
}

static void perfTimerShutdown(void) {
    disable_interrupts();
    TAC_REG = TACF_STOP;
    set_interrupts(0U);
}

void ps_gbc_perf_phase_begin(uint8_t phase) {
    if (gPerfPhaseEnabled && phase < PS_GBC_PERF_PHASE_COUNT) {
        gPerfPhaseStart[phase] = perfTimerTicks();
    }
}

void ps_gbc_perf_phase_end(uint8_t phase) {
    if (gPerfPhaseEnabled && phase < PS_GBC_PERF_PHASE_COUNT) {
        gPerfPhaseTicks[phase] += perfTimerTicks() - gPerfPhaseStart[phase];
    }
}
#endif

typedef struct SaveRecord {
    uint32_t magic;
    uint32_t source_hash;
    uint16_t version;
    uint16_t level;
    uint16_t checksum;
} SaveRecord;

static void displayOffForFullRewrite(void) {
#if defined(PS_GBC_AUTOTEST)
    ++gDisplayBlankCount;
#endif
    DISPLAY_OFF;
}

/*
 * Five-column, seven-row glyphs for A-Z, 0-9, '.', '-', ':', and '!'.
 * Each byte is one vertical column, least-significant bit at the top.
 */
static const uint8_t kGlyphs[40][5] = {
    {0x7e,0x11,0x11,0x11,0x7e}, {0x7f,0x49,0x49,0x49,0x36},
    {0x3e,0x41,0x41,0x41,0x22}, {0x7f,0x41,0x41,0x22,0x1c},
    {0x7f,0x49,0x49,0x49,0x41}, {0x7f,0x09,0x09,0x09,0x01},
    {0x3e,0x41,0x49,0x49,0x7a}, {0x7f,0x08,0x08,0x08,0x7f},
    {0x00,0x41,0x7f,0x41,0x00}, {0x20,0x40,0x41,0x3f,0x01},
    {0x7f,0x08,0x14,0x22,0x41}, {0x7f,0x40,0x40,0x40,0x40},
    {0x7f,0x02,0x0c,0x02,0x7f}, {0x7f,0x04,0x08,0x10,0x7f},
    {0x3e,0x41,0x41,0x41,0x3e}, {0x7f,0x09,0x09,0x09,0x06},
    {0x3e,0x41,0x51,0x21,0x5e}, {0x7f,0x09,0x19,0x29,0x46},
    {0x46,0x49,0x49,0x49,0x31}, {0x01,0x01,0x7f,0x01,0x01},
    {0x3f,0x40,0x40,0x40,0x3f}, {0x1f,0x20,0x40,0x20,0x1f},
    {0x3f,0x40,0x38,0x40,0x3f}, {0x63,0x14,0x08,0x14,0x63},
    {0x07,0x08,0x70,0x08,0x07}, {0x61,0x51,0x49,0x45,0x43},
    {0x3e,0x51,0x49,0x45,0x3e}, {0x00,0x42,0x7f,0x40,0x00},
    {0x62,0x51,0x49,0x49,0x46}, {0x22,0x41,0x49,0x49,0x36},
    {0x18,0x14,0x12,0x7f,0x10}, {0x2f,0x49,0x49,0x49,0x31},
    {0x3e,0x49,0x49,0x49,0x32}, {0x01,0x71,0x09,0x05,0x03},
    {0x36,0x49,0x49,0x49,0x36}, {0x26,0x49,0x49,0x49,0x3e},
    {0x00,0x60,0x60,0x00,0x00}, {0x08,0x08,0x08,0x08,0x08},
    {0x00,0x36,0x36,0x00,0x00}, {0x00,0x00,0x5f,0x00,0x00}
};

static uint16_t saveChecksum(const SaveRecord* save) {
    const uint8_t* bytes = (const uint8_t*)save;
    uint16_t hash = 0x811cU;
    uint8_t index;
    for (index = 0U; index < (uint8_t)(sizeof(SaveRecord) - sizeof(uint16_t)); ++index) {
        hash = (uint16_t)((hash ^ bytes[index]) * 257U);
    }
    return hash;
}

static bool snapshotRead(void* context, uint8_t slot, void* data, uint16_t byte_count) {
    volatile const uint8_t* source;
    uint8_t* destination = (uint8_t*)data;
    uint16_t offset = (uint16_t)((uint16_t)slot
        * ps_gbc_generated_game.max_level_cells
        * PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL);
    uint16_t index;
    (void)context;
    ENABLE_RAM_MBC5;
    SWITCH_RAM_MBC5(SNAPSHOT_RAM_BANK);
    source = (volatile const uint8_t*)(0xa000U + offset);
    for (index = 0U; index < byte_count; ++index) destination[index] = source[index];
    DISABLE_RAM_MBC5;
    return true;
}

static bool snapshotWrite(
    void* context,
    uint8_t slot,
    const void* data,
    uint16_t byte_count
) {
    volatile uint8_t* destination;
    const uint8_t* source = (const uint8_t*)data;
    uint16_t offset = (uint16_t)((uint16_t)slot
        * ps_gbc_generated_game.max_level_cells
        * PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL);
    uint16_t index;
    (void)context;
    ENABLE_RAM_MBC5;
    SWITCH_RAM_MBC5(SNAPSHOT_RAM_BANK);
    destination = (volatile uint8_t*)(0xa000U + offset);
    for (index = 0U; index < byte_count; ++index) destination[index] = source[index];
    DISABLE_RAM_MBC5;
    return true;
}

static bool readSave(uint16_t* level) {
    SaveRecord save;
    volatile const uint8_t* source;
    uint8_t* destination = (uint8_t*)&save;
    uint8_t index;
    ENABLE_RAM_MBC5;
    SWITCH_RAM_MBC5(0U);
    source = (volatile const uint8_t*)0xa000U;
    for (index = 0U; index < sizeof(save); ++index) destination[index] = source[index];
    DISABLE_RAM_MBC5;
    if (save.magic != SAVE_MAGIC || save.version != SAVE_VERSION
        || save.source_hash != ps_gbc_generated_game.source_hash
        || save.checksum != saveChecksum(&save)
        || save.level >= ps_gbc_generated_game.level_count) return false;
    *level = save.level;
    return true;
}

static void writeSave(uint16_t level) {
    SaveRecord save;
    volatile uint8_t* destination;
    const uint8_t* source = (const uint8_t*)&save;
    uint8_t index;
    save.magic = SAVE_MAGIC;
    save.source_hash = ps_gbc_generated_game.source_hash;
    save.version = SAVE_VERSION;
    save.level = level;
    save.checksum = saveChecksum(&save);
    ENABLE_RAM_MBC5;
    SWITCH_RAM_MBC5(0U);
    destination = (volatile uint8_t*)0xa000U;
    for (index = 0U; index < sizeof(save); ++index) destination[index] = source[index];
    DISABLE_RAM_MBC5;
}

static uint8_t glyphIndex(char ch) {
    if (ch >= 'a' && ch <= 'z') ch = (char)(ch - ('a' - 'A'));
    if (ch >= 'A' && ch <= 'Z') return (uint8_t)(1U + ch - 'A');
    if (ch >= '0' && ch <= '9') return (uint8_t)(27U + ch - '0');
    if (ch == '.') return 37U;
    if (ch == '-') return 38U;
    if (ch == ':') return 39U;
    if (ch == '!') return 40U;
    return 0U;
}

static void loadFont(void) {
    uint8_t glyph;
    uint8_t tile[16];
    uint8_t blank[16];
    memset(blank, 0, sizeof(blank));
    VBK_REG = VBK_BANK_0;
    set_bkg_data(0U, 1U, blank);
    for (glyph = 0U; glyph < 40U; ++glyph) {
        uint8_t row;
        for (row = 0U; row < 8U; ++row) {
            uint8_t bits = 0U;
            uint8_t column;
            if (row < 7U) {
                for (column = 0U; column < 5U; ++column) {
                    if ((kGlyphs[glyph][column] & (uint8_t)(1U << row)) != 0U) {
                        bits |= (uint8_t)(1U << (6U - column));
                    }
                }
            }
            tile[row * 2U] = bits;
            tile[row * 2U + 1U] = bits;
        }
        set_bkg_data((uint8_t)(glyph + 1U), 1U, tile);
    }
}

static void clearTextMap(void) {
    memset(gTileMap, 0, sizeof(gTileMap));
    memset(gAttributes, 0, sizeof(gAttributes));
}

static void drawTextLine(const char* text, uint8_t row) {
    uint8_t length = 0U;
    uint8_t column;
    while (text[length] != '\0' && text[length] != '\n' && length < 20U) ++length;
    column = (uint8_t)((20U - length) / 2U);
    while (*text != '\0' && *text != '\n' && column < 20U) {
        gTileMap[(uint16_t)row * 20U + column] = glyphIndex(*text);
        ++text;
        ++column;
    }
}

void showText(const char* message, bool title) {
    uint8_t row = title ? 5U : 2U;
    const char* cursor = message;
    gRenderedLevel = NO_RENDERED_LEVEL;
    displayOffForFullRewrite();
    if (gVramState != VRAM_STATE_TEXT) {
        set_bkg_palette(0U, 1U, ps_gbc_generated_game.ui_palette);
        loadFont();
    }
    clearTextMap();
    if (title) {
        drawTextLine(message, row);
        drawTextLine("PRESS A", (uint8_t)(row + 4U));
    } else {
        while (*cursor != '\0' && row < 16U) {
            char line[21];
            uint8_t length = 0U;
            while (*cursor == ' ' || *cursor == '\n') ++cursor;
            while (*cursor != '\0' && *cursor != '\n' && length < 20U) {
                line[length++] = *cursor++;
            }
            line[length] = '\0';
            drawTextLine(line, row++);
        }
        drawTextLine("PRESS A", 17U);
    }
    VBK_REG = VBK_BANK_0;
    set_bkg_tiles(0U, 0U, 20U, 18U, gTileMap);
    VBK_REG = VBK_BANK_1;
    set_bkg_tiles(0U, 0U, 20U, 18U, gAttributes);
    VBK_REG = VBK_BANK_0;
    gVramState = VRAM_STATE_TEXT;
    DISPLAY_ON;
}

uint8_t composeTile(uint32_t objects) {
    uint8_t layer;
    uint8_t target_palette = 0U;
    memset(gSourcePixels, 0, sizeof(gSourcePixels));
    for (layer = 0U; layer < ps_gbc_generated_game.layer_count; ++layer) {
        uint8_t object_id;
        for (object_id = 0U; object_id < ps_gbc_generated_game.object_count; ++object_id) {
            const ps_gbc_object* object;
            uint8_t pixel;
            bool drew = false;
            if ((objects & ((uint32_t)1U << object_id)) == 0U) continue;
            object = &ps_gbc_generated_game.objects[object_id];
            if (object->layer != layer) continue;
            for (pixel = 0U; pixel < 64U; ++pixel) {
                const uint8_t source = object->sprite_pixels[pixel];
                if (source == 0xffU) continue;
                gSourcePixels[pixel] = source;
                drew = true;
            }
            if (drew) target_palette = object->palette;
        }
    }
    {
        uint8_t y;
        for (y = 0U; y < 8U; ++y) {
            uint8_t low = 0U;
            uint8_t high = 0U;
            uint8_t x;
            for (x = 0U; x < 8U; ++x) {
                const uint8_t color = ps_gbc_generated_game.palette_remap[
                    (uint16_t)target_palette * 32U + gSourcePixels[(uint8_t)(y * 8U + x)]];
                low |= (uint8_t)((color & 1U) << (7U - x));
                high |= (uint8_t)(((color >> 1U) & 1U) << (7U - x));
            }
            gTileBytes[y * 2U] = low;
            gTileBytes[y * 2U + 1U] = high;
        }
    }
    return target_palette;
}

#if PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL == 1U
#define BOARD_OBJECTS(board, cell) (((const uint8_t*)(board))[(cell)])
#elif PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL == 2U
#define BOARD_OBJECTS(board, cell) (((const uint16_t*)(board))[(cell)])
#else
#define BOARD_OBJECTS(board, cell) (((const uint32_t*)(board))[(cell)])
#endif

void renderBoard(void) {
    ps_gbc_status status;
    const void* board;
    const uint8_t* dirty;
    uint16_t cells;
    uint8_t offset_x;
    uint8_t offset_y;
    bool full_render;
    ps_gbc_status_get(gSession, &status);
    if (status.mode != PS_FULL_STATE_MODE_LEVEL) {
        showText(status.message == NULL ? "" : status.message, false);
        return;
    }
    board = ps_gbc_board(gSession);
    dirty = ps_gbc_dirty_cells(gSession);
    cells = (uint16_t)(status.width * status.height);
    offset_x = (uint8_t)((20U - status.width) / 2U);
    offset_y = (uint8_t)((18U - status.height) / 2U);
    full_render = gRenderedLevel != status.current_level;
    if (full_render) displayOffForFullRewrite();
    if (gVramState != VRAM_STATE_BOARD) {
        set_bkg_palette(0U, 8U, ps_gbc_generated_game.background_palettes);
    }
    if (full_render) {
        ps_gbc_render_full_board(
            board, status.width, status.height, offset_x, offset_y);
    } else {
        uint16_t board_cell = 0U;
        uint16_t board_x;
        for (board_x = 0U; board_x < status.width; ++board_x) {
            uint16_t board_y;
            for (board_y = 0U; board_y < status.height; ++board_y, ++board_cell) {
                uint16_t screen_cell;
                uint8_t previous_tile;
                uint8_t previous_attributes;
                uint8_t screen_x;
                uint8_t screen_y;
                if ((dirty[board_cell >> 3U]
                        & (uint8_t)(1U << (board_cell & 7U))) == 0U) continue;
                screen_x = (uint8_t)(board_x + offset_x);
                screen_y = (uint8_t)(board_y + offset_y);
                screen_cell = (uint16_t)screen_y * 20U + screen_x;
                previous_tile = gTileMap[screen_cell];
                previous_attributes = gAttributes[screen_cell];
                if (!ps_gbc_reuse_matching_tile(
                        board,
                        dirty,
                        cells,
                        board_cell,
                        screen_cell,
                        status.height,
                        offset_x,
                        offset_y)) {
                    ps_gbc_render_cell(
                        screen_cell,
                        ps_gbc_find_free_tile(screen_cell),
                        BOARD_OBJECTS(board, board_cell));
                }
                if (gTileMap[screen_cell] != previous_tile) {
                    VBK_REG = VBK_BANK_0;
                    set_bkg_tile_xy(screen_x, screen_y, gTileMap[screen_cell]);
                }
                if (gAttributes[screen_cell] != previous_attributes) {
                    VBK_REG = VBK_BANK_1;
                    set_bkg_tile_xy(screen_x, screen_y, gAttributes[screen_cell]);
                }
            }
        }
    }
    if (full_render) {
        VBK_REG = VBK_BANK_0;
        set_bkg_tiles(0U, 0U, 20U, 18U, gTileMap);
        VBK_REG = VBK_BANK_1;
        set_bkg_tiles(0U, 0U, 20U, 18U, gAttributes);
    }
    VBK_REG = VBK_BANK_0;
    ps_gbc_clear_dirty_cells(gSession);
    gRenderedLevel = status.current_level;
    gVramState = VRAM_STATE_BOARD;
    if (full_render) DISPLAY_ON;
}

static void saveCurrentLevel(void) {
    ps_gbc_status status;
    ps_gbc_status_get(gSession, &status);
    writeSave(status.current_level);
}

#if defined(PS_GBC_AUTOTEST)
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

#if !defined(PS_GBC_PERF_BENCH)
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

static uint16_t countHardwareMapMismatches(const uint8_t* expected, uint8_t bank) {
    volatile const uint8_t* tile_map =
        (volatile const uint8_t*)((LCDC_REG & LCDCF_BG9C00) != 0U ? 0x9c00U : 0x9800U);
    uint16_t mismatches = 0U;
    uint8_t y;
    VBK_REG = bank;
    for (y = 0U; y < 18U; ++y) {
        uint8_t x;
        for (x = 0U; x < 20U; ++x) {
            if (tile_map[(uint16_t)y * 32U + x] != expected[(uint16_t)y * 20U + x]) {
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

static uint16_t countPaletteMismatches(
    const uint16_t* expected,
    uint8_t first_palette,
    uint8_t palette_count) {
    uint16_t mismatches = 0U;
    uint8_t palette;
    for (palette = 0U; palette < palette_count; ++palette) {
        uint8_t color;
        for (color = 0U; color < 4U; ++color) {
            if (readBkgPaletteColor((uint8_t)(first_palette + palette), color)
                != expected[(uint16_t)palette * 4U + color]) {
                ++mismatches;
            }
        }
    }
    return mismatches;
}
#endif

static void runAutotest(void) {
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
    (void)ps_gbc_first_player_position(gSession, &initial_x, &initial_y);
    showText(ps_gbc_generated_game.title, true);
    DISPLAY_OFF;
    title_map_nonzero = countNonzero(gTileMap, sizeof(gTileMap));
    title_tile_nonzero = countVramNonzero(VBK_BANK_0, 41U * 16U);
    title_palette_mismatches =
        countPaletteMismatches(ps_gbc_generated_game.ui_palette, 0U, 1U);
    title_background = readBkgPaletteColor(0U, 0U);
    title_foreground = readBkgPaletteColor(0U, 3U);
    title_map_mismatches = countHardwareMapMismatches(gTileMap, VBK_BANK_0);
    DISPLAY_ON;
    renderBoard();
    DISPLAY_OFF;
    board_tile_nonzero =
        (uint16_t)(countVramNonzero(VBK_BANK_0, 256U * 16U)
            + countVramNonzero(VBK_BANK_1, (SCREEN_TILES - 256U) * 16U));
    board_attributes_nonzero = countNonzero(gAttributes, sizeof(gAttributes));
    board_map_mismatches = countHardwareMapMismatches(gTileMap, VBK_BANK_0);
    board_attribute_mismatches =
        countHardwareMapMismatches(gAttributes, VBK_BANK_1);
    board_palette_mismatches =
        countPaletteMismatches(ps_gbc_generated_game.background_palettes, 0U, 8U);
    DISPLAY_ON;
    result = ps_gbc_step(gSession, PS_INPUT_RIGHT);
    (void)ps_gbc_first_player_position(gSession, &final_x, &final_y);
    incremental_blank_count = gDisplayBlankCount;
    renderBoard();
    incremental_blank_count =
        (uint16_t)(gDisplayBlankCount - incremental_blank_count);
    incremental_lcd_on = (LCDC_REG & LCDCF_ON) != 0U ? 1U : 0U;
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
#if !defined(PS_GBC_PERF_BENCH)
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
    writeSram32(16U, RENDER_AUTOTEST_MAGIC);
#endif
    writeSram32(0U, AUTOTEST_MAGIC);
    DISABLE_RAM_MBC5;
    for (;;) vsync();
}
#endif

void main(void) {
    const ps_gbc_snapshot_io snapshot_io = {NULL, snapshotRead, snapshotWrite};
    uint16_t saved_level = 0U;
    uint8_t previous_keys = 0U;
    SWITCH_ROM_MBC5(PS_GBC_GENERATED_ROM_BANK);
    if (_cpu == CGB_TYPE) cpu_fast();
    gSession = ps_gbc_session_init(
        gSessionArena,
        sizeof(gSessionArena),
        &ps_gbc_generated_game,
        &snapshot_io);
    if (gSession == NULL) {
        showText("MEMORY ERROR", false);
        for (;;) vsync();
    }
    if (readSave(&saved_level)) (void)ps_gbc_load_level(gSession, saved_level);
    SHOW_BKG;
#if defined(PS_GBC_AUTOTEST)
    runAutotest();
#endif
    gTitleScreen = true;
    showText(ps_gbc_generated_game.title, true);
    for (;;) {
        const uint8_t keys = joypad();
        const uint8_t pressed = (uint8_t)(keys & (uint8_t)~previous_keys);
        ps_gbc_status status;
        bool redraw = false;
        SWITCH_ROM_MBC5(PS_GBC_GENERATED_ROM_BANK);
        ps_gbc_status_get(gSession, &status);
        if (gTitleScreen) {
            if ((pressed & (J_A | J_START)) != 0U) {
                gTitleScreen = false;
                renderBoard();
            }
        } else if (status.completed) {
            showText("COMPLETE", false);
            gTitleScreen = true;
        } else if ((pressed & J_START) != 0U) {
            gTitleScreen = true;
            showText(ps_gbc_generated_game.title, true);
        } else if (status.mode == PS_FULL_STATE_MODE_MESSAGE) {
            if ((pressed & J_A) != 0U) {
                const ps_step_result result = ps_gbc_step(gSession, PS_INPUT_ACTION);
                if (result.transitioned) saveCurrentLevel();
                redraw = true;
            }
        } else if ((pressed & J_B) != 0U) {
            redraw = ps_gbc_undo(gSession);
        } else if ((pressed & J_SELECT) != 0U) {
            redraw = ps_gbc_restart(gSession);
        } else {
            ps_input input = PS_INPUT_TICK;
            bool has_input = status.pending_again;
            if ((pressed & J_UP) != 0U) { input = PS_INPUT_UP; has_input = true; }
            else if ((pressed & J_LEFT) != 0U) { input = PS_INPUT_LEFT; has_input = true; }
            else if ((pressed & J_DOWN) != 0U) { input = PS_INPUT_DOWN; has_input = true; }
            else if ((pressed & J_RIGHT) != 0U) { input = PS_INPUT_RIGHT; has_input = true; }
            else if ((pressed & J_A) != 0U) { input = PS_INPUT_ACTION; has_input = true; }
            if (has_input) {
                const ps_step_result result = ps_gbc_step(gSession, input);
                if (result.transitioned || result.won) saveCurrentLevel();
                redraw = result.changed || result.transitioned || result.won;
            }
        }
        if (redraw && !gTitleScreen) renderBoard();
        previous_keys = keys;
        vsync();
    }
}
