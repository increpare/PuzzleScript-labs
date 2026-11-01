import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from '../build/source-reader.js';
import { parseSource } from '../build/source-parser.js';
import { prepareDeclarations, completeDeclarations, resolveDeclarations } from '../build/declarations.js';
import { compileObjectSprites } from '../build/source-assets.js';
import { SourceDeclarationKind, SourceAliasOriginKind } from '../build/source-declarations.js';

const objects = 'Background .\nBlack\n\nPlayer P\nWhite\n\nCrate C\nRed';
function read(legend = '', layers = 'Background\nPlayer, Crate', definitions = objects) {
  return readSource(`OBJECTS\n${definitions}\nLEGEND\n${legend}\nSOUNDS\nCOLLISIONLAYERS\n${layers}\nRULES\nWINCONDITIONS\nLEVELS`).document;
}

test('accepted registrations carry recovered operand evidence and authored declaration identities', () => {
  const document = read('Choice = Choice or Player or Crate\nAlias = Choice');
  const choice = document.acceptedDeclarations.registrations.find(entry => entry.name === 'choice');
  assert.equal(choice.kind, SourceDeclarationKind.Property);
  assert.equal(choice.source, document.legend[0]);
  assert.equal(choice.nameToken.word, document.legend[0].name);
  assert.deepEqual(choice.references, ['player', 'crate']);
  assert.deepEqual(choice.referenceTokens.map(token => token.word), document.legend[0].references.slice(1));
  const alias = document.acceptedDeclarations.registrations.find(entry => entry.name === 'alias');
  assert.equal(alias.kind, SourceDeclarationKind.Alias);
  assert.equal(alias.target, 'choice');
  assert.equal(alias.origin.target.word, document.legend[1].references[0]);
});

test('preparation consumes accepted registrations and memberships after authored arrays change', () => {
  const document = read('Choice = Player or Crate\nAlias = Choice', 'Background\nAlias, Player');
  const playerSource = document.objects[1];
  const choiceSource = document.legend[0];
  const playerWord = playerSource.primaryName;
  document.objects.splice(0);
  document.legend.splice(0);
  document.collisionLayers.splice(0);
  playerSource.definitionNames.splice(0);
  choiceSource.definitionWords.splice(0);
  const prepared = prepareDeclarations(document);
  assert.deepEqual(prepared.objects.map(object => object.name), ['background', 'player', 'crate']);
  assert.equal(prepared.objectSources.get(prepared.objects[1]), playerSource);
  assert.equal(prepared.firstDeclarationWords.get('player'), playerWord);
  assert.deepEqual(prepared.rawLayers.map(layer => layer.map(object => object.name)), [['background'], ['player', 'crate', 'player']]);
  const result = completeDeclarations(prepared).declarations;
  assert.equal(result.names.get('choice').source, choiceSource);
  assert.equal(result.names.get('p').object, prepared.objects[1]);
});

test('unregistered legend prefixes stay absent and missing-equals recovery stays accepted', () => {
  for (const legend of ['X = Player )', 'X = Player (tail))']) {
    assert.equal(resolveDeclarations(read(legend)).declarations.names.has('x'), false, legend);
  }
  for (const [legend, expected] of [['X ? (c) Player', ['player']], ['X ? (c) Player or Crate', ['player', 'crate']]]) {
    const document = read(legend);
    const result = resolveDeclarations(document).declarations;
    const x = result.names.get('x');
    assert.ok(x, legend);
    assert.deepEqual('object' in x ? [x.object.name] : x.members.map(object => object.name), expected, legend);
    assert.equal(x.source, document.legend[0]);
    assert.equal(x.word, document.legend[0].name);
  }
});

test('accepted aliases keep their owning primary across sprite completion and duplicate headers', () => {
  const definitions = 'Background\nBlack\n\nPlayer P\nWhite\n00000\n00000\n00000\n00000\n00000 Late\n\nCrate C\nRed\n\nPlayer Extra\nBlue';
  const document = read('', 'Background\nPlayer\nCrate', definitions);
  const accepted = document.acceptedDeclarations.registrations;
  const late = accepted.find(entry => entry.name === 'late');
  const extra = accepted.find(entry => entry.name === 'extra');
  assert.equal(late.source, document.objects[1]);
  assert.equal(late.nameToken.word, document.objects[1].definitionNames.find(token => token.value === 'late').word);
  assert.equal(extra.source, document.objects[2]);
  assert.equal(extra.nameToken.word, document.objects[3].aliases[0]);
  assert.equal(accepted.filter(entry => entry.name === 'extra').length, 1);
  const { declarations } = resolveDeclarations(document);
  assert.equal(declarations.names.get('late').object, declarations.objects[1]);
  assert.equal(declarations.names.get('extra').object, declarations.objects[2]);
});

test('inherited lookup members retain empty layer slots without canonical objects', () => {
  const document = read('', 'constructor\n__proto__\nBackground\nPlayer, Crate');
  const prepared = prepareDeclarations(document);
  assert.deepEqual(prepared.rawLayers.map(layer => layer.map(object => object.name)), [[], [], ['background'], ['player', 'crate']]);
  assert.deepEqual(prepared.objects.map(object => object.name), ['background', 'player', 'crate']);
});

test('a stopped source walk remains authoritative before the interrupted layer mutation', () => {
  const source = `OBJECTS\n${objects}\nLEGEND\nSOUNDS\nCOLLISIONLAYERS\nPlayer\n` +
    Array.from({ length: 101 }, () => 'Player').join('\n') + '\nCrate';
  const { document } = parseSource(source);
  const prepared = prepareDeclarations(document);
  assert.equal(document.acceptedDeclarations.collisionLayers.length, 102);
  assert.deepEqual(prepared.rawLayers.at(-1), []);
  assert.equal(prepared.rawLayers.some(layer => layer.some(object => object.name === 'crate')), false);
});

test('final normalization leaves accepted source memberships and repeated completion unchanged', () => {
  const document = read('Early = Later\nLater = Player or Crate\nChoice = Player or Later', 'Background\nPlayer, Crate');
  const before = structuredClone(document.acceptedDeclarations);
  const prepared = prepareDeclarations(document);
  const first = completeDeclarations(prepared).declarations;
  const second = completeDeclarations(prepared).declarations;
  assert.deepEqual(document.acceptedDeclarations, before);
  assert.deepEqual([...first.ruleNames.properties], [...second.ruleNames.properties]);
  assert.equal(first.names.get('early').source, document.legend[0]);
});


test('an alias after an initially rejected primary records an explicit missing owner', () => {
  const document = readSource('OBJECTS\nconstructor Ghost').document;
  const alias = document.acceptedDeclarations.registrations[0];
  assert.equal(alias.kind, SourceDeclarationKind.Alias);
  assert.equal(alias.target, '');
  assert.equal(alias.origin.kind, SourceAliasOriginKind.UnownedObject);
  assert.equal(alias.origin.attemptedPrimary.word, document.objects[0].primaryName);
  assert.equal(alias.nameToken.word, document.objects[0].aliases[0]);
  assert.deepEqual(prepareDeclarations(document).objects, []);
});


test('recovery primaries bind to existing authored colors and retain assets beside rejected headers', () => {
  const document = read('', 'Background\nPlayer, Crate, Blue', objects + '\n\n.Bad !\nBlue\n\nPlayer Extra\nGreen');
  const blue = document.acceptedDeclarations.registrations.find(entry => entry.kind === SourceDeclarationKind.Object && entry.name === 'blue');
  const extra = document.acceptedDeclarations.registrations.find(entry => entry.name === 'extra');
  assert.equal(blue.source, document.objects[3]);
  assert.equal(blue.nameToken.word, document.objects[3].colors[0]);
  assert.equal(extra.source, blue.source);
  assert.equal(extra.nameToken.word, document.objects[4].aliases[0]);
  assert.equal(blue.colors[0].word, document.objects[4].colors[0]);
  const { declarations } = resolveDeclarations(document);
  const sprites = compileObjectSprites(document, declarations);
  assert.equal(sprites.diagnostics.some(issue => issue.code === 'missing-object-color'), false);
});

test('recovery primary diagnostics use the accepted primary word while retaining its authored object', () => {
  const document = read('', 'Background\nPlayer, Crate, Blue', objects + '\n\n.Bad !\nBlue');
  const { declarations } = resolveDeclarations(document);
  const sprites = compileObjectSprites(document, declarations);
  const blue = document.acceptedDeclarations.registrations.find(entry => entry.name === 'blue');
  const missing = sprites.diagnostics.find(issue => issue.code === 'missing-object-color');
  assert.equal(missing.reportedLine, blue.nameToken.word.span.start.line);
  assert.equal(missing.span, blue.nameToken.word.span);
});


test('object diagnostics use the accepted primary after an earlier same-name alias', () => {
  const document = read('', 'Background\nPlayer, Crate, A, X', objects + '\n\nA X\nRed\n\nX');
  const prepared = prepareDeclarations(document);
  const resolved = completeDeclarations(prepared).declarations;
  const primary = document.acceptedDeclarations.registrations.find(entry => entry.kind === SourceDeclarationKind.Object && entry.name === 'x').nameToken.word;
  assert.notEqual(prepared.firstDeclarationWords.get('x'), primary);
  for (const declarations of [prepared, resolved]) {
    const missing = compileObjectSprites(document, declarations).diagnostics.find(issue => issue.code === 'missing-object-color');
    assert.equal(missing.reportedLine, primary.span.start.line);
    assert.equal(missing.span, primary.span);
  }
});


test('accepted primaries sharing one authored object retain independent colors and sprite rows', () => {
  const document = read('', 'Background\nPlayer, Crate\nBlue\nWhite', objects + '\n\n.Bad !\nBlue\n00000\nWhite\nRed\n00000');
  const blue = document.acceptedDeclarations.registrations.find(entry => entry.kind === SourceDeclarationKind.Object && entry.name === 'blue');
  const white = document.acceptedDeclarations.registrations.find(entry => entry.kind === SourceDeclarationKind.Object && entry.name === 'white');
  assert.equal(blue.source, white.source);
  assert.deepEqual(blue.colors.map(token => token.value), []);
  assert.deepEqual(white.colors.map(token => token.value), ['red']);
  assert.deepEqual(blue.spriteRows, []);
  assert.deepEqual(white.spriteRows.map(row => row.map(token => token.value).join('')), ['00000']);
  assert.notEqual(blue.colors, white.colors);
  assert.equal(white.nameToken.word.spelling, 'White');
  assert.ok(white.source.definitionNames.includes(blue.nameToken));
  assert.ok(white.source.definitionNames.includes(white.nameToken));
  // Authored container arrays can be cleared without changing accepted assets.
  white.source.colors.splice(0);
  white.source.spriteRows.splice(0);
  const { declarations } = resolveDeclarations(document);
  const sprites = compileObjectSprites(document, declarations);
  const missing = sprites.diagnostics.filter(issue => issue.code === 'missing-object-color');
  assert.deepEqual(missing.map(issue => issue.reportedLine), [blue.nameToken.word.span.start.line]);
  assert.equal(sprites.sprites.get(declarations.names.get('white').object).colors[0], '#be2633');
});
