import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('object source types require case-specific cell addresses and readonly inputs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ps-object-source-types-'));
  try {
    const modulePath = relative(directory, fileURLToPath(new URL('../src/rule-object-sources.js', import.meta.url)));
    const source = `
import { ObjectSourceKind, resolveObjectSource, sameRuleCell, type ObjectSource, type RuleCellAddress }
  from ${JSON.stringify(modulePath)};

const cell: RuleCellAddress = { rowIndex: 0, cellIndex: 1 };
const candidates: readonly RuleCellAddress[] = [cell];
const resolved: ObjectSource = { kind: ObjectSourceKind.Resolved, cell };
const missing: ObjectSource = { kind: ObjectSourceKind.Missing };
const ambiguous: ObjectSource = { kind: ObjectSourceKind.Ambiguous, cells: candidates };
const inferred: ObjectSource = resolveObjectSource(candidates, cell);
const same: boolean = sameRuleCell(cell, cell);
const numericKind: number = ObjectSourceKind.Resolved;

// @ts-expect-error Resolved sources require their cell address.
const missingCell: ObjectSource = { kind: ObjectSourceKind.Resolved };
// @ts-expect-error Missing sources have no cell address.
const missingWithCell: ObjectSource = { kind: ObjectSourceKind.Missing, cell };
// @ts-expect-error Ambiguous sources require their candidate cell addresses.
const missingCells: ObjectSource = { kind: ObjectSourceKind.Ambiguous };
// @ts-expect-error Resolved sources carry one cell, not a candidate array.
const resolvedWithCells: ObjectSource = { kind: ObjectSourceKind.Resolved, cells: candidates };
// @ts-expect-error Ambiguous sources carry a candidate array, not one cell.
const ambiguousWithCell: ObjectSource = { kind: ObjectSourceKind.Ambiguous, cell };
// @ts-expect-error Every cell address requires both indices.
const incompleteCell: RuleCellAddress = { cellIndex: 1 };
// @ts-expect-error Cell addresses are immutable.
cell.rowIndex = 2;
// @ts-expect-error Cell addresses are immutable.
cell.cellIndex = 2;
// @ts-expect-error Source kinds are immutable.
resolved.kind = ObjectSourceKind.Missing;
// @ts-expect-error Resolved cell references are immutable.
resolved.cell = cell;
// @ts-expect-error Ambiguous source arrays are immutable.
ambiguous.cells.push(cell);
// @ts-expect-error Ambiguous source array references are immutable.
ambiguous.cells = [];
// @ts-expect-error The resolver takes only source addresses and a target address.
resolveObjectSource(candidates, cell, new Map());

function inspect(source: ObjectSource): RuleCellAddress | readonly RuleCellAddress[] | null {
  switch (source.kind) {
    case ObjectSourceKind.Resolved:
      // @ts-expect-error Resolved sources have no candidate array.
      source.cells;
      return source.cell;
    case ObjectSourceKind.Missing:
      // @ts-expect-error Missing sources carry no cell address.
      source.cell;
      // @ts-expect-error Missing sources carry no candidate array.
      source.cells;
      return null;
    case ObjectSourceKind.Ambiguous:
      // @ts-expect-error Ambiguous sources have no single resolved cell.
      source.cell;
      return source.cells;
  }
}
void [resolved, missing, ambiguous, inferred, same, numericKind, inspect];
`;
    const file = join(directory, 'object-sources.mts');
    const config = join(directory, 'tsconfig.json');
    await writeFile(file, source);
    await writeFile(config, JSON.stringify({ compilerOptions: {
      target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
      noEmit: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, types: [],
    }, files: [file] }));
    const compiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
    const result = spawnSync(process.execPath, [compiler, '-p', config], { encoding: 'utf8', timeout: 30000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
