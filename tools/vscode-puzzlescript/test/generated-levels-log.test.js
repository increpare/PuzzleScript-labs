#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    GeneratedLevelsLog,
    formatGeneratedLevelBlock,
} = require('../src/puzzlescriptGeneratedLevelsLog');

const entry = {
    timestamp: '2026-06-18T12:00:00.000Z',
    sourceFile: 'game.txt',
    batchId: 'batch-1',
    sourceLevel: 2,
    levelHash: 12345,
    rankWhenLogged: 1,
    effortScore: 77,
    solverStatus: 'solved',
    solverStrategy: 'portfolio',
    solverBudgetMs: 1000,
    solutionLength: 4,
    solution: ['up', 'right', 'down', 'left'],
    expanded: 55,
    generated: 99,
    uniqueStates: 77,
    recipeText: 'choose 1 [ player ] -> [ player ]',
    rows: ['#####', '#P.O#', '#####'],
};

const block = formatGeneratedLevelBlock(entry);
assert(block.includes('===== GENERATED LEVEL 2026-06-18T12:00:00.000Z ====='));
assert(block.includes('source_file: game.txt'));
assert(block.includes('level_hash: 12345'));
assert(block.includes('solution: up right down left'));
assert(block.includes('recipe:\n  choose 1 [ player ] -> [ player ]'));
assert(block.includes('level:\n#####\n#P.O#\n#####'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-generated-log-'));
const logPath = path.join(tmp, 'game.generatedlevels.txt');
const log = new GeneratedLevelsLog(logPath);
assert.strictEqual(log.appendIfNewTopSolved(entry), true);
assert.strictEqual(log.appendIfNewTopSolved(entry), false, 'same hash should not append twice');
assert.strictEqual(log.appendIfNewTopSolved({ ...entry, levelHash: 999, solverStatus: 'timeout' }), false);
const text = fs.readFileSync(logPath, 'utf8');
assert.strictEqual((text.match(/GENERATED LEVEL/g) || []).length, 1);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('generated levels log tests passed');
