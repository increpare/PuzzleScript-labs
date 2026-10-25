import { SourceLegendKind, type SourceLegend, type SourceLexicalToken } from './source-model.js';

export interface RecoveredLegendExpression {
  readonly kind: SourceLegendKind.Synonym | SourceLegendKind.Property | SourceLegendKind.Aggregate;
  readonly name: SourceLexicalToken;
  readonly references: readonly SourceLexicalToken[];
  readonly selfReferences: readonly SourceLexicalToken[];
}

/** Native syntactic recovery, retaining the original words and authored AST. */
export function recoverLegendExpression(source: SourceLegend): RecoveredLegendExpression | null {
  const tokens = source.definitionWords;
  const name = tokens[0];
  if (source.name === null || name === undefined || tokens.length < 3 || tokens.length % 2 === 0 || tokens[1]?.value !== '='
    || tokens.slice(2).some(token => token.value === '=')) return null;
  const expression = [...tokens];
  const selfReferences = tokens.filter((reference, index) => index >= 2 && index % 2 === 0 && reference.value === name.value);
  if (selfReferences.length > 0) {
    // The first operand removes its following operator; every later operand
    // removes its preceding operator. Only then does native select the kind.
    let index = expression.findIndex((token, position) => position >= 2 && token.value === name.value);
    while (index >= 2) {
      expression.splice(index >= 4 ? index - 1 : index, 2);
      index = expression.findIndex((token, position) => position >= 2 && token.value === name.value);
    }
  }
  const references = expression.filter((_token, index) => index >= 2 && index % 2 === 0);
  if (references.length === 0) return null;
  const operators = expression.filter((_token, index) => index >= 3 && index % 2 === 1);
  const kind = expression.length === 3 ? SourceLegendKind.Synonym
    : operators[0]?.value === 'and' ? SourceLegendKind.Aggregate
    : operators.length > 0 && operators.every(operator => operator.value === 'or') ? SourceLegendKind.Property : null;
  return kind === null ? null : { kind, name, references, selfReferences };
}
