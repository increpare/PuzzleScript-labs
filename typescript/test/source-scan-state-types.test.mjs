import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('scanner states keep section phases and sound payloads together', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ps-scan-state-types-'));
  try {
    const statePath = relative(directory, fileURLToPath(new URL('../src/source-scan-state.js', import.meta.url)));
    const modelPath = relative(directory, fileURLToPath(new URL('../src/source-model.js', import.meta.url)));
    const soundPath = relative(directory, fileURLToPath(new URL('../src/source-sound-syntax.js', import.meta.url)));
    const source = `
import { PreludePhase, ObjectPhase, LegendPhase, SoundPhase, RulePhase, WinPhase, LevelPhase,
  type SourceScanState } from ${JSON.stringify(statePath)};
import { SourceSectionKind, type SourceLexicalToken } from ${JSON.stringify(modelPath)};
import { SoundEventKind, SoundVerb, type SoundEvent, type CompleteSound,
  type DirectionalSoundVerb, type OtherSoundVerb } from ${JSON.stringify(soundPath)};

const word = { spelling: 'SFX0', normalized: 'sfx0', span: {
  start: { offset: 0, line: 1, column: 1 }, end: { offset: 4, line: 1, column: 5 } } };
const token = { value: 'sfx0', word };
const event: SoundEvent = { kind: SoundEventKind.SFX, index: 0, token };
const rules: SourceScanState = { section: SourceSectionKind.Rules, phase: RulePhase.Prelude };
const eventSeed: SourceScanState = { section: SourceSectionKind.Sounds, phase: SoundPhase.EventSeed, event };
const collision: SourceScanState = { section: SourceSectionKind.CollisionLayers };
// @ts-expect-error A rules scanner cannot own an object phase.
const wrongSection: SourceScanState = { section: SourceSectionKind.Rules, phase: ObjectPhase.Colors };
// @ts-expect-error An event seed is only possible after retaining the event token.
const missingEvent: SourceScanState = { section: SourceSectionKind.Sounds, phase: SoundPhase.EventSeed };
// @ts-expect-error Directional recovery requires the recognized target and verb.
const missingPartial: SourceScanState = { section: SourceSectionKind.Sounds, phase: SoundPhase.DirectionOrSeed };
// @ts-expect-error An object verb cannot be retained without its target.
const missingTarget: SourceScanState = { section: SourceSectionKind.Sounds, phase: SoundPhase.Verb };
// @ts-expect-error A non-directional verb cannot enter the direction phase.
const wrongVerb: SourceScanState = { section: SourceSectionKind.Sounds, phase: SoundPhase.DirectionOrSeed, target: token, verb: { kind: SoundVerb.Create, token } };

function assertNever(value: never): never { throw new Error(String(value)); }
function inspect(state: SourceScanState): void {
  switch (state.section) {
    case null: state.phase satisfies PreludePhase; return;
    case SourceSectionKind.Objects: state.phase satisfies ObjectPhase; return;
    case SourceSectionKind.Legend: state.phase satisfies LegendPhase; return;
    case SourceSectionKind.CollisionLayers:
      // @ts-expect-error Collision scanning has no unrelated positional phase.
      state.phase;
      return;
    case SourceSectionKind.Rules: state.phase satisfies RulePhase; return;
    case SourceSectionKind.WinConditions: state.phase satisfies WinPhase; return;
    case SourceSectionKind.Levels: state.phase satisfies LevelPhase; return;
    case SourceSectionKind.Sounds:
      switch (state.phase) {
        case SoundPhase.EventSeed: state.event satisfies SoundEvent; return;
        case SoundPhase.Verb: state.target satisfies SourceLexicalToken; return;
        case SoundPhase.DirectionOrSeed: state.verb satisfies DirectionalSoundVerb; state.target satisfies SourceLexicalToken; return;
        case SoundPhase.Seed: state.verb satisfies OtherSoundVerb; state.target satisfies SourceLexicalToken; return;
        case SoundPhase.End:
          state.definition satisfies CompleteSound;
          // @ts-expect-error Completed sounds keep their variant, not an optional event mirror.
          state.event;
          return;
        case SoundPhase.Head:
        case SoundPhase.Failed:
          // @ts-expect-error No event has been retained in these sound phases.
          state.event;
          // @ts-expect-error These phases do not need previous-token diagnostics.
          state.previous;
          return;
        default: return assertNever(state);
      }
    default: return assertNever(state);
  }
}
void [rules, eventSeed, collision, wrongSection, missingEvent, missingPartial, missingTarget, wrongVerb, inspect];
`;
    const file = join(directory, 'scan-state.mts');
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
