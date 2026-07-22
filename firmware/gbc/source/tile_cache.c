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
extern uint8_t gSourcePixels[PS_GBC_SOURCE_PIXEL_BUFFER_BYTES];
extern uint8_t gTileBytes[64];
#if defined(PS_GBC_AUTOTEST) && !defined(PS_GBC_AUTOTEST_LOGIC_ONLY)
extern uint16_t gTileUploadMismatches;
#endif

static const uint8_t kSourceCoordinate[PS_GBC_RENDERED_CELL_WIDTH] = {
    0U, 0U, 0U, 1U, 1U, 1U, 2U, 2U,
    2U, 2U, 3U, 3U, 3U, 4U, 4U, 4U
};

static uint32_t gCompositionMasks[PS_GBC_CACHE_COMPOSITIONS];
static uint8_t gCompositionAttributes[
    PS_GBC_CACHE_COMPOSITIONS * PS_GBC_TILES_PER_CELL];
static uint8_t gCompositionCount;
static uint8_t gReadbackTile[16];

static uint8_t packedPalette(uint16_t palettes, uint8_t part) {
    return (uint8_t)((palettes >> (part * 3U)) & 7U);
}

uint16_t composeTile(uint32_t objects) {
    uint8_t layer;
    uint16_t target_palettes = 0U;
    memset(gSourcePixels, 0, sizeof(gSourcePixels));
    for (layer = 0U; layer < ps_gbc_generated_game.layer_count; ++layer) {
        uint8_t object_id;
        for (object_id = 0U;
             object_id < ps_gbc_generated_game.object_count;
             ++object_id) {
            const ps_gbc_object* object;
            uint8_t composite_pixel;
            const uint8_t* composite_pixels;
            uint8_t part;
            uint8_t drew_parts;
            if ((objects & ((uint32_t)1U << object_id)) == 0U) continue;
            object = &ps_gbc_generated_game.objects[object_id];
            if (object->layer != layer) continue;
            /* Keep this as a sequential ROM walk. SDCC miscompiles two
             * indexed reads through this generated banked pointer. */
            composite_pixels = object->composite_pixels;
            for (composite_pixel = 0U;
                 composite_pixel < object->composite_pixel_count;
                 ++composite_pixel) {
                const uint8_t destination = *composite_pixels++;
                gSourcePixels[destination] = *composite_pixels++;
            }
            drew_parts = (uint8_t)(object->quadrant_palettes >> 12U);
            for (part = 0U; part < PS_GBC_TILES_PER_CELL; ++part) {
                const uint16_t palette_mask =
                    (uint16_t)7U << (part * 3U);
                if ((drew_parts & (uint8_t)(1U << part)) == 0U) continue;
                target_palettes = (uint16_t)(
                    (target_palettes & (uint16_t)~palette_mask)
                    | ((uint16_t)packedPalette(
                            object->quadrant_palettes, part)
                        << (part * 3U)));
            }
        }
    }
    return target_palettes;
}

#if PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL == 1U
#define BOARD_OBJECTS(board, cell) (((const uint8_t*)(board))[(cell)])
#elif PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL == 2U
#define BOARD_OBJECTS(board, cell) (((const uint16_t*)(board))[(cell)])
#else
#define BOARD_OBJECTS(board, cell) (((const uint32_t*)(board))[(cell)])
#endif

static void encodeQuartet(uint16_t palettes) {
    uint8_t part;
    uint16_t palette_bits = palettes;
    for (part = 0U; part < PS_GBC_TILES_PER_CELL; ++part) {
        const uint8_t palette = (uint8_t)(palette_bits & 7U);
        const uint8_t* palette_remap =
            ps_gbc_generated_game.palette_remap + ((uint16_t)palette << 5U);
        const uint8_t rendered_x_base = (uint8_t)((part & 1U) << 3U);
        const uint8_t rendered_y_base = (uint8_t)((part >> 1U) << 3U);
        uint8_t tile_row;
        for (tile_row = 0U; tile_row < 8U; ++tile_row) {
            const uint8_t source_y =
                kSourceCoordinate[(uint8_t)(rendered_y_base + tile_row)];
            uint8_t low = 0U;
            uint8_t high = 0U;
            uint8_t tile_column;
            for (tile_column = 0U; tile_column < 8U; ++tile_column) {
                const uint8_t source_x = kSourceCoordinate[
                    (uint8_t)(rendered_x_base + tile_column)];
                const uint8_t source = gSourcePixels[
                    (uint8_t)(
                        part * PS_GBC_GENERATED_CELL_PIXELS
                        + source_y * PS_GBC_GENERATED_CELL_WIDTH
                        + source_x)];
                const uint8_t color = palette_remap[source];
                low |= (uint8_t)((color & 1U) << (7U - tile_column));
                high |= (uint8_t)(
                    ((color >> 1U) & 1U) << (7U - tile_column));
            }
            gTileBytes[(uint8_t)(part * 16U + tile_row * 2U)] = low;
            gTileBytes[(uint8_t)(part * 16U + tile_row * 2U + 1U)] = high;
        }
        palette_bits >>= 3U;
    }
}

static void uploadQuartet(uint16_t base_tile) {
    uint8_t part;
    for (part = 0U; part < PS_GBC_TILES_PER_CELL; ++part) {
        const uint16_t tile = base_tile + part;
        VBK_REG = (uint8_t)(tile >> 8U);
        set_bkg_data((uint8_t)tile, 1U, gTileBytes + (uint8_t)(part << 4U));
#if defined(PS_GBC_AUTOTEST) \
    && !defined(PS_GBC_PERF_BENCH) \
    && !defined(PS_GBC_AUTOTEST_LOGIC_ONLY)
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

static uint16_t composeAndUpload(uint16_t base_tile, uint32_t objects) {
    const uint16_t palettes = composeTile(objects);
    encodeQuartet(palettes);
    uploadQuartet(base_tile);
    return palettes;
}

static void unpackAttributes(
    uint16_t packed,
    uint16_t base_tile,
    uint8_t* attributes
) {
    uint8_t part;
    for (part = 0U; part < PS_GBC_TILES_PER_CELL; ++part) {
        attributes[part] = (uint8_t)(
            (packed & 7U)
            | (base_tile + part >= 256U ? ATTR_TILE_BANK : 0U));
        packed >>= 3U;
    }
}

static uint16_t findCachedComposition(
    uint32_t objects,
    const uint8_t** attributes
) {
    uint8_t cache_index;
    for (cache_index = 0U;
         cache_index < gCompositionCount;
         ++cache_index) {
        if (gCompositionMasks[cache_index] == objects) {
            *attributes = gCompositionAttributes
                + (uint8_t)(cache_index * PS_GBC_TILES_PER_CELL);
            return PS_GBC_CACHE_TILE_OFFSET
                + (uint16_t)cache_index * PS_GBC_TILES_PER_CELL;
        }
    }
    return 0xffffU;
}

static uint16_t prepareComposition(
    uint16_t logical_screen_cell,
    uint32_t objects,
    uint8_t* fallback_attributes,
    const uint8_t** attributes
) {
    uint16_t base_tile = findCachedComposition(objects, attributes);
    if (base_tile != 0xffffU) return base_tile;
    if (gCompositionCount < PS_GBC_CACHE_COMPOSITIONS) {
        const uint8_t cache_index = gCompositionCount++;
        base_tile = PS_GBC_CACHE_TILE_OFFSET
            + (uint16_t)cache_index * PS_GBC_TILES_PER_CELL;
        gCompositionMasks[cache_index] = objects;
        uint8_t* cached_attributes = gCompositionAttributes
            + (uint8_t)(cache_index * PS_GBC_TILES_PER_CELL);
        unpackAttributes(
            composeAndUpload(base_tile, objects),
            base_tile,
            cached_attributes);
        *attributes = cached_attributes;
        return base_tile;
    }
    base_tile = PS_GBC_DEDICATED_TILE_OFFSET
        + logical_screen_cell * PS_GBC_TILES_PER_CELL;
    unpackAttributes(
        composeAndUpload(base_tile, objects),
        base_tile,
        fallback_attributes);
    *attributes = fallback_attributes;
    return base_tile;
}

static void mapComposition(
    uint8_t logical_x,
    uint8_t logical_y,
    uint16_t base_tile,
    const uint8_t* attributes,
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
        const uint8_t attribute = attributes[part];
        gTileMap[screen_cell] = (uint8_t)tile;
        gAttributes[screen_cell] = attribute;
        if (update_hardware) {
            VBK_REG = VBK_BANK_0;
            set_bkg_tile_xy(tile_x, tile_y, (uint8_t)tile);
            VBK_REG = VBK_BANK_1;
            set_bkg_tile_xy(tile_x, tile_y, attribute);
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
            uint8_t fallback_attributes[PS_GBC_TILES_PER_CELL];
            const uint8_t* attributes;
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
                prepareComposition(
                    logical_screen_cell,
                    objects,
                    fallback_attributes,
                    &attributes);
            mapComposition(
                logical_x,
                logical_y,
                base_tile,
                attributes,
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
            uint8_t fallback_attributes[PS_GBC_TILES_PER_CELL];
            const uint8_t* attributes;
            uint16_t base_tile;
            if ((dirty[board_cell >> 3U]
                    & (uint8_t)(1U << (board_cell & 7U))) == 0U) {
                continue;
            }
            base_tile = prepareComposition(
                logical_screen_cell,
                BOARD_OBJECTS(board, board_cell),
                fallback_attributes,
                &attributes);
            mapComposition(
                logical_x,
                logical_y,
                base_tile,
                attributes,
                true);
        }
    }
    VBK_REG = VBK_BANK_0;
}
