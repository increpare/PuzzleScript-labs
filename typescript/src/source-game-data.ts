import { appendSourceIssue, type SourceIssueReporter } from './source-diagnostics.js';
import { ResolvedNameKind, type ResolvedDeclarations } from './declaration-model.js';
import type { SoundIndex } from './commands.js';
import * as vanilla from './compatibility.js';
import { Movement, type GameObject, type MovementSound } from './model.js';
import { positionsByColumn } from './scan-order.js';
import { LevelKind, SimpleSound, type Dimensions, type ObjectSound, type SessionGame, type SessionLevel, type SessionMetadata, type SessionSounds } from './session-model.js';
import { SourceDiagnosticPhase, SourceDiagnosticSeverity, SourceLevelKind,
  type SourceDiagnostic, type SourceDocument, type SourceGridLevel, type SourceSpan, type SourceLexicalToken } from './source-model.js';
import { ObjectMatchKind, type ObjectCondition, type WinCondition } from './win-conditions.js';
import { AcceptedSoundKind, SoundEventKind, SoundVerb, SoundDirectionFamily, SoundSeedKind } from './source-sound-syntax.js';
import { WinSyntaxKind, WinTargetKind } from './source-win-syntax.js';

export type CompiledGameData = Pick<SessionGame, 'collisionLayers' | 'player' | 'levels' | 'winConditions' |
  'metadata' | 'sounds' | 'movementSounds' | 'failureSounds' | 'restorePolicies'>;
export interface SourceGameDataResult {
  readonly data: CompiledGameData;
  readonly diagnostics: readonly SourceDiagnostic[];
  readonly metadata: ReadonlyMap<string, string | Dimensions>;
}
export type GameDataReporter = (code: string, message: string, span: SourceSpan | null, warning?: boolean) => void;

function compileGrid(level: SourceGridLevel, declarations: ResolvedDeclarations, report: GameDataReporter): SessionLevel {
  // Lowercase the whole string before indexing: Unicode casing can depend on
  // context and can change its UTF-16 length. Source spans remain authored.
  const text = level.rows.map(row => row.text.toLowerCase());
  const width = text[0]?.length ?? 0;
  const height = text.length;
  const rows = text.map(() => Array.from({ length: width }, () => ({ objects: new Set<GameObject>() })));
  const result = { kind: LevelKind.Grid as const, board: { width, height, rows },
    sourceLine: level.rows[0]?.span.start.line ?? level.span.start.line };
  for (const { x, y } of positionsByColumn(result.board)) {
    const row = text[y]!;
    const glyph = row[x] ?? row[row.length - 1];
    const objects = glyph === undefined ? undefined : declarations.glyphs.get(glyph);
    if (objects === undefined) {
      const ambiguous = glyph !== undefined && (declarations.names.get(glyph)?.kind === ResolvedNameKind.Property
        || declarations.namedObjects.has(glyph));
      report(ambiguous ? 'ambiguous-level-glyph' : 'unknown-level-glyph', ambiguous
        ? `Error, symbol "${glyph}" is defined using OR, and therefore ambiguous - it cannot be used in a map. Did you mean to define it in terms of AND?`
        : `Error, symbol "${glyph}", used in map, not found.`, level.rows[y]!.glyphs[Math.min(x, level.rows[y]!.glyphs.length - 1)]?.span ?? level.rows[y]!.span);
      return result;
    }
    rows[y]![x]!.objects = new Set(objects);
  }
  const background = declarations.background;
  if (background === null) {
    report('missing-level-background', 'you have to have a background layer', null);
    return result;
  }
  let fill: readonly GameObject[] = [background.object];
  for (const { x, y } of positionsByColumn(result.board)) {
    const intersection = [...rows[y]![x]!.objects].filter(object => declarations.objectLayers.get(object) === background.layer);
    if (intersection.length > 0) { fill = intersection; break; }
  }
  for (const row of rows) for (const cell of row) {
    if (![...cell.objects].some(object => declarations.objectLayers.get(object) === background.layer)) {
      for (const object of fill) cell.objects.add(object);
    }
  }
  return result;
}

export function compileWinConditions(document: SourceDocument, declarations: ResolvedDeclarations, report: GameDataReporter): readonly WinCondition[] {
  const conditions: WinCondition[] = [];
  function operand(token: SourceLexicalToken): ObjectCondition | null {
    const objects = declarations.namedObjects.get(token.value);
    if (objects !== undefined) return { kind: ObjectMatchKind.Any, objects };
    const aggregate = declarations.namedAggregates.get(token.value);
    if (aggregate !== undefined) return { kind: ObjectMatchKind.All, objects: aggregate };
    report('unknown-win-operand', `Unwelcome term "${token.value}" found in win condition. I don't know what I'm supposed to do with this. `, token.word.span);
    return null;
  }
  const all: ObjectCondition = { kind: ObjectMatchKind.Any, objects: new Set(declarations.objectChoiceOrder) };
  for (const source of document.winConditions) {
    const definition = source.definition;
    if (definition === null) continue;
    if (definition.kind === WinSyntaxKind.MissingSubject) {
      report('malformed-win-condition', 'Win conditions is badly formatted - needs to look something like "No Fruit", "All Target On Crate", "Some Fruit", "Some Gold on Chest", "No Gold on Chest", or the like.', source.span);
      continue;
    }
    const subject = operand(definition.subjectToken);
    const target = definition.target.kind === WinTargetKind.Named ? operand(definition.target.token) : all;
    if (subject === null || target === null) continue;
    conditions.push({ quantifier: definition.quantifier, subject, target });
  }
  return conditions;
}

const valuedMetadata = new Set(['title', 'author', 'homepage', 'background_color', 'text_color', 'key_repeat_interval',
  'realtime_interval', 'again_interval', 'flickscreen', 'zoomscreen', 'color_palette', 'youtube']);
const flagMetadata = new Set(['run_rules_on_level_start', 'norepeat_action', 'require_player_movement', 'debug',
  'verbose_logging', 'throttle_movement', 'noundo', 'noaction', 'nohack', 'norestart', 'scanline']);

function parseDimensions(value: string, span: SourceSpan, report: GameDataReporter): Dimensions | null {
  const coordinates = value.split('x');
  if (coordinates.length !== 2) {
    report('invalid-dimensions', 'Dimensions must be of the form AxB.', span, true);
    return null;
  }
  const parsed = coordinates.map(coordinate => {
    const number = Number.parseFloat(coordinate);
    // Legacy isInt tested the signed 32-bit numeric range before parseInt.
    // Keep that validation explicit without a bitwise coercion.
    if (!Number.isFinite(Number(coordinate)) || !Number.isInteger(number) || number < -2147483648 || number > 2147483647) {
      report('invalid-dimension', `Wasn't able to make sense of "${coordinate}" as a (whole number) dimension.`, span, true);
      return NaN;
    }
    const result = Number.parseInt(coordinate);
    if (Number.isNaN(result)) report('invalid-dimension', `Wasn't able to make sense of "${coordinate}" as a dimension.`, span, true);
    if (result <= 0) report('nonpositive-dimension', `The dimension given to me (you gave "${coordinate}") is baad - it should be greater than 0.`, span, true);
    return result;
  });
  const width = parsed[0]!;
  const height = parsed[1]!;
  if (Number.isNaN(width) || Number.isNaN(height)) {
    report('invalid-dimensions', `Couldn't understand the dimensions given to me (you gave "${value}") - should be of the form AxB.`, span, true);
    return null;
  }
  if (width <= 0 || height <= 0) {
    report('nonpositive-dimensions', `The dimensions given to me (you gave "${value}") are baad - they should be > 0.`, span, true);
    return null;
  }
  return { width, height };
}

export function compileMetadata(document: SourceDocument, report: GameDataReporter): {
  readonly values: ReadonlyMap<string, string | Dimensions>; readonly session: SessionMetadata;
} {
  const values = new Map<string, string | Dimensions>();
  const spans = new Map<string, SourceSpan>();
  for (const source of document.metadata) {
    if (!source.accepted) continue;
    const key = source.key.normalized;
    if (!valuedMetadata.has(key) && !flagMetadata.has(key)) continue; // The reader diagnoses unknown keys.
    if (valuedMetadata.has(key) && source.value === '') continue;
    values.set(key, source.value);
    spans.set(key, source.span);
  }
  const screens: { flickscreen?: Dimensions; zoomscreen?: Dimensions } = {};
  for (const key of ['flickscreen', 'zoomscreen'] as const) {
    const value = values.get(key);
    if (typeof value !== 'string') continue;
    const dimensions = parseDimensions(value, spans.get(key)!, report);
    if (dimensions === null) values.delete(key);
    else { values.set(key, dimensions); screens[key] = dimensions; }
  }
  return { values, session: { requirePlayerMovement: values.has('require_player_movement'), runRulesOnLevelStart: values.has('run_rules_on_level_start'),
    noUndo: values.has('noundo'), noRestart: values.has('norestart'), ...screens } };
}

const soundDirections: Readonly<Record<SoundDirectionFamily, readonly Movement[]>> = {
  [SoundDirectionFamily.Up]: [Movement.Up], [SoundDirectionFamily.Down]: [Movement.Down],
  [SoundDirectionFamily.Left]: [Movement.Left], [SoundDirectionFamily.Right]: [Movement.Right],
  [SoundDirectionFamily.Horizontal]: [Movement.Left, Movement.Right], [SoundDirectionFamily.Vertical]: [Movement.Up, Movement.Down],
  [SoundDirectionFamily.Orthogonal]: [Movement.Up, Movement.Down, Movement.Left, Movement.Right],
};

export function compileSounds(document: SourceDocument, declarations: ResolvedDeclarations, report: GameDataReporter): {
  readonly sounds: SessionSounds; readonly movementSounds: readonly (readonly MovementSound[])[]; readonly failureSounds: readonly MovementSound[];
} {
  const simple = new Map<SimpleSound, string>();
  const sfx = new Map<SoundIndex, string>();
  const creation: ObjectSound[] = [];
  const destruction: ObjectSound[] = [];
  const movementSounds: MovementSound[][] = declarations.collisionLayers.map(() => []);
  const failureSounds: MovementSound[] = [];
  for (const source of document.sounds) {
    const definition = source.definition;
    if (definition === null) continue;
    if (definition.kind === AcceptedSoundKind.BareEvent || definition.kind === AcceptedSoundKind.BareTarget) {
      report('incomplete-sound', 'incorrect sound declaration.', source.span, true);
      continue;
    }
    if (definition.kind === AcceptedSoundKind.Event) {
      const { event, seed } = definition;
      if (event.kind === SoundEventKind.Simple) {
        if (simple.has(event.sound)) report('duplicate-sound-event', `${event.token.value.toUpperCase()} already declared.`, source.span, true);
        simple.set(event.sound, seed.value);
      } else {
        if (sfx.has(event.index)) report('duplicate-sound-event', `${event.token.value.toUpperCase()} already declared.`, source.span, true);
        sfx.set(event.index, seed.value);
      }
      continue;
    }
    const target = definition.target.value, verb = definition.verb, seed = definition.seed.token.value;
    if (definition.seed.kind === SoundSeedKind.Recovered) report('missing-sound-seed', `Expecting sfx data, instead found "${seed}".`, source.span);
    if (declarations.namedAggregates.has(target)) {
      report('aggregate-sound-target', `cannot assign sound events to aggregate objects (declared with "and"), only to regular objects, or properties, things defined in terms of "or" ("${target}").`, source.span);
      continue;
    }
    const objects = declarations.namedObjects.get(target);
    if (objects === undefined) { report('unknown-sound-target', `Object "${target}" not found.`, source.span); continue; }
    if (verb.kind === SoundVerb.Create) { creation.push({ objects, seed }); continue; }
    if (verb.kind === SoundVerb.Destroy) { destruction.push({ objects, seed }); continue; }
    const directions = verb.kind === SoundVerb.Action ? [] : verb.directions.map(direction => direction.family);
    const movements = verb.kind === SoundVerb.Action ? new Set([Movement.Action])
      : new Set((directions.length === 0 ? [SoundDirectionFamily.Orthogonal] : directions).flatMap(direction => soundDirections[direction]));
    for (const object of declarations.soundTargets.get(target) ?? []) {
      const layer = declarations.objectLayers.get(object);
      if (layer === undefined) continue;
      const sound = { objects: new Set([object]), layer, movements, seed };
      if (verb.kind === SoundVerb.CantMove) failureSounds.push(sound);
      else movementSounds[layer]!.push(sound);
    }
  }
  return { sounds: { simple, sfx, creation, destruction }, movementSounds, failureSounds };
}

export function gameDataReporter(diagnostics: SourceDiagnostic[], reporter?: SourceIssueReporter): GameDataReporter {
  return (code, message, span, warning = false) => {
    appendSourceIssue(diagnostics, { code, message, span,
      severity: warning ? SourceDiagnosticSeverity.Warning : SourceDiagnosticSeverity.Error,
      countsAsError: !warning || span === null, phase: SourceDiagnosticPhase.GameData }, reporter);
  };
}

export function compileLevels(document: SourceDocument, declarations: ResolvedDeclarations, report: GameDataReporter): readonly SessionLevel[] {
  return document.levels.map(level => {
    if (level.kind === SourceLevelKind.Message) {
      const wrapped = level.text.match(/.{1,34}(\s|$)|.{34}|.+$/g);
      if (wrapped !== null && wrapped.length > 12) report('long-level-message', 'Message too long to fit on screen.', level.keyword.span, true);
      return { kind: LevelKind.Message, text: level.text, sourceLine: level.keyword.span.start.line };
    }
    return compileGrid(level, declarations, report);
  });
}

export function compileRestorePolicies(levels: readonly SessionLevel[], layerCount: number): readonly vanilla.VanillaRestorePolicy[] {
  const policies: vanilla.VanillaRestorePolicy[] = [];
  for (const level of levels) {
    if (level.kind !== LevelKind.Grid) continue;
    const { width, height } = level.board;
    if (!policies.some(policy => policy.width === width && policy.height === height)) policies.push(vanilla.restorePolicyFor(width, height, layerCount));
  }
  return policies;
}

export function formatHomepage(values: ReadonlyMap<string, string | Dimensions>): ReadonlyMap<string, string | Dimensions> {
  const result = new Map(values);
  const homepage = result.get('homepage');
  if (typeof homepage === 'string') result.set('homepage', homepage.replace('http://', '').replace('https://', ''));
  return result;
}

export function compileGameData(document: SourceDocument, declarations: ResolvedDeclarations): SourceGameDataResult {
  const diagnostics: SourceDiagnostic[] = [], report = gameDataReporter(diagnostics);
  const levels = compileLevels(document, declarations, report);
  const metadata = compileMetadata(document, report);
  const sounds = compileSounds(document, declarations, report);
  return { data: { collisionLayers: declarations.collisionLayers, player: declarations.player, levels,
    winConditions: compileWinConditions(document, declarations, report), metadata: metadata.session,
    ...sounds, restorePolicies: compileRestorePolicies(levels, declarations.collisionLayers.length) },
    diagnostics, metadata: formatHomepage(metadata.values) };
}
