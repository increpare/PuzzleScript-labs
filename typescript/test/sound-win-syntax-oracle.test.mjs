import test from 'node:test';
import { readSource } from '../build/source-reader.js';
import { resolveDeclarations } from '../build/declarations.js';
import { compileGameData } from '../build/source-game-data.js';
import * as model from '../build/model.js';
import * as sessionModel from '../build/session-model.js';
import * as turnRules from '../build/turn-rules.js';
import * as winConditions from '../build/win-conditions.js';
import * as sourceTypes from '../build/source-model.js';
import * as compiler from '../build/source-compiler.js';
import * as commands from '../build/commands.js';
import * as ruleModel from '../build/rule-model.js';
import * as assets from '../build/source-assets.js';
import * as declarationModel from '../build/declaration-model.js';
import { createGameDataOracle } from './legacy-game-data-oracle.cjs';
import { createSourceCompilerOracle } from './legacy-source-compiler.cjs';
import { movementSource } from './scenarios.mjs';

const types = { readSource, resolveDeclarations, compileGameData, ...model, ...sessionModel, ...turnRules,
  ...winConditions, ...sourceTypes, ...compiler, ...commands, ...ruleModel, ...assets, ...declarationModel };
const compilerOracle = createSourceCompilerOracle(types);
const oracle = createGameDataOracle(types, { nativeAlreadyLoaded: true });
const cases = [
  ['event sound consumes a midline heading word', movementSource({ sounds: 'sfx0 sounds 123' })],
  ['object sound consumes a midline heading word', movementSource({ sounds: 'Player move rules 123' })],
  ['retained event sound is not reclassified as a heading after a leading close', movementSource({ sounds: ') sounds sfx0 123' })],
  ['retained object sound keeps its section after a leading close', movementSource({ sounds: ') rules Player move 123' })],
  ['win capture stops at the first opening comment', movementSource().replace('winconditions\n', 'winconditions\nall Player (c) on Crate\n')],
  ['win capture starts at the native unanchored fragment', movementSource().replace('winconditions\n', 'winconditions\n(c)all Player on Crate\n')],
  ['event seeds retain their spelling', movementSource({ sounds: 'sfx0 000123\nstartlevel 000456' })],
  ['bare event and target heads remain incomplete definitions', movementSource({ sounds: 'sfx0\nPlayer' })],
  ['a retained verb without a seed uses its final term for recovery', movementSource({ sounds: 'Player move' })],
  ['a retained direction without a seed is excluded from effective directions', movementSource({ sounds: 'Player move up left' })],
  ['a terminal unmatched close prevents an otherwise complete sound registration', movementSource({ sounds: 'Player move 123 )' })],
  ['a later EOL visit after an unmatched close retains the sound', movementSource({ sounds: 'Player move 123 ) ' })],
  ['event ASCII boundaries reject a Unicode suffix', movementSource({ sounds: 'sfx0é 123' })],
  ['a comment after ON truncates the captured target', movementSource().replace('winconditions\n', 'winconditions\nall Player on (c)Crate\n')],
  ['a comment before the subject retains the missing-subject recovery', movementSource().replace('winconditions\n', 'winconditions\nall (c)Player on Crate\n')],
  ['four captured words use a named target even with a malformed ON', movementSource().replace('winconditions\n', 'winconditions\nall Player nonsense Crate\n')],
  ['an extra captured word recovers to an everywhere target', movementSource().replace('winconditions\n', 'winconditions\nall Player on Crate extra\n')],
];
for (const [name, source] of cases) {
  test('accepted sound/win syntax: ' + name, () => oracle.compareFixture({ name, source }));
}

for (const [name, source] of cases) {
  test('complete source compilation preserves sound/win capture: ' + name,
    () => compilerOracle.compareFixture({ name, source }));
}
