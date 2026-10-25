import type { SourceDocument, SourcePosition, SourceSectionKind } from './source-model.js';
import { readAuthoredSource } from './source-reader.js';
import type { SourceIssueCollection } from './source-diagnostics.js';
import { walkSourceLexically, SourceLexicalStopReason as SourceParserStopReason } from './source-lexical.js';
export { SourceLexicalStopReason as SourceParserStopReason } from './source-lexical.js';

export enum SourceParserOutcomeKind { Complete, Stopped }
export type SourceParserOutcome = { readonly kind: SourceParserOutcomeKind.Complete } |
  { readonly kind: SourceParserOutcomeKind.Stopped; readonly cursor: SourcePosition; readonly reason: SourceParserStopReason; readonly section: SourceSectionKind | null };
export interface SourceParseResult extends SourceIssueCollection {
  readonly document: SourceDocument;
  readonly outcome: SourceParserOutcome;
}

export function parseSource(source: string): SourceParseResult {
  const lexical = walkSourceLexically(source, true);
  const { rawDiagnostics, diagnostics, errorCount, stop } = lexical;
  return { document: readAuthoredSource(source, lexical).document, rawDiagnostics, diagnostics, errorCount,
    outcome: stop === null ? { kind: SourceParserOutcomeKind.Complete } : { kind: SourceParserOutcomeKind.Stopped, ...stop } };
}
