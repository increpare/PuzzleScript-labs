#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { canonicalizeSource } = require('../canonicalize');
const src = path.resolve(__dirname, '..');
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const files = [
    'js/mis/mis_shims.js', 'js/storagewrapper.js', 'js/bitvec.js', 'js/level.js',
    'js/languageConstants.js', 'js/globalVariables.js', 'js/debug.js', 'js/plugin_header_on.js',
    'js/font.js', 'js/rng.js', 'js/riffwave.js', 'js/sfxr.js', 'js/codemirror/stringstream.js',
    'js/colorhelpers.js', 'js/colors.js', 'js/engine.js', 'js/parser.js', 'js/compiler.js',
    'js/soundbar.js', 'js/semantic_compile.js',
];
vm.runInThisContext(files.map(file => fs.readFileSync(path.join(src, file), 'utf8')).join('\n')
    + '\nmisAfterEngineLoaded();');

async function main() {
    const { buildMisOptimizer } = await import('../../scripts/build-mis-optimizer.mjs');
    await buildMisOptimizer();
    const bundle = path.join(src, 'js/mis/mis_tools_bundle.js');
    assert(fs.existsSync(bundle), 'build the workbench tools bundle');
    vm.runInThisContext(fs.readFileSync(bundle, 'utf8'));
    for (const game of ['sokoban_basic', 'notsnake', 'blockfaker', 'atlas shrank', 'byyourside']) {
        const original = fs.readFileSync(path.join(src, 'demo', game + '.txt'), 'utf8');
        assert(misCompile(original).ok);
        const before = state;
        const playing = { level, RandomGen, curlevel, STRIDE_OBJ, STRIDE_MOV };
        const playerVisual = { colors: state.objects.player && state.objects.player.colors, sprite: state.objects.player && state.objects.player.spritematrix };
        const backgroundVisual = state.objects[state.idDict[state.backgroundid]];
        const output = MISTools.canonicalize(original);
        assert.equal(state, before, 'restore the active game after tool compilation');
        assert.equal(level, playing.level, 'validation must not replace the active playtest board');
        assert.equal(RandomGen, playing.RandomGen, 'validation must not reset a playtest random stream');
        assert.equal(curlevel, playing.curlevel);
        assert.equal(STRIDE_OBJ, playing.STRIDE_OBJ);
        assert.equal(STRIDE_MOV, playing.STRIDE_MOV);
        assert(!/^=+$/m.test(output));
        assert.deepEqual(canonicalizeSource(output, 'semantic'), canonicalizeSource(original, 'semantic'), game);
        assert.equal(MISTools.canonicalize(output), output, 'canonicalizing again should be stable: ' + game);
        const visuals = psCompileSemantic(output, true).state.objects;
        if (playerVisual.colors && visuals.player) {
            assert.deepEqual(visuals.player.colors, playerVisual.colors.map(color => color.toLowerCase()), 'normal canonicalization retains palette: ' + game);
            assert.deepEqual(visuals.player.spritematrix, playerVisual.sprite, 'normal canonicalization retains sprite: ' + game);
        }
        if (visuals.background) assert.deepEqual(visuals.background.spritematrix, backgroundVisual.spritematrix, 'retain background art: ' + game);
        const stripped = MISTools.canonicalize(original, { stripSprites: true });
        assert(!/^[.0-9]{5}$/m.test(stripped.split('LEGEND')[0]), 'strip every sprite grid: ' + game);
        assert.deepEqual(canonicalizeSource(stripped, 'semantic'), canonicalizeSource(original, 'semantic'), game);
        assert.equal(MISTools.canonicalize(stripped, { stripSprites: true }), stripped, 'stripping is stable: ' + game);
    }
    const sokoban = fs.readFileSync(path.join(src, 'demo/sokoban_basic.txt'), 'utf8');
    for (const [palette, sprite, expected] of [
        ['black red red', '00112\n00112\n00112\n00112\n.....', '#be2633'],
        ['#000 #f00 #ff0000', '00112\n00112\n00112\n00112\n.....', '#ff0000'],
        ['transparent red', '00000\n00000\n00100\n00000\n00000', '#be2633'],
        ['black blue', '.....\n.111.\n.....\n.....\n.....', '#1d57f7'],
        ['black red', '01...\n.....\n.....\n.....\n.....', '#000000'],
        ['black red', '.....\n.....\n.....\n.....\n.....', '#000000'],
    ]) {
        const artSource = sokoban.replace(/\nPlayer\n[\s\S]*?\n\n/, '\nPlayer\n' + palette + '\n' + sprite + '\n\n');
        const output = MISTools.canonicalize(artSource, { stripSprites: true });
        const object = psCompileSemantic(output, true).state.objects.player;
        assert.deepEqual(object.colors, [expected], 'choose the dominant colour by pixel count, with palette-order ties');
        assert(object.spritematrix.flat().every(pixel => pixel === 0), 'omitted grids compile to solid blocks');
    }
    // Rule groups (a rule plus its `+` rules) are separated by blank lines,
    // loop markers included; `+` rules stay attached.
    const grouped = MISTools.canonicalize(sokoban.replace(/(\nRULES\s*\n=+\s*\n)[\s\S]*?(\n=+\s*\nWINCONDITIONS)/,
        '$1\n[ > Player | Crate ] -> [ > Player | > Crate ]\n+ [ Crate Target ] -> [ Crate Target ] again\n\nstartloop\n[ action Player ] -> [ Player ]\n'
        + '[ Crate | Crate ] -> [ Crate | Crate ]\nendloop\nlate [ Player Target ] -> [ Player Target ]\n$2'));
    const rulesBlock = grouped.slice(grouped.indexOf('\nRULES\n'), grouped.indexOf('\nWINCONDITIONS'));
    assert.match(rulesBlock, /\n\+ down \[ Target Crate \] -> \[ Target Crate \] again\n\nstartLoop\ndown \[ action Player \] -> \[ Player \]\n\ndown \[ Crate \| Crate \]/, 'blank line before each new group');
    assert.match(rulesBlock, /\nendLoop\n\nlate /, 'blank line after a loop, before the next group');
    assert(!/\n\n\+/.test(rulesBlock), '+ rules stay with their group');
    assert.equal(MISTools.canonicalize(grouped), grouped, 'grouped output is stable');
    const glyphCollision = fs.readFileSync(path.join(src, 'demo/sokoban_basic.txt'), 'utf8')
        .replace('P = Player', 'X = Player').replace(/Crate/g, 'P')
        .replace(/\nLEVELS([\s\S]*)/, (_, maps) => '\nLEVELS' + maps.replace(/P/g, 'X'))
        .replace('all Target on P', 'all Target on P\nall Background on Background');
    const glyphInput = misCompile(glyphCollision);
    assert(glyphInput.ok && !glyphInput.hasErrors, 'single-character object fixture is valid');
    const glyphOutput = MISTools.canonicalize(glyphCollision);
    assert(/^P$/m.test(glyphOutput), 'preserve a name that would otherwise be the preferred player glyph');
    assert.deepEqual(canonicalizeSource(glyphOutput, 'semantic'), canonicalizeSource(glyphCollision, 'semantic'));
    const before = state;
    assert.throws(() => MISTools.canonicalize('not a game'), /compile|invalid/i);
    assert.equal(state, before, 'failed conversion leaves the engine intact');
    console.log('mis_tools_node: ok');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
