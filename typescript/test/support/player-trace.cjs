'use strict';

// The actual player loads debug_off.js, which has no editor trace serializer.
// Supply observation helpers only; native gameplay and its IDE=false constant
// remain untouched. The visitation order matches the pinned editor serializer.
function installPlayerTrace() {
  global.soundHistory = [];
  global.convertLevelToString = function() {
    let result = '';
    const seen = new Map();
    for (let y = 0; y < level.height; y++) {
      for (let x = 0; x < level.width; x++) {
        const cell = level.getCell(x + y * level.width);
        const names = [];
        for (let id = 0; id < 32 * STRIDE_OBJ; id++) if (cell.get(id)) names.push(state.idDict[id]);
        const key = names.sort().join(' ');
        if (!seen.has(key)) { seen.set(key, seen.size); result += key + ':'; }
        result += seen.get(key) + ',';
      }
      result += '\n';
    }
    return result;
  };
}

module.exports = { installPlayerTrace };
