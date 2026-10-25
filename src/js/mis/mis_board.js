'use strict';

// MIS95 board geometry. Cells contain all model.stride words per tile and use
// the engine's column-major layout: tile = x * height + y.
const MISBoard = (function () {
	const C = typeof MISCore !== 'undefined' ? MISCore : require('./mis_core.js');
	const MAX_DIMENSION = 128;
	const MAX_CELLS = 16384;

	function validateDimensions(w, h) {
		if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 ||
			w > MAX_DIMENSION || h > MAX_DIMENSION || w * h > MAX_CELLS) {
			throw new RangeError('Board dimensions must be integer width and height from 1 to ' + MAX_DIMENSION + ', with at most ' + MAX_CELLS + ' cells.');
		}
	}

	function validateModel(model) {
		if (!model || !Number.isInteger(model.stride) || model.stride < 1) {
			throw new TypeError('Board model must have a positive integer stride.');
		}
		const id = model.backgroundId, layer = model.backgroundLayer;
		const mask = model.layerMasks && model.layerMasks[layer];
		if (!Number.isInteger(id) || id < 0 || id >= model.stride * 32 ||
			!Number.isInteger(layer) || layer < 0 || !mask || mask.length !== model.stride ||
			!(mask[id >> 5] & (1 << (id & 31)))) {
			throw new TypeError('Board model must provide a valid background object in its background collision layer.');
		}
	}

	function create(model, w, h) {
		validateDimensions(w, h);
		validateModel(model);
		const cells = new Int32Array(w * h * model.stride);
		for (let tile = 0; tile < w * h; tile++) C.ensureBackground(model, cells, tile);
		return { w: w, h: h, cells: cells };
	}

	// Positive deltas add cells at that edge; negative deltas crop them. Old
	// coordinate (x,y) becomes (x+left,y+top), including its lock value.
	function resize(model, board, deltas, locks) {
		validateModel(model);
		if (!board) throw new TypeError('A board is required for resizing.');
		// Imported source levels may exceed the editing cap; only the result
		// must fit it, so they can still be cropped into a supported size.
		if (!Number.isSafeInteger(board.w) || !Number.isSafeInteger(board.h) || board.w < 1 || board.h < 1) {
			throw new RangeError('Input board dimensions must be positive integer width and height.');
		}
		if (!(board.cells instanceof Int32Array) || board.cells.length !== board.w * board.h * model.stride) {
			throw new TypeError('Board cells must be an Int32Array containing every word of each tile.');
		}
		if (locks != null && (!(locks instanceof Uint8Array) || locks.length !== board.w * board.h)) {
			throw new TypeError('Locks must be a Uint8Array with one value per board tile.');
		}
		deltas = deltas || {};
		const edges = {};
		for (const edge of ['left', 'right', 'top', 'bottom']) {
			const delta = deltas[edge] === undefined ? 0 : deltas[edge];
			if (!Number.isSafeInteger(delta)) throw new TypeError('Resize ' + edge + ' delta must be an integer.');
			edges[edge] = delta;
		}
		const w = board.w + edges.left + edges.right;
		const h = board.h + edges.top + edges.bottom;
		const result = create(model, w, h);
		const resultLocks = new Uint8Array(w * h);
		for (let x = 0; x < board.w; x++) {
			const nx = x + edges.left;
			if (nx < 0 || nx >= w) continue;
			for (let y = 0; y < board.h; y++) {
				const ny = y + edges.top;
				if (ny < 0 || ny >= h) continue;
				const oldTile = x * board.h + y, newTile = nx * h + ny;
				const offset = oldTile * model.stride;
				result.cells.set(board.cells.subarray(offset, offset + model.stride), newTile * model.stride);
				if (locks) resultLocks[newTile] = locks[oldTile];
			}
		}
		return { board: result, locks: resultLocks };
	}

	return { create: create, resize: resize, MAX_DIMENSION: MAX_DIMENSION, MAX_CELLS: MAX_CELLS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MISBoard;
