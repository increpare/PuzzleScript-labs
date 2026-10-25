import type { SourceDiagnostic } from './source-model.js';

/** Ordered compiler issue evidence. Counts follow recorded issues, never raw visits. */
export interface SourceIssueCollection {
  readonly rawDiagnostics: SourceDiagnostic[];
  readonly diagnostics: SourceDiagnostic[];
  errorCount: number;
}

export function createSourceIssueCollection(): SourceIssueCollection {
  return { rawDiagnostics: [], diagnostics: [], errorCount: 0 };
}

export function sourceIssueLine(issue: SourceDiagnostic): number | null {
  return issue.reportedLine === undefined ? issue.span?.start.line ?? null : issue.reportedLine;
}

/** Returns true once the native global cap interrupts the current visit. */
export function collectSourceIssue(collection: SourceIssueCollection, issue: SourceDiagnostic): boolean {
  collection.rawDiagnostics.push(issue);
  if (issue.urgent !== true && collection.diagnostics.some(previous => previous.message === issue.message &&
    previous.severity === issue.severity && sourceIssueLine(previous) === sourceIssueLine(issue))) return false;
  collection.diagnostics.push(issue);
  if (issue.countsAsError) collection.errorCount++;
  return collection.diagnostics.length > 100;
}

/** A caller can observe each issue at its language operation, before recovery continues. */
export type SourceIssueReporter = (issue: SourceDiagnostic) => void;

export function appendSourceIssue(diagnostics: SourceDiagnostic[], issue: SourceDiagnostic, report?: SourceIssueReporter): void {
  diagnostics.push(issue);
  report?.(issue);
}

export class SourceIssueLimit extends Error {}
