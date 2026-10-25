import { prepareDeclarations, completeDeclarations, reportUnlayeredObjects } from './declarations.js';
import type { ResolvedDeclarations } from './declaration-model.js';
import type { ExecutableRule } from './execution-model.js';
import type { GameObject } from './model.js';
import type { Dimensions, SessionGame } from './session-model.js';
import { compileObjectSprites, compileDisplayColors, type ColorPalette, type ObjectSprite } from './source-assets.js';
import { collectSourceIssue, SourceIssueLimit, type SourceIssueCollection, type SourceIssueReporter } from './source-diagnostics.js';
import { compileLevels, compileWinConditions, compileMetadata, compileSounds, compileRestorePolicies, formatHomepage, gameDataReporter } from './source-game-data.js';
import { SourceDiagnosticSeverity, SourceDiagnosticPhase, type SourceDocument, type SourcePatternRule, type SourcePosition } from './source-model.js';
import { parseSource, SourceParserOutcomeKind, SourceParserStopReason } from './source-parser.js';
import { expandSourceRules, lowerSourceRules } from './source-rule-compiler.js';
import { compileRuleGroups, compileRuleLoops } from './source-rule-schedules.js';
import { vanillaQuirks, type Quirks } from './compatibility-vanilla-5a94bde1.js';

export enum SourceCompilationKind { Accepted, Declined, Invalid, Stopped }
export enum SourceCompilationStopReason { ParserErrors, IssueLimit }
export interface CompiledSourceData {
  readonly game: SessionGame;
  readonly declarations: ResolvedDeclarations;
  readonly sprites: ReadonlyMap<GameObject, ObjectSprite>;
  readonly palette: ColorPalette;
  readonly displayColors: { readonly backgroundColor: string; readonly textColor: string };
  readonly metadata: ReadonlyMap<string, string | Dimensions>;
  readonly ruleSources: ReadonlyMap<ExecutableRule, SourcePatternRule>;
}
export type SourceCompilationOutcome =
  (CompiledSourceData & { readonly kind: SourceCompilationKind.Accepted | SourceCompilationKind.Declined }) |
  { readonly kind: SourceCompilationKind.Invalid } |
  { readonly kind: SourceCompilationKind.Stopped; readonly reason: SourceCompilationStopReason; readonly cursor?: SourcePosition };
export interface SourceCompilationResult extends SourceIssueCollection {
  readonly document: SourceDocument;
  readonly outcome: SourceCompilationOutcome;
}

export interface CompileSourceOptions {
  /** Defaults to vanillaQuirks; the compiled game records the choice. */
  readonly quirks?: Quirks;
}

/** Compile in language order; a formed game and the installation decision are distinct. */
export function compileSource(source: string, options: CompileSourceOptions = {}): SourceCompilationResult {
  const quirks = options.quirks ?? vanillaQuirks;
  const parsed = parseSource(source);
  const { document, outcome: parserOutcome, ...issues } = parsed;
  if (parserOutcome.kind === SourceParserOutcomeKind.Stopped) return { document, ...issues,
    outcome: { kind: SourceCompilationKind.Stopped,
      reason: parserOutcome.reason === SourceParserStopReason.Errors ? SourceCompilationStopReason.ParserErrors : SourceCompilationStopReason.IssueLimit,
      cursor: parserOutcome.cursor } };
  const report: SourceIssueReporter = issue => {
    if (collectSourceIssue(issues, issue)) throw new SourceIssueLimit();
  };
  function error(code: string, message: string, urgent = false, phase = SourceDiagnosticPhase.Declarations): void {
    report({ code, message, span: null, severity: SourceDiagnosticSeverity.Error,
      countsAsError: true, phase, urgent });
  }
  const invalid = (): SourceCompilationResult => ({ document, ...issues, outcome: { kind: SourceCompilationKind.Invalid } });
  try {
    const prepared = prepareDeclarations(document);
    for (const name of ['player', 'background']) {
      if (!prepared.firstDeclarationWords.has(name)) error(`missing-${name}`,
        `Error, didn't find any object called ${name}, either in the objects section, or the legends section. There must be a ${name}!`);
    }
    if (prepared.rawLayers.length === 0) {
      error('missing-collision-layers', 'No collision layers defined.  All objects need to be in collision layers.');
      return invalid();
    }
    const assets = compileObjectSprites(document, prepared, report);
    const { declarations } = completeDeclarations(prepared, report);
    if (declarations.player.objects.size === 0) error('empty-player',
      "Error, didn't find any object called player, either in the objects section, or the legends section.");
    const dataReport = gameDataReporter([], report);
    const levels = compileLevels(document, declarations, dataReport);
    const expanded = expandSourceRules(document, declarations, report);
    if (expanded.rules === null) return invalid();
    const lowered = lowerSourceRules(expanded.rules, declarations, report, quirks);
    const groups = compileRuleGroups(lowered.rules, report);
    const winConditions = compileWinConditions(document, declarations, dataReport);
    reportUnlayeredObjects(declarations, report);
    const metadata = compileMetadata(document, dataReport);
    const schedules = compileRuleLoops(groups.early, groups.late, expanded.loops, report);
    const sounds = compileSounds(document, declarations, dataReport);
    const display = compileDisplayColors(document, assets.palette, report);
    const values = formatHomepage(metadata.values);
    const game: SessionGame = { collisionLayers: declarations.collisionLayers, player: declarations.player,
      levels, winConditions, metadata: metadata.session, ...sounds,
      earlyRules: schedules.early, lateRules: schedules.late, rigid: groups.rigid, rigidMerges: groups.rigidMerges,
      restorePolicies: compileRestorePolicies(levels, declarations.collisionLayers.length), quirks };
    if (levels.length === 0) error('missing-levels', 'No levels found.  Add some levels!', true, SourceDiagnosticPhase.GameData);
    return { document, ...issues, outcome: { kind: issues.errorCount > 5 ? SourceCompilationKind.Declined : SourceCompilationKind.Accepted,
      game, declarations, sprites: assets.sprites, palette: assets.palette,
      displayColors: { backgroundColor: display.backgroundColor, textColor: display.textColor },
      metadata: values, ruleSources: groups.ruleSources } };
  } catch (error) {
    if (!(error instanceof SourceIssueLimit)) throw error;
    return { document, ...issues, outcome: { kind: SourceCompilationKind.Stopped, reason: SourceCompilationStopReason.IssueLimit } };
  }
}
