'use strict';

// MIS95 - solver/generator worker.
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
importScripts('../semantic_compile.js', 'mis_optimizer_bundle.js');

let model = null;
let gameSource = '';
// Solver backend: the WebAssembly build of the native solver when available
// (native/wasm/build_mis_wasm.sh), otherwise the JS engine solver in MISCore.
let native = null;
let backendNote = '';
let solverBackend = null;
let preparation = null;

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
	assess: function (board, opts) { return solverBackend.assess(board, opts); },
	solve: function (board, opts) { return solverBackend.solve(board, opts); },
	simplify: function (board, opts) { return solverBackend.simplify(board, opts); },
};

function reply(msg) { self.postMessage(msg); }

function boardFrom(msg) {
	return { w: msg.w, h: msg.h, cells: new Int32Array(msg.cells) };
}

function packResult(r) {
	return {
		status: r.status, effort: r.effort, length: r.length, lanes: r.lanes,
		solution: r.solution, optimal: r.optimal, ms: r.ms, expanded: r.expanded, error: r.error,
		optimization: preparation && preparation.telemetry,
	};
}

self.onmessage = function (e) {
	const msg = e.data;
	try {
		if (msg.type === 'init') {
			const res = misCompile(msg.source);
			gameSource = msg.source;
			variants.clear();
			model = res.ok ? MISCore.extractModel(msg.source) : null;
			native = null;
			preparation = model ? MISOptimizer.prepare(msg.source, model, { enabled: msg.optimize !== false, hasErrors: res.hasErrors }) : null;
			solverBackend = preparation ? MISOptimizer.createBackend(preparation) : null;
			if (!model || msg.backend === 'js') {
				backendNote = msg.backend === 'js' ? 'JS solver (chosen)' : '';
				reply({ type: 'ready', ok: !!model, errors: res.errors, backend: 'js', note: backendNote, optimization: preparation && preparation.telemetry, ruleTags: preparation && preparation.ruleTags });
				return;
			}
			loadNative().then(function (M) {
				let originalNative = false;
				if (!M) { backendNote = 'native solver not built — using JS'; }
				else {
					const n = MISNative.create(M);
					let attached;
					if (preparation.telemetry.enabled && !MISOptimizer.hasRuleReductions(preparation)) {
						attached = n.attach(msg.source, model);
						originalNative = attached.ok && (model.noaction || n.actionUnnecessary());
					}
					if (!originalNative) attached = n.attach(preparation.source, preparation.model);
					if (attached.ok) {
						native = n; backendNote = 'native solver (WebAssembly)';
						if (preparation.telemetry.enabled && !originalNative) n.attachOriginal(msg.source, model);
					}
					else backendNote = attached.reason + ' — using JS';
				}
				solverBackend = MISOptimizer.createBackend(preparation, native, { originalNative });
				reply({ type: 'ready', ok: true, errors: res.errors, backend: native ? 'native' : 'js', note: backendNote, optimization: preparation.telemetry, ruleTags: preparation.ruleTags });
			});
		} else if (msg.type === 'assess') {
			const r = backend.assess(boardFrom(msg.board), Object.assign({ verifyOriginalJS: true }, msg.opts));
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
			const r = backend.solve(boardFrom(msg.board), Object.assign({ strategy: 'bfs', verifyOriginalJS: true }, msg.opts));
			reply({ type: 'proved', id: msg.id, result: { status: r.status, solution: r.status === 'solved' ? r.solution : null } });
		} else if (msg.type === 'ruleCheck') {
			ruleCheck(msg);
		} else if (msg.type === 'generate') {
			generate(msg);
		}
	} catch (err) {
		reply({ type: 'error', id: msg.id, message: String(err && err.message || err), stack: err && err.stack });
	}
};

/////////////////////////////////////////////////////////////////////
// Rule goals: solving the level with rules removed
/////////////////////////////////////////////////////////////////////

// The game with some rule lines removed, prepared once and kept. Each holds
// its own compiled engine state; the backend switches to it per solve.
const variants = new Map();
function variantFor(lines) {
	const key = lines.slice().sort(function (a, b) { return a - b; }).join(',');
	if (variants.has(key)) return variants.get(key);
	let v = null;
	try {
		const source = MISCore.withoutRuleLines(gameSource, lines);
		const res = misCompile(source);
		if (res.ok && !res.hasErrors) {
			const m = MISCore.extractModel(source);
			// Removing rules never changes objects or layers; refuse if it did.
			if (m && m.objectCount === model.objectCount && m.stride === model.stride && m.layerCount === model.layerCount) {
				const prep = MISOptimizer.prepare(source, m, { enabled: true });
				v = { backend: MISOptimizer.createBackend(prep) };
			}
		}
	} catch (e) {
		v = null;
	} finally {
		restoreGame();
	}
	variants.set(key, v);
	return v;
}

function restoreGame() {
	if (preparation) preparation.activateOriginal();
}

function variantSolve(lines, board, limits) {
	const v = variantFor(lines);
	if (!v) return { status: 'error' };
	try { return v.backend.solve(board, Object.assign({ strategy: 'bfs' }, limits)); }
	finally { restoreGame(); }
}

// The level's shortest solution in the real game: { solution } or null.
function shortestSolution(board, solution, optimal, limits) {
	if (optimal && solution) return solution;
	const r = backend.solve(board, Object.assign({ strategy: 'bfs' }, limits));
	return r.status === 'solved' ? r.solution : null;
}

function firedLines(board, solution) {
	restoreGame();
	const fired = new Set();
	MISCore.traceRules(model, board, solution).forEach(function (step) { step.forEach(function (line) { fired.add(line); }); });
	return fired;
}

// What one rule line means for this level:
//   required  - unsolvable without it
//   shortcut  - solvable without it, but only in more moves
//   optional  - solvable without it in the same number of moves
//   unknown   - the search ran out of budget
// `shortest` is the real game's shortest solution (null if unknown).
function ruleStatus(line, board, shortest, fired, limits) {
	if (shortest && !fired.has(line)) return { status: 'optional' };
	const r = variantSolve([line], board, limits);
	if (r.status === 'unsolvable') return { status: 'required' };
	if (r.status !== 'solved') return { status: 'unknown' };
	if (!shortest) return { status: 'optional', length: r.solution.length };
	return { status: r.solution.length > shortest.length ? 'shortcut' : 'optional', length: r.solution.length };
}

function ruleCheck(msg) {
	const board = boardFrom(msg.board);
	const limits = { timeMs: msg.timeMs || 3000, maxExpanded: msg.maxExpanded || 300000 };
	const shortest = shortestSolution(board, msg.solution, msg.optimal, limits);
	const fired = firedLines(board, shortest || msg.solution);
	const out = {};
	msg.lines.forEach(function (line) {
		out[line] = ruleStatus(line, board, shortest, fired, limits);
		reply({ type: 'progress', id: msg.id, line: line, result: out[line] });
	});
	reply({ type: 'ruleChecked', id: msg.id, result: out, shortest: shortest ? shortest.length : null });
}

// Generator filter for rule goals { need: [lines], ban: [lines] }. A needed
// rule must be required; a banned rule must give no shortcut.
function goalFilter(goals, limits) {
	return function (board, r) {
		const fired = firedLines(board, r.solution);
		// Every solution of a level that needs a rule fires it: a cheap first test.
		for (let i = 0; i < goals.need.length; i++) if (!fired.has(goals.need[i])) return false;
		if (goals.ban.length) {
			const shortest = shortestSolution(board, r.solution, r.optimal, limits);
			if (!shortest) return false;
			const firedShortest = r.optimal ? fired : firedLines(board, shortest);
			for (let i = 0; i < goals.ban.length; i++) {
				const s = ruleStatus(goals.ban[i], board, shortest, firedShortest, limits);
				if (s.status !== 'optional') return false;
			}
		}
		for (let i = 0; i < goals.need.length; i++) {
			if (variantSolve([goals.need[i]], board, limits).status !== 'unsolvable') return false;
		}
		return true;
	};
}

/////////////////////////////////////////////////////////////////////
// Generation loop (logic in mis_generator.js)
/////////////////////////////////////////////////////////////////////

function generate(msg) {
	// Auto mode sends several transforms ({ id, text }); the generator picks
	// among them as it learns which finds harder levels here.
	let programs = null, program;
	if (msg.transforms && msg.transforms.length) {
		programs = msg.transforms.map(function (t) { return { id: t.id, program: MISCore.parseTransform(t.text, model) }; })
			.filter(function (t) { return !t.program.errors.length && t.program.statements.length; });
		if (!programs.length) { reply({ type: 'genError', message: 'None of the transforms is usable.' }); return; }
		program = programs[0].program;
	} else {
		program = MISCore.parseTransform(msg.transform, model);
		if (!program.statements.length) {
			reply({ type: 'genError', message: program.errors.length ? program.errors[0].message : 'The transform is empty.' });
			return;
		}
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
		model: model, backend: backend, program: program, programs: programs && programs.length > 1 ? programs : null, base: base, baseEffort: baseEffort, seedPrimaryMs: seedPrimaryMs, adaptive: msg.adaptive === true, parents: msg.parents,
		frozen: msg.frozen ? new Uint8Array(msg.frozen) : null, seed: msg.seed, keep: msg.keep || 8,
		optimalCap: msg.optimalCap, initialBudgetMs: msg.initialBudgetMs, maxBudgetMs: msg.maxBudgetMs,
		shard: msg.shardCount > 1 ? { index: msg.shardIndex, count: msg.shardCount } : null,
		pipeline: msg.pipeline,
		accept: msg.goals && (msg.goals.need.length || msg.goals.ban.length)
			? goalFilter(msg.goals, { timeMs: 2000, maxExpanded: 200000 }) : null,
	});
	let lastStats = 0;
	function flushStats(force) {
		const t = Date.now();
		if (force || t - lastStats > 250) {
			lastStats = t;
			reply({ type: 'stats', stats: Object.assign({}, gen.stats()), profile: Object.assign({}, gen.profile()), arms: gen.arms(), transforms: gen.transforms(), exhausted: gen.exhausted() });
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
