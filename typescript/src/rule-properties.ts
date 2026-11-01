import { appendSourceIssue, type SourceIssueReporter } from './source-diagnostics.js';
import { PropertyLayerKind, type ResolvedDeclarations } from './declaration-model.js';
import { SourceDiagnosticPhase, SourceDiagnosticSeverity, type SourceDiagnostic } from './source-model.js';
import { RuleQualifier, type DirectedNamedRule, type NamedRuleCell, type NamedRuleRows,
  type NamedRuleTerm, type OrientedQualifier } from './source-rule-model.js';
import { ObjectSourceKind, resolveObjectSource, sameRuleCell,
  type ObjectSource, type RuleCellAddress } from './rule-object-sources.js';

/** A source relationship is established before any concrete member is chosen. */
interface PropertyUse {
  readonly property: string;
  readonly targetCell: RuleCellAddress;
  readonly source: ObjectSource;
}

/** Construction evidence belongs to one rule variant, never to runtime matches. */
interface PropertySelection {
  readonly property: string;
  readonly sourceCell: RuleCellAddress;
  readonly member: string;
}

interface PartialRule<Q extends OrientedQualifier> {
  readonly rule: DirectedNamedRule<Q>;
  readonly selections: readonly PropertySelection[];
}

interface ExpansionSite {
  readonly rowIndex: number;
  readonly cellIndex: number;
  readonly property: string;
}

function copyRows<Q extends OrientedQualifier>(rows: NamedRuleRows<Q>): NamedRuleTerm<Q>[][][] {
  return rows.map(row => row.map(cell => cell.map(term => ({ ...term }))));
}

function substitute<Q extends OrientedQualifier>(cell: NamedRuleCell<Q>, property: string, member: string): NamedRuleTerm<Q>[] {
  return cell.map(term => ({ ...term,
    name: term.name === property && term.qualifier !== RuleQualifier.RandomObject ? member : term.name }));
}

/** Expand ordered property choices without changing qualifiers. Surviving ordinary
 * properties need no further transported-property expansion; local single-layer
 * and unlayered predicates, random properties and recovery names may remain.
 * Local predicates keep live matches in board order across their alternatives. */
export function expandRuleProperties<Q extends OrientedQualifier>(rules: readonly DirectedNamedRule<Q>[],
  declarations: ResolvedDeclarations, report?: SourceIssueReporter): {
  readonly rules: readonly DirectedNamedRule<Q>[];
  readonly diagnostics: readonly SourceDiagnostic[];
} {
  const properties = declarations.ruleNames.properties;
  const expanded: DirectedNamedRule<Q>[] = [];
  const diagnostics: SourceDiagnostic[] = [];

  function participatingNames(cell: NamedRuleCell): string[] {
    return cell.filter(term => term.qualifier !== RuleQualifier.RandomObject && properties.has(term.name))
      .map(term => term.name);
  }

  function expandNegatives(cell: NamedRuleCell<Q>): NamedRuleTerm<Q>[] {
    return cell.flatMap(term => {
      const members = term.qualifier === RuleQualifier.No ? properties.get(term.name)?.alternatives : undefined;
      return members === undefined ? [{ ...term }] : members.map(name => ({ ...term, name }));
    });
  }

  function analyzePropertyUses(lhs: NamedRuleRows<Q>, rhs: NamedRuleRows<Q>): PropertyUse[] {
    const uses: PropertyUse[] = [];
    for (let rowIndex = 0; rowIndex < rhs.length; rowIndex++) {
      for (let cellIndex = 0; cellIndex < rhs[rowIndex]!.length; cellIndex++) {
        // Preserve the native recovered-stage boundary for unequal rule shapes.
        if (lhs[rowIndex]?.[cellIndex] === undefined) {
          throw new TypeError('Property RHS cell has no corresponding LHS cell');
        }
        const targetCell = { rowIndex, cellIndex };
        for (const property of participatingNames(rhs[rowIndex]![cellIndex]!)) {
          const candidates: RuleCellAddress[] = [];
          for (let sourceRow = 0; sourceRow < lhs.length; sourceRow++) {
            for (let sourceCell = 0; sourceCell < lhs[sourceRow]!.length; sourceCell++) {
              if (participatingNames(lhs[sourceRow]![sourceCell]!).includes(property)) {
                candidates.push({ rowIndex: sourceRow, cellIndex: sourceCell });
              }
            }
          }
          uses.push({ property, targetCell, source: resolveObjectSource(candidates, targetCell) });
        }
      }
    }
    return uses;
  }

  function firstSite(rule: DirectedNamedRule<Q>, needsMemberChoice: ReadonlySet<string>): ExpansionSite | undefined {
    for (let rowIndex = 0; rowIndex < rule.lhs.length; rowIndex++) {
      const row = rule.lhs[rowIndex]!;
      for (let cellIndex = 0; cellIndex < row.length; cellIndex++) {
        for (const property of participatingNames(row[cellIndex]!)) {
          const analysis = properties.get(property)!.layer;
          if (!needsMemberChoice.has(property)
            && (analysis.kind === PropertyLayerKind.SingleLayer || analysis.kind === PropertyLayerKind.Unlayered)) continue;
          return { rowIndex, cellIndex, property };
        }
      }
    }
    return undefined;
  }

  function choose(parent: PartialRule<Q>, site: ExpansionSite, member: string): PartialRule<Q> {
    const { rowIndex, cellIndex, property } = site;
    const lhs = copyRows(parent.rule.lhs);
    lhs[rowIndex]![cellIndex] = substitute(lhs[rowIndex]![cellIndex]!, property, member);
    return { rule: { ...parent.rule, lhs }, selections: [...parent.selections,
      { property, sourceCell: { rowIndex, cellIndex }, member }] };
  }

  function constructRightSide(partial: PartialRule<Q>, uses: readonly PropertyUse[]): DirectedNamedRule<Q> {
    const rhs = copyRows(partial.rule.rhs);
    for (const use of uses) {
      if (use.source.kind !== ObjectSourceKind.Resolved) continue;
      const sourceCell = use.source.cell;
      const selection = partial.selections.find(candidate => candidate.property === use.property
        && sameRuleCell(candidate.sourceCell, sourceCell));
      // A local source can remain a property predicate when no member was chosen.
      if (selection === undefined) continue;
      const { rowIndex, cellIndex } = use.targetCell;
      rhs[rowIndex]![cellIndex] = substitute(rhs[rowIndex]![cellIndex]!, use.property, selection.member);
    }
    return { ...partial.rule, rhs };
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

    // Inference sees pattern cells only. Expansion strategy is decided afterward.
    const uses = analyzePropertyUses(lhs, rhs);
    const needsMemberChoice = new Set<string>();
    for (const use of uses) {
      if (use.source.kind !== ObjectSourceKind.Resolved || !sameRuleCell(use.source.cell, use.targetCell)) {
        needsMemberChoice.add(use.property);
      }
    }

    const work: PartialRule<Q>[] = [{ rule: { ...input, lhs, rhs }, selections: [] }];
    for (let index = 0; index < work.length;) {
      const parent = work[index]!;
      const site = firstSite(parent.rule, needsMemberChoice);
      if (site === undefined) { index++; continue; }
      // Choose just one property in one cell per parent. Appending children
      // before removing the parent preserves duplicate paths and native order.
      for (const member of properties.get(site.property)!.alternatives) work.push(choose(parent, site, member));
      work.splice(index, 1);
    }

    // Normalized property members are not property names, so these source links
    // can construct the RHS once without introducing another inference problem.
    const variants = work.map(partial => constructRightSide(partial, uses));

    let ambiguousProperty: string | undefined;
    for (const variant of variants) for (const row of variant.rhs) for (const cell of row) {
      for (const property of participatingNames(cell)) {
        if (needsMemberChoice.has(property)) ambiguousProperty = property;
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
