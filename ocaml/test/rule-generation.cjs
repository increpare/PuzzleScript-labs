'use strict';
// Complete source construction, independent of both execution engines. This
// campaign exercises rule identity and random weighting rather than saving
// either engine's results as a golden.
const crypto = require('node:crypto');
const { renderProgram } = require('../../typescript/test/exploration/program.mjs');

exports.construct = function(campaignSeed, index) {
  let state = 1;
  for (const ch of campaignSeed + ':rules:' + index) state = (state * 31 + ch.codePointAt(0)) % 2147483647;
  if (!state) state = 1;
  const pick = values => { state = state * 48271 % 2147483647; return values[Math.floor(state / 2147483647 * values.length)]; };
  const family = ['weighted-lines', 'symmetric-directions', 'cartesian-rows', 'negative-spawn'][index % 4];
  const objects = [['Background', 'black'], ['Player', 'white'], ['Red', 'red'], ['Blue', 'blue'], ['Mark', 'yellow'], ['Token', 'green']]
    .map(([name, color]) => ({ name, color }));
  const width = pick([2, 3, 4, 5]), height = pick([1, 2, 3]);
  const board = Array.from({ length: height }, () => Array.from({ length: width }, () => {
    const cell = ['Background'], color = pick([null, 'Red', 'Red', 'Blue']);
    if (color) cell.push(color);
    if (pick([false, false, true])) cell.push('Token');
    if (pick([false, false, false, true])) cell.push('Mark');
    return cell;
  }));
  pick(board.flat()).push('Player');
  const colors = pick([['Red', 'Blue'], ['Blue', 'Red']]);
  const late = pick([false, false, true]);
  const rules = [];
  if (!late && pick([false, true])) rules.push('[ action Player ] -> [ randomdir Player ]');
  const count = pick([2, 3, 4, 5]);
  let previous = null;
  for (let n = 0; n < count; n++) {
    const color = pick(['Color', 'Hue', 'Red', 'Ember', 'Blue']);
    const qualifier = late ? '' : pick(['', '', 'stationary ']);
    let body;
    if (family === 'weighted-lines') {
      body = '[ ' + qualifier + color + ' no Mark ] -> [ ' + color + ' Mark ]';
    } else if (family === 'symmetric-directions') {
      const direction = pick(['horizontal', 'vertical', 'orthogonal', 'left right', 'up down']);
      const left = qualifier + color + ' no Mark';
      const right = color + ' Mark';
      const secondLeft = pick([left, 'Token no Mark']);
      const secondRight = secondLeft === left ? right : 'Token Mark';
      body = direction + ' [ ' + left + ' | ' + secondLeft + ' ] -> [ ' + right + ' | ' + secondRight + ' ]';
    } else if (family === 'cartesian-rows') {
      const other = pick(['Token', 'Player', 'Actor', color]);
      body = '[ ' + qualifier + color + ' no Mark ] [ ' + other + ' no Mark ] -> [ ' + color + ' Mark ] [ ' + other + ' Mark ]';
    } else {
      body = '[ no ' + color + ' no Mark ] -> [ random Color Mark ]';
    }
    if (previous && pick([false, true])) body = previous;
    previous = body;
    const command = pick(['', '', ' sfx0', ' checkpoint']);
    rules.push((n === 0 ? (late ? 'late random ' : 'random ') : '+ ' + (late ? 'late ' : '')) + body + command);
  }
  rules.push('+ ' + (late ? 'late ' : '') + '[ ' + pick(['Player', 'Actor']) + ' ] -> [ Player Mark ]');
  const inputs = [4];
  for (let turn = 0, length = pick([3, 5, 7]); turn < length; turn++) inputs.push(pick([0, 1, 2, 3, 4, 'tick', 'undo', 'restart']));
  const seed = campaignSeed + ':execution:' + index + pick(['', ':é', ':😀']);
  const program = { version: 1, name: family + ' case ' + index, seed, objects,
    properties: [{ name: 'Color', objects: colors }],
    layers: [['Background'], ['Player'], colors, ['Mark'], ['Token']], board, rules, inputs,
    sounds: [{ event: 'sfx0', seed: 12345 }] };
  let source = renderProgram(program).replace('\nsounds\n', '\nHue = Color\nActor = Player\nEmber = Red\n\nsounds\n');
  if (pick([false, false, true])) source = 'run_rules_on_level_start\n' + source;
  const identity = crypto.createHash('sha256').update(source.replace(/^title[^\n]*$/m, 'title Generated case')).digest('hex');
  return { source, seed, inputs, family, name: program.name, identity };
};
