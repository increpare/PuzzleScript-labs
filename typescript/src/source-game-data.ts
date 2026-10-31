import { appendSourceIssue, type SourceIssueReporter } from './source-diagnostics.js';
import { ResolvedNameKind, type ResolvedDeclarations } from './declaration-model.js';
import type { SoundIndex } from './commands.js';
import * as vanilla from './compatibility.js';
import { Movement, type GameObject, type MovementSound } from './model.js';
import { positionsByColumn } from './scan-order.js';
import { LevelKind, SimpleSound, type Dimensions, type ObjectSound, type SessionGame, type SessionLevel, type SessionMetadata, type SessionSounds } from './session-model.js';
import { SourceDiagnosticPhase, SourceDiagnosticSeverity, SourceLevelKind,
  type SourceDiagnostic, type SourceDocument, type SourceGridLevel, type SourceSpan, type SourceWord } from './source-model.js';
import { ObjectMatchKind, WinQuantifier, type ObjectCondition, type WinCondition } from './win-conditions.js';

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
  function operand(word: SourceWord): ObjectCondition | null {
    const objects = declarations.namedObjects.get(word.normalized);
    if (objects !== undefined) return { kind: ObjectMatchKind.Any, objects };
    const aggregate = declarations.namedAggregates.get(word.normalized);
    if (aggregate !== undefined) return { kind: ObjectMatchKind.All, objects: aggregate };
    report('unknown-win-operand', `Unwelcome term "${word.normalized}" found in win condition. I don't know what I'm supposed to do with this. `, word.span);
    return null;
  }
  const all: ObjectCondition = { kind: ObjectMatchKind.Any, objects: new Set(declarations.objectChoiceOrder) };
  for (const source of document.winConditions) {
    // Native parsing retains malformed word lists. Four words select an explicit
    // target even when the third is not ON; all other lengths use the whole board.
    if (source.words.length < 2) {
      report('malformed-win-condition', 'Win conditions is badly formatted - needs to look something like "No Fruit", "All Target On Crate", "Some Fruit", "Some Gold on Chest", "No Gold on Chest", or the like.', source.span);
      continue;
    }
    const subject = operand(source.words[1]!);
    const target = source.words.length === 4 ? operand(source.words[3]!) : all;
    if (subject === null || target === null) continue;
    const quantifier = source.words[0]!.normalized;
    conditions.push({ quantifier: quantifier === 'no' ? WinQuantifier.No : quantifier === 'all' ? WinQuantifier.All : WinQuantifier.Some, subject, target });
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

const simpleSoundEvents = new Map<string, SimpleSound>([
  ['titlescreen', SimpleSound.TitleScreen], ['startgame', SimpleSound.StartGame], ['endgame', SimpleSound.EndGame],
  ['startlevel', SimpleSound.StartLevel], ['endlevel', SimpleSound.EndLevel], ['undo', SimpleSound.Undo],
  ['restart', SimpleSound.Restart], ['showmessage', SimpleSound.ShowMessage], ['closemessage', SimpleSound.CloseMessage], ['cancel', SimpleSound.Cancel],
]);
const soundDirections = new Map<string, readonly Movement[]>([
  ['up', [Movement.Up]], ['down', [Movement.Down]], ['left', [Movement.Left]], ['right', [Movement.Right]],
  ['horizontal', [Movement.Left, Movement.Right]], ['vertical', [Movement.Up, Movement.Down]],
  ['orthogonal', [Movement.Up, Movement.Down, Movement.Left, Movement.Right]],
]);
const soundActions = new Set(['move', 'cantmove', 'action', 'create', 'destroy']);

function leadingSoundEvent(word: string): string | null {
  // Event tokens historically use ASCII word boundaries, unlike object names.
  // Thus undoA remains a name, but undoé starts with an UNDO event token.
  return /^(undo|restart|titlescreen|startgame|cancel|endgame|startlevel|endlevel|showmessage|closemessage|sfx0|sfx1|sfx2|sfx3|sfx4|sfx5|sfx6|sfx7|sfx8|sfx9|sfx10)\b/u.exec(word)?.[1] ?? null;
}

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
    const words = source.words.map(word => word.normalized);
    const target = words[0];
    if (target === undefined) continue;
    if (words.length === 1) {
      const declaration = declarations.firstDeclarationWords.get(target);
      if (source.eventDefinition !== null || (/^[\p{L}\p{N}_]+$/u.test(target) && declaration !== undefined
        && declaration.span.start.offset < source.span.start.offset)) report('incomplete-sound', 'incorrect sound declaration.', source.span, true);
      continue;
    }
    const event = leadingSoundEvent(target);
    if (event !== null && event !== target) continue; // The remaining name text makes the event row invalid.
    const simpleEvent = simpleSoundEvents.get(event ?? '');
    const sfxEvent = event === null ? null : /^sfx(10|[0-9])$/u.exec(event);
    if (simpleEvent !== undefined || sfxEvent !== null) {
      // An event keyword takes precedence over a same-named object. Parser
      // rejection drops the whole row when a seed is missing or followed by text.
      if (words.length !== 2 || !/^\d+$/u.test(words[1]!)) continue;
      const seed = words[1]!;
      if (simpleEvent !== undefined) {
        if (simple.has(simpleEvent)) report('duplicate-sound-event', `${target.toUpperCase()} already declared.`, source.span, true);
        simple.set(simpleEvent, seed);
      } else {
        const index = Number(sfxEvent![1]) as SoundIndex;
        if (sfx.has(index)) report('duplicate-sound-event', `${target.toUpperCase()} already declared.`, source.span, true);
        sfx.set(index, seed);
      }
      continue;
    }
    if (!/^[\p{L}\p{N}_]+$/u.test(target)) continue; // Broad map glyph aliases are not sound target tokens.
    const declaration = declarations.firstDeclarationWords.get(target);
    if (declaration === undefined || declaration.span.start.offset >= source.span.start.offset) {
      report('unknown-sound-target', `Object "${target}" has not been declared at this point.`, source.words[0]!.span);
      continue;
    }
    const action = words[1]!;
    if (!soundActions.has(action)) continue;
    const directional = action === 'move' || action === 'cantmove';
    let seedSeen = false;
    let accepted = true;
    for (const word of words.slice(2)) {
      if (seedSeen) { accepted = false; break; }
      if (/^\d+$/u.test(word)) seedSeen = true;
      else if (!directional || !soundDirections.has(word)) { accepted = false; break; }
    }
    if (!accepted) continue;
    // Native parsing also accepts incomplete rows ending in a verb/direction.
    // Compilation treats the final token as the seed and diagnoses its type.
    const seed = words[words.length - 1]!;
    if (!seedSeen) report('missing-sound-seed', `Expecting sfx data, instead found "${seed}".`, source.span);
    if (declarations.namedAggregates.has(target)) {
      report('aggregate-sound-target', `cannot assign sound events to aggregate objects (declared with "and"), only to regular objects, or properties, things defined in terms of "or" ("${target}").`, source.span);
      continue;
    }
    const objects = declarations.namedObjects.get(target);
    if (objects === undefined) { report('unknown-sound-target', `Object "${target}" not found.`, source.span); continue; }
    if (action === 'create') { creation.push({ objects, seed }); continue; }
    if (action === 'destroy') { destruction.push({ objects, seed }); continue; }
    const directions = words.slice(2, -1);
    const movements = action === 'action' ? new Set([Movement.Action])
      : new Set((directions.length === 0 ? ['orthogonal'] : directions).flatMap(direction => soundDirections.get(direction) ?? []));
    for (const object of declarations.soundTargets.get(target) ?? []) {
      const layer = declarations.objectLayers.get(object);
      if (layer === undefined) continue;
      const sound = { objects: new Set([object]), layer, movements, seed };
      if (action === 'cantmove') failureSounds.push(sound);
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
