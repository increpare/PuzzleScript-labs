import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

/** Complete source games described using names and ordinary cell occupants. */
export function renderProgram(program) {
  assert.equal(program.version, 1, 'Unsupported program version');
  assert.ok(typeof program.seed === 'string' && program.seed.length > 0, 'Use an explicit execution seed');
  const inputs = new Set([0, 1, 2, 3, 4, 'tick', 'undo', 'restart']);
  assert.ok(Array.isArray(program.inputs) && program.inputs.every(input => inputs.has(input)), 'Unsupported generated input tape');
  assert.equal(typeof program.name, 'string');
  assert.ok(!program.name.includes('\n'), 'A title must occupy one line');
  const names = new Set(program.objects.map(object => object.name));
  assert.equal(names.size, program.objects.length, 'Object names must be unique');
  assert.ok(names.has('Background') && names.has('Player'), 'Keep Background and Player declarations');
  const layerOf = new Map();
  for (const [index, layer] of program.layers.entries()) for (const name of layer) {
    assert.ok(names.has(name), 'Undefined object in layer: ' + name);
    assert.ok(!layerOf.has(name), 'Objects must occur in exactly one layer: ' + name);
    layerOf.set(name, index);
  }
  assert.equal(layerOf.size, names.size, 'Every object must occur in one layer');
  const width = program.board[0]?.length;
  assert.ok(width > 0 && program.board.every(row => row.length === width), 'The board must be a nonempty rectangle');
  const glyphs = new Map(), legend = ['. = Background'];
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const rows = program.board.map(row => row.map(cell => {
    const occupiedLayers = new Set();
    assert.equal(new Set(cell).size, cell.length, 'Do not repeat cell occupants');
    assert.ok(cell.includes('Background'), 'Every cell includes Background');
    for (const name of cell) {
      assert.ok(names.has(name), 'Undefined object in cell: ' + name);
      assert.ok(!occupiedLayers.has(layerOf.get(name)), 'One occupant per layer in generated initial cells');
      occupiedLayers.add(layerOf.get(name));
    }
    if (cell.length === 1) return '.';
    const occupants = [...cell].sort(), key = occupants.join(' ');
    if (!glyphs.has(key)) {
      const glyph = alphabet[glyphs.size];
      assert.ok(glyph, 'Too many distinct cells for the tiny-game alphabet');
      glyphs.set(key, glyph);
      legend.push(glyph + ' = ' + occupants.join(' and '));
    }
    return glyphs.get(key);
  }).join(''));
  for (const property of program.properties) {
    assert.ok(property.objects.length > 0, 'Properties need members');
    for (const name of property.objects) assert.ok(names.has(name), 'Undefined object in property: ' + name);
    legend.push(property.name + ' = ' + property.objects.join(' or '));
  }
  return [
    'title ' + program.name, '', 'objects', '',
    ...program.objects.flatMap(object => [object.name, object.color, '']),
    'legend', ...legend, '', 'sounds',
    ...(program.sounds ?? []).map(sound => sound.event + ' ' + sound.seed), '',
    'collisionlayers', ...program.layers.filter(layer => layer.length > 0).map(layer => layer.join(', ')), '',
    'rules', ...program.rules, '', 'winconditions', '', 'levels', ...rows, '',
  ].join('\n');
}

/** Count actual source variety without counting changed titles, tapes or seeds. */
export function sourceIdentity(program) {
  const source = renderProgram({ ...program, name: 'Generated case' });
  return createHash('sha256').update(source).digest('hex');
}
