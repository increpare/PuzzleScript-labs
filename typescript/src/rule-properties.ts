import { appendSourceIssue, type SourceIssueReporter } from './source-diagnostics.js';
import type { ResolvedDeclarations } from './declaration-model.js';
import { SourceDiagnosticPhase, SourceDiagnosticSeverity, type SourceDiagnostic } from './source-model.js';
import { RuleQualifier, type NamedRuleCell, type NamedRuleRows, type NamedRuleTerm, type OrientedRule } from './source-rule-model.js';

/** Private evidence records expansion sites, never a binding used by the runtime. */
interface PropertyChoice {
  readonly name: string;
  readonly firstMember: string;
  readonly expandedCells: number;
}

interface PartialRule {
  readonly rule: OrientedRule;
  readonly choices: readonly PropertyChoice[];
}

interface ExpansionSite {
  readonly rowIndex: number;
  readonly cellIndex: number;
  readonly property: string;
}

function copyRows(rows: NamedRuleRows): NamedRuleTerm[][][] {
  return rows.map(row => row.map(cell => cell.map(term => ({ ...term }))));
}

function substitute(cell: NamedRuleCell, property: string, member: string): NamedRuleTerm[] {
  return cell.map(term => ({ ...term,
    name: term.name === property && term.qualifier !== RuleQualifier.RandomObject ? member : term.name }));
}

/** Expand ordered property choices, retaining local single-layer predicates. */
export function expandRuleProperties(rules: readonly OrientedRule[], declarations: ResolvedDeclarations, report?: SourceIssueReporter): {
  readonly rules: readonly OrientedRule[];
  readonly diagnostics: readonly SourceDiagnostic[];
} {
  const properties = declarations.ruleNames.properties;
  const expanded: OrientedRule[] = [];
  const diagnostics: SourceDiagnostic[] = [];

  function participatingNames(cell: NamedRuleCell): string[] {
    return cell.filter(term => term.qualifier !== RuleQualifier.RandomObject && properties.has(term.name))
      .map(term => term.name);
  }

  function expandNegatives(cell: NamedRuleCell): NamedRuleTerm[] {
    return cell.flatMap(term => {
      const members = term.qualifier === RuleQualifier.No ? properties.get(term.name) : undefined;
      return members === undefined ? [{ ...term }] : members.map(name => ({ ...term, name }));
    });
  }

  function firstSite(rule: OrientedRule, transported: ReadonlySet<string>): ExpansionSite | undefined {
    for (let rowIndex = 0; rowIndex < rule.lhs.length; rowIndex++) {
      const row = rule.lhs[rowIndex]!;
      for (let cellIndex = 0; cellIndex < row.length; cellIndex++) {
        for (const property of participatingNames(row[cellIndex]!)) {
          // Presence matters: undefined is a valid unlayered recovery value.
          if (declarations.ruleNames.singleLayerProperties.has(property) && !transported.has(property)) continue;
          return { rowIndex, cellIndex, property };
        }
      }
    }
    return undefined;
  }

  function choose(parent: PartialRule, site: ExpansionSite, member: string): PartialRule {
    const { rowIndex, cellIndex, property } = site;
    const lhs = copyRows(parent.rule.lhs), rhs = copyRows(parent.rule.rhs);
    lhs[rowIndex]![cellIndex] = substitute(lhs[rowIndex]![cellIndex]!, property, member);
    if (rhs.length > 0) rhs[rowIndex]![cellIndex] = substitute(rhs[rowIndex]![cellIndex]!, property, member);
    const previous = parent.choices.find(choice => choice.name === property);
    const choices = previous === undefined
      ? [...parent.choices, { name: property, firstMember: member, expandedCells: 1 }]
      : parent.choices.map(choice => choice.name === property ? { ...choice, expandedCells: choice.expandedCells + 1 } : choice);
    return { rule: { ...parent.rule, lhs, rhs }, choices };
  }

  for (const input of rules) {
    const lhs = copyRows(input.lhs), rhs = copyRows(input.rhs);
    // Native visits RHS cells only while visiting their corresponding LHS cell.
    for (let rowIndex = 0; rowIndex < lhs.length; rowIndex++) {
      for (let cellIndex = 0; cellIndex < lhs[rowIndex]!.length; cellIndex++) {
        lhs[rowIndex]![cellIndex] = expandNegatives(lhs[rowIndex]![cellIndex]!);
        if (rhs.length > 0) rhs[rowIndex]![cellIndex] = expandNegatives(rhs[rowIndex]![cellIndex]!);
      }
    }

    const transported = new Set<string>();
    for (let rowIndex = 0; rowIndex < rhs.length; rowIndex++) {
      for (let cellIndex = 0; cellIndex < rhs[rowIndex]!.length; cellIndex++) {
        const left = participatingNames(lhs[rowIndex]![cellIndex]!);
        for (const property of participatingNames(rhs[rowIndex]![cellIndex]!)) {
          if (!left.includes(property)) transported.add(property);
        }
      }
    }

    const work: PartialRule[] = [{ rule: { ...input, lhs, rhs }, choices: [] }];
    for (let index = 0; index < work.length;) {
      const parent = work[index]!;
      const site = firstSite(parent.rule, transported);
      if (site === undefined) { index++; continue; }
      // Choose just one property in one cell per parent. Appending children
      // before removing the parent preserves duplicate paths and native order.
      for (const member of properties.get(site.property)!) work.push(choose(parent, site, member));
      work.splice(index, 1);
    }

    const variants = work.map(partial => {
      let inferred = partial.rule.rhs;
      for (const choice of partial.choices) {
        if (choice.expandedCells === 1) {
          inferred = inferred.map(row => row.map(cell => substitute(cell, choice.name, choice.firstMember)));
        }
      }
      return { ...partial.rule, rhs: inferred };
    });

    let ambiguousProperty: string | undefined;
    for (const variant of variants) for (const row of variant.rhs) for (const cell of row) {
      for (const property of participatingNames(cell)) {
        if (transported.has(property)) ambiguousProperty = property;
      }
    }
    if (ambiguousProperty !== undefined) {
      appendSourceIssue(diagnostics, { code: 'ambiguous-rule-property',
        message: `This rule has a property on the right-hand side, "${ambiguousProperty.toUpperCase()}", that can't be inferred from the left-hand side.  (either for every property on the right there has to be a corresponding one on the left in the same cell, OR, if there's a single occurrence of a particular property name on the left, all properties of the same name on the right are assumed to be the same).`,
        span: input.source.originalLine.span, phase: SourceDiagnosticPhase.Rules,
        severity: SourceDiagnosticSeverity.Error, countsAsError: true }, report);
      // This pass rejects the original input's entire family of variants.
      continue;
    }
    expanded.push(...variants);
  }
  return { rules: expanded, diagnostics };
}
