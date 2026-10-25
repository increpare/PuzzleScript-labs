import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, copyFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource, SourceCompilationKind } from '../build/source-compiler.js';
import { Movement } from '../build/model.js';
import { createSession } from '../build/session.js';
import { applyTurnRules } from '../build/turn-rules.js';

// Newly written small game; no native fixtures or test adapters supply its behavior.
const pushingSource = `title A tiny parcel
objects
Background .
black

Player P
white

Crate C
orange

Wall #
gray

legend
sounds
collisionlayers
Background
Player, Crate, Wall
rules
[ > Player | Crate ] -> [ > Player | > Crate ]
winconditions
levels
#######
#PC...#
#######
`;
const tracePath = fileURLToPath(new URL('../bin/trace.mjs', import.meta.url));

function withSource(source, run) {
  const directory = mkdtempSync(join(tmpdir(), 'puzzlescript-source-trace-'));
  try {
    const path = join(directory, 'game.ps');
    writeFileSync(path, source);
    return run(path);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
function command(path, inputs = [], options = []) {
  return spawnSync(process.execPath, ['--enable-source-maps', tracePath, ...options, path, ...inputs], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
const records = result => result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const observations = result => records(result).filter(record => record.type === 'observation');
const positions = (observation, name) => observation.board.rows.flatMap((row, y) =>
  row.flatMap((cell, x) => cell.objects.some(object => object.name === name) ? [{ x, y }] : []));

test('source trace really pushes, undoes, restarts and records each requested operation', () => {
  withSource(pushingSource, path => {
    const result = command(path, ['right', 'undo', 'restart', 'right', 'right'], ['--seed', 'example', '--level', '0']);
    assert.equal(result.status, 0, result.stderr);
    const seen = observations(result);
    assert.deepEqual(seen.map(record => record.input), ['initial', 'right', 'undo', 'restart', 'right', 'right']);
    assert.deepEqual(seen.map(record => positions(record, 'player')), [1, 2, 1, 1, 2, 3].map(x => [{ x, y: 1 }]));
    assert.deepEqual(seen.map(record => positions(record, 'crate')), [2, 3, 2, 2, 3, 4].map(x => [{ x, y: 1 }]));
    assert.deepEqual(seen.map(record => record.historyLength), [0, 1, 0, 1, 2, 3]);
  });
});

test('all accepted input words map explicitly to movement or session operations', () => {
  const source = pushingSource.replace('#PC...#', '#..P..#').replace('#######\n#..P..#\n#######', '.......\n...P...\n.......');
  withSource(source, path => {
    for (const [input, position] of [['up', [3, 0]], ['down', [3, 2]], ['left', [2, 1]], ['right', [4, 1]], ['action', [3, 1]], ['tick', [3, 1]]]) {
      const result = command(path, [input]);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(positions(observations(result).at(-1), 'player'), [{ x: position[0], y: position[1] }], input);
    }
  });
});

test('invalid options, levels and inputs fail with concise usage before compiling', () => {
  const cases = [[], ['--seed'], ['--level'], ['--seed', ''], ['--seed', '--level', '0'], ['--level', '-1'],
    ['--level', '1.5'], ['--level', '9007199254740992'], ['--mystery'], ['absent.ps', 'north'], ['absent.ps', '--seed', 'late']];
  for (const args of cases) {
    const result = spawnSync(process.execPath, [tracePath, ...args], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, args.join(' '));
    assert.match(result.stderr, /Usage: trace\.mjs/);
    assert.doesNotMatch(result.stderr, /ENOENT|at file:|node:internal/);
    assert.equal(result.stdout, '');
  }
});

test('compilation prints severity and exact authored line evidence, accepts recoverable errors', () => {
  const source = pushingSource.replace('Crate C\norange', 'Crate C\nnotacolor');
  withSource(source, path => {
    const result = command(path, ['right']);
    assert.equal(result.status, 0, result.stderr);
    const output = records(result);
    const issue = output.find(record => record.type === 'diagnostic' && record.severity === 'Error');
    assert.ok(issue);
    assert.equal(issue.source.path, path);
    assert.equal(issue.source.text, 'notacolor');
    assert.equal(source.split('\n')[issue.source.line - 1], issue.source.text);
    const accepted = output.find(record => record.type === 'compilation');
    assert.equal(accepted.outcome, 'Accepted');
    assert.ok(accepted.errorCount > 0);
    assert.deepEqual(positions(observations(result).at(-1), 'crate'), [{ x: 3, y: 1 }]);
  });
});

test('Declined, Invalid and Stopped compilation outcomes never run a session', () => {
  const cases = [
    ['Declined', pushingSource.replace('[ > Player | Crate ] -> [ > Player | > Crate ]', Array.from({ length: 7 }, (_, i) => `right [ Player Crate ] -> [ Player ] (distinct ${i})`).join('\n'))],
    ['Invalid', pushingSource.replace('Background\nPlayer, Crate, Wall\nrules', 'rules')],
    ['Stopped', pushingSource.replace('[ > Player | Crate ] -> [ > Player | > Crate ]', Array.from({ length: 110 }, (_, i) => `right [ Player Crate ] -> [ Player ] (distinct ${i})`).join('\n'))],
  ];
  for (const [outcome, source] of cases) withSource(source, path => {
    assert.equal(SourceCompilationKind[compileSource(source).outcome.kind], outcome, 'fixture outcome');
    const result = command(path, ['right']);
    assert.notEqual(result.status, 0);
    assert.equal(records(result).find(record => record.type === 'compilation').outcome, outcome);
    assert.deepEqual(observations(result), []);
    assert.match(result.stderr, new RegExp('Compilation ' + outcome));
  });
});

test('an absent requested level surfaces the actual MissingLevel diagnostic and fails', () => {
  withSource(pushingSource, path => {
    const result = command(path, ['right'], ['--level', '9']);
    assert.notEqual(result.status, 0);
    const seen = observations(result);
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].effects, [{ kind: 'Diagnostic', diagnostic: { origin: 'session', kind: 'MissingLevel' } }]);
    assert.equal(seen[0].screen.kind, 'Title');
    assert.match(result.stderr, /MissingLevel.*9/);
  });
});

test('seeded traces include full RNG state and deterministic seeds for later level loads', () => {
  const source = pushingSource.replace('[ > Player | Crate ] -> [ > Player | > Crate ]', '[ action Player ] -> [ Player ] win') + '\nP......\n';
  withSource(source, path => {
    const first = command(path, ['action', 'tick'], ['--seed', 'parcel']);
    const second = command(path, ['action', 'tick'], ['--seed', 'parcel']);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, second.stdout);
    const seen = observations(first);
    assert.equal(seen[0].loadedLevelSeed, 'parcel');
    assert.deepEqual(seen[0].seedsUsed, ['parcel']);
    assert.equal(seen[1].loadedLevelSeed, 'parcel:level:1');
    assert.deepEqual(seen[1].seedsUsed, ['parcel:level:1']);
    assert.deepEqual(seen[2].seedsUsed, []);
    for (const record of seen) {
      assert.equal(record.random.seed, record.loadedLevelSeed);
      assert.equal(record.random.permutation.length, 256);
      assert.equal(new Set(record.random.permutation).size, 256);
      assert.equal(typeof record.random.i, 'number');
      assert.equal(typeof record.random.j, 'number');
      assert.equal(record.screen.kind, 'Board');
      assert.deepEqual(record.pendingMovements, []);
      assert.deepEqual(record.remainingCommands.entries, []);
    }
    assert.ok(seen[1].effects.some(effect => effect.kind === 'Win'));
    assert.ok(seen[1].effects.some(effect => effect.kind === 'Persistence' && effect.operation === 'Progress'));
  });
});

// Newly written conveyor game: each automatic null turn moves one square.
const againSource = pushingSource.replace('[ > Player | Crate ] -> [ > Player | > Crate ]', 'random right [ Player | no Wall ] -> [ | Player ] again')
  .replace('#PC...#', '#P....#');
test('initial and later AGAIN turns are drained and emitted as separate substeps', () => {
  for (const onStart of [false, true]) {
    const source = onStart ? againSource.replace('objects', 'run_rules_on_level_start\nobjects') : againSource;
    withSource(source, path => {
      const result = command(path, onStart ? ['left'] : ['tick', 'left']);
      assert.equal(result.status, 0, result.stderr);
      const seen = observations(result);
      const repeatedInput = onStart ? 'initial' : 'tick';
      const substeps = seen.filter(record => record.input === repeatedInput);
      assert.deepEqual(substeps.map(record => record.substep), [0, 1, 2, 3]);
      assert.deepEqual(substeps.map(record => positions(record, 'player')), [2, 3, 4, 5].map(x => [{ x, y: 1 }]));
      assert.equal(seen.at(-1).input, 'left');
      assert.equal(seen.at(-1).againing, false);
    });
  }
});

test('an endless newly written AGAIN game fails after 10,000 automatic steps', () => {
  // Random groups apply once per turn: the only match alternates between two cells.
  const shuttle = pushingSource.replace('[ > Player | Crate ] -> [ > Player | > Crate ]',
    'random [ Player | no Player ] -> [ | Player ] again').replace('#######\n#PC...#\n#######', 'P.');
  withSource(shuttle, path => {
    const result = command(path, ['tick']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /AGAIN.*10,000.*nontermination/);
    assert.equal(observations(result).at(-1).substep, 10_000);
  });
});

test('the view links actual compiled queued rule identities to canonical authored source', async () => {
  const { createTraceView } = await import('../bin/trace-view.mjs');
  const rule = '[ > Player | Crate ] -> [ > Player | > Crate ] sfx0';
  const source = pushingSource.replace('[ > Player | Crate ] -> [ > Player | > Crate ]', rule);
  const compilation = compileSource(source);
  assert.equal(compilation.outcome.kind, SourceCompilationKind.Accepted);
  const { game, ruleSources } = compilation.outcome;
  const session = createSession(game, { seed: 'commands' }, { nextLevelSeed: () => 'unused' });
  const turn = applyTurnRules(game, session.state.execution, Movement.Right);
  assert.ok(turn.state.commands.entries.length > 0);
  const view = createTraceView(compilation, 'written-game.ps');
  const queue = view.execution(turn.state).remainingCommands;
  assert.equal(queue.entries[0].command.kind, 'Sound');
  const authored = ruleSources.get(turn.state.commands.entries[0].source);
  assert.equal(queue.entries[0].source.line, authored.originalLine.span.start.line);
  assert.equal(queue.entries[0].source.text, rule);
  assert.equal(queue.entries[0].source.path, 'written-game.ps');
  const unknown = { ...turn.state, commands: { ...turn.state.commands, entries: [{ ...turn.state.commands.entries[0], source: {} }] } };
  assert.equal(view.execution(unknown).remainingCommands.entries[0].source, null);
});

test('inspection preserves same-name orphan identity and names movement values with layer coordinates', async () => {
  const { createTraceView } = await import('../bin/trace-view.mjs');
  const source = pushingSource.replace('Background\nPlayer, Crate, Wall', 'Background\nBackground\nCrate, Wall')
    .replace('[ > Player | Crate ] -> [ > Player | > Crate ]', 'right [ Crate ] -> [ random Player ]');
  const compilation = compileSource(source);
  assert.equal(compilation.outcome.kind, SourceCompilationKind.Accepted);
  const { declarations, game } = compilation.outcome;
  assert.ok(declarations.orphanedObject);
  const view = createTraceView(compilation, 'orphan.ps');
  const execution = createSession(game, { seed: 'orphan' }, { nextLevelSeed: () => 'unused' }).state.execution;
  const original = declarations.orphanedObject.orphanedFrom;
  const orphan = declarations.orphanedObject;
  const inspected = view.execution({ ...execution,
    board: { width: 1, height: 1, rows: [[{ objects: new Set([original, orphan]) }]] },
    pendingMovements: [{ position: { x: 0, y: 0 }, layer: 1, movements: new Set([Movement.Right, Movement.Action]) }],
  });
  const objects = inspected.board.rows[0][0].objects;
  assert.equal(objects[0].name, objects[1].name);
  assert.notEqual(objects[0].id, objects[1].id);
  assert.equal(objects[1].orphanedFrom, objects[0].id);
  assert.deepEqual(inspected.pendingMovements, [{ x: 0, y: 0, layer: 1, movements: ['Right', 'Action'] }]);
});

function checkDirectExample(result) {
  assert.equal(result.status, 0, result.stderr);
  const seen = records(result);
  assert.deepEqual(seen.map(record => record.input), ['initial', 'right', 'undo']);
  assert.deepEqual(seen.map(record => record.historyLength), [0, 1, 0]);
  assert.deepEqual(seen[0].rows, seen[2].rows);
  assert.notDeepEqual(seen[0].rows, seen[1].rows);
  assert.ok(seen[0].rows[1][1].includes('player'));
  assert.ok(seen[1].rows[1][2].includes('player'));
  assert.ok(seen[1].rows[1][3].includes('crate'));
}

test('the short direct source example compiles exact nearby source and inspects public session values', () => {
  const example = fileURLToPath(new URL('../examples/source.mjs', import.meta.url));
  const result = spawnSync(process.execPath, ['--enable-source-maps', example], { encoding: 'utf8' });
  checkDirectExample(result);
  const script = readFileSync(example, 'utf8');
  assert.ok(script.trim().split('\n').length <= 25, 'keep direct example short enough to read at once');
  assert.match(script, /new URL\('\.\/source-game\.ps', import\.meta\.url\)/);
  assert.doesNotMatch(script, /trace-view|native|oracle|adapter/);
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
  assert.match(scripts.trace, /--enable-source-maps.*bin\/trace\.mjs/);
  assert.match(scripts['example:source'], /--enable-source-maps.*examples\/source\.mjs/);
  for (const name of ['example', 'example:matching', 'example:turn', 'example:session']) assert.ok(scripts[name]);
});

test('CLI and direct example work in a tree containing only built JS/maps and their own files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'puzzlescript-standalone-'));
  try {
    for (const folder of ['build', 'bin', 'examples']) mkdirSync(join(directory, folder));
    for (const file of readdirSync(new URL('../build/', import.meta.url))) {
      assert.match(file, /\.js(?:\.map)?$/, 'copy no source modules, adapters or dependencies');
      copyFileSync(new URL('../build/' + file, import.meta.url), join(directory, 'build', file));
    }
    for (const file of ['bin/trace.mjs', 'bin/trace-view.mjs', 'examples/source-game.ps', 'examples/source.mjs']) {
      copyFileSync(new URL('../' + file, import.meta.url), join(directory, file));
    }
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}\n');
    assert.deepEqual(readdirSync(directory).sort(), ['bin', 'build', 'examples', 'package.json']);
    const result = spawnSync(process.execPath, ['--enable-source-maps', 'bin/trace.mjs', '--seed', 'example', '--level', '0',
      'examples/source-game.ps', 'right', 'undo', 'restart', 'right', 'right'], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(observations(result).map(record => positions(record, 'crate')), [2, 3, 2, 2, 3, 4].map(x => [{ x, y: 1 }]));
    checkDirectExample(spawnSync(process.execPath, ['--enable-source-maps', 'examples/source.mjs'], { cwd: directory, encoding: 'utf8' }));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
