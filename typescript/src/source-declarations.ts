import { NativeLegendExpression } from './source-legend.js';
import { SourceLegendKind, type SourceLexicalToken } from './source-model.js';
import { isNativeInheritedObjectName } from './source-native-names.js';

export enum SourceDeclarationKind { Object, Alias, Property, Aggregate, InheritedObject }
interface SourceDeclarationBase { readonly name: string; readonly nameToken: SourceLexicalToken; readonly line: number }
export interface SourceObjectDeclaration extends SourceDeclarationBase { readonly kind: SourceDeclarationKind.Object }
export enum SourceAliasOriginKind { Object, UnownedObject, Legend }
export type SourceObjectAliasOrigin =
  { readonly kind: SourceAliasOriginKind.Object; readonly owner: SourceObjectDeclaration } |
  { readonly kind: SourceAliasOriginKind.UnownedObject; readonly attemptedPrimary: SourceLexicalToken };
export interface SourceLegendAliasOrigin { readonly kind: SourceAliasOriginKind.Legend; readonly target: SourceLexicalToken }
export type SourceAliasOrigin = SourceObjectAliasOrigin | SourceLegendAliasOrigin;
export interface SourceAliasDeclaration extends SourceDeclarationBase {
  readonly kind: SourceDeclarationKind.Alias;
  readonly target: string;
  readonly origin: SourceAliasOrigin;
}
interface SourceCompoundDeclarationBase extends SourceDeclarationBase {
  /** Operands after native self recovery, before source-time expansion. */
  readonly references: readonly string[];
  readonly referenceTokens: readonly SourceLexicalToken[];
}
export interface SourcePropertyDeclaration extends SourceCompoundDeclarationBase {
  readonly kind: SourceDeclarationKind.Property;
  readonly alternatives: readonly string[];
}
export interface SourceAggregateDeclaration extends SourceCompoundDeclarationBase {
  readonly kind: SourceDeclarationKind.Aggregate;
  readonly constituents: readonly string[];
}
export type SourceDeclaration = SourceObjectDeclaration | SourceAliasDeclaration | SourcePropertyDeclaration | SourceAggregateDeclaration;
export interface SourceInheritedObjectName {
  readonly kind: SourceDeclarationKind.InheritedObject;
  readonly name: string;
  readonly line: undefined;
}
export enum SourceExpansionKind { Object, Property, Aggregate, Undeclared }
export type SourceExpansion =
  { readonly kind: SourceExpansionKind.Object; readonly name: string } |
  { readonly kind: SourceExpansionKind.Property; readonly name: string; readonly alternatives: readonly string[] } |
  { readonly kind: SourceExpansionKind.Aggregate; readonly name: string; readonly constituents: readonly string[] } |
  { readonly kind: SourceExpansionKind.Undeclared; readonly name: string };
/** Semantic advice is evidence from source visits, separate from native issue reporting. */
export enum SourceDeclarationAdviceKind {
  DuplicateObject, DuplicateName, SelfReference, UndefinedReference, RepeatedReference,
  CrossKindReference, BackgroundLayerAlone, UndefinedLayerName, AggregateInLayer, MultipleLayers, RepeatedLayerName,
}
export type SourceDeclarationAdvice =
  { readonly kind: SourceDeclarationAdviceKind.DuplicateObject | SourceDeclarationAdviceKind.DuplicateName |
      SourceDeclarationAdviceKind.UndefinedReference | SourceDeclarationAdviceKind.RepeatedReference |
      SourceDeclarationAdviceKind.BackgroundLayerAlone | SourceDeclarationAdviceKind.UndefinedLayerName |
      SourceDeclarationAdviceKind.AggregateInLayer | SourceDeclarationAdviceKind.MultipleLayers | SourceDeclarationAdviceKind.RepeatedLayerName;
    readonly token: SourceLexicalToken } |
  { readonly kind: SourceDeclarationAdviceKind.SelfReference; readonly token: SourceLexicalToken; readonly name: SourceLexicalToken } |
  { readonly kind: SourceDeclarationAdviceKind.CrossKindReference; readonly token: SourceLexicalToken;
    readonly referenced: SourceLexicalToken; readonly referencedKind: SourceDeclarationKind.Property | SourceDeclarationKind.Aggregate };
export type SourceDeclarationIssue = (message: string, warning?: boolean) => void;

/** The source-time namespaces preserve insertion order, duplicate registrations,
 * and member multiplicity. They are separate from final compiler declarations. */
export class SourceDeclarations {
  private readonly objects: SourceObjectDeclaration[] = [];
  private readonly aliases: SourceAliasDeclaration[] = [];
  private readonly properties: SourcePropertyDeclaration[] = [];
  private readonly aggregates: SourceAggregateDeclaration[] = [];
  private readonly ordered: SourceDeclaration[] = [];
  private readonly adviceFacts: SourceDeclarationAdvice[] = [];
  private readonly ruleNames = new Set<string>();
  private readonly levelNames = new Set<string>();
  private readonly layers: string[][] = [];
  private explicitLayerNames: string[] = [];
  private backgroundInCurrentLayer = false;

  constructor(private readonly issue: SourceDeclarationIssue, private readonly keywords: ReadonlySet<string> = new Set()) {}

  get registrations(): readonly SourceDeclaration[] { return [...this.ordered]; }
  get advice(): readonly SourceDeclarationAdvice[] { return [...this.adviceFacts]; }
  get ruleVocabulary(): ReadonlySet<string> { return new Set(this.ruleNames); }
  get levelVocabulary(): ReadonlySet<string> { return new Set(this.levelNames); }
  get collisionLayers(): readonly (readonly string[])[] { return this.layers.map(layer => [...layer]); }
  isRuleName(name: string): boolean { return this.ruleNames.has(name); }
  isLevelGlyph(name: string): boolean { return this.levelNames.has(name); }

  /** Existence checks do not follow aliases and prefer compounds over aliases. */
  findDeclaration(name: string): SourceDeclaration | SourceInheritedObjectName | null {
    if (isNativeInheritedObjectName(name)) return { kind: SourceDeclarationKind.InheritedObject, name, line: undefined };
    return this.objects.find(object => object.name === name) ?? this.aggregates.find(aggregate => aggregate.name === name)
      ?? this.properties.find(property => property.name === name) ?? this.aliases.find(alias => alias.name === name) ?? null;
  }

  /** Expansion follows the first alias before considering same-name compounds. */
  expandName(name: string): SourceExpansion { return this.followAliasTarget(name, new Set()); }

  private followAliasTarget(name: string, path: Set<string>): SourceExpansion {
    if (this.objects.some(object => object.name === name) || isNativeInheritedObjectName(name)) return { kind: SourceExpansionKind.Object, name };
    if (path.has(name)) return { kind: SourceExpansionKind.Undeclared, name };
    path.add(name);
    const alias = this.aliases.find(alias => alias.name === name);
    if (alias !== undefined) return this.followAliasTarget(alias.target, path);
    const aggregate = this.aggregates.find(aggregate => aggregate.name === name);
    if (aggregate !== undefined) return { kind: SourceExpansionKind.Aggregate, name, constituents: aggregate.constituents };
    const property = this.properties.find(property => property.name === name);
    return property === undefined ? { kind: SourceExpansionKind.Undeclared, name }
      : { kind: SourceExpansionKind.Property, name, alternatives: property.alternatives };
  }

  private keywordWarning(name: string, includeSingleCharacter = false): void {
    if ((includeSingleCharacter || name.length > 1) && this.keywords.has(name)) {
      this.issue('You named an object "' + name.toUpperCase() + '", but this is a keyword. Don\'t do that!', true);
    }
  }

  private acceptObjectName(token: SourceLexicalToken, primary: boolean): boolean {
    const name = token.value;
    if (this.objects.some(object => object.name === name) || isNativeInheritedObjectName(name)) {
      this.adviceFacts.push({ kind: primary ? SourceDeclarationAdviceKind.DuplicateObject : SourceDeclarationAdviceKind.DuplicateName, token });
      this.issue('Object "' + name.toUpperCase() + '" defined multiple times.'); return false;
    }
    if ([...this.aliases, ...this.properties, ...this.aggregates].some(entry => entry.name === name)) {
      this.adviceFacts.push({ kind: SourceDeclarationAdviceKind.DuplicateName, token });
    }
    for (const alias of this.aliases) if (alias.name === name) this.issue('Name "' + name.toUpperCase() + '" already in use.');
    this.keywordWarning(name, primary);
    return true;
  }

  declareObject(nameToken: SourceLexicalToken): SourceObjectDeclaration | null {
    if (!this.acceptObjectName(nameToken, true)) return null;
    const object: SourceObjectDeclaration = { kind: SourceDeclarationKind.Object,
      name: nameToken.value, nameToken, line: nameToken.word.span.start.line };
    this.objects.push(object); this.ordered.push(object); return object;
  }

  declareObjectAlias(nameToken: SourceLexicalToken, origin: SourceObjectAliasOrigin): boolean {
    if (!this.acceptObjectName(nameToken, false)) return false;
    const target = origin.kind === SourceAliasOriginKind.Object ? origin.owner.name : '';
    this.acceptAlias(nameToken, target, origin); return true;
  }

  /** Register an accepted legend alias, retaining its one recovered target. */
  declareAlias(nameToken: SourceLexicalToken, target: SourceLexicalToken): void {
    this.acceptAlias(nameToken, target.value, { kind: SourceAliasOriginKind.Legend, target });
  }

  private acceptAlias(nameToken: SourceLexicalToken, target: string, origin: SourceAliasOrigin): void {
    const alias: SourceAliasDeclaration = { kind: SourceDeclarationKind.Alias,
      name: nameToken.value, nameToken, target, origin, line: nameToken.word.span.start.line };
    this.aliases.push(alias); this.ordered.push(alias);
  }

  private crossKindAdvice(token: SourceLexicalToken, name: string, referencedKind: SourceDeclarationKind.Property | SourceDeclarationKind.Aggregate): void {
    const referenced = this.findDeclaration(name);
    if (referenced !== null && referenced.kind !== SourceDeclarationKind.InheritedObject) {
      this.adviceFacts.push({ kind: SourceDeclarationAdviceKind.CrossKindReference, token, referenced: referenced.nameToken, referencedKind });
    }
  }

  declareProperty(nameToken: SourceLexicalToken, referenceTokens: readonly SourceLexicalToken[]): void {
    const name = nameToken.value, references = referenceTokens.map(token => token.value);
    const substitute = (reference: string): string[] => {
      const found = this.expandName(reference);
      switch (found.kind) {
        case SourceExpansionKind.Object: return [found.name];
        case SourceExpansionKind.Aggregate:
          this.crossKindAdvice(nameToken, found.name, SourceDeclarationKind.Aggregate);
          this.issue(`Cannot define a property (something defined in terms of 'or') in terms of an aggregate (something that uses 'and').  In this case, you can't define "${name.toUpperCase()}" in terms of "${found.name.toUpperCase()}".`);
          return [];
        case SourceExpansionKind.Property: return found.alternatives.filter(alternative => alternative !== found.name).flatMap(substitute);
        case SourceExpansionKind.Undeclared: return [found.name];
      }
    };
    const alternatives = references.flatMap(substitute);
    if (alternatives.length === 0) return;
    const property: SourcePropertyDeclaration = { kind: SourceDeclarationKind.Property, name, nameToken,
      references, referenceTokens: [...referenceTokens], alternatives, line: nameToken.word.span.start.line };
    this.properties.push(property); this.ordered.push(property);
  }

  declareAggregate(nameToken: SourceLexicalToken, referenceTokens: readonly SourceLexicalToken[]): void {
    const name = nameToken.value, references = referenceTokens.map(token => token.value);
    const substitute = (reference: string): string[] => {
      const found = this.expandName(reference);
      switch (found.kind) {
        case SourceExpansionKind.Object: return [found.name];
        case SourceExpansionKind.Aggregate: return found.constituents.flatMap(substitute);
        case SourceExpansionKind.Property:
          this.crossKindAdvice(nameToken, found.name, SourceDeclarationKind.Property);
          this.issue("Cannot define an aggregate (using 'and') in terms of properties (something that uses 'or').");
          return [found.name];
        case SourceExpansionKind.Undeclared: return [found.name];
      }
    };
    const constituents = references.flatMap(substitute);
    const aggregate: SourceAggregateDeclaration = { kind: SourceDeclarationKind.Aggregate, name, nameToken,
      references, referenceTokens: [...referenceTokens], constituents, line: nameToken.word.span.start.line };
    this.aggregates.push(aggregate); this.ordered.push(aggregate);
  }

  /** Diagnostics are synchronous visits. In particular no registration or self
   * removal occurs after the reporter interrupts a native issue-cap visit. */
  registerLegend(expression: NativeLegendExpression): void {
    if (expression.empty) return;
    if (expression.nameOnly) {
      this.issue('Incorrect format of legend - should be one of "A = B", "A = B or C [ or D ...]", "A = B and C [ and D ...]".'); return;
    }
    const dangling = expression.danglingWord;
    if (dangling !== null) {
      this.issue(`Incorrect format of legend - should be one of "A = B", "A = B or C [ or D ...]", "A = B and C [ and D ...]", but it looks like you have a dangling "${dangling.toUpperCase()}"?`); return;
    }
    const nameToken = expression.nameToken;
    if (nameToken === undefined) return;
    const name = nameToken.value, previous = this.findDeclaration(name);
    let okay = true;
    if (previous !== null) {
      this.adviceFacts.push({ kind: SourceDeclarationAdviceKind.DuplicateName, token: nameToken });
      this.issue(`Name "${name.toUpperCase()}" already in use (on line <a onclick="jumpToLine(${previous.line});" href="javascript:void(0);"><span class="errorTextLineNumber">line ${previous.line}</span></a>).`);
      okay = false;
    }
    this.keywordWarning(name);
    expression.recoverReferences(token => {
      this.adviceFacts.push({ kind: SourceDeclarationAdviceKind.SelfReference, token, name: nameToken });
      this.issue("You can't define object " + name.toUpperCase() + ' in terms of itself!'); okay = false;
    }, token => {
      this.adviceFacts.push({ kind: SourceDeclarationAdviceKind.RepeatedReference, token });
      this.issue("You're repeating the object " + token.value.toUpperCase() + " here multiple times on the RHS.  This makes no sense.  Don't do that.", true);
    });
    for (const token of expression.referenceTokens) if (token.value !== name && this.findDeclaration(token.value) === null) {
      this.adviceFacts.push({ kind: SourceDeclarationAdviceKind.UndefinedReference, token });
      this.issue(`You're talking about ${token.value.toUpperCase()} but it's not defined anywhere.`);
    }
    const references = expression.referenceTokens;
    switch (expression.kind) {
      case SourceLegendKind.Synonym: {
        const target = references[0];
        if (target !== undefined) this.declareAlias(nameToken, target);
        return;
      }
      case SourceLegendKind.Property: this.declareProperty(nameToken, references); return;
      case SourceLegendKind.Aggregate: this.declareAggregate(nameToken, references); return;
      case null:
        // Native silently drops a malformed OR tail; other malformed expressions
        // report their format only if no preceding semantic error suppressed it.
        if (okay && expression.firstOperator !== 'or') this.issue('This legend-entry is incorrectly-formatted - it should be one of A = B, A = B or C ( or D ...), A = B and C (and D ...)');
    }
  }

  captureRuleVocabulary(): void {
    for (const entries of [this.objects, this.aliases, this.aggregates, this.properties]) {
      for (const declaration of entries) this.ruleNames.add(declaration.name);
    }
  }

  captureLevelVocabulary(): void {
    for (const entries of [this.objects, this.aliases, this.aggregates]) {
      for (const declaration of entries) if (declaration.name.length === 1) this.levelNames.add(declaration.name);
    }
  }

  beginCollisionLayer(): void {
    this.layers.push([]); this.explicitLayerNames = []; this.backgroundInCurrentLayer = false;
  }

  private collisionMembers(reference: string, token: SourceLexicalToken): string[] {
    const found = this.expandName(reference);
    switch (found.kind) {
      case SourceExpansionKind.Object: return [found.name];
      case SourceExpansionKind.Aggregate:
        this.adviceFacts.push({ kind: SourceDeclarationAdviceKind.AggregateInLayer, token });
        this.issue('"' + found.name + '" is an aggregate (defined using "and"), and cannot be added to a single layer because its constituent objects must be able to coexist.'); return [];
      case SourceExpansionKind.Property:
        return found.alternatives.filter(alternative => alternative !== found.name).flatMap(alternative => this.collisionMembers(alternative, token));
      case SourceExpansionKind.Undeclared:
        this.adviceFacts.push({ kind: SourceDeclarationAdviceKind.UndefinedLayerName, token });
        this.issue('Cannot add "' + token.value.toUpperCase() + '" to a collision layer; it has not been declared.'); return [];
    }
  }

  addCollisionName(token: SourceLexicalToken): void {
    const name = token.value;
    const current = this.layers[this.layers.length - 1];
    if (name === 'background') {
      if ((current?.length ?? 0) > 0) {
        this.adviceFacts.push({ kind: SourceDeclarationAdviceKind.BackgroundLayerAlone, token });
        this.issue('Background must be in a layer by itself.');
      }
      this.backgroundInCurrentLayer = true;
    } else if (this.backgroundInCurrentLayer) {
      this.adviceFacts.push({ kind: SourceDeclarationAdviceKind.BackgroundLayerAlone, token });
      this.issue('Background must be in a layer by itself.');
    }
    const members = this.collisionMembers(name, token);
    if (current === undefined) { this.issue('no layers found.'); return; }
    const otherLayers: number[] = [];
    for (const member of members) for (let index = 0; index < this.layers.length - 1; index++) {
      if (this.layers[index]?.includes(member)) otherLayers.push(index);
    }
    if (otherLayers.length > 0) {
      this.adviceFacts.push({ kind: SourceDeclarationAdviceKind.MultipleLayers, token });
      this.issue('Object "' + name.toUpperCase() + '" included in multiple collision layers ( layers ' +
        otherLayers.map(index => '#' + (index + 1) + ', ').join('') + '#' + this.layers.length + ' ). You should fix this! (The compiler will just pick one layer to assign it to).', true);
    }
    if (this.explicitLayerNames.includes(name)) {
      this.adviceFacts.push({ kind: SourceDeclarationAdviceKind.RepeatedLayerName, token });
      this.issue('Object "' + name.toUpperCase() + '" included explicitly multiple times in the same layer. Don\'t do that innit.', true);
    }
    this.explicitLayerNames.push(name); current.push(...members);
  }
}
