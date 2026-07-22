#pragma bank 1

#include <gb/cgb.h>
#include <gb/gb.h>

#include "generated_game.h"
#include "puzzlescript/gbc.h"
#include "text.h"

#include <string.h>

#define SCREEN_TILES \
    (PS_GBC_SCREEN_TILE_WIDTH * PS_GBC_SCREEN_TILE_HEIGHT)
#define NO_RENDERED_LEVEL 0xffffU
#define TEXT_WIDTH 16U
#define FRAME_HORIZONTAL_TILE 38U
#define FRAME_VERTICAL_TILE 39U

extern uint8_t gTileMap[SCREEN_TILES];
extern uint8_t gAttributes[SCREEN_TILES];

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

void showText(const char* message, bool title) BANKED {
    uint8_t row = title ? 5U : 3U;
    const char* cursor = message;
    gRenderedLevel = NO_RENDERED_LEVEL;
    displayOffForFullRewrite();
    if (gVramState != VRAM_STATE_TEXT) {
        set_bkg_palette(0U, 1U, ps_gbc_generated_game.ui_palette);
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
        cursor = ps_gbc_generated_game.author;
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

void showTitleMenu(bool has_continue, bool continue_selected) BANKED {
    uint8_t row = 5U;
    const char* cursor = ps_gbc_generated_game.title;
    gRenderedLevel = NO_RENDERED_LEVEL;
    displayOffForFullRewrite();
    if (gVramState != VRAM_STATE_TEXT) {
        set_bkg_palette(0U, 1U, ps_gbc_generated_game.ui_palette);
        loadFont();
    }
    memset(gTileMap, 0, SCREEN_TILES);
    memset(gAttributes, 0, SCREEN_TILES);
    drawTextFrame();
    (void)drawWrappedLine("PUZZLESCRIPT", 3U);
    while (*cursor != '\0' && row < 9U) {
        cursor = drawWrappedLine(cursor, row++);
    }
    cursor = ps_gbc_generated_game.author;
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
