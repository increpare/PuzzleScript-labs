import { readFileSync } from 'node:fs';
import { compileSource, SourceCompilationKind, SourceCompilationStopReason } from '../build/source-compiler.js';
import { Movement } from '../build/model.js';
import { createSession, stepSession, undoSession, restartSession } from '../build/session.js';
import { SessionEffectKind, SessionDiagnosticKind } from '../build/session-model.js';
import { createTraceView } from './trace-view.mjs';

const movements = new Map([
  ['up', Movement.Up], ['down', Movement.Down], ['left', Movement.Left],
  ['right', Movement.Right], ['action', Movement.Action], ['tick', null],
]);
const usage = 'Usage: trace.mjs [--seed TEXT] [--level N] SOURCE.ps [up down left right action tick undo restart ...]\nDefaults: seed "example", level 0. Options precede the source path.';
const emit = record => console.log(JSON.stringify(record));
try {
  const arguments_ = process.argv.slice(2);
  let seed = 'example';
  let level = 0;
  while (arguments_[0]?.startsWith('-')) {
    const option = arguments_.shift();
    if (option !== '--seed' && option !== '--level') throw new Error('Unknown option: ' + option);
    const value = arguments_.shift();
    if (!value || value.startsWith('--')) throw new Error('Missing value for ' + option);
    if (option === '--seed') seed = value;
    else {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Invalid level: ' + value);
      level = Number(value);
    }
  }
  const path = arguments_.shift();
  if (!path) throw new Error('Missing source path');
  for (const input of arguments_) {
    if (!movements.has(input) && input !== 'undo' && input !== 'restart') throw new Error('Unknown input: ' + input);
  }
  const compilation = compileSource(readFileSync(path, 'utf8'));
  const view = createTraceView(compilation, path);
  for (const diagnostic of compilation.diagnostics) emit(view.diagnostic(diagnostic));
  emit({ type: 'compilation', source: path, outcome: SourceCompilationKind[compilation.outcome.kind],
    errorCount: compilation.errorCount,
    ...(compilation.outcome.kind === SourceCompilationKind.Stopped
      ? { reason: SourceCompilationStopReason[compilation.outcome.reason] } : {}) });
  if (compilation.outcome.kind !== SourceCompilationKind.Accepted) {
    throw new Error('Compilation ' + SourceCompilationKind[compilation.outcome.kind]);
  }
  const { game } = compilation.outcome;
  emit({ type: 'configuration', seed, level, collisionLayers: view.collisionLayers(),
    queueMeaning: 'Commands remaining after this operation; session operations consume their command queues.' });
  let loadCounter = 0;
  let seedsUsed = [seed];
  const environment = { nextLevelSeed() {
    const nextSeed = `${seed}:level:${++loadCounter}`;
    seedsUsed.push(nextSeed);
    return nextSeed;
  } };
  let result = createSession(game, { seed, level }, environment);
  function show(input, substep) {
    emit(view.observation(result, input, substep, seedsUsed));
    seedsUsed = [];
    if (result.effects.some(effect => effect.kind === SessionEffectKind.Diagnostic &&
      effect.diagnostic.origin === 'session' && effect.diagnostic.kind === SessionDiagnosticKind.MissingLevel)) {
      throw new Error('MissingLevel: requested level ' + result.state.levelIndex);
    }
  }
  function drain(input) {
    let substep = 0;
    show(input, substep);
    while (result.state.againing) {
      if (substep === 10_000) throw new Error('AGAIN exceeded 10,000 automatic steps: possible nontermination');
      result = stepSession(game, result.state, null, environment);
      show(input, ++substep);
    }
  }
  drain('initial');
  for (const input of arguments_) {
    if (input === 'undo') result = undoSession(game, result.state);
    else if (input === 'restart') result = restartSession(game, result.state, environment);
    else result = stepSession(game, result.state, movements.get(input), environment);
    drain(input);
  }
} catch (error) {
  console.error(error.message + '\n' + usage);
  process.exitCode = 1;
}
