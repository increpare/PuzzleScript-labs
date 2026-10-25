import { Movement } from '../build/model.js';
import { CommandKind } from '../build/commands.js';
import { ExecutionDiagnosticKind } from '../build/execution-model.js';
import { SourceDiagnosticPhase, SourceDiagnosticSeverity } from '../build/source-model.js';
import { sourceIssueLine } from '../build/source-diagnostics.js';
import { ScreenKind, LevelKind, RunMode, SessionEffectKind, PersistenceKind, SessionDiagnosticKind } from '../build/session-model.js';

/** Project compiler/session values into plain inspection records, retaining identity. */
export function createTraceView(compilation, path) {
  const identities = new Map();
  const data = compilation.outcome;
  for (const object of data.declarations?.objects ?? []) identities.set(object, `object:${identities.size}`);
  function objectId(object) {
    if (!identities.has(object)) identities.set(object, `object:${identities.size}`);
    return identities.get(object);
  }
  function objectView(object) {
    return { id: objectId(object), name: object.name,
      orphanedFrom: object.orphanedFrom === undefined ? null : objectId(object.orphanedFrom) };
  }
  function sourceLine(line) {
    const authored = compilation.document.lines[line - 1];
    return authored === undefined ? null : { path, line, text: authored.original };
  }
  function ruleSource(rule) {
    const authored = data.ruleSources?.get(rule);
    return authored === undefined ? null : {
      path, line: authored.originalLine.span.start.line, text: authored.originalLine.original,
    };
  }
  function board(board) {
    return { width: board.width, height: board.height,
      rows: board.rows.map(row => row.map(cell => ({ objects: [...cell.objects].map(objectView) }))) };
  }
  function execution(state) {
    return { board: board(state.board),
      pendingMovements: state.pendingMovements.map(entry => ({ x: entry.position.x, y: entry.position.y,
        layer: entry.layer, movements: [...entry.movements].map(movement => Movement[movement]) })),
      remainingCommands: { message: state.commands.message, entries: state.commands.entries.map(entry => ({
        command: { ...entry.command, kind: CommandKind[entry.command.kind] }, source: ruleSource(entry.source),
      })) },
      random: { seed: state.random.seed, i: state.random.i, j: state.random.j, permutation: [...state.random.permutation] },
    };
  }
  function effect(effect) {
    if (effect.kind === SessionEffectKind.Diagnostic) {
      const diagnostic = effect.diagnostic;
      return { kind: 'Diagnostic', diagnostic: diagnostic.origin === 'session'
        ? { origin: 'session', kind: SessionDiagnosticKind[diagnostic.kind] }
        : { origin: 'rules', kind: ExecutionDiagnosticKind[diagnostic.detail.kind],
          source: sourceLine(diagnostic.detail.sourceLine) } };
    }
    const result = { ...effect, kind: SessionEffectKind[effect.kind] };
    if (effect.kind === SessionEffectKind.Persistence) {
      result.operation = PersistenceKind[effect.operation];
      if ('snapshot' in effect) result.snapshot = { board: board(effect.snapshot.board), viewport: effect.snapshot.viewport };
    }
    return result;
  }
  return {
    execution,
    collisionLayers: () => (data.game?.collisionLayers ?? []).map(layer => layer.map(objectView)),
    diagnostic: issue => ({ type: 'diagnostic', origin: 'compilation', code: issue.code, message: issue.message,
      severity: SourceDiagnosticSeverity[issue.severity], phase: SourceDiagnosticPhase[issue.phase],
      countsAsError: issue.countsAsError, reportedLine: sourceIssueLine(issue),
      source: sourceLine(issue.span?.start.line ?? sourceIssueLine(issue)), span: issue.span }),
    observation(result, input, substep, seedsUsed) {
      const { state } = result;
      const level = data.game.levels[state.levelIndex];
      return { type: 'observation', input, substep, modified: result.modified,
        level: { index: state.levelIndex, kind: level === undefined ? null : LevelKind[level.kind],
          source: level === undefined ? null : sourceLine(level.sourceLine) },
        screen: { ...state.screen, kind: ScreenKind[state.screen.kind] }, runMode: RunMode[state.runMode],
        ...execution(state.execution), effects: result.effects.map(effect), historyLength: state.history.length,
        againing: state.againing, winning: state.winning, viewport: state.viewport,
        loadedLevelSeed: state.loadedLevelSeed, seedsUsed: [...seedsUsed] };
    },
  };
}
