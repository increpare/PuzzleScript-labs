'use strict';

// MIS95 - static analysis of transform rules, and the generation session's
// certificate built from it.
//
// A transform applies each match of an alternative atomically: every cell of
// the match is rewritten (mis_core.js applyCellReplacement), or, if that
// touches a locked tile or changes nothing, none is. So a transform keeps a
// property of the board if every single application of every alternative
// keeps it, whatever the statements, counts and probabilities around it.
//
// For each alternative and each object class (an object, a legend property,
// the player) this works out bounds on how one application changes the
// class's count, three ways: with no assumption about the board, assuming the
// board holds none of the class, and assuming it holds exactly one. The last
// is what lets `[ Player | no Wall ] -> [ | Player ]` keep a single player:
// the left cell holds it, so the right cell cannot.
//
// The analysis works per (cell, collision layer) slot. A well-formed board
// holds at most one object per layer per cell and always something on the
// background layer; the session certificate checks this of its start board,
// and every transform edit keeps it. For each object a slot could hold before
// the match, given the left-hand side, the rewrite gives exactly one object
// (or nothing) after it, so each slot's change is exact per starting object.
//
// A statement also bounds how often it applies: `choose N` applies at most N
// matches (one alternative per iteration), an everywhere rule any number. So a
// whole run of a transform changes a class's count by at most the sum of each
// statement's per-application range times its limit (`run`). Statements are
// not atomic: in a two-statement "remove a pair, add a pair" the second can
// fail to apply, so the run range is all that is proved, not an exact count.
//
// The certificate (sessionCertificate) combines this with the start board's
// counts and, when known, the game rules' quantity tags from static_analysis.js.
// Per class it gives a count range: `candidates` holds on every board the
// generator produces, `play` also on every state the game reaches from them.
// The generator re-checks each candidate (checkBoard) before handing the facts
// to the solver.

const MISTransformAnalysis = (function () {

	const EMPTY = -1;

	function bit(cells, tile, id, stride) {
		return (cells[tile * stride + (id >> 5)] >>> (id & 31)) & 1;
	}

	function sortedIds(ids) {
		return Array.from(new Set(ids)).sort(function (a, b) { return a - b; });
	}

	// Object classes: every object, every legend property, and the player.
	// Classes with the same members are one class with several names.
	function classes(model) {
		const byKey = new Map();
		const playerKey = sortedIds(model.playerIds || []).join(',');
		function add(name, kind, ids) {
			const sorted = sortedIds(ids);
			if (!sorted.length) return;
			const key = sorted.join(',');
			let c = byKey.get(key);
			if (!c) {
				c = { key: key, name: name, kind: kind, ids: sorted, names: [], isPlayer: key === playerKey };
				byKey.set(key, c);
			}
			if (c.names.indexOf(name) < 0) c.names.push(name);
		}
		model.objects.forEach(function (o) { if (o) add(o.display || o.name, 'object', [o.id]); });
		Object.keys(model.names).forEach(function (n) {
			const r = model.names[n];
			if (r.kind === 'property') add(n, 'property', r.ids);
		});
		if (playerKey) add('player', 'property', model.playerIds);
		const out = Array.from(byKey.values());
		out.forEach(function (c) {
			if (c.isPlayer) c.name = 'Player';
		});
		return out;
	}

	// The edits applyCellReplacement makes to one cell, in order.
	function cellOps(lhsCell, rhsCell) {
		const rhsPos = {}, lhsPos = {};
		rhsCell.forEach(function (t) { if (!t.neg) rhsPos[t.name] = true; });
		lhsCell.forEach(function (t) { if (!t.neg) lhsPos[t.name] = true; });
		const ops = [];
		lhsCell.forEach(function (t) {
			if (!t.neg && !rhsPos[t.name]) ops.push({ clear: new Set(t.ids) });
		});
		rhsCell.forEach(function (t) {
			if (t.neg) ops.push({ clear: new Set(t.ids) });
			else if (!lhsPos[t.name]) t.ids.forEach(function (id) { ops.push({ place: id }); });
		});
		return ops;
	}

	// What each layer of a matching cell can hold, from the left-hand side
	// (mis_core.js termMatches). Returns layer -> Set of allowed occupants
	// (object ids, or EMPTY) for the layers the side constrains.
	function layerOptions(model, lhsCell) {
		const allowed = new Map();
		const layerOf = function (id) { return model.objects[id].layer; };
		function restrict(layer, keep) {
			const cur = allowed.has(layer) ? allowed.get(layer) : new Set(slotUniverse(model, layer));
			const next = new Set();
			cur.forEach(function (o) { if (keep(o)) next.add(o); });
			allowed.set(layer, next);
		}
		lhsCell.forEach(function (t) {
			if (!t.neg) {
				if (t.kind === 'aggregate') {
					t.ids.forEach(function (id) { restrict(layerOf(id), function (o) { return o === id; }); });
				} else {
					const layers = sortedIds(t.ids.map(layerOf));
					// Any member present: only a one-layer property narrows a slot.
					if (layers.length === 1) {
						const members = new Set(t.ids);
						restrict(layers[0], function (o) { return members.has(o); });
					}
				}
			} else if (t.kind !== 'aggregate' || t.ids.length === 1) {
				// "no X": none of the members (an aggregate means "not all of them").
				t.ids.forEach(function (id) { restrict(layerOf(id), function (o) { return o !== id; }); });
			}
		});
		return allowed;
	}

	// What a slot can hold on a well-formed board.
	function slotUniverse(model, layer) {
		const objs = model.layerObjects[layer].slice();
		return layer === model.backgroundLayer ? objs : [EMPTY].concat(objs);
	}

	function finalOccupant(model, ops, layer, occupant) {
		let occ = occupant;
		for (let i = 0; i < ops.length; i++) {
			const op = ops[i];
			if (op.clear) { if (occ !== EMPTY && op.clear.has(occ)) occ = EMPTY; }
			else if (model.objects[op.place].layer === layer) occ = op.place;
		}
		if (occ === EMPTY && layer === model.backgroundLayer) occ = model.backgroundId;
		return occ;
	}

	// Slots of one alternative: { options: [occupant before], finals: [after] },
	// or null when the alternative can never match.
	function alternativeSlots(model, alt) {
		const slots = [];
		for (let p = 0; p < alt.lhs.length; p++) {
			for (let c = 0; c < alt.lhs[p].length; c++) {
				const lhs = alt.lhs[p][c], rhs = alt.rhs[p][c];
				const ops = cellOps(lhs, rhs);
				const options = layerOptions(model, lhs);
				const touched = new Set();
				ops.forEach(function (op) {
					if (op.place !== undefined) touched.add(model.objects[op.place].layer);
					else op.clear.forEach(function (id) { touched.add(model.objects[id].layer); });
				});
				for (let layer = 0; layer < model.layerCount; layer++) {
					if (!touched.has(layer) && !options.has(layer)) continue;
					const before = options.has(layer) ? Array.from(options.get(layer)) : slotUniverse(model, layer);
					if (!before.length) return null;
					slots.push({ layer: layer, options: before, finals: before.map(function (o) { return finalOccupant(model, ops, layer, o); }) });
				}
			}
		}
		return slots;
	}

	function range(values) {
		if (!values.length) return null;
		return { min: Math.min.apply(null, values), max: Math.max.apply(null, values) };
	}
	function addRange(a, b) {
		return a && b ? { min: a.min + b.min, max: a.max + b.max } : null;
	}
	function union(a, b) {
		if (!a) return b;
		if (!b) return a;
		return { min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) };
	}

	// Bounds on one application's change to the class count. Each regime is a
	// range, or null when the alternative cannot match a board in that regime.
	// The reverted outcome (locked tile, or no change) adds 0.
	function classDelta(slots, members) {
		const per = slots.map(function (s) {
			const inC = [], outC = [];
			s.options.forEach(function (o, i) {
				const d = (members.has(s.finals[i]) ? 1 : 0) - (members.has(o) ? 1 : 0);
				(members.has(o) ? inC : outC).push(d);
			});
			return { all: range(inC.concat(outC)), inC: range(inC), outC: range(outC) };
		});
		let general = { min: 0, max: 0 }, none = { min: 0, max: 0 };
		per.forEach(function (s) { general = addRange(general, s.all); none = addRange(none, s.outC); });
		// Exactly one member on the board: at most one slot holds it.
		let one = none;
		per.forEach(function (s, k) {
			if (!s.inC) return;
			let option = s.inC;
			per.forEach(function (o, j) { if (j !== k) option = addRange(option, o.outC); });
			one = union(one, option);
		});
		const withRevert = function (r) { return r ? union(r, { min: 0, max: 0 }) : null; };
		return { general: withRevert(general), none: withRevert(none), one: withRevert(one) };
	}

	// Per-class facts of one parsed transform (MISCore.parseTransform), plus the
	// objects it may write into or erase from a cell.
	// How many matches a `choose` statement with this upper count may apply,
	// when the generator may scale counts by up to `scale` (its adaptive step
	// size; scaled counts never drop below one).
	function chooseLimit(hi, scale) {
		if (!scale || scale === 1) return hi;
		return Math.max(hi, Math.ceil(hi * scale), 1);
	}

	// Count change of `times` applications, each in `range` (which holds 0).
	function repeat(times, range) {
		return {
			min: range.min === 0 ? 0 : times * range.min,
			max: range.max === 0 ? 0 : times * range.max,
		};
	}

	// opts.chooseScale: the largest factor the generator may scale `choose`
	// counts by (MISGenerator.MAX_CHOOSE_SCALE in adaptive mode; default 1).
	function analyzeTransform(model, program, opts) {
		opts = opts || {};
		const cls = classes(model);
		const out = { classes: {}, created: [], destroyed: [] };
		const created = new Set(), destroyed = new Set();
		cls.forEach(function (c) {
			out.classes[c.key] = {
				key: c.key, name: c.name, ids: c.ids,
				never_increases: true, never_decreases: true, keeps_zero: true, keeps_one: true, keeps_at_most_one: true,
				blockers: { never_increases: [], never_decreases: [], keeps_zero: [], keeps_one: [], keeps_at_most_one: [] },
				// Count change over one run of the whole transform (may be infinite).
				run: { min: 0, max: 0 },
			};
		});
		(program.statements || []).forEach(function (stmt) {
			const perApplication = {}; // class key -> range of one application of any alternative
			stmt.alts.forEach(function (alt) {
				const slots = alternativeSlots(model, alt);
				if (!slots) return; // never matches
				slots.forEach(function (s) {
					s.options.forEach(function (o, i) {
						const f = s.finals[i];
						if (f === o) return;
						if (f !== EMPTY) created.add(f);
						if (o !== EMPTY) destroyed.add(o);
					});
				});
				cls.forEach(function (c) {
					const d = classDelta(slots, new Set(c.ids));
					const facts = out.classes[c.key];
					const fail = function (tag) {
						facts[tag] = false;
						if (facts.blockers[tag].indexOf(alt.line) < 0) facts.blockers[tag].push(alt.line);
					};
					if (d.general && d.general.max > 0) fail('never_increases');
					if (d.general && d.general.min < 0) fail('never_decreases');
					if (d.none && d.none.max > 0) fail('keeps_zero');
					if (d.one && (d.one.min !== 0 || d.one.max !== 0)) fail('keeps_one');
					if ((d.none && d.none.max > 1) || (d.one && d.one.max > 0)) fail('keeps_at_most_one');
					perApplication[c.key] = union(perApplication[c.key], d.general);
				});
			});
			const times = stmt.choose ? chooseLimit(stmt.choose[1], opts.chooseScale) : Infinity;
			cls.forEach(function (c) {
				const r = perApplication[c.key];
				if (!r) return;
				const run = out.classes[c.key].run, step = repeat(times, r);
				run.min += step.min;
				run.max += step.max;
			});
		});
		out.created = sortedIds(Array.from(created));
		out.destroyed = sortedIds(Array.from(destroyed));
		return out;
	}

	// At most one object per layer per cell, and something on the background layer.
	function wellFormed(model, board) {
		const stride = model.stride;
		for (let t = 0; t < board.w * board.h; t++) {
			const seen = new Array(model.layerCount).fill(false);
			for (let id = 0; id < model.objectCount; id++) {
				if (!bit(board.cells, t, id, stride)) continue;
				const layer = model.objects[id].layer;
				if (seen[layer]) return { ok: false, reason: 'tile ' + t + ' holds two objects on one collision layer' };
				seen[layer] = true;
			}
			if (!seen[model.backgroundLayer]) return { ok: false, reason: 'tile ' + t + ' has nothing on the background layer' };
		}
		return { ok: true };
	}

	function idCounts(model, board) {
		const counts = new Array(model.objectCount).fill(0);
		for (let t = 0; t < board.w * board.h; t++) {
			for (let w = 0; w < model.stride; w++) {
				let bits = board.cells[t * model.stride + w] | 0;
				while (bits) {
					const b = 31 - Math.clz32(bits & -bits);
					const id = (w << 5) + b;
					if (id < counts.length) counts[id]++;
					bits &= bits - 1;
				}
			}
		}
		return counts;
	}

	// Rule-side quantity for a class, from a table built from the static
	// analysis report: { objects: { name: [never_increases, never_decreases] },
	// properties: [{ members: [names], never_increases, never_decreases }] }.
	// A property's own tags win; otherwise the members' tags bound the sum.
	function ruleQuantityFor(model, table, ids) {
		if (!table) return null;
		const names = ids.map(function (id) { return model.objects[id].name.toLowerCase(); });
		const key = names.slice().sort().join(',');
		const property = (table.properties || []).find(function (p) {
			return p.members.map(function (n) { return n.toLowerCase(); }).sort().join(',') === key;
		});
		if (property && typeof property.never_increases === 'boolean') {
			return { never_increases: property.never_increases, never_decreases: property.never_decreases };
		}
		let inc = true, dec = true;
		for (let i = 0; i < names.length; i++) {
			const q = table.objects && table.objects[names[i]];
			if (!q) return null;
			inc = inc && q[0] === true;
			dec = dec && q[1] === true;
		}
		return { never_increases: inc, never_decreases: dec };
	}

	const TAGS = ['exactly_zero', 'exactly_one', 'at_most_one'];

	// A count range as the certificate reports it (max null when unbounded).
	function bounds(min, max) {
		min = Math.max(0, min);
		return {
			min: min, max: max === Infinity ? null : max,
			exact_count: min === max ? min : null,
			exactly_zero: max === 0,
			exactly_one: min === 1 && max === 1,
			at_most_one: max <= 1,
		};
	}

	// Facts for one generation session: its start board and every transform
	// it may apply (programs: parsed transforms). Options:
	//   ruleQuantity: the table for ruleQuantityFor, or null when the rules'
	//     tags are unknown (then there are no play facts);
	//   chooseScale: the largest factor the generator may scale `choose`
	//     counts by (adaptive step size);
	//   repeated: candidates may be transforms of earlier candidates (elite
	//     parents), so only facts every single application keeps hold, not the
	//     run ranges.
	function sessionCertificate(model, programs, base, opts) {
		opts = opts || {};
		const form = wellFormed(model, base);
		const counts = idCounts(model, base);
		const analyses = programs.map(function (p) { return analyzeTransform(model, p, { chooseScale: opts.chooseScale }); });
		const created = new Set();
		analyses.forEach(function (a) { a.created.forEach(function (id) { created.add(id); }); });
		const cert = {
			ok: form.ok, reason: form.reason || null, classes: [],
			objectsMayAppear: [], rulesKnown: !!opts.ruleQuantity, repeated: !!opts.repeated,
			facts: { candidates: {}, play: {}, objectsMayAppear: [] },
		};
		['candidates', 'play'].forEach(function (scope) {
			TAGS.forEach(function (tag) { cert.facts[scope][tag] = []; });
			cert.facts[scope].counts = [];
			cert.facts[scope].exact_count = [];
		});
		classes(model).forEach(function (c) {
			const start = c.ids.reduce(function (n, id) { return n + counts[id]; }, 0);
			const per = analyses.map(function (a) { return a.classes[c.key]; });
			const all = function (k) { return per.every(function (f) { return f[k]; }); };
			const blockers = {};
			['keeps_zero', 'keeps_one', 'keeps_at_most_one', 'never_increases', 'never_decreases'].forEach(function (k) {
				blockers[k] = [];
				per.forEach(function (f, i) { f.blockers[k].forEach(function (line) { blockers[k].push({ transform: i, line: line }); }); });
			});
			let min = 0, max = Infinity;
			if (form.ok) {
				// Kept by every single application, so by any number of them.
				if (all('never_increases')) max = Math.min(max, start);
				if (all('never_decreases')) min = Math.max(min, start);
				if (start === 0 && all('keeps_zero')) max = 0;
				if (start === 1 && all('keeps_one')) { min = Math.max(min, 1); max = Math.min(max, 1); }
				if (start <= 1 && all('keeps_at_most_one')) max = Math.min(max, 1);
				// One run of one transform from the start board.
				if (!opts.repeated && per.length) {
					min = Math.max(min, start + Math.min.apply(null, per.map(function (f) { return f.run.min; })));
					max = Math.min(max, start + Math.max.apply(null, per.map(function (f) { return f.run.max; })));
				}
			}
			const candidates = bounds(min, max);
			const rules = opts.ruleQuantity ? ruleQuantityFor(model, opts.ruleQuantity, c.ids) : null;
			const play = rules ? bounds(rules.never_decreases ? candidates.min : 0, rules.never_increases ? max : Infinity) : null;
			cert.classes.push({
				key: c.key, name: c.name, names: c.names, ids: c.ids, kind: c.kind, isPlayer: c.isPlayer,
				start: start, candidates: candidates, play: play, rules: rules, blockers: blockers,
			});
			[['candidates', candidates], ['play', play]].forEach(function (pair) {
				const facts = cert.facts[pair[0]], b = pair[1];
				if (!b) return;
				TAGS.forEach(function (tag) { if (b[tag]) facts[tag].push(c.ids); });
				if (b.min > 0 || b.max !== null) facts.counts.push({ ids: c.ids, min: b.min, max: b.max });
				if (b.exact_count !== null) facts.exact_count.push({ ids: c.ids, count: b.exact_count });
			});
		});
		if (form.ok) {
			for (let id = 0; id < model.objectCount; id++) if (counts[id] > 0 || created.has(id)) cert.objectsMayAppear.push(id);
		}
		cert.facts.objectsMayAppear = cert.objectsMayAppear;
		return cert;
	}

	// Ways a candidate board breaks the certificate's candidate facts (empty
	// when it keeps them all).
	function checkBoard(model, cert, board) {
		if (!cert.ok) return ['the session has no certificate'];
		const out = [];
		const form = wellFormed(model, board);
		if (!form.ok) out.push(form.reason);
		const counts = idCounts(model, board);
		cert.classes.forEach(function (c) {
			const n = c.ids.reduce(function (sum, id) { return sum + counts[id]; }, 0);
			const b = c.candidates;
			if (b.max !== null && n > b.max) out.push(c.name + ': expected at most ' + b.max + ', found ' + n);
			if (n < b.min) out.push(c.name + ': expected at least ' + b.min + ', found ' + n);
		});
		const may = new Set(cert.objectsMayAppear);
		counts.forEach(function (n, id) {
			if (n > 0 && !may.has(id)) out.push(model.objects[id].name + ' appeared, but no transform creates it');
		});
		return out;
	}

	// A generator gate ({ facts, check }) for the session, or null if the
	// certificate bounds no count.
	function gate(model, cert) {
		if (!cert.ok || !cert.facts.candidates.counts.length) return null;
		return { facts: cert.facts, check: function (board) { return checkBoard(model, cert, board).length === 0; } };
	}

	// Short labels for the UI: classes with exactly one instance, by scope.
	function summary(cert) {
		const one = function (scope) {
			return cert.classes.filter(function (c) { return c[scope] && c[scope].exactly_one; }).map(function (c) { return c.name; });
		};
		return { candidates: one('candidates'), play: one('play') };
	}

	return {
		EMPTY: EMPTY,
		classes: classes,
		analyzeTransform: analyzeTransform,
		wellFormed: wellFormed,
		ruleQuantityFor: ruleQuantityFor,
		sessionCertificate: sessionCertificate,
		checkBoard: checkBoard,
		gate: gate,
		summary: summary,
	};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MISTransformAnalysis;
