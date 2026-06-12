#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadPuzzleScript } = require('./js_oracle/lib/puzzlescript_node_env');

loadPuzzleScript();

const solverGamePath = path.join(__dirname, 'solver_tests', 'a distant sunset.txt');
const solverSource = fs.readFileSync(solverGamePath, 'utf8');

assert.ok(solverSource.includes('sprt_1_1 ^'), 'expected keyword sprite object names in solver fixture');
assert.ok(!solverSource.includes('?title a distant sunset'), 'solver fixture must not contain duplicated source pasted into LEVELS');

if (typeof resetParserErrorState === 'function') {
    resetParserErrorState();
}

let compiledState;
try {
    compiledState = loadFile(solverSource);
} catch (error) {
    assert.fail(`loadFile threw for solver fixture: ${error.message}\n${error.stack}`);
}

assert.ok(compiledState !== null && compiledState !== undefined, 'loadFile should compile solver fixture');
assert.ok(Array.isArray(compiledState.rules) && compiledState.rules.length > 0, 'compiled rules should be present');

// Copy-state snapshots from incremental highlighting must keep membership sets usable.
const processor = new codeMirrorFn();
const snapshot = processor.copyState(processor.startState());
assert.ok(snapshot.namesSet instanceof Set, 'copyState should preserve namesSet');
assert.ok(snapshot.abbrevNamesSet instanceof Set, 'copyState should preserve abbrevNamesSet');

console.log('compiler_keyword_names_node: ok');
