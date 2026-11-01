import type { SourceSpan } from './source-model.js';
import type { MovementFamily } from './source-rule-model.js';
import type { ObjectSource, RuleCellAddress } from './rule-object-sources.js';

export enum RuleProblemKind { RowCountMismatch, CellCountMismatch, PropertyInference, MovementInference }

/** Coordinates refer to the rule at the reporting pass; spans retain authored text. */
export interface RuleProblemLocation {
  readonly cell: RuleCellAddress;
  readonly span: SourceSpan;
}

export interface MovementProblemSource extends RuleProblemLocation {
  readonly entityName: string;
}

/** Diagnostic facts are independent of legacy wording, severity and recovery policy. */
export type RuleProblem =
  { readonly kind: RuleProblemKind.RowCountMismatch;
    readonly leftRowCount: number; readonly rightRowCount: number;
    readonly leftRows: readonly SourceSpan[]; readonly rightRows: readonly SourceSpan[] } |
  { readonly kind: RuleProblemKind.CellCountMismatch; readonly rowIndex: number;
    readonly leftCellCount: number; readonly rightCellCount: number;
    readonly leftSpan: SourceSpan; readonly rightSpan: SourceSpan } |
  { readonly kind: RuleProblemKind.PropertyInference; readonly property: string;
    readonly target: RuleProblemLocation; readonly source: ObjectSource;
    readonly candidates: readonly RuleProblemLocation[] } |
  { readonly kind: RuleProblemKind.MovementInference; readonly entityName: string;
    readonly family: MovementFamily; readonly target: RuleProblemLocation;
    readonly entitySources: readonly RuleProblemLocation[];
    readonly familySources: readonly MovementProblemSource[] };
