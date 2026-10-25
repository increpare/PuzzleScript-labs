#!/usr/bin/env node
'use strict';

// Rule goals in the MIS95 worker (src/js/mis/mis_worker.js), run in Node with
// the JS solver: per-rule checks, cosmetic line tags, and generator filtering.
//
//   node src/tests/mis_rule_goals_node.js

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const misDir = path.join(__dirname, '..', 'js', 'mis');
const demo = fs.readFileSync(path.join(__dirname, '..', 'demo', 'sokoban_basic.txt'), 'utf8');

// Worker globals: scripts load into this context, replies are collected.
global.window = global;
global.self = global;
global.document = {
	URL: 'mis://', body: { classList: { contains() { return false; } }, addEventListener() {}, removeEventListener() {} },
	createElement() { return { style: {}, getContext() { return null; } }; }, getElementById() { return null; },
};
let listener = null;
global.postMessage = function (msg) { if (listener) listener(msg); };
global.importScripts = function (...files) {
	for (const f of files) {
		if (f.startsWith('wasm/')) throw new Error('no wasm in this test');
		vm.runInThisContext(fs.readFileSync(path.join(misDir, f), 'utf8'), { filename: f });
	}
};
vm.runInThisContext(fs.readFileSync(path.join(misDir, 'mis_worker.js'), 'utf8'), { filename: 'mis_worker.js' });

function send(msg, until) {
	return new Promise(resolve => {
		const seen = [];
		listener = m => { seen.push(m); if (until(m)) { listener = null; resolve(seen); } };
		self.onmessage({ data: msg });
	});
}

let passed = 0;
async function test(name, fn) {
	try { await fn(); passed++; console.log('ok   ' + name); }
	catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e)); process.exitCode = 1; }
}

const PUSH = '[ > Player | Crate ] -> [ > Player | > Crate ]';
// Adds a rule that bores through walls and a sound-only rule.
const GAME = demo.replace(PUSH, PUSH + '\n[ > Player | Wall ] -> [ > Player | ]\n[ Crate Target ] -> [ Crate Target ] sfx0')
	.replace('Crate move 36772507', 'Crate move 36772507\nsfx0 36772507');
const lineOf = (text, rule) => text.split('\n').map(l => l.trim()).indexOf(rule) + 1;
const PUSH_LINE = lineOf(GAME, PUSH), BORE_LINE = lineOf(GAME, '[ > Player | Wall ] -> [ > Player | ]');
const SOUND_LINE = lineOf(GAME, '[ Crate Target ] -> [ Crate Target ] sfx0');
const DEMO_PUSH_LINE = lineOf(demo, PUSH);
assert(PUSH_LINE > 0 && BORE_LINE === PUSH_LINE + 1 && SOUND_LINE === PUSH_LINE + 2);

async function init(source) {
	const [ready] = await send({ type: 'init', source, backend: 'js' }, m => m.type === 'ready');
	assert(ready.ok, 'game compiles');
	return ready;
}

// A rule that can never fire: Player and Crate share a collision layer.
const DEAD = '[ Player Target ] [ Crate Player ] -> [ Player Target ] [ ]';
const DEAD_GAME = demo.replace(PUSH, PUSH + '\n' + DEAD);
const DEAD_LINE = lineOf(DEAD_GAME, DEAD);

function solutionFor(source, board) {
	misCompile(source);
	const model = MISCore.extractModel(source);
	return MISCore.solve(model, { w: board.w, h: board.h, cells: new Int32Array(board.cells) }, { strategy: 'bfs', maxExpanded: 0 }).solution;
}

function firstBoard(source) {
	misCompile(source);
	const model = MISCore.extractModel(source);
	const b = model.levels.find(l => l.board).board;
	return { w: b.w, h: b.h, cells: Array.from(b.cells) };
}

(async () => {
	await test('ready tags sound-only lines inert; boring through walls is not cosmetic', async () => {
		const ready = await init(GAME);
		assert.deepStrictEqual(ready.ruleTags, { [SOUND_LINE]: 'inert' });
	});

	await test('rule check: every solution pushes, so push is required', async () => {
		const board = firstBoard(demo);
		const solution = solutionFor(demo, board);
		await init(demo);
		const progress = [];
		const msgs = await send({ type: 'ruleCheck', id: 1, board, solution, lines: [DEMO_PUSH_LINE], banLines: [DEMO_PUSH_LINE] },
			m => { if (m.type === 'progress') progress.push(m.line); return m.type === 'ruleChecked'; });
		assert.deepStrictEqual(progress, [DEMO_PUSH_LINE]);
		assert.deepStrictEqual(msgs[msgs.length - 1].result[DEMO_PUSH_LINE], { need: 'required', ban: 'used' });
	});

	await test('rule check: boring through walls is optional, and some solution uses it', async () => {
		const board = firstBoard(GAME);
		const solution = solutionFor(GAME, board);
		await init(GAME);
		const msgs = await send({ type: 'ruleCheck', id: 2, board, solution, lines: [BORE_LINE], banLines: [BORE_LINE] }, m => m.type === 'ruleChecked');
		assert.deepStrictEqual(msgs[msgs.length - 1].result[BORE_LINE], { need: 'optional', ban: 'used' });
	});

	await test('rule check: a rule that can never fire is optional and never used', async () => {
		const board = firstBoard(DEAD_GAME);
		const solution = solutionFor(DEAD_GAME, board);
		await init(DEAD_GAME);
		const msgs = await send({ type: 'ruleCheck', id: 3, board, solution, lines: [DEAD_LINE], banLines: [DEAD_LINE] }, m => m.type === 'ruleChecked');
		assert.deepStrictEqual(msgs[msgs.length - 1].result[DEAD_LINE], { need: 'optional', ban: 'never' });
	});

	const TRANSFORM = 'choose 2 [ Wall ] -> [ ]\nchoose 1 [ no Wall no Crate no Player no Target ] -> [ Wall ]';
	function generate(goals, seed, until) {
		return new Promise(resolve => {
			let stats = null, candidates = 0;
			listener = m => {
				if (m.type === 'candidate') candidates++;
				if (m.type === 'stats') stats = m.stats;
				if (stats && until(stats, candidates)) { listener = null; resolve({ stats, candidates }); }
			};
			self.onmessage({ data: { type: 'generate', base: firstBoard(DEAD_GAME), transform: TRANSFORM, goals, seed, keep: 4 } });
		});
	}

	await test('generator: banning the push rule rejects every solvable candidate', async () => {
		await init(DEAD_GAME);
		const { stats, candidates } = await generate({ need: [], ban: [DEMO_PUSH_LINE] }, 3, s => s.solved >= 5);
		assert.strictEqual(candidates, 0);
		assert.strictEqual(stats.offGoal, stats.solved);
	});

	await test('generator: needing push and banning a rule that never fires keeps candidates', async () => {
		await init(DEAD_GAME);
		const { candidates } = await generate({ need: [DEMO_PUSH_LINE], ban: [DEAD_LINE] }, 4, (s, n) => n >= 2);
		assert(candidates >= 2);
	});

	console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
	process.exit(process.exitCode || 0);
})();
