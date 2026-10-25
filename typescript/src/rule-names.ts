import { appendSourceIssue, type SourceIssueReporter } from './source-diagnostics.js';
import type { ResolvedDeclarations } from './declaration-model.js';
import { SourceDiagnosticPhase, SourceDiagnosticSeverity, type SourceDiagnostic } from './source-model.js';
import { RuleQualifier, type NamedRuleCell, type NamedRuleTerm, type OrientedRule } from './source-rule-model.js';

/** Atomize ordered aggregates without entering synonym substitution. */
export function expandRuleAggregates(rules: readonly OrientedRule[], declarations: ResolvedDeclarations, report?: SourceIssueReporter): {
  readonly rules: readonly OrientedRule[];
  readonly diagnostics: readonly SourceDiagnostic[];
} {
  const diagnostics: SourceDiagnostic[] = [];

  function atomize(cell: NamedRuleCell, rule: OrientedRule): NamedRuleTerm[] {
    const expanded = cell.map(term => ({ ...term }));
    for (let index = 0; index < expanded.length; index++) {
      const term = expanded[index]!;
      const members = declarations.ruleNames.aggregates.get(term.name);
      if (members === undefined) continue;
      const first = members[0];
      if (first === undefined) {
        // Invalid declarations can normalize to an empty aggregate. Native
        // writes undefined here and later throws while lowering the rule.
        // Keep string names truthful and preserve that failure category early.
        throw new TypeError(`Cannot expand empty aggregate "${term.name}" in a rule.`);
      }
      if (term.qualifier === RuleQualifier.No) {
        appendSourceIssue(diagnostics, { code: 'negative-rule-aggregate',
          message: `You cannot use 'no' to exclude the aggregate object ${term.name.toUpperCase()} (defined using 'AND'), only regular objects, or properties (objects defined using 'OR').  If you want to do this, you'll have to write it out yourself the long way.`,
          span: rule.source.originalLine.span, phase: SourceDiagnosticPhase.Rules,
          severity: SourceDiagnosticSeverity.Error, countsAsError: true }, report);
      }
      // Replace only this slot. Appended members are visited later in this loop;
      // the first member is not reconsidered and duplicates remain separate.
      expanded[index] = { ...term, name: first };
      for (const name of members.slice(1)) expanded.push({ ...term, name });
    }
    return expanded;
  }

  const expanded = rules.map(rule => {
    // Every RHS cell atomizes, including malformed cells outside LHS boundaries.
    const lhs = rule.lhs.map(row => row.map(cell => atomize(cell, rule)));
    const rhs = rule.rhs.map(row => row.map(cell => atomize(cell, rule)));
    return { ...rule, lhs, rhs };
  });
  return { rules: expanded, diagnostics };
}

/** Substitute final synonyms once, only within the corresponding LHS boundaries. */
export function substituteRuleSynonyms(rules: readonly OrientedRule[], declarations: ResolvedDeclarations): readonly OrientedRule[] {
  const rephrase = (cell: NamedRuleCell): NamedRuleCell => cell.map(term => ({ ...term,
    name: declarations.ruleNames.synonyms.get(term.name) ?? term.name }));
  return rules.map(rule => ({ ...rule, lhs: rule.lhs.map(row => row.map(rephrase)),
    rhs: rule.rhs.map((row, rowIndex) => row.map((cell, cellIndex) =>
      rule.lhs[rowIndex]?.[cellIndex] === undefined ? cell : rephrase(cell))) }));
}

/** Atomize ordered aggregates, then substitute each final synonym exactly once. */
export function expandRuleNames(rules: readonly OrientedRule[], declarations: ResolvedDeclarations): {
  readonly rules: readonly OrientedRule[];
  readonly diagnostics: readonly SourceDiagnostic[];
} {
  const aggregates = expandRuleAggregates(rules, declarations);
  return { rules: substituteRuleSynonyms(aggregates.rules, declarations), diagnostics: aggregates.diagnostics };
}
