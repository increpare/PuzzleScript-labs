import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSource } from '../build/source-reader.js';
import { resolveDeclarations } from '../build/declarations.js';
import { compileGameData } from '../build/source-game-data.js';
import { Movement } from '../build/model.js';
import { LevelKind, SimpleSound } from '../build/session-model.js';
import { PlayerMatchKind } from '../build/turn-rules.js';
import { ObjectMatchKind, WinQuantifier, hasWon } from '../build/win-conditions.js';
import { SourceLegendKind } from '../build/source-model.js';
import { recoverLegendExpression } from '../build/source-legend.js';
import { createGameDataOracle } from './legacy-game-data-oracle.cjs';
import { buildParserStateSnapshot, collectParserPhaseDiagnostics } from './support/parser-snapshot.cjs';

// The pinned native host is loaded once by this oracle for the entire file.
const oracle = createGameDataOracle({ readSource, resolveDeclarations, compileGameData,
  Movement, LevelKind, SimpleSound, PlayerMatchKind, ObjectMatchKind, WinQuantifier, hasWon });
const reproduction = readFileSync(new URL('./repros/legend-unicode-expansion.puzzlescript', import.meta.url), 'utf8');

function sourceWithLegend(legend, objects = '') {
  return reproduction.replace('X = İ or Crate', legend).replace('Crate C\nblue', 'Crate C\nblue' + objects);
}

function freezeSource(value, source) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  if ('spelling' in value) {
    assert.equal(value.normalized, value.spelling.toLowerCase());
    assert.equal(source.slice(value.span.start.offset, value.span.end.offset), value.spelling);
  }
  for (const item of Object.values(value)) freezeSource(item, source);
  Object.freeze(value);
}

test('native lowercase expansion ends a legend RHS name at the generated combining mark', () => {
  oracle.compareFixture({ name: 'legend lowercase expansion', source: reproduction });
  const { document } = readSource(reproduction);
  const { declarations } = resolveDeclarations(document);
  assert.equal(declarations.names.get('x').object, declarations.names.get('i').object);
  const result = compileGameData(document, declarations);
  assert.deepEqual([...result.data.levels[0].board.rows[0][0].objects].map(object => object.name).sort(), ['background', 'i']);
});

test('a partial lowercase expansion points to the complete unchanged authored word', () => {
  const source = sourceWithLegend('(İ 😀) X = İ or Crate');
  oracle.compareFixture({ name: 'authored expansion spans', source });
  const { document } = readSource(source);
  const legend = document.legend[0];
  assert.deepEqual(legend.words.map(word => word.spelling), ['X', '=', 'İ', 'or', 'Crate']);
  assert.deepEqual(legend.definitionWords.map(token => token.value), ['x', '=', 'i']);
  const token = legend.definitionWords[2];
  assert.equal(token.word, legend.words[2]);
  assert.equal(token.word.spelling, 'İ');
  assert.equal(token.word.normalized, 'i\u0307');
  const offset = source.indexOf('İ or Crate');
  assert.equal(token.word.span.start.offset, offset);
  assert.equal(token.word.span.end.offset, offset + 1);
  assert.equal(token.word.span.start.column, '(İ 😀) X = '.length + 1);
  assert.equal(document.comments[0].span.end.offset - document.comments[0].span.start.offset, '(İ 😀)'.length);
  const before = structuredClone(document);
  freezeSource(document, source);
  const expression = recoverLegendExpression(legend);
  assert.equal(expression.kind, SourceLegendKind.Synonym);
  assert.equal(expression.references[0], token);
  const { declarations } = resolveDeclarations(document);
  assert.equal(declarations.names.get('x').word, legend.name);
  assert.equal(declarations.names.get('x').source, legend);
  assert.equal(declarations.firstDeclarationWords.get('x'), legend.name);
  compileGameData(document, declarations);
  assert.deepEqual(document, before);
});

test('lowercase expansion preserves native bad-prefix discard and comment resumption', () => {
  for (const [legend, kind, values] of [
    ['X = Aİ! or Crate', SourceLegendKind.Synonym, ['ai']],
    ['X = İ! (comment) or Crate', SourceLegendKind.Property, ['i', 'crate']],
    ['X = İ (nested (İ 😀)) or Crate!', SourceLegendKind.Property, ['i', 'crate']],
    ['X = İ! (comment) and Crate', SourceLegendKind.Aggregate, ['i', 'crate']],
  ]) {
    const source = sourceWithLegend(legend, '\n\nAi\nyellow').replace('Player, I, Crate', 'Player, I, Crate\nAi');
    oracle.compareFixture({ name: legend, source });
    const expression = recoverLegendExpression(readSource(source).document.legend[0]);
    assert.equal(expression.kind, kind, legend);
    assert.deepEqual(expression.references.map(token => token.value), values, legend);
    const native = buildParserStateSnapshot(source).parser_state;
    const entries = kind === SourceLegendKind.Synonym ? native.legend_synonyms
      : kind === SourceLegendKind.Property ? native.legend_properties : native.legend_aggregates;
    assert.deepEqual(entries.find(entry => entry.name === 'x').items, values, legend);
  }
});

test('Greek sigma uses physical-line context even when a name ends before a case-ignorable mark', () => {
  for (const [legend, expected, spelling] of [
    ["X = ΟΣ'Α or Crate", 'οσ', 'ΟΣ'],
    ['X = ΟΣ\u0301Α or Crate', 'οσ', 'ΟΣ'],
    ['X = ΟΣ or Crate', 'ος', 'ΟΣ'],
    ['X = ΟΣ(Α) or Crate', 'ος', 'ΟΣ'],
  ]) {
    const source = sourceWithLegend(legend, '\n\nοσ\nyellow\n\nος\ngreen')
      .replace('Player, I, Crate', 'Player, I, Crate\nοσ, ος');
    oracle.compareFixture({ name: legend, source });
    const { document } = readSource(source);
    const expression = recoverLegendExpression(document.legend[0]);
    const token = expression.references[0];
    assert.equal(token.value, expected, legend);
    assert.equal(token.word.spelling, spelling, legend);
    assert.equal(token.word.normalized, spelling.toLowerCase(), legend);
    assert.equal(source.slice(token.word.span.start.offset, token.word.span.end.offset), spelling, legend);
  }
});

test('Unicode aliases and astral names retain their authored values and UTF-16 spans', () => {
  const source = sourceWithLegend('(İ) X = 𐐀', '\n\n𐐀 K\nyellow')
    .replace('I\nred', 'I İ\nred').replace('Player, I, Crate', 'Player, I, Crate\n𐐀');
  oracle.compareFixture({ name: 'Unicode alias and astral spans', source });
  const { document } = readSource(source);
  freezeSource(document, source);
  const { declarations } = resolveDeclarations(document);
  const letter = document.legend[0].definitionWords[2];
  assert.equal(letter.word.spelling, '𐐀');
  assert.equal(letter.value, '𐐨');
  assert.equal(letter.word.span.end.offset - letter.word.span.start.offset, 2);
  assert.equal(letter.word, document.legend[0].words[2]);
  assert.equal(declarations.names.get('x').object, declarations.names.get('𐐨').object);
  assert.equal(declarations.names.get('k').word.spelling, 'K');
  assert.equal(declarations.names.get('i\u0307').word.spelling, 'İ');
});

test('an undefined normalized lexical name diagnoses its original expanded source word', () => {
  const source = sourceWithLegend('X = Aİ or Crate');
  const { document } = readSource(source);
  const { diagnostics } = resolveDeclarations(document);
  const problem = diagnostics.find(diagnostic => diagnostic.code === 'undefined-reference');
  const word = document.legend[0].definitionWords[2].word;
  assert.equal(word.spelling, 'Aİ');
  assert.equal(word.normalized, 'ai\u0307');
  assert.equal(problem.span, word.span);
  assert.match(problem.message, /Aİ/);
});

test('a discarded expanded self-reference still diagnoses the authored word', () => {
  const source = sourceWithLegend('I = İ');
  assert.ok(collectParserPhaseDiagnostics(source).some(message => /itself/u.test(message)));
  const { document } = readSource(source);
  const { diagnostics } = resolveDeclarations(document);
  const word = document.legend[0].definitionWords[2].word;
  assert.equal(recoverLegendExpression(document.legend[0]), null);
  assert.equal(word.normalized, 'i\u0307');
  assert.equal(diagnostics.find(problem => problem.code === 'self-reference')?.span, word.span);
});
