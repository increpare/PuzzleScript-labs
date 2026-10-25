import type { SourceIssueReporter } from './source-diagnostics.js';
import { ResolvedNameKind, type ResolvedDeclarations, type ResolvedName, type RuleVocabulary } from './declaration-model.js';
import type { GameObject } from './model.js';
import { SourceDiagnosticPhase, SourceDiagnosticSeverity, SourceLegendKind,
  type SourceDiagnostic, type SourceDocument, type SourceLegend, type SourceObject, type SourceSpan, type SourceWord } from './source-model.js';
import { PlayerMatchKind } from './turn-rules.js';
import { recoverLegendExpression } from './source-legend.js';

enum DeclarationKind { Object, Synonym, Property, Aggregate }
interface Declaration {
  readonly name: string;
  readonly word: SourceWord;
  readonly source: SourceObject | SourceLegend;
  readonly kind: DeclarationKind;
  readonly references: readonly SourceWord[];
  readonly values: readonly string[];
}
interface ResolutionProblem {
  readonly code: 'cyclic-reference' | 'undefined-reference' | 'cross-kind-reference' | 'unresolved-name';
  readonly message: string;
}

/** Native dictionaries enumerate canonical integer-index names before other names. */
function dictionaryIterationNames<T>(dictionary: ReadonlyMap<string, T>): readonly string[] {
  const indexed: { readonly name: string; readonly index: number }[] = [];
  const ordinary: string[] = [];
  for (const name of dictionary.keys()) {
    const index = Number(name);
    if (Number.isInteger(index) && index >= 0 && index <= 4294967294 && String(index) === name) indexed.push({ name, index });
    else ordinary.push(name);
  }
  indexed.sort((a, b) => a.index - b.index);
  return [...indexed.map(entry => entry.name), ...ordinary];
}

/** Accepted authored namespaces and one canonical object construction. */
export interface PreparedDeclarations {
  readonly document: SourceDocument;
  readonly objects: GameObject[];
  readonly objectSources: Map<GameObject, SourceObject>;
  readonly concrete: Map<string, GameObject>;
  readonly concreteDeclarations: Map<string, Declaration>;
  readonly synonyms: Declaration[];
  readonly properties: Declaration[];
  readonly aggregates: Declaration[];
  readonly diagnostics: SourceDiagnostic[];
  readonly authoredNames: Set<string>;
  readonly firstDeclarationWords: Map<string, SourceWord>;
  readonly rawLayers: GameObject[][];
}

export function prepareDeclarations(document: SourceDocument): PreparedDeclarations {
  const objects: GameObject[] = [];
  const objectSources = new Map<GameObject, SourceObject>();
  const concrete = new Map<string, GameObject>();
  const concreteDeclarations = new Map<string, Declaration>();
  const synonyms: Declaration[] = [];
  const properties: Declaration[] = [];
  const aggregates: Declaration[] = [];
  const diagnostics: SourceDiagnostic[] = [];
  const authoredNames = new Set<string>();
  const firstDeclarationWords = new Map<string, SourceWord>();
  const rawLayers: GameObject[][] = [];
  function registerName(word: SourceWord, name: string): void {
    authoredNames.add(name);
    if (!firstDeclarationWords.has(name)) firstDeclarationWords.set(name, word);
  }
  function issue(code: string, message: string, span: SourceSpan | null, warning = false): void {
    diagnostics.push({ code, message, span, severity: warning ? SourceDiagnosticSeverity.Warning : SourceDiagnosticSeverity.Error,
      countsAsError: !warning, phase: SourceDiagnosticPhase.Declarations });
  }
  function parserLookup(name: string, visiting = new Set<string>()): Declaration | undefined {
    if (concrete.has(name)) return concreteDeclarations.get(name);
    if (visiting.has(name)) return undefined;
    visiting.add(name);
    const alias = synonyms.find(entry => entry.name === name);
    if (alias !== undefined) return parserLookup(alias.values[0]!, visiting);
    return aggregates.find(entry => entry.name === name) ?? properties.find(entry => entry.name === name);
  }
  function declared(name: string): boolean {
    return concrete.has(name) || [...synonyms, ...properties, ...aggregates].some(entry => entry.name === name);
  }
  function duplicate(word: SourceWord): void {
    issue('duplicate-name', `Name "${word.spelling}" is already in use.`, word.span);
  }
  let previousObject: GameObject | undefined;
  function registerObjectAliases(source: SourceObject, object: GameObject): void {
    for (const { value: name, word } of source.definitionNames.slice(1)) {
      if (declared(name)) duplicate(word);
      if (concrete.has(name)) continue;
      synonyms.push({ name, word, source, kind: DeclarationKind.Synonym,
        references: [objectSources.get(object)!.primaryName], values: [object.name] });
      registerName(word, name);
    }
  }
  const entries = [...document.objects, ...document.legend, ...document.collisionLayers].sort((a, b) => a.order - b.order);
  for (const source of entries) {
    if ('names' in source) {
      const layer: GameObject[] = [];
      const explicit = new Set<string>();
      let backgroundSeen = false;
      function expandLayer(name: string, word: SourceWord, visiting = new Set<string>()): GameObject[] {
        if (visiting.has(name)) { issue('cyclic-reference', `Cyclic layer reference "${word.spelling}".`, word.span); return []; }
        const found = parserLookup(name);
        if (found === undefined) { issue('undefined-layer-name', `Cannot add undeclared name "${word.spelling}" to a collision layer.`, word.span); return []; }
        const object = concrete.get(found.name);
        if (object !== undefined) return [object];
        if (found.kind === DeclarationKind.Aggregate) {
          issue('aggregate-in-layer', `Aggregate "${word.spelling}" cannot be added to a single collision layer.`, word.span);
          return [];
        }
        const next = new Set(visiting).add(name);
        return found.values.filter(value => value !== found.name).flatMap(value => expandLayer(value, word, next));
      }
      for (const { value: name, word } of source.definitionNames) {
        if ((name === 'background' && layer.length > 0) || (name !== 'background' && backgroundSeen)) {
          issue('background-layer-alone', 'Background must be in a layer by itself.', word.span);
        }
        if (name === 'background') backgroundSeen = true;
        const members = expandLayer(name, word);
        if (rawLayers.some(prior => members.some(object => prior.includes(object)))) {
          issue('multiple-layers', `Name "${word.spelling}" is included in multiple collision layers.`, word.span, true);
        }
        if (explicit.has(name)) issue('repeated-layer-name', `Name "${word.spelling}" is explicitly repeated in this collision layer.`, word.span, true);
        explicit.add(name);
        layer.push(...members);
      }
      rawLayers.push(layer);
      continue;
    }
    if ('primaryName' in source) {
      const primary = source.definitionNames[0];
      if (primary === undefined) continue;
      const { value: name, word } = primary;
      if (concrete.has(name)) {
        issue('duplicate-object', `Object "${word.spelling}" is defined multiple times.`, word.span);
        if (previousObject !== undefined) registerObjectAliases(source, previousObject);
        continue;
      }
      if (declared(name)) duplicate(word);
      const object = Object.freeze({ name });
      concrete.set(object.name, object);
      objects.push(object);
      objectSources.set(object, source);
      previousObject = object;
      const declaration = { name: object.name, word, source, kind: DeclarationKind.Object, references: [], values: [object.name] };
      concreteDeclarations.set(object.name, declaration);
      registerName(word, name);
      registerObjectAliases(source, object);
      continue;
    }
    if (source.name === null) continue;
    const word = source.name;
    const expression = recoverLegendExpression(source);
    const selfReferences = expression?.selfReferences ?? source.definitionWords.filter((reference, index) =>
      index >= 2 && index % 2 === 0 && reference.value === source.definitionWords[0]?.value);
    for (const reference of selfReferences) issue('self-reference', `Cannot define "${word.spelling}" in terms of itself.`, reference.word.span);
    if (expression === null) continue;
    const name = expression.name.value;
    if (declared(name)) duplicate(word);
    const references = expression.references;
    for (let index = 0; index < references.length; index++) {
      const reference = references[index]!;
      if (!declared(reference.value)) issue('undefined-reference', `Name "${reference.word.spelling}" has not been declared at this point.`, reference.word.span);
      if (references.slice(0, index).some(prior => prior.value === reference.value)) {
        issue('repeated-reference', `Name "${reference.word.spelling}" is repeated in this declaration.`, reference.word.span, true);
      }
    }
    const kind = expression.kind === SourceLegendKind.Synonym ? DeclarationKind.Synonym
      : expression.kind === SourceLegendKind.Property ? DeclarationKind.Property : DeclarationKind.Aggregate;
    function substitute(name: string, visiting = new Set<string>()): string[] {
      if (visiting.has(name)) return [name];
      const found = parserLookup(name);
      if (found === undefined) return [name];
      if (concrete.has(found.name)) return [found.name];
      if (found.kind !== kind) {
        issue('cross-kind-reference', `Cannot define "${word.spelling}" using a ${found.kind === DeclarationKind.Property ? 'property' : 'aggregate'} named "${found.word.spelling}".`, word.span);
        return kind === DeclarationKind.Property ? [] : [found.name];
      }
      const next = new Set(visiting).add(name);
      return found.values.filter(value => value !== found.name).flatMap(value => substitute(value, next));
    }
    // Vanilla expands every operand while parsing. Retain duplicates from
    // flattening here; compiler dictionary expansion has separate recovery rules.
    const values = kind === DeclarationKind.Synonym ? [references[0]!.value]
      : references.flatMap(reference => substitute(reference.value));
    if (kind === DeclarationKind.Property && values.length === 0) continue;
    const entry = { name, word, source, kind, references: source.references, values };
    (kind === DeclarationKind.Synonym ? synonyms : kind === DeclarationKind.Property ? properties : aggregates).push(entry);
    registerName(word, name);
  }

  return { document, objects, objectSources, concrete, concreteDeclarations, synonyms, properties, aggregates,
    diagnostics, authoredNames, firstDeclarationWords, rawLayers };
}

/** Glyph construction, final language namespaces and background choice, in native order. */
export function completeDeclarations(prepared: PreparedDeclarations, report?: SourceIssueReporter): {
  readonly declarations: ResolvedDeclarations; readonly diagnostics: readonly SourceDiagnostic[];
} {
  const { objects, objectSources, concrete, concreteDeclarations, synonyms, properties, aggregates,
    authoredNames, firstDeclarationWords, rawLayers } = prepared;
  const diagnostics = [...prepared.diagnostics];
  function issue(code: string, message: string, span: SourceSpan | null, warning = false): void {
    diagnostics.push({ code, message, span, severity: warning ? SourceDiagnosticSeverity.Warning : SourceDiagnosticSeverity.Error,
      countsAsError: !warning, phase: SourceDiagnosticPhase.Declarations });
  }
  function nativeIssue(code: string, message: string, span: SourceSpan | null): void {
    report?.({ code, message, span, severity: SourceDiagnosticSeverity.Error,
      countsAsError: true, phase: SourceDiagnosticPhase.Declarations });
  }
  // Every authored occurrence assigns again. Keep only each object's final
  // occurrence, retaining empty layer positions and the resulting choice order.
  const occurrences = new Map<GameObject, { layer: number; index: number; order: number }>();
  let occurrenceOrder = 0;
  rawLayers.forEach((layer, layerIndex) => layer.forEach((object, index) => {
    occurrences.set(object, { layer: layerIndex, index, order: occurrenceOrder++ });
  }));
  const collisionLayers = rawLayers.map((layer, layerIndex) => layer.filter((object, index) => {
    const last = occurrences.get(object)!;
    return last.layer === layerIndex && last.index === index;
  }));
  const objectLayers = new Map(objects.filter(object => occurrences.has(object)).map(object => [object, occurrences.get(object)!.layer]));
  const objectChoiceOrder = [...occurrences.keys()].sort((a, b) => occurrences.get(a)!.order - occurrences.get(b)!.order);
  // An unlayered lookup recovers the first raw assignment. When a later
  // occurrence replaced that assignment, it remains writable as one distinct
  // identity. Other overwritten occurrences cannot be reached by source lookup.
  const firstAssignment = rawLayers.find(layer => layer.length > 0)?.[0];
  const orphanedObject: GameObject | null = firstAssignment !== undefined
    && occurrences.get(firstAssignment)!.order !== 0 && objects.some(object => !objectLayers.has(object))
    ? Object.freeze({ name: firstAssignment.name, orphanedFrom: firstAssignment }) : null;
  if (orphanedObject !== null) objectChoiceOrder.unshift(orphanedObject);
  const unlayeredLookup = orphanedObject ?? firstAssignment;
  function lookupObject(object: GameObject): GameObject | undefined {
    return objectLayers.has(object) ? object : unlayeredLookup;
  }
  for (const object of objects) if (!objectLayers.has(object)) {
    issue('unlayered-object', `Object "${objectSources.get(object)!.primaryName.spelling}" has not been assigned to a collision layer.`, objectSources.get(object)!.primaryName.span);
  }

  const availableGlyphs = new Map<string, ReadonlySet<GameObject>>();
  const glyphOrder: { readonly name: string; readonly line: number }[] = [];
  function addGlyph(entry: Declaration, members: ReadonlySet<GameObject>): void {
    availableGlyphs.set(entry.name, members);
    glyphOrder.push({ name: entry.name, line: entry.word.span.start.line });
  }
  for (const object of objects) {
    addGlyph(concreteDeclarations.get(object.name)!, new Set(objectLayers.has(object) ? [object] : []));
  }
  let glyphAdded = true;
  while (glyphAdded) {
    glyphAdded = false;
    for (const entry of synonyms) {
      const target = availableGlyphs.get(entry.values[0]!);
      if (!availableGlyphs.has(entry.name) && target !== undefined) {
        addGlyph(entry, target);
        glyphAdded = true;
      }
    }
    for (const entry of aggregates) {
      if (availableGlyphs.has(entry.name) || !entry.values.every(value => availableGlyphs.has(value))) continue;
      const byLayer = new Map<number, GameObject>();
      for (const value of entry.values) {
        const object = concrete.get(value);
        if (object === undefined) continue;
        const layer = objectLayers.get(object);
        if (layer === undefined) {
          nativeIssue('aggregate-unlayered-object', `Object "${object.name.toUpperCase()}" has been defined, but not assigned to a layer.`, entry.word.span);
          continue;
        }
        if (byLayer.has(layer)) {
          nativeIssue('aggregate-layer-conflict', `Trying to create an aggregate object (something defined in the LEGEND section using AND) with both "${object.name.toUpperCase()}" and "${byLayer.get(layer)!.name.toUpperCase()}", which are on the same layer and therefore can't coexist.`, entry.word.span);
          issue('aggregate-layer-conflict', `Aggregate "${entry.word.spelling}" contains both "${byLayer.get(layer)!.name}" and "${object.name}" on the same collision layer.`, entry.word.span);
        } else byLayer.set(layer, object);
      }
      addGlyph(entry, new Set([...byLayer].sort((a, b) => a[0] - b[0]).map(([, object]) => object)));
      glyphAdded = true;
    }
  }
  glyphOrder.sort((a, b) => a.line - b.line);
  const glyphs = new Map(glyphOrder.map(entry => [entry.name, availableGlyphs.get(entry.name)!]));

  // Parser lookup is intentionally separate from these final compiler dictionaries.
  // The compiler keeps the last property/synonym declaration, whereas parsing
  // and glyph construction can have already used an earlier synonym.
  const propertyValues = new Map(properties.map(entry => [entry.name, [...entry.values]]));
  const aggregateValues = new Map(aggregates.map(entry => [entry.name, [...entry.values]]));
  const synonymValues = new Map<string, string>();
  const propertySources = new Map(properties.map(entry => [entry.name, entry]));
  const aggregateSources = new Map(aggregates.map(entry => [entry.name, entry]));
  const synonymSources = new Map<string, Declaration>();
  for (const entry of synonyms) {
    const target = entry.values[0]!;
    if (aggregateValues.has(target)) {
      aggregateValues.set(entry.name, aggregateValues.get(target)!);
      aggregateSources.set(entry.name, entry);
    } else if (propertyValues.has(target)) {
      propertyValues.set(entry.name, propertyValues.get(target)!);
      propertySources.set(entry.name, entry);
    } else if (entry.name !== target) {
      synonymValues.set(entry.name, target);
      synonymSources.set(entry.name, entry);
    }
  }
  function problem(name: string, visiting = new Set<string>(), expected?: DeclarationKind): ResolutionProblem | null {
    if (visiting.has(name)) return { code: 'cyclic-reference', message: `Cyclic reference involving "${name}".` };
    // A final synonym can collide with a concrete name. Expansion still follows
    // that synonym, so concrete-name preference must not conceal alias cycles.
    if (concrete.has(name) && !synonymValues.has(name)) return null;
    const kind = aggregateValues.has(name) ? DeclarationKind.Aggregate : propertyValues.has(name) ? DeclarationKind.Property : DeclarationKind.Synonym;
    if (expected !== undefined && kind !== DeclarationKind.Synonym && kind !== expected) {
      return { code: 'cross-kind-reference', message: `Cross-kind reference to "${name}".` };
    }
    const values = kind === DeclarationKind.Aggregate ? aggregateValues.get(name) : kind === DeclarationKind.Property ? propertyValues.get(name)
      : synonymValues.has(name) ? [synonymValues.get(name)!] : undefined;
    if (values === undefined) return { code: 'undefined-reference', message: `Missing declaration "${name}".` };
    if (values.length === 0) return { code: 'unresolved-name', message: `No concrete members could be resolved for "${name}".` };
    const next = new Set(visiting).add(name);
    for (const value of values) {
      const error = problem(value, next, kind === DeclarationKind.Synonym ? expected : kind);
      if (error !== null) return error;
    }
    return null;
  }
  interface NormalizationEntry { readonly name: string; readonly values: readonly string[] }
  type NormalizationState = readonly (readonly NormalizationEntry[])[];
  function captureNormalization(): NormalizationState {
    return [dictionaryIterationNames(synonymValues).map(name => ({ name, values: [synonymValues.get(name)!] })),
      ...[propertyValues, aggregateValues].map(dictionary => dictionaryIterationNames(dictionary).map(name => ({ name, values: [...dictionary.get(name)!] })))];
  }
  function sameNormalization(a: NormalizationState, b: NormalizationState): boolean {
    return a.every((dictionary, index) => dictionary.length === b[index]!.length && dictionary.every((entry, entryIndex) => {
      const other = b[index]![entryIndex]!;
      return entry.name === other.name && entry.values.length === other.values.length && entry.values.every((value, valueIndex) => value === other.values[valueIndex]);
    }));
  }
  const previousNormalizations: NormalizationState[] = [];
  let modified = true;
  while (modified) {
    // Native self-removal can make graph cycles terminate. Perform its ordinary
    // transformations first; repeated semantic state identifies a real loop.
    const before = captureNormalization();
    if (previousNormalizations.some(previous => sameNormalization(previous, before))) break;
    previousNormalizations.push(before);
    modified = false;
    for (const name of dictionaryIterationNames(synonymValues)) {
      const target = synonymValues.get(name)!;
      if (propertyValues.has(target)) {
        propertyValues.set(name, propertyValues.get(target)!);
        propertySources.set(name, synonymSources.get(name)!);
        synonymValues.delete(name);
        modified = true;
      } else if (aggregateValues.has(target)) {
        aggregateValues.set(name, aggregateValues.get(target)!);
        aggregateSources.set(name, synonymSources.get(name)!);
        synonymValues.delete(name);
        modified = true;
      } else if (synonymValues.has(target)) {
        // This substitution alone does not request another native outer pass.
        synonymValues.set(name, synonymValues.get(target)!);
      }
    }
    for (const dictionary of [propertyValues, aggregateValues]) {
      for (const name of dictionaryIterationNames(dictionary)) {
        const values = dictionary.get(name)!;
        for (let index = 0; index < values.length; index++) {
          const value = values[index]!;
          if (synonymValues.has(value)) { values[index] = synonymValues.get(value)!; modified = true; }
          else if (dictionary.has(value)) {
            values.splice(index, 1);
            for (const member of dictionary.get(value)!) if (!values.includes(member)) values.push(member);
            modified = true;
          }
          const conflicting = dictionary === propertyValues ? aggregateValues : propertyValues;
          if (conflicting.has(value)) nativeIssue('cross-kind-legend',
            `Trying to define ${dictionary === propertyValues ? 'property' : 'aggregate'} "${name.toUpperCase()}" in terms of ${dictionary === propertyValues ? 'aggregate' : 'property'} "${value.toUpperCase()}".`, null);
        }
      }
    }
  }
  const ruleProperties = new Map(dictionaryIterationNames(propertyValues).map(name => [name, [...propertyValues.get(name)!]]));
  const singleLayerProperties = new Map<string, number | undefined>();
  for (const [name, members] of ruleProperties) {
    if (members.length === 0) continue;
    const first = concrete.get(members[0]!);
    if (first === undefined) continue;
    const layer = objectLayers.get(first);
    if (members.every(member => {
      const object = concrete.get(member);
      return object !== undefined && objectLayers.get(object) === layer;
    })) singleLayerProperties.set(name, layer);
  }
  const ruleNames: RuleVocabulary = {
    synonyms: new Map(dictionaryIterationNames(synonymValues).map(name => [name, synonymValues.get(name)!])),
    properties: ruleProperties,
    aggregates: new Map(dictionaryIterationNames(aggregateValues).map(name => [name, [...aggregateValues.get(name)!]])),
    singleLayerProperties,
  };
  const names = new Map<string, ResolvedName>();
  for (const name of authoredNames) {
    const entry = concreteDeclarations.get(name) ?? aggregateSources.get(name) ?? propertySources.get(name) ?? synonymSources.get(name)!;
    const base = { name, word: entry.word, source: entry.source };
    const object = concrete.get(name);
    let error = problem(name);
    const synonymObject = concrete.get(synonymValues.get(name) ?? '');
    if (object === undefined && !aggregateValues.has(name) && !propertyValues.has(name) && synonymObject === undefined && error === null) {
      error = { code: 'unresolved-name', message: `Synonym "${name}" still refers to "${synonymValues.get(name)}" rather than a concrete object after declaration normalization.` };
    }
    if (object !== undefined) names.set(name, { ...base, kind: ResolvedNameKind.Object, object });
    else if (error !== null) {
      names.set(name, { ...base, kind: ResolvedNameKind.Unresolved, references: entry.references, reason: error.message });
      if (error.code !== 'undefined-reference') issue(error.code, error.message, entry.word.span);
    } else if (aggregateValues.has(name) || propertyValues.has(name)) {
      const aggregate = aggregateValues.has(name);
      names.set(name, { ...base, kind: aggregate ? ResolvedNameKind.Aggregate : ResolvedNameKind.Property,
        members: (aggregateValues.get(name) ?? propertyValues.get(name)!).map(value => concrete.get(value)!) });
    } else {
      names.set(name, { ...base, kind: ResolvedNameKind.Object, object: synonymObject! });
    }
  }
  const playerName = names.get('player');
  const player = { kind: aggregateValues.has('player') ? PlayerMatchKind.All : PlayerMatchKind.Any,
    objects: new Set<GameObject>() };
  function addPlayer(name: string): void {
    const object = concrete.get(name);
    const recovered = object === undefined ? undefined : lookupObject(object);
    if (recovered !== undefined) player.objects.add(recovered);
  }
  // Native player lookup unions all overlapping namespaces. Its aggregate flag
  // likewise survives a same-named concrete object or property declaration.
  addPlayer('player');
  for (const name of aggregateValues.get('player') ?? []) addPlayer(name);
  for (const name of propertyValues.get('player') ?? []) addPlayer(name);
  const playerSynonym = synonymValues.get('player');
  if (playerSynonym !== undefined) addPlayer(playerSynonym);
  if (playerName === undefined || playerName.kind === ResolvedNameKind.Unresolved) {
    issue(playerName === undefined ? 'missing-player' : 'unresolved-player', 'A usable player declaration is required.', playerName?.word.span ?? null);
  }

  if (rawLayers.length > 0 && !rawLayers.some(layer => layer.length > 0)) nativeIssue('missing-assigned-objects', 'You need to have some objects defined', null);

  function selectBackground(): GameObject | undefined {
    // Background uses a different precedence from both player and preferred names.
    const object = concrete.get('background');
    if (object !== undefined) return object;
    const target = synonymValues.get('background');
    if (target !== undefined) {
      const selected = concrete.get(target);
      if (selected === undefined) issue('unresolved-background', 'The background synonym could not be resolved.', synonymSources.get('background')!.word.span);
      return selected;
    }
    const members = propertyValues.get('background');
    if (members !== undefined) {
      const first = members[0];
      const selected = first === undefined ? undefined : concrete.get(first);
      const layer = selected === undefined ? undefined : objectLayers.get(selected);
      const span = propertySources.get('background')!.word.span;
      for (const member of members.slice(1)) if (selected !== undefined && concrete.has(member) && objectLayers.get(concrete.get(member)!) !== layer) {
        nativeIssue('background-multiple-layers', 'Background objects must be on the same layer', span);
        issue('background-multiple-layers', 'Background objects must be on the same collision layer.', span);
      }
      if (selected === undefined) issue('unresolved-background', 'The background property has no usable default member.', span);
      return selected;
    }
    const aggregate = aggregateValues.has('background');
    nativeIssue(aggregate ? 'aggregate-background' : 'missing-background', aggregate
      ? "background cannot be an aggregate (declared with 'and'), it has to be a simple type, or property (declared in terms of others using 'or')."
      : 'Seriously, you have to define something to be the background.', aggregateSources.get('background')?.word.span ?? null);
    issue(aggregate ? 'aggregate-background' : 'missing-background',
      aggregate ? 'Background cannot be an aggregate.' : 'A background declaration is required.', aggregateSources.get('background')?.word.span ?? null);
    // Native fallback starts at the first raw assignment, even if that object
    // later receives another assignment and moves in the effective choice order.
    return rawLayers.find(layer => layer.length > 0)?.[0];
  }
  const backgroundObject = selectBackground();
  const backgroundLayer = backgroundObject === undefined ? undefined : objectLayers.get(backgroundObject);
  const background = backgroundObject !== undefined && backgroundLayer !== undefined
    ? { object: backgroundObject, layer: backgroundLayer } : null;
  const namedObjects = new Map<string, ReadonlySet<GameObject>>();
  const rawObjectLookups = new Map<GameObject, ReadonlySet<GameObject>>();
  for (const object of objects) {
    const recovered = lookupObject(object);
    const members = new Set(recovered === undefined ? [] : [recovered]);
    namedObjects.set(object.name, members);
    rawObjectLookups.set(object, members);
  }
  const lookupEntries = [...synonyms, ...properties].sort((a, b) => a.word.span.start.line - b.word.span.start.line);
  for (const entry of lookupEntries) {
    if (entry.values.length === 1) {
      const target = namedObjects.get(entry.values[0]!);
      if (target !== undefined) {
        namedObjects.set(entry.name, target);
      }
    } else {
      namedObjects.set(entry.name, new Set(entry.values.flatMap(name => [...namedObjects.get(name) ?? []])));
    }
  }
  const namedAggregates = new Map<string, ReadonlySet<GameObject>>();
  for (const name of dictionaryIterationNames(aggregateValues)) {
    const values = aggregateValues.get(name)!;
    namedAggregates.set(name, new Set(values.flatMap(value => [...namedObjects.get(value) ?? []])));
  }
  const soundTargets = new Map<string, readonly GameObject[]>();
  for (const name of namedObjects.keys()) {
    const targets = [{ name, ancestors: new Set<string>() }];
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (let index = 0; index < targets.length; index++) {
        const target = targets[index]!;
        const synonym = synonymValues.get(target.name);
        const property = propertyValues.get(target.name);
        if (synonym === undefined && property === undefined) continue;
        // Malformed cyclic declarations must still yield a useful finite result.
        if (target.ancestors.has(target.name)) { targets.splice(index--, 1); continue; }
        const ancestors = new Set(target.ancestors).add(target.name);
        if (synonym !== undefined) targets[index] = { name: synonym, ancestors };
        else {
          targets.splice(index--, 1);
          targets.push(...property!.map(member => ({ name: member, ancestors })));
        }
        expanded = true;
      }
    }
    soundTargets.set(name, targets.flatMap(target => {
      const object = concrete.get(target.name);
      return object === undefined ? [] : [object];
    }));
  }
  return { declarations: { objects, objectSources, names, ruleNames, objectChoiceOrder, collisionLayers,
    objectLayers, glyphs, player, background, firstDeclarationWords, namedObjects, rawObjectLookups,
    namedAggregates, orphanedObject, soundTargets }, diagnostics };
}

/** Convenience declaration advice and semantics use the same canonical construction. */
export function resolveDeclarations(document: SourceDocument): {
  readonly declarations: ResolvedDeclarations; readonly diagnostics: readonly SourceDiagnostic[];
} {
  return completeDeclarations(prepareDeclarations(document));
}

export function reportUnlayeredObjects(declarations: ResolvedDeclarations, report: SourceIssueReporter): void {
  const byName = new Map(declarations.objects.map(object => [object.name, object]));
  for (const name of dictionaryIterationNames(byName)) {
    const object = byName.get(name)!;
    if (declarations.objectLayers.has(object)) continue;
    report({ code: 'unlayered-object', message: `Object "${name.toUpperCase()}" has been defined, but not assigned to a layer.`,
      span: declarations.objectSources.get(object)!.primaryName.span, severity: SourceDiagnosticSeverity.Error,
      countsAsError: true, phase: SourceDiagnosticPhase.Declarations });
  }
}
