import type { Command } from './commands.js';
import type { Direction } from './model.js';
import type { SourceDiagnostic, SourceLoopMarker, SourcePatternRule, SourceSpan } from './source-model.js';

/** Source movement identities, before orientation, family expansion or name inference. */
export enum RuleQualifier {
  Unspecified, Up, Down, Left, Right, Action, Stationary, No,
  RandomObject, RandomDirection, Horizontal, Vertical, Orthogonal, Moving,
  Forward, Backward, Counterclockwise, Clockwise, Parallel, Perpendicular,
  HorizontalParallel, VerticalParallel, HorizontalPerpendicular, VerticalPerpendicular, Ellipsis,
}

export interface NamedRuleTerm {
  readonly qualifier: RuleQualifier;
  readonly name: string;
  readonly origin: SourceSpan;
}
export type NamedRuleCell = readonly NamedRuleTerm[];
export type NamedRuleRows = readonly (readonly NamedRuleCell[])[];

export interface RuleHeader {
  readonly source: SourcePatternRule;
  readonly sourceGroup: number;
  readonly late: boolean;
  readonly rigid: boolean;
  readonly random: boolean;
  readonly commands: readonly Command[];
}
export interface RuleSyntax extends RuleHeader {
  readonly directions: readonly Direction[];
  readonly lhs: NamedRuleRows;
  readonly rhs: NamedRuleRows;
}
/** One retained syntax selector, after relative movement and row orientation. */
export interface OrientedRule extends RuleHeader {
  readonly direction: Direction;
  readonly lhs: NamedRuleRows;
  readonly rhs: NamedRuleRows;
}
export interface RuleSyntaxResult {
  readonly rules: readonly RuleSyntax[];
  readonly loops: readonly SourceLoopMarker[];
  readonly diagnostics: readonly SourceDiagnostic[];
  readonly abortsCompilation: boolean;
}
