import { appendSourceIssue, type SourceIssueReporter } from './source-diagnostics.js';
import type { ResolvedDeclarations } from './declaration-model.js';
import type { CellReplacement, ExecutableRule } from './execution-model.js';
import { getObjectIntentLayer, Movement, type GameObject } from './model.js';
import { Ellipsis, type CellPattern, type LayerMovement, type PatternCell } from './rule-model.js';
import { SourceDiagnosticPhase, SourceDiagnosticSeverity, type SourceDiagnostic } from './source-model.js';
import { RuleQualifier as Q, type OrientedRule } from './source-rule-model.js';

export interface LoweredRule {
  readonly namedRule: OrientedRule;
  readonly executable: ExecutableRule;
  readonly overlap: readonly [string, string] | null;
}

const allMovements = [Movement.Up, Movement.Down, Movement.Left, Movement.Right, Movement.Action];

function qualifierMovements(qualifier: Q): readonly Movement[] {
  switch (qualifier) {
    case Q.Up: return [Movement.Up];
    case Q.Down: return [Movement.Down];
    case Q.Left: return [Movement.Left];
    case Q.Right: return [Movement.Right];
    case Q.Action: return [Movement.Action];
    // This recovered LHS spelling has the historical conjunction Up AND Left.
    case Q.RandomDirection: return [Movement.Up, Movement.Left];
    default: return [];
  }
}

function addMovements(target: LayerMovement[], layer: number, movements: readonly Movement[]): void {
  for (const movement of movements) {
    if (!target.some(entry => entry.layer === layer && entry.movement === movement)) target.push({ layer, movement });
  }
}

function orderedMovements(entries: LayerMovement[]): readonly LayerMovement[] {
  return entries.sort((first, second) => first.layer - second.layer || first.movement - second.movement);
}

/** Lower ordered names into static predicates and explicit cell transactions. */
export function lowerRules(rules: readonly OrientedRule[], declarations: ResolvedDeclarations, report?: SourceIssueReporter): {
  readonly rules: readonly LoweredRule[];
  readonly diagnostics: readonly SourceDiagnostic[];
} {
  const lowered: LoweredRule[] = [], diagnostics: SourceDiagnostic[] = [];
  const concrete = new Map(declarations.objects.map(object => [object.name, object]));
  const namedObjects = (name: string): ReadonlySet<GameObject> => declarations.namedObjects.get(name) ?? new Set();
  // A raw declaration determines the layer even when a later legend entry
  // changes the final named object set. Unlayered concrete names recover to zero.
  const layerOf = (name: string): number | undefined => {
    const object = concrete.get(name);
    return object === undefined ? declarations.ruleNames.singleLayerProperties.get(name) : declarations.objectLayers.get(object) ?? 0;
  };
  const include = (target: Set<GameObject>, objects: ReadonlySet<GameObject>): void => {
    for (const object of objects) target.add(object);
  };

  ruleLoop: for (const rule of rules) {
    let overlap: readonly [string, string] | null = null, ellipsisAtEdge = false;
    const rows: PatternCell[][] = [], replacements: (CellReplacement | null)[][] = [];
    function issue(code: string, message: string, severity = SourceDiagnosticSeverity.Error): void {
      appendSourceIssue(diagnostics, { code, message, span: rule.source.originalLine.span, phase: SourceDiagnosticPhase.Rules,
        severity, countsAsError: severity === SourceDiagnosticSeverity.Error }, report);
    }
    const mixedEllipsis = (): void => issue('mixed-rule-ellipsis', "You can't have anything in with an ellipsis. Sorry.");
    const missingLayer = (name: string): void => issue('rule-object-without-layer', `Oops! ${name.toUpperCase()} not assigned to a layer.`);

    for (let rowIndex = 0; rowIndex < rule.lhs.length; rowIndex++) {
      const row = rule.lhs[rowIndex]!, patternRow: PatternCell[] = [], replacementRow: (CellReplacement | null)[] = [];
      rows.push(patternRow); replacements.push(replacementRow);
      for (let cellIndex = 0; cellIndex < row.length; cellIndex++) {
        const left = row[cellIndex]!, right = rule.rhs[rowIndex]?.[cellIndex];
        const requiredObjects = new Set<GameObject>(), forbiddenObjects = new Set<GameObject>();
        const anyObjects: ReadonlySet<GameObject>[] = [], requiredMovements: LayerMovement[] = [], forbiddenMovements: LayerMovement[] = [];
        const leftOccupants = new Map<number, string>(), leftConcreteLayers = new Set<number>();
        let isEllipsis = false;

        for (const term of left) {
          const { name, qualifier } = term;
          if (qualifier === Q.Ellipsis) {
            if (left.length !== 1) { mixedEllipsis(); continue ruleLoop; }
            if (cellIndex === 0 || cellIndex === row.length - 1) {
              issue('edge-rule-ellipsis', "There's no point in putting an ellipsis at the very start or the end of a rule");
              ellipsisAtEdge = true;
            }
            if (rule.rhs.length > 0 && (right?.length !== 1 || right[0]?.qualifier !== Q.Ellipsis)) {
              issue('unmatched-left-rule-ellipsis', 'An ellipsis on the left must be matched by one in the corresponding place on the right.');
            }
            isEllipsis = true;
            break;
          }
          if (qualifier === Q.RandomObject) {
            issue('random-object-on-left', 'RANDOM cannot be matched on the left-hand side, it can only appear on the right');
            continue;
          }
          const layer = layerOf(name);
          if (layer === undefined) { missingLayer(name); continue; }
          if (qualifier === Q.No) { include(forbiddenObjects, namedObjects(name)); continue; }
          const previous = leftOccupants.get(layer);
          if (previous !== undefined) overlap = [name.toUpperCase(), previous.toUpperCase()];
          leftOccupants.set(layer, name);
          if (concrete.has(name)) {
            // LHS concrete requirements deliberately use the final named lookup.
            include(requiredObjects, namedObjects(name));
            leftConcreteLayers.add(layer);
          } else anyObjects.push(new Set(namedObjects(name)));
          if (qualifier === Q.Stationary) addMovements(forbiddenMovements, layer, allMovements);
          else addMovements(requiredMovements, layer, qualifierMovements(qualifier));
        }
        if (isEllipsis) { patternRow.push(Ellipsis); replacementRow.push(null); continue; }
        const pattern: CellPattern = { requiredObjects, forbiddenObjects, anyObjects,
          requiredMovements: orderedMovements(requiredMovements), forbiddenMovements: orderedMovements(forbiddenMovements) };
        patternRow.push(pattern);
        const contradictions = declarations.objectChoiceOrder.filter(object => requiredObjects.has(object) && forbiddenObjects.has(object));
        if (contradictions.length > 0) {
          const names = contradictions.map(object => `${object.name} NO ${object.name}`).join(', ').toUpperCase();
          issue('contradictory-rule-objects', `This rule has something amounting to "${names}" on the left-hand-side,which can never match, so the rule is getting removed during compilation.`, SourceDiagnosticSeverity.Warning);
          continue ruleLoop;
        }
        if (rule.rhs.length === 0) { replacementRow.push(null); continue; }
        const rightTerms = right!;
        if (rightTerms[0]?.qualifier === Q.Ellipsis) {
          issue('unmatched-right-rule-ellipsis', 'An ellipsis on the right must be matched by one in the corresponding place on the left.');
        }
        for (const term of rightTerms) if (term.qualifier === Q.Ellipsis && rightTerms.length !== 1) mixedEllipsis();

        const removeObjects = new Set<GameObject>(), addObjects = new Set<GameObject>(), vacateLayers = new Set<number>();
        const removeMovements: LayerMovement[] = [], addMovementTerms: LayerMovement[] = [];
        const resetMovementLayers = new Set<number>(), randomObjects = new Set<GameObject>(), randomDirectionLayers = new Set<number>();
        const rightOccupants = new Map<number, string>(), randomOccupants = new Map<number, string>(), rightConcreteLayers = new Set<number>();
        for (const term of rightTerms) {
          const { name, qualifier } = term;
          if (qualifier === Q.Ellipsis) break;
          if (qualifier === Q.RandomObject) {
            if (!declarations.namedObjects.has(name)) {
              issue('unknown-random-rule-object', `You want to spawn a random "${name.toUpperCase()}", but I don't know how to do that`);
              continue;
            }
            include(randomObjects, namedObjects(name));
            const values = declarations.ruleNames.properties.get(name) ?? [name];
            if (values.length === 1) {
              issue('single-random-rule-object', `In this rule you're asking me to spawn a random ${name.toUpperCase()} for you, but that's already a concrete single object. You wanna be using random with properties (things defined in terms of OR in the legend) so there's some things to select between.`, SourceDiagnosticSeverity.Warning);
            }
            for (const member of values) {
              const object = concrete.get(member), layer = object === undefined ? undefined : declarations.objectLayers.get(object);
              if (layer === undefined) continue;
              const previous = rightOccupants.get(layer);
              if (previous !== undefined && member.toUpperCase() !== previous.toUpperCase()) {
                issue('random-rule-object-conflict', `This rule may try to spawn a ${member.toUpperCase()} with random, but also requires a ${previous.toUpperCase()} be here, which is on the same layer - they shouldn't be able to coexist!`, SourceDiagnosticSeverity.Warning);
              }
              randomOccupants.set(layer, member);
            }
            continue;
          }
          const layer = layerOf(name);
          if (layer === undefined) { missingLayer(name); continue; }
          if (qualifier === Q.No) { include(removeObjects, namedObjects(name)); continue; }
          const previous = rightOccupants.get(layer) ?? randomOccupants.get(layer);
          if (previous !== undefined && overlap === null) {
            issue('overlapping-rule-writes', `Rule matches object types that can't overlap: "${name.toUpperCase()}" and "${previous.toUpperCase()}".`);
          }
          rightOccupants.set(layer, name);
          if (qualifier !== Q.Unspecified) resetMovementLayers.add(layer);
          const object = concrete.get(name);
          if (object !== undefined) {
            // Positive concrete writes use the raw lookup, including its orphan.
            include(addObjects, declarations.rawObjectLookups.get(object)!);
            vacateLayers.add(layer);
            rightConcreteLayers.add(layer);
          }
          if (qualifier === Q.Stationary) addMovements(removeMovements, layer, allMovements);
          else if (qualifier === Q.RandomDirection) randomDirectionLayers.add(layer);
          else addMovements(addMovementTerms, layer, qualifierMovements(qualifier));
        }
        // Native clearing is whole-set: a single missing member clears every
        // required member. Additions are retained and win when applied.
        if ([...requiredObjects].some(object => !addObjects.has(object))) include(removeObjects, requiredObjects);
        if (requiredMovements.some(entry => !addMovementTerms.some(added => added.layer === entry.layer && added.movement === entry.movement))) {
          for (const entry of requiredMovements) addMovements(removeMovements, entry.layer, [entry.movement]);
        }
        for (const layer of leftOccupants.keys()) if (!rightOccupants.has(layer)) {
          vacateLayers.add(layer);
          resetMovementLayers.add(layer);
        }
        for (const layer of leftConcreteLayers) if (!rightConcreteLayers.has(layer)) resetMovementLayers.add(layer);
        // Random writes follow current intent layers; static concrete recovery
        // still uses layer zero and does not gain these dynamic rigid layers.
        const candidates = declarations.objectChoiceOrder.filter(object => randomObjects.has(object))
          .map(object => ({ object, layer: getObjectIntentLayer(declarations.collisionLayers, object)! }));
        const hasChanges = removeObjects.size > 0 || addObjects.size > 0
          || [...vacateLayers].some(layer => (declarations.collisionLayers[layer]?.length ?? 0) > 0)
          || removeMovements.length > 0 || addMovementTerms.length > 0 || resetMovementLayers.size > 0
          || candidates.length > 0 || randomDirectionLayers.size > 0;
        replacementRow.push(hasChanges ? { edits: { removeObjects, addObjects, vacateLayers,
          removeMovements: orderedMovements(removeMovements), addMovements: orderedMovements(addMovementTerms),
          resetMovementLayers, randomObjects: candidates, randomDirectionLayers }, rigidLayers: resetMovementLayers } : null);
      }
    }
    if (ellipsisAtEdge) continue;
    lowered.push({ namedRule: rule, overlap, executable: { direction: rule.direction, rows, replacements,
      sourceLine: rule.source.originalLine.span.start.line, hasReplacements: rule.rhs.length > 0,
      commands: rule.commands, rigidGroup: null } });
  }
  return { rules: lowered, diagnostics };
}
