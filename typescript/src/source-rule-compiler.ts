import type { SourceIssueReporter } from './source-diagnostics.js';
import type { SourceLoopMarker } from './source-model.js';
import type { ResolvedDeclarations } from './declaration-model.js';
import { normalizeRuleDuplicates } from './rule-duplicates.js';
import { lowerRules } from './rule-lowering.js';
import type { Quirks } from './compatibility-vanilla-5a94bde1.js';
import { expandRuleMovements } from './rule-movements.js';
import { expandRuleAggregates, substituteRuleSynonyms } from './rule-names.js';
import { checkEarlyNegativeTerms } from './rule-negatives.js';
import { orientRule } from './rule-orientations.js';
import { expandRuleProperties } from './rule-properties.js';
import { inferSpawnedStationary } from './rule-spawns.js';
import { recoverRuleSyntax } from './rule-syntax.js';
import type { SourceDiagnostic, SourceDocument } from './source-model.js';
import type { OrientedRule } from './source-rule-model.js';
import { compileRuleSchedules } from './source-rule-schedules.js';
import type { TurnRulesGame } from './turn-rules.js';

export type CompiledRuleData = Pick<TurnRulesGame, 'earlyRules' | 'lateRules' | 'rigid' | 'rigidMerges'>;

/** Compile authored rules with one canonical declaration result and native checkpoints. */
export function expandSourceRules(document: SourceDocument, declarations: ResolvedDeclarations, report?: SourceIssueReporter): {
  readonly rules: readonly OrientedRule[] | null;
  readonly loops: readonly SourceLoopMarker[];
  readonly diagnostics: readonly SourceDiagnostic[];
} {
  const syntax = recoverRuleSyntax(document, declarations, report);
  const negatives = checkEarlyNegativeTerms(syntax.rules, declarations, report);
  const diagnostics = [...syntax.diagnostics, ...negatives.diagnostics];
  const namedRules: OrientedRule[] = [];
  for (const rule of negatives.rules) for (const direction of rule.directions) {
    const oriented = orientRule(rule, direction);
    const aggregates = expandRuleAggregates([oriented], declarations, report);
    diagnostics.push(...aggregates.diagnostics);
    if (syntax.abortsCompilation) return { rules: null, loops: syntax.loops, diagnostics };
    namedRules.push(...substituteRuleSynonyms(aggregates.rules, declarations));
  }
  const movements = expandRuleMovements(namedRules, report);
  diagnostics.push(...movements.diagnostics);
  const properties = expandRuleProperties(movements.rules, declarations, report);
  diagnostics.push(...properties.diagnostics);
  const spawned = inferSpawnedStationary(properties.rules, declarations);
  // A retained syntax error also survives an empty selector collection. Ordinary
  // authored bracket rules supply selectors, but the final checkpoint still owns it.
  if (syntax.abortsCompilation || movements.abortsCompilation) return { rules: null, loops: syntax.loops, diagnostics };
  return { rules: spawned, loops: syntax.loops, diagnostics };
}

export function lowerSourceRules(
  rules: readonly OrientedRule[], declarations: ResolvedDeclarations, report?: SourceIssueReporter, quirks?: Quirks,
) {
  return lowerRules(normalizeRuleDuplicates(rules), declarations, report, quirks);
}

/** Convenience composition of expansion, lowering, groups and loops. */
export function compileSourceRules(document: SourceDocument, declarations: ResolvedDeclarations): {
  readonly data: CompiledRuleData | null;
  readonly diagnostics: readonly SourceDiagnostic[];
} {
  const expanded = expandSourceRules(document, declarations);
  const diagnostics = [...expanded.diagnostics];
  if (expanded.rules === null) return { data: null, diagnostics };
  const lowered = lowerSourceRules(expanded.rules, declarations);
  diagnostics.push(...lowered.diagnostics);
  const schedules = compileRuleSchedules(lowered.rules, expanded.loops);
  diagnostics.push(...schedules.diagnostics);
  return { data: { earlyRules: schedules.early, lateRules: schedules.late,
    rigid: schedules.rigid, rigidMerges: schedules.rigidMerges }, diagnostics };
}
