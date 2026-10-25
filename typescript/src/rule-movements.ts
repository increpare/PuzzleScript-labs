import { appendSourceIssue, type SourceIssueReporter } from './source-diagnostics.js';
import { SourceDiagnosticPhase, SourceDiagnosticSeverity, type SourceDiagnostic } from './source-model.js';
import { RuleQualifier, type NamedRuleCell, type NamedRuleRows, type NamedRuleTerm, type OrientedRule } from './source-rule-model.js';

interface ExpansionCell {
  readonly rowIndex: number;
  readonly cellIndex: number;
}

/** Private evidence describes one local expansion, rather than a runtime binding. */
interface MovementExpansion {
  readonly entityName: string;
  readonly family: RuleQualifier;
  readonly chosenQualifier: RuleQualifier;
  readonly sourceCell: ExpansionCell;
}

interface PartialRule {
  readonly rule: OrientedRule;
  readonly expansions: readonly MovementExpansion[];
}

function choices(family: RuleQualifier): readonly RuleQualifier[] {
  switch (family) {
    case RuleQualifier.Horizontal:
    case RuleQualifier.HorizontalParallel:
    case RuleQualifier.HorizontalPerpendicular:
      return [RuleQualifier.Left, RuleQualifier.Right];
    case RuleQualifier.Vertical:
    case RuleQualifier.VerticalParallel:
    case RuleQualifier.VerticalPerpendicular:
      return [RuleQualifier.Up, RuleQualifier.Down];
    case RuleQualifier.Orthogonal:
      return [RuleQualifier.Up, RuleQualifier.Down, RuleQualifier.Left, RuleQualifier.Right];
    case RuleQualifier.Moving:
      return [RuleQualifier.Up, RuleQualifier.Down, RuleQualifier.Left, RuleQualifier.Right, RuleQualifier.Action];
    default:
      return [];
  }
}

function familySpelling(family: RuleQualifier): string {
  switch (family) {
    case RuleQualifier.Horizontal: return 'horizontal';
    case RuleQualifier.Vertical: return 'vertical';
    case RuleQualifier.Orthogonal: return 'orthogonal';
    case RuleQualifier.Moving: return 'moving';
    case RuleQualifier.HorizontalParallel: return 'horizontal_par';
    case RuleQualifier.VerticalParallel: return 'vertical_par';
    case RuleQualifier.HorizontalPerpendicular: return 'horizontal_perp';
    case RuleQualifier.VerticalPerpendicular: return 'vertical_perp';
    default: throw new Error('Expected an oriented movement family.');
  }
}

function copyRows(rows: NamedRuleRows): NamedRuleTerm[][][] {
  return rows.map(row => row.map(cell => cell.map(term => ({ ...term }))));
}

function replaceInCell(cell: NamedRuleCell, expansion: MovementExpansion, entityName: string | undefined): NamedRuleTerm[] {
  return cell.map(term => ({ ...term,
    qualifier: term.qualifier === expansion.family && (entityName === undefined || term.name === entityName)
      ? expansion.chosenQualifier : term.qualifier }));
}

function expandAt(parent: PartialRule, expansion: MovementExpansion): PartialRule {
  const lhs = copyRows(parent.rule.lhs);
  const rhs = copyRows(parent.rule.rhs);
  const { rowIndex, cellIndex } = expansion.sourceCell;
  lhs[rowIndex]![cellIndex] = replaceInCell(lhs[rowIndex]![cellIndex]!, expansion, expansion.entityName);
  if (rhs.length > 0) {
    rhs[rowIndex]![cellIndex] = replaceInCell(rhs[rowIndex]![cellIndex]!, expansion, expansion.entityName);
  }
  return { rule: { ...parent.rule, lhs, rhs },
    expansions: [...parent.expansions.map(previous => ({ ...previous, sourceCell: { ...previous.sourceCell } })),
      { ...expansion, sourceCell: { ...expansion.sourceCell } }] };
}

function inferRightMovements(partial: PartialRule): OrientedRule {
  let rhs = partial.rule.rhs;
  const encountered: MovementExpansion[] = [];
  // First use each entity/family's first choice, only when it expanded in one cell.
  for (const expansion of partial.expansions) {
    if (encountered.some(previous => previous.entityName === expansion.entityName && previous.family === expansion.family)) continue;
    encountered.push(expansion);
    const cells: ExpansionCell[] = [];
    for (const event of partial.expansions) {
      if (event.entityName !== expansion.entityName || event.family !== expansion.family) continue;
      if (!cells.some(cell => cell.rowIndex === event.sourceCell.rowIndex && cell.cellIndex === event.sourceCell.cellIndex)) {
        cells.push(event.sourceCell);
      }
    }
    if (cells.length === 1) rhs = rhs.map(row => row.map(cell => replaceInCell(cell, expansion, expansion.entityName)));
  }
  // Then a family may cross entity names only if there was exactly one event.
  // Equal concrete directions at several sites do not make this evidence unique.
  const families: RuleQualifier[] = [];
  for (const expansion of partial.expansions) {
    if (families.includes(expansion.family)) continue;
    families.push(expansion.family);
    if (partial.expansions.filter(event => event.family === expansion.family).length === 1) {
      rhs = rhs.map(row => row.map(cell => replaceInCell(cell, expansion, undefined)));
    }
  }
  return { ...partial.rule, rhs };
}

/** Expand movement families in native work order, then infer remaining RHS movement. */
export function expandRuleMovements(rules: readonly OrientedRule[], report?: SourceIssueReporter): {
  readonly rules: readonly OrientedRule[];
  readonly diagnostics: readonly SourceDiagnostic[];
  readonly abortsCompilation: boolean;
} {
  const expanded: OrientedRule[] = [];
  const diagnostics: SourceDiagnostic[] = [];
  for (const input of rules) {
    const work: PartialRule[] = [{ rule: { ...input, lhs: copyRows(input.lhs), rhs: copyRows(input.rhs) }, expansions: [] }];
    for (let index = 0; index < work.length;) {
      const parent = work[index]!;
      let producedChild = false;
      for (let rowIndex = 0; rowIndex < parent.rule.lhs.length; rowIndex++) {
        const row = parent.rule.lhs[rowIndex]!;
        for (let cellIndex = 0; cellIndex < row.length; cellIndex++) {
          const term = row[cellIndex]!.find(candidate => choices(candidate.qualifier).length > 0);
          if (term === undefined) continue;
          producedChild = true;
          // Every eligible cell branches from this same unchanged parent.
          // Keep all duplicate paths; appending and removing controls their order.
          for (const chosenQualifier of choices(term.qualifier)) {
            work.push(expandAt(parent, { entityName: term.name, family: term.qualifier,
              chosenQualifier, sourceCell: { rowIndex, cellIndex } }));
          }
        }
      }
      if (producedChild) work.splice(index, 1);
      else index++;
    }

    const variants = work.map(inferRightMovements);
    let remainingFamily: RuleQualifier | undefined;
    for (const variant of variants) {
      for (const row of variant.rhs) for (const cell of row) for (const term of cell) {
        if (remainingFamily === undefined && choices(term.qualifier).length > 0) remainingFamily = term.qualifier;
      }
      if (remainingFamily !== undefined) break;
    }
    if (remainingFamily !== undefined) {
      appendSourceIssue(diagnostics, { code: 'ambiguous-rule-movement',
        message: `This rule has an ambiguous movement on the right-hand side, "${familySpelling(remainingFamily)}", that can't be inferred from the left-hand side.  (either for every ambiguous movement associated to an entity on the right there has to be a corresponding one on the left attached to the same entity, OR, if there's a single occurrence of a particular ambiguous movement on the left, all properties of the same movement attached to the same object on the right are assumed to be the same (or something like that)).`,
        span: input.source.originalLine.span, phase: SourceDiagnosticPhase.Rules,
        severity: SourceDiagnosticSeverity.Error, countsAsError: true }, report);
    }
    expanded.push(...variants);
  }
  return { rules: expanded, diagnostics, abortsCompilation: diagnostics.length > 0 };
}
