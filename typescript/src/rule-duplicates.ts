import { CommandKind, type Command } from './commands.js';
import { RuleQualifier, type NamedRuleRows, type OrientedRule } from './source-rule-model.js';

function sameRows(first: NamedRuleRows, second: NamedRuleRows): boolean {
  if (first.length !== second.length) return false;
  for (let rowIndex = 0; rowIndex < first.length; rowIndex++) {
    const firstRow = first[rowIndex]!, secondRow = second[rowIndex]!;
    if (firstRow.length !== secondRow.length) return false;
    for (let cellIndex = 0; cellIndex < firstRow.length; cellIndex++) {
      const firstCell = firstRow[cellIndex]!, secondCell = secondRow[cellIndex]!;
      if (firstCell.length !== secondCell.length) return false;
      for (let termIndex = 0; termIndex < firstCell.length; termIndex++) {
        const firstTerm = firstCell[termIndex]!, secondTerm = secondCell[termIndex]!;
        if (firstTerm.qualifier !== secondTerm.qualifier) return false;
        // Native printing omits the name even in a malformed recovered ellipsis term.
        if (firstTerm.qualifier !== RuleQualifier.Ellipsis && firstTerm.name !== secondTerm.name) return false;
      }
    }
  }
  return true;
}

function sameCommands(first: readonly Command[], second: readonly Command[]): boolean {
  if (first.length !== second.length) return false;
  for (let index = 0; index < first.length; index++) {
    const firstCommand = first[index]!, secondCommand = second[index]!;
    if (firstCommand.kind !== secondCommand.kind) return false;
    if (firstCommand.kind === CommandKind.Message
      && (secondCommand.kind !== CommandKind.Message || firstCommand.text !== secondCommand.text)) return false;
    if (firstCommand.kind === CommandKind.Sound
      && (secondCommand.kind !== CommandKind.Sound || firstCommand.index !== secondCommand.index)) return false;
  }
  return true;
}

function sameRule(first: OrientedRule, second: OrientedRule): boolean {
  if (first.source.originalLine.span.start.line !== second.source.originalLine.span.start.line
    || first.late !== second.late || first.rigid !== second.rigid || first.random !== second.random) return false;
  if (!sameRows(first.lhs, second.lhs) || !sameRows(first.rhs, second.rhs)) return false;
  // Several independent single-cell rows still have no printed orientation.
  if (first.lhs.some(row => row.length > 1) && first.direction !== second.direction) return false;
  return sameCommands(first.commands, second.commands);
}

/** Keep the last equal variant within each contiguous source group, in source order. */
export function normalizeRuleDuplicates(rules: readonly OrientedRule[]): readonly OrientedRule[] {
  const survivors: OrientedRule[] = [];
  let group: number | undefined;
  let retained: OrientedRule[] = [];
  for (let index = rules.length - 1; index >= 0; index--) {
    const rule = rules[index]!;
    if (rule.sourceGroup !== group) retained = [];
    group = rule.sourceGroup;
    if (retained.some(other => sameRule(rule, other))) continue;
    retained.push(rule);
    survivors.push(rule);
  }
  return survivors.reverse();
}
