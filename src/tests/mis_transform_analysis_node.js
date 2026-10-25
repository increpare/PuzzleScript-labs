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
const TWO_PLAYERS = `title two players
========
OBJECTS
========
Background
black
Target
blue
Wall
grey
PlayerL
white
PlayerR
yellow
Crate
orange
Gem
green
=======
LEGEND
=======
. = Background
# = Wall
L = PlayerL
R = PlayerR
* = Crate
O = Target
G = Gem
Player = PlayerL or PlayerR
=======
SOUNDS
=======
================
COLLISIONLAYERS
================
Background
Target
PlayerL, PlayerR, Wall, Crate
Gem
======
RULES
======
[ > Player | Crate ] -> [ > Player | > Crate ]
[ left PlayerR ] -> [ left PlayerL ]
[ right PlayerL ] -> [ right PlayerR ]
==============
WINCONDITIONS
==============
All Target on Crate
=======
LEVELS
=======
#######
#.L.*O#
#..G..#
#.*..O#
#######

#######
#L..*O#
#.R...#
#######
`;

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

console.log('\n' + passed + ' passed');
