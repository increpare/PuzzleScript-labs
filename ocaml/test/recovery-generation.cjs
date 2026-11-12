'use strict';
// Complete source programs combine declaration recovery with distinct rule,
// layer, sound and glyph consumers. No compiler IR or engine output is reused.
const crypto = require('node:crypto');
const families = ['forward-alias', 'forward-property', 'alias-redefinition', 'property-redefinition',
  'cross-kind-name', 'rejected-cycle', 'late-publication', 'player-redefinition'];
exports.families = families;
exports.construct = (campaignSeed, index) => {
  let word = 2166136261;
  for (const ch of campaignSeed + ':' + index) word = Math.imul(word ^ ch.charCodeAt(0), 16777619) >>> 0;
  const draw = n => { word ^= word << 13; word ^= word >>> 17; word ^= word << 5; return (word >>> 0) % n; };
  const family = families[index % families.length];
  const direction = ['right', 'down', 'left', 'up'][Math.floor(index / families.length) % 4];
  const variant = Math.floor(index / (families.length * 4)) % 16;
  const name = ['Choice', 'Hue', 'ΟΣ', 'Straße', 'Метка', '猫', '20', '_mark'][variant % 8];
  const link = name + 'Link', last = name + 'Last';
  let declarations;
  switch (family) {
    case 'forward-alias': declarations = variant & 8
      ? [last + ' = Crate', link + ' = ' + last, name + ' = ' + link]
      : [name + ' = ' + link, link + ' = ' + last, last + ' = Crate']; break;
    case 'forward-property': declarations = variant & 8
      ? [link + ' = Crate', name + ' = ' + link + ' or Wall']
      : [name + ' = ' + link + ' or Wall', link + ' = Crate']; break;
    case 'alias-redefinition': declarations = [name + ' = ' + (variant & 8 ? 'Wall' : 'Crate'), name + ' = Crate']; break;
    case 'property-redefinition': declarations = [name + ' = Crate or Wall', name + ' = ' + (variant & 8 ? 'Wall or Player' : 'Wall or Crate')]; break;
    case 'cross-kind-name': declarations = variant & 8
      ? [name + ' = Crate and Marker', name + ' = Crate or Wall']
      : [name + ' = Crate or Wall', name + ' = Crate']; break;
    case 'rejected-cycle': declarations = [name + ' = ' + link, link + ' = ' + name]; break;
    case 'late-publication': declarations = []; break;
    case 'player-redefinition': declarations = [name + ' = Crate', 'Player = ' + name]; break;
  }
  const layout = draw(8);
  const decorate = text => layout === 1 ? text.replace(' = ', '(name) = ')
    : layout === 2 ? text.replace(' = ', ' = (member) ')
    : layout === 3 ? text.replace(' = ', '\u00a0=\u202f')
    : layout === 4 ? '(leading (nested)) ' + text
    : layout === 5 ? text + ' (trailing)'
    : layout === 6 ? text.replace(/ or /g, ' (operator) or (member) ')
    : layout === 7 ? text.replace(' = ', ' = (line\ncomment) ') : text;
  const glyph = draw(2) ? ['P', 'C'] : ['π', 'κ'];
  let row = glyph.join('') + '.'.repeat(1 + draw(3));
  if (direction === 'left' || direction === 'up') row = [...row].reverse().join('');
  const rows = direction === 'up' || direction === 'down' ? [...row] : [row];
  const layer = draw(2) ? 'Player, ' + name + ', Crate, Wall' : 'Player, Crate, Wall';
  const rule = (draw(2) ? 'random ' : '') + direction + ' [ action Player | ' + name + ' ] -> [ Player | Marker ] sfx0';
  const lines = [
    'title Recovery ' + family + ' ' + index, '', 'objects',
    'Background', 'black', '', 'Player', 'white', '', 'Crate', 'red', '', 'Wall', 'blue', '', 'Marker', 'yellow', '',
    'legend', '. = Background', 'P = Player', 'C = Crate', 'π = Player', 'κ = Crate', '# = Wall',
    ...declarations.map(decorate), '', 'sounds', 'sfx0 12345', name + ' move 54321', '',
    'collisionlayers', 'Background', layer, 'Marker', '',
  ];
  if (family === 'late-publication') {
    lines.push('legend', decorate(name + ' = Crate'), '');
    if (variant & 8) lines.push('sounds', '');
  }
  lines.push('rules', (layout === 4 ? '(İ) ' : '') + rule,
    '[ action Player ] -> checkpoint', '', 'winconditions', 'no Player', '', 'levels', ...rows, '');
  let source = lines.join('\n');
  if (draw(2)) source = 'run_rules_on_level_start\n' + source;
  if (draw(2)) source = source.replace(/\n/g, '\r\n');
  return { name: family + ' recovery ' + index, family, source,
    inputs: [4, 3, 'undo', 4, 'restart', 'tick'], seed: campaignSeed + ':' + index + (draw(2) ? ':😀' : ':é'),
    identity: crypto.createHash('sha256').update(source.replace(/^title[^\r\n]*/m, 'title Recovery')).digest('hex') };
};
