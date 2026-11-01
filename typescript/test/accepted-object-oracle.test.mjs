import assert from 'node:assert/strict';
import test from 'node:test';
import { createSourceCompilerOracle } from './legacy-source-compiler.cjs';
import { movementSource } from './scenarios.mjs';

const modules = await Promise.all(['source-compiler', 'source-model', 'model', 'session-model',
  'turn-rules', 'win-conditions', 'commands', 'rule-model', 'source-assets', 'declaration-model']
  .map(name => import('../build/' + name + '.js')));
const types = Object.assign({}, ...modules);
const oracle = createSourceCompilerOracle(types);

for (const [name, extra] of [
  ['accepted primary retained as an authored color word', '.Bad !\nBlue'],
  ['accepted owner receives aliases and colors from a rejected header', '.Bad !\nBlue\n\nPlayer Extra\nGreen'],
  ['several accepted objects inside one authored group retain separate assets', '.Bad !\nBlue\n00000\nWhite\nRed'],
  ['a concrete object after an earlier alias has its own diagnostic line', 'X'],
]) {
  test('accepted object provenance: ' + name, () => {
    let source = movementSource({ rules: '[ Player ] -> [ Player ]' })
      .replace('\nlegend\n', '\n' + extra + '\n\nlegend\n');
    source = extra === 'X' ? source.replace('Wall\nblue', 'Wall X\nblue')
      .replace('Player, Crate, Wall', 'Player, Crate, Wall, X')
      : source.replace('Player, Crate, Wall', extra.includes('White')
        ? 'Player, Crate, Wall\nBlue\nWhite' : 'Player, Crate, Wall, Blue');
    oracle.compareFixture({ name, source });
  });
}

test('an inline comment after a completed sprite gives aliases and another color to the same object', () => {
  const source = `OBJECTS
Background .
black

Player P
white
00000
00000
00000
00000
00000 (c) Extra E
blue

LEGEND
SOUNDS
COLLISIONLAYERS
Background
Player
RULES
[ Player ] -> [ Player ]
WINCONDITIONS
LEVELS
P.`;
  const { result } = oracle.compareFixture({ name: 'sprite inline comment preserves alias owner', source });
  assert.equal(result.errorCount, 0);
  const { declarations, sprites } = result.outcome;
  const player = declarations.names.get('player').object;
  assert.equal(declarations.names.get('extra').object, player);
  assert.equal(declarations.names.get('e').object, player);
  assert.equal(sprites.get(player).colors.length, 2);
  assert.equal(declarations.objects.length, 2);
});

test('the oracle rejects substituting a raw container primary for the accepted object name', () => {
  const source = movementSource({ rules: '[ Player ] -> [ Player ]' })
    .replace('\nlegend\n', '\n.Bad !\nBlue\n\nlegend\n')
    .replace('Player, Crate, Wall', 'Player, Crate, Wall, Blue');
  assert.throws(() => oracle.compareFixture({ name: 'corrupt accepted object origin', source }, {
    compileSource: source => {
      const result = types.compileSource(source);
      const declarations = result.outcome.declarations;
      const blue = declarations.names.get('blue');
      declarations.names.set('blue', { ...blue, word: blue.source.primaryName });
      return result;
    },
  }), /name provenance/);
});
