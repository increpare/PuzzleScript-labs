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
        `SpecializedCompactTurnOutcome ${name}(`,
        `CompactTurnMovementOutcome_0 ${name}(`,
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

function assertInOrder(text, needles, context) {
    let offset = 0;
    for (const needle of needles) {
        const index = text.indexOf(needle, offset);
        assert.notStrictEqual(index, -1, `missing ordered snippet in ${context}: ${needle}`);
        offset = index + needle.length;
    }
}

function compileSource(compiler, fixtureName, fixture, symbol) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-compact-dirty-shape-'));
    const gamePath = path.join(tmpDir, `${fixtureName}.txt`);
    const cppPath = path.join(tmpDir, `${fixtureName}.cpp`);
    fs.writeFileSync(gamePath, fixture);
    const result = spawnSync(compiler, [
        'compile-rules',
        gamePath,
        '--emit-cpp',
        cppPath,
        '--symbol',
        symbol,
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

function compileFixture(compiler) {
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
    return compileSource(compiler, 'dirty_shape', fixture, 'dirty_shape');
}

function compileMissingPrecheckFixture(compiler) {
    const fixture = [
        'title missing precheck shape',
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
        '=======',
        'LEGEND',
        '. = Background',
        'P = Player',
        'C = Crate',
        '',
        '=======',
        'COLLISIONLAYERS',
        'Background',
        'Player',
        'Crate',
        '',
        '=======',
        'RULES',
        '[ Player no Crate ] -> [ Player Crate ]',
        '',
        '=======',
        'WINCONDITIONS',
        '',
        '=======',
        'LEVELS',
        'P',
        '',
    ].join('\n');
    return compileSource(compiler, 'missing_precheck_shape', fixture, 'missing_precheck_shape');
}

function compileGroupPrecheckFixture(compiler) {
    const fixture = [
        'title group precheck shape',
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
        'Wall',
        'gray',
        '',
        '=======',
        'LEGEND',
        '. = Background',
        'P = Player',
        'C = Crate',
        'G = Goal',
        '# = Wall',
        '',
        '=======',
        'COLLISIONLAYERS',
        'Background',
        'Player, Crate, Goal, Wall',
        '',
        '=======',
        'RULES',
        '[ Player ] -> [ Crate ]',
        '+ [ Crate ] -> [ Goal ]',
        '+ [ Goal ] -> [ Wall ]',
        '+ [ Wall ] -> [ Player ]',
        '',
        '=======',
        'WINCONDITIONS',
        '',
        '=======',
        'LEVELS',
        'P',
        '',
    ].join('\n');
    return compileSource(compiler, 'group_precheck_shape', fixture, 'group_precheck_shape');
}

function compileExternalPrecheckedRuleFixture(compiler) {
    const fixture = [
        'title external prechecked rule shape',
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
        '=======',
        'LEGEND',
        '. = Background',
        'P = Player',
        'C = Crate',
        '',
        '=======',
        'COLLISIONLAYERS',
        'Background',
        'Player, Crate',
        '',
        '=======',
        'RULES',
        '[ Player ] -> [ Crate ]',
        '',
        '=======',
        'WINCONDITIONS',
        '',
        '=======',
        'LEVELS',
        'P',
        '',
    ].join('\n');
    return compileSource(compiler, 'external_prechecked_rule_shape', fixture, 'external_prechecked_rule_shape');
}

function compileNoopReplacementFixture(compiler) {
    const fixture = [
        'title noop replacement shape',
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
        '=======',
        'LEGEND',
        '. = Background',
        'P = Player',
        'C = Crate',
        '',
        '=======',
        'COLLISIONLAYERS',
        'Background',
        'Player, Crate',
        '',
        '=======',
        'RULES',
        'right [ Player | no Crate ] -> [ Player | Crate ]',
        '',
        '=======',
        'WINCONDITIONS',
        '',
        '=======',
        'LEVELS',
        'P.',
        '',
    ].join('\n');
    return compileSource(compiler, 'noop_replacement_shape', fixture, 'noop_replacement_shape');
}

function compileCombinedEagerSplitFixture(compiler) {
    const fixture = [
        'title combined eager split shape',
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
        'Goal',
        'green',
        '',
        '=======',
        'LEGEND',
        '. = Background',
        'P = Player',
        'G = Goal',
        '',
        '=======',
        'COLLISIONLAYERS',
        'Background',
        'Player',
        'Goal',
        '',
        '=======',
        'RULES',
        'right [ stationary Player ] -> [ > Player ]',
        '[ > Player no Goal ] -> [ > Player Goal ]',
        '[ > Player no Goal ] -> [ stationary Player Goal ]',
        '',
        '=======',
        'WINCONDITIONS',
        '',
        '=======',
        'LEVELS',
        'P.',
        '',
    ].join('\n');
    return compileSource(compiler, 'combined_eager_split_shape', fixture, 'combined_eager_split_shape');
}

function compileVerticalUniqueAnchorFixture(compiler) {
    const fixture = [
        'title vertical unique anchor shape',
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
        '=======',
        'LEGEND',
        '. = Background',
        'P = Player',
        'C = Crate',
        '',
        '=======',
        'COLLISIONLAYERS',
        'Background',
        'Player',
        'Crate',
        '',
        '=======',
        'RULES',
        'down [ Player | no Crate ] -> [ Player | Crate ]',
        '',
        '=======',
        'WINCONDITIONS',
        '',
        '=======',
        'LEVELS',
        'P',
        '.',
        '',
    ].join('\n');
    return compileSource(compiler, 'vertical_unique_anchor_shape', fixture, 'vertical_unique_anchor_shape');
}

function compileSpreadGroupFixture(compiler) {
    const fixture = [
        'title spread group shape',
        'author codex',
        '',
        '========',
        'OBJECTS',
        '',
        'Background',
        'black',
        '',
        'blue_raw',
        'blue',
        '',
        'blue1',
        'blue',
        '',
        'blue2',
        'blue',
        '',
        'blue3',
        'blue',
        '',
        'blue4',
        'blue',
        '',
        'blue5',
        'blue',
        '',
        'blue6',
        'blue',
        '',
        'blue7',
        'blue',
        '',
        'blue8',
        'blue',
        '',
        'blue9',
        'blue',
        '',
        'once',
        'transparent',
        '',
        'counted',
        'white',
        '',
        'counting',
        'yellow',
        '',
        'deleting',
        'yellow',
        '',
        'deleted',
        'orange',
        '',
        '=======',
        'LEGEND',
        '. = Background',
        '@ = counting and blue_raw',
        '* = blue1',
        'blue = blue_raw or blue1 or blue2 or blue3 or blue4 or blue5 or blue6 or blue7 or blue8 or blue9',
        'blue_other = blue',
        '',
        '=======',
        'COLLISIONLAYERS',
        'once, counted',
        'counting',
        'deleted',
        'Background',
        'blue_raw, blue1, blue2, blue3, blue4, blue5, blue6, blue7, blue8, blue9',
        'deleting',
        '',
        '=======',
        'RULES',
        'late [ counting blue no deleting | no counting blue_other no deleting ] -> [ counting blue | counting blue ]',
        '',
        '=======',
        'WINCONDITIONS',
        '',
        '=======',
        'LEVELS',
        '@*',
        '',
    ].join('\n');
    return compileSource(compiler, 'spread_group_shape', fixture, 'spread_group_shape');
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
    assertExcludes(source, 'bool precheckPassed_', 'generated rule mask precheck branch');
    const objectDerivedBody = functionBody(source, 'compact_turn_rebuild_object_derived_state_0');
    assertExcludes(objectDerivedBody, 'objectCellBits.assign', 'object derived-state rebuild');
    assertExcludes(objectDerivedBody, 'objectCellCounts.assign', 'object derived-state rebuild');
    const objectCellIndexBody = functionBody(source, 'compact_turn_rebuild_object_cell_index_0');
    assertIncludes(objectCellIndexBody, 'objectCellBits.assign', 'object-cell index rebuild');
    assertIncludes(objectCellIndexBody, 'objectCellCounts.assign', 'object-cell index rebuild');
    assertIncludes(source, 'scratch.objectRowCounts', 'object mask count cache');
    assertIncludes(source, 'scratch.objectColumnCounts', 'object mask count cache');
    assertIncludes(source, 'scratch.objectBoardCounts', 'object mask count cache');
    assertIncludes(
        objectDerivedBody,
        'objectRowCounts.assign',
        'object derived-state rebuild count cache',
    );
    assertIncludes(
        objectDerivedBody,
        'objectColumnCounts.assign',
        'object derived-state rebuild count cache',
    );
    assertIncludes(
        objectDerivedBody,
        'objectBoardCounts.assign',
        'object derived-state rebuild count cache',
    );
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
        'compact_turn_update_object_mask_counts_0(dimensions, scratch, tileIndex, beforeObjects, afterObjects)',
        'object write exact mask count update',
    );
    assertIncludes(
        noteObjectBody,
        'if (!updatedObjectMasks) {',
        'object write exact mask count fallback',
    );
    assertInOrder(
        noteObjectBody,
        [
            'const bool updatedObjectMasks = compact_turn_update_object_mask_counts_0',
            'if (!updatedObjectMasks) {',
            'scratch.dirtyObjectBoard = true;',
            'scratch.anyMasksDirty = true;',
            '}',
        ],
        'object write add-only dirty mask gating',
    );
    assertIncludes(
        noteObjectBody,
        'compact_turn_update_object_cell_index_0(dimensions, scratch, tileIndex, beforeObjects, afterObjects);',
        'object write incremental object-cell index',
    );
    assertExcludes(noteObjectBody, 'scratch.objectCellIndexDirty = true;', 'object write incremental object-cell index');
    assertExcludes(
        noteObjectBody,
        'scratch.rowMasks[static_cast<size_t>(y * compact_turn_object_stride_0 + word)] |= value;',
        'object write relies on exact mask counts',
    );
    assertExcludes(
        noteObjectBody,
        'scratch.columnMasks[static_cast<size_t>(x * compact_turn_object_stride_0 + word)] |= value;',
        'object write relies on exact mask counts',
    );
    assertExcludes(
        noteObjectBody,
        'scratch.boardMask[static_cast<size_t>(word)] |= value;',
        'object write relies on exact mask counts',
    );
    const noteMovementBody = functionBody(source, 'compact_turn_note_movement_cell_written_0');
    assertIncludes(noteMovementBody, 'scratch.liveMovementsClean = false;', 'movement write marks live movement storage dirty');
    assertInOrder(
        noteMovementBody,
        [
            'bool removedMovements = false;',
            'const MaskWord removed = beforeMovements[word] & ~afterMovements[word];',
            'removedMovements = removedMovements || removed != 0;',
            'if (removedMovements) {',
            'scratch.dirtyMovementBoard = true;',
            'scratch.anyMasksDirty = true;',
            '}',
        ],
        'movement write add-only dirty mask gating',
    );
    assertIncludes(noteMovementBody, 'scratch.rowMovementMasks[static_cast<size_t>(y * compact_turn_movement_stride_0 + word)] |= value;', 'movement write conservative masks');
    assertIncludes(noteMovementBody, 'scratch.columnMovementMasks[static_cast<size_t>(x * compact_turn_movement_stride_0 + word)] |= value;', 'movement write conservative masks');
    assertIncludes(noteMovementBody, 'scratch.boardMovementMask[static_cast<size_t>(word)] |= value;', 'movement write conservative masks');
    const executeProgramBody = functionBody(source, 'compact_turn_execute_program_0');
    assertIncludes(executeProgramBody, 'if (!scratch.liveMovementsClean) {', 'turn start skips redundant movement clear');
    const prepareStateBody = functionBody(source, 'compact_turn_prepare_state_0');
    assertIncludes(
        prepareStateBody,
        'scratch.singleRowMatchScratch.reserve(static_cast<size_t>(tileCount));',
        'single-row match scratch reserve happens once in compact setup',
    );
    assertInOrder(
        prepareStateBody,
        [
            'const bool masksStorageReady =',
            'if (!scratch.anyMasksDirty && masksStorageReady) {',
            'return true;',
            'const auto noDirtyBytes =',
        ],
        'compact setup clean-mask fast path',
    );
    const resolveMovementsBody = functionBody(source, 'compact_turn_resolve_movements_0');
    assertIncludes(resolveMovementsBody, 'scratch.liveMovementsClean = true;', 'movement resolution marks live movement storage clean');
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
    const objectEagerFastPathBody = functionBody(source, 'compact_turn_simple_replacement_fast_path_objects_eager_0');
    const movementEagerFastPathBody = functionBody(source, 'compact_turn_simple_replacement_fast_path_movements_eager_0');
    const combinedObjectEagerFastPathBody = functionBody(source, 'compact_turn_simple_replacement_fast_path_objects_movements_eager_objects_0');
    const combinedMovementEagerFastPathBody = functionBody(source, 'compact_turn_simple_replacement_fast_path_objects_movements_eager_movements_0');
    const combinedBothEagerFastPathBody = functionBody(source, 'compact_turn_simple_replacement_fast_path_objects_movements_eager_both_0');
    assertIncludes(source, 'inline bool compact_turn_simple_replacement_fast_path_objects_0(', 'object-only fast replacement');
    assertExcludes(source, 'PS_COMPACT_TURN_NOINLINE bool compact_turn_simple_replacement_fast_path_objects_0(', 'object-only fast replacement');
    assertIncludes(objectFastPathBody, 'MaskWord beforeObjects[compact_turn_object_stride_0] = {};', 'object-only fast replacement');
    assertExcludes(objectEagerFastPathBody, 'fastObjectsChanged', 'eager object-only fast replacement');
    assertExcludes(objectEagerFastPathBody, 'before != after', 'eager object-only fast replacement');
    assertExcludes(
        objectEagerFastPathBody,
        'compact_turn_count_simple_replacement_fast_path_noop_0();',
        'eager object-only fast replacement',
    );
    assertIncludes(objectEagerFastPathBody, 'fastObjects[word] = after;', 'eager object-only fast replacement');
    assertIncludes(objectEagerFastPathBody, 'return true;', 'eager object-only fast replacement');
    assertExcludes(movementEagerFastPathBody, 'fastMovementsChanged', 'eager movement-only fast replacement');
    assertExcludes(movementEagerFastPathBody, 'before != after', 'eager movement-only fast replacement');
    assertExcludes(
        movementEagerFastPathBody,
        'compact_turn_count_simple_replacement_fast_path_noop_0();',
        'eager movement-only fast replacement',
    );
    assertIncludes(movementEagerFastPathBody, 'fastMovements[word] = after;', 'eager movement-only fast replacement');
    assertIncludes(movementEagerFastPathBody, 'return true;', 'eager movement-only fast replacement');
    assertExcludes(combinedObjectEagerFastPathBody, 'fastObjectsChanged', 'object-proven eager object+movement fast replacement');
    assertIncludes(combinedObjectEagerFastPathBody, 'if (fastMovementsChanged)', 'object-proven eager object+movement fast replacement');
    assertIncludes(
        combinedObjectEagerFastPathBody,
        'compact_turn_note_object_cell_written_0(dimensions, scratch, tileIndex, beforeObjects, fastObjects);',
        'object-proven eager object+movement fast replacement',
    );
    assertIncludes(combinedMovementEagerFastPathBody, 'if (fastObjectsChanged)', 'movement-proven eager object+movement fast replacement');
    assertExcludes(combinedMovementEagerFastPathBody, 'fastMovementsChanged', 'movement-proven eager object+movement fast replacement');
    assertIncludes(
        combinedMovementEagerFastPathBody,
        'compact_turn_note_movement_cell_written_0(dimensions, scratch, tileIndex, beforeMovements, fastMovements);',
        'movement-proven eager object+movement fast replacement',
    );
    assertExcludes(combinedBothEagerFastPathBody, 'fastObjectsChanged', 'object+movement-proven eager object+movement fast replacement');
    assertExcludes(combinedBothEagerFastPathBody, 'fastMovementsChanged', 'object+movement-proven eager object+movement fast replacement');
    assertExcludes(combinedBothEagerFastPathBody, 'before != after', 'object+movement-proven eager object+movement fast replacement');
    assertExcludes(
        combinedObjectEagerFastPathBody,
        'if (fastObjectsChanged || fastMovementsChanged)',
        'object-proven eager object+movement fast replacement',
    );
    assertExcludes(
        combinedMovementEagerFastPathBody,
        'if (fastObjectsChanged || fastMovementsChanged)',
        'movement-proven eager object+movement fast replacement',
    );
    assertExcludes(
        combinedBothEagerFastPathBody,
        'if (fastObjectsChanged || fastMovementsChanged)',
        'object+movement-proven eager object+movement fast replacement',
    );
    assertExcludes(
        combinedObjectEagerFastPathBody,
        'compact_turn_count_simple_replacement_fast_path_noop_0();',
        'object-proven eager object+movement fast replacement',
    );
    assertExcludes(
        combinedMovementEagerFastPathBody,
        'compact_turn_count_simple_replacement_fast_path_noop_0();',
        'movement-proven eager object+movement fast replacement',
    );
    assertExcludes(
        combinedBothEagerFastPathBody,
        'compact_turn_count_simple_replacement_fast_path_noop_0();',
        'object+movement-proven eager object+movement fast replacement',
    );
    assertIncludes(combinedObjectEagerFastPathBody, 'return true;', 'object-proven eager object+movement fast replacement');
    assertIncludes(combinedMovementEagerFastPathBody, 'return true;', 'movement-proven eager object+movement fast replacement');
    assertIncludes(combinedBothEagerFastPathBody, 'return true;', 'object+movement-proven eager object+movement fast replacement');

    const combinedSplitSource = compileCombinedEagerSplitFixture(options.compiler);
    assertIncludes(
        combinedSplitSource,
        'changed = compact_turn_simple_replacement_fast_path_objects_movements_eager_movements_0(',
        'movement-proven object+movement eager replacement call',
    );
    assertIncludes(
        combinedSplitSource,
        'changed = compact_turn_simple_replacement_fast_path_objects_movements_eager_objects_0(',
        'object-proven object+movement eager replacement call',
    );
    assertIncludes(
        combinedSplitSource,
        'changed = compact_turn_simple_replacement_fast_path_objects_movements_eager_both_0(',
        'object+movement-proven eager replacement call',
    );
    assertExcludes(
        combinedSplitSource,
        'changed = compact_turn_simple_replacement_fast_path_objects_movements_eager_0(',
        'split object+movement eager replacement calls',
    );

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
    assertExcludes(
        objectOnlyApplyBody,
        'matches.reserve(static_cast<size_t>(tileCount));',
        'single-row rule apply does not repeat match scratch reserve',
    );
    const objectOnlyFallbackScanIndex = objectOnlyApplyBody.indexOf('if (!usedAnchorScan)');
    assert.notStrictEqual(
        objectOnlyFallbackScanIndex,
        -1,
        'object-only fast replacement: expected anchored scan fallback',
    );
    const objectOnlyAnchorScanBody = objectOnlyApplyBody.slice(0, objectOnlyFallbackScanIndex);
    assertInOrder(
        objectOnlyAnchorScanBody,
        [
            'bool matched = true;',
            'if (matched) {',
            'const MaskWord* tile_0_objects',
        ],
        'inline pattern object loads are matched-gated',
    );
    assertExcludes(
        objectOnlyAnchorScanBody,
        'compact_turn_line_has_required_masks_0',
        'object-only anchor scan with covered positive line preconditions',
    );
    assertIncludes(
        objectOnlyApplyBody,
        'compact_turn_simple_replacement_fast_path_objects_eager_0(',
        'object-only layer-exclusive fast replacement is guaranteed to change',
    );
    assertExcludes(objectOnlyApplyBody, 'MaskWord* fastObjects', 'object-only fast replacement');
    assertExcludes(objectOnlyApplyBody, 'fastMovements', 'object-only fast replacement');
    assertExcludes(objectOnlyApplyBody, 'compact_turn_cell_movements_0(scratch, applyTile_0)', 'object-only fast replacement');

    const missingSource = compileMissingPrecheckFixture(options.compiler);
    const missingApplyBody = functionBody(missingSource, 'ctr_0_e_0_0_apply');
    assertIncludes(
        missingApplyBody,
        'compact_turn_prepare_object_cell_index_0',
        'missing-object precheck fixture anchored scan',
    );
    const missingFallbackScanIndex = missingApplyBody.indexOf('if (!usedAnchorScan)');
    assert.notStrictEqual(
        missingFallbackScanIndex,
        -1,
        'missing-object precheck fixture: expected anchored scan fallback',
    );
    const missingAnchorScanBody = missingApplyBody.slice(0, missingFallbackScanIndex);
    assertIncludes(
        missingAnchorScanBody,
        'compact_turn_line_has_required_masks_0',
        'missing-object anchor scan preserves line precheck',
    );
    assertIncludes(
        missingAnchorScanBody,
        'const MaskWord tile_0_objects_word_0 = tile_0_objects[0];',
        'same-word present/missing object checks share one load',
    );

    const groupPrecheckSource = compileGroupPrecheckFixture(options.compiler);
    const groupPrecheckApplyBody = functionBody(groupPrecheckSource, 'ctg_0_e_0_apply');
    assertIncludes(
        groupPrecheckApplyBody,
        'compact_turn_count_rule_mask_precheck_failure_0(4);',
        'multi-rule group all-fail precheck aggregation',
    );
    assertIncludes(
        groupPrecheckApplyBody,
        'compact_turn_count_rules_skipped_by_mask_0(4);',
        'multi-rule group all-fail skip aggregation',
    );

    const externalPrecheckedSource = compileExternalPrecheckedRuleFixture(options.compiler);
    const externalPrecheckedApplyBody = functionBody(externalPrecheckedSource, 'ctr_0_e_0_0_apply');
    assertExcludes(
        externalPrecheckedApplyBody,
        'scratch.boardMask',
        'externally prechecked rule apply body',
    );

    const noopReplacementSource = compileNoopReplacementFixture(options.compiler);
    const noopReplacementApplyBody = functionBody(noopReplacementSource, 'ctr_0_e_0_0_apply');
    assertExcludes(
        noopReplacementApplyBody,
        'applyTile_0',
        'matched-cell no-op replacement elision',
    );
    assertIncludes(
        noopReplacementApplyBody,
        'applyTile_1',
        'matched-cell no-op replacement elision keeps real replacement',
    );

    const verticalUniqueSource = compileVerticalUniqueAnchorFixture(options.compiler);
    const verticalUniqueApplyBody = functionBody(verticalUniqueSource, 'ctr_0_e_0_0_apply');
    const verticalUniqueFallbackScanIndex = verticalUniqueApplyBody.indexOf('if (!usedAnchorScan)');
    assert.notStrictEqual(
        verticalUniqueFallbackScanIndex,
        -1,
        'vertical unique anchor scan: expected anchored scan fallback',
    );
    const verticalUniqueAnchorScanBody = verticalUniqueApplyBody.slice(0, verticalUniqueFallbackScanIndex);
    assertExcludes(
        verticalUniqueAnchorScanBody,
        'compact_turn_sort_unique_start_matches_0',
        'vertical unique anchor scan',
    );

    const spreadGroupSource = compileSpreadGroupFixture(options.compiler);
    const spreadGroupApplyBody = functionBody(spreadGroupSource, 'ctg_0_l_0_apply');
    assertIncludes(
        spreadGroupApplyBody,
        'compact_turn_apply_spread_group_0_0',
        'property-expanded marker spread group fusion',
    );
    assertExcludes(
        spreadGroupApplyBody,
        'ctg_0_l_0_apply_chunk_0',
        'property-expanded marker spread group fusion',
    );

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
