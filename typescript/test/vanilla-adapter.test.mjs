import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPuzzleScript } from './native-host.cjs';
import { decodeSessionGame } from './legacy-session-data.cjs';
import { movementSource } from './scenarios.mjs';
import * as model from '../build/model.js';
import * as rules from '../build/rule-model.js';
import * as commands from '../build/commands.js';
import * as turns from '../build/turn-rules.js';
import * as sessions from '../build/session-model.js';
import * as wins from '../build/win-conditions.js';

loadPuzzleScript({ includeTests: true });
const types = { ...model, ...rules, ...commands, ...turns, ...sessions, ...wins };
function nativeGame() {
  resetParserErrorState();
  compile(['loadLevel', 0], movementSource() + '\n', 'vanilla-adapter');
  return state;
}

test('the vanilla adapter decodes every compiled rule field without labs extensions', () => {
  const decoded = decodeSessionGame(nativeGame(), types);
  assert.ok(decoded.game.earlyRules.groups.length > 0);
});

for (const [name, target, field] of [
  ['cell predicate', game => game.rules[0][0].patterns[0][0], 'anyMovementsPresent'],
  ['replacement', game => game.rules[0][0].patterns[0][0].replacement, 'inferredPropertyBindings'],
  ['rule', game => game.rules[0][0], 'propertyBindingsArr'],
]) {
  test('the pinned vanilla adapter rejects an unsupported ' + name + ' field', () => {
    const game = nativeGame();
    target(game)[field] = [];
    assert.throws(() => decodeSessionGame(game, types), /Unsupported vanilla .* field/);
  });
}
