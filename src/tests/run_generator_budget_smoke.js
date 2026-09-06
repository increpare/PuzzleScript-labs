#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const binary = path.resolve(process.argv[2]);
const root = path.resolve(__dirname, '../..');
const game = path.join(root, 'src/demo/sokoban_basic.txt');
const spec = path.join(__dirname, 'generator_presets/sokoban_levelset_tiny.gen');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'psgen-budget-'));
let runId = 0;
function run(args, expectedStatus = 0) {
    const out = path.join(tmp, `game-${++runId}.txt`);
    const report = path.join(tmp, `report-${runId}.json`);
    const result = spawnSync(binary, [game, spec, '--out', out, '--json-out', report,
        '--solver-timeout-ms', '60000', '--inactivity-start', '60s', ...args],
        { encoding: 'utf8', timeout: 6000, windowsHide: true });
    assert(!result.error, String(result.error));
    assert.strictEqual(result.status, expectedStatus, result.stderr);
    if (expectedStatus !== 0) return result;
    assert(fs.existsSync(out), 'bounded runs must flush their generated game');
    return JSON.parse(fs.readFileSync(report, 'utf8'));
}
try {
    // Intentionally not quiet: joining the progress reporter used to add ten
    // seconds to short runs. More workers than each block's allocation also
    // catches reservation overshoot and cancellation of the last candidates.
    const sampled = run(['--samples', '7', '--jobs', '8']);
    assert.strictEqual(sampled.stop_reason, 'samples');
    assert.strictEqual(sampled.totals.samples_attempted, 7);
    assert.deepStrictEqual(sampled.blocks.map(b => b.samples_attempted), [4, 3]);
    assert.strictEqual(sampled.totals.interrupted_assessments, 0);
    const zero = run(['--samples', '0']);
    assert.strictEqual(zero.totals.samples_attempted, 0);
    assert.strictEqual(zero.stop_reason, 'samples');
    const timed = run(['--time-ms', '120', '--samples', '10000000', '--jobs', '2']);
    assert.strictEqual(timed.stop_reason, 'deadline');
    assert(timed.elapsed_ms < 5000, 'all lanes must obey the global deadline');
    assert(timed.totals.samples_attempted < 10000000);
    assert(/requires.*portfolio/.test(run(['--samples', '1', '--solver-strategy', 'bfs'], 1).stderr));
    const legacyReport = path.join(tmp, 'legacy.json');
    const legacy = spawnSync(binary, [game, path.join(__dirname, 'generator_presets/sokoban_room_scatter.gen'),
        '--time-ms', '120', '--samples', '100000', '--solver-timeout-ms', '60000',
        '--json-out', legacyReport, '--quiet'], { encoding: 'utf8', timeout: 6000, windowsHide: true });
    assert(!legacy.error, String(legacy.error));
    assert.strictEqual(legacy.status, 0, legacy.stderr);
    assert(JSON.parse(fs.readFileSync(legacyReport, 'utf8')).totals.samples_attempted < 100000);
    // Completion can race ahead of the coordinator's first wait. Exercise
    // immediate completion and a quota smaller than the worker count; joins
    // must preserve the last admitted samples instead of cancelling their work.
    for (const samples of [0, 3]) {
        const completed = spawnSync(binary, [game, path.join(__dirname, 'generator_presets/sokoban_room_scatter.gen'),
            '--samples', String(samples), '--jobs', '8', '--solver-timeout-ms', '100',
            '--json-out', legacyReport, '--quiet'], { encoding: 'utf8', timeout: 6000, windowsHide: true });
        assert(!completed.error, String(completed.error));
        assert.strictEqual(completed.status, 0, completed.stderr);
        assert.strictEqual(JSON.parse(fs.readFileSync(legacyReport, 'utf8')).totals.samples_attempted, samples);
    }
    console.log('Generator sample/deadline/report contracts pass.');
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
