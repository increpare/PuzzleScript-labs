#!/usr/bin/env node
'use strict';

// Instrumented profile of the PuzzleScript+MIS web generator loop
// (src/js/mis/mis_generator.js), the same code the browser workers run.
//
//   node src/tests/mis_generator_profile_node.js [--seconds N] [--backend js|native|both]
//                                                [--scenario substring] [--json out.json]
//
// Reports, per scenario and backend:
//   macro  - candidates/s, outcome mix, and how often N independent workers
//            would assess the same board (duplicated work across workers);
//   loop   - share of worker time per phase (transform, dedupe, primary solve
//            by outcome, refinement);
//   solve  - per-call cost model from a least-squares fit of primary solve
//            time against states expanded: fixed setup ms + µs per state.
// Generator flags: --pipeline lazy|legacy, --no-adaptive (fixed step size),
// --shard (hash-shard boards across the simulated workers), --optimal-cap N,
// --workers N.

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const srcDir = path.join(__dirname, '..');
const args = process.argv.slice(2);
function arg(name, dflt) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; }
const SECONDS = +arg('--seconds', 12);
const BACKENDS = arg('--backend', 'both') === 'both' ? ['js', 'native'] : [arg('--backend')];
const ONLY = arg('--scenario', '');
const WORKERS = +arg('--workers', 3);
const jsonOut = arg('--json', null);
const PIPELINE = arg('--pipeline', 'lazy'); // 'lazy' (current) or 'legacy'
const SHARD = args.includes('--shard');
const ADAPTIVE = !args.includes('--no-adaptive');
const OPTIMAL_CAP = args.includes('--optimal-cap') ? +arg('--optimal-cap') : undefined;

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
code += '\n' + fs.readFileSync(path.join(srcDir, 'js/mis/mis_generator.js'), 'utf8');
code += '\nglobal.MISCore = MISCore; global.misCompile = misCompile; global.MISGenerator = MISGenerator;\n';
vm.runInThisContext(code, { filename: 'mis_combined.js' });
const MISNative = require(path.join(srcDir, 'js/mis/mis_native.js'));

const SCENARIOS = [
	['sokoban L1 add/remove Wall', 'demo/sokoban_basic.txt', 0, 'Add/remove Wall'],
	['microban L5 bit of everything', 'demo/microban.txt', 5, 'A bit of everything'],
	['microban L5 shuffle movers', 'demo/microban.txt', 5, 'Shuffle movers'],
	['AG2B L3 shuffle movers', 'tests/good_games/ALL GREEN TO BLUE.txt', 3, 'Shuffle movers'],
].filter(s => s[0].includes(ONLY));

function pct(a, b) { return b > 0 ? (100 * a / b).toFixed(1) + '%' : '-'; }
function f1(x) { return Number(x).toFixed(1); }

// Least squares ms = a + b * expanded.
function fit(points) {
	const n = points.length;
	if (n < 3) return null;
	let sx = 0, sy = 0, sxx = 0, sxy = 0;
	for (const [x, y] of points) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
	const d = n * sxx - sx * sx;
	if (d === 0) return null;
	const b = (n * sxy - sx * sy) / d, a = (sy - b * sx) / n;
	return { fixedMs: a, usPerState: b * 1000, n };
}

// Wrap a backend to record (expanded, ms) for every primary call.
function recording(backend, points) {
	return {
		assess(board, opts) {
			const t = performance.now();
			const r = backend.assess(board, opts);
			if (opts && (opts.refine === false || !r.refined)) points.push([r.expanded || 0, performance.now() - t]);
			return r;
		},
		solve: backend.solve,
		simplify: backend.simplify,
	};
}

(async () => {
	const nativeModule = await require(path.join(srcDir, 'js/mis/wasm/mis_native.js'))();
	const report = [];
	for (const [label, rel, levelIndex, presetLabel] of SCENARIOS) {
		const text = fs.readFileSync(path.join(srcDir, rel), 'utf8');
		misCompile(text);
		const model = MISCore.extractModel(text);
		const preset = MISCore.derivePresets(model).find(p => p.label === presetLabel);
		const program = MISCore.parseTransform(preset.text, model);
		const base = model.levels[levelIndex].board;
		for (const be of BACKENDS) {
			let backend;
			if (be === 'native') {
				const n = MISNative.create(nativeModule);
				if (!n.attach(text, model).ok) { console.log('skip native', label); continue; }
				backend = n;
			} else {
				backend = { assess: (b, o) => MISCore.assess(model, b, o), solve: (b, o) => MISCore.solve(model, b, o), simplify: (b, o) => MISCore.simplify(model, b, o) };
			}
			const points = [];
			const baseline = backend.assess(base, { timeMs: 5000, maxExpanded: 400000, refineGate: 0 });
			const baseEffort = baseline.status === 'solved' ? baseline.effort : 0;
			const rec = recording(backend, points);
			// Simulate WORKERS independent workers (different seeds, private
			// dedupe) interleaved step by step, to measure cross-worker overlap.
			const gens = [];
			const assessedBy = [];
			for (let w = 0; w < WORKERS; w++) {
				const seen = new Set();
				assessedBy.push(seen);
				gens.push(MISGenerator.create({ model, backend: rec, program, base, seed: 1000 + w * 7919, keep: 8, seen, pipeline: PIPELINE, optimalCap: OPTIMAL_CAP, adaptive: ADAPTIVE, baseEffort,
					shard: SHARD ? { index: w, count: WORKERS } : null }));
			}
			const t0 = performance.now();
			let found = 0;
			const harder = new Set();
			while (performance.now() - t0 < SECONDS * 1000) {
				for (const g of gens) {
					const r = g.step();
					if (!r) continue;
					found++;
					if (r.result.effort > baseEffort) harder.add(MISCore.cellsKey(r.board.cells));
				}
			}
			const wall = (performance.now() - t0) / 1000;
			// Totals across simulated workers.
			const st = {}, pr = {};
			for (const g of gens) {
				for (const [k, v] of Object.entries(g.stats())) st[k] = (st[k] || 0) + v;
				for (const [k, v] of Object.entries(g.profile())) pr[k] = (pr[k] || 0) + v;
			}
			const assessed = st.solved + st.unsolvable + st.timeout;
			// Boards assessed by more than one worker (the private `seen` sets
			// contain every generated key; assessed ⊂ seen).
			const counts = new Map();
			for (const s of assessedBy) for (const k of s) counts.set(k, (counts.get(k) || 0) + 1);
			let distinct = 0, dupAssess = 0;
			for (const c of counts.values()) { distinct++; dupAssess += c - 1; }
			const measured = pr.transformMs + pr.keyMs + pr.primarySolvedMs + pr.primaryUnsolvableMs + pr.primaryTimeoutMs + pr.refineMs + pr.proofMs;
			const cost = fit(points);
			// Quality: best efforts reached (what the designer sees).
			const best = gens.map(g => g.best()).flat().sort((a, b) => b - a).slice(0, 8);
			const row = { label, backend: be, pipeline: PIPELINE, shard: SHARD, adaptive: ADAPTIVE, baseEffort, harder: harder.size, best, wall, assessed, rate: assessed / wall, samples: pr.samples, st, pr, measured,
				crossWorkerDuplicates: dupAssess, distinctGenerated: distinct, cost };
			report.push(row);
			console.log(`\n== ${label} — ${be} [${PIPELINE}${SHARD ? ', sharded' : ''}${ADAPTIVE ? ', adaptive' : ''}] (${WORKERS} simulated workers, one thread, ${f1(wall)}s)`);
			console.log(`macro: ${assessed} assessed = ${f1(assessed / wall)}/s (single thread) · samples ${pr.samples} · unchanged ${pct(st.unchanged, pr.samples)} · duplicate ${pct(st.duplicates, pr.samples)}`);
			console.log(`       outcomes: solved ${pct(st.solved, assessed)}  unsolvable ${pct(st.unsolvable, assessed)}  timeout ${pct(st.timeout, assessed)}  · budget ${st.budgetMs}ms · shortlisted ${found}`);
			console.log(`       harder than the level (effort > ${baseEffort}): ${harder.size} = ${f1(harder.size * 60 / wall)}/min · top-8 efforts found: ${best.join(', ')}`);
			if (ADAPTIVE && gens[0].arms().length > 1) console.log(`       step-size time share: ${gens[0].arms().map(a => '×' + a.scale + ' ' + Math.round(100 * a.ms / Math.max(1, gens[0].arms().reduce((x, b) => x + b.ms, 0))) + '%').join('  ')}`);
			console.log(`       cross-worker: ${dupAssess} of ${st.generated} generated boards were also generated by another worker (${pct(dupAssess, st.generated)} of assessments would be repeats)`);
			console.log(`loop:  transform ${pct(pr.transformMs, measured)}  dedupe ${pct(pr.keyMs, measured)}  primary: solved ${pct(pr.primarySolvedMs, measured)} unsolvable ${pct(pr.primaryUnsolvableMs, measured)} timeout ${pct(pr.primaryTimeoutMs, measured)}  refine ${pct(pr.refineMs, measured)} (${pr.refines} refines, ${f1(pr.refineMs / Math.max(1, pr.refines))}ms each)  proof ${pct(pr.proofMs, measured)} (${pr.proofs})  admitted ${pr.refineAdmitted}`);
			if (cost) console.log(`solve: primary cost ≈ ${cost.fixedMs.toFixed(3)} ms fixed + ${cost.usPerState.toFixed(1)} µs/state (fit over ${cost.n} calls; mean ${f1(points.reduce((a, p) => a + p[0], 0) / points.length)} states/call)`);
		}
	}
	if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
})();
