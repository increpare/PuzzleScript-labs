#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

const {
    compileGameFile,
    parseArgs,
} = require('./run_solver_tests_js');

const parsed = parseArgs([
    'node',
    'run_solver_tests_js.js',
    'src/tests/solver_tests',
    '--solver-certified-wake-prune',
]);
assert.strictEqual(
    parsed.solverCertifiedWakePrune,
    true,
    'CLI should enable certified wake-mask pruning'
);

const compiled = compileGameFile(path.join(__dirname, 'solver_tests', 'karamell.txt'), {
    quiet: true,
    solverCertifiedWakePrune: true,
});
assert.ok(
    compiled.certifiedWakePruneAttachment && compiled.certifiedWakePruneAttachment.complete,
    'certified wake-mask pruning should attach masks while compiling Karamell'
);
assert.strictEqual(
    process.env.PUZZLESCRIPT_INCREMENTAL_PRUNE,
    '1',
    'certified wake-mask pruning should enable the incremental prune loop it specializes'
);
assert.ok(
    state.rules[21][0].certifiedReadMovements.anyBitsInCommon(state.rules[21][4].certifiedWriteMovements),
    'Karamell line 444 moving reader should be woken by line 448 certified propagation writes'
);
assert.ok(
    state.rules[21][2].certifiedReadMovements.anyBitsInCommon(state.rules[21][4].certifiedWriteMovements),
    'Karamell line 446 moving reader should be woken by line 448 certified propagation writes'
);

function movementMask(bitIndex) {
    const mask = new BitVec(STRIDE_MOV);
    mask.ibitset(bitIndex);
    return mask;
}

function objectMask(bitIndex = null) {
    const mask = new BitVec(STRIDE_OBJ);
    if (bitIndex !== null) {
        mask.ibitset(bitIndex);
    }
    return mask;
}

process.env.PUZZLESCRIPT_INCREMENTAL_PRUNE = '1';
process.env.PUZZLESCRIPT_CERTIFIED_WAKE_PRUNE = '1';
const certifiedWriterWake = movementMask(0);
const readerWake = movementMask(1);
const emptyMovements = new BitVec(STRIDE_MOV);
const emptyObjects = objectMask();
const writerReadObjects = objectMask(0);
let writerCalls = 0;
let readerCalls = 0;
const directGroup = [
    {
        isRandom: false,
        forceAlwaysRun: false,
        readObjects: writerReadObjects,
        readMovements: emptyMovements,
        writeObjects: emptyObjects,
        writeMovements: readerWake,
        certifiedReadMovements: emptyMovements,
        certifiedWriteMovements: certifiedWriterWake,
        hasCertifiedWakePruneMasks: true,
        tryApply() {
            writerCalls++;
            return writerCalls === 1;
        },
    },
    {
        isRandom: false,
        forceAlwaysRun: false,
        readObjects: emptyObjects,
        readMovements: readerWake,
        writeObjects: emptyObjects,
        writeMovements: emptyMovements,
        certifiedReadMovements: readerWake,
        certifiedWriteMovements: emptyMovements,
        hasCertifiedWakePruneMasks: true,
        tryApply() {
            readerCalls++;
            return false;
        },
    },
];
applyRuleGroup(directGroup);
assert.strictEqual(writerCalls, 1, 'direct writer should only apply during the all-ones seed loop');
assert.strictEqual(
    readerCalls,
    1,
    'certified movement-aware prune should skip a movement reader when certified writes do not wake it'
);

process.stdout.write('solver_certified_wake_prune_node: ok\n');
