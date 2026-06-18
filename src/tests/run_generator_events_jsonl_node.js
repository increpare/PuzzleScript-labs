#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const generator = process.argv[2];
const repoRoot = process.argv[3] || path.resolve(__dirname, '..', '..');
assert(generator, 'usage: run_generator_events_jsonl_node.js <puzzlescript_generator> [repoRoot]');

function writeFixture(tmp) {
    const gamePath = path.join(tmp, 'game.txt');
    const specPath = path.join(tmp, 'recipe.gen');
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

    return { gamePath, specPath };
}

function runGenerator(args) {
    return childProcess.spawnSync(generator, args, {
        cwd: repoRoot,
        encoding: 'utf8',
    });
}

function validateEvent(event) {
    assert.strictEqual(event.event, 'candidate_evaluated');
    assert.strictEqual(typeof event.sample_id, 'number');
    assert.strictEqual(typeof event.seed, 'number');
    assert.strictEqual(typeof event.sample_seed, 'number');
    assert.strictEqual(event.sample_seed, event.seed);
    assert.strictEqual(typeof event.level_hash, 'number');
    assert(['solved', 'timeout', 'exhausted', 'level_error'].includes(event.status), event.status);
    assert.strictEqual(typeof event.solver_budget_ms, 'number');
    assert.strictEqual(typeof event.unique_states, 'number');
    assert.strictEqual(typeof event.expanded, 'number');
    assert.strictEqual(typeof event.generated, 'number');
    assert.strictEqual(typeof event.duplicates, 'number');
    assert.strictEqual(typeof event.solution_length, 'number');
    assert.strictEqual(typeof event.solver_iterations, 'number');
    assert.strictEqual(event.solver_iterations, event.expanded);
    assert.strictEqual(typeof event.effort_score, 'number');
    assert.strictEqual(event.effort_score, event.unique_states);
    assert.strictEqual(typeof event.solve_ms, 'number');
    assert(event.solve_ms >= 0, `solve_ms should be non-negative, got ${event.solve_ms}`);
    assert.strictEqual(event.width, 3);
    assert.strictEqual(event.height, 1);
    assert(Array.isArray(event.cells), 'cells should be serialized for host scheduling');
    assert.strictEqual(event.cells.length, 1);
    assert.strictEqual(event.cells[0].length, 3);
    assert.strictEqual(typeof event.filled_cells, 'number');
    const filledCells = event.cells.flat().filter(Boolean).length;
    assert.strictEqual(event.filled_cells, filledCells);
    assert(Array.isArray(event.solution), 'solution should always be serialized');
    assert.strictEqual(event.solution.length, event.solution_length);
    if (event.status === 'solved') {
        assert(event.solution.length > 0, 'solved event should include a non-empty solution array');
    }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-generator-events-'));
try {
    const { gamePath, specPath } = writeFixture(tmp);
    const eventsPath = path.join(tmp, 'events.jsonl');
    const resultPath = path.join(tmp, 'result.json');

    fs.writeFileSync(eventsPath, '{"stale":true}\n', 'utf8');
    const result = runGenerator([
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
    ]);

    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(result.signal, null, 'success path should not exit via signal');
    assert(fs.existsSync(resultPath), 'result JSON should be written');
    assert(fs.existsSync(eventsPath), 'events JSONL should be written');

    const rawEvents = fs.readFileSync(eventsPath, 'utf8');
    assert(!rawEvents.includes('"stale":true'), 'old JSONL content should be truncated before the run');
    const lines = rawEvents.trim().split(/\r?\n/).filter(Boolean);
    assert(lines.length > 0, 'expected at least one candidate event');
    for (const line of lines) {
        validateEvent(JSON.parse(line));
    }

    const badEventsDir = path.join(tmp, 'events-dir');
    fs.mkdirSync(badEventsDir);
    const badResult = runGenerator([
        gamePath,
        specPath,
        '--samples', '1',
        '--time-ms', '5000',
        '--jobs', '1',
        '--seed', '1',
        '--solver-timeout-ms', '100',
        '--top-k', '1',
        '--events-jsonl', badEventsDir,
        '--json-out', resultPath,
        '--quiet',
    ]);

    assert.notStrictEqual(badResult.status, 0, 'invalid events path should fail');
    assert.strictEqual(badResult.signal, null, 'invalid events path should fail cleanly without terminate');
    const failureText = `${badResult.stderr}\n${badResult.stdout}`;
    assert(/Failed to (initialize|write) generator events/.test(failureText), failureText);
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('generator events jsonl test passed');
