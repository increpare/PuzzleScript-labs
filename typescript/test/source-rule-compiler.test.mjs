import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { readSource } from '../build/source-reader.js';
import { resolveDeclarations } from '../build/declarations.js';
import { movementSource } from './scenarios.mjs';
import { createSourceRuleCompilerOracle } from './legacy-source-rule-compiler.cjs';
import * as sourceTypes from '../build/source-model.js';
import { CommandKind } from '../build/commands.js';
import { Ellipsis } from '../build/rule-model.js';
import { compileGameData } from '../build/source-game-data.js';
import { createRandom } from '../build/random.js';
import { findMatches, matchTuples } from '../build/matching.js';
import { applyRuleGroup } from '../build/scheduling.js';
import { applyTurnRules, startPlayerMovement } from '../build/turn-rules.js';
import { runInThisContext } from 'node:vm';
import { substituteRuleSynonyms } from '../build/rule-names.js';
const compiler = await import('../build/source-rule-compiler.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const oracle = createSourceRuleCompilerOracle({ readSource, resolveDeclarations, ...sourceTypes, CommandKind, Ellipsis, ...compiler });
const fixture = (rules, legend = '', sounds = '') => ({ name: rules,
  source: movementSource({ rules, sounds }).replace('. = Background', legend + '\n. = Background') });
const base = fixture('right [ Player ] -> [ Player ] win');
test('independent source rule compiler matches actual native final schedules', () => {
  assert.equal(typeof compiler.compileSourceRules, 'function');
  oracle.compareFixture(base);
});

for (const sounds of ['', 'sfx0 123', 'sfx0', 'sfx0 rubbish', 'sfx0 123 extra', 'sfx0é 123', 'sfx0 (comment) 123', 'sfx0 123\nsounds\nsfx1', 'sfx0)', 'sfx0) ', 'sfx0(comment))']) {
  test('SFX native first-token membership and original diagnostic order: ' + sounds, () => {
    oracle.compareFixture(fixture('late [ > Player sfx0 ] -> sfx1 sfx0 win', '', sounds));
  });
}

test('all 478 original simulation sources match actual final schedules and complete raw rule diagnostics', t => {
  const fixtures = oracle.corpusFixtures();
  assert.equal(fixtures.length, 478);
  const totals = { sources: 0, finalRules: 0, earlyGroups: 0, lateGroups: 0, loops: 0, diagnostics: 0, invalid: 0 };
  for (const item of fixtures) {
    const { result } = oracle.compareFixture(item);
    totals.sources++; totals.diagnostics += result.diagnostics.length;
    if (result.data === null) { totals.invalid++; continue; }
    const { earlyRules, lateRules } = result.data;
    totals.earlyGroups += earlyRules.groups.length; totals.lateGroups += lateRules.groups.length;
    totals.loops += earlyRules.loops.size + lateRules.loops.size;
    totals.finalRules += [...earlyRules.groups, ...lateRules.groups].reduce((sum, group) => sum + group.rules.length, 0);
  }
  t.diagnostic(JSON.stringify(totals));
  assert.equal(totals.finalRules, 99076);
  assert.equal(totals.earlyGroups, 11072); assert.equal(totals.lateGroups, 4481); assert.equal(totals.loops, 89);
  assert.equal(totals.diagnostics, 398); assert.equal(totals.invalid, 0);
});

// Instrument ordinary module imports only in a test-owned copy. Production APIs
// retain their direct calls and have no pass registry or injection options.
let compilerCopy = 0;
async function withCompilerHooks(hooks, callback) {
  const key = '__sourceRuleCompilerTest' + compilerCopy++;
  globalThis[key] = hooks;
  try {
    let source = readFileSync(new URL('../build/source-rule-compiler.js', import.meta.url), 'utf8');
    source = source.replace(/import \{ ([^}]+) \} from '([^']+)';/gu, (statement, names, specifier) => {
      const absolute = new URL(specifier, new URL('../build/source-rule-compiler.js', import.meta.url)).href;
      const exports = names.split(',').map(name => name.trim());
      if (!exports.some(name => Object.hasOwn(hooks, name))) return `import { ${names} } from '${absolute}';`;
      const wrapper = `import * as real from '${absolute}';\n` + exports.map(name =>
        `export const ${name} = (...args) => Object.hasOwn(globalThis['${key}'], '${name}') ? globalThis['${key}']['${name}'](real.${name}, ...args) : real.${name}(...args);`).join('\n');
      return `import { ${names} } from 'data:text/javascript;base64,${Buffer.from(wrapper).toString('base64')}';`;
    });
    const copy = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    return await callback(copy.compileSourceRules);
  } finally { delete globalThis[key]; }
}
const passNames = ['recoverRuleSyntax', 'checkEarlyNegativeTerms', 'orientRule', 'expandRuleAggregates',
  'substituteRuleSynonyms', 'expandRuleMovements', 'expandRuleProperties', 'inferSpawnedStationary',
  'normalizeRuleDuplicates', 'lowerRules', 'compileRuleSchedules'];
const tracingHooks = visits => Object.fromEntries(passNames.map(name => [name, (real, ...args) => {
  visits.push(name); return real(...args);
}]));

test('syntax invalid still checks every negative and the first aggregate, before synonyms or later InPlace', async () => {
  const item = fixture('moving [ > Player no Pair | Crate ] -> [ Player ]\nright [ Player ] -> [ Player no Player ]\nright [ Player no Crate ] -> [ Player ]\nstartloop',
    'Pair = Background and Wall');
  const visits = [];
  await withCompilerHooks(tracingHooks(visits), compileSourceRules => {
    const { result } = oracle.compareFixture(item, { compileSourceRules });
    assert.equal(result.data, null);
    assert.deepEqual(result.diagnostics.map(issue => issue.code), ['unequal-rule-cell-count', 'duplicate-cell-name', 'contradictory-rhs-exclusion',
      'redundant-lhs-exclusion', 'negative-rule-aggregate']);
  });
  assert.deepEqual(visits, ['recoverRuleSyntax', 'checkEarlyNegativeTerms', 'orientRule', 'expandRuleAggregates']);
});

test('movement invalid continues later inputs, property inference and spawning before final abort', async () => {
  const item = fixture('right [ Player ] -> [ horizontal Crate ]\nright [ Crate ] -> [ vertical Wall ]\nright [ random Things ] -> [ Things ]\nright [ Player ] -> [ random Player ]\nright [ Player | ... ] -> [ Player | ... ]',
    'Things = Player or Crate');
  const visits = [];
  await withCompilerHooks(tracingHooks(visits), compileSourceRules => {
    const { result } = oracle.compareFixture(item, { compileSourceRules });
    assert.equal(result.data, null);
    assert.deepEqual(result.diagnostics.map(issue => issue.code), ['ambiguous-rule-movement', 'ambiguous-rule-movement', 'ambiguous-rule-property']);
  });
  assert.deepEqual(visits.slice(-3), ['expandRuleMovements', 'expandRuleProperties', 'inferSpawnedStationary']);
  assert.equal(visits.includes('normalizeRuleDuplicates'), false);
  assert.equal(visits.includes('lowerRules'), false);
});

test('property ambiguity drops its input without invalidating surviving schedules', () => {
  const { result } = oracle.compareFixture(fixture('right [ random Things ] -> [ Things ]\nright [ Player ] -> win', 'Things = Player or Crate'));
  assert.notEqual(result.data, null);
  assert.equal(result.data.earlyRules.groups.length, 1);
});

test('successful stages preserve canonical syntax command objects and declaration objects', async () => {
  let syntax;
  await withCompilerHooks({ recoverRuleSyntax: (real, ...args) => (syntax = real(...args)) }, compileSourceRules => {
    const { result, declarations } = oracle.compareFixture(fixture('horizontal [ Player | Crate ] -> [ Player | Crate ] win\nlate [ Player ] -> message Hi'), { compileSourceRules });
    for (const group of [...result.data.earlyRules.groups, ...result.data.lateRules.groups]) for (const rule of group.rules) {
      const original = syntax.rules.find(input => input.source.originalLine.span.start.line === rule.sourceLine);
      assert.equal(rule.commands, original.commands);
      rule.commands.forEach((command, index) => assert.equal(command, original.commands[index]));
      for (const row of rule.rows) for (const cell of row) if (cell !== Ellipsis) for (const object of cell.requiredObjects) {
        assert.ok(declarations.objects.includes(object));
      }
    }
  });
});

const executionState = (board, seed) => ({ board, pendingMovements: [], rigidMarks: [], bannedGroups: new Set(),
  canMoveSounds: [], cantMoveSounds: [], random: createRandom(seed), commands: { entries: [], message: '' },
  createdObjects: new Set(), destroyedObjects: new Set() });
const cells = board => board.rows.map(row => row.map(cell => [...cell.objects].map(object =>
  object.orphanedFrom ? object.name + ' (orphaned)' : object.name).sort()));
const rngView = random => ({ i: random.i, j: random.j, permutation: random.permutation });

test('original concrete and synonym random precursors produce three versus four actual application candidates and seeded commands', () => {
  const counts = [];
  for (const name of ['Player', 'AliasPlayer']) {
    const item = fixture(`random horizontal [ ${name} no Wall | ${name} no Crate ] -> message row\n+ [ ${name} ] -> message single`,
      name === 'AliasPlayer' ? 'AliasPlayer = Player' : '');
    item.source = item.source.replace('PC.', 'PP');
    const { document, declarations, result } = oracle.compareFixture(item);
    oracle.independently(() => {
      const { data } = compileGameData(document, declarations);
      const game = { ...data, ...result.data }, group = game.earlyRules.groups[0];
      const before = executionState(game.levels[0].board, 'precursor-0');
      counts.push(group.rules.flatMap(rule => matchTuples(findMatches(rule, before))).length);
    });
    for (let index = 0; index < 12; index++) {
      const seed = 'precursor-' + index;
      const expected = oracle.nativeRandomApplication(item.source, seed);
      oracle.independently(() => {
        const { data } = compileGameData(document, declarations);
        const game = { ...data, ...result.data }, group = game.earlyRules.groups[0];
        const before = executionState(game.levels[0].board, seed);
        const candidates = group.rules.flatMap((rule, index) => {
          const matches = findMatches(rule, before);
          return matches.length === 0 ? [] : matchTuples(matches).map(tuple => ({ index, tuple }));
        });
        assert.deepEqual(candidates, expected.candidates, 'actual ordered candidates');
        const applied = applyRuleGroup(game, group, before);
        assert.equal(applied.changed, expected.changed);
        assert.deepEqual(cells(applied.state.board), expected.cells.map(row => row.map(cell => [...cell].sort())));
        assert.deepEqual(applied.state.commands.entries.map(entry => entry.command.kind === CommandKind.Message ? 'message' : 'other'), expected.commands);
        assert.equal(applied.state.commands.message, expected.message);
        assert.deepEqual(applied.state.commands.entries.map(entry => ({ index: group.rules.indexOf(entry.source), line: entry.source.sourceLine })), expected.sources);
        assert.deepEqual(rngView(applied.state.random), expected.random);
      });
    }
  }
  assert.deepEqual(counts, [3, 4]);
});

test('issue 1206 executes typed source rules plus typed game data with the same declarations', () => {
  const source = readFileSync(new URL('./repros/rigid-owner.puzzlescript', import.meta.url), 'utf8');
  const expected = oracle.nativeApplication(source, 'rigid-source', [-1]);
  const attempts = oracle.nativeRigidAttempts(source, 'rigid-source');
  const { document, declarations, result } = oracle.compareFixture({ name: 'issue 1206 typed source runtime', source });
  oracle.independently(() => {
    const { data } = compileGameData(document, declarations);
    const game = { ...data, ...result.data };
    assert.equal(game.collisionLayers, declarations.collisionLayers);
    assert.equal(game.player, declarations.player);
    assert.equal(game.rigidMerges.get(0).get(1), 2);
    const before = executionState(game.levels[0].board, 'rigid-source');
    const applied = applyTurnRules(game, before, null);
    assert.deepEqual(cells(applied.state.board), expected.frames[1].cells.map(row => row.map(cell => [...cell].sort())));
    assert.deepEqual(rngView(applied.state.random), expected.frames[1].random);
    assert.deepEqual(startPlayerMovement(game, applied.state, 3).playerPositions, expected.frames[1].playerPositions);
    assert.equal(applied.attempts, attempts.length);
    assert.equal(applied.rigidRetries, attempts.filter(attempt => attempt.retry).length);
    assert.deepEqual(applied.state.bannedGroups, new Set(attempts.at(-1).bans));
    assert.deepEqual(attempts, [{ retry: true, bans: [2] }, { retry: false, bans: [2] }]);
  });
});

test('writable orphan recovery keeps its own canonical identity through source compilation and execution', () => {
  const item = fixture('right [ Crate ] -> [ random Player ]');
  item.source = item.source.replace('Player, Crate, Wall', 'Background\nCrate, Wall').replace('PC.', 'C');
  const expected = oracle.nativeApplication(item.source, 'orphan-source', [4]);
  const { document, declarations, result } = oracle.compareFixture(item);
  oracle.independently(() => {
    const { data } = compileGameData(document, declarations);
    const game = { ...data, ...result.data };
    const rule = game.earlyRules.groups[0].rules[0];
    const candidate = rule.replacements[0][0].edits.randomObjects[0];
    assert.equal(candidate.object, declarations.orphanedObject);
    assert.equal(candidate.layer, 1);
    const applied = applyTurnRules(game, executionState(game.levels[0].board, 'orphan-source'), 4);
    assert.deepEqual(cells(applied.state.board), expected.frames[1].cells.map(row => row.map(cell => [...cell].sort())));
    assert.deepEqual(rngView(applied.state.random), expected.frames[1].random);
  });
});

test('documented malformed source failures are confirmed through full native loadFile guards', () => {
  const inPlace = fixture('moving [ > Player | Crate ] -> win');
  const empty = fixture('right [ Player ] -> [ Player ]', 'Pair = Player and Player\nPlayer = Pair');
  empty.source = empty.source.replace('P = Player\n', '');
  for (const item of [inPlace, empty]) {
    assert.equal(oracle.nativeLoadFailure(item.source).name, 'TypeError');
    oracle.independently(() => {
      const { document } = readSource(item.source);
      const { declarations } = resolveDeclarations(document);
      assert.throws(() => compiler.compileSourceRules(document, declarations), error => error instanceof TypeError
        && /InPlace|empty aggregate/.test(error.message));
    });
  }
});


test('sound lexical recovery keeps authored evidence for incomplete records and ASCII keyword boundaries', () => {
  const { document } = readSource(fixture('right [ Player ] -> sfx0', '', 'sFx0\nsfx1 100\nsfx2 nope\nsfx3é\nsfx4 100 extra').source);
  assert.deepEqual(document.sounds.map(sound => sound.eventDefinition?.value ?? null), ['sfx0', 'sfx1', null, null, null]);
  assert.equal(document.sounds[0].kind, sourceTypes.SourceSoundKind.Invalid);
  const token = document.sounds[0].eventDefinition;
  assert.equal(token.word.spelling, 'sFx0');
  assert.equal(token.word, document.sounds[0].words[0]);
  assert.equal(document.source.slice(token.word.span.start.offset, token.word.span.end.offset), 'sFx0');
});

test('SFX definitions accumulated in later repeated sections affect every recovered rule', () => {
  const item = fixture('right [ Player ] -> sfx0 sfx1');
  item.source = item.source.replace('winconditions', 'sounds\nsfx0\nsfx1 123\nwinconditions');
  const { result } = oracle.compareFixture(item);
  assert.deepEqual(result.diagnostics, []);
});

test('source compiler candidate cannot call any native parser/compiler/gameplay producer', () => {
  oracle.nativeApplication(base.source, 'producer-guard', []);
  for (const name of [...oracle.producers, ...oracle.gameplayProducers]) {
    assert.throws(() => oracle.compareFixture(base, { compileSourceRules: () => { globalThis[name](); } }),
      new RegExp('Candidate called native ' + name));
  }
  for (const source of ['new codeMirrorFn().startState()', 'new CodeMirror.StringStream("",4)',
    'state.calculateRowColMasks(level)', 'state.rules[0][0].findMatches(level)', 'RandomGen.uniform()']) {
    assert.throws(() => oracle.independently(() => runInThisContext(source)), /Candidate called native/);
  }
  for (const [prototype, method] of [[runInThisContext('Rule.prototype'), 'findMatches'],
    [runInThisContext('CellPattern.prototype'), 'generateMatchFunction']]) {
    assert.throws(() => oracle.independently(() => prototype[method].call(null)), /Candidate called native/);
  }
});

test('compiler frozen inputs include declaration Maps and Sets', () => {
  assert.throws(() => oracle.compareFixture(base, { compileSourceRules: document => { document.rules.length = 0; } }), TypeError);
  assert.throws(() => oracle.compareFixture(base, { compileSourceRules: (document, declarations) => {
    declarations.namedObjects.get('player').clear();
    return compiler.compileSourceRules(document, declarations);
  } }), /compiler inputs are unchanged/);
  assert.throws(() => oracle.compareFixture(base, { compileSourceRules: (document, declarations) => {
    declarations.ruleNames.synonyms.clear();
    return compiler.compileSourceRules(document, declarations);
  } }), /compiler inputs are unchanged/);
});

for (const [name, afterLower, afterNative] of [
  ['lowered rule', parsed => { parsed.rules[0].unsupportedField = true; }],
  ['predicate', parsed => { parsed.rules[0].lhs[0][0].unsupportedField = true; }],
  ['replacement', parsed => { parsed.rules[0].lhs[0][0].replacement.unsupportedField = true; }],
  ['scheduled rule', undefined, parsed => { parsed.rules[0][0].unsupportedField = true; }],
]) test('complete native field guards reject an unsupported ' + name, () => {
  assert.throws(() => oracle.compareFixture(fixture('right [ Player ] -> [ Crate ]'), { afterLower, afterNative }), /Unsupported vanilla.*unsupportedField/);
});

const changeFirst = (result, transform) => ({ ...result, data: { ...result.data,
  earlyRules: { ...result.data.earlyRules, groups: result.data.earlyRules.groups.map((group, index) => index === 0
    ? { ...group, rules: group.rules.map((rule, ri) => ri === 0 ? transform(rule) : rule) } : group) } } });
for (const [name, item, corrupt] of [
  ['predicate object identity', base, result => changeFirst(result, rule => ({ ...rule,
    rows: rule.rows.map(row => row.map(cell => ({ ...cell, requiredObjects: new Set([...cell.requiredObjects].map(object => ({ ...object }))) }))) }))],
  ['replacement vacancies', fixture('right [ Player ] -> [ Crate ]'), result => changeFirst(result, rule => ({ ...rule,
    replacements: rule.replacements.map(row => row.map(replacement => ({ ...replacement, edits: { ...replacement.edits, vacateLayers: new Set() } }))) }))],
  ['group sequence', fixture('right [ Player ] -> win\nright [ Crate ] -> win'), result => ({ ...result, data: { ...result.data,
    earlyRules: { ...result.data.earlyRules, groups: [...result.data.earlyRules.groups].reverse() } } })],
  ['rigid merges', fixture('rigid right [ Player ] -> win\nrigid right [ Crate ] -> win'), result => ({ ...result,
    data: { ...result.data, rigidMerges: new Map() } })],
  ['loop points', fixture('startloop\nright [ Player ] -> win\nendloop'), result => ({ ...result, data: { ...result.data,
    earlyRules: { ...result.data.earlyRules, loops: new Map() } } })],
  ['raw diagnostic interleaving', fixture('late [ > Player ] -> sfx0'), result => ({ ...result, diagnostics: [...result.diagnostics].reverse() })],
]) test('compiler oracle rejects corrupt ' + name, () => {
  assert.throws(() => oracle.compareFixture(item, { compileSourceRules: (...args) => corrupt(compiler.compileSourceRules(...args)) }),
    /every final|complete raw|canonical identity/);
});

test('oracle rejects skipping early negatives', async () => {
  await withCompilerHooks({ checkEarlyNegativeTerms: (_real, rules) => ({ rules, diagnostics: [] }) }, compileSourceRules => {
    assert.throws(() => oracle.compareFixture(fixture('right [ Player no Crate ] -> win'), { compileSourceRules }), /every final|complete raw/);
  });
});
test('oracle rejects synonym substitution before aggregate expansion', async () => {
  await withCompilerHooks({ expandRuleAggregates: (real, rules, declarations) => real(substituteRuleSynonyms(rules, declarations), declarations) }, compileSourceRules => {
    assert.throws(() => oracle.compareFixture(fixture('right [ Pair ] -> win', 'Pair = Crate and Wall\nPair = Player'), { compileSourceRules }), /every final/);
  });
});
test('oracle rejects stopping properties after movement invalid', async () => {
  await withCompilerHooks({ expandRuleProperties: () => ({ rules: [], diagnostics: [] }) }, compileSourceRules => {
    assert.throws(() => oracle.compareFixture(fixture('right [ Player ] -> [ horizontal Crate ]\nright [ random Things ] -> [ Things ]', 'Things = Player or Crate'),
      { compileSourceRules }), /complete raw/);
  });
});
test('invalid syntax makes later passes unreachable', async () => {
  const forbidden = Object.fromEntries(['substituteRuleSynonyms', 'expandRuleMovements', 'expandRuleProperties',
    'inferSpawnedStationary', 'normalizeRuleDuplicates', 'lowerRules', 'compileRuleSchedules'].map(name => [name, () => { throw new Error('unreachable ' + name); }]));
  await withCompilerHooks(forbidden, compileSourceRules => {
    oracle.compareFixture(fixture('moving [ > Player no Pair | Crate ] -> [ Player ]', 'Pair = Background and Wall'), { compileSourceRules });
  });
});

test('compiler oracle rejects an unassigned declaration hidden by object-choice projection', () => {
  const item = fixture('right [ Player ] -> win');
  item.source = item.source.replace('Player, Crate, Wall', 'Crate, Wall');
  assert.throws(() => oracle.compareFixture(item, { compileSourceRules: (document, declarations) => {
    const result = compiler.compileSourceRules(document, declarations);
    return changeFirst(result, rule => ({ ...rule, rows: rule.rows.map(row => row.map(cell => ({ ...cell,
      requiredObjects: new Set([...cell.requiredObjects, declarations.objects.find(object => object.name === 'player')]),
    }))) }));
  } }), /runtime object|every final/);
});
