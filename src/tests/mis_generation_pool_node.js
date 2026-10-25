#!/usr/bin/env node
'use strict';

// Shared generation scheduling: injected worker handles, actual worker event
// loop in an isolated VM, and generator dedupe lifetime. No browser required.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const poolPath = path.join(__dirname, '../js/mis/mis_generation_pool.js');
const Pool = fs.existsSync(poolPath) ? require(poolPath) : {};
let passed = 0;
function test(name, fn) {
	try { fn(); passed++; console.log('ok   ' + name); }
	catch (e) { console.error('FAIL ' + name + '\n' + e.stack); process.exitCode = 1; }
}
function fixture(size, opts) {
	assert.strictEqual(typeof Pool.create, 'function', 'the shared pool must expose create');
	const handles = [], received = [];
	let changes = 0;
	const pool = Pool.create(Object.assign({ size, spawn() {
		const h = { ready: true, dead: false, messages: [], terminated: 0 };
		h.w = { postMessage(m) { h.messages.push(m); }, terminate() { h.terminated++; } };
		handles.push(h); return h;
	}, onMessage(id, worker, msg) { received.push({ id, worker, msg }); }, onChange() { changes++; } }, opts));
	return { pool, handles, received, changes: () => changes };
}
const assignments = h => h.messages[h.messages.length - 1].jobs;
const response = (j, extra) => Object.assign({ type: 'stats', jobId: j.jobId, revision: j.revision, generationEpoch: j.generationEpoch, stats: { generated: 1 } }, extra);

test('one bounded pool fairly partitions many levels and reuses idle workers', () => {
	const { pool, handles } = fixture(3);
	for (let i = 0; i < 8; i++) pool.start('level-' + i, { seed: 100, transform: 'x' });
	assert.strictEqual(handles.length, 3);
	assert.strictEqual(pool.workerCount(), 3);
	assert.strictEqual(pool.activeCount(), 8);
	assert.deepStrictEqual(handles.map(h => assignments(h).map(j => j.jobId)), [
		['level-0', 'level-3', 'level-6'], ['level-1', 'level-4', 'level-7'], ['level-2', 'level-5'],
	]);
	assert.strictEqual(assignments(handles[1])[0].seed, 100 + 7919);
	pool.stopAll();
	assert.strictEqual(pool.activeCount(), 0);
	assert(handles.every(h => assignments(h).length === 0));
	pool.start('resumed', { seed: 100 });
	assert.strictEqual(handles.length, 3);
	assert(handles.every(h => assignments(h)[0].jobId === 'resumed'));
	assert.strictEqual(new Set(handles.map(h => assignments(h)[0].seed)).size, 3);
	pool.destroy();
	assert(handles.every(h => h.terminated === 1));
});

test('replacement and pause drop stale revisions and remapped worker epochs', () => {
	const { pool, handles, received } = fixture(2);
	const revision = pool.start('a', { seed: 1 });
	const original = assignments(handles[0])[0], oldOther = assignments(handles[1])[0];
	pool.start('b', { seed: 2 });
	assert.strictEqual(assignments(handles[0])[0].revision, revision);
	assert.strictEqual(assignments(handles[0])[0].generationEpoch, original.generationEpoch);
	handles[0].onMessage(response(original));
	handles[1].onMessage(response(oldOther));
	assert.strictEqual(received.length, 1);
	pool.pause('b');
	const remapped = assignments(handles[1])[0];
	assert.notStrictEqual(remapped.generationEpoch, oldOther.generationEpoch);
	handles[1].onMessage(response(oldOther));
	handles[1].onMessage(response(remapped));
	assert.strictEqual(received.length, 2);
	pool.pause('a');
	assert(!pool.isRunning('a'));
	handles[0].onMessage(response(original));
	assert.strictEqual(received.length, 2);
	const next = pool.start('a', { seed: 1 });
	assert.notStrictEqual(next, revision);
	handles[0].onMessage(response(original, { type: 'genError' }));
	assert(pool.isRunning('a'), 'stale errors cannot pause a replacement');
	pool.destroy();
});

test('pausing an early job keeps unrelated worker contexts when loads are balanced', () => {
	const { pool, handles } = fixture(2);
	for (const id of ['a', 'b', 'c', 'd']) pool.start(id, {});
	const b = assignments(handles[1]).find(j => j.jobId === 'b');
	const d = assignments(handles[1]).find(j => j.jobId === 'd');
	pool.pause('a');
	assert(assignments(handles[1]).some(j => j.jobId === 'b' && j.generationEpoch === b.generationEpoch));
	assert(assignments(handles[1]).some(j => j.jobId === 'd' && j.generationEpoch === d.generationEpoch));
	pool.destroy();
});

test('underfilled pools retain surviving contexts and only fill freed workers', () => {
	for (const size of [3, 5]) {
		const { pool, handles } = fixture(size);
		for (const id of ['a', 'b', 'c']) pool.start(id, {});
		const previous = handles.map(h => assignments(h)[0]);
		pool.pause('a');
		previous.forEach(function (old, i) {
			if (old.jobId === 'a') return;
			const current = assignments(handles[i])[0];
			assert.strictEqual(current.jobId, old.jobId, 'worker ' + i + ' keeps its surviving level');
			assert.strictEqual(current.generationEpoch, old.generationEpoch, 'worker ' + i + ' keeps its search context');
		});
		const replicas = ['b', 'c'].map(id => handles.filter(h => assignments(h)[0].jobId === id).length);
		assert(Math.max(...replicas) - Math.min(...replicas) <= 1, 'freed workers balance replication');
		pool.start('a', {});
		const resumed = ['a', 'b', 'c'].map(id => handles.filter(h => assignments(h).some(j => j.jobId === id)).length);
		assert(Math.min(...resumed) > 0, 'a resumed level receives a worker');
		assert(Math.max(...resumed) - Math.min(...resumed) <= 1, 'adding a level balances replication');
		pool.destroy();
	}
});

test('worker post failure pauses assigned levels and spawning failures stay recoverable', () => {
	const f = fixture(1);
	f.pool.start('a', {});
	f.handles[0].w.postMessage = () => { throw new Error('worker gone'); };
	f.pool.start('b', {});
	assert.strictEqual(f.pool.activeCount(), 0);
	assert.strictEqual(f.pool.workerCount(), 0);
	assert.deepStrictEqual(f.received.map(r => r.id).sort(), ['a', 'b']);
	f.pool.start('c', {});
	assert.strictEqual(f.pool.workerCount(), 1);
	assert(f.pool.isRunning('c'));
	f.pool.destroy();
	const g = fixture(2, { spawn() { throw new Error('could not spawn'); } });
	g.pool.start('a', {});
	assert(!g.pool.isRunning('a'));
	assert.strictEqual(g.received[0].msg.message, 'could not spawn');
	g.pool.destroy();
});

test('readiness sends only current assignments and job errors pause only that level', () => {
	const { pool, handles, received } = fixture(1, { spawn() {
		const h = { ready: false, dead: false, messages: [], terminated: 0 };
		h.w = { postMessage(m) { h.messages.push(m); }, terminate() { h.terminated++; } };
		handles.push(h); return h;
	} });
	pool.start('a', {}); pool.start('b', {});
	const h = handles[0];
	assert.strictEqual(h.messages.length, 0);
	h.ready = true; h.onReady({ ok: true });
	assert.deepStrictEqual(assignments(h).map(j => j.jobId), ['a', 'b']);
	h.onMessage(response(assignments(h)[0], { type: 'genError', message: 'bad transform' }));
	assert(!pool.isRunning('a')); assert(pool.isRunning('b'));
	assert.strictEqual(received[0].id, 'a');
	assert.deepStrictEqual(assignments(h).map(j => j.jobId), ['b']);
	pool.destroy();
});

test('worker death, readiness failure and destruction callbacks cannot reenter loops', () => {
	const { pool, handles, received } = fixture(2);
	pool.start('a', {}); pool.start('b', {}); pool.start('c', {});
	handles[0].dead = true;
	handles[0].onMessage({ type: 'genError', message: 'worker crashed' });
	assert(!pool.isRunning('a')); assert(!pool.isRunning('c')); assert(pool.isRunning('b'));
	assert.deepStrictEqual(received.map(r => r.id).sort(), ['a', 'c']);
	pool.destroy(); pool.destroy();
	assert(handles.every(h => h.terminated <= 1));
	const f = fixture(1);
	f.pool.start('x', {});
	f.handles[0].onReady({ ok: false, errors: ['compile failed'] });
	assert.strictEqual(f.pool.activeCount(), 0);
	assert.strictEqual(f.received.length, 1);
	const g = fixture(1, { onChange() { g.pool.destroy(); } });
	g.pool.start('x', {});
	assert.strictEqual(g.pool.activeCount(), 0);
	assert(g.handles.every(h => h.terminated === 1));
	assert.strictEqual(g.pool.start('ignored', {}), undefined);
});

function workerFixture() {
	const messages = [], tasks = [], created = [], steps = [];
	let time = 0;
	const core = {
		extractModel() { return {}; },
		parseTransform(text) { return { statements: text === 'invalid' ? [] : [{}], errors: [] }; },
	};
	const sandbox = { console, Int32Array, Uint8Array, Set, Map, Date: { now() { time += 5; return time; } },
		importScripts() {}, misAfterEngineLoaded() {}, misCompile() { return { ok: true, errors: [] }; },
		MISCore: core, MISOptimizer: { prepare() { return { telemetry: {} }; }, createBackend() { return { assess() { return { status: 'solved', effort: 10, primaryMs: 1 }; } }; } },
		MISGenerator: { create(opts) {
			const id = opts.base.cells[0]; created.push(id); let count = 0;
			return { step() { steps.push(id); count++; if (id === 13) throw new Error('candidate failed'); return { board: opts.base, result: { effort: count, solution: [] } }; },
				stats() { return { generated: count }; }, profile() { return {}; }, arms() { return []; }, transforms() { return []; }, exhausted() { return false; } };
		} },
		MessageChannel: function () { this.port1 = {}; this.port2 = { postMessage: () => tasks.push(() => this.port1.onmessage()) }; },
	};
	sandbox.self = { postMessage(m) { messages.push(m); } };
	vm.createContext(sandbox);
	vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/mis/mis_worker.js'), 'utf8'), sandbox);
	const send = m => sandbox.self.onmessage({ data: m });
	send({ type: 'init', source: 'game', backend: 'js' });
	return { send, messages, created, steps, tick() { assert(tasks.length, 'a generation slice must be queued'); tasks.shift()(); }, queued: () => tasks.length };
}
const job = (id, revision = 1, epoch) => ({ jobId: 'level-' + id, revision, generationEpoch: epoch, base: { w: 1, h: 1, cells: [id] }, transform: 'x', seed: id });

test('worker initializes jobs lazily and rotates at generator step boundaries', () => {
	const f = workerFixture();
	f.send({ type: 'generationJobs', jobs: [job(1), job(2), job(3)] });
	assert.strictEqual(f.created.length, 0, 'assignments do not assess every seed synchronously');
	f.tick(); f.tick();
	assert.deepStrictEqual(f.steps.slice(0, 3), [1, 2, 3]);
	const replies = f.messages.filter(m => m.type === 'candidate');
	assert(replies.length >= 3);
	assert(replies.every(m => m.jobId && m.revision === 1 && m.generationEpoch !== undefined));
	assert.strictEqual(new Set(replies.slice(0, 3).map(m => m.generationEpoch)).size, 3);
});

test('worker reshuffling preserves contexts and rejects changed assignments with a new epoch', () => {
	const f = workerFixture();
	f.send({ type: 'generationJobs', jobs: [job(1, 1, 100), job(2, 1, 101)] });
	f.tick(); f.tick();
	const previous = f.messages.filter(m => m.type === 'candidate' && m.jobId === 'level-1').pop();
	f.send({ type: 'generationJobs', jobs: [job(1, 1, 100), job(3, 1, 102)] });
	f.tick(); f.tick();
	assert.strictEqual(f.created.filter(id => id === 1).length, 1);
	const current = f.messages.filter(m => m.type === 'candidate' && m.jobId === 'level-1').pop();
	assert.strictEqual(current.generationEpoch, previous.generationEpoch);
	assert(current.result.effort > previous.result.effort);
	f.send({ type: 'generationJobs', jobs: [job(1, 2, 103)] });
	f.tick();
	assert.strictEqual(f.created.filter(id => id === 1).length, 2);
	assert(f.messages.some(m => m.jobId === 'level-1' && m.revision === 2 && m.generationEpoch === 103));
	f.send({ type: 'generationJobs', jobs: [] });
	const count = f.steps.length;
	if (f.queued()) f.tick();
	assert.strictEqual(f.steps.length, count);
});

test('worker isolates asynchronous generator errors and supports replacing legacy generation', () => {
	const f = workerFixture();
	f.send({ type: 'generationJobs', jobs: [job(13), job(2)] });
	f.tick(); f.tick();
	const error = f.messages.find(m => m.type === 'genError');
	assert(error && error.jobId === 'level-13' && error.revision === 1 && error.generationEpoch !== undefined);
	assert(f.messages.some(m => m.type === 'candidate' && m.jobId === 'level-2'));
	f.send(Object.assign(job(3), { type: 'generate' }));
	f.tick();
	assert(f.steps.includes(3));
	f.send(Object.assign(job(4), { type: 'generate' }));
	const n = f.steps.length;
	f.tick();
	assert(f.steps.slice(n).every(id => id === 4));
});


// Run the real parser/compiler/optimizer/generator with manual MessageChannel
// delivery, so coexistence is checked without sleeps or a leaked test server.
test('real JS worker serves two levels, keeps the continuing context, and isolates invalid transforms', () => {
	const dir = path.join(__dirname, '../js/mis'), tasks = [], messages = [];
	const sandbox = { console, performance, setTimeout, clearTimeout,
		postMessage(m) { messages.push(m); },
		MessageChannel: function () { this.port1 = {}; this.port2 = { postMessage: () => tasks.push(() => this.port1.onmessage()) }; },
	};
	sandbox.self = sandbox;
	vm.createContext(sandbox);
	sandbox.importScripts = function (...files) {
		for (const f of files) {
			if (f.startsWith('wasm/')) throw new Error('JS-only fixture');
			vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), sandbox, { filename: f });
		}
	};
	vm.runInContext(fs.readFileSync(path.join(dir, 'mis_worker.js'), 'utf8'), sandbox);
	const send = m => sandbox.onmessage({ data: m });
	const source = fs.readFileSync(path.join(__dirname, '../demo/sokoban_basic.txt'), 'utf8');
	send({ type: 'init', source, backend: 'js' });
	assert(messages.some(m => m.type === 'ready' && m.ok));
	const base = vm.runInContext('model.levels.find(l => l.board).board', sandbox);
	const transform = 'choose 2 [ Wall ] -> [ ]\nchoose 1 [ no Wall no Crate no Player no Target ] -> [ Wall ]';
	const a = { jobId: 'a', revision: 1, generationEpoch: 1, base, transform, seed: 3 };
	const b = { jobId: 'b', revision: 1, generationEpoch: 2, base, transform, seed: 4 };
	const tick = () => { assert(tasks.length); tasks.shift()(); };
	send({ type: 'generationJobs', jobs: [a, b] });
	for (let i = 0; i < 20 && !['a', 'b'].every(id => messages.some(m => m.type === 'candidate' && m.jobId === id)); i++) tick();
	assert(['a', 'b'].every(id => messages.some(m => m.type === 'candidate' && m.jobId === id)), 'both real contexts produce candidates');
	const before = messages.filter(m => m.type === 'candidate' && m.jobId === 'a').length;
	send({ type: 'generationJobs', jobs: [a] });
	const retained = vm.runInContext('generationJobs[0].gen.stats().generated', sandbox);
	assert(retained > 0);
	for (let i = 0; i < 4; i++) tick();
	assert(messages.filter(m => m.type === 'candidate' && m.jobId === 'a').length > before);
	const marker = messages.length;
	send({ type: 'generationJobs', jobs: [Object.assign({}, a, { revision: 2, generationEpoch: 3, transform: '' }), Object.assign({}, b, { generationEpoch: 4 })] });
	for (let i = 0; i < 4; i++) tick();
	assert(messages.slice(marker).some(m => m.type === 'genError' && m.jobId === 'a' && m.revision === 2 && m.generationEpoch === 3));
	assert(vm.runInContext("generationJobs.length === 1 && generationJobs[0].msg.jobId === 'b' && generationJobs[0].gen.stats().generated > 0", sandbox), 'the other real job continues sampling after the error');
	send({ type: 'generationJobs', jobs: [] });
	if (tasks.length) tick();
	assert.strictEqual(tasks.length, 0);
});

function generatorFixture(opts) {
	let n = 0, assessments = 0;
	const sandbox = { performance: { now() { return n; } }, MISCore: {
		makeRng() { return () => 0.5; }, cellsKey(cells) { return String(cells[0]); },
		runTransform() { n++; return { cells: new Int32Array([opts.sample(n)]) }; }, boardDiffCount() { return 1; },
	} };
	vm.createContext(sandbox);
	vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/mis/mis_generator.js'), 'utf8') + '\nthis.create = MISGenerator.create;', sandbox);
	const gen = sandbox.create(Object.assign({ model: { stride: 1 }, program: { statements: [{}] }, base: { cells: new Int32Array([0]) }, backend: { assess() { assessments++; return { status: 'unsolvable' }; } } }, opts));
	return { gen, assessments: () => assessments };
}

test('generator internal seen set evicts oldest entries at explicit and default bounds', () => {
	const f = generatorFixture({ maxSeen: 3, sample: n => n <= 4 ? n : 1 });
	for (let i = 0; i < 5; i++) f.gen.step();
	assert.strictEqual(f.assessments(), 5, 'the oldest sampled key is eligible after eviction');
	const g = generatorFixture({ sample: n => n <= 20001 ? n : 1 });
	for (let i = 0; i < 20002; i++) g.gen.step();
	assert.strictEqual(g.assessments(), 20002, 'overnight contexts default to a bounded 20000-key window');
});

test('generator does not evict caller-owned shared dedupe entries', () => {
	const seen = new Set(['external']);
	const f = generatorFixture({ seen, maxSeen: 3, sample: n => n <= 4 ? n : 1 });
	for (let i = 0; i < 5; i++) f.gen.step();
	assert.strictEqual(f.assessments(), 4);
	assert(seen.has('external') && seen.has('1'));
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
