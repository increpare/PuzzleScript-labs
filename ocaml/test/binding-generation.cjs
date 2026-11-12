'use strict';
// Complete games with independently prepared movements. Vary property transport,
// copy and command-only matching without saving either engine's answers.
const crypto = require('node:crypto');

exports.construct = function(campaignSeed, index) {
  let state = 1;
  for (const ch of campaignSeed + ':bindings:' + index) state = (state * 31 + ch.codePointAt(0)) % 2147483647;
  if (!state) state = 1;
  const pick = values => { state = state * 48271 % 2147483647; return values[Math.floor(state / 2147483647 * values.length)]; };
  const family = ['property-transport', 'relative-transport', 'property-copy', 'command-evidence'][index % 4];
  const objects = [['Background', 'black'], ['Red', 'red'], ['Blue', 'blue'], ['Anchor', 'yellow'], ['Target', 'green'], ['Trophy', 'white']]
    .map(([name, color]) => ({ name, color }));
  const width = pick([5, 6, 7, 8]), height = pick([4, 5, 6]);
  const board = Array.from({ length: height }, () => Array.from({ length: width }, () => ['Background']));
  const direction = pick(['up', 'down', 'left', 'right']);
  const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction];
  const x = Math.floor(width / 2), y = Math.floor(height / 2);
  board[y][x].push(pick(['Red', 'Blue']), 'Anchor');
  board[y + dy][x + dx].push('Red', 'Target');
  const colors = pick([['Red', 'Blue'], ['Blue', 'Red']]);
  const name = pick(['Color', 'Hue']);
  let qualifier = pick(['moving', 'orthogonal']);
  let leftMovement = pick(['up', 'down', 'left', 'right']);
  let rightMovement = pick(['up', 'down', 'left', 'right']);
  if (family === 'relative-transport') {
    qualifier = pick(['parallel', 'perpendicular']);
    const vertical = (direction === 'up' || direction === 'down') === (qualifier === 'parallel');
    leftMovement = pick(vertical ? ['up', 'down'] : ['left', 'right']);
    rightMovement = pick(vertical ? ['up', 'down'] : ['left', 'right']);
  }
  const rules = [
    '[ action Color Anchor ] -> [ ' + leftMovement + ' Color Anchor ]',
    '[ action Red Target ] -> [ ' + rightMovement + ' Red Target ]',
  ];
  const random = pick([false, true]);
  const modifier = random ? 'random ' : '';
  const command = pick(['', ' sfx0', ' checkpoint']);
  if (family === 'command-evidence') {
    rules.push(modifier + '[ ' + qualifier + ' ' + name + ' Anchor ] [ ' + qualifier + ' Red Target ] -> sfx0 checkpoint');
  } else {
    const retained = family === 'property-copy' ? qualifier + ' ' + name + ' Anchor' : 'Anchor';
    rules.push(modifier + direction + ' [ ' + qualifier + ' ' + name + ' Anchor | ' + qualifier + ' Red Target ] -> [ ' + retained + ' | ' + qualifier + ' ' + name + ' Target Trophy ]' + command);
  }
  const inputs = [4];
  for (let turn = 0, length = pick([3, 5, 7]); turn < length; turn++) inputs.push(pick([0, 1, 2, 3, 4, 'tick', 'undo', 'restart']));
  const seed = campaignSeed + ':execution:' + index + pick(['', ':é', ':😀']);
  const nameOfGame = family + ' case ' + index;
  // Player is intentionally an alias of a property, so this constructor writes
  // the tiny complete source directly rather than requiring a concrete Player.
  let source = [
    'title ' + nameOfGame, '', 'objects',
    ...objects.flatMap(object => [object.name, object.color, '']),
    'legend', '. = Background',
    'L = ' + board[y][x].filter(name => name !== 'Background').join(' and '),
    'R = Red and Target', 'Color = ' + colors.join(' or '), 'Hue = Color', 'Player = Hue',
    '', 'sounds', 'sfx0 12345', 'Color move 54321', '', 'collisionlayers',
    'Background', colors.join(', '), 'Anchor', 'Target', 'Trophy', '',
    'rules', ...rules, '', 'winconditions', 'no Player', '', 'levels',
    ...board.map(row => row.map(cell => cell.includes('Anchor') ? 'L' : cell.includes('Target') ? 'R' : '.').join('')), '',
  ].join('\n');
  if (pick([false, false, true])) source = 'run_rules_on_level_start\n' + source;
  const identity = crypto.createHash('sha256').update(source.replace(/^title[^\n]*$/m, 'title Generated case')).digest('hex');
  return { source, seed, inputs, family, name: nameOfGame, identity };
};
