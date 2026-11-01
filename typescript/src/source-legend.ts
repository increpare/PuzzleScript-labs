import { SourceLegendKind, type SourceLexicalToken } from './source-model.js';

/** Native's flat working expression is mutable, including on comment revisits.
 * Keep its positional recovery here; declaration semantics consume named operands. */
function removeSelfReferences(expression: SourceLexicalToken[], name: string): void {
  let index = expression.findIndex((word, position) => position >= 2 && word.value === name);
  while (index >= 2) {
    expression.splice(index >= 4 ? index - 1 : index, 2);
    index = expression.findIndex((word, position) => position >= 2 && word.value === name);
  }
}

function expressionReferences(expression: readonly SourceLexicalToken[]): SourceLexicalToken[] {
  return expression.filter((_word, index) => index >= 2 && index % 2 === 0);
}

function expressionKind(expression: readonly SourceLexicalToken[]): ParsedLegendKind | null {
  if (expression.length === 3) return SourceLegendKind.Synonym;
  const operators = expression.filter((_word, index) => index >= 3 && index % 2 === 1).map(word => word.value);
  if (operators[0] === 'and') return SourceLegendKind.Aggregate;
  return operators.length > 0 && operators.every(operator => operator === 'or') ? SourceLegendKind.Property : null;
}

export type ParsedLegendKind = SourceLegendKind.Synonym | SourceLegendKind.Property | SourceLegendKind.Aggregate;

export class NativeLegendExpression {
  private readonly words: SourceLexicalToken[] = [];
  append(word: SourceLexicalToken): void { this.words.push(word); }
  get empty(): boolean { return this.words.length === 0; }
  get name(): string { return this.nameToken?.value ?? ''; }
  get nameToken(): SourceLexicalToken | undefined { return this.words[0]; }
  get nameOnly(): boolean { return this.words.length === 1; }
  get danglingWord(): string | null { return this.words.length % 2 === 0 ? this.words[this.words.length - 1]?.value ?? null : null; }
  get firstOperator(): string | undefined { return this.words[3]?.value; }
  get references(): readonly string[] { return this.referenceTokens.map(token => token.value); }
  get referenceTokens(): readonly SourceLexicalToken[] { return expressionReferences(this.words); }
  get kind(): ParsedLegendKind | null { return expressionKind(this.words); }

  /** Native reports a self visit before removing all occurrences. Repeated-member
   * visits then use the mutated working expression, retaining the original visit's
   * operand. A thrown issue must interrupt before the splice. */
  recoverReferences(selfReference: (word: SourceLexicalToken) => void, repeatedReference: (word: SourceLexicalToken) => void): void {
    for (let index = 2; index < this.words.length; index += 2) {
      const member = this.words[index];
      if (member?.value === this.name) {
        selfReference(member);
        removeSelfReferences(this.words, this.name);
      }
      for (let earlier = 2; earlier < index; earlier += 2) {
        if (member !== undefined && this.words[earlier]?.value === member.value) repeatedReference(member);
      }
    }
  }
}
