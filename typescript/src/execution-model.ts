import type { Command, CommandState } from './commands.js';
import type { QuirkSettings, VanillaRigidCompatibility } from './compatibility.js';
import type { CollisionLayer, GameObject, MovementState } from './model.js';
import type { RandomState } from './random.js';
import type { CellEdits } from './replacement.js';
import type { RulePattern } from './rule-model.js';

export interface CellReplacement {
  readonly edits: CellEdits;
  /** Static affected layers; random edits do not extend them. */
  readonly rigidLayers: ReadonlySet<number>;
}

export interface ExecutableRule extends RulePattern {
  readonly sourceLine: number;
  readonly hasReplacements: boolean;
  readonly replacements: readonly (readonly (CellReplacement | null)[])[];
  readonly commands: readonly Command[];
  readonly rigidGroup: number | null;
}

export interface RuleGame extends VanillaRigidCompatibility, QuirkSettings {
  readonly collisionLayers: readonly CollisionLayer[];
}

export interface RuleExecutionState extends MovementState {
  readonly random: RandomState;
  readonly commands: CommandState<ExecutableRule>;
  readonly createdObjects: ReadonlySet<GameObject>;
  readonly destroyedObjects: ReadonlySet<GameObject>;
}

export enum ExecutionDiagnosticKind {
  GroupIterationLimit,
  LoopIterationLimit,
}

export interface ExecutionDiagnostic {
  readonly kind: ExecutionDiagnosticKind;
  readonly sourceLine: number;
}

export interface RuleExecutionResult {
  readonly state: RuleExecutionState;
  readonly changed: boolean;
  readonly diagnostics: readonly ExecutionDiagnostic[];
}

export interface RuleGroup {
  readonly rules: readonly ExecutableRule[];
  readonly random: boolean;
}

export interface RuleSchedule {
  readonly groups: readonly RuleGroup[];
  readonly loops: ReadonlyMap<number, number>;
}
