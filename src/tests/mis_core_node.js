#!/usr/bin/env node
'use strict';

// Checks for the PuzzleScript+MIS web prototype core (src/js/mis/mis_core.js):
// transform language, board <-> source write-back, solver, presets, simplify.
//
//   node src/tests/mis_core_node.js

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const srcDir = path.join(__dirname, '..');

global.window = global;
global.document = {
	URL: 'mis://', body: { classList: { contains() { return false; } }, addEventListener() {}, removeEventListener() {} },
	createElement() { return { style: {}, getContext() { return null; } }; }, getElementById() { return null; },
};

const files = [
	'js/mis/mis_shims.js',
	'js/storagewrapper.js', 'js/bitvec.js', 'js/level.js', 'js/languageConstants.js', 'js/globalVariables.js',
	'js/debug.js', 'js/plugin_header_on.js', 'js/font.js', 'js/rng.js', 'js/riffwave.js', 'js/sfxr.js',
	'js/codemirror/stringstream.js', 'js/colorhelpers.js', 'js/colors.js', 'js/engine.js', 'js/parser.js',
	'js/compiler.js', 'js/soundbar.js',
];
let code = '';
for (const f of files) code += `\n// ---- ${f} ----\n` + fs.readFileSync(path.join(srcDir, f), 'utf8');
code += '\nmisAfterEngineLoaded();\n';
code += fs.readFileSync(path.join(srcDir, 'js/mis/mis_core.js'), 'utf8');
code += '\nglobal.MISCore = MISCore; global.misCompile = misCompile;\n';
vm.runInThisContext(code, { filename: 'mis_combined.js' });

let passed = 0;
function test(name, fn) {
	try { fn(); passed++; console.log('ok   ' + name); }
	catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e)); process.exitCode = 1; }
}

function load(rel) {
	const text = fs.readFileSync(path.join(srcDir, rel), 'utf8');
	const res = misCompile(text);
	assert(res.ok, rel + ' should compile');
	return { text, model: MISCore.extractModel(text) };
}

const C = MISCore;
const soko = load('demo/sokoban_basic.txt');
const firstLevel = soko.model.levels.find(l => l.board);

test('model: names, glyphs and levels', () => {
	const m = soko.model;
	assert.strictEqual(m.levels.length, 2);
	assert(m.levelMapOK);
	assert.deepStrictEqual(m.playerIds, [m.names.player.ids[0]]);
	assert.strictEqual(m.names['@'].kind, 'aggregate');
	assert(m.movers.crate && m.movers.player);
	assert.deepStrictEqual(m.winText, [{ quant: 'all', a: 'target', b: 'crate' }]);
});

test('write-back is a no-op for unchanged levels (corpus sample)', () => {
	for (const rel of ['demo/sokoban_basic.txt', 'demo/microban.txt', 'tests/good_games/ALL GREEN TO BLUE.txt', 'demo/tiny treasure hunt.txt']) {
		const g = load(rel);
		for (const lv of g.model.levels) {
			if (!lv.board) continue;
			assert.strictEqual(C.writeLevelToSource(g.model, g.text, lv.index, lv.board), g.text, rel + ' level ' + lv.index);
		}
	}
});

test('write-back invents a legend glyph for new object combinations', () => {
	const m = soko.model;
	const b = C.cloneBoard(firstLevel.board);
	// Player standing on a target has no glyph in this game.
	let tile = -1;
	for (let t = 0; t < b.w * b.h && tile < 0; t++) if (C.hasBit(b.cells, t, m.names.player.ids[0], m.stride)) tile = t;
	C.setBit(b.cells, tile, m.names.target.ids[0], m.stride);
	const text = C.writeLevelToSource(m, soko.text, firstLevel.index, b);
	assert(/\n\S = Player and Target|\n\S = Target and Player/.test(text), 'legend line added');
	assert(misCompile(text).ok);
	const again = C.extractModel(text);
	assert(C.boardsEqual(again.levels[firstLevel.index].board, b), 'recompiled board matches');
	misCompile(soko.text);
});

test('transform parser reports useful errors', () => {
	const m = soko.model;
	const r = C.parseTransform('choose 3 [ Wal ] -> [ Crate ]\nchoose x [Crate] -> []\n[ Crate | Wall ] -> [ Crate ]\nor', m);
	assert.strictEqual(r.statements.length, 0);
	assert.deepStrictEqual(r.errors.map(e => e.line), [0, 1, 2]);
	assert(/Unknown object name 'wal'/.test(r.errors[0].message));
	const ok = C.parseTransform('(comment)\nchoose 2-4 option 0.5 [ Wall ] -> [ ]\nor option 0.5 [ no Wall no Crate no Player ] -> [ Wall ]\nchoose 1 [ Crate ] [ Target ] -> [ ] [ ]', m);
	assert.deepStrictEqual(ok.errors, []);
	assert.strictEqual(ok.statements.length, 2);
	assert.deepStrictEqual(ok.statements[0].choose, [2, 4]);
	assert.strictEqual(ok.statements[0].alts.length, 2);
});

test('transforms change boards, keep object counts where they should, and respect locks', () => {
	const m = soko.model;
	const prog = C.parseTransform('choose 6 [ Crate | no Wall no Crate no Player ] -> [ | Crate ]', m);
	const rng = C.makeRng(7);
	const crates = b => { let n = 0; for (let t = 0; t < b.w * b.h; t++) if (C.hasBit(b.cells, t, m.names.crate.ids[0], m.stride)) n++; return n; };
	let changed = 0;
	for (let i = 0; i < 30; i++) {
		const out = C.runTransform(m, prog, firstLevel.board, null, rng);
		assert.strictEqual(crates(out), crates(firstLevel.board));
		if (!C.boardsEqual(out, firstLevel.board)) changed++;
	}
	assert(changed > 20);
	const locked = new Uint8Array(firstLevel.board.w * firstLevel.board.h).fill(1);
	for (let i = 0; i < 10; i++) assert(C.boardsEqual(C.runTransform(m, prog, firstLevel.board, locked, rng), firstLevel.board));
});

test('"everywhere" rules and option probabilities', () => {
	const m = soko.model;
	const fill = C.parseTransform('[ Target no Crate ] -> [ Target Crate ]', m);
	const out = C.runTransform(m, fill, firstLevel.board, null, C.makeRng(1));
	let bad = 0;
	for (let t = 0; t < out.w * out.h; t++) if (C.hasBit(out.cells, t, m.names.target.ids[0], m.stride) && !C.hasBit(out.cells, t, m.names.crate.ids[0], m.stride)) bad++;
	assert.strictEqual(bad, 0);
	const none = C.parseTransform('option 0 [ Wall ] -> [ ]', m);
	assert(C.boardsEqual(C.runTransform(m, none, firstLevel.board, null, C.makeRng(2)), firstLevel.board));
});

test('solver: BFS optimum, unsolvable detection, MIS effort', () => {
	const m = soko.model;
	const bfs = C.solve(m, firstLevel.board, { strategy: 'bfs', maxExpanded: 300000 });
	assert.strictEqual(bfs.status, 'solved');
	assert.strictEqual(bfs.solution.length, 33);
	const r = C.assess(m, firstLevel.board, { timeMs: 5000, bfsFloor: 300000 });
	assert.strictEqual(r.status, 'solved');
	assert(r.optimal && r.length === 33);
	assert(r.effort > 0 && r.effort <= r.lanes.astar);
	// Wall off the player completely -> unsolvable.
	const b = C.cloneBoard(firstLevel.board);
	const wall = m.names.wall.ids[0];
	let p = -1;
	for (let t = 0; t < b.w * b.h; t++) if (C.hasBit(b.cells, t, m.names.player.ids[0], m.stride)) p = t;
	const px = Math.floor(p / b.h), py = p % b.h;
	for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) C.placeObject(m, b.cells, (px + dx) * b.h + (py + dy), wall);
	assert.strictEqual(C.solve(m, b, { strategy: 'astar' }).status, 'unsolvable');
});

test('replayed solution frames end in a win', () => {
	const m = soko.model;
	const r = C.solve(m, firstLevel.board, { strategy: 'astar' });
	const frames = C.replayFrames(m, firstLevel.board, r.solution);
	assert.strictEqual(frames.length, r.solution.length + 1);
	C.loadBoardIntoEngine(m, frames[frames.length - 1]);
	assert(C.winconditionsNow());
});

test('presets are derived from rules and win conditions and all parse', () => {
	for (const rel of ['demo/sokoban_basic.txt', 'tests/good_games/ALL GREEN TO BLUE.txt', 'demo/limerick.txt', 'demo/microban.txt']) {
		const g = load(rel);
		const presets = C.derivePresets(g.model);
		assert(presets.length > 0, rel + ' has presets');
		for (const p of presets) assert.deepStrictEqual(C.parseTransform(p.text, g.model).errors, [], rel + ': ' + p.label);
	}
	misCompile(soko.text);
	const labels = C.derivePresets(soko.model).map(p => p.label);
	assert(labels.includes('Swap a Target/Crate pair'));
	assert(labels.includes('Backward design'));
	assert.deepStrictEqual(C.staticSolids(soko.model), [soko.model.names.wall.ids[0]]);
});

test('simplify keeps the shortest solution length and removes clutter', () => {
	const m = soko.model;
	const r = C.simplify(m, firstLevel.board, { budgetMs: 60000 });
	assert(r.ok);
	assert(r.changed > 0);
	assert.strictEqual(C.solve(m, r.board, { strategy: 'bfs', maxExpanded: 400000 }).solution.length, r.length);
	assert(C.countObjects(m, r.board) < C.countObjects(m, firstLevel.board));
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
