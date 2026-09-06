#!/usr/bin/env node
'use strict';

// Bounded exploration observes the original solver transitions without pruning.
// Cached solutions provide a separate sample of successful play. Neither sample
// is presented as an unbiased frequency estimate of all possible game states.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { analyzeFile, discoverInputFiles } = require('./ps_static_analysis');
const { createFutureObjectAnalyzer, createRuntimeObjectCounter } = require('./lib/future_object_universe');
const solver = require('./run_solver_tests_js');
const internals = solver.__solverSearchInternals;

function optionsFromArgs(args) {
    const options = { roots: ['src/tests/solver_tests', 'src/tests/good_games', 'src/demo'], out: 'build/future-universe-survey.json', shard: 0, shards: 1, maxExpanded: 64, walkLength: 40, levelBudgetMs: 0, game: '' };
    for (let i = 0; i < args.length; i++) {
        const key = args[i];
        if (key === '--out') options.out = args[++i];
        else if (key === '--roots') options.roots = args[++i].split(',');
        else if (key === '--shard') options.shard = Number(args[++i]);
        else if (key === '--shards') options.shards = Number(args[++i]);
        else if (key === '--max-expanded') options.maxExpanded = Number(args[++i]);
        else if (key === '--walk-length') options.walkLength = Number(args[++i]);
        else if (key === '--level-budget-ms') options.levelBudgetMs = Number(args[++i]);
        else if (key === '--game') options.game = args[++i];
        else throw new Error(`Unknown option ${key}`);
    }
    return options;
}

function sha(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function diff(a, b) { const other = new Set(b); return a.filter(n => !other.has(n)); }
function stableKey(snapshot) {
    // Exact board and control/RNG identity, not a hash-only equality test.
    return JSON.stringify([Array.from(snapshot.objects), snapshot.random, snapshot.restartTarget,
        snapshot.curlevel, snapshot.textMode, snapshot.titleScreen, snapshot.messagetext,
        snapshot.winning, snapshot.againing, snapshot.hasUsedCheckpoint]);
}

function surveyGame(file, aliases, solutions, options) {
    const report = analyzeFile(file);
    const row = { source: file, aliases, sha256: sha(fs.readFileSync(file)), status: report.status, levels: [] };
    if (report.status !== 'ok') return row;
    const analyzer = createFutureObjectAnalyzer(report);
    row.blockers = analyzer.blockers;
    const compiled = solver.compileGameFile(file);
    const count = createRuntimeObjectCounter(report, state);
    const evaluate = counts => ({ counts, fact: analyzer.inspect(counts) });
    const current = () => evaluate(count(level.objects, STRIDE_OBJ));
    const originalDoWin = DoWin;
    let winBoundary = null;
    DoWin = function observedWin() {
        if (!winBoundary) winBoundary = current();
        return originalDoWin.apply(this, arguments);
    };
    try {
        const playable = report.ps_tagged.levels.filter(l => l.kind === 'level');
        for (const template of playable) {
            const li = template.index;
            const stats = {
                level: li, status: 'ok', raw_player_count: null, settled_player_count: null,
                single_player_certified: false, initial_prevents_completion: false,
                initial_impossible_objects: [], expanded: 0, transitions: 0, bounded: false,
                channels: {}, events: [], cached_replays: [], sampled_solutions: 0,
            };
            row.levels.push(stats);
            const events = new Map();
            function observe(parent, child, channel, stage, tokens, solved = false) {
                stats.transitions++;
                const channelCounts = stats.channels[channel] ||= { transitions: 0, loss_transitions: 0, preventing_transitions: 0 };
                channelCounts.transitions++;
                if (parent.fact.status === 'proved') {
                    const outside = Object.keys(child.counts).filter(n => child.counts[n] > 0 && !parent.fact.possible_objects.includes(n));
                    if (outside.length) throw new Error(`Future-universe violation ${outside.join(',')} after ${tokens.join(',')}`);
                    if (parent.fact.prevents_completion && solved) throw new Error(`Pruned winning continuation after ${tokens.join(',')}`);
                    if (parent.fact.single_player_certified && child.fact.player_count !== 1) throw new Error('Single-player certificate violated');
                }
                const lost = diff(parent.fact.possible_objects, child.fact.possible_objects);
                const disappeared = Object.keys(parent.counts).filter(n => parent.counts[n] > 0 && !child.counts[n]);
                if (!lost.length && !disappeared.length) return null;
                if (lost.length) channelCounts.loss_transitions++;
                if (lost.length && child.fact.prevents_completion && !solved) channelCounts.preventing_transitions++;
                const goalAbsence = disappeared.filter(n => parent.fact.goal_requires_absence.includes(n));
                const necessary = lost.filter(n => parent.fact.necessary_extinctions.includes(n));
                const key = JSON.stringify([channel, stage, lost, disappeared, child.fact.prevents_completion, necessary]);
                let event = events.get(key);
                if (!event) {
                    event = { channel, stage, lost_future_types: lost, disappeared_types: disappeared,
                        newly_disabled_rules: diff(child.fact.disabled_rule_ids, parent.fact.disabled_rule_ids).length,
                        prevents_completion: !solved && child.fact.prevents_completion,
                        goal_requires_absence: goalAbsence, necessary_extinctions: necessary,
                        observed_on_winning_path: false, observations: 0, witness: tokens.slice() };
                    events.set(key, event);
                }
                event.observations++;
                return event;
            }
            function markWinning(eventsOnPath) {
                stats.sampled_solutions++;
                for (const event of eventsOnPath) if (event) {
                    if (event.prevents_completion) throw new Error('A certified dead state has a winning descendant');
                    event.observed_on_winning_path = true;
                }
            }
            function load() {
                winBoundary = null;
                const result = solver.replaySolutionOnCurrentCompiledState(compiled.game, li, []);
                if (!['not_solved', 'solved'].includes(result.status)) throw new Error(`Load failed: ${result.status}: ${result.error || ''}`);
                return { solved: result.status === 'solved', value: winBoundary || current() };
            }
            try {
                const raw = evaluate(count(state.levels[li].objects, STRIDE_OBJ));
                stats.raw_player_count = raw.fact.player_count;
                const start = load();
                stats.settled_player_count = start.value.fact.player_count;
                stats.single_player_certified = start.value.fact.single_player_certified;
                stats.initial_prevents_completion = !start.solved && start.value.fact.prevents_completion;
                stats.initial_impossible_objects = start.value.fact.impossible_objects;
                const startup = observe(raw, start.value, 'startup', 'initialization', [], start.solved);
                if (start.solved) {
                    markWinning([startup]);
                    stats.status = 'won_during_load';
                    stats.events = [...events.values()];
                    continue;
                }
                const ops = internals.createSolverLevelSpecialization();
                const actions = internals.solverActionsForGame();
                const initialSnapshot = ops.capture();
                const nodes = [{ snapshot: initialSnapshot, value: start.value, tokens: [], pathEvents: [startup] }];
                const visited = new Set([stableKey(initialSnapshot)]);
                // Default to a fixed expansion sample so corpus counts do not
                // depend on CPU contention between shards. An explicit wall
                // cap remains available for unusually expensive sources.
                const deadline = options.levelBudgetMs > 0 ? Date.now() + options.levelBudgetMs : Infinity;
                let index = 0;
                let sampledSolution = null;
                for (; index < nodes.length && index < options.maxExpanded && Date.now() < deadline; index++) {
                    const parent = nodes[index];
                    stats.expanded++;
                    for (const action of actions) {
                        ops.restore(parent.snapshot);
                        winBoundary = null;
                        const step = internals.stepSolverAction(action);
                        const child = winBoundary || current();
                        const tokens = parent.tokens.concat(action.token);
                        const event = observe(parent.value, child, 'exploration', tokens.length === 1 ? 'first_input' : 'later_input', tokens, step.solved);
                        const pathEvents = parent.pathEvents.concat(event);
                        if (step.solved) {
                            markWinning(pathEvents);
                            sampledSolution ||= tokens;
                            continue;
                        }
                        if (!step.changed) continue;
                        const snapshot = ops.capture();
                        const key = stableKey(snapshot);
                        if (visited.has(key)) continue;
                        visited.add(key);
                        nodes.push({ snapshot, value: child, tokens, pathEvents });
                    }
                }
                stats.bounded = index < nodes.length;
                // A deterministic walk complements shallow BFS. It is not a
                // solver policy and is reported separately from search/replay.
                ops.restore(initialSnapshot);
                let parent = start.value;
                let pathEvents = [startup];
                const tokens = [];
                let random = ((li + 1) * 2654435761) >>> 0;
                for (let turn = 0; turn < options.walkLength; turn++) {
                    random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
                    const action = actions[(random >>> 0) % actions.length];
                    tokens.push(action.token);
                    winBoundary = null;
                    const step = internals.stepSolverAction(action);
                    const child = winBoundary || current();
                    pathEvents.push(observe(parent, child, 'walk', turn === 0 ? 'first_input' : 'later_input', tokens, step.solved));
                    if (step.solved) { markWinning(pathEvents); sampledSolution ||= tokens.slice(); break; }
                    parent = child;
                }
                if (sampledSolution) {
                    const replay = solver.replaySolutionOnCurrentCompiledState(compiled.game, li, sampledSolution);
                    if (replay.status !== 'solved') throw new Error(`Sample solution failed ordinary replay: ${replay.status}`);
                }
                for (const solution of solutions.filter(s => s.source_level === li)) {
                    const solutionTokens = fs.readFileSync(solution.solution_path, 'utf8').trim().split(/\s+/).filter(Boolean);
                    const loaded = load();
                    let previous = loaded.value;
                    const replayEvents = [startup];
                    let solved = loaded.solved;
                    let steps = 0;
                    for (const token of solutionTokens) {
                        if (solved) break;
                        const action = actions.find(a => a.token === token);
                        if (!action) throw new Error(`Unsupported cached input ${token}`);
                        winBoundary = null;
                        const step = internals.stepSolverAction(action);
                        const child = winBoundary || current();
                        steps++;
                        replayEvents.push(observe(previous, child, 'cached_solution', steps === 1 ? 'first_input' : 'later_input', solutionTokens.slice(0, steps), step.solved));
                        previous = child;
                        solved = step.solved;
                    }
                    stats.cached_replays.push({ path: solution.solution_path, solved, steps });
                    if (!solved) throw new Error('Previously validated cached solution no longer wins');
                    markWinning(replayEvents);
                }
            } catch (error) {
                stats.status = 'error';
                stats.error = error.stack || String(error);
            }
            stats.events = [...events.values()];
        }
    } finally { DoWin = originalDoWin; }
    row.analysis_counters = { ...analyzer.counters };
    return row;
}

function summarize(rows) {
    const levels = rows.flatMap(r => r.levels || []);
    const usable = levels.filter(l => l.status !== 'error');
    const events = usable.flatMap(l => l.events || []);
    const affected = l => (l.events || []).some(e => e.lost_future_types.length);
    return {
        sources: rows.length, analyzed: rows.filter(r => r.status === 'ok').length,
        blocked_sources: rows.filter(r => r.blockers?.length).length,
        playable_levels: levels.length, level_errors: levels.filter(l => l.status === 'error').length,
        affected_games: rows.filter(r => r.levels.some(l => l.status !== 'error' && affected(l))).length,
        affected_levels: usable.filter(affected).length,
        initialization_loss_levels: usable.filter(l => l.events.some(e => e.stage === 'initialization' && e.lost_future_types.length)).length,
        first_input_loss_levels: usable.filter(l => l.events.some(e => e.stage === 'first_input' && e.lost_future_types.length)).length,
        later_input_loss_levels: usable.filter(l => l.events.some(e => e.stage === 'later_input' && e.lost_future_types.length)).length,
        preventing_loss_levels: usable.filter(l => l.events.some(e => e.lost_future_types.length && e.prevents_completion)).length,
        necessary_extinction_levels: usable.filter(l => l.events.some(e => e.necessary_extinctions.length)).length,
        loss_on_winning_path_levels: usable.filter(l => l.events.some(e => e.lost_future_types.length && e.observed_on_winning_path)).length,
        initially_impossible_levels: usable.filter(l => l.initial_prevents_completion).length,
        raw_single_player_levels: usable.filter(l => l.raw_player_count === 1).length,
        settled_single_player_levels: usable.filter(l => l.settled_player_count === 1).length,
        certified_single_player_levels: usable.filter(l => l.single_player_certified).length,
        transitions: usable.reduce((n,l) => n+l.transitions,0),
        loss_transitions: events.filter(e => e.lost_future_types.length).reduce((n,e) => n+e.observations,0),
        cached_replays: usable.reduce((n,l) => n+l.cached_replays.length,0),
        cached_replays_solved: usable.reduce((n,l) => n+l.cached_replays.filter(r => r.solved).length,0),
    };
}

function main() {
    const options = optionsFromArgs(process.argv.slice(2));
    const byHash = new Map();
    for (const file of discoverInputFiles(options.roots)) {
        const hash = sha(fs.readFileSync(file));
        if (!byHash.has(hash)) byHash.set(hash, []);
        byHash.get(hash).push(path.relative(process.cwd(), file).replaceAll('\\', '/'));
    }
    const cacheManifest = JSON.parse(fs.readFileSync('src/tests/solution_cache/eligible/manifest.json', 'utf8'));
    const groups = [...byHash.entries()].filter(([_hash, files]) => !options.game || files.some(f => f.includes(options.game)))
        .filter((_entry, i) => i % options.shards === options.shard);
    const result = { schema: 'future-object-universe-survey-v1', options,
        scope: 'Exact-source-deduplicated bundled collections; bounded unpruned exploration, deterministic walk, and source-hash-matched cached winning traces. Not an unbiased state-frequency estimate.', rows: [] };
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    for (const [hash, files] of groups) {
        const file = files[0];
        const solutions = cacheManifest.entries.filter(e => e.source_sha256 === hash);
        try { result.rows.push(surveyGame(file, files, solutions, options)); }
        catch (e) { result.rows.push({ source: file, aliases: files, sha256: hash, status: 'error', error: e.stack, levels: [] }); }
        result.totals = summarize(result.rows);
        fs.writeFileSync(options.out, JSON.stringify(result, null, 2)+'\n');
        console.log(`${result.rows.length}/${groups.length} ${file}: ${result.totals.affected_levels} affected, ${result.totals.level_errors} errors`);
    }
    console.log(JSON.stringify(result.totals));
}

module.exports = { surveyGame, summarize };
if (require.main === module) main();
