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

	await test('rule check: the push rule is required', async () => {
		await init(demo);
		const board = firstBoard(demo);
		const progress = [];
		const msgs = await send({ type: 'ruleCheck', id: 1, board, lines: [DEMO_PUSH_LINE], timeMs: 20000 },
			m => { if (m.type === 'progress') progress.push(m.line); return m.type === 'ruleChecked'; });
		assert.deepStrictEqual(progress, [DEMO_PUSH_LINE]);
		assert.strictEqual(msgs[msgs.length - 1].result[DEMO_PUSH_LINE].status, 'required');
	});

	await test('rule check: boring through walls is a shortcut', async () => {
		await init(GAME);
		const board = firstBoard(GAME);
		const msgs = await send({ type: 'ruleCheck', id: 2, board, lines: [BORE_LINE], timeMs: 20000, maxExpanded: 2000000 }, m => m.type === 'ruleChecked');
		const done = msgs[msgs.length - 1];
		assert.strictEqual(done.result[BORE_LINE].status, 'shortcut');
		assert(done.result[BORE_LINE].length > done.shortest, 'without boring, the solution is longer');
	});

	await test('rule check: a rule that never fires in a shortest solution is optional without searching', async () => {
		await init(GAME);
		const board = firstBoard(demo);
		const msgs = await send({ type: 'ruleCheck', id: 3, board, lines: [SOUND_LINE], timeMs: 20000 }, m => m.type === 'ruleChecked');
		assert.strictEqual(msgs[msgs.length - 1].result[SOUND_LINE].status, 'optional');
	});

	await test('generator: banning the push rule rejects every solvable candidate', async () => {
		await init(demo);
		const board = firstBoard(demo);
		let stats = null, candidates = 0;
		await new Promise(resolve => {
			listener = m => {
				if (m.type === 'candidate') candidates++;
				if (m.type === 'stats') { stats = m.stats; if (stats.solved >= 5) { listener = null; resolve(); } }
			};
			self.onmessage({ data: {
				type: 'generate', base: board, transform: 'choose 2 [ Wall ] -> [ ]\nchoose 1 [ no Wall no Crate no Player no Target ] -> [ Wall ]',
				goals: { need: [], ban: [DEMO_PUSH_LINE] }, seed: 3, keep: 4,
			} });
		});
		assert.strictEqual(candidates, 0);
		assert.strictEqual(stats.offGoal, stats.solved);
	});

	await test('generator: needing the push rule keeps candidates', async () => {
		await init(demo);
		const board = firstBoard(demo);
		const found = [];
		await new Promise(resolve => {
			listener = m => { if (m.type === 'candidate') { found.push(m); if (found.length >= 2) { listener = null; resolve(); } } };
			self.onmessage({ data: {
				type: 'generate', base: board, transform: 'choose 2 [ Wall ] -> [ ]\nchoose 1 [ no Wall no Crate no Player no Target ] -> [ Wall ]',
				goals: { need: [DEMO_PUSH_LINE], ban: [] }, seed: 4, keep: 4,
			} });
		});
		assert.strictEqual(found.length, 2);
	});

	await test('generator: banning a rule that fires but gives no shortcut keeps candidates', async () => {
		const soundGame = demo.replace(PUSH, PUSH + '\n[ Crate Target ] -> [ Crate Target ] sfx0')
			.replace('Crate move 36772507', 'Crate move 36772507\nsfx0 36772507');
		const soundLine = lineOf(soundGame, '[ Crate Target ] -> [ Crate Target ] sfx0');
		await init(soundGame);
		const board = firstBoard(soundGame);
		const found = [];
		await new Promise(resolve => {
			listener = m => { if (m.type === 'candidate') { found.push(m); if (found.length >= 2) { listener = null; resolve(); } } };
			self.onmessage({ data: {
				type: 'generate', base: board, transform: 'choose 2 [ Wall ] -> [ ]\nchoose 1 [ no Wall no Crate no Player no Target ] -> [ Wall ]',
				goals: { need: [], ban: [soundLine] }, seed: 6, keep: 4,
			} });
		});
		assert.strictEqual(found.length, 2);
	});

	console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
	process.exit(process.exitCode || 0);
})();
