import { readFileSync } from 'node:fs';
import { compileSource, SourceCompilationKind } from '../build/source-compiler.js';
import { Movement } from '../build/model.js';
import { createSession, stepSession, undoSession } from '../build/session.js';

const source = readFileSync(new URL('./source-game.ps', import.meta.url), 'utf8');
const compilation = compileSource(source);
if (compilation.outcome.kind !== SourceCompilationKind.Accepted) {
  throw new Error(`Compilation ${SourceCompilationKind[compilation.outcome.kind]}: ${compilation.diagnostics.map(issue => issue.message).join('; ')}`);
}
const { game } = compilation.outcome;
let loadCounter = 0;
const environment = { nextLevelSeed: () => `example:level:${++loadCounter}` };
let current = createSession(game, { seed: 'example' }, environment).state;
const show = input => console.log(JSON.stringify({ input, historyLength: current.history.length,
  rows: current.execution.board.rows.map(row => row.map(cell => [...cell.objects].map(object => object.name))) }));
show('initial');
current = stepSession(game, current, Movement.Right, environment).state;
show('right');
current = undoSession(game, current).state;
show('undo');
