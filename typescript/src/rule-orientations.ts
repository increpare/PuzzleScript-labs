import { Direction } from './model.js';
import { RuleQualifier, type NamedRuleRows, type OrientedRule, type RuleSyntax } from './source-rule-model.js';

/** Resolve one retained selector before the compiler visits its invalid checkpoint. */
export function orientRule(rule: RuleSyntax, original: Direction): OrientedRule {
  function absolute(qualifier: RuleQualifier, direction: Direction): RuleQualifier {
    switch (qualifier) {
      case RuleQualifier.Counterclockwise:
      case RuleQualifier.Clockwise:
      case RuleQualifier.Backward:
      case RuleQualifier.Forward:
      case RuleQualifier.Parallel:
      case RuleQualifier.Perpendicular:
        break;
      default:
        return qualifier;
    }
    if (direction === Direction.InPlace) {
      // Native fails its relative-direction lookup for this recovered selector.
      throw new TypeError('InPlace rule orientation cannot resolve a relative movement qualifier.');
    }
    if (qualifier === RuleQualifier.Parallel) {
      return direction === Direction.Left || direction === Direction.Right
        ? RuleQualifier.HorizontalParallel : RuleQualifier.VerticalParallel;
    }
    if (qualifier === RuleQualifier.Perpendicular) {
      return direction === Direction.Left || direction === Direction.Right
        ? RuleQualifier.VerticalPerpendicular : RuleQualifier.HorizontalPerpendicular;
    }
    switch (direction) {
      case Direction.Right:
        switch (qualifier) {
          case RuleQualifier.Counterclockwise: return RuleQualifier.Up;
          case RuleQualifier.Clockwise: return RuleQualifier.Down;
          case RuleQualifier.Backward: return RuleQualifier.Left;
          default: return RuleQualifier.Right;
        }
      case Direction.Up:
        switch (qualifier) {
          case RuleQualifier.Counterclockwise: return RuleQualifier.Left;
          case RuleQualifier.Clockwise: return RuleQualifier.Right;
          case RuleQualifier.Backward: return RuleQualifier.Down;
          default: return RuleQualifier.Up;
        }
      case Direction.Down:
        switch (qualifier) {
          case RuleQualifier.Counterclockwise: return RuleQualifier.Right;
          case RuleQualifier.Clockwise: return RuleQualifier.Left;
          case RuleQualifier.Backward: return RuleQualifier.Up;
          default: return RuleQualifier.Down;
        }
      case Direction.Left:
        switch (qualifier) {
          case RuleQualifier.Counterclockwise: return RuleQualifier.Down;
          case RuleQualifier.Clockwise: return RuleQualifier.Up;
          case RuleQualifier.Backward: return RuleQualifier.Right;
          default: return RuleQualifier.Left;
        }
    }
  }

  function orientSide(side: NamedRuleRows, direction: Direction, reverseRows: number): NamedRuleRows {
    return side.map((row, index) => {
      const oriented = row.map(cell => cell.map(term => ({ ...term, qualifier: absolute(term.qualifier, direction) })));
      if (index < reverseRows) oriented.reverse();
      return oriented;
    });
  }

  // Native only inspects the first term's name in each LHS cell.
  const hasEllipsis = rule.lhs.some(row => row.some(cell => cell[0]?.name === '...'));
  const { directions, ...header } = rule;
  const reverse = !hasEllipsis && (original === Direction.Up || original === Direction.Left);
  const direction = reverse ? original === Direction.Up ? Direction.Down : Direction.Right : original;
  const reverseRows = reverse ? rule.lhs.length : 0;
  return { ...header, direction,
    lhs: orientSide(rule.lhs, original, reverseRows), rhs: orientSide(rule.rhs, original, reverseRows) };
}

/** Emit one variant per retained selector, resolving movement before reversing rows. */
export function orientRules(rules: readonly RuleSyntax[]): readonly OrientedRule[] {
  return rules.flatMap(rule => rule.directions.map(direction => orientRule(rule, direction)));
}
