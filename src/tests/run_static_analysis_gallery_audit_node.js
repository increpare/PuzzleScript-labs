#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadManifest, markCaseTimeout } = require('./run_static_analysis_gallery_audit');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-gallery-audit-'));
try {
    const fixture = fs.readFileSync(path.join(__dirname, 'static_analysis_testdata/rule_tags/match-interactions.txt'), 'utf8');
    const source = fixture.replace(/RULES\n[\s\S]*?\nWINCONDITIONS/, 'RULES\n[ alpha ] -> [ beta ]\n\nWINCONDITIONS')
        .replace(/LEVELS\n[\s\S]*$/, 'LEVELS\na\n\nmessage hello\n\naa\n');
    fs.writeFileSync(path.join(root, 'tiny.txt'), source);
    const sha256 = require('node:crypto').createHash('sha256').update(source).digest('hex');
    const manifest = path.join(root, 'manifest.json');
    const payload = { entries: [{ title: 'Tiny', sourceFile: 'tiny.txt', sha256, status: 'ready' }] };
    fs.writeFileSync(manifest, JSON.stringify(payload));
    assert.equal(loadManifest(manifest)[0].sha256, sha256);
    const out = path.join(root, 'output');
    const run = spawnSync(process.execPath, [path.join(__dirname, 'run_static_analysis_gallery_audit.js'),
        '--manifest', manifest, '--out', out, '--jobs', '1', '--iterations', '1', '--input-length', '4',
        '--max-probes', '100', '--timeout-ms', '30000'], { encoding: 'utf8', timeout: 40000 });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    const summary = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'));
    assert.equal(summary.gamesCompleted, 1);
    assert.equal(summary.playableLevels, 2);
    assert.equal(summary.casesPassed, 4, 'both modes must run on both playable levels');
    const game = JSON.parse(fs.readFileSync(path.join(out, 'game-0.json'), 'utf8'));
    assert.deepEqual(game.levels, [0, 2], 'message levels are excluded, not later playable levels');
    assert(game.coverage.find(row => row.id === 'rule.self_disabling').checks > 0);
    assert(game.coverage.find(row => row.id === 'game.has_random').checks > 0, 'seeded deterministic traces receive alternate-seed checks');
    assert(game.coverage.some(row => row.status === 'unchecked'), 'uncovered claims remain visible');
    const resumeArgs = [path.join(__dirname, 'run_static_analysis_gallery_audit.js'), '--manifest', manifest,
        '--out', out, '--jobs', '1', '--iterations', '1', '--input-length', '4', '--max-probes', '100',
        '--timeout-ms', '30000', '--resume'];
    const resumed = spawnSync(process.execPath, resumeArgs, { encoding: 'utf8', timeout: 40000 });
    assert.equal(resumed.status, 0, resumed.stderr);
    const changed = spawnSync(process.execPath, resumeArgs.concat(['--seed', 'changed']), { encoding: 'utf8', timeout: 40000 });
    assert.equal(changed.status, 1);
    assert.match(changed.stderr, /Resume configuration/);
    const partial = { casesAttempted: 2, casesPassed: 1, traces: [{ levelIndex: 0, iteration: 0, inputMode: 'forward' }],
        failures: [], activeCase: { levelIndex: 0, iteration: 0, inputMode: 'mixed', seed: 123, inputs: [1] } };
    markCaseTimeout(partial, 20);
    assert.equal(partial.failures[0].kind, 'case-timeout');
    assert.equal(partial.failures[0].seed, 123);
    assert.equal(partial.activeCase, undefined);
    assert.equal(partial.traces.length, 1, 'passed traces survive worker continuation');
    const timedOut = spawnSync(process.execPath, [path.join(__dirname, 'run_static_analysis_gallery_audit.js'),
        '--manifest', manifest, '--out', path.join(root, 'bounded'), '--jobs', '1', '--iterations', '1',
        '--input-length', '4', '--case-timeout-ms', '1', '--timeout-ms', '30000'],
    { encoding: 'utf8', timeout: 40000 });
    const bounded = JSON.parse(fs.readFileSync(path.join(root, 'bounded', 'summary.json'), 'utf8'));
    assert.equal(bounded.gamesCompleted, 1, timedOut.stderr);
    assert.equal(bounded.casesAttempted, 4, 'timed-out cases are not retried forever');
    assert.equal(bounded.casesPassed + bounded.timeoutCases, 4);
    assert(bounded.timeoutCases > 0, 'the parent watchdog must actually interrupt a worker');
    for (const limit of [20, 50]) {
        const finalization = spawnSync(process.execPath, [path.join(__dirname, 'run_static_analysis_gallery_audit.js'),
            '--manifest', manifest, '--out', path.join(root, `finalization-${limit}`), '--jobs', '1', '--iterations', '1',
            '--input-length', '1', '--max-probes', '0', '--case-timeout-ms', String(limit)],
        { encoding: 'utf8', timeout: 40000 });
        const finalized = JSON.parse(fs.readFileSync(path.join(root, `finalization-${limit}`, 'summary.json'), 'utf8'));
        assert.equal(finalized.gamesCompleted, 1, finalization.stderr);
        assert.equal(finalized.interruptedGames, 0, 'completed traces must disarm their watchdog before finalization');
    }
    payload.entries[0].sha256 = 'wrong';
    fs.writeFileSync(manifest, JSON.stringify(payload));
    assert.throws(() => loadManifest(manifest), /hash mismatch/);
    console.log('run_static_analysis_gallery_audit_node: ok');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
