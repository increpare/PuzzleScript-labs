import type { SourceIssueReporter } from './source-diagnostics.js';
import type { SourceLoopMarker } from './source-model.js';
import type { ResolvedDeclarations } from './declaration-model.js';
import { normalizeRuleDuplicates } from './rule-duplicates.js';
import { lowerRules } from './rule-lowering.js';
import type { Quirks } from './compatibility.js';
import { expandRuleMovements } from './rule-movements.js';
import { expandRuleAggregates, substituteRuleSynonyms } from './rule-names.js';
import { checkEarlyNegativeTerms } from './rule-negatives.js';
import { orientRule } from './rule-orientations.js';
import { expandRuleProperties } from './rule-properties.js';
import { inferSpawnedStationary } from './rule-spawns.js';
import { recoverRuleSyntax } from './rule-syntax.js';
import type { SourceDiagnostic, SourceDocument } from './source-model.js';
import type { DirectedNamedRule, MovementRule, OrientedQualifier, OrientedRule } from './source-rule-model.js';
import { compileRuleSchedules } from './source-rule-schedules.js';
import type { TurnRulesGame } from './turn-rules.js';
import { RuleCompilationCheckpoint, RuleExpansionKind, type RuleCompilationFailure } from './rule-recovery.js';

export type CompiledRuleData = Pick<TurnRulesGame, 'earlyRules' | 'lateRules' | 'rigid' | 'rigidMerges'>;
interface RuleExpansionBase {
  readonly loops: readonly SourceLoopMarker[];
  readonly diagnostics: readonly SourceDiagnostic[];
}
export type RuleExpansionResult = RuleExpansionBase & (
  { readonly kind: RuleExpansionKind.Ready; readonly rules: readonly MovementRule[] } |
  { readonly kind: RuleExpansionKind.Blocked; readonly failure: RuleCompilationFailure }
);

/** Compile authored rules with one canonical declaration result and native checkpoints. */
export function expandSourceRules(document: SourceDocument, declarations: ResolvedDeclarations, report?: SourceIssueReporter): RuleExpansionResult {
  const syntax = recoverRuleSyntax(document, declarations, report);
  const negatives = checkEarlyNegativeTerms(syntax.rules, declarations, report);
  const diagnostics = [...syntax.diagnostics, ...negatives.diagnostics];
  function blocked(checkpoint: RuleCompilationCheckpoint, causes: readonly SourceDiagnostic[]): RuleExpansionResult {
    return { kind: RuleExpansionKind.Blocked, failure: { checkpoint, causes }, loops: syntax.loops, diagnostics };
  }
  const namedRules: OrientedRule[] = [];
  for (const rule of negatives.rules) for (const direction of rule.directions) {
    const oriented = orientRule(rule, direction);
    const aggregates = expandRuleAggregates([oriented], declarations, report);
    diagnostics.push(...aggregates.diagnostics);
    if (syntax.blockingIssues.length > 0) return blocked(RuleCompilationCheckpoint.AfterAggregateExpansion, syntax.blockingIssues);
    namedRules.push(...substituteRuleSynonyms(aggregates.rules, declarations));
  }
  const movements = expandRuleMovements(namedRules, report);
  diagnostics.push(...movements.diagnostics);
  function inferPropertiesAndSpawns<Q extends OrientedQualifier>(rules: readonly DirectedNamedRule<Q>[]) {
    const properties = expandRuleProperties(rules, declarations, report);
    diagnostics.push(...properties.diagnostics);
    return inferSpawnedStationary(properties.rules, declarations);
  }
  if (movements.abortsCompilation) {
    // Property diagnostics still run with unresolved movement families.
    inferPropertiesAndSpawns(movements.rules);
    return blocked(RuleCompilationCheckpoint.AfterPropertyInference, movements.diagnostics);
  }
  const spawned = inferPropertiesAndSpawns(movements.rules);
  // A retained syntax error also survives an empty selector collection. Ordinary
  // authored bracket rules supply selectors, but the final checkpoint still owns it.
  if (syntax.blockingIssues.length > 0) return blocked(RuleCompilationCheckpoint.AfterPropertyInference, syntax.blockingIssues);
  return { kind: RuleExpansionKind.Ready, rules: spawned, loops: syntax.loops, diagnostics };
}

export function lowerSourceRules(
  rules: readonly MovementRule[], declarations: ResolvedDeclarations, report?: SourceIssueReporter, quirks?: Quirks,
) {
  return lowerRules(normalizeRuleDuplicates(rules), declarations, report, quirks);
}

/** Convenience composition of expansion, lowering, groups and loops. */
export function compileSourceRules(document: SourceDocument, declarations: ResolvedDeclarations):
  { readonly data: CompiledRuleData; readonly diagnostics: readonly SourceDiagnostic[] } |
  { readonly data: null; readonly failure: RuleCompilationFailure; readonly diagnostics: readonly SourceDiagnostic[] } {
  const expanded = expandSourceRules(document, declarations);
  const diagnostics = [...expanded.diagnostics];
  if (expanded.kind === RuleExpansionKind.Blocked) return { data: null, failure: expanded.failure, diagnostics };
  const lowered = lowerSourceRules(expanded.rules, declarations);
  diagnostics.push(...lowered.diagnostics);
  const schedules = compileRuleSchedules(lowered.rules, expanded.loops);
  diagnostics.push(...schedules.diagnostics);
  return { data: { earlyRules: schedules.early, lateRules: schedules.late,
    rigid: schedules.rigid, rigidMerges: schedules.rigidMerges }, diagnostics };
}
