import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from '../build/source-reader.js';
import { resolveDeclarations } from '../build/declarations.js';
import { compileGameData } from '../build/source-game-data.js';
import * as sourceTypes from '../build/source-model.js';
import { ResolvedNameKind } from '../build/declaration-model.js';
import { Movement } from '../build/model.js';
import { LevelKind, SimpleSound } from '../build/session-model.js';
import { PlayerMatchKind } from '../build/turn-rules.js';
import { ObjectMatchKind, WinQuantifier, hasWon } from '../build/win-conditions.js';
import { CommandKind } from '../build/commands.js';
import * as syntax from '../build/rule-syntax.js';
import { RuleQualifier } from '../build/source-rule-model.js';
import { createSourceOracle } from './legacy-source-oracle.cjs';
import { createDeclarationOracle } from './legacy-declaration-oracle.cjs';
import { createGameDataOracle } from './legacy-game-data-oracle.cjs';
import { createRuleSyntaxOracle } from './legacy-rule-syntax.cjs';
import { movementSource } from './scenarios.mjs';

const types = { readSource, resolveDeclarations, compileGameData, ...sourceTypes,
  ResolvedNameKind, Movement, LevelKind, SimpleSound, PlayerMatchKind, ObjectMatchKind, WinQuantifier, hasWon,
  CommandKind, ...syntax };
const sourceOracle = createSourceOracle(types);
// One pinned host supplies every projection; native lexical globals cannot be
// redeclared. Each adapter still disables its producers during candidate work.
const declarationOracle = createDeclarationOracle(types, { nativeAlreadyLoaded: true });
const gameDataOracle = createGameDataOracle(types, { nativeAlreadyLoaded: true });
const syntaxOracle = createRuleSyntaxOracle(types, { nativeAlreadyLoaded: true });

// Ordinary rules, legend references and map glyphs use ASCII aliases so each
// fixture isolates object/layer declaration lexing from later language stages.
function objectSource(header, layer = 'Player') {
  return movementSource({ rules: '[ Player ] -> [ Player ]' })
    .replace('\nPlayer\nwhite', '\n' + header + '\nwhite')
    .replace('Player, Crate, Wall', layer + ', Crate, Wall');
}

function compare(source, name) {
  const fixture = { name, source };
  declarationOracle.compareFixture(fixture);
  sourceOracle.compareFixture(fixture);
  gameDataOracle.compareFixture(fixture);
  syntaxOracle.compareFixture(fixture);
}

test('native object primary expansion creates i and a separate generated combining-dot alias', () => {
  const source = objectSource('İ Player', 'İ');
  compare(source, 'dotted I object primary');
  const { document } = readSource(source);
  const { declarations } = resolveDeclarations(document);
  assert.deepEqual(document.objects[1].definitionNames.map(token => token.value), ['i', '\u0307', 'player']);
  assert.equal(declarations.names.has('i\u0307'), false);
  assert.equal(declarations.names.get('\u0307').object, declarations.names.get('i').object);
});

test('native object primary sigma uses casing context beyond its lexical prefix', () => {
  const source = objectSource("ΟΣ'Α Player", "ΟΣ'Α");
  compare(source, 'Greek object primary context');
  const { document } = readSource(source);
  const { declarations } = resolveDeclarations(document);
  assert.equal(document.objects[1].primaryName.normalized, 'ος');
  assert.equal(document.objects[1].definitionNames[0].value, 'οσ');
  assert.equal(declarations.objects[1].name, 'οσ');
  assert.equal(declarations.firstDeclarationWords.get('οσ'), document.objects[1].primaryName);
  const layer = document.collisionLayers[1];
  assert.equal(layer.names[0].normalized, 'ος');
  assert.equal(layer.definitionNames[0].value, 'οσ');
  assert.equal(layer.definitionNames[0].word, layer.names[0]);
});

for (const header of ['𐐀 Player K', '(leading 😀) İ Player (trailing)',
  "(leading) ΟΣ'Α Player (trailing)", 'ΟΣ(Α) Player', 'İ! Player', 'Aİ Player']) {
  test('native object and alias boundaries preserve authored evidence: ' + header, () => {
    const source = objectSource(header);
    compare(source, header);
    const { document } = readSource(source);
    const object = document.objects[1];
    assert.equal(object.nameLine.original, header);
    const authored = [object.primaryName, ...object.aliases];
    for (const token of object.definitionNames) {
      assert.equal(token.word.normalized, token.word.spelling.toLowerCase());
      assert.equal(source.slice(token.word.span.start.offset, token.word.span.end.offset), token.word.spelling);
      const matching = authored.find(word => word.span.start.offset === token.word.span.start.offset && word.span.end.offset === token.word.span.end.offset);
      if (matching !== undefined) assert.equal(token.word, matching);
    }
    if (header.startsWith('𐐀')) {
      assert.equal(object.definitionNames[0].value, '𐐨');
      assert.equal(object.definitionNames[0].word.span.end.offset - object.definitionNames[0].word.span.start.offset, 2);
    }
  });
}

test('an authored dotted-I alias keeps its full lexical value after a stable primary', () => {
  const source = objectSource('𐐀 Player İ');
  compare(source, 'authored expanded alias');
  const { document } = readSource(source);
  const { declarations } = resolveDeclarations(document);
  assert.deepEqual(document.objects[1].definitionNames.map(token => token.value), ['𐐨', 'player', 'i\u0307']);
  assert.equal(document.objects[1].definitionNames[2].word, document.objects[1].aliases[1]);
  assert.equal(declarations.names.get('i\u0307').object, declarations.objects[1]);
  assert.equal(declarations.names.has('\u0307'), false);
});

test('expanded primary and generated alias reuse one unchanged authored word', () => {
  const source = objectSource('(😀) İ Player (comment)', 'İ');
  compare(source, 'expanded primary authored identity');
  const { document } = readSource(source);
  const object = document.objects[1];
  const layer = document.collisionLayers[1];
  assert.equal(object.primaryName.spelling, 'İ');
  assert.equal(object.primaryName.normalized, 'i\u0307');
  assert.deepEqual(object.aliases.map(word => word.spelling), ['Player']);
  assert.equal(object.definitionNames[0].word, object.primaryName);
  assert.equal(object.definitionNames[1].word, object.primaryName);
  assert.equal(object.definitionNames[2].word, object.aliases[0]);
  assert.equal(object.primaryName.span.start.column, '(😀) '.length + 1);
  assert.equal(layer.names[0].normalized, 'i\u0307');
  assert.equal(layer.definitionNames[0].value, 'i');
  assert.equal(layer.definitionNames[0].word, layer.names[0]);
  const before = structuredClone(document);
  function freeze(value) {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  freeze(document);
  const { declarations } = resolveDeclarations(document);
  assert.equal(declarations.firstDeclarationWords.get('i'), object.primaryName);
  assert.equal(declarations.firstDeclarationWords.get('\u0307'), object.primaryName);
  assert.equal(declarations.names.get('i').word, object.primaryName);
  assert.equal(declarations.names.get('\u0307').word, object.primaryName);
  assert.equal(declarations.names.get('player').word, object.aliases[0]);
  assert.equal(declarations.objectSources.get(declarations.objects[1]), object);
  compileGameData(document, declarations);
  assert.deepEqual(document, before);
});

test('layer scanning continues after an expanded combining mark and keeps final ownership', () => {
  const source = objectSource('İ Player')
    .replace('Player, Crate, Wall', '(lead) İCrate, Wall (tail)\nPlayer, İ, Player');
  compare(source, 'expanded layer runs and repeated assignments');
  const { document } = readSource(source);
  const layer = document.collisionLayers[1];
  assert.deepEqual(layer.names.map(word => word.spelling), ['İCrate', 'Wall']);
  assert.deepEqual(layer.definitionNames.map(token => token.value), ['i', 'crate', 'wall']);
  assert.equal(layer.definitionNames[0].word.spelling, 'İ');
  assert.equal(layer.definitionNames[0].word.normalized, 'i\u0307');
  assert.equal(layer.definitionNames[1].word.spelling, 'Crate');
  const { declarations, diagnostics } = resolveDeclarations(document);
  assert.deepEqual(declarations.collisionLayers.map(layer => layer.map(object => object.name)), [['background'], ['crate', 'wall'], ['i']]);
  assert.equal(declarations.objectLayers.get(declarations.objects[1]), 2);
  assert.ok(diagnostics.some(issue => issue.code === 'multiple-layers'));
  assert.ok(diagnostics.some(issue => issue.code === 'repeated-layer-name'));
});

test('an unknown expanded layer name diagnoses the complete authored code point', () => {
  const source = objectSource('İ Player', 'Aİ');
  compare(source, 'unknown expanded layer name');
  const { document } = readSource(source);
  const token = document.collisionLayers[1].definitionNames[0];
  assert.equal(token.value, 'ai');
  assert.equal(token.word.normalized, 'ai\u0307');
  assert.equal(token.word, document.collisionLayers[1].names[0]);
  const { diagnostics } = resolveDeclarations(document);
  const issue = diagnostics.find(issue => issue.code === 'undefined-layer-name');
  assert.equal(issue.span, token.word.span);
  assert.match(issue.message, /Aİ/);
});

test('native duplicate concrete-name recovery still attaches aliases to the previous object', () => {
  const source = objectSource('İ Player').replace('\nWall\nblue', '\nI Extra\nblue');
  const fixture = { name: 'expanded primary duplicate recovery', source };
  // The authored AST retains both attempts; source preservation checks their
  // spans while the declaration and game-data oracles compare native recovery.
  sourceOracle.checkPreservation(fixture);
  declarationOracle.compareFixture(fixture);
  gameDataOracle.compareFixture(fixture);
  syntaxOracle.compareFixture(fixture);
  const { document } = readSource(source);
  const { declarations, diagnostics } = resolveDeclarations(document);
  assert.deepEqual(declarations.objects.map(object => object.name), ['background', 'i', 'crate']);
  assert.equal(declarations.names.get('extra').object, declarations.names.get('crate').object);
  assert.equal(diagnostics.find(issue => issue.code === 'duplicate-object').span, document.objects[3].primaryName.span);
});

test('a dotted-I map cell expands to native width using the generated alias', () => {
  const source = objectSource('İ Player', 'İ').replace('\nPC.\n', '\nİ\n');
  compare(source, 'literal dotted-I map expansion');
  const { document } = readSource(source);
  const { declarations } = resolveDeclarations(document);
  const { data } = compileGameData(document, declarations);
  assert.equal(data.levels[0].board.width, 2);
  assert.deepEqual(data.levels[0].board.rows[0].map(cell => [...cell.objects].map(object => object.name).sort()),
    [['background', 'i'], ['background', 'i']]);
});

test('the reported renamed movement rule retains native pending-qualifier recovery', () => {
  const source = movementSource({ rules: '[ > Player | ^ Crate | v Wall ] -> [ Player | Crate | Wall ]' })
    .replaceAll('Player', 'İ').replaceAll('Crate', '𐐀').replaceAll('Wall', 'ΟΣ');
  compare(source, 'reported full Unicode rule renaming');
  const { document, result } = syntaxOracle.compareFixture({ name: 'pending dotted-I recovery', source });
  const { declarations } = resolveDeclarations(document);
  assert.equal(declarations.firstDeclarationWords.has('i\u0307'), false);
  assert.equal(declarations.firstDeclarationWords.get('i'), document.objects[1].primaryName);
  assert.equal(result.abortsCompilation, true);
  assert.deepEqual(result.rules[0].lhs[0].map(cell => cell.map(term => [term.qualifier, term.name])),
    [[[RuleQualifier.Forward, '𐐨']], [[RuleQualifier.Clockwise, 'ος']]]);
  assert.deepEqual(result.rules[0].rhs[0].map(cell => cell.map(term => term.name)), [[], ['𐐨'], ['ος']]);
  assert.deepEqual(result.diagnostics.map(issue => issue.code),
    ['unknown-rule-token', 'unfinished-movement', 'multiple-rule-qualifiers', 'unknown-rule-token', 'unequal-rule-cell-count']);
});

for (const [label, corrupt] of [
  ['lookalike canonical object', (document, declarations) => {
    const names = new Map(declarations.names);
    const meaning = names.get('i');
    names.set('i', { ...meaning, object: { ...meaning.object } });
    return { ...declarations, names };
  }],
  ['wrong authored alias', (document, declarations) => {
    const names = new Map(declarations.names);
    names.set('i', { ...names.get('i'), word: document.objects[1].aliases[0] });
    return { ...declarations, names };
  }],
  ['cloned expanded source word', (document, declarations) => {
    const names = new Map(declarations.names);
    names.set('\u0307', { ...names.get('\u0307'), word: { ...names.get('\u0307').word } });
    return { ...declarations, names };
  }],
]) test('Unicode declaration oracle rejects ' + label, () => {
  const fixture = { name: label, source: objectSource('İ Player') };
  assert.throws(() => declarationOracle.compareFixture(fixture, { resolveDeclarations: document => {
    const result = resolveDeclarations(document);
    return { ...result, declarations: corrupt(document, result.declarations) };
  } }), /canonical identity|name provenance/);
});

test('canonical object provenance cannot substitute an authored normalization for the lexical primary', () => {
  const fixture = { name: 'wrong canonical lexical primary', source: objectSource("ΟΣ'Α Player") };
  assert.throws(() => declarationOracle.compareFixture(fixture, { resolveDeclarations: document => {
    const result = resolveDeclarations(document);
    const objects = result.declarations.objects.map(object => object.name === 'οσ' ? Object.freeze({ name: 'ος' }) : object);
    const objectSources = new Map(objects.map((object, index) => [object, document.objects[index]]));
    return { ...result, declarations: { ...result.declarations, objects, objectSources } };
  } }), /canonical object source name/);
});

test('effective token provenance must attach the same word to the correct lexical value', () => {
  const fixture = { name: 'wrong token value for authored evidence', source: objectSource('İ Player') };
  assert.throws(() => declarationOracle.compareFixture(fixture, { readSource: source => {
    const { document, diagnostics } = readSource(source);
    const objects = document.objects.map((object, index) => index === 1 ? { ...object,
      definitionNames: object.definitionNames.map((token, tokenIndex) => tokenIndex === 1 ? { ...token, value: 'other' } : token),
    } : object);
    return { diagnostics, document: { ...document, objects } };
  }, resolveDeclarations: document => {
    const result = resolveDeclarations(document);
    // The source and exact expanded word remain correct, but no source token
    // carries this claimed lexical value. Matching only the word would miss it.
    const names = new Map(result.declarations.names);
    names.set('\u0307', { ...names.get('other'), name: '\u0307' });
    names.delete('other');
    return { ...result, declarations: { ...result.declarations, names } };
  } }), /name provenance/);
});

test('authored normalization cannot be replaced with its different effective lexical value', () => {
  const fixture = { name: 'corrupt authored normalization', source: objectSource('İ Player') };
  assert.throws(() => sourceOracle.checkPreservation(fixture, { readSource: source => {
    const result = readSource(source);
    const objects = result.document.objects.map((object, index) => index === 1 ? {
      ...object, primaryName: { ...object.primaryName, normalized: object.definitionNames[0].value },
    } : object);
    return { ...result, document: { ...result.document, objects } };
  } }), /normalized source word/);
});

test('shared native-host oracle factories keep candidate producer guards active', () => {
  const fixture = { name: 'shared host producer guards', source: objectSource('İ Player') };
  for (const oracle of [sourceOracle, declarationOracle, syntaxOracle]) {
    assert.throws(() => oracle.compareFixture(fixture, { readSource: source => {
      globalThis.loadFile(source);
      return readSource(source);
    } }), /called (?:JS producer |native )loadFile/);
  }
  assert.throws(() => gameDataOracle.compareFixture(fixture, { resolveDeclarations: document => {
    globalThis.generateMasks({});
    return resolveDeclarations(document);
  } }), /called JS producer generateMasks/);
});
