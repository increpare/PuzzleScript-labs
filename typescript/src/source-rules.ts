import { SourceDiagnosticSeverity, SourceRuleCellKind, SourceRuleCommandKind, SourceRuleKind,
  type SourceEntry, type SourceLine, type SourceRule, type SourceRuleCell, type SourceRuleCommand, type SourceRuleRow,
  type SourceRuleTerm, type SourceSpan, type SourceWord } from './source-model.js';
import { lineSpan, sourceWord, trimmedRange } from './source-text.js';

const qualifiers = new Set(['up', 'down', 'left', 'right', '^', 'v', '<', '>', 'moving', 'stationary', 'parallel', 'perpendicular',
  'horizontal', 'vertical', 'orthogonal', 'no', 'randomdir', 'random', 'action']);
const prefixes = new Set(['+', 'up', 'down', 'left', 'right', 'horizontal', 'vertical', 'orthogonal', 'moving', 'late', 'rigid', 'random']);
const commands = new Map<string, SourceRuleCommandKind>([['cancel', SourceRuleCommandKind.Cancel], ['checkpoint', SourceRuleCommandKind.Checkpoint],
  ['restart', SourceRuleCommandKind.Restart], ['win', SourceRuleCommandKind.Win], ['message', SourceRuleCommandKind.Message], ['again', SourceRuleCommandKind.Again],
  ...Array.from({ length: 11 }, (_, index): [string, SourceRuleCommandKind] => [`sfx${index}`, SourceRuleCommandKind.SoundEffect])]);

function legacyCaptureRange(line: SourceLine): { start: number; end: number } {
  const match = /[^(]+/u.exec(line.original);
  return match === null ? { start: line.original.length, end: line.original.length } : { start: match.index, end: match.index + match[0].length };
}

/** Brackets, pipes, arrows and a leading '+' are boundaries; '>Player' stays one word. */
function wordsInRange(line: SourceLine, start: number, end: number): SourceWord[] {
  const words: SourceWord[] = [];
  let index = start;
  while (index < end) {
    if (/[\p{Z}\s]/u.test(line.original.charAt(index))) { index++; continue; }
    const start = index;
    if ('[]|'.includes(line.original.charAt(index)) || (words.length === 0 && line.original.charAt(index) === '+')) index++;
    else if (line.original.startsWith('->', index)) index += 2;
    else {
      while (index < end && !/[\p{Z}\s\[\]|]/u.test(line.original.charAt(index)) && !line.original.startsWith('->', index)) index++;
    }
    words.push(sourceWord(line, start, index));
  }
  return words;
}

export function ruleWords(line: SourceLine): SourceWord[] {
  const range = legacyCaptureRange(line);
  return wordsInRange(line, range.start, range.end);
}

function messageWordIndex(words: readonly SourceWord[], declaredNames: ReadonlySet<string>): number {
  const firstBracket = words.findIndex(word => word.normalized === '[');
  return firstBracket < 0 ? -1 : words.findIndex((word, index) => index > firstBracket && word.normalized === 'message' && !declaredNames.has(word.normalized));
}

export type RuleIssue = (code: string, message: string, span: SourceSpan, severity?: SourceDiagnosticSeverity) => void;

function readCell(words: readonly SourceWord[], span: SourceSpan, issue: RuleIssue, authoredWords = words): SourceRuleCell {
  const ellipsis = words.some(word => word.normalized === '...');
  if (ellipsis && words.length === 1) return { kind: SourceRuleCellKind.Ellipsis, words: authoredWords, terms: [], span };
  const terms: SourceRuleTerm[] = [];
  let invalid = ellipsis;
  if (ellipsis) issue('mixed-ellipsis-cell', 'An ellipsis must occupy its own cell.', span);
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (word === undefined || word.normalized === '...') continue;
    if (qualifiers.has(word.normalized)) {
      const next = words[index + 1];
      const name = next !== undefined && !qualifiers.has(next.normalized) && next.normalized !== '...' ? next : null;
      if (name === null) { invalid = true; issue('rule-qualifier-without-name', 'A qualifier needs an object or legend name.', word.span); }
      else index++;
      terms.push({ qualifier: word, name, words: name === null ? [word] : [word, name], span: { start: word.span.start, end: name?.span.end ?? word.span.end } });
    } else terms.push({ qualifier: null, name: word, words: [word], span: word.span });
  }
  return { kind: invalid ? SourceRuleCellKind.Invalid : SourceRuleCellKind.Contents, words: authoredWords, terms, span };
}

function readRow(line: SourceLine, words: readonly SourceWord[], start: number, issue: RuleIssue,
  takeCommand: (word: SourceWord) => boolean): { row: SourceRuleRow; next: number } {
  const openingBracket = words[start];
  if (openingBracket === undefined) throw new Error('A rule row needs its opening bracket.');
  const cells: SourceRuleCell[] = [];
  let contents: SourceWord[] = [];
  let authoredWords: SourceWord[] = [];
  let cellStart = openingBracket.span.end;
  let closingBracket: SourceWord | null = null;
  let index = start + 1;
  for (; index < words.length; index++) {
    const word = words[index];
    if (word === undefined) continue;
    if (word.normalized === '|' || word.normalized === ']') {
      cells.push(readCell(contents, { start: cellStart, end: word.span.start }, issue, authoredWords));
      contents = [];
      authoredWords = [];
      cellStart = word.span.end;
      if (word.normalized === ']') { closingBracket = word; index++; break; }
    } else {
      if (word.normalized === '[' || word.normalized === '->') issue('unexpected-rule-boundary', 'A rule row cannot contain a nested bracket or arrow.', word.span);
      authoredWords.push(word);
      if (!takeCommand(word)) contents.push(word);
    }
  }
  if (closingBracket === null) {
    const end = words[words.length - 1]?.span.end ?? openingBracket.span.end;
    cells.push(readCell(contents, { start: cellStart, end }, issue, authoredWords));
    issue('unclosed-rule-row', 'Rule row has no closing bracket.', openingBracket.span);
  }
  return { row: { openingBracket, closingBracket, cells,
    span: { start: openingBracket.span.start, end: closingBracket?.span.end ?? words[words.length - 1]?.span.end ?? line.span.end } }, next: index };
}

export function readRule(line: SourceLine, compilerLine: string, entry: SourceEntry, declaredNames: ReadonlySet<string>, report: RuleIssue): SourceRule {
  const tokens = ruleWords(line);
  const captured = legacyCaptureRange(line);
  const base = { ...entry, originalLine: line, compilerLine, legacyCapturedText: line.original.slice(captured.start, captured.end).toLowerCase(),
    legacyCapturedSpan: lineSpan(line, captured.start, captured.end), tokens };
  const marker = tokens[0];
  if (tokens.length === 1 && marker !== undefined && ['startloop', 'endloop'].includes(marker.normalized)) {
    return { ...base, kind: marker.normalized === 'startloop' ? SourceRuleKind.StartLoop : SourceRuleKind.EndLoop, marker };
  }
  let invalid = false;
  const issue: RuleIssue = (code, message, span, severity = SourceDiagnosticSeverity.Error) => {
    if (severity === SourceDiagnosticSeverity.Error) invalid = true;
    report(code, message, span, severity);
  };
  const firstBracket = tokens.findIndex(word => word.normalized === '[');
  const prefixWords = firstBracket < 0 ? tokens : tokens.slice(0, firstBracket);
  for (const word of prefixWords) if (!prefixes.has(word.normalized)) issue('invalid-rule-prefix', 'Unexpected rule prefix word.', word.span);
  const lhs: SourceRuleRow[] = [];
  const rhs: SourceRuleRow[] = [];
  const ruleCommands: SourceRuleCommand[] = [];
  const trailingWords: SourceWord[] = [];
  let arrow: SourceWord | null = null;
  const takeCommand = (word: SourceWord, insideRow: boolean): boolean => {
    const command = declaredNames.has(word.normalized) ? undefined : commands.get(word.normalized);
    if (command === undefined || command === SourceRuleCommandKind.Message || firstBracket < 0) return false;
    ruleCommands.push({ kind: command, word });
    if (arrow === null) issue('command-before-arrow', 'Commands follow the rule arrow.', word.span);
    else if (insideRow) issue('command-inside-row', 'Commands should follow the replacement rows.', word.span, SourceDiagnosticSeverity.Warning);
    return true;
  };
  const messageIndex = messageWordIndex(tokens, declaredNames);
  const words = messageIndex < 0 ? tokens : tokens.slice(0, messageIndex);
  if (firstBracket < 0) issue('rule-row-missing', 'A rule needs a bracketed pattern.', line.span);
  for (let index = Math.max(0, firstBracket); index < words.length;) {
    const word = words[index];
    if (word === undefined) { index++; continue; }
    if (word.normalized === '[') {
      const parsed = readRow(line, words, index, issue, word => takeCommand(word, true));
      (arrow === null ? lhs : rhs).push(parsed.row);
      index = parsed.next;
    } else if (word.normalized === '->') {
      if (arrow !== null) issue('duplicate-rule-arrow', 'A rule can have only one arrow.', word.span);
      else arrow = word;
      index++;
    } else {
      if (!takeCommand(word, false)) { trailingWords.push(word); issue('unexpected-rule-word', 'Unexpected word outside a rule row.', word.span); }
      index++;
    }
  }
  const message = tokens[messageIndex];
  if (message !== undefined) {
    const range = trimmedRange(line.original, message.span.end.column - 1);
    const authoredPayload = line.original.slice(range.start, range.end);
    ruleCommands.push({ kind: SourceRuleCommandKind.Message, word: message, authoredPayload, legacyPayload: authoredPayload === '' ? ' ' : authoredPayload,
      payloadSpan: lineSpan(line, range.start, range.end) });
    if (arrow === null) issue('command-before-arrow', 'Commands follow the rule arrow.', message.span);
  }
  if (arrow === null) issue('rule-arrow-missing', 'A rule needs an arrow between its before and after parts.', line.span);
  else if (rhs.length === 0 && ruleCommands.length === 0) issue('rule-consequence-missing', 'A rule needs a replacement or a command after its arrow.', arrow.span);
  if (lhs.length === 0) issue('rule-pattern-missing', 'A rule needs a pattern before its arrow.', line.span);
  return { ...base, kind: invalid ? SourceRuleKind.Invalid : SourceRuleKind.Ordinary, prefixWords, lhs, rhs, arrow, commands: ruleCommands, trailingWords };
}
