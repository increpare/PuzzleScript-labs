#!/usr/bin/env node
'use strict';

// Seed corpus + productivity survey for the PuzzleScript+MIS level generator.
//
//   node src/tests/mis_generator_seed_survey_node.js seeds  [--out seeds.json] [--solve-ms 500]
//   node src/tests/mis_generator_seed_survey_node.js survey [--seeds seeds.json] [--out survey.json] [--seed 7]
//        [--candidates 30 --min-seconds 3 --max-seconds 15 | --seconds S] [--rejudge prev.json] [--seed-budget] [--retry-growth 1]
//        [--generator REGEX] [--trace]
//   node src/tests/mis_generator_seed_survey_node.js cull survey.json [--cap 4] [--pick spread|productive] [--min-effort 10] [--out bench.json]
//
// seeds:  every playable level in src/tests/solver_tests that the native
//         portfolio solver solves within --solve-ms (default 500). Games with
//         random rules, or whose native/JS object tables differ, are skipped.
// survey: for every seed level and every generator (the game's derived
//         transform presets), run the generator until it has judged
//         --candidates candidate levels (within --min/--max-seconds; or a fixed
//         --seconds) and record how productive it is: distinct new solvable
//         levels, levels harder than the seed (solver effort), best effort
//         found, slowest single step, and time per generator phase.
// cull:   the benchmark set. From the seeds, drop levels with solver effort
//         <= --min-effort (too trivial to improve on), levels with a hung run,
//         and levels where no generator found anything harder. Then keep at most --cap levels per
//         game: by default spread evenly over the game's seed efforts (easiest,
//         hardest and between); --pick productive prefers levels where more
//         generators were productive, then the larger lift.
//
// Jobs run on a pool of worker threads (--jobs, default = cores). Each job has
// a hard deadline; a job that overruns is killed and recorded as "hung".

const fs = require('fs');
const os = require('os');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const srcDir = path.join(__dirname, '..');
const CORPUS = path.join(srcDir, 'tests/solver_tests');

/////////////////////////////////////////////////////////////////////
// Worker: engine + core + generator + native, one game cached at a time
/////////////////////////////////////////////////////////////////////

if (!isMainThread) {
	// Engine, generator and wasm come from workerData.srcDir when given (a
	// reference checkout for A/B benchmarks), otherwise from this checkout.
	const srcDir = (workerData && workerData.srcDir) || path.join(__dirname, '..');
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
	const C = global.MISCore;

	let nativeP = require(path.join(srcDir, 'js/mis/wasm/mis_native.js'))().then(M => MISNative.create(M));
	let cached = null; // { file, model, text, native, reason }

	async function game(file) {
		if (cached && cached.file === file) return cached;
		const native = await nativeP;
		const text = fs.readFileSync(file, 'utf8');
		const res = global.misCompile(text);
		if (!res.ok) return (cached = { file, reason: 'js compile failed' });
		const model = C.extractModel(text);
		if (!model) return (cached = { file, reason: 'no model' });
		if (model.usesRandom) return (cached = { file, reason: 'random rules' });
		const attached = native.attach(text, model);
		if (!attached.ok) return (cached = { file, reason: attached.reason });
		return (cached = { file, model, text, native });
	}

	parentPort.on('message', async (job) => {
		try {
			const g = await game(job.file);
			if (job.type === 'levels') {
				parentPort.postMessage({ id: job.id, ok: true, reason: g.reason || null,
					levels: g.model ? g.model.levels.filter(l => l.board).map(l => l.index) : [] });
				return;
			}
			if (g.reason) { parentPort.postMessage({ id: job.id, ok: false, reason: g.reason }); return; }
			const lv = g.model.levels[job.level];
			if (job.type === 'seed') {
				const t = Date.now();
				const r = g.native.solve(lv.board, { strategy: 'portfolio', timeMs: job.solveMs });
				const ms = Date.now() - t;
				parentPort.postMessage({ id: job.id, ok: true, status: r.status, ms, expanded: r.expanded,
					length: r.solution ? r.solution.length : null, w: lv.board.w, h: lv.board.h,
					boardHash: crypto.createHash('sha256').update(Buffer.from(lv.board.cells.buffer)).digest('hex').slice(0, 16) });
				return;
			}
			if (job.type === 'presets') {
				parentPort.postMessage({ id: job.id, ok: true, presets: C.derivePresets(g.model).map(p => ({ id: p.id, label: p.label, text: p.text })) });
				return;
			}
			if (job.type === 'survey') {
				const base = lv.board;
				const tb = Date.now();
				// Work clock (job.workClock): the seed's assessment is deterministic
				// too (a states cap instead of 3 s).
				const baseline = job.workClock
					? g.native.assess(base, { timeMs: 120000, primaryMaxExpanded: 150000, deterministic: true, maxExpanded: 400000, refineGate: 0, refineTimeMs: 120000 })
					: g.native.assess(base, { timeMs: 3000, maxExpanded: 400000, refineGate: 0 });
				const baselineMs = Date.now() - tb;
				const baseEffort = baseline.status === 'solved' ? baseline.effort : 0;
				const program = C.parseTransform(job.transform, g.model);
				if (program.errors.length || !program.statements.length) {
					parentPort.postMessage({ id: job.id, ok: false, reason: 'transform error: ' + (program.errors[0] ? program.errors[0].message : 'empty') });
					return;
				}
				// --trace: one entry per candidate assessment: [board index (repeats are
				// retries of parked timeouts), budget ms, primary ms, status, effort].
				const trace = job.trace ? [] : null, traceIds = new Map();
				// job.slowdown s > 1: busy-wait (s - 1) x each solver call's time, to
				// check that a slower engine shows up in the benchmark score.
				const slow = job.slowdown > 1 ? (f) => function () {
					const t = performance.now();
					const r = f.apply(null, arguments);
					const until = performance.now() + (performance.now() - t) * (job.slowdown - 1);
					while (performance.now() < until) { /* spin */ }
					return r;
				} : null;
				const nat = !slow ? g.native : { assess: slow((b, o) => g.native.assess(b, o)), solve: slow((b, o) => g.native.solve(b, o)) };
				const backend = !trace ? nat : {
					solve: (b, o) => nat.solve(b, o),
					assess: (b, o) => {
						const r = nat.assess(b, o);
						const k = C.cellsKey(b.cells);
						if (!traceIds.has(k)) traceIds.set(k, traceIds.size);
						trace.push([traceIds.get(k), o.timeMs, Math.round(r.primaryMs * 10) / 10, r.status[0], r.effort || 0]);
						return r;
					},
				};
				const gen = MISGenerator.create({ model: g.model, backend, program, base, seed: job.seed, keep: 8, baseEffort,
					basePrimaryMs: job.seedBudget && baseline.status === 'solved'
						? (job.workClock ? baseline.expanded / MISGenerator.WORK_STATES_PER_MS : baseline.primaryMs) : undefined,
					retryGrowth: job.retryGrowth,
					workClock: !!job.workClock, ...(job.genOpts || {}) });
				const solvable = new Set(), harder = new Set();
				let slowest = 0, bestEffort = 0;
				// Budget: run until job.candidates candidates have been judged (solved,
				// proved unsolvable or timed out), but at least minSeconds and at most
				// maxSeconds. Slow-to-judge games get more time; fast ones stop at minSeconds.
				const t0 = Date.now();
				const judged = () => { const st = gen.stats(); return st.solved + st.unsolvable + st.timeout; };
				let hitWall = false;
				for (;;) {
					const el = Date.now() - t0;
					if (job.workClock) {
						// Stop on work done (ms-equivalent); wall time is only a safety net.
						if (gen.work() >= job.maxSeconds * 1000) break;
						if (el >= job.maxSeconds * 1000 * 10) { hitWall = true; break; }
						// fall through to step
					} else {
						if (el >= job.maxSeconds * 1000) break;
						if (el >= job.minSeconds * 1000 && judged() >= job.candidates) break;
					}
					const s = Date.now();
					const r = gen.step();
					slowest = Math.max(slowest, Date.now() - s);
					if (!r) continue;
					const key = C.cellsKey(r.board.cells);
					solvable.add(key);
					if (r.result.effort > baseEffort) harder.add(key);
					bestEffort = Math.max(bestEffort, r.result.effort || 0);
				}
				const secs = (Date.now() - t0) / 1000;
				const st = gen.stats();
				const top = gen.best();
				const pr = gen.profile();
				parentPort.postMessage({ id: job.id, ok: true, secs, baseEffort, baselineMs, trace: trace || undefined, top: top.slice(),
					basePrimaryMs: baseline.status === 'solved' ? baseline.primaryMs : null,
					budget: { candidates: job.candidates, minSeconds: job.minSeconds, maxSeconds: job.maxSeconds },
					hitMax: judged() < job.candidates, solverBudgetMs: st.budgetMs, work: gen.work ? gen.work() / 1000 : undefined, hitWall,
					phaseMs: { transform: Math.round(pr.transformMs), dedupe: Math.round(pr.keyMs),
						primarySolved: Math.round(pr.primarySolvedMs), primaryUnsolvable: Math.round(pr.primaryUnsolvableMs),
						primaryTimeout: Math.round(pr.primaryTimeoutMs), refine: Math.round(pr.refineMs), proof: Math.round(pr.proofMs) },
					samples: st.generated + st.duplicates + st.unchanged, assessed: st.solved + st.unsolvable + st.timeout,
					solvedPct: (st.solved + st.unsolvable + st.timeout) ? st.solved / (st.solved + st.unsolvable + st.timeout) : 0,
					timeouts: st.timeout, newSolvable: solvable.size, harder: harder.size,
					harderPerMin: harder.size * 60 / secs, newSolvablePerMin: solvable.size * 60 / secs,
					bestEffort, top8Mean: top.length ? top.reduce((a, b) => a + b, 0) / top.length : 0,
					bestRatio: baseEffort > 0 ? bestEffort / baseEffort : null, slowestStepMs: slowest,
					arms: gen.arms().map(a => ({ scale: a.scale, ms: Math.round(a.ms) })) });
				return;
			}
		} catch (e) {
			parentPort.postMessage({ id: job.id, ok: false, reason: 'threw: ' + (e && e.message || e) });
		}
	});
	return;
}

/////////////////////////////////////////////////////////////////////
// Main: job pool with hard deadlines
/////////////////////////////////////////////////////////////////////

const args = process.argv.slice(2);
const mode = args[0];
function arg(name, dflt) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; }
const JOBS = +arg('--jobs', os.cpus().length);

function makePool(size, workerOpts) {
	const slots = [];
	let nextId = 1;
	const queue = [];
	function spawn(slot) {
		slot.worker = new Worker(__filename, workerOpts ? { workerData: workerOpts } : undefined);
		slot.busy = null;
		slot.worker.on('message', (m) => {
			const job = slot.busy;
			if (!job || m.id !== job.id) return;
			clearTimeout(job.timer);
			slot.busy = null;
			job.resolve(m);
			pump();
		});
		slot.worker.on('error', (e) => {
			const job = slot.busy;
			slot.busy = null;
			if (job) { clearTimeout(job.timer); job.resolve({ id: job.id, ok: false, reason: 'worker error: ' + e.message }); }
			spawn(slot);
			pump();
		});
	}
	for (let i = 0; i < size; i++) { const s = {}; spawn(s); slots.push(s); }
	function pump() {
		for (const slot of slots) {
			if (slot.busy || !queue.length) continue;
			const job = queue.shift();
			slot.busy = job;
			job.timer = setTimeout(() => {
				// Hard deadline: kill the worker (a native turn can't be interrupted).
				const j = slot.busy;
				slot.busy = null;
				slot.worker.removeAllListeners();
				slot.worker.terminate();
				spawn(slot);
				if (j) j.resolve({ id: j.id, ok: false, hung: true, reason: 'hung: exceeded ' + j.deadlineMs + 'ms' });
				pump();
			}, job.deadlineMs);
			slot.worker.postMessage(job.msg);
		}
	}
	return {
		run(msg, deadlineMs) {
			return new Promise((resolve) => {
				const id = nextId++;
				queue.push({ id, msg: Object.assign({ id }, msg), deadlineMs, resolve });
				pump();
			});
		},
		close() { slots.forEach(s => s.worker.terminate()); },
	};
}

function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16); }
function progress(done, total, label) { if (done % 25 === 0 || done === total) process.stderr.write(`  ${label} ${done}/${total}\n`); }

async function seeds() {
	const solveMs = +arg('--solve-ms', 500);
	const out = arg('--out', path.join(srcDir, 'tests/mis_generator_seeds.json'));
	const pool = makePool(JOBS);
	const files = fs.readdirSync(CORPUS).filter(f => f.endsWith('.txt')).sort();
	const skipped = [];
	const jobs = [];
	for (const f of files) {
		const file = path.join(CORPUS, f);
		jobs.push(pool.run({ type: 'levels', file }, 60000).then((m) => {
			if (!m.ok || m.reason) { skipped.push({ game: f, reason: m.reason }); return []; }
			return m.levels.map(level => ({ f, file, level }));
		}));
	}
	const levels = (await Promise.all(jobs)).flat();
	process.stderr.write(`${levels.length} playable levels in ${files.length - skipped.length} usable games (${skipped.length} skipped)\n`);
	let done = 0;
	const results = await Promise.all(levels.map(({ f, file, level }) =>
		pool.run({ type: 'seed', file, level, solveMs }, solveMs + 20000).then((m) => {
			progress(++done, levels.length, 'solved-check');
			return Object.assign({ game: f, level }, m);
		})));
	pool.close();
	const seedsList = results.filter(r => r.ok && r.status === 'solved' && r.ms <= solveMs)
		.map(r => ({ game: r.game, level: r.level, w: r.w, h: r.h, boardHash: r.boardHash, solveMs: r.ms, expanded: r.expanded, solutionLength: r.length }));
	const perGame = {};
	seedsList.forEach(s => { perGame[s.game] = (perGame[s.game] || 0) + 1; });
	const manifest = {
		schema_version: 1,
		kind: 'mis_generator_seeds',
		description: 'Levels from src/tests/solver_tests that the native portfolio solver (WebAssembly build, portfolio_jobs=1) solves within solve_ms. Seeds for generator benchmarks.',
		generated_at: new Date().toISOString(),
		corpus: 'src/tests/solver_tests',
		solve_ms: solveMs,
		game_hashes: Object.fromEntries(Object.keys(perGame).sort().map(g => [g, sha(path.join(CORPUS, g))])),
		counts: {
			games_in_corpus: files.length, games_skipped: skipped.length, levels_checked: levels.length,
			seed_levels: seedsList.length, seed_games: Object.keys(perGame).length,
			not_solved: results.filter(r => r.ok && r.status !== 'solved').length,
			hung: results.filter(r => r.hung).length, errors: results.filter(r => !r.ok && !r.hung).length,
		},
		skipped_games: skipped.sort((a, b) => a.game.localeCompare(b.game)),
		hung_levels: results.filter(r => r.hung).map(r => ({ game: r.game, level: r.level })),
		seeds: seedsList.sort((a, b) => a.game.localeCompare(b.game) || a.level - b.level),
	};
	fs.writeFileSync(out, JSON.stringify(manifest, null, 1) + '\n');
	console.log(JSON.stringify(manifest.counts));
	const top = Object.entries(perGame).sort((a, b) => b[1] - a[1]).slice(0, 12);
	console.log('most seed levels per game: ' + top.map(([g, n]) => `${g.replace(/\.txt$/, '')} ${n}`).join(', '));
	console.log('wrote ' + path.relative(process.cwd(), out));
}

async function survey() {
	const seedsFile = arg('--seeds', path.join(srcDir, 'tests/mis_generator_seeds.json'));
	const out = arg('--out', 'mis_generator_survey.json');
	// --seconds S: fixed S seconds per run (the original survey). Otherwise a
	// candidate budget: --candidates judged, within --min-seconds..--max-seconds.
	const fixed = arg('--seconds', null);
	const budget = fixed ? { candidates: 0, minSeconds: +fixed, maxSeconds: +fixed }
		: { candidates: +arg('--candidates', 30), minSeconds: +arg('--min-seconds', 3), maxSeconds: +arg('--max-seconds', 15) };
	const only = arg('--game', null);
	const rngSeed = +arg('--seed', 7);
	// Experimental generator options (see MISGenerator): --seed-budget sets the
	// solver budget relative to the seed's solve time (basePrimaryMs);
	// --retry-growth R retries parked timeouts only once the budget grew R-fold.
	const seedBudget = args.includes('--seed-budget');
	const retryGrowth = +arg('--retry-growth', 1);
	const trace = args.includes('--trace');
	const genFilter = arg('--generator', null) ? new RegExp(arg('--generator', null)) : null;
	// --rejudge prev.json: rerun only the levels the cull would drop as
	// unproductive in prev.json (no generator found a harder level, or a run
	// hung), and merge the new rows over the old ones.
	const rejudgeFile = arg('--rejudge', null);
	const prev = rejudgeFile ? JSON.parse(fs.readFileSync(rejudgeFile, 'utf8')) : null;
	const minEffort = +arg('--min-effort', 10);
	const manifest = JSON.parse(fs.readFileSync(seedsFile, 'utf8'));
	const pool = makePool(JOBS);
	let seedsList = manifest.seeds;
	if (only) seedsList = seedsList.filter(s => s.game.includes(only));
	if (prev) {
		const byLevel = {};
		for (const r of prev.rows) (byLevel[r.game + '#' + r.level] || (byLevel[r.game + '#' + r.level] = [])).push(r);
		seedsList = seedsList.filter((s) => {
			const rs = byLevel[s.game + '#' + s.level] || [];
			const ok = rs.filter(r => r.ok);
			if (ok.length && !(ok[0].baseEffort > minEffort)) return false; // trivial: culled anyway
			return !ok.some(r => r.harder > 0) || rs.some(r => r.hung);
		});
	}
	// Generators per game: the derived presets (frozen into the survey output).
	const games = [...new Set(seedsList.map(s => s.game))];
	const presetsByGame = {};
	await Promise.all(games.map(g => pool.run({ type: 'presets', file: path.join(CORPUS, g), level: 0 }, 60000)
		.then(m => { presetsByGame[g] = m.ok ? m.presets : []; })));
	const tasks = [];
	for (const s of seedsList) {
		for (const p of presetsByGame[s.game] || []) if (!genFilter || genFilter.test(p.id)) tasks.push({ s, p });
	}
	process.stderr.write(`${tasks.length} (level, generator) runs on ${seedsList.length} levels, budget ${JSON.stringify(budget)}, ${JOBS} threads\n`);
	let done = 0;
	const rows = await Promise.all(tasks.map(({ s, p }) =>
		pool.run({ type: 'survey', file: path.join(CORPUS, s.game), level: s.level, transform: p.text, candidates: budget.candidates, minSeconds: budget.minSeconds, maxSeconds: budget.maxSeconds, seed: rngSeed, seedBudget, retryGrowth, trace }, (budget.maxSeconds + 30) * 1000)
			.then((m) => {
				progress(++done, tasks.length, 'survey');
				return Object.assign({ game: s.game, level: s.level, generator: p.id, generatorLabel: p.label }, m);
			})));
	pool.close();
	let allRows = rows, generators = presetsByGame;
	if (prev) {
		const redone = new Set(seedsList.map(s => s.game + '#' + s.level));
		allRows = prev.rows.filter(r => !redone.has(r.game + '#' + r.level)).concat(rows);
		generators = Object.assign({}, prev.generators, presetsByGame);
	}
	fs.writeFileSync(out, JSON.stringify({
		schema_version: 2, kind: 'mis_generator_survey', generated_at: new Date().toISOString(),
		seeds: path.relative(process.cwd(), seedsFile), budget, threads: JOBS, rng_seed: rngSeed, seed_relative_solver_budget: seedBudget, retry_growth: retryGrowth,
		rejudged: prev ? { from: path.relative(process.cwd(), rejudgeFile), levels: seedsList.length, budget_of_other_rows: prev.budget || { seconds: prev.seconds_per_run } } : undefined,
		generators, rows: allRows,
	}, null, 1) + '\n');
	report(allRows);
	console.log('wrote ' + out);
}

function cull() {
	const survey = JSON.parse(fs.readFileSync(args[1], 'utf8'));
	const seedsFile = arg('--seeds', path.join(srcDir, 'tests/mis_generator_seeds.json'));
	const out = arg('--out', path.join(srcDir, 'tests/mis_generator_bench_seeds.json'));
	const cap = +arg('--cap', 4), minEffort = +arg('--min-effort', 10);
	const pick = arg('--pick', 'spread');
	const manifest = JSON.parse(fs.readFileSync(seedsFile, 'utf8'));
	const runs = {};
	for (const r of survey.rows) (runs[r.game + '#' + r.level] || (runs[r.game + '#' + r.level] = [])).push(r);
	const dropped = { trivial: 0, unproductive: 0, hung: 0, not_surveyed: 0, over_cap: 0 };
	const byGame = {};
	for (const s of manifest.seeds) {
		const all = runs[s.game + '#' + s.level] || [];
		const rs = all.filter(r => r.ok);
		// A hung run (a native turn that can't be interrupted) costs the whole
		// deadline on every benchmark run and measures nothing.
		if (all.some(r => r.hung)) { dropped.hung++; continue; }
		if (!rs.length) { dropped.not_surveyed++; continue; }
		const baseEffort = rs[0].baseEffort;
		if (!(baseEffort > minEffort)) { dropped.trivial++; continue; }
		const productive = rs.filter(r => r.harder > 0);
		if (!productive.length) { dropped.unproductive++; continue; }
		const lift = Math.max(...rs.map(r => r.top8Mean / baseEffort));
		(byGame[s.game] || (byGame[s.game] = [])).push(Object.assign({}, s, {
			baseEffort, productiveGenerators: productive.map(r => r.generator).sort(),
			generators: rs.length, lift: +lift.toFixed(3),
		}));
	}
	const kept = [];
	for (const list of Object.values(byGame)) {
		dropped.over_cap += Math.max(0, list.length - cap);
		if (list.length <= cap) { kept.push(...list); continue; }
		if (pick === 'productive') {
			list.sort((a, b) => b.productiveGenerators.length - a.productiveGenerators.length || b.lift - a.lift || a.level - b.level);
			kept.push(...list.slice(0, cap));
		} else {
			// spread: the easiest, the hardest and evenly spaced levels between, by
			// seed solver effort, so the set covers each game's difficulty range.
			list.sort((a, b) => a.baseEffort - b.baseEffort || a.level - b.level);
			for (let i = 0; i < cap; i++) kept.push(list[cap === 1 ? 0 : Math.round(i * (list.length - 1) / (cap - 1))]);
		}
	}
	kept.sort((a, b) => a.game.localeCompare(b.game) || a.level - b.level);
	const games = [...new Set(kept.map(s => s.game))];
	const bench = {
		schema_version: 1,
		kind: 'mis_generator_bench_seeds',
		description: 'Benchmark levels for the MIS generator: seeds from ' + path.relative(process.cwd(), seedsFile) +
			', minus trivial levels, levels with a hung run and levels no generator improved on, at most `cap` per game chosen by `rule.pick`.',
		generated_at: new Date().toISOString(),
		corpus: manifest.corpus,
		solve_ms: manifest.solve_ms,
		rule: { min_effort_exclusive: minEffort, cap_per_game: cap,
			pick: pick === 'productive' ? 'productive generators desc, lift desc, level asc' : 'spread: evenly spaced by seed effort (includes easiest and hardest)',
			survey_budget: survey.budget || { seconds: survey.seconds_per_run }, survey_rejudged: survey.rejudged, survey_rng_seed: survey.rng_seed || 7 },
		game_hashes: Object.fromEntries(games.map(g => [g, manifest.game_hashes[g]])),
		generators: Object.fromEntries(games.map(g => [g, survey.generators[g]])),
		counts: { seed_levels_in: manifest.seeds.length, dropped, levels: kept.length, games: games.length },
		seeds: kept,
	};
	fs.writeFileSync(out, JSON.stringify(bench, null, 1) + '\n');
	console.log(JSON.stringify(bench.counts));
	console.log('wrote ' + path.relative(process.cwd(), out));
}

function report(rows) {
	const ok = rows.filter(r => r.ok);
	const byGame = {};
	for (const r of ok) {
		const g = byGame[r.game] || (byGame[r.game] = { levels: new Set(), runs: 0, harder: 0, newSolvable: 0, secs: 0, best: {} });
		g.levels.add(r.level); g.runs++; g.harder += r.harder; g.newSolvable += r.newSolvable; g.secs += r.secs;
		const lb = g.best[r.level] || 0;
		g.best[r.level] = Math.max(lb, r.harderPerMin);
	}
	const hung = rows.filter(r => r.hung).length, failed = rows.filter(r => !r.ok && !r.hung).length;
	console.log(`\n${ok.length} runs ok, ${hung} hung, ${failed} failed`);
	const genTotals = {};
	for (const r of ok) {
		const k = r.generator.split('-')[0];
		const t = genTotals[k] || (genTotals[k] = { runs: 0, harder: 0, secs: 0, solvable: 0 });
		t.runs++; t.harder += r.harder; t.secs += r.secs; t.solvable += r.newSolvable;
	}
	console.log('\nBy generator type (harder-than-seed levels per minute, new solvable levels per minute):');
	for (const [k, t] of Object.entries(genTotals).sort((a, b) => b[1].harder / b[1].secs - a[1].harder / a[1].secs)) {
		console.log(`  ${k.padEnd(9)} ${String(t.runs).padStart(5)} runs  harder ${(t.harder * 60 / t.secs).toFixed(1).padStart(7)}/min  new solvable ${(t.solvable * 60 / t.secs).toFixed(1).padStart(7)}/min`);
	}
	const games = Object.entries(byGame).map(([g, v]) => {
		const perLevel = Object.values(v.best).sort((a, b) => b - a);
		return { game: g, levels: v.levels.size, harderPerMin: v.harder * 60 / v.secs, bestLevel: perLevel[0] || 0,
			productiveLevels: perLevel.filter(x => x > 0).length };
	}).sort((a, b) => b.harderPerMin - a.harderPerMin);
	console.log('\nGames by productivity (harder-than-seed per minute, averaged over all their runs):');
	console.log('  ' + 'game'.padEnd(40) + 'seed lvls  productive lvls  harder/min  best level/min');
	for (const g of games) {
		console.log('  ' + g.game.replace(/\.txt$/, '').slice(0, 38).padEnd(40) + String(g.levels).padStart(9) + String(g.productiveLevels).padStart(17) +
			g.harderPerMin.toFixed(1).padStart(12) + g.bestLevel.toFixed(1).padStart(16));
	}
}

if (require.main !== module) {
	module.exports = { makePool, CORPUS, srcDir };
} else (async () => {
	if (mode === 'seeds') await seeds();
	else if (mode === 'survey') await survey();
	else if (mode === 'cull') cull();
	else if (mode === 'report') report(JSON.parse(fs.readFileSync(args[1], 'utf8')).rows);
	else {
		console.log('usage: mis_generator_seed_survey_node.js seeds|survey|cull <survey.json>|report <survey.json> [options]');
		process.exit(2);
	}
})();
