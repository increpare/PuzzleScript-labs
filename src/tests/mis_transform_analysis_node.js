#!/usr/bin/env node
'use strict';

// Checks for the MIS95 transform analyzer (src/js/mis/mis_transform_analysis.js):
// per-class count bounds of transform rules, created/destroyed objects, the
// session certificate, the per-candidate check and the generator's gate.
//
//   node src/tests/mis_transform_analysis_node.js

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const srcDir = path.join(__dirname, '..');

global.window = global;
global.document = {
	URL: 'mis://', body: { classList: { contains() { return false; } }, addEventListener() {}, removeEventListener() {} },
	createElement() { return { style: {}, getContext() { return null; } }; }, getElementById() { return null; },
};

const files = [
	'js/mis/mis_shims.js',
	'js/storagewrapper.js', 'js/bitvec.js', 'js/level.js', 'js/languageConstants.js', 'js/globalVariables.js',
	'js/debug.js', 'js/plugin_header_on.js', 'js/font.js', 'js/rng.js', 'js/riffwave.js', 'js/sfxr.js',
	'js/codemirror/stringstream.js', 'js/colorhelpers.js', 'js/colors.js', 'js/engine.js', 'js/parser.js',
	'js/compiler.js', 'js/soundbar.js',
];
let code = '';
for (const f of files) code += `\n// ---- ${f} ----\n` + fs.readFileSync(path.join(srcDir, f), 'utf8');
code += '\nmisAfterEngineLoaded();\n';
code += fs.readFileSync(path.join(srcDir, 'js/mis/mis_core.js'), 'utf8');
code += '\n' + fs.readFileSync(path.join(srcDir, 'js/mis/mis_generator.js'), 'utf8');
code += '\n' + fs.readFileSync(path.join(srcDir, 'js/mis/mis_transform_analysis.js'), 'utf8');
code += '\nglobal.MISCore = MISCore; global.misCompile = misCompile; global.MISGenerator = MISGenerator; global.MISTransformAnalysis = MISTransformAnalysis;\n';
vm.runInThisContext(code, { filename: 'mis_combined.js' });

let passed = 0;
function test(name, fn) {
	try { fn(); passed++; console.log('ok   ' + name); }
	catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e)); process.exitCode = 1; }
}

const C = MISCore, A = MISTransformAnalysis;

function loadText(text, label) {
	const res = misCompile(text);
	assert(res.ok && !res.hasErrors, label + ' should compile: ' + JSON.stringify(res.errors));
	return { text, model: C.extractModel(text) };
}
function load(rel) { return loadText(fs.readFileSync(path.join(srcDir, rel), 'utf8'), rel); }

// Player is a property of two objects on one layer; Gem sits on its own layer.
const TWO_PLAYERS = fs.readFileSync(path.join(__dirname, 'fixtures/mis-optimization/two_players.txt'), 'utf8');

const soko = load('demo/sokoban_basic.txt');
const sokoBoard = soko.model.levels.find(l => l.board).board;
const two = loadText(TWO_PLAYERS, 'two players');
const twoBoard = two.model.levels.find(l => l.board).board;
const twoBoard2 = two.model.levels.filter(l => l.board)[1].board;

function classOf(model, analysis, name) {
	const ids = model.names[name].ids.slice().sort((a, b) => a - b).join(',');
	const c = analysis.classes[ids];
	assert(c, 'class ' + name + ' analysed');
	return c;
}
function analyse(g, text) {
	const prog = C.parseTransform(text, g.model);
	assert.deepStrictEqual(prog.errors, [], text);
	return A.analyzeTransform(g.model, prog);
}
function countId(model, board, id) {
	let n = 0;
	for (let t = 0; t < board.w * board.h; t++) if (C.hasBit(board.cells, t, id, model.stride)) n++;
	return n;
}
function count(model, board, name) {
	const ids = model.names[name].ids;
	let n = 0;
	for (let t = 0; t < board.w * board.h; t++) for (const id of ids) if (C.hasBit(board.cells, t, id, model.stride)) n++;
	return n;
}

test('classes: every object, legend properties and the player', () => {
	const cls = A.classes(two.model);
	const keyOf = name => two.model.names[name].ids.slice().sort((a, b) => a - b).join(',');
	const player = cls.find(c => c.key === keyOf('player'));
	assert(player && player.isPlayer, 'player class');
	assert.strictEqual(player.ids.length, 2);
	assert(cls.find(c => c.key === keyOf('playerl')), 'PlayerL object class');
	assert(cls.find(c => c.key === keyOf('gem')), 'Gem object class');
	assert.strictEqual(new Set(cls.map(c => c.key)).size, cls.length, 'no duplicate classes');
});

test('slide preset keeps exactly one Player, without needing the hypothesis', () => {
	const preset = C.derivePresets(soko.model).find(p => p.id === 'move');
	const p = classOf(soko.model, analyse(soko, preset.text), 'player');
	assert.strictEqual(p.keeps_one, true);
	assert.strictEqual(p.never_increases, true);
	assert.strictEqual(p.never_decreases, true);
});

test('backward-design preset keeps exactly one Player', () => {
	const preset = C.derivePresets(soko.model).find(p => p.id.indexOf('backward') === 0);
	assert(preset, 'sokoban has a backward-design preset');
	assert.strictEqual(classOf(soko.model, analyse(soko, preset.text), 'player').keeps_one, true);
});

test('a player walk with an unguarded target cell needs the one-player hypothesis', () => {
	const p = classOf(soko.model, analyse(soko, 'choose 9 horizontal [ Player | no Wall ] -> [ | Player ]'), 'player');
	assert.strictEqual(p.keeps_one, true, 'one player in: the other cell holds none');
	assert.strictEqual(p.never_increases, true);
	assert.strictEqual(p.never_decreases, false, 'with two players, one can step onto the other');
});

test('adding a Player is a blocker on its line', () => {
	const p = classOf(soko.model, analyse(soko, '(walls)\n[ Wall ] -> [ ]\nchoose 1 [ no Wall ] -> [ Player ]'), 'player');
	assert.strictEqual(p.keeps_one, false);
	assert.strictEqual(p.never_increases, false);
	assert.deepStrictEqual(p.blockers.keeps_one, [2]);
});

test('placing a Crate on the player layer may erase the player unless guarded', () => {
	const bad = classOf(soko.model, analyse(soko, 'choose 3 [ no Wall ] -> [ Crate ]'), 'player');
	assert.strictEqual(bad.keeps_one, false);
	assert.strictEqual(bad.never_decreases, false);
	const good = classOf(soko.model, analyse(soko, 'choose 3 [ no Wall no Player ] -> [ Crate ]'), 'player');
	assert.strictEqual(good.keeps_one, true);
});

test('a property class survives a swap that its members do not', () => {
	const a = analyse(two, 'choose 1 [ PlayerL ] -> [ PlayerR ]');
	assert.strictEqual(classOf(two.model, a, 'player').keeps_one, true);
	assert.strictEqual(classOf(two.model, a, 'playerl').keeps_one, false);
	assert.strictEqual(classOf(two.model, a, 'playerl').never_increases, true);
	assert.strictEqual(classOf(two.model, a, 'playerr').never_decreases, true);
});

test('created and destroyed objects', () => {
	const m = soko.model, id = n => m.names[n].ids[0];
	const a = analyse(soko, '[ Wall ] -> [ ]');
	assert.deepStrictEqual(a.created, []);
	assert.deepStrictEqual(a.destroyed, [id('wall')]);
	const b = analyse(soko, 'choose 2 [ no Wall no Player no Crate ] -> [ Crate ]');
	assert.deepStrictEqual(b.created, [id('crate')]);
	assert.deepStrictEqual(b.destroyed, []);
	// An unguarded crate placement may overwrite whatever shares its layer.
	const c = analyse(soko, '[ Target ] -> [ Target Crate ]');
	assert.deepStrictEqual(c.created, [id('crate')]);
	assert.deepStrictEqual(c.destroyed.slice().sort((x, y) => x - y), [id('player'), id('wall')].sort((x, y) => x - y));
});

test('a Gem on its own layer: zero stays zero only if nothing adds one', () => {
	const add = classOf(two.model, analyse(two, 'choose 1 [ no Wall ] -> [ Gem ]'), 'gem');
	assert.strictEqual(add.keeps_zero, false);
	assert.strictEqual(add.keeps_at_most_one, false, 'two applications add two gems');
	const move = classOf(two.model, analyse(two, 'choose 4 [ Gem | no Gem ] -> [ | Gem ]'), 'gem');
	assert.strictEqual(move.keeps_zero, true);
	assert.strictEqual(move.keeps_one, true);
	assert.strictEqual(move.keeps_at_most_one, true);
});

test('session certificate: start board, every transform, and the rules', () => {
	const m = soko.model;
	const preset = C.derivePresets(m).find(p => p.id === 'move');
	const prog = C.parseTransform(preset.text, m);
	const cert = A.sessionCertificate(m, [prog], sokoBoard, {});
	assert(cert.ok, cert.reason);
	const player = cert.classes.find(c => c.isPlayer);
	assert.strictEqual(player.start, 1);
	assert.strictEqual(player.candidates.exactly_one, true);
	assert.strictEqual(player.play, null, 'no rule facts were given');
	assert(cert.facts.candidates.exactly_one.some(ids => ids.join(',') === player.key));
	assert(cert.objectsMayAppear.indexOf(m.names.player.ids[0]) >= 0);
	assert(cert.objectsMayAppear.indexOf(m.names.target.ids[0]) >= 0);

	const quantity = { objects: { player: [true, true], crate: [true, true] }, properties: [] };
	const withRules = A.sessionCertificate(m, [prog], sokoBoard, { ruleQuantity: quantity });
	assert.strictEqual(withRules.classes.find(c => c.isPlayer).play.exactly_one, true);
	assert(withRules.facts.play.exactly_one.some(ids => ids.join(',') === player.key));
	const growing = A.sessionCertificate(m, [prog], sokoBoard, { ruleQuantity: { objects: { player: [false, true] }, properties: [] } });
	assert.strictEqual(growing.classes.find(c => c.isPlayer).play.exactly_one, false, 'rules may add players');

	// Every transform must keep it (Auto mode sends several).
	const adder = C.parseTransform('choose 1 [ no Wall no Player no Crate ] -> [ Player ]', m);
	const both = A.sessionCertificate(m, [prog, adder], sokoBoard, {});
	assert.strictEqual(both.classes.find(c => c.isPlayer).candidates.exactly_one, false);
});

test('session certificate: property players and a two-player start board', () => {
	const prog = C.parseTransform('choose 3 [ PlayerL ] -> [ PlayerR ]\nor [ PlayerR ] -> [ PlayerL ]', two.model);
	const quantity = { objects: { playerl: [false, false], playerr: [false, false] }, properties: [{ members: ['playerl', 'playerr'], never_increases: true, never_decreases: true }] };
	const one = A.sessionCertificate(two.model, [prog], twoBoard, { ruleQuantity: quantity });
	const player = one.classes.find(c => c.isPlayer);
	assert.strictEqual(player.candidates.exactly_one, true);
	assert.strictEqual(player.play.exactly_one, true, 'the property quantity is used');
	const fallback = A.sessionCertificate(two.model, [prog], twoBoard, { ruleQuantity: { objects: quantity.objects, properties: [] } });
	assert.strictEqual(fallback.classes.find(c => c.isPlayer).play.exactly_one, false, 'members alone cannot prove the sum');
	const pair = A.sessionCertificate(two.model, [prog], twoBoard2, {});
	assert.strictEqual(pair.classes.find(c => c.isPlayer).start, 2);
	assert.strictEqual(pair.classes.find(c => c.isPlayer).candidates.exactly_one, false);
});

test('a malformed start board is not certified', () => {
	const m = soko.model, b = C.cloneBoard(sokoBoard);
	let tile = -1;
	for (let t = 0; t < b.w * b.h && tile < 0; t++) if (C.hasBit(b.cells, t, m.names.wall.ids[0], m.stride)) tile = t;
	C.setBit(b.cells, tile, m.names.crate.ids[0], m.stride); // two objects on one layer
	const cert = A.sessionCertificate(m, [C.parseTransform('[ Wall ] -> [ ]', m)], b, {});
	assert.strictEqual(cert.ok, false);
	assert.deepStrictEqual(cert.facts.candidates.exactly_one, []);
});

test('checkBoard reports boards that break the certificate', () => {
	const m = soko.model;
	const cert = A.sessionCertificate(m, [C.parseTransform('choose 2 [ Player | no Wall no Crate ] -> [ | Player ]', m)], sokoBoard, {});
	assert.deepStrictEqual(A.checkBoard(m, cert, sokoBoard), []);
	const b = C.cloneBoard(sokoBoard);
	let tile = -1;
	for (let t = 0; t < b.w * b.h && tile < 0; t++) if (!C.hasBit(b.cells, t, m.names.player.ids[0], m.stride) && !C.hasBit(b.cells, t, m.names.wall.ids[0], m.stride) && !C.hasBit(b.cells, t, m.names.crate.ids[0], m.stride)) tile = t;
	C.setBit(b.cells, tile, m.names.player.ids[0], m.stride);
	const v = A.checkBoard(m, cert, b);
	assert(v.some(x => /player/i.test(x)), JSON.stringify(v));
});

// Soundness: whatever a transform is claimed to keep, running it keeps.
test('fuzz: claims hold on transformed boards', () => {
	const pools = [
		[soko, [sokoBoard, soko.model.levels.filter(l => l.board)[1].board], [
			'[ Player | no Wall ] -> [ | Player ]', '[ Player | no Wall no Crate ] -> [ | Player ]', '[ no Wall ] -> [ Player ]',
			'[ no Wall ] -> [ Crate ]', '[ no Wall no Player ] -> [ Crate ]', '[ Crate | Player ] -> [ Player | Crate ]',
			'[ Crate ] [ Target ] -> [ ] [ ]', '[ Target no Crate ] -> [ Target Crate ]', '[ Wall ] -> [ Player ]',
			'[ Player ] -> [ Crate ]', '[ Player | Crate ] -> [ Crate | Player ]', '[ no Player | Player ] -> [ Player | ]',
			'[ Crate no Target ] -> [ Target ]', '[ Wall | no Wall ] -> [ | Wall ]', '[ Player ] [ no Wall no Crate no Player ] -> [ ] [ Player ]',
			'[ no Crate ] -> [ no Player ]', '[ Target ] -> [ no Target Player ]', '[ Player Target ] -> [ Wall ]',
		]],
		[two, [twoBoard, twoBoard2], [
			'[ PlayerL ] -> [ PlayerR ]', '[ Player ] -> [ Player Gem ]', '[ Player | no Wall ] -> [ | PlayerL ]',
			'[ Gem | no Gem ] -> [ | Gem ]', '[ no Wall ] -> [ Gem ]', '[ Gem ] -> [ ]', '[ PlayerL | no Player ] -> [ PlayerL | PlayerL ]',
			'[ Player no Gem ] -> [ Player Gem ]', '[ no Player | PlayerL ] -> [ PlayerL | ]', '[ Crate ] -> [ PlayerR ]',
			'[ PlayerR | no Wall no Crate no Player ] -> [ | PlayerR ]', '[ no Gem ] [ Gem ] -> [ Gem ] [ ]',
		]],
	];
	const rng = C.makeRng(12345);
	let checked = 0, claims = 0;
	for (const [g, boards, lines] of pools) {
		const m = g.model, cls = A.classes(m);
		for (let trial = 0; trial < 120; trial++) {
			const pick = [];
			const n = 1 + Math.floor(rng() * 3);
			for (let i = 0; i < n; i++) pick.push((rng() < 0.6 ? 'choose ' + (1 + Math.floor(rng() * 4)) + ' ' : '') + lines[Math.floor(rng() * lines.length)]);
			const text = pick.join('\n');
			const prog = C.parseTransform(text, m);
			assert.deepStrictEqual(prog.errors, [], text);
			const a = A.analyzeTransform(m, prog);
			for (const board of boards) {
				// Chain some runs so later inputs are boards the authored levels never show.
				let input = board;
				for (let run = 0; run < 6; run++) {
					const out = C.runTransform(m, prog, input, null, rng);
					checked++;
					for (const c of cls) {
						const f = a.classes[c.key];
						const sum = b => { let k = 0; for (let t = 0; t < b.w * b.h; t++) for (const id of c.ids) if (C.hasBit(b.cells, t, id, m.stride)) k++; return k; };
						const before = sum(input), after = sum(out), where = text + ' / ' + c.name + ' ' + before + '->' + after;
						if (f.never_increases) { claims++; assert(after <= before, 'never_increases: ' + where); }
						if (f.never_decreases) { claims++; assert(after >= before, 'never_decreases: ' + where); }
						if (f.keeps_zero && before === 0) { claims++; assert.strictEqual(after, 0, 'keeps_zero: ' + where); }
						if (f.keeps_one && before === 1) { claims++; assert.strictEqual(after, 1, 'keeps_one: ' + where); }
						if (f.keeps_at_most_one && before <= 1) { claims++; assert(after <= 1, 'keeps_at_most_one: ' + where); }
					}
					for (let t = 0; t < out.w * out.h; t++) {
						for (let id = 0; id < m.objectCount; id++) {
							const was = C.hasBit(input.cells, t, id, m.stride), is = C.hasBit(out.cells, t, id, m.stride);
							if (!was && is) assert(a.created.indexOf(id) >= 0, 'created ' + m.objects[id].name + ': ' + text);
							if (was && !is) assert(a.destroyed.indexOf(id) >= 0, 'destroyed ' + m.objects[id].name + ': ' + text);
						}
					}
					assert(A.wellFormed(m, out).ok, 'transforms keep boards well formed: ' + text);
					input = rng() < 0.5 ? out : board;
				}
			}
		}
	}
	assert(checked > 2000 && claims > 5000, checked + ' boards, ' + claims + ' claims');
});

test('generator gate: facts reach the solver only for boards that pass', () => {
	const m = soko.model;
	const prog = C.parseTransform('choose 2 [ Player | no Wall no Crate ] -> [ | Player ]', m);
	const seen = [];
	const backend = { assess(board, opts) { seen.push(opts.facts); return { status: 'unsolvable', expanded: 1 }; } };
	let calls = 0;
	const facts = { candidates: { exactly_one: [[m.names.player.ids[0]]] } };
	const gen = MISGenerator.create({
		model: m, backend, program: prog, base: sokoBoard, seed: 3,
		gate: { facts, check() { calls++; return calls % 2 === 1; } },
	});
	for (let i = 0; i < 60; i++) gen.step();
	const s = gen.stats();
	assert(seen.length > 4, 'some boards were assessed');
	assert.strictEqual(s.gateChecked, calls);
	assert.strictEqual(s.gatePassed + s.gateFailed, calls);
	assert(s.gateFailed > 0);
	// After the first failure the session's certificate is withdrawn.
	const first = seen.findIndex(f => f === undefined);
	assert(first > 0 && seen[0] === facts, 'first board carried the facts');
	assert(seen.slice(first).every(f => f === undefined), 'no facts after a failed check');
	assert.strictEqual(s.gateFailed, 1, 'checking stops once withdrawn');
});

/////////////////////////////////////////////////////////////////////
// Count ranges: exact counts, one-sided bounds, choose-bounded statements
/////////////////////////////////////////////////////////////////////

const idsOf = (model, name) => model.names[name].ids.slice().sort((a, b) => a - b);
const keyOf = (model, name) => idsOf(model, name).join(',');
function certFor(g, texts, board, opts) {
	const programs = [].concat(texts).map(text => {
		const prog = C.parseTransform(text, g.model);
		assert.deepStrictEqual(prog.errors, [], text);
		return prog;
	});
	const cert = A.sessionCertificate(g.model, programs, board, opts || {});
	assert(cert.ok, cert.reason);
	return cert;
}
function classIn(cert, model, name) {
	const c = cert.classes.find(x => x.key === keyOf(model, name));
	assert(c, name + ' class in certificate');
	return c;
}
const FREE = 'no Wall no Crate no Player';
const sokoCrates = count(soko.model, sokoBoard, 'crate');
const sokoWalls = count(soko.model, sokoBoard, 'wall');
const sokoTargets = count(soko.model, sokoBoard, 'target');

test('exact counts: a crate shuffle keeps the crate count', () => {
	const m = soko.model;
	const cert = certFor(soko, 'choose 3 [ Crate | ' + FREE + ' ] -> [ | Crate ]', sokoBoard, { ruleQuantity: { objects: { crate: [true, true], player: [true, true] }, properties: [] } });
	const crate = classIn(cert, m, 'crate');
	assert.strictEqual(crate.candidates.exact_count, sokoCrates);
	assert.strictEqual(crate.candidates.min, sokoCrates);
	assert.strictEqual(crate.candidates.max, sokoCrates);
	assert.strictEqual(crate.play.exact_count, sokoCrates, 'sokoban rules keep crates too');
	assert.strictEqual(classIn(cert, m, 'target').candidates.exact_count, sokoTargets, 'untouched objects keep their count');
	assert.strictEqual(classIn(cert, m, 'wall').candidates.exact_count, sokoWalls);
	assert(cert.facts.candidates.exact_count.some(f => f.ids.join(',') === crate.key && f.count === sokoCrates));
	assert(cert.facts.play.exact_count.some(f => f.ids.join(',') === crate.key && f.count === sokoCrates));
});

test('exact counts need both directions: one-sided transforms give one-sided bounds', () => {
	const m = soko.model;
	const remove = classIn(certFor(soko, '[ Wall ] -> [ ]', sokoBoard), m, 'wall');
	assert.deepStrictEqual([remove.candidates.min, remove.candidates.max, remove.candidates.exact_count], [0, sokoWalls, null]);
	const fill = classIn(certFor(soko, '[ ' + FREE + ' ] -> [ Wall ]', sokoBoard), m, 'wall');
	assert.deepStrictEqual([fill.candidates.min, fill.candidates.max, fill.candidates.exact_count], [sokoWalls, null, null]);
});

test('a choose statement adds at most its count', () => {
	const m = soko.model, crate = cert => classIn(cert, m, 'crate').candidates;
	const one = crate(certFor(soko, 'choose 1 [ ' + FREE + ' ] -> [ Crate ]', sokoBoard));
	assert.deepStrictEqual([one.min, one.max], [sokoCrates, sokoCrates + 1]);
	const range = crate(certFor(soko, 'choose 2-3 [ ' + FREE + ' ] -> [ Crate ]', sokoBoard));
	assert.deepStrictEqual([range.min, range.max], [sokoCrates, sokoCrates + 3], 'the top of a range bounds it');
	const option = crate(certFor(soko, 'choose 2 option 0.5 [ Crate ] -> [ ]', sokoBoard));
	assert.deepStrictEqual([option.min, option.max], [Math.max(0, sokoCrates - 2), sokoCrates]);
	const either = crate(certFor(soko, 'choose 2 [ Crate ] -> [ ]\nor [ ' + FREE + ' ] -> [ Crate ]', sokoBoard));
	assert.deepStrictEqual([either.min, either.max], [Math.max(0, sokoCrates - 2), sokoCrates + 2], 'each iteration applies one alternative');
	const sum = crate(certFor(soko, 'choose 1 [ ' + FREE + ' ] -> [ Crate ]\nchoose 2 [ ' + FREE + ' ] -> [ Crate ]', sokoBoard));
	assert.deepStrictEqual([sum.min, sum.max], [sokoCrates, sokoCrates + 3], 'statements add up');
	const everywhere = crate(certFor(soko, '[ ' + FREE + ' ] -> [ Crate ]', sokoBoard));
	assert.deepStrictEqual([everywhere.min, everywhere.max], [sokoCrates, null], 'an everywhere rule has no bound');
	const neutral = crate(certFor(soko, '[ Crate | ' + FREE + ' ] -> [ | Crate ]', sokoBoard));
	assert.strictEqual(neutral.exact_count, sokoCrates, 'everywhere is fine when each application keeps the count');
});

test('choose bounds prove at most one where the one-step rule cannot', () => {
	const m = two.model;
	assert.strictEqual(count(m, twoBoard2, 'gem'), 0);
	const cert = certFor(two, 'choose 1 [ no Wall no Gem ] -> [ Gem ]', twoBoard2);
	const gem = classIn(cert, m, 'gem');
	assert.strictEqual(A.analyzeTransform(m, C.parseTransform('choose 1 [ no Wall no Gem ] -> [ Gem ]', m)).classes[gem.key].keeps_at_most_one, false);
	assert.strictEqual(gem.candidates.at_most_one, true);
	assert.strictEqual(gem.candidates.exactly_zero, false);
	assert.deepStrictEqual([gem.candidates.min, gem.candidates.max], [0, 1]);
	assert(cert.facts.candidates.at_most_one.some(ids => ids.join(',') === gem.key));
	const many = classIn(certFor(two, '[ no Wall no Gem ] -> [ Gem ]', twoBoard2), m, 'gem');
	assert.strictEqual(many.candidates.at_most_one, false);
	const twice = classIn(certFor(two, 'choose 2 [ no Wall no Gem ] -> [ Gem ]', twoBoard2), m, 'gem');
	assert.strictEqual(twice.candidates.at_most_one, false);
	assert.strictEqual(twice.candidates.max, 2);
});

test('pair swap: counts stay within one, but are not kept', () => {
	const m = soko.model;
	const preset = C.derivePresets(m).find(p => p.id === 'pair-target-crate');
	assert(preset, 'sokoban has a pair-swap preset');
	const cert = certFor(soko, preset.text, sokoBoard);
	for (const name of ['crate', 'target']) {
		const c = classIn(cert, m, name).candidates, start = count(m, sokoBoard, name);
		assert.strictEqual(c.exact_count, null, name + ' is not certified exact');
		assert.deepStrictEqual([c.min, c.max], [start - 1, start + 1], name + ' range');
	}
	// The second statement can fail: put a crate on a target and lock every
	// other tile. Removing that target and another crate leaves one free tile,
	// and the pair needs two.
	const b = C.cloneBoard(sokoBoard);
	const has = (t, n) => C.hasBit(b.cells, t, m.names[n].ids[0], m.stride);
	let onTarget = false;
	for (let t = 0; t < b.w * b.h && !onTarget; t++) if (has(t, 'target') && has(t, 'crate')) onTarget = true;
	for (let t = 0; t < b.w * b.h && !onTarget; t++) {
		if (has(t, 'target') && !has(t, 'wall') && !has(t, 'player')) { C.placeObject(m, b.cells, t, m.names.crate.ids[0]); onTarget = true; }
	}
	assert(onTarget);
	const frozen = new Uint8Array(b.w * b.h);
	for (let t = 0; t < b.w * b.h; t++) frozen[t] = has(t, 'target') || has(t, 'crate') ? 0 : 1;
	const prog = C.parseTransform(preset.text, m), rng = C.makeRng(99);
	const crates = count(m, b, 'crate'), bcert = A.sessionCertificate(m, [prog], b, {});
	let lost = 0;
	for (let i = 0; i < 200; i++) {
		const out = C.runTransform(m, prog, b, frozen, rng);
		const n = count(m, out, 'crate');
		assert(n >= crates - 1 && n <= crates + 1);
		assert.deepStrictEqual(A.checkBoard(m, bcert, out), []);
		if (n === crates - 1) lost++;
	}
	assert(lost > 0, 'the preset really can lose a pair');
});

test('an atomic pair move keeps exact counts', () => {
	const m = soko.model, free = 'no Target ' + FREE;
	const cert = certFor(soko, 'choose 3 [ Crate ] [ Target ] [ ' + free + ' ] [ ' + free + ' ] -> [ ] [ ] [ Crate ] [ Target ]', sokoBoard);
	assert.strictEqual(classIn(cert, m, 'crate').candidates.exact_count, sokoCrates);
	assert.strictEqual(classIn(cert, m, 'target').candidates.exact_count, sokoTargets);
});

test('adaptive scaling widens choose bounds', () => {
	const m = soko.model, text = 'choose 2 [ ' + FREE + ' ] -> [ Crate ]';
	assert.strictEqual(classIn(certFor(soko, text, sokoBoard), m, 'crate').candidates.max, sokoCrates + 2);
	assert.strictEqual(classIn(certFor(soko, text, sokoBoard, { chooseScale: 2 }), m, 'crate').candidates.max, sokoCrates + 4);
	assert.strictEqual(classIn(certFor(soko, 'choose 3 [ ' + FREE + ' ] -> [ Crate ]', sokoBoard, { chooseScale: 0.5 }), m, 'crate').candidates.max, sokoCrates + 3,
		'scales below one never shrink the bound');
});

test('repeated transforms (elite parents) keep only one-step facts', () => {
	const m = soko.model;
	const cert = certFor(soko, 'choose 1 [ ' + FREE + ' ] -> [ Crate ]\nchoose 2 [ Player | ' + FREE + ' ] -> [ | Player ]', sokoBoard, { repeated: true });
	const crate = classIn(cert, m, 'crate').candidates;
	assert.deepStrictEqual([crate.min, crate.max], [sokoCrates, null], 'repeated adds have no bound');
	assert.strictEqual(classIn(cert, m, 'target').candidates.exact_count, sokoTargets);
	assert.strictEqual(cert.classes.find(c => c.isPlayer).candidates.exactly_one, true);
});

test('Auto: ranges cover every transform', () => {
	const m = soko.model;
	const crate = classIn(certFor(soko, ['choose 1 [ ' + FREE + ' ] -> [ Crate ]', 'choose 2 [ Crate ] -> [ ]'], sokoBoard), m, 'crate').candidates;
	assert.deepStrictEqual([crate.min, crate.max], [Math.max(0, sokoCrates - 2), sokoCrates + 1]);
	const both = classIn(certFor(soko, ['[ Crate | ' + FREE + ' ] -> [ | Crate ]', 'choose 2 [ Crate | ' + FREE + ' ] -> [ | Crate ]'], sokoBoard), m, 'crate');
	assert.strictEqual(both.candidates.exact_count, sokoCrates);
});

test('checkBoard enforces count ranges', () => {
	const m = soko.model;
	const cert = certFor(soko, 'choose 1 [ ' + FREE + ' ] -> [ Crate ]', sokoBoard);
	const free = [];
	for (let t = 0; t < sokoBoard.w * sokoBoard.h; t++) {
		if (!['wall', 'crate', 'player'].some(n => C.hasBit(sokoBoard.cells, t, m.names[n].ids[0], m.stride))) free.push(t);
	}
	const one = C.cloneBoard(sokoBoard);
	C.placeObject(m, one.cells, free[0], m.names.crate.ids[0]);
	assert.deepStrictEqual(A.checkBoard(m, cert, one), []);
	const two_ = C.cloneBoard(one);
	C.placeObject(m, two_.cells, free[1], m.names.crate.ids[0]);
	assert(A.checkBoard(m, cert, two_).some(v => /crate/i.test(v) && /at most/.test(v)), 'two extra crates break the bound');
	const fewer = C.cloneBoard(sokoBoard);
	for (let t = 0; t < fewer.w * fewer.h; t++) if (C.hasBit(fewer.cells, t, m.names.crate.ids[0], m.stride)) { C.clearBit(fewer.cells, t, m.names.crate.ids[0], m.stride); break; }
	assert(A.checkBoard(m, cert, fewer).some(v => /crate/i.test(v) && /at least/.test(v)), 'a missing crate breaks the bound');
});

test('play ranges follow the rules', () => {
	const m = soko.model, text = 'choose 1 [ ' + FREE + ' ] -> [ Crate ]';
	const grows = classIn(certFor(soko, text, sokoBoard, { ruleQuantity: { objects: { crate: [false, true] }, properties: [] } }), m, 'crate');
	assert.deepStrictEqual([grows.play.min, grows.play.max], [sokoCrates, null]);
	const shrinks = classIn(certFor(soko, text, sokoBoard, { ruleQuantity: { objects: { crate: [true, false] }, properties: [] } }), m, 'crate');
	assert.deepStrictEqual([shrinks.play.min, shrinks.play.max], [0, sokoCrates + 1]);
	assert.strictEqual(shrinks.play.at_most_one, false);
	const unknown = classIn(certFor(soko, text, sokoBoard), m, 'crate');
	assert.strictEqual(unknown.play, null);
});

test('facts list bounded counts for consumers', () => {
	const m = soko.model;
	const cert = certFor(soko, 'choose 1 [ ' + FREE + ' ] -> [ Crate ]\n[ Wall ] -> [ ]', sokoBoard);
	const entry = name => cert.facts.candidates.counts.find(f => f.ids.join(',') === keyOf(m, name));
	assert.deepStrictEqual(entry('crate'), { ids: idsOf(m, 'crate'), min: sokoCrates, max: sokoCrates + 1 });
	assert.deepStrictEqual(entry('wall'), { ids: idsOf(m, 'wall'), min: 0, max: sokoWalls });
	assert(!cert.facts.candidates.exact_count.some(f => f.ids.join(',') === keyOf(m, 'crate')));
	const fill = A.sessionCertificate(m, [C.parseTransform('[ ' + FREE + ' ] -> [ Wall ]', m)], sokoBoard, {});
	assert.deepStrictEqual(fill.facts.candidates.counts.find(f => f.ids.join(',') === keyOf(m, 'wall')), { ids: idsOf(m, 'wall'), min: sokoWalls, max: null });
	assert.notStrictEqual(A.gate(m, cert), null, 'bounds alone make a gate');
});

test('run ranges per transform', () => {
	const m = soko.model, key = keyOf(m, 'crate');
	const a = A.analyzeTransform(m, C.parseTransform('choose 2-4 [ ' + FREE + ' ] -> [ Crate ]\n[ Crate | ' + FREE + ' ] -> [ | Crate ]\nchoose 1 option 0.5 [ Crate ] -> [ ]', m));
	assert.deepStrictEqual(a.classes[key].run, { min: -1, max: 4 });
	const b = A.analyzeTransform(m, C.parseTransform('[ Crate ] -> [ ]', m));
	assert.deepStrictEqual(b.classes[key].run, { min: -Infinity, max: 0 });
	const scaled = A.analyzeTransform(m, C.parseTransform('choose 3 [ ' + FREE + ' ] -> [ Crate ]', m), { chooseScale: 2 });
	assert.deepStrictEqual(scaled.classes[key].run, { min: 0, max: 6 });
	const never = A.analyzeTransform(m, C.parseTransform('choose 5 [ Wall Crate ] -> [ ]', m));
	assert.deepStrictEqual(never.classes[key].run, { min: 0, max: 0 }, 'an alternative that can never match changes nothing');
});

/////////////////////////////////////////////////////////////////////
// Fuzz: every candidate passes its session certificate
/////////////////////////////////////////////////////////////////////

// Random transforms mixing every statement form: everywhere, choose N,
// choose a-b, option probabilities and 'or' alternatives.
function randomTransform(rng, rules) {
	const pick = list => list[Math.floor(rng() * list.length)];
	const lines = [];
	const n = 1 + Math.floor(rng() * 3);
	for (let i = 0; i < n; i++) {
		const r = rng();
		const head = r < 0.25 ? '' : r < 0.6 ? 'choose ' + (1 + Math.floor(rng() * 4)) + ' ' : 'choose ' + Math.floor(rng() * 3) + '-' + (1 + Math.floor(rng() * 4)) + ' ';
		const alt = () => (rng() < 0.3 ? 'option ' + (0.2 + 0.2 * Math.floor(rng() * 4)).toFixed(1) + ' ' : '') + pick(rules);
		let line = head + alt();
		if (head && rng() < 0.35) line += ' or ' + alt();
		lines.push(line);
		if (rng() < 0.25) lines.push('or ' + alt());
	}
	return lines.join('\n');
}
const FUZZ_POOLS = [
	[soko, () => [sokoBoard, soko.model.levels.filter(l => l.board)[1].board], [
		'[ Player | no Wall ] -> [ | Player ]', '[ Player | no Wall no Crate ] -> [ | Player ]', '[ no Wall ] -> [ Player ]',
		'[ no Wall ] -> [ Crate ]', '[ no Wall no Player ] -> [ Crate ]', '[ Crate | Player ] -> [ Player | Crate ]',
		'[ Crate ] [ Target ] -> [ ] [ ]', '[ Target no Crate ] -> [ Target Crate ]', '[ Wall ] -> [ Player ]',
		'[ Player ] -> [ Crate ]', '[ Player | Crate ] -> [ Crate | Player ]', '[ no Player | Player ] -> [ Player | ]',
		'[ Crate no Target ] -> [ Target ]', '[ Wall | no Wall ] -> [ | Wall ]', '[ Crate ] -> [ ]', '[ Wall ] -> [ ]',
		'[ no Target ' + FREE + ' ] -> [ Target ]', '[ ' + FREE + ' ] -> [ Crate ]', '[ Crate | ' + FREE + ' ] -> [ | Crate ]',
		'[ Crate ] [ Target ] [ no Target ' + FREE + ' ] [ no Target ' + FREE + ' ] -> [ ] [ ] [ Crate ] [ Target ]',
	]],
	[two, () => [twoBoard, twoBoard2], [
		'[ PlayerL ] -> [ PlayerR ]', '[ Player ] -> [ Player Gem ]', '[ Player | no Wall ] -> [ | PlayerL ]',
		'[ Gem | no Gem ] -> [ | Gem ]', '[ no Wall ] -> [ Gem ]', '[ Gem ] -> [ ]', '[ PlayerL | no Player ] -> [ PlayerL | PlayerL ]',
		'[ Player no Gem ] -> [ Player Gem ]', '[ no Player | PlayerL ] -> [ PlayerL | ]', '[ Crate ] -> [ PlayerR ]',
		'[ PlayerR | no Wall no Crate no Player ] -> [ | PlayerR ]', '[ no Gem ] [ Gem ] -> [ Gem ] [ ]', '[ no Wall no Gem ] -> [ Gem ]',
	]],
];
function randomFrozen(rng, board) {
	if (rng() < 0.5) return null;
	const f = new Uint8Array(board.w * board.h);
	for (let t = 0; t < f.length; t++) f[t] = rng() < 0.3 ? 1 : 0;
	return f;
}
// The generator's step-size arms (mis_generator.js scaleProgram).
function scaleProgram(prog, scale) {
	return { errors: prog.errors, statements: prog.statements.map(st => {
		if (!st.choose) return st;
		const lo = Math.max(1, Math.round(st.choose[0] * scale));
		return Object.assign({}, st, { choose: [lo, Math.max(lo, Math.round(st.choose[1] * scale))] });
	}) };
}

test('fuzz: every candidate from the start board passes the certificate', () => {
	const rng = C.makeRng(2024);
	let boards = 0, bounded = 0;
	for (const [g, getBoards, rules] of FUZZ_POOLS) {
		const m = g.model;
		for (let trial = 0; trial < 150; trial++) {
			const text = randomTransform(rng, rules), prog = C.parseTransform(text, m);
			assert.deepStrictEqual(prog.errors, [], text);
			const analysis = A.analyzeTransform(m, prog);
			for (const base of getBoards()) {
				const cert = A.sessionCertificate(m, [prog], base, {});
				bounded += cert.facts.candidates.counts.length;
				for (let run = 0; run < 8; run++) {
					const out = C.runTransform(m, prog, base, randomFrozen(rng, base), rng);
					boards++;
					assert.deepStrictEqual(A.checkBoard(m, cert, out), [], text);
					for (const c of cert.classes) {
						const r = analysis.classes[c.key].run;
						const d = c.ids.reduce((s, id) => s + countId(m, out, id) - countId(m, base, id), 0);
						assert(d >= r.min && d <= r.max, 'run range ' + c.name + ' ' + d + ' not in [' + r.min + ', ' + r.max + ']: ' + text);
					}
				}
			}
		}
	}
	assert(boards > 4000 && bounded > 1000, boards + ' boards, ' + bounded + ' bounded classes');
});

test('fuzz: chained candidates pass a repeated-mode certificate', () => {
	const rng = C.makeRng(77);
	let boards = 0, bounded = 0;
	for (const [g, getBoards, rules] of FUZZ_POOLS) {
		const m = g.model;
		for (let trial = 0; trial < 80; trial++) {
			const text = randomTransform(rng, rules), prog = C.parseTransform(text, m);
			for (const base of getBoards()) {
				const cert = A.sessionCertificate(m, [prog], base, { repeated: true });
				bounded += cert.facts.candidates.counts.filter(f => f.max !== null).length;
				let parent = base;
				for (let run = 0; run < 12; run++) {
					const out = C.runTransform(m, prog, parent, null, rng);
					boards++;
					assert.deepStrictEqual(A.checkBoard(m, cert, out), [], text + ' (generation ' + run + ')');
					parent = rng() < 0.7 ? out : base;
				}
			}
		}
	}
	assert(boards > 2000 && bounded > 500, boards + ' boards, ' + bounded + ' upper bounds');
});

test('fuzz: scaled step sizes stay inside a chooseScale certificate', () => {
	const rng = C.makeRng(31337);
	let boards = 0, choosey = 0;
	for (const [g, getBoards, rules] of FUZZ_POOLS) {
		const m = g.model;
		for (let trial = 0; trial < 80; trial++) {
			const text = randomTransform(rng, rules), prog = C.parseTransform(text, m);
			for (const base of getBoards()) {
				const cert = A.sessionCertificate(m, [prog], base, { chooseScale: MISGenerator.MAX_CHOOSE_SCALE });
				const plain = A.sessionCertificate(m, [prog], base, {});
				// Classes whose bound the scaling widens: the case this test is about.
				choosey += cert.classes.filter((c, i) => c.candidates.max !== plain.classes[i].candidates.max).length;
				for (const scale of [0.125, 0.25, 0.5, 1, 2]) {
					const out = C.runTransform(m, scaleProgram(prog, scale), base, null, rng);
					boards++;
					assert.deepStrictEqual(A.checkBoard(m, cert, out), [], text + ' at scale ' + scale);
				}
			}
		}
	}
	assert(boards > 1000 && choosey > 100, boards + ' boards, ' + choosey + ' widened bounds');
});

console.log('\n' + passed + ' passed');
