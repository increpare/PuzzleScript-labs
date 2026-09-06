'use strict';

const assert = require('assert');
const { analyzeSource } = require('./ps_static_analysis');
const { FUTURE_OBJECT_FACT_FAMILIES, createFutureObjectAnalyzer, createRuntimeObjectCounter,
    createFutureObjectSession, getFutureObjectSession } = require('./lib/future_object_universe');

function source(rules, wins = 'some Prize', extra = '', legend = '', layers = 'Player\nSeed\nPrize\nMarker') {
    return `title Future universe\n${extra}\nobjects\nBackground\nblack\n\nPlayer\nwhite\n\nSeed\ngreen\n\nPrize\nyellow\n\nMarker\nred\n\nlegend\n. = Background\nP = Player\nS = Seed\nT = Prize\nM = Marker\n${legend}\nsounds\ncollisionlayers\nBackground\n${layers}\nrules\n${rules}\nwinconditions\n${wins}\nlevels\nPS.M\n`;
}

function model(text, options) {
    const report = analyzeSource(text);
    assert.strictEqual(report.status, 'ok', JSON.stringify(report.diagnostics));
    return createFutureObjectAnalyzer(report, options);
}

const chain = model(source('[ Seed ] -> [ Prize ]\n[ action Player ] -> [ Player ]'));
assert(chain.inspect({ Player: 1, Seed: 1 }).possible_objects.includes('Prize'));
const gone = chain.inspect({ Player: 1 });
assert(gone.impossible_objects.includes('Prize'));
assert(gone.prevents_completion);
assert(gone.disabled_rule_ids.length > 0);
assert(gone.single_player_certified);
assert(!chain.inspect({ Player: 2 }).single_player_certified);
assert(!chain.inspect({}).single_player_certified);
const unconditional = model(source('[ no Prize ] -> [ Prize ]'));
assert(!unconditional.inspect({ Player: 1 }).prevents_completion, 'absence-triggered spawn remains possible');
const alternate = model(source('[ Seed ] -> [ Prize ]\n[ Player ] -> win'));
assert(!alternate.inspect({ Player: 1 }).prevents_completion, 'explicit win bypasses formal goal');
const unreachableWin = model(source('[ Seed ] -> win'));
assert(unreachableWin.inspect({ Player: 1 }).prevents_completion, 'impossible explicit win does not mask dead end');
const restart = model(source('[ Player ] -> restart'));
assert.strictEqual(restart.inspect({ Player: 1 }).status, 'unsupported');
assert(!restart.inspect({ Player: 1 }).prevents_completion);
assert.strictEqual(model(source('[ Player ] -> checkpoint')).inspect({}).status, 'unsupported');
const collected = model(source('[ Player Seed ] -> [ Player ]', 'no Seed'));
assert.deepStrictEqual(collected.inspect({ Player: 1, Seed: 2 }).necessary_extinctions, ['Seed']);
assert(!collected.inspect({ Player: 1 }).prevents_completion);
const renewable = model(source('[ Player Seed ] -> [ Player ]\n[ Marker no Seed ] -> [ Marker Seed ]', 'no Seed'));
assert.deepStrictEqual(renewable.inspect({ Seed: 1 }).goal_requires_absence, ['Seed']);
assert.deepStrictEqual(renewable.inspect({ Seed: 1 }).necessary_extinctions, [], 'required absence is not required permanent loss');
const all = model(source('[ Player Seed ] -> [ Player ]', 'all Seed on Prize'));
assert(!all.inspect({ Seed: 1 }).prevents_completion, 'ALL can be won by removing its source');
assert(!all.inspect({}).prevents_completion, 'ALL is vacuous with no source');
const persistentAll = model(source('', 'all Seed on Prize'));
assert(persistentAll.inspect({ Seed: 1 }).prevents_completion);
const any = model(source('', 'some Either', '', 'Either = Seed or Prize'));
assert(!any.inspect({ Seed: 1 }).prevents_completion);
const aggregate = model(source('', 'some Both', '', 'Both = Seed and Prize'));
assert(aggregate.inspect({ Seed: 1 }).prevents_completion);
assert(!aggregate.inspect({ Seed: 1, Prize: 1 }).prevents_completion, 'co-location is unknown, not impossible');
const noAggregate = model(source('', 'no Both', '', 'Both = Seed and Prize'));
assert(!noAggregate.inspect({ Seed: 1, Prize: 1 }).prevents_completion, 'positive counts do not imply aggregate presence');
assert.deepStrictEqual(noAggregate.inspect({ Seed: 1, Prize: 1 }).necessary_extinctions, []);
const allTypesAggregate = model(source('', 'no Player on Everything', '',
    'Everything = Background and Player and Seed and Prize and Marker'));
assert(!allTypesAggregate.inspect({ Player: 1 }).prevents_completion,
    'an all-types aggregate target must not be mistaken for a bare NO condition');
const overwrite = model(source('[ Seed ] -> [ Prize ]', 'some Prize', '', '', 'Player\nSeed, Prize\nMarker'));
assert(overwrite.inspect({ Seed: 1 }).possible_objects.includes('Prize'));
const playerForms = source('[ Player ] -> [ Seed ]\n[ Seed ] -> [ Player ]', 'some Prize')
    .replace('Player\nwhite', 'Hero\nwhite').replaceAll('[ Player ]', '[ Hero ]')
    .replace('P = Player', 'P = Hero\nPlayer = Hero or Seed').replace('Background\nPlayer\nSeed\nPrize', 'Background\nHero, Seed\nPrize');
assert(model(playerForms).inspect({ Hero: 1 }).single_player_certified, 'player property sum conservation');
assert.throws(() => chain.inspect({ Unknown: 1 }), /Invalid/);
assert.throws(() => chain.inspect({ Player: -1 }), /Invalid/);
const cached = model(source('', 'no Seed'), { cacheLimit: 1 });
cached.inspect({ Seed: 1 });
cached.inspect({ Seed: 4 });
assert.strictEqual(cached.counters.closures, 1);
cached.inspect({});
assert(cached.inspect({ Seed: 4 }).prevents_completion);
assert.strictEqual(cached.counters.closures, 3, 'eviction never changes results');
const countWide = createRuntimeObjectCounter({ ps_tagged: { objects: ['A', 'B', 'C', 'D']
    .map(name => ({ name, canonical_name: name.toLowerCase() })) } },
    { objects: { a: { id: 31 }, b: { id: 32 }, c: { id: 63 }, d: { id: 96 } } });
assert.deepStrictEqual(countWide(new Int32Array([-2147483648, -2147483647, 0, 1, 0, 1, 0, 0]), 4),
    { A: 1, B: 2, C: 1, D: 1 }, 'occupied-bit counting handles signed high bits and multiple words');

const sharedReport = analyzeSource(source('[ Seed ] -> [ Prize ]'), { familyFilter: FUTURE_OBJECT_FACT_FAMILIES });
assert.deepStrictEqual(Object.keys(sharedReport.facts), FUTURE_OBJECT_FACT_FAMILIES,
    'consumer requests ruleset facts without per-level or unrelated flow analysis');
const runtime = { objects: Object.fromEntries(sharedReport.ps_tagged.objects.map((o, id) => [o.canonical_name, { id }])) };
const bit = name => 1 << runtime.objects[name.toLowerCase()].id;
const session = getFutureObjectSession(sharedReport, runtime);
assert.strictEqual(getFutureObjectSession(sharedReport, runtime), session, 'same compiled ruleset owns one session');
const one = new Int32Array([bit('Player') | bit('Seed')]);
const two = new Int32Array([bit('Player'), bit('Player'), bit('Seed'), bit('Seed')]);
assert(session.certifyPlayer(one, 1).single_player_certified);
assert.strictEqual(session.certifyPlayer(two, 1).player_count, 2);
assert(!session.certifyPlayer(two, 1).single_player_certified);
assert(!session.certifyPlayer(new Int32Array([bit('Seed')]), 1).single_player_certified);
assert.strictEqual(session.analyzer.counters.queries, 0, 'player certificate never runs a future-object query');
assert(!session.preventsCompletion(one, 1));
assert(!session.preventsCompletion(two, 1));
assert.strictEqual(session.counters.cache_hits, 1, 'different dimensions/counts share presence verdicts');
assert.strictEqual(session.analyzer.counters.queries, 1);
assert(session.preventsCompletion(new Int32Array([bit('Player')]), 1));
assert(!session.preventsCompletion(one, 1), 'restoring an earlier population does not inherit later deadness');
assert.throws(() => session.preventsCompletion(new Int32Array([1 << 29]), 1), /unanalysed/);
const remappedRuntime = { objects: Object.fromEntries(sharedReport.ps_tagged.objects.map((o, id) => [o.canonical_name, { id: 96 - id }])) };
const remapped = getFutureObjectSession(sharedReport, remappedRuntime);
assert.notStrictEqual(remapped, session, 'different compiled ID layouts have distinct presence caches');
assert.strictEqual(remapped.analyzer, session.analyzer, 'ID rebinding reuses the name-based ruleset proof');
const wideBoard = new Int32Array(4);
for (const name of ['player', 'seed']) {
    const id = remappedRuntime.objects[name].id;
    wideBoard[id >>> 5] |= 1 << (id & 31);
}
assert(!remapped.preventsCompletion(wideBoard, 4));
assert(remapped.certifyPlayer(wideBoard, 4).single_player_certified);
const fresh = createFutureObjectSession(sharedReport, runtime, { cacheLimit: 1 });
for (const board of [one, two, new Int32Array([bit('Player')]), one]) {
    assert.strictEqual(fresh.preventsCompletion(board, 1), session.preventsCompletion(board, 1));
}
assert.strictEqual(fresh.counters.cache_misses, 3, 'bounded eviction preserves answers');
assert.notStrictEqual(getFutureObjectSession(analyzeSource(source('', 'no Seed')), runtime).analyzer,
    session.analyzer, 'recompilation / changed goals cannot inherit cached proofs');
assert(createFutureObjectAnalyzer(analyzeSource(playerForms, { familyFilter: FUTURE_OBJECT_FACT_FAMILIES }))
    .certifyPlayerCount(1).single_player_certified, 'filtered ruleset analysis preserves player-form sum proofs');

module.exports = { source };
console.log('future_object_universe_node: ok');
