import type { SoundIndex } from './commands.js';
import type { VanillaRestoreCompatibility } from './compatibility-vanilla-5a94bde1.js';
import type { ExecutionDiagnostic, RuleExecutionState } from './execution-model.js';
import type { Board, GameObject } from './model.js';
import type { TurnRulesGame } from './turn-rules.js';
import type { WinCondition } from './win-conditions.js';

export enum RunMode { Replay, Interactive }
export enum ScreenKind { Board, LevelMessage, TemporaryMessage, Title }
export enum LevelKind { Grid, Message }
export enum SimpleSound { TitleScreen, StartGame, EndGame, StartLevel, EndLevel, Undo, Restart, ShowMessage, CloseMessage, Cancel }
export interface Viewport { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
export interface Dimensions { readonly width: number; readonly height: number }
export interface BoardSnapshot { readonly board: Board; readonly viewport: Viewport | null }
export type SessionLevel =
  | { readonly kind: LevelKind.Grid; readonly board: Board; readonly sourceLine: number }
  | { readonly kind: LevelKind.Message; readonly text: string; readonly sourceLine: number };
export interface SessionMetadata {
  readonly requirePlayerMovement: boolean;
  readonly runRulesOnLevelStart: boolean;
  readonly noUndo: boolean;
  readonly noRestart: boolean;
  readonly flickscreen?: Dimensions;
  readonly zoomscreen?: Dimensions;
}
export interface ObjectSound { readonly objects: ReadonlySet<GameObject>; readonly seed: string }
export interface SessionSounds {
  readonly simple: ReadonlyMap<SimpleSound, string>;
  readonly sfx: ReadonlyMap<SoundIndex, string>;
  readonly creation: readonly ObjectSound[];
  readonly destruction: readonly ObjectSound[];
}
export interface SessionGame extends TurnRulesGame, VanillaRestoreCompatibility {
  readonly levels: readonly SessionLevel[];
  readonly winConditions: readonly WinCondition[];
  readonly metadata: SessionMetadata;
  readonly sounds: SessionSounds;
}
export type SessionScreen =
  | { readonly kind: ScreenKind.Board | ScreenKind.Title }
  | { readonly kind: ScreenKind.LevelMessage | ScreenKind.TemporaryMessage; readonly text: string };
export interface SessionState {
  readonly execution: RuleExecutionState;
  readonly levelIndex: number;
  readonly levelTarget: BoardSnapshot | null;
  readonly restartTarget: BoardSnapshot;
  readonly history: readonly BoardSnapshot[];
  readonly viewport: Viewport | null;
  readonly screen: SessionScreen;
  readonly winning: boolean;
  readonly againing: boolean;
  readonly restarting: boolean;
  readonly levelStarting: boolean;
  readonly checkpointUsed: boolean;
  readonly loadedLevelSeed: string;
  readonly runMode: RunMode;
}
export enum SessionEffectKind { Sound, Persistence, Win, Diagnostic }
/** Progress saves the level index and removes any stored checkpoint; ClearProgress removes both saved values. */
export enum PersistenceKind { Checkpoint, Progress, ClearProgress }
export enum SessionDiagnosticKind { RigidIterationLimit, MissingLevel }
export type RuntimeDiagnostic =
  | { readonly origin: 'rules'; readonly detail: ExecutionDiagnostic }
  | { readonly origin: 'session'; readonly kind: SessionDiagnosticKind };
export type SessionEffect =
  | { readonly kind: SessionEffectKind.Sound; readonly seed: string; readonly simple: boolean }
  | { readonly kind: SessionEffectKind.Persistence; readonly operation: PersistenceKind.Checkpoint; readonly levelIndex: number; readonly snapshot: BoardSnapshot }
  | { readonly kind: SessionEffectKind.Persistence; readonly operation: PersistenceKind.Progress | PersistenceKind.ClearProgress; readonly levelIndex: number }
  | { readonly kind: SessionEffectKind.Win; readonly levelIndex: number; readonly suppressed: boolean }
  | { readonly kind: SessionEffectKind.Diagnostic; readonly diagnostic: RuntimeDiagnostic };
export interface SessionResult { readonly state: SessionState; readonly modified: boolean; readonly effects: readonly SessionEffect[] }
export interface SessionEnvironment { nextLevelSeed(): string }
export interface CreateSessionOptions { readonly level?: number; readonly seed?: string; readonly runMode?: RunMode }
export interface StepSessionOptions { readonly suppressWin?: boolean; readonly probe?: boolean }
export interface UndoSessionOptions { readonly force?: boolean; readonly ignoreDuplicates?: boolean }
