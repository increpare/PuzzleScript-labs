#include "puzzlescript/gbc.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const uint32_t kLayerMasks[] = {1U, 2U, 12U, 0U, 0U, 0U};
static const uint8_t kMovementCollisionLayers[] = {2U};
static const uint8_t kSprite[] = {0U};
static const ps_gbc_object kObjects[] = {
    {"background", 0U, PS_GBC_NO_MOVEMENT_LAYER, 1U, 1U, 0U, kSprite, 0U},
    {"target", 1U, PS_GBC_NO_MOVEMENT_LAYER, 1U, 1U, 0U, kSprite, 0U},
    {"player", 2U, 0U, 1U, 1U, 0U, kSprite, 0U},
    {"crate", 2U, 0U, 1U, 1U, 0U, kSprite, 0U},
};
static const uint8_t kLevelCells[] = {5U, 9U, 3U, 1U};
static const uint16_t kLevelCells16[] = {5U, 9U, 3U, 1U};
static const uint32_t kLevelCells32[] = {5U, 9U, 3U, 1U};
static const ps_gbc_level kLevels[] = {
    {PS_GBC_LEVEL_BOARD, 4U, 1U, kLevelCells, NULL},
};
static const ps_gbc_pattern kPatterns[] = {
    {
        4U, 0U, 8U, 0U,
        12U, 4U, 0U, 8U, 0x1fU,
        PS_GBC_PATTERN_OBJECTS_PRESENT | PS_GBC_PATTERN_MOVEMENTS_PRESENT
            | PS_GBC_PATTERN_HAS_REPLACEMENT
            | PS_GBC_REPLACEMENT_CLEAR_MOVEMENT_LAYERS
    },
    {
        8U, 0U, 0U, 0U,
        12U, 8U, 0U, 8U, 0x1fU,
        PS_GBC_PATTERN_OBJECTS_PRESENT | PS_GBC_PATTERN_HAS_REPLACEMENT
            | PS_GBC_REPLACEMENT_CLEAR_MOVEMENT_LAYERS
    },
};
static const ps_gbc_rule kRules[] = {
    {0U, 2U, 8U, 0U, NULL},
};
static const ps_gbc_rule_group kGroups[] = {
    {0U, 1U, -1},
};
static const ps_gbc_win_condition kWinConditions[] = {
    {1, 0U, 0U, 2U, 8U},
};
static const uint16_t kPalettes[32] = {0U};
static const uint8_t kRemap[256] = {0U};
static const uint16_t kUiPalette[4] = {0U, 32767U, 32767U, 32767U};
static const ps_gbc_game_view kGame = {
    PS_GBC_GAME_ABI_VERSION,
    1234U,
    "test",
    "",
    4U,
    3U,
    1U,
    1U,
    1U,
    2U,
    4U,
    1U,
    1U,
    4U,
    2U,
    1U,
    1U,
    0U,
    1U,
    4U,
    1U,
    kLayerMasks,
    kMovementCollisionLayers,
    kObjects,
    kLevels,
    kPatterns,
    kRules,
    kGroups,
    NULL,
    kWinConditions,
    kPalettes,
    kRemap,
    kUiPalette,
    false,
    false,
    false
};

static int require_true(bool condition, const char* message) {
    if (condition) return 0;
    fprintf(stderr, "gbc_core: %s\n", message);
    return 1;
}

static bool cell_dirty(const ps_gbc_session* session, uint16_t cell) {
    const uint8_t* dirty = ps_gbc_dirty_cells(session);
    return dirty != NULL && (dirty[cell >> 3U] & (uint8_t)(1U << (cell & 7U))) != 0U;
}

typedef struct snapshot_store {
    uint8_t data[(PS_GBC_MAX_UNDO + 1U) * 4U * sizeof(uint32_t)];
    uint16_t stride;
} snapshot_store;

static bool snapshot_read(void* context, uint8_t slot, void* data, uint16_t byte_count) {
    const snapshot_store* snapshots = (const snapshot_store*)context;
    memcpy(data, snapshots->data + (size_t)slot * snapshots->stride, byte_count);
    return true;
}

static bool snapshot_write(
    void* context,
    uint8_t slot,
    const void* data,
    uint16_t byte_count
) {
    snapshot_store* snapshots = (snapshot_store*)context;
    memcpy(snapshots->data + (size_t)slot * snapshots->stride, data, byte_count);
    return true;
}

int main(void) {
    const size_t bytes = ps_gbc_session_required_bytes(&kGame);
    const uint8_t three_movement_layers[] = {0U, 1U, 2U};
    const uint8_t six_movement_layers[] = {0U, 1U, 3U, 4U, 5U, 2U};
    const uint8_t duplicate_movement_layers[] = {0U, 0U, 2U};
    ps_gbc_object three_lane_objects[4];
    ps_gbc_object six_lane_objects[4];
    ps_gbc_object wide_objects[17];
    ps_gbc_pattern three_lane_patterns[2];
    ps_gbc_pattern six_lane_patterns[2];
    ps_gbc_level two_byte_level = kLevels[0];
    ps_gbc_level four_byte_level = kLevels[0];
    ps_gbc_game_view three_lane_game = kGame;
    ps_gbc_game_view six_lane_game = kGame;
    ps_gbc_game_view two_byte_game = kGame;
    ps_gbc_game_view four_byte_game = kGame;
    ps_gbc_game_view invalid_game = kGame;
    ps_gbc_game_view max_one_lane_game;
    ps_gbc_game_view max_three_lane_game;
    ps_gbc_game_view max_six_lane_game;
    size_t three_lane_bytes;
    size_t six_lane_bytes;
    size_t max_one_lane_bytes;
    size_t max_three_lane_bytes;
    size_t max_six_lane_bytes;
    size_t two_byte_bytes;
    size_t four_byte_bytes;
    void* arena = malloc(bytes);
    snapshot_store snapshots = {{0U}, 4U};
    const ps_gbc_snapshot_io snapshot_io = {
        &snapshots,
        snapshot_read,
        snapshot_write
    };
    ps_gbc_session* session;
    ps_gbc_session* three_lane_session;
    ps_gbc_session* six_lane_session;
    ps_gbc_session* two_byte_session;
    ps_gbc_session* four_byte_session;
    void* three_lane_arena;
    void* six_lane_arena;
    void* two_byte_arena;
    void* four_byte_arena;
    snapshot_store two_byte_snapshots = {{0U}, 8U};
    snapshot_store four_byte_snapshots = {{0U}, 16U};
    const ps_gbc_snapshot_io two_byte_snapshot_io = {
        &two_byte_snapshots,
        snapshot_read,
        snapshot_write
    };
    const ps_gbc_snapshot_io four_byte_snapshot_io = {
        &four_byte_snapshots,
        snapshot_read,
        snapshot_write
    };
    ps_step_result result;
    ps_gbc_status status;
    int failed = 0;
    memcpy(three_lane_objects, kObjects, sizeof(kObjects));
    memcpy(six_lane_objects, kObjects, sizeof(kObjects));
    memcpy(three_lane_patterns, kPatterns, sizeof(kPatterns));
    memcpy(six_lane_patterns, kPatterns, sizeof(kPatterns));
    memcpy(wide_objects, kObjects, sizeof(kObjects));
    {
        uint8_t object_id;
        for (object_id = 4U; object_id < 17U; ++object_id) {
            wide_objects[object_id] = kObjects[0];
        }
    }
    two_byte_level.cells = kLevelCells16;
    two_byte_game.object_count = 9U;
    two_byte_game.object_bytes_per_cell = 2U;
    two_byte_game.objects = wide_objects;
    two_byte_game.levels = &two_byte_level;
    two_byte_bytes = ps_gbc_session_required_bytes(&two_byte_game);
    four_byte_level.cells = kLevelCells32;
    four_byte_game.object_count = 17U;
    four_byte_game.object_bytes_per_cell = 4U;
    four_byte_game.objects = wide_objects;
    four_byte_game.levels = &four_byte_level;
    four_byte_bytes = ps_gbc_session_required_bytes(&four_byte_game);
    three_lane_objects[2].movement_layer = 2U;
    three_lane_objects[3].movement_layer = 2U;
    three_lane_patterns[0].movements_present = 8U << 10U;
    three_lane_patterns[0].movements_set = 8U << 10U;
    three_lane_patterns[0].movement_layer_mask = 0x1fU << 10U;
    three_lane_patterns[1].movements_set = 8U << 10U;
    three_lane_patterns[1].movement_layer_mask = 0x1fU << 10U;
    six_lane_objects[2].movement_layer = 5U;
    six_lane_objects[3].movement_layer = 5U;
    six_lane_patterns[0].movements_present = 8U << 25U;
    six_lane_patterns[0].movements_set = 8U << 25U;
    six_lane_patterns[0].movement_layer_mask = 0x1fU << 25U;
    six_lane_patterns[1].movements_set = 8U << 25U;
    six_lane_patterns[1].movement_layer_mask = 0x1fU << 25U;
    three_lane_game.movement_layer_count = 3U;
    three_lane_game.movement_bytes_per_cell = 2U;
    three_lane_game.movement_collision_layers = three_movement_layers;
    three_lane_game.objects = three_lane_objects;
    three_lane_game.patterns = three_lane_patterns;
    three_lane_bytes = ps_gbc_session_required_bytes(&three_lane_game);
    six_lane_game.layer_count = 6U;
    six_lane_game.movement_layer_count = 6U;
    six_lane_game.movement_bytes_per_cell = 4U;
    six_lane_game.movement_collision_layers = six_movement_layers;
    six_lane_game.objects = six_lane_objects;
    six_lane_game.patterns = six_lane_patterns;
    six_lane_bytes = ps_gbc_session_required_bytes(&six_lane_game);
    max_one_lane_game = kGame;
    max_one_lane_game.max_level_cells = PS_GBC_MAX_BOARD_CELLS;
    max_three_lane_game = three_lane_game;
    max_three_lane_game.max_level_cells = PS_GBC_MAX_BOARD_CELLS;
    max_six_lane_game = six_lane_game;
    max_six_lane_game.max_level_cells = PS_GBC_MAX_BOARD_CELLS;
    max_one_lane_bytes = ps_gbc_session_required_bytes(&max_one_lane_game);
    max_three_lane_bytes = ps_gbc_session_required_bytes(&max_three_lane_game);
    max_six_lane_bytes = ps_gbc_session_required_bytes(&max_six_lane_game);
    invalid_game.movement_layer_count = 3U;
    invalid_game.movement_bytes_per_cell = 1U;
    invalid_game.movement_collision_layers = three_movement_layers;
    invalid_game.objects = three_lane_objects;
    failed |= require_true(bytes > 0U && bytes < 1024U, "unexpected session size");
    failed |= require_true(three_lane_bytes == bytes + 4U,
        "two-byte movement cells are not reflected exactly in arena size");
    failed |= require_true(six_lane_bytes == bytes + 12U,
        "four-byte movement cells are not reflected exactly in arena size");
    failed |= require_true(two_byte_bytes == bytes + 4U,
        "two-byte object cells are not reflected exactly in arena size");
    failed |= require_true(four_byte_bytes == bytes + 12U,
        "four-byte object cells are not reflected exactly in arena size");
    failed |= require_true(max_three_lane_bytes == max_one_lane_bytes + 360U,
        "maximum-board two-byte movement savings are miscounted");
    failed |= require_true(max_six_lane_bytes == max_one_lane_bytes + 1080U,
        "maximum-board four-byte movement savings are miscounted");
    failed |= require_true(max_six_lane_bytes <= 4U * 1024U,
        "maximum board with six live lanes exceeds the session WRAM gate");
    failed |= require_true(ps_gbc_session_required_bytes(&invalid_game) == 0U,
        "invalid lane-count/storage-width pairing was accepted");
    invalid_game.movement_bytes_per_cell = 2U;
    invalid_game.movement_collision_layers = duplicate_movement_layers;
    failed |= require_true(ps_gbc_session_required_bytes(&invalid_game) == 0U,
        "duplicate collision-to-movement mappings were accepted");
    invalid_game = kGame;
    invalid_game.object_bytes_per_cell = 2U;
    failed |= require_true(ps_gbc_session_required_bytes(&invalid_game) == 0U,
        "invalid object-count/storage-width pairing was accepted");
    failed |= require_true(arena != NULL, "arena allocation failed");
    if (failed) {
        free(arena);
        return 1;
    }
    memset(arena, 0xcc, bytes);
    session = ps_gbc_session_init(arena, bytes, &kGame, &snapshot_io);
    failed |= require_true(session != NULL, "session initialization failed");
    failed |= require_true(
        cell_dirty(session, 0U) && cell_dirty(session, 1U)
            && cell_dirty(session, 2U) && cell_dirty(session, 3U),
        "initial board was not marked dirty");
    ps_gbc_clear_dirty_cells(session);
    failed |= require_true(
        !cell_dirty(session, 0U) && !cell_dirty(session, 1U)
            && !cell_dirty(session, 2U) && !cell_dirty(session, 3U),
        "dirty board did not clear");
    failed |= require_true(ps_gbc_cell_objects(session, 0, 0) == 5U, "initial player cell differs");
    result = ps_gbc_step(session, PS_INPUT_RIGHT);
    failed |= require_true(result.changed, "push turn did not change the board");
    failed |= require_true(result.won, "push turn did not satisfy the win condition");
    failed |= require_true((ps_gbc_cell_objects(session, 1, 0) & 4U) != 0U, "player did not move");
    failed |= require_true((ps_gbc_cell_objects(session, 2, 0) & 8U) != 0U, "crate did not move");
    failed |= require_true(
        cell_dirty(session, 0U) && cell_dirty(session, 1U)
            && cell_dirty(session, 2U) && !cell_dirty(session, 3U),
        "changed board cells were not tracked exactly");
    ps_gbc_status_get(session, &status);
    failed |= require_true(status.completed, "last level did not complete");
    failed |= require_true(ps_gbc_undo(session), "undo snapshot was not retained");
    failed |= require_true(ps_gbc_cell_objects(session, 0, 0) == 5U, "undo did not restore the board");
    failed |= require_true(
        cell_dirty(session, 0U) && cell_dirty(session, 1U)
            && cell_dirty(session, 2U) && cell_dirty(session, 3U),
        "undo did not mark the board dirty");
    two_byte_arena = malloc(two_byte_bytes);
    four_byte_arena = malloc(four_byte_bytes);
    failed |= require_true(two_byte_arena != NULL && four_byte_arena != NULL,
        "wide-object arena allocation failed");
    if (two_byte_arena != NULL) {
        two_byte_session = ps_gbc_session_init(
            two_byte_arena,
            two_byte_bytes,
            &two_byte_game,
            &two_byte_snapshot_io);
        failed |= require_true(two_byte_session != NULL,
            "two-byte object session initialization failed");
        if (two_byte_session != NULL) {
            result = ps_gbc_step(two_byte_session, PS_INPUT_RIGHT);
            failed |= require_true(
                result.changed
                    && (ps_gbc_cell_objects(two_byte_session, 1, 0) & 4U) != 0U
                    && (ps_gbc_cell_objects(two_byte_session, 2, 0) & 8U) != 0U
                    && ps_gbc_undo(two_byte_session)
                    && ps_gbc_cell_objects(two_byte_session, 0, 0) == 5U,
                "two-byte object turn or snapshot differs");
        }
    }
    if (four_byte_arena != NULL) {
        four_byte_session = ps_gbc_session_init(
            four_byte_arena,
            four_byte_bytes,
            &four_byte_game,
            &four_byte_snapshot_io);
        failed |= require_true(four_byte_session != NULL,
            "four-byte object session initialization failed");
        if (four_byte_session != NULL) {
            result = ps_gbc_step(four_byte_session, PS_INPUT_RIGHT);
            failed |= require_true(
                result.changed
                    && (ps_gbc_cell_objects(four_byte_session, 1, 0) & 4U) != 0U
                    && (ps_gbc_cell_objects(four_byte_session, 2, 0) & 8U) != 0U
                    && ps_gbc_undo(four_byte_session)
                    && ps_gbc_cell_objects(four_byte_session, 0, 0) == 5U,
                "four-byte object turn or snapshot differs");
        }
    }
    three_lane_arena = malloc(three_lane_bytes);
    six_lane_arena = malloc(six_lane_bytes);
    failed |= require_true(three_lane_arena != NULL && six_lane_arena != NULL,
        "wide-lane arena allocation failed");
    if (three_lane_arena != NULL) {
        three_lane_session = ps_gbc_session_init(
            three_lane_arena, three_lane_bytes, &three_lane_game, &snapshot_io);
        failed |= require_true(three_lane_session != NULL,
            "two-byte movement session initialization failed");
        if (three_lane_session != NULL) {
            result = ps_gbc_step(three_lane_session, PS_INPUT_RIGHT);
            failed |= require_true(result.changed
                    && (ps_gbc_cell_objects(three_lane_session, 1, 0) & 4U) != 0U
                    && (ps_gbc_cell_objects(three_lane_session, 2, 0) & 8U) != 0U,
                "movement in the high two-byte lane did not resolve");
        }
    }
    if (six_lane_arena != NULL) {
        six_lane_session = ps_gbc_session_init(
            six_lane_arena, six_lane_bytes, &six_lane_game, &snapshot_io);
        failed |= require_true(six_lane_session != NULL,
            "four-byte movement session initialization failed");
        if (six_lane_session != NULL) {
            result = ps_gbc_step(six_lane_session, PS_INPUT_RIGHT);
            failed |= require_true(result.changed
                    && (ps_gbc_cell_objects(six_lane_session, 1, 0) & 4U) != 0U
                    && (ps_gbc_cell_objects(six_lane_session, 2, 0) & 8U) != 0U,
                "movement in the high four-byte lane did not resolve");
        }
    }
    free(six_lane_arena);
    free(three_lane_arena);
    free(four_byte_arena);
    free(two_byte_arena);
    free(arena);
    return failed ? 1 : 0;
}
