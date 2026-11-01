import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('accepted sound and win definitions require complete variant payloads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ps-sound-win-types-'));
  try {
    const path = name => relative(directory, fileURLToPath(new URL(`../src/${name}.js`, import.meta.url)));
    const source = `
import { AcceptedSoundKind, SoundEventKind, SoundVerb, SoundDirectionFamily, SoundSeedKind,
  type AcceptedSound, type SoundEvent, type SoundTargetVerb } from ${JSON.stringify(path('source-sound-syntax'))};
import { WinSyntaxKind, WinTargetKind, type AcceptedWinCondition } from ${JSON.stringify(path('source-win-syntax'))};
import { type SourceLexicalToken, type SourceSound, type SourceWinCondition } from ${JSON.stringify(path('source-model'))};
import { SimpleSound } from ${JSON.stringify(path('session-model'))};
import { WinQuantifier } from ${JSON.stringify(path('win-conditions'))};
declare const token: SourceLexicalToken;
const event: SoundEvent = { kind: SoundEventKind.Simple, sound: SimpleSound.Undo, token };
const seed = { kind: SoundSeedKind.Numeric, token } as const;
const complete: AcceptedSound = { kind: AcceptedSoundKind.Event, event, seed: token };
const target: AcceptedSound = { kind: AcceptedSoundKind.Target, target: token,
  verb: { kind: SoundVerb.Move, token, directions: [{ family: SoundDirectionFamily.Up, token }] }, seed };
const bareEvent: AcceptedSound = { kind: AcceptedSoundKind.BareEvent, event };
const bareTarget: AcceptedSound = { kind: AcceptedSoundKind.BareTarget, target: token };
// @ts-expect-error An accepted complete event requires its seed.
const missingSeed: AcceptedSound = { kind: AcceptedSoundKind.Event, event };
// @ts-expect-error An accepted complete event requires its event payload.
const missingEvent: AcceptedSound = { kind: AcceptedSoundKind.Event, seed: token };
// @ts-expect-error An accepted target requires its target token.
const missingTarget: AcceptedSound = { kind: AcceptedSoundKind.Target, verb: { kind: SoundVerb.Create, token }, seed };
// @ts-expect-error An SFX event carries an index, not a SimpleSound payload.
const wrongEvent: SoundEvent = { kind: SoundEventKind.SFX, sound: SimpleSound.Undo, token };
// @ts-expect-error A bare target cannot carry an event instead of a target token.
const wrongTarget: AcceptedSound = { kind: AcceptedSoundKind.BareTarget, event };
// @ts-expect-error Non-directional verbs cannot carry directions.
const wrongVerb: SoundTargetVerb = { kind: SoundVerb.Create, token, directions: [] };
const win: AcceptedWinCondition = { kind: WinSyntaxKind.Clause, quantifier: WinQuantifier.All,
  quantifierToken: token, subjectToken: token, target: { kind: WinTargetKind.Everywhere } };
// @ts-expect-error A recovered clause always has a subject.
const missingSubject: AcceptedWinCondition = { kind: WinSyntaxKind.Clause, quantifier: WinQuantifier.All, quantifierToken: token, target: { kind: WinTargetKind.Everywhere } };
// @ts-expect-error A named target always has a token.
const missingWinTarget: AcceptedWinCondition = { ...win, target: { kind: WinTargetKind.Named } };
// @ts-expect-error Everywhere cannot carry a named target token.
const mixedWinTarget: AcceptedWinCondition = { ...win, target: { kind: WinTargetKind.Everywhere, token } };
declare const entry: Omit<SourceSound, 'definition'>;
// @ts-expect-error Raw evidence requires an explicit accepted-definition decision.
const missingDefinition: SourceSound = entry;
declare const winEntry: Omit<SourceWinCondition, 'definition'>;
// @ts-expect-error Win evidence likewise requires an explicit recovered definition.
const missingWinDefinition: SourceWinCondition = winEntry;
void [complete, target, bareEvent, bareTarget, missingSeed, missingEvent, missingTarget, wrongEvent, wrongTarget, wrongVerb,
  win, missingSubject, missingWinTarget, mixedWinTarget, missingDefinition, missingWinDefinition];
`;
    const file = join(directory, 'contract.mts');
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
