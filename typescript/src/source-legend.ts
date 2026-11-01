import { SourceLegendKind, type SourceLegend, type SourceLexicalToken } from './source-model.js';

/** Native's flat working expression is mutable, including on comment revisits.
 * Keep its positional recovery here; declaration semantics consume named operands. */
function removeSelfReferences<T>(expression: T[], name: string, value: (word: T) => string): void {
  let index = expression.findIndex((word, position) => position >= 2 && value(word) === name);
  while (index >= 2) {
    expression.splice(index >= 4 ? index - 1 : index, 2);
    index = expression.findIndex((word, position) => position >= 2 && value(word) === name);
  }
}

function expressionReferences<T>(expression: readonly T[]): T[] {
  return expression.filter((_word, index) => index >= 2 && index % 2 === 0);
}

function expressionKind<T>(expression: readonly T[], value: (word: T) => string): RecoveredLegendExpression['kind'] | null {
  if (expression.length === 3) return SourceLegendKind.Synonym;
  const operators = expression.filter((_word, index) => index >= 3 && index % 2 === 1).map(value);
  if (operators[0] === 'and') return SourceLegendKind.Aggregate;
  return operators.length > 0 && operators.every(operator => operator === 'or') ? SourceLegendKind.Property : null;
}

export class NativeLegendExpression {
  private readonly words: string[] = [];
  append(word: string): void { this.words.push(word); }
  get empty(): boolean { return this.words.length === 0; }
  get name(): string { return this.words[0] ?? ''; }
  get nameOnly(): boolean { return this.words.length === 1; }
  get danglingWord(): string | null { return this.words.length % 2 === 0 ? this.words[this.words.length - 1] ?? null : null; }
  get firstOperator(): string | undefined { return this.words[3]; }
  get references(): readonly string[] { return expressionReferences(this.words); }
  get kind(): RecoveredLegendExpression['kind'] | null { return expressionKind(this.words, word => word); }

  /** Native reports a self visit before removing all occurrences. Repeated-member
   * visits then use the mutated working expression, retaining the original visit's
   * operand. A thrown issue must interrupt before the splice. */
  recoverReferences(selfReference: () => void, repeatedReference: (name: string) => void): void {
    for (let index = 2; index < this.words.length; index += 2) {
      const member = this.words[index];
      if (member === this.name) {
        selfReference();
        removeSelfReferences(this.words, this.name, word => word);
      }
      for (let earlier = 2; earlier < index; earlier += 2) {
        if (member !== undefined && this.words[earlier] === member) repeatedReference(member);
      }
    }
  }
}

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
  // An AND/OR name may also match an operator. Native only starts removal
  // after visiting a matching operand, then removes by its historical flat search.
  if (selfReferences.length > 0) removeSelfReferences(expression, name.value, token => token.value);
  const references = expressionReferences(expression);
  if (references.length === 0) return null;
  const kind = expressionKind(expression, token => token.value);
  return kind === null ? null : { kind, name, references, selfReferences };
}
