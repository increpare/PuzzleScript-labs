#pragma bank 1

#include <gb/gb.h>

#include "generated_game.h"
#include "tile_cache.h"

#include <string.h>

#define ATTR_TILE_BANK 0x08U
#define SCREEN_TILES \
    (PS_GBC_SCREEN_TILE_WIDTH * PS_GBC_SCREEN_TILE_HEIGHT)

extern uint8_t gTileMap[SCREEN_TILES];
extern uint8_t gAttributes[SCREEN_TILES];
extern uint8_t gSourcePixels[64];
extern uint8_t gTileBytes[64];
extern uint8_t composeTile(uint32_t objects);
#if defined(PS_GBC_AUTOTEST)
extern uint16_t gTileUploadMismatches;
#endif

static const uint8_t kSourceCoordinate[PS_GBC_RENDERED_CELL_WIDTH] = {
    0U, 0U, 0U, 1U, 1U, 1U, 2U, 2U,
    2U, 2U, 3U, 3U, 3U, 4U, 4U, 4U
};

static uint32_t gCompositionMasks[PS_GBC_CACHE_COMPOSITIONS];
static uint8_t gCompositionPalettes[PS_GBC_CACHE_COMPOSITIONS];
static uint8_t gCompositionCount;
static uint8_t gReadbackTile[16];

#if PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL == 1U
#define BOARD_OBJECTS(board, cell) (((const uint8_t*)(board))[(cell)])
#elif PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL == 2U
#define BOARD_OBJECTS(board, cell) (((const uint16_t*)(board))[(cell)])
#else
#define BOARD_OBJECTS(board, cell) (((const uint32_t*)(board))[(cell)])
#endif

static void encodeQuartet(uint8_t palette) {
    const uint8_t* palette_remap =
        ps_gbc_generated_game.palette_remap + ((uint16_t)palette << 5U);
    uint8_t rendered_y;
    memset(gTileBytes, 0, sizeof(gTileBytes));
    for (rendered_y = 0U;
         rendered_y < PS_GBC_RENDERED_CELL_HEIGHT;
         ++rendered_y) {
        const uint8_t source_y = kSourceCoordinate[rendered_y];
        const uint8_t tile_y = rendered_y >> 3U;
        const uint8_t tile_row = (uint8_t)(rendered_y & 7U);
        uint8_t rendered_x;
        for (rendered_x = 0U;
             rendered_x < PS_GBC_RENDERED_CELL_WIDTH;
             ++rendered_x) {
            const uint8_t source_x = kSourceCoordinate[rendered_x];
            const uint8_t source = gSourcePixels[
                (uint8_t)(source_y * PS_GBC_GENERATED_CELL_WIDTH + source_x)];
            const uint8_t color = palette_remap[source];
            const uint8_t tile_x = rendered_x >> 3U;
            const uint8_t tile_column = (uint8_t)(rendered_x & 7U);
            const uint8_t destination = (uint8_t)(
                (tile_y * 2U + tile_x) * 16U + tile_row * 2U);
            gTileBytes[destination] |=
                (uint8_t)((color & 1U) << (7U - tile_column));
            gTileBytes[destination + 1U] |=
                (uint8_t)(((color >> 1U) & 1U) << (7U - tile_column));
        }
    }
}

static void uploadQuartet(uint16_t base_tile) {
    uint8_t part;
    for (part = 0U; part < PS_GBC_TILES_PER_CELL; ++part) {
        const uint16_t tile = base_tile + part;
        VBK_REG = (uint8_t)(tile >> 8U);
        set_bkg_data((uint8_t)tile, 1U, gTileBytes + (uint8_t)(part << 4U));
#if defined(PS_GBC_AUTOTEST) && !defined(PS_GBC_PERF_BENCH)
        get_bkg_data((uint8_t)tile, 1U, gReadbackTile);
        if (memcmp(
                gReadbackTile,
                gTileBytes + (uint8_t)(part << 4U),
                sizeof(gReadbackTile))
            != 0) {
            ++gTileUploadMismatches;
        }
#endif
    }
}

static uint8_t composeAndUpload(uint16_t base_tile, uint32_t objects) {
    const uint8_t palette = composeTile(objects);
    encodeQuartet(palette);
    uploadQuartet(base_tile);
    return palette;
}

static uint16_t findCachedComposition(uint32_t objects, uint8_t* palette) {
    uint8_t cache_index;
    for (cache_index = 0U;
         cache_index < gCompositionCount;
         ++cache_index) {
        if (gCompositionMasks[cache_index] == objects) {
            *palette = gCompositionPalettes[cache_index];
            return PS_GBC_CACHE_TILE_OFFSET
                + (uint16_t)cache_index * PS_GBC_TILES_PER_CELL;
        }
    }
    return 0xffffU;
}

static uint16_t prepareComposition(
    uint16_t logical_screen_cell,
    uint32_t objects,
    uint8_t* palette
) {
    uint16_t base_tile = findCachedComposition(objects, palette);
    if (base_tile != 0xffffU) return base_tile;
    if (gCompositionCount < PS_GBC_CACHE_COMPOSITIONS) {
        const uint8_t cache_index = gCompositionCount++;
        base_tile = PS_GBC_CACHE_TILE_OFFSET
            + (uint16_t)cache_index * PS_GBC_TILES_PER_CELL;
        gCompositionMasks[cache_index] = objects;
        *palette = composeAndUpload(base_tile, objects);
        gCompositionPalettes[cache_index] = *palette;
        return base_tile;
    }
    base_tile = PS_GBC_DEDICATED_TILE_OFFSET
        + logical_screen_cell * PS_GBC_TILES_PER_CELL;
    *palette = composeAndUpload(base_tile, objects);
    return base_tile;
}

static void mapComposition(
    uint8_t logical_x,
    uint8_t logical_y,
    uint16_t base_tile,
    uint8_t palette,
    bool update_hardware
) {
    const uint8_t physical_x = (uint8_t)(logical_x << 1U);
    const uint8_t physical_y = (uint8_t)(logical_y << 1U);
    uint8_t part;
    for (part = 0U; part < PS_GBC_TILES_PER_CELL; ++part) {
        const uint8_t part_x = (uint8_t)(part & 1U);
        const uint8_t part_y = (uint8_t)(part >> 1U);
        const uint8_t tile_x = (uint8_t)(physical_x + part_x);
        const uint8_t tile_y = (uint8_t)(physical_y + part_y);
        const uint16_t screen_cell =
            (uint16_t)tile_y * PS_GBC_SCREEN_TILE_WIDTH + tile_x;
        const uint16_t tile = base_tile + part;
        const uint8_t tile_bank = (uint8_t)(tile >> 8U);
        const uint8_t attributes =
            (uint8_t)(palette | (tile_bank != 0U ? ATTR_TILE_BANK : 0U));
        gTileMap[screen_cell] = (uint8_t)tile;
        gAttributes[screen_cell] = attributes;
        if (update_hardware) {
            VBK_REG = VBK_BANK_0;
            set_bkg_tile_xy(tile_x, tile_y, (uint8_t)tile);
            VBK_REG = VBK_BANK_1;
            set_bkg_tile_xy(tile_x, tile_y, attributes);
        }
    }
}

void ps_gbc_render_full_board(
    const void* board,
    uint16_t board_width,
    uint16_t board_height,
    uint8_t offset_x,
    uint8_t offset_y
) BANKED {
    uint8_t logical_y;
    gCompositionCount = 0U;
    for (logical_y = 0U;
         logical_y < PS_GBC_VIEWPORT_HEIGHT;
         ++logical_y) {
        uint8_t logical_x;
        for (logical_x = 0U;
             logical_x < PS_GBC_VIEWPORT_WIDTH;
             ++logical_x) {
            const uint16_t logical_screen_cell =
                (uint16_t)logical_y * PS_GBC_VIEWPORT_WIDTH + logical_x;
            uint32_t objects = ps_gbc_generated_game.background_mask;
            uint8_t palette;
            uint16_t base_tile;
            if (logical_x >= offset_x
                && logical_x < (uint8_t)(offset_x + board_width)
                && logical_y >= offset_y
                && logical_y < (uint8_t)(offset_y + board_height)) {
                const uint16_t board_x = logical_x - offset_x;
                const uint16_t board_y = logical_y - offset_y;
                objects = BOARD_OBJECTS(
                    board,
                    board_x * board_height + board_y);
            }
            base_tile =
                prepareComposition(logical_screen_cell, objects, &palette);
            mapComposition(
                logical_x,
                logical_y,
                base_tile,
                palette,
                false);
        }
    }
    VBK_REG = VBK_BANK_0;
}

void ps_gbc_render_dirty_board(
    const void* board,
    const uint8_t* dirty,
    uint16_t board_width,
    uint16_t board_height,
    uint8_t offset_x,
    uint8_t offset_y
) BANKED {
    uint16_t board_cell = 0U;
    uint16_t board_x;
    for (board_x = 0U; board_x < board_width; ++board_x) {
        uint16_t board_y;
        for (board_y = 0U;
             board_y < board_height;
             ++board_y, ++board_cell) {
            const uint8_t logical_x = (uint8_t)(offset_x + board_x);
            const uint8_t logical_y = (uint8_t)(offset_y + board_y);
            const uint16_t logical_screen_cell =
                (uint16_t)logical_y * PS_GBC_VIEWPORT_WIDTH + logical_x;
            uint8_t palette;
            uint16_t base_tile;
            if ((dirty[board_cell >> 3U]
                    & (uint8_t)(1U << (board_cell & 7U))) == 0U) {
                continue;
            }
            base_tile = prepareComposition(
                logical_screen_cell,
                BOARD_OBJECTS(board, board_cell),
                &palette);
            mapComposition(
                logical_x,
                logical_y,
                base_tile,
                palette,
                true);
        }
    }
    VBK_REG = VBK_BANK_0;
}
