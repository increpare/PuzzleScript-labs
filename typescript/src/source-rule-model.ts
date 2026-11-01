import type { Command } from './commands.js';
import type { Direction } from './model.js';
import type { SourceDiagnostic, SourceLoopMarker, SourcePatternRule, SourceSpan } from './source-model.js';

/** Stable qualifier identities shared by the finite domains below. */
export enum RuleQualifier {
  Unspecified, Up, Down, Left, Right, Action, Stationary, No,
  RandomObject, RandomDirection, Horizontal, Vertical, Orthogonal, Moving,
  Forward, Backward, Counterclockwise, Clockwise, Parallel, Perpendicular,
  HorizontalParallel, VerticalParallel, HorizontalPerpendicular, VerticalPerpendicular, Ellipsis,
}

export type AbsoluteMovementQualifier = RuleQualifier.Up | RuleQualifier.Down | RuleQualifier.Left
  | RuleQualifier.Right | RuleQualifier.Action;
export type AtomicQualifier = AbsoluteMovementQualifier | RuleQualifier.Unspecified | RuleQualifier.Stationary
  | RuleQualifier.No | RuleQualifier.RandomObject | RuleQualifier.RandomDirection | RuleQualifier.Ellipsis;
export type SourceMovementFamily = RuleQualifier.Horizontal | RuleQualifier.Vertical
  | RuleQualifier.Orthogonal | RuleQualifier.Moving;
export type MovementFamily = SourceMovementFamily | RuleQualifier.HorizontalParallel | RuleQualifier.VerticalParallel
  | RuleQualifier.HorizontalPerpendicular | RuleQualifier.VerticalPerpendicular;
export type RelativeQualifier = RuleQualifier.Forward | RuleQualifier.Backward | RuleQualifier.Counterclockwise
  | RuleQualifier.Clockwise | RuleQualifier.Parallel | RuleQualifier.Perpendicular;
/** Authored syntax excludes the internal parallel/perpendicular family identities. */
export type SourceQualifier = AtomicQualifier | SourceMovementFamily | RelativeQualifier;
export type OrientedQualifier = AtomicQualifier | MovementFamily;

export interface NamedRuleTerm<Q extends RuleQualifier = RuleQualifier> {
  readonly qualifier: Q;
  readonly name: string;
  readonly origin: SourceSpan;
}
// Explicit covariance keeps qualifier-domain checks on nested readonly arrays.
export interface NamedRuleCell<out Q extends RuleQualifier = RuleQualifier> extends ReadonlyArray<NamedRuleTerm<Q>> {}
export interface NamedRuleRows<out Q extends RuleQualifier = RuleQualifier> extends ReadonlyArray<ReadonlyArray<NamedRuleCell<Q>>> {}

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
  readonly lhs: NamedRuleRows<SourceQualifier>;
  readonly rhs: NamedRuleRows<SourceQualifier>;
}
export interface DirectedNamedRule<out Q extends RuleQualifier = RuleQualifier> extends RuleHeader {
  readonly direction: Direction;
  readonly lhs: NamedRuleRows<Q>;
  readonly rhs: NamedRuleRows<Q>;
}
/** One retained syntax selector, after relative movement and row orientation. */
export type OrientedRule = DirectedNamedRule<OrientedQualifier>;
/** Movement families have been expanded or inferred on both sides. */
export type MovementRule = DirectedNamedRule<AtomicQualifier>;
export interface RuleSyntaxResult {
  readonly rules: readonly RuleSyntax[];
  readonly loops: readonly SourceLoopMarker[];
  readonly diagnostics: readonly SourceDiagnostic[];
  readonly abortsCompilation: boolean;
}
