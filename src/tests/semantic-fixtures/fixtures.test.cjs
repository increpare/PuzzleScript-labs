'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('authored two-dimensional boards encode the established testdata wire order', () => {
  const { serializeExpectedBoard } = require('./fixtures.cjs');
  const cells = { P: ['player', 'background'], A: ['red', 'background'], B: ['blue', 'background'], '.': ['background'] };
  assert.equal(serializeExpectedBoard(['PA.', '.B.'], cells),
    'background player:0,background:1,background red:2,\nbackground blue:3,1,1,\n');
  assert.deepEqual(cells.P, ['player', 'background'], 'encoding does not mutate authored expectations');
});

test('expected boards reject missing glyph definitions and ragged rows', () => {
  const { serializeExpectedBoard } = require('./fixtures.cjs');
  assert.throws(() => serializeExpectedBoard(['P?'], { P: ['player'] }), /Undefined expected glyph/);
  assert.throws(() => serializeExpectedBoard(['P.', 'P'], { P: ['player'], '.': [] }), /rectangle/);
});

test('manifest loader uses explicit expected cells and fixed seeds, independently of game syntax', () => {
  const { loadFixtures, fixtureTuple } = require('./fixtures.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-loader-'));
  try {
    fs.writeFileSync(path.join(directory, 'game.ps'), 'authored source, not parsed by the exporter\n');
    fs.writeFileSync(path.join(directory, 'family.json'), JSON.stringify([{
      id: 'unit/example', sourceFile: 'game.ps', explanation: 'Explicit expected objects.',
      cells: { P: ['background', 'player'] },
      cases: [{ name: 'first', inputs: [4, 'undo'], expected: ['P'], expectedSounds: [100, '200'], expectedPlayedSounds: [100, '200', 300] }],
    }]));
    const [fixture] = loadFixtures({ directory });
    assert.equal(fixture.seed, 'unit/example');
    assert.equal(fixture.name, 'semantic: unit/example: first');
    assert.equal(fixture.expectedBoard, 'background player:0,\n');
    assert.deepEqual(fixture.expectedPlayedSounds, [100, '200', 300]);
    assert.deepEqual(fixtureTuple(fixture), [fixture.name, [fixture.source, [4, 'undo'],
      fixture.expectedBoard, 0, 'unit/example', [100, '200']]]);
    assert.deepEqual(loadFixtures({ directory, filter: 'absent' }), []);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'family.json')));
    manifest[0].cases[0].inputs = ['RIGHT'];
    fs.writeFileSync(path.join(directory, 'family.json'), JSON.stringify(manifest));
    assert.throws(() => loadFixtures({ directory }), /Unsupported input/);
    manifest[0].cases[0].inputs = [4];
    manifest[0].cases[0].expectedSound = [100];
    fs.writeFileSync(path.join(directory, 'family.json'), JSON.stringify(manifest));
    assert.throws(() => loadFixtures({ directory }), /Unknown case field: expectedSound/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('generated testdata section replaces itself without touching existing fixtures', () => {
  const { replaceGeneratedSection, renderSection } = require('./export.cjs');
  const original = 'var testdata = [["existing", []]];\n\n\n';
  const fixture = { name: 'semantic: unit: example', source: 'game', inputs: [4], expectedBoard: 'player:0,\n', level: 0, seed: 'unit' };
  const section = renderSection([fixture]);
  const updated = replaceGeneratedSection(original, section);
  assert.ok(updated.startsWith(original));
  assert.equal(replaceGeneratedSection(updated, section), updated);
  const context = {};
  require('node:vm').runInNewContext(updated, context);
  assert.equal(context.testdata.length, 2);
  assert.equal(context.testdata[1][1][2], fixture.expectedBoard);
});

test('Labs exports use explicit board and sound overrides while historical fixtures stay pinned', () => {
  const { loadFixtures, fixtureTuple } = require('./fixtures.cjs');
  const { renderSection } = require('./export.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-labs-loader-'));
  try {
    fs.writeFileSync(path.join(directory, 'game.ps'), 'authored source\n');
    fs.writeFileSync(path.join(directory, 'family.json'), JSON.stringify([{
      id: 'unit/late-compatibility', sourceFile: 'game.ps', explanation: 'An explicitly different Labs outcome.',
      cells: { P: ['background', 'player'], '.': ['background'] },
      cases: [
        { name: 'different board and sounds', inputs: [4, 2], expected: ['P.'], expectedSounds: [100, 200],
          labsExpected: ['.P'], labsExpectedSounds: [] },
        { name: 'board override preserves shared sounds', inputs: [4], expected: ['P.'], expectedSounds: [300],
          labsExpected: ['.P'] },
      ],
    }]));
    const [different, sharedSounds] = loadFixtures({ directory });
    assert.deepEqual(different.expectedRows, ['P.']);
    assert.deepEqual(different.labsExpectedRows, ['.P']);
    assert.equal(different.expectedBoard, 'background player:0,background:1,\n');
    assert.equal(different.labsExpectedBoard, 'background:0,background player:1,\n');
    assert.deepEqual(different.expectedSounds, [100, 200]);
    assert.deepEqual(different.labsExpectedSounds, []);
    assert.deepEqual(fixtureTuple(different)[1].slice(2), [different.expectedBoard, 0, different.seed, [100, 200]]);
    assert.deepEqual(fixtureTuple(different, { labs: true })[1].slice(2), [different.labsExpectedBoard, 0, different.seed, []]);
    assert.deepEqual(fixtureTuple(sharedSounds, { labs: true })[1].slice(2), [sharedSounds.labsExpectedBoard, 0, sharedSounds.seed, [300]]);
    const context = { testdata: [] };
    require('node:vm').runInNewContext(renderSection([different]), context);
    assert.equal(context.testdata[0][1][2], different.labsExpectedBoard);
    assert.equal(context.testdata[0][1][5].length, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
