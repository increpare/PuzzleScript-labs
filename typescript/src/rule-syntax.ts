import { appendSourceIssue, type SourceIssueReporter } from './source-diagnostics.js';
import { CommandKind, type Command, type SoundIndex } from './commands.js';
import type { ResolvedDeclarations } from './declaration-model.js';
import { SourceDiagnosticPhase, SourceDiagnosticSeverity, SourceRuleCommandKind, SourceRuleSyntaxIssueKind,
  type SourceDiagnostic, type SourceDocument, type SourceLoopMarker, type SourceRuleCommand, type SourceRuleRow } from './source-model.js';
import type { NamedRuleRows, RuleSyntax, RuleSyntaxResult } from './source-rule-model.js';

function projectRows(rows: readonly SourceRuleRow[]): NamedRuleRows {
  return rows.map(row => row.cells.map(cell => cell.terms.map(term => ({
    qualifier: term.qualifierValue, name: term.nameValue, origin: term.span,
  }))));
}

function projectCommand(command: SourceRuleCommand): Command {
  switch (command.kind) {
    case SourceRuleCommandKind.SoundEffect: return { kind: CommandKind.Sound, index: command.index as SoundIndex };
    case SourceRuleCommandKind.Cancel: return { kind: CommandKind.Cancel };
    case SourceRuleCommandKind.Checkpoint: return { kind: CommandKind.Checkpoint };
    case SourceRuleCommandKind.Restart: return { kind: CommandKind.Restart };
    case SourceRuleCommandKind.Win: return { kind: CommandKind.Win };
    case SourceRuleCommandKind.Message: return { kind: CommandKind.Message, text: command.text };
    case SourceRuleCommandKind.Again: return { kind: CommandKind.Again };
  }
}

/** Project the authoritative recovered source tree at the existing Rules checkpoint. */
export function recoverRuleSyntax(document: SourceDocument, declarations: ResolvedDeclarations, report?: SourceIssueReporter): RuleSyntaxResult {
  const rules: RuleSyntax[] = [];
  const loops: SourceLoopMarker[] = [];
  const diagnostics: SourceDiagnostic[] = [];
  let abortsCompilation = false;
  for (const source of document.rules) {
    if (!('lhs' in source)) { loops.push(source); continue; }
    for (const issue of source.syntaxIssues) {
      if (issue.kind === SourceRuleSyntaxIssueKind.Diagnostic) appendSourceIssue(diagnostics, issue.diagnostic, report);
      else if (declarations.ruleNames.properties.has(issue.name)) {
        // This supplemental note alone depends on resolved properties (including
        // promoted aliases); its placeholder preserves native diagnostic order.
        appendSourceIssue(diagnostics, { code: 'duplicate-property-name',
          message: `( However, noticing that you're committing this crime with <i>properties</i>, and not being able to help but acknowledge that you <i>may</i> be trying to do something esoteric and <i>clever</i> with the property inference system,  I might be brought to suggest that you consider this: you can have multiple equivalent properties with different names. )`,
          span: null, phase: SourceDiagnosticPhase.Rules, severity: SourceDiagnosticSeverity.Warning, countsAsError: true }, report);
      }
    }
    abortsCompilation ||= source.abortsCompilation;
    if (source.retained) rules.push({ source, sourceGroup: source.sourceGroup, directions: source.directions,
      lhs: projectRows(source.lhs), rhs: projectRows(source.rhs), late: source.late, rigid: source.rigid,
      random: source.random, commands: source.commands.map(projectCommand) });
  }
  return { rules, loops, diagnostics, abortsCompilation };
}
