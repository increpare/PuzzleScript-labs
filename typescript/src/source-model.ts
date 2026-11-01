import type { SourceObjectDeclaration, SourceAliasDeclaration, SourcePropertyDeclaration, SourceAggregateDeclaration, SourceDeclarationAdvice, SourceAliasOriginKind, SourceLegendAliasOrigin } from './source-declarations.js';
import type { Direction } from './model.js';
import type { SourceQualifier } from './source-rule-model.js';
import type { AcceptedSound } from './source-sound-syntax.js';
import type { AcceptedWinCondition } from './source-win-syntax.js';

/** Every offset and column counts JavaScript UTF-16 code units. End positions are exclusive. */
export interface SourcePosition { readonly offset: number; readonly line: number; readonly column: number }
export interface SourceSpan { readonly start: SourcePosition; readonly end: SourcePosition }
/** An exact authored slice; normalized is always spelling.toLowerCase(). */
export interface SourceWord { readonly spelling: string; readonly normalized: string; readonly span: SourceSpan }
/** A native lexical value with its unchanged authored source evidence. */
export interface SourceLexicalToken { readonly value: string; readonly word: SourceWord }

export enum SourceSectionKind { Objects, Legend, Sounds, CollisionLayers, Rules, WinConditions, Levels }
export enum SourceLineKind { Blank, Comment, Separator, Heading, Entry, Invalid }
export interface SourceLine {
  readonly original: string;
  readonly span: SourceSpan;
  kind: SourceLineKind;
  sectionId: number | null;
}
export interface SourceSection {
  readonly id: number;
  readonly kind: SourceSectionKind;
  readonly name: SourceWord;
  readonly heading: SourceLine;
  readonly trailingWords: readonly SourceWord[];
  readonly lines: SourceLine[];
}
export interface SourceMetadata {
  readonly key: SourceWord;
  /** Native accepts a prelude key only on a logical start-of-line visit. */
  readonly accepted: boolean;
  readonly authoredValue: string;
  readonly value: string;
  readonly span: SourceSpan;
}

export interface SourceComment { span: SourceSpan; readonly depth: number; closed: boolean }
export interface SourceEntry {
  readonly sectionId: number;
  readonly order: number;
  span: SourceSpan;
}
export interface SourceSpriteRow {
  /** Visible authored glyphs, including invalid glyphs and dimensions, without comments or spacing. */
  readonly text: string;
  readonly glyphs: readonly SourceWord[];
  readonly span: SourceSpan;
  readonly original: string;
}
export interface SourceObject extends SourceEntry {
  readonly primaryName: SourceWord;
  readonly validPrimaryName: boolean;
  readonly aliases: readonly SourceWord[];
  /** Name evidence for accepted registrations owned by this authored container.
   * Recovery can give one container several accepted primaries. */
  readonly definitionNames: SourceLexicalToken[];
  readonly nameLine: SourceLine;
  colorLine: SourceLine | null;
  readonly colors: SourceWord[];
  spriteRows: SourceSpriteRow[] | null;
}
export enum SourceLegendKind { Synonym, Property, Aggregate, Invalid }
interface SourceLegendBase extends SourceEntry {
  readonly name: SourceWord | null;
  readonly words: readonly SourceWord[];
  /** Tokens recognized after whole-line lowercasing, before malformed text is discarded. */
  readonly definitionWords: readonly SourceLexicalToken[];
  readonly references: readonly SourceWord[];
  readonly operators: readonly SourceWord[];
}
export type SourceLegend = SourceLegendBase & (
  { readonly kind: SourceLegendKind.Synonym } | { readonly kind: SourceLegendKind.Property } |
  { readonly kind: SourceLegendKind.Aggregate } | { readonly kind: SourceLegendKind.Invalid });
export interface SourceSound extends SourceEntry {
  readonly words: readonly SourceWord[];
  /** Null means the native source visits did not retain a sound record. */
  readonly definition: AcceptedSound | null;
}
export interface SourceCollisionLayer extends SourceEntry {
  readonly names: readonly SourceWord[];
  readonly words: readonly SourceWord[];
  readonly definitionNames: readonly SourceLexicalToken[];
}
export interface SourceWinCondition extends SourceEntry {
  readonly words: readonly SourceWord[];
  /** Null means the win body was never visited at logical start of line. */
  readonly definition: AcceptedWinCondition | null;
}
export enum SourceRuleKind { Ordinary, StartLoop, EndLoop, Invalid }
export enum SourceRuleCellKind { Contents, Ellipsis }
export interface SourceRuleTerm {
  readonly qualifier: SourceWord | null;
  readonly qualifierValue: SourceQualifier;
  readonly name: SourceWord;
  /** Effective whole-line lowercase value, which can differ from name.normalized. */
  readonly nameValue: string;
  readonly words: readonly SourceWord[];
  readonly span: SourceSpan;
}
export interface SourceRuleCell {
  readonly kind: SourceRuleCellKind;
  readonly words: readonly SourceWord[];
  readonly terms: readonly SourceRuleTerm[];
  readonly span: SourceSpan;
}
export interface SourceRuleRow {
  readonly cells: readonly SourceRuleCell[];
  /** Native nested-bracket recovery can emit another row without a fresh opener. */
  readonly openingBracket: SourceWord | null;
  readonly closingBracket: SourceWord;
  readonly span: SourceSpan;
}
export enum SourceRuleCommandKind { SoundEffect, Cancel, Checkpoint, Restart, Win, Message, Again }
export type SourceRuleCommand =
  { readonly kind: SourceRuleCommandKind.Message; readonly word: SourceWord; readonly authoredPayload: string; readonly legacyPayload: string;
    readonly text: string; readonly payloadSpan: SourceSpan } |
  { readonly kind: SourceRuleCommandKind.SoundEffect; readonly word: SourceWord; readonly index: number } |
  { readonly kind: Exclude<SourceRuleCommandKind, SourceRuleCommandKind.Message | SourceRuleCommandKind.SoundEffect>; readonly word: SourceWord };
/** Syntax issues are replayed only when compilation reaches the Rules checkpoint. */
export enum SourceRuleSyntaxIssueKind { Diagnostic, DuplicateProperty }
export type SourceRuleSyntaxIssue =
  { readonly kind: SourceRuleSyntaxIssueKind.Diagnostic; readonly diagnostic: SourceDiagnostic } |
  { readonly kind: SourceRuleSyntaxIssueKind.DuplicateProperty; readonly name: string };
interface SourceRuleBase extends SourceEntry {
  readonly originalLine: SourceLine;
  /** Full authored compiler input, retaining its original case even after comment reentry. */
  readonly compilerLine: string;
  /** The compiler historically receives the first run of non-'(' text, lowercased, on this physical line. */
  readonly legacyCapturedText: string;
  readonly legacyCapturedSpan: SourceSpan;
  readonly tokens: readonly SourceWord[];
  /** Canonical effective scanner output, including fragments discarded by recovery. */
  readonly lexicalTokens: readonly SourceLexicalToken[];
}
export interface SourcePatternRule extends SourceRuleBase {
  readonly kind: SourceRuleKind.Ordinary | SourceRuleKind.Invalid;
  readonly prefixWords: readonly SourceWord[];
  readonly lhs: readonly SourceRuleRow[];
  readonly rhs: readonly SourceRuleRow[];
  readonly arrow: SourceWord | null;
  readonly commands: readonly SourceRuleCommand[];
  readonly trailingWords: readonly SourceWord[];
  readonly retained: boolean;
  readonly abortsCompilation: boolean;
  readonly syntaxIssues: readonly SourceRuleSyntaxIssue[];
  readonly sourceGroup: number;
  readonly directions: readonly Direction[];
  readonly late: boolean;
  readonly rigid: boolean;
  readonly random: boolean;
}
export interface SourceLoopMarker extends SourceRuleBase {
  readonly kind: SourceRuleKind.StartLoop | SourceRuleKind.EndLoop;
  readonly marker: SourceWord;
}
export type SourceRule = SourcePatternRule | SourceLoopMarker;
export enum SourceLevelKind { Grid, Message }
export interface SourceGridRow {
  readonly original: string;
  readonly text: string;
  readonly glyphs: readonly SourceWord[];
  readonly span: SourceSpan;
}
export interface SourceGridLevel extends SourceEntry { readonly kind: SourceLevelKind.Grid; readonly rows: SourceGridRow[] }
export interface SourceMessageLevel extends SourceEntry {
  readonly kind: SourceLevelKind.Message;
  readonly keyword: SourceWord;
  readonly authoredText: string;
  /** Native accepted text; a later visit after a leading comment sees lowercase. */
  readonly text: string;
  readonly textSpan: SourceSpan;
}
export type SourceLevel = SourceGridLevel | SourceMessageLevel;

export enum SourceDiagnosticSeverity { Warning, Error }
export enum SourceDiagnosticPhase { Reader, Declarations, GameData, Rules, Assets }
export interface SourceDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: SourceDiagnosticSeverity;
  readonly countsAsError: boolean;
  readonly span: SourceSpan | null;
  readonly phase: SourceDiagnosticPhase;
  /** Absent uses span.start.line; null explicitly has no line, zero is native line 0. */
  readonly reportedLine?: number | null;
  /** Absent means false. Urgent native visits bypass duplicate suppression. */
  readonly urgent?: boolean;
}
/** One accepted primary and its own assets, independent of authored grouping. */
export interface AcceptedSourceObjectDeclaration extends SourceObjectDeclaration {
  readonly source: SourceObject;
  readonly colors: readonly SourceLexicalToken[];
  readonly spriteRows: readonly (readonly SourceLexicalToken[])[];
}
export type AcceptedSourceObjectAliasOrigin =
  { readonly kind: SourceAliasOriginKind.Object; readonly owner: AcceptedSourceObjectDeclaration } |
  { readonly kind: SourceAliasOriginKind.UnownedObject; readonly attemptedPrimary: SourceLexicalToken };
/** Accepted source-time semantics, bound once to the authored tree. */
export type AcceptedSourceDeclaration =
  AcceptedSourceObjectDeclaration |
  (Omit<SourceAliasDeclaration, 'origin'> & { readonly origin: AcceptedSourceObjectAliasOrigin; readonly source: SourceObject }) |
  (Omit<SourceAliasDeclaration, 'origin'> & { readonly origin: SourceLegendAliasOrigin; readonly source: SourceLegend }) |
  (SourcePropertyDeclaration & { readonly source: SourceLegend }) |
  (SourceAggregateDeclaration & { readonly source: SourceLegend });
export interface AcceptedSourceDeclarations {
  readonly registrations: readonly AcceptedSourceDeclaration[];
  /** Expanded at the native source visit, including repeated members and empty layers. */
  readonly collisionLayers: readonly (readonly string[])[];
  readonly advice: readonly SourceDeclarationAdvice[];
}
export interface SourceDocument {
  readonly source: string;
  readonly acceptedDeclarations: AcceptedSourceDeclarations;
  readonly lines: SourceLine[];
  readonly sections: SourceSection[];
  readonly metadata: SourceMetadata[];
  readonly comments: SourceComment[];
  readonly levels: SourceLevel[];
  readonly objects: SourceObject[];
  readonly legend: SourceLegend[];
  readonly sounds: SourceSound[];
  readonly collisionLayers: SourceCollisionLayer[];
  readonly winConditions: SourceWinCondition[];
  readonly rules: SourceRule[];
}
export interface SourceReadResult { readonly document: SourceDocument; readonly diagnostics: readonly SourceDiagnostic[] }
