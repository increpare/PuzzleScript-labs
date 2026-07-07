#!/usr/bin/env node
'use strict';

const assert = require('assert');

const {
    parseLayoutJsonLine,
    summarizeGames,
} = require('../../scripts/locality_survey.js');

const layout = parseLayoutJsonLine(JSON.stringify({
    source: 'demo.txt',
    compile_ok: true,
    object_count: 4,
    layer_count: 4,
    word_count: 1,
    stride_object: 1,
    stride_movement: 1,
    mask_arena_words: 100,
    mask_arena_bytes: 800,
    rule_count: 2,
    late_rule_count: 0,
    mask_slot_count: 100,
    unique_mask_count: 40,
    mask_arena_utilization: 0.4,
    mask_reference_span_words: 80,
    mask_reference_span_ratio: 0.8,
    first_board_level_index: 0,
    first_board_width: 5,
    first_board_height: 5,
    board_objects_bytes: 25,
}));

assert.strictEqual(layout.mask_arena_bytes, 800);
assert.strictEqual(layout.unique_mask_count, 40);

const summary = summarizeGames([
    {
        ok: true,
        name: 'big',
        layout: {
            mask_arena_bytes: 9000,
            unique_mask_count: 100,
            mask_arena_utilization: 0.2,
            mask_reference_span_ratio: 0.9,
            mask_slot_count: 500,
            stride_object: 10,
            rule_count: 200,
            board_objects_bytes: 400,
        },
    },
    {
        ok: true,
        name: 'small',
        layout: {
            mask_arena_bytes: 100,
            unique_mask_count: 10,
            mask_arena_utilization: 1.0,
            mask_reference_span_ratio: 0.1,
            mask_slot_count: 10,
            stride_object: 1,
            rule_count: 1,
            board_objects_bytes: 20,
        },
    },
    {
        ok: false,
        name: 'broken',
        layout: null,
    },
]);

assert.strictEqual(summary.measured_games, 2);
assert.strictEqual(summary.failures, 1);
assert.strictEqual(summary.top_mask_arena_bytes[0].name, 'big');
assert.strictEqual(summary.low_mask_arena_utilization[0].name, 'big');

console.log('locality_survey_node: ok');
