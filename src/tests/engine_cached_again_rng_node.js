#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPuzzleScript } = require('./js_oracle/lib/puzzlescript_node_env');

loadPuzzleScript();
const source = fs.readFileSync(path.join(__dirname, 'semantic-fixtures/history/again-probe-random.ps'), 'utf8');
compile(['loadLevel', 0], source, 'callback-again');
assert.equal(errorCount, 0);

let draws = 0;
RandomGen = new RNG(() => { draws++; return 0.25; });
const originalLevel = level;
assert.equal(processInput(4), true);
assert.equal(againing, true);
assert.equal(draws, 0, 'scheduling AGAIN must not invoke an uncloneable entropy callback');
assert.equal(level, originalLevel, 'callback fallback retains the live board');

assert.equal(processInput(-1), true);
assert.equal(draws, 1, 'the actual AGAIN turn invokes the callback once');
assert.equal(againing, false);
assert.equal(level, originalLevel, 'callback turns must bypass cached board swaps');
assert.ok(convertLevelToString().includes('done player red target'));

console.log('engine_cached_again_rng_node passed');
