'use strict';

const assert = require('node:assert/strict');
const { loadPuzzleScript } = require('./native-host.cjs');
const { nativeSourceObjects, candidateObjectLabels, orphanLabel } = require('./legacy-source-objects.cjs');

// Native dictionaries/masks are read only in this test adapter. The candidate
// receives the original source and resolves ordinary canonical object values.
// Reuse is only for a suite whose earlier oracle already loaded and verified
// this same pinned host with tests; candidate producer guards still run below.
function createDeclarationOracle(types, { nativeAlreadyLoaded = false } = {}) {
  if (!nativeAlreadyLoaded) loadPuzzleScript({ includeTests: true });
  const { ResolvedNameKind, PlayerMatchKind } = types;

  function nativeDeclarations(source) {
    resetParserErrorState();
    const processor = new codeMirrorFn();
    const parsed = processor.startState();
    for (const line of source.split('\n')) {
      const stream = new CodeMirror.StringStream(line, 4);
      do { processor.token(stream, parsed); } while (!stream.eol());
    }
    generateExtraMembers(parsed);
    generateMasks(parsed);
    return nativeView(parsed);
  }

  function nativeView(parsed) {
    const objects = Object.keys(parsed.objects).sort((a, b) => parsed.objects[a].lineNumber - parsed.objects[b].lineNumber);
    const projection = nativeSourceObjects(parsed);
    const choice = projection.entries.map(entry => entry.label);
    const meanings = new Map(objects.map(name => [name, { kind: 'object', object: name }]));
    for (const [name, target] of Object.entries(parsed.synonymsDict)) {
      if (!meanings.has(name)) meanings.set(name, parsed.objects[target] === undefined
        ? { kind: 'unresolved' } : { kind: 'object', object: target });
    }
    for (const [dictionary, kind] of [[parsed.propertiesDict, 'property'], [parsed.aggregatesDict, 'aggregate']]) {
      for (const [name, members] of Object.entries(dictionary)) {
        if (!Object.hasOwn(parsed.objects, name)) meanings.set(name, members.length === 0 || members.some(member => !Object.hasOwn(parsed.objects, member))
          ? { kind: 'unresolved' } : { kind, members });
      }
    }
    // Native output retains declaration lines for concrete objects and original
    // legend entries, but does not expose which assignment supplied a compiled
    // dictionary key. Check unambiguous names here; conflicting namespaces get
    // explicit, independently established source-line expectations in fixtures.
    const sourceLines = new Map();
    for (const [name] of meanings) {
      if (Object.hasOwn(parsed.objects, name)) sourceLines.set(name, parsed.objects[name].lineNumber);
      else {
        const candidates = [...parsed.legend_synonyms, ...parsed.legend_properties, ...parsed.legend_aggregates]
          .filter(entry => entry[0] === name);
        if (candidates.length === 1) sourceLines.set(name, candidates[0].lineNumber);
      }
    }
    const namesFromMask = projection.members;
    const lookupView = mask => namesFromMask(mask).sort();
    const view = {
      objects: objects.map(name => ({ name, line: parsed.objects[name].lineNumber })),
      names: [...meanings].sort(([a], [b]) => a.localeCompare(b)),
      ruleNames: {
        synonyms: Object.entries(parsed.synonymsDict),
        properties: Object.entries(parsed.propertiesDict),
        aggregates: Object.entries(parsed.aggregatesDict),
        singleLayerProperties: Object.entries(parsed.propertiesSingleLayer),
      },
      choice,
      orphanedObject: projection.orphanedName === null ? null : orphanLabel(projection.orphanedName),
      layers: parsed.collisionLayers.map((_layer, index) => projection.assigned.filter(name => parsed.objects[name].layer === index)),
      objectLayers: projection.assigned.map(name => [name, parsed.objects[name].layer]),
      rawObjectLookups: objects.map(name => {
        // Raw concrete requirements bypass later same-name namespace overrides.
        const mask = new BitVec(parsed.STRIDE_OBJ);
        mask.ibitset(parsed.objects[name].id);
        return [name, lookupView(mask)];
      }),
      namedObjects: Object.keys(parsed.objectMasks).filter(name => name !== '\nall\n').sort()
        .map(name => [name, lookupView(parsed.objectMasks[name])]),
      glyphs: parsed.glyphOrder.map(name => [name,
        parsed.glyphDict[name].filter(id => id >= 0).map(id => parsed.idDict[id]).sort()]),
      player: { kind: parsed.playerMask[0] ? 'all' : 'any',
        members: namesFromMask(parsed.playerMask[1]).sort() },
      background: parsed.backgroundid === undefined || parsed.backgroundlayer === undefined ? null
        : { object: parsed.idDict[parsed.backgroundid], layer: parsed.backgroundlayer },
    };
    return { view, sourceLines };
  }

  function freezeSource(value) {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
    for (const child of Object.values(value)) freezeSource(child);
    Object.freeze(value);
  }

  function candidateView(fixture, document, declarations) {
    assert.deepEqual(Object.keys(declarations.ruleNames).sort(), ['aggregates', 'properties', 'singleLayerProperties', 'synonyms'], 'plain rule vocabulary fields');
    const canonical = new Set(declarations.objects);
    const nameOf = candidateObjectLabels(declarations, fixture.name);
    assert.equal(canonical.size, declarations.objects.length, fixture.name + ': unique canonical declarations');
    assert.equal(declarations.objectSources.size, canonical.size, fixture.name + ': declaration source count');
    const objects = declarations.objects.map(object => {
      const source = declarations.objectSources.get(object);
      assert.ok(document.objects.includes(source), fixture.name + ': canonical object must retain authored source identity');
      assert.equal(source.definitionNames[0]?.value, object.name, fixture.name + ': canonical object source name');
      return { name: nameOf(object), line: source.primaryName.span.start.line };
    });
    const names = [...declarations.names].map(([name, meaning]) => {
      assert.equal(meaning.name, name, fixture.name + ': resolved name key');
      assert.equal(meaning.word.normalized, meaning.word.spelling.toLowerCase(), fixture.name + ': normalized source word');
      assert.equal(document.source.slice(meaning.word.span.start.offset, meaning.word.span.end.offset),
        meaning.word.spelling, fixture.name + ': authored source word');
      assert.ok(document.objects.includes(meaning.source) || document.legend.includes(meaning.source),
        fixture.name + ': resolved name must retain authored declaration identity');
      const tokens = 'primaryName' in meaning.source ? meaning.source.definitionNames : meaning.source.definitionWords.slice(0, 1);
      assert.ok(tokens.some(token => token.value === name && token.word === meaning.word),
        fixture.name + ': name provenance must retain its lexical value and authored word identity');
      switch (meaning.kind) {
        case ResolvedNameKind.Object:
          assert.deepEqual(Object.keys(meaning).sort(), ['kind', 'name', 'object', 'source', 'word'], 'plain resolved name fields');
          return [name, { kind: 'object', object: nameOf(meaning.object) }];
        case ResolvedNameKind.Property:
          assert.deepEqual(Object.keys(meaning).sort(), ['kind', 'members', 'name', 'source', 'word'], 'plain resolved name fields');
          return [name, { kind: 'property', members: meaning.members.map(nameOf) }];
        case ResolvedNameKind.Aggregate:
          assert.deepEqual(Object.keys(meaning).sort(), ['kind', 'members', 'name', 'source', 'word'], 'plain resolved name fields');
          return [name, { kind: 'aggregate', members: meaning.members.map(nameOf) }];
        case ResolvedNameKind.Unresolved:
          assert.deepEqual(Object.keys(meaning).sort(), ['kind', 'name', 'reason', 'references', 'source', 'word'], 'plain resolved name fields');
          return [name, { kind: 'unresolved' }];
        default: assert.fail(fixture.name + ': unknown resolved name kind');
      }
    }).sort(([a], [b]) => a.localeCompare(b));
    assert.ok(declarations.player.kind === PlayerMatchKind.Any || declarations.player.kind === PlayerMatchKind.All
      || declarations.player.kind === PlayerMatchKind.Never,
      fixture.name + ': player match kind');
    const choice = declarations.objectChoiceOrder.map(nameOf);
    assert.notEqual(declarations.rawObjectLookups, undefined, 'meaningful raw object lookups must exist');
    const lookupView = lookup => [...lookup].map(nameOf).sort();
    assert.deepEqual([...declarations.rawObjectLookups.keys()], declarations.objects, 'one raw lookup per canonical object');
    return {
      objects, names, choice, orphanedObject: declarations.orphanedObject === null ? null : nameOf(declarations.orphanedObject),
      ruleNames: {
        synonyms: [...declarations.ruleNames.synonyms],
        properties: [...declarations.ruleNames.properties],
        aggregates: [...declarations.ruleNames.aggregates],
        singleLayerProperties: [...declarations.ruleNames.singleLayerProperties],
      },
      layers: declarations.collisionLayers.map(layer => layer.map(nameOf)),
      objectLayers: [...declarations.objectLayers].map(([object, layer]) => [nameOf(object), layer])
        .sort(([a], [b]) => choice.indexOf(a) - choice.indexOf(b)),
      rawObjectLookups: [...declarations.rawObjectLookups].map(([object, lookup]) => [nameOf(object), lookupView(lookup)]),
      namedObjects: [...declarations.namedObjects].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([name, lookup]) => [name, lookupView(lookup)]),
      glyphs: [...declarations.glyphs].map(([name, members]) => [name, [...members].map(nameOf).sort()]),
      player: { kind: declarations.player.kind === PlayerMatchKind.Never ? 'never'
        : declarations.player.kind === PlayerMatchKind.All ? 'all' : 'any',
        members: [...declarations.player.objects].map(nameOf).sort() },
      background: declarations.background === null ? null
        : { object: nameOf(declarations.background.object), layer: declarations.background.layer },
    };
  }

  function compareFixture(fixture, options = {}) {
    const native = nativeDeclarations(fixture.source);
    const expected = native.view;
    const producers = ['compile', 'loadFile', 'generateExtraMembers', 'generateMasks', 'lookupLegendName'];
    const originals = new Map(producers.map(name => [name, globalThis[name]]));
    const originalParser = codeMirrorFn;
    let document;
    let result;
    try {
      for (const name of producers) globalThis[name] = () => { throw new Error('TS declarations called JS producer ' + name); };
      codeMirrorFn = function() { throw new Error('TS declarations called JS producer codeMirrorFn'); };
      ({ document } = (options.readSource ?? types.readSource)(fixture.source));
      freezeSource(document);
      result = (options.resolveDeclarations ?? types.resolveDeclarations)(document);
    } finally {
      codeMirrorFn = originalParser;
      for (const [name, original] of originals) globalThis[name] = original;
    }
    const actual = candidateView(fixture, document, result.declarations);
    const sourceLines = new Map([...native.sourceLines, ...(fixture.nameSourceLines ?? [])]);
    for (const [name, line] of sourceLines) {
      const meaning = result.declarations.names.get(name);
      assert.equal(meaning?.word.span.start.line, line, fixture.name + ': name provenance for ' + name);
    }
    assert.deepEqual(actual, expected,
      fixture.name + ': resolved declaration data');
    return { objects: result.declarations.objects.length, names: result.declarations.names.size,
      layers: result.declarations.collisionLayers.length, glyphs: result.declarations.glyphs.size,
      checkedNameSources: sourceLines.size, unverifiedNameSources: expected.names.length - sourceLines.size };
  }
  const corpusFixtures = () => testdata.map(([name, data]) => ({ name, source: data[0] }));
  return { compareFixture, corpusFixtures, nativeView, candidateView };
}

module.exports = { createDeclarationOracle };
