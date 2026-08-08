#pragma bank 1

#include <gb/cgb.h>
#include <gb/gb.h>

#include "cart_launcher.h"
#include "game_dispatch.h"
#include "puzzlescript/gbc.h"
#include "text.h"
#if defined(PS_GBC_CART_BUILD)
#include "generated_cart.h"
#endif

#include <string.h>

#define SCREEN_TILES \
    (PS_GBC_SCREEN_TILE_WIDTH * PS_GBC_SCREEN_TILE_HEIGHT)
#define NO_RENDERED_LEVEL 0xffffU
#define TEXT_WIDTH 16U
#define FRAME_HORIZONTAL_TILE 38U
#define FRAME_VERTICAL_TILE 39U

extern uint8_t gTileMap[SCREEN_TILES];
extern uint8_t gAttributes[SCREEN_TILES];

static char gTextBuffer[256];
static uint16_t gUiPalette[4];

/*
 * Five-column, seven-row glyphs for A-Z, 0-9, and common punctuation.
 * Each byte is one vertical column, least-significant bit at the top.
 */
static const uint8_t kGlyphs[TEXT_TILE_COUNT - 1U][5] = {
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
    {0x00,0x36,0x36,0x00,0x00}, {0x00,0x00,0x5f,0x00,0x00},
    {0x02,0x01,0x51,0x09,0x06}, {0x00,0x40,0x20,0x00,0x00},
    {0x00,0x04,0x03,0x00,0x00}, {0x40,0x20,0x10,0x0c,0x03},
    {0x7f,0x41,0x41,0x00,0x00}, {0x00,0x00,0x41,0x41,0x7f}
};

static uint8_t glyphIndex(char ch) {
    if (ch >= 'a' && ch <= 'z') ch = (char)(ch - ('a' - 'A'));
    if (ch >= 'A' && ch <= 'Z') return (uint8_t)(1U + ch - 'A');
    if (ch >= '0' && ch <= '9') return (uint8_t)(27U + ch - '0');
    if (ch == '.') return 37U;
    if (ch == '-') return 38U;
    if (ch == ':') return 39U;
    if (ch == '!') return 40U;
    if (ch == '?') return 41U;
    if (ch == ',') return 42U;
    if (ch == '\'') return 43U;
    if (ch == '/') return 44U;
    if (ch == '[') return 45U;
    if (ch == ']') return 46U;
    return 0U;
}

static void loadFont(void) {
    uint8_t glyph;
    uint8_t tile[16];
    uint8_t blank[16];
    memset(blank, 0, sizeof(blank));
    VBK_REG = VBK_BANK_0;
    set_bkg_data(0U, 1U, blank);
    for (glyph = 0U; glyph < TEXT_TILE_COUNT - 1U; ++glyph) {
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

static void drawTextLine(const char* text, uint8_t row, uint8_t length) {
    uint8_t column = (uint8_t)((20U - length) / 2U);
    while (length-- != 0U) {
        gTileMap[(uint16_t)row * 20U + column] = glyphIndex(*text++);
        ++column;
    }
}

#if defined(PS_GBC_CART_BUILD)
#define LAUNCHER_SAVE_MAGIC 0x43424750UL
#define LAUNCHER_SAVE_VERSION 1U
#define LAUNCHER_BAND_TILES 40U
#define LAUNCHER_BAND_BYTES (LAUNCHER_BAND_TILES * 16U)

typedef struct LauncherSaveRecord {
    uint32_t magic;
    uint32_t source_hash;
    uint16_t version;
    uint16_t level;
    uint16_t checksum;
} LauncherSaveRecord;

typedef struct LauncherCachedGame {
    uint8_t launcher_art_bank;
    uint8_t launcher_selected_art_bank;
    const uint8_t* header_band;
    const uint8_t* card_band;
    const uint8_t* selected_card_band;
    uint16_t palette[4];
    bool valid;
} LauncherCachedGame;

static ps_gbc_launcher_card gLauncherCard;
static uint8_t gLauncherBandStorage[LAUNCHER_BAND_BYTES + 15U];
#define gLauncherBand \
    ((uint8_t*)(((uint16_t)gLauncherBandStorage + 15U) & 0xfff0U))
static uint8_t gLauncherBlankBandStorage[LAUNCHER_BAND_BYTES + 15U];
#define gLauncherBlankBand \
    ((uint8_t*)(((uint16_t)gLauncherBlankBandStorage + 15U) & 0xfff0U))
static char gLauncherProgress[8];
static char gLauncherCounter[8];
static uint16_t gLauncherHeaderPalette[4];
static bool gLauncherPageUseHBlank;
static bool gLauncherPageHBlankStarted;
static uint8_t gLauncherLastPageVBlankBlocks;
static uint8_t gLauncherMaxPageVBlankBlocks;
static uint8_t gLauncherLastPageStartLy;
static uint8_t gLauncherLastPageEndLy;
static LauncherCachedGame
    gLauncherCache[PS_GBC_CART_GAME_COUNT];
static const uint16_t kLauncherRowOffsets[16] = {
    0U, 2U, 4U, 6U, 8U, 10U, 12U, 14U,
    320U, 322U, 324U, 326U, 328U, 330U, 332U, 334U
};
static const uint8_t kLauncherPixelMasks[8] = {
    0x80U, 0x40U, 0x20U, 0x10U, 0x08U, 0x04U, 0x02U, 0x01U
};

static uint16_t launcherSaveChecksum(const LauncherSaveRecord* save) {
    const uint8_t* bytes = (const uint8_t*)save;
    uint16_t hash = 0x811cU;
    uint8_t index;
    for (index = 0U;
         index < (uint8_t)(
             sizeof(LauncherSaveRecord) - sizeof(uint16_t));
         ++index) {
        hash = (uint16_t)((hash ^ bytes[index]) * 257U);
    }
    return hash;
}

static bool readLauncherProgress(
    uint8_t game_index,
    uint32_t source_hash,
    uint8_t level_count,
    bool* completed,
    uint8_t* level
) {
    LauncherSaveRecord save;
    volatile const uint8_t* source;
    uint8_t* destination = (uint8_t*)&save;
    uint8_t index;
    ENABLE_RAM_MBC5;
    SWITCH_RAM_MBC5(0U);
    source = (volatile const uint8_t*)(
        0xa000U
        + (uint16_t)game_index * (uint16_t)sizeof(LauncherSaveRecord));
    for (index = 0U; index < sizeof(save); ++index) {
        destination[index] = source[index];
    }
    DISABLE_RAM_MBC5;
    if (save.magic != LAUNCHER_SAVE_MAGIC
        || save.version != LAUNCHER_SAVE_VERSION
        || save.source_hash != source_hash
        || save.checksum != launcherSaveChecksum(&save)) {
        return false;
    }
    return ps_gbc_cart_launcher_decode_progress(
        save.level,
        level_count,
        completed,
        level);
}

static uint8_t launcherStringLength(const char* text) {
    uint8_t length = 0U;
    while (length < 31U && text[length] != '\0') ++length;
    return length;
}

static void setLauncherBandPixel(
    uint8_t x,
    uint8_t y,
    uint8_t color
) {
    const uint16_t offset =
        kLauncherRowOffsets[y] + ((uint16_t)(x >> 3U) << 4U);
    const uint8_t mask = kLauncherPixelMasks[x & 7U];
    gLauncherBand[offset] &= (uint8_t)~mask;
    gLauncherBand[offset + 1U] &= (uint8_t)~mask;
    if ((color & 1U) != 0U) gLauncherBand[offset] |= mask;
    if ((color & 2U) != 0U) gLauncherBand[offset + 1U] |= mask;
}

static void waitLauncherPageVBlank(void) {
    while (LY_REG < 144U) {
    }
}

static void recordLauncherPageVBlankBlocks(uint8_t blocks) {
    if ((uint8_t)(0xffU - gLauncherLastPageVBlankBlocks) < blocks) {
        gLauncherLastPageVBlankBlocks = 0xffU;
    } else {
        gLauncherLastPageVBlankBlocks =
            (uint8_t)(gLauncherLastPageVBlankBlocks + blocks);
    }
}

static bool beginLauncherPageHBlankSpan(void) {
    if (!gLauncherPageUseHBlank) return false;
    if (gLauncherPageHBlankStarted && LY_REG >= 144U) {
        gLauncherPageUseHBlank = false;
        return false;
    }
    gLauncherPageHBlankStarted = true;
    return true;
}

static void uploadLauncherBand(
    const uint8_t* band,
    uint8_t palette,
    uint8_t first_screen_row,
    bool update_map
) {
    const uint16_t first_screen_tile =
        (uint16_t)first_screen_row * 20U;
    ps_gbc_launcher_transfer_span spans[2];
    const bool unsigned_mode =
        (LCDC_REG & LCDCF_BG8000) != 0U;
    const uint8_t span_count =
        ps_gbc_cart_launcher_transfer_plan(
            first_screen_tile,
            unsigned_mode,
            spans);
    uint8_t span;
    uint8_t tile;
    for (span = 0U; span < span_count; ++span) {
        uint16_t source = (uint16_t)(
            band
            + (uint16_t)spans[span].source_tile * 16U);
        const uint16_t destination =
            ps_gbc_cart_launcher_tile_data_address(
                spans[span].tile,
                unsigned_mode);
        uint16_t target = destination;
        uint8_t remaining = spans[span].tile_count;
        while (remaining != 0U) {
            if (!update_map && beginLauncherPageHBlankSpan()) {
                const uint8_t blocks =
                    ps_gbc_wram_vram_dma_hblank(
                        (const void*)source,
                        target,
                        remaining,
                        spans[span].vram_bank);
                const uint16_t bytes = (uint16_t)blocks << 4U;
                source += bytes;
                target += bytes;
                remaining = (uint8_t)(remaining - blocks);
                if (remaining == 0U) continue;
                gLauncherPageUseHBlank = false;
            }
            if (!update_map) {
                waitLauncherPageVBlank();
                recordLauncherPageVBlankBlocks(remaining);
            }
            VBK_REG = spans[span].vram_bank;
            HDMA1_REG = (uint8_t)(source >> 8U);
            HDMA2_REG = (uint8_t)source & 0xf0U;
            HDMA3_REG = (uint8_t)(target >> 8U) & 0x1fU;
            HDMA4_REG = (uint8_t)target & 0xf0U;
            HDMA5_REG = (uint8_t)(remaining - 1U);
            remaining = 0U;
        }
    }
    VBK_REG = VBK_BANK_0;
    if (!update_map) return;
    for (tile = 0U; tile < LAUNCHER_BAND_TILES; ++tile) {
        const uint16_t screen_tile = first_screen_tile + tile;
        const bool second_bank = screen_tile >= 256U;
        gTileMap[screen_tile] = second_bank
            ? (uint8_t)(screen_tile - 256U)
            : (uint8_t)screen_tile;
        gAttributes[screen_tile] =
            (uint8_t)(palette | (second_bank ? S_BANK : 0U));
    }
}

static bool uploadLauncherRomBand(
    uint8_t source_bank,
    const uint8_t* source,
    uint8_t palette,
    uint8_t first_screen_row,
    bool update_map
) {
    const uint16_t first_screen_tile =
        (uint16_t)first_screen_row * 20U;
    ps_gbc_launcher_transfer_span spans[2];
    const bool unsigned_mode =
        (LCDC_REG & LCDCF_BG8000) != 0U;
    const uint8_t span_count =
        ps_gbc_cart_launcher_transfer_plan(
            first_screen_tile,
            unsigned_mode,
            spans);
    uint8_t span;
    uint8_t tile;
    if (source == NULL) return false;
    for (span = 0U; span < span_count; ++span) {
        const uint16_t destination =
            ps_gbc_cart_launcher_tile_data_address(
                spans[span].tile,
                unsigned_mode);
        const uint8_t* span_source =
            source + (uint16_t)spans[span].source_tile * 16U;
        uint16_t target = destination;
        uint8_t remaining = spans[span].tile_count;
        while (remaining != 0U) {
            if (!update_map && beginLauncherPageHBlankSpan()) {
                const uint8_t blocks =
                    ps_gbc_rom_vram_dma_hblank(
                        source_bank,
                        span_source,
                        target,
                        remaining,
                        spans[span].vram_bank);
                const uint16_t bytes = (uint16_t)blocks << 4U;
                span_source += bytes;
                target += bytes;
                remaining = (uint8_t)(remaining - blocks);
                if (remaining == 0U) continue;
                gLauncherPageUseHBlank = false;
            }
            if (!update_map) {
                waitLauncherPageVBlank();
                recordLauncherPageVBlankBlocks(remaining);
            }
            if (!ps_gbc_rom_vram_dma(
                    source_bank,
                    span_source,
                    target,
                    remaining,
                    spans[span].vram_bank)) {
                return false;
            }
            remaining = 0U;
        }
    }
    VBK_REG = VBK_BANK_0;
    if (!update_map) return true;
    for (tile = 0U; tile < LAUNCHER_BAND_TILES; ++tile) {
        const uint16_t screen_tile = first_screen_tile + tile;
        const bool second_bank = screen_tile >= 256U;
        gTileMap[screen_tile] = second_bank
            ? (uint8_t)(screen_tile - 256U)
            : (uint8_t)screen_tile;
        gAttributes[screen_tile] =
            (uint8_t)(palette | (second_bank ? S_BANK : 0U));
    }
    return true;
}

static void prepareLauncherBand(const ps_gbc_launcher_card* card) {
    uint8_t tile;
    for (tile = 0U; tile < 40U; ++tile) {
        memcpy(
            gLauncherBand + (uint16_t)tile * 16U,
            card->background_tile_2bpp,
            16U);
    }
}

static void applyLauncherRowMask(
    uint8_t x,
    uint8_t y,
    uint8_t pixels,
    bool foreground
) {
    const uint8_t tile = (uint8_t)(x >> 3U);
    const uint8_t shift = (uint8_t)(9U - (x & 7U));
    const uint16_t shifted = (uint16_t)pixels << shift;
    const uint16_t offset =
        kLauncherRowOffsets[y] + ((uint16_t)tile << 4U);
    const uint8_t first = (uint8_t)(shifted >> 8U);
    const uint8_t second = (uint8_t)shifted;
    if (foreground) {
        gLauncherBand[offset] |= first;
        gLauncherBand[offset + 1U] |= first;
        if (tile < 19U) {
            gLauncherBand[offset + 16U] |= second;
            gLauncherBand[offset + 17U] |= second;
        }
    } else {
        gLauncherBand[offset] &= (uint8_t)~first;
        gLauncherBand[offset + 1U] &= (uint8_t)~first;
        if (tile < 19U) {
            gLauncherBand[offset + 16U] &= (uint8_t)~second;
            gLauncherBand[offset + 17U] &= (uint8_t)~second;
        }
    }
}

static void drawLauncherText(
    const char* text,
    uint8_t start_x,
    uint8_t limit_x
) {
    uint8_t character;
    for (character = 0U;
         character < 31U && text[character] != '\0';
         ++character) {
        const uint16_t character_x =
            (uint16_t)start_x + (uint16_t)character * 6U;
        const uint8_t glyph = glyphIndex(text[character]);
        uint8_t rows[7];
        uint8_t column;
        if (character_x + 5U >= limit_x) break;
        if (glyph == 0U) continue;
        memset(rows, 0, sizeof(rows));
        for (column = 0U; column < 5U; ++column) {
            uint8_t row;
            for (row = 0U; row < 7U; ++row) {
                if ((kGlyphs[glyph - 1U][column]
                        & (uint8_t)(1U << row)) != 0U) {
                    rows[row] |= (uint8_t)(1U << (4U - column));
                }
            }
        }
        {
            int8_t row;
            for (row = -1; row <= 7; ++row) {
                uint8_t neighbors = 0U;
                uint8_t outline;
                if (row > 0) neighbors |= rows[(uint8_t)(row - 1)];
                if (row >= 0 && row < 7) neighbors |= rows[(uint8_t)row];
                if (row < 6) neighbors |= rows[(uint8_t)(row + 1)];
                neighbors <<= 1U;
                outline = (uint8_t)(
                    neighbors | (neighbors << 1U) | (neighbors >> 1U));
                applyLauncherRowMask(
                    (uint8_t)(character_x - 1U),
                    (uint8_t)(row + 4),
                    outline,
                    false);
            }
        }
        {
            uint8_t row;
            for (row = 0U; row < 7U; ++row) {
                applyLauncherRowMask(
                    (uint8_t)(character_x - 1U),
                    (uint8_t)(row + 4U),
                    (uint8_t)(rows[row] << 1U),
                    true);
            }
        }
    }
}

static void renderLauncherEntry(
    const ps_gbc_launcher_card* card,
    const char* progress,
    uint8_t row,
    uint8_t first_visible,
    bool selected
) {
    uint8_t x;
    uint8_t y;
    const uint8_t progress_width =
        (uint8_t)(launcherStringLength(progress) * 6U);
    const uint8_t progress_x =
        progress_width < 154U ? (uint8_t)(154U - progress_width) : 12U;
    prepareLauncherBand(card);
    for (y = 0U; y < 8U; ++y) {
        for (x = 0U; x < 8U; ++x) {
            const uint8_t player =
                card->player_pixels[(uint8_t)(y * 8U + x)];
            if (player != 0xffU) {
                setLauncherBandPixel(
                    (uint8_t)(x + 2U),
                    (uint8_t)(y + 4U),
                    player);
            }
        }
    }
    drawLauncherText(card->title, 12U, (uint8_t)(progress_x - 2U));
    drawLauncherText(progress, progress_x, 158U);
    {
        const uint16_t thumb_top =
            (uint16_t)first_visible * 128U / PS_GBC_CART_GAME_COUNT;
        uint16_t thumb_height =
            8U * 128U / PS_GBC_CART_GAME_COUNT;
        if (thumb_height < 4U) thumb_height = 4U;
        for (y = 0U; y < 16U; ++y) {
            const uint16_t global_y = (uint16_t)row * 16U + y;
            const uint8_t color =
                global_y >= thumb_top
                    && global_y < thumb_top + thumb_height
                ? 3U : 0U;
            setLauncherBandPixel(158U, y, color);
            setLauncherBandPixel(159U, y, color);
        }
    }
    if (selected) {
        for (x = 0U; x <= 156U; ++x) {
            setLauncherBandPixel(x, 0U, 3U);
            setLauncherBandPixel(x, 15U, 3U);
        }
    }
    uploadLauncherBand(
        gLauncherBand,
        row,
        (uint8_t)(2U + row * 2U),
        true);
}

static void formatLauncherCounter(uint8_t selected) {
    const uint8_t number = (uint8_t)(selected + 1U);
    const uint8_t count = PS_GBC_CART_GAME_COUNT;
    uint8_t length = 0U;
    if (number >= 10U) {
        gLauncherCounter[length++] = (char)('0' + number / 10U);
    }
    gLauncherCounter[length++] = (char)('0' + number % 10U);
    gLauncherCounter[length++] = ' ';
    gLauncherCounter[length++] = '/';
    gLauncherCounter[length++] = ' ';
#if PS_GBC_CART_GAME_COUNT >= 10
    gLauncherCounter[length++] = (char)('0' + count / 10U);
#endif
    gLauncherCounter[length++] = (char)('0' + count % 10U);
    gLauncherCounter[length] = '\0';
}

static bool renderLauncherHeader(
    uint8_t selected,
    uint8_t palette,
    bool update_map
) {
    const LauncherCachedGame* cached = &gLauncherCache[selected];
    if (!cached->valid
        || !uploadLauncherRomBand(
            cached->launcher_art_bank,
            cached->header_band,
            palette,
            0U,
            update_map)) {
        return false;
    }
    if (update_map) {
        VBK_REG = VBK_BANK_1;
        set_bkg_tiles(0U, 0U, 20U, 2U, gAttributes);
        VBK_REG = VBK_BANK_0;
    }
    return true;
}

static void updateLauncherHeaderAttributes(uint8_t palette) {
    uint8_t tile;
    for (tile = 0U; tile < LAUNCHER_BAND_TILES; ++tile) {
        gAttributes[tile] = palette;
    }
    VBK_REG = VBK_BANK_1;
    set_bkg_tiles(0U, 0U, 20U, 2U, gAttributes);
    VBK_REG = VBK_BANK_0;
}

static void updateLauncherHeaderCounter(uint8_t palette) {
    uint8_t tile;
    uint8_t x;
    const uint8_t counter_x = (uint8_t)(
        156U - launcherStringLength(gLauncherCounter) * 6U);
    memset(
        gLauncherBand + 14U * 16U,
        0,
        6U * 16U);
    memset(
        gLauncherBand + 34U * 16U,
        0,
        6U * 16U);
    drawLauncherText(gLauncherCounter, counter_x, 158U);
    for (x = 112U; x < 160U; ++x) {
        setLauncherBandPixel(x, 15U, 3U);
    }
    VBK_REG = VBK_BANK_0;
    set_bkg_data(14U, 6U, gLauncherBand + 14U * 16U);
    set_bkg_data(34U, 6U, gLauncherBand + 34U * 16U);
    for (tile = 0U; tile < 40U; ++tile) {
        gAttributes[tile] = palette;
    }
    VBK_REG = VBK_BANK_1;
    set_bkg_tiles(0U, 0U, 20U, 2U, gAttributes);
    VBK_REG = VBK_BANK_0;
}

static void loadLauncherHeaderPalette(
    const uint16_t* palette_colors,
    uint8_t palette
) {
    gLauncherHeaderPalette[0] = 0x7fffU;
    gLauncherHeaderPalette[1] = palette_colors[1];
    gLauncherHeaderPalette[2] = palette_colors[2];
    gLauncherHeaderPalette[3] = 0x0000U;
    set_bkg_palette(palette, 1U, gLauncherHeaderPalette);
}

static uint8_t launcherScrollColor(
    uint8_t first_visible,
    uint8_t row,
    uint8_t y
) {
    const uint16_t thumb_top =
        (uint16_t)first_visible * 128U / PS_GBC_CART_GAME_COUNT;
    uint16_t thumb_height =
        8U * 128U / PS_GBC_CART_GAME_COUNT;
    const uint16_t global_y = (uint16_t)row * 16U + y;
    if (thumb_height < 4U) thumb_height = 4U;
    return global_y >= thumb_top
            && global_y < thumb_top + thumb_height
        ? 3U
        : 0U;
}

static void writeLauncherBorderTile(
    uint16_t screen_tile,
    uint8_t pixel_row,
    uint8_t plane0,
    uint8_t plane1
) {
    uint8_t tile;
    uint8_t* address;
    if (screen_tile < 256U) {
        VBK_REG = VBK_BANK_0;
        tile = (uint8_t)screen_tile;
    } else {
        VBK_REG = VBK_BANK_1;
        tile = (uint8_t)(screen_tile - 256U);
    }
    address = (uint8_t*)(
        ps_gbc_cart_launcher_tile_data_address(
            tile,
            (LCDC_REG & LCDCF_BG8000) != 0U)
        + (uint16_t)pixel_row * 2U);
    set_vram_byte(address, plane0);
    set_vram_byte(address + 1U, plane1);
}

static void launcherSelectionBorderColors(
    const uint8_t* background_tile_2bpp,
    uint8_t row,
    uint8_t first_visible,
    uint8_t line,
    bool selected,
    uint8_t full[2],
    uint8_t final[2]);

static void updateLauncherSelectionLines(
    const uint8_t* background_tile_2bpp,
    uint8_t row,
    uint8_t first_visible,
    bool selected
) {
    uint8_t line;
    for (line = 0U; line < 2U; ++line) {
        const uint8_t pixel_row = line == 0U ? 0U : 7U;
        const uint8_t screen_row =
            (uint8_t)(2U + row * 2U + line);
        const uint16_t first_screen_tile =
            (uint16_t)screen_row * 20U;
        uint8_t full[2];
        uint8_t final[2];
        uint8_t tile;
        launcherSelectionBorderColors(
            background_tile_2bpp,
            row,
            first_visible,
            line,
            selected,
            full,
            final);
        for (tile = 0U; tile < 20U; ++tile) {
            const bool final_tile = tile == 19U;
            writeLauncherBorderTile(
                first_screen_tile + tile,
                pixel_row,
                final_tile ? final[0] : full[0],
                final_tile ? final[1] : full[1]);
        }
    }
    VBK_REG = VBK_BANK_0;
}

static void launcherSelectionBorderColors(
    const uint8_t* background_tile_2bpp,
    uint8_t row,
    uint8_t first_visible,
    uint8_t line,
    bool selected,
    uint8_t full[2],
    uint8_t final[2]
) {
    const uint8_t pixel_row = line == 0U ? 0U : 7U;
    const uint8_t background_offset =
        (uint8_t)(pixel_row * 2U);
    const uint8_t scroll = launcherScrollColor(
        first_visible,
        row,
        line == 0U ? 0U : 15U);
    uint8_t plane;
    for (plane = 0U; plane < 2U; ++plane) {
        const uint8_t background =
            background_tile_2bpp[background_offset + plane];
        const bool scroll_plane =
            (scroll & (uint8_t)(1U << plane)) != 0U;
        full[plane] = ps_gbc_cart_launcher_border_plane(
            background,
            scroll_plane,
            selected,
            false);
        final[plane] = ps_gbc_cart_launcher_border_plane(
            background,
            scroll_plane,
            selected,
            true);
    }
}

static bool renderLauncherGameIndex(
    uint8_t index,
    uint8_t row,
    uint8_t first_visible,
    bool selected,
    bool update_map
) {
    const LauncherCachedGame* cached = &gLauncherCache[index];
    (void)first_visible;
    if (!cached->valid) return false;
    if (!selected) {
        set_bkg_palette(row, 1U, cached->palette);
    }
    if (!uploadLauncherRomBand(
            selected
                ? cached->launcher_selected_art_bank
                : cached->launcher_art_bank,
            selected
                ? cached->selected_card_band
                : cached->card_band,
            row,
            (uint8_t)(2U + row * 2U),
            update_map)) {
        return false;
    }
    return true;
}

static void refreshLauncherCache(void) {
    uint8_t index;
    for (index = 0U; index < PS_GBC_CART_GAME_COUNT; ++index) {
        ps_gbc_cart_entry entry;
        uint8_t level = 0U;
        uint8_t variant;
        bool completed = false;
        bool has_save;
        LauncherCachedGame* cached = &gLauncherCache[index];
        cached->valid = false;
        if (!ps_gbc_cart_copy_entry(index, &entry)
            || !ps_gbc_cart_copy_launcher_card(
                index,
                &gLauncherCard)) {
            continue;
        }
        memcpy(
            cached->palette,
            gLauncherCard.palette,
            sizeof(gLauncherCard.palette));
        has_save = readLauncherProgress(
            index,
            entry.source_hash,
            gLauncherCard.level_count,
            &completed,
            &level);
        variant =
            ps_gbc_cart_launcher_progress_variant(
                &gLauncherCard,
                has_save,
                completed,
                level);
        if (entry.launcher_art == NULL
            || entry.launcher_selected_art == NULL
            || variant
            >= entry.launcher_progress_variant_count) continue;
        cached->launcher_art_bank = entry.launcher_art_bank;
        cached->launcher_selected_art_bank =
            entry.launcher_selected_art_bank;
        cached->header_band = entry.launcher_art;
        cached->card_band = entry.launcher_art
            + (uint16_t)(variant + 1U) * LAUNCHER_BAND_BYTES;
        cached->selected_card_band =
            entry.launcher_selected_art
            + (uint16_t)variant * LAUNCHER_BAND_BYTES;
        cached->valid = true;
    }
}
#endif

static const char* drawWrappedLine(const char* text, uint8_t row) {
    uint8_t length = 0U;
    uint8_t word_break = 0xffU;
    while (*text == ' ' || *text == '\n') ++text;
    while (text[length] != '\0'
        && text[length] != '\n'
        && length < TEXT_WIDTH) {
        if (text[length] == ' ') word_break = length;
        ++length;
    }
    if (length == TEXT_WIDTH
        && text[length] != '\0'
        && text[length] != '\n'
        && text[length] != ' '
        && word_break != 0xffU) length = word_break;
    drawTextLine(text, row, length);
    text += length;
    while (*text == ' ') ++text;
    if (*text == '\n') ++text;
    return text;
}

static void drawTextFrame(void) {
    uint8_t position;
    for (position = 2U; position < 18U; ++position) {
        gTileMap[20U + position] = FRAME_HORIZONTAL_TILE;
        gTileMap[320U + position] = FRAME_HORIZONTAL_TILE;
    }
    for (position = 2U; position < 16U; ++position) {
        gTileMap[(uint16_t)position * 20U + 1U] = FRAME_VERTICAL_TILE;
        gTileMap[(uint16_t)position * 20U + 18U] = FRAME_VERTICAL_TILE;
    }
}

static const char* copyActiveText(const char* source) {
    if (source == NULL) return "";
    if (!ps_gbc_active_rom_copy_string(
            source,
            gTextBuffer,
            sizeof(gTextBuffer))) {
        gTextBuffer[0] = '\0';
    }
    return gTextBuffer;
}

static void loadActiveUiPalette(void) {
    const ps_gbc_game_view* game = ps_gbc_active_game_view();
    if (game == NULL
        || !ps_gbc_active_rom_copy(
            game->ui_palette,
            gUiPalette,
            sizeof(gUiPalette))) {
        memset(gUiPalette, 0, sizeof(gUiPalette));
    }
}

void showText(const char* message, bool title) BANKED {
    uint8_t row = title ? 5U : 3U;
    const char* cursor = message;
    gRenderedLevel = NO_RENDERED_LEVEL;
    displayOffForFullRewrite();
    if (gVramState != VRAM_STATE_TEXT) {
        loadActiveUiPalette();
        set_bkg_palette(0U, 1U, gUiPalette);
        loadFont();
    }
    memset(gTileMap, 0, SCREEN_TILES);
    memset(gAttributes, 0, SCREEN_TILES);
    drawTextFrame();
    if (title) {
        (void)drawWrappedLine("PUZZLESCRIPT", 3U);
        while (*cursor != '\0' && row < 10U) {
            cursor = drawWrappedLine(cursor, row++);
        }
        {
            const ps_gbc_game_view* game = ps_gbc_active_game_view();
            cursor = game == NULL ? "" : copyActiveText(game->author);
        }
        if (*cursor != '\0') {
            (void)drawWrappedLine("BY", 11U);
            row = 12U;
            while (*cursor != '\0' && row < 14U) {
                cursor = drawWrappedLine(cursor, row++);
            }
        }
        (void)drawWrappedLine("PRESS A", 15U);
    } else {
        while (*cursor != '\0' && row < 14U) {
            cursor = drawWrappedLine(cursor, row++);
        }
        (void)drawWrappedLine("PRESS A", 15U);
    }
    VBK_REG = VBK_BANK_0;
    set_bkg_tiles(0U, 0U, 20U, 18U, gTileMap);
    VBK_REG = VBK_BANK_1;
    set_bkg_tiles(0U, 0U, 20U, 18U, gAttributes);
    VBK_REG = VBK_BANK_0;
    gVramState = VRAM_STATE_TEXT;
    DISPLAY_ON;
}

void showGameText(const char* game_message) BANKED {
    showText(copyActiveText(game_message), false);
}

void showGameTitleText(void) BANKED {
    const ps_gbc_game_view* game = ps_gbc_active_game_view();
    showText(game == NULL ? "" : copyActiveText(game->title), true);
}

void showTitleMenu(bool has_continue, bool continue_selected) BANKED {
    uint8_t row = 5U;
    const ps_gbc_game_view* game = ps_gbc_active_game_view();
    const char* cursor =
        game == NULL ? "" : copyActiveText(game->title);
    gRenderedLevel = NO_RENDERED_LEVEL;
    displayOffForFullRewrite();
    if (gVramState != VRAM_STATE_TEXT) {
        loadActiveUiPalette();
        set_bkg_palette(0U, 1U, gUiPalette);
        loadFont();
    }
    memset(gTileMap, 0, SCREEN_TILES);
    memset(gAttributes, 0, SCREEN_TILES);
    drawTextFrame();
    (void)drawWrappedLine("PUZZLESCRIPT", 3U);
    while (*cursor != '\0' && row < 9U) {
        cursor = drawWrappedLine(cursor, row++);
    }
    cursor = game == NULL ? "" : copyActiveText(game->author);
    if (*cursor != '\0') {
        (void)drawWrappedLine("BY", 10U);
        row = 11U;
        while (*cursor != '\0' && row < 13U) {
            cursor = drawWrappedLine(cursor, row++);
        }
    }
    if (has_continue) {
        (void)drawWrappedLine(
            continue_selected ? "NEW GAME" : "[NEW GAME]",
            13U);
        (void)drawWrappedLine(
            continue_selected ? "[CONTINUE]" : "CONTINUE",
            15U);
    } else {
        (void)drawWrappedLine("PRESS A", 15U);
    }
    VBK_REG = VBK_BANK_0;
    set_bkg_tiles(0U, 0U, 20U, 18U, gTileMap);
    VBK_REG = VBK_BANK_1;
    set_bkg_tiles(0U, 0U, 20U, 18U, gAttributes);
    VBK_REG = VBK_BANK_0;
    gVramState = VRAM_STATE_TEXT;
    DISPLAY_ON;
}

void updateTitleMenuSelection(bool continue_selected) BANKED {
    const uint8_t left = glyphIndex('[');
    const uint8_t right = glyphIndex(']');
    const uint16_t new_game = 13U * 20U;
    const uint16_t resume = 15U * 20U;
    gTileMap[new_game + 5U] = continue_selected ? 0U : left;
    gTileMap[new_game + 14U] = continue_selected ? 0U : right;
    gTileMap[resume + 5U] = continue_selected ? left : 0U;
    gTileMap[resume + 14U] = continue_selected ? right : 0U;
    VBK_REG = VBK_BANK_0;
    set_bkg_tile_xy(5U, 13U, gTileMap[new_game + 5U]);
    set_bkg_tile_xy(14U, 13U, gTileMap[new_game + 14U]);
    set_bkg_tile_xy(5U, 15U, gTileMap[resume + 5U]);
    set_bkg_tile_xy(14U, 15U, gTileMap[resume + 14U]);
}

#if defined(PS_GBC_CART_BUILD)
void showCartLauncher(
    uint8_t selected,
    uint8_t first_visible
) BANKED {
    uint8_t row;
    uint8_t selected_palette =
        (uint8_t)(selected - first_visible);
    gRenderedLevel = NO_RENDERED_LEVEL;
    displayOffForFullRewrite();
    refreshLauncherCache();
    memset(gTileMap, 0, SCREEN_TILES);
    memset(gAttributes, 0, SCREEN_TILES);
    (void)renderLauncherHeader(selected, selected_palette, true);
    for (row = 0U; row < PS_GBC_CART_PAGE_SIZE; ++row) {
        const uint8_t index = (uint8_t)(first_visible + row);
        if (index >= PS_GBC_CART_GAME_COUNT) break;
        (void)renderLauncherGameIndex(
            index,
            row,
            first_visible,
            index == selected,
            true);
    }
    while (row < PS_GBC_CART_PAGE_SIZE) {
        set_bkg_palette(row, 1U, gLauncherCard.palette);
        uploadLauncherBand(
            gLauncherBlankBand,
            row,
            (uint8_t)(2U + row * 2U),
            true);
        ++row;
    }
    if (ps_gbc_cart_copy_launcher_card(selected, &gLauncherCard)) {
        loadLauncherHeaderPalette(
            gLauncherCard.palette,
            selected_palette);
        updateLauncherSelectionLines(
            gLauncherCard.background_tile_2bpp,
            selected_palette,
            first_visible,
            true);
    }
    VBK_REG = VBK_BANK_0;
    set_bkg_tiles(0U, 0U, 20U, 18U, gTileMap);
    VBK_REG = VBK_BANK_1;
    set_bkg_tiles(0U, 0U, 20U, 18U, gAttributes);
    VBK_REG = VBK_BANK_0;
    gVramState = VRAM_STATE_TEXT;
    DISPLAY_ON;
}

void updateCartLauncherSelection(
    uint8_t old_selected,
    uint8_t selected,
    uint8_t first_visible
) BANKED {
    const uint8_t old_row = (uint8_t)(old_selected - first_visible);
    const uint8_t row = (uint8_t)(selected - first_visible);
    if (ps_gbc_cart_copy_launcher_card(selected, &gLauncherCard)) {
        updateLauncherSelectionLines(
            gLauncherCard.background_tile_2bpp,
            row,
            first_visible,
            true);
        loadLauncherHeaderPalette(gLauncherCard.palette, row);
    }
    (void)renderLauncherHeader(selected, row, true);
    if (ps_gbc_cart_copy_launcher_card(old_selected, &gLauncherCard)) {
        set_bkg_palette(old_row, 1U, gLauncherCard.palette);
        updateLauncherSelectionLines(
            gLauncherCard.background_tile_2bpp,
            old_row,
            first_visible,
            false);
    }
    gVramState = VRAM_STATE_TEXT;
}

void updateCartLauncherPage(
    uint8_t selected,
    uint8_t first_visible
) BANKED {
    uint8_t row;
    const uint16_t* blank_palette;
    const uint8_t selected_palette =
        (uint8_t)(selected - first_visible);
    if (!gLauncherCache[selected].valid) return;
    blank_palette = gLauncherCache[selected].palette;
    gLauncherLastPageVBlankBlocks = 0U;
    gLauncherPageUseHBlank = false;
    waitLauncherPageVBlank();
    gLauncherLastPageStartLy = LY_REG;
    updateLauncherHeaderAttributes(selected_palette);
    loadLauncherHeaderPalette(
        gLauncherCache[selected].palette,
        selected_palette);
    /*
     * The header is one 40-block span and safely fits in the starting
     * VBlank. Uploading it here leaves only the eight card rows for the
     * visible-scan scheduler and gives the final VBlank tail enough
     * register/bank-switch margin below the raw 142-block ceiling.
     */
    (void)renderLauncherHeader(
        selected,
        selected_palette,
        false);
    gLauncherLastPageVBlankBlocks = 0U;
    gLauncherPageHBlankStarted = false;
    gLauncherPageUseHBlank = true;
    /* Rows stream from top to bottom before their display deadlines. */
    for (row = 0U; row < PS_GBC_CART_PAGE_SIZE; ++row) {
        const uint8_t index = (uint8_t)(first_visible + row);
        if (index < PS_GBC_CART_GAME_COUNT
            && gLauncherCache[index].valid) {
            (void)renderLauncherGameIndex(
                index,
                row,
                first_visible,
                row == selected_palette,
                false);
            blank_palette = gLauncherCache[index].palette;
        } else {
            uploadLauncherBand(
                gLauncherBlankBand,
                row,
                (uint8_t)(2U + row * 2U),
                false);
            set_bkg_palette(row, 1U, blank_palette);
        }
    }
    if (gLauncherLastPageVBlankBlocks
        > gLauncherMaxPageVBlankBlocks) {
        gLauncherMaxPageVBlankBlocks =
            gLauncherLastPageVBlankBlocks;
    }
    gLauncherLastPageEndLy = LY_REG;
    gVramState = VRAM_STATE_TEXT;
}

uint8_t cartLauncherLastPageVBlankBlocks(void) BANKED {
    return gLauncherLastPageVBlankBlocks;
}

uint8_t cartLauncherMaxPageVBlankBlocks(void) BANKED {
    return gLauncherMaxPageVBlankBlocks;
}

uint8_t cartLauncherLastPageStartLy(void) BANKED {
    return gLauncherLastPageStartLy;
}

uint8_t cartLauncherLastPageEndLy(void) BANKED {
    return gLauncherLastPageEndLy;
}
#endif
