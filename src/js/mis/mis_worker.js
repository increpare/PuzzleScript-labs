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

let model = null;

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
			reply({ type: 'ready', ok: !!model, errors: res.errors });
		} else if (msg.type === 'assess') {
			const r = MISCore.assess(model, boardFrom(msg.board), msg.opts || {});
			reply({ type: 'assessed', id: msg.id, result: packResult(r) });
		} else if (msg.type === 'simplify') {
			const r = MISCore.simplify(model, boardFrom(msg.board), Object.assign({}, msg.opts, {
				onProgress: function (done, total) { reply({ type: 'progress', id: msg.id, done: done, total: total }); },
			}));
			if (r.ok) r.board = { w: r.board.w, h: r.board.h, cells: Array.from(r.board.cells) };
			reply({ type: 'simplified', id: msg.id, result: r });
		} else if (msg.type === 'generate') {
			generate(msg);
		}
	} catch (err) {
		reply({ type: 'error', id: msg.id, message: String(err && err.message || err), stack: err && err.stack });
	}
};

/////////////////////////////////////////////////////////////////////
// Generation loop
/////////////////////////////////////////////////////////////////////
//
// Mirrors the MIS app's curator: sample a transformed board, prove it solvable
// with a time budget, refine its difficulty only if it could make the
// shortlist, and grow the budget toward the difficulty frontier. Timeouts are
// parked and retried once the budget has grown past the one they failed at.

function generate(msg) {
	const base = boardFrom(msg.base);
	const frozen = msg.frozen ? new Uint8Array(msg.frozen) : null;
	const program = MISCore.parseTransform(msg.transform, model);
	if (!program.statements.length) {
		reply({ type: 'genError', message: program.errors.length ? program.errors[0].message : 'The transform is empty.' });
		return;
	}
	const rng = MISCore.makeRng(msg.seed);
	const baseKey = MISCore.cellsKey(base.cells);
	const seen = new Set([baseKey]);
	const keepCount = msg.keep || 8;
	const topEfforts = [];
	const parked = [];
	let budget = msg.initialBudgetMs || 200;
	const maxBudget = msg.maxBudgetMs || 5000;
	const stats = { generated: 0, duplicates: 0, unchanged: 0, solved: 0, unsolvable: 0, timeout: 0, budgetMs: budget };
	let lastStats = 0;
	let streak = 0; // consecutive duplicate/unchanged samples

	function flushStats(force) {
		const now = Date.now();
		if (force || now - lastStats > 250) {
			lastStats = now;
			stats.budgetMs = budget;
			reply({ type: 'stats', stats: Object.assign({}, stats), exhausted: streak > 3000 });
		}
	}

	function admit(effort) {
		topEfforts.push(effort);
		topEfforts.sort(function (a, b) { return b - a; });
		if (topEfforts.length > keepCount) topEfforts.length = keepCount;
	}

	function step() {
		let board = null, retried = false;
		for (let i = 0; i < parked.length; i++) {
			if (parked[i].budget < budget) { board = parked[i].board; parked.splice(i, 1); retried = true; break; }
		}
		if (!board) {
			board = MISCore.runTransform(model, program, base, frozen, rng);
			const key = MISCore.cellsKey(board.cells);
			if (key === baseKey) { stats.unchanged++; streak++; flushStats(); return; }
			if (seen.has(key)) { stats.duplicates++; streak++; flushStats(); return; }
			seen.add(key);
			stats.generated++;
		}
		streak = 0;
		const primary = MISCore.assess(model, board, { timeMs: budget, maxExpanded: 400000, refine: false });
		if (primary.status === 'solved') {
			stats.solved++;
			if (retried) stats.timeout--;
			const couldPlace = topEfforts.length < keepCount || primary.effort >= topEfforts[topEfforts.length - 1];
			let result = primary;
			if (couldPlace) {
				result = MISCore.assess(model, board, { timeMs: Math.max(budget, 1500), maxExpanded: 400000, bfsFloor: 20000 });
				if (result.status !== 'solved') result = primary;
			}
			if (couldPlace && (topEfforts.length < keepCount || result.effort >= topEfforts[topEfforts.length - 1])) {
				admit(result.effort);
				budget = Math.min(maxBudget, Math.max(budget, Math.round(result.ms * 7), 200));
			}
			reply({
				type: 'candidate',
				board: { w: board.w, h: board.h, cells: Array.from(board.cells) },
				result: { status: 'solved', effort: result.effort, length: result.length, lanes: result.lanes, solution: result.solution, optimal: result.optimal, refined: !!result.refined },
			});
		} else if (primary.status === 'unsolvable') {
			stats.unsolvable++;
			if (retried) stats.timeout--;
		} else {
			if (!retried) stats.timeout++;
			if (parked.length < 32) parked.push({ board: board, budget: budget });
			if (!topEfforts.length) budget = Math.min(maxBudget, budget * 2);
		}
		flushStats();
	}

	function loop() {
		const until = Date.now() + 40;
		do { step(); } while (Date.now() < until);
		setTimeout(loop, 0);
	}
	flushStats(true);
	loop();
}
