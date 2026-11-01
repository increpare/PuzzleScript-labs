import type { SourceLexicalToken, SourceLine, SourceRule, SourceSpan } from './source-model.js';
import { lowercaseSourceRange, sourceWord } from './source-text.js';

/** Scan the native capture once, before rule parsing, retaining authored UTF-16 evidence. */
export function scanRuleTokens(line: SourceLine, capturedSpan: SourceSpan): readonly SourceLexicalToken[] {
  const normalized = lowercaseSourceRange(line,
    capturedSpan.start.offset - line.span.start.offset,
    capturedSpan.end.offset - line.span.start.offset);
  const tokens: SourceLexicalToken[] = [];
  let index = 0;
  while (index < normalized.value.length) {
    // Native tokenizeRuleLine uses ECMAScript whitespace, including trim's leading whitespace.
    if (/\s/.test(normalized.value.charAt(index))) { index++; continue; }
    const start = index;
    if ('[]|'.includes(normalized.value.charAt(index)) || (tokens.length === 0 && normalized.value.charAt(index) === '+')) index++;
    else if (normalized.value.startsWith('->', index)) index += 2;
    else {
      while (index < normalized.value.length && !/[\s\[\]|]/.test(normalized.value.charAt(index))
        && !normalized.value.startsWith('->', index)) index++;
    }
    const authoredStart = normalized.authoredRanges[start]!.start;
    const authoredEnd = normalized.authoredRanges[index - 1]!.end;
    const word = sourceWord(line, authoredStart, authoredEnd);
    tokens.push({ value: normalized.value.slice(start, index), word });
  }
  return tokens;
}

/** Compatibility accessor: compilation and callers share the already-scanned tokens. */
export function compilerRuleTokens(source: SourceRule): readonly SourceLexicalToken[] {
  return source.lexicalTokens;
}

/** Match the native normalized search cursor, then slice its full compiler line at that same UTF-16 index. */
export function compilerMessagePayload(source: Pick<SourceRule, 'compilerLine'>, tokens: readonly SourceLexicalToken[], messageIndex: number): string {
  const compilerLine = source.compilerLine;
  const lowercase = compilerLine.toLowerCase();
  let cursor = 0;
  for (let index = 0; index <= messageIndex; index++) {
    const token = tokens[index]!.value;
    // Keep indexOf's -1 arithmetic: malformed/repeated tokens need not have a successful match.
    cursor = lowercase.indexOf(token, cursor) + token.length;
  }
  // Lowercase expansion can move this cursor past the authored message word.
  // That offset mismatch is native behavior; an authored token span would change the payload.
  return compilerLine.substring(cursor).trim() || ' ';
}
