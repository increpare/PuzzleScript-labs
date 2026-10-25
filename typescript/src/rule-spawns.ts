import type { ResolvedDeclarations } from './declaration-model.js';
import type { GameObject } from './model.js';
import { RuleQualifier, type NamedRuleCell, type OrientedRule } from './source-rule-model.js';

/** Make a new concrete object stationary when its cell had no possible object on that layer. */
export function inferSpawnedStationary(rules: readonly OrientedRule[], declarations: ResolvedDeclarations): readonly OrientedRule[] {
  const concrete = new Map(declarations.objects.map(object => [object.name, object]));

  function possibleObjects(cell: NamedRuleCell): ReadonlySet<GameObject> {
    const possible = new Set<GameObject>();
    for (const term of cell) {
      // Every qualifier contributes, including No and RandomObject. A raw
      // concrete name has priority over an overlapping property namespace.
      const object = concrete.get(term.name);
      if (object !== undefined) possible.add(object);
      else for (const member of declarations.ruleNames.properties.get(term.name) ?? []) {
        const memberObject = concrete.get(member);
        if (memberObject !== undefined) possible.add(memberObject);
      }
    }
    return possible;
  }

  return rules.map(rule => ({ ...rule,
    lhs: rule.lhs.map(row => row.map(cell => cell.map(term => ({ ...term })))),
    rhs: rule.rhs.map((row, rowIndex) => row.map((cell, cellIndex) => {
      if (rule.late) return cell.map(term => ({ ...term }));
      const possible = possibleObjects(rule.lhs[rowIndex]![cellIndex]!);
      // Actual layer values include undefined for known unlayered objects.
      const layers = new Set<number | undefined>([...possible].map(object => declarations.objectLayers.get(object)));
      return cell.map(term => {
        if (term.qualifier !== RuleQualifier.Unspecified || declarations.ruleNames.properties.has(term.name)) return { ...term };
        const object = concrete.get(term.name);
        if (object === undefined || possible.has(object) || layers.has(declarations.objectLayers.get(object))) return { ...term };
        return { ...term, qualifier: RuleQualifier.Stationary };
      });
    })),
  }));
}
