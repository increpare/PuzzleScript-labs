import type { CollisionLayer, GameObject } from './model.js';
import type { SourceObject, SourceLegend, SourceWord } from './source-model.js';
import type { PlayerDefinition } from './turn-rules.js';

export enum ResolvedNameKind { Object, Property, Aggregate, Unresolved }
interface ResolvedNameSource {
  readonly name: string;
  readonly word: SourceWord;
  readonly source: SourceObject | SourceLegend;
}
export type ResolvedName = ResolvedNameSource & (
  { readonly kind: ResolvedNameKind.Object; readonly object: GameObject } |
  { readonly kind: ResolvedNameKind.Property; readonly members: readonly GameObject[] } |
  { readonly kind: ResolvedNameKind.Aggregate; readonly members: readonly GameObject[] } |
  { readonly kind: ResolvedNameKind.Unresolved; readonly references: readonly SourceWord[]; readonly reason: string });

/** Final rule-language namespaces, retaining identifier and member order. */
export interface RuleVocabulary {
  readonly synonyms: ReadonlyMap<string, string>;
  readonly properties: ReadonlyMap<string, readonly string[]>;
  readonly aggregates: ReadonlyMap<string, readonly string[]>;
  /** A present undefined value means every member is a known, unlayered object. */
  readonly singleLayerProperties: ReadonlyMap<string, number | undefined>;
}

export interface ResolvedDeclarations {
  readonly objects: readonly GameObject[];
  readonly orphanedObject: GameObject | null;
  readonly objectSources: ReadonlyMap<GameObject, SourceObject>;
  readonly names: ReadonlyMap<string, ResolvedName>;
  readonly ruleNames: RuleVocabulary;
  /** Earliest accepted registration, before later declarations can replace a namespace. */
  readonly firstDeclarationWords: ReadonlyMap<string, SourceWord>;
  /** Source-ordered concrete/synonym/property lookup used by win conditions and object sounds. */
  readonly namedObjects: ReadonlyMap<string, ReadonlySet<GameObject>>;
  /** Raw concrete requirements, before same-name legend overrides. */
  readonly rawObjectLookups: ReadonlyMap<GameObject, ReadonlySet<GameObject>>;
  /** Final aggregate namespace, kept separate even when names overlap. */
  readonly namedAggregates: ReadonlyMap<string, ReadonlySet<GameObject>>;
  /** Final synonym/property expansion for movement sounds, retaining order and duplicates. */
  readonly soundTargets: ReadonlyMap<string, readonly GameObject[]>;
  readonly objectChoiceOrder: readonly GameObject[];
  readonly collisionLayers: readonly CollisionLayer[];
  readonly objectLayers: ReadonlyMap<GameObject, number>;
  readonly glyphs: ReadonlyMap<string, ReadonlySet<GameObject>>;
  readonly player: PlayerDefinition;
  readonly background: { readonly object: GameObject; readonly layer: number } | null;
}
