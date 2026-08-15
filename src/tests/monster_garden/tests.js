#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const garden = require('./garden');

const tests = [];

function test(name, fn) {
    tests.push({ name, fn });
}

const SAMPLE = `title Garden Sample
flickscreen 5x5

========
OBJECTS
========

Background
black

Player
white

Wall
gray

=======
LEGEND
=======

. = Background
P = Player
Obstacle = Player or Wall
Together = Player and Background

=========
SOUNDS
=========

================
COLLISIONLAYERS
================

Background
Player, Wall

======
RULES
======

[ > Player | Wall ] -> [ > Player | > Wall ] again

==============
WINCONDITIONS
==============

=======
LEVELS
=======

PP
..
`;

const MATRIX_SAMPLE = SAMPLE.replace('Player\nwhite\n', [
    'Player',
    'white black',
    '00000',
    '01110',
    '01110',
    '01110',
    '00000',
    ''
].join('\n'));

const RICH_SAMPLE = `title Garden Rich Sample

========
OBJECTS
========

Background
black

Player
white

Crate
brown

Target
yellow

=======
LEGEND
=======

. = Background
P = Player
C = Crate
T = Target
Pushable = Crate

=========
SOUNDS
=========

Crate move 12345
Player move 67890

================
COLLISIONLAYERS
================

Background
Target
Player, Crate

======
RULES
======

[ > Player | Pushable ] -> [ > Player | > Pushable ]

==============
WINCONDITIONS
==============

all Crate on Target
no Player on Target

=======
LEVELS
=======

.T.
PC.
`;

test('seeded random streams are repeatable and bounded', function() {
    const first = new garden.Random(123456);
    const second = new garden.Random(123456);
    const values = [];
    for (let i = 0; i < 20; i++) {
        values.push(first.integer(7));
    }
    assert.deepStrictEqual(values, values.map(function() { return second.integer(7); }));
    assert(values.every(function(value) { return value >= 0 && value < 7; }));
    assert.throws(function() { first.integer(0); }, /positive/);
});

test('the existing simulation and compiler-message fixtures form one corpus', function() {
    const resourceDir = path.join(__dirname, '..', 'resources');
    const corpus = garden.loadCorpus(resourceDir);
    const simulation = corpus.filter(function(item) { return item.kind === 'simulation'; });
    const compiler = corpus.filter(function(item) { return item.kind === 'compiler-message'; });
    assert(simulation.length > 0);
    assert(compiler.length > 0);
    assert.strictEqual(simulation.length + compiler.length, corpus.length);
    assert.strictEqual(typeof corpus[0].source, 'string');
    assert(Array.isArray(corpus[0].inputs));
    assert.strictEqual(corpus[0].fixtureIndex, 0);
    assert.strictEqual(corpus[0].kind, 'simulation');
    assert.strictEqual(corpus[simulation.length].kind, 'compiler-message');
    assert.strictEqual(corpus[simulation.length].fixtureIndex, 0);
    assert.deepStrictEqual(corpus[simulation.length].inputs, []);
});

test('corpusIndex is unique even when names and kind-local indexes collide', function() {
    const corpus = garden.loadCorpus(path.join(__dirname, '..', 'resources'));
    const indexes = corpus.map(function(item) { return item.corpusIndex; });
    assert.strictEqual(indexes.length, new Set(indexes).size);
    corpus.forEach(function(item, i) {
        assert.strictEqual(item.corpusIndex, i);
        assert.strictEqual(typeof item.kind, 'string');
        assert.strictEqual(typeof item.fixtureIndex, 'number');
    });
    const icy = corpus.filter(function(item) { return item.name === 'icycrates'; });
    if (icy.length >= 2) {
        assert.notStrictEqual(icy[0].kind, icy[1].kind);
        assert.notStrictEqual(icy[0].corpusIndex, icy[1].corpusIndex);
    }
});

test('cellObjectNames returns object tokens and drops qualifiers', function() {
    assert.deepStrictEqual(garden.cellObjectNames(' > Player | Wall '), ['Player', 'Wall']);
    assert.deepStrictEqual(garden.cellObjectNames(' no moving Crate '), ['Crate']);
    assert.deepStrictEqual(garden.cellObjectNames('  '), []);
    // Movement glyph v must be excluded even though it matches the identifier shape
    assert.deepStrictEqual(garden.cellObjectNames(' v Player '), ['Player']);
    // But objects legitimately named with v (longer names starting with v) are included
    assert.deepStrictEqual(garden.cellObjectNames(' Vine '), ['Vine']);
});

test('mutateRuleCell replaces exactly one cell in one rule', function() {
    const result = garden.mutateRuleCell(SAMPLE, new garden.Random(4), function(cellText) {
        return { text: ' Replaced ', detail: 'replaced a cell' };
    });
    assert(result);
    assert.strictEqual(result.detail, 'replaced a cell');
    assert(/\[[^\]]*Replaced[^\]]*\]/.test(result.source));
    assert.strictEqual(
        result.source.split('\n').length,
        SAMPLE.split('\n').length,
        'cell edits stay on one line'
    );
    // Verify right-hand side is unmodified: the -> and everything after survives
    const originalLine = '[ > Player | Wall ] -> [ > Player | > Wall ] again';
    const mutatedLine = result.source.split('\n').find(function(line) {
        return line.indexOf('->') >= 0;
    });
    assert(mutatedLine, 'mutation result contains a rule');
    // Extract the right-hand side (from -> onward) of the mutated line
    const arrowIndex = mutatedLine.indexOf('->');
    assert(arrowIndex >= 0, 'mutated rule contains ->');
    const mutatedRhs = mutatedLine.slice(arrowIndex);
    // The original RHS should be unchanged
    assert.strictEqual(mutatedRhs, '-> [ > Player | > Wall ] again');
    // Verify only the FIRST bracket pair was mutated (non-global regex)
    assert(/^\[[^\]]*Replaced[^\]]*\]/.test(mutatedLine), 'first bracket pair was mutated');
});

test('mutateRuleCell reports inapplicable when the callback declines', function() {
    const result = garden.mutateRuleCell(SAMPLE, new garden.Random(4), function() {
        return null;
    });
    assert.strictEqual(result, null);
});

test('no-x-with-x negates an object that is present in the same cell', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'no-x-with-x'; })[0];
    assert(mutator, 'no-x-with-x should be registered');
    let succeeded = 0;
    let sawDoubled = false;
    let sawSingle = false;
    const job = { inputs: [0], level: 0, randomSeed: 'garden-seed', replay: false, maxInputs: 8 };
    for (let seed = 0; seed < 30; seed++) {
        const result = mutator.apply(SAMPLE, new garden.Random(seed), {});
        if (!result) {
            continue;
        }
        succeeded++;
        const cell = /\[([^\]]*)\]/.exec(result.source)[1];
        const negated = /no\s+([A-Za-z][A-Za-z0-9_]*)/.exec(cell);
        assert(negated, 'seed ' + seed + ' should negate something: ' + cell);
        assert(
            new RegExp('\\b' + negated[1] + '\\b').test(cell.replace(/no\s+[A-Za-z][A-Za-z0-9_]*/g, '')),
            'the negated object should also be present unnegated, seed ' + seed
        );
        if (/no\s+(\w+)\s+no\s+\1/.test(cell)) {
            sawDoubled = true;
        } else {
            sawSingle = true;
        }
        // The mutant is meant to damage the program (that's the point of the
        // four issues this mutator is mined from), so compiling it clean is
        // not the bar. The bar is that the worker reports a recognised
        // result kind rather than blowing up uncaught: a 'crash' here would
        // mean the compiler itself throws on a same-cell contradiction
        // instead of reporting it as an error, which is exactly the bug
        // class #1169/#1136/#1071/#762 describe.
        const compiled = workerResult(Object.assign({ source: result.source }, job));
        assert(
            garden.KNOWN_RESULT_KINDS.indexOf(compiled.kind) >= 0,
            'seed ' + seed + ' should return a known result kind, got: ' + JSON.stringify(compiled)
        );
        assert.notStrictEqual(
            compiled.kind,
            'crash',
            'seed ' + seed + ' should not crash the compiler: ' + JSON.stringify(compiled)
        );
    }
    assert(succeeded > 0, 'no-x-with-x should apply at least once');
    assert(sawSingle, 'expected at least one single negation across seeds');
    assert(sawDoubled, 'expected at least one doubled negation across seeds');
});

test('relative-direction-cell qualifies a cell object with a relative direction', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'relative-direction-cell'; })[0];
    assert(mutator, 'relative-direction-cell should be registered');
    const seen = {};
    let succeeded = 0;
    const job = { inputs: [0], level: 0, randomSeed: 'garden-seed', replay: false, maxInputs: 8 };
    for (let seed = 0; seed < 40; seed++) {
        const result = mutator.apply(SAMPLE, new garden.Random(seed), {});
        if (!result) {
            continue;
        }
        succeeded++;
        const match = /(perpendicular|parallel|vertical|horizontal|orthogonal|moving|stationary)\s+[A-Za-z]/
            .exec(result.source);
        assert(match, 'seed ' + seed + ' should add a qualifier');
        seen[match[1]] = true;
        assert.strictEqual(result.source.split('\n').length, SAMPLE.split('\n').length);
        // As with no-x-with-x, this mutator is meant to damage the program
        // (that's the point of issues #682, #498, #496, #941), so compiling
        // clean is not the bar. The bar is that the worker reports a
        // recognised result kind instead of crashing: a 'crash' here would
        // mean the compiler throws on a relative-direction cell qualifier
        // instead of reporting it as an error, which is exactly the bug
        // class those issues describe.
        const compiled = workerResult(Object.assign({ source: result.source }, job));
        assert(
            garden.KNOWN_RESULT_KINDS.indexOf(compiled.kind) >= 0,
            'seed ' + seed + ' should return a known result kind, got: ' + JSON.stringify(compiled)
        );
        assert.notStrictEqual(
            compiled.kind,
            'crash',
            'seed ' + seed + ' should not crash the compiler: ' + JSON.stringify(compiled)
        );
    }
    assert(succeeded > 0, 'relative-direction-cell should apply at least once');
    assert(Object.keys(seen).length >= 3, 'expected several distinct qualifiers across seeds');
});

test('same-layer-cell puts two objects from one collision layer in one cell', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'same-layer-cell'; })[0];
    assert(mutator, 'same-layer-cell should be registered');
    const job = { inputs: [0], level: 0, randomSeed: 'garden-seed', replay: false, maxInputs: 8 };
    let succeeded = 0;
    for (let seed = 0; seed < 20; seed++) {
        const result = mutator.apply(SAMPLE, new garden.Random(seed), {});
        if (!result) {
            continue;
        }
        succeeded++;
        const cells = /\[([^\]]*)\]/.exec(result.source)[1].split('|');
        const crowded = cells.filter(function(cell) {
            return /\bPlayer\b/.test(cell) && /\bWall\b/.test(cell);
        });
        assert.strictEqual(
            crowded.length, 1,
            'seed ' + seed + ' exactly one cell should hold both: ' + cells.join(' | ')
        );
        assert(/same-layer/.test(result.detail));

        // Issue #605: "Rules with objects that can never overlap creates
        // exception." Player and Wall share a collision layer, so this cell
        // can never be satisfied on the board; the compiler must diagnose
        // that instead of throwing.
        const compiled = workerResult(Object.assign({ source: result.source }, job));
        assert(
            garden.KNOWN_RESULT_KINDS.indexOf(compiled.kind) >= 0,
            'seed ' + seed + ' should return a known result kind, got: ' + JSON.stringify(compiled)
        );
        assert.notStrictEqual(
            compiled.kind,
            'crash',
            'seed ' + seed + ' should not crash the compiler: ' + JSON.stringify(compiled)
        );
    }
    assert(succeeded > 0, 'same-layer-cell should apply at least once');
});

test('same-layer-cell declines when no layer holds two objects', function() {
    assert(
        SAMPLE.indexOf('Background\nPlayer, Wall') >= 0,
        'fixture drifted: expected same-layer pair line not found in SAMPLE'
    );
    const singleLayer = SAMPLE.replace('Background\nPlayer, Wall', 'Background\nPlayer\nWall');
    const mutator = garden.mutators.filter(function(m) { return m.name === 'same-layer-cell'; })[0];
    assert.strictEqual(mutator.apply(singleLayer, new garden.Random(6), {}), null);
});

test('property-in-concrete-slot substitutes an or-property for a concrete object', function() {
    // Fixture drift guard: the declared-name allowlist below is hand-derived
    // from SAMPLE's OBJECTS/LEGEND sections. If the fixture changes, this
    // test should fail loudly instead of silently accepting a wider set.
    assert(/\nBackground\nblack\n/.test(SAMPLE), 'fixture drifted: Background object');
    assert(/\nPlayer\nwhite\n/.test(SAMPLE), 'fixture drifted: Player object');
    assert(/\nWall\ngray\n/.test(SAMPLE), 'fixture drifted: Wall object');
    assert(/\nObstacle = Player or Wall\n/.test(SAMPLE), 'fixture drifted: Obstacle property');
    assert(/\nTogether = Player and Background\n/.test(SAMPLE), 'fixture drifted: Together legend key');
    // SAMPLE's only declared names (OBJECTS block names plus multi-character
    // LEGEND keys) other than the property itself ("Obstacle"). A regression
    // to harvesting raw section-body tokens (e.g. the rule flag "again" in
    // RULES, or "all"/"on" in WINCONDITIONS) would produce a victim outside
    // this set and fail the assertion below.
    const declaredNames = ['Background', 'Player', 'Wall', 'Together'];

    const mutator = garden.mutators.filter(function(m) { return m.name === 'property-in-concrete-slot'; })[0];
    assert(mutator, 'property-in-concrete-slot should be registered');
    const job = { inputs: [0], level: 0, randomSeed: 'garden-seed', replay: false, maxInputs: 8 };
    let applied = 0;
    for (let seed = 0; seed < 30; seed++) {
        const result = mutator.apply(SAMPLE, new garden.Random(seed), {});
        if (!result) {
            continue;
        }
        applied++;
        assert.notStrictEqual(result.source, SAMPLE);
        assert(/Obstacle/.test(result.source));
        assert(/replaced .* with property Obstacle/.test(result.detail), result.detail);

        const detailMatch = /replaced (\S+) with property Obstacle in (\S+)/.exec(result.detail);
        assert(detailMatch, 'detail should name the replaced token and section: ' + result.detail);
        const victim = detailMatch[1];
        assert(
            declaredNames.some(function(name) { return name.toLowerCase() === victim.toLowerCase(); }),
            'seed ' + seed + ' replaced "' + victim + '", which is not a declared object or legend ' +
                'name (expected one of ' + declaredNames.join(', ') + '): ' + result.detail
        );

        // Issue #929: "Ambiguous properties throw an exception." A property
        // substituted into a concrete slot must be diagnosed, not crash the
        // compiler.
        const compiled = workerResult(Object.assign({ source: result.source }, job));
        assert(
            garden.KNOWN_RESULT_KINDS.indexOf(compiled.kind) >= 0,
            'seed ' + seed + ' should return a known result kind, got: ' + JSON.stringify(compiled)
        );
        assert.notStrictEqual(
            compiled.kind,
            'crash',
            'seed ' + seed + ' should not crash the compiler: ' + JSON.stringify(compiled)
        );
    }
    assert(applied > 0, 'expected the mutator to apply for at least one seed');
});

test('property-in-concrete-slot declines when the legend defines no or-property', function() {
    const noProperty = SAMPLE.replace('Obstacle = Player or Wall\n', '');
    const mutator = garden.mutators.filter(function(m) { return m.name === 'property-in-concrete-slot'; })[0];
    for (let seed = 0; seed < 10; seed++) {
        assert.strictEqual(mutator.apply(noProperty, new garden.Random(seed), {}), null);
    }
});

const LATE_RULE_SAMPLE = (function() {
    const original = '[ > Player | Wall ] -> [ > Player | > Wall ] again';
    assert(SAMPLE.indexOf(original) >= 0, 'fixture drifted: expected arrow rule');
    return SAMPLE.replace(original, 'late [ > Player | Wall ] -> [ > Player | > Wall ]');
})();

test('rigid-prefix makes a rule rigid, grouped, or late rigid', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'rigid-prefix'; })[0];
    assert(mutator, 'rigid-prefix should be registered');
    const job = { inputs: [0], level: 0, randomSeed: 'garden-seed', replay: false, maxInputs: 8 };
    let sawPlain = false;
    let sawGroup = false;
    let sawLate = false;
    let succeeded = 0;
    for (let seed = 0; seed < 60; seed++) {
        const result = mutator.apply(SAMPLE, new garden.Random(seed), {});
        assert(result, 'seed ' + seed + ' should apply');
        succeeded++;
        assert(/\brigid\b/.test(result.source));
        if (/^late rigid /m.test(result.source)) {
            sawLate = true;
        } else if (/^\+\s*rigid /m.test(result.source)) {
            sawGroup = true;
        } else if (/^rigid /m.test(result.source)) {
            sawPlain = true;
        }

        // Issues #952, #1118, #869: rigid bodies. A rigid, grouped rigid, or
        // late rigid prefix must be diagnosed if invalid, not crash the
        // compiler. Mode 1 (+ rigid) is new ground for issue #952 (rigid
        // disablement applying to whole rule-groups) — a crash here would be
        // a genuine discovery, not a test bug.
        const compiled = workerResult(Object.assign({ source: result.source }, job));
        assert(
            garden.KNOWN_RESULT_KINDS.indexOf(compiled.kind) >= 0,
            'seed ' + seed + ' should return a known result kind, got: ' + JSON.stringify(compiled)
        );
        assert.notStrictEqual(
            compiled.kind,
            'crash',
            'seed ' + seed + ' should not crash the compiler: ' + JSON.stringify(compiled)
        );
    }
    assert(succeeded > 0, 'expected the mutator to apply for at least one seed');
    assert(sawPlain, 'expected a bare rigid prefix across seeds');
    assert(sawGroup, 'expected a grouped (+ rigid) prefix across seeds');
    assert(sawLate, 'expected a late rigid prefix across seeds');
});

test('rigid-prefix does not duplicate an existing late keyword', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'rigid-prefix'; })[0];
    const job = { inputs: [0], level: 0, randomSeed: 'garden-seed', replay: false, maxInputs: 8 };
    let succeeded = 0;
    for (let seed = 0; seed < 60; seed++) {
        const result = mutator.apply(LATE_RULE_SAMPLE, new garden.Random(seed), {});
        assert(result, 'seed ' + seed + ' should apply');
        succeeded++;
        assert(/\brigid\b/.test(result.source));
        assert(
            !/\blate\s+rigid\s+late\b/i.test(result.source) && !/\blate\s+late\b/i.test(result.source),
            'seed ' + seed + ' duplicated late: ' + result.source
        );

        const compiled = workerResult(Object.assign({ source: result.source }, job));
        assert(
            garden.KNOWN_RESULT_KINDS.indexOf(compiled.kind) >= 0,
            'seed ' + seed + ' should return a known result kind, got: ' + JSON.stringify(compiled)
        );
        assert.notStrictEqual(
            compiled.kind,
            'crash',
            'seed ' + seed + ' should not crash the compiler: ' + JSON.stringify(compiled)
        );
    }
    assert(succeeded > 0, 'expected the mutator to apply for at least one seed');
});

test('sprite-matrix-resize changes the shape of a sprite matrix', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'sprite-matrix-resize'; })[0];
    assert(mutator, 'sprite-matrix-resize should be registered');
    const job = { inputs: [0], level: 0, randomSeed: 'garden-seed', replay: false, maxInputs: 8 };
    const shapes = {};
    let succeeded = 0;
    for (let seed = 0; seed < 30; seed++) {
        const result = mutator.apply(MATRIX_SAMPLE, new garden.Random(seed), {});
        if (!result) {
            continue;
        }
        succeeded++;
        assert.notStrictEqual(result.source, MATRIX_SAMPLE);
        const rows = result.source.split('\n').filter(function(line) {
            return /^[01.]{2,}$/.test(line.trim());
        });
        const widths = rows.map(function(row) { return row.trim().length; });
        const ragged = widths.some(function(width) { return width !== 5; });
        shapes[rows.length !== 5 || ragged ? 'changed' : 'same'] = true;

        // Issues #973, #927: sprites that are not 5x5 are inconsistently
        // accepted and rendered. A resized (possibly ragged) matrix must be
        // diagnosed if invalid, not crash the compiler.
        const compiled = workerResult(Object.assign({ source: result.source }, job));
        assert(
            garden.KNOWN_RESULT_KINDS.indexOf(compiled.kind) >= 0,
            'seed ' + seed + ' should return a known result kind, got: ' + JSON.stringify(compiled)
        );
        assert.notStrictEqual(
            compiled.kind,
            'crash',
            'seed ' + seed + ' should not crash the compiler: ' + JSON.stringify(compiled)
        );
    }
    assert(succeeded > 0, 'expected the mutator to apply for at least one seed');
    assert(shapes.changed, 'expected at least one seed to change the matrix shape');
});

test('sprite-matrix-resize declines when there is no sprite matrix', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'sprite-matrix-resize'; })[0];
    for (let seed = 0; seed < 10; seed++) {
        assert.strictEqual(mutator.apply(SAMPLE, new garden.Random(seed), {}), null);
    }
});

test('sectionBlocks splits a section body into header and object blocks', function() {
    const body = [
        'OBJECTS',
        '========',
        '',
        'Background',
        'black',
        '',
        'Player',
        'white',
        'white'
    ].join('\n');
    const parsed = garden.sectionBlocks(body);
    assert.deepStrictEqual(parsed.header, ['OBJECTS', '========']);
    assert.deepStrictEqual(parsed.blocks, [
        ['Background', 'black'],
        ['Player', 'white', 'white']
    ]);
});

test('sectionBlocks returns no blocks for a section that is only a header', function() {
    const parsed = garden.sectionBlocks('SOUNDS\n=========\n\n');
    assert.deepStrictEqual(parsed.header, ['SOUNDS', '=========']);
    assert.deepStrictEqual(parsed.blocks, []);
});

test('loadGameDir returns sorted absolute paths and honours the size cap', function() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'garden-games-'));
    try {
        fs.writeFileSync(path.join(dir, 'zebra.txt'), 'title Z\n');
        fs.writeFileSync(path.join(dir, 'apple.txt'), 'title A\n');
        fs.writeFileSync(path.join(dir, 'huge.txt'), 'x'.repeat(200));
        const games = garden.loadGameDir(dir, 100);
        assert.deepStrictEqual(
            games.map(function(p) { return path.basename(p); }),
            ['apple.txt', 'zebra.txt'],
            'sorted, and huge.txt excluded by the cap'
        );
        games.forEach(function(p) {
            assert.strictEqual(path.isAbsolute(p), true, p + ' should be absolute');
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('loadGameDir is stable across calls', function() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'garden-games-'));
    try {
        for (let i = 0; i < 12; i++) {
            fs.writeFileSync(path.join(dir, 'g' + i + '.txt'), 'title ' + i + '\n');
        }
        assert.deepStrictEqual(garden.loadGameDir(dir), garden.loadGameDir(dir));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('loadGameDir rejects a missing directory and an empty one', function() {
    assert.throws(function() {
        garden.loadGameDir(path.join(os.tmpdir(), 'garden-does-not-exist-' + Date.now()));
    }, /game directory/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'garden-games-'));
    try {
        assert.throws(function() { garden.loadGameDir(dir); }, /no games/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('--game-dir collects pools in order and defaults to none', function() {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'garden-poolA-'));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'garden-poolB-'));
    try {
        fs.writeFileSync(path.join(dirA, 'a.txt'), 'title A\n');
        fs.writeFileSync(path.join(dirB, 'b.txt'), 'title B\n');
        const none = garden.parseArguments([]);
        assert.deepStrictEqual(none.gameDirs, []);
        const both = garden.parseArguments(['--game-dir', dirA, '--game-dir', dirB]);
        assert.deepStrictEqual(both.gameDirs, [dirA, dirB]);
    } finally {
        fs.rmSync(dirA, { recursive: true, force: true });
        fs.rmSync(dirB, { recursive: true, force: true });
    }
});

test('--game-dir rejects a directory that does not exist', function() {
    assert.throws(function() {
        garden.parseArguments(['--game-dir', path.join(os.tmpdir(), 'garden-missing-' + Date.now())]);
    }, /game directory/);
});

test('mutateFixture passes a donor context to mutators', function() {
    const seen = [];
    const fake = {
        name: 'fake-donor-reader',
        apply: function(source, rng, fixture, context) {
            seen.push(context ? context.donors.slice() : null);
            return { source: source + 'author A\n', detail: 'ok' };
        }
    };
    const saved = garden.mutators.slice();
    garden.mutators.length = 0;
    garden.mutators.push(fake);
    try {
        garden.mutateFixture(
            { name: 'f', source: 'title T\n', inputs: [], level: 0, randomSeed: null },
            new garden.Random(3),
            null,
            { maxAttempts: 2, donors: ['/tmp/one.txt'] }
        );
        assert.deepStrictEqual(seen[0], ['/tmp/one.txt']);
    } finally {
        garden.mutators.length = 0;
        for (let i = 0; i < saved.length; i++) {
            garden.mutators.push(saved[i]);
        }
    }
});

const DONOR_SAMPLE = `title Donor

========
OBJECTS
========

Background
blue

Player
green

Water
lightblue

=======
LEGEND
=======

. = Background
P = Player
W = Water

================
COLLISIONLAYERS
================

Background
Player, Water

======
RULES
======

[ > Player | Water ] -> [ > Player | ]

==============
WINCONDITIONS
==============

no Water

=======
LEVELS
=======

WPW
...
`;

// Count declarations in the OBJECTS section only. Counting whole-line matches
// across the whole file is wrong: e.g. Background also appears on its own line
// in COLLISIONLAYERS (it has no layer-mates), so it legitimately matches twice
// there even in an unmerged, well-formed game.
function declaredInObjects(source, name) {
    const match = /\n=+\nOBJECTS\n=+\n([\s\S]*?)(?:\n=+\n[A-Z]+\n=+\n|$)/.exec(source);
    assert(match, 'expected an OBJECTS section');
    // `line === line.trimStart()` is meant to pick out only unindented head
    // lines (object names), as opposed to their indented body lines (colour,
    // sprite rows, etc). Nothing in this codebase's OBJECTS blocks is actually
    // indented, so this filter is currently inert -- it does not yet do the
    // "is this a head line" job it looks like it does. In particular an
    // object's own colour/property lines are unindented too, so a colour
    // literally named the same as an object (e.g. an object `Red` coloured
    // `red`) would be double-counted here as a false duplicate. Not exercised
    // by current fixtures; tighten if that ever becomes a real case.
    const heads = match[1].split('\n').filter(function (line) {
        return line.trim() !== '' && line === line.trimStart();
    });
    return heads.filter(function (line) {
        return line.trim().split(/\s+/)[0].toLowerCase() === name.toLowerCase();
    }).length;
}

test('mergeGames adds only objects A does not already define', function() {
    const merged = garden.mergeGames(SAMPLE, DONOR_SAMPLE, new garden.Random(1));
    assert(merged, 'merge should apply to two well-formed games');
    // Water is new and must arrive; Player and Background exist in both and must
    // not be redeclared, or the merged game would not compile.
    assert(/^Water$/m.test(merged.source), 'Water should be added');
    assert.strictEqual(declaredInObjects(merged.source, 'Player'), 1, 'Player must not be declared twice');
    assert.strictEqual(declaredInObjects(merged.source, 'Background'), 1, 'Background must not be declared twice');
    assert.strictEqual(declaredInObjects(merged.source, 'Water'), 1, 'Water should be added exactly once');
});

test('mergeGames appends the donor rules, levels and win conditions', function() {
    const merged = garden.mergeGames(SAMPLE, DONOR_SAMPLE, new garden.Random(1));
    assert(/\[ > Player \| Water \]/.test(merged.source), 'donor rule should be appended');
    assert(/no Water/.test(merged.source), 'donor win condition should be appended');
    assert(/WPW/.test(merged.source), 'donor level should be appended');
    // A's own rule must survive: this is a union, not a transplant.
    assert(/\[ > Player \| Wall \]/.test(merged.source), 'the fixture rule should survive');
});

test('mergeGames keeps one prelude and one copy of each section header', function() {
    const merged = garden.mergeGames(SAMPLE, DONOR_SAMPLE, new garden.Random(1));
    assert.strictEqual((merged.source.match(/^OBJECTS$/gm) || []).length, 1);
    assert.strictEqual((merged.source.match(/^RULES$/gm) || []).length, 1);
    assert.strictEqual((merged.source.match(/^LEVELS$/gm) || []).length, 1);
    assert.strictEqual((merged.source.match(/^title /gm) || []).length, 1, 'one title only');
    assert(!/title Donor/.test(merged.source), "the donor's prelude should be dropped");
});

test('mergeGames offers both collision-layer modes across seeds', function() {
    const seen = {};
    for (let seed = 0; seed < 20; seed++) {
        const merged = garden.mergeGames(SAMPLE, DONOR_SAMPLE, new garden.Random(seed));
        if (!merged) {
            continue;
        }
        const mode = /raw layers/.test(merged.detail) ? 'raw' : 'filtered';
        seen[mode] = true;
        if (mode === 'filtered') {
            // Player is placed by A already, so the donor's layer line must not
            // name it again or the merged game double-books it.
            const layers = /COLLISIONLAYERS\n=+\n([\s\S]*?)\n=+\n/.exec(merged.source);
            assert(layers, 'merged source should still have a collision layer section');
            assert.strictEqual(
                (layers[1].match(/\bPlayer\b/g) || []).length,
                1,
                'filtered mode must place Player exactly once: ' + layers[1]
            );
        }
    }
    assert(seen.raw, 'expected raw mode across 20 seeds');
    assert(seen.filtered, 'expected filtered mode across 20 seeds');
});

test('mergeGames returns null when either side lacks the core sections', function() {
    assert.strictEqual(garden.mergeGames(SAMPLE, 'title nothing here\n', new garden.Random(1)), null);
    assert.strictEqual(garden.mergeGames('title nothing here\n', SAMPLE, new garden.Random(1)), null);
});

test('mergeGames compares names case-insensitively', function() {
    const shouty = DONOR_SAMPLE.replace(/^Player$/m, 'PLAYER').replace(/= Player$/m, '= PLAYER');
    const merged = garden.mergeGames(SAMPLE, shouty, new garden.Random(1));
    assert(merged);
    assert.strictEqual(
        (merged.source.match(/^(Player|PLAYER)$/gm) || []).length,
        1,
        'a differently-cased duplicate is still a duplicate'
    );
});

// PuzzleScript lets an object declare its level glyph inline on the same
// OBJECTS head line as its name (e.g. "Background .", "Player p" -- both
// appear in the real corpus). That trailing token is itself a declared name:
// declaredNames() must register EVERY whitespace-separated token on the head
// line, not just the first, or a donor's colliding LEGEND entry for that
// glyph survives the dedupe and the merged game fails to compile with
// "Name "." already in use". This was the single largest class of filtered
// merge failures against the real donor pool (21 of 49 sampled).
const GLYPH_ALIAS_FIXTURE = `title Glyph Alias Fixture

========
OBJECTS
========

Background .
black

Player
white

=======
LEGEND
=======

P = Player

=========
SOUNDS
=========

================
COLLISIONLAYERS
================

Background
Player

======
RULES
======

[ Player ] -> [ Player ]

==============
WINCONDITIONS
==============

=======
LEVELS
=======

P
`;

const GLYPH_ALIAS_DONOR = `title Glyph Alias Donor

========
OBJECTS
========

Wall
gray

=======
LEGEND
=======

. = Wall

=========
SOUNDS
=========

================
COLLISIONLAYERS
================

Wall

======
RULES
======

[ Wall ] -> [ Wall ]

==============
WINCONDITIONS
==============

=======
LEVELS
=======

.
`;

// A standalone parenthetical divider inside OBJECTS is a common corpus idiom
// (14% of sampled games have one). Its words must not be mistaken for declared
// names: doing so drops the donor's real object while its legend entry and
// rules survive, producing a merge that looks plausible and cannot compile.
test('mergeGames does not treat words inside an OBJECTS comment as declared names', function() {
    function game(objectsBody, legendBody, layersBody, rulesBody, level) {
        return 'title T\n\n========\nOBJECTS\n========\n\n' + objectsBody +
            '\n=======\nLEGEND\n=======\n\n' + legendBody +
            '\n=========\nSOUNDS\n=========\n\n================\nCOLLISIONLAYERS\n================\n\n' + layersBody +
            '\n======\nRULES\n======\n\n' + rulesBody +
            '\n==============\nWINCONDITIONS\n==============\n\n=======\nLEVELS\n=======\n\n' + level + '\n';
    }
    const fixture = game(
        '( Physical Objects )\n\nBackground\nblack\n\nPlayer\nwhite\n',
        '. = Background\nP = Player\n',
        'Background\nPlayer\n',
        '',
        'P.'
    );
    const donor = game('Physical\nblue\n', 'X = Physical\n', 'Physical\n', '[ Physical ] -> [ ]\n', 'X.');
    const merged = garden.mergeGames(fixture, donor, new garden.Random(1));
    assert(merged, 'the merge should apply');
    assert(
        /^Physical$/m.test(merged.source),
        'the donor object must survive: the comment word "Physical" is not a declaration\n' + merged.source
    );
    const compiled = workerResult({
        source: merged.source, inputs: [], level: 0, randomSeed: null, replay: false, maxInputs: 4
    });
    assert(
        garden.KNOWN_RESULT_KINDS.indexOf(compiled.kind) >= 0,
        'unknown kind: ' + JSON.stringify(compiled)
    );
    assert.notStrictEqual(compiled.kind, 'crash', JSON.stringify(compiled));
});

test('mergeGames dedupes a donor LEGEND entry that collides with a head-line glyph alias', function() {
    const merged = garden.mergeGames(GLYPH_ALIAS_FIXTURE, GLYPH_ALIAS_DONOR, new garden.Random(1));
    assert(merged, 'merge should apply to two well-formed games');
    // The donor's ". = Wall" LEGEND line must be dropped: "." is already
    // spoken for by the fixture's "Background ." head line.
    assert(
        !/\.\s*=\s*Wall/.test(merged.source),
        'the colliding donor LEGEND entry should have been deduped:\n' + merged.source
    );
    const compiled = workerResult({
        source: merged.source,
        inputs: [],
        level: 0,
        randomSeed: null,
        replay: false,
        maxInputs: 8
    });
    assert.notStrictEqual(
        compiled.kind,
        'crash',
        'the merge should not crash the compiler: ' + JSON.stringify(compiled)
    );
    // Before the fix, this merge produced a duplicate-name compiler error
    // ("Name "." already in use"). The whole point of the dedupe is that a
    // colliding glyph alias does not reach the compiler as a duplicate.
    assert.notStrictEqual(
        compiled.kind,
        'compiler-error',
        'a glyph-alias collision should have been deduped away, not reach the compiler: ' +
            JSON.stringify(compiled)
    );
});

// Passing tests on the merged *text* are not enough: the whole point of a
// filtered-mode merge is that it is a VALID, runnable game, and a boundary bug
// in the section-extraction helpers (leaking a neighbouring section's "===="
// border into extracted OBJECTS/COLLISIONLAYERS/etc. content) produced
// well-formed-looking text that nonetheless failed to compile. Only actually
// running it through the worker catches that. Seeds are pinned explicitly
// (rather than looping and hoping) so each test exercises a known mode:
// seed 1 -> filtered layers, seed 0 -> raw layers, confirmed via merged.detail.
test('mergeGames filtered-mode output actually compiles and runs', function() {
    const merged = garden.mergeGames(SAMPLE, DONOR_SAMPLE, new garden.Random(1));
    assert(merged, 'merge should apply to two well-formed games');
    assert(/filtered layers/.test(merged.detail), 'seed 1 should pick filtered mode: ' + merged.detail);
    const compiled = workerResult({
        source: merged.source,
        inputs: [],
        level: 0,
        randomSeed: null,
        replay: false,
        maxInputs: 8
    });
    assert(
        garden.KNOWN_RESULT_KINDS.indexOf(compiled.kind) >= 0,
        'filtered merge should return a known result kind, got: ' + JSON.stringify(compiled)
    );
    // This is the assertion that would have caught the boundary-leak bug: a
    // filtered merge drops every colliding declaration, so the result must be
    // a valid game that reaches the engine, not a parse error.
    assert.notStrictEqual(
        compiled.kind,
        'compiler-error',
        'a filtered-mode merge is supposed to produce a valid game: ' + JSON.stringify(compiled)
    );
});

test('mergeGames raw-mode output still reaches the compiler (a compile error there is correct)', function() {
    const merged = garden.mergeGames(SAMPLE, DONOR_SAMPLE, new garden.Random(0));
    assert(merged, 'merge should apply to two well-formed games');
    assert(/raw layers/.test(merged.detail), 'seed 0 should pick raw mode: ' + merged.detail);
    const compiled = workerResult({
        source: merged.source,
        inputs: [],
        level: 0,
        randomSeed: null,
        replay: false,
        maxInputs: 8
    });
    // Raw mode deliberately double-books shared objects across collision
    // layers, so compiler-error is its correct, expected outcome -- unlike
    // filtered mode, we do NOT assert kind !== 'compiler-error' here. The bar
    // is only that the worker reports a recognised kind instead of the
    // process blowing up uncaught.
    assert(
        garden.KNOWN_RESULT_KINDS.indexOf(compiled.kind) >= 0,
        'raw merge should return a known result kind, got: ' + JSON.stringify(compiled)
    );
});

test('semantics-preserving mutators declare an equivalence level', function() {
    const expected = {
        'rename-object': 'board',
        'reorder-objects': 'board',
        'reorder-winconditions': 'full',
        'reorder-sounds': 'full',
        'inline-legend-synonym': 'full',
        'add-legend-alias': 'board',
        'add-unreachable-rule': 'board',
        'comment-reflow': 'full',
        'scramble-case': 'board'
    };
    const names = Object.keys(expected);
    for (let i = 0; i < names.length; i++) {
        const mutator = garden.mutators.filter(function(m) { return m.name === names[i]; })[0];
        assert(mutator, names[i] + ' should be registered');
        assert.strictEqual(mutator.equivalence, expected[names[i]], names[i] + ' equivalence level');
    }
    // The loop above only checks that every name in `expected` is registered
    // with the right level; it says nothing about a mutator that declares
    // `equivalence` but was never added to `expected`. That gap is exactly
    // how scramble-case slipped through unchecked when it was added. Walk
    // garden.mutators in the other direction so a future semantics-preserving
    // mutator without a matching entry here fails loudly instead of being
    // silently unchecked.
    const declared = garden.mutators.filter(function(m) { return m.equivalence; });
    declared.forEach(function(mutator) {
        assert(
            Object.prototype.hasOwnProperty.call(expected, mutator.name),
            mutator.name + ' declares equivalence: ' + mutator.equivalence +
                ' but has no expected entry in this test'
        );
    });
    assert.strictEqual(
        declared.length,
        names.length,
        'expected map and garden.mutators equivalence-declaring set must be the same size'
    );
    const rename = garden.mutators.filter(function(m) { return m.name === 'rename-object'; })[0];
    assert.strictEqual(typeof rename.normalise, 'function');
});

test('rename-object renames consistently and never touches Background or Player', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'rename-object'; })[0];
    let succeeded = 0;
    for (let seed = 0; seed < 25; seed++) {
        const result = mutator.apply(RICH_SAMPLE, new garden.Random(seed), {});
        if (!result) {
            continue;
        }
        succeeded++;
        assert(/\bBackground\b/.test(result.source), 'Background must survive seed ' + seed);
        assert(/\bPlayer\b/.test(result.source), 'Player must survive seed ' + seed);
        assert(!/\bBackgroundRenamed\b/.test(result.source));
        assert(!/\bPlayerRenamed\b/.test(result.source));
        const renames = result.equivalenceContext.renames;
        const newNames = Object.keys(renames);
        assert.strictEqual(newNames.length, 1);
        // The old name is gone everywhere and the new name appears in OBJECTS,
        // LEGEND, COLLISIONLAYERS and RULES alike.
        const oldName = renames[newNames[0]];
        assert(!new RegExp('\\b' + oldName + '\\b', 'i').test(result.source), 'old name gone, seed ' + seed);
    }
    assert(succeeded > 0, 'rename-object should apply at least once');
});

const LEVEL_GLYPH_SAMPLE = `title Garden Level Glyph Sample

========
OBJECTS
========

Background
black

Player
white

b
brown

Wall
gray

=======
LEGEND
=======

. = Background
P = Player
W = Wall

=========
SOUNDS
=========

================
COLLISIONLAYERS
================

Background
Player, b, Wall

======
RULES
======

[ Player | b ] -> [ Player | b ]
[ Player | Wall ] -> [ Player | Wall ]

==============
WINCONDITIONS
==============

=======
LEVELS
=======

.b.
PW.
`;

test('rename-object never renames a single-character object used as its own level glyph', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'rename-object'; })[0];
    // "b" is used directly (with no LEGEND entry) as its own glyph in the
    // LEVELS grid below; a one-character object name is auto-registered by
    // the parser as its own glyph, so renaming it -- even leaving the grid
    // text itself untouched -- would strand that glyph unresolved. "Wall" is
    // the only object that should ever be picked.
    const job = {
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    };
    const baseline = workerResult(Object.assign({ source: LEVEL_GLYPH_SAMPLE }, job));
    assert.strictEqual(baseline.kind, 'ok', JSON.stringify(baseline));
    let succeeded = 0;
    for (let seed = 0; seed < 30; seed++) {
        const result = mutator.apply(LEVEL_GLYPH_SAMPLE, new garden.Random(seed), {});
        if (!result) {
            continue;
        }
        succeeded++;
        assert.strictEqual(result.detail, 'renamed Wall to WallRenamed', 'seed ' + seed + ' renamed the wrong object');
        assert(/\.b\.\nPW\.\n?$/.test(result.source.slice(result.source.indexOf('LEVELS'))), 'seed ' + seed + ' corrupted the level grid');
        const compiled = workerResult(Object.assign({ source: result.source }, job));
        assert.strictEqual(compiled.kind, 'ok', 'seed ' + seed + ': ' + JSON.stringify(compiled));
        assert.strictEqual(
            garden.compareEquivalence(mutator, baseline, compiled, result.equivalenceContext),
            null,
            'seed ' + seed
        );
    }
    assert(succeeded > 0, 'rename-object should apply at least once');
});

test('rename-object never renames an object whose name is also a PuzzleScript color keyword', function() {
    // A \b-anchored rename cannot distinguish "White" the object name from
    // "White" the colour literal used in a *different* object's colour list.
    // The real corpus fixture "gallery game: mad queens" has both: an object
    // named "White" and an object "Alice" whose colour list is
    // "Blue Brown White Yellow". Renaming "White" corrupted the latter and
    // produced a false equivalence-break in a --seed 777 --count 150 run
    // restricted to the semantics-preserving mutators (fixture #158).
    const corpus = garden.loadCorpus(path.join(__dirname, '..', 'resources'));
    const item = corpus.filter(function(c) {
        return c.name === 'gallery game: mad queens' && c.kind === 'simulation';
    })[0];
    assert(item, 'the "gallery game: mad queens" corpus fixture should exist');
    const mutator = garden.mutators.filter(function(m) { return m.name === 'rename-object'; })[0];
    for (let seed = 0; seed < 100; seed++) {
        const result = mutator.apply(item.source, new garden.Random(seed), {});
        if (!result) {
            continue;
        }
        assert(
            !/renamed (White|Black|Red) to/.test(result.detail),
            'seed ' + seed + ' renamed a colour-named object: ' + result.detail
        );
    }
});

test('rename-object replaces lowercase rule references of the same object', function() {
    const mixed = RICH_SAMPLE.replace(
        '[ > Player | Pushable ] -> [ > Player | > Pushable ]',
        '[ > Player | crate ] -> [ > Player | > crate ]'
    );
    const mutator = garden.mutators.filter(function(m) { return m.name === 'rename-object'; })[0];
    let result = null;
    for (let seed = 0; seed < 40; seed++) {
        const applied = mutator.apply(mixed, new garden.Random(seed), {});
        if (applied && applied.detail.indexOf('renamed Crate ') === 0) {
            result = applied;
            break;
        }
    }
    assert(result, 'should rename Crate on some seed');
    assert(
        !/\bcrate\b/i.test(result.source.replace(/CrateRenamed/gi, '')),
        'lowercase crate references must be renamed:\n' + result.source
    );
    const compiled = workerResult({
        source: result.source,
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    });
    assert.strictEqual(compiled.kind, 'ok', JSON.stringify(compiled));
});

test('normaliseBoardNames maps lowercase engine names using the original-case rename map', function() {
    const board = 'background craterenamed target:3,background craterenamed:4,\n';
    const normalised = garden.normaliseBoardNames(board, { CrateRenamed: 'Crate' });
    assert.strictEqual(normalised, 'background crate target:3,background crate:4,\n');
});

test('rename-object output normalises back to the original board', function() {
    const board = 'Crate Player:0,Target:1,\n';
    const renamed = 'CrateRenamed Player:0,Target:1,\n';
    assert.strictEqual(garden.normaliseBoardNames(renamed, { CrateRenamed: 'Crate' }), board);
});

test('reorder-objects permutes blocks without changing the object set', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'reorder-objects'; })[0];
    const result = mutator.apply(RICH_SAMPLE, new garden.Random(11), {});
    assert(result);
    assert.notStrictEqual(result.source, RICH_SAMPLE);
    const names = ['Background', 'Player', 'Crate', 'Target'];
    for (let i = 0; i < names.length; i++) {
        assert(new RegExp('^' + names[i] + '$', 'm').test(result.source), names[i] + ' should survive');
    }
    const job = {
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    };
    const baseline = workerResult(Object.assign({ source: RICH_SAMPLE }, job));
    const compiled = workerResult(Object.assign({ source: result.source }, job));
    assert.strictEqual(baseline.kind, 'ok', JSON.stringify(baseline));
    assert.strictEqual(compiled.kind, 'ok', JSON.stringify(compiled));
    assert.strictEqual(garden.compareEquivalence(mutator, baseline, compiled, null), null);
});

test('reorder-objects refuses to reorder past a comment that spans several blank-line-separated blocks', function() {
    // sectionBlocks splits the OBJECTS body purely on blank lines, with no
    // awareness that a PuzzleScript "(...)" comment can legally span several
    // of those blank-line-separated blocks. The real corpus fixture
    // "Rigidbody fix bug #246" has exactly that shape: a comment opens at
    // "(AHBlock" and does not close until four blocks later at ".000.)".
    // Before this guard, reorder-objects could swap the block holding the
    // opening '(' away from the block holding the matching ')', silently
    // commenting out AUBlock/IUBlock/ADBlock/IDBlock/AProjector and every
    // object declared after it. Measured before the fix: 8 equivalence-breaks
    // in 25 trials (--seed 5 --count 25 --mutator reorder-objects --fixture
    // "Rigidbody fix bug #246"), each a mutant that failed to compile with
    // "You're talking about ABACKGROUND but it's not defined anywhere."
    const corpus = garden.loadCorpus(path.join(__dirname, '..', 'resources'));
    const item = corpus.filter(function(c) {
        return c.name === 'Rigidbody fix bug #246' && c.kind === 'simulation';
    })[0];
    assert(item, 'the "Rigidbody fix bug #246" corpus fixture should exist');
    const mutator = garden.mutators.filter(function(m) { return m.name === 'reorder-objects'; })[0];
    for (let seed = 0; seed < 100; seed++) {
        const result = mutator.apply(item.source, new garden.Random(seed), {});
        assert.strictEqual(result, null, 'seed ' + seed + ' should refuse to reorder past the multi-block comment');
    }
});

test('reorder-winconditions and reorder-sounds keep the line count', function() {
    const names = ['reorder-winconditions', 'reorder-sounds'];
    const job = {
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    };
    const baseline = workerResult(Object.assign({ source: RICH_SAMPLE }, job));
    assert.strictEqual(baseline.kind, 'ok', JSON.stringify(baseline));
    for (let i = 0; i < names.length; i++) {
        const mutator = garden.mutators.filter(function(m) { return m.name === names[i]; })[0];
        const result = mutator.apply(RICH_SAMPLE, new garden.Random(20 + i), {});
        assert(result, names[i] + ' should apply to RICH_SAMPLE');
        assert.strictEqual(
            result.source.split('\n').length,
            RICH_SAMPLE.split('\n').length,
            names[i] + ' must stay line-aligned'
        );
        const compiled = workerResult(Object.assign({ source: result.source }, job));
        assert.strictEqual(compiled.kind, 'ok', names[i] + ': ' + JSON.stringify(compiled));
        assert.strictEqual(garden.compareEquivalence(mutator, baseline, compiled, null), null, names[i]);
    }
});

test('reorder-winconditions treats "any" as a member quantifier, matching languageConstants reg_winconditionquantifiers', function() {
    // languageConstants.js defines reg_winconditionquantifiers as
    // /^(all|any|no|some)$/. "no Player on Target" already matched the old
    // predicate, so a fixture with only "all" and "any" lines is needed to
    // show the gap: under the old /^\s*(all|some|no)\b/i predicate "any"
    // was not a member, leaving only one member line, so the mutator could
    // never find a second line to swap with and always returned null.
    const source = RICH_SAMPLE.replace(
        'all Crate on Target\nno Player on Target\n',
        'all Crate on Target\nany Player on Target\n'
    );
    const mutator = garden.mutators.filter(function(m) { return m.name === 'reorder-winconditions'; })[0];
    const job = {
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    };
    const baseline = workerResult(Object.assign({ source: source }, job));
    assert.strictEqual(baseline.kind, 'ok', JSON.stringify(baseline));
    let succeeded = 0;
    for (let seed = 0; seed < 20; seed++) {
        const result = mutator.apply(source, new garden.Random(seed), {});
        if (!result) {
            continue;
        }
        succeeded++;
        assert(/swapped wincondition lines/.test(result.detail), result.detail);
        const compiled = workerResult(Object.assign({ source: result.source }, job));
        assert.strictEqual(compiled.kind, 'ok', 'seed ' + seed + ': ' + JSON.stringify(compiled));
        assert.strictEqual(garden.compareEquivalence(mutator, baseline, compiled, null), null, 'seed ' + seed);
    }
    assert(succeeded > 0, 'reorder-winconditions should treat "any" as a member and be able to swap it');
});

// findSection matches a section header by exact line equality. The real
// corpus fixture "Weirdness with = as glyph" declares its LEVELS section as
// "LEVELS(\n)=======\n" -- a comment that opens right after the header text
// and closes on the following line, which the real parser accepts, but which
// findSection does not recognise as a boundary at all (it never equals
// "LEVELS"). That makes the WINCONDITIONS "section" run on into the level
// grid. Likewise "COLLISIONLAYERS(\n)================\n" makes a SOUNDS
// section run on into the collision-layer declarations. This is exactly the
// shape that produced a measured false equivalence-break (1/36): the old
// reorderSectionLines swapped a real line with a level row or a layer line.
// reorder-winconditions/-sounds must not do that; they may only swap lines
// that look like genuine members of their own section.
function loadWeirdnessFixture() {
    const corpus = garden.loadCorpus(path.join(__dirname, '..', 'resources'));
    const item = corpus.filter(function(c) {
        return c.name === 'Weirdness with = as glyph' && c.kind === 'simulation';
    })[0];
    assert(item, 'the "Weirdness with = as glyph" corpus fixture should exist');
    return item.source;
}

test('reorder-winconditions never swaps a wincondition line with level-grid content past a comment-hidden header', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'reorder-winconditions'; })[0];
    // The stock fixture has only one win condition; add a second so a real
    // swap is possible, to prove the fix does more than just refuse to run.
    const source = loadWeirdnessFixture().replace('all Target on Crate\n', 'all Target on Crate\nno Player on Wall\n');
    const job = {
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    };
    const baseline = workerResult(Object.assign({ source: source }, job));
    assert.strictEqual(baseline.kind, 'ok', JSON.stringify(baseline));
    let succeeded = 0;
    for (let seed = 0; seed < 40; seed++) {
        const result = mutator.apply(source, new garden.Random(seed), {});
        if (!result) {
            continue;
        }
        succeeded++;
        assert(
            /####\.\.\n#\.O#\.\./.test(result.source),
            'seed ' + seed + ' corrupted the level rows:\n' + result.source
        );
        const compiled = workerResult(Object.assign({ source: result.source }, job));
        assert.strictEqual(compiled.kind, 'ok', 'seed ' + seed + ': ' + JSON.stringify(compiled));
        assert.strictEqual(garden.compareEquivalence(mutator, baseline, compiled, null), null, 'seed ' + seed);
    }
    assert(succeeded > 0, 'reorder-winconditions should apply at least once');
});

test('reorder-sounds never swaps a sound line with collision-layer content past a comment-hidden header', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'reorder-sounds'; })[0];
    const source = loadWeirdnessFixture()
        .replace('================\nCOLLISIONLAYERS\n================\n\n', '================\nCOLLISIONLAYERS(\n)================\n\n')
        .replace('Crate move 36772507\n', 'Crate move 36772507\nPlayer move 111\n');
    const job = {
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    };
    const baseline = workerResult(Object.assign({ source: source }, job));
    assert.strictEqual(baseline.kind, 'ok', JSON.stringify(baseline));
    let succeeded = 0;
    for (let seed = 0; seed < 40; seed++) {
        const result = mutator.apply(source, new garden.Random(seed), {});
        if (!result) {
            continue;
        }
        succeeded++;
        assert(
            result.source.indexOf('Background\nTarget\nPlayer, Wall, Crate') >= 0,
            'seed ' + seed + ' corrupted the collision layers:\n' + result.source
        );
        const compiled = workerResult(Object.assign({ source: result.source }, job));
        assert.strictEqual(compiled.kind, 'ok', 'seed ' + seed + ': ' + JSON.stringify(compiled));
        assert.strictEqual(garden.compareEquivalence(mutator, baseline, compiled, null), null, 'seed ' + seed);
    }
    assert(succeeded > 0, 'reorder-sounds should apply at least once');
});

// SOUNDS lines can carry '(' / ')' that the parser treats as comments.
// Swapping them changes comment nesting (and can hide COLLISIONLAYERS), so
// reorder-sounds is not an equivalence on those fixtures. This test was
// dropped by accident in 15df9828 ("Drop the extra TooManyErrors garden
// tests") alongside two genuinely-redundant TooManyErrors tests -- but this
// one is the only coverage of the refuseUnbalancedComments option in
// reorderSectionLines. Stubbing that guard to a no-op still passes the rest
// of the suite; only this test catches the regression.
test('reorder-sounds refuses a SOUNDS section whose comment delimiters make line order matter', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'reorder-sounds'; })[0];
    const source = SAMPLE.replace(
        '=========\nSOUNDS\n=========\n',
        '=========\nSOUNDS\n=========\n\n' +
        ')Crate MOVE 36772507(b)\n' +
        'Crate MOVE(a)36772507(\n' +
        '(e)Crate MOVE 36772507(d\n'
    );
    for (let seed = 0; seed < 40; seed++) {
        const result = mutator.apply(source, new garden.Random(seed), {});
        assert.strictEqual(
            result,
            null,
            'seed ' + seed + ' reordered comment-sensitive sound lines:\n' +
                (result && result.source)
        );
    }
});

test('inline-legend-synonym stays line-aligned and removes the alias', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'inline-legend-synonym'; })[0];
    const result = mutator.apply(RICH_SAMPLE, new garden.Random(5), {});
    assert(result);
    assert.strictEqual(result.source.split('\n').length, RICH_SAMPLE.split('\n').length);
    assert(!/\bPushable\b/.test(result.source), 'the alias should be gone');
    assert(/\[ > Player \| Crate \]/.test(result.source), 'uses should be inlined');
    const job = {
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    };
    const baseline = workerResult(Object.assign({ source: RICH_SAMPLE }, job));
    const compiled = workerResult(Object.assign({ source: result.source }, job));
    assert.strictEqual(baseline.kind, 'ok', JSON.stringify(baseline));
    assert.strictEqual(compiled.kind, 'ok', JSON.stringify(compiled));
    assert.strictEqual(garden.compareEquivalence(mutator, baseline, compiled, null), null);
});

test('inline-legend-synonym replaces case-differing references to the alias', function() {
    // PuzzleScript names are case-insensitive, so a reference can use
    // different casing than the alias's own LEGEND definition. The real
    // corpus fixture "Neoprenanzieher" defines "playerbody =
    // Playerbody_main" (lowercase) but references it elsewhere as
    // "Playerbody" (capital P), e.g. "player = Playerbody or playerhead or
    // Playerfeet". The old code replaced only case-exact occurrences (a bare
    // 'g' flag), so blanking the definition line left "Playerbody"
    // unresolved -- the exact hazard commit 24b9abf9 already fixed for the
    // sibling rename-object mutator by switching to 'gi'. Measured before
    // the fix, at seed 0: baseline compiled ok, the mutant failed with
    // "You're talking about PLAYERBODY but it's not defined anywhere."
    const corpus = garden.loadCorpus(path.join(__dirname, '..', 'resources'));
    const item = corpus.filter(function(c) {
        return c.name === 'Neoprenanzieher' && c.kind === 'simulation';
    })[0];
    assert(item, 'the "Neoprenanzieher" corpus fixture should exist');
    const mutator = garden.mutators.filter(function(m) { return m.name === 'inline-legend-synonym'; })[0];
    const job = {
        inputs: item.inputs,
        level: item.level,
        randomSeed: item.randomSeed,
        replay: false,
        maxInputs: 8
    };
    const baseline = workerResult(Object.assign({ source: item.source }, job));
    assert.strictEqual(baseline.kind, 'ok', JSON.stringify(baseline));
    let sawPlayerbody = false;
    for (let seed = 0; seed < 60; seed++) {
        const result = mutator.apply(item.source, new garden.Random(seed), {});
        if (!result || result.detail.indexOf('inlined legend synonym playerbody ') !== 0) {
            continue;
        }
        sawPlayerbody = true;
        assert(
            !/\bPlayerbody\b/i.test(result.source.replace(/Playerbody_main/gi, '')),
            'seed ' + seed + ' left a dangling case-differing reference:\n' + result.detail
        );
        const compiled = workerResult(Object.assign({ source: result.source }, job));
        assert.strictEqual(compiled.kind, 'ok', 'seed ' + seed + ': ' + JSON.stringify(compiled));
        assert.strictEqual(garden.compareEquivalence(mutator, baseline, compiled, null), null, 'seed ' + seed);
    }
    assert(sawPlayerbody, 'should have inlined the playerbody alias on some seed');
});

const LOW_PLAYER_SAMPLE = `title Garden Low Player Sample

========
OBJECTS
========

Background
black

LowPlayer
white

Wall
gray

=======
LEGEND
=======

. = Background
Player = LowPlayer
# = Wall

=========
SOUNDS
=========

================
COLLISIONLAYERS
================

Background
Player, Wall

======
RULES
======

[ > Player | Wall ] -> [ > Player | > Wall ]

==============
WINCONDITIONS
==============

=======
LEVELS
=======

P.#
`;

test('inline-legend-synonym never blanks a Player or Background alias definition', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'inline-legend-synonym'; })[0];
    // "Player = LowPlayer" is the only candidate longer than one character
    // besides "Wall = ..." would be if present; here it is the sole eligible
    // alias, so any seed that finds a candidate must skip it and report
    // inapplicable rather than delete the game's Player declaration.
    for (let seed = 0; seed < 30; seed++) {
        const result = mutator.apply(LOW_PLAYER_SAMPLE, new garden.Random(seed), {});
        assert.strictEqual(result, null, 'seed ' + seed + ' should refuse to inline the Player alias');
    }
});

test('a trailing ellipsis with run_rules_on_level_start is a compiler error, not a crash', function() {
    const source = SAMPLE.replace(
        'title Garden Sample\n',
        'title Garden Sample\nrun_rules_on_level_start\n'
    ).replace(
        '[ > Player | Wall ] -> [ > Player | > Wall ] again',
        '[ Player | ... ] -> [ Player | ]'
    );
    const compiled = workerResult({
        source: source,
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    });
    assert.strictEqual(compiled.kind, 'compiler-error', JSON.stringify(compiled));
    assert.strictEqual(compiled.error, null);
});

test('comment-reflow stays line-aligned and comments after the finished rule', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'comment-reflow'; })[0];
    const result = mutator.apply(RICH_SAMPLE, new garden.Random(9), {});
    assert(result);
    assert.strictEqual(result.source.split('\n').length, RICH_SAMPLE.split('\n').length);
    assert(!/\[ \(garden\)/.test(result.source), 'a leading ( would comment out the rest of the rule');
    assert(/ \(garden\)\s*$/m.test(result.source));
    assert(/\[[^\n]*->[^\n]* \(garden\)/.test(result.source));
    const compiled = workerResult({
        source: result.source,
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    });
    assert.strictEqual(compiled.kind, 'ok', JSON.stringify(compiled));
});

test('comment-reflow skips rules that use the message command', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'comment-reflow'; })[0];
    const onlyMessage = SAMPLE.replace(
        '[ > Player | Wall ] -> [ > Player | > Wall ] again',
        '[ moving Player ] -> cancel message ACTION'
    );
    for (let seed = 0; seed < 20; seed++) {
        assert.strictEqual(
            mutator.apply(onlyMessage, new garden.Random(seed), {}),
            null,
            'seed ' + seed + ' should not comment a message rule'
        );
    }
    const mixed = SAMPLE.replace(
        '[ > Player | Wall ] -> [ > Player | > Wall ] again',
        '[ moving Player ] -> cancel message ACTION\n[ > Player | Wall ] -> [ > Player | > Wall ] again'
    );
    let commented = 0;
    for (let seed = 0; seed < 40; seed++) {
        const result = mutator.apply(mixed, new garden.Random(seed), {});
        if (!result) {
            continue;
        }
        commented++;
        assert(
            !/message[^\n]*\(garden\)/.test(result.source),
            'seed ' + seed + ' appended into a message:\n' + result.source
        );
        const compiled = workerResult({
            source: result.source,
            inputs: [0],
            level: 0,
            randomSeed: 'garden-seed',
            replay: false,
            maxInputs: 8
        });
        const baseline = workerResult({
            source: mixed,
            inputs: [0],
            level: 0,
            randomSeed: 'garden-seed',
            replay: false,
            maxInputs: 8
        });
        assert.strictEqual(compiled.kind, 'ok', JSON.stringify(compiled));
        assert.strictEqual(garden.compareEquivalence(mutator, baseline, compiled, null), null);
    }
    assert(commented > 0, 'should still comment a non-message rule');
});

function asciiFoldLetters(text) {
    let out = '';
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code >= 65 && code <= 90) {
            out += String.fromCharCode(code + 32);
        } else {
            out += text.charAt(i);
        }
    }
    return out;
}

test('scramble-case flips only ASCII letters and stays board-equivalent', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'scramble-case'; })[0];
    assert(mutator, 'scramble-case should be registered');
    const marked = 'Player ßİı 123.\n';
    const result = mutator.apply(marked, new garden.Random(4), {});
    assert(result);
    assert.notStrictEqual(result.source, marked);
    assert.strictEqual(asciiFoldLetters(result.source), asciiFoldLetters(marked));
    assert(result.source.indexOf('ß') >= 0, 'sharp s must stay a single character');
    assert(result.source.indexOf('İ') >= 0, 'dotted I must not be produced from ASCII i');
    assert(result.source.indexOf('ı') >= 0);
    assert.strictEqual(result.source.split('\n').length, marked.split('\n').length);
    const scrambled = mutator.apply(RICH_SAMPLE, new garden.Random(4), {});
    assert(scrambled);
    const compiled = workerResult({
        source: scrambled.source,
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    });
    assert.strictEqual(compiled.kind, 'ok', JSON.stringify(compiled));
    const baseline = workerResult({
        source: RICH_SAMPLE,
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    });
    assert.strictEqual(garden.compareEquivalence(mutator, baseline, compiled, null), null);
});

test('inject-nasty-message appends to command-free rules and inserts between maps', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'inject-nasty-message'; })[0];
    assert(mutator);
    const source = RICH_SAMPLE.replace(
        '.T.\nPC.\n',
        '.T.\nPC.\n\n.T.\n.P.\n'
    );
    const result = mutator.apply(source, new garden.Random(3), {});
    assert(result);
    assert(
        !/\[ Player \] -> \[ Player \] message/.test(result.source),
        'should not insert a new rule; should append to an existing one'
    );
    const rulePrefix = '[ > Player | Pushable ] -> [ > Player | > Pushable ] message ';
    const ruleLine = result.source.split('\n').filter(function(line) {
        return line.indexOf('[ > Player | Pushable ]') >= 0;
    })[0];
    assert(ruleLine && ruleLine.indexOf(rulePrefix) === 0, result.source);
    assert(
        garden.NAUGHTY_STRINGS.indexOf(ruleLine.slice(rulePrefix.length)) >= 0,
        JSON.stringify(ruleLine.slice(rulePrefix.length))
    );

    const levels = result.source.split(/=======+\s*\nLEVELS\s*\n=======+\s*\n/i)[1];
    const levelLines = levels.split('\n').filter(function(line) {
        return line.trim() !== '' && !/^=+$/.test(line);
    });
    assert.strictEqual(levelLines[0], '.T.');
    assert.strictEqual(levelLines[1], 'PC.');
    assert(/^\s*message /.test(levelLines[2]), levels);
    const levelPayload = levelLines[2].replace(/^\s*message /, '');
    assert(garden.NAUGHTY_STRINGS.indexOf(levelPayload) >= 0, JSON.stringify(levelPayload));
    assert.strictEqual(levelLines[3], '.T.');
    assert.strictEqual(levelLines[4], '.P.');

    assert.strictEqual(mutator.apply(source, new garden.Random(3), {}).source, result.source);
    assert.strictEqual(mutator.apply(SAMPLE, new garden.Random(3), {}), null);
    assert.strictEqual(mutator.apply('title only\n', new garden.Random(1), {}), null);
});

test('add-unreachable-rule declares its object in OBJECTS, layers and RULES', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'add-unreachable-rule'; })[0];
    const result = mutator.apply(RICH_SAMPLE, new garden.Random(2), {});
    assert(result);
    assert.strictEqual((result.source.match(/GardenGhost/g) || []).length, 3);
    assert(/\[ GardenGhost \] -> \[ \]/.test(result.source));
});

function sourceWithObjectCount(count) {
    // SAMPLE already has Background, Player, Wall.
    const extra = count - 3;
    const names = [];
    const blocks = [];
    for (let i = 0; i < extra; i++) {
        names.push('Pad' + i);
        blocks.push('Pad' + i + '\ntransparent\n');
    }
    return SAMPLE
        .replace('Wall\ngray\n', 'Wall\ngray\n\n' + blocks.join('\n'))
        .replace('Player, Wall', 'Player, Wall, ' + names.join(', '));
}

test('add-unreachable-rule stays board-equivalent when GardenGhost grows STRIDE_OBJ', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'add-unreachable-rule'; })[0];
    const packed = sourceWithObjectCount(32);
    const applied = mutator.apply(packed, new garden.Random(0), {});
    assert(applied);
    const job = {
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    };
    const baseline = workerResult(Object.assign({ source: packed }, job));
    const compiled = workerResult(Object.assign({ source: applied.source }, job));
    assert.strictEqual(baseline.kind, 'ok', JSON.stringify(baseline));
    assert.strictEqual(compiled.kind, 'ok', JSON.stringify(compiled));
    assert.notStrictEqual(
        baseline.fingerprint,
        compiled.fingerprint,
        'adding an object at the 32-bit packing boundary must change the raw objects array'
    );
    assert.strictEqual(garden.compareEquivalence(mutator, baseline, compiled, null), null);
});

test('add-legend-alias defines the alias and routes a rule reference through it', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'add-legend-alias'; })[0];
    const result = mutator.apply(RICH_SAMPLE, new garden.Random(13), {});
    assert(result);
    assert(/^GardenAlias = \w+$/m.test(result.source));
    const rulesIndex = result.source.indexOf('RULES');
    assert(result.source.indexOf('GardenAlias', rulesIndex) > rulesIndex, 'alias should appear in RULES');
    // Inserting the LEGEND line shifts every later line number, which can
    // change "line N" text inside errorStrings that the 'full' fingerprint
    // would compare verbatim -- that is exactly why this mutator is
    // 'board'-equivalent rather than 'full'. Compiling here proves the board
    // itself is unaffected regardless of any such shift.
    const job = {
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    };
    const baseline = workerResult(Object.assign({ source: RICH_SAMPLE }, job));
    const compiled = workerResult(Object.assign({ source: result.source }, job));
    assert.strictEqual(baseline.kind, 'ok', JSON.stringify(baseline));
    assert.strictEqual(compiled.kind, 'ok', JSON.stringify(compiled));
    assert.strictEqual(garden.compareEquivalence(mutator, baseline, compiled, null), null);
});

test('normaliseBoardNames maps names back and re-sorts each cell', function() {
    const board = 'CrateRenamed Player:0,1,\nBackground:1,0,\n';
    const normalised = garden.normaliseBoardNames(board, { CrateRenamed: 'Crate' });
    assert.strictEqual(normalised, 'Crate Player:0,1,\nBackground:1,0,\n');
});

test('normaliseBoardNames re-sorts when the new name sorts differently', function() {
    const board = 'Player Zebra:0,\n';
    const normalised = garden.normaliseBoardNames(board, { Zebra: 'Crate' });
    assert.strictEqual(normalised, 'Crate Player:0,\n');
});

test('normaliseBoardNames leaves empty cells alone', function() {
    assert.strictEqual(garden.normaliseBoardNames(':0,0,\n', { A: 'B' }), ':0,0,\n');
});

test('compareEquivalence ignores mutators that do not declare equivalence', function() {
    const plain = { name: 'plain', apply: function() { return null; } };
    const result = garden.compareEquivalence(
        plain,
        { kind: 'ok', fingerprint: 'a' },
        { kind: 'ok', fingerprint: 'b' },
        null
    );
    assert.strictEqual(result, null);
});

test('compareEquivalence makes no claim when the baseline is unhealthy', function() {
    const mutator = { name: 'm', equivalence: 'full', apply: function() { return null; } };
    const result = garden.compareEquivalence(
        mutator,
        { kind: 'crash', fingerprint: 'a' },
        { kind: 'ok', fingerprint: 'b' },
        null
    );
    assert.strictEqual(result, null);
});

test('compareEquivalence reports a full-fingerprint divergence', function() {
    const mutator = { name: 'm', equivalence: 'full', apply: function() { return null; } };
    assert.strictEqual(garden.compareEquivalence(
        mutator, { kind: 'ok', fingerprint: 'a' }, { kind: 'ok', fingerprint: 'a' }, null
    ), null);
    const broken = garden.compareEquivalence(
        mutator, { kind: 'ok', fingerprint: 'a' }, { kind: 'ok', fingerprint: 'b' }, null
    );
    assert(broken);
    assert.strictEqual(broken.detail, 'fingerprint differs');
});

test('compareEquivalence compares only the board for board-level mutators', function() {
    const mutator = { name: 'm', equivalence: 'board', apply: function() { return null; } };
    const baseline = { kind: 'ok', fingerprint: JSON.stringify({ board: 'Crate:0,\n', curlevel: 0 }) };
    const sameBoard = { kind: 'ok', fingerprint: JSON.stringify({ board: 'Crate:0,\n', curlevel: 9 }) };
    assert.strictEqual(garden.compareEquivalence(mutator, baseline, sameBoard, null), null);
    const otherBoard = { kind: 'ok', fingerprint: JSON.stringify({ board: 'Player:0,\n', curlevel: 0 }) };
    const broken = garden.compareEquivalence(mutator, baseline, otherBoard, null);
    assert(broken);
    assert.strictEqual(broken.detail, 'board differs');
});

test('compareEquivalence applies the rename normaliser before comparing boards', function() {
    const mutator = {
        name: 'm',
        equivalence: 'board',
        normalise: garden.normaliseBoardNames,
        apply: function() { return null; }
    };
    const baseline = { kind: 'ok', fingerprint: JSON.stringify({ board: 'Crate Player:0,\n' }) };
    const renamed = { kind: 'ok', fingerprint: JSON.stringify({ board: 'CrateRenamed Player:0,\n' }) };
    const context = { renames: { CrateRenamed: 'Crate' } };
    assert.strictEqual(garden.compareEquivalence(mutator, baseline, renamed, context), null);
});

test('compareEquivalence maps lowercase board names from a Title Case rename', function() {
    const mutator = {
        name: 'm',
        equivalence: 'board',
        normalise: garden.normaliseBoardNames,
        apply: function() { return null; }
    };
    const baseline = { kind: 'ok', fingerprint: JSON.stringify({ board: 'background crate:4,\n' }) };
    const renamed = { kind: 'ok', fingerprint: JSON.stringify({ board: 'background craterenamed:4,\n' }) };
    const context = { renames: { CrateRenamed: 'Crate' } };
    assert.strictEqual(garden.compareEquivalence(mutator, baseline, renamed, context), null);
});

test('compareEquivalence treats a compiler error on a valid transformation as a break', function() {
    const mutator = { name: 'm', equivalence: 'full', apply: function() { return null; } };
    const broken = garden.compareEquivalence(
        mutator, { kind: 'ok', fingerprint: 'a' }, { kind: 'compiler-error', fingerprint: 'x' }, null
    );
    assert(broken);
    assert(/compiler-error/.test(broken.detail));
});

test('compareEquivalence does not treat a new warning or a crash as a break', function() {
    const mutator = { name: 'm', equivalence: 'full', apply: function() { return null; } };
    assert.strictEqual(garden.compareEquivalence(
        mutator, { kind: 'ok', fingerprint: 'a' }, { kind: 'compiler-warning', fingerprint: 'x' }, null
    ), null);
    assert.strictEqual(garden.compareEquivalence(
        mutator, { kind: 'ok', fingerprint: 'a' }, { kind: 'crash', fingerprint: 'x' }, null
    ), null);
});

test('compareEquivalence makes no claim when a board is missing from a fingerprint', function() {
    const mutator = { name: 'm', equivalence: 'board', apply: function() { return null; } };
    const baseline = { kind: 'ok', fingerprint: JSON.stringify({ levelCount: 2 }) };
    const mutant = { kind: 'ok', fingerprint: JSON.stringify({ board: 'Crate:0,\n' }) };
    assert.strictEqual(garden.compareEquivalence(mutator, baseline, mutant, null), null);
});

test('equivalence-break is a known, interesting result kind', function() {
    assert(garden.KNOWN_RESULT_KINDS.indexOf('equivalence-break') >= 0);
    assert.strictEqual(garden.isInteresting({ kind: 'equivalence-break' }), true);
});

test('semantics-preserving mutators are skipped on fixtures that use randomness', function() {
    const randomFixture = {
        name: 'randomish',
        source: 'title T\n\n======\nRULES\n======\n\n[ Player ] -> [ randomDir Player ]\n',
        inputs: [],
        level: 0,
        randomSeed: null
    };
    const plainFixture = Object.assign({}, randomFixture, {
        source: 'title T\n\n======\nRULES\n======\n\n[ Player ] -> [ > Player ]\n'
    });
    const preserving = {
        name: 'fake-preserving',
        equivalence: 'full',
        apply: function(source) { return { source: source + 'author A\n', detail: 'edited' }; }
    };
    const saved = garden.mutators.slice();
    garden.mutators.length = 0;
    garden.mutators.push(preserving);
    try {
        assert.throws(function() {
            garden.mutateFixture(randomFixture, new garden.Random(7), null, { maxAttempts: 4 });
        }, /inapplicable/, 'a random fixture must offer no semantics-preserving mutator');
        const ok = garden.mutateFixture(plainFixture, new garden.Random(7), null, { maxAttempts: 4 });
        assert.strictEqual(ok.mutator, 'fake-preserving');
    } finally {
        garden.mutators.length = 0;
        for (let i = 0; i < saved.length; i++) {
            garden.mutators.push(saved[i]);
        }
    }
});

test('mutateFixture carries equivalenceContext through to the mutant', function() {
    const fixture = { name: 'f', source: 'title T\n', inputs: [], level: 0, randomSeed: null };
    const fake = [{
        name: 'fake-preserving',
        equivalence: 'board',
        apply: function(source) {
            return {
                source: source + 'author A\n',
                detail: 'renamed',
                equivalenceContext: { renames: { New: 'Old' } }
            };
        }
    }];
    const saved = garden.mutators.slice();
    garden.mutators.length = 0;
    garden.mutators.push(fake[0]);
    try {
        const mutant = garden.mutateFixture(fixture, new garden.Random(3), null, { maxAttempts: 2 });
        assert.deepStrictEqual(mutant.equivalenceContext, { renames: { New: 'Old' } });
    } finally {
        garden.mutators.length = 0;
        for (let i = 0; i < saved.length; i++) {
            garden.mutators.push(saved[i]);
        }
    }
});

function mutatorChangedJob(result, source, fixture) {
    if (!result) {
        return false;
    }
    if (result.source !== source) {
        return true;
    }
    if (result.inputs && JSON.stringify(result.inputs) !== JSON.stringify(fixture.inputs || [])) {
        return true;
    }
    if (result.level !== undefined && result.level !== fixture.level) {
        return true;
    }
    if (result.randomSeed !== undefined && result.randomSeed !== fixture.randomSeed) {
        return true;
    }
    return false;
}

test('every named mutator either changes a suitable source or reports inapplicable', function() {
    const expected = [
        'delete-rule-punctuation',
        'duplicate-rule-punctuation',
        'swap-legend-operator',
        'invalid-viewport',
        'duplicate-rule-command',
        'legend-cycle',
        'swap-sections',
        'odd-whitespace',
        'unterminated-comment',
        'duplicate-rule-line',
        'swap-object-colors',
        'nudge-level-cell',
        'flip-win-quantifier',
        'blns-slot',
        'keyword-as-name',
        'orphan-legend-member',
        'inject-ellipsis',
        'inject-no',
        'inject-control-char',
        'sprite-matrix-noise',
        'duplicate-object-name',
        'case-flip-name',
        'layer-drop',
        'layer-double-book',
        'background-as-aggregate',
        'sound-on-property',
        'win-on-undefined',
        'empty-cell-row',
        'command-on-lhs',
        'group-plus',
        'startloop-mismatch',
        'direction-prefix-salad',
        'inject-again-loop',
        'inject-random-fill',
        'prelude-injection',
        'ragged-level',
        'message-sandwich',
        'inject-nasty-message',
        'comment-eat-section',
        'duplicate-section',
        'nudge-input',
        'off-by-one-level',
        'seed-poison',
        'prefix-chop',
        'rename-object',
        'reorder-objects',
        'reorder-winconditions',
        'reorder-sounds',
        'inline-legend-synonym',
        'add-legend-alias',
        'add-unreachable-rule',
        'comment-reflow',
        'scramble-case',
        'no-x-with-x',
        'relative-direction-cell',
        'same-layer-cell',
        'property-in-concrete-slot',
        'rigid-prefix',
        'sprite-matrix-resize',
        'restart-again-message',
        'multi-fault',
        'comment-in-rule',
        'merge-game',
        'shuffle-rules',
        'shuffle-levels'
    ];
    assert.deepStrictEqual(garden.mutators.map(function(mutator) { return mutator.name; }), expected);

    const winSource = SAMPLE.replace(
        '==============\nWINCONDITIONS\n==============\n\n',
        '==============\nWINCONDITIONS\n==============\n\nall crate on target\n\n'
    );
    const fixtureBase = { inputs: [0, 3], level: 0, randomSeed: null };
    // merge-game needs a donor pool to be applicable at all; give every
    // mutator in this loop a context so merge-game gets the same chance to
    // apply as the rest (other mutators simply ignore the extra argument).
    const donorContext = {
        donors: ['donor-fixture'],
        readDonor: function() { return DONOR_SAMPLE; }
    };
    // shuffle-rules needs at least two rule lines to have anything to reorder;
    // every other fixture in this loop declares exactly one.
    const multiRuleSource = SAMPLE.replace(
        '[ > Player | Wall ] -> [ > Player | > Wall ] again',
        '[ > Player | Wall ] -> [ > Player | > Wall ] again\n[ Player ] -> [ Player ]\n' +
            '[ Wall ] -> [ Wall ]\n[ Player Wall ] -> [ Player ]'
    );
    // shuffle-levels only ever has a single two-row level to work with in the
    // other fixtures, and this loop's fixed seed happens to draw a no-op swap
    // on that one; a fixture with several levels gives it room to permute.
    const multiLevelSource = SAMPLE.replace('PP\n..\n', 'PP\n..\n\n.P\nP.\n\nP.\n.P\n');

    for (let i = 0; i < garden.mutators.length; i++) {
        const mutator = garden.mutators[i];
        let source = SAMPLE;
        let fixture = Object.assign({ source: source }, fixtureBase);
        let result = mutator.apply(source, new garden.Random(100 + i), fixture, donorContext);
        if (!mutatorChangedJob(result, source, fixture)) {
            source = winSource;
            fixture = Object.assign({ source: source }, fixtureBase);
            result = mutator.apply(source, new garden.Random(100 + i), fixture, donorContext);
        }
        if (!mutatorChangedJob(result, source, fixture)) {
            source = RICH_SAMPLE;
            fixture = Object.assign({ source: source }, fixtureBase);
            result = mutator.apply(source, new garden.Random(100 + i), fixture, donorContext);
        }
        if (!mutatorChangedJob(result, source, fixture)) {
            source = MATRIX_SAMPLE;
            fixture = Object.assign({ source: source }, fixtureBase);
            result = mutator.apply(source, new garden.Random(100 + i), fixture, donorContext);
        }
        if (!mutatorChangedJob(result, source, fixture)) {
            source = multiRuleSource;
            fixture = Object.assign({ source: source }, fixtureBase);
            result = mutator.apply(source, new garden.Random(100 + i), fixture, donorContext);
        }
        if (!mutatorChangedJob(result, source, fixture)) {
            source = multiLevelSource;
            fixture = Object.assign({ source: source }, fixtureBase);
            result = mutator.apply(source, new garden.Random(100 + i), fixture, donorContext);
        }
        assert(result, mutator.name + ' should apply to a suitable source');
        assert(mutatorChangedJob(result, source, fixture), mutator.name + ' should change the source or job');
        assert.strictEqual(typeof result.detail, 'string');
        assert(result.detail.length > 0);
    }
});

test('job-tape mutators change inputs, level, or seed without requiring a source edit', function() {
    const fixture = {
        name: 'sample',
        fixtureIndex: 0,
        kind: 'simulation',
        source: SAMPLE,
        inputs: [0, 3, 1],
        level: 0,
        randomSeed: null
    };
    const nudged = garden.mutateFixture(fixture, new garden.Random(1), ['nudge-input']);
    assert.strictEqual(nudged.source, fixture.source);
    assert.notDeepStrictEqual(nudged.inputs, fixture.inputs);
    const chopped = garden.mutateFixture(fixture, new garden.Random(1), ['prefix-chop']);
    assert.strictEqual(chopped.source, fixture.source);
    assert.ok(chopped.inputs.length < fixture.inputs.length);
    const leveled = garden.mutateFixture(fixture, new garden.Random(1), ['off-by-one-level']);
    assert.strictEqual(leveled.source, fixture.source);
    assert.notStrictEqual(leveled.level, fixture.level);
    const seeded = garden.mutateFixture(fixture, new garden.Random(1), ['seed-poison']);
    assert.strictEqual(seeded.source, fixture.source);
    assert.notStrictEqual(seeded.randomSeed, fixture.randomSeed);
});

test('the real semantics-preserving mutators are all skipped on random fixtures', function() {
    const randomFixture = {
        name: 'randomish',
        source: RICH_SAMPLE.replace('[ > Player | Pushable ]', '[ > Player | randomDir Pushable ]'),
        inputs: [],
        level: 0,
        randomSeed: null
    };
    const names = garden.mutators
        .filter(function(mutator) { return mutator.equivalence; })
        .map(function(mutator) { return mutator.name; });
    assert.strictEqual(names.length, 9);
    assert.throws(function() {
        garden.mutateFixture(randomFixture, new garden.Random(7), names, { maxAttempts: 6 });
    }, /inapplicable/);
});

test('mutating a fixture records enough information to reproduce it', function() {
    const fixture = {
        name: 'sample',
        fixtureIndex: 7,
        kind: 'simulation',
        source: SAMPLE,
        inputs: [0, 3],
        level: 0,
        randomSeed: null
    };
    const first = garden.mutateFixture(fixture, new garden.Random(44), ['legend-cycle']);
    const second = garden.mutateFixture(fixture, new garden.Random(44), ['legend-cycle']);
    assert.deepStrictEqual(first, second);
    assert.strictEqual(first.mutator, 'legend-cycle');
    assert.strictEqual(first.fixtureName, 'sample');
    assert.strictEqual(first.fixtureIndex, 7);
    assert.notStrictEqual(first.source, fixture.source);
});

test('mutateFixture retries then fails when no mutator applies', function() {
    const fixture = {
        name: 'empty',
        fixtureIndex: 0,
        kind: 'simulation',
        source: 'title X\n',
        inputs: [],
        level: 0,
        randomSeed: null
    };
    assert.throws(function() {
        garden.mutateFixture(fixture, new garden.Random(1), ['delete-rule-punctuation'], { maxAttempts: 2 });
    }, /inapplicable/);
});

test('shrinkEquivalencePair deletes the same line from both sources', async function() {
    const mutator = { name: 'm', equivalence: 'full', apply: function() { return null; } };
    // Line "junk" is irrelevant to the divergence; line "keep" causes it.
    const evaluate = async function(job) {
        const diverges = job.source.indexOf('keep') >= 0;
        if (job.source.indexOf('MUTANT') >= 0) {
            return { kind: 'ok', fingerprint: diverges ? 'mutant' : 'same' };
        }
        return { kind: 'ok', fingerprint: 'same' };
    };
    const mutant = {
        source: 'MUTANT\njunk\nkeep\n',
        inputs: [],
        level: 0,
        randomSeed: null
    };
    const result = await garden.shrinkEquivalencePair(
        mutant,
        'BASE\njunk\nkeep\n',
        mutator,
        { shrink: true, shrinkBudget: 50, evaluate: evaluate }
    );
    assert.strictEqual(result.skipped, false);
    assert.strictEqual(result.source.indexOf('junk'), -1);
    assert.strictEqual(result.baselineSource.indexOf('junk'), -1);
    assert(result.source.indexOf('keep') >= 0);
    assert(result.baselineSource.indexOf('keep') >= 0);
});

test('shrinkEquivalencePair skips when the mutant is not line-aligned', async function() {
    const mutator = { name: 'm', equivalence: 'full', apply: function() { return null; } };
    const mutant = { source: 'a\nb\nc\n', inputs: [], level: 0, randomSeed: null };
    const result = await garden.shrinkEquivalencePair(
        mutant,
        'a\nb\n',
        mutator,
        { shrink: true, shrinkBudget: 50, evaluate: async function() { throw new Error('must not evaluate'); } }
    );
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.source, 'a\nb\nc\n');
    assert.strictEqual(result.steps, 0);
});

test('shrinkEquivalencePair honours the shrink option being off', async function() {
    const mutator = { name: 'm', equivalence: 'full', apply: function() { return null; } };
    const mutant = { source: 'a\nb\n', inputs: [], level: 0, randomSeed: null };
    const result = await garden.shrinkEquivalencePair(
        mutant,
        'a\nb\n',
        mutator,
        { shrink: false, shrinkBudget: 50, evaluate: async function() { throw new Error('must not evaluate'); } }
    );
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.steps, 0);
});

test('arguments have reproducible defaults and reject unsafe numeric values', function() {
    const defaults = garden.parseArguments([], { now: function() { return 98765; } });
    assert.strictEqual(defaults.seed, 98765);
    assert.strictEqual(defaults.count, 100);
    assert.strictEqual(defaults.forever, false);
    assert.strictEqual(defaults.timeoutMs, 2000);
    assert.strictEqual(defaults.shrink, true);
    assert.strictEqual(defaults.replay, true);
    assert.strictEqual(defaults.maxInputs, 8);
    assert.strictEqual(defaults.shrinkBudget, 200);
    assert.strictEqual(defaults.maxAttempts, 8);
    assert.strictEqual(defaults.output, '.build/monster_garden');
    assert.strictEqual(defaults.fixture, null);
    assert.strictEqual(defaults.mutators, null);
    assert.strictEqual(defaults.listMutators, false);

    const parsed = garden.parseArguments([
        '--seed', '42', '--count', '3', '--timeout-ms', '900',
        '--fixture', 'sokoban', '--mutator', 'legend-cycle,odd-whitespace',
        '--output', 'somewhere', '--no-shrink', '--no-replay', '--max-inputs', '4',
        '--shrink-budget', '50', '--max-attempts', '3'
    ]);
    assert.strictEqual(parsed.seed, 42);
    assert.strictEqual(parsed.count, 3);
    assert.strictEqual(parsed.timeoutMs, 900);
    assert.deepStrictEqual(parsed.mutators, ['legend-cycle', 'odd-whitespace']);
    assert.strictEqual(parsed.shrink, false);
    assert.strictEqual(parsed.replay, false);
    assert.strictEqual(parsed.maxInputs, 4);
    assert.strictEqual(parsed.shrinkBudget, 50);
    assert.strictEqual(parsed.maxAttempts, 3);
    assert.strictEqual(parsed.listMutators, false);
    assert.strictEqual(garden.parseArguments(['--list-mutators']).listMutators, true);
    assert.throws(function() { garden.parseArguments(['--count', '0']); }, /count/);
    assert.throws(function() { garden.parseArguments(['--timeout-ms', '0']); }, /timeout-ms/);
    assert.throws(function() { garden.parseArguments(['--timeout-ms', '2147483648']); }, /timeout-ms/);
    assert.strictEqual(garden.parseArguments(['--timeout-ms', '2147483647']).timeoutMs, 2147483647);
    assert.throws(function() { garden.parseArguments(['--wat']); }, /Unknown option/);
    assert.throws(function() { garden.parseArguments(['--mutator', 'imaginary']); }, /Unknown mutator/);
    assert.throws(function() { garden.parseArguments(['--mutator', '']); }, /mutator/);
    assert.throws(function() { garden.parseArguments(['--seed', '']); }, /seed/);
    assert.throws(function() { garden.parseArguments(['--seed', '4294967296']); }, /seed/);
    assert.strictEqual(garden.parseArguments(['--seed', '4294967295']).seed, 4294967295);
});

test('--forever cannot be combined with --count', function() {
    assert.strictEqual(garden.parseArguments([]).forever, false);
    assert.strictEqual(garden.parseArguments(['--forever']).forever, true);
    assert.strictEqual(garden.parseArguments(['--forever']).count, 100);
    assert.throws(function() {
        garden.parseArguments(['--forever', '--count', '3']);
    }, /forever/);
    assert.throws(function() {
        garden.parseArguments(['--count', '3', '--forever']);
    }, /forever/);
});

test('extra inputs are generated deterministically and appended after the truncated prefix', function() {
    assert.strictEqual(garden.parseArguments([]).extraInputs, 0);
    assert.throws(function() { garden.parseArguments(['--extra-inputs', '0']); }, /extra-inputs/);
    const rng = new garden.Random(1);
    const recorded = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    const first = garden.extendInputs(recorded, rng, { maxInputs: 8, extraInputs: 3 });
    const rng2 = new garden.Random(1);
    const second = garden.extendInputs(recorded, rng2, { maxInputs: 8, extraInputs: 3 });
    assert.deepStrictEqual(first, second);
    assert.strictEqual(first.length, 11);
    assert.deepStrictEqual(first.slice(0, 8), recorded.slice(0, 8));
    first.slice(8).forEach(function(value) {
        assert.notStrictEqual([0, 1, 2, 3, 4, 'tick'].indexOf(value), -1);
    });
});

test('default extraInputs keeps the unsliced recorded tape and campaign maxInputs', function() {
    const recorded = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    const rng = new garden.Random(1);
    const unsliced = garden.prepareTrialInputs(recorded, rng, { maxInputs: 8, extraInputs: 0 });
    assert.strictEqual(unsliced.length, recorded.length);
    assert.deepStrictEqual(unsliced, recorded);

    const omitted = garden.prepareTrialInputs(recorded, new garden.Random(1), { maxInputs: 8 });
    assert.strictEqual(omitted.length, recorded.length);
    assert.deepStrictEqual(omitted, recorded);

    const extras = garden.prepareTrialInputs(recorded, new garden.Random(1), { maxInputs: 8, extraInputs: 3 });
    const expectedExtras = garden.extendInputs(recorded, new garden.Random(1), { maxInputs: 8, extraInputs: 3 });
    assert.deepStrictEqual(extras, expectedExtras);
    assert.strictEqual(extras.length, 11);

    const options = { maxInputs: 8, extraInputs: 0 };
    assert.strictEqual(garden.trialMaxInputs(options, unsliced), 8);
    assert.strictEqual(garden.trialMaxInputs({ maxInputs: 8 }, unsliced), 8);
    assert.strictEqual(garden.trialMaxInputs({ maxInputs: 8, extraInputs: 3 }, extras), extras.length);
});

test('only inapplicable mutation errors are skippable', function() {
    assert.strictEqual(garden.isInapplicableMutation(new Error('inapplicable mutation after 2 attempts')), true);
    assert.strictEqual(garden.isInapplicableMutation(new TypeError('mutator exploded')), false);
    assert.strictEqual(garden.isInapplicableMutation(new Error('Cannot read property apply of undefined')), false);
});

test('failure signatures distinguish timeouts from parser crashes and include fingerprints', function() {
    const crash = garden.failureSignature({
        kind: 'crash',
        error: { name: 'TypeError', message: 'bad thing\nwith stack noise' },
        fingerprint: 'ignored',
        detail: ''
    });
    assert.strictEqual(crash, garden.failureSignature({
        kind: 'crash',
        error: { name: 'TypeError', message: 'bad thing\nelsewhere' },
        fingerprint: 'other'
    }));
    assert.notStrictEqual(crash, garden.failureSignature({ kind: 'timeout' }));
    const first = garden.failureSignature({
        kind: 'replay-divergence',
        fingerprint: 'alpha-board',
        detail: 'beta'
    });
    const second = garden.failureSignature({
        kind: 'replay-divergence',
        fingerprint: 'gamma-board',
        detail: 'beta'
    });
    assert.notStrictEqual(first, second);
    assert.strictEqual(garden.failureSignature({ kind: 'timeout', fingerprint: 'x' }), 'timeout');
});

test('timeouts are not shrunk and a signature change after shrink is reverted', async function() {
    const original = 'keep\nlater-crash\n';
    const mutant = { source: original, inputs: [], level: 0, randomSeed: null };
    const ok = { kind: 'ok', error: null, fingerprint: 'ok', detail: '', errorCount: 0 };
    const crash = {
        kind: 'crash',
        error: { name: 'TypeError', message: 'keep' },
        fingerprint: '',
        detail: '',
        errorCount: 0
    };

    let timeoutCalls = 0;
    const timeoutResult = { kind: 'timeout', error: null, fingerprint: '', detail: 'timeout', errorCount: 0 };
    const shrunkTimeout = await garden.shrinkInteresting(mutant, timeoutResult, {
        shrink: true,
        shrinkBudget: 20,
        evaluate: async function() {
            timeoutCalls++;
            return { kind: 'compiler-error', error: null, fingerprint: 'compiler-error:1', detail: '', errorCount: 1 };
        }
    });
    assert.strictEqual(shrunkTimeout.source, original);
    assert.strictEqual(shrunkTimeout.result.kind, 'timeout');
    assert.strictEqual(timeoutCalls, 0);

    const shrinkCandidates = [];
    const shrunkCrash = await garden.shrinkInteresting(mutant, crash, {
        shrink: true,
        shrinkBudget: 20,
        evaluate: async function(partial) {
            shrinkCandidates.push(partial.source);
            if (partial.source.indexOf('keep') >= 0) {
                return crash;
            }
            return ok;
        }
    });
    assert.strictEqual(shrunkCrash.source, 'keep\n');
    assert.strictEqual(shrunkCrash.result.kind, 'crash');
    assert(shrinkCandidates.length > 0);
    shrinkCandidates.forEach(function(source) {
        assert(source.endsWith('\n'), JSON.stringify(source));
    });

    const seen = Object.create(null);
    const reverted = await garden.shrinkInteresting(mutant, crash, {
        shrink: true,
        shrinkBudget: 20,
        evaluate: async function(partial) {
            const source = partial.source;
            seen[source] = (seen[source] || 0) + 1;
            if (source.indexOf('later-crash') < 0 && seen[source] > 1) {
                return ok;
            }
            if (source.indexOf('keep') >= 0) {
                return crash;
            }
            return ok;
        }
    });
    assert.strictEqual(reverted.source, original);
    assert.strictEqual(reverted.result, crash);
});

test('level invariants accept a well-formed level and name the first broken field', function() {
    const good = {
        width: 2,
        height: 3,
        n_tiles: 6,
        objects: new Int32Array(12),
        movements: new Int32Array(6),
        commandQueue: [],
        rowCellContents: [0, 0, 0],
        colCellContents: [0, 0]
    };
    assert.strictEqual(garden.checkLevelInvariants(good, 2, 1), null);
    assert(/stride/.test(garden.checkLevelInvariants(good, 0, 1)));
    assert(/missing/.test(garden.checkLevelInvariants(null, 2, 1)));
    assert(/dimensions/.test(garden.checkLevelInvariants({
        width: 0, height: 3, n_tiles: 0, objects: new Int32Array(0), movements: new Int32Array(0)
    }, 2, 1)));
    assert(/n_tiles/.test(garden.checkLevelInvariants({
        width: 2, height: 3, n_tiles: 5, objects: new Int32Array(10), movements: new Int32Array(5)
    }, 2, 1)));
    assert(/objects/.test(garden.checkLevelInvariants({
        width: 2, height: 3, n_tiles: 6, objects: new Int32Array(5), movements: new Int32Array(6)
    }, 2, 1)));
    assert(/movements/.test(garden.checkLevelInvariants({
        width: 2, height: 3, n_tiles: 6, objects: new Int32Array(12)
    }, 2, 1)));
    assert(/commandQueue/.test(garden.checkLevelInvariants({
        width: 2, height: 3, n_tiles: 6,
        objects: new Int32Array(12), movements: new Int32Array(6),
        commandQueue: ['win']
    }, 2, 1)));
});

test('level occupancy counts a sign-bit object as one occupant', function() {
    const signBit = 1 << 31;
    const oneTile = {
        width: 1,
        height: 1,
        n_tiles: 1,
        objects: new Int32Array([signBit]),
        movements: new Int32Array(1)
    };
    const signMask = { layerMasks: [{ data: new Int32Array([signBit]) }] };
    assert.strictEqual(garden.checkLevelInvariants(oneTile, 1, 1, signMask), null);
    const twoBits = {
        width: 1,
        height: 1,
        n_tiles: 1,
        objects: new Int32Array([signBit | 1]),
        movements: new Int32Array(1)
    };
    const bothBits = { layerMasks: [{ data: new Int32Array([-1]) }] };
    assert(/collision layer/.test(garden.checkLevelInvariants(twoBits, 1, 1, bothBits)));
});

test('only crashes, timeouts, invariants, nondeterminism, and replay divergence are interesting', function() {
    assert.strictEqual(garden.isInteresting({ kind: 'ok' }), false);
    assert.strictEqual(garden.isInteresting({ kind: 'compiler-error' }), false);
    assert.strictEqual(garden.isInteresting({ kind: 'crash' }), true);
    assert.strictEqual(garden.isInteresting({ kind: 'timeout' }), true);
    assert.strictEqual(garden.isInteresting({ kind: 'invariant' }), true);
    assert.strictEqual(garden.isInteresting({ kind: 'nondeterministic' }), true);
    assert.strictEqual(garden.isInteresting({ kind: 'replay-divergence' }), true);
});

test('semantic-mismatch is interesting and baseline oracle fields are gated', function() {
    assert.strictEqual(garden.isInteresting({ kind: 'semantic-mismatch' }), true);

    const simulation = {
        kind: 'simulation',
        expectedOutput: 'board',
        expectedErrors: null,
        expectedErrorCount: null,
        inputs: [0, 1, 2]
    };
    assert.deepStrictEqual(
        garden.baselineOracleFields(simulation, { extraInputs: 0, maxInputs: 8 }),
        { expectedOutput: 'board' }
    );
    assert.deepStrictEqual(
        garden.baselineOracleFields(simulation, { extraInputs: 0, maxInputs: 3 }),
        { expectedOutput: 'board' }
    );
    assert.deepStrictEqual(
        garden.baselineOracleFields(simulation, { extraInputs: 0, maxInputs: 2 }),
        {}
    );
    assert.deepStrictEqual(
        garden.baselineOracleFields(simulation, { extraInputs: 3, maxInputs: 8 }),
        {}
    );
    assert.deepStrictEqual(
        garden.baselineOracleFields({
            kind: 'simulation',
            expectedOutput: null,
            inputs: [0]
        }, { extraInputs: 0, maxInputs: 8 }),
        {}
    );

    const compiler = {
        kind: 'compiler-message',
        expectedErrors: ['msg'],
        expectedErrorCount: 1,
        expectedOutput: null,
        inputs: []
    };
    assert.deepStrictEqual(
        garden.baselineOracleFields(compiler, { extraInputs: 3, maxInputs: 8 }),
        { expectedErrors: ['msg'], expectedErrorCount: 1 }
    );
    assert.deepStrictEqual(
        garden.baselineOracleFields(compiler, { extraInputs: 0, maxInputs: 8 }),
        { expectedErrors: ['msg'], expectedErrorCount: 1 }
    );
});

test('only causal mutants are attributed when the unmutated fixture already fails', function() {
    const baseline = {
        kind: 'replay-divergence',
        error: null,
        fingerprint: 'same',
        detail: 'x',
        errorCount: 0
    };
    const same = garden.attributeMonster(baseline, baseline);
    assert.strictEqual(same.save, false);
    assert.strictEqual(same.tally, 'baseline');
    const different = garden.attributeMonster(baseline, {
        kind: 'crash',
        error: { name: 'TypeError', message: 'boom' },
        fingerprint: '',
        detail: '',
        errorCount: 0
    });
    assert.strictEqual(different.save, true);
    assert.strictEqual(different.tally, 'crash');
    const healthy = garden.attributeMonster({
        kind: 'ok', error: null, fingerprint: 'f', detail: '', errorCount: 0
    }, baseline);
    assert.strictEqual(healthy.save, true);
    assert.strictEqual(healthy.tally, 'replay-divergence');
    assert.strictEqual(garden.attributeMonster({
        kind: 'compiler-error', error: null, fingerprint: 'compiler-error:1', detail: '', errorCount: 1
    }, { kind: 'ok', error: null, fingerprint: 'f', detail: '', errorCount: 0 }).save, false);
    assert.strictEqual(garden.attributeMonster({
        kind: 'compiler-warning', error: null, fingerprint: 'compiler-warning:1', detail: '', errorCount: 1
    }, { kind: 'ok', error: null, fingerprint: 'f', detail: '', errorCount: 0 }).save, false);
    const oracleMiss = garden.attributeMonster({
        kind: 'semantic-mismatch',
        error: null,
        fingerprint: 'diag',
        detail: 'expectedOutput',
        errorCount: 0
    }, {
        kind: 'ok',
        error: null,
        fingerprint: 'play',
        detail: '',
        errorCount: 0
    });
    assert.strictEqual(oracleMiss.save, false);
    assert.strictEqual(oracleMiss.tally, 'baseline');
    assert.strictEqual(garden.isHealthyKind('ok'), true);
    assert.strictEqual(garden.isHealthyKind('compiler-error'), true);
    assert.strictEqual(garden.isHealthyKind('compiler-warning'), true);
    assert.strictEqual(garden.isHealthyKind('crash'), false);
    assert.strictEqual(garden.isHealthyKind('replay-divergence'), false);
});

test('line shrinking keeps a deletion only when the signature stays the same', function() {
    const source = 'keep\nnoise\nkeep\n';
    const result = garden.shrinkSource(source, function(candidate) {
        return candidate.split('\n').filter(function(line) { return line === 'keep'; }).length === 2
            && candidate.indexOf('noise') < 0
            && candidate.endsWith('\n');
    }, 20);
    assert.strictEqual(result.source, 'keep\nkeep\n');
    assert(result.steps > 0);
    assert(result.steps <= 20);
});

test('artifact names and regression fixtures are copy-pasteable and path-safe', function() {
    const name = garden.artifactDirName('crash:TypeError:bad thing / \\ : *', 99, 3);
    assert.strictEqual(name, 'crash-TypeError-bad-thing-s99_0003');
    assert(!/[\/\\:*]/.test(name));
    const snippet = garden.formatRegression('monster garden 99 3', 'title "X"\nline\n', {
        inputs: [2, 3],
        level: 4,
        randomSeed: '1397263843369.0808'
    });
    assert.strictEqual(
        snippet,
        '[\n    "monster garden 99 3",\n    ["title \\"X\\"\\nline\\n", [2,3], "", 4, "1397263843369.0808"]\n],\n'
    );
});

test('writeArtifacts uses a unique temp directory and leaves dest intact until rename', function() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monster-garden-art-'));
    const destName = 'crash-demo-s1_0001';
    const dest = path.join(root, destName);
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'report.json'), '{"old":true}\n');
    const origRm = fs.rmSync;
    const origMkdtemp = fs.mkdtempSync;
    const removed = [];
    const prefixes = [];
    fs.rmSync = function(target, opts) {
        removed.push(target);
        return origRm.call(fs, target, opts);
    };
    fs.mkdtempSync = function(prefix, opts) {
        prefixes.push(prefix);
        return origMkdtemp.call(fs, prefix, opts);
    };
    let written;
    try {
        written = garden.writeArtifacts(root, destName, {
            'report.json': '{"new":true}\n',
            'original.txt': 'src\n'
        });
    } finally {
        fs.rmSync = origRm;
        fs.mkdtempSync = origMkdtemp;
    }
    assert.strictEqual(written, dest);
    assert.strictEqual(fs.readFileSync(path.join(dest, 'report.json'), 'utf8'), '{"new":true}\n');
    assert.strictEqual(fs.readFileSync(path.join(dest, 'original.txt'), 'utf8'), 'src\n');
    removed.forEach(function(target) {
        assert.notStrictEqual(path.resolve(target), path.resolve(dest));
    });
    assert(prefixes.length > 0);
    prefixes.forEach(function(prefix) {
        assert.strictEqual(prefix.indexOf(path.join(root, '.' + destName + '-')), 0);
    });
    const names = fs.readdirSync(root);
    assert.ok(names.indexOf(destName + '.tmp') < 0);
    names.forEach(function(name) {
        assert.ok(name.indexOf('.' + destName + '-') !== 0, name);
    });
});

test('writeArtifacts cleans unique temp dirs if writing fails', function() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monster-garden-art-fail-'));
    const destName = 'crash-demo-s1_0002';
    const origWrite = fs.writeFileSync;
    fs.writeFileSync = function() {
        throw new Error('disk full');
    };
    try {
        assert.throws(function() {
            garden.writeArtifacts(root, destName, { 'report.json': '{"new":true}\n' });
        }, /disk full/);
    } finally {
        fs.writeFileSync = origWrite;
    }
    const leftovers = fs.readdirSync(root).filter(function(name) {
        return name.indexOf('.' + destName + '-') === 0;
    });
    assert.deepStrictEqual(leftovers, []);
});

test('writeArtifacts restores dest if the replacement rename fails', function() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monster-garden-art-restore-'));
    const destName = 'crash-demo-s1_0003';
    const dest = path.join(root, destName);
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'report.json'), '{"old":true}\n');
    const origRename = fs.renameSync;
    fs.renameSync = function(from, to) {
        const fromNames = fs.existsSync(from) ? fs.readdirSync(from) : [];
        if (path.resolve(to) === path.resolve(dest)
            && path.resolve(from) !== path.resolve(dest)
            && fromNames.indexOf('original.txt') >= 0
            && !fs.existsSync(dest)) {
            const err = new Error('replacement rename failed');
            err.code = 'EXDEV';
            throw err;
        }
        return origRename.call(fs, from, to);
    };
    try {
        assert.throws(function() {
            garden.writeArtifacts(root, destName, {
                'report.json': '{"new":true}\n',
                'original.txt': 'src\n'
            });
        }, /replacement rename failed/);
    } finally {
        fs.renameSync = origRename;
    }
    assert.strictEqual(fs.readFileSync(path.join(dest, 'report.json'), 'utf8'), '{"old":true}\n');
    const leftovers = fs.readdirSync(root).filter(function(name) {
        return name.indexOf('.' + destName + '-') === 0;
    });
    assert.deepStrictEqual(leftovers, []);
});

test('writeTally replaces tally.json atomically and payload fields are stable', function() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monster-garden-tally-'));
    const counts = {
        ok: 1, 'compiler-error': 0, 'compiler-warning': 0, crash: 2,
        timeout: 0, invariant: 0, nondeterministic: 0, 'replay-divergence': 0,
        'semantic-mismatch': 0, baseline: 0, skipped: 0
    };
    const payload = garden.tallyPayload({
        seed: 9,
        forever: true,
        trials: 4,
        saved: 2,
        counts: counts,
        lastSaved: { dir: 'crash-demo-s9_0002', signature: 'crash:TypeError:x', kind: 'crash' }
    }, function() { return '2026-08-14T12:00:00.000Z'; });
    garden.writeTally(dir, payload);
    garden.writeTally(dir, payload);
    const names = fs.readdirSync(dir);
    assert.deepStrictEqual(names.filter(function(name) {
        return name !== 'tally.json';
    }), []);
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'tally.json'), 'utf8'));
    assert.strictEqual(parsed.seed, 9);
    assert.strictEqual(parsed.forever, true);
    assert.strictEqual(parsed.trials, 4);
    assert.strictEqual(parsed.saved, 2);
    assert.strictEqual(parsed.updatedAt, '2026-08-14T12:00:00.000Z');
    assert.deepStrictEqual(parsed.counts, counts);
    assert.strictEqual(parsed.lastTrial, undefined);
    assert.strictEqual(parsed.lastSaved.kind, 'crash');
    assert.strictEqual(
        garden.formatForeverStatus(counts, 4, 2),
        'trials=4 saved=2 crash=2 timeout=0 invariant=0 nondeterministic=0 replay-divergence=0 semantic-mismatch=0 equivalence-break=0'
    );
});

function runWorkerSync(job, timeoutMs, killSignal) {
    // worker.js ignores SIGINT/SIGTERM so that --forever survives a terminal
    // Ctrl+C (see garden.js forever mode). That means spawnSync's default
    // killSignal ('SIGTERM') cannot reap a worker that is genuinely hung in
    // an infinite loop: spawnSync will block past its own timeout waiting for
    // the (SIGTERM-immune) child to exit. Callers that expect a mutant might
    // hang for real (e.g. an again/restart loop) must pass killSignal:
    // 'SIGKILL' to guarantee the call returns.
    return spawnSync(process.execPath, [path.join(__dirname, 'worker.js')], {
        input: JSON.stringify(job),
        encoding: 'utf8',
        timeout: timeoutMs || 20000,
        killSignal: killSignal || 'SIGTERM'
    });
}

function workerResult(job) {
    const child = runWorkerSync(job);
    assert.strictEqual(child.error, undefined, child.stderr);
    const line = child.stdout.trim().split('\n').pop();
    return JSON.parse(line);
}

test('restart-again-message combines a turn command, a message and a tape restart, and the mutant runs without crashing', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'restart-again-message'; })[0];
    assert(mutator, 'restart-again-message should be registered');
    const fixture = { source: SAMPLE, inputs: [0, 3], level: 0, randomSeed: null };
    const seen = {};
    let appliedCount = 0;
    const hangs = [];
    for (let seed = 0; seed < 30; seed++) {
        const result = mutator.apply(SAMPLE, new garden.Random(seed), fixture);
        if (!result) {
            continue;
        }
        appliedCount++;
        const command = /(again|restart|checkpoint|win|cancel)\s+message garden/.exec(result.source);
        assert(command, 'seed ' + seed + ' should append a command and a message');
        assert(Array.isArray(result.inputs));
        assert.strictEqual(result.inputs.length, 3);
        assert(result.inputs.indexOf('restart') >= 0, 'restart should be spliced into the tape');

        // Compile and run the mutant for the first seed that hits each distinct
        // turn command, so this test stays bounded even though the whole point
        // of restart-again-message (issues #774, #981) is that a variant can
        // genuinely hang forever. worker.js ignores SIGTERM (so --forever
        // survives Ctrl+C), so runWorkerSync is called with killSignal:
        // 'SIGKILL' here -- without that override a real hang would block
        // spawnSync past its own timeout and never return.
        if (!seen[command[1]]) {
            seen[command[1]] = true;
            const job = {
                source: result.source,
                inputs: result.inputs,
                level: 0,
                randomSeed: null,
                replay: false,
                maxInputs: 8
            };
            const child = runWorkerSync(job, 5000, 'SIGKILL');
            if (child.error) {
                // A hang here is a legitimate outcome, not a test bug: it may be
                // issue #774 (infinite restart loop) or #981 (message+again hang)
                // reproducing for real. Report it loudly instead of asserting
                // kind !== 'timeout', but do not fail the test on it.
                hangs.push({
                    seed: seed,
                    command: command[1],
                    source: result.source,
                    inputs: result.inputs,
                    error: String(child.error)
                });
                continue;
            }
            const line = child.stdout.trim().split('\n').pop();
            const compiled = JSON.parse(line);
            assert(
                garden.KNOWN_RESULT_KINDS.indexOf(compiled.kind) >= 0,
                'seed ' + seed + ' (' + command[1] + ') returned an unknown result kind: ' + JSON.stringify(compiled)
            );
            // A crash is issue #341's shape (restart triggered on level start
            // corrupting engine state); it must fail loudly, not be tolerated.
            assert.notStrictEqual(
                compiled.kind,
                'crash',
                'seed ' + seed + ' (' + command[1] + ') crashed running the mutant (issue #341 shape): ' +
                    JSON.stringify({ source: result.source, inputs: result.inputs, compiled: compiled }, null, 2)
            );
        }
    }
    assert(appliedCount > 0, 'mutator should apply for at least one seed');
    assert(Object.keys(seen).length >= 3, 'expected several distinct turn commands across seeds');
    if (hangs.length > 0) {
        console.log(
            '\n[restart-again-message] observed ' + hangs.length +
            ' hang(s)/timeout(s) running the mutant -- possibly issues #774/#981 reproducing:\n' +
            JSON.stringify(hangs, null, 2)
        );
    }
});

test('comment-in-rule puts a parenthetical inside the brackets and is rejected cleanly', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'comment-in-rule'; })[0];
    assert(mutator, 'comment-in-rule should be registered');
    assert(!mutator.equivalence, 'comment-in-rule damages the program and must not claim equivalence');
    let succeeded = 0;
    for (let seed = 0; seed < 20; seed++) {
        const result = mutator.apply(SAMPLE, new garden.Random(seed), {});
        if (!result) {
            continue;
        }
        succeeded++;
        assert(/\[\s*\(garden\)/.test(result.source), 'seed ' + seed + ' should comment inside a bracket');
        assert.strictEqual(
            result.source.split('\n').length,
            SAMPLE.split('\n').length,
            'seed ' + seed + ' should not change the line count'
        );
    }
    assert(succeeded > 0, 'expected comment-in-rule to apply for at least one seed');

    // #1128's fix was a clear error message, not legalising the construct. The
    // point of this mutator is that the rejection stays an error: a crash here
    // would be the regression the issue was closed on.
    const mutated = mutator.apply(SAMPLE, new garden.Random(0), {});
    const compiled = workerResult({
        source: mutated.source,
        inputs: [],
        level: 0,
        randomSeed: null,
        replay: false,
        maxInputs: 8
    });
    assert(
        garden.KNOWN_RESULT_KINDS.indexOf(compiled.kind) >= 0,
        'unknown result kind: ' + JSON.stringify(compiled)
    );
    assert.notStrictEqual(
        compiled.kind,
        'crash',
        'a comment inside a rule must be reported, not crash the compiler: ' +
            JSON.stringify({ source: mutated.source, compiled: compiled }, null, 2)
    );
});

test('merge-game splices a donor game and compiles to a known kind', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'merge-game'; })[0];
    assert(mutator, 'merge-game should be registered');
    assert(!mutator.equivalence, 'merge-game changes behaviour and must not claim equivalence');

    // No donors available: the mutator must report inapplicable, not throw.
    assert.strictEqual(mutator.apply(SAMPLE, new garden.Random(1), {}, { donors: [] }), null);
    assert.strictEqual(mutator.apply(SAMPLE, new garden.Random(1), {}, undefined), null);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'garden-donor-'));
    try {
        const donorPath = path.join(dir, 'donor.txt');
        fs.writeFileSync(donorPath, DONOR_SAMPLE);
        const context = {
            donors: [donorPath],
            readDonor: function(p) { return fs.readFileSync(p, 'utf8'); }
        };
        let succeeded = 0;
        for (let seed = 0; seed < 12; seed++) {
            const result = mutator.apply(SAMPLE, new garden.Random(seed), {}, context);
            if (!result) {
                continue;
            }
            succeeded++;
            assert.notStrictEqual(result.source, SAMPLE);
            assert(/Water/.test(result.source), 'seed ' + seed + ' should bring the donor object across');
        }
        assert(succeeded > 0, 'expected merge-game to apply for at least one seed');

        const mutated = mutator.apply(SAMPLE, new garden.Random(0), {}, context);
        const compiled = workerResult({
            source: mutated.source,
            inputs: [],
            level: 0,
            randomSeed: null,
            replay: false,
            maxInputs: 8
        });
        assert(
            garden.KNOWN_RESULT_KINDS.indexOf(compiled.kind) >= 0,
            'unknown result kind: ' + JSON.stringify(compiled)
        );
        assert.notStrictEqual(
            compiled.kind,
            'crash',
            'merging two valid games must not crash the compiler: ' +
                JSON.stringify({ source: mutated.source, compiled: compiled }, null, 2)
        );
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('shuffle-rules reorders rule lines without losing any', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'shuffle-rules'; })[0];
    assert(mutator, 'shuffle-rules should be registered');
    assert(!mutator.equivalence, 'rule order is significant; this must not claim equivalence');
    const many = SAMPLE.replace(
        '[ > Player | Wall ] -> [ > Player | > Wall ] again',
        '[ > Player | Wall ] -> [ > Player | > Wall ] again\n[ Player ] -> [ Player ]\n[ Wall ] -> [ Wall ]\n[ Player Wall ] -> [ Player ]'
    );
    let succeeded = 0;
    for (let seed = 0; seed < 20; seed++) {
        const result = mutator.apply(many, new garden.Random(seed), {});
        if (!result) {
            continue;
        }
        succeeded++;
        const before = many.split('\n').filter(function(l) { return l.indexOf('->') >= 0; }).sort();
        const after = result.source.split('\n').filter(function(l) { return l.indexOf('->') >= 0; }).sort();
        assert.deepStrictEqual(after, before, 'seed ' + seed + ' must preserve the rule set');
        assert.notStrictEqual(result.source, many, 'seed ' + seed + ' should change the order');
    }
    assert(succeeded > 0, 'expected shuffle-rules to apply for at least one seed');

    const mutated = mutator.apply(many, new garden.Random(0), {});
    const compiled = workerResult({
        source: mutated.source, inputs: [], level: 0, randomSeed: null, replay: false, maxInputs: 8
    });
    assert(garden.KNOWN_RESULT_KINDS.indexOf(compiled.kind) >= 0, JSON.stringify(compiled));
    assert.notStrictEqual(compiled.kind, 'crash', JSON.stringify(compiled));
});

test('shuffle-levels permutes levels or scrambles rows', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'shuffle-levels'; })[0];
    assert(mutator, 'shuffle-levels should be registered');
    assert(!mutator.equivalence, 'shuffle-levels changes the game and must not claim equivalence');
    const many = SAMPLE.replace('PP\n..\n', 'PP\n..\n\n.P\nP.\n\nP.\n.P\n');
    let succeeded = 0;
    for (let seed = 0; seed < 20; seed++) {
        const result = mutator.apply(many, new garden.Random(seed), {});
        if (!result) {
            continue;
        }
        succeeded++;
        assert.notStrictEqual(result.source, many);
        // Whichever mode fired, the character budget of the level section is
        // unchanged: rows move, they are not invented or dropped.
        const cellsBefore = (many.match(/[P.]/g) || []).length;
        const cellsAfter = (result.source.match(/[P.]/g) || []).length;
        assert.strictEqual(cellsAfter, cellsBefore, 'seed ' + seed + ' should not add or drop cells');
    }
    assert(succeeded > 0, 'expected shuffle-levels to apply for at least one seed');

    const mutated = mutator.apply(many, new garden.Random(0), {});
    const compiled = workerResult({
        source: mutated.source, inputs: [], level: 0, randomSeed: null, replay: false, maxInputs: 8
    });
    assert(garden.KNOWN_RESULT_KINDS.indexOf(compiled.kind) >= 0, JSON.stringify(compiled));
    assert.notStrictEqual(compiled.kind, 'crash', JSON.stringify(compiled));
});

// Random-fill again rules once logged more than 100 distinct runtime messages,
// and parser.js's TooManyErrors abort then reached the worker as a crash. That
// was worked around by making TooManyErrors return while unitTesting; the real
// cause was later fixed in compiler.js, so this fixture now compiles and runs
// clean and the workaround has been dropped. The test stays as the guard: it
// was deleted by accident in 7a938656 and the regression would have been
// invisible without it.
test('flooding runtime errors should stop logging instead of crashing (TooManyErrors)', function() {
    const result = workerResult({
        source: `title flood runtime errors
========
OBJECTS
========
Background
black
Player
white
Wall
gray
player_1
red
player_2
blue
player_3
green
=======
LEGEND
=======
. = Background
P = Player
# = Wall
=======
SOUNDS
=======
================
COLLISIONLAYERS
================
Background
Player, Wall
player_1
player_2
player_3
======
RULES
======
random [ no Player ] -> [ Player ] again
late right [ Player | Player | Player ] -> [ Player player_1 | Player player_2 | Player player_3 ]
==============
WINCONDITIONS
==============
=======
LEVELS
=======
################
#..............#
#..............#
#..............#
#..............#
#..............#
#..............#
#..............#
#..............#
#..............#
#..............#
#..............#
#..............#
#.....P........#
################
`,
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    });
    assert.notStrictEqual(result.kind, 'crash', JSON.stringify(result));
});

test('multi-fault stacks several damaging mutators and never a preserving one', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'multi-fault'; })[0];
    assert(mutator, 'multi-fault should be registered');
    const preserving = garden.mutators
        .filter(function(m) { return m.equivalence; })
        .map(function(m) { return m.name; });
    let applied = 0;
    let compiled = 0;
    let burst = 0;
    const hangs = [];
    for (let seed = 0; seed < 30; seed++) {
        const fixture = { source: SAMPLE, inputs: [0, 3], level: 0, randomSeed: null };
        const result = mutator.apply(SAMPLE, new garden.Random(seed), fixture);
        if (!result) {
            continue;
        }
        applied++;
        assert.notStrictEqual(result.source, SAMPLE);
        const names = /applied (.+)$/.exec(result.detail)[1].split(' + ');
        assert(names.length >= 2, 'multi-fault should stack at least two: ' + result.detail);
        if (names.length >= 8) {
            burst++;
        }
        for (let i = 0; i < names.length; i++) {
            assert.strictEqual(names[i], names[i].trim());
            assert(preserving.indexOf(names[i]) < 0, names[i] + ' preserves semantics and must not be stacked');
            assert.notStrictEqual(names[i], 'multi-fault', 'multi-fault must not recurse');
        }

        // Compile a bounded sample of the mutants for real (issues #1012, #1002,
        // #980 concern behaviour under several simultaneous errors, and the only
        // way to know whether this mutator actually gets there is to run the
        // compiler on what it produces). worker.js ignores SIGTERM, so a real
        // hang (e.g. restart-again-message stacked in) would block spawnSync
        // past its own timeout without killSignal: 'SIGKILL'.
        if (compiled < 8) {
            compiled++;
            const job = {
                source: result.source,
                inputs: result.inputs || fixture.inputs,
                level: 0,
                randomSeed: null,
                replay: false,
                maxInputs: 8
            };
            const child = runWorkerSync(job, 5000, 'SIGKILL');
            if (child.error) {
                hangs.push({ seed: seed, names: names, error: String(child.error) });
                continue;
            }
            const line = child.stdout.trim().split('\n').pop();
            const parsed = JSON.parse(line);
            assert(
                garden.KNOWN_RESULT_KINDS.indexOf(parsed.kind) >= 0,
                'seed ' + seed + ' returned an unknown result kind: ' + JSON.stringify(parsed)
            );
            // A crash here is exactly the bug family #1012/#1002/#980 describe:
            // it must fail loudly, not be swallowed as an acceptable outcome.
            assert.notStrictEqual(
                parsed.kind,
                'crash',
                'seed ' + seed + ' crashed compiling a multi-fault mutant (' + names.join(' + ') + '): ' +
                    JSON.stringify({ source: result.source, inputs: job.inputs, compiled: parsed }, null, 2)
            );
        }
    }
    assert(applied > 0, 'expected multi-fault to apply for at least one seed');
    // The burst mode exists to reach compiler.js's `errorCount > MAX_ERRORS`
    // abort, which two or three stacked faults usually miss. Without this the
    // heavy-tail branch could be dropped and every other assertion would still
    // pass. It is not aiming at parser.js's MAX_ERRORS_FOR_REAL of 100: the
    // compile-time abort at 6 errors makes that threshold unreachable here.
    assert(burst > 0, 'expected at least one burst-sized stack across 30 seeds');
    if (hangs.length > 0) {
        console.log(
            '\n[multi-fault] observed ' + hangs.length +
            ' hang(s)/timeout(s) compiling a multi-fault mutant:\n' +
            JSON.stringify(hangs, null, 2)
        );
    }
});

// Regression: multiFault used to call mutator.apply(current, rng, job) without
// forwarding the fourth context argument, so a donor-consuming sub-mutator
// (merge-game) stacked through multi-fault always saw context === undefined
// and silently returned null, forever. Prove the fix by driving multi-fault
// with a real donor context and seeding until merge-game is picked into the
// stack; if the context were being dropped again, merge-game could never
// appear in `names` no matter how many seeds are tried.
test('multi-fault forwards its context to stacked sub-mutators (merge-game)', function() {
    const mutator = garden.mutators.filter(function(m) { return m.name === 'multi-fault'; })[0];
    assert(mutator, 'multi-fault should be registered');
    const context = {
        donors: ['donor-fixture'],
        readDonor: function() { return DONOR_SAMPLE; }
    };
    let sawMergeGame = false;
    for (let seed = 0; seed < 200 && !sawMergeGame; seed++) {
        const fixture = { source: SAMPLE, inputs: [0, 3], level: 0, randomSeed: null };
        const result = mutator.apply(SAMPLE, new garden.Random(seed), fixture, context);
        if (!result) {
            continue;
        }
        const names = /applied (.+)$/.exec(result.detail)[1].split(' + ');
        if (names.indexOf('merge-game') >= 0) {
            sawMergeGame = true;
        }
    }
    assert(
        sawMergeGame,
        'merge-game never appeared in a multi-fault stack across 200 seeds; ' +
            'multi-fault must forward its context argument to sub-mutator apply() calls'
    );
});

test('the worker compiles a valid sample and returns a stable ok fingerprint', function() {
    const job = {
        source: SAMPLE,
        inputs: [0, 3],
        level: 0,
        randomSeed: null,
        replay: false,
        maxInputs: 8
    };
    const first = workerResult(job);
    const second = workerResult(job);
    assert.strictEqual(first.kind, 'ok', JSON.stringify(first));
    assert.strictEqual(first.error, null);
    assert.strictEqual(typeof first.fingerprint, 'string');
    const parsed = JSON.parse(first.fingerprint);
    assert.strictEqual(parsed.errorCount, 0);
    assert.strictEqual(typeof parsed.board, 'string');
    assert(Array.isArray(parsed.objects));
    assert.strictEqual(first.errorCount, 0);
    assert.deepStrictEqual(first, second);
});

test('structure-aware mutators usually keep a compiling sample compiling', function() {
    const names = ['duplicate-rule-line', 'swap-object-colors', 'nudge-level-cell', 'flip-win-quantifier'];
    names.forEach(function(name) {
        const mutator = garden.mutators.find(function(item) { return item.name === name; });
        assert(mutator, name);
        const rng = new garden.Random(7);
        let source = SAMPLE;
        let applied = mutator.apply(source, rng);
        if (!applied) {
            source = SAMPLE.replace(
                '==============\nWINCONDITIONS\n==============\n\n',
                '==============\nWINCONDITIONS\n==============\n\nall crate on target\n\n'
            );
            applied = mutator.apply(source, new garden.Random(7));
        }
        assert(applied);
        assert.notStrictEqual(applied.source, source);
        const result = workerResult({
            source: applied.source,
            inputs: [0],
            level: 0,
            randomSeed: 'garden-seed',
            replay: false,
            maxInputs: 8
        });
        assert.notStrictEqual(result.kind, 'crash', name + ' ' + JSON.stringify(result));
    });
});

const NUDGE_L_SOURCE = `title Nudge L
========
OBJECTS
========

Background
black

Player
white

=======
LEGEND
=======

. = Background
L = Player

=========
SOUNDS
=========

================
COLLISIONLAYERS
================

Background
Player

======
RULES
======

==============
WINCONDITIONS
==============

=======
LEVELS
=======

L.
..
`;

test('nudge-level-cell never rewrites the LEVELS header', function() {
    const mutator = garden.mutators.find(function(item) { return item.name === 'nudge-level-cell'; });
    assert(mutator);
    let succeeded = 0;
    for (let seed = 0; seed < 30; seed++) {
        const applied = mutator.apply(NUDGE_L_SOURCE, new garden.Random(seed));
        if (!applied) {
            continue;
        }
        succeeded++;
        const levelsLine = applied.source.split('\n').find(function(line) {
            return line.trim().toUpperCase() === 'LEVELS';
        });
        assert(levelsLine, 'seed ' + seed + ' lost exact LEVELS header');
        assert.strictEqual(levelsLine.trim().toUpperCase(), 'LEVELS');
    }
    assert(succeeded > 0, 'nudge-level-cell should apply at least once');
});

const SWAP_RED_SOURCE = `title Swap Red
========
OBJECTS
========

Background
black

Red
black

Player
white

=======
LEGEND
=======

. = Background
P = Player

=========
SOUNDS
=========

================
COLLISIONLAYERS
================

Background
Player
Red

======
RULES
======

==============
WINCONDITIONS
==============

=======
LEVELS
=======

P.
`;

test('swap-object-colors does not rewrite an object named Red', function() {
    const mutator = garden.mutators.find(function(item) { return item.name === 'swap-object-colors'; });
    assert(mutator);
    let succeeded = 0;
    for (let seed = 0; seed < 30; seed++) {
        const applied = mutator.apply(SWAP_RED_SOURCE, new garden.Random(seed));
        if (!applied) {
            continue;
        }
        succeeded++;
        const lines = applied.source.split('\n');
        let i = 0;
        while (i < lines.length && lines[i].trim().toUpperCase() !== 'OBJECTS') {
            i++;
        }
        const names = [];
        let wantName = true;
        for (i = i + 1; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed.toUpperCase() === 'LEGEND') {
                break;
            }
            if (trimmed === '' || /^=+$/.test(trimmed)) {
                if (trimmed === '') {
                    wantName = true;
                }
                continue;
            }
            if (wantName) {
                names.push(trimmed);
                wantName = false;
            }
        }
        assert(names.indexOf('Red') >= 0, 'seed ' + seed + ' rewrote object name Red');
        assert(applied.source.split('\n').some(function(line) {
            return line.trim() === 'Red';
        }), 'seed ' + seed + ' lost a whole-line Red name');
    }
    assert(succeeded > 0, 'swap-object-colors should apply at least once');
});

const SWAP_BLACK_ONLY_SOURCE = `title Black Only
========
OBJECTS
========

Background
black

Player
black

=======
LEGEND
=======

. = Background
P = Player

=========
SOUNDS
=========

================
COLLISIONLAYERS
================

Background
Player

======
RULES
======

==============
WINCONDITIONS
==============

=======
LEVELS
=======

P.
`;

test('swap-object-colors returns null when both colors are the same word', function() {
    const mutator = garden.mutators.find(function(item) { return item.name === 'swap-object-colors'; });
    assert(mutator);
    const applied = mutator.apply(SWAP_BLACK_ONLY_SOURCE, new garden.Random(0));
    assert.strictEqual(applied, null);
});

test('perpendicular as a rule direction should error instead of crashing (delta_index)', function() {
    const result = workerResult({
        source: `title perpendicular rule prefix
run_rules_on_level_start

========
OBJECTS
========

Background
black

Player
white

Crate
orange

=======
LEGEND
=======

. = Background
P = Player
* = Crate

=========
SOUNDS
=========

================
COLLISIONLAYERS
================

Background
Player, Crate

======
RULES
======

perpendicular [ > Player | Crate ] -> [ > Player | > Crate ]

==============
WINCONDITIONS
==============

=======
LEVELS
=======

P*
`,
        inputs: [],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    });
    assert.notStrictEqual(result.kind, 'crash', JSON.stringify(result));
    assert.strictEqual(result.kind, 'compiler-error', JSON.stringify(result));
});

test('a win condition on an undefined name should error instead of crashing (bitsClearInArray)', function() {
    const result = workerResult({
        source: `title win on missing name
run_rules_on_level_start

========
OBJECTS
========

Background
black

Player
white

=======
LEGEND
=======

. = Background
P = Player

=========
SOUNDS
=========

================
COLLISIONLAYERS
================

Background
Player

======
RULES
======

==============
WINCONDITIONS
==============

all Floop on Player

=======
LEVELS
=======

P
`,
        inputs: [],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    });
    assert.notStrictEqual(result.kind, 'crash', JSON.stringify(result));
    assert.strictEqual(result.kind, 'compiler-error', JSON.stringify(result));
});

test('a background property of missing objects should error instead of crashing (calcBackgroundMask)', function() {
    const result = workerResult({
        source: `title background property of missing objects
========
OBJECTS
========

LowPlayerTop
white

LowPlayer
black

=======
LEGEND
=======

P = LowPlayer
Background = LowFloor or Wall

=========
SOUNDS
=========

================
COLLISIONLAYERS
================

LowPlayerTop

======
RULES
======

==============
WINCONDITIONS
==============

=======
LEVELS
=======

P
`,
        inputs: [],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    });
    assert.notStrictEqual(result.kind, 'crash', JSON.stringify(result));
    assert.strictEqual(result.kind, 'compiler-error', JSON.stringify(result));
});

test('a compiled game with fewer levels than job.level is ok, not a crash', function() {
    const result = workerResult({
        source: SAMPLE,
        inputs: [],
        level: 13,
        randomSeed: null,
        replay: false,
        maxInputs: 8
    });
    assert.strictEqual(result.kind, 'ok', JSON.stringify(result));
    assert.strictEqual(result.error, null);
});

test('ok fingerprints include rng and mode, not only the board string', function() {
    const result = workerResult({
        source: SAMPLE,
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    });
    assert.strictEqual(result.kind, 'ok', JSON.stringify(result));
    const parsed = JSON.parse(result.fingerprint);
    assert.strictEqual(parsed.errorCount, 0);
    assert.strictEqual(typeof parsed.board, 'string');
    assert(Array.isArray(parsed.objects));
    assert(parsed.rng && typeof parsed.rng.i === 'number');
    assert.strictEqual(typeof parsed.titleScreen, 'boolean');
});

test('invariants are checked after each input', function() {
    const result = workerResult({
        source: SAMPLE,
        inputs: [0, 3],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    });
    assert.strictEqual(result.kind, 'ok', JSON.stringify(result));
});

test('play fingerprints stay JSON after a compile-success runtime error', function() {
    const result = workerResult({
        source: `title Loop Fingerprint
========
OBJECTS
========

Background
black

Player
white

Crate
gray

=======
LEGEND
=======

. = Background
P = Player

=========
SOUNDS
=========

================
COLLISIONLAYERS
================

Background
Player, Crate

======
RULES
======

[ Player ] -> [ Crate ]
+ [ Crate ] -> [ Player ]

==============
WINCONDITIONS
==============

=======
LEVELS
=======

P
`,
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    });
    assert.strictEqual(result.kind, 'ok', JSON.stringify(result));
    assert.notStrictEqual(result.fingerprint.indexOf('compiler-error:'), 0, result.fingerprint.slice(0, 80));
    const parsed = JSON.parse(result.fingerprint);
    assert.strictEqual(typeof parsed.board, 'string');
    assert(parsed.errorCount > 0, JSON.stringify(parsed));
});

test('replaying a looping rule group does not accumulate runtime errors in the fingerprint', function() {
    const result = workerResult({
        source: `title Loop Fingerprint
========
OBJECTS
========

Background
black

Player
white

Crate
gray

=======
LEGEND
=======

. = Background
P = Player

=========
SOUNDS
=========

================
COLLISIONLAYERS
================

Background
Player, Crate

======
RULES
======

[ Player ] -> [ Crate ]
+ [ Crate ] -> [ Player ]

==============
WINCONDITIONS
==============

=======
LEVELS
=======

P
`,
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: true,
        maxInputs: 8
    });
    assert.notStrictEqual(result.kind, 'replay-divergence', JSON.stringify(result));
    assert.strictEqual(result.kind, 'ok', JSON.stringify(result));
});

test('replay after winning onto a differently sized level does not crash', function() {
    const result = workerResult({
        source: `title Size Change
========
OBJECTS
========

Background
black

Player
white

=======
LEGEND
=======

. = Background
P = Player

=========
SOUNDS
=========

================
COLLISIONLAYERS
================

Background
Player

======
RULES
======

[ Player ] -> [ Player ] win

==============
WINCONDITIONS
==============

=======
LEVELS
=======

P...

P.
`,
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: true,
        maxInputs: 8
    });
    assert.notStrictEqual(result.kind, 'crash', JSON.stringify(result));
    assert.strictEqual(result.kind, 'ok', JSON.stringify(result));
    const parsed = JSON.parse(result.fingerprint);
    assert.strictEqual(typeof parsed.board, 'string');
});

test('winning onto the next level then replaying stays ok with a canonical seed', function() {
    const result = workerResult({
        source: `title Win Then Replay
========
OBJECTS
========

Background
black

Player
white

=======
LEGEND
=======

. = Background
P = Player

=========
SOUNDS
=========

================
COLLISIONLAYERS
================

Background
Player

======
RULES
======

==============
WINCONDITIONS
==============

some Player

=======
LEVELS
=======

P

P.
`,
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: true,
        maxInputs: 8
    });
    assert.strictEqual(result.kind, 'ok', JSON.stringify(result));
    const parsed = JSON.parse(result.fingerprint);
    assert.strictEqual(parsed.curlevel, 1);
    assert.strictEqual(parsed.rng.seed, 'garden-seed');
});

test('replaying a tape that restarts then wins does not use a stale restartTarget', function() {
    const result = workerResult({
        source: `title Restart Then Win
========
OBJECTS
========

Background
black

Player
white

Crate
orange

Target
blue

=======
LEGEND
=======

. = Background
P = Player
* = Crate
O = Target
@ = Crate and Target

=========
SOUNDS
=========

================
COLLISIONLAYERS
================

Background
Target
Player, Crate

======
RULES
======

[ > Player | Crate ] -> [ > Player | > Crate ]

==============
WINCONDITIONS
==============

all Crate on Target

=======
LEVELS
=======

P*O

*P
`,
        inputs: [1, 'restart', 3],
        level: 0,
        randomSeed: 'garden-seed',
        replay: true,
        maxInputs: 8
    });
    assert.notStrictEqual(result.kind, 'replay-divergence', JSON.stringify(result));
    assert.strictEqual(result.kind, 'ok', JSON.stringify(result));
});

test('an aggregate Background with no assigned objects is a compiler-error, not a crash', function() {
    const result = workerResult({
        source: `LEGEND
Background = Player and Wall
COLLISIONLAYERS
player
`,
        inputs: [],
        level: 0,
        randomSeed: null,
        replay: true,
        maxInputs: 8
    });
    assert.notStrictEqual(result.kind, 'crash', JSON.stringify(result));
    assert.strictEqual(result.kind, 'compiler-error', JSON.stringify(result));
    assert(result.errorCount > 0);
});

test('an object Background redefined as an aggregate of missing names is a compiler-error, not a crash', function() {
    const result = workerResult({
        source: `OBJECTS
Background Player .
LEGEND
Background = Player and Wall
COLLISIONLAYERS
Background
`,
        inputs: [],
        level: 0,
        randomSeed: null,
        replay: true,
        maxInputs: 8
    });
    assert.notStrictEqual(result.kind, 'crash', JSON.stringify(result));
    assert.strictEqual(result.kind, 'compiler-error', JSON.stringify(result));
    assert(result.errorCount > 0);
});

test('the worker treats compile diagnostics as compiler-error, not a crash', function() {
    const result = workerResult({
        source: `title No Background
=======
OBJECTS
=======

Player
white

=======
LEGEND
=======
P = Player
`,
        inputs: [0],
        level: 0,
        randomSeed: null,
        replay: true,
        maxInputs: 8
    });
    assert.strictEqual(result.kind, 'compiler-error', JSON.stringify(result));
    assert.strictEqual(result.error, null);
    assert(result.errorCount > 0);
    assert(result.fingerprint.indexOf('compiler-error:' + result.errorCount + ':') === 0);
});

test('the worker echoes a canonical engineSeed and rejects a non-integer level', function() {
    const withSeed = workerResult({
        source: SAMPLE,
        inputs: [],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    });
    assert.strictEqual(withSeed.kind, 'ok', JSON.stringify(withSeed));
    assert.strictEqual(withSeed.engineSeed, 'garden-seed');
    const invented = workerResult({
        source: SAMPLE,
        inputs: [],
        level: 0,
        randomSeed: null,
        replay: false,
        maxInputs: 8
    });
    assert.strictEqual(invented.kind, 'ok', JSON.stringify(invented));
    assert.strictEqual(typeof invented.engineSeed, 'string');
    assert(invented.engineSeed.length > 0);
    const badLevel = workerResult({
        source: SAMPLE,
        inputs: [],
        level: '0',
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    });
    assert.strictEqual(badLevel.kind, 'crash', JSON.stringify(badLevel));
    assert.strictEqual(badLevel.engineSeed, 'garden-seed');
});

test('expectedOutput mismatches are semantic-mismatch', function() {
    const ok = workerResult({
        source: SAMPLE,
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    });
    assert.strictEqual(ok.kind, 'ok', JSON.stringify(ok));
    const parsed = JSON.parse(ok.fingerprint);
    const mismatch = workerResult({
        source: SAMPLE,
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8,
        expectedOutput: 'not-the-board'
    });
    assert.strictEqual(mismatch.kind, 'semantic-mismatch', JSON.stringify(mismatch));
    const match = workerResult({
        source: SAMPLE,
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8,
        expectedOutput: parsed.board
    });
    assert.strictEqual(match.kind, 'ok', JSON.stringify(match));
});

test('compiler-message oracles compare stripped messages', function() {
    const corpus = garden.loadCorpus(path.join(__dirname, '..', 'resources'));
    const item = corpus.find(function(row) { return row.name === 'Background missing'; });
    assert(item);
    const match = workerResult({
        source: item.source,
        inputs: [],
        level: 0,
        randomSeed: null,
        replay: false,
        maxInputs: 8,
        expectedErrors: item.expectedErrors,
        expectedErrorCount: item.expectedErrorCount
    });
    assert.strictEqual(match.kind, 'compiler-error', JSON.stringify(match));
    const mismatch = workerResult({
        source: item.source,
        inputs: [],
        level: 0,
        randomSeed: null,
        replay: false,
        maxInputs: 8,
        expectedErrors: ['this message is not produced'],
        expectedErrorCount: 2
    });
    assert.strictEqual(mismatch.kind, 'semantic-mismatch', JSON.stringify(mismatch));
});

test('warning-only compiles are compiler-warning, not ok', function() {
    const corpus = garden.loadCorpus(path.join(__dirname, '..', 'resources'));
    const warning = corpus.find(function(item) {
        return item.kind === 'compiler-message' && item.expectedErrorCount === 0;
    });
    assert(warning, 'need a warning-only compiler-message fixture');
    const result = workerResult({
        source: warning.source,
        inputs: [],
        level: 0,
        randomSeed: null,
        replay: false,
        maxInputs: 8
    });
    assert.strictEqual(result.kind, 'compiler-warning', JSON.stringify(result));
    assert.strictEqual(result.errorCount, 0);
    assert(Array.isArray(result.errorStrings));
    assert(result.errorStrings.length > 0);
});

test('the worker reports a crash when execution throws', function() {
    const result = workerResult({
        source: SAMPLE,
        inputs: ['not-a-command'],
        level: 0,
        randomSeed: null,
        replay: false,
        maxInputs: 8
    });
    assert.strictEqual(result.kind, 'crash', JSON.stringify(result));
    assert.strictEqual(typeof result.error.name, 'string');
    assert.strictEqual(typeof result.error.message, 'string');
});

test('unmutated legend of zokoban with replay is ok', function() {
    const corpus = garden.loadCorpus(path.join(__dirname, '..', 'resources'));
    const zokoban = corpus.find(function(item) { return item.name === 'legend of zokoban'; });
    assert(zokoban, 'legend of zokoban should be in the simulation corpus');
    const result = workerResult({
        source: zokoban.source,
        inputs: zokoban.inputs,
        level: zokoban.level,
        randomSeed: zokoban.randomSeed,
        replay: true,
        maxInputs: 8
    });
    assert.strictEqual(result.kind, 'ok', JSON.stringify(result));
});

test('a compiling message-only game is ok, not an invariant failure', function() {
    const result = workerResult({
        source: `title Message Only

========
OBJECTS
========

Background
black

Player
white

=======
LEGEND
=======

. = Background
P = Player

=========
SOUNDS
=========

================
COLLISIONLAYERS
================

Background
Player

======
RULES
======

==============
WINCONDITIONS
==============

=======
LEVELS
=======

message hello
`,
        inputs: [0, 3],
        level: 0,
        randomSeed: null,
        replay: true,
        maxInputs: 8
    });
    assert.notStrictEqual(result.kind, 'invariant', JSON.stringify(result));
    assert.strictEqual(result.kind, 'ok', JSON.stringify(result));
});

test('the parent classifies a hung child as timeout', function() {
    const hung = path.join(os.tmpdir(), 'monster-garden-hang.js');
    fs.writeFileSync(hung, 'setTimeout(function() {}, 100000);\n');
    const largeStdin = JSON.stringify({ source: 'x'.repeat(200 * 1024), inputs: [], level: 0 });
    return garden.runChild(process.execPath, [hung], largeStdin, 80).then(function(result) {
        assert.strictEqual(result.kind, 'timeout');
    });
});

const KNOWN = [
    'ok', 'compiler-error', 'compiler-warning', 'crash',
    'invariant', 'nondeterministic', 'replay-divergence', 'semantic-mismatch',
    'equivalence-break'
];

test('runChild rejects parseable non-results and nonzero exits', function() {
    assert.deepStrictEqual(garden.KNOWN_RESULT_KINDS, KNOWN);
    const empty = path.join(os.tmpdir(), 'monster-garden-empty-json.js');
    fs.writeFileSync(empty, 'process.stdout.write("{}\\n"); process.exit(0);\n');
    return garden.runChild(process.execPath, [empty], '{}', 2000).then(function(result) {
        assert.strictEqual(result.kind, 'crash');
        const liar = path.join(os.tmpdir(), 'monster-garden-ok-nonzero.js');
        fs.writeFileSync(liar, 'process.stdout.write(JSON.stringify({kind:"ok",error:null,fingerprint:"x",detail:"",errorCount:0})+"\\n"); process.exit(73);\n');
        return garden.runChild(process.execPath, [liar], '{}', 2000);
    }).then(function(result) {
        assert.strictEqual(result.kind, 'crash');
        const euro = path.join(os.tmpdir(), 'monster-garden-utf8.js');
        fs.writeFileSync(euro, 'process.stdout.write(JSON.stringify({kind:"crash",error:{name:"Error",message:"euro € here"},fingerprint:"",detail:"",errorCount:0})+"\\n");\n');
        return garden.runChild(process.execPath, [euro], '{}', 2000);
    }).then(function(result) {
        assert.strictEqual(result.kind, 'crash');
        assert.strictEqual(result.error.message, 'euro € here');
        const jsonNull = path.join(os.tmpdir(), 'monster-garden-null-json.js');
        fs.writeFileSync(jsonNull, 'process.stdout.write("null\\n");\n');
        return garden.runChild(process.execPath, [jsonNull], '{}', 2000);
    }).then(function(result) {
        assert.strictEqual(result.kind, 'crash');
        const silent = path.join(os.tmpdir(), 'monster-garden-empty-stdout.js');
        fs.writeFileSync(silent, 'process.exit(0);\n');
        return garden.runChild(process.execPath, [silent], '{}', 2000);
    }).then(function(result) {
        assert.strictEqual(result.kind, 'crash');
        assert.strictEqual(result.error.message, 'empty worker stdout');
        const array = path.join(os.tmpdir(), 'monster-garden-array-json.js');
        fs.writeFileSync(array, 'process.stdout.write("[]\\n");\n');
        return garden.runChild(process.execPath, [array], '{}', 2000);
    }).then(function(result) {
        assert.strictEqual(result.kind, 'crash');
        const workerTimeout = path.join(os.tmpdir(), 'monster-garden-timeout-kind.js');
        fs.writeFileSync(workerTimeout, 'process.stdout.write(JSON.stringify({kind:"timeout",error:null,fingerprint:"",detail:"timeout",errorCount:0})+"\\n");\n');
        return garden.runChild(process.execPath, [workerTimeout], '{}', 2000);
    }).then(function(result) {
        assert.strictEqual(result.kind, 'crash');
    });
});

test('runChild prefers a finished ok result over a late timeout', function() {
    const payload = JSON.stringify({
        kind: 'ok', error: null, fingerprint: 'x', detail: '', errorCount: 0
    });
    const kinds = [];
    let chain = Promise.resolve();
    for (let i = 0; i < 40; i++) {
        chain = chain.then(function() {
            return garden.runChild('/bin/echo', [payload], '{}', 1).then(function(result) {
                kinds.push(result.kind);
                assert.ok(result.kind === 'ok' || result.kind === 'timeout', result.kind);
            });
        });
    }
    return chain.then(function() {
        assert.ok(kinds.indexOf('ok') >= 0, 'expected a finished ok among ' + kinds.join(','));
    });
});

test('runChild onSpawn receives the live child process', function() {
    const payload = JSON.stringify({
        kind: 'ok', error: null, fingerprint: 'x', detail: '', errorCount: 0
    });
    let seen = null;
    return garden.runChild('/bin/echo', [payload], '{}', 2000, function(child) {
        seen = child;
        assert.strictEqual(typeof child.pid, 'number');
        assert.strictEqual(typeof child.kill, 'function');
    }).then(function(result) {
        assert(seen);
        assert.strictEqual(result.kind, 'ok');
    });
});

test('run.js --list-mutators prints every mutator and exits 0', function() {
    const child = spawnSync(process.execPath, [path.join(__dirname, 'run.js'), '--list-mutators'], {
        encoding: 'utf8'
    });
    assert.strictEqual(child.status, 0, child.stderr);
    garden.mutators.forEach(function(mutator) {
        assert(child.stdout.indexOf(mutator.name) >= 0, mutator.name);
    });
});

test('run.js rejects malformed options with a nonzero exit', function() {
    const child = spawnSync(process.execPath, [path.join(__dirname, 'run.js'), '--count', '0'], {
        encoding: 'utf8'
    });
    assert.notStrictEqual(child.status, 0);
    assert(/count/.test(child.stderr));
    const oversized = spawnSync(process.execPath, [path.join(__dirname, 'run.js'), '--timeout-ms', '2147483648'], {
        encoding: 'utf8'
    });
    assert.notStrictEqual(oversized.status, 0);
    assert(/timeout-ms/.test(oversized.stderr));
    const both = spawnSync(process.execPath, [
        path.join(__dirname, 'run.js'), '--forever', '--count', '3'
    ], { encoding: 'utf8' });
    assert.notStrictEqual(both.status, 0);
    assert(/forever/.test(both.stderr));
});

test('a one-mutant CLI run is deterministic and writes no artifacts for healthy output', function() {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'monster-garden-'));
    const args = [
        path.join(__dirname, 'run.js'),
        '--seed', '12345',
        '--count', '1',
        '--no-shrink',
        '--no-replay',
        '--timeout-ms', '20000',
        '--output', output
    ];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    const second = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.strictEqual(first.status, 0, first.stderr + first.stdout);
    assert.strictEqual(second.status, 0, second.stderr + second.stdout);
    assert.strictEqual(first.stdout, second.stdout);
    const names = fs.readdirSync(output).sort();
    assert.deepStrictEqual(names, []);
});

test('run.js --forever stops on SIGINT and prints counts', function() {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'monster-garden-forever-'));
    const child = spawn(process.execPath, [
        path.join(__dirname, 'run.js'),
        '--forever',
        '--seed', '1',
        '--no-shrink',
        '--no-replay',
        '--timeout-ms', '20000',
        '--output', output
    ]);
    let stdout = '';
    let signalled = false;
    child.stdout.on('data', function(chunk) {
        stdout += chunk.toString();
        if (!signalled && stdout.indexOf('#') >= 0) {
            signalled = true;
            child.kill('SIGINT');
        }
    });
    return new Promise(function(resolve, reject) {
        const timer = setTimeout(function() {
            child.kill('SIGKILL');
            reject(new Error('forever process did not exit after SIGINT; stdout=' + stdout.slice(0, 200)));
        }, 30000);
        child.on('error', function(error) {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', function(code) {
            clearTimeout(timer);
            try {
                assert.strictEqual(code, 0, stdout);
                assert(signalled);
                const names = fs.readdirSync(output);
                const artifactDirs = names.filter(function(name) { return name !== 'tally.json'; });
                if (artifactDirs.length === 0) {
                    assert.ok(names.indexOf('tally.json') < 0, 'tally.json should not exist when nothing was saved');
                } else {
                    const tally = JSON.parse(fs.readFileSync(path.join(output, 'tally.json'), 'utf8'));
                    assert.strictEqual(tally.lastTrial, undefined);
                    assert(tally.lastSaved);
                    assert.strictEqual(tally.saved, artifactDirs.length);
                }
                const lines = stdout.trim().split('\n').filter(Boolean);
                const summary = JSON.parse(lines[lines.length - 1]);
                assert.strictEqual(typeof summary.ok, 'number');
                assert.strictEqual(typeof summary.crash, 'number');
                assert.strictEqual(typeof summary.skipped, 'number');
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
});

test('worker.js ignores SIGINT and still emits a JSON result', function() {
    const job = {
        source: SAMPLE,
        inputs: [0, 3],
        level: 0,
        randomSeed: null,
        replay: false,
        maxInputs: 8
    };
    const child = spawn(process.execPath, [path.join(__dirname, 'worker.js')]);
    let stdout = '';
    child.stdout.on('data', function(chunk) {
        stdout += chunk.toString();
    });
    child.stdin.write(JSON.stringify(job));
    return new Promise(function(resolve, reject) {
        const timer = setTimeout(function() {
            child.kill('SIGKILL');
            reject(new Error('worker did not finish after SIGINT; stdout=' + stdout.slice(0, 200)));
        }, 20000);
        child.on('error', function(error) {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', function(code, signal) {
            clearTimeout(timer);
            try {
                assert.strictEqual(signal, null, 'worker died from ' + signal);
                assert.strictEqual(code, 0, stdout);
                const line = stdout.trim().split('\n').pop();
                const result = JSON.parse(line);
                assert(
                    result.kind === 'ok' || result.kind === 'compiler-error',
                    JSON.stringify(result)
                );
                resolve();
            } catch (error) {
                reject(error);
            }
        });
        setTimeout(function() {
            child.kill('SIGINT');
            child.stdin.end();
        }, 200);
    });
});

test('run.js --count exits on the first SIGINT', function() {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'monster-garden-count-int-'));
    const child = spawn(process.execPath, [
        path.join(__dirname, 'run.js'),
        '--seed', '1',
        '--count', '100',
        '--no-shrink',
        '--no-replay',
        '--timeout-ms', '20000',
        '--output', output
    ]);
    let signalled = false;
    child.stdout.on('data', function() {
        if (!signalled) {
            signalled = true;
            child.kill('SIGINT');
        }
    });
    return new Promise(function(resolve, reject) {
        const timer = setTimeout(function() {
            child.kill('SIGKILL');
            reject(new Error('--count did not exit on first SIGINT'));
        }, 15000);
        child.on('error', function(error) {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', function(code, signal) {
            clearTimeout(timer);
            try {
                assert(
                    signal === 'SIGINT' || (code !== 0 && code !== null),
                    'expected SIGINT or nonzero exit, got code=' + code + ' signal=' + signal
                );
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
});

test('a semantics-preserving campaign finds no equivalence breaks', async function() {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'garden-equivalence-'));
    const names = garden.mutators
        .filter(function(mutator) { return mutator.equivalence; })
        .map(function(mutator) { return mutator.name; })
        .join(',');
    const result = spawnSync(process.execPath, [
        path.join(__dirname, 'run.js'),
        '--seed', '31337',
        '--count', '40',
        '--mutator', names,
        '--timeout-ms', '8000',
        '--output', output
    ], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
    // run.js's finite-campaign summary has always been a JSON.stringify(counts)
    // line (colon-separated), never the "key=value" text that
    // formatForeverStatus produces for --forever's live TTY status; match the
    // JSON shape the process actually emits.
    const match = /"equivalence-break":(\d+)/.exec(result.stdout);
    assert(match, 'summary should report an equivalence-break count:\n' + result.stdout);
    assert.strictEqual(
        match[1],
        '0',
        'semantics-preserving mutators must not break equivalence.\n' +
        'A non-zero count is a real compiler bug, not a test failure to paper over.\n' +
        'Artifacts are in ' + output + '\n' + result.stdout
    );
    fs.rmSync(output, { recursive: true, force: true });
});

test('the real donor pool merges into fixtures when it is present', function() {
    // This corpus lives at an absolute path outside the repo (a private
    // gist-scraper dump) and will not exist on any other machine or in CI.
    // Skipping here is intentional, not a disabled test: the assertions
    // below only run when a developer has the pool checked out locally.
    const POOL = '/Users/stephenlavelle/Documents/google_gist_scraper/dumpprocessed_compiles';
    if (!fs.existsSync(POOL)) {
        return;
    }
    const games = garden.loadGameDir(POOL);
    assert(games.length > 1000, 'expected a large pool, got ' + games.length);
    assert.deepStrictEqual(games, games.slice().sort(), 'pool must be sorted');
    const mutator = garden.mutators.filter(function(m) { return m.name === 'merge-game'; })[0];
    const context = {
        donors: games,
        readDonor: function(p) { return fs.readFileSync(p, 'utf8'); }
    };
    let succeeded = 0;
    let compiledCount = 0;
    const job = { inputs: [], level: 0, randomSeed: null, replay: false };
    for (let seed = 0; seed < 10; seed++) {
        const result = mutator.apply(SAMPLE, new garden.Random(seed), {}, context);
        if (result) {
            succeeded++;
            assert.notStrictEqual(result.source, SAMPLE);
            // Structural assertions above (source differs from SAMPLE) don't
            // prove a real-donor merge is compilable in any sense -- they
            // proved that once already, when mergeGames shipped at 133/133
            // while every filtered merge produced a compiler error. Actually
            // compile a couple of real merges through the worker and require
            // a known, non-crashing result kind. A compiler-error is a
            // legitimate outcome for an arbitrary real-game merge, so it is
            // not asserted away here -- only 'crash' is disallowed.
            if (compiledCount < 2) {
                compiledCount++;
                const compiled = workerResult(Object.assign({ source: result.source }, job));
                assert(
                    garden.KNOWN_RESULT_KINDS.indexOf(compiled.kind) >= 0,
                    'seed ' + seed + ' should return a known result kind, got: ' + JSON.stringify(compiled)
                );
                assert.notStrictEqual(
                    compiled.kind,
                    'crash',
                    'seed ' + seed + ' should not crash the compiler: ' + JSON.stringify(compiled)
                );
            }
        }
    }
    assert(succeeded > 0, 'expected at least one real-corpus merge to apply');
    assert(compiledCount > 0, 'expected at least one real-corpus merge to be compiled and checked');
});

async function main() {
    let passed = 0;
    for (let i = 0; i < tests.length; i++) {
        try {
            await tests[i].fn();
            passed++;
            process.stdout.write('.');
        } catch (error) {
            process.stdout.write('F');
            console.error('\n\n' + tests[i].name + '\n' + error.stack);
        }
    }
    console.log('\n' + passed + '/' + tests.length + ' monster garden tests passed');
    process.exitCode = passed === tests.length ? 0 : 1;
}

main();

