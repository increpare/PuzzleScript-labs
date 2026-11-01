import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from '../build/source-reader.js';
import { resolveDeclarations } from '../build/declarations.js';
import { ResolvedNameKind } from '../build/declaration-model.js';
import { PlayerMatchKind } from '../build/turn-rules.js';
import * as sourceTypes from '../build/source-model.js';
import * as parser from '../build/source-parser.js';
import { createSourceParserOracle } from './legacy-source-parser.cjs';
import { createDeclarationOracle } from './legacy-declaration-oracle.cjs';
import { movementSource } from './scenarios.mjs';

const parsing = createSourceParserOracle({ ...sourceTypes, ...parser });
const declarations = createDeclarationOracle({ readSource, resolveDeclarations, ResolvedNameKind, PlayerMatchKind },
  { nativeAlreadyLoaded: true });

function sourceWith(legend, layers = 'Player, Crate, Wall') {
  return movementSource({ rules: '[ Player ] -> [ Player ]' })
    .replace('C = Crate', 'C = Crate\n' + legend).replace('Player, Crate, Wall', layers);
}

const cases = [
  ['alias before a property with the same name', 'Shared = Player\nShared = Crate or Wall\nProbe = Shared or Crate'],
  ['alias before an aggregate with the same name', 'Shared = Player\nShared = Crate and Wall\nProbe = Shared or Crate'],
  ['aggregate before a property with the same name', 'Shared = Player and Crate\nShared = Player or Wall\nProbe = Shared or Wall'],
  ['property before a same-name alias', 'Shared = Player or Crate\nShared = Wall\nProbe = Shared or Crate'],
  ['nested repeated property members', 'First = Player or Crate\nSecond = First or Wall or First\nThird = Second or First or Second'],
  ['nested repeated aggregate members', 'First = Player and Crate\nSecond = First and Wall and First'],
  ['OR as a property name is not an operand self-reference', 'or = Player or Crate'],
  ['AND as an aggregate name is not an operand self-reference', 'and = Player and Crate'],
  ['property recovery discards aggregate members', 'Pair = Player and Crate\nSurvivor = Pair or Wall'],
  ['empty property recovery does not register a name', 'Pair = Player and Crate\nGone = Pair or Pair'],
  ['self removal changes the resulting declaration kind', 'Reduced = Reduced or Player and Crate'],
  ['self removal keeps repeated remaining members', 'Reduced = Player or Reduced or Crate or Player'],
  ['source-layer expansion keeps repeated occurrences', 'First = Player or Crate\nSecond = First or Player', 'Player\nSecond\nCrate'],
  ['aliases and compounds remain distinct in layers', 'Pair = Player and Crate\nAlias = Pair\nChoice = Player or Wall', 'Alias\nChoice\nCrate'],
];

for (const [name, legend, layers] of cases) {
  const fixture = { name: 'declaration boundary: ' + name, source: sourceWith(legend, layers) };
  test(name + ': native visits and final namespace remain distinct', () => {
    parsing.compareFixture(fixture);
    declarations.compareFixture(fixture);
  });
}

test('declaration existence diagnostics use compound precedence rather than alias expansion precedence', () => {
  const source = sourceWith('Shared = Player\nShared = Crate or Wall\nShared = Player and Crate\nShared = Wall');
  const { native } = parsing.compareFixture({ name: 'duplicate declaration precedence', source });
  const line = spelling => source.split('\n').indexOf(spelling) + 1;
  const conflicts = native.raw.filter(issue => issue.message.startsWith('Name "SHARED" already in use'));
  assert.equal(conflicts.length, 3);
  for (const [issue, previous] of conflicts.map((issue, index) => [issue, [
    'Shared = Player', 'Shared = Crate or Wall', 'Shared = Player and Crate',
  ][index]])) {
    assert.ok(issue.message.includes('jumpToLine(' + line(previous) + ')'), previous);
  }
});

for (const legend of ['Self = Self (tail)', 'Self = Self or Player (tail)',
  'Self = Player or Self and Crate (tail)', 'Self = Self (middle) or Player',
  'Self = Player (middle) or Self or Crate']) {
  test('comment reentry preserves mutable legend recovery: ' + legend, () => {
    parsing.compareFixture({ name: 'legend comment reentry: ' + legend, source: sourceWith(legend) });
  });
}

test('a diagnostic cap interrupts a legend before its next registration and vocabulary capture', () => {
  const source = 'OBJECTS\nPlayer\nWhite\nLEGEND\n'
    + Array.from({ length: 101 }, (_, index) => `Up${index} = Player or Player`).join('\n')
    + '\nAfter = Player\nSOUNDS\nRULES\n[ After ] -> [ After ]';
  const { result } = parsing.compareFixture({ name: 'legend registration interruption', source });
  assert.equal(result.outcome.kind, parser.SourceParserOutcomeKind.Stopped);
  assert.equal(result.outcome.reason, parser.SourceParserStopReason.Issues);
  assert.equal(result.diagnostics.length, 101);
  assert.ok(result.document.rules.length > 0, 'physical source remains available beyond the stopping cursor');
});
