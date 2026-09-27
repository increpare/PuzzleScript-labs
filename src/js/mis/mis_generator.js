'use strict';

// PuzzleScript+MIS (web prototype) - candidate generation loop.
//
// Shared by the Web Worker and the Node profiler (src/tests/mis_generator_profile_node.js)
// so both run the same code. Mirrors the MIS app's curator: sample a
// transformed board, prove it solvable within a time budget, refine its
// difficulty only if it could make the shortlist, and grow the budget toward
// the difficulty frontier. Timeouts are parked and retried once the budget has
// grown past the one they failed at.
//
// Every phase is timed (performance.now is cheap in JS) so profiles can split
// a worker's time into transform / dedupe / primary solves by outcome /
// refinement.

const MISGenerator = (function () {

	const now = typeof performance !== 'undefined' ? function () { return performance.now(); } : Date.now;

	function create(opts) {
		const model = opts.model, backend = opts.backend, C = MISCore;
		const base = opts.base;
		const frozen = opts.frozen || null;
		const program = opts.program;
		const rng = C.makeRng(opts.seed >>> 0);
		const baseKey = C.cellsKey(base.cells);
		const seen = opts.seen || new Set();
		seen.add(baseKey);
		const keepCount = opts.keep || 8;
		// Solver budget per candidate: starts at 200 ms, doubles on timeouts until
		// something solves, follows 7x the admitted candidates' solve time, at most
		// 5 s. Experimental, off by default: basePrimaryMs (the seed level's own
		// primary solve time) starts it at 7x that and caps it at 20x (at least
		// 1 s). On the slow benchmark levels timeouts take ~70% of solve time, but
		// the slow solves include the hardest levels: the cap lowered the top-8
		// mean effort by ~10% (docs/benchmarks/2026-09-27-mis-generator-bench.md).
		const basePrimaryMs = opts.basePrimaryMs > 0 ? opts.basePrimaryMs : 0;
		const maxBudget = basePrimaryMs
			? Math.min(opts.maxBudgetMs || 5000, Math.max(1000, Math.round(basePrimaryMs * 20)))
			: opts.maxBudgetMs || 5000;
		// States a BFS may spend proving a shortlisted candidate's shortest solution.
		const optimalCap = opts.optimalCap !== undefined ? opts.optimalCap : 20000;
		// Optional sharding: only assess boards whose hash lands on this worker,
		// so parallel workers never solve the same board twice.
		const shard = opts.shard || null; // { index, count }
		const topEfforts = [];
		const parked = [];
		// A parked timeout is retried once the budget exceeds the one it timed out
		// at by this factor (1, the default: any growth at all). 2 found ~10% more
		// harder-than-base levels but no better shortlist in the same time.
		const retryGrowth = opts.retryGrowth || 1;

		// Adaptive mutation strength. How many changes a transform makes per
		// sample decides most of the useful yield (big steps are mostly
		// unsolvable, tiny ones run out of distinct boards), and the best size
		// differs per level and transform. Each arm scales every `choose`
		// count; a UCB bandit spends time on the arm finding harder-than-base
		// levels (and shortlist entries) fastest per second of work.
		const baseEffort = opts.baseEffort || 0;
		const arms = [];
		const hasChoose = program.statements.some(function (st) { return !!st.choose; });
		const scales = opts.adaptive === false || !hasChoose ? [1] : [0.125, 0.25, 0.5, 1, 2];
		scales.forEach(function (scale) {
			arms.push({ scale: scale, program: scaleProgram(program, scale), ms: 0, reward: 0, pulls: 0 });
		});
		let armIndex = arms.length > 1 ? 3 : 0; // start at the transform as written
		let budget = Math.min(maxBudget, Math.max(opts.initialBudgetMs || 200, Math.round(basePrimaryMs * 7)));
		let streak = 0;
		const legacy = opts.pipeline === 'legacy';

		const stats = { generated: 0, duplicates: 0, unchanged: 0, otherShard: 0, solved: 0, unsolvable: 0, timeout: 0, budgetMs: budget };
		// Profile: milliseconds and counts per phase.
		const prof = {
			transformMs: 0, keyMs: 0, primarySolvedMs: 0, primaryUnsolvableMs: 0, primaryTimeoutMs: 0,
			refineMs: 0, refines: 0, refineAdmitted: 0, proofMs: 0, proofs: 0, samples: 0,
			primaryExpandedSolved: 0, primaryExpandedUnsolvable: 0, primaryExpandedTimeout: 0,
		};

		function scaleProgram(prog, scale) {
			if (scale === 1) return prog;
			return {
				errors: prog.errors,
				statements: prog.statements.map(function (st) {
					if (!st.choose) return st;
					const lo = Math.max(1, Math.round(st.choose[0] * scale));
					const hi = Math.max(lo, Math.round(st.choose[1] * scale));
					return Object.assign({}, st, { choose: [lo, hi] });
				}),
			};
		}

		function pickArm() {
			if (arms.length === 1) return 0;
			let totalMs = 0;
			arms.forEach(function (a) { totalMs += a.ms; });
			// Round-robin until every arm has had a little time.
			for (let i = 0; i < arms.length; i++) if (arms[i].ms < 150) return i;
			let best = 0, bestScore = -Infinity;
			for (let i = 0; i < arms.length; i++) {
				const a = arms[i];
				const rate = (a.reward + 0.5) / (a.ms / 1000 + 0.5);
				const bonus = Math.sqrt(2 * Math.log(totalMs / 1000 + 1) / (a.ms / 1000 + 0.05));
				const score = rate * (1 + bonus);
				if (score > bestScore) { bestScore = score; best = i; }
			}
			return best;
		}

		function admit(effort) {
			topEfforts.push(effort);
			topEfforts.sort(function (a, b) { return b - a; });
			if (topEfforts.length > keepCount) topEfforts.length = keepCount;
		}

		function shardOf(key) {
			return C.hashString(key) % shard.count;
		}

		// One unit of work. Returns a solved candidate {board, result} or null.
		function step() {
			const t0 = now();
			const before = topEfforts.length ? topEfforts[topEfforts.length - 1] : 0;
			const filled = topEfforts.length >= keepCount;
			const arm = arms[armIndex];
			const found = stepWith(arm.program);
			arm.ms += now() - t0;
			arm.pulls++;
			if (found) {
				const e = found.result.effort || 0;
				if (e > baseEffort) arm.reward += 1;
				if (filled && e > before) arm.reward += 3;
			}
			armIndex = pickArm();
			return found;
		}

		function stepWith(program) {
			let board = null, retried = false;
			for (let i = 0; i < parked.length; i++) {
				if (parked[i].budget * retryGrowth < budget || (retryGrowth > 1 && budget >= maxBudget && parked[i].budget < budget)) { board = parked[i].board; parked.splice(i, 1); retried = true; break; }
			}
			if (!board) {
				prof.samples++;
				let t = now();
				board = C.runTransform(model, program, base, frozen, rng);
				prof.transformMs += now() - t;
				t = now();
				const key = C.cellsKey(board.cells);
				let skip = null;
				if (key === baseKey) skip = 'unchanged';
				else if (seen.has(key)) skip = 'duplicates';
				else {
					seen.add(key);
					if (shard && shardOf(key) !== shard.index) skip = 'otherShard';
				}
				prof.keyMs += now() - t;
				if (skip) { stats[skip]++; streak++; return null; }
				stats.generated++;
			}
			streak = 0;
			return legacy ? assessLegacy(board, retried) : assessLazy(board, retried);
		}

		function floor() {
			return topEfforts.length < keepCount ? 0 : topEfforts[topEfforts.length - 1];
		}

		function recordUnsolved(primary, primaryMs, board, retried) {
			if (primary.status === 'unsolvable') {
				prof.primaryUnsolvableMs += primaryMs;
				prof.primaryExpandedUnsolvable += primary.expanded || 0;
				stats.unsolvable++;
				if (retried) stats.timeout--;
			} else {
				prof.primaryTimeoutMs += primaryMs;
				if (!retried) stats.timeout++;
				if (parked.length < 32) parked.push({ board: board, budget: budget });
				if (!topEfforts.length) budget = Math.min(maxBudget, budget * 2);
			}
			return null;
		}

		// One assessment per candidate: primary search, then the refinement
		// lanes only when the primary count could reach the shortlist floor
		// (it bounds the final min from above). Shortest-length BFS proof only
		// for admitted candidates. Budget follows the primary's time, as in MIS.
		function assessLazy(board, retried) {
			let t = now();
			const gate = floor();
			const r = backend.assess(board, { timeMs: budget, maxExpanded: 400000, refineGate: gate, refineTimeMs: Math.max(budget, 1500) });
			const ms = now() - t;
			if (r.status !== 'solved') return recordUnsolved(r, ms, board, retried);
			stats.solved++;
			if (retried) stats.timeout--;
			if (r.refined) { prof.refineMs += ms; prof.refines++; } else prof.primarySolvedMs += ms;
			prof.primaryExpandedSolved += r.expanded || 0;
			if (r.effort >= gate || topEfforts.length < keepCount) {
				admit(r.effort);
				prof.refineAdmitted++;
				budget = Math.min(maxBudget, Math.max(budget, Math.round((r.primaryMs || r.ms || ms) * 7), 200));
				if (!r.optimal && optimalCap > 0 && backend.solve) {
					t = now();
					const bfs = backend.solve(board, { strategy: 'bfs', maxExpanded: optimalCap, timeMs: Math.max(budget, 1500) });
					prof.proofMs += now() - t;
					prof.proofs++;
					if (bfs.status === 'solved') { r.solution = bfs.solution; r.length = bfs.solution.length; r.optimal = true; }
				}
			}
			return { board: board, result: r };
		}

		// The original loop: a separate full re-assessment (primary again,
		// lanes, BFS proof) for every candidate that might place.
		function assessLegacy(board, retried) {
			let t = now();
			const primary = backend.assess(board, { timeMs: budget, maxExpanded: 400000, refine: false });
			const primaryMs = now() - t;
			if (primary.status !== 'solved') return recordUnsolved(primary, primaryMs, board, retried);
			prof.primarySolvedMs += primaryMs;
			prof.primaryExpandedSolved += primary.expanded || 0;
			stats.solved++;
			if (retried) stats.timeout--;
			const couldPlace = topEfforts.length < keepCount || primary.effort >= floor();
			let result = primary;
			if (couldPlace) {
				t = now();
				result = backend.assess(board, { timeMs: Math.max(budget, 1500), maxExpanded: 400000, bfsFloor: optimalCap });
				prof.refineMs += now() - t;
				prof.refines++;
				if (result.status !== 'solved') result = primary;
			}
			if (couldPlace && (topEfforts.length < keepCount || result.effort >= floor())) {
				admit(result.effort);
				prof.refineAdmitted++;
				budget = Math.min(maxBudget, Math.max(budget, Math.round((result.ms || primaryMs) * 7), 200));
			}
			return { board: board, result: result };
		}

		return {
			step: step,
			stats: function () { stats.budgetMs = budget; return stats; },
			profile: function () { return prof; },
			exhausted: function () { return streak > 3000; },
			best: function () { return topEfforts.slice(); },
			arms: function () { return arms.map(function (a) { return { scale: a.scale, ms: Math.round(a.ms), reward: a.reward, pulls: a.pulls }; }); },
		};
	}

	return { create: create };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MISGenerator;
