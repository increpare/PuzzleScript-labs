import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as compiler from '../build/source-compiler.js';
import * as sourceTypes from '../build/source-model.js';
import * as model from '../build/model.js';
import * as sessionModel from '../build/session-model.js';
import * as session from '../build/session.js';
import * as turnRules from '../build/turn-rules.js';
import * as winConditions from '../build/win-conditions.js';
import * as commands from '../build/commands.js';
import * as ruleModel from '../build/rule-model.js';
import * as assets from '../build/source-assets.js';
import * as declarationModel from '../build/declaration-model.js';
import { ExecutionDiagnosticKind } from '../build/execution-model.js';
import { createSessionOracle } from './legacy-session-oracle.cjs';
import { movementSource } from './scenarios.mjs';

const oracle = createSessionOracle({ ...compiler, ...sourceTypes, ...model, ...sessionModel, ...session,
  ...turnRules, ...winConditions, ...commands, ...ruleModel, ...assets, ...declarationModel, ExecutionDiagnosticKind });
const seed = 'frontend-0';
const localPropertySource = readFileSync(new URL('../../src/tests/semantic-fixtures/interaction-matching/local-property-overlap.ps', import.meta.url), 'utf8');

function compile(source) {
  const result = compiler.compileSource(source);
  assert.equal(result.outcome.kind, compiler.SourceCompilationKind.Accepted,
    result.rawDiagnostics.map(issue => issue.message).join('\n'));
  return result.outcome.game;
}

function withEarlyRules(game, transform) {
  assert.equal(game.earlyRules.groups.length, 1);
  const group = game.earlyRules.groups[0];
  assert.equal(group.rules.length, 1);
  return { ...game, earlyRules: { ...game.earlyRules, groups: [{ ...group, rules: transform(group.rules) }] } };
}

const glyphs = new Map([
  ['', '.'], ['player', 'P'], ['crate', 'C'], ['wall', '#'], ['red', 'r'], ['blue', 'b'],
  ['mark,red', 'R'], ['blue,mark', 'B'],
]);
function boardAfter(game, input, level = 0) {
  const environment = { nextLevelSeed: () => seed };
  const initial = session.createSession(game, { seed, level, runMode: sessionModel.RunMode.Replay }, environment);
  const result = session.stepSession(game, initial.state, input, environment);
  return result.state.execution.board.rows.map(row => row.map(cell => {
    assert.ok([...cell.objects].some(object => object.name === 'background'));
    const names = [...cell.objects].map(object => object.name).filter(name => name !== 'background').sort().join(',');
    assert.ok(glyphs.has(names), 'unexpected cell members: ' + names);
    return glyphs.get(names);
  }).join(''));
}

const fixtures = [
  {
    name: 'duplicate candidates change seeded random selection',
    source: movementSource({ rules: 'random right right [ > Player ] -> [ Crate ]', level: 'PP..' }),
    input: model.Movement.Right, expected: ['C.P.'], counterfactual: ['PC..'],
    withoutBehavior: game => withEarlyRules(game, rules => [...rules, ...rules]),
  },
  {
    name: 'Up row normalization assigns random draws in execution order',
    source: movementSource({ rules: 'up [ Player | Player ] -> [ random Choice | random Choice ]', level: 'P\nP' })
      .replace('C = Crate', 'C = Crate\nChoice = Crate or Wall'),
    input: model.Movement.Action, expected: ['C', '#'], counterfactual: ['#', 'C'],
    withoutBehavior: game => withEarlyRules(game, rules => rules.map(rule => {
      assert.equal(rule.direction, model.Direction.Down);
      return { ...rule, direction: model.Direction.Up,
        rows: rule.rows.map(row => [...row].reverse()), replacements: rule.replacements.map(row => [...row].reverse()) };
    })),
  },
  {
    name: 'the retained nondirectional selector determines random match traversal',
    source: movementSource({ rules: 'random [ Player ] -> [ Crate ]', level: 'PP\nPP' }),
    input: model.Movement.Action, expected: ['PP', 'CP'], counterfactual: ['PC', 'PP'],
    withoutBehavior: game => withEarlyRules(game, rules => rules.map(rule => {
      assert.equal(rule.direction, model.Direction.Down);
      // Without first-selector collapse, equal one-cell variants keep the last
      // selector during duplicate normalization: Right, whose traversal differs.
      return { ...rule, direction: model.Direction.Right };
    })),
  },
  {
    name: 'one local property predicate preserves live overlap order',
    source: localPropertySource, level: 1, input: null, expected: ['B.bP'], counterfactual: ['bR.P'],
    withoutBehavior: game => withEarlyRules(game, rules => {
      const rule = rules[0];
      assert.equal(rule.rows.length, 1);
      assert.equal(rule.rows[0].length, 2);
      const members = game.collisionLayers[2];
      assert.deepEqual(members.map(object => object.name), ['red', 'blue']);
      // Split the two independent local predicates into ordered concrete cases.
      // Edits still keep the left member and remove the right member.
      return members.flatMap(left => members.map(right => ({ ...rule,
        rows: rule.rows.map(row => row.map((cell, index) => {
          assert.equal(cell.anyObjects.length, 1);
          return { ...cell, anyObjects: [new Set([index === 0 ? left : right])] };
        })),
      })));
    }),
  },
];

for (const fixture of fixtures) {
  test('native transformation witness: ' + fixture.name, () => {
    const report = oracle.compareFixture({ ...fixture, seed, inputs: [fixture.input === null ? 'tick' : fixture.input] });
    assert.equal(report.snapshots, 2);
    assert.deepEqual(boardAfter(compile(fixture.source), fixture.input, fixture.level), fixture.expected);
  });

  test('counterfactual transformation witness: ' + fixture.name, () => {
    // Experimental game graphs are never used as oracle candidates or expected
    // native data. The baseline source is validated independently above.
    const game = compile(fixture.source);
    const changed = fixture.withoutBehavior(game);
    assert.deepEqual(boardAfter(game, fixture.input, fixture.level), fixture.expected);
    assert.deepEqual(boardAfter(changed, fixture.input, fixture.level), fixture.counterfactual);
    assert.notDeepEqual(fixture.counterfactual, fixture.expected);
  });
}
