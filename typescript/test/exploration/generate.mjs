export const families = Object.freeze(['push-property', 'multirow-live', 'random-rigid', 'session-again']);

// Case construction has its own arithmetic generator, independent of either engine.
function choices(seed) {
  let state = 1;
  for (const character of seed) state = (state * 31 + character.codePointAt(0)) % 2147483647;
  if (state === 0) state = 1;
  return values => {
    state = state * 48271 % 2147483647;
    return values[Math.floor(state / 2147483647 * values.length)];
  };
}

export function generateProgram(campaignSeed, index) {
  if (typeof campaignSeed !== 'string' || !Number.isSafeInteger(index) || index < 0) throw new Error('Use a string seed and nonnegative case index');
  const pick = choices(campaignSeed + ':' + index), family = families[index % families.length];
  const direction = pick(['up', 'left', 'down', 'right']);
  const separateCrate = family === 'random-rigid' && pick([false, true]);
  const objects = [
    ['Background', 'black'], ['Player', 'white'], ['Crate', 'orange'], ['Wall', 'gray'],
    ['Red', 'red'], ['Blue', 'blue'], ['Mark', 'yellow'], ['Token', 'green'],
  ].map(([name, color]) => ({ name, color }));
  const layers = separateCrate
    ? [['Background'], ['Player', 'Wall'], ['Crate'], ['Red', 'Blue'], ['Mark'], ['Token']]
    : [['Background'], ['Player', 'Crate', 'Wall'], ['Red', 'Blue'], ['Mark'], ['Token']];
  const width = pick([1, 2, 3, 4]), height = pick([1, 2, 3]);
  const board = Array.from({ length: height }, () => Array.from({ length: width }, () => ['Background']));
  const positions = board.flat();
  const player = pick(positions);
  for (const cell of positions) {
    if (cell === player) cell.push('Player');
    else {
      const actor = pick([null, null, 'Crate', 'Wall']);
      if (actor !== null) cell.push(actor);
    }
    if (separateCrate && !cell.includes('Crate') && pick([false, true, false])) cell.push('Crate');
    const color = pick([null, null, 'Red', 'Blue']);
    if (color !== null) cell.push(color);
    if (family !== 'session-again' && pick([false, false, true])) cell.push('Mark');
    if (pick([false, false, true])) cell.push('Token');
  }
  const colorMembers = pick([['Red', 'Blue'], ['Blue', 'Red']]);
  let rules;
  if (family === 'push-property') {
    rules = [
      direction + ' [ > Player | Crate ] -> [ > Player | > Crate ]',
      direction + ' [ Color no Mark | no Color no Wall ] -> [ Mark | Color ]',
      '[ Crate no Mark ] -> [ Crate Mark ]',
    ];
    if (pick([false, true])) rules.reverse();
    if (pick([false, true])) rules.push('random [ action Player ] -> [ randomdir Player random Color ]');
  } else if (family === 'multirow-live') {
    rules = [
      direction + ' [ Color no Mark ] [ Crate no Mark ] -> [ Color Mark ] [ Crate Mark ]',
      pick([false, true])
        ? direction + ' [ Color | ... | Crate | ... | no Color no Mark ] -> [ | ... | Crate | ... | Color Mark ]'
        : direction + ' [ Color | ... | no Color no Mark ] -> [ | ... | Color Mark ]',
    ];
    if (pick([false, true])) rules.reverse();
    if (pick([false, true])) rules.push('late [ Player Red ] -> checkpoint');
  } else if (family === 'random-rigid') {
    rules = separateCrate ? [
      'rigid ' + direction + ' [ Player ] -> [ > Player ]',
      'rigid ' + direction + ' [ Player Crate ] -> [ > Player > Crate ]',
    ] : ['rigid ' + direction + ' [ > Player | Crate ] -> [ > Player | > Crate ]'];
    if (pick([false, true])) rules.push('[ Token no Mark ] -> [ randomdir Token Mark ]');
    rules.push('random [ Token ] -> [ random Color ]', '+ [ Player ] -> [ Player random Color ]');
    if (pick([false, true])) rules.push('late [ Player Blue ] -> checkpoint');
  } else {
    rules = [
      direction + ' [ action Player ] -> [ > Player > Mark ] again',
      direction + ' [ Player Mark | no Player no Wall ] -> [ > Player > Mark | ] again',
      'late [ Player Red ] -> checkpoint',
    ];
    if (pick([false, true])) rules.push('late [ Player Blue ] -> ' + pick(['cancel', 'restart']));
    if (pick([false, true])) rules.push('late random [ Player ] -> sfx0');
  }
  const inputs = [4];
  for (let turn = 0, length = pick([3, 5, 7]); turn < length; turn++) inputs.push(pick([0, 1, 2, 3, 4, 'tick', 'undo', 'restart']));
  return { version: 1, name: family + ' case ' + index, family,
    seed: campaignSeed + ':execution:' + index, objects,
    properties: [{ name: 'Color', objects: colorMembers }], layers, board, rules, inputs,
    sounds: [{ event: 'sfx0', seed: 12345 }] };
}
