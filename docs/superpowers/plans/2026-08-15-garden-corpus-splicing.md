# Garden Corpus Splicing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the garden a second source — a scraped corpus of real PuzzleScript games — and a crossover mutator that merges a donor game into a fixture, plus two structural mutators that permute rules and levels.

**Architecture:** Two pure functions in `garden.js` (`loadGameDir`, `mergeGames`) carry all the new logic and are unit-testable without touching the filesystem or the compiler. A `--game-dir` flag builds a deterministic donor list that reaches mutators through a new fourth `context` argument to `apply`, which every existing mutator ignores.

**Tech Stack:** Node.js built-ins only. `garden.js`, `run.js` and `tests.js` under `src/tests/monster_garden/`.

**Worktree:** `.worktrees/compiler-monster-garden`

**Spec:** `docs/superpowers/specs/2026-08-15-garden-corpus-splicing-design.md`

## Global Constraints

- Node built-ins only. No new dependencies.
- ES5-style function syntax with `const`/`let`, matching the existing files. No arrow functions in `garden.js` or `run.js`. (`async function`/`await` already appear in both and are fine.)
- Run `node src/tests/monster_garden/tests.js` after every change. Baseline is 124/124.
- Run `node src/tests/run_tests_node.js` before each task's final commit. Baseline is 770 passed, 0 failed, 0 errors. It must not regress.
- Do not modify `src/js/compiler.js`, `src/js/engine.js`, `src/js/parser.js` or `src/js/debug.js`.
- **The new mutators must never declare an `equivalence` field.** That is reserved for the semantics-preserving family. Declaring it would make the oracle assert a damaging mutant behaves identically to the original, and would also exclude the mutator from `multi-fault`'s pool.
- **Every mutator test must compile its mutant** via the existing `workerResult()` helper in `tests.js`, asserting the worker returns a kind in `garden.KNOWN_RESULT_KINDS` that is not `crash`. This is the standing lesson from the equivalence-oracle plan, where a whole class of defects shipped green because tests asserted only on mutated text.
- **Seed loops need an applied-at-least-once guard** (`let succeeded = 0; … assert(succeeded > 0)`), or a test can pass while exercising nothing.
- **Identifier comparisons must be case-insensitive.** PuzzleScript identifiers are case-insensitive and this hazard was found three separate times during the equivalence-oracle work.
- **Tests must not depend on the external corpus.** It lives at absolute paths outside the repo and will be absent on other machines. Tests construct donors inline. The one test that touches the real corpus skips itself when the directory is missing.
- The test at `src/tests/monster_garden/tests.js` asserts the exact list of mutator names in exact registry order via `deepStrictEqual`. **Every task adding a mutator must append its name to that list**, or the suite fails. The registry currently holds 62 mutators ending with `comment-in-rule`. Locate the array's end by content — line numbers in this plan may drift.

---

## File map

- Modify: `src/tests/monster_garden/garden.js` — `loadGameDir`, `mergeGames`, the `context` argument, `--game-dir` parsing, three mutators, three registry entries.
- Modify: `src/tests/monster_garden/run.js` — build the donor list once per campaign, pass it into `mutateFixture`.
- Modify: `src/tests/monster_garden/tests.js` — unit tests for both pure functions, per-mutator tests, the corpus-optional test.
- Modify: `docs/superpowers/specs/2026-08-14-compiler-monster-garden-design.md` — document `--game-dir`.

No new files. `garden.js` is already the home for every pure, testable helper.

---

### Task 1: `loadGameDir`

**Files:**
- Modify: `src/tests/monster_garden/garden.js`
- Test: `src/tests/monster_garden/tests.js`

**Interfaces:**
- Produces: `loadGameDir(dir, maxBytes)` → sorted `string[]` of absolute file paths. `maxBytes` defaults to `65536`. Throws if `dir` does not exist or contains no file at or below the cap.

Sorting is the point: directory iteration order is not stable across machines, and a garden run must reproduce from its seed alone.

- [ ] **Step 1: Write the failing tests.** Add to `src/tests/monster_garden/tests.js` immediately after the `sectionBlocks` tests:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node src/tests/monster_garden/tests.js`
Expected: `garden.loadGameDir is not a function`.

- [ ] **Step 3: Implement.** Add to `src/tests/monster_garden/garden.js` directly after the `loadCorpus` function:

```js
const DEFAULT_GAME_BYTES = 65536;

// Sorted, because directory order is not stable across machines and a campaign
// must reproduce from its seed alone. The cap keeps the rare enormous game out:
// the corpus p95 is 23 KB but its max is 899 KB, and a donor that size would
// dominate any mutant it entered and shrink badly.
function loadGameDir(dir, maxBytes) {
    const cap = maxBytes === undefined ? DEFAULT_GAME_BYTES : maxBytes;
    let entries;
    try {
        entries = fs.readdirSync(dir);
    } catch (error) {
        throw new Error('game directory is unreadable: ' + dir);
    }
    const kept = [];
    for (let i = 0; i < entries.length; i++) {
        const full = path.join(dir, entries[i]);
        let stat;
        try {
            stat = fs.statSync(full);
        } catch (error) {
            continue;
        }
        if (stat.isFile() && stat.size > 0 && stat.size <= cap) {
            kept.push(full);
        }
    }
    if (kept.length === 0) {
        throw new Error('no games at or below ' + cap + ' bytes in ' + dir);
    }
    kept.sort();
    return kept;
}
```

- [ ] **Step 4: Export it.** In `module.exports`, add after `loadCorpus: loadCorpus,`:

```js
    loadGameDir: loadGameDir,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node src/tests/monster_garden/tests.js`
Expected: all pass, 127/127.

- [ ] **Step 6: Commit**

```bash
git add src/tests/monster_garden/garden.js src/tests/monster_garden/tests.js
git commit -m "Add loadGameDir for deterministic donor pools."
```

---

### Task 2: `mergeGames`

**Files:**
- Modify: `src/tests/monster_garden/garden.js`
- Test: `src/tests/monster_garden/tests.js`

**Interfaces:**
- Consumes: `findSection`, `sectionBlocks`, `SECTION_NAMES` (all existing in `garden.js`).
- Produces: `mergeGames(sourceA, sourceB, rng)` → `{ source, detail }` or `null`. Merges B into A as a union. `rng` chooses the collision-layer mode.

**What a merge is.** Nothing in A is replaced. B's OBJECTS and LEGEND entries are added only where A does not already define that name or glyph, compared case-insensitively. B's RULES, LEVELS, WINCONDITIONS and SOUNDS are appended after A's. B's prelude is dropped. COLLISIONLAYERS has two modes chosen by `rng.integer(2)`: *filtered* drops objects A already places, giving a valid game; *raw* appends verbatim, double-booking shared objects into a compile error.

- [ ] **Step 1: Write the failing tests.** Add to `src/tests/monster_garden/tests.js` after the `loadGameDir` tests:

```js
const DONOR_SAMPLE = `title Donor

========
OBJECTS
========

Background
blue

Player
green

Water
cyan

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

test('mergeGames adds only objects A does not already define', function() {
    const merged = garden.mergeGames(SAMPLE, DONOR_SAMPLE, new garden.Random(1));
    assert(merged, 'merge should apply to two well-formed games');
    // Water is new and must arrive; Player and Background exist in both and must
    // not be redeclared, or the merged game would not compile.
    assert(/^Water$/m.test(merged.source), 'Water should be added');
    assert.strictEqual(
        (merged.source.match(/^Player$/gm) || []).length,
        1,
        'Player must not be declared twice'
    );
    assert.strictEqual(
        (merged.source.match(/^Background$/gm) || []).length,
        1,
        'Background must not be declared twice'
    );
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node src/tests/monster_garden/tests.js`
Expected: `garden.mergeGames is not a function`.

- [ ] **Step 3: Implement.** Add to `src/tests/monster_garden/garden.js` directly after `sectionBlocks`:

```js
const MERGE_APPEND_SECTIONS = ['RULES', 'LEVELS', 'WINCONDITIONS', 'SOUNDS'];

function sectionBodyLines(source, name) {
    const section = findSection(source, name);
    if (!section) {
        return null;
    }
    const body = section.lines.slice(section.start, section.end);
    const parsed = sectionBlocks(body.join('\n'));
    return { header: parsed.header, blocks: parsed.blocks, lines: body };
}

// Names declared by a game: its OBJECTS block heads plus its LEGEND keys.
function declaredNames(source) {
    const names = {};
    const objects = sectionBodyLines(source, 'OBJECTS');
    if (objects) {
        for (let i = 0; i < objects.blocks.length; i++) {
            const first = objects.blocks[i][0].trim().split(/\s+/)[0];
            if (first) {
                names[first.toLowerCase()] = true;
            }
        }
    }
    const legend = findSection(source, 'LEGEND');
    if (legend) {
        for (let i = legend.start; i < legend.end; i++) {
            const match = /^\s*([^=\s]+)\s*=/.exec(legend.lines[i]);
            if (match) {
                names[match[1].toLowerCase()] = true;
            }
        }
    }
    return names;
}

function bodyOnly(source, name) {
    const section = findSection(source, name);
    if (!section) {
        return [];
    }
    const lines = section.lines.slice(section.start, section.end);
    const parsed = sectionBlocks(lines.join('\n'));
    return lines.slice(parsed.header.length);
}

function appendIntoSection(lines, name, extra) {
    const source = lines.join('\n');
    const section = findSection(source, name);
    if (!section || extra.length === 0) {
        return lines;
    }
    const next = lines.slice();
    next.splice(section.end, 0, '');
    next.splice(section.end + 1, 0, ...extra);
    return next;
}

// A union of two games: nothing in A is replaced. Duplicate declarations are the
// interesting part — B's rules then rebind to A's same-named objects, giving a
// valid game with foreign semantics.
function mergeGames(sourceA, sourceB, rng) {
    const required = ['OBJECTS', 'LEGEND', 'COLLISIONLAYERS', 'RULES', 'LEVELS'];
    for (let i = 0; i < required.length; i++) {
        if (!findSection(sourceA, required[i]) || !findSection(sourceB, required[i])) {
            return null;
        }
    }
    const known = declaredNames(sourceA);
    let lines = sourceA.split('\n');

    const donorObjects = sectionBodyLines(sourceB, 'OBJECTS');
    const newObjects = [];
    for (let i = 0; i < donorObjects.blocks.length; i++) {
        const block = donorObjects.blocks[i];
        const name = block[0].trim().split(/\s+/)[0];
        if (name && !known[name.toLowerCase()]) {
            newObjects.push('');
            for (let j = 0; j < block.length; j++) {
                newObjects.push(block[j]);
            }
        }
    }
    lines = appendIntoSection(lines, 'OBJECTS', newObjects);

    const donorLegend = bodyOnly(sourceB, 'LEGEND');
    const newLegend = [];
    for (let i = 0; i < donorLegend.length; i++) {
        const match = /^\s*([^=\s]+)\s*=/.exec(donorLegend[i]);
        if (match && !known[match[1].toLowerCase()]) {
            newLegend.push(donorLegend[i]);
        }
    }
    lines = appendIntoSection(lines, 'LEGEND', newLegend);

    const rawLayers = rng.integer(2) === 0;
    const donorLayers = bodyOnly(sourceB, 'COLLISIONLAYERS');
    const newLayers = [];
    for (let i = 0; i < donorLayers.length; i++) {
        const trimmed = donorLayers[i].trim();
        if (trimmed === '') {
            continue;
        }
        if (rawLayers) {
            newLayers.push(donorLayers[i]);
            continue;
        }
        const kept = trimmed.split(',').map(function(part) {
            return part.trim();
        }).filter(function(part) {
            return part !== '' && !known[part.toLowerCase()];
        });
        if (kept.length > 0) {
            newLayers.push(kept.join(', '));
        }
    }
    lines = appendIntoSection(lines, 'COLLISIONLAYERS', newLayers);

    for (let i = 0; i < MERGE_APPEND_SECTIONS.length; i++) {
        const name = MERGE_APPEND_SECTIONS[i];
        lines = appendIntoSection(lines, name, bodyOnly(sourceB, name));
    }

    const merged = lines.join('\n');
    if (merged === sourceA) {
        return null;
    }
    return {
        source: merged,
        detail: 'merged a donor game with ' + (rawLayers ? 'raw layers' : 'filtered layers')
    };
}
```

- [ ] **Step 4: Export it.** In `module.exports`, add after `loadGameDir: loadGameDir,`:

```js
    mergeGames: mergeGames,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node src/tests/monster_garden/tests.js`
Expected: all pass, 133/133.

If a test fails because the merged source is malformed, fix `mergeGames` rather than relaxing the test. These assertions are what make the merge worth having.

- [ ] **Step 6: Commit**

```bash
git add src/tests/monster_garden/garden.js src/tests/monster_garden/tests.js
git commit -m "Add mergeGames, a union of two PuzzleScript games."
```

---

### Task 3: Measure the merge compile rate — GATE

The spec requires this before anything else is built. The value of `merge-game`
rests on merged games mostly compiling; if they mostly fail, the mutator is worth
far less than it looks and the design needs revisiting.

**Files:**
- Create: a throwaway script under your scratchpad directory. Do NOT commit it.

**Interfaces:**
- Consumes: `garden.loadGameDir`, `garden.mergeGames`, `src/tests/monster_garden/worker.js`.

- [ ] **Step 1: Write the probe.** Put this in your scratchpad (not the repo):

```js
const { spawnSync } = require('child_process');
const fs = require('fs');
const R = '/Users/stephenlavelle/Documents/GitHub/PuzzleScript/.worktrees/compiler-monster-garden/src/tests/monster_garden/';
const garden = require(R + 'garden.js');
const POOL = '/Users/stephenlavelle/Documents/google_gist_scraper/dumpprocessed_compiles';

const games = garden.loadGameDir(POOL);
console.log('pool size after cap:', games.length);

function compile(source) {
    const job = JSON.stringify({ source: source, inputs: [], level: 0, randomSeed: null, replay: false, maxInputs: 4 });
    const r = spawnSync(process.execPath, [R + 'worker.js'], { input: job, encoding: 'utf8', timeout: 20000, killSignal: 'SIGKILL' });
    try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch (e) { return { kind: 'NO_OUTPUT' }; }
}

const kinds = {}; const byMode = { raw: {}, filtered: {} };
let attempted = 0, merged = 0;
for (let i = 0; i < 60; i++) {
    const rng = new garden.Random(5000 + i);
    const a = fs.readFileSync(games[rng.integer(games.length)], 'utf8');
    const b = fs.readFileSync(games[rng.integer(games.length)], 'utf8');
    attempted++;
    const out = garden.mergeGames(a, b, rng);
    if (!out) { kinds['MERGE_NULL'] = (kinds['MERGE_NULL'] || 0) + 1; continue; }
    merged++;
    const mode = /raw layers/.test(out.detail) ? 'raw' : 'filtered';
    const res = compile(out.source);
    kinds[res.kind] = (kinds[res.kind] || 0) + 1;
    byMode[mode][res.kind] = (byMode[mode][res.kind] || 0) + 1;
}
console.log('attempted', attempted, 'merged', merged);
console.log('all:', JSON.stringify(kinds));
console.log('raw:', JSON.stringify(byMode.raw));
console.log('filtered:', JSON.stringify(byMode.filtered));
```

- [ ] **Step 2: Run it and record the numbers**

Run it with `node`. Expect it to take two to three minutes.

- [ ] **Step 3: Judge the result and report before continuing**

Report all four printed lines to your controller, then assess:

- **`filtered` mode yields `ok` or `compiler-warning` for a substantial share** (say a third or more): the design holds. Continue to Task 4.
- **Almost everything is `compiler-error`**: do NOT continue. Read three of the failing merged sources, identify the single most common cause, and report it with an example. It is likely a structural detail this plan got wrong — a section the merge forgot, a legend glyph collision, a layer ordering rule — and it is far cheaper to fix `mergeGames` now than after three more tasks are built on it.
- **Any `crash`**: report it immediately with the merged source. That is a genuine compiler bug and the most valuable thing this task can produce.

Do not adjust the probe to make the numbers look better. The measurement is the deliverable.

- [ ] **Step 4: No commit.** The probe is scratch. Nothing to commit for this task.

---

### Task 4: `--game-dir` and the donor context

**Files:**
- Modify: `src/tests/monster_garden/garden.js` (argument parsing, `mutateFixture`)
- Modify: `src/tests/monster_garden/run.js`
- Test: `src/tests/monster_garden/tests.js`

**Interfaces:**
- Consumes: `loadGameDir` from Task 1.
- Produces: `options.gameDirs` (a `string[]`, empty by default); `mutateFixture(fixture, rng, names, options)` where `options.donors` is a `string[]` of file paths; mutators receive a fourth argument `context` shaped `{ donors: string[], readDonor: function(path) }`.

Existing mutators take three arguments and ignore a fourth, so this is backward compatible.

- [ ] **Step 1: Write the failing tests.**

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node src/tests/monster_garden/tests.js`
Expected: failures on `gameDirs` being `undefined`.

- [ ] **Step 3: Add the flag.** In `parseArguments`'s defaults object in `garden.js`, add after `mutators: null,`:

```js
        gameDirs: [],
```

Then add a case to the argument `switch`, beside `case '--fixture':`:

```js
            case '--game-dir': {
                const dir = needValue(argv, i, 'game-dir');
                // Fail loudly at parse time rather than yielding a silent empty
                // pool that makes every donor mutator report inapplicable.
                loadGameDir(dir);
                result.gameDirs.push(dir);
                i++;
                break;
            }
```

- [ ] **Step 4: Pass the context through `mutateFixture`.** In `garden.js`, find the line inside `mutateFixture` that calls the mutator:

```js
        const applied = mutator.apply(fixture.source, rng, fixture);
```

Replace it with:

```js
        const donors = (options && options.donors) || [];
        const context = {
            donors: donors,
            readDonor: function(donorPath) {
                return fs.readFileSync(donorPath, 'utf8');
            }
        };
        const applied = mutator.apply(fixture.source, rng, fixture, context);
```

- [ ] **Step 5: Build the donor list in `run.js`.** Near the top of `main`, after `options` is parsed and before the trial loop, add:

```js
    let donors = [];
    for (let i = 0; i < options.gameDirs.length; i++) {
        donors = donors.concat(garden.loadGameDir(options.gameDirs[i]));
    }
```

Then in the `garden.mutateFixture(...)` call, add `donors` to the options object it already passes:

```js
            mutant = garden.mutateFixture(fixture, rng, allowedMutators(options.mutators), {
                maxAttempts: options.maxAttempts,
                donors: donors
            });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node src/tests/monster_garden/tests.js`
Expected: all pass, 136/136.

- [ ] **Step 7: Confirm the runner still works without a pool**

Run: `node src/tests/monster_garden/run.js --seed 4242 --count 10 --output /tmp/garden-nodonor`
Expected: exit 0, ordinary tally.

- [ ] **Step 8: Commit**

```bash
git add src/tests/monster_garden/garden.js src/tests/monster_garden/run.js src/tests/monster_garden/tests.js
git commit -m "Add --game-dir and pass a donor context to mutators."
```

---

### Task 5: The `merge-game` mutator

**Files:**
- Modify: `src/tests/monster_garden/garden.js`
- Test: `src/tests/monster_garden/tests.js`

**Interfaces:**
- Consumes: `mergeGames` (Task 2), the `context` argument (Task 4).
- Produces: registry entry `{ name: 'merge-game', apply: mergeGame }`.

- [ ] **Step 1: Write the failing test.**

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node src/tests/monster_garden/tests.js`
Expected: `merge-game should be registered`.

- [ ] **Step 3: Implement.** Add to `garden.js` before `const mutators = [`:

```js
// Crossover: union a real game from the donor pool into the fixture. Where both
// declare the same name the donor's declaration is skipped, so the donor's rules
// rebind to the fixture's objects — a valid game with foreign semantics. Merging
// also grows the object table and layer list, crossing the 32-object STRIDE_OBJ
// and 5-layer STRIDE_MOV boundaries in compiler.js.
function mergeGame(source, rng, fixture, context) {
    if (!context || !context.donors || context.donors.length === 0) {
        return null;
    }
    const donorPath = context.donors[rng.integer(context.donors.length)];
    let donor;
    try {
        donor = context.readDonor(donorPath);
    } catch (error) {
        return null;
    }
    const merged = mergeGames(source, donor, rng);
    if (!merged) {
        return null;
    }
    return {
        source: merged.source,
        detail: merged.detail + ' (' + path.basename(donorPath) + ')'
    };
}
```

- [ ] **Step 4: Register it** after the final entry `{ name: 'comment-in-rule', apply: commentInRule }`:

```js
,
    { name: 'merge-game', apply: mergeGame }
```

- [ ] **Step 5: Update the name list** in `tests.js` — append `'merge-game'` after `'comment-in-rule'`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node src/tests/monster_garden/tests.js`
Expected: all pass, 137/137.

- [ ] **Step 7: Confirm the main suite has not regressed**

Run: `node src/tests/run_tests_node.js`
Expected: 770 passed, 0 failed, 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/tests/monster_garden/garden.js src/tests/monster_garden/tests.js
git commit -m "Add the merge-game crossover mutator."
```

---

### Task 6: `shuffle-rules` and `shuffle-levels`

**Files:**
- Modify: `src/tests/monster_garden/garden.js`
- Test: `src/tests/monster_garden/tests.js`

**Interfaces:**
- Consumes: `mutateSection`, `sectionBlocks`, `arrowRuleIndexes` (all existing).
- Produces: registry entries `{ name: 'shuffle-rules', apply: shuffleRules }` and `{ name: 'shuffle-levels', apply: shuffleLevels }`.

Rule order is semantically significant in PuzzleScript, so `shuffle-rules` changes behaviour. Neither may declare `equivalence`.

- [ ] **Step 1: Write the failing tests.**

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node src/tests/monster_garden/tests.js`
Expected: `shuffle-rules should be registered`.

- [ ] **Step 3: Implement.** Add to `garden.js` before `const mutators = [`:

```js
function shuffleInPlace(items, rng) {
    for (let i = items.length - 1; i > 0; i--) {
        const j = rng.integer(i + 1);
        const swap = items[i];
        items[i] = items[j];
        items[j] = swap;
    }
    return items;
}

// Rule order is semantically significant in PuzzleScript, so this changes
// behaviour. It reaches rule-group formation and startLoop/endLoop pairing,
// which startloop-mismatch only pokes crudely.
function shuffleRules(source, rng) {
    return mutateSection(source, 'RULES', function(body) {
        const found = arrowRuleIndexes(body);
        if (found.indexes.length < 2) {
            return null;
        }
        const picked = found.indexes.slice();
        const contents = picked.map(function(index) { return found.lines[index]; });
        shuffleInPlace(contents, rng);
        let changed = false;
        for (let i = 0; i < picked.length; i++) {
            if (found.lines[picked[i]] !== contents[i]) {
                changed = true;
            }
            found.lines[picked[i]] = contents[i];
        }
        if (!changed) {
            return null;
        }
        return { source: found.lines.join('\n'), detail: 'shuffled ' + picked.length + ' rule lines' };
    });
}

function shuffleLevels(source, rng) {
    return mutateSection(source, 'LEVELS', function(body) {
        const parsed = sectionBlocks(body);
        if (parsed.blocks.length === 0) {
            return null;
        }
        const blocks = parsed.blocks.map(function(block) { return block.slice(); });
        let detail;
        if (blocks.length > 1 && rng.integer(2) === 0) {
            shuffleInPlace(blocks, rng);
            detail = 'permuted ' + blocks.length + ' levels';
        } else {
            const index = rng.integer(blocks.length);
            if (blocks[index].length < 2) {
                return null;
            }
            shuffleInPlace(blocks[index], rng);
            detail = 'scrambled the rows of level ' + index;
        }
        let out = parsed.header.slice();
        for (let i = 0; i < blocks.length; i++) {
            out.push('');
            out = out.concat(blocks[i]);
        }
        out.push('');
        const next = out.join('\n');
        if (next === body) {
            return null;
        }
        return { source: next, detail: detail };
    });
}
```

- [ ] **Step 4: Register them** after the `merge-game` entry:

```js
,
    { name: 'shuffle-rules', apply: shuffleRules },
    { name: 'shuffle-levels', apply: shuffleLevels }
```

- [ ] **Step 5: Update the name list** in `tests.js` — append `'shuffle-rules'` then `'shuffle-levels'`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node src/tests/monster_garden/tests.js`
Expected: all pass, 139/139.

- [ ] **Step 7: Confirm the main suite has not regressed**

Run: `node src/tests/run_tests_node.js`
Expected: 770 passed, 0 failed, 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/tests/monster_garden/garden.js src/tests/monster_garden/tests.js
git commit -m "Add the shuffle-rules and shuffle-levels mutators."
```

---

### Task 7: Corpus smoke check and documentation

**Files:**
- Modify: `src/tests/monster_garden/tests.js`
- Modify: `docs/superpowers/specs/2026-08-14-compiler-monster-garden-design.md`

- [ ] **Step 1: Add the corpus-optional test.** It must skip cleanly when the corpus is absent, since it will be on every machine but this one:

```js
test('the real donor pool merges into fixtures when it is present', function() {
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
    for (let seed = 0; seed < 10; seed++) {
        const result = mutator.apply(SAMPLE, new garden.Random(seed), {}, context);
        if (result) {
            succeeded++;
            assert.notStrictEqual(result.source, SAMPLE);
        }
    }
    assert(succeeded > 0, 'expected at least one real-corpus merge to apply');
});
```

- [ ] **Step 2: Run the tests**

Run: `node src/tests/monster_garden/tests.js`
Expected: all pass, 140/140.

- [ ] **Step 3: Run a campaign over the new mutators**

```bash
node src/tests/monster_garden/run.js \
  --seed 20260815 --count 150 --timeout-ms 8000 \
  --game-dir /Users/stephenlavelle/Documents/google_gist_scraper/dumpprocessed_compiles \
  --mutator merge-game,shuffle-rules,shuffle-levels \
  --output /tmp/garden-splice
```

Expected: exit 0. Findings are expected — these are damaging mutators — so report the tally rather than treating errors as failure. A `crash` or `timeout` is a genuine discovery: report it with the artifact directory.

- [ ] **Step 4: Run a campaign without a pool, to prove graceful degradation**

```bash
node src/tests/monster_garden/run.js --seed 4242 --count 40 \
  --mutator merge-game,shuffle-rules,shuffle-levels --output /tmp/garden-nopool
```

Expected: exit 0. `merge-game` reports inapplicable throughout, so expect a raised `skipped` count and no crash.

- [ ] **Step 5: Document the flag.** In `docs/superpowers/specs/2026-08-14-compiler-monster-garden-design.md`, add a row to the flag table after the `--mutator` row:

```markdown
| `--game-dir DIR` | none | Donor pool for `merge-game`; repeatable, pools concatenate in order |
```

- [ ] **Step 6: Commit**

```bash
git add src/tests/monster_garden/tests.js docs/superpowers/specs/2026-08-14-compiler-monster-garden-design.md
git commit -m "Add a corpus smoke check and document --game-dir."
```
