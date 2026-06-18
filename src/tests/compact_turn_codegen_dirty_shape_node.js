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
    const start = source.indexOf(`bool ${name}(`);
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
        '[ moving Player ] -> [ stationary Player ]',
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

    const movementOnlyBody = functionBody(source, 'ctg_0_e_1_apply_chunk_0');
    assertIncludes(movementOnlyBody, 'scratch.dirtyMovementBoard = false;', 'movement-only rule');
    assertIncludes(movementOnlyBody, 'const bool changedMovements_0 = scratch.dirtyMovementBoard;', 'movement-only rule');
    assertIncludes(
        movementOnlyBody,
        'compact_turn_rebuild_rule_derived_state_0(dimensions, levelState, scratch, false, changedMovements_0);',
        'movement-only rule',
    );
    assertExcludes(movementOnlyBody, 'scratch.dirtyObjectBoard = false;', 'movement-only rule');
    assertExcludes(movementOnlyBody, 'const bool changedObjects_0 = scratch.dirtyObjectBoard;', 'movement-only rule');

    console.log('compact_turn_codegen_dirty_shape_node passed');
}

main();
