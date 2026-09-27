#!/usr/bin/env node
'use strict';

// Benchmark score for the PuzzleScript+MIS level generator: does a change make
// generation better? Faster solving, better choices of candidates, discarding
// dead ends sooner: anything that helps shows up as a better shortlist in the
// same time.
//
//   node src/tests/mis_generator_bench_node.js run [--quick] [--work] [--repeats 1] [--jobs N] [--game SUBSTRING]
//        [--variant NAME='{"src":"../ref/src","gen":{...},"slowdown":1.5}']... [--out bench_run.json]
//   node src/tests/mis_generator_bench_node.js score bench_run.json [more_runs.json ...]
//   node src/tests/mis_generator_bench_node.js calibrate survey.json    (writes benchSeconds into the manifest)
//
// Levels: src/tests/mis_generator_bench_seeds.json (see
// docs/benchmarks/2026-09-27-mis-generator-bench.md). Every (level, generator)
// run gets the level's frozen time (benchSeconds: what the reference generator
// needed to judge 30 candidates, 3-15 s), so a faster engine or smarter loop
// has the same time to do more with. --quick uses one level per game.
//
// Score: per run, lift = shortlist value / seed effort, where the shortlist
// value is the mean effort over its 8 slots (an empty slot counts as 0) and
// lift is floored at 1/16. A variant's score is the geometric mean of lift,
// averaged per game first so every game counts the same.
//
// --work: deterministic work clock. Budgets count solver states (50 per ms
// of the level's time) instead of time, and the solver makes no timing-based
// decisions, so identical code gives identical results. It measures the
// loop's choices only; engine speed shows only in the timed mode.
//
// Variants run at the same time on the same machine, interleaved, each on
// jobs / variants threads, so machine load affects them alike. The first
// variant is the reference: each other variant's score is compared run by run
// (same level, generator, repeat and random seed) with a 95% confidence
// interval from resampling games. A variant's "src" is the src/ directory of
// another checkout (e.g. a git worktree of the commit to compare against);
// "gen" passes MISGenerator options; "seedBudget": true sets the generator's
// basePrimaryMs from the seed; "slowdown" busy-waits to make every solver call
// that many times slower (a check that the score can see speed).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { makePool, CORPUS, srcDir } = require('./mis_generator_seed_survey_node.js');

const args = process.argv.slice(2);
const mode = args[0];
function arg(name, dflt) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; }
function argAll(name) { const out = []; args.forEach((a, i) => { if (a === name) out.push(args[i + 1]); }); return out; }
const MANIFEST = arg('--manifest', path.join(srcDir, 'tests/mis_generator_bench_seeds.json'));
const LIFT_FLOOR = 1 / 16;

function gitInfo(dir) {
	try {
		const head = execSync('git rev-parse --short HEAD', { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
		const dirty = execSync('git status --porcelain -- .', { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() ? '+dirty' : '';
		return head + dirty;
	} catch (e) { return null; }
}

function quickSet(seeds) {
	// One level per game: the one with the median seed effort (lower median).
	const byGame = {};
	for (const s of seeds) (byGame[s.game] || (byGame[s.game] = [])).push(s);
	return Object.values(byGame).map((l) => {
		l = l.slice().sort((a, b) => a.baseEffort - b.baseEffort || a.level - b.level);
		return l[(l.length - 1) >> 1];
	});
}

/////////////////////////////////////////////////////////////////////
// calibrate: frozen time per level from a candidate-budget survey
/////////////////////////////////////////////////////////////////////

function calibrate() {
	const survey = JSON.parse(fs.readFileSync(args[1], 'utf8'));
	const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
	const minS = +arg('--min-seconds', 3), maxS = +arg('--max-seconds', 15);
	const per = {};
	for (const r of survey.rows) {
		if (!r.ok || !r.budget || !r.budget.candidates) continue;
		const target = r.budget.candidates;
		// Time to judge `target` candidates (extrapolated when the run hit its limit).
		const t = r.hitMax ? r.secs * target / Math.max(1, r.assessed) : r.secs;
		(per[r.game + '#' + r.level] || (per[r.game + '#' + r.level] = [])).push(t);
	}
	const med = (x) => { x = x.slice().sort((a, b) => a - b); return x[x.length >> 1]; };
	let missing = 0, runSeconds = 0;
	for (const s of manifest.seeds) {
		const ts = per[s.game + '#' + s.level];
		if (!ts) { missing++; s.benchSeconds = maxS; continue; }
		s.benchSeconds = Math.min(maxS, Math.max(minS, Math.round(med(ts) * 2) / 2));
		runSeconds += s.benchSeconds * ((manifest.generators[s.game] || []).length || 1);
	}
	manifest.calibration = {
		from: path.basename(args[1]), survey_budget: survey.budget, generated_at: new Date().toISOString(),
		rule: `median over the level's generators of the time to judge ${survey.budget && survey.budget.candidates} candidates, clamped to ${minS}-${maxS} s, rounded to 0.5 s`,
		levels_without_data: missing, total_run_seconds: Math.round(runSeconds),
	};
	fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + '\n');
	const q = quickSet(manifest.seeds);
	const qs = q.reduce((t, s) => t + s.benchSeconds * ((manifest.generators[s.game] || []).length || 1), 0);
	console.log(`calibrated ${manifest.seeds.length} levels (${missing} without data): one full pass = ${Math.round(runSeconds / 60)} thread-minutes; --quick (${q.length} levels) = ${Math.round(qs / 60)} thread-minutes`);
}

/////////////////////////////////////////////////////////////////////
// run
/////////////////////////////////////////////////////////////////////

function parseVariants() {
	const specs = argAll('--variant');
	if (!specs.length) return [{ name: 'current' }];
	return specs.map((spec) => {
		const eq = spec.indexOf('=');
		const name = eq < 0 ? spec : spec.slice(0, eq);
		const v = Object.assign({ name }, eq < 0 ? {} : JSON.parse(spec.slice(eq + 1)));
		if (v.src) {
			v.src = path.resolve(v.src);
			if (!fs.existsSync(path.join(v.src, 'js/mis/mis_generator.js'))) throw new Error(`${name}: ${v.src} has no js/mis/mis_generator.js`);
		}
		return v;
	});
}

async function run() {
	const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
	if (!manifest.seeds.every(s => s.benchSeconds > 0)) throw new Error('manifest has no benchSeconds: run calibrate first');
	const quick = args.includes('--quick');
	const repeats = +arg('--repeats', 1);
	const jobs = +arg('--jobs', os.cpus().length);
	const out = arg('--out', 'mis_generator_bench_run.json');
	const variants = parseVariants();
	// --work: deterministic work-clock runs (solver states instead of time).
	const work = args.includes('--work');
	let seeds = quick ? quickSet(manifest.seeds) : manifest.seeds;
	const only = arg('--game', null);
	if (only) seeds = seeds.filter(s => s.game.includes(only));
	if (!seeds.length) throw new Error('no benchmark levels selected');
	const perVariant = Math.max(1, Math.floor(jobs / variants.length));
	const pools = variants.map(v => makePool(perVariant, v.src ? { srcDir: v.src } : null));
	for (const v of variants) v.commit = gitInfo(v.src || srcDir);

	const tasks = [];
	for (let rep = 0; rep < repeats; rep++) {
		for (const s of seeds) {
			for (const p of manifest.generators[s.game] || []) tasks.push({ s, p, rep });
		}
	}
	const threadSeconds = tasks.reduce((t, x) => t + x.s.benchSeconds, 0);
	process.stderr.write(`${tasks.length} runs x ${variants.length} variant(s) [${variants.map(v => v.name).join(', ')}], ` +
		`${perVariant} thread(s) each: ~${Math.round(threadSeconds / perVariant / 60)} min\n`);
	let done = 0;
	const total = tasks.length * variants.length;
	const rows = [];
	const promises = [];
	// Interleave: every task is queued for all variants back to back.
	for (const { s, p, rep } of tasks) {
		variants.forEach((v, vi) => {
			const slow = v.slowdown > 1 ? v.slowdown : 1;
			promises.push(pools[vi].run({
				type: 'survey', file: path.join(CORPUS, s.game), level: s.level, transform: p.text,
				candidates: 0, minSeconds: s.benchSeconds, maxSeconds: s.benchSeconds, seed: 11 + rep,
				genOpts: v.gen || null, slowdown: slow, seedBudget: !!v.seedBudget, workClock: work,
			}, ((work ? 10 : 1) * s.benchSeconds + 60) * 1000 * slow).then((m) => {
				done++;
				if (done % 50 === 0 || done === total) process.stderr.write(`  ${done}/${total}\n`);
				rows.push({
					variant: v.name, game: s.game, level: s.level, generator: p.id, rep, seconds: s.benchSeconds,
					ok: !!m.ok, hung: !!m.hung, reason: m.ok ? undefined : m.reason,
					secs: m.secs, work: m.work, hitWall: m.hitWall || undefined, baseEffort: m.baseEffort, top: m.top, assessed: m.assessed, timeouts: m.timeouts,
					harder: m.harder, newSolvable: m.newSolvable, solvedPct: m.solvedPct,
				});
			}));
		});
	}
	await Promise.all(promises);
	pools.forEach(p => p.close());
	const result = {
		schema_version: 1, kind: 'mis_generator_bench_run', generated_at: new Date().toISOString(),
		manifest: path.relative(process.cwd(), MANIFEST), quick, repeats, jobs, clock: work ? 'work' : 'time',
		machine: { cpus: os.cpus().length, model: (os.cpus()[0] || {}).model, node: process.version },
		variants, rows,
	};
	fs.writeFileSync(out, JSON.stringify(result) + '\n');
	score([result]);
	console.log('wrote ' + out);
}

/////////////////////////////////////////////////////////////////////
// score
/////////////////////////////////////////////////////////////////////

function lift(r) {
	const top = r.top || [];
	const value = top.reduce((a, b) => a + b, 0) / 8;
	return Math.max(LIFT_FLOOR, value / r.baseEffort);
}

function makeRng(seed) {
	let s = seed >>> 0;
	return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function score(results) {
	// Merge files; variant names are made unique.
	const rows = [], names = [];
	for (const res of results) {
		const rename = {};
		for (const v of res.variants) {
			let n = v.name, k = 2;
			while (names.includes(n)) n = v.name + '#' + (k++);
			names.push(n); rename[v.name] = n;
		}
		for (const r of res.rows) rows.push(Object.assign({}, r, { variant: rename[r.variant] }));
	}
	const key = r => `${r.game}#${r.level}#${r.generator}#${r.rep}`;
	const by = {};
	for (const n of names) by[n] = {};
	for (const r of rows) if (r.ok && r.baseEffort > 0) by[r.variant][key(r)] = r;
	const mean = x => x.reduce((a, b) => a + b, 0) / x.length;
	const f2 = x => x.toFixed(2), pctc = x => (x >= 1 ? '+' : '') + ((x - 1) * 100).toFixed(1) + '%';

	console.log('\nvariant              runs  hung   score  harder/run  candidates/s');
	for (const n of names) {
		const rs = Object.values(by[n]);
		const games = {};
		for (const r of rs) (games[r.game] || (games[r.game] = [])).push(Math.log(lift(r)));
		const sc = Math.exp(mean(Object.values(games).map(mean)));
		const hung = rows.filter(r => r.variant === n && r.hung).length;
		const cps = rs.reduce((t, r) => t + r.assessed, 0) / rs.reduce((t, r) => t + r.secs, 0);
		console.log(`${n.slice(0, 20).padEnd(20)} ${String(rs.length).padStart(5)} ${String(hung).padStart(5)} ${f2(sc).padStart(7)} ${mean(rs.map(r => r.harder)).toFixed(2).padStart(11)} ${cps.toFixed(1).padStart(13)}`);
	}
	if (names.length < 2) return;
	const ref = names[0];
	console.log(`\nvs ${ref} (paired runs; 95% CI from resampling games; "better/worse" = runs whose lift changed by more than 5%):`);
	for (const n of names.slice(1)) {
		const perGame = {};
		let better = 0, worse = 0, pairs = 0, candA = 0, candB = 0, secA = 0, secB = 0;
		for (const k in by[n]) {
			const a = by[ref][k], b = by[n][k];
			if (!a) continue;
			pairs++;
			const d = Math.log(lift(b)) - Math.log(lift(a));
			if (d > Math.log(1.05)) better++; else if (d < -Math.log(1.05)) worse++;
			(perGame[b.game] || (perGame[b.game] = [])).push(d);
			candA += a.assessed; candB += b.assessed; secA += a.secs; secB += b.secs;
		}
		const g = Object.values(perGame).map(mean);
		const est = mean(g);
		const rng = makeRng(12345);
		const boots = [];
		for (let i = 0; i < 2000; i++) {
			let t = 0;
			for (let j = 0; j < g.length; j++) t += g[Math.floor(rng() * g.length)];
			boots.push(t / g.length);
		}
		boots.sort((x, y) => x - y);
		const lo = Math.exp(boots[Math.floor(0.025 * boots.length)]), hi = Math.exp(boots[Math.floor(0.975 * boots.length)]);
		const verdict = g.length < 10 ? 'too few games for a CI' : lo > 1 ? 'BETTER' : hi < 1 ? 'WORSE' : 'no significant change';
		console.log(`  ${n.slice(0, 20).padEnd(20)} score ${pctc(Math.exp(est)).padStart(7)}  [${pctc(lo)}, ${pctc(hi)}]  ${verdict.padEnd(22)} ` +
			`better/worse runs ${better}/${worse} of ${pairs}  candidates/s ${pctc((candB / secB) / (candA / secA))}`);
	}
}

(async () => {
	if (mode === 'calibrate') calibrate();
	else if (mode === 'run') await run();
	else if (mode === 'score') score(args.slice(1).filter(a => a.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(f, 'utf8'))));
	else {
		console.log('usage: mis_generator_bench_node.js run [--quick] [--repeats N] [--variant NAME=JSON]... | score run.json... | calibrate survey.json');
		process.exit(2);
	}
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
