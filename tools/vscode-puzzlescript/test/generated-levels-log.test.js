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

function countLoggedBlocks(text) {
    return (text.match(/GENERATED LEVEL/g) || []).length;
}

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
assert.strictEqual(log.appendIfNewTopSolved({ ...entry, levelHash: 54321, rankWhenLogged: 2 }), true);
assert.strictEqual(countLoggedBlocks(fs.readFileSync(logPath, 'utf8')), 2);

const exactHashEntry = {
    ...entry,
    levelHash: 12345,
    levelHashHex: '00000000000000000000000000003039',
};
const exactHashBlock = formatGeneratedLevelBlock(exactHashEntry);
assert(exactHashBlock.includes('level_hash_hex: 00000000000000000000000000003039'));
assert(exactHashBlock.includes('level_hash: 12345'));

const exactLogPath = path.join(tmp, 'nested', 'logs', 'game.generatedlevels.txt');
const exactLog = new GeneratedLevelsLog(exactLogPath);
assert.strictEqual(exactLog.appendIfNewTopSolved(exactHashEntry), true);
assert.strictEqual(
    exactLog.appendIfNewTopSolved({ ...exactHashEntry, levelHash: 54321 }),
    false,
    'same exact hex hash should dedupe even if numeric hash changes'
);
assert.strictEqual(
    exactLog.appendIfNewTopSolved({
        ...exactHashEntry,
        levelHashHex: '00000000000000000000000000000002',
    }),
    true,
    'distinct exact hex hash should append even if numeric hash matches'
);
assert.strictEqual(
    exactLog.appendIfNewTopSolved({
        ...exactHashEntry,
        levelHash: 99999,
        levelHashHex: undefined,
        level_hash_hex: '00000000000000000000000000000003',
    }),
    true,
    'snake_case exact hex hash should be used for identity'
);
const exactText = fs.readFileSync(exactLogPath, 'utf8');
assert.strictEqual(countLoggedBlocks(exactText), 3);
assert(exactText.includes('level_hash_hex: 00000000000000000000000000000003'));

const missingHashPath = path.join(tmp, 'missing.generatedlevels.txt');
const missingHashLog = new GeneratedLevelsLog(missingHashPath);
const missingHashEntry = { ...entry, levelHash: undefined };
assert.strictEqual(missingHashLog.appendIfNewTopSolved(missingHashEntry), false);
assert.strictEqual(fs.existsSync(missingHashPath), false);

const blockedParentPath = path.join(tmp, 'not-a-directory');
fs.writeFileSync(blockedParentPath, 'file where directory should be', 'utf8');
const retryLog = new GeneratedLevelsLog(path.join(blockedParentPath, 'game.generatedlevels.txt'));
const retryEntry = {
    ...entry,
    levelHash: 777,
    levelHashHex: '00000000000000000000000000000777',
};
assert.throws(() => retryLog.appendIfNewTopSolved(retryEntry), /ENOTDIR|EEXIST/);
retryLog.logPath = path.join(tmp, 'retry.generatedlevels.txt');
assert.strictEqual(retryLog.appendIfNewTopSolved(retryEntry), true);
assert.strictEqual(countLoggedBlocks(fs.readFileSync(retryLog.logPath, 'utf8')), 1);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('generated levels log tests passed');
