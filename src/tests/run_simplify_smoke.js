#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { compileGameFile, replaySolutionOnCurrentCompiledState } = require('./run_solver_tests_js');

if (process.argv.length < 3) {
    console.error('Usage: node src/tests/run_simplify_smoke.js <puzzlescript_simplify> [game.txt]');
    process.exit(2);
}

const simplifyPath = path.resolve(process.argv[2]);
const repoRoot = path.resolve(__dirname, '..', '..');
const gamePath = path.resolve(process.argv[3] || path.join(repoRoot, 'src/demo/sokoban_basic.txt'));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-simplify-smoke-'));
const outPath = path.join(tempDir, 'simplified_game.txt');

const COMPACT_TO_TOKEN = {
    U: 'up',
    D: 'down',
    L: 'left',
    R: 'right',
    A: 'action',
};

function preludeBeforeLevels(source) {
    const lines = source.split(/\r?\n/);
    const levelsIndex = lines.findIndex((line) => line.trim().toLowerCase() === 'levels');
    assert.ok(levelsIndex >= 0, 'game should contain LEVELS section');
    return lines.slice(0, levelsIndex + 1).join('\n') + '\n';
}

function parseSolutionComment(line) {
    const match = line.match(/^\(solution:\s*([^)]+)\)$/);
    if (!match) {
        return null;
    }
    const compact = match[1].replace(/\s+/g, '');
    const solution = [];
    for (const ch of compact) {
        const token = COMPACT_TO_TOKEN[ch];
        assert.ok(token, `unknown compact solution character: ${ch}`);
        solution.push(token);
    }
    return solution;
}

function parseLevels(source) {
    const lines = source.split(/\r?\n/);
    const levelsIndex = lines.findIndex((line) => line.trim().toLowerCase() === 'levels');
    assert.ok(levelsIndex >= 0, 'game should contain LEVELS section');

    const levels = [];
    let index = levelsIndex + 1;
    while (index < lines.length && /^=+$/.test(lines[index].trim())) {
        index += 1;
    }

    while (index < lines.length) {
        while (index < lines.length && lines[index].trim() === '') {
            index += 1;
        }
        if (index >= lines.length) {
            break;
        }
        if (/^[A-Z_]+$/i.test(lines[index].trim()) && lines[index].trim().toLowerCase() !== 'message') {
            break;
        }

        if (lines[index].trim().toLowerCase().startsWith('message ')) {
            levels.push({ message: lines[index].trim().slice('message '.length), rows: [] });
            index += 1;
            continue;
        }

        let solution = null;
        if (lines[index].trim().startsWith('(solution:')) {
            solution = parseSolutionComment(lines[index].trim());
            index += 1;
        }

        const rows = [];
        while (index < lines.length) {
            const row = lines[index];
            if (row.trim() === '') {
                index += 1;
                break;
            }
            if (row.trim().startsWith('(solution:') || row.trim().toLowerCase().startsWith('message ')) {
                break;
            }
            rows.push(row);
            index += 1;
        }
        levels.push({ solution, rows });
    }
    return levels;
}

function countOccupiedGlyphs(rows) {
    let count = 0;
    for (const row of rows) {
        for (const ch of row) {
            if (ch !== '.' && ch !== ' ') {
                count += 1;
            }
        }
    }
    return count;
}

const inputSource = fs.readFileSync(gamePath, 'utf8');
const run = spawnSync(
    simplifyPath,
    [gamePath, '--out', outPath, '--solver-timeout-ms', '5000', '--simplify-timeout-ms', '10000'],
    { encoding: 'utf8' }
);
assert.strictEqual(run.status, 0, run.stderr || run.stdout);

const outputSource = fs.readFileSync(outPath, 'utf8');
assert.strictEqual(
    preludeBeforeLevels(inputSource),
    preludeBeforeLevels(outputSource),
    'non-LEVELS prelude should be unchanged'
);

const inputLevels = parseLevels(inputSource);
const outputLevels = parseLevels(outputSource);
assert.strictEqual(outputLevels.length, inputLevels.length, 'level count should be unchanged');

const compiled = compileGameFile(outPath);
let playableIndex = 0;
for (let levelIndex = 0; levelIndex < inputLevels.length; levelIndex += 1) {
    const inputLevel = inputLevels[levelIndex];
    const outputLevel = outputLevels[levelIndex];

    if (inputLevel.message !== undefined) {
        assert.strictEqual(outputLevel.message, inputLevel.message, 'message screens preserved');
        continue;
    }

    const inputCount = countOccupiedGlyphs(inputLevel.rows);
    const outputCount = countOccupiedGlyphs(outputLevel.rows);
    assert.ok(outputCount <= inputCount, `level ${levelIndex} object count increased`);

    assert.ok(outputLevel.solution, `level ${levelIndex} should have solution comment`);
    const replay = replaySolutionOnCurrentCompiledState(compiled.game, playableIndex, outputLevel.solution);
    assert.strictEqual(replay.status, 'solved', `level ${levelIndex} solution should replay to win`);
    playableIndex += 1;
}

console.log('simplify smoke passed');
