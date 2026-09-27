#!/usr/bin/env node
'use strict';

// Profile the PuzzleScript+MIS web prototype's two solver backends on the same
// levels: the JavaScript engine solver (src/js/mis/mis_core.js) and the
// WebAssembly build of the native solver (src/js/mis/wasm, see
// native/wasm/build_mis_wasm.sh).
//
//   node src/tests/mis_backend_bench_node.js [--quick] [--json out.json]
//
// Reports per-strategy states expanded, wall time and states/second, checks
// that both backends agree on BFS-optimal solution lengths, then compares the
// full MIS difficulty assessment and the simplifier.

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const srcDir = path.join(__dirname, '..');
const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
// --dump-grids FILE: also write every benchmarked board in the native layer-cell
// layout, for native/wasm/mis_wasm_bench_native.cpp (x86 vs wasm comparison).
const dumpGrids = args.includes('--dump-grids') ? args[args.indexOf('--dump-grids') + 1] : null;
const dumpLines = [];

global.window = global;
global.document = {
	URL: 'mis://', body: { classList: { contains() { return false; } }, addEventListener() {}, removeEventListener() {} },
	createElement() { return { style: {}, getContext() { return null; } }; }, getElementById() { return null; },
};
const files = [
	'js/mis/mis_shims.js', 'js/storagewrapper.js', 'js/bitvec.js', 'js/level.js', 'js/languageConstants.js',
	'js/globalVariables.js', 'js/debug.js', 'js/plugin_header_on.js', 'js/font.js', 'js/rng.js', 'js/riffwave.js',
	'js/sfxr.js', 'js/codemirror/stringstream.js', 'js/colorhelpers.js', 'js/colors.js', 'js/engine.js',
	'js/parser.js', 'js/compiler.js', 'js/soundbar.js',
];
let code = '';
for (const f of files) code += '\n' + fs.readFileSync(path.join(srcDir, f), 'utf8');
code += '\nmisAfterEngineLoaded();\n' + fs.readFileSync(path.join(srcDir, 'js/mis/mis_core.js'), 'utf8');
code += '\nglobal.MISCore = MISCore; global.misCompile = misCompile;\n';
vm.runInThisContext(code, { filename: 'mis_combined.js' });
const MISNative = require(path.join(srcDir, 'js/mis/mis_native.js'));
const createMisNative = require(path.join(srcDir, 'js/mis/wasm/mis_native.js'));

const GAMES = [
	['demo/sokoban_basic.txt', 99],
	['demo/microban.txt', QUICK ? 4 : 10],
	['demo/twolittlecrates1.txt', QUICK ? 2 : 4],
	['tests/good_games/ALL GREEN TO BLUE.txt', QUICK ? 3 : 8],
	['demo/lunar_lockout.txt', QUICK ? 2 : 4],
];
const CAP = 300000;          // max states expanded per solve
const TIME_MS = QUICK ? 8000 : 20000;

function fmt(n, d = 0) { return Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }); }
function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function lpad(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

(async () => {
	const native = MISNative.create(await createMisNative());
	const rows = [];
	const assessRows = [];
	const simplifyRows = [];

	for (const [rel, maxLevels] of GAMES) {
		const text = fs.readFileSync(path.join(srcDir, rel), 'utf8');
		if (!misCompile(text).ok) { console.log('skip (JS compile failed):', rel); continue; }
		const model = MISCore.extractModel(text);
		const attached = native.attach(text, model);
		if (!attached.ok) { console.log('skip', rel, attached.reason); continue; }
		const levels = model.levels.filter(l => l.board).slice(0, maxLevels);
		if (dumpGrids) dumpLines.push('GAME ' + path.join(srcDir, rel));
		for (const lv of levels) {
			const name = path.basename(rel, '.txt') + ' #' + lv.index;
			if (dumpGrids) {
				const b = lv.board, ids = [];
				for (let l = 0; l < model.layerCount; l++) for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
					const hit = model.layerObjects[l].find(id => MISCore.hasBit(b.cells, x * b.h + y, id, model.stride));
					ids.push(hit === undefined ? -1 : hit);
				}
				dumpLines.push('LEVEL ' + name.replace(/\s+/g, '_') + ' ' + b.w + ' ' + b.h + ' ' + ids.length + ' ' + ids.join(' '));
			}
			process.stderr.write('  ' + name + '\n');
			for (const strategy of ['bfs', 'astar', 'greedy']) {
				const js = MISCore.solve(model, lv.board, { strategy, maxExpanded: CAP, timeMs: TIME_MS });
				const nt = native.solve(lv.board, { strategy, maxExpanded: CAP, timeMs: TIME_MS });
				rows.push({ level: name, strategy, js: { status: js.status, expanded: js.expanded, ms: js.ms, length: js.solution ? js.solution.length : null },
					native: { status: nt.status, expanded: nt.expanded, ms: nt.ms, length: nt.solution ? nt.solution.length : null } });
			}
			const np = native.solve(lv.board, { strategy: 'portfolio', timeMs: TIME_MS });
			rows.push({ level: name, strategy: 'portfolio', js: null, native: { status: np.status, expanded: np.expanded, ms: np.ms, length: np.solution ? np.solution.length : null } });

			// Full MIS difficulty assessment as the generator runs it.
			let t = Date.now();
			const ja = MISCore.assess(model, lv.board, { timeMs: 3000, maxExpanded: CAP });
			const jaMs = Date.now() - t;
			t = Date.now();
			const na = native.assess(lv.board, { timeMs: 3000 });
			const naMs = Date.now() - t;
			assessRows.push({ level: name, js: { status: ja.status, effort: ja.effort, ms: jaMs }, native: { status: na.status, effort: na.effort, ms: naMs, lanes: na.lanes } });
		}
		// Simplifier on the first level of each game.
		const lv = levels[0];
		if (lv && !model.usesRandom) {
			let t = Date.now();
			const js = MISCore.simplify(model, lv.board, { budgetMs: 60000 });
			const jsMs = Date.now() - t;
			t = Date.now();
			const nt = native.simplify(lv.board, {});
			const ntMs = Date.now() - t;
			simplifyRows.push({ level: path.basename(rel, '.txt') + ' #' + lv.index,
				js: { ok: js.ok, removed: js.changed, length: js.length, ms: jsMs },
				native: { ok: nt.ok, removed: nt.changed, length: nt.length, ms: ntMs, reason: nt.reason } });
		}
	}

	// ---- Report ----
	console.log('\nPer-solve comparison (cap ' + fmt(CAP) + ' expanded, ' + TIME_MS / 1000 + 's)\n');
	console.log(pad('level', 26) + pad('strategy', 10) + lpad('JS exp', 9) + lpad('JS ms', 8) + lpad('nat exp', 9) + lpad('nat ms', 8) + lpad('JS st/s', 10) + lpad('nat st/s', 11) + '  result');
	for (const r of rows) {
		const js = r.js;
		const nt = r.native;
		const rate = (e, ms) => ms > 0 ? fmt(e / (ms / 1000)) : '—';
		const res = (js ? js.status + (js.length != null ? '(' + js.length + ')' : '') + ' / ' : '') + nt.status + (nt.length != null ? '(' + nt.length + ')' : '');
		console.log(pad(r.level, 26) + pad(r.strategy, 10) + lpad(js ? fmt(js.expanded) : '', 9) + lpad(js ? fmt(js.ms) : '', 8) + lpad(fmt(nt.expanded), 9) + lpad(fmt(nt.ms), 8) +
			lpad(js ? rate(js.expanded, js.ms) : '', 10) + lpad(rate(nt.expanded, nt.ms), 11) + '  ' + res);
	}

	console.log('\nThroughput by strategy (solves where both backends finished, i.e. no timeout)\n');
	const summary = {};
	for (const strategy of ['bfs', 'astar', 'greedy']) {
		const both = rows.filter(r => r.strategy === strategy && r.js.status !== 'timeout' && r.native.status !== 'timeout');
		const jsE = both.reduce((a, r) => a + r.js.expanded, 0), jsMs = both.reduce((a, r) => a + r.js.ms, 0);
		const nE = both.reduce((a, r) => a + r.native.expanded, 0), nMs = both.reduce((a, r) => a + r.native.ms, 0);
		const wallSpeedup = nMs > 0 ? jsMs / nMs : Infinity;
		summary[strategy] = { solves: both.length, jsExpanded: jsE, jsMs, nativeExpanded: nE, nativeMs: nMs, jsRate: jsE / (jsMs / 1000), nativeRate: nE / (Math.max(1, nMs) / 1000), wallSpeedup };
		console.log(pad(strategy, 8) + lpad(both.length + ' solves', 10) + '   JS ' + lpad(fmt(jsE / (jsMs / 1000)), 8) + ' states/s   native ' + lpad(fmt(nE / (Math.max(1, nMs) / 1000)), 9) + ' states/s   wall-time speedup ×' + fmt(wallSpeedup, 1));
	}
	const onlyNative = rows.filter(r => r.js && r.js.status === 'timeout' && r.native.status === 'solved').length;
	const onlyJs = rows.filter(r => r.js && r.js.status === 'solved' && r.native.status === 'timeout').length;
	console.log('\nSolved only by native (JS hit the cap/time): ' + onlyNative + '   solved only by JS: ' + onlyJs);

	const bfsBoth = rows.filter(r => r.strategy === 'bfs' && r.js.status === 'solved' && r.native.status === 'solved');
	const disagree = bfsBoth.filter(r => r.js.length !== r.native.length);
	const statusDisagree = rows.filter(r => r.js && ((r.js.status === 'solved' && r.native.status === 'unsolvable') || (r.js.status === 'unsolvable' && r.native.status === 'solved')));
	console.log('BFS optimal length agreement: ' + (bfsBoth.length - disagree.length) + '/' + bfsBoth.length + (disagree.length ? '  DISAGREE: ' + disagree.map(r => r.level + ' ' + r.js.length + '≠' + r.native.length).join(', ') : ''));
	console.log('Solvable/unsolvable contradictions: ' + statusDisagree.length + (statusDisagree.length ? ' ' + statusDisagree.map(r => r.level + ' ' + r.strategy).join(', ') : ''));

	console.log('\nFull MIS difficulty assessment (primary 3s + capped refinement lanes)\n');
	console.log(pad('level', 26) + lpad('JS ms', 8) + lpad('JS effort', 11) + lpad('nat ms', 8) + lpad('nat effort', 12) + '  native lanes');
	for (const a of assessRows) {
		console.log(pad(a.level, 26) + lpad(fmt(a.js.ms), 8) + lpad(a.js.status === 'solved' ? fmt(a.js.effort) : a.js.status, 11) + lpad(fmt(a.native.ms), 8) +
			lpad(a.native.status === 'solved' ? fmt(a.native.effort) : a.native.status, 12) + '  ' + Object.entries(a.native.lanes || {}).map(([k, v]) => k + ' ' + v).join(', '));
	}
	const aBoth = assessRows.filter(a => a.js.status === 'solved' && a.native.status === 'solved');
	const jsA = aBoth.reduce((s, a) => s + a.js.ms, 0), nA = aBoth.reduce((s, a) => s + a.native.ms, 0);
	console.log('\nAssess wall time where both solved: JS ' + fmt(jsA) + ' ms, native ' + fmt(nA) + ' ms (×' + fmt(jsA / Math.max(1, nA), 1) + ')');

	console.log('\nSimplify (first level of each game)\n');
	for (const s of simplifyRows) {
		console.log(pad(s.level, 26) + 'JS: ' + (s.js.ok ? '−' + s.js.removed + ' objects, len ' + s.js.length : 'failed') + ' in ' + fmt(s.js.ms) + ' ms   native: ' +
			(s.native.ok ? '−' + s.native.removed + ' objects, len ' + s.native.length : 'failed (' + s.native.reason + ')') + ' in ' + fmt(s.native.ms) + ' ms');
	}

	if (dumpGrids) fs.writeFileSync(dumpGrids, dumpLines.join('\n') + '\n');
	if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ rows, summary, assessRows, simplifyRows, cap: CAP, timeMs: TIME_MS, node: process.version }, null, 2));
})();
