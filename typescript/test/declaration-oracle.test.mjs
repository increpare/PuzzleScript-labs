import assert from 'node:assert/strict';
import test from 'node:test';
import { runInThisContext } from 'node:vm';
import { readSource } from '../build/source-reader.js';
import { resolveDeclarations } from '../build/declarations.js';
import { ResolvedNameKind } from '../build/declaration-model.js';
import { PlayerMatchKind } from '../build/turn-rules.js';
import { createDeclarationOracle } from './legacy-declaration-oracle.cjs';
import { movementSource } from './scenarios.mjs';

const oracle = createDeclarationOracle({ readSource, resolveDeclarations, ResolvedNameKind, PlayerMatchKind });
const fixture = { name: 'declaration oracle', source: movementSource() };
const vocabularyAliases = { name: 'rule vocabulary aliases and duplicates', source: movementSource()
  .replace('C = Crate', 'C = Crate\nObjectAlias = Player\nMovable = Crate or Player or Crate or Wall\nEquivalent = Crate or Player or Crate or Wall\nPropertyAlias = Movable\nPair = Player and Wall and Player\nAggregateAlias = Pair') };
const vocabularyCollisionSource = movementSource()
  .replace('C = Crate', 'C = Crate\nMovable = Player or Crate\nMovable = Wall');
const vocabularyCollision = { name: 'rule vocabulary overlapping namespaces', source: vocabularyCollisionSource,
  nameSourceLines: [['movable', vocabularyCollisionSource.split('\n').indexOf('Movable = Player or Crate') + 1]] };
const unlayeredVocabulary = { name: 'rule vocabulary unlayered properties', source: movementSource()
  .replace('C = Crate', 'C = Crate\nUnlayered = Crate or Wall\nMixed = Player or Crate\nSame = Player or Player')
  .replace('Player, Crate, Wall', 'Player') };

function corruptRuleVocabulary(item, corrupt) {
  return () => oracle.compareFixture(item, { resolveDeclarations: document => {
    const result = resolveDeclarations(document);
    const ruleNames = corrupt(result.declarations.ruleNames);
    return { ...result, declarations: { ...result.declarations, ruleNames } };
  } });
}

test('the independent resolver agrees on canonical declarations and unnamed layers', () => {
  const report = oracle.compareFixture(fixture);
  assert.equal(report.objects, 4);
  assert.equal(report.layers, 2);
  assert.equal(report.checkedNameSources, report.names);
  assert.equal(report.unverifiedNameSources, 0);
});

test('wrong layer assignment is rejected', () => {
  assert.throws(() => oracle.compareFixture(fixture, { resolveDeclarations: document => {
    const result = resolveDeclarations(document);
    return { ...result, declarations: { ...result.declarations, collisionLayers: [...result.declarations.collisionLayers].reverse() } };
  } }), /resolved declaration data/);
});

test('reversing random object choice order is rejected', () => {
  assert.throws(() => oracle.compareFixture(fixture, { resolveDeclarations: document => {
    const result = resolveDeclarations(document);
    return { ...result, declarations: { ...result.declarations, objectChoiceOrder: [...result.declarations.objectChoiceOrder].reverse() } };
  } }), /resolved declaration data/);
});

test('lookalike object values cannot replace shared canonical identities', () => {
  assert.throws(() => oracle.compareFixture(fixture, { resolveDeclarations: document => {
    const result = resolveDeclarations(document);
    const names = new Map(result.declarations.names);
    const player = names.get('player');
    names.set('player', { ...player, object: { ...player.object } });
    return { ...result, declarations: { ...result.declarations, names } };
  } }), /canonical identity/);
});

test('a resolved name cannot claim an unrelated authored source', () => {
  const item = { name: 'unrelated name source', source: movementSource()
    .replace('C = Crate', 'C = Crate\nMovable = Player or Crate') };
  assert.throws(() => oracle.compareFixture(item, { resolveDeclarations: document => {
    const result = resolveDeclarations(document);
    const names = new Map(result.declarations.names);
    names.set('movable', { ...names.get('movable'), source: document.objects[0] });
    return { ...result, declarations: { ...result.declarations, names } };
  } }), /name provenance/);
});

test('resolved source words must retain their authored identity', () => {
  assert.throws(() => oracle.compareFixture(fixture, { resolveDeclarations: document => {
    const result = resolveDeclarations(document);
    const names = new Map(result.declarations.names);
    const player = names.get('player');
    names.set('player', { ...player, word: { ...player.word } });
    return { ...result, declarations: { ...result.declarations, names } };
  } }), /name provenance/);
});

test('provenance selects the property namespace when a later synonym conflicts', () => {
  const source = movementSource().replace('C = Crate', 'C = Crate\nMovable = Player or Crate\nMovable = Wall');
  const item = { name: 'conflicting namespace provenance', source,
    nameSourceLines: [['movable', source.split('\n').indexOf('Movable = Player or Crate') + 1]] };
  oracle.compareFixture(item);
  assert.throws(() => oracle.compareFixture(item, { resolveDeclarations: document => {
    const result = resolveDeclarations(document);
    const names = new Map(result.declarations.names);
    const wrong = document.legend.find(entry => entry.name?.normalized === 'movable' && entry.references.length === 1);
    names.set('movable', { ...names.get('movable'), source: wrong, word: wrong.name });
    return { ...result, declarations: { ...result.declarations, names } };
  } }), /name provenance/);
});

test('duplicate property provenance follows the native last declaration', () => {
  const source = movementSource().replace('C = Crate', 'C = Crate\nMovable = Player or Crate\nMovable = Wall or Crate');
  const item = { name: 'duplicate property provenance', source,
    nameSourceLines: [['movable', source.split('\n').indexOf('Movable = Wall or Crate') + 1]] };
  const report = oracle.compareFixture(item);
  assert.equal(report.unverifiedNameSources, 0);
  assert.throws(() => oracle.compareFixture(item, { resolveDeclarations: document => {
    const result = resolveDeclarations(document);
    const names = new Map(result.declarations.names);
    const wrong = document.legend.find(entry => entry.name?.normalized === 'movable');
    names.set('movable', { ...names.get('movable'), source: wrong, word: wrong.name });
    return { ...result, declarations: { ...result.declarations, names } };
  } }), /name provenance/);
});

test('the candidate resolver cannot call native compiler producers', () => {
  assert.throws(() => oracle.compareFixture(fixture, { resolveDeclarations: document => {
    globalThis.generateExtraMembers({});
    return resolveDeclarations(document);
  } }), /TS declarations called JS producer generateExtraMembers/);
});

test('the candidate reader cannot use the lexical native parser binding', () => {
  assert.throws(() => oracle.compareFixture(fixture, { readSource: source => {
    runInThisContext('new codeMirrorFn().startState()');
    return readSource(source);
  } }), /TS declarations called JS producer codeMirrorFn/);
});

test('duplicate layer occurrences preserve only the final effective assignment and order', () => {
  oracle.compareFixture({ name: 'same layer duplicate', source: movementSource().replace('Player, Crate, Wall', 'Player, Crate, Wall, Player') });
  oracle.compareFixture({ name: 'cross layer duplicate', source: movementSource().replace('Player, Crate, Wall', 'Player, Crate, Wall\nPlayer') });
});

test('a duplicate synonym keeps distinct compiler and glyph recovery meanings', () => {
  oracle.compareFixture({ name: 'duplicate alias recovery', source: movementSource()
    .replace('\nPlayer\nwhite', '\nPlayer X\nwhite')
    .replace('C = Crate', 'C = Crate\nX = Crate') });
});

test('player selection preserves native unions across conflicting name declarations', () => {
  for (const declaration of ['Player = Crate', 'Player = Crate or Wall']) {
    oracle.compareFixture({ name: 'overlapping player: ' + declaration,
      source: movementSource().replace('C = Crate', 'C = Crate\n' + declaration) });
  }
});

test('background selection keeps native synonym precedence over a conflicting property', () => {
  oracle.compareFixture({ name: 'background alias and property', source: movementSource()
    .replace('\nBackground\nblack', '\nBase Background\nblack')
    .replace('C = Crate', 'C = Crate\nBackground = Crate or Wall') });
  oracle.compareFixture({ name: 'background synonym and property', source: movementSource()
    .replace('\nBackground\nblack', '\nBase\nblack')
    .replace('. = Background', '. = Base\nBackground = Crate\nBackground = Wall or Crate')
    .replace('collisionlayers\nBackground', 'collisionlayers\nBase') });
});

test('forward synonym compiler recovery remains distinct from fully resolved glyphs', () => {
  for (const extra of ['', '\nPicks = Wall or Player\nMore = Crate or Wall or Picks']) {
    oracle.compareFixture({ name: 'forward synonym recovery with expansion ' + Boolean(extra), source: movementSource()
      .replace('C = Crate', 'C = Crate\nOne = Two\nTwo = Three\nThree = Crate' + extra) });
  }
});

test('property cycles that converge through native self-removal retain their members', () => {
  for (const legend of ['Y = X\nX = Y or Wall', 'Loop = Later or Player\nLater = Loop or Crate']) {
    oracle.compareFixture({ name: 'recoverable property cycle: ' + legend,
      source: movementSource().replace('C = Crate', 'C = Crate\n' + legend) });
  }
});

test('integer-index declaration names follow native dictionary ordering during normalization', () => {
  oracle.compareFixture({ name: 'numeric synonym order', source: movementSource()
    .replace('C = Crate', 'C = Crate\n3 = 2\n2 = 1\n1 = Crate') });
});

test('property membership order remains observable after nested declarations', () => {
  oracle.compareFixture({ name: 'nested properties', source: movementSource()
    .replace('C = Crate', 'C = Crate\nMovable = Player or Crate\nOther = Wall or Movable\nMore = Crate or Wall or Movable') });
});

test('changing property member order is rejected', () => {
  const item = { name: 'property order corruption', source: movementSource()
    .replace('C = Crate', 'C = Crate\nMovable = Player or Crate') };
  assert.throws(() => oracle.compareFixture(item, { resolveDeclarations: document => {
    const result = resolveDeclarations(document);
    const names = new Map(result.declarations.names);
    const property = names.get('movable');
    names.set('movable', { ...property, members: [...property.members].reverse() });
    return { ...result, declarations: { ...result.declarations, names } };
  } }), /resolved declaration data/);
});

test('rule vocabulary aliases, equivalent properties, duplicates and concrete collisions match native dictionaries', () => {
  for (const item of [vocabularyAliases, vocabularyCollision, unlayeredVocabulary,
    { name: 'rule vocabulary concrete namespace collision', source: movementSource()
      .replace('C = Crate', 'C = Crate\nWall = Player or Crate') },
    // The older preferred-name oracle assumes compound names resolve. Remove
    // Wall's # alias to avoid that unrelated unresolved-name limitation while
    // comparing its concrete-name collision and raw vocabulary in full.
    ...['Missing or Crate', 'Crate or Missing'].map(expression => ({ name: 'rule vocabulary unknown member ' + expression,
      source: movementSource().replace('C = Crate', 'C = Crate\nWall = ' + expression).replace('# = Wall\n', '')
        .replace('Player, Crate, Wall', 'Player, Wall') })),
  ]) oracle.compareFixture(item);
});

test('rule vocabulary integer-index properties and aggregates retain native entry order', () => {
  for (const operator of ['or', 'and']) oracle.compareFixture({ name: 'numeric rule vocabulary ' + operator,
    source: movementSource().replace('C = Crate', `C = Crate\n3 = Wall ${operator} Player\n2 = Crate ${operator} Wall\n1 = Player ${operator} Crate`) });
});

test('dropping a colliding rule synonym namespace is rejected', () => {
  assert.throws(corruptRuleVocabulary(vocabularyCollision, ruleNames => {
    const synonyms = new Map(ruleNames.synonyms);
    synonyms.delete('movable');
    return { ...ruleNames, synonyms };
  }), /resolved declaration data/);
});

test('reversing rule property member order is rejected', () => {
  assert.throws(corruptRuleVocabulary(vocabularyAliases, ruleNames => {
    const properties = new Map(ruleNames.properties);
    properties.set('movable', [...properties.get('movable')].reverse());
    return { ...ruleNames, properties };
  }), /resolved declaration data/);
});

test('reversing rule dictionary entries is rejected', () => {
  for (const dictionary of ['synonyms', 'properties', 'aggregates', 'singleLayerProperties']) {
    assert.throws(corruptRuleVocabulary(vocabularyAliases,
      ruleNames => ({ ...ruleNames, [dictionary]: new Map([...ruleNames[dictionary]].reverse()) })), /resolved declaration data/, dictionary);
  }
});

test('dropping a present undefined single-layer property is rejected', () => {
  assert.throws(corruptRuleVocabulary(unlayeredVocabulary, ruleNames => {
    assert.equal(ruleNames.singleLayerProperties.has('unlayered'), true);
    assert.equal(ruleNames.singleLayerProperties.get('unlayered'), undefined);
    const singleLayerProperties = new Map(ruleNames.singleLayerProperties);
    singleLayerProperties.delete('unlayered');
    return { ...ruleNames, singleLayerProperties };
  }), /resolved declaration data/);
});

test('the independent resolver agrees on declaration data for every simulation source', () => {
  const fixtures = oracle.corpusFixtures();
  assert.equal(fixtures.length, 478);
  for (const item of fixtures) oracle.compareFixture(item);
});

test('initial AND declarations retain native aggregate recovery after later operators', () => {
  for (const operator of ['or', 'unexpected']) oracle.compareFixture({ name: 'aggregate recovery ' + operator,
    source: movementSource().replace('C = Crate', 'C = Crate\nMixed = Player and Crate ' + operator + ' Wall')
      .replace('Player, Crate, Wall', 'Player\nCrate\nWall') });
});

test('self-reference removal precedes native declaration-kind selection', () => {
  for (const expression of ['Mixed and Player or Crate', 'Player and Mixed or Crate', 'Mixed or Player and Crate',
    'Mixed and Mixed or Player and Crate']) {
    oracle.compareFixture({ name: 'self-reference kind recovery ' + expression,
      source: movementSource().replace('C = Crate', 'C = Crate\nMixed = ' + expression)
        .replace('Player, Crate, Wall', 'Player\nCrate\nWall') });
  }
});

test('unlayered names retain empty glyphs and native object lookup recovery', () => {
  for (const layers of ['Player, Crate', 'Crate, Wall', 'Player, Crate\nBackground']) {
    oracle.compareFixture({ name: 'unlayered recovery ' + layers,
      source: movementSource().replace('Player, Crate, Wall', layers) });
  }
});

test('meaningful object lookups preserve raw concrete and source-ordered named recovery', () => {
  for (const layers of ['Background\nPlayer, Crate', 'Background, Wall\nPlayer\nBackground', 'Unknown']) {
    for (const legend of ['', 'Wall = Player\nMixed = Wall or Crate', 'Wall = Player or Crate']) {
      const source = movementSource().replace('Background\nPlayer, Crate, Wall', layers)
        .replace('C = Crate', 'C = Crate\n' + legend);
      oracle.compareFixture({ name: 'meaningful lookups ' + layers + '; ' + legend, source });
    }
  }
});

test('one writable orphan remains in a lookup that also contains ordinary objects', () => {
  const source = movementSource().replace('Background\nPlayer, Crate, Wall', 'Background, Wall\nPlayer\nBackground')
    .replace('C = Crate', 'C = Crate\nMixed = Wall or Crate');
  oracle.compareFixture({ name: 'orphan and ordinary lookup', source });
  const { declarations } = resolveDeclarations(readSource(source).document);
  const lookup = declarations.namedObjects.get('mixed');
  assert.deepEqual([...lookup].map(object => object.name), ['wall', 'background']);
  assert.equal([...lookup][1], declarations.orphanedObject);
  assert.equal(declarations.orphanedObject.orphanedFrom, declarations.objects.find(object => object.name === 'background'));
});

test('discarding the writable orphan is rejected by the native declaration oracle', () => {
  const item = { name: 'lost orphan lookup', source: movementSource()
    .replace('Background\nPlayer, Crate, Wall', 'Background, Wall\nPlayer\nBackground') };
  assert.throws(() => oracle.compareFixture(item, { resolveDeclarations: document => {
    const result = resolveDeclarations(document);
    const namedObjects = new Map([...result.declarations.namedObjects].map(([name, lookup]) =>
      [name, new Set([...lookup].filter(object => object !== result.declarations.orphanedObject))]));
    return { ...result, declarations: { ...result.declarations,
      namedObjects } };
  } }), /resolved declaration data/);
});

for (const [layers, first, hasOrphan] of [
  ['Background\nPlayer, Crate', 'background', false],
  ['Background\nBackground\nPlayer, Crate, Wall', 'background', false],
  ['Background\nBackground\nCrate\nCrate', 'background', true],
  ['Player, Crate\nPlayer\nBackground', 'player', true],
  ['Unknown', null, false],
]) test('only a needed overwritten first assignment gains an orphan: ' + layers, () => {
  const source = movementSource().replace('Background\nPlayer, Crate, Wall', layers);
  oracle.compareFixture({ name: 'bounded orphan ' + layers, source });
  const { declarations } = resolveDeclarations(readSource(source).document);
  assert.equal(declarations.orphanedObject !== null, hasOrphan);
  if (hasOrphan) {
    const orphan = declarations.orphanedObject;
    assert.equal(orphan.orphanedFrom, declarations.objects.find(object => object.name === first));
    const unlayered = declarations.objects.filter(object => !declarations.objectLayers.has(object));
    for (const object of unlayered) assert.deepEqual([...declarations.rawObjectLookups.get(object)], [orphan]);
    assert.equal(declarations.objectChoiceOrder.filter(object => object.orphanedFrom !== undefined).length, 1);
  } else for (const object of declarations.objects) {
    if (declarations.objectLayers.has(object)) continue;
    assert.deepEqual([...declarations.rawObjectLookups.get(object)], first === null ? []
      : [declarations.objects.find(candidate => candidate.name === first)]);
  }
});

test('orphan recovery propagates through aliases, properties and aggregates while raw lookup bypasses final names', () => {
  for (const override of ['', 'Wall = Player', 'Wall = Player or Crate']) {
    const source = movementSource().replace('Background\nPlayer, Crate, Wall', 'Background\nBackground\nPlayer')
      .replace('C = Crate', 'C = Crate\nAlias = Wall\nMixed = Wall or Crate or Wall\nPair = Wall and Crate\n' + override);
    oracle.compareFixture({ name: 'orphan namespaces ' + override, source });
    const { declarations } = resolveDeclarations(readSource(source).document);
    const orphan = declarations.orphanedObject;
    for (const name of ['crate', 'wall']) {
      const object = declarations.objects.find(object => object.name === name);
      assert.deepEqual([...declarations.rawObjectLookups.get(object)], [orphan]);
    }
    assert.ok(declarations.namedObjects.get('mixed').has(orphan));
    assert.ok(declarations.namedAggregates.get('pair').has(orphan));
    if (override !== '') assert.equal(declarations.namedObjects.get('wall').has(orphan), override.includes('or'));
  }
});

for (const corrupt of ['replace with final identity', 'wrong source link']) test('native declaration oracle rejects orphan ' + corrupt, () => {
  const source = movementSource().replace('Background\nPlayer, Crate, Wall', 'Background\nBackground\nCrate, Wall');
  assert.throws(() => oracle.compareFixture({ name: corrupt, source }, { resolveDeclarations: document => {
    const result = resolveDeclarations(document);
    const { declarations } = result;
    if (corrupt === 'replace with final identity') {
      const namedObjects = new Map([...declarations.namedObjects].map(([name, members]) => [name,
        new Set([...members].map(object => object === declarations.orphanedObject ? object.orphanedFrom : object))]));
      return { ...result, declarations: { ...declarations, namedObjects } };
    }
    return { ...result, declarations: { ...declarations, orphanedObject: Object.freeze({ name: 'background',
      orphanedFrom: Object.freeze({ name: 'background' }) }) } };
  } }), /resolved declaration data|canonical authored declaration/);
});

test('a punctuation map alias is not accepted as a collision-layer name', () => {
  oracle.compareFixture({ name: 'punctuation collision alias',
    source: movementSource().replace('Player, Crate, Wall', 'Player, Crate, #') });
});

test('legend recovery keeps recognized operand prefixes before punctuation', () => {
  for (const expression of ['Player!', 'Player #', 'Player=', 'Player! or Crate', 'Player or Crate!',
    'Player and Crate!', 'Player! (comment) or Crate']) {
    oracle.compareFixture({ name: 'legend prefix recovery ' + expression,
      source: movementSource().replace('C = Crate', 'C = Crate\nX = ' + expression)
        .replace('Player, Crate, Wall', 'Player\nCrate\nWall') });
  }
});

test('an aggregate Player retains its writable orphan even when no initial cell contains it', () => {
  oracle.compareFixture({ name: 'orphan aggregate player',
    source: movementSource({ level: 'C', rules: '' }).replaceAll('Player', 'Avatar')
      .replace('C = Crate', 'C = Crate\nPlayer = Wall and Crate')
      .replace('Avatar, Crate, Wall', 'Avatar, Crate\nBackground') });
});

test('an aggregate Player with zero raw assignments retains empty All meaning', () => {
  oracle.compareFixture({ name: 'zero assignment aggregate player',
    source: movementSource({ level: 'C', rules: '' }).replaceAll('Player', 'Avatar')
      .replace('C = Crate', 'C = Crate\nPlayer = Wall and Crate')
      .replace('Background\nAvatar, Crate, Wall', 'Unknown') });
});
