#if defined(__SDCC) || defined(GBDK)
#pragma bank 2
#endif

#include "puzzlescript/gbc_facade_rules.h"

#include "puzzlescript/gbc_compact_facade.h"

#include "session_internal.h"

#include <string.h>

#if defined(PS_GBC_GENERATED_BUILD)
#include "generated_game.h"
#endif

#if defined(PS_GBC_GENERATED_PACKED_PATTERNS)
typedef ps_gbc_generated_pattern ps_gbc_runtime_pattern;
typedef ps_gbc_generated_object_mask ps_gbc_runtime_object_mask;
typedef ps_gbc_generated_movement_mask ps_gbc_runtime_movement_mask;
#else
typedef ps_gbc_pattern ps_gbc_runtime_pattern;
typedef uint32_t ps_gbc_runtime_object_mask;
typedef uint32_t ps_gbc_runtime_movement_mask;
#endif

#if defined(PS_GBC_GENERATED_PACKED_RULES)
typedef ps_gbc_generated_rule ps_gbc_runtime_rule;
#else
typedef ps_gbc_rule ps_gbc_runtime_rule;
#endif

#define PS_GBC_GROUP_PASSES 200
#define PS_GBC_RULE_LOOPS 200

#if !defined(PS_GBC_GENERATED_SOUND_COUNT) \
    || PS_GBC_GENERATED_SOUND_COUNT != 0U
#define PS_GBC_HAS_AUDIO 1
#else
#define PS_GBC_HAS_AUDIO 0
#endif

#if !defined(PS_GBC_GENERATED_CREATION_SOUND_COUNT) \
    || PS_GBC_GENERATED_CREATION_SOUND_COUNT != 0U
#define PS_GBC_HAS_CREATION_AUDIO 1
#else
#define PS_GBC_HAS_CREATION_AUDIO 0
#endif

#if !defined(PS_GBC_GENERATED_DESTRUCTION_SOUND_COUNT) \
    || PS_GBC_GENERATED_DESTRUCTION_SOUND_COUNT != 0U
#define PS_GBC_HAS_DESTRUCTION_AUDIO 1
#else
#define PS_GBC_HAS_DESTRUCTION_AUDIO 0
#endif

#if !defined(PS_GBC_GENERATED_RULE_SOUND_COUNT) \
    || PS_GBC_GENERATED_RULE_SOUND_COUNT != 0U
#define PS_GBC_HAS_RULE_AUDIO 1
#else
#define PS_GBC_HAS_RULE_AUDIO 0
#endif

#if !defined(PS_GBC_GENERATED_RULE_MESSAGE_COUNT) \
    || PS_GBC_GENERATED_RULE_MESSAGE_COUNT != 0U
#define PS_GBC_HAS_RULE_MESSAGES 1
#else
#define PS_GBC_HAS_RULE_MESSAGES 0
#endif

enum {
    PS_GBC_AUDIO_SFX = 4U,
    PS_GBC_AUDIO_UI = 5U
};

#if PS_GBC_HAS_AUDIO
static void ps_gbc_facade_rules_audio_append(
    ps_gbc_session* session,
    uint8_t sound_id,
    uint8_t kind,
    bool ui
) {
    ps_audio_event* events;
    uint8_t* count;
    uint8_t index;
    int32_t seed;
    if (session->suppress_audio || sound_id == PS_GBC_NO_SOUND
        || sound_id >= session->game->sound_count) return;
    seed = session->game->sound_seeds[sound_id];
    events = ui ? session->ui_audio_events : session->audio_events;
    count = ui ? &session->ui_audio_count : &session->audio_count;
#if defined(PS_GBC_FREESTANDING)
    (void)kind;
    for (index = 0U; index < *count; ++index) {
        if (events[index].seed == seed) return;
    }
#else
    if (ui || kind == PS_GBC_AUDIO_SFX) {
        for (index = 0U; index < *count; ++index) {
            if (events[index].seed == seed
                && (ui || session->audio_kinds[index] == kind)) return;
        }
    }
#endif
    if (*count >= PS_GBC_MAX_AUDIO_EVENTS) return;
    events[*count].seed = seed;
#if !defined(PS_GBC_FREESTANDING)
    if (!ui) session->audio_kinds[*count] = kind;
#endif
    ++*count;
}
#endif

#if PS_GBC_HAS_PLAYER_CELL_ANCHORS
static void ps_gbc_facade_rules_track_player_cell(
    ps_gbc_session* session,
    uint8_t cell,
    uint32_t objects
) {
    uint8_t index = 0U;
    uint8_t shift;
    if ((objects & session->game->player_mask) == 0U) return;
    while (index < session->player_cell_count
        && session->player_cells[index] < cell) ++index;
    if (index < session->player_cell_count
        && session->player_cells[index] == cell) return;
    shift = session->player_cell_count;
    while (shift > index) {
        session->player_cells[shift] = session->player_cells[shift - 1U];
        --shift;
    }
    session->player_cells[index] = cell;
    ++session->player_cell_count;
}
#endif

static int8_t ps_gbc_facade_rules_delta(const ps_gbc_session* session, uint8_t direction) {
    switch (direction) {
        case 1U: return -1;
        case 2U: return 1;
        case 4U: return -(int8_t)session->height;
        case 8U: return (int8_t)session->height;
        default: return 0;
    }
}

static bool ps_gbc_facade_rules_pattern_matches(
    const ps_gbc_session* session,
    const ps_gbc_runtime_pattern* pattern,
    uint8_t cell
) {
    ps_gbc_runtime_object_mask objects;
    ps_gbc_runtime_movement_mask movements;
    const uint8_t flags = pattern->flags;
    if ((flags & PS_GBC_PATTERN_NEVER_MATCH) != 0U) return false;
    objects = ps_gbc_facade_get_objects(session, cell);
    if ((flags & PS_GBC_PATTERN_OBJECTS_PRESENT) != 0U
        && (objects & pattern->objects_present) != pattern->objects_present) return false;
    if ((flags & PS_GBC_PATTERN_OBJECTS_MISSING) != 0U
        && (objects & pattern->objects_missing) != 0U) return false;
    if ((flags & (PS_GBC_PATTERN_MOVEMENTS_PRESENT
            | PS_GBC_PATTERN_MOVEMENTS_MISSING)) == 0U) return true;
    movements = ps_gbc_facade_get_movements(session, cell);
    if ((flags & PS_GBC_PATTERN_MOVEMENTS_PRESENT) != 0U
        && (movements & pattern->movements_present) != pattern->movements_present) return false;
    if ((flags & PS_GBC_PATTERN_MOVEMENTS_MISSING) != 0U
        && (movements & pattern->movements_missing) != 0U) return false;
    return true;
}

static bool ps_gbc_facade_rules_rule_matches_at(
    const ps_gbc_session* session,
    const ps_gbc_runtime_rule* rule,
    uint8_t start,
    int8_t delta
) {
    const ps_gbc_runtime_pattern* pattern = (const ps_gbc_runtime_pattern*)(
        (const uint8_t*)session->game->patterns + rule->first_pattern.byte_offset);
    uint8_t cell = start;
    uint8_t index;
    for (index = 0U; index < rule->pattern_count; ++index, ++pattern) {
        if (!ps_gbc_facade_rules_pattern_matches(session, pattern, cell)) return false;
        cell = (uint8_t)((int16_t)cell + delta);
    }
    return true;
}

static uint8_t ps_gbc_facade_rules_collect_matches(
    ps_gbc_session* session,
    const ps_gbc_runtime_rule* rule,
    int8_t delta
) {
    uint8_t count = 0U;
    uint8_t* const match_cells = session->match_cells;
    uint8_t x;
    uint8_t y;
    uint8_t xmin = 0U;
    uint8_t xmax = (uint8_t)session->width;
    uint8_t ymin = 0U;
    uint8_t ymax = (uint8_t)session->height;
    const uint8_t length = rule->pattern_count;
    uint8_t cell;
    uint8_t column_advance;
    if (length == 0U || delta == 0) return 0U;
    if (rule->direction == 1U) ymin = (uint8_t)(length - 1U);
    else if (rule->direction == 2U) ymax = (uint8_t)(ymax - (length - 1U));
    else if (rule->direction == 4U) xmin = (uint8_t)(length - 1U);
    else if (rule->direction == 8U) xmax = (uint8_t)(xmax - (length - 1U));
    else return 0U;
#if PS_GBC_HAS_PLAYER_CELL_ANCHORS
    if ((rule->commands & PS_GBC_RULE_PLAYER_CELL_ANCHOR) != 0U) {
        uint8_t player_index;
        for (player_index = 0U;
             player_index < session->player_cell_count;
             ++player_index) {
            const uint8_t player_cell = session->player_cells[player_index];
            const uint8_t player_x = (uint8_t)(player_cell / session->height);
            const uint8_t player_y = (uint8_t)(
                player_cell - player_x * session->height);
            if (player_x < xmin || player_x >= xmax
                || player_y < ymin || player_y >= ymax) continue;
            if (ps_gbc_facade_rules_rule_matches_at(session, rule, player_cell, delta)) {
                match_cells[count] = player_cell;
                ++count;
            }
        }
        return count;
    }
#endif
    cell = (uint8_t)(xmin * session->height + ymin);
    column_advance = (uint8_t)(session->height - (ymax - ymin));
    for (x = xmin; x < xmax; ++x) {
        for (y = ymin; y < ymax; ++y) {
            if (ps_gbc_facade_rules_rule_matches_at(session, rule, cell, delta)) {
                match_cells[count] = cell;
                ++count;
            }
            ++cell;
        }
        cell = (uint8_t)(cell + column_advance);
    }
    return count;
}

static bool ps_gbc_facade_rules_apply_replacement(
    ps_gbc_session* session,
    const ps_gbc_runtime_pattern* pattern,
    uint8_t cell
) {
    ps_gbc_runtime_object_mask objects;
    ps_gbc_runtime_movement_mask movements;
    ps_gbc_runtime_movement_mask original_movements;
    ps_gbc_runtime_object_mask next_objects;
    ps_gbc_runtime_movement_mask next_movements;
    if ((pattern->flags & PS_GBC_PATTERN_HAS_REPLACEMENT) == 0U) return false;
    objects = ps_gbc_facade_get_objects(session, cell);
    movements = ps_gbc_facade_get_movements(session, cell);
    original_movements = movements;
    next_objects = (objects & ~pattern->objects_clear) | pattern->objects_set;
#if PS_GBC_HAS_CREATION_AUDIO
    if (!session->suppress_audio) {
        session->created_objects |= next_objects & ~objects;
    }
#endif
#if PS_GBC_HAS_DESTRUCTION_AUDIO
    if (!session->suppress_audio) {
        session->destroyed_objects |= objects & ~next_objects;
    }
#endif
    if ((pattern->flags & PS_GBC_REPLACEMENT_CLEAR_MOVEMENT_LAYERS) != 0U) {
        movements &= ~pattern->movement_layer_mask;
    }
    next_movements = (movements & ~pattern->movements_clear) | pattern->movements_set;
#if PS_GBC_HAS_OBJECT_PRESENCE_PRECHECK
    session->present_objects |= (ps_gbc_presence_mask)next_objects;
#endif
#if PS_GBC_HAS_PLAYER_CELL_ANCHORS
    ps_gbc_facade_rules_track_player_cell(session, cell, next_objects);
#endif
    ps_gbc_facade_set_objects(session, cell, next_objects);
    ps_gbc_facade_set_movements(session, cell, next_movements);
    if (next_objects != objects) ps_gbc_facade_mark_dirty(session, cell);
    return next_objects != objects || next_movements != original_movements;
}

static bool ps_gbc_facade_rules_apply_rule(
    ps_gbc_session* session,
    const ps_gbc_runtime_rule* rule,
    ps_gbc_commands* commands
) {
#if PS_GBC_HAS_OBJECT_PRESENCE_PRECHECK
    if ((rule->commands & PS_GBC_RULE_OBJECT_PRESENCE_PRECHECK) != 0U) {
        const ps_gbc_runtime_pattern* first_pattern = (const ps_gbc_runtime_pattern*)(
            (const uint8_t*)session->game->patterns + rule->first_pattern.byte_offset);
        const ps_gbc_presence_mask required_objects =
            (ps_gbc_presence_mask)first_pattern->objects_present;
        if ((session->present_objects & required_objects)
            != required_objects) return false;
    }
#endif
    const int8_t delta = ps_gbc_facade_rules_delta(session, rule->direction);
    const uint8_t match_count = ps_gbc_facade_rules_collect_matches(session, rule, delta);
    const uint8_t* const match_cells = session->match_cells;
    uint8_t match_index;
    bool changed = false;
    if (match_count == 0U) return false;
    commands->flags |= rule->commands;
#if PS_GBC_HAS_RULE_MESSAGES
    if ((rule->commands & PS_GBC_COMMAND_MESSAGE) != 0U) commands->message = rule->message;
#endif
#if PS_GBC_HAS_RULE_AUDIO
    if (rule->sound_count != 0U && session->game->rule_sound_ids != NULL) {
        uint8_t sound_index;
        for (sound_index = 0U; sound_index < rule->sound_count; ++sound_index) {
            const uint16_t reference =
                (uint16_t)rule->first_sound + sound_index;
            if (reference >= session->game->rule_sound_count) break;
            ps_gbc_facade_rules_audio_append(
                session,
                session->game->rule_sound_ids[reference],
                PS_GBC_AUDIO_SFX,
                true);
        }
    }
#endif
    for (match_index = 0U; match_index < match_count; ++match_index) {
        const ps_gbc_runtime_pattern* pattern;
        const uint8_t start = match_cells[match_index];
        uint8_t cell;
        uint8_t pattern_index;
        if (!ps_gbc_facade_rules_rule_matches_at(session, rule, start, delta)) continue;
        pattern = (const ps_gbc_runtime_pattern*)(
            (const uint8_t*)session->game->patterns + rule->first_pattern.byte_offset);
        cell = start;
        for (pattern_index = 0U;
             pattern_index < rule->pattern_count;
             ++pattern_index, ++pattern) {
            changed = ps_gbc_facade_rules_apply_replacement(
                session,
                pattern,
                cell) || changed;
            cell = (uint8_t)((int16_t)cell + delta);
        }
    }
    return changed;
}

static bool ps_gbc_facade_rules_apply_group(
    ps_gbc_session* session,
    const ps_gbc_rule_group* group,
    uint8_t input_direction,
    ps_gbc_commands* commands
) {
    const ps_gbc_runtime_rule* const rules =
        (const ps_gbc_runtime_rule*)session->game->rules;
    uint16_t first_rule = group->first_rule;
    uint16_t rule_count = group->rule_count & PS_GBC_RULE_GROUP_COUNT_MASK;
    const uint16_t input_layout =
        group->rule_count & PS_GBC_RULE_GROUP_INPUT_LAYOUT_MASK;
    const uint16_t pass_limit =
        (group->rule_count & PS_GBC_RULE_GROUP_SINGLE_PASS) != 0U
            ? 1U
            : PS_GBC_GROUP_PASSES;
    uint16_t pass;
    bool ever_changed = false;
    if (input_layout != 0U) {
        uint16_t block_size;
        uint8_t block;
        if (input_layout == PS_GBC_RULE_GROUP_INPUT_QUARTET) {
            block_size = rule_count >> 2U;
            if (input_direction == 1U) block = 0U;
            else if (input_direction == 2U) block = 1U;
            else if (input_direction == 4U) block = 2U;
            else if (input_direction == 8U) block = 3U;
            else return false;
        } else {
            block_size = rule_count >> 1U;
            if (input_layout == PS_GBC_RULE_GROUP_INPUT_VERTICAL) {
                if (input_direction == 1U) block = 0U;
                else if (input_direction == 2U) block = 1U;
                else return false;
            } else {
                if (input_direction == 4U) block = 0U;
                else if (input_direction == 8U) block = 1U;
                else return false;
            }
        }
        first_rule = (uint16_t)(first_rule + (uint16_t)block * block_size);
        rule_count = block_size;
    }
    for (pass = 0U; pass < pass_limit; ++pass) {
        uint16_t rule_index;
        bool changed = false;
        for (rule_index = 0U; rule_index < rule_count; ++rule_index) {
            changed = ps_gbc_facade_rules_apply_rule(
                session,
                &rules[first_rule + rule_index],
                commands) || changed;
        }
        if (!changed) break;
        ever_changed = true;
    }
    return ever_changed;
}

bool ps_gbc_facade_apply_groups(
    ps_gbc_session* session,
    const ps_gbc_rule_group* groups,
    uint16_t group_count,
    uint8_t input_direction,
    ps_gbc_commands* commands
) {
    uint16_t group_index = 0U;
    uint16_t loop_count = 0U;
    bool propagated = false;
    bool changed = false;
    while (group_index < group_count) {
        bool group_changed = ps_gbc_facade_rules_apply_group(
            session, &groups[group_index], input_direction, commands);
        changed = changed || group_changed;
        propagated = propagated || group_changed;
        if (propagated && groups[group_index].loop_target >= 0) {
            group_index = (uint16_t)groups[group_index].loop_target;
            propagated = false;
            if (++loop_count > PS_GBC_RULE_LOOPS) break;
        } else {
            ++group_index;
        }
    }
    return changed;
}
