import { appendSourceIssue, type SourceIssueReporter } from './source-diagnostics.js';
import * as vanilla from './compatibility-vanilla-5a94bde1.js';
import type { ExecutableRule } from './execution-model.js';
import type { SourcePatternRule } from './source-model.js';
import type { RuleGame, RuleGroup, RuleSchedule } from './execution-model.js';
import type { LoweredRule } from './rule-lowering.js';
import { Ellipsis } from './rule-model.js';
import {
  SourceDiagnosticPhase, SourceDiagnosticSeverity, SourceRuleKind,
  type SourceDiagnostic, type SourceLoopMarker, type SourceSpan,
} from './source-model.js';

function report(
  diagnostics: SourceDiagnostic[], code: string, message: string, span: SourceSpan,
  severity = SourceDiagnosticSeverity.Error, reporter?: SourceIssueReporter,
): void {
  appendSourceIssue(diagnostics, { code, message, span, severity, countsAsError: severity === SourceDiagnosticSeverity.Error,
    phase: SourceDiagnosticPhase.Rules }, reporter);
}

function overlapMessage(pairs: readonly (readonly [string, string])[]): string {
  const first = pairs[0]!;
  let extra = '';
  if (pairs.length > 1) {
    extra = ' (ditto for ';
    for (let index = 1; index < pairs.length; index++) {
      if (index > 1) {
        extra += ', ';
        if (index === pairs.length - 1) extra += 'and ';
      }
      const pair = pairs[index]!;
      extra += `${pair[0]}/${pair[1]}`;
      if (index === 3 && pairs.length > 4) { extra += ' etc.'; break; }
    }
    extra += ')';
  }
  return `${first[0]} and ${first[1]} can never overlap${extra}. This rule requires that to happen, so it impossible it will ever trigger.`;
}

/** Delete forwards: neighbouring variants and accumulated examples change after each deletion. */
function removeOverlaps(group: readonly LoweredRule[], diagnostics: SourceDiagnostic[], reporter?: SourceIssueReporter): LoweredRule[] {
  const surviving = [...group];
  const pairs: (readonly [string, string])[] = [];
  for (let index = 0; index < surviving.length; index++) {
    const rule = surviving[index]!;
    if (rule.overlap === null) continue;
    const line = rule.executable.sourceLine;
    const sameBefore = surviving[index - 1]?.executable.sourceLine === line;
    const sameAfter = surviving[index + 1]?.executable.sourceLine === line;
    surviving.splice(index, 1);
    if (!pairs.some(pair => pair[0] === rule.overlap![0] && pair[1] === rule.overlap![1])) pairs.push(rule.overlap);
    if ((!sameBefore && !sameAfter) || surviving.length === 0) {
      report(diagnostics, 'overlapping-rule-match', overlapMessage(pairs), rule.namedRule.source.originalLine.span, SourceDiagnosticSeverity.Error, reporter);
    }
    index--;
  }
  return surviving;
}

function collectGroups(rules: readonly LoweredRule[], late: boolean, diagnostics: SourceDiagnostic[], reporter?: SourceIssueReporter): LoweredRule[][] {
  const bySourceGroup = new Map<number, LoweredRule[]>();
  for (const rule of rules) {
    if (rule.namedRule.late !== late) continue;
    const number = rule.namedRule.sourceGroup;
    const group = bySourceGroup.get(number);
    if (group === undefined) bySourceGroup.set(number, [rule]);
    else group.push(rule);
  }
  const groups: LoweredRule[][] = [];
  for (const number of [...bySourceGroup.keys()].sort((a, b) => a - b)) {
    const surviving = removeOverlaps(bySourceGroup.get(number)!, diagnostics, reporter);
    if (surviving.length > 0) groups.push(surviving);
  }
  return groups;
}

function validateEllipses(groups: readonly (readonly LoweredRule[])[], diagnostics: SourceDiagnostic[], reporter?: SourceIssueReporter): void {
  for (const group of groups) for (const rule of group) for (const row of rule.executable.rows) {
    let count = 0;
    for (let index = 0; index < row.length; index++) {
      if (row[index] !== Ellipsis) continue;
      count++;
      if (count > 2) {
        report(diagnostics, 'too-many-rule-ellipses', "You can't use more than two ellipses in a single cell match pattern.", rule.namedRule.source.originalLine.span, SourceDiagnosticSeverity.Error, reporter);
      } else if (row[index - 1] === Ellipsis) {
        report(diagnostics, 'adjacent-rule-ellipses', "Why would you go and have two ellipses in a row like that? It's exactly the same as just having a single ellipsis, right?", rule.namedRule.source.originalLine.span, SourceDiagnosticSeverity.Warning, reporter);
      }
    }
  }
}

function executableGroups(groups: readonly (readonly LoweredRule[])[], rigidBySource: ReadonlyMap<number, number>, sources: Map<ExecutableRule, SourcePatternRule>): RuleGroup[] {
  return groups.map(group => ({ random: group[0]!.namedRule.random,
    rules: group.map(rule => {
      const executable = { ...rule.executable,
        rigidGroup: rule.namedRule.rigid ? rigidBySource.get(rule.namedRule.sourceGroup) ?? null : null };
      sources.set(executable, rule.namedRule.source);
      return executable;
    }),
  }));
}

function loopBounds(loops: readonly SourceLoopMarker[], diagnostics: SourceDiagnostic[], reporter?: SourceIssueReporter): SourceLoopMarker[] {
  for (let index = 0; index < loops.length; index++) {
    const loop = loops[index]!;
    if (index % 2 === 0 && loop.kind === SourceRuleKind.EndLoop) {
      report(diagnostics, 'unexpected-endloop', "Found an ENDLOOP, but I'm not in a loop?", loop.originalLine.span, SourceDiagnosticSeverity.Error, reporter);
    } else if (index % 2 === 1 && loop.kind === SourceRuleKind.StartLoop) {
      report(diagnostics, 'nested-startloop', "Found a STARTLOOP, but I'm already inside a loop? (Puzzlescript can't nest loops, FWIW).", loop.originalLine.span, SourceDiagnosticSeverity.Error, reporter);
    }
  }
  const bounds = [...loops];
  if (bounds.length % 2 !== 0) {
    const last = bounds[bounds.length - 1]!;
    report(diagnostics, 'missing-endloop', 'Yo I found a STARTLOOP without a corresponding ENDLOOP.', last.originalLine.span, SourceDiagnosticSeverity.Error, reporter);
    // Only the physical position is used for recovery; keep input evidence intact.
    bounds.push({ ...last, kind: SourceRuleKind.EndLoop });
  }
  return bounds;
}

function scheduleLoops(groups: readonly RuleGroup[], bounds: readonly SourceLoopMarker[], diagnostics: SourceDiagnostic[], reporter?: SourceIssueReporter): Map<number, number> {
  const loops = new Map<number, number>();
  for (let index = 0; index < bounds.length; index += 2) {
    const start = bounds[index]!, end = bounds[index + 1]!;
    const startLine = start.originalLine.span.start.line, endLine = end.originalLine.span.start.line;
    let target: number | null = null;
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const rules = groups[groupIndex]!.rules;
      const firstLine = rules[0]!.sourceLine, lastLine = rules[rules.length - 1]!.sourceLine;
      if (firstLine <= startLine && startLine <= lastLine) {
        report(diagnostics, 'loop-inside-rule-group', "Found a loop point in the middle of a rule. You probably don't want to do this, right?", start.originalLine.span, SourceDiagnosticSeverity.Error, reporter);
      } else if (firstLine <= endLine && endLine <= lastLine) {
        report(diagnostics, 'loop-inside-rule-group', "Found a loop point in the middle of a rule. You probably don't want to do this, right?", start.originalLine.span, SourceDiagnosticSeverity.Error, reporter);
      }
      if (endLine < firstLine) break;
      if (startLine <= firstLine && firstLine <= endLine) {
        if (target === null) target = groupIndex;
        if (loops.get(groupIndex - 1) === target) loops.delete(groupIndex - 1);
        loops.set(groupIndex, target);
      }
    }
  }
  return loops;
}

/** Form runtime schedules only after source variants have survived group validation. */
export function compileRuleGroups(rules: readonly LoweredRule[], reporter?: SourceIssueReporter): {
  readonly early: RuleSchedule;
  readonly late: RuleSchedule;
  readonly rigid: boolean;
  readonly rigidMerges: RuleGame['rigidMerges'];
  readonly diagnostics: readonly SourceDiagnostic[];
  readonly ruleSources: ReadonlyMap<ExecutableRule, SourcePatternRule>;
} {
  const diagnostics: SourceDiagnostic[] = [];
  const early = collectGroups(rules, false, diagnostics, reporter), late = collectGroups(rules, true, diagnostics, reporter);
  validateEllipses(early, diagnostics, reporter);
  validateEllipses(late, diagnostics, reporter);
  const rigidGroups: number[] = [], rigidBySource = new Map<number, number>();
  for (let index = 0; index < early.length; index++) {
    const group = early[index]!;
    if (group.some(rule => rule.namedRule.rigid)) {
      rigidGroups.push(index);
      rigidBySource.set(group[0]!.namedRule.sourceGroup, index);
    }
  }
  if (rigidGroups.length > 30) {
    report(diagnostics, 'too-many-rigid-groups', "There can't be more than 30 rigid groups (rule groups containing rigid members).", early[rigidGroups[30]!]![0]!.namedRule.source.originalLine.span, SourceDiagnosticSeverity.Error, reporter);
  }
  const rigidMerges = vanilla.rigidOwnershipTransitions(rigidGroups);
  const ruleSources = new Map<ExecutableRule, SourcePatternRule>();
  const earlyGroups = executableGroups(early, rigidBySource, ruleSources), lateGroups = executableGroups(late, rigidBySource, ruleSources);
  return { early: { groups: earlyGroups, loops: new Map() }, late: { groups: lateGroups, loops: new Map() },
    rigid: rigidGroups.length > 0, rigidMerges, ruleSources, diagnostics };
}

export function compileRuleLoops(early: RuleSchedule, late: RuleSchedule, loops: readonly SourceLoopMarker[], reporter?: SourceIssueReporter): {
  readonly early: RuleSchedule; readonly late: RuleSchedule; readonly diagnostics: readonly SourceDiagnostic[];
} {
  const diagnostics: SourceDiagnostic[] = [], bounds = loopBounds(loops, diagnostics, reporter);
  return { early: { groups: early.groups, loops: scheduleLoops(early.groups, bounds, diagnostics, reporter) },
    late: { groups: late.groups, loops: scheduleLoops(late.groups, bounds, diagnostics, reporter) }, diagnostics };
}

/** Convenience composition, sharing the same final executable identities. */
export function compileRuleSchedules(rules: readonly LoweredRule[], loops: readonly SourceLoopMarker[]) {
  const groups = compileRuleGroups(rules);
  const scheduled = compileRuleLoops(groups.early, groups.late, loops);
  return { early: scheduled.early, late: scheduled.late, rigid: groups.rigid, rigidMerges: groups.rigidMerges,
    diagnostics: [...groups.diagnostics, ...scheduled.diagnostics] };
}
