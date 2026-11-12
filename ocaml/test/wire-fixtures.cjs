'use strict';
// This recovery state contains two distinct board identities displayed with
// the same name. The portable authored format deliberately forbids duplicate
// names, so its exact legacy wire expectation is authored here instead.
const fs = require('node:fs');
const path = require('node:path');
module.exports = [{
  name: 'ocaml: overwritten first slot remains independent of the final layer assignment',
  sourceFile: 'orphaned-slot.ps',
  source: fs.readFileSync(path.join(__dirname, 'fixtures/orphaned-slot.ps'), 'utf8'),
  level: 0, seed: 'ocaml/orphaned-slot', inputs: [4],
  expectedErrors: ['Object "GHOST" has been defined, but not assigned to a layer.'],
  expectedBoard: 'background player:0,background background marker:1,\n',
  expectedSounds: [], expectedPlayedSounds: [],
}];
