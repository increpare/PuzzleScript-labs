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
  /** Effective primary and aliases, including suffix names accepted after sprite completion. */
  readonly definitionNames: SourceLexicalToken[];
  readonly nameLine: SourceLine;
  colorLine: SourceLine | null;
  readonly colors: SourceWord[];
  /** Accepted native colors beside unchanged authored chunks. */
  readonly definitionColors: SourceLexicalToken[];
  spriteRows: SourceSpriteRow[] | null;
  /** Accepted pixel tokens, after junk/oversize recovery, beside authored rows. */
  readonly definitionSpriteRows: SourceLexicalToken[][];
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
export enum SourceSoundKind { Event, Target, Invalid }
interface SourceSoundBase extends SourceEntry {
  /** First token of a retained native event record, including a bare event without a seed. */
  readonly eventDefinition: SourceLexicalToken | null;
  readonly words: readonly SourceWord[];
  readonly directions: readonly SourceWord[];
}
export type SourceSound = SourceSoundBase & (
  { readonly kind: SourceSoundKind.Event; readonly event: SourceWord; readonly target: null; readonly action: null; readonly seed: SourceWord } |
  { readonly kind: SourceSoundKind.Target; readonly event: null; readonly target: SourceWord; readonly action: SourceWord; readonly seed: SourceWord } |
  { readonly kind: SourceSoundKind.Invalid; readonly event: SourceWord | null; readonly target: SourceWord | null; readonly action: SourceWord | null; readonly seed: SourceWord | null });
export interface SourceCollisionLayer extends SourceEntry {
  readonly names: readonly SourceWord[];
  readonly words: readonly SourceWord[];
  readonly definitionNames: readonly SourceLexicalToken[];
}
export enum SourceWinConditionKind { Valid, Invalid }
export interface SourceWinCondition extends SourceEntry {
  readonly kind: SourceWinConditionKind;
  readonly words: readonly SourceWord[];
  readonly quantifier: SourceWord | null;
  readonly subject: SourceWord | null;
  readonly on: SourceWord | null;
  readonly target: SourceWord | null;
}
export enum SourceRuleKind { Ordinary, StartLoop, EndLoop, Invalid }
export enum SourceRuleCellKind { Contents, Ellipsis, Invalid }
export interface SourceRuleTerm {
  readonly qualifier: SourceWord | null;
  readonly name: SourceWord | null;
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
  readonly openingBracket: SourceWord;
  readonly closingBracket: SourceWord | null;
  readonly span: SourceSpan;
}
export enum SourceRuleCommandKind { SoundEffect, Cancel, Checkpoint, Restart, Win, Message, Again }
export type SourceRuleCommand =
  { readonly kind: SourceRuleCommandKind.Message; readonly word: SourceWord; readonly authoredPayload: string; readonly legacyPayload: string; readonly payloadSpan: SourceSpan } |
  { readonly kind: Exclude<SourceRuleCommandKind, SourceRuleCommandKind.Message>; readonly word: SourceWord };
interface SourceRuleBase extends SourceEntry {
  readonly originalLine: SourceLine;
  /** Full compiler input: leading-comment reentry captures an already lowercased line; originalLine stays authored. */
  readonly compilerLine: string;
  /** The compiler historically receives the first run of non-'(' text, lowercased, on this physical line. */
  readonly legacyCapturedText: string;
  readonly legacyCapturedSpan: SourceSpan;
  readonly tokens: readonly SourceWord[];
}
export interface SourcePatternRule extends SourceRuleBase {
  readonly kind: SourceRuleKind.Ordinary | SourceRuleKind.Invalid;
  readonly prefixWords: readonly SourceWord[];
  readonly lhs: readonly SourceRuleRow[];
  readonly rhs: readonly SourceRuleRow[];
  readonly arrow: SourceWord | null;
  readonly commands: readonly SourceRuleCommand[];
  readonly trailingWords: readonly SourceWord[];
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
export interface SourceDocument {
  readonly source: string;
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
