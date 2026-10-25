import { appendSourceIssue, type SourceIssueReporter } from './source-diagnostics.js';
import type { ResolvedDeclarations } from './declaration-model.js';
import type { GameObject } from './model.js';
import { SourceDiagnosticPhase, SourceDiagnosticSeverity, type SourceDiagnostic } from './source-model.js';
import { RuleQualifier, type NamedRuleCell, type NamedRuleTerm, type RuleSyntax } from './source-rule-model.js';

/** Check and trim exclusions before orientation, synonym substitution or expansion. */
export function checkEarlyNegativeTerms(rules: readonly RuleSyntax[], declarations: ResolvedDeclarations, report?: SourceIssueReporter): {
  readonly rules: readonly RuleSyntax[];
  readonly diagnostics: readonly SourceDiagnostic[];
} {
  const concrete = new Map(declarations.objects.map(object => [object.name, object]));
  const diagnostics: SourceDiagnostic[] = [];

  function overlaps(lookup: ReadonlySet<GameObject>, objects: ReadonlySet<GameObject>): boolean {
    return [...lookup].some(object => objects.has(object));
  }

  function issue(rule: RuleSyntax, code: string, message: string, warning: boolean): void {
    appendSourceIssue(diagnostics, { code, message, span: rule.source.originalLine.span,
      phase: SourceDiagnosticPhase.Rules,
      severity: warning ? SourceDiagnosticSeverity.Warning : SourceDiagnosticSeverity.Error,
      countsAsError: !warning }, report);
  }

  function checkRightCell(rule: RuleSyntax, cell: NamedRuleCell): void {
    const presentNames: string[] = [];
    const presentObjects = new Set<GameObject>();
    for (const term of cell) {
      const object = concrete.get(term.name);
      // This stage deliberately counts only raw concrete names, even when a
      // synonym, property or aggregate would describe the same objects.
      if (term.qualifier !== RuleQualifier.No && object !== undefined) {
        presentNames.push(term.name);
        for (const member of declarations.rawObjectLookups.get(object)!) presentObjects.add(member);
      }
    }
    for (const term of cell) {
      if (term.qualifier !== RuleQualifier.No) continue;
      const excluded = declarations.namedObjects.get(term.name);
      if (excluded !== undefined && overlaps(excluded, presentObjects)) {
        issue(rule, 'contradictory-rhs-exclusion', `You have specified that there should be NO ${term.name.toUpperCase()} but there is also a requirement that ${presentNames.join(', ').toUpperCase()} be here.  This is a mistake right?`, false);
      }
    }
  }

  function trimRightCell(cell: NamedRuleCell, left: NamedRuleCell | undefined): NamedRuleTerm[] {
    const retained = [...cell];
    for (let index = 0; index < retained.length; index++) {
      const term = retained[index]!;
      if (term.qualifier === RuleQualifier.No
        && left?.some(other => other.qualifier === RuleQualifier.No && other.name === term.name)) {
        retained.splice(index, 1);
        // Native advances after deletion, skipping the term shifted into this slot.
      }
    }
    return retained;
  }

  function trimLeftCell(rule: RuleSyntax, cell: NamedRuleCell): NamedRuleTerm[] {
    const requiredObjects = new Set<GameObject>();
    const requiredLayers = new Set<number>();
    const occupier = new Map<number, string>();

    function requireObjects(object: GameObject): void {
      for (const member of declarations.rawObjectLookups.get(object)!) requiredObjects.add(member);
    }

    function requireObjectAndLayer(object: GameObject, name: string): void {
      requireObjects(object);
      const layer = declarations.objectLayers.get(object);
      // Native recovery treats an unlayered positive as occupying the first
      // layer, but its undefined layer contributes no numeric warning label.
      requiredLayers.add(layer ?? 0);
      if (layer !== undefined) occupier.set(layer, name);
    }

    for (const term of cell) {
      if (term.qualifier === RuleQualifier.No) continue;
      const name = term.name;
      // Namespace priority is significant when invalid declarations reuse names.
      if (declarations.ruleNames.singleLayerProperties.has(name)) {
        const layer = declarations.ruleNames.singleLayerProperties.get(name);
        requiredLayers.add(layer ?? 0);
        if (layer !== undefined) occupier.set(layer, name);
        for (const member of declarations.ruleNames.properties.get(name) ?? []) {
          const object = concrete.get(member);
          if (object !== undefined) requireObjects(object);
        }
      } else {
        const object = concrete.get(name);
        if (object !== undefined) requireObjectAndLayer(object, name);
        else for (const member of declarations.ruleNames.aggregates.get(name) ?? []) {
          const memberObject = concrete.get(member);
          if (memberObject !== undefined) requireObjectAndLayer(memberObject, name);
        }
      }
    }

    const retained = [...cell];
    for (let index = 0; index < retained.length; index++) {
      const term = retained[index]!;
      if (term.qualifier !== RuleQualifier.No) continue;
      const excluded = declarations.namedObjects.get(term.name);
      if (excluded === undefined) continue;
      const disjoint = !overlaps(excluded, requiredObjects);
      const covered = [...excluded].every(object => {
        const layer = declarations.objectLayers.get(object);
        return layer === undefined || requiredLayers.has(layer);
      });
      if (!disjoint || !covered) continue;

      // Warnings name every occupied layer, including layers beyond the exclusion.
      // One aggregate can therefore appear repeatedly in the label list.
      const layers = [...occupier.keys()].sort((a, b) => a - b);
      const labels = layers.map(layer => occupier.get(layer)!);
      issue(rule, 'redundant-lhs-exclusion', `You have specified that there should be NO ${term.name.toUpperCase()} but there is also a requirement that ${labels.join(', ').toUpperCase()} be there, which collectively occupies the same layers (Layers ${layers.map(layer => layer + 1).join(', ')}), so you can leave this out.`, true);
      retained.splice(index, 1);
      index--; // Unlike the RHS sweep, the LHS revisits the shifted term.
    }
    return retained;
  }

  const checked = rules.map(rule => {
    // Report RHS contradictions before either side loses exclusions.
    for (const row of rule.rhs) for (const cell of row) checkRightCell(rule, cell);
    const rhs = rule.rhs.map((row, rowIndex) => row.map((cell, cellIndex) =>
      trimRightCell(cell, rule.lhs[rowIndex]?.[cellIndex])));
    const lhs = rule.lhs.map(row => row.map(cell => trimLeftCell(rule, cell)));
    return { ...rule, lhs, rhs };
  });
  return { rules: checked, diagnostics };
}
