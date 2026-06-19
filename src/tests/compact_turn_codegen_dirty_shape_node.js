#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function usage() {
    console.log([
        'Usage: node src/tests/compact_turn_codegen_dirty_shape_node.js',
        '  --compiler PATH',
    ].join('\n'));
}

function parseArgs(argv) {
    const options = {
        compiler: null,
    };
    for (let index = 2; index < argv.length; ++index) {
        const arg = argv[index];
        const next = () => {
            assert.ok(index + 1 < argv.length, `missing value for ${arg}`);
            return argv[++index];
        };
        if (arg === '--compiler') {
            options.compiler = next();
        } else if (arg === '--help' || arg === '-h') {
            usage();
            process.exit(0);
        } else {
            throw new Error(`unknown argument ${arg}`);
        }
    }
    if (!options.compiler) {
        throw new Error('expected --compiler');
    }
    return options;
}

function functionBody(source, name) {
    const prefixes = [
        `bool ${name}(`,
        `void ${name}(`,
        `int32_t ${name}(`,
        `MaskWord* ${name}(`,
        `const MaskWord* ${name}(`,
    ];
    const start = Math.max(...prefixes.map((prefix) => source.lastIndexOf(prefix)));
    assert.notStrictEqual(start, -1, `missing generated function ${name}`);
    const braceStart = source.indexOf('{', start);
    assert.notStrictEqual(braceStart, -1, `missing body for generated function ${name}`);
    let depth = 0;
    for (let index = braceStart; index < source.length; ++index) {
        const char = source[index];
        if (char === '{') {
            depth++;
        } else if (char === '}') {
            depth--;
            if (depth === 0) {
                return source.slice(braceStart + 1, index);
            }
        }
    }
    throw new Error(`unterminated generated function ${name}`);
}

function compileFixture(compiler) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-compact-dirty-shape-'));
    const gamePath = path.join(tmpDir, 'dirty_shape.txt');
    const cppPath = path.join(tmpDir, 'dirty_shape.cpp');
    const fixture = [
        'title dirty shape',
        'author codex',
        '',
        '========',
        'OBJECTS',
        '',
        'Background',
        'black',
        '',
        'Player',
        'red',
        '',
        'Crate',
        'blue',
        '',
        'Goal',
        'green',
        '',
        '=======',
        'LEGEND',
        '. = Background',
        'P = Player',
        'C = Crate',
        'G = Goal',
        '',
        '=======',
        'COLLISIONLAYERS',
        'Background',
        'Player, Crate, Goal',
        '',
        '=======',
        'RULES',
        '[ Player ] -> [ Goal ]',
        'right [ Player ] -> [ > Player ]',
        '[ moving Player ] -> [ stationary ]',
        '',
        '=======',
        'WINCONDITIONS',
        '',
        '=======',
        'LEVELS',
        'P',
        '',
    ].join('\n');
    fs.writeFileSync(gamePath, fixture);
    const result = spawnSync(compiler, [
        'compile-rules',
        gamePath,
        '--emit-cpp',
        cppPath,
        '--symbol',
        'dirty_shape',
        '--max-rows',
        '1',
        '--compact-turn-only',
        '--compact-turn-mode=compiler',
    ], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 16,
    });
    if (result.status !== 0) {
        throw new Error([
            `compile-rules failed with status ${result.status}`,
            result.stdout,
            result.stderr,
        ].join('\n'));
    }
    return fs.readFileSync(cppPath, 'utf8');
}

function assertIncludes(body, needle, context) {
    assert.ok(body.includes(needle), `${context}: expected generated body to include ${needle}`);
}

function assertExcludes(body, needle, context) {
    assert.ok(!body.includes(needle), `${context}: expected generated body not to include ${needle}`);
}

function main() {
    const options = parseArgs(process.argv);
    const source = compileFixture(options.compiler);

    assert.match(
        source,
        /(?:static\s+)?constexpr bool \w+_writes_objects\s*=\s*true;/,
        'expected generated write-summary object constant',
    );
    assert.match(
        source,
        /(?:static\s+)?constexpr bool \w+_writes_movements\s*=\s*true;/,
        'expected generated write-summary movement constant',
    );
    assert.match(
        source,
        /(?:static\s+)?constexpr bool \w+_writes_objects\s*=\s*false;/,
        'expected generated no-object-write summary constant',
    );
    assert.match(
        source,
        /(?:static\s+)?constexpr bool \w+_writes_movements\s*=\s*false;/,
        'expected generated no-movement-write summary constant',
    );
    const objectDerivedBody = functionBody(source, 'compact_turn_rebuild_object_derived_state_0');
    assertExcludes(objectDerivedBody, 'objectCellBits.assign', 'object derived-state rebuild');
    assertExcludes(objectDerivedBody, 'objectCellCounts.assign', 'object derived-state rebuild');
    const objectCellIndexBody = functionBody(source, 'compact_turn_rebuild_object_cell_index_0');
    assertIncludes(objectCellIndexBody, 'objectCellBits.assign', 'object-cell index rebuild');
    assertIncludes(objectCellIndexBody, 'objectCellCounts.assign', 'object-cell index rebuild');
    const prepareObjectCellIndexBody = functionBody(source, 'compact_turn_prepare_object_cell_index_0');
    assertIncludes(
        prepareObjectCellIndexBody,
        'compact_turn_rebuild_object_cell_index_0(dimensions, levelState, scratch)',
        'object-cell index prepare',
    );
    const updateObjectCellIndexBody = functionBody(source, 'compact_turn_update_object_cell_index_0');
    assertIncludes(updateObjectCellIndexBody, 'beforeObjects', 'object-cell index incremental update');
    assertIncludes(updateObjectCellIndexBody, 'afterObjects', 'object-cell index incremental update');
    assertIncludes(updateObjectCellIndexBody, 'removedBits', 'object-cell index incremental update');
    assertIncludes(updateObjectCellIndexBody, 'addedBits', 'object-cell index incremental update');
    assertIncludes(updateObjectCellIndexBody, '--scratch.objectCellCounts', 'object-cell index incremental update');
    assertIncludes(updateObjectCellIndexBody, '++scratch.objectCellCounts', 'object-cell index incremental update');
    const noteObjectBody = functionBody(source, 'compact_turn_note_object_cell_written_0');
    assertIncludes(
        noteObjectBody,
        'compact_turn_update_object_cell_index_0(dimensions, scratch, tileIndex, beforeObjects, afterObjects);',
        'object write incremental object-cell index',
    );
    assertExcludes(noteObjectBody, 'scratch.objectCellIndexDirty = true;', 'object write incremental object-cell index');
    assertIncludes(noteObjectBody, 'scratch.rowMasks[static_cast<size_t>(y * compact_turn_object_stride_0 + word)] |= value;', 'object write conservative masks');
    assertIncludes(noteObjectBody, 'scratch.columnMasks[static_cast<size_t>(x * compact_turn_object_stride_0 + word)] |= value;', 'object write conservative masks');
    assertIncludes(noteObjectBody, 'scratch.boardMask[static_cast<size_t>(word)] |= value;', 'object write conservative masks');
    const noteMovementBody = functionBody(source, 'compact_turn_note_movement_cell_written_0');
    assertIncludes(noteMovementBody, 'scratch.rowMovementMasks[static_cast<size_t>(y * compact_turn_movement_stride_0 + word)] |= value;', 'movement write conservative masks');
    assertIncludes(noteMovementBody, 'scratch.columnMovementMasks[static_cast<size_t>(x * compact_turn_movement_stride_0 + word)] |= value;', 'movement write conservative masks');
    assertIncludes(noteMovementBody, 'scratch.boardMovementMask[static_cast<size_t>(word)] |= value;', 'movement write conservative masks');
    const ruleDerivedBody = functionBody(source, 'compact_turn_rebuild_rule_derived_state_0');
    assertIncludes(
        ruleDerivedBody,
        'compact_turn_rebuild_dirty_object_derived_state_0(dimensions, levelState, scratch)',
        'rule derived-state rebuild',
    );
    assertIncludes(
        ruleDerivedBody,
        'compact_turn_rebuild_dirty_movement_derived_state_0(dimensions, scratch)',
        'rule derived-state rebuild',
    );
    assertExcludes(
        ruleDerivedBody,
        'compact_turn_rebuild_object_derived_state_0(dimensions, levelState, scratch)',
        'rule derived-state rebuild',
    );
    assertExcludes(
        ruleDerivedBody,
        'compact_turn_rebuild_movement_derived_state_0(dimensions, scratch)',
        'rule derived-state rebuild',
    );
    assertExcludes(ruleDerivedBody, 'compact_turn_rebuild_object_cell_index_0', 'rule derived-state rebuild');

    const fastPathCallCount = (source.match(/compact_turn_count_simple_replacement_fast_path_call_0\(\);/g) || []).length;
    assert.ok(
        fastPathCallCount >= 2,
        `expected at least two generated simple replacement fast-path calls; actual=${fastPathCallCount}`,
    );
    const objectFastPathBody = functionBody(source, 'compact_turn_simple_replacement_fast_path_objects_0');
    assertIncludes(objectFastPathBody, 'MaskWord beforeObjects[compact_turn_object_stride_0] = {};', 'object-only fast replacement');

    const objectOnlyBody = functionBody(source, 'ctg_0_e_0_apply_chunk_0');
    assertIncludes(objectOnlyBody, 'scratch.dirtyObjectBoard = false;', 'object-only rule');
    assertIncludes(objectOnlyBody, 'const bool changedObjects_0 = scratch.dirtyObjectBoard;', 'object-only rule');
    assertIncludes(
        objectOnlyBody,
        'compact_turn_rebuild_rule_derived_state_0(dimensions, levelState, scratch, changedObjects_0, false);',
        'object-only rule',
    );
    assertExcludes(objectOnlyBody, 'scratch.dirtyMovementBoard = false;', 'object-only rule');
    assertExcludes(objectOnlyBody, 'const bool changedMovements_0 = scratch.dirtyMovementBoard;', 'object-only rule');
    const objectOnlyApplyBody = functionBody(source, 'ctr_0_e_0_0_apply');
    assertIncludes(
        objectOnlyApplyBody,
        'compact_turn_simple_replacement_fast_path_objects_0(',
        'object-only fast replacement',
    );
    assertExcludes(objectOnlyApplyBody, 'MaskWord* fastObjects', 'object-only fast replacement');
    assertExcludes(objectOnlyApplyBody, 'fastMovements', 'object-only fast replacement');
    assertExcludes(objectOnlyApplyBody, 'compact_turn_cell_movements_0(scratch, applyTile_0)', 'object-only fast replacement');

    const objectAndMovementBody = functionBody(source, 'ctg_0_e_1_apply_chunk_0');
    assertIncludes(objectAndMovementBody, 'scratch.dirtyObjectBoard = false;', 'object+movement rule');
    assertIncludes(objectAndMovementBody, 'scratch.dirtyMovementBoard = false;', 'object+movement rule');
    assertIncludes(objectAndMovementBody, 'const bool changedObjects_0 = scratch.dirtyObjectBoard;', 'object+movement rule');
    assertIncludes(objectAndMovementBody, 'const bool changedMovements_0 = scratch.dirtyMovementBoard;', 'object+movement rule');
    assertIncludes(
        objectAndMovementBody,
        'compact_turn_rebuild_rule_derived_state_0(dimensions, levelState, scratch, changedObjects_0, changedMovements_0);',
        'object+movement rule',
    );

    const noWriteBody = functionBody(source, 'ctg_0_e_2_apply_chunk_0');
    assertExcludes(noWriteBody, 'scratch.dirtyObjectBoard = false;', 'no-write rule');
    assertExcludes(noWriteBody, 'scratch.dirtyMovementBoard = false;', 'no-write rule');
    assertExcludes(noWriteBody, 'const bool changedObjects_0 = scratch.dirtyObjectBoard;', 'no-write rule');
    assertExcludes(noWriteBody, 'const bool changedMovements_0 = scratch.dirtyMovementBoard;', 'no-write rule');
    assertExcludes(noWriteBody, 'compact_turn_rebuild_rule_derived_state_0(', 'no-write rule');

    console.log('compact_turn_codegen_dirty_shape_node passed');
}

main();
