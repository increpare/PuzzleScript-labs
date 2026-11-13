'use strict';
// Stable command/event ordinals for the v2 wire format. Strings are opaque
// presentation/seed values; the shader queues their indices, never CPU turns.
const commands = ['cancel', 'restart', 'win', 'checkpoint', 'again', 'message',
  ...Array.from({ length: 11 }, (_, i) => 'sfx' + i)];
const events = ['titlescreen', 'startgame', 'endgame', 'startlevel', 'endlevel',
  'undo', 'restart', 'showmessage', 'closemessage', 'cancel',
  ...Array.from({ length: 11 }, (_, i) => 'sfx' + i)];

function encode(game, mask, symbol) {
  const rows = [];
  for (const list of game.sfx_MovementMasks) for (const sound of list) {
    rows.push([0, sound.layer, mask(sound.objectMask, game.STRIDE_OBJ), mask(sound.directionMask, game.STRIDE_MOV), symbol(sound.seed)]);
  }
  for (const sound of game.sfx_MovementFailureMasks) {
    rows.push([1, sound.layer, mask(sound.objectMask, game.STRIDE_OBJ), mask(sound.directionMask, game.STRIDE_MOV), symbol(sound.seed)]);
  }
  for (const [kind, list] of [[2, game.sfx_CreationMasks], [3, game.sfx_DestructionMasks]]) for (const sound of list) {
    rows.push([kind, 0, mask(sound.objectMask, game.STRIDE_OBJ), mask(null, game.STRIDE_MOV), symbol(sound.seed)]);
  }
  const simple = events.map(name => game.sfx_Events[name] === undefined ? 0xffffffff : symbol(game.sfx_Events[name]));
  return { rows, simple };
}
module.exports = { commands, events, encode };
