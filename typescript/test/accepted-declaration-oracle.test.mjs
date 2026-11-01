import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from '../build/source-reader.js';
import { prepareDeclarations, resolveDeclarations } from '../build/declarations.js';
import { ResolvedNameKind, PropertyLayerKind } from '../build/declaration-model.js';
import { PlayerMatchKind } from '../build/turn-rules.js';
import { createDeclarationOracle } from './legacy-declaration-oracle.cjs';
import { movementSource } from './scenarios.mjs';

const oracle = createDeclarationOracle({ readSource, resolveDeclarations, ResolvedNameKind, PlayerMatchKind, PropertyLayerKind });
const sourceWithLegend = legend => movementSource({ rules: '[ Player ] -> [ Player ]' })
  .replace('C = Crate', 'C = Crate\n' + legend);

for (const [name, legend] of [
  ['terminal unmatched close drops registration', 'X = Player )'],
  ['nested terminal unmatched close drops registration', 'X = Player (tail))'],
  ['trailing space permits registration before unmatched close', 'X = Player ) '],
  ['missing equals recovered before a comment accepts an alias', 'X ? (c) Player'],
  ['missing equals recovered before a comment accepts a property', 'X ? (c) Player or Crate'],
]) {
  test('accepted declaration stream: ' + name, () => {
    oracle.compareFixture({ name, source: sourceWithLegend(legend) });
  });
}

test('a duplicate object header gives its alias to the last accepted object exactly once', () => {
  const source = movementSource({ rules: '[ Player ] -> [ Player ]' })
    .replace('\nlegend\n', '\nPlayer Extra\nwhite\n\nlegend\n');
  oracle.compareFixture({ name: 'duplicate header alias owner', source });
  const { document } = readSource(source);
  const wall = document.objects.find(object => object.primaryName.normalized === 'wall');
  const word = wall.definitionNames.find(token => token.value === 'extra').word;
  const { declarations } = resolveDeclarations(document);
  assert.equal(declarations.names.get('extra').object, declarations.names.get('wall').object);
  assert.equal(declarations.names.get('extra').source, wall);
  assert.equal(declarations.names.get('extra').word, word);
  const prepared = prepareDeclarations(document);
  assert.equal(prepared.aliases.filter(alias => alias.name === 'extra').length, 1);
});

test('an alias after the fifth sprite row retains its accepted object and exact authored word', () => {
  const source = movementSource({ rules: '[ Player ] -> [ Player ]' })
    .replace('Wall\nblue', 'Wall\nblue\n00000\n00000\n00000\n00000\n00000 Extra');
  oracle.compareFixture({ name: 'sprite-row alias owner', source });
  const { document } = readSource(source);
  const wall = document.objects.find(object => object.primaryName.normalized === 'wall');
  const word = wall.definitionNames.find(token => token.value === 'extra').word;
  const { declarations } = resolveDeclarations(document);
  const alias = declarations.names.get('extra');
  assert.equal(alias.object, declarations.names.get('wall').object);
  assert.equal(alias.source, wall);
  assert.equal(alias.word, word);
  assert.equal(source.slice(word.span.start.offset, word.span.end.offset), 'Extra');
  assert.ok(word.span.start.line > wall.primaryName.span.start.line);
});

for (const inherited of ['constructor', '__proto__']) {
  test('an inherited object lookup keeps an empty layer without inventing an object: ' + inherited, () => {
    const source = movementSource({ rules: '[ Player ] -> [ Player ]' })
      .replace('Player, Crate, Wall', 'Player, Crate, Wall\n' + inherited);
    oracle.compareFixture({ name: 'inherited empty layer ' + inherited, source });
    const { declarations } = resolveDeclarations(readSource(source).document);
    assert.equal(declarations.collisionLayers.length, 3);
    assert.deepEqual(declarations.collisionLayers[2], []);
    assert.equal(declarations.objects.some(object => object.name === inherited), false);
  });
}
