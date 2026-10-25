'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { loadPuzzleScript } = require('../native-host.cjs');
const { oracle } = loadPuzzleScript();
const source = fs.readFileSync(path.join(__dirname, 'rigid-owner.puzzlescript'), 'utf8');
unitTesting = true;
compile(['loadLevel', 0], source, 'rigid-owner');
const original = state.resolveMovements;
const attempts = [];
state.resolveMovements = function(current, bans) {
  const owners = [];
  for (let layer = 0; layer < current.layerCount; layer++) {
    const applied = current.rigidMovementAppliedMask[0];
    if (!applied || !applied.getshiftor(31, 5 * layer)) continue;
    const encoded = current.rigidGroupIndexMask[0].getshiftor(31, 5 * layer);
    const group = state.rigidGroupIndex_to_GroupIndex[encoded - 1];
    owners.push({ layer, group, ruleLine: state.rules[group]?.[0].lineNumber });
  }
  const retry = original.apply(this, arguments);
  attempts.push({ owners, retry, bannedGroups: Object.keys(bans).filter(key => bans[key]).map(Number) });
  return retry;
};
processInput(process.argv[2] === undefined ? -1 : Number(process.argv[2]));
console.log(JSON.stringify({ repository: oracle.repository, revision: oracle.revision,
  rules: state.rules.map((group, index) => ({ index, line: group[0].lineNumber })), attempts }, null, 2));
