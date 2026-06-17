#!/usr/bin/env node
'use strict';

// Cumulative solve curve for the JS solver: how many corpus levels are solved
// at each timeout threshold.
//
// Methodology: ONE serial corpus run at the maximum timeout. Search order is
// deterministic and a wall-clock deadline only truncates it, so a level whose
// solve took elapsed_ms <= T would also be solved by a run with timeout T (up
// to scheduler jitter near the boundary). The cumulative curve is therefore
// just a count over solved levels' elapsed_ms - far cheaper and smoother than
// N separate runs. Run serially: CPU contention inflates elapsed_ms.
//
// Usage:
//   node src/tests/solver_timeout_curve.js [corpusDir] [--max-ms N] [--step-ms N]
//       [--with-cpp] [--compare-all]
//       [--save-json path] [--save-json-canonical path] [--canonical-corpus path]
//       [--save-json-cpp path]
//       [--cpp-solver path] [--cpp-strategy NAME]
//       [--cpp-series "label:save-json-path:args..."]...
//       [--cpp-series "label:save-json-path:solver-path:args..."]...
//       [--series "label:results.json"]... [--label NAME]
//       [--out-svg path] [--out-csv path]
//       [-- extra args passed to run_solver_tests_js.js]
//
// Examples:
//   node src/tests/solver_timeout_curve.js                      # solver_tests, 50..1000ms
//   node src/tests/solver_timeout_curve.js --from-json run.json # re-plot existing run
//   node src/tests/solver_timeout_curve.js --compare-all        # js + c++ chart
//   # overlay saved runs from different solvers on one chart (no corpus run):
//   node src/tests/solver_timeout_curve.js --series "js:js_1s.json" --series "PS+:psplus_1s.json" --series "c++:cpp_1s.json"
//
// Standard full-corpus chart: make solver_timeout_curve
//
// Any results JSON with [{status, elapsed_ms}, ...] entries works as a series,
// including the native solver's: build/native/puzzlescript_solver ... --json.
// A saved curve CSV (timeout_ms,solved,pct) is also accepted as a series.
// Multi-series charts require every series to agree on the playable-level
// denominator; otherwise absolute solve counts are misleading.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_JS_LABEL = 'Javascript';
const PSPLUS_LABEL = 'PS+ naive';
const CANONICAL_LABEL_SUFFIX = ' (canonical)';

function isExistingDirectory(value) {
    try {
        return fs.statSync(value).isDirectory();
    } catch {
        return false;
    }
}

function isCanonicalLabel(label) {
    return /\bcanonical\b/i.test(label);
}

function parseArgs(argv) {
    const options = {
        corpus: 'src/tests/solver_tests',
        maxMs: 1000,
        stepMs: 50,
        maxMsExplicit: false,
        stepMsExplicit: false,
        allowSmoke: false,
        fromJson: null,
        saveJson: null,
        saveJsonCanonical: null,
        canonicalCorpus: null,
        saveJsonPsplus: null,
        saveJsonCpp: null,
        withPsplus: false,
        withCpp: false,
        compareAll: false,
        cppSolver: path.join('build', 'native', 'puzzlescript_solver'),
        cppStrategy: 'portfolio',
        cppSeries: [],
        label: DEFAULT_JS_LABEL,
        series: [],
        outSvg: 'build/solver_timeout_curve.svg',
        outCsv: 'build/solver_timeout_curve.csv',
        passthrough: [],
        quiet: false,
        progressPerGame: true,
        progressEvery: null,
    };
    const args = argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--max-ms') {
            options.maxMs = Math.max(1, Number.parseInt(args[++i], 10) || 1000);
            options.maxMsExplicit = true;
        } else if (arg === '--step-ms') {
            options.stepMs = Math.max(1, Number.parseInt(args[++i], 10) || 50);
            options.stepMsExplicit = true;
        } else if (arg === '--allow-smoke') {
            options.allowSmoke = true;
        } else if (arg === '--quiet') {
            options.quiet = true;
            options.progressPerGame = false;
            options.progressEvery = 0;
        } else if (arg === '--progress-per-game') {
            options.progressPerGame = true;
            options.progressEvery = null;
        } else if (arg === '--progress-every') {
            options.progressPerGame = false;
            options.progressEvery = Math.max(0, Number.parseInt(args[++i], 10));
        } else if (arg === '--from-json') {
            options.fromJson = args[++i];
        } else if (arg === '--save-json') {
            options.saveJson = args[++i];
        } else if (arg === '--save-json-canonical') {
            options.saveJsonCanonical = args[++i];
        } else if (arg === '--canonical-corpus') {
            options.canonicalCorpus = args[++i];
        } else if (arg === '--save-json-psplus') {
            options.saveJsonPsplus = args[++i];
        } else if (arg === '--save-json-cpp') {
            options.saveJsonCpp = args[++i];
        } else if (arg === '--with-psplus') {
            options.withPsplus = true;
        } else if (arg === '--with-cpp') {
            options.withCpp = true;
        } else if (arg === '--compare-all') {
            options.compareAll = true;
        } else if (arg === '--cpp-solver') {
            options.cppSolver = args[++i];
        } else if (arg === '--cpp-strategy') {
            options.cppStrategy = args[++i];
        } else if (arg === '--cpp-series') {
            options.cppSeries.push(parseCppSeriesSpec(args[++i]));
        } else if (arg === '--label') {
            options.label = args[++i];
        } else if (arg === '--series') {
            const spec = String(args[++i]);
            const colon = spec.indexOf(':');
            if (colon <= 0) {
                throw new Error(`--series expects "label:path", got: ${spec}`);
            }
            options.series.push({ label: spec.slice(0, colon), file: spec.slice(colon + 1) });
        } else if (arg === '--out-svg') {
            options.outSvg = args[++i];
        } else if (arg === '--out-csv') {
            options.outCsv = args[++i];
        } else if (arg === '--') {
            options.passthrough = args.slice(i + 1);
            break;
        } else if (!arg.startsWith('--')) {
            options.corpus = arg;
        } else {
            throw new Error(`unknown argument: ${arg}`);
        }
    }
    if (options.compareAll) {
        options.withCpp = true;
    }
    if (options.saveJsonCanonical && !options.canonicalCorpus) {
        throw new Error('--save-json-canonical requires --canonical-corpus');
    }
    return options;
}

function splitArgString(value) {
    const args = [];
    let current = '';
    let quote = null;
    let escaped = false;
    for (const ch of String(value)) {
        if (escaped) {
            current += ch;
            escaped = false;
        } else if (ch === '\\') {
            escaped = true;
        } else if (quote) {
            if (ch === quote) {
                quote = null;
            } else {
                current += ch;
            }
        } else if (ch === '"' || ch === "'") {
            quote = ch;
        } else if (/\s/.test(ch)) {
            if (current.length > 0) {
                args.push(current);
                current = '';
            }
        } else {
            current += ch;
        }
    }
    if (escaped) {
        current += '\\';
    }
    if (quote) {
        throw new Error(`unterminated quote in cpp series args: ${value}`);
    }
    if (current.length > 0) {
        args.push(current);
    }
    return args;
}

function parseCppSeriesSpec(spec) {
    const value = String(spec);
    const firstColon = value.indexOf(':');
    const secondColon = firstColon < 0 ? -1 : value.indexOf(':', firstColon + 1);
    if (firstColon <= 0 || secondColon <= firstColon + 1) {
        throw new Error(
            `--cpp-series expects "label:save-json-path:args...", ` +
            `"label:save-json-path:solver-path:args...", ` +
            `"label:save-json-path:corpus-dir:args...", or ` +
            `"label:save-json-path:corpus-dir:solver-path:args...", got: ${spec}`
        );
    }
    const label = value.slice(0, firstColon);
    const saveJson = value.slice(firstColon + 1, secondColon);
    const rest = value.slice(secondColon + 1);
    const thirdColon = rest.indexOf(':');
    if (thirdColon > 0 && !rest.startsWith('--')) {
        const third = rest.slice(0, thirdColon);
        const afterThird = rest.slice(thirdColon + 1);
        if (isExistingDirectory(third)) {
            const fourthColon = afterThird.indexOf(':');
            if (fourthColon > 0 && !afterThird.startsWith('--')) {
                return {
                    label,
                    saveJson,
                    corpus: third,
                    solver: afterThird.slice(0, fourthColon),
                    args: splitArgString(afterThird.slice(fourthColon + 1)),
                };
            }
            return {
                label,
                saveJson,
                corpus: third,
                solver: null,
                args: splitArgString(afterThird),
            };
        }
        if (third && !third.startsWith('-')) {
            return {
                label,
                saveJson,
                corpus: null,
                solver: third,
                args: splitArgString(afterThird),
            };
        }
    }
    return {
        label,
        saveJson,
        corpus: null,
        solver: null,
        args: splitArgString(rest),
    };
}

function progressArgs(options) {
    if (options.quiet) {
        return ['--quiet'];
    }
    if (options.progressEvery != null) {
        return ['--progress-every', String(options.progressEvery)];
    }
    if (options.progressPerGame) {
        return ['--progress-per-game'];
    }
    return ['--progress-every', '25'];
}

function spawnJsonCommand(command, args, label) {
    process.stderr.write(`running ${label} corpus at ${args.includes('--timeout-ms') ? args[args.indexOf('--timeout-ms') + 1] : '?'}ms timeout (serial; progress on stderr)...\n`);
    const child = spawnSync(command, args, {
        encoding: 'utf8',
        maxBuffer: 1 << 28,
        stdio: ['ignore', 'pipe', 'inherit'],
    });
    if (child.status !== 0) {
        throw new Error(`${label} corpus run failed (exit ${child.status})`);
    }
    if (!child.stdout || !String(child.stdout).trim()) {
        throw new Error(`${label} corpus run produced no JSON on stdout`);
    }
    return JSON.parse(child.stdout);
}

function runCorpus(options, labelOverride, corpusOverride) {
    const label = labelOverride || options.label;
    const corpus = corpusOverride || options.corpus;
    const passthrough = labelOverride === PSPLUS_LABEL
        ? [...options.passthrough, '--strategy', 'naive']
        : options.passthrough;
    const runnerArgs = [
        path.join(__dirname, 'run_solver_tests_js.js'),
        corpus,
        '--timeout-ms', String(options.maxMs),
        '--json', '--no-solutions',
        ...progressArgs(options),
        ...passthrough,
    ];
    return spawnJsonCommand(process.execPath, runnerArgs, label);
}

function defaultCppSeries(options) {
    return {
        label: 'c++',
        saveJson: options.saveJsonCpp,
        corpus: null,
        solver: null,
        args: ['--jobs', '1', '--strategy', options.cppStrategy],
    };
}

function runNativeCorpus(options, series) {
    const runnerArgs = [
        series.solver || options.cppSolver,
        series.corpus || options.corpus,
        '--timeout-ms', String(options.maxMs),
        ...series.args,
        '--json', '--no-solutions',
        ...progressArgs(options),
    ];
    return spawnJsonCommand(runnerArgs[0], runnerArgs.slice(1), series.label);
}

function flattenLevels(payload) {
    const results = payload.results || payload;
    const out = [];
    for (const entry of results) {
        for (const level of (entry.levels || [entry])) {
            out.push(level);
        }
    }
    return out;
}

function unwrapPayload(raw) {
    if (raw && raw.meta && raw.results) {
        return raw;
    }
    const results = raw.results || raw;
    const levels = flattenLevels({ results });
    const playable = levels.filter((l) => l.status !== 'skipped_message' && l.status !== 'compile_error');
    const timeoutMs = levels.reduce((max, level) => Math.max(max, level.timeout_ms | 0), 0);
    return {
        meta: {
            corpus: null,
            max_ms: timeoutMs || null,
            step_ms: null,
            generated_at: null,
            solver: null,
            playable: playable.length,
            legacy: true,
        },
        results,
    };
}

function wrapPayload(payload, meta) {
    return { meta, results: payload.results || payload };
}

function writePayloadFile(filePath, payload, meta) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const results = payload.results || payload;
    fs.writeFileSync(filePath, JSON.stringify({ meta, results }));
}

function curveMetaFromOptions(options, label, playable) {
    return {
        corpus: options.corpus,
        max_ms: options.maxMs,
        step_ms: options.stepMs,
        generated_at: new Date().toISOString(),
        solver: label,
        playable,
    };
}

function applyMetaFromSeriesFiles(options) {
    // CSV series carry no metadata; sniff the first JSON series instead.
    const firstJson = options.series.find((spec) => !spec.file.replace(/#[^#]*$/, '').endsWith('.csv'));
    if (!firstJson) {
        return;
    }
    const first = unwrapPayload(JSON.parse(fs.readFileSync(firstJson.file, 'utf8')));
    const meta = first.meta || {};
    if (meta.max_ms && !options.maxMsExplicit) {
        options.maxMs = meta.max_ms;
    }
    if (meta.step_ms && !options.stepMsExplicit) {
        options.stepMs = meta.step_ms;
    }
    options.chartMeta = meta;
    const playable = meta.playable || flattenLevels(first).filter((l) => l.status !== 'skipped_message' && l.status !== 'compile_error').length;
    if (!options.allowSmoke && playable > 0 && playable < 50) {
        throw new Error(
            `Saved curve JSON looks like a smoke run (${playable} playable levels in ${firstJson.file}). ` +
            'Run `make solver_timeout_curve` on the full corpus first, or pass --allow-smoke to replot anyway.'
        );
    }
}

function buildCurve(levels, options) {
    const playable = levels.filter((l) => l.status !== 'skipped_message' && l.status !== 'compile_error');
    const solveTimes = playable
        .filter((l) => l.status === 'solved')
        .map((l) => Math.max(1, l.elapsed_ms | 0))
        .sort((a, b) => a - b);
    const thresholds = [];
    for (let t = options.stepMs; t <= options.maxMs; t += options.stepMs) {
        thresholds.push(t);
    }
    const points = thresholds.map((t) => {
        let solved = 0;
        for (const e of solveTimes) {
            if (e <= t) solved++; else break;
        }
        return { timeout_ms: t, solved, pct: playable.length === 0 ? 0 : solved / playable.length * 100 };
    });
    return { playable: playable.length, totalSolvedAtMax: solveTimes.length, points };
}

function isPlayableLevel(level) {
    return level.status !== 'skipped_message' && level.status !== 'compile_error';
}

function levelKey(level) {
    return `${level.game}#${level.level}`;
}

function lostPlayableLevels(originalLevels, canonicalLevels) {
    const canonicalByKey = new Map(canonicalLevels.map((level) => [levelKey(level), level]));
    const compileErrors = new Map();
    for (const level of canonicalLevels) {
        if (level.level === -1 && level.status === 'compile_error') {
            compileErrors.set(level.game, level.error || 'compile_error');
        }
    }
    const lost = [];
    const seenGames = new Set();
    for (const level of originalLevels) {
        if (!isPlayableLevel(level)) {
            continue;
        }
        const compileError = compileErrors.get(level.game);
        if (compileError) {
            if (!seenGames.has(level.game)) {
                seenGames.add(level.game);
                lost.push({
                    game: level.game,
                    level: null,
                    reason: `game compile_error: ${String(compileError).split('\n')[0]}`,
                });
            }
            continue;
        }
        const canonical = canonicalByKey.get(levelKey(level));
        if (!canonical || !isPlayableLevel(canonical)) {
            lost.push({
                game: level.game,
                level: level.level,
                reason: canonical ? canonical.status : 'missing',
            });
        }
    }
    return lost;
}

function reportLostPlayableLevels(originalLevels, canonicalLevels) {
    const lost = lostPlayableLevels(originalLevels, canonicalLevels);
    if (lost.length === 0) {
        return;
    }
    process.stderr.write(
        `canonical corpus: ${lost.length} playable level slot(s) from the original corpus are not playable in the canonical JS run:\n`
    );
    for (const row of lost) {
        const where = row.level == null ? row.game : `${row.game}#${row.level}`;
        process.stderr.write(`  ${where}: ${row.reason}\n`);
    }
}

function assertConsistentPlayableDenominators(curves, options) {
    if (curves.length <= 1) {
        return;
    }
    const expected = curves[0].playable;
    const mismatches = curves
        .filter((curve) => curve.playable !== expected)
        .map((curve) => `${curve.label}=${curve.playable}`);
    if (mismatches.length === 0) {
        return;
    }
    const counts = curves.map((curve) => `${curve.label}=${curve.playable}`).join(', ');
    if (options && options.denominatorCheck) {
        reportLostPlayableLevels(options.denominatorCheck.originalLevels, options.denominatorCheck.canonicalLevels);
    }
    throw new Error(
        `playable denominator mismatch across solver curve series: ${counts}. ` +
        'Do not compare solve counts from runs that disagree about which levels are playable.'
    );
}

function loadSeries(spec, options) {
    // CSV path may carry a "#seriesName" suffix to pick one series out of a
    // multi-series curve CSV when the chart label differs from the stored name.
    const hash = spec.file.lastIndexOf('#');
    const csvSeriesName = hash > 0 && spec.file.slice(0, hash).endsWith('.csv')
        ? spec.file.slice(hash + 1)
        : null;
    const filePath = csvSeriesName ? spec.file.slice(0, hash) : spec.file;
    if (filePath.endsWith('.csv')) {
        const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
        const header = lines[0].split(',');
        const col = (name) => header.indexOf(name);
        const tCol = col('timeout_ms'), sCol = col('solved'), pCol = col('pct'), seriesCol = col('series');
        const wanted = csvSeriesName || spec.label;
        const rows = lines.slice(1).map((line) => line.split(','));
        const points = rows
            .filter((row) => seriesCol < 0 || row[seriesCol] === wanted)
            .map((row) => ({
                timeout_ms: Number(row[tCol]), solved: Number(row[sCol]), pct: Number(row[pCol]),
            }));
        if (points.length === 0) {
            const available = [...new Set(rows.map((row) => row[seriesCol]))].join(', ');
            throw new Error(
                `No rows for series "${wanted}" in ${filePath} (available: ${available}). ` +
                'Use --series "label:path.csv#seriesName" to pick one.'
            );
        }
        const last = points[points.length - 1];
        const playable = last.pct > 0 ? Math.round(last.solved / (last.pct / 100)) : 0;
        return { label: spec.label, playable, totalSolvedAtMax: last.solved, points };
    }
    const payload = unwrapPayload(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    const curve = buildCurve(flattenLevels(payload), options);
    return { label: spec.label, meta: payload.meta, ...curve };
}

function renderAscii(curves) {
    const width = 44;
    const max = Math.max(...curves.flatMap((c) => c.points.map((p) => p.solved)), 1);
    let out = '';
    for (const curve of curves) {
        out += `\n[${curve.label}] cumulative solves out of ${curve.playable} playable levels\n`;
        for (const p of curve.points) {
            const bar = '#'.repeat(Math.round(p.solved / max * width));
            out += `${String(p.timeout_ms).padStart(5)}ms |${bar.padEnd(width)}| ${String(p.solved).padStart(4)}  (${p.pct.toFixed(1)}%)\n`;
        }
    }
    return out;
}

// One distinct hue per solver family; canonical variants reuse the parent color (dashed).
const SERIES_BASE_COLORS = [
    '#2171b5', // Javascript
    '#238b45', // c++ portfolio
    '#6a51a3', // c++ hda-weighted-astar x8
    '#cb181d', // c++ portfolio compiled
    '#d94801', // c++ hda-weighted-astar x8 compiled
    '#525252',
    '#88419d',
    '#a63603',
];

function seriesBaseKey(label) {
    return String(label).replace(/\s*\(canonical\)\s*$/i, '').trim();
}

function buildSeriesColorMap(curves) {
    const map = new Map();
    let next = 0;
    for (const curve of curves) {
        const base = seriesBaseKey(curve.label);
        if (!map.has(base)) {
            map.set(base, SERIES_BASE_COLORS[next % SERIES_BASE_COLORS.length]);
            next++;
        }
    }
    return map;
}

function seriesColor(label, colorMap) {
    return colorMap.get(seriesBaseKey(label)) || SERIES_BASE_COLORS[0];
}

// Nudge overlapping end-of-line labels apart while staying as close as possible to
// each curve's terminal point.
function resolveLabelYs(baseYs, minGap, yMin, yMax) {
    const n = baseYs.length;
    if (n === 0) {
        return [];
    }
    const order = baseYs.map((_, i) => i).sort((a, b) => baseYs[a] - baseYs[b]);
    const ys = order.map((i) => baseYs[i]);
    for (let j = 1; j < n; j++) {
        if (ys[j] < ys[j - 1] + minGap) {
            ys[j] = ys[j - 1] + minGap;
        }
    }
    if (ys[n - 1] > yMax) {
        const shift = ys[n - 1] - yMax;
        for (let j = 0; j < n; j++) {
            ys[j] -= shift;
        }
    }
    if (ys[0] < yMin) {
        const shift = yMin - ys[0];
        for (let j = 0; j < n; j++) {
            ys[j] += shift;
        }
        if (ys[n - 1] > yMax) {
            const shift = ys[n - 1] - yMax;
            for (let j = 0; j < n; j++) {
                ys[j] -= shift;
            }
        }
    }
    const out = new Array(n);
    for (let j = 0; j < n; j++) {
        out[order[j]] = ys[j];
    }
    return out;
}

function renderSvg(curves, options) {
    const W = 720;
    const extraLegendRows = Math.max(0, curves.length - 5);
    const H = 460 + extraLegendRows * 18;
    const mL = 60, mR = 20, mT = 50, mB = 45;
    const plotW = W - mL - mR, plotH = H - mT - mB;
    const maxX = options.maxMs;
    const maxY = Math.max(...curves.map((c) => c.totalSolvedAtMax), 1) * 1.05;
    const x = (ms) => mL + ms / maxX * plotW;
    const y = (n) => mT + plotH - n / maxY * plotH;
    let grid = '';
    for (let t = 0; t <= maxX; t += Math.max(options.stepMs * 2, 100)) {
        grid += `<line x1="${x(t)}" y1="${mT}" x2="${x(t)}" y2="${mT + plotH}" stroke="#eee"/>` +
            `<text x="${x(t)}" y="${H - mB + 16}" font-size="11" text-anchor="middle" fill="#555">${t}</text>`;
    }
    const yStep = Math.max(1, Math.round(maxY / 6));
    for (let n = 0; n <= maxY; n += yStep) {
        grid += `<line x1="${mL}" y1="${y(n)}" x2="${mL + plotW}" y2="${y(n)}" stroke="#eee"/>` +
            `<text x="${mL - 8}" y="${y(n) + 4}" font-size="11" text-anchor="end" fill="#555">${n}</text>`;
    }
    let lines = '';
    let legend = '';
    const labelMeta = curves.map((curve) => {
        const last = curve.points[curve.points.length - 1];
        return { last, baseY: y(last.solved) };
    });
    const labelYs = resolveLabelYs(
        labelMeta.map((meta) => meta.baseY),
        14,
        mT + 6,
        mT + plotH - 6
    );
    const colorMap = buildSeriesColorMap(curves);
    curves.forEach((curve, ci) => {
        const color = seriesColor(curve.label, colorMap);
        const pts = [[0, 0], ...curve.points.map((p) => [p.timeout_ms, p.solved])];
        const poly = pts.map(([ms, n]) => `${x(ms).toFixed(1)},${y(n).toFixed(1)}`).join(' ');
        const { last } = labelMeta[ci];
        const dash = isCanonicalLabel(curve.label) ? ' stroke-dasharray="6 4"' : '';
        lines += `<polyline points="${poly}" fill="none" stroke="${color}" stroke-width="2.5"${dash}/>` +
            `<text x="${x(last.timeout_ms) - 6}" y="${labelYs[ci]}" font-size="12" text-anchor="end" dominant-baseline="middle" fill="${color}">${curve.label}: ${last.solved} (${last.pct.toFixed(1)}%)</text>`;
        const ly = mT + 10 + ci * 18;
        const legendDash = isCanonicalLabel(curve.label) ? ' stroke-dasharray="4 3"' : '';
        legend += `<line x1="${mL + 12}" y1="${ly + 2}" x2="${mL + 30}" y2="${ly + 2}" stroke="${color}" stroke-width="3"${legendDash}/>` +
            `<text x="${mL + 36}" y="${ly + 6}" font-size="11" fill="#333">${curve.label}</text>`;
    });
    const playable = curves[0].playable;
    const meta = options.chartMeta || curves[0].meta || {};
    const corpusLabel = meta.corpus ? path.basename(meta.corpus) : 'saved runs';
    const playableLabel = options.playableDenominatorNote || `${playable} playable levels`;
    const subtitle = meta.generated_at
        ? `${corpusLabel}, max ${options.maxMs}ms, generated ${meta.generated_at.slice(0, 19)}`
        : `${corpusLabel}, max ${options.maxMs}ms`;
    const denominatorNote = options.playableDenominatorNote
        ? `<text x="${W / 2}" y="48" font-size="10" text-anchor="middle" fill="#888">${options.playableDenominatorNote}</text>`
        : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="sans-serif">
<rect width="${W}" height="${H}" fill="white"/>
${grid}
${lines}
${legend}
<line x1="${mL}" y1="${mT + plotH}" x2="${mL + plotW}" y2="${mT + plotH}" stroke="#333"/>
<line x1="${mL}" y1="${mT}" x2="${mL}" y2="${mT + plotH}" stroke="#333"/>
<text x="${W / 2}" y="18" font-size="14" text-anchor="middle">Cumulative levels solved vs timeout (${playableLabel})</text>
<text x="${W / 2}" y="36" font-size="11" text-anchor="middle" fill="#666">${subtitle}</text>
${denominatorNote}
<text x="${W / 2}" y="${H - 8}" font-size="12" text-anchor="middle" fill="#333">timeout (ms)</text>
</svg>\n`;
}

function main() {
    const options = parseArgs(process.argv);
    applyMetaFromSeriesFiles(options);
    const curves = [];
    if (options.series.length > 0) {
        for (const spec of options.series) {
            curves.push(loadSeries(spec, options));
        }
    } else {
        const rawPayload = options.fromJson
            ? JSON.parse(fs.readFileSync(options.fromJson, 'utf8'))
            : runCorpus(options);
        const payload = unwrapPayload(rawPayload);
        const levels = flattenLevels(payload);
        const jsMeta = curveMetaFromOptions(options, options.label, buildCurve(levels, options).playable);
        if (options.saveJson) {
            writePayloadFile(options.saveJson, payload, jsMeta);
        }
        curves.push({ label: options.label, meta: jsMeta, ...buildCurve(levels, options) });
        options.chartMeta = jsMeta;

        if (options.saveJsonCanonical && options.canonicalCorpus) {
            const canonicalLabel = `${options.label}${CANONICAL_LABEL_SUFFIX}`;
            const canonicalRaw = runCorpus(options, canonicalLabel, options.canonicalCorpus);
            const canonicalPayload = unwrapPayload(canonicalRaw);
            const canonicalLevels = flattenLevels(canonicalPayload);
            const canonicalMeta = curveMetaFromOptions(
                { ...options, corpus: options.canonicalCorpus },
                canonicalLabel,
                buildCurve(canonicalLevels, options).playable
            );
            writePayloadFile(options.saveJsonCanonical, canonicalPayload, canonicalMeta);
            curves.push({ label: canonicalLabel, meta: canonicalMeta, ...buildCurve(canonicalLevels, options) });
            options.denominatorCheck = { originalLevels: levels, canonicalLevels };
        }

        if (options.withPsplus && !options.fromJson) {
            const psplusRaw = runCorpus(options, PSPLUS_LABEL);
            const psplusPayload = unwrapPayload(psplusRaw);
            const psplusLevels = flattenLevels(psplusPayload);
            const psplusMeta = curveMetaFromOptions(options, PSPLUS_LABEL, buildCurve(psplusLevels, options).playable);
            if (options.saveJsonPsplus) {
                writePayloadFile(options.saveJsonPsplus, psplusPayload, psplusMeta);
            }
            curves.push({ label: PSPLUS_LABEL, meta: psplusMeta, ...buildCurve(psplusLevels, options) });
        }

        const cppSeries = [...options.cppSeries];
        if (options.withCpp && cppSeries.length === 0 && !options.fromJson) {
            cppSeries.push(defaultCppSeries(options));
        }
        for (const series of cppSeries) {
            const cppRaw = runNativeCorpus(options, series);
            const cppPayload = unwrapPayload(cppRaw);
            const cppLevels = flattenLevels(cppPayload);
            const cppMeta = curveMetaFromOptions(options, series.label, buildCurve(cppLevels, options).playable);
            if (series.saveJson) {
                writePayloadFile(series.saveJson, cppPayload, cppMeta);
            }
            curves.push({ label: series.label, meta: cppMeta, ...buildCurve(cppLevels, options) });
        }
    }
    assertConsistentPlayableDenominators(curves, options);
    process.stdout.write(renderAscii(curves));
    fs.mkdirSync(path.dirname(options.outCsv), { recursive: true });
    fs.writeFileSync(options.outCsv, 'series,timeout_ms,solved,pct\n' +
        curves.flatMap((c) => c.points.map((p) => `${c.label},${p.timeout_ms},${p.solved},${p.pct.toFixed(2)}`)).join('\n') + '\n');
    fs.writeFileSync(options.outSvg, renderSvg(curves, options));
    process.stderr.write(`wrote ${options.outCsv} and ${options.outSvg}\n`);
}

if (require.main === module) {
    main();
}
module.exports = {
    parseCppSeriesSpec,
    isCanonicalLabel,
    isExistingDirectory,
    seriesBaseKey,
    buildSeriesColorMap,
    seriesColor,
    lostPlayableLevels,
};
