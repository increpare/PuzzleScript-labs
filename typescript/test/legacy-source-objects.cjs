'use strict';

const assert = require('node:assert/strict');
const orphanLabel = name => name + ' (orphaned)';

// Read only native parser assignments and their final native definitions. Source
// lookups can write the first overwritten assignment through an unlayered name.
// Other obsolete assignments and storage padding are unreachable from source
// lookup and deliberately remain outside this bounded source-domain projection.
function nativeSourceObjects(parsed) {
  const assigned = Object.keys(parsed.objects).filter(name => typeof parsed.objects[name].id === 'number')
    .sort((a, b) => parsed.objects[a].id - parsed.objects[b].id);
  const raw = parsed.collisionLayers.flat().filter(name => Object.hasOwn(parsed.objects, name));
  const first = raw[0];
  const orphanedName = first !== undefined && parsed.objects[first].id !== 0
    && Object.values(parsed.objects).some(object => object.id === undefined) ? first : null;
  if (first !== undefined) assert.equal(parsed.idDict[0], first, 'first native assignment evidence');
  const entries = assigned.map(name => ({ name, id: parsed.objects[name].id, label: name }));
  if (orphanedName !== null) entries.unshift({ name: orphanedName, id: 0, label: orphanLabel(orphanedName) });
  const members = mask => entries.filter(entry => mask.get(entry.id)).map(entry => entry.label);
  return { assigned, entries, members, orphanedName };
}

function candidateObjectLabels(declarations, fixtureName) {
  const authored = new Set(declarations.objects);
  for (const object of authored) {
    assert.deepEqual(Object.keys(object), ['name'], fixtureName + ': ordinary source object shape');
    assert.ok(Object.isFrozen(object), fixtureName + ': immutable source object');
  }
  assert.notEqual(declarations.orphanedObject, undefined, 'explicit nullable orphan identity');
  const orphan = declarations.orphanedObject;
  if (orphan !== null) {
    assert.deepEqual(Object.keys(orphan), ['name', 'orphanedFrom'], fixtureName + ': bounded orphan shape');
    assert.ok(Object.isFrozen(orphan), fixtureName + ': immutable orphan');
    assert.ok(!authored.has(orphan), fixtureName + ': orphan is distinct from authored declarations');
    assert.ok(authored.has(orphan.orphanedFrom), fixtureName + ': orphan links to canonical authored declaration');
    assert.equal(orphan.name, orphan.orphanedFrom.name, fixtureName + ': orphan keeps source name');
    assert.equal(orphan.orphanedFrom.orphanedFrom, undefined, fixtureName + ': no orphan chains');
    assert.equal(declarations.objectSources.has(orphan), false, fixtureName + ': no invented source declaration');
    assert.equal(declarations.objectLayers.has(orphan), false, fixtureName + ': no actual orphan layer');
    assert.ok(declarations.collisionLayers.every(layer => !layer.includes(orphan)), fixtureName + ': no orphan collision membership');
    assert.equal(declarations.objectChoiceOrder[0], orphan, fixtureName + ': first random candidate');
  }
  return object => {
    assert.ok(authored.has(object) || object === orphan, fixtureName + ': canonical identity; canonical object identity required');
    return object === orphan ? orphanLabel(object.name) : object.name;
  };
}

// Gameplay adapters retain their native address-indexed test representation.
// Attach the explicit source link to its one reachable overwritten identity;
// no numeric address or native object enters the candidate GameObject values.
function decodeNativeObjects(legacy) {
  const { orphanedName } = nativeSourceObjects(legacy);
  const objects = legacy.idDict.map(name => Object.freeze({ name }));
  if (orphanedName !== null) objects[0] = Object.freeze({ name: orphanedName,
    orphanedFrom: objects[legacy.objects[orphanedName].id] });
  return objects;
}

module.exports = { nativeSourceObjects, candidateObjectLabels, decodeNativeObjects, orphanLabel };
