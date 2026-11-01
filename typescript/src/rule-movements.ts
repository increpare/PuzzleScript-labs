import { appendSourceIssue, type SourceIssueReporter } from './source-diagnostics.js';
import { SourceDiagnosticPhase, SourceDiagnosticSeverity, type SourceDiagnostic } from './source-model.js';
import { RuleQualifier, type AbsoluteMovementQualifier, type AtomicQualifier, type MovementFamily, type MovementRule,
  type NamedRuleCell, type NamedRuleRows, type NamedRuleTerm, type OrientedQualifier, type OrientedRule } from './source-rule-model.js';
import { sameRuleCell, type RuleCellAddress } from './rule-object-sources.js';

/** Private evidence describes one local expansion, rather than a runtime binding. */
interface MovementExpansion {
  readonly entityName: string;
  readonly family: MovementFamily;
  readonly chosenQualifier: AbsoluteMovementQualifier;
  readonly sourceCell: RuleCellAddress;
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

function replaceInCell(cell: NamedRuleCell<OrientedQualifier>, expansion: MovementExpansion): NamedRuleTerm<OrientedQualifier>[] {
  return cell.map(term => ({ ...term,
    qualifier: term.qualifier === expansion.family && term.name === expansion.entityName
      ? expansion.chosenQualifier : term.qualifier }));
}

function expandAt(parent: PartialRule, expansion: MovementExpansion): PartialRule {
  const lhs = copyRows(parent.rule.lhs);
  const rhs = copyRows(parent.rule.rhs);
  const { rowIndex, cellIndex } = expansion.sourceCell;
  lhs[rowIndex]![cellIndex] = replaceInCell(lhs[rowIndex]![cellIndex]!, expansion);
  if (rhs.length > 0) {
    rhs[rowIndex]![cellIndex] = replaceInCell(rhs[rowIndex]![cellIndex]!, expansion);
  }
  return { rule: { ...parent.rule, lhs, rhs },
    expansions: [...parent.expansions, expansion] };
}

/** Finish one cell's families in term order. Repeated entity/family terms share a choice. */
function chooseCellMovements(parent: PartialRule, sourceCell: RuleCellAddress): PartialRule[] {
  const { rowIndex, cellIndex } = sourceCell;
  const term = parent.rule.lhs[rowIndex]![cellIndex]!.find((candidate): candidate is NamedRuleTerm<MovementFamily> =>
    isMovementFamily(candidate.qualifier));
  if (term === undefined) return [parent];
  return choices(term.qualifier).flatMap(chosenQualifier => {
    const child = expandAt(parent, { entityName: term.name, family: term.qualifier, chosenQualifier, sourceCell });
    return chooseCellMovements(child, sourceCell);
  });
}

/** The entity/family's first choice is usable only when all its evidence comes from one cell. */
function entityMovementSource(expansions: readonly MovementExpansion[], entityName: string,
  family: MovementFamily): MovementExpansion | undefined {
  let first: MovementExpansion | undefined;
  for (const expansion of expansions) {
    if (expansion.entityName !== entityName || expansion.family !== family) continue;
    if (first === undefined) first = expansion;
    else if (!sameRuleCell(first.sourceCell, expansion.sourceCell)) return undefined;
  }
  return first;
}

/** Crossing entity names requires exactly one expansion event for this family. */
function singleFamilyExpansion(expansions: readonly MovementExpansion[], family: MovementFamily): MovementExpansion | undefined {
  let source: MovementExpansion | undefined;
  for (const expansion of expansions) {
    if (expansion.family !== family) continue;
    if (source !== undefined) return undefined;
    source = expansion;
  }
  return source;
}

function inferRightMovements(partial: PartialRule): OrientedRule {
  const rhs = partial.rule.rhs.map(row => row.map(cell => cell.map(term => {
    if (!isMovementFamily(term.qualifier)) return term;
    // Matching same-cell terms were already replaced during local expansion.
    const source = entityMovementSource(partial.expansions, term.name, term.qualifier)
      ?? singleFamilyExpansion(partial.expansions, term.qualifier);
    return source === undefined ? term : { ...term, qualifier: source.chosenQualifier };
  })));
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

/** Enumerate concrete assignments in surviving native order, then infer RHS movement. */
export function expandRuleMovements(rules: readonly OrientedRule[], report?: SourceIssueReporter): MovementExpansionResult {
  const expanded: OrientedRule[] = [];
  const diagnostics: SourceDiagnostic[] = [];
  for (const input of rules) {
    let partials: PartialRule[] = [{ rule: { ...input, lhs: copyRows(input.lhs), rhs: copyRows(input.rhs) }, expansions: [] }];
    // Of the native interleavings, the last one finishes the last cell first.
    // Enumerate that order directly: earlier cells' choices vary faster.
    // Separate inputs remain separate until the final duplicate pass.
    for (let rowIndex = input.lhs.length - 1; rowIndex >= 0; rowIndex--) {
      for (let cellIndex = input.lhs[rowIndex]!.length - 1; cellIndex >= 0; cellIndex--) {
        const sourceCell = { rowIndex, cellIndex };
        partials = partials.flatMap(parent => chooseCellMovements(parent, sourceCell));
      }
    }

    const variants = partials.map(inferRightMovements);
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
