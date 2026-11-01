import { appendSourceIssue, type SourceIssueReporter } from './source-diagnostics.js';
import { SourceDiagnosticPhase, SourceDiagnosticSeverity, type SourceDiagnostic } from './source-model.js';
import { RuleQualifier, type AbsoluteMovementQualifier, type AtomicQualifier, type MovementFamily, type MovementRule,
  type NamedRuleCell, type NamedRuleRows, type NamedRuleTerm, type OrientedQualifier, type OrientedRule } from './source-rule-model.js';

interface ExpansionCell {
  readonly rowIndex: number;
  readonly cellIndex: number;
}

/** Private evidence describes one local expansion, rather than a runtime binding. */
interface MovementExpansion {
  readonly entityName: string;
  readonly family: MovementFamily;
  readonly chosenQualifier: AbsoluteMovementQualifier;
  readonly sourceCell: ExpansionCell;
}

interface PartialRule {
  readonly rule: OrientedRule;
  readonly expansions: readonly MovementExpansion[];
}

function isAtomicQualifier(qualifier: OrientedQualifier): qualifier is AtomicQualifier {
  switch (qualifier) {
    case RuleQualifier.Unspecified:
    case RuleQualifier.Up:
    case RuleQualifier.Down:
    case RuleQualifier.Left:
    case RuleQualifier.Right:
    case RuleQualifier.Action:
    case RuleQualifier.Stationary:
    case RuleQualifier.No:
    case RuleQualifier.RandomObject:
    case RuleQualifier.RandomDirection:
    case RuleQualifier.Ellipsis:
      return true;
    case RuleQualifier.Horizontal:
    case RuleQualifier.Vertical:
    case RuleQualifier.Orthogonal:
    case RuleQualifier.Moving:
    case RuleQualifier.HorizontalParallel:
    case RuleQualifier.VerticalParallel:
    case RuleQualifier.HorizontalPerpendicular:
    case RuleQualifier.VerticalPerpendicular:
      return false;
  }
  const unsupported: never = qualifier;
  throw new Error(`Unsupported oriented qualifier: ${unsupported}`);
}

function isMovementFamily(qualifier: OrientedQualifier): qualifier is MovementFamily {
  return !isAtomicQualifier(qualifier);
}

function isMovementRows(rows: NamedRuleRows<OrientedQualifier>): rows is NamedRuleRows<AtomicQualifier> {
  return rows.every(row => row.every(cell => cell.every(term => isAtomicQualifier(term.qualifier))));
}

function isMovementRule(rule: OrientedRule): rule is MovementRule {
  return isMovementRows(rule.lhs) && isMovementRows(rule.rhs);
}

function choices(family: MovementFamily): readonly AbsoluteMovementQualifier[] {
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
  }
  const unsupported: never = family;
  throw new Error(`Unsupported movement family: ${unsupported}`);
}

function familySpelling(family: MovementFamily): string {
  switch (family) {
    case RuleQualifier.Horizontal: return 'horizontal';
    case RuleQualifier.Vertical: return 'vertical';
    case RuleQualifier.Orthogonal: return 'orthogonal';
    case RuleQualifier.Moving: return 'moving';
    case RuleQualifier.HorizontalParallel: return 'horizontal_par';
    case RuleQualifier.VerticalParallel: return 'vertical_par';
    case RuleQualifier.HorizontalPerpendicular: return 'horizontal_perp';
    case RuleQualifier.VerticalPerpendicular: return 'vertical_perp';
  }
  const unsupported: never = family;
  throw new Error(`Unsupported movement family: ${unsupported}`);
}

function copyRows(rows: NamedRuleRows<OrientedQualifier>): NamedRuleTerm<OrientedQualifier>[][][] {
  return rows.map(row => row.map(cell => cell.map(term => ({ ...term }))));
}

function replaceInCell(cell: NamedRuleCell<OrientedQualifier>, expansion: MovementExpansion,
  entityName: string | undefined): NamedRuleTerm<OrientedQualifier>[] {
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
  const families: MovementFamily[] = [];
  for (const expansion of partial.expansions) {
    if (families.includes(expansion.family)) continue;
    families.push(expansion.family);
    if (partial.expansions.filter(event => event.family === expansion.family).length === 1) {
      rhs = rhs.map(row => row.map(cell => replaceInCell(cell, expansion, undefined)));
    }
  }
  return { ...partial.rule, rhs };
}

export type MovementExpansionResult = {
  readonly rules: readonly MovementRule[];
  readonly diagnostics: readonly SourceDiagnostic[];
  readonly abortsCompilation: false;
} | {
  readonly rules: readonly OrientedRule[];
  readonly diagnostics: readonly SourceDiagnostic[];
  readonly abortsCompilation: true;
};

/** Expand movement families in native work order, then infer remaining RHS movement. */
export function expandRuleMovements(rules: readonly OrientedRule[], report?: SourceIssueReporter): MovementExpansionResult {
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
          const term = row[cellIndex]!.find((candidate): candidate is NamedRuleTerm<MovementFamily> =>
            isMovementFamily(candidate.qualifier));
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
    let remainingFamily: MovementFamily | undefined;
    for (const variant of variants) {
      for (const row of variant.rhs) for (const cell of row) for (const term of cell) {
        if (remainingFamily === undefined && isMovementFamily(term.qualifier)) remainingFamily = term.qualifier;
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
  if (diagnostics.length > 0) return { rules: expanded, diagnostics, abortsCompilation: true };
  if (!expanded.every(isMovementRule)) throw new Error('Movement expansion succeeded with an unresolved movement family.');
  return { rules: expanded, diagnostics, abortsCompilation: false };
}
