import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('rule pass contracts retain finite qualifier domains through successful lowering', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ps-rule-pass-types-'));
  try {
    const modulePath = name => JSON.stringify(relative(directory,
      fileURLToPath(new URL(`../src/${name}.js`, import.meta.url))));
    const source = `
import { RuleQualifier as Q, type AbsoluteMovementQualifier, type AtomicQualifier,
  type SourceMovementFamily, type MovementFamily, type RelativeQualifier, type SourceQualifier,
  type OrientedQualifier, type NamedRuleTerm, type NamedRuleCell, type NamedRuleRows,
  type DirectedNamedRule, type RuleSyntax, type OrientedRule, type MovementRule }
  from ${modulePath('source-rule-model')};
import { Direction } from ${modulePath('model')};
import { SourceRuleCommandKind, type SourceRuleCommand, type SourcePatternRule,
  type SourceRuleTerm, type SourceSpan, type SourceWord } from ${modulePath('source-model')};
import type { ResolvedDeclarations } from ${modulePath('declaration-model')};
import { orientRule } from ${modulePath('rule-orientations')};
import { expandRuleMovements } from ${modulePath('rule-movements')};
import { expandRuleProperties } from ${modulePath('rule-properties')};
import { inferSpawnedStationary } from ${modulePath('rule-spawns')};
import { normalizeRuleDuplicates } from ${modulePath('rule-duplicates')};
import { lowerRules, type LoweredRule } from ${modulePath('rule-lowering')};
import { expandSourceRules, lowerSourceRules } from ${modulePath('source-rule-compiler')};
import { RuleRecoveryKind, RuleExpansionKind, RuleCompilationCheckpoint,
  type RuleRecovery, type RuleCompilationFailure } from ${modulePath('rule-recovery')};
import { SourceRuleKind, type SourceDocument, type SourceDiagnostic } from ${modulePath('source-model')};
import { SourceCompilationKind, SourceCompilationFailureKind, compileSource } from ${modulePath('source-compiler')};

declare const origin: SourceSpan;
declare const authored: SourcePatternRule;
declare const declarations: ResolvedDeclarations;
declare const document: SourceDocument;
declare const word: SourceWord;
const sound0: SourceRuleCommand = { kind: SourceRuleCommandKind.SoundEffect, word, index: 0 };
const sound10: SourceRuleCommand = { kind: SourceRuleCommandKind.SoundEffect, word, index: 10 };
// @ts-expect-error Authored sound commands use only the finite SFX0 through SFX10 domain.
const sound11: SourceRuleCommand = { kind: SourceRuleCommandKind.SoundEffect, word, index: 11 };
declare const message: Extract<SourceRuleCommand, { kind: SourceRuleCommandKind.Message }>;
const authoredPayload: string = message.authoredPayload;
const effectiveText: string = message.text;
// @ts-expect-error Authored evidence and effective text have no unused legacy payload mirror.
const falsePayloadMirror = message.legacyPayload;
const absolute: AbsoluteMovementQualifier = Q.Action;
const atomic: AtomicQualifier = Q.RandomObject;
const sourceFamily: SourceMovementFamily = Q.Moving;
const family: MovementFamily = Q.HorizontalParallel;
const relative: RelativeQualifier = Q.Forward;
const sourceQualifier: SourceQualifier = relative;
const orientedQualifier: OrientedQualifier = family;
// @ts-expect-error Relative movement is not absolute.
const relativeAbsolute: AbsoluteMovementQualifier = Q.Forward;
// @ts-expect-error Atomic movement excludes families.
const atomicFamily: AtomicQualifier = Q.Horizontal;
// @ts-expect-error Internal orientation families are never authored qualifiers.
const internalSourceFamily: SourceMovementFamily = Q.VerticalPerpendicular;
// @ts-expect-error Internal orientation families are never authored qualifiers.
const internalSource: SourceQualifier = Q.HorizontalParallel;
// @ts-expect-error Nor can internal families enter the authored term payload.
const internalPayload: SourceRuleTerm['qualifierValue'] = Q.HorizontalPerpendicular;
// @ts-expect-error Oriented terms have no relative qualifiers.
const relativeOriented: OrientedQualifier = Q.Parallel;

const sourceTerm: NamedRuleTerm<SourceQualifier> = { qualifier: Q.Forward, name: 'player', origin };
const sourceCell: NamedRuleCell<SourceQualifier> = [sourceTerm];
const sourceRows: NamedRuleRows<SourceQualifier> = [[sourceCell]];
const syntax: RuleSyntax = { source: authored, sourceGroup: 1, late: false, rigid: false,
  random: false, commands: [], directions: [Direction.Up], lhs: sourceRows, rhs: sourceRows };
// @ts-expect-error Syntax cannot contain an orientation-only family.
const invalidSyntax: RuleSyntax = { ...syntax, lhs: [[[{ qualifier: Q.VerticalParallel, name: 'player', origin }]]] };
const oriented: OrientedRule = orientRule(syntax, Direction.Up);
const inPlace: OrientedRule = { ...oriented, direction: Direction.InPlace };
const withFamily: OrientedRule = { ...oriented, rhs: [[[{ qualifier: Q.Horizontal, name: 'player', origin }]]] };
// @ts-expect-error The readonly rows preserve their qualifier domain.
const atomicRows: NamedRuleRows<AtomicQualifier> = withFamily.rhs;
// @ts-expect-error The readonly cells preserve their qualifier domain.
const atomicCell: NamedRuleCell<AtomicQualifier> = withFamily.rhs[0]![0]!;
// @ts-expect-error The readonly terms preserve their qualifier domain.
const atomicTerm: NamedRuleTerm<AtomicQualifier> = withFamily.rhs[0]![0]![0]!;
// @ts-expect-error Relative qualifiers cannot survive orientation.
const relativeRule: OrientedRule = { ...oriented, lhs: sourceRows };
const movement: MovementRule = { ...oriented, lhs: [[[{ qualifier: Q.Up, name: 'player', origin }]]], rhs: [] };
// @ts-expect-error A movement rule cannot contain a family.
const unresolved: MovementRule = withFamily;
// @ts-expect-error A movement rule cannot contain a relative qualifier.
const relativeMovement: MovementRule = { ...movement, lhs: sourceRows };

const result = expandRuleMovements([oriented]);
// @ts-expect-error A broad movement result has not established successful expansion.
lowerRules(result.rules, declarations);
// @ts-expect-error Oriented inputs may still contain families.
lowerRules([oriented], declarations);
// @ts-expect-error The source lowering composition requires the same successful movement domain.
lowerSourceRules([oriented], declarations);
if (result.abortsCompilation) {
  const recovered: readonly OrientedRule[] = result.rules;
  // @ts-expect-error Invalid movement output retains unresolved families.
  lowerRules(result.rules, declarations);
  const properties = expandRuleProperties(result.rules, declarations);
  // @ts-expect-error Property inference does not resolve movement families.
  lowerRules(properties.rules, declarations);
  void recovered;
} else {
  const expanded: readonly MovementRule[] = result.rules;
  const properties = expandRuleProperties(result.rules, declarations);
  const propertiesAtomic: readonly MovementRule[] = properties.rules;
  const spawned = inferSpawnedStationary(properties.rules, declarations);
  const spawnedAtomic: readonly MovementRule[] = spawned;
  const normalized = normalizeRuleDuplicates(spawned);
  const normalizedAtomic: readonly MovementRule[] = normalized;
  const lowered: readonly LoweredRule[] = lowerRules(normalized, declarations).rules;
  lowered.forEach(rule => { const retained: MovementRule = rule.namedRule; void retained; });
  lowerSourceRules(normalized, declarations);
  void [expanded, propertiesAtomic, spawnedAtomic, normalizedAtomic];
}

const onlyUp: DirectedNamedRule<Q.Up> = { ...movement, lhs: [[[{ qualifier: Q.Up, name: 'player', origin }]]], rhs: [] };
const stillUp: readonly DirectedNamedRule<Q.Up>[] = expandRuleProperties([onlyUp], declarations).rules;
const upOrStationary: readonly DirectedNamedRule<Q.Up | Q.Stationary>[] = inferSpawnedStationary(stillUp, declarations);
// @ts-expect-error Spawn inference can add Stationary, even to a narrower input domain.
const spawnWithoutStationary: readonly DirectedNamedRule<Q.Up>[] = inferSpawnedStationary(stillUp, declarations);
const earlier: DirectedNamedRule<SourceQualifier> & { readonly evidence: 'retained' } = {
  ...movement, lhs: sourceRows, evidence: 'retained',
};
const sameRecords: readonly (typeof earlier)[] = normalizeRuleDuplicates([earlier]);
const expandedSource = expandSourceRules(document, declarations);
// @ts-expect-error Expansion has not established a successful lowerable result.
lowerRules(expandedSource.rules, declarations);
if (expandedSource.kind === RuleExpansionKind.Ready) lowerRules(expandedSource.rules, declarations);
else {
  const failure: RuleCompilationFailure = expandedSource.failure;
  // @ts-expect-error Blocked rules cannot enter lowering.
  lowerRules(expandedSource.rules, declarations);
  void failure;
}
declare const cause: SourceDiagnostic;
const keep: RuleRecovery = { kind: RuleRecoveryKind.Keep };
const discard: RuleRecovery = { kind: RuleRecoveryKind.Discard, cause };
const diagnosticOnly: RuleRecovery = { kind: RuleRecoveryKind.KeepForDiagnostics, causes: [cause] };
// @ts-expect-error A discarded pattern must identify its syntax diagnostic.
const noCause: RuleRecovery = { kind: RuleRecoveryKind.Discard };
// @ts-expect-error A diagnostic-only pattern must identify its blocking causes.
const noBlockers: RuleRecovery = { kind: RuleRecoveryKind.KeepForDiagnostics };
// @ts-expect-error Keep does not combine contradictory recovery flags or causes.
const unsupported: RuleRecovery = { kind: RuleRecoveryKind.Keep, cause };
const pattern: SourceRuleKind.Pattern = authored.kind;
// @ts-expect-error Severity no longer implies a structural Invalid pattern kind.
SourceRuleKind.Invalid;
// @ts-expect-error Recovery replaces the separate retained boolean.
authored.retained;
// @ts-expect-error Recovery replaces the separate abort boolean.
authored.abortsCompilation;
const compilation = compileSource('');
if (compilation.outcome.kind === SourceCompilationKind.Invalid) {
  switch (compilation.outcome.failure.kind) {
    case SourceCompilationFailureKind.MissingCollisionLayers: {
      const diagnostic: SourceDiagnostic = compilation.outcome.failure.diagnostic;
      void diagnostic; break;
    }
    case SourceCompilationFailureKind.RuleCompilation: {
      const checkpoint: RuleCompilationCheckpoint = compilation.outcome.failure.checkpoint;
      const causes: readonly SourceDiagnostic[] = compilation.outcome.failure.causes;
      // @ts-expect-error Complete failures expose the checkpoint directly without a redundant failure wrapper.
      compilation.outcome.failure.failure;
      void [checkpoint, causes]; break;
    }
  }
}
void [keep, discard, diagnosticOnly, pattern];
void [absolute, atomic, sourceFamily, family, relative, sourceQualifier, orientedQualifier,
  inPlace, upOrStationary, sameRecords, sound0, sound10, authoredPayload, effectiveText];
`;
    const file = join(directory, 'rule-passes.mts');
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
