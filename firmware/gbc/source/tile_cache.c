#pragma bank 1

#include <gb/gb.h>

#include "generated_game.h"
#include "tile_cache.h"

#include <string.h>

#define ATTR_TILE_BANK 0x08U
#define SCREEN_TILES (PS_GBC_VIEWPORT_WIDTH * PS_GBC_VIEWPORT_HEIGHT)
#define COMPOSITION_CACHE_CAPACITY 16U
#define DIRTY_TILE_BYTES ((SCREEN_TILES + 7U) / 8U)

extern uint8_t gTileMap[SCREEN_TILES];
extern uint8_t gAttributes[SCREEN_TILES];
extern uint8_t gSourcePixels[64];
extern uint8_t gTileBytes[16];
extern uint8_t composeTile(uint32_t objects);
#if defined(PS_GBC_AUTOTEST)
extern uint16_t gTileUploadMismatches;
#endif

static uint32_t gCompositionMasks[COMPOSITION_CACHE_CAPACITY];
static uint8_t
    gCompositionPixels[COMPOSITION_CACHE_CAPACITY][PS_GBC_GENERATED_CELL_PIXELS];
static uint8_t gCompositionCount;
static uint8_t gPhysicalPixels[64];
static uint8_t gDirtyPhysicalTiles[DIRTY_TILE_BYTES];
static const void* gRenderBoard;
static uint16_t gRenderBoardWidth;
static uint16_t gRenderBoardHeight;
static uint8_t gRenderOriginX;
static uint8_t gRenderOriginY;

#if PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL == 1U
#define BOARD_OBJECTS(board, cell) (((const uint8_t*)(board))[(cell)])
#elif PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL == 2U
#define BOARD_OBJECTS(board, cell) (((const uint16_t*)(board))[(cell)])
#else
#define BOARD_OBJECTS(board, cell) (((const uint32_t*)(board))[(cell)])
#endif

static const uint8_t* compositionForObjects(uint32_t objects) {
    uint8_t cache_index;
    for (cache_index = 0U; cache_index < gCompositionCount; ++cache_index) {
        if (gCompositionMasks[cache_index] == objects) {
            return gCompositionPixels[cache_index];
        }
    }
    (void)composeTile(objects);
    if (gCompositionCount < COMPOSITION_CACHE_CAPACITY) {
        cache_index = gCompositionCount++;
        gCompositionMasks[cache_index] = objects;
        memcpy(
            gCompositionPixels[cache_index],
            gSourcePixels,
            PS_GBC_GENERATED_CELL_PIXELS);
        return gCompositionPixels[cache_index];
    }
    return gSourcePixels;
}

static uint8_t selectPhysicalPalette(const uint8_t* counts) {
    uint8_t palette;
    uint8_t best_palette = 0U;
    uint8_t best_priority = 0U;
    uint8_t best_count = 0U;
    for (palette = 0U; palette < 8U; ++palette) {
        const uint8_t priority =
            ps_gbc_generated_game.palette_priorities[palette];
        if (counts[palette] != 0U
            && (priority > best_priority
                || (priority == best_priority
                    && counts[palette] > best_count))) {
            best_priority = priority;
            best_count = counts[palette];
            best_palette = palette;
        }
    }
    return best_palette;
}

static void encodePhysicalTile(uint8_t palette) {
    const uint8_t* palette_remap =
        ps_gbc_generated_game.palette_remap + ((uint16_t)palette << 5U);
    uint8_t y;
    for (y = 0U; y < 8U; ++y) {
        uint8_t low = 0U;
        uint8_t high = 0U;
        uint8_t x;
        for (x = 0U; x < 8U; ++x) {
            const uint8_t source = gPhysicalPixels[(uint8_t)(y * 8U + x)];
            const uint8_t color = palette_remap[source];
            low |= (uint8_t)((color & 1U) << (7U - x));
            high |= (uint8_t)(((color >> 1U) & 1U) << (7U - x));
        }
        gTileBytes[y * 2U] = low;
        gTileBytes[y * 2U + 1U] = high;
    }
}

static void renderPhysicalTile(
    uint8_t tile_x,
    uint8_t tile_y,
    bool update_hardware_attribute
) {
    const uint16_t screen_x0 = (uint16_t)tile_x << 3U;
    const uint16_t screen_y0 = (uint16_t)tile_y << 3U;
    const uint16_t screen_x1 = screen_x0 + 8U;
    const uint16_t screen_y1 = screen_y0 + 8U;
    const uint16_t board_x0 = gRenderOriginX;
    const uint16_t board_y0 = gRenderOriginY;
    const uint16_t board_x1 = board_x0
        + gRenderBoardWidth * PS_GBC_GENERATED_CELL_WIDTH;
    const uint16_t board_y1 = board_y0
        + gRenderBoardHeight * PS_GBC_GENERATED_CELL_HEIGHT;
    const uint16_t overlap_x0 =
        screen_x0 > board_x0 ? screen_x0 : board_x0;
    const uint16_t overlap_y0 =
        screen_y0 > board_y0 ? screen_y0 : board_y0;
    const uint16_t overlap_x1 =
        screen_x1 < board_x1 ? screen_x1 : board_x1;
    const uint16_t overlap_y1 =
        screen_y1 < board_y1 ? screen_y1 : board_y1;
    uint8_t palette_counts[8] = {0U};
    uint8_t palette;
    uint16_t screen_cell;
    uint16_t tile;
    uint8_t tile_bank;
    uint8_t attributes;
    bool upload_tile;
    screen_cell = (uint16_t)tile_y * PS_GBC_VIEWPORT_WIDTH + tile_x;
    if (overlap_x0 >= overlap_x1 || overlap_y0 >= overlap_y1) {
        const uint8_t phase_x =
            (uint8_t)(screen_x0 % PS_GBC_GENERATED_CELL_WIDTH);
        const uint8_t phase_y =
            (uint8_t)(screen_y0 % PS_GBC_GENERATED_CELL_HEIGHT);
        const uint16_t phase =
            (uint16_t)phase_y * PS_GBC_GENERATED_CELL_WIDTH + phase_x;
        palette = ps_gbc_generated_game.background_palette;
        tile = PS_GBC_BACKGROUND_TILE_OFFSET + phase;
        upload_tile = false;
    } else {
        const bool full_board_tile =
            overlap_x0 == screen_x0 && overlap_x1 == screen_x1
            && overlap_y0 == screen_y0 && overlap_y1 == screen_y1;
        const uint8_t first_board_x = (uint8_t)(
            (overlap_x0 - board_x0) / PS_GBC_GENERATED_CELL_WIDTH);
        const uint8_t last_board_x = (uint8_t)(
            (overlap_x1 - board_x0 - 1U) / PS_GBC_GENERATED_CELL_WIDTH);
        const uint8_t first_board_y = (uint8_t)(
            (overlap_y0 - board_y0) / PS_GBC_GENERATED_CELL_HEIGHT);
        const uint8_t last_board_y = (uint8_t)(
            (overlap_y1 - board_y0 - 1U) / PS_GBC_GENERATED_CELL_HEIGHT);
        uint8_t board_x;
        if (!full_board_tile) {
            const uint8_t* background =
                compositionForObjects(ps_gbc_generated_game.background_mask);
            uint8_t source_y =
                (uint8_t)(screen_y0 % PS_GBC_GENERATED_CELL_HEIGHT);
            uint8_t destination = 0U;
            uint8_t pixel_y;
            for (pixel_y = 0U; pixel_y < 8U; ++pixel_y) {
                uint8_t source_x =
                    (uint8_t)(screen_x0 % PS_GBC_GENERATED_CELL_WIDTH);
                uint8_t pixel_x;
                const uint8_t source_row =
                    (uint8_t)(source_y * PS_GBC_GENERATED_CELL_WIDTH);
                for (pixel_x = 0U; pixel_x < 8U; ++pixel_x) {
                    const uint8_t source = background[source_row + source_x];
                    gPhysicalPixels[destination++] = source;
                    ++palette_counts[source >> 2U];
                    if (++source_x == PS_GBC_GENERATED_CELL_WIDTH) {
                        source_x = 0U;
                    }
                }
                if (++source_y == PS_GBC_GENERATED_CELL_HEIGHT) {
                    source_y = 0U;
                }
            }
        }
        for (board_x = first_board_x; board_x <= last_board_x; ++board_x) {
            const uint16_t cell_x0 =
                board_x0 + (uint16_t)board_x * PS_GBC_GENERATED_CELL_WIDTH;
            const uint16_t copy_x0 =
                overlap_x0 > cell_x0 ? overlap_x0 : cell_x0;
            const uint16_t cell_x1 =
                cell_x0 + PS_GBC_GENERATED_CELL_WIDTH;
            const uint16_t copy_x1 =
                overlap_x1 < cell_x1 ? overlap_x1 : cell_x1;
            uint8_t board_y;
            for (board_y = first_board_y;
                 board_y <= last_board_y;
                 ++board_y) {
                const uint16_t cell_y0 =
                    board_y0
                    + (uint16_t)board_y * PS_GBC_GENERATED_CELL_HEIGHT;
                const uint16_t copy_y0 =
                    overlap_y0 > cell_y0 ? overlap_y0 : cell_y0;
                const uint16_t cell_y1 =
                    cell_y0 + PS_GBC_GENERATED_CELL_HEIGHT;
                const uint16_t copy_y1 =
                    overlap_y1 < cell_y1 ? overlap_y1 : cell_y1;
                const uint32_t objects = BOARD_OBJECTS(
                    gRenderBoard,
                    (uint16_t)board_x * gRenderBoardHeight + board_y);
                const uint8_t* composition = compositionForObjects(objects);
                uint16_t copy_y;
                for (copy_y = copy_y0; copy_y < copy_y1; ++copy_y) {
                    uint16_t copy_x;
                    uint8_t source_offset = (uint8_t)(
                        (copy_y - cell_y0) * PS_GBC_GENERATED_CELL_WIDTH
                        + copy_x0 - cell_x0);
                    uint8_t destination = (uint8_t)(
                        (copy_y - screen_y0) * 8U + copy_x0 - screen_x0);
                    for (copy_x = copy_x0; copy_x < copy_x1; ++copy_x) {
                        const uint8_t source = composition[source_offset++];
                        if (!full_board_tile) {
                            --palette_counts[
                                gPhysicalPixels[destination] >> 2U];
                        }
                        gPhysicalPixels[destination++] = source;
                        ++palette_counts[source >> 2U];
                    }
                }
            }
        }
        palette = selectPhysicalPalette(palette_counts);
        encodePhysicalTile(palette);
        tile = screen_cell + PS_GBC_BOARD_TILE_OFFSET;
        upload_tile = true;
    }
    tile_bank = (uint8_t)(tile >> 8U);
    attributes =
        (uint8_t)(palette | (tile_bank != 0U ? ATTR_TILE_BANK : 0U));
    if (upload_tile) {
        VBK_REG = tile_bank;
        set_bkg_data((uint8_t)tile, 1U, gTileBytes);
#if defined(PS_GBC_AUTOTEST) && !defined(PS_GBC_PERF_BENCH)
        get_bkg_data((uint8_t)tile, 1U, gPhysicalPixels);
        if (memcmp(gPhysicalPixels, gTileBytes, sizeof(gTileBytes)) != 0) {
            ++gTileUploadMismatches;
        }
#endif
    }
    gTileMap[screen_cell] = (uint8_t)tile;
    if (update_hardware_attribute && gAttributes[screen_cell] != attributes) {
        VBK_REG = VBK_BANK_1;
        set_bkg_tile_xy(tile_x, tile_y, attributes);
    }
    gAttributes[screen_cell] = attributes;
}

void ps_gbc_render_full_board(
    const void* board,
    uint16_t board_width,
    uint16_t board_height,
    uint8_t origin_x,
    uint8_t origin_y
) BANKED {
    uint16_t phase;
    uint8_t first_tile_x;
    uint8_t last_tile_x;
    uint8_t first_tile_y;
    uint8_t last_tile_y;
    uint8_t tile_y;
    gRenderBoard = board;
    gRenderBoardWidth = board_width;
    gRenderBoardHeight = board_height;
    gRenderOriginX = origin_x;
    gRenderOriginY = origin_y;
    for (phase = 0U; phase < PS_GBC_BACKGROUND_PHASE_TILES; ++phase) {
        const uint16_t tile = PS_GBC_BACKGROUND_TILE_OFFSET + phase;
        VBK_REG = (uint8_t)(tile >> 8U);
        set_bkg_data(
            (uint8_t)tile,
            1U,
            ps_gbc_generated_game.background_phase_tiles + (phase << 4U));
#if defined(PS_GBC_AUTOTEST) && !defined(PS_GBC_PERF_BENCH)
        get_bkg_data((uint8_t)tile, 1U, gPhysicalPixels);
        if (memcmp(
                gPhysicalPixels,
                ps_gbc_generated_game.background_phase_tiles + (phase << 4U),
                sizeof(gTileBytes))
            != 0) {
            ++gTileUploadMismatches;
        }
#endif
    }
    for (tile_y = 0U; tile_y < PS_GBC_VIEWPORT_HEIGHT; ++tile_y) {
        const uint8_t phase_y = (uint8_t)(
            ((uint16_t)tile_y * 8U) % PS_GBC_GENERATED_CELL_HEIGHT);
        uint8_t tile_x;
        for (tile_x = 0U; tile_x < PS_GBC_VIEWPORT_WIDTH; ++tile_x) {
            const uint8_t phase_x = (uint8_t)(
                ((uint16_t)tile_x * 8U) % PS_GBC_GENERATED_CELL_WIDTH);
            const uint16_t phase_index =
                (uint16_t)phase_y * PS_GBC_GENERATED_CELL_WIDTH + phase_x;
            const uint16_t tile =
                PS_GBC_BACKGROUND_TILE_OFFSET + phase_index;
            const uint16_t screen_cell =
                (uint16_t)tile_y * PS_GBC_VIEWPORT_WIDTH + tile_x;
            gTileMap[screen_cell] = (uint8_t)tile;
            gAttributes[screen_cell] =
                ps_gbc_generated_game.background_palette;
        }
    }
    first_tile_x = (uint8_t)(origin_x >> 3U);
    last_tile_x = (uint8_t)(
        (origin_x + board_width * PS_GBC_GENERATED_CELL_WIDTH - 1U) >> 3U);
    first_tile_y = (uint8_t)(origin_y >> 3U);
    last_tile_y = (uint8_t)(
        (origin_y + board_height * PS_GBC_GENERATED_CELL_HEIGHT - 1U) >> 3U);
    for (tile_y = first_tile_y; tile_y <= last_tile_y; ++tile_y) {
        uint8_t tile_x;
        for (tile_x = first_tile_x; tile_x <= last_tile_x; ++tile_x) {
            renderPhysicalTile(tile_x, tile_y, false);
        }
    }
    VBK_REG = VBK_BANK_0;
}

void ps_gbc_render_dirty_board(
    const void* board,
    const uint8_t* dirty,
    uint16_t board_width,
    uint16_t board_height,
    uint8_t origin_x,
    uint8_t origin_y
) BANKED {
    uint16_t board_cell = 0U;
    uint16_t board_x;
    uint8_t first_screen_tile_x;
    uint8_t last_screen_tile_x;
    uint8_t first_screen_tile_y;
    uint8_t last_screen_tile_y;
    gRenderBoard = board;
    gRenderBoardWidth = board_width;
    gRenderBoardHeight = board_height;
    gRenderOriginX = origin_x;
    gRenderOriginY = origin_y;
    memset(gDirtyPhysicalTiles, 0, sizeof(gDirtyPhysicalTiles));
    for (board_x = 0U; board_x < board_width; ++board_x) {
        uint16_t board_y;
        for (board_y = 0U; board_y < board_height; ++board_y, ++board_cell) {
            uint8_t first_tile_x;
            uint8_t last_tile_x;
            uint8_t first_tile_y;
            uint8_t last_tile_y;
            uint8_t tile_y;
            if ((dirty[board_cell >> 3U]
                    & (uint8_t)(1U << (board_cell & 7U))) == 0U) {
                continue;
            }
            first_tile_x = (uint8_t)(
                (origin_x + board_x * PS_GBC_GENERATED_CELL_WIDTH) >> 3U);
            last_tile_x = (uint8_t)(
                (origin_x + (board_x + 1U) * PS_GBC_GENERATED_CELL_WIDTH - 1U)
                >> 3U);
            first_tile_y = (uint8_t)(
                (origin_y + board_y * PS_GBC_GENERATED_CELL_HEIGHT) >> 3U);
            last_tile_y = (uint8_t)(
                (origin_y + (board_y + 1U) * PS_GBC_GENERATED_CELL_HEIGHT - 1U)
                >> 3U);
            for (tile_y = first_tile_y; tile_y <= last_tile_y; ++tile_y) {
                uint8_t tile_x;
                for (tile_x = first_tile_x; tile_x <= last_tile_x; ++tile_x) {
                    const uint16_t screen_cell =
                        (uint16_t)tile_y * PS_GBC_VIEWPORT_WIDTH + tile_x;
                    gDirtyPhysicalTiles[screen_cell >> 3U] |=
                        (uint8_t)(1U << (screen_cell & 7U));
                }
            }
        }
    }
    first_screen_tile_x = (uint8_t)(origin_x >> 3U);
    last_screen_tile_x = (uint8_t)(
        (origin_x + board_width * PS_GBC_GENERATED_CELL_WIDTH - 1U) >> 3U);
    first_screen_tile_y = (uint8_t)(origin_y >> 3U);
    last_screen_tile_y = (uint8_t)(
        (origin_y + board_height * PS_GBC_GENERATED_CELL_HEIGHT - 1U) >> 3U);
    for (first_screen_tile_y = first_screen_tile_y;
         first_screen_tile_y <= last_screen_tile_y;
         ++first_screen_tile_y) {
        uint8_t tile_x;
        for (tile_x = first_screen_tile_x;
             tile_x <= last_screen_tile_x;
             ++tile_x) {
            board_cell = (uint16_t)first_screen_tile_y
                * PS_GBC_VIEWPORT_WIDTH + tile_x;
            if ((gDirtyPhysicalTiles[board_cell >> 3U]
                    & (uint8_t)(1U << (board_cell & 7U))) != 0U) {
                renderPhysicalTile(tile_x, first_screen_tile_y, true);
            }
        }
    }
    VBK_REG = VBK_BANK_0;
}
