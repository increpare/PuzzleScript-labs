import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from '../build/source-reader.js';
import { resolveDeclarations } from '../build/declarations.js';
import { ResolvedNameKind } from '../build/declaration-model.js';
import { PlayerMatchKind } from '../build/turn-rules.js';
import { SourceDiagnosticPhase, SourceDiagnosticSeverity, SourceLegendKind } from '../build/source-model.js';
import { spawnSync } from 'node:child_process';

function read(objects, legend = '', layers = '') {
  return readSource(`OBJECTS\n${objects}\nLEGEND\n${legend}\nCOLLISIONLAYERS\n${layers}\nRULES\nWINCONDITIONS\nLEVELS`).document;
}
const names = objects => objects.map(object => object.name);
const simpleObjects = 'A X\nRed\n\nB\nBlue\n\nC\nGreen\n\nD\nYellow';
const members = (declarations, name) => names(declarations.names.get(name).members);

test('concrete names and aliases share canonical immutable objects without changing source', () => {
  const document = read('Background .\nBlack\n\nPlayer P @\nWhite', '', 'Background\nPlayer');
  const before = structuredClone(document);
  const { declarations } = resolveDeclarations(document);
  assert.deepEqual(names(declarations.objects), ['background', 'player']);
  const player = declarations.objects[1];
  assert.equal(declarations.names.get('player').kind, ResolvedNameKind.Object);
  for (const name of ['player', 'p', '@']) assert.equal(declarations.names.get(name).object, player);
  assert.equal(declarations.objectSources.get(player), document.objects[1]);
  assert.equal(declarations.names.get('p').word.spelling, 'P');
  assert.equal(declarations.names.get('p').source, document.objects[1]);
  assert.ok(Object.isFrozen(player));
  assert.deepEqual(document, before);
});

test('concrete declarations override earlier aliases while duplicate concrete names are rejected', () => {
  const document = read('A X\nRed\n\nX Y\nBlue\n\nA Z\nGreen');
  const { declarations, diagnostics } = resolveDeclarations(document);
  assert.deepEqual(names(declarations.objects), ['a', 'x']);
  assert.equal(declarations.names.get('x').object, declarations.objects[1]);
  // Native final synonym collapsing still follows the older X alias for Y.
  assert.equal(declarations.names.get('y').object, declarations.objects[0]);
  assert.equal(declarations.names.get('z').object, declarations.objects[0]);
  assert.ok(diagnostics.some(item => item.code === 'duplicate-name' && item.span.start.line === 5));
  assert.ok(diagnostics.some(item => item.code === 'duplicate-object'));
});

test('undefined references diagnose at the authored point even if a registered synonym later resolves', () => {
  const { declarations, diagnostics } = resolveDeclarations(read(simpleObjects,
    'Early = Later\nLater = A\nChain = Early\nLost = Missing'));
  assert.equal(declarations.names.get('early').object, declarations.objects[0]);
  assert.equal(declarations.names.get('chain').object, declarations.objects[0]);
  const lost = declarations.names.get('lost');
  assert.equal(lost.kind, ResolvedNameKind.Unresolved);
  assert.deepEqual(lost.references.map(word => word.spelling), ['Missing']);
  assert.match(lost.reason, /missing/i);
  assert.equal(diagnostics.filter(item => item.code === 'undefined-reference').length, 2);
});

test('nested properties retain native parser flattening and compiler append order with duplicates', () => {
  const { declarations } = resolveDeclarations(read(simpleObjects,
    'P = A or B\nQ = P or C or P or D\nR = A or Q or B\nPair = A and B\nStack = Pair and C\nAlias = Stack'));
  assert.deepEqual(members(declarations, 'p'), ['a', 'b']);
  assert.deepEqual(members(declarations, 'q'), ['a', 'b', 'c', 'a', 'b', 'd']);
  assert.deepEqual(members(declarations, 'r'), ['a', 'a', 'b', 'c', 'a', 'b', 'd', 'b']);
  assert.deepEqual(members(declarations, 'stack'), ['a', 'b', 'c']);
  assert.deepEqual(members(declarations, 'alias'), ['a', 'b', 'c']);
});

test('self-reference removal, duplicate properties and cross-kind recovery follow native acceptance', () => {
  const { declarations, diagnostics } = resolveDeclarations(read(simpleObjects,
    'P = A or B\nP = C or D\nPair = A and B\nBad = A and P\nRecover = Pair or C\nS = S or A or B\nT = A or T\nU = U\nMixed = A or B and C'));
  assert.deepEqual(members(declarations, 'p'), ['c', 'd']);
  assert.equal(declarations.names.get('bad').kind, ResolvedNameKind.Unresolved);
  assert.equal(declarations.firstDeclarationWords.get('bad').spelling, 'Bad');
  assert.deepEqual(members(declarations, 'recover'), ['c']);
  assert.deepEqual(members(declarations, 's'), ['a', 'b']);
  assert.equal(declarations.names.get('t').object.name, 'a');
  assert.equal(declarations.names.has('u'), false);
  assert.equal(declarations.names.has('mixed'), false);
  assert.ok(diagnostics.some(item => item.code === 'cross-kind-reference'));
  assert.ok(diagnostics.some(item => item.code === 'self-reference'));
});

test('an aggregate keeps all operands after an initial AND even when a later operator is OR', () => {
  const { declarations } = resolveDeclarations(read(simpleObjects, 'Mixed = A and B or C', 'A\nB\nC\nD'));
  assert.equal(declarations.names.get('mixed')?.kind, ResolvedNameKind.Aggregate);
  assert.deepEqual(members(declarations, 'mixed'), ['a', 'b', 'c']);
  assert.deepEqual(names([...declarations.glyphs.get('mixed')]), ['a', 'b', 'c']);
});

test('declaration kind follows the operators remaining after native self-reference removal', () => {
  for (const [legend, expectedKind, authoredKind] of [
    ['Mixed = Mixed and A or B', ResolvedNameKind.Property, SourceLegendKind.Aggregate],
    ['Mixed = A and Mixed or B', ResolvedNameKind.Property, SourceLegendKind.Aggregate],
    ['Mixed = Mixed or A and B', ResolvedNameKind.Aggregate, SourceLegendKind.Invalid],
    ['Mixed = Mixed and Mixed or A or B', ResolvedNameKind.Property, SourceLegendKind.Aggregate],
  ]) {
    const document = read(simpleObjects, legend, 'A\nB\nC\nD');
    const before = structuredClone(document);
    const source = document.legend[0];
    const { declarations } = resolveDeclarations(document);
    const resolved = declarations.names.get('mixed');
    assert.equal(resolved?.kind, expectedKind, legend);
    assert.deepEqual(members(declarations, 'mixed'), ['a', 'b'], legend);
    assert.equal(source.kind, authoredKind, legend);
    assert.equal(resolved.source, source, legend);
    assert.equal(resolved.word, source.name, legend);
    assert.deepEqual(document, before, legend);
  }
});

test('self-only and dangling declarations do not acquire a recovered namespace', () => {
  for (const legend of ['Mixed = Mixed', 'Mixed = Mixed and Mixed', 'Mixed = Mixed or A and', 'Mixed = Mixed and A or B and C']) {
    const { declarations } = resolveDeclarations(read(simpleObjects, legend, 'A\nB\nC\nD'));
    assert.equal(declarations.names.has('mixed'), false, legend);
    assert.equal(declarations.firstDeclarationWords.has('mixed'), false, legend);
  }
});

test('legend lexical errors retain the native definition prefix and exact source evidence', () => {
  for (const [legend, kind, expected] of [
    ['Y = A!', ResolvedNameKind.Object, ['a']],
    ['Y = A #', ResolvedNameKind.Object, ['a']],
    ['Y = A=', ResolvedNameKind.Object, ['a']],
    ['Y = A! or B', ResolvedNameKind.Object, ['a']],
    ['Y = A or B!', ResolvedNameKind.Property, ['a', 'b']],
    ['Y = A and B!', ResolvedNameKind.Aggregate, ['a', 'b']],
    ['Y = A! (comment) or B', ResolvedNameKind.Property, ['a', 'b']],
    ['Y=A=B', ResolvedNameKind.Object, ['a']],
  ]) {
    const document = read(simpleObjects, legend, 'A\nB\nC\nD');
    const before = structuredClone(document);
    const { declarations } = resolveDeclarations(document);
    const resolved = declarations.names.get('y');
    assert.equal(resolved?.kind, kind, legend);
    assert.deepEqual(kind === ResolvedNameKind.Object ? [resolved.object.name] : members(declarations, 'y'), expected, legend);
    assert.equal(resolved.source, document.legend[0], legend);
    assert.equal(resolved.word, document.legend[0].name, legend);
    assert.deepEqual(document, before, legend);
  }
  for (const legend of ['Y==', 'Y=!A', 'Y=A or! B']) {
    assert.equal(resolveDeclarations(read(simpleObjects, legend, 'A\nB\nC\nD')).declarations.names.has('y'), false, legend);
  }
});

test('cyclic aliases stay unresolved while terminating property self-removal recovers native members', () => {
  const { declarations, diagnostics } = resolveDeclarations(read(simpleObjects,
    'One = Two\nTwo = One\nLoop = Later or A\nLater = Loop or B'));
  for (const name of ['one', 'two']) {
    assert.equal(declarations.names.get(name).kind, ResolvedNameKind.Unresolved, name);
    assert.match(declarations.names.get(name).reason, /cycl/i);
  }
  for (const name of ['loop', 'later']) assert.deepEqual(members(declarations, name), ['a', 'b']);
  assert.ok(diagnostics.some(item => item.code === 'cyclic-reference'));
});

test('unnamed layers expand properties, retain empty layers, and reject aggregates', () => {
  const { declarations, diagnostics } = resolveDeclarations(read(simpleObjects,
    'P = A or B\nAlias = P\nPair = C and D', 'Alias\nPair\nMissing\nC, D'));
  assert.deepEqual(declarations.collisionLayers.map(names), [['a', 'b'], [], [], ['c', 'd']]);
  assert.deepEqual([...declarations.objectLayers].map(([object, layer]) => [object.name, layer]), [['a', 0], ['b', 0], ['c', 3], ['d', 3]]);
  assert.ok(diagnostics.some(item => item.code === 'aggregate-in-layer'));
  assert.ok(diagnostics.some(item => item.code === 'undefined-layer-name'));
});

test('final raw occurrence determines effective layer and object choice order', () => {
  const { declarations, diagnostics } = resolveDeclarations(read(simpleObjects, '', 'A, B, A\nC, B\nD'));
  assert.deepEqual(declarations.collisionLayers.map(names), [['a'], ['c', 'b'], ['d']]);
  assert.deepEqual(names(declarations.objectChoiceOrder), ['a', 'c', 'b', 'd']);
  assert.ok(diagnostics.some(item => item.code === 'repeated-layer-name' && !item.countsAsError));
  assert.ok(diagnostics.some(item => item.code === 'multiple-layers' && !item.countsAsError));
  const repeated = resolveDeclarations(read('A\nRed\n\nB\nBlue', '', 'A, B, A')).declarations;
  assert.deepEqual(repeated.collisionLayers.map(names), [['b', 'a']]);
  assert.deepEqual(names(repeated.objectChoiceOrder), ['b', 'a']);
});

test('layer lookup retains earlier synonyms while final names use the last synonym', () => {
  const { declarations } = resolveDeclarations(read(simpleObjects, 'X = B', 'X\nB\nC\nD'));
  assert.equal(declarations.names.get('x').object.name, 'b');
  assert.deepEqual(declarations.collisionLayers.map(names), [['a'], ['b'], ['c'], ['d']]);
});

test('background-alone and unlayered objects diagnose with authored source evidence', () => {
  const { declarations, diagnostics } = resolveDeclarations(read('Background\nBlack\n\nPlayer\nWhite\n\nUnused\nRed', '', 'Background, Player'));
  assert.deepEqual(declarations.collisionLayers.map(names), [['background', 'player']]);
  assert.ok(diagnostics.some(item => item.code === 'background-layer-alone'));
  const unlayered = diagnostics.find(item => item.code === 'unlayered-object');
  assert.equal(unlayered.span.start.line, 8);
});

test('unlayered objects retain empty glyphs and recover lookup through the first raw assignment', () => {
  const { declarations, diagnostics } = resolveDeclarations(read('Background .\nBlack\n\nPlayer P\nWhite\n\nWall #\nBlue', '', 'Background\nPlayer'));
  const [background, , wall] = declarations.objects;
  assert.equal(declarations.objectLayers.has(wall), false);
  for (const name of ['wall', '#']) {
    assert.equal(declarations.glyphs.has(name), true, name);
    assert.equal(declarations.glyphs.get(name).size, 0, name);
    assert.deepEqual([...declarations.namedObjects.get(name)], [background], name);
    assert.deepEqual(declarations.soundTargets.get(name), [wall], name);
  }
  assert.ok(diagnostics.some(item => item.code === 'unlayered-object'));
});

test('an unlayered player uses the same raw-assignment recovery as object lookup', () => {
  const { declarations } = resolveDeclarations(read('Background\nBlack\n\nPlayer P\nWhite\n\nWall\nBlue', '', 'Background\nWall'));
  assert.deepEqual([...declarations.player.objects], [declarations.objects[0]]);
  assert.deepEqual([...declarations.namedObjects.get('player')], [declarations.objects[0]]);
});

test('unlayered lookup retains one immutable orphan when the first raw assignment was superseded', () => {
  const { declarations } = resolveDeclarations(read(simpleObjects, '', 'A\nB\nA\nC'));
  assert.equal(declarations.namedObjects.has('d'), true);
  const orphan = declarations.orphanedObject;
  assert.ok(orphan);
  assert.deepEqual([...declarations.namedObjects.get('d')], [orphan]);
  assert.deepEqual(orphan, { name: 'a', orphanedFrom: declarations.objects[0] });
  assert.ok(Object.isFrozen(orphan));
  assert.equal(declarations.objectChoiceOrder[0], orphan);
  assert.equal(declarations.objectSources.has(orphan), false);
  assert.equal(declarations.objectLayers.has(orphan), false);
});

test('collision layers consult only declarations available at their source point', () => {
  const { declarations, diagnostics } = resolveDeclarations(readSource('OBJECTS\nA\nRed\nCOLLISIONLAYERS\nLater\nLEGEND\nLater = A').document);
  assert.deepEqual(declarations.collisionLayers.map(names), [[]]);
  assert.equal(declarations.names.get('later').object.name, 'a');
  assert.ok(diagnostics.some(item => item.code === 'undefined-layer-name'));
});

test('glyphs use canonical objects and native source order while properties stay ambiguous', () => {
  const { declarations } = resolveDeclarations(read(simpleObjects,
    'P = A or B\nPair = B and A\nAlias = Pair\nX = B\nAgain = X', 'A\nB\nC\nD'));
  assert.deepEqual([...declarations.glyphs.keys()], ['a', 'x', 'b', 'c', 'd', 'pair', 'alias', 'again']);
  assert.deepEqual(names([...declarations.glyphs.get('pair')]), ['a', 'b']);
  assert.equal(declarations.glyphs.has('p'), false);
  assert.equal([...declarations.glyphs.get('x')][0], declarations.objects[0]);
  assert.equal(declarations.names.get('x').object, declarations.objects[1]);
  assert.equal([...declarations.glyphs.get('again')][0], declarations.objects[0]);
});

test('aggregate glyph conflicts keep the first member on each effective layer', () => {
  const { declarations, diagnostics } = resolveDeclarations(read(simpleObjects,
    'Pair = B and A and C\nAlias = Pair', 'A, B\nC\nD'));
  assert.deepEqual(names([...declarations.glyphs.get('pair')]), ['b', 'c']);
  assert.deepEqual(names([...declarations.glyphs.get('alias')]), ['b', 'c']);
  assert.ok(diagnostics.some(item => item.code === 'aggregate-layer-conflict'));
});

test('player object and property aliases use Any while aggregate aliases use All', () => {
  for (const [legend, kind, expected] of [
    ['Player = X', PlayerMatchKind.Any, ['a']],
    ['People = A or B\nPlayer = People', PlayerMatchKind.Any, ['a', 'b']],
    ['Pair = A and B\nAlias = Pair\nPlayer = Alias', PlayerMatchKind.All, ['a', 'b']],
  ]) {
    const { declarations } = resolveDeclarations(read(simpleObjects, legend, 'A\nB\nC\nD'));
    assert.equal(declarations.player.kind, kind);
    assert.deepEqual(names([...declarations.player.objects]), expected);
  }
});

test('background properties keep first declared member and diagnose differing layers', () => {
  const { declarations, diagnostics } = resolveDeclarations(read(simpleObjects,
    'Choices = B or A\nBackground = Choices\nPlayer = C', 'A, B\nC\nD'));
  assert.equal(declarations.background.object.name, 'b');
  assert.equal(declarations.background.layer, 0);
  assert.ok(!diagnostics.some(item => item.code === 'background-multiple-layers'));
  const split = resolveDeclarations(read(simpleObjects, 'Background = B or A', 'A\nB\nC\nD'));
  assert.equal(split.declarations.background.object.name, 'b');
  assert.ok(split.diagnostics.some(item => item.code === 'background-multiple-layers'));
});

test('missing and aggregate backgrounds recover with the first raw id object', () => {
  for (const legend of ['', 'Background = A and B']) {
    const { declarations, diagnostics } = resolveDeclarations(read(simpleObjects, legend, 'A, B, A\nC\nD'));
    assert.deepEqual(names(declarations.objectChoiceOrder), ['b', 'a', 'c', 'd']);
    assert.equal(declarations.background.object.name, 'a');
    assert.equal(declarations.background.layer, 0);
    assert.ok(diagnostics.some(item => item.code === (legend === '' ? 'missing-background' : 'aggregate-background')));
  }
});

test('missing and unresolved declarations return useful empty player and nullable background', () => {
  for (const document of [readSource('').document, read(simpleObjects, 'Player = Missing\nBackground = Missing', 'A\nB\nC\nD')]) {
    const { declarations, diagnostics } = resolveDeclarations(document);
    assert.equal(declarations.player.kind, PlayerMatchKind.Any);
    assert.equal(declarations.player.objects.size, 0);
    assert.equal(declarations.background, null);
    assert.ok(diagnostics.some(item => item.code === 'missing-player' || item.code === 'unresolved-player'));
    for (const diagnostic of diagnostics) {
      assert.equal(diagnostic.phase, SourceDiagnosticPhase.Declarations);
      assert.equal(typeof diagnostic.countsAsError, 'boolean');
      assert.ok(diagnostic.severity === SourceDiagnosticSeverity.Error || diagnostic.severity === SourceDiagnosticSeverity.Warning);
      assert.ok(diagnostic.span === null || diagnostic.span.start.offset <= diagnostic.span.end.offset);
    }
  }
});

test('concrete-name property collisions retain native compiler self-removal recovery', () => {
  const { declarations } = resolveDeclarations(read(simpleObjects,
    'P = A or B\nA = P or C', 'A\nB\nC\nD'));
  assert.equal(declarations.names.get('a').kind, ResolvedNameKind.Object);
  assert.deepEqual(members(declarations, 'p'), ['b', 'c']);
});

test('a concrete-name collision cannot conceal a nonterminating synonym expansion', () => {
  const document = read('A X\nRed\n\nX\nBlue\n\nB\nGreen', 'A = X\nP = X or B', 'A\nX\nB');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { resolveDeclarations } from ${JSON.stringify(new URL('../build/declarations.js', import.meta.url).href)};
    const result = resolveDeclarations(${JSON.stringify(document)});
    if (result.declarations.names.get('p').kind !== ${ResolvedNameKind.Unresolved}) process.exit(2);
  `], { timeout: 2000, encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
});

test('a property with no recoverable concrete members is not registered by the vanilla parser', () => {
  const { declarations } = resolveDeclarations(read(simpleObjects,
    'Pair = A and B\nEmpty = Pair or Pair\nPlayer = Empty', 'A\nB\nC\nD'));
  assert.equal(declarations.names.has('empty'), false);
  assert.equal(declarations.firstDeclarationWords.has('empty'), false);
  assert.equal(declarations.names.get('player').kind, ResolvedNameKind.Unresolved);
  assert.equal(declarations.player.objects.size, 0);
});

test('player selection unions overlapping concrete, synonym and property namespaces', () => {
  const objects = 'Background\nBlack\n\nPlayer P\nWhite\n\nCrate\nBlue\n\nWall\nGreen';
  for (const [legend, expected] of [
    ['Player = Crate', ['player', 'crate']],
    ['Player = Crate or Wall', ['player', 'crate', 'wall']],
    ['Player = Crate or Wall\nPlayer = Background', ['player', 'crate', 'wall', 'background']],
  ]) {
    const { declarations } = resolveDeclarations(read(objects, legend, 'Background\nPlayer, Crate, Wall'));
    assert.equal(declarations.names.get('player').kind, ResolvedNameKind.Object);
    assert.equal(declarations.names.get('player').object.name, 'player');
    assert.equal(declarations.player.kind, PlayerMatchKind.Any);
    assert.deepEqual(new Set(names([...declarations.player.objects])), new Set(expected));
  }
});

test('an aggregate player alias sets All while retaining overlapping concrete and property members', () => {
  const objects = 'Background\nBlack\n\nPlayer P\nWhite\n\nCrate\nBlue\n\nWall\nGreen';
  for (const legend of ['Pair = Crate and Wall\nPlayer = Pair',
    'Player = Background or Wall\nPair = Crate and Wall\nPlayer = Pair']) {
    const { declarations } = resolveDeclarations(read(objects, legend, 'Background\nPlayer\nCrate\nWall'));
    assert.equal(declarations.names.get('player').kind, ResolvedNameKind.Object);
    assert.equal(declarations.player.kind, PlayerMatchKind.All);
    const expected = legend.startsWith('Player') ? ['player', 'background', 'wall', 'crate'] : ['player', 'crate', 'wall'];
    assert.deepEqual(new Set(names([...declarations.player.objects])), new Set(expected));
  }
});

test('background selection prefers concrete then synonym definitions over properties', () => {
  const objects = 'A Background\nBlack\n\nPlayer P\nWhite\n\nB\nBlue\n\nC\nGreen';
  const first = resolveDeclarations(read(objects, 'Background = B or C', 'Background\nPlayer\nB, C')).declarations;
  assert.equal(first.names.get('background').kind, ResolvedNameKind.Property);
  assert.deepEqual(first.background, { object: first.objects[0], layer: 0 });
  const second = resolveDeclarations(read(objects, 'Background = B\nBackground = C or B', 'Background\nPlayer\nB, C')).declarations;
  // The original object alias is overwritten in the final synonym dictionary.
  assert.equal(second.names.get('background').kind, ResolvedNameKind.Property);
  assert.deepEqual(second.background, { object: second.objects[2], layer: 2 });
  const concrete = resolveDeclarations(read('Background\nBlack\n\nPlayer\nWhite\n\nB\nBlue\n\nC\nGreen',
    'Background = B\nBackground = C or B', 'Background\nPlayer\nB, C')).declarations;
  assert.deepEqual(concrete.background, { object: concrete.objects[0], layer: 0 });
});

test('partial player definitions retain native known members and unresolved targets stay empty', () => {
  for (const [legend, kind, expected] of [
    ['Player = Missing', PlayerMatchKind.Any, []],
    ['Player = Missing or A', PlayerMatchKind.Any, ['a']],
    ['Player = Missing and A', PlayerMatchKind.All, ['a']],
  ]) {
    const { declarations, diagnostics } = resolveDeclarations(read(simpleObjects, legend, 'A\nB\nC\nD'));
    assert.equal(declarations.names.get('player').kind, ResolvedNameKind.Unresolved);
    assert.equal(declarations.player.kind, kind);
    assert.deepEqual(names([...declarations.player.objects]), expected);
    assert.ok(diagnostics.some(item => item.code === 'unresolved-player'));
  }
});

test('unresolved background synonym blocks a property fallback while partial properties keep their first member', () => {
  for (const [legend, expected] of [
    ['Background = Missing\nBackground = A or B', null],
    ['Background = Missing or A', null],
    ['Background = A or Missing', 'a'],
  ]) {
    const { declarations } = resolveDeclarations(read(simpleObjects, legend, 'A\nB\nC\nD'));
    assert.equal(declarations.background?.object.name ?? null, expected);
  }
});

test('preferred compound meanings retain the declaration that supplied that namespace', () => {
  const document = read(simpleObjects, 'P = A or B\nP = C');
  const { declarations } = resolveDeclarations(document);
  const property = declarations.names.get('p');
  assert.equal(property.kind, ResolvedNameKind.Property);
  assert.equal(property.source, document.legend[0]);
  assert.equal(property.word, document.legend[0].name);
});

test('fully flattened later properties do not request another vanilla synonym pass', () => {
  const chain = 'One = Two\nTwo = Three\nThree = A';
  const { declarations } = resolveDeclarations(read(simpleObjects, chain, 'A\nB\nC\nD'));
  assert.equal(declarations.names.get('one').kind, ResolvedNameKind.Unresolved);
  assert.equal(declarations.names.get('two').object.name, 'a');
  assert.equal([...declarations.glyphs.get('one')][0].name, 'a');
  const repeated = resolveDeclarations(read(simpleObjects, `${chain}\nP = A or B\nQ = C or D or P`, 'A\nB\nC\nD')).declarations;
  assert.equal(repeated.names.get('one').kind, ResolvedNameKind.Unresolved);
  assert.deepEqual(members(repeated, 'q'), ['c', 'd', 'a', 'b']);
});

test('a synonym/property cycle can terminate by native self-removal', () => {
  const { declarations } = resolveDeclarations(read(simpleObjects, 'Y = X\nX = Y or D', 'A\nB\nC\nD'));
  // X is also an authored object alias here; use independent names for the cycle.
  const recovered = resolveDeclarations(read(simpleObjects, 'Later = Earlier\nEarlier = Later or D', 'A\nB\nC\nD')).declarations;
  for (const name of ['later', 'earlier']) assert.deepEqual(members(recovered, name), ['d']);
  assert.equal(declarations.names.get('x').kind, ResolvedNameKind.Property);
});

test('final synonym dictionaries visit canonical integer-index names before ordinary insertion order', () => {
  const { declarations } = resolveDeclarations(read(simpleObjects, '3 = 2\n2 = 1\n1 = A', 'A\nB\nC\nD'));
  assert.deepEqual([...declarations.names.keys()].filter(name => ['1', '2', '3'].includes(name)), ['3', '2', '1']);
  for (const name of ['3', '2', '1']) assert.equal(declarations.names.get(name).object.name, 'a');
});

test('integer-index order also controls nested property and aggregate member order', () => {
  for (const operator of ['or', 'and']) {
    const legend = [
      ['4', ['2', '2', '3']], ['3', ['B', 'B', 'B', 'D', 'A']],
      ['2', ['C', 'A', 'C', '1']], ['1', ['C', 'D', 'A', 'C']],
    ].map(([name, references]) => `${name} = ${references.join(` ${operator} `)}`).join('\n');
    const { declarations } = resolveDeclarations(read(simpleObjects, legend, 'A\nB\nC\nD'));
    assert.deepEqual(members(declarations, '4'), ['c', 'a', 'd', 'b']);
  }
});

test('integer-index keys exclude leading zeros and the 32-bit maximum sentinel', () => {
  const padded = resolveDeclarations(read(simpleObjects, '03 = 02\n02 = 01\n01 = A', 'A\nB\nC\nD')).declarations;
  assert.equal(padded.names.get('03').kind, ResolvedNameKind.Unresolved);
  for (const [index, outerKind] of [['4294967294', ResolvedNameKind.Object], ['4294967295', ResolvedNameKind.Unresolved]]) {
    const { declarations } = resolveDeclarations(read(simpleObjects, `Outer = ${index}\n${index} = 1\n1 = A`, 'A\nB\nC\nD'));
    assert.equal(declarations.names.get('outer').kind, outerKind);
    assert.equal(declarations.names.get(index).object.name, 'a');
  }
});

test('named object lookup follows original accepted declarations in source order', () => {
  const { declarations } = resolveDeclarations(read(simpleObjects,
    'One = Two\nTwo = Three\nThree = A\nPair = A and B\nEmpty = Pair or Pair\nP = A or B\nA = C', 'A\nB\nC\nD'));
  assert.equal(declarations.namedObjects.has('one'), false);
  assert.equal(declarations.namedObjects.has('two'), false);
  assert.deepEqual(names([...declarations.namedObjects.get('three')]), ['a']);
  assert.deepEqual(names([...declarations.namedObjects.get('a')]), ['c']);
  assert.deepEqual(names([...declarations.namedObjects.get('p')]), ['a', 'b']);
  assert.equal(declarations.namedObjects.has('empty'), false);
  // Final aggregate definitions draw contributions from this separate lookup.
  assert.deepEqual(names([...declarations.namedAggregates.get('pair')]), ['c', 'b']);
});

test('aggregate aliases keep an independent namespace and movement targets preserve final expansion order', () => {
  const { declarations } = resolveDeclarations(read(simpleObjects,
    'Pair = A and B\nAlias = Pair\nP = B or A or B\nA = D', 'A\nB\nC\nD'));
  assert.deepEqual(names([...declarations.namedAggregates.get('alias')]), ['d', 'b']);
  assert.equal(declarations.namedObjects.has('alias'), false);
  assert.equal(declarations.soundTargets.has('alias'), false);
  assert.deepEqual(names(declarations.soundTargets.get('p')), ['b', 'd', 'b']);
  assert.deepEqual(names(declarations.soundTargets.get('a')), ['d']);
});

test('first declaration words retain accepted registration evidence despite later namespace replacement', () => {
  const document = read(simpleObjects, 'Old = A\nOld = B\nMixed = A or B and C', 'A\nB\nC\nD');
  const { declarations } = resolveDeclarations(document);
  assert.equal(declarations.firstDeclarationWords.get('old'), document.legend[0].name);
  assert.equal(declarations.firstDeclarationWords.get('a'), document.objects[0].primaryName);
  assert.equal(declarations.firstDeclarationWords.get('x'), document.objects[0].aliases[0]);
  assert.equal(declarations.firstDeclarationWords.has('mixed'), false);
  assert.equal(declarations.names.get('old').word, document.legend[1].name);
});

test('rule vocabulary keeps object aliases and distinct property and aggregate aliases in dictionary order', () => {
  const { declarations } = resolveDeclarations(read(simpleObjects,
    'ObjectAlias = A\nP = B or A or B\nEquivalent = B or A or B\nPropertyAlias = P\nPair = A and B and A\nAggregateAlias = Pair',
    'A, B\nC\nD'));
  assert.ok(declarations.ruleNames, 'resolved declarations expose rule vocabulary');
  assert.deepEqual([...declarations.ruleNames.synonyms], [['x', 'a'], ['objectalias', 'a']]);
  assert.deepEqual([...declarations.ruleNames.properties], [
    ['p', ['b', 'a', 'b']], ['equivalent', ['b', 'a', 'b']], ['propertyalias', ['b', 'a', 'b']],
  ]);
  assert.deepEqual([...declarations.ruleNames.aggregates], [
    ['pair', ['a', 'b', 'a']], ['aggregatealias', ['a', 'b', 'a']],
  ]);
  assert.deepEqual([...declarations.ruleNames.singleLayerProperties], [['p', 0], ['equivalent', 0], ['propertyalias', 0]]);
});

test('rule vocabulary preserves colliding namespaces even when resolved names prefer one meaning', () => {
  const { declarations } = resolveDeclarations(read(simpleObjects,
    'P = A or B\nP = C\nA = B or D', 'A\nB, D\nC'));
  assert.equal(declarations.names.get('a').kind, ResolvedNameKind.Object);
  assert.equal(declarations.names.get('p').kind, ResolvedNameKind.Property);
  assert.deepEqual([...declarations.ruleNames.synonyms], [['p', 'c']]);
  assert.deepEqual([...declarations.ruleNames.properties], [['p', ['b', 'd']], ['a', ['b', 'd']], ['x', ['b', 'd']]]);
  assert.deepEqual([...declarations.ruleNames.singleLayerProperties], [['p', 1], ['a', 1], ['x', 1]]);
});

test('rule vocabulary retains unresolved final string targets in forward synonym chains', () => {
  const { declarations } = resolveDeclarations(read(simpleObjects,
    'One = Two\nTwo = Three\nThree = A\nLost = Missing', 'A\nB\nC\nD'));
  assert.deepEqual([...declarations.ruleNames.synonyms], [
    ['x', 'a'], ['one', 'three'], ['two', 'a'], ['three', 'a'], ['lost', 'missing'],
  ]);
  assert.equal(declarations.names.get('one').kind, ResolvedNameKind.Unresolved);
  assert.equal(declarations.namedObjects.has('one'), false);
});

test('rule vocabulary enumerates integer-index names before ordinary names in every namespace', () => {
  const synonyms = resolveDeclarations(read(simpleObjects, '3 = 2\n2 = 1\n1 = A', 'A\nB\nC\nD')).declarations.ruleNames;
  assert.deepEqual([...synonyms.synonyms], [['1', 'a'], ['2', 'a'], ['3', 'a'], ['x', 'a']]);
  for (const [operator, dictionary] of [['or', 'properties'], ['and', 'aggregates']]) {
    const { ruleNames } = resolveDeclarations(read(simpleObjects,
      `3 = B ${operator} A\n2 = C ${operator} B\n1 = D ${operator} A`, 'A, B, C, D')).declarations;
    assert.deepEqual([...ruleNames[dictionary]], [['1', ['d', 'a']], ['2', ['c', 'b']], ['3', ['b', 'a']]]);
    if (operator === 'or') assert.deepEqual([...ruleNames.singleLayerProperties], [['1', 0], ['2', 0], ['3', 0]]);
  }
});

test('single-layer rule properties require known members and preserve present unlayered keys', () => {
  const { ruleNames } = resolveDeclarations(read(`${simpleObjects}\n\nE\nPurple`,
    'Same = A or B\nRepeated = A or A\nMixed = A or C\nUnlayered = D or E\nPartial = A or D\nUnknown = Missing or D\nUnknownTail = D or Missing',
    'A, B\nC')).declarations;
  assert.deepEqual([...ruleNames.properties], [
    ['same', ['a', 'b']], ['repeated', ['a', 'a']], ['mixed', ['a', 'c']],
    ['unlayered', ['d', 'e']], ['partial', ['a', 'd']], ['unknown', ['missing', 'd']], ['unknowntail', ['d', 'missing']],
  ]);
  assert.deepEqual([...ruleNames.singleLayerProperties], [['same', 0], ['repeated', 0], ['unlayered', undefined]]);
  assert.equal(ruleNames.singleLayerProperties.has('unlayered'), true);
  for (const name of ['mixed', 'partial', 'unknown', 'unknowntail']) assert.equal(ruleNames.singleLayerProperties.has(name), false, name);
});
