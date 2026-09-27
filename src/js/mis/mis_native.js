'use strict';

// PuzzleScript+MIS (web prototype) - native backend adapter.
//
// Wraps the WebAssembly build of the native compiler/solver
// (native/src/wasm/mis_wasm.cpp, built by native/wasm/build_mis_wasm.sh) behind
// the same result shapes MISCore.solve / assess / simplify return, so the
// worker can use either backend.
//
// Object ids are shared with the JS engine (the native compiler is a port of
// compiler.js); attach() verifies that per game and refuses to run otherwise.

const MISNative = (function () {

	const STATUS = ['solved', 'unsolvable', 'timeout', 'error']; // ps_solve_status order
	const STRATEGY = { portfolio: 0, bfs: 1, astar: 2, 'astar-deep': 3, greedy: 4 };

	function create(module) {
		const M = module;
		let model = null;

		function writeString(text) {
			const len = M.lengthBytesUTF8(text);
			const ptr = M._malloc(len + 1);
			M.stringToUTF8(text, ptr, len + 1);
			return { ptr: ptr, len: len };
		}

		// JS engine board (column-major bitsets) -> native layer-cell grid
		// (layer-major, row-major, -1 = empty).
		function writeGrid(board) {
			const layers = model.layerCount, w = board.w, h = board.h, stride = model.stride;
			const count = layers * w * h;
			const ptr = M._misw_grid_buffer(count) >> 2;
			const heap = M.HEAP32;
			for (let l = 0; l < layers; l++) {
				const ids = model.layerObjects[l];
				for (let y = 0; y < h; y++) {
					for (let x = 0; x < w; x++) {
						const tile = x * h + y;
						let found = -1;
						for (let k = 0; k < ids.length; k++) {
							const id = ids[k];
							if (board.cells[tile * stride + (id >> 5)] & (1 << (id & 31))) { found = id; break; }
						}
						heap[ptr + l * w * h + y * w + x] = found;
					}
				}
			}
			return count;
		}

		function readGrid(w, h) {
			const count = M._misw_result_grid_length();
			const ptr = M._misw_result_grid() >> 2;
			const cells = new Int32Array(w * h * model.stride);
			const plane = w * h;
			for (let i = 0; i < count; i++) {
				const id = M.HEAP32[ptr + i];
				if (id < 0) continue;
				const rem = i % plane, x = rem % w, y = (rem / w) | 0;
				const tile = x * h + y;
				cells[tile * model.stride + (id >> 5)] |= (1 << (id & 31));
			}
			return { w: w, h: h, cells: cells };
		}

		function readSolution() {
			const n = M._misw_result_solution_length();
			const ptr = M._misw_result_solution() >> 2;
			return Array.from(M.HEAP32.subarray(ptr, ptr + n));
		}

		function lane(v) { return v >= 0 ? v : undefined; }

		return {
			backend: 'native',

			// Compile `sourceText` natively and check it agrees with the JS model.
			attach: function (sourceText, jsModel) {
				const s = writeString(sourceText);
				const ok = M._misw_compile(s.ptr, s.len);
				M._free(s.ptr);
				if (!ok) return { ok: false, reason: 'native compile failed: ' + M.UTF8ToString(M._misw_error()) };
				if (M._misw_object_count() !== jsModel.objectCount || M._misw_layer_count() !== jsModel.layerCount) {
					return { ok: false, reason: 'native/JS object tables differ' };
				}
				for (let id = 0; id < jsModel.objectCount; id++) {
					const o = jsModel.objects[id];
					// An object in no collision layer can never appear on a board; the
					// JS compiler drops it while the native one keeps it with layer -1.
					if (!o && M._misw_object_layer(id) < 0) continue;
					if (!o || M.UTF8ToString(M._misw_object_name(id)).toLowerCase() !== o.name || M._misw_object_layer(id) !== o.layer) {
						return { ok: false, reason: 'native/JS object ' + id + ' differs' };
					}
				}
				model = jsModel;
				return { ok: true };
			},

			solve: function (board, opts) {
				opts = opts || {};
				const count = writeGrid(board);
				const st = M._misw_solve(board.w, board.h, count, STRATEGY[opts.strategy || 'astar'], opts.timeMs || 60000, opts.maxExpanded || 0);
				const res = { status: STATUS[st] || 'error', expanded: M._misw_result_expanded(), ms: M._misw_result_elapsed_ms(), strategy: opts.strategy || 'astar' };
				if (res.status === 'error') res.error = M.UTF8ToString(M._misw_error());
				if (res.status === 'solved') res.solution = readSolution();
				return res;
			},

			// Same shape as MISCore.assess. Uses the shared native MIS metric:
			// portfolio primary, then capped greedy / weighted A* / BFS lanes.
			assess: function (board, opts) {
				opts = opts || {};
				const count = writeGrid(board);
				const refine = opts.refine !== false;
				const st = M._misw_assess(board.w, board.h, count, opts.timeMs || 1500, refine ? 1 : 0, opts.bfsTimeMs || opts.timeMs || 1500);
				const status = STATUS[st] || 'error';
				const out = { status: status, lanes: {}, solution: null, optimal: false, ms: M._misw_result_elapsed_ms() };
				if (status === 'error') out.error = M.UTF8ToString(M._misw_error());
				if (status !== 'solved') return out;
				out.solution = readSolution();
				out.length = out.solution.length;
				const lanes = { portfolio: lane(M._misw_result_portfolio()), greedy: lane(M._misw_result_greedy()), astar: lane(M._misw_result_weighted_astar()), bfs: lane(M._misw_result_bfs()) };
				Object.keys(lanes).forEach(function (k) { if (lanes[k] !== undefined) out.lanes[k] = lanes[k]; });
				const d = M._misw_result_difficulty();
				out.effort = Math.max(1, d >= 0 ? d : M._misw_result_expanded());
				out.refined = !!M._misw_result_supplemental_ran();
				// The native lanes don't carry BFS's path back, so prove the
				// shortest length with a separate capped BFS when asked.
				if (opts.bfsFloor) {
					const bfs = this.solve(board, { strategy: 'bfs', maxExpanded: opts.bfsFloor, timeMs: opts.bfsTimeMs || opts.timeMs || 1500 });
					if (bfs.status === 'solved') { out.solution = bfs.solution; out.length = bfs.solution.length; out.optimal = true; }
				}
				return out;
			},

			// Same shape as MISCore.simplify (mode 'simplify' only).
			simplify: function (board, opts) {
				opts = opts || {};
				const count = writeGrid(board);
				const ok = M._misw_simplify(board.w, board.h, count, opts.solveTimeMs || 5000, opts.bfsTimeMs || 20000);
				if (!ok) return { ok: false, reason: M.UTF8ToString(M._misw_error()) || 'native simplify failed' };
				if (!M._misw_result_complete()) return { ok: false, reason: "Couldn't find the shortest solution in time (level too big for exhaustive search)." };
				// The native simplifier also strips Background (it never affects the
				// solution); put it back and count only the objects a designer sees.
				const out = readGrid(board.w, board.h);
				for (let t = 0; t < out.w * out.h; t++) MISCore.ensureBackground(model, out.cells, t);
				const removed = MISCore.countObjects(model, board) - MISCore.countObjects(model, out);
				return { ok: true, board: out, changed: removed, length: M._misw_result_optimal_length(), mode: 'simplify', ms: M._misw_result_elapsed_ms() };
			},
		};
	}

	return { create: create };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MISNative;
