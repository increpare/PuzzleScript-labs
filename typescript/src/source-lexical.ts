import { SourceDiagnosticPhase, SourceDiagnosticSeverity, SourceSectionKind, type SourceLexicalToken,
  type SourceLine, type SourcePosition } from './source-model.js';
import { collectSourceIssue, createSourceIssueCollection, type SourceIssueCollection } from './source-diagnostics.js';
import { lineSpan, lowercaseSourceRange, sourceWord, splitSourceLines, type LowercaseSourceView } from './source-text.js';
import { SourceDeclarations, SourceAliasOriginKind, type SourceDeclaration, type SourceDeclarationAdvice, type SourceObjectAliasOrigin } from './source-declarations.js';
import { NativeLegendExpression } from './source-legend.js';
import { AcceptedSoundKind, SoundVerb, SoundSeedKind, acceptedSoundEvent, acceptedSoundVerb, acceptedSoundDirection, soundEffectIndices,
  type AcceptedSound } from './source-sound-syntax.js';
import { recoverWinSyntax, type AcceptedWinCondition } from './source-win-syntax.js';
import { sourceSectionDescriptors, PreludePhase, ObjectPhase, LegendPhase, SoundPhase, RulePhase, WinPhase, LevelPhase,
  type SourceScanState, type PreludeScanState, type ObjectScanState, type LegendScanState, type SoundScanState,
  type RuleScanState, type WinScanState, type LevelScanState } from './source-scan-state.js';

export const sourceSectionNames = sourceSectionDescriptors.map(section => section.name);
export const sourceMetadataValues = new Set(['title', 'author', 'homepage', 'background_color', 'text_color', 'key_repeat_interval',
  'realtime_interval', 'again_interval', 'flickscreen', 'zoomscreen', 'color_palette', 'youtube']);
export const sourceMetadataFlags = new Set(['run_rules_on_level_start', 'norepeat_action', 'require_player_movement', 'debug',
  'verbose_logging', 'throttle_movement', 'noundo', 'noaction', 'nohack', 'norestart', 'scanline']);
const commands = new Set([...soundEffectIndices.keys(),
  'cancel', 'checkpoint', 'restart', 'win', 'message', 'again']);
const soundEvents = /^(undo|restart|titlescreen|startgame|cancel|endgame|startlevel|endlevel|showmessage|closemessage|sfx[0-9]|sfx10)\b[\p{Z}\s]*/u;
const soundVerbs = /^(move|action|create|destroy|cantmove)\b[\p{Z}\s]*/u;
const soundDirections = /^[\p{Z}\s]*(up|down|left|right|horizontal|vertical|orthogonal)(?![\p{L}\p{N}_])[\p{Z}\s]*/u;
const keywords = new Set([...sourceSectionNames, '...', '|', '[', ']', 'up', 'down', 'left', 'right', 'late', 'rigid', '^', 'v',
  '>', '<', 'no', 'randomdir', 'random', 'horizontal', 'vertical', 'any', 'all', 'some', 'moving', 'stationary', 'parallel',
  'perpendicular', 'action', 'message', 'move', 'create', 'destroy', 'cantmove', ...[...commands].filter(name => name !== 'checkpoint'),
  'undo', 'titlescreen', 'startgame', 'endgame', 'startlevel', 'endlevel', 'showmessage', 'closemessage']);
const namePattern = /^[\p{L}\p{N}_]+[\p{Z}\s]*/u;
const colorPattern = /^(black|white|gray|darkgray|lightgray|grey|darkgrey|lightgrey|red|darkred|lightred|brown|darkbrown|lightbrown|orange|yellow|green|darkgreen|lightgreen|blue|lightblue|darkblue|purple|pink|transparent|#(?:[0-9a-f]{3}){1,2})\s*/u;
const notComment = /^[^(]+/u;
const spaces = /^[\p{Z}\s]*/u;

/** Lexical acceptance stays separate from the full authored object and its physical rows. */
export interface SourceObjectLexical {
  readonly primary: SourceLexicalToken;
  readonly names: SourceLexicalToken[];
  readonly colors: SourceLexicalToken[];
  rows: SourceLexicalToken[][];
}
export interface SourceMetadataLexical { readonly key: SourceLexicalToken; readonly value: string }
export enum SourceObjectLineKind { Names, Colors, Sprite }
export interface SourceObjectLineLexical {
  readonly kind: SourceObjectLineKind;
  completedSprite: boolean;
  awaitingColors: boolean;
}
export enum SourceLexicalStopReason { Errors, Issues }
export interface SourceLexicalStop { readonly reason: SourceLexicalStopReason; readonly cursor: SourcePosition; readonly section: SourceSectionKind | null }
export interface SourceLexicalResult extends SourceIssueCollection {
  readonly objects: SourceObjectLexical[];
  readonly registrations: readonly SourceDeclaration[];
  readonly collisionLayers: readonly (readonly string[])[];
  readonly declarationAdvice: readonly SourceDeclarationAdvice[];
  readonly metadata: SourceMetadataLexical[];
  readonly objectLines: ReadonlyMap<number, SourceObjectLineLexical>;
  readonly objectNameAttempts: ReadonlyMap<number, readonly SourceLexicalToken[]>;
  readonly legendWords: ReadonlyMap<number, readonly SourceLexicalToken[]>;
  readonly collisionNames: ReadonlyMap<number, readonly SourceLexicalToken[]>;
  readonly soundDefinitions: ReadonlyMap<number, AcceptedSound>;
  readonly winDefinitions: ReadonlyMap<number, AcceptedWinCondition>;
  readonly levelMessages: ReadonlyMap<number, string>;
  /** SOUNDS registrations visible while scanning each physical rule line;
   * later headings can change the final grammar vocabulary, but not comments. */
  readonly ruleNamesByLine: ReadonlyMap<number, ReadonlySet<string>>;
  /** Final accumulated SOUNDS-entry registrations used by every rule's grammar. */
  readonly ruleNames: ReadonlySet<string>;
  /** Accepted event names, including malformed definitions retained by native recovery. */
  readonly definedSounds: ReadonlySet<string>;
  readonly stop: SourceLexicalStop | null;
}

/** Cursor in the native effective line, mapped back to authored UTF-16 positions. */
class SourceCursor {
  readonly normalized: LowercaseSourceView;
  text: string;
  index = 0;
  constructor(readonly line: SourceLine) {
    this.normalized = lowercaseSourceRange(line, 0, line.original.length);
    this.text = this.normalized.value;
  }
  get end(): boolean { return this.index >= this.text.length; }
  get character(): string { return this.text.charAt(this.index); }
  match(pattern: RegExp, consume = true): string | null {
    const found = pattern.exec(this.text.slice(this.index));
    if (found === null || found.index !== 0) return null;
    if (consume) this.index += found[0].length;
    return found[0];
  }
  next(): string { const character = this.character; if (!this.end) this.index++; return character; }
  space(): void { this.match(spaces); }
  discard(): void { this.match(notComment); }
  position(index = this.index): SourcePosition {
    const column = index === 0 ? 0 : this.text === this.line.original ? Math.min(index, this.line.original.length)
      : this.normalized.authoredRanges[Math.min(index, this.normalized.authoredRanges.length) - 1]?.end ?? 0;
    return lineSpan(this.line, column, column).start;
  }
  token(start: number, end = this.index): SourceLexicalToken {
    const ranges = this.normalized.authoredRanges;
    const authoredStart = this.text === this.line.original ? start : ranges[start]?.start ?? this.line.original.length;
    const authoredEnd = this.text === this.line.original ? end : ranges[end - 1]?.end ?? authoredStart;
    return { value: this.text.slice(start, end).trim(), word: sourceWord(this.line, authoredStart, authoredEnd) };
  }
  trimmedToken(start: number, end = this.index): SourceLexicalToken {
    while (end > start && /[\p{Z}\s]/u.test(this.text.charAt(end - 1))) end--;
    return this.token(start, end);
  }
}

class IssueCap extends Error {}

/**
 * The common native lexical walk. Authored reading requests all visits; parsing
 * obeys the native compilation limits. Source registration stays separate from
 * the retained lexical object assets and final compiler declarations.
 */
export function walkSourceLexically(source: string, stopAtLimits: boolean): SourceLexicalResult {
  const issues = createSourceIssueCollection();
  const objects: SourceObjectLexical[] = [], metadata: SourceMetadataLexical[] = [];
  const objectLines = new Map<number, SourceObjectLineLexical>(), objectNameAttempts = new Map<number, SourceLexicalToken[]>();
  const legendWords = new Map<number, SourceLexicalToken[]>(), collisionNames = new Map<number, SourceLexicalToken[]>();
  const soundDefinitions = new Map<number, AcceptedSound>(), winDefinitions = new Map<number, AcceptedWinCondition>();
  const ruleNamesByLine = new Map<number, ReadonlySet<string>>();
  const levelMessages = new Map<number, string>();
  const concrete = new Map<string, SourceObjectLexical>();
  const metadataLines = new Map<string, number>();
  const visited: SourceSectionKind[] = [];
  let scan: SourceScanState = { section: null, phase: PreludePhase.Key };
  let commentDepth = 0, resumeAsLineStart = false;
  let lineShouldEnd: string | null = null, legendExpression = new NativeLegendExpression();
  let objectName = '', workingRows: SourceLexicalToken[][] = [];
  let objectAliasOrigin: SourceObjectAliasOrigin | null = null;
  let gridWidth: number | null = null, gridHasRows = false, levelMessage = false;
  let cursor: SourceCursor;
  let visitStart = 0;
  let stop: SourceLexicalStop | null = null;
  const issue = (message: string, warning = false): void => {
    const severity = warning ? SourceDiagnosticSeverity.Warning : SourceDiagnosticSeverity.Error;
    const capped = collectSourceIssue(issues, { code: 'native-parser', message, severity, countsAsError: !warning,
      phase: SourceDiagnosticPhase.Reader, span: { start: cursor.position(visitStart), end: cursor.position() } });
    if (capped && stopAtLimits) throw new IssueCap();
  };
  const declarations = new SourceDeclarations(issue, keywords);
  // Only native EOL paths finalize line work; an unmatched terminal ')' skips this.
  const visitNativeEndOfLine = (): void => {
    if (scan.section === SourceSectionKind.Legend) declarations.registerLegend(legendExpression);
    else if (scan.section === SourceSectionKind.Sounds) {
      const line = cursor.line.span.start.line;
      switch (scan.phase) {
        case SoundPhase.EventSeed: soundDefinitions.set(line, { kind: AcceptedSoundKind.BareEvent, event: scan.event }); return;
        case SoundPhase.Verb: soundDefinitions.set(line, { kind: AcceptedSoundKind.BareTarget, target: scan.target }); return;
        case SoundPhase.End: soundDefinitions.set(line, scan.definition); return;
        case SoundPhase.Seed:
          soundDefinitions.set(line, { kind: AcceptedSoundKind.Target, target: scan.target, verb: scan.verb,
            seed: { kind: SoundSeedKind.Recovered, token: scan.verb.token } }); return;
        case SoundPhase.DirectionOrSeed: {
          const lastDirection = scan.verb.directions.at(-1);
          soundDefinitions.set(line, { kind: AcceptedSoundKind.Target, target: scan.target,
            verb: { ...scan.verb, directions: lastDirection === undefined ? [] : scan.verb.directions.slice(0, -1) },
            seed: { kind: SoundSeedKind.Recovered, token: lastDirection?.token ?? scan.verb.token } }); return;
        }
        case SoundPhase.Head:
        case SoundPhase.Failed: return;
      }
    }
  };
  const fallback = (): string => cursor.match(/^[^\p{Z}\s()]+[\p{Z}\s]*/u) ?? cursor.match(notComment) ?? '';
  const objectToken = (state: ObjectScanState, sol: boolean): void => {
    const lineNumber = cursor.line.span.start.line;
    const readName = (): void => {
      const start = cursor.index;
      const match = cursor.match(sol ? namePattern : /^[^\p{Z}\s()]+[\p{Z}\s]*/u);
      if (match === null) {
        cursor.discard();
        if (cursor.index > 0) issue('Unknown junk in object section (possibly: sprites have to be 5 pixels wide and 5 pixels high exactly. Or maybe: the main names for objects have to be words containing only the letters a-z0.9 - if you want to call them something like ",", do it in the legend section).', true);
        return;
      }
      const name = match.trim();
      const token = cursor.trimmedToken(start);
      const attempts = objectNameAttempts.get(lineNumber) ?? [];
      attempts.push(token); objectNameAttempts.set(lineNumber, attempts);
      if (sol) {
        const accepted = declarations.declareObject(token);
        if (accepted === null) {
          objectAliasOrigin ??= { kind: SourceAliasOriginKind.UnownedObject, attemptedPrimary: token };
          return;
        }
        objectAliasOrigin = { kind: SourceAliasOriginKind.Object, owner: accepted };
        objectName = name;
        const object: SourceObjectLexical = { primary: token, names: [token], colors: [], rows: [] };
        concrete.set(name, object); objects.push(object);
      } else {
        if (objectAliasOrigin === null) throw new Error('An object alias needs its preceding primary visit.');
        if (!declarations.declareObjectAlias(token, objectAliasOrigin)) return;
        concrete.get(objectName)?.names.push(token);
      }
      state.phase = ObjectPhase.Aliases;
      objectLines.get(lineNumber)!.awaitingColors = true;
    };
    if (sol && state.phase === ObjectPhase.Colors) state.phase = ObjectPhase.Sprite;
    if (sol && state.phase === ObjectPhase.Aliases) state.phase = ObjectPhase.Colors;
    if (!objectLines.has(lineNumber)) objectLines.set(lineNumber, {
      kind: state.phase === ObjectPhase.Colors ? SourceObjectLineKind.Colors
        : state.phase === ObjectPhase.Sprite && (workingRows.length > 0 || /^[.\d]/u.test(cursor.character))
          ? SourceObjectLineKind.Sprite : SourceObjectLineKind.Names,
      completedSprite: false, awaitingColors: false,
    });
    if (state.phase === ObjectPhase.Names || state.phase === ObjectPhase.Aliases) { workingRows = []; readName(); return; }
    const object = concrete.get(objectName);
    if (state.phase === ObjectPhase.Colors) {
      const start = cursor.index, color = cursor.match(colorPattern);
      if (color === null) {
        const invalid = cursor.match(namePattern) ?? cursor.match(notComment);
        issue('Was looking for color for object ' + objectName.toUpperCase() + ', got "' + invalid + '" instead.');
      } else object?.colors.push(cursor.trimmedToken(start));
      return;
    }
    const start = cursor.index, pixel = cursor.match(/^[.\d]/u);
    if (pixel === null) {
      if (workingRows.length === 0) { readName(); return; }
      issue('Unknown junk in spritematrix for object ' + objectName.toUpperCase() + '.'); cursor.discard(); return;
    }
    if (sol) workingRows.push([]);
    const row = workingRows[workingRows.length - 1];
    // Native's non-SOL empty matrix stores a non-array property; it never becomes a retained row.
    if (row === undefined) return;
    row.push(cursor.token(start));
    if (row.length > 5) { issue('Sprites must be 5 wide and 5 high.', true); cursor.discard(); return; }
    if (object !== undefined) object.rows = workingRows;
    if (workingRows.length === 5 && row.length === 5) {
      state.phase = ObjectPhase.Names;
      objectLines.get(lineNumber)!.completedSprite = true;
    }
    if (pixel !== '.' && Number(pixel) >= (object?.colors.length ?? 0)) issue('Trying to access color number ' + Number(pixel) +
      ' from the color palette of sprite ' + objectName.toUpperCase() + ', but there are only ' + (object?.colors.length ?? 0) + ' defined in it.');
  };
  const legendToken = (state: LegendScanState): void => {
    const start = cursor.index;
    let match: string | null;
    let actualMatch = true;
    if (state.phase === LegendPhase.Name) {
      match = cursor.match(/^[^=\p{Z}\s(]*(\p{Z}\s)*/u);
      state.phase = LegendPhase.Equals;
    } else if (state.phase === LegendPhase.Equals) {
      match = cursor.match(/^=/u);
      if (match === null) {
        issue('In the legend, define new items using the equals symbol - declarations must look like "A = B", "A = B or C [ or D ...]", "A = B and C [ and D ...]".');
        cursor.discard(); match = 'ERROR'; actualMatch = false;
      }
      cursor.space(); state.phase = LegendPhase.FirstMember;
    } else if (state.phase === LegendPhase.FirstOperator || state.phase === LegendPhase.LaterOperator) {
      match = cursor.match(namePattern);
      if (match === null) { issue("Something bad's happening in the LEGEND"); cursor.discard(); }
      else if (match.trim() === 'and' || match.trim() === 'or') {
        if (state.phase === LegendPhase.LaterOperator && match.trim() !== legendExpression.firstOperator) issue("Hey! You can't go mixing ANDs and ORs in a single legend entry.");
      } else issue(`Expected and 'AND' or an 'OR' here, but got ${match.trim().toUpperCase()} instead. In the legend, define new items using the equals symbol - declarations must look like 'A = B' or 'A = B and C' or 'A = B or C'.`);
      // Native advances even when an operator failed to match.
      state.phase = LegendPhase.LaterMember;
    } else {
      match = cursor.match(namePattern);
      if (match === null) { issue("Something bad's happening in the LEGEND"); cursor.discard(); }
      // Failed members retain their expected position for comment resumption.
      else state.phase = state.phase === LegendPhase.FirstMember ? LegendPhase.FirstOperator : LegendPhase.LaterOperator;
    }
    if (match !== null) {
      const token = actualMatch ? cursor.trimmedToken(start, start + match.length)
        : { value: match, word: cursor.trimmedToken(start).word };
      legendExpression.append(token);
      if (actualMatch && match.trim() !== '') {
        const tokens = legendWords.get(cursor.line.span.start.line) ?? [];
        tokens.push(token); legendWords.set(cursor.line.span.start.line, tokens);
      }
    }
    if (cursor.end) declarations.registerLegend(legendExpression);
  };
  const soundToken = (state: SoundScanState): void => {
    const accept = (pattern: RegExp): SourceLexicalToken | null => {
      const start = cursor.index;
      const match = cursor.match(pattern);
      return match === null ? null : cursor.trimmedToken(start);
    };
    const fail = (message: string, warning = false): void => {
      scan = { section: SourceSectionKind.Sounds, phase: SoundPhase.Failed };
      issue(message, warning);
    };
    if (state.phase === SoundPhase.Failed) {
      // Native recovery tries a seed without retaining its local match. It can
      // therefore consume the following name/fallback during the same visit.
      let match = cursor.match(soundEvents) ?? cursor.match(soundVerbs) ?? cursor.match(soundDirections);
      if (match === null) cursor.match(/^\d+\b/u);
      if (match === null) match = cursor.match(namePattern);
      if (match === null) fallback();
    } else if (state.phase === SoundPhase.Head) {
      const event = accept(soundEvents);
      if (event === null) {
        const target = accept(namePattern);
        if (target === null) { fallback(); fail("Was expecting a sound event (like SFX3, or ENDLEVEL) or an object name, but didn't find either.", true); }
        else if (declarations.findDeclaration(target.value) === null) fail(`unexpected sound token "${target.value}".`);
        else scan = { section: SourceSectionKind.Sounds, phase: SoundPhase.Verb, target };
      } else scan = { section: SourceSectionKind.Sounds, phase: SoundPhase.EventSeed, event: acceptedSoundEvent(event) };
    } else if (state.phase === SoundPhase.EventSeed) {
      const seed = accept(/^\d+\b/u);
      if (seed === null) { fallback(); fail('Was expecting a sound seed here (a number like 123123, like you generate by pressing the buttons above the console panel), but found something else.'); }
      else scan = { section: SourceSectionKind.Sounds, phase: SoundPhase.End, definition: { kind: AcceptedSoundKind.Event, event: state.event, seed } };
    } else if (state.phase === SoundPhase.Verb) {
      const verb = accept(soundVerbs);
      if (verb === null) { fallback(); fail('Was expecting a soundverb here (MOVE, DESTROY, CANTMOVE, or the like), but found something else.'); }
      else {
        const accepted = acceptedSoundVerb(verb);
        scan = accepted.kind === SoundVerb.Move || accepted.kind === SoundVerb.CantMove
          ? { section: SourceSectionKind.Sounds, phase: SoundPhase.DirectionOrSeed, target: state.target, verb: accepted }
          : { section: SourceSectionKind.Sounds, phase: SoundPhase.Seed, target: state.target, verb: accepted };
      }
    } else if (state.phase === SoundPhase.End) {
      const match = fallback();
      const seed = state.definition.kind === AcceptedSoundKind.Event ? state.definition.seed : state.definition.seed.token;
      fail(`I wasn't expecting anything after the sound declaration ${seed.value.toUpperCase()} on this line, so I don't know what to do with "${match.trim().toUpperCase()}" here.`);
    } else {
      const directional = state.phase === SoundPhase.DirectionOrSeed;
      if (state.phase === SoundPhase.DirectionOrSeed) {
        const direction = accept(soundDirections);
        if (direction !== null) {
          scan = { ...state, verb: { ...state.verb, directions: [...state.verb.directions, acceptedSoundDirection(direction)] } };
          return;
        }
      }
      const seed = accept(/^\d+\b/u);
      if (seed !== null) scan = { section: SourceSectionKind.Sounds, phase: SoundPhase.End,
        definition: { kind: AcceptedSoundKind.Target, target: state.target, verb: state.verb, seed: { kind: SoundSeedKind.Numeric, token: seed } } };
      else {
        const match = fallback();
        const previous = state.phase === SoundPhase.DirectionOrSeed ? state.verb.directions.at(-1)?.token ?? state.verb.token : state.verb.token;
        fail(`Ah I was expecting ${directional ? 'direction or a sound seed' : 'a sound seed'} here after ${previous.value.toUpperCase()}, but I don't know what to make of "${match.trim().toUpperCase()}".`);
      }
    }
  };
  const collisionToken = (sol: boolean): void => {
    if (sol) declarations.beginCollisionLayer();
    const start = cursor.index, match = cursor.match(namePattern);
    if (match === null) {
      if (cursor.match(/^[ ,]*/u) === '') { issue('error detected - unexpected character ' + cursor.character); cursor.next(); }
      return;
    }
    const token = cursor.trimmedToken(start);
    const tokens = collisionNames.get(cursor.line.span.start.line) ?? [];
    tokens.push(token); collisionNames.set(cursor.line.span.start.line, tokens);
    declarations.addCollisionName(token);
  };
  const ruleToken = (state: RuleScanState, sol: boolean): void => {
    if (!ruleNamesByLine.has(cursor.line.span.start.line)) ruleNamesByLine.set(cursor.line.span.start.line, declarations.ruleVocabulary);
    if (sol) state.phase = RulePhase.Prelude;
    if (state.phase === RulePhase.MessageTail) { cursor.index = cursor.text.length; return; }
    if (cursor.match(/^[\p{Z}\s]*->[\p{Z}\s]*/u) !== null) return;
    if ('[|]+'.includes(cursor.character)) {
      if (cursor.character !== '+') state.phase = RulePhase.AfterPatternSeparator;
      cursor.next(); cursor.space(); return;
    }
    const word = cursor.match(/^[^\[|\]\p{Z}\s]*/u)!.trim();
    if (state.phase === RulePhase.Prelude && /^(startloop|endloop)$/u.test(word)) return;
    if (state.phase === RulePhase.Prelude && /^(up|down|left|right|horizontal|vertical|orthogonal|late|rigid)$/u.test(word)) { cursor.space(); return; }
    if (state.phase === RulePhase.AfterPatternSeparator && /^(action|up|down|left|right|\^|v|<|>|moving|stationary|parallel|perpendicular|horizontal|orthogonal|vertical|no|randomdir|random)$/u.test(word)) { cursor.space(); return; }
    if (declarations.isRuleName(word)) {
      if (sol) issue('Objects cannot appear outside of square brackets in rules, only directions can.');
      else cursor.space();
    } else if (word === '...' || word === 'rigid' || word === 'random') return;
    else if (commands.has(word)) { if (word === 'message') state.phase = RulePhase.MessageTail; }
    else issue('Name "' + word + '", referred to in a rule, does not exist.');
  };
  const winToken = (state: WinScanState, sol: boolean): void => {
    if (sol) {
      state.phase = WinPhase.Quantifier;
      // Native captures the first non-'(' fragment of the entire normalized
      // physical line, even when this body visit resumes after a comment.
      const capture = /[^(]+/u.exec(cursor.text);
      const tokens: SourceLexicalToken[] = [];
      if (capture !== null) for (const word of capture[0].matchAll(/[^\p{Z}\s]+/gu)) {
        const start = capture.index + word.index;
        tokens.push(cursor.token(start, start + word[0].length));
      }
      winDefinitions.set(cursor.line.span.start.line, recoverWinSyntax(tokens));
    }
    // Native increments before matching, including visits that report an error.
    const expected = state.phase;
    switch (expected) {
      case WinPhase.Quantifier: state.phase = WinPhase.Subject; break;
      case WinPhase.Subject: state.phase = WinPhase.On; break;
      case WinPhase.On: state.phase = WinPhase.Target; break;
      case WinPhase.Target: state.phase = WinPhase.Excess; break;
      case WinPhase.Excess: break;
    }
    const match = cursor.match(namePattern);
    if (match === null) { issue('incorrect format of win condition.'); cursor.discard(); return; }
    const word = match.trim();
    if (expected === WinPhase.Quantifier) {
      if (!/^(all|any|no|some)$/u.test(word)) issue('Expecting the start of a win condition ("ALL","SOME","NO") but got "' + word.toUpperCase() + "'.");
    } else if (expected === WinPhase.On) {
      if (word !== 'on') issue('Expecting the word "ON" but got "' + word.toUpperCase() + '".');
    } else if (expected === WinPhase.Subject || expected === WinPhase.Target) {
      if (!declarations.isRuleName(word)) issue('Error in win condition: "' + word.toUpperCase() + '" is not a valid object name.');
    } else issue("Error in win condition: I don't know what to do with " + word.toUpperCase() + '.');
  };
  const levelToken = (state: LevelScanState, sol: boolean, mixedCase: string): void => {
    if (sol) {
      let message = cursor.match(/^[\p{Z}\s]*message\b[\p{Z}\s]*/u);
      if (message === null && cursor.match(/^[\p{Z}\s]*message[\p{Z}\s]*/u) !== null) {
        issue("You probably meant to put a space after 'message' innit.  That's ok, I'll still interpret it as a message, but you probably want to put a space there.", true);
        message = 'message';
      }
      if (message !== null) {
        levelMessages.set(cursor.line.span.start.line, mixedCase.slice(cursor.index).trim());
        state.phase = LevelPhase.MessageTail; levelMessage = true; return;
      }
      const row = cursor.match(notComment, false)?.trim() ?? '';
      state.phase = LevelPhase.Grid;
      if (levelMessage) { gridWidth = row.length; gridHasRows = true; levelMessage = false; }
      else {
        if (!gridHasRows) { gridWidth = row.length; gridHasRows = true; }
        if (row.length !== gridWidth) issue('Maps must be rectangular, yo (In a level, the length of each row must be the same).', true);
      }
    } else if (state.phase === LevelPhase.MessageTail) { cursor.index = cursor.text.length; return; }
    if (state.phase === LevelPhase.Grid && !cursor.end) {
      const glyph = cursor.next();
      if (!declarations.isLevelGlyph(glyph)) issue('Key "' + glyph.toUpperCase() + '" not found. Do you need to add it to the legend, or define a new object?');
    }
  };
  const preludeToken = (state: PreludeScanState, sol: boolean, mixedCase: string): void => {
    if (sol || resumeAsLineStart) state.phase = PreludePhase.Key;
    if (state.phase === PreludePhase.Key) {
      const start = cursor.index, match = cursor.match(namePattern);
      if (match === null) {
        const text = cursor.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        issue(`Unrecognised stuff "${text}" in the prelude.`); cursor.next(); return;
      }
      const key = match.trim();
      if (!sol) return;
      if (sourceMetadataValues.has(key)) {
        if (key === 'author' || key === 'homepage' || key === 'title') cursor.text = mixedCase;
        if (key === 'youtube') issue("Unfortunately, YouTube support hasn't been working properly for a long time - it was always a hack and it hasn't gotten less hacky over time, so I can no longer pretend to support it.", true);
        const value = cursor.match(notComment, false);
        if (value === null) issue('MetaData "' + key + '" needs a value.');
        else {
          metadata.push({ key: { value: key, word: cursor.trimmedToken(start, start + key.length).word }, value: value.trim() });
          const previous = metadataLines.get(key);
          if (previous !== undefined) issue(`You've already defined a ${key.toUpperCase()} in the prelude on line <a onclick="jumpToLine(${previous});" href="javascript:void(0);">${previous}</a>.`, true);
          metadataLines.set(key, cursor.line.span.start.line);
        }
        state.phase = PreludePhase.Value;
      } else if (sourceMetadataFlags.has(key)) {
        metadata.push({ key: cursor.trimmedToken(start, start + key.length), value: 'true' }); state.phase = PreludePhase.FlagArguments;
        const value = cursor.match(notComment, false);
        if (value !== null) issue('MetaData ' + key.toUpperCase() + ' doesn\'t take any parameters, but you went and gave it "' + value.trim() + '".', true);
      } else issue('Unrecognised stuff in the prelude.');
    } else {
      cursor.discard();
      if (state.phase === PreludePhase.FlagArguments) state.phase = PreludePhase.Key;
      else if (state.phase === PreludePhase.Value) state.phase = PreludePhase.ValueTail;
      else issue("Error: you can't embed comments in metadata values. Anything after the comment will be ignored.", true);
    }
  };
  const beginPhysicalLine = (): void => {
    legendExpression = new NativeLegendExpression();
    lineShouldEnd = null;
    switch (scan.section) {
      case null: scan.phase = PreludePhase.Key; return;
      case SourceSectionKind.Objects: return; // Object ownership and rows cross physical lines.
      case SourceSectionKind.Legend: scan.phase = LegendPhase.Name; return;
      case SourceSectionKind.Sounds: scan = { section: SourceSectionKind.Sounds, phase: SoundPhase.Head }; return;
      case SourceSectionKind.CollisionLayers: return;
      case SourceSectionKind.Rules: scan.phase = RulePhase.Prelude; return;
      // A common precheck can consume physical SOL before the win body is visited.
      // Native's initial zero then preincrements to Subject; logical SOL resets it.
      case SourceSectionKind.WinConditions: scan.phase = WinPhase.Subject; return;
      case SourceSectionKind.Levels: scan.phase = LevelPhase.Start; return;
    }
  };
  const enterSection = (kind: SourceSectionKind): void => {
    switch (kind) {
      case SourceSectionKind.Objects: scan = { section: kind, phase: ObjectPhase.Names }; return;
      case SourceSectionKind.Legend: scan = { section: kind, phase: LegendPhase.Name }; return;
      case SourceSectionKind.Sounds: scan = { section: kind, phase: SoundPhase.Head }; return;
      case SourceSectionKind.CollisionLayers: scan = { section: kind }; return;
      case SourceSectionKind.Rules: scan = { section: kind, phase: RulePhase.Prelude }; return;
      case SourceSectionKind.WinConditions: scan = { section: kind, phase: WinPhase.Quantifier }; return;
      case SourceSectionKind.Levels: scan = { section: kind, phase: LevelPhase.Start }; return;
    }
  };
  const visit = (): void => {
    const physicalStart = cursor.index === 0;
    const mixedCase = cursor.line.original;
    let sol = physicalStart;
    if (physicalStart) beginPhysicalLine();
    // A resumed comment supplies logical SOL without clearing physical line work.
    if (resumeAsLineStart) { sol = true; resumeAsLineStart = false; }
    cursor.space();
    const character = cursor.character;
    const messageTail = scan.section === SourceSectionKind.Rules && scan.phase === RulePhase.MessageTail
      || scan.section === SourceSectionKind.Levels && scan.phase === LevelPhase.MessageTail;
    if (character === '(' && !messageTail) { cursor.next(); commentDepth++; }
    else if (character === ')') {
      cursor.next();
      if (commentDepth > 0) {
        commentDepth--;
        if (commentDepth === 0) { resumeAsLineStart = true; return; }
      } else {
        issue("You're trying to close a comment here, but I can't find any opening bracket to match it? [This is highly suspicious; you probably want to fix it.]", true); return;
      }
    }
    if (commentDepth > 0) {
      if (sol) resumeAsLineStart = true;
      while (!cursor.end) {
        const character = cursor.next();
        if (character === '(') commentDepth++;
        else if (character === ')') commentDepth--;
        if (commentDepth === 0) break;
      }
      if (cursor.end) visitNativeEndOfLine();
      return;
    }
    cursor.space();
    if (sol && cursor.end) {
      visitNativeEndOfLine();
      if (scan.section === SourceSectionKind.Levels && gridHasRows) { gridHasRows = false; gridWidth = null; }
      if (scan.section === SourceSectionKind.Objects) scan.phase = ObjectPhase.Names;
      return;
    }
    if (lineShouldEnd !== null && !cursor.end) {
      issue('Only comments should go after ' + lineShouldEnd + ' on a line.'); cursor.index = cursor.text.length; return;
    }
    if (sol && (scan.section !== SourceSectionKind.Levels || /^[\p{Z}\s=]*$/u.test(cursor.text.slice(cursor.index))) && cursor.match(/^=+/u) !== null) {
      lineShouldEnd = "a bunch of equals signs ('===')"; return;
    }
    if (scan.section !== SourceSectionKind.Levels) {
      // Native consumes a heading-shaped word even when this is not logical SOL.
      const heading = cursor.match(/^(objects|collisionlayers|legend|sounds|rules|winconditions|levels)(?![\p{L}\p{N}_])[\p{Z}\s]*/u);
      if (sol && heading !== null) {
        const descriptor = sourceSectionDescriptors.find(section => section.name === heading.trim());
        if (descriptor === undefined) throw new Error('Matched heading has no section descriptor.');
        const { name, kind, predecessor } = descriptor;
        enterSection(kind);
        if (visited.includes(kind)) issue('cannot duplicate sections (you tried to duplicate "' + name.toUpperCase() + '").');
        lineShouldEnd = `a section name ("${name.toUpperCase()}")`;
        visited.push(kind);
        if (predecessor === null) {
          if (visited.length > 1) issue('section "' + name.toUpperCase() + '" must be the first section');
        } else if (!visited.includes(predecessor.kind)) issue('section "' + name.toUpperCase() + '" is out of order, must follow  "' + predecessor.name.toUpperCase() + '" (or it could be that the section "' + predecessor.name.toUpperCase() + '"is just missing totally.  You have to include all section headings, even if the section itself is empty).');
        if (kind === SourceSectionKind.Sounds) declarations.captureRuleVocabulary();
        else if (kind === SourceSectionKind.Levels) declarations.captureLevelVocabulary();
        return;
      }
    }
    if (cursor.end) { visitNativeEndOfLine(); return; }
    switch (scan.section) {
      case SourceSectionKind.Objects: objectToken(scan, sol); return;
      case SourceSectionKind.Legend: legendToken(scan); return;
      case SourceSectionKind.Sounds: soundToken(scan); if (cursor.end) visitNativeEndOfLine(); return;
      case SourceSectionKind.CollisionLayers: collisionToken(sol); return;
      case SourceSectionKind.Rules: ruleToken(scan, sol); return;
      case SourceSectionKind.WinConditions: winToken(scan, sol); return;
      case SourceSectionKind.Levels: levelToken(scan, sol, mixedCase); return;
      case null: preludeToken(scan, sol, mixedCase); return;
    }
  };
  for (const line of splitSourceLines(source)) {
    cursor = new SourceCursor(line);
    do {
      visitStart = cursor.index;
      try { visit(); }
      catch (error) {
        if (!(error instanceof IssueCap)) throw error;
        stop = { reason: SourceLexicalStopReason.Issues, cursor: cursor.position(), section: scan.section }; break;
      }
      if (stopAtLimits && issues.errorCount > 5) { stop = { reason: SourceLexicalStopReason.Errors, cursor: cursor.position(), section: scan.section }; break; }
    } while (!cursor.end);
    if (stop !== null) break;
  }
  return { ...issues, objects, metadata, objectLines, objectNameAttempts, legendWords, collisionNames,
    registrations: declarations.registrations, collisionLayers: declarations.collisionLayers, declarationAdvice: declarations.advice,
    soundDefinitions, winDefinitions, levelMessages, ruleNamesByLine,
    ruleNames: declarations.ruleVocabulary, definedSounds: new Set([...soundDefinitions.values()].flatMap(definition =>
      definition.kind === AcceptedSoundKind.Event || definition.kind === AcceptedSoundKind.BareEvent ? [definition.event.token.value] : [])), stop };
}
