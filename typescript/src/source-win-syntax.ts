import type { SourceLexicalToken } from './source-model.js';
import { WinQuantifier } from './win-conditions.js';

export enum WinSyntaxKind { MissingSubject, Clause }
export enum WinTargetKind { Everywhere, Named }
export type WinSyntaxTarget = { readonly kind: WinTargetKind.Everywhere }
  | { readonly kind: WinTargetKind.Named; readonly token: SourceLexicalToken };
export type AcceptedWinCondition =
  | { readonly kind: WinSyntaxKind.MissingSubject; readonly quantifierToken: SourceLexicalToken | null }
  | { readonly kind: WinSyntaxKind.Clause; readonly quantifier: WinQuantifier; readonly quantifierToken: SourceLexicalToken;
    readonly subjectToken: SourceLexicalToken; readonly target: WinSyntaxTarget };

/** Recover native's captured word list exactly once, independently of lexical diagnostics. */
export function recoverWinSyntax(tokens: readonly SourceLexicalToken[]): AcceptedWinCondition {
  const quantifierToken = tokens[0], subjectToken = tokens[1];
  if (quantifierToken === undefined || subjectToken === undefined) return { kind: WinSyntaxKind.MissingSubject, quantifierToken: quantifierToken ?? null };
  const quantifier = quantifierToken.value === 'no' ? WinQuantifier.No
    : quantifierToken.value === 'all' ? WinQuantifier.All : WinQuantifier.Some;
  return { kind: WinSyntaxKind.Clause, quantifier, quantifierToken, subjectToken,
    target: tokens.length === 4 ? { kind: WinTargetKind.Named, token: tokens[3]! } : { kind: WinTargetKind.Everywhere } };
}
export function bindWinSyntax(definition: AcceptedWinCondition, bind: (token: SourceLexicalToken) => SourceLexicalToken): AcceptedWinCondition {
  if (definition.kind === WinSyntaxKind.MissingSubject) return { ...definition,
    quantifierToken: definition.quantifierToken === null ? null : bind(definition.quantifierToken) };
  return { ...definition, quantifierToken: bind(definition.quantifierToken), subjectToken: bind(definition.subjectToken),
    target: definition.target.kind === WinTargetKind.Everywhere ? definition.target : { ...definition.target, token: bind(definition.target.token) } };
}
