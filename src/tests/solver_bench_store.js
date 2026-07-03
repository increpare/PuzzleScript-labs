#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCHEMA_VERSION = 1;

const SUMMARY_FIELDS = [
    'solved',
    'timeout',
    'exhausted',
    'errors',
    'generated',
    'expanded',
    'step_ms',
    'heuristic_ms',
    'elapsed_ms',
];

function stableValue(value) {
    if (Array.isArray(value)) {
        return value.map(stableValue);
    }
    if (value && typeof value === 'object' && value.constructor === Object) {
        const out = {};
        for (const key of Object.keys(value).sort()) {
            out[key] = stableValue(value[key]);
        }
        return out;
    }
    return value;
}

function stableJson(value) {
    return JSON.stringify(stableValue(value));
}

function shortHash(value) {
    return crypto.createHash('sha256').update(stableJson(value)).digest('hex').slice(0, 16);
}

function numeric(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function resultKey(result) {
    return `${result.game || ''}\u0000${result.level}`;
}

function defaultGitRev(repoRoot = path.resolve(__dirname, '..', '..')) {
    try {
        return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch (error) {
        return 'unknown';
    }
}

function defaultMachine() {
    return {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
    };
}

function requireString(metadata, field) {
    const value = metadata[field];
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`${field} is required`);
    }
    return value;
}

function inferConfig(runJson, metadata) {
    const totals = runJson && runJson.totals ? runJson.totals : {};
    const firstResult = Array.isArray(runJson && runJson.results) ? runJson.results[0] || {} : {};
    return {
        timeout_ms: metadata.timeout_ms ?? firstResult.timeout_ms ?? totals.timeout_ms ?? null,
        strategy: metadata.strategy ?? firstResult.strategy ?? runJson.strategy ?? null,
        jobs: metadata.jobs ?? runJson.jobs ?? null,
        runner: metadata.runner ?? null,
    };
}

function normalizeResults(runJson) {
    return (Array.isArray(runJson && runJson.results) ? runJson.results : []).map((row) => {
        const out = {
            game: row.game || '',
            level: row.level,
            status: row.status || 'unknown',
        };
        for (const field of [
            'elapsed_ms',
            'generated',
            'expanded',
            'unique_states',
            'duplicates',
            'max_frontier',
            'solution_length',
            'timeout_ms',
            'step_ms',
            'heuristic_ms',
            'clone_ms',
            'hash_ms',
            'queue_ms',
            'reconstruct_ms',
        ]) {
            if (row[field] !== undefined) {
                out[field] = numeric(row[field]);
            }
        }
        return out;
    });
}

function countStatus(results, status) {
    return results.filter((row) => row.status === status).length;
}

function sumField(results, field) {
    return results.reduce((sum, row) => sum + numeric(row[field]), 0);
}

function normalizeTotals(runJson, results) {
    const totals = runJson && runJson.totals ? runJson.totals : {};
    const out = {
        levels: numeric(totals.levels, results.length),
        solved: numeric(totals.solved, countStatus(results, 'solved')),
        timeout: numeric(totals.timeout, countStatus(results, 'timeout')),
        exhausted: numeric(totals.exhausted, countStatus(results, 'exhausted')),
        skipped_message: numeric(totals.skipped_message, countStatus(results, 'skipped_message')),
        errors: numeric(totals.errors, countStatus(results, 'error')),
    };
    for (const field of ['generated', 'expanded', 'step_ms', 'heuristic_ms', 'elapsed_ms']) {
        out[field] = numeric(totals[field], sumField(results, field));
    }
    return out;
}

function createRunRecord(runJson, metadata = {}) {
    if (!runJson || typeof runJson !== 'object') {
        throw new Error('runJson must be an object');
    }
    const benchmarkSlice = requireString(metadata, 'benchmark_slice');
    const variant = requireString(metadata, 'variant');
    const results = normalizeResults(runJson);
    const totals = normalizeTotals(runJson, results);
    const config = stableValue(metadata.config || inferConfig(runJson, metadata));
    const artifacts = (metadata.artifacts || []).map((artifactPath) => path.resolve(String(artifactPath)));
    return {
        schema_version: SCHEMA_VERSION,
        record_type: 'solver_bench_run',
        recorded_at: metadata.recorded_at || new Date().toISOString(),
        git_rev: metadata.git_rev || defaultGitRev(metadata.repo_root),
        benchmark_slice: benchmarkSlice,
        variant,
        pair_id: metadata.pair_id || null,
        config_hash: shortHash(config),
        config,
        machine: metadata.machine || defaultMachine(),
        source_path: metadata.source_path ? path.resolve(metadata.source_path) : null,
        artifacts,
        totals,
        results,
    };
}

function appendRunRecord(storePath, record) {
    if (!record || record.schema_version !== SCHEMA_VERSION || record.record_type !== 'solver_bench_run') {
        throw new Error('not a solver bench run record');
    }
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.appendFileSync(storePath, `${JSON.stringify(record)}\n`);
}

function readRunRecords(storePath) {
    if (!fs.existsSync(storePath)) {
        return [];
    }
    return fs.readFileSync(storePath, 'utf8')
        .split(/\n/)
        .filter((line) => line.trim().length > 0)
        .map((line, index) => {
            try {
                return JSON.parse(line);
            } catch (error) {
                throw new Error(`${storePath}:${index + 1}: invalid JSONL record: ${error.message}`);
            }
        });
}

function filterRecords(records, filters = {}) {
    return records.filter((record) => {
        if (filters.benchmark_slice && record.benchmark_slice !== filters.benchmark_slice) {
            return false;
        }
        if (filters.variant && record.variant !== filters.variant) {
            return false;
        }
        if (filters.config_hash && record.config_hash !== filters.config_hash) {
            return false;
        }
        return true;
    });
}

function stats(values) {
    const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
    if (finite.length === 0) {
        return { count: 0, min: null, max: null, mean: null, median: null, spread: null };
    }
    const sum = finite.reduce((total, value) => total + value, 0);
    return {
        count: finite.length,
        min: finite[0],
        max: finite[finite.length - 1],
        mean: sum / finite.length,
        median: finite[Math.floor(finite.length / 2)],
        spread: finite[finite.length - 1] - finite[0],
    };
}

function summarizeRecords(records, filters = {}) {
    const selected = filterRecords(records, filters);
    const variants = {};
    const pairs = new Set();
    for (const record of selected) {
        variants[record.variant] = (variants[record.variant] || 0) + 1;
        if (record.pair_id) {
            pairs.add(record.pair_id);
        }
    }
    const summary = {
        schema_version: SCHEMA_VERSION,
        run_count: selected.length,
        variants,
        pair_count: pairs.size,
    };
    for (const field of SUMMARY_FIELDS) {
        summary[field] = stats(selected.map((record) => numeric(record.totals && record.totals[field], NaN)));
    }
    return summary;
}

function metricValue(record, metric) {
    if (record.totals && Number.isFinite(Number(record.totals[metric]))) {
        return Number(record.totals[metric]);
    }
    if (Number.isFinite(Number(record[metric]))) {
        return Number(record[metric]);
    }
    return NaN;
}

function metricDirection(metric, override) {
    if (override === 'higher' || override === 'lower') {
        return override;
    }
    if (/_ms$/.test(metric) || metric === 'wall_ms' || metric === 'elapsed_ms') {
        return 'lower';
    }
    return 'higher';
}

function indexByPair(records, variant) {
    const out = new Map();
    for (const record of records) {
        if (record.variant === variant && record.pair_id) {
            out.set(record.pair_id, record);
        }
    }
    return out;
}

function compareStatusFlips(baseline, candidate) {
    const candidateByKey = new Map((candidate.results || []).map((row) => [resultKey(row), row]));
    const flips = {
        status_changed: 0,
        baseline_timeout_candidate_solved: 0,
        baseline_solved_candidate_timeout: 0,
        details: [],
    };
    for (const baselineRow of baseline.results || []) {
        const candidateRow = candidateByKey.get(resultKey(baselineRow));
        if (!candidateRow || baselineRow.status === candidateRow.status) {
            continue;
        }
        flips.status_changed++;
        if (baselineRow.status !== 'solved' && candidateRow.status === 'solved') {
            flips.baseline_timeout_candidate_solved++;
        }
        if (baselineRow.status === 'solved' && candidateRow.status !== 'solved') {
            flips.baseline_solved_candidate_timeout++;
        }
        flips.details.push({
            game: baselineRow.game || '',
            level: baselineRow.level,
            baseline_status: baselineRow.status,
            candidate_status: candidateRow.status,
        });
    }
    return flips;
}

function mergeFlipCounts(target, source) {
    target.status_changed += source.status_changed;
    target.baseline_timeout_candidate_solved += source.baseline_timeout_candidate_solved;
    target.baseline_solved_candidate_timeout += source.baseline_solved_candidate_timeout;
    target.details.push(...source.details);
}

function comparePairedRuns(records, options = {}) {
    const selected = filterRecords(records, { benchmark_slice: options.benchmark_slice });
    const baselineVariant = options.baseline_variant || 'baseline';
    const candidateVariant = options.candidate_variant || 'candidate';
    const metric = options.metric || 'solved';
    const direction = metricDirection(metric, options.direction);
    const noiseBand = numeric(options.noise_band, 0);
    const baselineByPair = indexByPair(selected, baselineVariant);
    const candidateByPair = indexByPair(selected, candidateVariant);
    const pairRows = [];
    const flips = {
        status_changed: 0,
        baseline_timeout_candidate_solved: 0,
        baseline_solved_candidate_timeout: 0,
        details: [],
    };

    for (const [pairId, baseline] of baselineByPair.entries()) {
        const candidate = candidateByPair.get(pairId);
        if (!candidate) {
            continue;
        }
        const baselineMetric = metricValue(baseline, metric);
        const candidateMetric = metricValue(candidate, metric);
        if (!Number.isFinite(baselineMetric) || !Number.isFinite(candidateMetric)) {
            continue;
        }
        const delta = candidateMetric - baselineMetric;
        pairRows.push({
            pair_id: pairId,
            baseline: baselineMetric,
            candidate: candidateMetric,
            delta,
        });
        mergeFlipCounts(flips, compareStatusFlips(baseline, candidate));
    }

    const deltaStats = stats(pairRows.map((row) => row.delta));
    let verdict = 'no_pairs';
    if (pairRows.length > 0) {
        if (Math.abs(deltaStats.mean) <= noiseBand) {
            verdict = 'inconclusive_noise_band';
        } else if ((direction === 'higher' && deltaStats.mean > 0) || (direction === 'lower' && deltaStats.mean < 0)) {
            verdict = 'candidate_better';
        } else {
            verdict = 'candidate_worse';
        }
    }

    return {
        schema_version: SCHEMA_VERSION,
        benchmark_slice: options.benchmark_slice || null,
        baseline_variant: baselineVariant,
        candidate_variant: candidateVariant,
        metric,
        direction,
        noise_band: noiseBand,
        pair_count: pairRows.length,
        mean_delta: deltaStats.mean,
        min_delta: deltaStats.min,
        max_delta: deltaStats.max,
        spread: deltaStats.spread,
        verdict,
        pairs: pairRows,
        flips,
    };
}

function loadBenchmarkSlices(slicePath) {
    const slices = JSON.parse(fs.readFileSync(slicePath, 'utf8'));
    if (slices.schema_version !== SCHEMA_VERSION || !Array.isArray(slices.slices)) {
        throw new Error(`invalid benchmark slice registry: ${slicePath}`);
    }
    const names = new Set();
    for (const slice of slices.slices) {
        if (!slice.name || names.has(slice.name)) {
            throw new Error(`invalid or duplicate slice name: ${slice.name}`);
        }
        names.add(slice.name);
        if (!slice.selection || !slice.selection.stability) {
            throw new Error(`slice ${slice.name} is missing selection.stability`);
        }
    }
    return slices;
}

function pathContains(parentPath, childPath) {
    const relative = path.relative(parentPath, childPath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function directChildren(rootPath) {
    if (!fs.existsSync(rootPath)) {
        return [];
    }
    return fs.readdirSync(rootPath)
        .map((name) => path.join(rootPath, name))
        .filter((entryPath) => {
            try {
                return fs.statSync(entryPath).isDirectory();
            } catch (error) {
                return false;
            }
        });
}

function referencedArtifactPaths(records) {
    const paths = new Set();
    for (const record of records) {
        for (const artifact of record.artifacts || []) {
            paths.add(path.resolve(artifact));
        }
        if (record.source_path) {
            paths.add(path.resolve(record.source_path));
        }
    }
    return paths;
}

function planArtifactRetention(options = {}) {
    const buildRoot = path.resolve(options.build_root || 'build');
    const records = options.records || [];
    const now = options.now || new Date();
    const maxAgeDays = numeric(options.max_age_days, 30);
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const referenced = referencedArtifactPaths(records);
    const keep = [];
    const remove = [];
    const seenKeep = new Set();

    function keepPath(entryPath, reason) {
        const resolved = path.resolve(entryPath);
        if (seenKeep.has(resolved) || !fs.existsSync(resolved)) {
            return;
        }
        seenKeep.add(resolved);
        keep.push({ path: resolved, reason });
    }

    for (const referencedPath of referenced) {
        keepPath(referencedPath, 'referenced');
    }

    for (const entryPath of directChildren(buildRoot)) {
        const resolvedEntry = path.resolve(entryPath);
        const isReferenced = Array.from(referenced).some((referencedPath) =>
            pathContains(resolvedEntry, referencedPath) || pathContains(referencedPath, resolvedEntry)
        );
        if (isReferenced) {
            keepPath(resolvedEntry, 'referenced');
            continue;
        }
        const stat = fs.statSync(resolvedEntry);
        const ageMs = now.getTime() - stat.mtime.getTime();
        if (ageMs > maxAgeMs) {
            remove.push({
                path: resolvedEntry,
                reason: 'expired_unreferenced',
                age_days: ageMs / (24 * 60 * 60 * 1000),
            });
        } else {
            keepPath(resolvedEntry, 'recent');
        }
    }

    return {
        schema_version: SCHEMA_VERSION,
        build_root: buildRoot,
        max_age_days: maxAgeDays,
        keep,
        remove,
    };
}

Object.assign(module.exports, {
    appendRunRecord,
    comparePairedRuns,
    createRunRecord,
    filterRecords,
    loadBenchmarkSlices,
    planArtifactRetention,
    readRunRecords,
    summarizeRecords,
});
