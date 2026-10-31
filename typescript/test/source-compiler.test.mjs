import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource, SourceCompilationKind, SourceCompilationStopReason } from '../build/source-compiler.js';
import { createSession } from '../build/session.js';
import { movementSource } from './scenarios.mjs';
import { readFileSync } from 'node:fs';
import { createCompiledGameComparator, compareCompiledGame } from './legacy-source-compiler.cjs';
import * as sourceTypes from '../build/source-model.js';
import { createSourceCompilerOracle } from './legacy-source-compiler.cjs';
import { createGameDataOracle } from './legacy-game-data-oracle.cjs';
import * as model from '../build/model.js';
import * as sessionModel from '../build/session-model.js';
import * as turnRules from '../build/turn-rules.js';
import * as winConditions from '../build/win-conditions.js';
import * as commands from '../build/commands.js';
import * as ruleModel from '../build/rule-model.js';
import * as assets from '../build/source-assets.js';
import * as declarationModel from '../build/declaration-model.js';

const source = `title Clear example
OBJECTS
Background .
Black

Player P
White
LEGEND
SOUNDS
COLLISIONLAYERS
Background
Player
RULES
[ > Player ] -> [ > Player ]
WINCONDITIONS
LEVELS
P.`;

test('compile source to a canonical game with authored rule links', () => {
  const result = compileSource(source);
  assert.equal(result.outcome.kind, SourceCompilationKind.Accepted);
  assert.deepEqual(result.rawDiagnostics, []);
  assert.equal(result.errorCount, 0);
  const { game, declarations, ruleSources } = result.outcome;
  const player = declarations.objects.find(object => object.name === 'player');
  assert.ok(player);
  assert.ok(game.player.objects.has(player));
  for (const schedule of [game.earlyRules, game.lateRules]) {
    for (const group of schedule.groups) for (const rule of group.rules) {
      const authored = ruleSources.get(rule);
      assert.ok(result.document.rules.includes(authored));
      assert.equal(authored.originalLine.span.start.line, rule.sourceLine);
    }
  }
  const session = createSession(game, { seed: 'source example' }, {
    nextLevelSeed: () => 'source example',
  });
  assert.ok(session.state.execution.board.rows[0][0].objects.has(player));
});

const compilerTypes = { compileSource, SourceCompilationKind, SourceCompilationStopReason, ...sourceTypes,
  ...model, ...sessionModel, ...turnRules, ...winConditions, ...commands, ...ruleModel, ...assets, ...declarationModel };
const oracle = createSourceCompilerOracle(compilerTypes);

test('all 335 pinned compilation sources match actual compile diagnostics and acceptance', t => {
  const totals = { sources: 0, formed: 0, invalid: 0, stopped: 0, accepted: 0, declined: 0, raw: 0, recorded: 0 };
  for (const fixture of oracle.compilationFixtures()) {
    const { result } = oracle.compareFixture(fixture);
    totals.sources++; totals.raw += result.rawDiagnostics.length; totals.recorded += result.diagnostics.length;
    switch (result.outcome.kind) {
      case SourceCompilationKind.Accepted: totals.accepted++; totals.formed++; break;
      case SourceCompilationKind.Declined: totals.declined++; totals.formed++; break;
      case SourceCompilationKind.Invalid: totals.invalid++; break;
      case SourceCompilationKind.Stopped: totals.stopped++; break;
      default: assert.fail('unknown compilation outcome');
    }
  }
  t.diagnostic(JSON.stringify(totals));
  assert.deepEqual(totals, { sources: 335, formed: 315, invalid: 17, stopped: 3,
    accepted: 306, declined: 9, raw: 876, recorded: 705 });
});

test('all 492 pinned simulation sources match complete actual compilation semantics and issues', t => {
  const totals = { sources: 0, accepted: 0, raw: 0, recorded: 0, errors: 0, finalRules: 0 };
  for (const fixture of oracle.corpusFixtures()) {
    const { result } = oracle.compareFixture(fixture);
    totals.sources++; totals.accepted += Number(result.outcome.kind === SourceCompilationKind.Accepted);
    totals.raw += result.rawDiagnostics.length; totals.recorded += result.diagnostics.length; totals.errors += result.errorCount;
    totals.finalRules += [...result.outcome.game.earlyRules.groups, ...result.outcome.game.lateRules.groups]
      .reduce((sum, group) => sum + group.rules.length, 0);
  }
  t.diagnostic(JSON.stringify(totals));
  assert.deepEqual(totals, { sources: 492, accepted: 492, raw: 579, recorded: 548, errors: 25, finalRules: 99192 });
});

const originalFixture = name => {
  const fixture = oracle.compilationFixtures().find(fixture => fixture.name === name);
  assert.ok(fixture, 'original compilation fixture exists: ' + name);
  return fixture;
};

test('original errorful accepted, no-layer invalid, formed declined and urgent no-levels boundaries', () => {
  const accepted = oracle.compareFixture(originalFixture('Background missing')).result;
  assert.equal(accepted.outcome.kind, SourceCompilationKind.Accepted); assert.equal(accepted.errorCount, 2);
  const invalid = oracle.compareFixture(originalFixture('no collision layers defined')).result;
  assert.deepEqual(invalid.outcome, { kind: SourceCompilationKind.Invalid });
  const declined = oracle.compareFixture(originalFixture("#815 problem with dead rule elimination and 'Rules with overlapping objects' test")).result;
  assert.equal(declined.outcome.kind, SourceCompilationKind.Declined); assert.equal(declined.errorCount, 10);
  assert.ok(declined.outcome.game.levels.length > 0);
  const noLevels = oracle.compareFixture(originalFixture('No levels found')).result;
  assert.equal(noLevels.outcome.kind, SourceCompilationKind.Accepted); assert.deepEqual(noLevels.outcome.game.levels, []);
  assert.equal(noLevels.rawDiagnostics.at(-1).phase, sourceTypes.SourceDiagnosticPhase.GameData);
  assert.deepEqual(oracle.issueView(noLevels.rawDiagnostics.at(-1)), { message: 'No levels found.  Add some levels!',
    line: null, severity: sourceTypes.SourceDiagnosticSeverity.Error, countsAsError: true, urgent: true });
});

test('constructed: level diagnostics precede the explicit invalid rule checkpoint', () => {
  const fixture = { name: 'constructed: level diagnostic before invalid rules', source: source
    .replace('Background\nPlayer\nRULES', 'Player\nRULES').replace('[ > Player ] -> [ > Player ]', '[ Player ] -> [ Player | Player ]') };
  const { result } = oracle.compareFixture(fixture);
  assert.equal(result.outcome.kind, SourceCompilationKind.Invalid);
  assert.deepEqual(result.rawDiagnostics.map(issue => issue.code), ['missing-level-background', 'unequal-rule-cell-count']);
});

test('constructed: wins, layering, dimensions, loops, sounds and display diagnostics retain native order', () => {
  const fixture = { name: 'constructed: all late compiler boundaries', source: movementSource({
    metadata: 'flickscreen AxB\ntext_color invalid', sounds: 'Player create', rules: 'startloop\nright [ Player ] -> [ Player ]',
  }).replace('Player, Crate, Wall', 'Player, Crate').replace('winconditions\n', 'winconditions\nall Unknown\n') };
  const { result } = oracle.compareFixture(fixture);
  const codes = result.rawDiagnostics.map(issue => issue.code);
  const ordered = ['unknown-win-operand', 'unlayered-object', 'invalid-dimension', 'invalid-dimensions',
    'missing-endloop', 'missing-sound-seed', 'invalid-text-color'];
  let previous = -1;
  for (const code of ordered) { const index = codes.indexOf(code); assert.ok(index > previous, code + ': native order'); previous = index; }
  assert.ok(result.rawDiagnostics.find(issue => issue.code === 'unknown-win-operand').message.endsWith('. '));
});

test('constructed: global issue cap stops within syntax before unreachable native InPlace failure', () => {
  const fixture = { name: 'constructed: global cap before malformed orientation', source: movementSource({ rules:
    Array.from({ length: 110 }, () => 'right [ Player Player ] -> [ Player ]').join('\n') + '\nmoving [ > Player | Crate ] -> win',
  }) };
  const { result, native } = oracle.compareFixture(fixture);
  assert.equal(native.stopped, true);
  assert.deepEqual(result.outcome, { kind: SourceCompilationKind.Stopped, reason: SourceCompilationStopReason.IssueLimit });
  assert.equal(result.diagnostics.length, 101); assert.equal(result.errorCount, 101);
  const lastIssue = result.rawDiagnostics.at(-1);
  const authored = result.document.rules.find(rule => rule.originalLine.span.start.line === lastIssue.span.start.line);
  assert.ok(lastIssue.span.start.offset >= authored.originalLine.span.start.offset);
  assert.ok(lastIssue.span.end.offset <= authored.originalLine.span.end.offset);
  assert.equal(lastIssue.span.start.line, native.rawDiagnostics.at(-1).line);
  assert.ok(lastIssue.span.start.line < result.document.rules.at(-1).originalLine.span.start.line);
  assert.equal(result.rawDiagnostics.some(issue => issue.code === 'missing-levels'), false);
});

test('constructed: explicit orphan and issue 1206 remain in the whole source result', () => {
  const orphan = { name: 'constructed: source compiler orphan', source: movementSource({ rules: 'right [ Crate ] -> [ random Player ]' })
    .replace('Player, Crate, Wall', 'Background\nCrate, Wall').replace('PC.', 'C') };
  const { result } = oracle.compareFixture(orphan);
  const { declarations, sprites, game } = result.outcome;
  assert.ok(declarations.orphanedObject); assert.equal(sprites.has(declarations.orphanedObject), false);
  assert.equal(game.earlyRules.groups[0].rules[0].replacements[0][0].edits.randomObjects[0].object, declarations.orphanedObject);
  const rigid = oracle.compareFixture({ name: 'original issue 1206 repro',
    source: readFileSync(new URL('./repros/rigid-owner.puzzlescript', import.meta.url), 'utf8') }).result;
  assert.equal(rigid.outcome.game.rigidMerges.get(0).get(1), 0);
});

const corruptResult = mutate => text => { const result = compileSource(text); mutate(result); return result; };
test('comparator rejects deliberately corrupted diagnostics, acceptance, rule semantics and source identity', () => {
  const fixture = originalFixture('Background missing');
  assert.throws(() => oracle.compareFixture(fixture, { compileSource: corruptResult(result => {
    result.rawDiagnostics[0] = { ...result.rawDiagnostics[0], message: 'corrupted issue' };
  }) }), /exact raw diagnostics/);
  assert.throws(() => oracle.compareFixture({ name: 'constructed: comparator accepted tag', source }, { compileSource: corruptResult(result => {
    result.outcome.kind = SourceCompilationKind.Declined;
  }) }), /installation outcome/);
  assert.throws(() => oracle.compareFixture({ name: 'constructed: comparator rule field', source }, { compileSource: corruptResult(result => {
    result.outcome.game.earlyRules.groups[0].rules[0].direction = model.Direction.Left;
  }) }), /every executable rule/);
  assert.throws(() => oracle.compareFixture({ name: 'constructed: comparator source identity', source }, { compileSource: corruptResult(result => {
    const [rule, authored] = result.outcome.ruleSources.entries().next().value;
    result.outcome.ruleSources.set(rule, { ...authored });
  }) }), /canonical source-map identity/);
});

test('native and candidate projections reject unknown semantic fields', () => {
  const fixture = { name: 'constructed: unknown native rule field', source };
  assert.throws(() => oracle.compareFixture(fixture, { afterNative: native => { native.rules[0][0].unknownField = true; } }), /Unsupported vanilla rule field/);
  assert.throws(() => oracle.compareFixture(fixture, { compileSource: corruptResult(result => {
    result.outcome.game.unknownField = true;
  }) }), /complete public compiler fields/);
});

test('candidate source compilation cannot invoke actual native producers or prototypes', () => {
  for (const name of ['compile', 'loadFile', 'generateExtraMembers', 'rulesToArray', 'rulesToMask', 'processInput']) {
    assert.throws(() => oracle.independently(() => globalThis[name]()), new RegExp('Candidate called native ' + name));
  }
  assert.throws(() => oracle.independently(() => new Level(0, 1, 1, 1, []).getCell(0)), /Candidate called native prototype/);
  oracle.independently(() => assert.equal(compileSource(source).outcome.kind, SourceCompilationKind.Accepted));
});

test('host-free semantic comparator retains native globals and returns actual canonical correspondence', () => {
  const fixture = { name: 'constructed: reusable semantic comparator', source };
  const native = oracle.nativeCompile(source), result = oracle.independently(() => compileSource(source));
  const before = { state, level, errorStrings, errorCount, localStorage, document };
  const compareGame = createCompiledGameComparator(compilerTypes);
  for (const correspondence of [compareGame(fixture, native.formed, result, native.levelLines),
    compareCompiledGame(compilerTypes, fixture, native.formed, result, native.levelLines)]) {
    assert.equal(correspondence.objectIds.size, result.outcome.declarations.objectChoiceOrder.length);
    for (const [object, id] of correspondence.objectIds) assert.equal(native.formed.idDict[id], object.name);
    for (const [rule, nativeRule] of correspondence.nativeRules) {
      assert.ok(result.outcome.ruleSources.has(rule));
      assert.ok([...native.formed.rules.flat(), ...native.formed.lateRules.flat()].includes(nativeRule));
    }
  }
  for (const [key, value] of Object.entries({ state, level, errorStrings, errorCount, localStorage, document })) assert.equal(value, before[key], key + ': native host unchanged');
});

test('constructed: documented native InPlace and empty aggregate TypeErrors remain explicit host boundaries', () => {
  const inPlace = movementSource({ rules: 'moving [ > Player | Crate ] -> win' });
  const emptyAggregate = movementSource({ rules: 'right [ Player ] -> [ Player ]' })
    .replace('. = Background', 'Pair = Player and Player\nPlayer = Pair\n. = Background').replace('P = Player\n', '');
  for (const text of [inPlace, emptyAggregate]) {
    assert.throws(() => oracle.nativeCompile(text), TypeError);
    assert.throws(() => oracle.independently(() => compileSource(text)), TypeError);
  }
});

test('constructed: the global warning cap interrupts the native parser with its actual cursor', () => {
  const fixture = { name: 'constructed: source parser global warning cap', source: ')\n'.repeat(101) + source };
  const { result } = oracle.compareFixture(fixture);
  assert.equal(result.outcome.kind, SourceCompilationKind.Stopped);
  assert.equal(result.outcome.reason, SourceCompilationStopReason.IssueLimit);
  assert.ok(result.outcome.cursor); assert.equal(result.diagnostics.length, 101);
});

test('constructed: urgent NoLevels is the 101st recorded issue and stops after native state formation', () => {
  const fixture = { name: 'constructed: global cap in NoLevels wrapper', source: movementSource({ level: '',
    rules: Array.from({ length: 100 }, () => 'right [ Player ] -> [ Player ] sfx0').join('\n'),
  }) };
  const { result, native } = oracle.compareFixture(fixture);
  assert.ok(native.formed); assert.equal(native.stopped, true);
  assert.deepEqual(result.outcome, { kind: SourceCompilationKind.Stopped, reason: SourceCompilationStopReason.IssueLimit });
  assert.equal(result.diagnostics.length, 101); assert.equal(result.errorCount, 1);
  assert.equal(result.rawDiagnostics.at(-1).urgent, true);
});

test('comparator rejects an unassigned canonical object hidden by writable-object projection', () => {
  const fixture = { name: 'constructed: unassigned object cannot hide in a rule',
    source: movementSource({ rules: 'right [ Crate ] -> [ random Player ]' })
      .replace('Player, Crate, Wall', 'Background\nCrate, Wall').replace('PC.', 'C') };
  assert.throws(() => oracle.compareFixture(fixture, { compileSource: corruptResult(result => {
    const player = result.outcome.declarations.objects.find(object => object.name === 'player');
    result.outcome.game.earlyRules.groups[0].rules[0].rows[0][0].requiredObjects.add(player);
  }) }), /canonical writable runtime object/);
});

for (const operand of ['subject', 'target']) {
  test(`review: invalid compiled win ${operand} match tag is rejected`, () => {
    const fixture = { name: `constructed: invalid win ${operand} match tag`, source: movementSource({ rules: 'right [ Player ] -> win' })
      .replace('winconditions\n', 'winconditions\nsome Player on Player\n') };
    assert.throws(() => oracle.compareFixture(fixture, { compileSource: corruptResult(result => {
      result.outcome.game.winConditions[0][operand].kind = 999;
    }) }), /unsupported object match kind/);
  });
}

for (const [variant, level] of [['grid', 'PC.'], ['message', 'message Review message']]) {
  test(`review: unknown native ${variant} level fields are rejected`, () => {
    const fixture = { name: `constructed: unknown native ${variant} level field`, source: movementSource({ level }) };
    assert.throws(() => oracle.compareFixture(fixture, { afterNative: native => {
      native.levels[0].unknownSemanticField = true;
    } }), /native (grid|message) level fields/);
  });
}

test('review: unknown native sound event keys are rejected', () => {
  const fixture = { name: 'constructed: unknown native event key', source: movementSource({ sounds: 'sfx0 123\nundo 456' }) };
  assert.throws(() => oracle.compareFixture(fixture, { afterNative: native => {
    native.sfx_Events.unknownSemanticField = '123';
  } }), /Unsupported vanilla sound events field/);
});

for (const [variant, rule, sounds] of [
  ['control', 'right [ Player ] -> win', ''],
  ['message', 'right [ Player ] -> message Review message', ''],
  ['sound', 'right [ Player ] -> sfx0', 'sfx0 123'],
]) {
  test(`review: unknown compiled ${variant} command fields are rejected`, () => {
    const fixture = { name: `constructed: unknown ${variant} command field`, source: movementSource({ rules: rule, sounds }) };
    assert.throws(() => oracle.compareFixture(fixture, { compileSource: corruptResult(result => {
      result.outcome.game.earlyRules.groups[0].rules[0].commands[0].unknownSemanticField = true;
    }) }), /plain command fields/);
  });
}

for (const [variant, name, legend] of [
  ['object', 'player', ''],
  ['property', 'movable', 'Movable = Player or Crate'],
  ['aggregate', 'pair', 'Pair = Background and Player'],
  ['unresolved', 'alias', 'Alias = Missing'],
]) {
  test(`review: unknown resolved ${variant} name fields are rejected`, () => {
    const fixture = { name: `constructed: unknown resolved ${variant} name field`, source: movementSource({ rules: 'right [ Player ] -> win' })
      .replace('C = Crate', 'C = Crate\n' + legend) };
    assert.throws(() => oracle.compareFixture(fixture, { compileSource: corruptResult(result => {
      result.outcome.declarations.names.get(name).unknownSemanticField = true;
    }) }), /plain resolved name fields/);
  });
}

test('review: unknown rule vocabulary fields are rejected', () => {
  const fixture = { name: 'constructed: unknown rule vocabulary field', source: movementSource() };
  assert.throws(() => oracle.compareFixture(fixture, { compileSource: corruptResult(result => {
    result.outcome.declarations.ruleNames.unknownSemanticField = true;
  }) }), /plain rule vocabulary fields/);
});

for (const extra of ['game', 'extraField']) {
  test(`review: original parser-Stopped outcome rejects ${extra}`, () => {
    assert.throws(() => oracle.compareFixture(originalFixture('cake monster'), { compileSource: corruptResult(result => {
      result.outcome[extra] = { apparentlyUsable: true };
    }) }), /exact stopped outcome fields/);
  });
}


test('review: supported object match tags retain distinct projections', () => {
  const fixture = { name: 'constructed: supported win condition variants', source: movementSource()
    .replace('winconditions\n', 'winconditions\nsome Player on Player\n') };
  const dataOracle = createGameDataOracle(compilerTypes, { nativeAlreadyLoaded: true });
  for (const [kind, expected] of [[winConditions.ObjectMatchKind.Any, 'any'],
    [winConditions.ObjectMatchKind.All, 'all'], [winConditions.ObjectMatchKind.Never, 'never']]) {
    const result = compileSource(fixture.source);
    const { game, declarations, metadata } = result.outcome;
    game.winConditions[0].subject.kind = kind; game.winConditions[0].target.kind = kind;
    const projected = dataOracle.candidateDataView(fixture, declarations, { data: game, metadata });
    assert.equal(projected.data.winConditions[0].subject.kind, expected);
    assert.equal(projected.data.winConditions[0].target.kind, expected);
  }
});

test('review: parser-Stopped comparison validates every cursor coordinate and its exact fields', () => {
  const fixture = originalFixture('cake monster');
  const mutations = [cursor => { cursor.line++; }, cursor => { cursor.column++; }, cursor => { cursor.offset++; },
    cursor => { cursor.extraField = true; }, cursor => { delete cursor.offset; }];
  for (const mutate of mutations) assert.throws(() => oracle.compareFixture(fixture, { compileSource: corruptResult(result => {
    mutate(result.outcome.cursor);
  }) }), /actual native stopping cursor|exact stopping cursor fields/);
});

test('review: global-cap Stopped and Invalid outcomes retain their no-game shape', () => {
  const stopped = { name: 'constructed: extra game after compiler issue cap', source: movementSource({ rules:
    Array.from({ length: 110 }, () => 'right [ Player Player ] -> [ Player ]').join('\n'),
  }) };
  assert.throws(() => oracle.compareFixture(stopped, { compileSource: corruptResult(result => {
    result.outcome.game = { apparentlyUsable: true };
  }) }), /exact stopped outcome fields/);
  assert.throws(() => oracle.compareFixture(originalFixture('no collision layers defined'), { compileSource: corruptResult(result => {
    result.outcome.game = { apparentlyUsable: true };
  }) }), /deep-equal/);
});

test('quality: unknown compiled level kind is rejected before schema branching', () => {
  const fixture = { name: 'constructed: unknown compiled level tag',
    source: movementSource({ sounds: 'startlevel 123', rules: 'right [ Player ] -> [ Player ]' }) };
  assert.throws(() => oracle.compareFixture(fixture, { compileSource: corruptResult(result => {
    result.outcome.game.levels[0].kind = 999;
  }) }), /unsupported level kind/);
});

test('quality: the independent game-data projection rejects an unknown level kind', () => {
  const fixture = { name: 'constructed: unknown level tag at game-data projection', source: movementSource() };
  const result = compileSource(fixture.source);
  const { game, declarations, metadata } = result.outcome;
  game.levels[0].kind = 999;
  const dataOracle = createGameDataOracle(compilerTypes, { nativeAlreadyLoaded: true });
  assert.throws(() => dataOracle.candidateDataView(fixture, declarations, { data: game, metadata }), /unsupported level kind/);
});

for (const [variant, levelText, expectedSounds] of [['grid', 'PC.', ['123']], ['message', 'message Start here', []]]) {
  test(`quality: supported ${variant} levels preserve projection and level-start effects`, () => {
    const fixture = { name: `constructed: valid ${variant} level tag`,
      source: movementSource({ level: levelText, sounds: 'startlevel 123', rules: 'right [ Player ] -> [ Player ]' }) };
    const { result } = oracle.compareFixture(fixture);
    const { game, declarations, metadata } = result.outcome;
    const dataOracle = createGameDataOracle(compilerTypes, { nativeAlreadyLoaded: true });
    assert.equal(dataOracle.candidateDataView(fixture, declarations, { data: game, metadata }).data.levels[0].kind, variant);
    const session = createSession(game, { seed: 'valid level tag' }, { nextLevelSeed: () => 'valid level tag' });
    assert.deepEqual(session.effects.filter(effect => effect.kind === sessionModel.SessionEffectKind.Sound).map(effect => effect.seed), expectedSounds);
  });
}
