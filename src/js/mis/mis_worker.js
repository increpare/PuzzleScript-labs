'use strict';

// MIS95 - solver/generator worker.
//
// Each worker owns its own copy of the engine. Generation assignments yield
// between slices and rotate resumable jobs at normal generator step boundaries.

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
			assignGeneration([]);
			const res = misCompile(msg.source);
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
		} else if (msg.type === 'generationJobs') {
			assignGeneration(msg.jobs || []);
		} else if (msg.type === 'generate') {
			// Older callers still use one job, replaced by the next generate.
			assignGeneration([Object.assign({}, msg, { jobId: msg.jobId === undefined ? 'legacy' : msg.jobId, revision: ++legacyRevision, generationEpoch: undefined })]);
		}
	} catch (err) {
		reply({ type: 'error', id: msg.id, message: String(err && err.message || err), stack: err && err.stack });
	}
};

/////////////////////////////////////////////////////////////////////
// Rule goals: does every solution fire a rule? does any?
/////////////////////////////////////////////////////////////////////
//
// MISCore.ruleGoalSearch tracks which rules fire, so it runs on the JS engine
// with the game's original rules (the solver's reduced rules renumber lines).

function goalSearch(board, goals, limits) {
	if (preparation) preparation.activateOriginal();
	return MISCore.ruleGoalSearch(model, board, goals, limits);
}

function firedLines(board, solution) {
	if (preparation) preparation.activateOriginal();
	const fired = new Set();
	MISCore.traceRules(model, board, solution).forEach(function (step) { step.forEach(function (line) { fired.add(line); }); });
	return fired;
}

// What a rule line means for this level, given a solution that's known:
//   need: 'required' (every solution fires it) | 'optional' | 'unknown'
//   ban:  'never' (no solution fires it) | 'used' | 'unknown'   (only if asked)
// The known solution answers some of these for free.
function ruleStatus(line, board, fired, wantBan, limits) {
	const out = {};
	if (!fired.has(line)) out.need = 'optional';
	else {
		const r = goalSearch(board, { need: [line] }, limits);
		out.need = r.status === 'met' ? 'required' : r.status === 'broken' ? 'optional' : 'unknown';
	}
	if (wantBan) {
		if (fired.has(line)) out.ban = 'used';
		else {
			const r = goalSearch(board, { ban: [line] }, limits);
			out.ban = r.status === 'met' ? 'never' : r.status === 'broken' ? 'used' : 'unknown';
		}
	}
	return out;
}

function ruleCheck(msg) {
	const board = boardFrom(msg.board);
	const limits = { timeMs: msg.timeMs || 3000, maxExpanded: msg.maxExpanded || 300000 };
	const fired = firedLines(board, msg.solution);
	const ban = new Set(msg.banLines || []);
	const out = {};
	msg.lines.forEach(function (line) {
		out[line] = ruleStatus(line, board, fired, ban.has(line), limits);
		reply({ type: 'progress', id: msg.id, line: line, result: out[line] });
	});
	reply({ type: 'ruleChecked', id: msg.id, result: out });
}

// Generator filter for rule goals { need: [lines], ban: [lines] }: every
// solution must fire each needed rule, and none may fire a banned one. The
// candidate's own solution rejects most misses without a search.
function goalFilter(goals, limits) {
	return function (board, r) {
		const fired = firedLines(board, r.solution);
		for (let i = 0; i < goals.need.length; i++) if (!fired.has(goals.need[i])) return false;
		for (let i = 0; i < goals.ban.length; i++) if (fired.has(goals.ban[i])) return false;
		return goalSearch(board, goals, limits).status === 'met';
	};
}

/////////////////////////////////////////////////////////////////////
// Generation loop (logic in mis_generator.js)
/////////////////////////////////////////////////////////////////////

let generationJobs = [], generationCursor = 0, generationEpoch = 0, legacyRevision = 0;
let generationTick = null, generationQueued = false;

function generationReply(context, msg) {
	reply(Object.assign({}, msg, { jobId: context.msg.jobId, revision: context.msg.revision, generationEpoch: context.epoch }));
}

function queueGeneration() {
	if (generationQueued || !generationJobs.length) return;
	if (!generationTick) {
		generationTick = new MessageChannel();
		generationTick.port1.onmessage = generationSlice;
	}
	generationQueued = true;
	generationTick.port2.postMessage(null);
}

function assignGeneration(jobs) {
	const previous = new Map(generationJobs.map(function (c) { return [c.msg.jobId, c]; }));
	const nextId = generationJobs[generationCursor] && generationJobs[generationCursor].msg.jobId;
	generationJobs = jobs.map(function (msg) {
		const old = previous.get(msg.jobId);
		if (old && old.msg.revision === msg.revision && (msg.generationEpoch === undefined || old.epoch === msg.generationEpoch)) return old;
		const epoch = msg.generationEpoch === undefined ? ++generationEpoch : msg.generationEpoch;
		generationEpoch = Math.max(generationEpoch, epoch);
		return { msg: msg, epoch: epoch, gen: null, lastStats: 0 };
	});
	generationCursor = Math.max(0, generationJobs.findIndex(function (c) { return c.msg.jobId === nextId; }));
	queueGeneration();
}

function generationSlice() {
	generationQueued = false;
	const until = Date.now() + 40;
	while (generationJobs.length) {
		const context = generationJobs[generationCursor];
		generationCursor = (generationCursor + 1) % generationJobs.length;
		try {
			if (!context.gen) context.gen = createGeneration(context.msg);
			generationStep(context);
		} catch (err) {
			const at = generationJobs.indexOf(context);
			generationJobs.splice(at, 1);
			if (at < generationCursor) generationCursor--;
			generationCursor = generationJobs.length ? generationCursor % generationJobs.length : 0;
			generationReply(context, { type: 'genError', message: String(err && err.message || err), stack: err && err.stack });
		}
		if (Date.now() >= until) break;
	}
	queueGeneration();
}

// Creating a context assesses its seed. Do this only when its first step is
// actually scheduled, rather than blocking every reassignment on all seeds.
function createGeneration(msg) {
	// Auto mode sends several transforms ({ id, text }); the generator picks
	// among them as it learns which finds harder levels here.
	let programs = null, program;
	if (msg.transforms && msg.transforms.length) {
		programs = msg.transforms.map(function (t) { return { id: t.id, program: MISCore.parseTransform(t.text, model) }; })
			.filter(function (t) { return !t.program.errors.length && t.program.statements.length; });
		if (!programs.length) throw new Error('None of the transforms is usable.');
		program = programs[0].program;
	} else {
		program = MISCore.parseTransform(msg.transform, model);
		if (!program.statements.length) {
			throw new Error(program.errors.length ? program.errors[0].message : 'The transform is empty.');
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
	return MISGenerator.create({
		model: model, backend: backend, program: program, programs: programs && programs.length > 1 ? programs : null, base: base, baseEffort: baseEffort, seedPrimaryMs: seedPrimaryMs, adaptive: msg.adaptive === true, parents: msg.parents,
		frozen: msg.frozen ? new Uint8Array(msg.frozen) : null, seed: msg.seed, keep: msg.keep || 8,
		optimalCap: msg.optimalCap, initialBudgetMs: msg.initialBudgetMs, maxBudgetMs: msg.maxBudgetMs,
		shard: msg.shardCount > 1 ? { index: msg.shardIndex, count: msg.shardCount } : null,
		pipeline: msg.pipeline, maxSeen: msg.maxSeen,
		accept: msg.goals && (msg.goals.need.length || msg.goals.ban.length)
			? goalFilter(msg.goals, { timeMs: 2000, maxExpanded: 200000 }) : null,
	});
}

function generationStats(context, force) {
	const gen = context.gen, t = Date.now();
	if (force || t - context.lastStats > 250) {
		context.lastStats = t;
		generationReply(context, { type: 'stats', stats: Object.assign({}, gen.stats()), profile: Object.assign({}, gen.profile()), arms: gen.arms(), transforms: gen.transforms(), exhausted: gen.exhausted() });
	}
}

function generationStep(context) {
	const gen = context.gen;
	if (!context.lastStats) generationStats(context, true);
	const found = gen.step();
	if (found) {
		const r = found.result;
		generationReply(context, {
			type: 'candidate',
			board: { w: found.board.w, h: found.board.h, cells: Array.from(found.board.cells) },
			result: { status: 'solved', effort: r.effort, length: r.length, lanes: r.lanes, solution: r.solution, optimal: r.optimal, refined: !!r.refined },
		});
	}
	generationStats(context);
}
