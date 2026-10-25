'use strict';

const { createRuntimeOracle } = require('./legacy-oracle.cjs');
const { createSessionOracle } = require('./legacy-session-oracle.cjs');

async function main() {
  const { Direction, Movement } = await import('../build/model.js');
  const { resolveMovements } = await import('../build/movement.js');
  const { Ellipsis } = await import('../build/rule-model.js');
  const { findMatches, matchesRow } = await import('../build/matching.js');
  const { createRandom, nextRandom } = await import('../build/random.js');
  const { applyRules } = await import('../build/scheduling.js');
  const { CommandKind } = await import('../build/commands.js');
  const { applyTurnRules, PlayerMatchKind } = await import('../build/turn-rules.js');
  const piecesOnly = process.argv.includes('--pieces');
  const completeTurns = process.argv.includes('--turns');
  const completeSession = process.argv.includes('--session');
  if ([piecesOnly, completeTurns, completeSession].filter(Boolean).length > 1) {
    throw new Error('Choose one of --pieces, --turns or --session');
  }
  const oracle = completeSession ? createSessionOracle({
    Direction, Movement, Ellipsis, CommandKind, PlayerMatchKind,
    ...await import('../build/source-compiler.js'),
    ...await import('../build/source-model.js'),
    ...await import('../build/source-assets.js'),
    ...await import('../build/declaration-model.js'),
    ...await import('../build/execution-model.js'),
    ...await import('../build/win-conditions.js'),
    ...await import('../build/session-model.js'),
    ...await import('../build/session.js'),
  }) : createRuntimeOracle({
    Direction, Movement, Ellipsis, resolveMovements, findMatches, matchesRow,
    createRandom, nextRandom, CommandKind, PlayerMatchKind,
    ...(completeTurns ? { applyTurnRules } : {}), ...(piecesOnly ? {} : { applyRules }),
  });
  const filter = process.argv.slice(2).find(argument =>
    argument !== '--pieces' && argument !== '--turns' && argument !== '--session');
  const fixtures = oracle.corpusFixtures().filter((fixture) =>
    !filter || fixture.name.toLowerCase().includes(filter.toLowerCase()));
  if (fixtures.length === 0) throw new Error('No simulation fixtures match: ' + filter);
  const totals = completeSession ? { fixtures: 0, snapshots: 0, candidateOperations: 0, levelLoads: 0 }
    : { fixtures: 0, movementCalls: 0, snapshots: 0, rigidRetries: 0, levelLoads: 0,
    matchSearches: 0, matchRechecks: 0, randomDraws: 0, randomInitializations: 0, rulePhases: 0, turnPhases: 0 };
  for (const fixture of fixtures) {
    if (completeSession) console.log('Source-compiled session ' + (totals.fixtures + 1) + '/' + fixtures.length + ': ' + fixture.name);
    const report = oracle.compareFixture(fixture);
    totals.fixtures++;
    for (const key of Object.keys(report)) totals[key] += report[key];
    if (totals.fixtures % 50 === 0) {
      console.log('Compared ' + totals.fixtures + '/' + fixtures.length + ' fixtures');
    }
  }
  console.log('JS/TypeScript ' + (completeSession ? 'source-compiled session' : piecesOnly ? 'runtime pieces'
    : completeTurns ? 'turn rule pipeline' : 'rules and movement')
    + ' differential: ' + JSON.stringify(totals));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
