import type { SourceDiagnostic } from './source-model.js';

/** Syntax recovery and diagnostic severity are independent decisions. */
export enum RuleRecoveryKind { Keep, Discard, KeepForDiagnostics }
export type RuleRecovery =
  { readonly kind: RuleRecoveryKind.Keep } |
  { readonly kind: RuleRecoveryKind.Discard; readonly cause: SourceDiagnostic } |
  { readonly kind: RuleRecoveryKind.KeepForDiagnostics; readonly causes: readonly SourceDiagnostic[] };

export enum RuleCompilationCheckpoint { AfterAggregateExpansion, AfterPropertyInference }
export interface RuleCompilationFailure {
  readonly checkpoint: RuleCompilationCheckpoint;
  readonly causes: readonly SourceDiagnostic[];
}

export enum RuleExpansionKind { Ready, Blocked }
