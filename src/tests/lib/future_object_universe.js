'use strict';

const {
    compileObjectUniversePlan, closeObjectUniverse,
    ruleRequirementsReachable, playerObjectNameSet,
} = require('../ps_static_analysis');

// A state-conditioned certificate for forward, stable-boundary search in one
// level. This does not approximate the board used by the engine: it proves a
// superset of types that any future board may contain. Once the superset
// shrinks, whole creation chains and their dependent rules become impossible.
// Reset/checkpoint games fail closed until restored-state roots are modelled.
function createFutureObjectAnalyzer(report, { cacheLimit = 256 } = {}) {
    if (!report || report.status !== 'ok' || !report.ps_tagged) {
        throw new Error('Future-object analysis requires a successful full static report');
    }
    const tagged = report.ps_tagged;
    const rules = compileObjectUniversePlan(tagged);
    const objects = tagged.objects;
    const names = objects.map(o => o.name);
    const known = new Set(names);
    const blockers = [...new Set(rules.flatMap(r => r.commands)
        .filter(c => c === 'restart' || c === 'checkpoint'))].sort();
    const quantity = new Map(objects.map(o => [o.name, o.tags.quantity || {}]));
    const players = [...playerObjectNameSet(tagged)].sort();
    const sums = (report.facts.linear_count_invariants || [])
        .filter(f => f.status === 'proved').map(f => f.value.objects);
    const playerCountConserved = players.length > 0 && (
        players.every(n => quantity.get(n).never_increases && quantity.get(n).never_decreases)
        || sums.some(s => s.length === players.length && s.every(n => players.includes(n)))
    );
    const cache = new Map();
    const counters = { queries: 0, closures: 0, cache_hits: 0 };

    function universe(counts) {
        const present = names.filter(n => (counts[n] || 0) > 0);
        const key = JSON.stringify(present);
        const cached = cache.get(key);
        if (cached) {
            counters.cache_hits++;
            return cached;
        }
        counters.closures++;
        const reachable = blockers.length ? new Set(names)
            : closeObjectUniverse(rules, present).reachableObjects;
        const availableRules = rules.filter(r => ruleRequirementsReachable(r.requirements, reachable));
        const out = {
            possible_objects: names.filter(n => reachable.has(n)),
            impossible_objects: names.filter(n => !reachable.has(n)),
            disabled_rule_ids: rules.filter(r => r.active && !ruleRequirementsReachable(r.requirements, reachable)).map(r => r.id),
            possible_explicit_win: availableRules.some(r => r.commands.includes('win')),
            reachable,
        };
        // Presence determines the relaxed closure, so share it across boards
        // with different geometry/counts. Goal lower bounds are evaluated below
        // per query: caching those by presence would be incorrect. Bound retained
        // closures; eviction changes cost only, never the certificate.
        if (cacheLimit > 0) {
            if (cache.size >= cacheLimit) cache.delete(cache.keys().next().value);
            cache.set(key, out);
        }
        return out;
    }

    function inspect(counts) {
        counters.queries++;
        for (const [name, count] of Object.entries(counts)) {
            if (!known.has(name) || !Number.isInteger(count) || count < 0) {
                throw new Error(`Invalid future-object count: ${name}=${count}`);
            }
        }
        const u = universe(counts);
        const filterPossible = (ns, aggregate) => aggregate
            ? ns.every(n => u.reachable.has(n)) : ns.some(n => u.reachable.has(n));
        // Positive per-type counts imply an ANY filter exists somewhere, but
        // do not imply that aggregate members coexist on one cell.
        const filterPersists = (ns, aggregate) => (!aggregate || ns.length === 1)
            && ns.some(n => (counts[n] || 0) > 0 && quantity.get(n).never_decreases);
        const impossibleConditions = [];
        const requiredAbsences = new Set();
        if (!blockers.length) for (const win of tagged.winconditions) {
            const sourcePossible = filterPossible(win.subjects, win.aggregate_subjects);
            const targetPossible = win.tags.plain || filterPossible(win.targets, win.aggregate_targets);
            if (win.quantifier === 0 && (!sourcePossible || !targetPossible)) {
                impossibleConditions.push({ win: win.id, reason: 'some_filter_permanently_unavailable' });
            }
            if (win.quantifier === 1 && !targetPossible) {
                if (filterPersists(win.subjects, win.aggregate_subjects)) {
                    impossibleConditions.push({ win: win.id, reason: 'all_source_persists_without_possible_target' });
                }
                if (!win.aggregate_subjects || win.subjects.length === 1) {
                    win.subjects.forEach(n => requiredAbsences.add(n));
                }
            }
            if (win.quantifier === -1 && win.tags.plain) {
                if (filterPersists(win.subjects, win.aggregate_subjects)) {
                    impossibleConditions.push({ win: win.id, reason: 'no_source_count_cannot_decrease' });
                }
                if (!win.aggregate_subjects || win.subjects.length === 1) {
                    win.subjects.forEach(n => requiredAbsences.add(n));
                }
            }
        }
        const playerCount = players.reduce((n, p) => n + (counts[p] || 0), 0);
        return {
            status: blockers.length ? 'unsupported' : 'proved',
            scope: 'forward_same_level_stable_boundaries_without_external_reset',
            blockers: blockers.slice(),
            possible_objects: u.possible_objects.slice(),
            impossible_objects: u.impossible_objects.slice(),
            disabled_rule_ids: u.disabled_rule_ids.slice(),
            possible_explicit_win: u.possible_explicit_win,
            impossible_conditions: impossibleConditions,
            prevents_completion: !blockers.length && !u.possible_explicit_win && impossibleConditions.length > 0,
            // Required absence alone is not proof that the ability to recreate
            // the type must disappear. Only a non-increasing type turns this
            // into a necessary irreversible extinction on every winning route.
            goal_requires_absence: u.possible_explicit_win ? [] : [...requiredAbsences].sort(),
            necessary_extinctions: u.possible_explicit_win ? [] : [...requiredAbsences]
                .filter(n => (counts[n] || 0) > 0 && quantity.get(n).never_increases).sort(),
            player_count: playerCount,
            player_count_conserved: playerCountConserved,
            single_player_certified: !blockers.length && playerCountConserved && playerCount === 1,
        };
    }

    return { inspect, counters, players, names, blockers };
}

// Match by canonical names, not object IDs: semantic compilation and runtime
// compilation need not assign identical IDs. Count object instances rather
// than player-occupied cells, so overlapping multi-player aggregates cannot
// accidentally receive an exactly-one-player certificate.
function createRuntimeObjectCounter(report, runtimeState) {
    const entries = report.ps_tagged.objects.map(o => {
        const runtime = runtimeState.objects[o.canonical_name];
        if (!runtime) throw new Error(`Missing runtime object ${o.canonical_name}`);
        return { name: o.name, word: runtime.id >>> 5, bit: 1 << (runtime.id & 31) };
    });
    const byId = new Map(entries.map(e => [e.word * 32 + (31 - Math.clz32(e.bit)), e.name]));
    return function countObjects(board, stride) {
        if (!Number.isInteger(stride) || stride <= 0 || board.length % stride !== 0) {
            throw new Error('Invalid board stride for future-object analysis');
        }
        const counts = Object.fromEntries(entries.map(e => [e.name, 0]));
        for (let offset = 0; offset < board.length; offset += stride) {
            // Visit occupied bits, not every declared object type on every
            // tile. Most tiles have only a few layers occupied even in games
            // with hundreds of types; this keeps observation cost proportional
            // to the actual board population plus its word stride.
            for (let word = 0; word < stride; word++) {
                let bits = board[offset + word] | 0;
                while (bits) {
                    const bit = bits & -bits;
                    const name = byId.get(word * 32 + 31 - Math.clz32(bit));
                    if (name === undefined) throw new Error('Runtime board contains an unanalysed object');
                    counts[name]++;
                    bits &= bits - 1;
                }
            }
        }
        return counts;
    };
}

module.exports = { createFutureObjectAnalyzer, createRuntimeObjectCounter };
