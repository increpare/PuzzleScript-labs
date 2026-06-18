#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { PuzzleScriptGeneratorRun } = require('../src/puzzlescriptGeneratorRunner');

function writeExecutable(dir, name, body) {
    const script = path.join(dir, name);
    fs.writeFileSync(script, `#!/usr/bin/env node\n${body}`, 'utf8');
    fs.chmodSync(script, 0o755);
    return script;
}

async function runTests() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-generator-runner-test-'));
    const success = writeExecutable(tmp, 'success.js', `
const fs = require('fs');
const jsonOut = process.argv[process.argv.indexOf('--json-out') + 1];
console.error('generator_progress elapsed_s=0.1 jobs=1 top=1 samples=2 valid=2 solved=1');
fs.writeFileSync(jsonOut, JSON.stringify({ totals: { samples_attempted: 2 }, top: [] }));
`);
    const seenProgress = [];
    const goodRun = new PuzzleScriptGeneratorRun({
        binaryPath: success,
        sourceText: 'title T\\nlevels\\nP',
        specText: '(INIT LEVEL)\\nP\\n\\n(GENERATION RULES)\\nchoose 1 [ player ] -> [ player ]',
        runOptions: {
            timeMs: 10,
            jobs: 1,
            seed: 1,
            solverTimeoutMs: 10,
            solverStrategy: 'portfolio',
            topK: 1,
            samples: '',
        },
        onProgress: progress => seenProgress.push(progress),
    });
    const good = await goodRun.start();
    assert.strictEqual(good.cancelled, false);
    assert.deepStrictEqual(good.result, { totals: { samples_attempted: 2 }, top: [] });
    assert.strictEqual(fs.existsSync(good.tempDir), false);
    assert.strictEqual(seenProgress[0].samples, 2);

    const noEventsFlag = writeExecutable(tmp, 'no-events-flag.js', `
const fs = require('fs');
if (process.argv.includes('--events-jsonl')) {
    console.error('unexpected events flag');
    process.exit(3);
}
const jsonOut = process.argv[process.argv.indexOf('--json-out') + 1];
fs.writeFileSync(jsonOut, JSON.stringify({ totals: { samples_attempted: 1 }, top: [] }));
`);
    const compatRun = new PuzzleScriptGeneratorRun({
        binaryPath: noEventsFlag,
        sourceText: 'title T\\nlevels\\nP',
        specText: '(INIT LEVEL)\\nP\\n\\n(GENERATION RULES)\\nchoose 1 [ player ] -> [ player ]',
        runOptions: {
            timeMs: 10,
            jobs: 1,
            seed: 1,
            solverTimeoutMs: 10,
            solverStrategy: 'portfolio',
            topK: 1,
            samples: '',
        },
    });
    const compat = await compatRun.start();
    assert.deepStrictEqual(compat.result, { totals: { samples_attempted: 1 }, top: [] });

    const eventing = writeExecutable(tmp, 'eventing.js', `
const fs = require('fs');
const jsonOut = process.argv[process.argv.indexOf('--json-out') + 1];
const eventsOut = process.argv[process.argv.indexOf('--events-jsonl') + 1];
fs.appendFileSync(eventsOut, JSON.stringify({ event: 'candidate_evaluated', level_hash: 1, status: 'timeout', unique_states: 9, cells: [['player']] }) + '\\n');
fs.writeFileSync(jsonOut, JSON.stringify({ totals: { samples_attempted: 1 }, top: [] }));
`);
    const seenEvents = [];
    const eventRun = new PuzzleScriptGeneratorRun({
        binaryPath: eventing,
        sourceText: 'title T\\nlevels\\nP',
        specText: '(INIT LEVEL)\\nP\\n\\n(GENERATION RULES)\\nchoose 1 [ player ] -> [ player ]',
        runOptions: {
            timeMs: 10,
            jobs: 1,
            seed: 1,
            solverTimeoutMs: 10,
            solverStrategy: 'portfolio',
            topK: 1,
            samples: '',
        },
        onCandidateEvent: event => seenEvents.push(event),
    });
    await eventRun.start();
    assert.strictEqual(seenEvents.length, 1);
    assert.strictEqual(seenEvents[0].status, 'timeout');

    const callbackThrowRun = new PuzzleScriptGeneratorRun({
        binaryPath: eventing,
        sourceText: 'title T\\nlevels\\nP',
        specText: '(INIT LEVEL)\\nP\\n\\n(GENERATION RULES)\\nchoose 1 [ player ] -> [ player ]',
        runOptions: {
            timeMs: 10,
            jobs: 1,
            seed: 1,
            solverTimeoutMs: 10,
            solverStrategy: 'portfolio',
            topK: 1,
            samples: '',
        },
        onCandidateEvent: () => {
            throw new Error('event callback failed');
        },
    });
    const callbackThrow = await callbackThrowRun.start();
    assert.deepStrictEqual(callbackThrow.result, { totals: { samples_attempted: 1 }, top: [] });
    assert.strictEqual(callbackThrow.warnings.length, 1);
    assert.match(callbackThrow.warnings[0], /event callback failed/);

    const malformedEvents = writeExecutable(tmp, 'malformed-events.js', `
const fs = require('fs');
const jsonOut = process.argv[process.argv.indexOf('--json-out') + 1];
const eventsOut = process.argv[process.argv.indexOf('--events-jsonl') + 1];
fs.writeFileSync(eventsOut, '{not-json}\\n');
fs.writeFileSync(jsonOut, JSON.stringify({ totals: { samples_attempted: 1 }, top: [] }));
`);
    const malformedRun = new PuzzleScriptGeneratorRun({
        binaryPath: malformedEvents,
        sourceText: 'title T\\nlevels\\nP',
        specText: '(INIT LEVEL)\\nP\\n\\n(GENERATION RULES)\\nchoose 1 [ player ] -> [ player ]',
        runOptions: {
            timeMs: 10,
            jobs: 1,
            seed: 1,
            solverTimeoutMs: 10,
            solverStrategy: 'portfolio',
            topK: 1,
            samples: '',
        },
        onCandidateEvent: () => {},
    });
    const malformed = await malformedRun.start();
    assert.deepStrictEqual(malformed.result, { totals: { samples_attempted: 1 }, top: [] });
    assert.strictEqual(malformed.warnings.length, 1);
    assert.match(malformed.warnings[0], /candidate events/);

    const failure = writeExecutable(tmp, 'failure.js', `
console.error('bad spec');
process.exit(2);
`);
    const badRun = new PuzzleScriptGeneratorRun({
        binaryPath: failure,
        sourceText: '',
        specText: '',
        runOptions: {
            timeMs: 10,
            jobs: 1,
            seed: 1,
            solverTimeoutMs: 10,
            solverStrategy: 'portfolio',
            topK: 1,
            samples: '',
        },
    });
    await assert.rejects(() => badRun.start(), /bad spec/);

    const slow = writeExecutable(tmp, 'slow.js', `
setTimeout(() => {}, 10000);
`);
    const slowRun = new PuzzleScriptGeneratorRun({
        binaryPath: slow,
        sourceText: '',
        specText: '',
        runOptions: {
            timeMs: 10000,
            jobs: 1,
            seed: 1,
            solverTimeoutMs: 10,
            solverStrategy: 'portfolio',
            topK: 1,
            samples: '',
        },
    });
    const pending = slowRun.start();
    setTimeout(() => slowRun.cancel(), 50);
    const cancelled = await pending;
    assert.strictEqual(cancelled.cancelled, true);
    assert.strictEqual(fs.existsSync(cancelled.tempDir), false);

    fs.rmSync(tmp, { recursive: true, force: true });
}

runTests().then(() => {
    console.log('generator runner tests passed');
}).catch(error => {
    console.error(error);
    process.exit(1);
});
