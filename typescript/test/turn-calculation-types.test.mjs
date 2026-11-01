import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('calculated turns distinguish turn inputs from object movements and execution snapshots', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ps-turn-calculation-types-'));
  try {
    const sourcePath = name => relative(directory, fileURLToPath(new URL(`../src/${name}.js`, import.meta.url)));
    const source = `
import { Movement, TurnInput } from ${JSON.stringify(sourcePath('model'))};
import type { RuleExecutionState } from ${JSON.stringify(sourcePath('execution-model'))};
import { calculateTurn, applyTurnRules, startPlayerMovement, type CalculatedTurn,
  type TurnRulesGame, type TurnRulesResult } from ${JSON.stringify(sourcePath('turn-rules'))};
import { movementInput } from ${JSON.stringify(sourcePath('turn-input'))};

declare const game: TurnRulesGame;
declare const execution: RuleExecutionState;
const automatic: CalculatedTurn = calculateTurn(game, execution, TurnInput.None);
const player: CalculatedTurn = calculateTurn(game, execution, TurnInput.Right);
const recorded: TurnInput = automatic.input;
const state: RuleExecutionState = player.state;
const attempts: number = player.attempts;
const oldResult: TurnRulesResult = applyTurnRules(game, execution, Movement.Right);
const oldAutomatic: TurnRulesResult = applyTurnRules(game, execution, null);
startPlayerMovement(game, execution, Movement.Action);
const converted: TurnInput = movementInput(Movement.Up);
const noInput: TurnInput = movementInput(null);
// @ts-expect-error Turn inputs and per-layer movements are separate domains.
const movement: Movement = TurnInput.None;
// @ts-expect-error All turn input members remain distinct from object movements.
const directionalMovement: Movement = TurnInput.Right;
// @ts-expect-error Core calculation uses explicit None instead of null.
calculateTurn(game, execution, null);
// @ts-expect-error Object Movement is not the input enum.
calculateTurn(game, execution, Movement.Right);
// @ts-expect-error The conversion boundary accepts object movements, not turn inputs.
movementInput(TurnInput.Up);
// @ts-expect-error A raw execution snapshot is not a calculated turn.
const missingCalculation: CalculatedTurn = execution;
// @ts-expect-error A component result does not record the calculation's input.
const missingInput: CalculatedTurn = oldResult;
// @ts-expect-error Calculated turns have flat fields without a result wrapper.
player.result;
// @ts-expect-error The public component API retains its existing result shape.
oldResult.input;
void [recorded, state, attempts, oldAutomatic, converted, noInput, movement,
  directionalMovement, missingCalculation, missingInput];
`;
    const file = join(directory, 'turn-calculation.mts');
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
