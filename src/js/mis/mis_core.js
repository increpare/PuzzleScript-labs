'use strict';

// PuzzleScript+MIS (web prototype) - shared core.
//
// Loaded after the PuzzleScript engine scripts, both on the page (for editing,
// rendering and playtesting) and inside the solver/generator Web Workers. It
// talks to the engine through its globals (`state`, `level`, `STRIDE_OBJ`,
// `processInput`, ...), exactly like the Node test harnesses do.
//
// Boards use the engine's own layout: one bitset of STRIDE_OBJ words per tile,
// tiles in column-major order (index = x * height + y), background included.

const MISCore = (function () {

	/////////////////////////////////////////////////////////////////////
	// Small utilities
	/////////////////////////////////////////////////////////////////////

	function makeRng(seed) {
		// mulberry32
		let a = (seed >>> 0) || 0x9e3779b9;
		return function () {
			a = (a + 0x6D2B79F5) | 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	function shuffleInPlace(arr, rng) {
		for (let i = arr.length - 1; i > 0; i--) {
			const j = Math.floor(rng() * (i + 1));
			const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
		}
		return arr;
	}

	function cellsKey(cells) {
		// Compact string key for a board; used for dedupe and visited sets.
		const u16 = new Uint16Array(cells.buffer, cells.byteOffset, cells.length * 2);
		let out = '';
		const CHUNK = 8192;
		for (let i = 0; i < u16.length; i += CHUNK) {
			out += String.fromCharCode.apply(null, u16.subarray(i, i + CHUNK));
		}
		return out;
	}

	function hashString(str) {
		let h = 2166136261 >>> 0;
		for (let i = 0; i < str.length; i++) {
			h ^= str.charCodeAt(i);
			h = Math.imul(h, 16777619) >>> 0;
		}
		return h;
	}

	function cloneBoard(board) {
		return { w: board.w, h: board.h, cells: new Int32Array(board.cells) };
	}

	function boardsEqual(a, b) {
		if (!a || !b || a.w !== b.w || a.h !== b.h) return false;
		const ca = a.cells, cb = b.cells;
		for (let i = 0; i < ca.length; i++) if (ca[i] !== cb[i]) return false;
		return true;
	}

	// Number of tiles whose contents differ.
	function boardDiffCount(a, b, stride) {
		if (a.w !== b.w || a.h !== b.h) return Infinity;
		let n = 0;
		for (let t = 0; t < a.w * a.h; t++) {
			for (let k = 0; k < stride; k++) {
				if (a.cells[t * stride + k] !== b.cells[t * stride + k]) { n++; break; }
			}
		}
		return n;
	}

	function diffTiles(a, b, stride) {
		const out = new Uint8Array(a.w * a.h);
		if (a.w !== b.w || a.h !== b.h) return out.fill(1);
		for (let t = 0; t < a.w * a.h; t++) {
			for (let k = 0; k < stride; k++) {
				if (a.cells[t * stride + k] !== b.cells[t * stride + k]) { out[t] = 1; break; }
			}
		}
		return out;
	}

	function hasBit(cells, tile, id, stride) {
		return (cells[tile * stride + (id >> 5)] & (1 << (id & 31))) !== 0;
	}
	function setBit(cells, tile, id, stride) {
		cells[tile * stride + (id >> 5)] |= (1 << (id & 31));
	}
	function clearBit(cells, tile, id, stride) {
		cells[tile * stride + (id >> 5)] &= ~(1 << (id & 31));
	}

	function idsFromBitData(data, objectCount) {
		const ids = [];
		for (let id = 0; id < objectCount; id++) {
			if (data[id >> 5] & (1 << (id & 31))) ids.push(id);
		}
		return ids;
	}

	/////////////////////////////////////////////////////////////////////
	// Source text helpers (sections, legend, level blocks)
	/////////////////////////////////////////////////////////////////////

	const SECTION_NAMES = ['objects', 'legend', 'sounds', 'collisionlayers', 'rules', 'winconditions', 'levels'];

	// Returns per-line text with (nested) comments blanked out.
	function stripCommentsPerLine(lines) {
		let depth = 0;
		return lines.map(function (line) {
			let out = '';
			for (let i = 0; i < line.length; i++) {
				const c = line[i];
				if (c === '(') { depth++; out += ' '; }
				else if (c === ')' && depth > 0) { depth--; out += ' '; }
				else out += depth > 0 ? ' ' : c;
			}
			return out;
		});
	}

	function findSections(lines) {
		const stripped = stripCommentsPerLine(lines);
		const sections = {};
		let current = null;
		for (let i = 0; i < lines.length; i++) {
			const t = stripped[i].trim().toLowerCase();
			if (SECTION_NAMES.indexOf(t) >= 0) {
				if (current) sections[current].end = i - 1;
				current = t;
				sections[t] = { start: i + 1, end: lines.length - 1 };
			}
		}
		return { sections: sections, stripped: stripped };
	}

	// Level blocks in the LEVELS section, in the same order as state.levels.
	function findLevelBlocks(lines) {
		const found = findSections(lines);
		const sec = found.sections.levels;
		const blocks = [];
		if (!sec) return blocks;
		let cur = null;
		for (let i = sec.start; i <= sec.end && i < lines.length; i++) {
			const raw = lines[i];
			const t = found.stripped[i].trim();
			if (/^=+$/.test(t)) continue;
			if (t.length === 0) {
				if (raw.trim().length === 0 && cur) { blocks.push(cur); cur = null; }
				continue;
			}
			if (/^message(\s|$)/i.test(t)) {
				if (cur) { blocks.push(cur); cur = null; }
				blocks.push({ kind: 'message', start: i, end: i });
				continue;
			}
			if (!cur) cur = { kind: 'level', start: i, end: i };
			cur.end = i;
		}
		if (cur) blocks.push(cur);
		return blocks;
	}

	// Map of lowercase single-char glyph -> glyph as written in the source legend.
	function legendCaseMap(lines) {
		const found = findSections(lines);
		const sec = found.sections.legend;
		const map = {};
		if (!sec) return map;
		for (let i = sec.start; i <= sec.end; i++) {
			const m = /^\s*(\S)\s*=/.exec(found.stripped[i]);
			if (m) map[m[1].toLowerCase()] = m[1];
		}
		return map;
	}

	// Parse "all X on Y" style win conditions directly from source text.
	function parseWinconditionText(lines) {
		const found = findSections(lines);
		const sec = found.sections.winconditions;
		const out = [];
		if (!sec) return out;
		for (let i = sec.start; i <= sec.end; i++) {
			const toks = found.stripped[i].trim().toLowerCase().split(/\s+/).filter(Boolean);
			if (toks.length < 2 || /^=+$/.test(toks[0])) continue;
			const q = toks[0] === 'any' ? 'some' : toks[0];
			if (['all', 'some', 'no'].indexOf(q) < 0) continue;
			out.push({ quant: q, a: toks[1], b: toks[2] === 'on' ? toks[3] : null });
		}
		return out;
	}

	// Names that appear next to a movement token somewhere in RULES.
	function parseMovingNames(lines) {
		const found = findSections(lines);
		const sec = found.sections.rules;
		const movers = {};
		if (!sec) return movers;
		const moveTok = { '>': 1, '<': 1, '^': 1, 'v': 1, 'up': 1, 'down': 1, 'left': 1, 'right': 1, 'moving': 1, 'horizontal': 1, 'vertical': 1, 'perpendicular': 1, 'parallel': 1, 'orthogonal': 1 };
		for (let i = sec.start; i <= sec.end; i++) {
			const line = found.stripped[i].toLowerCase();
			const arrow = line.indexOf('->');
			if (arrow < 0) continue;
			const toks = line.replace(/[\[\]|]/g, ' ').split(/\s+/).filter(Boolean);
			for (let k = 1; k < toks.length; k++) {
				if (moveTok[toks[k - 1]] && !moveTok[toks[k]] && toks[k] !== '->') movers[toks[k]] = true;
			}
		}
		return movers;
	}

	/////////////////////////////////////////////////////////////////////
	// Game model (extracted from the compiled engine `state`)
	/////////////////////////////////////////////////////////////////////

	function extractModel(sourceText) {
		if (typeof state === 'undefined' || !state || !state.objects || !state.collisionLayers) return null;
		const stride = STRIDE_OBJ;
		const objectCount = state.objectCount;
		const objects = [];
		for (const name in state.objects) {
			const o = state.objects[name];
			objects[o.id] = {
				id: o.id,
				name: name,
				display: (state.original_case_names && state.original_case_names[name]) || name,
				layer: o.layer,
				colors: o.colors,
				sprite: o.spritematrix,
			};
		}
		const layerCount = state.collisionLayers.length;
		const layerMasks = state.layerMasks.map(function (bv) { return Int32Array.from(bv.data); });
		const layerObjects = [];
		for (let l = 0; l < layerCount; l++) layerObjects.push([]);
		objects.forEach(function (o) { if (o) layerObjects[o.layer].push(o.id); });

		const playerIds = state.playerMask && state.playerMask[1] ? idsFromBitData(state.playerMask[1].data, objectCount) : [];

		// Name resolution (objects, synonyms, aggregates, properties).
		const names = {};
		objects.forEach(function (o) { if (o) names[o.name] = { kind: 'object', ids: [o.id] }; });
		const syn = {}, agg = {}, prop = {};
		(state.legend_synonyms || []).forEach(function (s) { syn[s[0]] = s[1]; });
		(state.legend_aggregates || []).forEach(function (s) { agg[s[0]] = s.slice(1); });
		(state.legend_properties || []).forEach(function (s) { prop[s[0]] = s.slice(1); });
		function resolve(name, depth) {
			if (names[name]) return names[name];
			if (depth > 32) return null;
			let r = null;
			if (syn[name] !== undefined) {
				const t = resolve(syn[name], depth + 1);
				if (t) r = { kind: t.kind, ids: t.ids.slice() };
			} else if (agg[name] !== undefined) {
				const ids = [];
				agg[name].forEach(function (p) { const t = resolve(p, depth + 1); if (t) t.ids.forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); }); });
				r = { kind: 'aggregate', ids: ids };
			} else if (prop[name] !== undefined) {
				const ids = [];
				prop[name].forEach(function (p) { const t = resolve(p, depth + 1); if (t) t.ids.forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); }); });
				r = { kind: 'property', ids: ids };
			}
			if (r) names[name] = r;
			return r;
		}
		Object.keys(syn).concat(Object.keys(agg), Object.keys(prop)).forEach(function (n) { resolve(n, 0); });

		// Single character glyphs usable in levels (skip properties).
		const lines = sourceText.split('\n');
		const caseMap = legendCaseMap(lines);
		const glyphs = [];
		const glyphByKey = {};
		const glyphKeyByChar = {};
		const bg = state.backgroundid;
		const order = state.glyphOrder || Object.keys(state.glyphDict);
		order.forEach(function (ch) {
			if (ch.length !== 1) return;
			const n = names[ch];
			if (n && n.kind === 'property') return;
			const arr = state.glyphDict[ch];
			if (!arr) return;
			const ids = arr.filter(function (id) { return id >= 0; });
			const key = ids.filter(function (id) { return id !== bg; }).sort(function (a, b) { return a - b; }).join(',');
			const g = { ch: caseMap[ch] || ch, ids: ids, key: key };
			glyphs.push(g);
			glyphKeyByChar[ch] = key;
			if (glyphByKey[key] === undefined) glyphByKey[key] = g;
		});

		const levels = state.levels.map(function (lv, i) {
			if (lv.message !== undefined) return { index: i, message: lv.message };
			return { index: i, board: { w: lv.width, h: lv.height, cells: new Int32Array(lv.objects) } };
		});

		const blocks = findLevelBlocks(lines);
		let levelMapOK = blocks.length === levels.length;
		if (levelMapOK) {
			for (let i = 0; i < blocks.length; i++) {
				const isMsg = levels[i].message !== undefined;
				if ((blocks[i].kind === 'message') !== isMsg) { levelMapOK = false; break; }
				if (!isMsg && blocks[i].end - blocks[i].start + 1 !== levels[i].board.h) { levelMapOK = false; break; }
			}
		}

		return {
			stride: stride,
			objectCount: objectCount,
			objects: objects,
			layerCount: layerCount,
			layerMasks: layerMasks,
			layerObjects: layerObjects,
			backgroundId: bg,
			backgroundLayer: state.backgroundlayer,
			playerIds: playerIds,
			names: names,
			glyphs: glyphs,
			glyphByKey: glyphByKey,
			glyphKeyByChar: glyphKeyByChar,
			levels: levels,
			levelMapOK: levelMapOK,
			metadata: state.metadata || {},
			bgcolor: state.bgcolor,
			fgcolor: state.fgcolor,
			noaction: !!(state.metadata && state.metadata.noaction !== undefined),
			winText: parseWinconditionText(lines),
			movers: parseMovingNames(lines),
			usesRandom: /\brandom(dir)?\b/i.test(sourceText),
		};
	}

	function cellIds(model, board, tile) {
		const ids = [];
		for (let id = 0; id < model.objectCount; id++) {
			if (hasBit(board.cells, tile, id, model.stride)) ids.push(id);
		}
		return ids;
	}

	// Put object `id` on a tile, replacing whatever shares its collision layer.
	function placeObject(model, cells, tile, id) {
		const layer = model.objects[id].layer;
		const mask = model.layerMasks[layer];
		for (let k = 0; k < model.stride; k++) cells[tile * model.stride + k] &= ~mask[k];
		setBit(cells, tile, id, model.stride);
	}

	function ensureBackground(model, cells, tile) {
		const mask = model.layerMasks[model.backgroundLayer];
		for (let k = 0; k < model.stride; k++) if (cells[tile * model.stride + k] & mask[k]) return;
		setBit(cells, tile, model.backgroundId, model.stride);
	}

	// Remove the top-most non-background object from a tile. Returns true if changed.
	function eraseTop(model, cells, tile) {
		const ids = [];
		for (let id = 0; id < model.objectCount; id++) if (hasBit(cells, tile, id, model.stride)) ids.push(id);
		ids.sort(function (a, b) { return model.objects[b].layer - model.objects[a].layer; });
		for (let i = 0; i < ids.length; i++) {
			if (model.objects[ids[i]].layer !== model.backgroundLayer) {
				clearBit(cells, tile, ids[i], model.stride);
				ensureBackground(model, cells, tile);
				return true;
			}
		}
		return false;
	}

	function countObjects(model, board) {
		let n = 0;
		for (let t = 0; t < board.w * board.h; t++) {
			for (let id = 0; id < model.objectCount; id++) {
				// hasBit first: objects missing from every collision layer have no entry.
				if (hasBit(board.cells, t, id, model.stride) && model.objects[id].layer !== model.backgroundLayer) n++;
			}
		}
		return n;
	}

	/////////////////////////////////////////////////////////////////////
	// Board -> level text (write back into the source)
	/////////////////////////////////////////////////////////////////////

	const SPARE_GLYPHS = 'abcdefghijklmnopqrstuvwxyz0123456789!$%&+-:;<>?^_~\'"`/\\{}';

	// Returns { rows: [...], newLegend: [lines] } ; may invent aggregate glyphs.
	// `previousRows`/`originalBoard` (optional): keep the author's glyph wherever
	// it still means the same thing. PuzzleScript fills a per-level default
	// background under glyphs that don't name one, so glyphs are also matched
	// "modulo" that fill object.
	function boardToRows(model, board, extraGlyphs, previousRows, originalBoard) {
		const bg = model.backgroundId;
		const bgLayer = {};
		model.layerObjects[model.backgroundLayer].forEach(function (id) { bgLayer[id] = true; });
		const glyphHasBg = {};
		model.glyphs.forEach(function (g) { glyphHasBg[g.ch.toLowerCase()] = g.ids.some(function (id) { return bgLayer[id]; }); });
		let fillBg = bg;
		if (previousRows && originalBoard && originalBoard.w === board.w && originalBoard.h === board.h) {
			search: for (let y = 0; y < board.h; y++) {
				for (let x = 0; x < board.w; x++) {
					const prev = previousRows[y] ? previousRows[y][x] : undefined;
					if (prev === undefined || glyphHasBg[prev.toLowerCase()] !== false) continue;
					const bgs = cellIds(model, originalBoard, x * board.h + y).filter(function (id) { return bgLayer[id]; });
					if (bgs.length === 1) { fillBg = bgs[0]; break search; }
				}
			}
		}
		const used = {};
		model.glyphs.forEach(function (g) { used[g.ch.toLowerCase()] = true; });
		Object.keys(model.names).forEach(function (n) { if (n.length === 1) used[n] = true; });
		extraGlyphs = extraGlyphs || {};
		Object.keys(extraGlyphs).forEach(function (k) { used[extraGlyphs[k].toLowerCase()] = true; });
		const newLegend = [];
		const rows = [];
		for (let y = 0; y < board.h; y++) {
			let row = '';
			for (let x = 0; x < board.w; x++) {
				const tile = x * board.h + y;
				const all = cellIds(model, board, tile);
				const ids = all.filter(function (id) { return id !== bg; });
				const key = ids.join(',');
				const bgs = all.filter(function (id) { return bgLayer[id]; });
				const fgKey = all.filter(function (id) { return !bgLayer[id]; }).join(',');
				const onFill = bgs.length === 1 && bgs[0] === fillBg;
				const prev = previousRows && previousRows[y] ? previousRows[y][x] : undefined;
				if (prev !== undefined) {
					const pl = prev.toLowerCase();
					const pk = model.glyphKeyByChar[pl];
					if (pk === key || (onFill && glyphHasBg[pl] === false && pk === fgKey)) { row += prev; continue; }
				}
				let g = model.glyphByKey[key];
				if (!g && onFill) {
					const h = model.glyphByKey[fgKey];
					if (h && glyphHasBg[h.ch.toLowerCase()] === false) g = h;
				}
				let ch = g ? g.ch : extraGlyphs[key];
				if (!ch) {
					let pick = null;
					for (let i = 0; i < SPARE_GLYPHS.length; i++) {
						const c = SPARE_GLYPHS[i];
						if (!used[c]) { pick = c; break; }
					}
					if (!pick) throw new Error('Ran out of spare legend characters.');
					used[pick] = true;
					extraGlyphs[key] = pick;
					ch = pick;
					const parts = ids.map(function (id) { return model.objects[id].display; });
					newLegend.push(pick + ' = ' + (parts.length ? parts.join(' and ') : model.objects[bg].display));
				}
				row += ch;
			}
			rows.push(row);
		}
		return { rows: rows, newLegend: newLegend };
	}

	// Replace level `levelIndex` in source text with `board`. Returns new text.
	function writeLevelToSource(model, sourceText, levelIndex, board) {
		const lines = sourceText.split('\n');
		const blocks = findLevelBlocks(lines);
		const block = blocks[levelIndex];
		if (!block || block.kind !== 'level') throw new Error('Could not locate level ' + levelIndex + ' in the source.');
		const previousRows = lines.slice(block.start, block.end + 1).map(function (r) { return r.trim(); });
		const original = model.levels[levelIndex] && model.levels[levelIndex].board;
		const out = boardToRows(model, board, null, previousRows, original);
		lines.splice(block.start, block.end - block.start + 1, ...out.rows);
		if (out.newLegend.length) insertLegendLines(lines, out.newLegend);
		return lines.join('\n');
	}

	function insertLegendLines(lines, newLines) {
		const found = findSections(lines);
		const sec = found.sections.legend;
		if (!sec) throw new Error('No LEGEND section to add glyphs to.');
		let last = sec.start;
		for (let i = sec.start; i <= sec.end; i++) if (/=/.test(found.stripped[i])) last = i;
		lines.splice(last + 1, 0, ...newLines);
	}

	// Append a new level (copy of `board`) after level `afterIndex`.
	function insertLevelInSource(model, sourceText, afterIndex, board) {
		const lines = sourceText.split('\n');
		const blocks = findLevelBlocks(lines);
		const out = boardToRows(model, board);
		let at;
		if (blocks.length === 0) {
			const found = findSections(lines);
			at = found.sections.levels ? found.sections.levels.end + 1 : lines.length;
		} else {
			const b = blocks[Math.min(afterIndex, blocks.length - 1)];
			at = b.end + 1;
		}
		lines.splice(at, 0, '', ...out.rows);
		if (out.newLegend.length) insertLegendLines(lines, out.newLegend);
		return lines.join('\n');
	}

	/////////////////////////////////////////////////////////////////////
	// Transform language (PuzzleScript+MIS "choose" / "option" / "or")
	/////////////////////////////////////////////////////////////////////
	//
	//   [Target no Crate] -> [Target Crate]            apply everywhere
	//   option 0.4 [Wall] -> []                          each match with p=0.4
	//   choose 5 [Wall] -> [Crate]                       5 random matches
	//   choose 2-6 [Wall] -> []                          2..6 random matches
	//   choose 20 option 0.4 [Wall] -> []
	//   or option 0.6 [no Obstacle] -> [Wall]            weighted alternatives
	//   choose 1 [Crate][Target] -> [][]                 disjoint cell groups
	//   choose 9 horizontal [Player | no Wall] -> [ | Player]

	const DIRS = {
		up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
	};

	function parseTransform(text, model) {
		const rawLines = text.split('\n');
		const lines = stripCommentsPerLine(rawLines);
		const statements = [];
		const errors = [];
		function err(line, msg) { errors.push({ line: line, message: msg }); }

		for (let li = 0; li < lines.length; li++) {
			let line = lines[li].trim();
			if (!line) continue;
			const low = line.toLowerCase();
			if (/^=+$/.test(low) || low === 'transform' || low === 'generation') continue;
			const toks = low.replace(/\[/g, ' [ ').replace(/\]/g, ' ] ').replace(/\|/g, ' | ').replace(/->/g, ' -> ').split(/\s+/).filter(Boolean);
			let pos = 0;
			let stmt;
			if (toks[0] === 'or') {
				if (!statements.length) { err(li, "'or' needs a rule above it to be an alternative of."); continue; }
				stmt = statements[statements.length - 1];
				pos = 1;
			} else {
				stmt = { choose: null, alts: [], line: li };
				if (toks[pos] === 'choose') {
					pos++;
					const m = /^(\d+)(?:-(\d+))?$/.exec(toks[pos] || '');
					if (!m) { err(li, "Expected a number after 'choose' (e.g. choose 5 or choose 2-6)."); continue; }
					const lo = parseInt(m[1], 10), hi = m[2] !== undefined ? parseInt(m[2], 10) : lo;
					stmt.choose = [Math.min(lo, hi), Math.max(lo, hi)];
					pos++;
				}
				statements.push(stmt);
			}
			// One or more alternatives on this line, separated by 'or'.
			while (pos < toks.length) {
				const alt = { prob: null, dirs: null, lhs: [], rhs: [], line: li };
				if (toks[pos] === 'option') {
					pos++;
					const p = parseFloat(toks[pos]);
					if (!(p >= 0 && p <= 1)) { err(li, "Expected a probability between 0 and 1 after 'option'."); pos = toks.length; break; }
					alt.prob = p;
					pos++;
				}
				while (toks[pos] && (DIRS[toks[pos]] || toks[pos] === 'horizontal' || toks[pos] === 'vertical')) {
					const d = toks[pos];
					alt.dirs = alt.dirs || [];
					if (d === 'horizontal') alt.dirs.push('left', 'right');
					else if (d === 'vertical') alt.dirs.push('up', 'down');
					else alt.dirs.push(d);
					pos++;
				}
				let side = alt.lhs;
				let ok = true;
				while (pos < toks.length && toks[pos] !== 'or') {
					const t = toks[pos];
					if (t === '->') {
						if (side === alt.rhs) { err(li, "Unexpected second '->'."); ok = false; break; }
						side = alt.rhs; pos++; continue;
					}
					if (t !== '[') { err(li, "Unexpected '" + t + "' - rules look like [ a | b ] -> [ c | d ]."); ok = false; break; }
					pos++;
					const pattern = [];
					let cell = [];
					let neg = false;
					while (pos < toks.length && toks[pos] !== ']') {
						const u = toks[pos++];
						if (u === '|') { pattern.push(cell); cell = []; neg = false; continue; }
						if (u === 'no') { neg = true; continue; }
						const r = model.names[u];
						if (!r) { err(li, "Unknown object name '" + u + "'."); ok = false; break; }
						cell.push({ neg: neg, name: u, kind: r.kind, ids: r.ids });
						neg = false;
					}
					if (!ok) break;
					if (toks[pos] !== ']') { err(li, "Missing ']'."); ok = false; break; }
					pos++;
					pattern.push(cell);
					side.push(pattern);
				}
				if (!ok) { pos = toks.length; break; }
				if (toks[pos] === 'or') pos++;
				if (!alt.lhs.length) { err(li, 'Rule has no left-hand side.'); break; }
				if (alt.rhs.length !== alt.lhs.length) { err(li, 'Left and right sides need the same number of [ ] groups.'); break; }
				let shapeOK = true;
				for (let p = 0; p < alt.lhs.length; p++) {
					if (alt.lhs[p].length !== alt.rhs[p].length) { err(li, 'Each [ ] group needs the same number of cells on both sides.'); shapeOK = false; break; }
					for (let c = 0; c < alt.rhs[p].length; c++) {
						alt.rhs[p][c].forEach(function (term) {
							if (term.neg || term.kind !== 'property') return;
							const inLhs = alt.lhs[p][c].some(function (l) { return !l.neg && l.name === term.name; });
							if (!inLhs) { err(li, "'" + term.name + "' is a property (it could mean several objects), so it can only stay on the right if it's also on the left."); shapeOK = false; }
						});
					}
				}
				if (!shapeOK) break;
				const multi = alt.lhs.some(function (p) { return p.length > 1; });
				if (!alt.dirs) alt.dirs = multi ? ['up', 'down', 'left', 'right'] : ['right'];
				stmt.alts.push(alt);
			}
		}
		// Drop statements that ended up with no valid alternatives.
		const valid = statements.filter(function (s) { return s.alts.length > 0; });
		return { statements: valid, errors: errors };
	}

	function termMatches(cells, tile, term, stride) {
		let any = false, all = true;
		for (let i = 0; i < term.ids.length; i++) {
			if (hasBit(cells, tile, term.ids[i], stride)) any = true; else all = false;
		}
		const present = term.kind === 'aggregate' ? all : any;
		return term.neg ? !present : present;
	}

	function cellMatches(cells, tile, cellTerms, stride) {
		for (let i = 0; i < cellTerms.length; i++) if (!termMatches(cells, tile, cellTerms[i], stride)) return false;
		return true;
	}

	// All anchors (tile list) where `pattern` matches along one of `dirs`.
	function findPatternMatches(board, pattern, dirs, stride) {
		const out = [];
		const n = pattern.length;
		for (let di = 0; di < dirs.length; di++) {
			const d = DIRS[dirs[di]];
			for (let x = 0; x < board.w; x++) {
				for (let y = 0; y < board.h; y++) {
					const ex = x + d[0] * (n - 1), ey = y + d[1] * (n - 1);
					if (ex < 0 || ey < 0 || ex >= board.w || ey >= board.h) continue;
					let ok = true;
					const tiles = [];
					for (let k = 0; k < n; k++) {
						const tile = (x + d[0] * k) * board.h + (y + d[1] * k);
						if (!cellMatches(board.cells, tile, pattern[k], stride)) { ok = false; break; }
						tiles.push(tile);
					}
					if (ok) out.push(tiles);
				}
			}
			if (n === 1) break; // direction is irrelevant for single cells
		}
		return out;
	}

	function applyCellReplacement(model, cells, tile, lhsCell, rhsCell) {
		const stride = model.stride;
		const rhsPosNames = {};
		rhsCell.forEach(function (t) { if (!t.neg) rhsPosNames[t.name] = true; });
		const lhsPosNames = {};
		lhsCell.forEach(function (t) {
			if (t.neg) return;
			lhsPosNames[t.name] = true;
			if (!rhsPosNames[t.name]) t.ids.forEach(function (id) { clearBit(cells, tile, id, stride); });
		});
		rhsCell.forEach(function (t) {
			if (t.neg) { t.ids.forEach(function (id) { clearBit(cells, tile, id, stride); }); return; }
			if (lhsPosNames[t.name]) return;
			t.ids.forEach(function (id) { placeObject(model, cells, tile, id); });
		});
		ensureBackground(model, cells, tile);
	}

	// Apply one match (array of tile-lists per pattern). Reverts and returns
	// false if it would touch a frozen tile or change nothing.
	function applyMatch(model, board, alt, match, frozen) {
		const stride = model.stride;
		const saved = [];
		for (let p = 0; p < match.length; p++) {
			for (let c = 0; c < match[p].length; c++) {
				const tile = match[p][c];
				saved.push([tile, board.cells.slice(tile * stride, tile * stride + stride)]);
			}
		}
		for (let p = 0; p < match.length; p++) {
			for (let c = 0; c < match[p].length; c++) {
				applyCellReplacement(model, board.cells, match[p][c], alt.lhs[p][c], alt.rhs[p][c]);
			}
		}
		let changed = false, frozenHit = false;
		for (let s = 0; s < saved.length; s++) {
			const tile = saved[s][0], before = saved[s][1];
			for (let k = 0; k < stride; k++) {
				if (board.cells[tile * stride + k] !== before[k]) {
					changed = true;
					if (frozen && frozen[tile]) frozenHit = true;
					break;
				}
			}
		}
		if (!changed || frozenHit) {
			for (let s = saved.length - 1; s >= 0; s--) board.cells.set(saved[s][1], saved[s][0] * stride);
			return false;
		}
		return true;
	}

	function matchStillValid(model, board, alt, match) {
		for (let p = 0; p < match.length; p++) {
			for (let c = 0; c < match[p].length; c++) {
				if (!cellMatches(board.cells, match[p][c], alt.lhs[p][c], model.stride)) return false;
			}
		}
		return true;
	}

	// Pick and apply one random match of `alt`. Returns true if applied.
	function applyRandomMatch(model, board, alt, frozen, rng) {
		const per = alt.lhs.map(function (pattern) { return findPatternMatches(board, pattern, alt.dirs, model.stride); });
		if (per.some(function (m) { return m.length === 0; })) return false;
		if (per.length === 1) {
			const order = shuffleInPlace(per[0].map(function (_, i) { return i; }), rng);
			const tries = Math.min(order.length, 40);
			for (let i = 0; i < tries; i++) {
				if (applyMatch(model, board, alt, [per[0][order[i]]], frozen)) return true;
			}
			return false;
		}
		for (let attempt = 0; attempt < 60; attempt++) {
			const match = per.map(function (list) { return list[Math.floor(rng() * list.length)]; });
			const seen = {};
			let disjoint = true;
			for (let p = 0; p < match.length && disjoint; p++) {
				for (let c = 0; c < match[p].length; c++) {
					if (seen[match[p][c]]) { disjoint = false; break; }
					seen[match[p][c]] = true;
				}
			}
			if (!disjoint) continue;
			if (applyMatch(model, board, alt, match, frozen)) return true;
		}
		return false;
	}

	function applyEverywhere(model, board, alt, frozen, rng) {
		let any = false;
		if (alt.lhs.length > 1) {
			const n = alt.prob === null ? 200 : 1;
			for (let i = 0; i < n; i++) {
				if (alt.prob !== null && rng() >= alt.prob) continue;
				if (applyRandomMatch(model, board, alt, frozen, rng)) any = true; else break;
			}
			return any;
		}
		const passes = alt.prob === null ? 64 : 1;
		for (let pass = 0; pass < passes; pass++) {
			const matches = shuffleInPlace(findPatternMatches(board, alt.lhs[0], alt.dirs, model.stride), rng);
			let changed = false;
			for (let i = 0; i < matches.length; i++) {
				if (alt.prob !== null && rng() >= alt.prob) continue;
				if (!matchStillValid(model, board, alt, [matches[i]])) continue;
				if (applyMatch(model, board, alt, [matches[i]], frozen)) changed = true;
			}
			if (!changed) break;
			any = true;
		}
		return any;
	}

	function pickAlternative(alts, rng) {
		// Weighted by option probabilities; plain alternatives weigh 1.
		const weights = alts.map(function (a) { return a.prob === null ? 1 : a.prob; });
		const order = [];
		const pool = alts.map(function (a, i) { return i; });
		const w = weights.slice();
		while (pool.length) {
			let total = 0;
			pool.forEach(function (i) { total += w[i]; });
			if (total <= 0) { order.push.apply(order, pool); break; }
			let r = rng() * total;
			let k = 0;
			for (; k < pool.length - 1; k++) { r -= w[pool[k]]; if (r < 0) break; }
			order.push(pool[k]);
			pool.splice(k, 1);
		}
		return order;
	}

	function runTransform(model, program, baseBoard, frozen, rng) {
		const board = cloneBoard(baseBoard);
		program.statements.forEach(function (stmt) {
			if (stmt.choose) {
				const count = stmt.choose[0] + Math.floor(rng() * (stmt.choose[1] - stmt.choose[0] + 1));
				for (let i = 0; i < count; i++) {
					const order = stmt.alts.length > 1 ? pickAlternative(stmt.alts, rng) : [0];
					if (stmt.alts.length === 1 && stmt.alts[0].prob !== null && rng() >= stmt.alts[0].prob) continue;
					for (let k = 0; k < order.length; k++) {
						if (applyRandomMatch(model, board, stmt.alts[order[k]], frozen, rng)) break;
					}
				}
			} else {
				const alt = stmt.alts[stmt.alts.length > 1 ? pickAlternative(stmt.alts, rng)[0] : 0];
				applyEverywhere(model, board, alt, frozen, rng);
			}
		});
		return board;
	}

	/////////////////////////////////////////////////////////////////////
	// Presets derived from the game itself
	/////////////////////////////////////////////////////////////////////

	// Objects that block movers but never move and aren't goals (Wall-like).
	function staticSolids(model) {
		const moverIds = [];
		Object.keys(model.movers).forEach(function (n) {
			const r = model.names[n];
			if (r) r.ids.forEach(function (id) { if (moverIds.indexOf(id) < 0) moverIds.push(id); });
		});
		const winIds = {};
		model.winText.forEach(function (w) {
			[w.a, w.b].forEach(function (n) { const r = n && model.names[n]; if (r) r.ids.forEach(function (id) { winIds[id] = true; }); });
		});
		const moverLayers = {};
		moverIds.concat(model.playerIds).forEach(function (id) { moverLayers[model.objects[id].layer] = true; });
		return model.objects.filter(function (o) {
			return o && o.layer !== model.backgroundLayer && moverLayers[o.layer] &&
				moverIds.indexOf(o.id) < 0 && model.playerIds.indexOf(o.id) < 0 && !winIds[o.id];
		}).map(function (o) { return o.id; });
	}

	function derivePresets(model) {
		const presets = [];
		const disp = function (id) { return model.objects[id].display; };
		const nameOf = function (n) {
			const r = model.names[n];
			if (r && r.kind === 'object') return disp(r.ids[0]);
			return n.length === 1 ? null : n.charAt(0).toUpperCase() + n.slice(1);
		};
		const layerFree = function (layer) {
			return model.layerObjects[layer].map(function (id) { return 'no ' + disp(id); }).join(' ');
		};
		const playerLayer = model.playerIds.length ? model.objects[model.playerIds[0]].layer : -1;
		const playerNames = model.playerIds.map(disp);
		// Transforms need concrete objects to move; a property like Player = PlayerL or PlayerR can't be placed.
		const playerName = model.names.player && model.names.player.kind === 'object' ? 'Player' : (playerNames[0] || null);

		// Movers: player + objects pushed/moved by rules.
		const moverIds = [];
		Object.keys(model.movers).forEach(function (n) {
			const r = model.names[n];
			if (!r) return;
			r.ids.forEach(function (id) {
				if (model.playerIds.indexOf(id) >= 0) return;
				if (moverIds.indexOf(id) < 0) moverIds.push(id);
			});
		});
		const winIds = {};
		model.winText.forEach(function (w) {
			[w.a, w.b].forEach(function (n) {
				const r = n && model.names[n];
				if (r) r.ids.forEach(function (id) { winIds[id] = true; });
			});
		});
		// Static solids: sit on a layer shared with movers/player, never move, not in win conditions.
		const moverLayers = {};
		moverIds.concat(model.playerIds).forEach(function (id) { moverLayers[model.objects[id].layer] = true; });
		const staticIds = model.objects.filter(function (o) {
			return o && o.layer !== model.backgroundLayer && moverLayers[o.layer] &&
				moverIds.indexOf(o.id) < 0 && model.playerIds.indexOf(o.id) < 0 && !winIds[o.id];
		}).map(function (o) { return o.id; });

		const moveLines = [];
		if (playerLayer >= 0) {
			(playerName === 'Player' ? ['Player'] : playerNames).forEach(function (p) {
				moveLines.push('[ ' + p + ' | ' + layerFree(playerLayer) + ' ] -> [ | ' + p + ' ]');
			});
		}
		moverIds.forEach(function (id) {
			moveLines.push('[ ' + disp(id) + ' | ' + layerFree(model.objects[id].layer) + ' ] -> [ | ' + disp(id) + ' ]');
		});
		if (moveLines.length) {
			presets.push({
				id: 'move', label: 'Shuffle movers',
				hint: 'Slide ' + [playerName].concat(moverIds.map(disp)).filter(Boolean).join(', ') + ' around.',
				text: '(slide the player and movable objects around)\nchoose 12 ' + moveLines.join('\nor ') + '\n',
			});
		}
		staticIds.forEach(function (id) {
			const layer = model.objects[id].layer;
			presets.push({
				id: 'walls-' + id, label: 'Add/remove ' + disp(id),
				hint: 'Knock out or build ' + disp(id) + ' tiles (biased toward adding).',
				text: '(randomly remove or add ' + disp(id) + ')\nchoose 8 option 0.4 [ ' + disp(id) + ' ] -> [ ]\nor option 0.6 [ ' + layerFree(layer) + (playerLayer >= 0 && playerLayer !== layer ? ' ' + layerFree(playerLayer) : '') + ' ] -> [ ' + disp(id) + ' ]\n',
			});
		});
		model.winText.forEach(function (w) {
			const A = nameOf(w.a), B = w.b ? nameOf(w.b) : null;
			if (!A) return;
			const ra = model.names[w.a], rb = w.b ? model.names[w.b] : null;
			if (!ra) return;
			const layerA = model.objects[ra.ids[0]].layer;
			if (w.quant !== 'no' && B && rb && ra.kind === 'object' && rb.kind === 'object') {
				const layerB = model.objects[rb.ids[0]].layer;
				const freeA = layerFree(layerA);
				const freeB = layerFree(layerB) + (layerB !== layerA ? ' ' + staticIds.filter(function (id) { return model.objects[id].layer === layerA; }).map(function (id) { return 'no ' + disp(id); }).join(' ') : '');
				presets.push({
					id: 'pair-' + w.a + '-' + w.b, label: 'Swap a ' + A + '/' + B + ' pair',
					hint: 'From "' + w.quant + ' ' + w.a + ' on ' + w.b + '": remove one pair, add one elsewhere.',
					text: '(remove one ' + A + '/' + B + ' pair and add one somewhere else)\nchoose 1 [ ' + A + ' ] [ ' + B + ' ] -> [ ] [ ]\nchoose 1 [ ' + freeA + ' ' + layerFree(layerB) + ' ] [ ' + freeB.trim() + ' ' + (layerA !== layerB ? freeA : '') + ' ] -> [ ' + A + ' ] [ ' + B + ' ]\n',
				});
				// Backward design needs one side of the pair to be something the player moves.
				const aMoves = moverIds.indexOf(ra.ids[0]) >= 0, bMoves = moverIds.indexOf(rb.ids[0]) >= 0;
				if (playerName && playerLayer >= 0 && (aMoves || bMoves)) {
					const M = aMoves ? A : B, S = aMoves ? B : A;
					const freeM = layerFree(model.objects[(aMoves ? ra : rb).ids[0]].layer);
					presets.push({
						id: 'backward-' + w.a, label: 'Backward design',
						hint: 'Start from the solved state (a ' + M + ' on every ' + S + ') and let the player pull ' + M + 's away.',
						text: '(backward design, after Taylor & Parberry 2011: start from the solved state...)\n[ ' + S + ' ' + freeM + ' ] -> [ ' + S + ' ' + M + ' ]\n(...then walk the player around, pulling ' + M + 's with them)\nchoose 40 [ ' + playerName + ' | ' + layerFree(playerLayer) + ' ] -> [ | ' + playerName + ' ]\nor [ ' + layerFree(playerLayer) + ' | ' + playerName + ' | ' + M + ' ] -> [ ' + playerName + ' | ' + M + ' | ]\n',
					});
				}
			} else if (w.quant === 'no' && ra.kind === 'object') {
				presets.push({
					id: 'no-' + w.a, label: 'Add/remove ' + A,
					hint: 'From "no ' + w.a + '": vary how many ' + A + ' there are.',
					text: 'choose 3 option 0.5 [ ' + A + ' ] -> [ ]\nor option 0.5 [ ' + layerFree(layerA) + ' ] -> [ ' + A + ' ]\n',
				});
			}
		});
		if (presets.length > 1) {
			presets.push({
				id: 'mix', label: 'A bit of everything',
				hint: 'All of the above, in smaller doses.',
				text: presets.filter(function (p) { return p.id.indexOf('backward') !== 0; })
					.map(function (p) { return p.text.replace(/choose (\d+)/g, function (_, n) { return 'choose ' + Math.max(1, Math.ceil(parseInt(n, 10) / 2)); }); }).join('\n'),
			});
		}
		return presets;
	}

	/////////////////////////////////////////////////////////////////////
	// Solver (drives the real engine; needs a compiled game in `state`)
	/////////////////////////////////////////////////////////////////////

	let wonFlag = false;
	let hooksInstalled = false;
	function installEngineHooks() {
		if (hooksInstalled) return;
		hooksInstalled = true;
		// eslint-disable-next-line no-global-assign
		DoWin = function () { wonFlag = true; };
	}

	function loadBoardIntoEngine(model, board, seed) {
		installEngineHooks();
		const lv = new Level(0, board.w, board.h, model.layerCount, new Int32Array(board.cells));
		loadLevelFromLevelDat(state, lv, seed || 'mis');
		curlevel = 0;
		textMode = false;
		titleScreen = false;
		winning = false;
		settleAgain();
	}

	function settleAgain() {
		for (let pass = 0; pass < 200 && againing; pass++) {
			againing = false;
			processInput(-1, false, false, true);
		}
		againing = false;
	}

	function restoreTo(objects) {
		restoreLevel({ dat: objects, width: level.width, height: level.height, oldflickscreendat: [] });
	}

	// One step from the current engine level; returns {changed, won}.
	function engineStep(input) {
		wonFlag = false;
		const changed = processInput(input, false, false, true);
		settleAgain();
		textMode = false;
		winning = false;
		backups.length = 0;
		return { changed: !!changed, won: wonFlag };
	}

	function winconditionsNow() {
		// Mirrors checkWin() without side effects.
		if (!state.winconditions.length) return false;
		for (let w = 0; w < state.winconditions.length; w++) {
			const wc = state.winconditions[w];
			const f1 = wc[1], f2 = wc[2], a1 = wc[4], a2 = wc[5];
			const m1 = function (i) { return a1 ? maskAggregateMatchesAtTile(f1, i) : maskAnyMatchesAtTile(f1, i); };
			const m2 = function (i) { return a2 ? maskAggregateMatchesAtTile(f2, i) : maskAnyMatchesAtTile(f2, i); };
			let pass = true;
			if (wc[0] === -1) { for (let i = 0; i < level.n_tiles; i++) if (m1(i) && m2(i)) { pass = false; break; } }
			else if (wc[0] === 0) { pass = false; for (let i = 0; i < level.n_tiles; i++) if (m1(i) && m2(i)) { pass = true; break; } }
			else { for (let i = 0; i < level.n_tiles; i++) if (m1(i) && !m2(i)) { pass = false; break; } }
			if (!pass) return false;
		}
		return true;
	}

	// Heuristic: unsatisfied win-condition tiles plus distance to the nearest fix.
	function heuristicNow() {
		let h = 0;
		const H = level.height;
		for (let w = 0; w < state.winconditions.length; w++) {
			const wc = state.winconditions[w];
			const f1 = wc[1], f2 = wc[2], a1 = wc[4], a2 = wc[5];
			const m1 = function (i) { return a1 ? maskAggregateMatchesAtTile(f1, i) : maskAnyMatchesAtTile(f1, i); };
			const m2 = function (i) { return a2 ? maskAggregateMatchesAtTile(f2, i) : maskAnyMatchesAtTile(f2, i); };
			if (wc[0] === -1) {
				for (let i = 0; i < level.n_tiles; i++) if (m1(i) && m2(i)) h++;
			} else {
				const bad = [], spots = [];
				let satisfied = 0;
				for (let i = 0; i < level.n_tiles; i++) {
					const a = m1(i), b = m2(i);
					if (a && b) satisfied++;
					else if (a) bad.push(i);
					else if (b) spots.push(i);
				}
				if (wc[0] === 0 && satisfied > 0) continue;
				const list = wc[0] === 0 ? bad.slice(0, 1) : bad;
				for (let k = 0; k < list.length; k++) {
					const ax = (list[k] / H) | 0, ay = list[k] % H;
					let best = 0;
					if (spots.length) {
						best = 1e9;
						for (let s = 0; s < spots.length; s++) {
							const d = Math.abs(((spots[s] / H) | 0) - ax) + Math.abs(spots[s] % H - ay);
							if (d < best) best = d;
						}
					}
					h += 1 + best;
				}
			}
		}
		return h;
	}

	function Heap() { this.items = []; }
	Heap.prototype.push = function (item) {
		const a = this.items; a.push(item);
		let i = a.length - 1;
		while (i > 0) {
			const p = (i - 1) >> 1;
			if (a[p].f < item.f || (a[p].f === item.f && a[p].g <= item.g)) break;
			a[i] = a[p]; i = p;
		}
		a[i] = item;
	};
	Heap.prototype.pop = function () {
		const a = this.items;
		const top = a[0], last = a.pop();
		if (a.length) {
			let i = 0;
			const n = a.length;
			for (;;) {
				const l = 2 * i + 1, r = l + 1;
				let m = i;
				let mv = last;
				if (l < n && (a[l].f < mv.f || (a[l].f === mv.f && a[l].g < mv.g))) { m = l; mv = a[l]; }
				if (r < n && (a[r].f < mv.f || (a[r].f === mv.f && a[r].g < mv.g))) { m = r; mv = a[r]; }
				if (m === i) break;
				a[i] = a[m]; i = m;
			}
			a[i] = last;
		}
		return top;
	};
	Heap.prototype.size = function () { return this.items.length; };

	// strategy: 'bfs' | 'astar' (weighted, w=2) | 'greedy'
	function solve(model, board, opts) {
		opts = opts || {};
		const strategy = opts.strategy || 'astar';
		const maxExpanded = opts.maxExpanded || 200000;
		const deadline = opts.timeMs ? Date.now() + opts.timeMs : Infinity;
		const inputs = model.noaction ? [0, 1, 2, 3] : [0, 1, 2, 3, 4];
		const t0 = Date.now();
		loadBoardIntoEngine(model, board, opts.seed);
		const root = new Int32Array(level.objects);
		if (winconditionsNow()) return { status: 'solved', solution: [], expanded: 0, strategy: strategy, ms: 0 };
		const snaps = [root], parent = [-1], action = [-1], depth = [0];
		const visited = new Set([cellsKey(root)]);
		let expanded = 0;
		const W = strategy === 'greedy' ? 0 : 1, HW = strategy === 'bfs' ? 0 : (strategy === 'greedy' ? 1 : 2);
		let queue, qhead = 0, heap;
		if (strategy === 'bfs') queue = [0];
		else { heap = new Heap(); heap.push({ f: 0, g: 0, n: 0 }); }
		function finish(status, last) {
			const res = { status: status, expanded: expanded, strategy: strategy, ms: Date.now() - t0 };
			if (status === 'solved') {
				const sol = [];
				for (let n = last; n > 0; n = parent[n]) sol.push(action[n]);
				sol.reverse();
				res.solution = sol;
			}
			return res;
		}
		for (;;) {
			let node;
			if (strategy === 'bfs') { if (qhead >= queue.length) return finish('unsolvable'); node = queue[qhead++]; }
			else { if (!heap.size()) return finish('unsolvable'); node = heap.pop().n; }
			if (expanded >= maxExpanded) return finish('timeout');
			if ((expanded & 31) === 0 && Date.now() > deadline) return finish('timeout');
			if (opts.shouldStop && (expanded & 255) === 0 && opts.shouldStop()) return finish('timeout');
			expanded++;
			for (let k = 0; k < inputs.length; k++) {
				restoreTo(snaps[node]);
				const step = engineStep(inputs[k]);
				if (!step.changed && !step.won) continue;
				const key = cellsKey(level.objects);
				if (visited.has(key)) continue;
				visited.add(key);
				const id = snaps.length;
				snaps.push(new Int32Array(level.objects));
				parent.push(node); action.push(inputs[k]); depth.push(depth[node] + 1);
				if (step.won || winconditionsNow()) return finish('solved', id);
				if (strategy === 'bfs') queue.push(id);
				else {
					const h = heuristicNow();
					heap.push({ f: W * depth[id] + HW * h, g: depth[id], n: id });
				}
			}
		}
	}

	// MIS difficulty: solver effort (states expanded) as the min over lanes.
	// A weighted-A* primary proves solvability; greedy and BFS then run capped
	// at primary+6 expansions so they can only lower the score. BFS also
	// yields the true shortest solution when it finishes inside the cap.
	function assess(model, board, opts) {
		opts = opts || {};
		const primary = solve(model, board, { strategy: 'astar', timeMs: opts.timeMs || 1500, maxExpanded: opts.maxExpanded || 150000, shouldStop: opts.shouldStop });
		const out = { status: primary.status, lanes: { astar: primary.expanded }, solution: primary.solution || null, optimal: false, ms: primary.ms };
		if (primary.status !== 'solved') return out;
		out.effort = Math.max(1, primary.expanded);
		out.length = primary.solution.length;
		if (opts.refine === false) return out;
		const cap = primary.expanded + 6;
		const greedy = solve(model, board, { strategy: 'greedy', maxExpanded: cap, timeMs: opts.timeMs || 1500 });
		if (greedy.status === 'solved') { out.lanes.greedy = greedy.expanded; out.effort = Math.min(out.effort, Math.max(1, greedy.expanded)); }
		const bfsCap = Math.max(cap, opts.bfsFloor || 0);
		const bfs = solve(model, board, { strategy: 'bfs', maxExpanded: bfsCap, timeMs: opts.bfsTimeMs || opts.timeMs || 1500 });
		if (bfs.status === 'solved') {
			if (bfs.expanded <= cap) { out.lanes.bfs = bfs.expanded; out.effort = Math.min(out.effort, Math.max(1, bfs.expanded)); }
			out.solution = bfs.solution;
			out.length = bfs.solution.length;
			out.optimal = true;
		}
		out.refined = true;
		return out;
	}

	// Replay a solution; returns an array of boards (one per step, start included).
	function replayFrames(model, board, solution) {
		loadBoardIntoEngine(model, board);
		const frames = [{ w: level.width, h: level.height, cells: new Int32Array(level.objects) }];
		for (let i = 0; i < solution.length; i++) {
			engineStep(solution[i]);
			frames.push({ w: level.width, h: level.height, cells: new Int32Array(level.objects) });
		}
		return frames;
	}

	/////////////////////////////////////////////////////////////////////
	// Simplify ("window dressing") and Tighten
	/////////////////////////////////////////////////////////////////////
	//
	// Simplify removes objects one at a time and keeps a removal only when the
	// level stays solvable with the same BFS-optimal solution length - the
	// same criterion as native/src/search/simplify.cpp. Tighten does the
	// reverse for a chosen static object (e.g. Wall).

	function optimalLength(model, board, cap, timeMs) {
		const r = solve(model, board, { strategy: 'bfs', maxExpanded: cap, timeMs: timeMs });
		return r.status === 'solved' ? { length: r.solution.length, expanded: r.expanded } : { length: -1, status: r.status, expanded: r.expanded };
	}

	function simplify(model, board, opts) {
		opts = opts || {};
		const base = optimalLength(model, board, opts.cap || 400000, opts.timeMs || 20000);
		if (base.length < 0) return { ok: false, reason: base.status === 'unsolvable' ? 'The level is unsolvable.' : "Couldn't find the shortest solution in time (level too big for exhaustive search)." };
		const trialCap = Math.max(256, base.expanded * 2);
		const work = cloneBoard(board);
		const candidates = [];
		const player = {};
		model.playerIds.forEach(function (id) { player[id] = true; });
		const mode = opts.mode || 'simplify';
		if (mode === 'simplify') {
			for (let t = 0; t < board.w * board.h; t++) {
				for (let id = 0; id < model.objectCount; id++) {
					if (player[id] || !hasBit(board.cells, t, id, model.stride) || model.objects[id].layer === model.backgroundLayer) continue;
					candidates.push([t, id]);
				}
			}
		} else {
			const id = opts.objectId;
			const layer = model.objects[id].layer;
			for (let t = 0; t < board.w * board.h; t++) {
				let vacant = true;
				for (let k = 0; k < model.stride; k++) if (board.cells[t * model.stride + k] & model.layerMasks[layer][k]) vacant = false;
				if (vacant) candidates.push([t, id]);
			}
			// Prefer cells far from the player so paths stay open longer.
			candidates.sort(function (a, b) { return (a[0] % 7) - (b[0] % 7); });
		}
		let changed = 0, tried = 0;
		const deadline = Date.now() + (opts.budgetMs || 30000);
		for (let c = 0; c < candidates.length; c++) {
			if (Date.now() > deadline) break;
			const t = candidates[c][0], id = candidates[c][1];
			const saved = work.cells.slice(t * model.stride, t * model.stride + model.stride);
			if (mode === 'simplify') { if (!hasBit(work.cells, t, id, model.stride)) continue; clearBit(work.cells, t, id, model.stride); ensureBackground(model, work.cells, t); }
			else placeObject(model, work.cells, t, id);
			tried++;
			const r = optimalLength(model, work, trialCap, 4000);
			if (r.length === base.length) changed++;
			else work.cells.set(saved, t * model.stride);
			if (opts.onProgress && (c & 3) === 0) opts.onProgress(c + 1, candidates.length);
		}
		return { ok: true, board: work, changed: changed, tried: tried, length: base.length, mode: mode };
	}

	return {
		makeRng: makeRng,
		cellsKey: cellsKey,
		hashString: hashString,
		cloneBoard: cloneBoard,
		boardsEqual: boardsEqual,
		boardDiffCount: boardDiffCount,
		diffTiles: diffTiles,
		hasBit: hasBit,
		setBit: setBit,
		clearBit: clearBit,
		findSections: findSections,
		findLevelBlocks: findLevelBlocks,
		extractModel: extractModel,
		cellIds: cellIds,
		placeObject: placeObject,
		ensureBackground: ensureBackground,
		eraseTop: eraseTop,
		countObjects: countObjects,
		writeLevelToSource: writeLevelToSource,
		insertLevelInSource: insertLevelInSource,
		parseTransform: parseTransform,
		runTransform: runTransform,
		derivePresets: derivePresets,
		staticSolids: staticSolids,
		restoreTo: restoreTo,
		loadBoardIntoEngine: loadBoardIntoEngine,
		engineStep: engineStep,
		winconditionsNow: winconditionsNow,
		solve: solve,
		assess: assess,
		replayFrames: replayFrames,
		simplify: simplify,
	};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MISCore;
