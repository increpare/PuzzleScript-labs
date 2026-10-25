#!/usr/bin/env node
'use strict';

// Board geometry for MIS95: node src/tests/mis_board_node.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const srcDir = path.join(__dirname, '..');
const boardPath = path.join(srcDir, 'js/mis/mis_board.js');
let passed = 0;
function test(name, body) {
	try { body(); passed++; console.log('ok   ' + name); }
	catch (error) { console.error('FAIL ' + name + '\n' + (error.stack || error)); process.exitCode = 1; }
}

test('board helper exists', () => assert(fs.existsSync(boardPath), 'MISBoard should provide board creation and resizing'));
if (!fs.existsSync(boardPath)) process.exit(1);
const B = require(boardPath);

test('standalone CommonJS import creates a board without engine globals', () => {
	const script = `
		const assert = require('assert');
		const B = require(${JSON.stringify(boardPath)});
		const model = { stride: 2, backgroundId: 35, backgroundLayer: 0, layerMasks: [new Int32Array([0, 8])] };
		const board = B.create(model, 2, 3);
		assert.strictEqual(board.w, 2);
		assert.strictEqual(board.h, 3);
		assert.deepStrictEqual(Array.from(board.cells), [0, 8, 0, 8, 0, 8, 0, 8, 0, 8, 0, 8]);
	`;
	execFileSync(process.execPath, ['-e', script], { stdio: 'pipe' });
});

// Use the real engine/model and background implementation, as in mis_core_node.
global.window = global;
const storage = Object.create(null);
Object.defineProperty(global, 'localStorage', { configurable: true, value: {
	getItem(key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
	setItem(key, value) { storage[key] = String(value); },
	removeItem(key) { delete storage[key]; },
} });
const files = [
	'js/mis/mis_shims.js', 'js/storagewrapper.js', 'js/bitvec.js', 'js/level.js',
	'js/languageConstants.js', 'js/globalVariables.js', 'js/debug.js', 'js/plugin_header_on.js',
	'js/font.js', 'js/rng.js', 'js/riffwave.js', 'js/sfxr.js', 'js/codemirror/stringstream.js',
	'js/colorhelpers.js', 'js/colors.js', 'js/engine.js', 'js/parser.js', 'js/compiler.js', 'js/soundbar.js',
];
let code = files.map(file => fs.readFileSync(path.join(srcDir, file), 'utf8')).join('\n');
code += '\nmisAfterEngineLoaded();\n' + fs.readFileSync(path.join(srcDir, 'js/mis/mis_core.js'), 'utf8');
code += '\nglobal.MISCore = MISCore; global.misCompile = misCompile;\n';
vm.runInThisContext(code, { filename: 'mis_board_engine.js' });
const C = global.MISCore;
function compileModel(source) {
	const result = misCompile(source);
	assert(result.ok && !result.hasErrors, JSON.stringify(result.errors));
	return C.extractModel(source);
}
const demo = fs.readFileSync(path.join(srcDir, 'demo/sokoban_basic.txt'), 'utf8');
const model = compileModel(demo);
function tileWords(board, x, y, stride) {
	const offset = (x * board.h + y) * stride;
	return Array.from(board.cells.slice(offset, offset + stride));
}
function assertBackground(m, board, x, y) {
	const expected = new Int32Array(m.stride);
	C.ensureBackground(m, expected, 0);
	assert.deepStrictEqual(tileWords(board, x, y, m.stride), Array.from(expected), 'background at ' + x + ',' + y);
}
function markedBoard(m, w, h) {
	const board = B.create(m, w, h);
	for (let tile = 0; tile < w * h; tile++) {
		for (let word = 0; word < m.stride; word++) board.cells[tile * m.stride + word] = (tile + 1) * 100 + word;
	}
	return board;
}

test('CommonJS and browser APIs expose creation, resizing and bounds', () => {
	assert.strictEqual(typeof B.create, 'function');
	assert.strictEqual(typeof B.resize, 'function');
	assert.strictEqual(B.MAX_DIMENSION, 128);
	assert.strictEqual(B.MAX_CELLS, 16384);
	const browser = vm.createContext({ MISCore: C, Int32Array, Uint8Array });
	vm.runInContext(fs.readFileSync(boardPath, 'utf8'), browser);
	const browserBoard = vm.runInContext('MISBoard.create', browser)(model, 2, 3);
	assert.strictEqual(browserBoard.cells.length, 6 * model.stride);
});

test('create fills every asymmetric board tile with the model background', () => {
	const board = B.create(model, 3, 2);
	assert.strictEqual(board.w, 3);
	assert.strictEqual(board.h, 2);
	assert(board.cells instanceof Int32Array);
	assert.strictEqual(board.cells.length, 6 * model.stride);
	for (let x = 0; x < 3; x++) for (let y = 0; y < 2; y++) assertBackground(model, board, x, y);
	assert.strictEqual(B.create(model, 128, 128).cells.length, 16384 * model.stride);
});

test('create rejects fractional, nonnumeric, empty and oversized dimensions', () => {
	for (const [w, h] of [[0, 2], [2, -1], [1.5, 2], [2, NaN], [Infinity, 2], ['2', 2], [129, 1], [1, 129]]) {
		assert.throws(() => B.create(model, w, h), /dimensions|width|height/i, String(w) + ' x ' + h);
	}
});

test('invalid background metadata is rejected before allocating a board', () => {
	for (const changes of [
		{ backgroundId: -1 }, { backgroundId: 0.5 }, { backgroundId: model.stride * 32 },
		{ backgroundLayer: -1 }, { backgroundLayer: 999 }, { layerMasks: [] },
		{ layerMasks: model.layerMasks.map(mask => new Int32Array(mask.length)) },
	]) assert.throws(() => B.create(Object.assign({}, model, changes), 2, 2), /background/i);
	assert.throws(() => B.create(Object.assign({}, model, { stride: 0 }), 2, 2), /stride/i);
});

test('each expanded edge places retained column-major cells at its own offset', () => {
	const board = markedBoard(model, 3, 2);
	for (const [edge, dx, dy, w, h] of [['left', 2, 0, 5, 2], ['right', 0, 0, 5, 2], ['top', 0, 2, 3, 4], ['bottom', 0, 0, 3, 4]]) {
		const out = B.resize(model, board, { [edge]: 2 });
		assert.strictEqual(out.board.w, w, edge);
		assert.strictEqual(out.board.h, h, edge);
		for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
			if (x >= dx && x < dx + board.w && y >= dy && y < dy + board.h) {
				assert.deepStrictEqual(tileWords(out.board, x, y, model.stride), tileWords(board, x - dx, y - dy, model.stride), edge);
			} else assertBackground(model, out.board, x, y);
		}
		assert(out.locks instanceof Uint8Array);
		assert.strictEqual(out.locks.length, w * h);
		assert(out.locks.every(lock => lock === 0));
	}
});

test('each cropped edge discards the correct rows or columns', () => {
	const board = markedBoard(model, 4, 3);
	for (const [edge, dx, dy, w, h] of [['left', 1, 0, 3, 3], ['right', 0, 0, 3, 3], ['top', 0, 1, 4, 2], ['bottom', 0, 0, 4, 2]]) {
		const out = B.resize(model, board, { [edge]: -1 });
		assert.strictEqual(out.board.w, w);
		assert.strictEqual(out.board.h, h);
		for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
			assert.deepStrictEqual(tileWords(out.board, x, y, model.stride), tileWords(board, x + dx, y + dy, model.stride), edge);
		}
	}
});

test('mixed asymmetric cropping and expansion translates locks with the cells', () => {
	const board = markedBoard(model, 4, 3);
	const locks = new Uint8Array([1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1]);
	const beforeCells = new Int32Array(board.cells), beforeLocks = new Uint8Array(locks);
	const out = B.resize(model, board, { left: -1, right: 2, top: 2, bottom: -1 }, locks);
	assert.strictEqual(out.board.w, 5);
	assert.strictEqual(out.board.h, 4);
	for (let x = 0; x < 5; x++) for (let y = 0; y < 4; y++) {
		if (x < 3 && y >= 2) {
			assert.deepStrictEqual(tileWords(out.board, x, y, model.stride), tileWords(board, x + 1, y - 2, model.stride));
			assert.strictEqual(out.locks[x * 4 + y], locks[(x + 1) * 3 + y - 2]);
		} else {
			assertBackground(model, out.board, x, y);
			assert.strictEqual(out.locks[x * 4 + y], 0);
		}
	}
	assert.deepStrictEqual(board.cells, beforeCells);
	assert.deepStrictEqual(locks, beforeLocks);
});

test('zero deltas return independently owned board and lock storage', () => {
	const board = markedBoard(model, 2, 3);
	const locks = new Uint8Array([1, 0, 1, 0, 1, 0]);
	const out = B.resize(model, board, {}, locks);
	assert.notStrictEqual(out.board, board);
	assert.notStrictEqual(out.board.cells.buffer, board.cells.buffer);
	assert.notStrictEqual(out.locks.buffer, locks.buffer);
	assert.deepStrictEqual(out.board.cells, board.cells);
	assert.deepStrictEqual(out.locks, locks);
	out.board.cells[0] = 0; out.locks[0] = 0;
	assert.strictEqual(board.cells[0], 100);
	assert.strictEqual(locks[0], 1);
	const other = B.create(model, 2, 3);
	assert.notStrictEqual(other.cells.buffer, B.create(model, 2, 3).cells.buffer);
});

test('oversized imported boards can shrink to the bounded output dimensions', () => {
	for (const [w, h, deltas, dx, dy] of [
		[130, 3, { left: -1, right: -1 }, 1, 0],
		[2, 130, { top: -2 }, 0, 2],
	]) {
		const board = { w, h, cells: new Int32Array(w * h * model.stride) };
		const locks = new Uint8Array(w * h);
		for (let tile = 0; tile < w * h; tile++) {
			for (let word = 0; word < model.stride; word++) board.cells[tile * model.stride + word] = tile * 100 + word;
			locks[tile] = tile % 2;
		}
		const out = B.resize(model, board, deltas, locks);
		assert.strictEqual(out.board.w, w === 130 ? 128 : w);
		assert.strictEqual(out.board.h, h === 130 ? 128 : h);
		for (let x = 0; x < out.board.w; x++) for (let y = 0; y < out.board.h; y++) {
			assert.deepStrictEqual(tileWords(out.board, x, y, model.stride), tileWords(board, x + dx, y + dy, model.stride));
			assert.strictEqual(out.locks[x * out.board.h + y], locks[(x + dx) * h + y + dy]);
		}
		assert.throws(() => B.resize(model, board, {}), /dimensions/i, 'output remains bounded');
	}
});

test('resize rejects invalid deltas, empty results, malformed cells and locks', () => {
	const board = B.create(model, 3, 2);
	for (const [w, h] of [[0, 2], [-1, 2], [1.5, 2], [2, NaN], [Infinity, 2]]) {
		assert.throws(() => B.resize(model, { w, h, cells: new Int32Array() }, {}), /dimensions/i);
	}
	for (const deltas of [{ left: 0.5 }, { right: '1' }, { top: NaN }, { bottom: Infinity }, { left: -3 }, { bottom: -2 }, { right: 126 }]) {
		assert.throws(() => B.resize(model, board, deltas), /integer|dimensions|width|height/i);
	}
	assert.throws(() => B.resize(model, { w: 3, h: 2, cells: new Int32Array(5 * model.stride) }, {}), /cells|board/i);
	assert.throws(() => B.resize(model, board, {}, new Uint8Array(5)), /lock/i);
	assert.throws(() => B.resize(model, board, {}, [1, 0, 0, 0, 0, 0]), /lock/i);
});

// Put background and player in the second word to catch one-word assumptions.
const extras = Array.from({ length: 34 }, (_, n) => 'Extra' + n);
const wideSource = 'title Multiword geometry\n\nOBJECTS\n\n' + extras.concat(['Background', 'Player']).map(name => name + '\nwhite\n').join('\n') +
	'\nLEGEND\n\n. = Background\nP = Player\n\nSOUNDS\n\nCOLLISIONLAYERS\n\n' + extras.concat(['Background', 'Player']).join('\n') +
	'\n\nRULES\n\nWINCONDITIONS\n\nno Player\n\nLEVELS\n\nP.\n..\n';

test('multiword cells and high background IDs survive resize without truncation', () => {
	const m = compileModel(wideSource);
	assert(m.stride > 1 && m.backgroundId >= 32, 'fixture must exercise second-word background');
	const board = B.create(m, 2, 3);
	const extraIds = [m.names.extra0.ids[0], m.names.extra33.ids[0], m.names.player.ids[0]];
	for (let tile = 0; tile < 6; tile++) C.setBit(board.cells, tile, extraIds[tile % extraIds.length], m.stride);
	const out = B.resize(m, board, { left: 1, right: 2, top: -1, bottom: 1 });
	for (let x = 0; x < 5; x++) for (let y = 0; y < 3; y++) {
		if (x >= 1 && x < 3 && y < 2) assert.deepStrictEqual(tileWords(out.board, x, y, m.stride), tileWords(board, x - 1, y + 1, m.stride));
		else assertBackground(m, out.board, x, y);
	}
});

test('created and resized multiword boards round-trip through real source compilation', () => {
	let m = compileModel(wideSource);
	const blank = B.create(m, 3, 2);
	let source = C.insertLevelInSource(m, wideSource, 0, blank);
	m = compileModel(source);
	assert(C.boardsEqual(m.levels[1].board, blank));
	const original = m.levels[0].board;
	const resized = B.resize(m, original, { left: 2, right: -1, top: 1, bottom: 2 }).board;
	source = C.writeLevelToSource(m, source, 0, resized);
	const roundTrip = compileModel(source);
	assert(C.boardsEqual(roundTrip.levels[0].board, resized));
	assert(C.boardsEqual(roundTrip.levels[1].board, blank));
});

if (!process.exitCode) console.log('\n' + passed + ' MIS board tests passed.');
