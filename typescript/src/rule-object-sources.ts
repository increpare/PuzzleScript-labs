export interface RuleCellAddress {
  readonly rowIndex: number;
  readonly cellIndex: number;
}

export enum ObjectSourceKind { Resolved, Missing, Ambiguous }

export type ObjectSource =
  | { readonly kind: ObjectSourceKind.Resolved; readonly cell: RuleCellAddress }
  | { readonly kind: ObjectSourceKind.Missing }
  | { readonly kind: ObjectSourceKind.Ambiguous; readonly cells: readonly RuleCellAddress[] };

export function sameRuleCell(a: RuleCellAddress, b: RuleCellAddress): boolean {
  return a.rowIndex === b.rowIndex && a.cellIndex === b.cellIndex;
}

export function resolveObjectSource(candidates: readonly RuleCellAddress[], target: RuleCellAddress): ObjectSource {
  const local = candidates.find(candidate => sameRuleCell(candidate, target));
  if (local !== undefined) return { kind: ObjectSourceKind.Resolved, cell: local };

  const cells: RuleCellAddress[] = [];
  for (const candidate of candidates) {
    if (!cells.some(cell => sameRuleCell(cell, candidate))) cells.push(candidate);
  }
  if (cells.length > 1) return { kind: ObjectSourceKind.Ambiguous, cells };
  const cell = cells[0];
  return cell === undefined ? { kind: ObjectSourceKind.Missing } : { kind: ObjectSourceKind.Resolved, cell };
}
