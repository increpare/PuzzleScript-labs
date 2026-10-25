import { queueCommands } from './commands.js';
import {
  ExecutionDiagnosticKind, type ExecutableRule, type ExecutionDiagnostic,
  type RuleExecutionResult, type RuleExecutionState, type RuleGame, type RuleGroup, type RuleSchedule,
} from './execution-model.js';
import { findMatches, matchTuples } from './matching.js';
import { nextRandom } from './random.js';
import type { RowMatch } from './rule-model.js';
import { applyRuleAt, cloneExecutionState, tryApplyRule } from './rules.js';

const MAX_ITERATIONS = 200;

/** Apply every rule directly until a deterministic group settles, or choose one random tuple. */
export function applyRuleGroup(game: RuleGame, group: RuleGroup, before: RuleExecutionState): RuleExecutionResult {
  let state = cloneExecutionState(before);
  const diagnostics: ExecutionDiagnostic[] = [];
  if (group === undefined || group.rules.length === 0) return { state, changed: false, diagnostics };

  if (group.random) {
    const candidates: { readonly rule: ExecutableRule; readonly tuple: readonly RowMatch[] }[] = [];
    for (const rule of group.rules) {
      const matches = findMatches(rule, state);
      if (matches.length === 0) continue;
      for (const tuple of matchTuples(matches)) candidates.push({ rule, tuple });
    }
    if (candidates.length === 0) return { state, changed: false, diagnostics };

    const draw = nextRandom(state.random);
    const candidateIndex = Math.floor(draw.value * candidates.length);
    const selected = candidates[candidateIndex];
    if (selected === undefined) {
      // Legacy uniform arithmetic can round to one; do not silently select a different tuple.
      throw new Error(`Random rule candidate index ${candidateIndex} is outside ${candidates.length} candidates`);
    }
    const result = applyRuleAt(game, selected.rule, { ...state, random: draw.state }, selected.tuple, false);
    return {
      state: { ...result.state, commands: queueCommands(result.state.commands, selected.rule, selected.rule.commands) },
      changed: result.changed,
      diagnostics: result.diagnostics,
    };
  }

  let changed = false;
  let changedThisPass = true;
  let passes = 0;
  // The postincrement also counts a rejected 201st pass, while a quiet 200th pass still diagnoses.
  while (changedThisPass && passes++ < MAX_ITERATIONS) {
    changedThisPass = false;
    for (const rule of group.rules) {
      const result = tryApplyRule(game, rule, state);
      state = result.state;
      diagnostics.push(...result.diagnostics);
      if (result.changed) {
        changedThisPass = true;
        changed = true;
      }
    }
  }
  if (passes >= MAX_ITERATIONS) {
    diagnostics.push({ kind: ExecutionDiagnosticKind.GroupIterationLimit, sourceLine: group.rules[0]!.sourceLine });
  }
  return { state, changed, diagnostics };
}

/** Apply source groups and compiler-declared loop points without optimized scheduling. */
export function applyRules(game: RuleGame, schedule: RuleSchedule, before: RuleExecutionState): RuleExecutionResult {
  let state = cloneExecutionState(before);
  let changed = false;
  let loopPropagated = false;
  let loopCount = 0;
  let groupIndex = 0;
  const diagnostics: ExecutionDiagnostic[] = [];

  while (groupIndex < schedule.groups.length) {
    if (!before.bannedGroups.has(groupIndex)) {
      const result = applyRuleGroup(game, schedule.groups[groupIndex]!, state);
      state = result.state;
      changed = result.changed || changed;
      loopPropagated = result.changed || loopPropagated;
      diagnostics.push(...result.diagnostics);
    }

    // Mid-sequence loop points inspect the current group before its index advances.
    let target = loopPropagated ? schedule.loops.get(groupIndex) : undefined;
    if (target === undefined) {
      groupIndex++;
      if (groupIndex === schedule.groups.length && loopPropagated) target = schedule.loops.get(groupIndex);
    }
    if (target !== undefined) {
      if (!Number.isInteger(target) || target < 0 || target >= schedule.groups.length) {
        throw new Error(`Loop target ${target} is outside the source rule groups`);
      }
      groupIndex = target;
      loopPropagated = false;
      loopCount++;
      if (loopCount > MAX_ITERATIONS) {
        diagnostics.push({
          kind: ExecutionDiagnosticKind.LoopIterationLimit,
          sourceLine: schedule.groups[target]!.rules[0]?.sourceLine ?? 0,
        });
        break;
      }
    }
  }
  return { state, changed, diagnostics };
}
