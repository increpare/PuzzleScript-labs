'use strict';

// PuzzleScript+MIS (web prototype) - solver/generator worker.
//
// Each worker owns its own copy of the engine. The page cancels work by
// terminating the worker, so loops here don't need to poll for stop requests.

importScripts('mis_shims.js');
importScripts(
	'../storagewrapper.js', '../bitvec.js', '../level.js', '../languageConstants.js',
	'../globalVariables.js', '../debug.js', '../plugin_header_on.js', '../font.js', '../rng.js',
	'../riffwave.js', '../sfxr.js', '../codemirror/stringstream.js', '../colorhelpers.js',
	'../colors.js', '../engine.js', '../parser.js', '../compiler.js', '../soundbar.js'
);
misAfterEngineLoaded();
importScripts('mis_core.js');
importScripts('mis_native.js');
importScripts('mis_generator.js');

let model = null;
// Solver backend: the WebAssembly build of the native solver when available
// (native/wasm/build_mis_wasm.sh), otherwise the JS engine solver in MISCore.
let native = null;
let backendNote = '';

function loadNative() {
	if (loadNative.promise) return loadNative.promise;
	loadNative.promise = new Promise(function (resolve) {
		try {
			importScripts('wasm/mis_native.js');
		} catch (e) {
			resolve(null);
			return;
		}
		createMisNative({ locateFile: function (p) { return 'wasm/' + p; } })
			.then(function (M) { resolve(M); }, function () { resolve(null); });
	});
	return loadNative.promise;
}

const backend = {
	assess: function (board, opts) { return native ? native.assess(board, opts) : MISCore.assess(model, board, opts); },
	solve: function (board, opts) { return native ? native.solve(board, opts) : MISCore.solve(model, board, opts); },
	simplify: function (board, opts) {
		// The native simplifier only removes; Tighten stays on the JS path.
		if (native && (opts.mode || 'simplify') === 'simplify') {
			const r = native.simplify(board, opts);
			if (r.ok || !/time budget|in time/.test(r.reason || '')) return r;
		}
		return MISCore.simplify(model, board, opts);
	},
};

function reply(msg) { self.postMessage(msg); }

function boardFrom(msg) {
	return { w: msg.w, h: msg.h, cells: new Int32Array(msg.cells) };
}

function packResult(r) {
	return {
		status: r.status, effort: r.effort, length: r.length, lanes: r.lanes,
		solution: r.solution, optimal: r.optimal, ms: r.ms,
	};
}

self.onmessage = function (e) {
	const msg = e.data;
	try {
		if (msg.type === 'init') {
			const res = misCompile(msg.source);
			model = res.ok ? MISCore.extractModel(msg.source) : null;
			native = null;
			if (!model || msg.backend === 'js') {
				backendNote = msg.backend === 'js' ? 'JS solver (chosen)' : '';
				reply({ type: 'ready', ok: !!model, errors: res.errors, backend: 'js', note: backendNote });
				return;
			}
			loadNative().then(function (M) {
				if (!M) { backendNote = 'native solver not built — using JS'; }
				else {
					const n = MISNative.create(M);
					const attached = n.attach(msg.source, model);
					if (attached.ok) { native = n; backendNote = 'native solver (WebAssembly)'; }
					else backendNote = attached.reason + ' — using JS';
				}
				reply({ type: 'ready', ok: true, errors: res.errors, backend: native ? 'native' : 'js', note: backendNote });
			});
		} else if (msg.type === 'assess') {
			const r = backend.assess(boardFrom(msg.board), msg.opts || {});
			reply({ type: 'assessed', id: msg.id, result: packResult(r) });
		} else if (msg.type === 'simplify') {
			const r = backend.simplify(boardFrom(msg.board), Object.assign({}, msg.opts, {
				onProgress: function (done, total) { reply({ type: 'progress', id: msg.id, done: done, total: total }); },
			}));
			if (r.ok) r.board = { w: r.board.w, h: r.board.h, cells: Array.from(r.board.cells) };
			reply({ type: 'simplified', id: msg.id, result: r });
		} else if (msg.type === 'prove') {
			// Shortest solution for a suggestion card (the generator leaves proofs
			// to whoever shows the candidate).
			const r = backend.solve(boardFrom(msg.board), Object.assign({ strategy: 'bfs' }, msg.opts));
			reply({ type: 'proved', id: msg.id, result: { status: r.status, solution: r.status === 'solved' ? r.solution : null } });
		} else if (msg.type === 'generate') {
			generate(msg);
		}
	} catch (err) {
		reply({ type: 'error', id: msg.id, message: String(err && err.message || err), stack: err && err.stack });
	}
};

/////////////////////////////////////////////////////////////////////
// Generation loop (logic in mis_generator.js)
/////////////////////////////////////////////////////////////////////

function generate(msg) {
	const program = MISCore.parseTransform(msg.transform, model);
	if (!program.statements.length) {
		reply({ type: 'genError', message: program.errors.length ? program.errors[0].message : 'The transform is empty.' });
		return;
	}
	const base = boardFrom(msg.base);
	// Baseline for the adaptive step size's reward: the level being improved.
	// The base's own primary solve time sets the per-candidate solver budget.
	let baseEffort = msg.baseEffort, seedPrimaryMs;
	if (!(baseEffort > 0)) {
		const r = backend.assess(base, { timeMs: 3000, maxExpanded: 400000, refineGate: 0 });
		baseEffort = r.status === 'solved' ? r.effort : 0;
		if (r.status === 'solved') seedPrimaryMs = r.primaryMs;
	} else {
		const r = backend.assess(base, { timeMs: 3000, maxExpanded: 400000, refine: false });
		if (r.status === 'solved') seedPrimaryMs = r.primaryMs;
	}
	const gen = MISGenerator.create({
		model: model, backend: backend, program: program, base: base, baseEffort: baseEffort, seedPrimaryMs: seedPrimaryMs, adaptive: msg.adaptive !== false,
		frozen: msg.frozen ? new Uint8Array(msg.frozen) : null, seed: msg.seed, keep: msg.keep || 8,
		optimalCap: msg.optimalCap, initialBudgetMs: msg.initialBudgetMs, maxBudgetMs: msg.maxBudgetMs,
		shard: msg.shardCount > 1 ? { index: msg.shardIndex, count: msg.shardCount } : null,
		pipeline: msg.pipeline,
	});
	let lastStats = 0;
	function flushStats(force) {
		const t = Date.now();
		if (force || t - lastStats > 250) {
			lastStats = t;
			reply({ type: 'stats', stats: Object.assign({}, gen.stats()), profile: Object.assign({}, gen.profile()), arms: gen.arms(), exhausted: gen.exhausted() });
		}
	}
	function step() {
		const found = gen.step();
		if (found) {
			const r = found.result;
			reply({
				type: 'candidate',
				board: { w: found.board.w, h: found.board.h, cells: Array.from(found.board.cells) },
				result: { status: 'solved', effort: r.effort, length: r.length, lanes: r.lanes, solution: r.solution, optimal: r.optimal, refined: !!r.refined },
			});
		}
		flushStats();
	}

	// Yield between slices so messages get through; MessageChannel avoids the
	// 4ms clamp browsers apply to nested setTimeout(0).
	const tick = new MessageChannel();
	function loop() {
		const until = Date.now() + 40;
		do { step(); } while (Date.now() < until);
		tick.port2.postMessage(null);
	}
	tick.port1.onmessage = loop;
	flushStats(true);
	loop();
}
