import { SourceSectionKind, type SourceLexicalToken } from './source-model.js';

/** Section order is a language relationship, independent of enum ordinals. */
export const sourceSectionDescriptors = [
  { name: 'objects', kind: SourceSectionKind.Objects, predecessor: null },
  { name: 'legend', kind: SourceSectionKind.Legend, predecessor: { name: 'objects', kind: SourceSectionKind.Objects } },
  { name: 'sounds', kind: SourceSectionKind.Sounds, predecessor: { name: 'legend', kind: SourceSectionKind.Legend } },
  { name: 'collisionlayers', kind: SourceSectionKind.CollisionLayers, predecessor: { name: 'sounds', kind: SourceSectionKind.Sounds } },
  { name: 'rules', kind: SourceSectionKind.Rules, predecessor: { name: 'collisionlayers', kind: SourceSectionKind.CollisionLayers } },
  { name: 'winconditions', kind: SourceSectionKind.WinConditions, predecessor: { name: 'rules', kind: SourceSectionKind.Rules } },
  { name: 'levels', kind: SourceSectionKind.Levels, predecessor: { name: 'winconditions', kind: SourceSectionKind.WinConditions } },
] as const;

export enum PreludePhase { Key, FlagArguments, Value, ValueTail }
export enum ObjectPhase { Names, Aliases, Colors, Sprite }
export enum LegendPhase { Name, Equals, FirstMember, FirstOperator, LaterMember, LaterOperator }
export enum SoundPhase { Head, EventSeed, Verb, DirectionOrSeed, Seed, End, Failed }
/** AfterPatternSeparator records a prior [, | or ]; it does not mean inside a cell. */
export enum RulePhase { Prelude, AfterPatternSeparator, MessageTail }
export enum WinPhase { Quantifier, Subject, On, Target, Excess }
export enum LevelPhase { Start, Grid, MessageTail }

export type PreludeScanState = { section: null; phase: PreludePhase };
export type ObjectScanState = { section: SourceSectionKind.Objects; phase: ObjectPhase };
export type LegendScanState = { section: SourceSectionKind.Legend; phase: LegendPhase };
export type SoundScanState =
  | { section: SourceSectionKind.Sounds; phase: SoundPhase.Head }
  | { section: SourceSectionKind.Sounds; phase: SoundPhase.EventSeed; event: SourceLexicalToken }
  | { section: SourceSectionKind.Sounds; phase: SoundPhase.Verb }
  | { section: SourceSectionKind.Sounds; phase: SoundPhase.DirectionOrSeed | SoundPhase.Seed; previous: string }
  | { section: SourceSectionKind.Sounds; phase: SoundPhase.End; previous: string; event: SourceLexicalToken | null }
  | { section: SourceSectionKind.Sounds; phase: SoundPhase.Failed };
export type RuleScanState = { section: SourceSectionKind.Rules; phase: RulePhase };
export type WinScanState = { section: SourceSectionKind.WinConditions; phase: WinPhase };
export type LevelScanState = { section: SourceSectionKind.Levels; phase: LevelPhase };

export type SourceScanState = PreludeScanState | ObjectScanState | LegendScanState | SoundScanState
  | { section: SourceSectionKind.CollisionLayers } | RuleScanState | WinScanState | LevelScanState;
