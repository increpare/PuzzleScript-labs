#!/usr/bin/env node
'use strict';

// Headless compiler regressions: node this-file [path/to/src].
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const element = () => ({ style: {}, getContext() { return null; } });
const context = vm.createContext({ assert, console, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: { URL: 'test://', body: { classList: { contains() { return false; } }, addEventListener() {} },
        createElement: element, getElementById() { return null; } },
    editor: { getValue() { return ''; } }, input: element(), canvas: null, lastDownTarget: null,
    Audio: function() {}, PuzzleScriptTestAssertions: { push() {}, equal() {} },
    UnitTestingThrow(error) { throw error; } });
context.global = context;
context.window = context;
for (const name of ['consolePrint', 'consoleError', 'consoleCacheDump', 'consolePrintFromRule', 'canvasResize',
    'redraw', 'forceRegenImages', 'addToDebugTimeline', 'killAudioButton', 'showAudioButton', 'regenSpriteImages',
    'jumpToLine', 'printLevel', 'playSound']) context[name] = () => {};
const files = ['storagewrapper', 'bitvec', 'level', 'languageConstants', 'globalVariables', 'debug',
    ...(fs.existsSync(path.join(src, 'js/plugin_header_on.js')) ? ['plugin_header_on'] : []),
    'font', 'rng', 'riffwave', 'sfxr', 'codemirror/stringstream', 'colorhelpers', 'colors', 'engine', 'parser', 'compiler', 'soundbar'];
vm.runInContext(files.map(file => fs.readFileSync(path.join(src, 'js', file + '.js'), 'utf8')).join('\n'), context);
const prefix = 'OBJECTS\nBackground .\nblack\nPlayer P\nwhite\nCrate C\nred\nFlag F\nyellow\nLEGEND\nSOUNDS\nCOLLISIONLAYERS\nBackground\nPlayer, Crate\nFlag\nRULES\n';
const ending = '\nWINCONDITIONS\nLEVELS\nP\n';
const cases = [
    ['( [ Player ] -> [ Crate ] (note) ) cancel  ', 'player', ['cancel']],
    ['( [ Player ] -> [ Crate ] (note) ) cancel message garden', 'player', ['cancel message garden']],
    [' ( [ Player ] -> [ Crate ] (note) ) cancel', 'player', ['cancel']],
    ['( [ Player ] -> [ Crate ] (note) )  ', 'player', []],
    ['( [ Player ] -> [ Flag ] ) [ Player ] -> [ Crate ]', 'crate', ['[ player ] -> [ crate ]']],
    ['(İ (nested) note) [ Player ] -> [ Crate ]', 'crate', ['[ player ] -> [ crate ]']],
    ['( [ Player ] -> [ Flag ]\n(note) ) [ Player ] -> [ Crate ]', 'crate', ['[ player ] -> [ crate ]']],
    ['[ Player ] -> [ Crate ] (note) cancel', 'crate', ['[ player ] -> [ crate ]']],
    ['[ Player ] -> [ Crate ] (note) cancel (unclosed\n[ Player ] -> [ Crate ]', 'crate', ['[ player ] -> [ crate ]', '[ player ] -> [ crate ]']],
];
for (const [rules, expected, captured] of cases) {
    context.source = prefix + rules + ending;
    context.expected = expected;
    context.captured = captured;
    vm.runInContext(`{
        resetParserErrorState();
        const processor = new codeMirrorFn(), parsed = processor.startState();
        for (const line of source.split('\\n')) {
            const stream = new CodeMirror.StringStream(line, 4);
            do { processor.token(stream, parsed); } while (!stream.eol());
        }
        assert.equal(JSON.stringify(parsed.rules.map(rule => rule[0].trim())), JSON.stringify(captured), source);
        unitTesting = true; lazyFunctionGeneration = false;
        compile(['loadLevel', 0], source, 'comment capture');
        processInput(4);
        const present = state.idDict.filter((name, id) => level.objects[id >> 5] & (1 << (id & 31)));
        assert(present.includes(expected), source + ': expected ' + expected + ', got ' + present);
        assert(!present.includes('flag'), 'Commented rule created Flag');
        assert.equal(present.includes('crate'), expected === 'crate', source);
    }`, context);
}
context.source = prefix + '(İ prefix) [ Player ] -> message HeLLo (literal\n[ Player ] -> [ Player ]' + ending;
vm.runInContext(`{
    unitTesting = true; lazyFunctionGeneration = false;
    compile(['loadLevel', 0], source, 'comment capture');
    const messages = state.rules.flatMap(group => group.flatMap(rule => rule.commands.filter(command => command[0] === 'message')));
    assert(messages.length > 0);
    assert(messages.every(command => command[1] === 'HeLLo (literal'), JSON.stringify(messages));
}`, context);
for (const win of [
    '( all Player on Flag (note) ) all Crate on Flag',
    '(İ (nested)) all Crate on Flag',
    'all Crate on Flag (note) all Player on Flag',
]) {
    context.source = prefix + '\nWINCONDITIONS\n' + win + '\nLEVELS\nP\n';
    vm.runInContext(`{
        resetParserErrorState();
        const processor = new codeMirrorFn(), parsed = processor.startState();
        for (const line of source.split('\\n')) {
            const stream = new CodeMirror.StringStream(line, 4);
            do { processor.token(stream, parsed); } while (!stream.eol());
        }
        assert.equal(parsed.winconditions.length, 1, source);
        assert.equal(parsed.winconditions[0].slice(0, -1).join(' '), 'all crate on flag', source);
    }`, context);
}
console.log('Comment capture: 13 cases passed');
