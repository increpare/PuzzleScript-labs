import { SourceDiagnosticPhase, SourceDiagnosticSeverity, SourceSectionKind, type SourceLexicalToken,
  type SourceLine, type SourcePosition } from './source-model.js';
import { collectSourceIssue, createSourceIssueCollection, type SourceIssueCollection } from './source-diagnostics.js';
import { lineSpan, lowercaseSourceRange, sourceWord, splitSourceLines, type LowercaseSourceView } from './source-text.js';

export const sourceSectionNames = ['objects', 'legend', 'sounds', 'collisionlayers', 'rules', 'winconditions', 'levels'] as const;
export const sourceMetadataValues = new Set(['title', 'author', 'homepage', 'background_color', 'text_color', 'key_repeat_interval',
  'realtime_interval', 'again_interval', 'flickscreen', 'zoomscreen', 'color_palette', 'youtube']);
export const sourceMetadataFlags = new Set(['run_rules_on_level_start', 'norepeat_action', 'require_player_movement', 'debug',
  'verbose_logging', 'throttle_movement', 'noundo', 'noaction', 'nohack', 'norestart', 'scanline']);
const commands = new Set(['sfx0', 'sfx1', 'sfx2', 'sfx3', 'sfx4', 'sfx5', 'sfx6', 'sfx7', 'sfx8', 'sfx9', 'sfx10',
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
// The native raw object dictionary inherits Object.prototype. Lowercasing
// leaves these inherited names visible to lookups, but not own-name snapshots.
const inheritedObjectNames = new Set(Object.getOwnPropertyNames(Object.prototype).filter(name => name === name.toLowerCase()));

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
  readonly metadata: SourceMetadataLexical[];
  readonly objectLines: ReadonlyMap<number, SourceObjectLineLexical>;
  readonly objectNameAttempts: ReadonlyMap<number, readonly SourceLexicalToken[]>;
  readonly legendWords: ReadonlyMap<number, readonly SourceLexicalToken[]>;
  readonly collisionNames: ReadonlyMap<number, readonly SourceLexicalToken[]>;
  readonly soundEvents: ReadonlyMap<number, SourceLexicalToken>;
  readonly levelMessages: ReadonlyMap<number, string>;
  /** Full source-ordered vocabulary for authored rules. Native parser name
   * recognition separately uses its SOUNDS-entry snapshot. */
  readonly ruleNamesByLine: ReadonlyMap<number, ReadonlySet<string>>;
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

enum ObjectPart { Names, Aliases, Colors, Sprite }
enum NameKind { Object, Synonym, Aggregate, Property, Undeclared }
interface LegendEntry { readonly name: string; readonly members: string[]; readonly line: number }
interface FoundName { readonly kind: NameKind; readonly name: string; readonly entry?: LegendEntry }
enum SoundRole { Event, Name, Verb, Direction, Seed }
interface SoundToken { readonly value: string; readonly role: SoundRole }
class IssueCap extends Error {}

/**
 * The common native lexical walk. Authored reading requests all visits; parsing
 * obeys the native compilation limits. Neither path constructs game declarations.
 */
export function walkSourceLexically(source: string, stopAtLimits: boolean): SourceLexicalResult {
  const issues = createSourceIssueCollection();
  const objects: SourceObjectLexical[] = [], metadata: SourceMetadataLexical[] = [];
  const objectLines = new Map<number, SourceObjectLineLexical>(), objectNameAttempts = new Map<number, SourceLexicalToken[]>();
  const legendWords = new Map<number, SourceLexicalToken[]>(), collisionNames = new Map<number, SourceLexicalToken[]>();
  const retainedSoundEvents = new Map<number, SourceLexicalToken>(), ruleNamesByLine = new Map<number, ReadonlySet<string>>();
  const levelMessages = new Map<number, string>();
  const concrete = new Map<string, SourceObjectLexical>();
  const synonyms: LegendEntry[] = [], aggregates: LegendEntry[] = [], properties: LegendEntry[] = [];
  const names = new Set<string>(), glyphs = new Set<string>();
  const metadataLines = new Map<string, number>();
  const layers: string[][] = [];
  const visited: SourceSectionKind[] = [];
  let section: SourceSectionKind | null = null, commentDepth = 0, afterComment = false;
  let lineShouldEnd: string | null = null, tokenIndex = 0, words: string[] = [];
  let objectPart = ObjectPart.Names, objectName = '', workingRows: SourceLexicalToken[][] = [];
  let sounds: SoundToken[] = [], soundFailed = false;
  let soundEvent: SourceLexicalToken | null = null;
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
  const declared = (name: string): { line: number | undefined } | null => {
    const object = concrete.get(name);
    if (inheritedObjectNames.has(name)) return { line: undefined };
    return object === undefined ? aggregates.find(entry => entry.name === name) ?? properties.find(entry => entry.name === name)
      ?? synonyms.find(entry => entry.name === name) ?? null : { line: object.primary.word.span.start.line };
  };
  const lookup = (name: string, path = new Set<string>()): FoundName => {
    if (concrete.has(name) || inheritedObjectNames.has(name)) return { kind: NameKind.Object, name };
    if (path.has(name)) return { kind: NameKind.Undeclared, name };
    path.add(name);
    const synonym = synonyms.find(entry => entry.name === name);
    if (synonym !== undefined) return lookup(synonym.members[0]!, path);
    const aggregate = aggregates.find(entry => entry.name === name);
    if (aggregate !== undefined) return { kind: NameKind.Aggregate, name, entry: aggregate };
    const property = properties.find(entry => entry.name === name);
    return property === undefined ? { kind: NameKind.Undeclared, name } : { kind: NameKind.Property, name, entry: property };
  };
  const keywordWarning = (name: string): void => {
    if (keywords.has(name)) issue('You named an object "' + name.toUpperCase() + '", but this is a keyword. Don\'t do that!', true);
  };
  const processLegend = (): void => {
    let okay = true;
    if (words.length === 0) return;
    if (words.length === 1) {
      issue('Incorrect format of legend - should be one of "A = B", "A = B or C [ or D ...]", "A = B and C [ and D ...]".');
      return;
    }
    if (words.length % 2 === 0) {
      issue(`Incorrect format of legend - should be one of "A = B", "A = B or C [ or D ...]", "A = B and C [ and D ...]", but it looks like you have a dangling "${words[words.length - 1]!.toUpperCase()}"?`);
      return;
    }
    const name = words[0]!, previous = declared(name);
    if (previous !== null) {
      issue(`Name "${name.toUpperCase()}" already in use (on line <a onclick="jumpToLine(${previous.line});" href="javascript:void(0);"><span class="errorTextLineNumber">line ${previous.line}</span></a>).`);
      okay = false;
    }
    keywordWarning(name);
    for (let index = 2; index < words.length; index += 2) {
      const member = words[index]!;
      if (member === name) {
        issue("You can't define object " + name.toUpperCase() + ' in terms of itself!');
        okay = false;
        let found = words.indexOf(name, 2);
        while (found >= 2) { words.splice(found >= 4 ? found - 1 : found, 2); found = words.indexOf(name, 2); }
      }
      for (let earlier = 2; earlier < index; earlier += 2) if (words[earlier] === member) {
        issue("You're repeating the object " + member.toUpperCase() + " here multiple times on the RHS.  This makes no sense.  Don't do that.", true);
      }
    }
    for (let index = 2; index < words.length; index += 2) if (words[index] !== name && declared(words[index]!) === null) {
      issue(`You're talking about ${words[index]!.toUpperCase()} but it's not defined anywhere.`);
    }
    const line = cursor.line.span.start.line;
    if (words.length === 3) synonyms.push({ name, members: [words[2]!], line });
    else if (words[3] === 'and') {
      const substitute = (member: string): string[] => {
        const found = lookup(member);
        switch (found.kind) {
          case NameKind.Object: return [found.name];
          case NameKind.Aggregate: return found.entry!.members.flatMap(substitute);
          case NameKind.Property:
            issue("Cannot define an aggregate (using 'and') in terms of properties (something that uses 'or').");
            okay = false;
            return [found.name];
          default: return [found.name];
        }
      };
      aggregates.push({ name, members: words.filter((_, index) => index >= 2 && index % 2 === 0).flatMap(substitute), line });
    } else if (words[3] === 'or') {
      const substitute = (member: string): string[] => {
        const found = lookup(member);
        switch (found.kind) {
          case NameKind.Object: return [found.name];
          case NameKind.Aggregate:
            issue(`Cannot define a property (something defined in terms of 'or') in terms of an aggregate (something that uses 'and').  In this case, you can't define "${name.toUpperCase()}" in terms of "${found.name.toUpperCase()}".`);
            return [];
          case NameKind.Property: return found.entry!.members.filter(member => member !== found.name).flatMap(substitute);
          default: return [found.name];
        }
      };
      if (words.every((word, index) => index < 5 || index % 2 === 0 || word === 'or')) {
        const members = words.filter((_, index) => index >= 2 && index % 2 === 0).flatMap(substitute);
        if (members.length > 0) properties.push({ name, members, line });
      }
    } else if (okay) issue('This legend-entry is incorrectly-formatted - it should be one of A = B, A = B or C ( or D ...), A = B and C (and D ...)');
  };
  const endOfLine = (): void => {
    if (section === SourceSectionKind.Legend) processLegend();
    else if (section === SourceSectionKind.Sounds && !soundFailed && soundEvent !== null) {
      retainedSoundEvents.set(cursor.line.span.start.line, soundEvent);
    }
  };
  const fallback = (): string => cursor.match(/^[^\p{Z}\s()]+[\p{Z}\s]*/u) ?? cursor.match(notComment) ?? '';
  const objectToken = (sol: boolean): void => {
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
      if (concrete.has(name) || inheritedObjectNames.has(name)) { issue('Object "' + name.toUpperCase() + '" defined multiple times.'); return; }
      for (const entry of synonyms) if (entry.name === name) issue('Name "' + name.toUpperCase() + '" already in use.');
      keywordWarning(name);
      if (sol) {
        objectName = name;
        const object: SourceObjectLexical = { primary: token, names: [token], colors: [], rows: [] };
        concrete.set(name, object); objects.push(object);
      } else {
        synonyms.push({ name, members: [objectName], line: cursor.line.span.start.line });
        concrete.get(objectName)?.names.push(token);
      }
      objectPart = ObjectPart.Aliases;
      objectLines.get(lineNumber)!.awaitingColors = true;
    };
    if (sol && objectPart === ObjectPart.Colors) objectPart = ObjectPart.Sprite;
    if (sol && objectPart === ObjectPart.Aliases) objectPart = ObjectPart.Colors;
    if (!objectLines.has(lineNumber)) objectLines.set(lineNumber, {
      kind: objectPart === ObjectPart.Colors ? SourceObjectLineKind.Colors
        : objectPart === ObjectPart.Sprite && (workingRows.length > 0 || /^[.\d]/u.test(cursor.character))
          ? SourceObjectLineKind.Sprite : SourceObjectLineKind.Names,
      completedSprite: false, awaitingColors: false,
    });
    if (objectPart === ObjectPart.Names || objectPart === ObjectPart.Aliases) { workingRows = []; readName(); return; }
    const object = concrete.get(objectName);
    if (objectPart === ObjectPart.Colors) {
      tokenIndex = 0;
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
      objectPart = ObjectPart.Names;
      objectLines.get(lineNumber)!.completedSprite = true;
    }
    if (pixel !== '.' && Number(pixel) >= (object?.colors.length ?? 0)) issue('Trying to access color number ' + Number(pixel) +
      ' from the color palette of sprite ' + objectName.toUpperCase() + ', but there are only ' + (object?.colors.length ?? 0) + ' defined in it.');
  };
  const legendToken = (): void => {
    const start = cursor.index;
    let match: string | null;
    let actualMatch = true;
    if (tokenIndex === 0) { match = cursor.match(/^[^=\p{Z}\s(]*(\p{Z}\s)*/u); tokenIndex++; }
    else if (tokenIndex === 1) {
      match = cursor.match(/^=/u);
      if (match === null) {
        issue('In the legend, define new items using the equals symbol - declarations must look like "A = B", "A = B or C [ or D ...]", "A = B and C [ and D ...]".');
        cursor.discard(); match = 'ERROR'; actualMatch = false;
      }
      cursor.space(); tokenIndex++;
    } else if (tokenIndex >= 3 && tokenIndex % 2 === 1) {
      match = cursor.match(namePattern);
      if (match === null) { issue("Something bad's happening in the LEGEND"); cursor.discard(); }
      else if (match.trim() === 'and' || match.trim() === 'or') {
        if (tokenIndex >= 5 && match.trim() !== words[3]) issue("Hey! You can't go mixing ANDs and ORs in a single legend entry.");
      } else issue(`Expected and 'AND' or an 'OR' here, but got ${match.trim().toUpperCase()} instead. In the legend, define new items using the equals symbol - declarations must look like 'A = B' or 'A = B and C' or 'A = B or C'.`);
      tokenIndex++;
    } else {
      match = cursor.match(namePattern);
      if (match === null) { issue("Something bad's happening in the LEGEND"); cursor.discard(); }
      else tokenIndex++;
    }
    if (match !== null) words.push(match.trim());
    if (match !== null && actualMatch && match.trim() !== '') {
      const tokens = legendWords.get(cursor.line.span.start.line) ?? [];
      tokens.push(cursor.trimmedToken(start, start + match.length)); legendWords.set(cursor.line.span.start.line, tokens);
    }
    if (cursor.end) processLegend();
  };
  const soundToken = (): void => {
    const accept = (pattern: RegExp, role: SoundRole): boolean => {
      const start = cursor.index;
      const match = cursor.match(pattern);
      if (match === null) return false;
      if (role === SoundRole.Event) soundEvent = cursor.trimmedToken(start);
      sounds.push({ value: match.trim(), role }); tokenIndex++; return true;
    };
    const fail = (message: string, warning = false): void => { soundFailed = true; issue(message, warning); };
    if (soundFailed) {
      // Native recovery tries a seed without retaining its local match. It can
      // therefore consume the following name/fallback during the same visit.
      let match = cursor.match(soundEvents) ?? cursor.match(soundVerbs) ?? cursor.match(soundDirections);
      if (match === null) cursor.match(/^\d+\b/u);
      if (match === null) match = cursor.match(namePattern);
      if (match === null) fallback();
    } else if (sounds.length === 0) {
      if (!accept(soundEvents, SoundRole.Event)) {
        const match = cursor.match(namePattern);
        if (match === null) { fallback(); fail("Was expecting a sound event (like SFX3, or ENDLEVEL) or an object name, but didn't find either.", true); }
        else if (declared(match.trim()) === null) fail(`unexpected sound token "${match.trim()}".`);
        else { sounds.push({ value: match.trim(), role: SoundRole.Name }); tokenIndex++; }
      }
    } else if (sounds.length === 1) {
      if (sounds[0]!.role === SoundRole.Event) {
        if (!accept(/^\d+\b/u, SoundRole.Seed)) { fallback(); fail('Was expecting a sound seed here (a number like 123123, like you generate by pressing the buttons above the console panel), but found something else.'); }
      } else if (!accept(soundVerbs, SoundRole.Verb)) { fallback(); fail('Was expecting a soundverb here (MOVE, DESTROY, CANTMOVE, or the like), but found something else.'); }
    } else {
      const last = sounds[sounds.length - 1]!;
      if (sounds[0]!.role === SoundRole.Event || last.role === SoundRole.Seed) {
        const match = fallback();
        fail(`I wasn't expecting anything after the sound declaration ${last.value.toUpperCase()} on this line, so I don't know what to do with "${match.trim().toUpperCase()}" here.`);
      } else {
        const directional = sounds[1]!.value === 'move' || sounds[1]!.value === 'cantmove';
        if (directional && accept(soundDirections, SoundRole.Direction)) return;
        if (!accept(/^\d+\b/u, SoundRole.Seed)) {
          const match = fallback();
          fail(`Ah I was expecting ${directional ? 'direction or a sound seed' : 'a sound seed'} here after ${last.value.toUpperCase()}, but I don't know what to make of "${match.trim().toUpperCase()}".`);
        }
      }
    }
  };
  const collisionToken = (sol: boolean): void => {
    if (sol) { layers.push([]); words = []; tokenIndex = 0; }
    const start = cursor.index, match = cursor.match(namePattern);
    if (match === null) {
      if (cursor.match(/^[ ,]*/u) === '') { issue('error detected - unexpected character ' + cursor.character); cursor.next(); }
      return;
    }
    const name = match.trim();
    const tokens = collisionNames.get(cursor.line.span.start.line) ?? [];
    tokens.push(cursor.trimmedToken(start)); collisionNames.set(cursor.line.span.start.line, tokens);
    const substitute = (member: string): string[] => {
      const found = lookup(member);
      switch (found.kind) {
        case NameKind.Object: return [found.name];
        case NameKind.Aggregate:
          issue('"' + found.name + '" is an aggregate (defined using "and"), and cannot be added to a single layer because its constituent objects must be able to coexist.'); return [];
        case NameKind.Property: return found.entry!.members.filter(member => member !== found.name).flatMap(substitute);
        default: issue('Cannot add "' + name.toUpperCase() + '" to a collision layer; it has not been declared.'); return [];
      }
    };
    if (name === 'background') {
      if ((layers[layers.length - 1]?.length ?? 0) > 0) issue('Background must be in a layer by itself.');
      tokenIndex = 1;
    } else if (tokenIndex !== 0) issue('Background must be in a layer by itself.');
    const members = substitute(name), current = layers[layers.length - 1];
    if (current === undefined) { issue('no layers found.'); return; }
    const others: number[] = [];
    for (const member of members) for (let index = 0; index < layers.length - 1; index++) if (layers[index]!.includes(member)) others.push(index);
    if (others.length > 0) issue('Object "' + name.toUpperCase() + '" included in multiple collision layers ( layers ' +
      others.map(index => '#' + (index + 1) + ', ').join('') + '#' + layers.length + ' ). You should fix this!', true);
    if (words.includes(name)) issue('Object "' + name.toUpperCase() + '" included explicitly multiple times in the same layer. Don\'t do that innit.', true);
    words.push(name); current.push(...members);
  };
  const ruleToken = (sol: boolean): void => {
    if (!ruleNamesByLine.has(cursor.line.span.start.line)) ruleNamesByLine.set(cursor.line.span.start.line,
      new Set([...concrete.keys(), ...synonyms.map(entry => entry.name), ...aggregates.map(entry => entry.name), ...properties.map(entry => entry.name)]));
    if (sol) tokenIndex = 0;
    if (tokenIndex === -4) { cursor.index = cursor.text.length; return; }
    if (cursor.match(/^[\p{Z}\s]*->[\p{Z}\s]*/u) !== null) return;
    if ('[|]+'.includes(cursor.character)) {
      if (cursor.character !== '+') tokenIndex = 1;
      cursor.next(); cursor.space(); return;
    }
    const word = cursor.match(/^[^\[|\]\p{Z}\s]*/u)!.trim();
    if (tokenIndex === 0 && /^(startloop|endloop)$/u.test(word)) return;
    if (tokenIndex === 0 && /^(up|down|left|right|horizontal|vertical|orthogonal|late|rigid)$/u.test(word)) { cursor.space(); return; }
    if (tokenIndex === 1 && /^(action|up|down|left|right|\^|v|<|>|moving|stationary|parallel|perpendicular|horizontal|orthogonal|vertical|no|randomdir|random)$/u.test(word)) { cursor.space(); return; }
    if (names.has(word)) {
      if (sol) issue('Objects cannot appear outside of square brackets in rules, only directions can.');
      else cursor.space();
    } else if (word === '...' || word === 'rigid' || word === 'random') return;
    else if (commands.has(word)) { if (word === 'message') tokenIndex = -4; }
    else issue('Name "' + word + '", referred to in a rule, does not exist.');
  };
  const winToken = (sol: boolean): void => {
    if (sol) tokenIndex = -1;
    tokenIndex++;
    const match = cursor.match(namePattern);
    if (match === null) { issue('incorrect format of win condition.'); cursor.discard(); return; }
    const word = match.trim();
    if (tokenIndex === 0) {
      if (!/^(all|any|no|some)$/u.test(word)) issue('Expecting the start of a win condition ("ALL","SOME","NO") but got "' + word.toUpperCase() + "'.");
    } else if (tokenIndex === 2) {
      if (word !== 'on') issue('Expecting the word "ON" but got "' + word.toUpperCase() + '".');
    } else if (tokenIndex === 1 || tokenIndex === 3) {
      if (!names.has(word)) issue('Error in win condition: "' + word.toUpperCase() + '" is not a valid object name.');
    } else issue("Error in win condition: I don't know what to do with " + word.toUpperCase() + '.');
  };
  const levelToken = (sol: boolean, mixedCase: string): void => {
    if (sol) {
      let message = cursor.match(/^[\p{Z}\s]*message\b[\p{Z}\s]*/u);
      if (message === null && cursor.match(/^[\p{Z}\s]*message[\p{Z}\s]*/u) !== null) {
        issue("You probably meant to put a space after 'message' innit.  That's ok, I'll still interpret it as a message, but you probably want to put a space there.", true);
        message = 'message';
      }
      if (message !== null) {
        levelMessages.set(cursor.line.span.start.line, mixedCase.slice(cursor.index).trim());
        tokenIndex = -4; levelMessage = true; return;
      }
      const row = cursor.match(notComment, false)?.trim() ?? '';
      tokenIndex = 2;
      if (levelMessage) { gridWidth = row.length; gridHasRows = true; levelMessage = false; }
      else {
        if (!gridHasRows) { gridWidth = row.length; gridHasRows = true; }
        if (row.length !== gridWidth) issue('Maps must be rectangular, yo (In a level, the length of each row must be the same).', true);
      }
    } else if (tokenIndex === -4) { cursor.index = cursor.text.length; return; }
    if (tokenIndex === 2 && !cursor.end) {
      const glyph = cursor.next();
      if (!glyphs.has(glyph)) issue('Key "' + glyph.toUpperCase() + '" not found. Do you need to add it to the legend, or define a new object?');
    }
  };
  const preludeToken = (sol: boolean, mixedCase: string): void => {
    if (sol || afterComment) tokenIndex = 0;
    if (tokenIndex === 0) {
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
        tokenIndex = 1;
      } else if (sourceMetadataFlags.has(key)) {
        metadata.push({ key: cursor.trimmedToken(start, start + key.length), value: 'true' }); tokenIndex = -1;
        const value = cursor.match(notComment, false);
        if (value !== null) issue('MetaData ' + key.toUpperCase() + ' doesn\'t take any parameters, but you went and gave it "' + value.trim() + '".', true);
      } else issue('Unrecognised stuff in the prelude.');
    } else {
      cursor.discard(); tokenIndex++;
      if (tokenIndex > 2) issue("Error: you can't embed comments in metadata values. Anything after the comment will be ignored.", true);
    }
  };
  const visit = (): void => {
    const physicalSol = cursor.index === 0;
    const mixedCase = physicalSol ? cursor.line.original : cursor.text;
    let sol = physicalSol;
    if (sol) { words = []; sounds = []; soundFailed = false; soundEvent = null; tokenIndex = 0; lineShouldEnd = null; }
    if (afterComment) { sol = true; afterComment = false; }
    cursor.space();
    const character = cursor.character;
    if (character === '(' && tokenIndex !== -4) { cursor.next(); commentDepth++; }
    else if (character === ')') {
      cursor.next();
      if (commentDepth > 0) {
        commentDepth--;
        if (commentDepth === 0) { afterComment = true; return; }
      } else {
        issue("You're trying to close a comment here, but I can't find any opening bracket to match it? [This is highly suspicious; you probably want to fix it.]", true); return;
      }
    }
    if (commentDepth > 0) {
      if (sol) afterComment = true;
      while (!cursor.end) {
        const character = cursor.next();
        if (character === '(') commentDepth++;
        else if (character === ')') commentDepth--;
        if (commentDepth === 0) break;
      }
      if (cursor.end) endOfLine();
      return;
    }
    cursor.space();
    if (sol && cursor.end) {
      endOfLine();
      if (section === SourceSectionKind.Levels && gridHasRows) { gridHasRows = false; gridWidth = null; }
      if (section === SourceSectionKind.Objects) objectPart = ObjectPart.Names;
      return;
    }
    if (lineShouldEnd !== null && !cursor.end) {
      issue('Only comments should go after ' + lineShouldEnd + ' on a line.'); cursor.index = cursor.text.length; return;
    }
    if (sol && (section !== SourceSectionKind.Levels || /^[\p{Z}\s=]*$/u.test(cursor.text.slice(cursor.index))) && cursor.match(/^=+/u) !== null) {
      lineShouldEnd = "a bunch of equals signs ('===')"; return;
    }
    if (section !== SourceSectionKind.Levels) {
      const heading = cursor.match(/^(objects|collisionlayers|legend|sounds|rules|winconditions|levels)(?![\p{L}\p{N}_])[\p{Z}\s]*/u);
      if (sol && heading !== null) {
        section = sourceSectionNames.indexOf(heading.trim() as typeof sourceSectionNames[number]);
        const name = sourceSectionNames[section]!;
        if (visited.includes(section)) issue('cannot duplicate sections (you tried to duplicate "' + name.toUpperCase() + '").');
        lineShouldEnd = `a section name ("${name.toUpperCase()}")`;
        visited.push(section);
        if (section === SourceSectionKind.Objects) {
          objectPart = ObjectPart.Names;
          if (visited.length > 1) issue('section "' + name.toUpperCase() + '" must be the first section');
        } else if (!visited.includes(section - 1)) issue('section "' + name.toUpperCase() + '" is out of order, must follow  "' + sourceSectionNames[section - 1]!.toUpperCase() + '" (or it could be that the section "' + sourceSectionNames[section - 1]!.toUpperCase() + '"is just missing totally.  You have to include all section headings, even if the section itself is empty).');
        if (section === SourceSectionKind.Sounds) {
          for (const name of concrete.keys()) names.add(name);
          for (const entries of [synonyms, aggregates, properties]) for (const entry of entries) names.add(entry.name);
        } else if (section === SourceSectionKind.Levels) {
          for (const name of concrete.keys()) if (name.length === 1) glyphs.add(name);
          for (const entries of [synonyms, aggregates]) for (const entry of entries) if (entry.name.length === 1) glyphs.add(entry.name);
        }
        return;
      }
    }
    if (cursor.end) { endOfLine(); return; }
    switch (section) {
      case SourceSectionKind.Objects: objectToken(sol); return;
      case SourceSectionKind.Legend: legendToken(); return;
      case SourceSectionKind.Sounds: soundToken(); if (cursor.end) endOfLine(); return;
      case SourceSectionKind.CollisionLayers: collisionToken(sol); return;
      case SourceSectionKind.Rules: ruleToken(sol); return;
      case SourceSectionKind.WinConditions: winToken(sol); return;
      case SourceSectionKind.Levels: levelToken(sol, mixedCase); return;
      case null: preludeToken(sol, mixedCase); return;
    }
  };
  for (const line of splitSourceLines(source)) {
    cursor = new SourceCursor(line);
    do {
      visitStart = cursor.index;
      try { visit(); }
      catch (error) {
        if (!(error instanceof IssueCap)) throw error;
        stop = { reason: SourceLexicalStopReason.Issues, cursor: cursor.position(), section }; break;
      }
      if (stopAtLimits && issues.errorCount > 5) { stop = { reason: SourceLexicalStopReason.Errors, cursor: cursor.position(), section }; break; }
    } while (!cursor.end);
    if (stop !== null) break;
  }
  return { ...issues, objects, metadata, objectLines, objectNameAttempts, legendWords, collisionNames,
    soundEvents: retainedSoundEvents, levelMessages, ruleNamesByLine, stop };
}
