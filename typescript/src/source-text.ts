import { SourceDiagnosticPhase, SourceDiagnosticSeverity, SourceLineKind, type SourceComment,
  type SourceDiagnostic, type SourceLine, type SourceSpan, type SourceWord } from './source-model.js';

export function splitSourceLines(source: string): SourceLine[] {
  let offset = 0;
  return source.split('\n').map((original, index) => {
    const line: SourceLine = { original, kind: SourceLineKind.Blank, sectionId: null,
      span: { start: { offset, line: index + 1, column: 1 }, end: { offset: offset + original.length, line: index + 1, column: original.length + 1 } } };
    offset += original.length + 1;
    return line;
  });
}

export function lineSpan(line: SourceLine, start: number, end: number): SourceSpan {
  return { start: { offset: line.span.start.offset + start, line: line.span.start.line, column: start + 1 },
    end: { offset: line.span.start.offset + end, line: line.span.start.line, column: end + 1 } };
}

export function sourceWord(line: SourceLine, start: number, end: number): SourceWord {
  const spelling = line.original.slice(start, end);
  return { spelling, normalized: spelling.toLowerCase(), span: lineSpan(line, start, end) };
}

/** Tokenize an offset-preserving view; spellings always come from the original line. */
export function sourceWords(line: SourceLine, view: string, pattern = /[^\p{Z}\s]+/gu): SourceWord[] {
  return Array.from(view.matchAll(pattern), match => sourceWord(line, match.index, match.index + match[0].length));
}

export interface LowercaseSourceView {
  readonly value: string;
  /** Each normalized UTF-16 unit points to the complete authored code point that produced it. */
  readonly authoredRanges: readonly { readonly start: number; readonly end: number }[];
}

/** Lowercase the complete selected substring; mapped offsets remain relative to the physical line. */
export function lowercaseSourceRange(line: SourceLine, start: number, end: number): LowercaseSourceView {
  const authored = line.original.slice(start, end);
  const value = authored.toLowerCase();
  const authoredRanges: { start: number; end: number }[] = [];
  let authoredOffset = start;
  let normalizedOffset = 0;
  for (const character of authored) {
    const authoredEnd = authoredOffset + character.length;
    // Context changes the value of Greek sigma, so values must come from the
    // complete substring. Per-code-point lowercasing supplies only the output length.
    const length = character.toLowerCase().length;
    for (let index = 0; index < length; index++) authoredRanges.push({ start: authoredOffset, end: authoredEnd });
    authoredOffset = authoredEnd;
    normalizedOffset += length;
  }
  if (normalizedOffset !== value.length) throw new Error('Lowercase length does not match the authored offset map.');
  return { value, authoredRanges };
}

/** Lowercase the physical line before hiding comments, retaining an authored offset map. */
export function lowercaseSourceView(line: SourceLine, view: string): LowercaseSourceView {
  const normalized = lowercaseSourceRange(line, 0, line.original.length);
  const visible = normalized.value.split('').map((unit, index) => {
    const range = normalized.authoredRanges[index]!;
    return view.slice(range.start, range.end) === line.original.slice(range.start, range.end) ? unit : ' ';
  });
  return { value: visible.join(''), authoredRanges: normalized.authoredRanges };
}

export interface CommentState { readonly comments: SourceComment[]; readonly stack: SourceComment[] }

/** Leading comments preserve logical SOL; an unmatched close consumes that visit. */
export function leadingContent(line: SourceLine, initialCommentDepth: number): { readonly start: number; readonly startOfLine: boolean } {
  let depth = initialCommentDepth;
  let startOfLine = true;
  for (let index = 0; index < line.original.length; index++) {
    const character = line.original.charAt(index);
    if (character === '(') depth++;
    else if (character === ')') {
      if (depth > 0) depth--;
      else startOfLine = false;
    } else if (depth === 0 && !/[\p{Z}\s]/u.test(character)) return { start: index, startOfLine };
  }
  return { start: line.original.length, startOfLine };
}

/** Look only through leading whitespace/comments; message payloads after this point may be literal. */
export function leadingContentStart(line: SourceLine, initialCommentDepth: number): number {
  return leadingContent(line, initialCommentDepth).start;
}

/** Replace comment code units by spaces so surviving tokens retain their exact offsets.
 * In rules, the lexical word reader consumes embedded parentheses and MESSAGE consumes the remaining physical line.
 */
export function readComments(line: SourceLine, state: CommentState, diagnostics: SourceDiagnostic[], literalFrom = line.original.length,
  ruleNames?: ReadonlySet<string>): string {
  const view = line.original.split('');
  for (let index = 0; index < literalFrom; index++) {
    const character = line.original.charAt(index);
    if (ruleNames !== undefined && state.stack.length === 0 && !/[\p{Z}\s\[\]|+()]/u.test(character)) {
      if (line.original.startsWith('->', index)) { index++; continue; }
      let end = index + 1;
      while (end < literalFrom && !/[\p{Z}\s\[\]|]/u.test(line.original.charAt(end))) end++;
      const word = line.original.slice(index, end).toLowerCase();
      if (word === 'message' && !ruleNames.has(word)) break;
      index = end - 1;
      continue;
    }
    if (character === '(') {
      const comment: SourceComment = { span: lineSpan(line, index, line.original.length), depth: state.stack.length + 1, closed: false };
      state.comments.push(comment);
      state.stack.push(comment);
      view[index] = ' ';
    } else if (character === ')') {
      const comment = state.stack.pop();
      if (comment === undefined) diagnostics.push({ code: 'unmatched-comment-close', message: 'Closing comment has no matching opening parenthesis.',
        severity: SourceDiagnosticSeverity.Warning, countsAsError: false, phase: SourceDiagnosticPhase.Reader, span: lineSpan(line, index, index + 1) });
      else { comment.span = { start: comment.span.start, end: lineSpan(line, index, index + 1).end }; comment.closed = true; }
      view[index] = ' ';
    } else if (state.stack.length > 0) view[index] = ' ';
  }
  return view.join('');
}

export function trimmedRange(view: string, start = 0, end = view.length): { start: number; end: number } {
  while (start < end && /[\p{Z}\s]/u.test(view.charAt(start))) start++;
  while (end > start && /[\p{Z}\s]/u.test(view.charAt(end - 1))) end--;
  return { start, end };
}
