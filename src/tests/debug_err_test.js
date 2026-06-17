#!/usr/bin/env node
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const srcDir = path.join(__dirname, '..');
const _storage = {};
global.localStorage = {
    getItem(key) { return Object.prototype.hasOwnProperty.call(_storage, key) ? _storage[key] : null; },
    setItem(key, value) { _storage[key] = String(value); },
    removeItem(key) { delete _storage[key]; },
};
global.document = {
    URL: 'test://',
    body: { classList: { contains() { return false; } }, addEventListener() {}, removeEventListener() {} },
    createElement() { return { style: {}, innerHTML: '', textContent: '', getContext() { return null; } }; },
    getElementById() { return null; },
};
global.window = global;
global.lastDownTarget = null;
global.canvas = null;
global.input = global.document.createElement('TEXTAREA');
global.canvasResize = function() {};
global.redraw = function() {};
global.forceRegenImages = function() {};
global.consolePrintFromRule = function() {};
global.consolePrint = function() {};
global.console_print_raw = console.log;
global.consoleError = function() {};
global.consoleCacheDump = function() {};
global.addToDebugTimeline = function() {};
global.killAudioButton = function() {};
global.showAudioButton = function() {};
global.regenSpriteImages = function() {};
global.jumpToLine = function() {};
global.printLevel = function() {};
global.playSound = function() {};
global.levelString = '';
global.UnitTestingThrow = function(error) { throw error; };

const sourceFiles = [
    'js/storagewrapper.js', 'js/bitvec.js', 'js/level.js', 'js/languageConstants.js',
    'js/globalVariables.js', 'js/debug.js', 'js/plugin_header_on.js', 'js/font.js',
    'js/rng.js', 'js/riffwave.js', 'js/sfxr.js', 'js/codemirror/stringstream.js',
    'js/colors.js', 'js/engine.js', 'js/parser.js', 'js/compiler.js', 'js/soundbar.js',
];
let allCode = '';
for (const file of sourceFiles) {
    allCode += fs.readFileSync(path.join(srcDir, file), 'utf8') + '\n';
}
allCode += fs.readFileSync(path.join(srcDir, 'tests/resources/errormessage_testdata.js'), 'utf8');
vm.runInThisContext(allCode, { filename: 'combined_sources.js' });

const name = process.argv[2] || 'name B already in use';
const entry = global.errormessage_testdata.find(e => e[0] === name);
const source = entry[1][0];
global.unitTesting = true;
global.lazyFunctionGeneration = false;
if (typeof global.resetParserErrorState === 'function') {
    global.resetParserErrorState();
}
try {
    compile(['restart'], source);
    console.log('ok errorCount=', errorCount);
    console.log(errorStrings.map(s => s.replace(/<[^>]+>/g, '')).join('\n'));
} catch (error) {
    console.error('THREW', error.message);
    console.error(error.stack);
    process.exit(1);
}
