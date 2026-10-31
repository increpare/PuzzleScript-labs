import { SourceDiagnosticPhase, SourceDiagnosticSeverity, SourceLegendKind, SourceLevelKind, SourceLineKind, SourceRuleKind, SourceSectionKind, SourceSoundKind, SourceWinConditionKind,
  type SourceDiagnostic, type SourceDocument, type SourceEntry, type SourceGridLevel, type SourceLegend, type SourceLexicalToken, type SourceLine, type SourceObject,
  type SourceReadResult, type SourceSection, type SourceSound, type SourceSpan, type SourceSpriteRow, type SourceWinCondition, type SourceWord } from './source-model.js';
import { leadingContent, lineSpan, readComments, sourceWord, sourceWords, splitSourceLines, trimmedRange,
  type CommentState } from './source-text.js';
import { readRule } from './source-rules.js';
import { walkSourceLexically, sourceMetadataFlags as metadataFlags, sourceMetadataValues as metadataValues,
  SourceObjectLineKind, type SourceLexicalResult } from './source-lexical.js';

const sectionKinds = new Map<string, SourceSectionKind>([['objects', SourceSectionKind.Objects], ['legend', SourceSectionKind.Legend],
  ['sounds', SourceSectionKind.Sounds], ['collisionlayers', SourceSectionKind.CollisionLayers], ['rules', SourceSectionKind.Rules],
  ['winconditions', SourceSectionKind.WinConditions], ['levels', SourceSectionKind.Levels]]);

function isLevels(section: SourceSection | null): boolean { return section?.kind === SourceSectionKind.Levels; }

interface SourceHeading { name: SourceWord; kind: SourceSectionKind; trailingWords: SourceWord[] }
function sectionHeading(line: SourceLine, view: string): SourceHeading | null {
  const match = /^[\p{Z}\s]*(objects|legend|sounds|collisionlayers|rules|winconditions|levels)(?![\p{L}\p{N}_])/iu.exec(view);
  const spelling = match?.[1];
  if (match === null || spelling === undefined) return null;
  const end = match[0].length;
  const name = sourceWord(line, end - spelling.length, end);
  const kind = sectionKinds.get(name.normalized);
  return kind === undefined ? null : { name, kind, trailingWords: sourceWords(line, ' '.repeat(end) + view.slice(end)) };
}

function reuseLexicalWords(tokens: readonly SourceLexicalToken[], words: readonly SourceWord[]): SourceLexicalToken[] {
  return tokens.map(token => ({ value: token.value, word: words.find(word => word.span.start.offset === token.word.span.start.offset &&
    word.span.end.offset === token.word.span.end.offset) ?? token.word }));
}

function readLegend(entry: SourceEntry, words: readonly SourceWord[], tokens: readonly SourceLexicalToken[]): SourceLegend {
  const equals = words.findIndex(word => word.normalized === '=');
  const members = equals < 0 ? [] : words.slice(equals + 1);
  const references = members.filter((_, index) => index % 2 === 0);
  const operators = members.filter((_, index) => index % 2 === 1);
  let kind = SourceLegendKind.Invalid;
  if (equals === 1 && members.length > 0 && members.length % 2 === 1 && !members.some(word => word.normalized === '=')) {
    if (operators.length === 0) kind = SourceLegendKind.Synonym;
    else if (operators.every(operator => operator.normalized === 'or')) kind = SourceLegendKind.Property;
    // Native recovery keeps an aggregate once the first operator is AND, even
    // when a later operator is malformed. Retain that meaning and diagnose it.
    else if (operators[0]?.normalized === 'and') kind = SourceLegendKind.Aggregate;
  }
  return { ...entry, kind, name: equals === 0 ? null : words[0] ?? null, words,
    definitionWords: reuseLexicalWords(tokens, words), references, operators };
}

const soundEvents = new Set(['undo', 'restart', 'titlescreen', 'startgame', 'cancel', 'endgame', 'startlevel', 'endlevel', 'showmessage', 'closemessage',
  ...Array.from({ length: 11 }, (_, index) => `sfx${index}`)]);
const soundActions = new Set(['move', 'action', 'create', 'destroy', 'cantmove']);
const soundDirections = new Set(['up', 'down', 'left', 'right', 'horizontal', 'vertical', 'orthogonal']);

function readSound(entry: SourceEntry, words: readonly SourceWord[], eventToken: SourceLexicalToken | undefined): SourceSound {
  const eventDefinition = eventToken === undefined ? null : reuseLexicalWords([eventToken], words)[0]!;
  const first = words[0] ?? null;
  const event = first !== null && soundEvents.has(first.normalized) ? first : null;
  const target = event === null ? first : null;
  const action = event === null ? words[1] ?? null : null;
  const possibleSeed = words[words.length - 1] ?? null;
  const seed = possibleSeed !== null && /^\d+$/u.test(possibleSeed.normalized) ? possibleSeed : null;
  const directions = event === null ? words.slice(2, seed === null ? words.length : -1) : [];
  if (event !== null && seed !== null && words.length === 2) return { ...entry, eventDefinition, kind: SourceSoundKind.Event, words, directions, event, target: null, action: null, seed };
  if (target !== null && action !== null && seed !== null && soundActions.has(action.normalized) &&
    directions.every(direction => soundDirections.has(direction.normalized)) && (directions.length === 0 || ['move', 'cantmove'].includes(action.normalized))) {
    return { ...entry, eventDefinition, kind: SourceSoundKind.Target, words, directions, event: null, target, action, seed };
  }
  return { ...entry, eventDefinition, kind: SourceSoundKind.Invalid, words, directions, event, target, action, seed };
}

function readWinCondition(entry: SourceEntry, words: readonly SourceWord[]): SourceWinCondition {
  const quantifier = words[0] ?? null;
  const subject = words[1] ?? null;
  const on = words[2] ?? null;
  const target = words[3] ?? null;
  const valid = quantifier !== null && ['all', 'any', 'some', 'no'].includes(quantifier.normalized) && subject !== null &&
    (words.length === 2 || (words.length === 4 && on?.normalized === 'on'));
  return { ...entry, kind: valid ? SourceWinConditionKind.Valid : SourceWinConditionKind.Invalid, words, quantifier, subject, on, target };
}

function spriteRow(line: SourceLine, view: string): SourceSpriteRow {
  const range = trimmedRange(view);
  const glyphs: SourceWord[] = [];
  for (let index = range.start; index < range.end; index++) if (!/[\p{Z}\s]/u.test(view.charAt(index))) glyphs.push(sourceWord(line, index, index + 1));
  return { text: glyphs.map(glyph => glyph.spelling).join(''), glyphs, span: lineSpan(line, range.start, range.end), original: line.original };
}

function readColors(line: SourceLine, view: string): SourceWord[] {
  const color = /(?:black|white|gray|darkgray|lightgray|grey|darkgrey|lightgrey|red|darkred|lightred|brown|darkbrown|lightbrown|orange|yellow|green|darkgreen|lightgreen|blue|lightblue|darkblue|purple|pink|transparent|#(?:[0-9a-f]{3}){1,2})/iyu;
  const colors: SourceWord[] = [];
  for (let index = 0; index < view.length;) {
    if (/[\p{Z}\s]/u.test(view.charAt(index))) { index++; continue; }
    color.lastIndex = index;
    const match = color.exec(view);
    const start = index;
    if (match !== null) index += match[0].length;
    else while (index < view.length && !/[\p{Z}\s]/u.test(view.charAt(index))) index++;
    colors.push(sourceWord(line, start, index));
  }
  return colors;
}

enum ObjectReadingPart { Names, Colors, Sprite }
interface ObjectReadingState {
  part: ObjectReadingPart;
  source: SourceObject | null;
}
function emptyObjectReadingState(): ObjectReadingState {
  return { part: ObjectReadingPart.Names, source: null };
}

/** Read authored source without resolving names or constructing executable rules. */
export function readSource(source: string): SourceReadResult {
  return readAuthoredSource(source, walkSourceLexically(source, false));
}

/** Build full authored evidence around a complete or stopped shared lexical walk. */
export function readAuthoredSource(source: string, lexical: SourceLexicalResult): SourceReadResult {
  const document: SourceDocument = { source, lines: splitSourceLines(source), sections: [], metadata: [], comments: [], levels: [],
    objects: [], legend: [], sounds: [], collisionLayers: [], winConditions: [], rules: [] };
  const diagnostics: SourceDiagnostic[] = [];
  const comments: CommentState = { comments: document.comments, stack: [] };
  const issue = (code: string, message: string, span: SourceSpan, severity = SourceDiagnosticSeverity.Error): void => {
    diagnostics.push({ code, message, span, severity, countsAsError: severity === SourceDiagnosticSeverity.Error, phase: SourceDiagnosticPhase.Reader });
  };
  let section: SourceSection | null = null;
  let grid: SourceGridLevel | null = null;
  let objectReading = emptyObjectReadingState();
  let order = 0;
  for (const line of document.lines) {
    const startsInsideComment = comments.stack.length > 0;
    const content = leadingContent(line, comments.stack.length);
    const contentStart = content.start;
    const levelMessage = isLevels(section) ? /^message/iu.exec(line.original.slice(contentStart)) : null;
    const activeHeading: SourceHeading | null = isLevels(section) ? null : sectionHeading(line, ' '.repeat(contentStart) + line.original.slice(contentStart));
    const declaredNames = lexical.ruleNamesByLine.get(line.span.start.line) ?? new Set<string>();
    const ruleNames = section?.kind === SourceSectionKind.Rules && activeHeading === null ? declaredNames : undefined;
    const view = readComments(line, comments, diagnostics, levelMessage === null ? undefined : contentStart + levelMessage[0].length, ruleNames);
    const words = sourceWords(line, view);
    const first = words[0];
    line.sectionId = section?.id ?? null;
    if (first === undefined) {
      line.kind = !startsInsideComment && line.original.trim() === '' ? SourceLineKind.Blank : SourceLineKind.Comment;
      if (line.kind === SourceLineKind.Blank) { grid = null; objectReading = emptyObjectReadingState(); }
      section?.lines.push(line);
      continue;
    }
    const separatorText = isLevels(section) ? line.original.slice(contentStart) : view;
    if (/^[=\p{Z}\s]+$/u.test(separatorText) || (!isLevels(section) && /^[\p{Z}\s]*=/u.test(view))) {
      line.kind = SourceLineKind.Separator;
      if (!/^[=\p{Z}\s]+$/u.test(view)) issue('separator-trailing-text', 'Only comments may follow a section separator.', line.span);
    } else {
      const heading: SourceHeading | null = isLevels(section) ? null : sectionHeading(line, view);
      if (heading !== null) {
        if (document.sections.some(previous => previous.kind === heading.kind)) issue('duplicate-section', `Section ${heading.name.spelling} is repeated.`, heading.name.span);
        if (heading.trailingWords.length > 0) issue('heading-trailing-text', 'Only comments may follow a section heading.', line.span);
        line.kind = SourceLineKind.Heading;
        section = { id: document.sections.length, kind: heading.kind, name: heading.name, heading: line, trailingWords: heading.trailingWords, lines: [] };
        document.sections.push(section);
        grid = null;
        objectReading = emptyObjectReadingState();
      } else {
        line.kind = SourceLineKind.Entry;
        if (section === null) {
          const prefix = /^[\p{L}\p{N}_]+/u.exec(first.spelling)?.[0];
          const key = prefix === undefined ? first : sourceWord(line, first.span.start.column - 1, first.span.start.column - 1 + prefix.length);
          const commentStart = line.original.indexOf('(', key.span.end.column - 1);
          const range = trimmedRange(line.original, key.span.end.column - 1, commentStart < 0 ? line.original.length : commentStart);
          const authoredValue = line.original.slice(range.start, range.end);
          const flag = metadataFlags.has(key.normalized);
          const known = flag || metadataValues.has(key.normalized);
          const accepted = lexical.metadata.find(entry => entry.key.word.span.start.offset === key.span.start.offset);
          document.metadata.push({ key, authoredValue, accepted: accepted !== undefined,
            value: accepted?.value ?? (flag ? 'true' : ['title', 'author', 'homepage'].includes(key.normalized) ? authoredValue : authoredValue.toLowerCase()), span: line.span });
          if (!known) { line.kind = SourceLineKind.Invalid; issue('unknown-metadata', `Unknown metadata ${key.spelling}.`, key.span); }
          else if (!flag && authoredValue === '') issue('metadata-value-missing', `Metadata ${key.spelling} needs a value.`, key.span);
        } else if (section.kind === SourceSectionKind.Objects) {
          const object = objectReading.source;
          // Invalid authored primaries still retain their following color line
          // as authored evidence even though native never accepted that object.
          const objectLine = object?.validPrimaryName === false ? undefined : lexical.objectLines.get(line.span.start.line);
          if (object !== null && (objectLine?.kind === SourceObjectLineKind.Colors ||
            objectLine === undefined && objectReading.part === ObjectReadingPart.Colors)) {
            const authoredColors = readColors(line, view);
            object.colors.push(...authoredColors);
            object.colorLine ??= line;
            object.span = { start: object.span.start, end: line.span.end };
            objectReading.part = ObjectReadingPart.Sprite;
          } else if (object !== null && (objectLine?.kind === SourceObjectLineKind.Sprite ||
            objectLine === undefined && objectReading.part === ObjectReadingPart.Sprite &&
            ((object.spriteRows?.length ?? 0) > 0 || /^[.\d]/u.test(view.trim())))) {
            object.spriteRows ??= [];
            const row = spriteRow(line, view);
            object.spriteRows.push(row);
            object.span = { start: object.span.start, end: line.span.end };
            // Completion follows the fifth row reaching five pixels; earlier malformed rows remain authored evidence.
            if (objectLine?.completedSprite || objectLine === undefined && object.spriteRows.length === 5 && row.text.length >= 5) {
              objectReading = { source: object, part: objectLine?.awaitingColors ? ObjectReadingPart.Colors : ObjectReadingPart.Names };
            }
          } else {
            const primaryPrefix = /^[\p{L}\p{N}_]+/u.exec(first.spelling)?.[0];
            const validPrimaryName = primaryPrefix !== undefined;
            const primaryName = primaryPrefix === undefined ? first : sourceWord(line, first.span.start.column - 1, first.span.start.column - 1 + primaryPrefix.length);
            const aliases = words.slice(1);
            if (primaryName.span.end.offset < first.span.end.offset) aliases.unshift(sourceWord(line, primaryName.span.end.column - 1, first.span.end.column - 1));
            const definitionNames = reuseLexicalWords(lexical.objectNameAttempts.get(line.span.start.line) ?? [], [primaryName, ...aliases]);
            const sourceObject: SourceObject = { sectionId: section.id, order: order++, span: line.span, primaryName, validPrimaryName,
              aliases, definitionNames, nameLine: line, colorLine: null, colors: [], definitionColors: [], spriteRows: null, definitionSpriteRows: [] };
            document.objects.push(sourceObject);
            objectReading = { part: ObjectReadingPart.Colors, source: sourceObject };
            if (!validPrimaryName) { line.kind = SourceLineKind.Invalid; issue('invalid-object-name', 'Primary object names must contain letters, numbers or underscores.', first.span); }
          }
        } else if (section.kind === SourceSectionKind.Legend) {
          const legend = readLegend({ sectionId: section.id, order: order++, span: line.span }, sourceWords(line, view, /[^=\p{Z}\s]+|=/gu),
            lexical.legendWords.get(line.span.start.line) ?? []);
          document.legend.push(legend);
          if (legend.kind === SourceLegendKind.Invalid) { line.kind = SourceLineKind.Invalid; issue('invalid-legend', 'Expected a name, =, and a synonym or an expression using only and or only or.', line.span); }
          if (legend.kind === SourceLegendKind.Aggregate) for (const operator of legend.operators) {
            if (operator.normalized !== 'and') issue('invalid-legend-operator', 'Expected AND throughout an aggregate declaration.', operator.span);
          }
        } else if (section.kind === SourceSectionKind.Sounds) {
          const sound = readSound({ sectionId: section.id, order: order++, span: line.span }, words, lexical.soundEvents.get(line.span.start.line));
          document.sounds.push(sound);
          if (sound.kind === SourceSoundKind.Invalid) { line.kind = SourceLineKind.Invalid; issue('invalid-sound', 'Expected a sound event and seed or a target, action, optional directions and seed.', line.span); }
        } else if (section.kind === SourceSectionKind.CollisionLayers) {
          const names = sourceWords(line, view, /[\p{L}\p{N}_]+/gu);
          document.collisionLayers.push({ sectionId: section.id, order: order++, span: line.span, names, words,
            definitionNames: reuseLexicalWords(lexical.collisionNames.get(line.span.start.line) ?? [], names) });
        } else if (section.kind === SourceSectionKind.Rules) {
          const rule = readRule(line, line.original, { sectionId: section.id, order: order++, span: line.span }, declaredNames, issue);
          document.rules.push(rule);
          if (rule.kind === SourceRuleKind.Invalid) line.kind = SourceLineKind.Invalid;
        } else if (section.kind === SourceSectionKind.WinConditions) {
          const win = readWinCondition({ sectionId: section.id, order: order++, span: line.span }, words);
          document.winConditions.push(win);
          if (win.kind === SourceWinConditionKind.Invalid) { line.kind = SourceLineKind.Invalid; issue('invalid-win-condition', 'Expected a quantifier and subject, optionally followed by on and a target.', line.span); }
        } else if (section.kind === SourceSectionKind.Levels) {
          if (levelMessage !== null) {
            const keywordEnd = contentStart + levelMessage[0].length;
            const keywordStart = keywordEnd - 'message'.length;
            const range = trimmedRange(line.original, keywordEnd);
            const authoredText = line.original.slice(range.start, range.end);
            document.levels.push({ kind: SourceLevelKind.Message, sectionId: section.id, order: order++, span: line.span,
              keyword: sourceWord(line, keywordStart, keywordEnd), authoredText,
              text: lexical.levelMessages.get(line.span.start.line) ?? authoredText, textSpan: lineSpan(line, range.start, range.end) });
            grid = null;
          } else {
            const commentStart = line.original.indexOf('(', contentStart);
            const range = trimmedRange(line.original, contentStart, commentStart < 0 ? line.original.length : commentStart);
            if (grid === null) {
              grid = { kind: SourceLevelKind.Grid, sectionId: section.id, order: order++, span: line.span, rows: [] };
              document.levels.push(grid);
            }
            grid.rows.push({ original: line.original, text: line.original.slice(range.start, range.end), span: lineSpan(line, range.start, range.end),
              glyphs: Array.from({ length: range.end - range.start }, (_, index) => sourceWord(line, range.start + index, range.start + index + 1)) });
            grid.span = { start: grid.span.start, end: line.span.end };
          }
        }
      }
    }
    line.sectionId = section?.id ?? null;
    if (line.kind !== SourceLineKind.Heading) section?.lines.push(line);
  }
  const finalLine = document.lines[document.lines.length - 1];
  if (finalLine !== undefined) for (const comment of comments.stack) {
    comment.span = { start: comment.span.start, end: finalLine.span.end };
    issue('unclosed-comment', 'Comment has no closing parenthesis.', comment.span);
  }
  for (const object of document.objects) {
    const accepted = lexical.objects.find(entry => entry.primary.word.span.start.offset === object.primaryName.span.start.offset);
    if (accepted === undefined) {
      if (lexical.stop !== null) object.definitionNames.splice(0);
      continue;
    }
    const words = [object.primaryName, ...object.aliases, ...object.colors, ...(object.spriteRows ?? []).flatMap(row => row.glyphs)];
    object.definitionNames.splice(0, object.definitionNames.length, ...reuseLexicalWords(accepted.names, words));
    object.definitionColors.push(...reuseLexicalWords(accepted.colors, words));
    object.definitionSpriteRows.push(...accepted.rows.map(row => reuseLexicalWords(row, words)));
  }
  return { document, diagnostics };
}
