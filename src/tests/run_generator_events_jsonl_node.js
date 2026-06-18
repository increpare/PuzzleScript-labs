#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const generator = process.argv[2];
const repoRoot = process.argv[3] || path.resolve(__dirname, '..', '..');
assert(generator, 'usage: run_generator_events_jsonl_node.js <puzzlescript_generator> [repoRoot]');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-generator-events-'));
const gamePath = path.join(tmp, 'game.txt');
const specPath = path.join(tmp, 'recipe.gen');
const eventsPath = path.join(tmp, 'events.jsonl');
const resultPath = path.join(tmp, 'result.json');

fs.writeFileSync(gamePath, [
    'title Event Stream',
    '',
    'objects',
    'Background',
    'black',
    'Player',
    'blue',
    'Target',
    'green',
    '',
    'legend',
    '. = Background',
    'P = Player',
    'T = Target',
    '',
    'collisionlayers',
    'Background',
    'Player',
    'Target',
    '',
    'rules',
    '[ > Player | Target ] -> [ > Player | Target ]',
    '',
    'winconditions',
    'some Player on Target',
    '',
    'levels',
    'P.T',
].join('\n'), 'utf8');

fs.writeFileSync(specPath, [
    '(INIT LEVEL)',
    'P.T',
    '',
    '(GENERATION RULES)',
    'choose 1 [ player | no player no target ] -> [ | player ]',
].join('\n'), 'utf8');

const result = childProcess.spawnSync(generator, [
    gamePath,
    specPath,
    '--samples', '3',
    '--time-ms', '5000',
    '--jobs', '1',
    '--seed', '1',
    '--solver-timeout-ms', '100',
    '--top-k', '3',
    '--events-jsonl', eventsPath,
    '--json-out', resultPath,
    '--quiet',
], {
    cwd: repoRoot,
    encoding: 'utf8',
});

assert.strictEqual(result.status, 0, result.stderr || result.stdout);
assert(fs.existsSync(resultPath), 'result JSON should be written');
assert(fs.existsSync(eventsPath), 'events JSONL should be written');

const lines = fs.readFileSync(eventsPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
assert(lines.length > 0, 'expected at least one candidate event');
const event = JSON.parse(lines[0]);
assert.strictEqual(event.event, 'candidate_evaluated');
assert.strictEqual(typeof event.sample_id, 'number');
assert.strictEqual(typeof event.level_hash, 'number');
assert(['solved', 'timeout', 'exhausted', 'level_error'].includes(event.status), event.status);
assert.strictEqual(event.width, 3);
assert.strictEqual(event.height, 1);
assert(Array.isArray(event.cells), 'cells should be serialized for host scheduling');
assert.strictEqual(event.cells.length, 1);
assert.strictEqual(typeof event.unique_states, 'number');
assert.strictEqual(typeof event.expanded, 'number');
assert.strictEqual(typeof event.generated, 'number');
if (event.status === 'solved') {
    assert(Array.isArray(event.solution), 'solved event should include a solution array');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('generator events jsonl test passed');
