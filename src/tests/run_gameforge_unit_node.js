'use strict';
const assert = require('assert');
const { loadSpec, DEFAULT_SPEC } = require('../../tools/gameforge/lib/spec');
const {
  parsePlayableLevels,
  cellAgreement,
  filterNearDupes,
} = require('../../tools/gameforge/lib/levels');
const { evaluatePublishGates } = require('../../tools/gameforge/lib/gates');
const { selectCandidate } = require('../../tools/gameforge/lib/select');

function testLoadSpecDefaults() {
  const spec = loadSpec({
    prompt: 'ice crates',
    seeds: ['src/demo/microban.txt'],
    candidates: ['candidates/c0.txt'],
    mechanic_intent: 'crates slide on ice until they hit a wall',
  });
  assert.strictEqual(spec.min_solution_length, 5);
  assert.strictEqual(spec.near_dupe_threshold, 0.92);
  assert.strictEqual(spec.smoke_level_count, 1);
  assert.strictEqual(spec.min_levels_per_band, 1);
  assert.ok(spec.wall_clock_ms > 0);
  assert.deepStrictEqual(spec.bands.map((b) => b.name), ['tiny', 'small', 'medium']);
  assert.strictEqual(spec.selection_policy, 'max_novelty');
  assert.strictEqual(spec.reject_vanilla_sokoban, true);
  assert.strictEqual(spec.reject_stock_sokoban_objects, true);
  assert.strictEqual(spec.require_structural_delta, true);
  assert.strictEqual(spec.allow_safe_mode, false);
  assert.strictEqual(spec.min_novelty_score, 1);
  assert.strictEqual(spec.min_structural_score, 1);
}

function testRejectMissingPrompt() {
  assert.throws(() => loadSpec({ seeds: ['a.txt'] }), /prompt/);
}

function testDefaultBandsAreCopied() {
  const beforeLength = DEFAULT_SPEC.bands.length;
  const beforeNames = DEFAULT_SPEC.bands.map((b) => b.name);
  const spec = loadSpec({
    prompt: 'ice crates',
    seeds: ['a.txt'],
    candidates: [],
  });
  assert.notStrictEqual(spec.bands, DEFAULT_SPEC.bands);
  spec.bands.push({ name: 'huge', dimensions: '10x10' });
  spec.bands[0].name = 'mutated';
  assert.strictEqual(DEFAULT_SPEC.bands.length, beforeLength);
  assert.deepStrictEqual(DEFAULT_SPEC.bands.map((b) => b.name), beforeNames);
}

function testParseSolutionComment() {
  const src = [
    '=======',
    'LEVELS',
    '',
    '(difficulty: 12)',
    '(solution: UURRDDLL)',
    '####',
    '#P.#',
    '#*C#',
    '####',
    '',
  ].join('\n');
  const levels = parsePlayableLevels(src);
  assert.strictEqual(levels.length, 1);
  assert.deepStrictEqual(levels[0].solution, ['up', 'up', 'right', 'right', 'down', 'down', 'left', 'left']);
  assert.strictEqual(levels[0].rows.length, 4);
}

function testNearDupeFilter() {
  const a = { width: 3, height: 2, rows: ['abc', 'def'] };
  const b = { width: 3, height: 2, rows: ['abc', 'def'] };
  const c = { width: 3, height: 2, rows: ['abx', 'def'] };
  assert.strictEqual(cellAgreement(a, b), 1);
  assert.ok(cellAgreement(a, c) < 1);
  const kept = filterNearDupes([a, b, c], 0.92);
  assert.strictEqual(kept.length, 2); // a kept, b dupe of a, c kept
}

function testPublishable() {
  const report = evaluatePublishGates({
    spec: loadSpec({
      prompt: 'x',
      seeds: ['s'],
      candidates: [],
      bands: [
        { name: 'tiny', dimensions: '3x2' },
        { name: 'small', dimensions: '4x3' },
      ],
      min_levels_per_band: 1,
      min_solution_length: 5,
    }),
    compileOk: true,
    theme: {
      hasTitle: true,
      hasAuthorOrPreludeOrMessage: true,
      legendCoversLevelGlyphs: true,
      spritesForAllObjects: true,
    },
    designLogPresent: true,
    levels: [
      {
        band: 'tiny',
        width: 3,
        height: 2,
        rows: ['###', '#P#'],
        solution: ['left', 'left', 'left', 'left', 'left'],
        solved: true,
        winExercised: true,
      },
      {
        band: 'small',
        width: 4,
        height: 3,
        rows: ['####', '#P.#', '####'],
        solution: ['right', 'right', 'right', 'right', 'right'],
        solved: true,
        winExercised: true,
      },
    ],
  });
  assert.strictEqual(report.status, 'publishable');
  assert.deepStrictEqual(report.failures, []);
}

function testTrivialFails() {
  const report = evaluatePublishGates({
    spec: loadSpec({ prompt: 'x', seeds: ['s'], candidates: [], min_solution_length: 5,
      bands: [{ name: 'tiny', dimensions: '3x2' }] }),
    compileOk: true,
    theme: {
      hasTitle: true,
      hasAuthorOrPreludeOrMessage: true,
      legendCoversLevelGlyphs: true,
      spritesForAllObjects: true,
    },
    designLogPresent: true,
    levels: [{
      band: 'tiny', width: 3, height: 2, rows: ['###', '#P#'],
      solution: ['left'], solved: true, winExercised: true,
    }],
  });
  assert.strictEqual(report.status, 'playable_incomplete');
  assert.ok(report.failures.some((f) => /min_solution_length/.test(f)));
}

function miniGame({ objects, layers, rules, win }) {
  const objBlock = objects.map((name) => `${name}\nblack\n.....`).join('\n\n');
  return `
title t
========
OBJECTS
========
${objBlock}
=======
LEGEND
=======
. = Background
=======
SOUNDS
=======
================
COLLISIONLAYERS
================
${layers}
======
RULES
======
${rules}
==============
WINCONDITIONS
==============
${win}
=======
LEVELS
=======
.
`;
}

const VANILLA_SOK = miniGame({
  objects: ['Background', 'Player', 'Wall', 'Crate', 'Target'],
  layers: 'Background\nTarget\nPlayer, Wall, Crate',
  rules: '[ > Player | Crate ] -> [ > Player | > Crate ]',
  win: 'all Target on Crate',
});

// Rule change only, stock object names — must fail structural / stock-object gates.
const SLIDE_STOCK = miniGame({
  objects: ['Background', 'Player', 'Wall', 'Crate', 'Target'],
  layers: 'Background\nTarget\nPlayer, Wall, Crate',
  rules: '[ > Player | Crate ] -> [ > Player | > Crate ]\n[ > Crate | no Wall ] -> [ | > Crate ]',
  win: 'all Target on Crate',
});

// Prompt-native objects + slide rule + layer tweak.
const SLIDE_THEMED = miniGame({
  objects: ['Background', 'Octopus', 'Reef', 'Shell', 'Nest'],
  layers: 'Background\nNest\nOctopus, Reef, Shell',
  rules: '[ > Octopus | Shell ] -> [ > Octopus | > Shell ]\n[ > Shell | no Reef ] -> [ | > Shell ]',
  win: 'all Nest on Shell',
});

const PULL_THEMED = miniGame({
  objects: ['Background', 'Octopus', 'Reef', 'Shell', 'Nest'],
  layers: 'Background\nNest\nOctopus, Reef, Shell',
  rules: '[ < Octopus | Shell ] -> [ < Octopus | < Shell ]',
  win: 'all Nest on Shell',
});

function testSelectPrefersNovelty() {
  const files = {
    '/tmp/job/seeds/a.txt': VANILLA_SOK,
    '/tmp/job/candidates/paint.txt': VANILLA_SOK,
    '/tmp/job/candidates/slide_stock.txt': SLIDE_STOCK,
    '/tmp/job/candidates/slide_themed.txt': SLIDE_THEMED,
  };
  const result = selectCandidate({
    jobDir: '/tmp/job',
    spec: loadSpec({
      prompt: 'octopus eggs',
      mechanic_intent: 'shells slide on sand until they hit reef; cover nests',
      seeds: ['seeds/a.txt'],
      candidates: [
        'candidates/paint.txt',
        'candidates/slide_stock.txt',
        'candidates/slide_themed.txt',
      ],
    }),
    candidatePaths: [
      '/tmp/job/candidates/paint.txt',
      '/tmp/job/candidates/slide_stock.txt',
      '/tmp/job/candidates/slide_themed.txt',
    ],
    seedPaths: ['/tmp/job/seeds/a.txt'],
    compileFile: () => ({ ok: true, errors: [] }),
    smokeCheck: () => ({ ok: true, reasons: [], winExercised: true }),
    readFile: (p) => files[p],
    copyFile: () => {},
  });
  assert.strictEqual(result.status, 'selected');
  assert.ok(
    result.selectedPath.endsWith('slide_themed.txt'),
    `expected slide_themed, got ${result.selectedPath}`,
  );
  assert.ok(result.rejections.some((r) => r.stage === 'novelty' && /paint/.test(r.path)));
  assert.ok(result.rejections.some((r) => r.stage === 'novelty' && /slide_stock/.test(r.path)));
}

function testRejectAllVanillaNoSafeMode() {
  const files = {
    '/tmp/job/seeds/a.txt': VANILLA_SOK,
    '/tmp/job/candidates/paint.txt': VANILLA_SOK,
  };
  const result = selectCandidate({
    jobDir: '/tmp/job',
    spec: loadSpec({
      prompt: 'x',
      mechanic_intent: 'should fail — paint only',
      seeds: ['seeds/a.txt'],
      candidates: ['candidates/paint.txt'],
    }),
    candidatePaths: ['/tmp/job/candidates/paint.txt'],
    seedPaths: ['/tmp/job/seeds/a.txt'],
    compileFile: () => ({ ok: true, errors: [] }),
    smokeCheck: () => ({ ok: true, reasons: [], winExercised: true }),
    readFile: (p) => files[p],
    copyFile: () => {},
  });
  assert.strictEqual(result.status, 'failed_mutate');
  assert.strictEqual(result.reason, 'no_novel_candidate_safe_mode_disabled');
}

function testSafeModeWhenNoCandidates() {
  const result = selectCandidate({
    jobDir: '/tmp/job',
    spec: loadSpec({ prompt: 'x', seeds: ['seeds/a.txt'], candidates: [] }),
    candidatePaths: [],
    seedPaths: ['/tmp/job/seeds/a.txt'],
    compileFile: () => ({ ok: true, errors: [] }),
    smokeCheck: () => ({ ok: true, reasons: [], winExercised: true }),
    readFile: () => VANILLA_SOK,
    copyFile: () => {},
  });
  assert.strictEqual(result.status, 'safe_mode');
  assert.ok(result.selectedPath.includes('seeds'));
}

function testRequireMechanicIntent() {
  assert.throws(
    () => loadSpec({ prompt: 'x', seeds: ['a'], candidates: ['c0.txt'] }),
    /mechanic_intent/,
  );
}

function testIsVanillaNoveltyAndStructure() {
  const {
    isVanillaSokoban,
    isStockSokobanObjectSet,
    noveltyAgainstSeeds,
    structuralDeltaAgainstSeeds,
    evaluateCandidateMechanic,
  } = require('../../tools/gameforge/lib/mechanic');
  assert.strictEqual(isVanillaSokoban(VANILLA_SOK), true);
  assert.strictEqual(isVanillaSokoban(SLIDE_STOCK), false);
  assert.strictEqual(isStockSokobanObjectSet(VANILLA_SOK), true);
  assert.strictEqual(isStockSokobanObjectSet(SLIDE_THEMED), false);
  const nov = noveltyAgainstSeeds(SLIDE_THEMED, [{ path: 'seed', source: VANILLA_SOK }]);
  assert.ok(nov.score >= 1, `expected novelty >= 1, got ${nov.score}`);
  const struct = structuralDeltaAgainstSeeds(SLIDE_THEMED, [{ path: 'seed', source: VANILLA_SOK }]);
  assert.ok(struct.score >= 1, `expected structural >= 1, got ${struct.score}`);
  assert.ok(struct.newObjects.includes('shell') || struct.newObjects.includes('octopus'));
  const stockSlide = evaluateCandidateMechanic(SLIDE_STOCK, [{ path: 'seed', source: VANILLA_SOK }]);
  assert.strictEqual(stockSlide.ok, false);
  assert.ok(stockSlide.reasons.some((r) => /stock_sokoban_objects|structural_delta/.test(r)));
  const themed = evaluateCandidateMechanic(SLIDE_THEMED, [{ path: 'seed', source: VANILLA_SOK }]);
  assert.strictEqual(themed.ok, true, themed.reasons.join('; '));
  assert.ok(PULL_THEMED.length > 0);
}

testLoadSpecDefaults();
testRejectMissingPrompt();
testDefaultBandsAreCopied();
testParseSolutionComment();
testNearDupeFilter();
testPublishable();
testTrivialFails();
testIsVanillaNoveltyAndStructure();
testRequireMechanicIntent();
testSelectPrefersNovelty();
testRejectAllVanillaNoSafeMode();
testSafeModeWhenNoCandidates();
console.log('run_gameforge_unit_node: ok');
