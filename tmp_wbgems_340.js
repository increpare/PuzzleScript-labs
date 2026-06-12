#!/usr/bin/env node
'use strict';
const fs = require('fs'); const vm = require('vm'); const path = require('path');
const srcDir = path.join(__dirname, 'src');
const _storage = {};
global.localStorage = { getItem(k) { return _storage[k] ?? null; }, setItem(k,v) { _storage[k]=String(v); }, removeItem(k) { delete _storage[k]; } };
global.document = { URL: 'test://', body: { classList: { contains() { return false; } }, addEventListener() {}, removeEventListener() {} }, createElement() { return { style: {}, getContext() { return null; } }; }, getElementById() { return null; } };
global.window = global; global.lastDownTarget = null; global.canvas = null; global.input = global.document.createElement('TEXTAREA');
global.forceRegenImages = false;
['canvasResize','redraw','consolePrint','consoleCacheDump','addToDebugTimeline','playSound','consolePrintFromRule'].forEach(n => { global[n] = () => {}; });
global.levelString = ''; global.editor = { getValue() { return global.levelString; } };
global.QUnit = { push() {}, assert: { equal() {} } }; global.UnitTestingThrow = (e) => { throw e; };
const sourceFiles = fs.readFileSync(path.join(srcDir, 'tests/run_tests_node.js'), 'utf8').match(/const sourceFiles = \[([\s\S]*?)\];/)[1].match(/'[^']+'/g).map(s => s.slice(1, -1));
let code = sourceFiles.map(f => fs.readFileSync(path.join(srcDir, f), 'utf8')).join('\n');
code += fs.readFileSync(path.join(srcDir, 'tests/resources/testdata.js'), 'utf8');
code += fs.readFileSync(path.join(srcDir, 'tests/resources/testingFrameWork.js'), 'utf8');
vm.runInThisContext(code, { filename: 'bundle.js' });
const data = global.testdata.find(x => x[0] === 'wb + gems test')[1];
function xy(i) { return [(i / level.height) | 0, i % level.height]; }
function runTo(n) {
  unitTesting = true; lazyFunctionGeneration = false; levelString = data[0]; errorStrings = []; errorCount = 0;
  compile(['loadLevel', data[3]], levelString, data[4]);
  while (againing) { againing = false; processInput(-1); }
  for (let i = 0; i < n; i++) {
    const val = data[1][i];
    if (val === 'undo') DoUndo(false, true);
    else if (val === 'restart') DoRestart();
    else if (val === 'tick') processInput(-1);
    else processInput(val);
    while (againing) { againing = false; processInput(-1); }
  }
}
runTo(13);
const pid = state.idDict.indexOf('player');
const tid = state.idDict.indexOf('temp');
console.log('after snap13 player cells:');
for (let i = 0; i < level.n_tiles; i++) {
  const c = level.getCell(i);
  if (c.get(pid)) console.log('  player at', i, xy(i));
}
const origApply = Rule.prototype.applyAt;
Rule.prototype.applyAt = function(level, tuple, check, delta) {
  if (this.lineNumber === 340 || this.lineNumber === 344) {
    console.log('rule', this.lineNumber, 'tuple', tuple.map(t => t), 'check', check);
  }
  return origApply.call(this, level, tuple, check, delta);
};
const origResolve = state.resolveMovements;
state.resolveMovements = function(level, bannedGroup) {
  const ti = 10 * level.height + 7;
  console.log('pre-resolve player (10,7) idx', ti, 'mov', level.getMovements(ti));
  return origResolve.call(this, level, bannedGroup);
};
processInput(0);
console.log('after input14 player cells:');
for (let i = 0; i < level.n_tiles; i++) {
  const c = level.getCell(i);
  if (c.get(pid)) console.log('  player at', i, xy(i));
  if (c.get(tid)) console.log('  temp at', i, xy(i));
}
