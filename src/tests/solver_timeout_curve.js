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
//       [--with-psplus] [--with-cpp] [--compare-all]
//       [--save-json path] [--save-json-psplus path] [--save-json-cpp path]
//       [--cpp-solver path] [--cpp-strategy NAME]
//       [--series "label:results.json"]... [--label NAME]
//       [--out-svg path] [--out-csv path]
//       [-- extra args passed to run_solver_tests_js.js]
//
// Examples:
//   node src/tests/solver_timeout_curve.js                      # solver_tests, 50..1000ms
//   node src/tests/solver_timeout_curve.js --from-json run.json # re-plot existing run
//   node src/tests/solver_timeout_curve.js --compare-all        # js + PS+ + c++ chart
//   # overlay saved runs from different solvers on one chart (no corpus run):
//   node src/tests/solver_timeout_curve.js --series "js:js_1s.json" --series "PS+:psplus_1s.json" --series "c++:cpp_1s.json"
//
// Standard full-corpus chart: make solver_timeout_curve
//
// Any results JSON with [{status, elapsed_ms}, ...] entries works as a series,
// including the native solver's: build/native/puzzlescript_solver ... --json.
// A saved curve CSV (timeout_ms,solved,pct) is also accepted as a series.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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
        saveJsonPsplus: null,
        saveJsonCpp: null,
        withPsplus: false,
        withCpp: false,
        compareAll: false,
        cppSolver: path.join('build', 'native', 'puzzlescript_solver'),
        cppStrategy: 'portfolio',
        label: 'js',
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
        options.withPsplus = true;
        options.withCpp = true;
    }
    return options;
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

function runCorpus(options, labelOverride) {
    const label = labelOverride || options.label;
    const passthrough = labelOverride === 'PS+'
        ? [...options.passthrough, '--strategy', 'naive']
        : options.passthrough;
    const runnerArgs = [
        path.join(__dirname, 'run_solver_tests_js.js'),
        options.corpus,
        '--timeout-ms', String(options.maxMs),
        '--json', '--no-solutions',
        ...progressArgs(options),
        ...passthrough,
    ];
    return spawnJsonCommand(process.execPath, runnerArgs, label);
}

function runNativeCorpus(options) {
    const runnerArgs = [
        options.cppSolver,
        options.corpus,
        '--timeout-ms', String(options.maxMs),
        '--jobs', '1',
        '--strategy', options.cppStrategy,
        '--json', '--no-solutions',
        ...progressArgs(options),
    ];
    return spawnJsonCommand(runnerArgs[0], runnerArgs.slice(1), 'c++');
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
    if (options.series.length === 0) {
        return;
    }
    const first = unwrapPayload(JSON.parse(fs.readFileSync(options.series[0].file, 'utf8')));
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
            `Saved curve JSON looks like a smoke run (${playable} playable levels in ${options.series[0].file}). ` +
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
        return { timeout_ms: t, solved, pct: solved / playable.length * 100 };
    });
    return { playable: playable.length, totalSolvedAtMax: solveTimes.length, points };
}

function loadSeries(spec, options) {
    if (spec.file.endsWith('.csv')) {
        const lines = fs.readFileSync(spec.file, 'utf8').trim().split('\n');
        const header = lines[0].split(',');
        const col = (name) => header.indexOf(name);
        const tCol = col('timeout_ms'), sCol = col('solved'), pCol = col('pct'), seriesCol = col('series');
        const points = lines.slice(1)
            .map((line) => line.split(','))
            .filter((row) => seriesCol < 0 || row[seriesCol] === spec.label)
            .map((row) => ({
                timeout_ms: Number(row[tCol]), solved: Number(row[sCol]), pct: Number(row[pCol]),
            }));
        const last = points[points.length - 1];
        const playable = last.pct > 0 ? Math.round(last.solved / (last.pct / 100)) : 0;
        return { label: spec.label, playable, totalSolvedAtMax: last.solved, points };
    }
    const payload = unwrapPayload(JSON.parse(fs.readFileSync(spec.file, 'utf8')));
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

const SERIES_COLORS = ['#2266cc', '#cc4422', '#22aa66', '#9944cc', '#888822'];

function renderSvg(curves, options) {
    const W = 720, H = 460, mL = 60, mR = 20, mT = 50, mB = 45;
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
    curves.forEach((curve, ci) => {
        const color = SERIES_COLORS[ci % SERIES_COLORS.length];
        const pts = [[0, 0], ...curve.points.map((p) => [p.timeout_ms, p.solved])];
        const poly = pts.map(([ms, n]) => `${x(ms).toFixed(1)},${y(n).toFixed(1)}`).join(' ');
        const last = curve.points[curve.points.length - 1];
        const labelY = y(last.solved) - 8 - ci * 14;
        lines += `<polyline points="${poly}" fill="none" stroke="${color}" stroke-width="2.5"/>` +
            `<text x="${x(last.timeout_ms) - 6}" y="${labelY}" font-size="12" text-anchor="end" fill="${color}">${curve.label}: ${last.solved} (${last.pct.toFixed(1)}%)</text>`;
        legend += `<rect x="${mL + 12}" y="${mT + 10 + ci * 20}" width="18" height="4" fill="${color}"/>` +
            `<text x="${mL + 36}" y="${mT + 16 + ci * 20}" font-size="12" fill="#333">${curve.label}</text>`;
    });
    const playable = curves[0].playable;
    const meta = options.chartMeta || curves[0].meta || {};
    const corpusLabel = meta.corpus ? path.basename(meta.corpus) : 'saved runs';
    const subtitle = meta.generated_at
        ? `${corpusLabel}, max ${options.maxMs}ms, generated ${meta.generated_at.slice(0, 19)}`
        : `${corpusLabel}, max ${options.maxMs}ms`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="sans-serif">
<rect width="${W}" height="${H}" fill="white"/>
${grid}
${lines}
${legend}
<line x1="${mL}" y1="${mT + plotH}" x2="${mL + plotW}" y2="${mT + plotH}" stroke="#333"/>
<line x1="${mL}" y1="${mT}" x2="${mL}" y2="${mT + plotH}" stroke="#333"/>
<text x="${W / 2}" y="18" font-size="14" text-anchor="middle">Cumulative levels solved vs timeout (${playable} playable levels)</text>
<text x="${W / 2}" y="36" font-size="11" text-anchor="middle" fill="#666">${subtitle}</text>
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

        if (options.withPsplus && !options.fromJson) {
            const psplusRaw = runCorpus(options, 'PS+');
            const psplusPayload = unwrapPayload(psplusRaw);
            const psplusLevels = flattenLevels(psplusPayload);
            const psplusMeta = curveMetaFromOptions(options, 'PS+', buildCurve(psplusLevels, options).playable);
            if (options.saveJsonPsplus) {
                writePayloadFile(options.saveJsonPsplus, psplusPayload, psplusMeta);
            }
            curves.push({ label: 'PS+', meta: psplusMeta, ...buildCurve(psplusLevels, options) });
        }

        if (options.withCpp && !options.fromJson) {
            const cppRaw = runNativeCorpus(options);
            const cppPayload = unwrapPayload(cppRaw);
            const cppLevels = flattenLevels(cppPayload);
            const cppMeta = curveMetaFromOptions(options, 'c++', buildCurve(cppLevels, options).playable);
            if (options.saveJsonCpp) {
                writePayloadFile(options.saveJsonCpp, cppPayload, cppMeta);
            }
            curves.push({ label: 'c++', meta: cppMeta, ...buildCurve(cppLevels, options) });
        }
    }
    process.stdout.write(renderAscii(curves));
    fs.mkdirSync(path.dirname(options.outCsv), { recursive: true });
    fs.writeFileSync(options.outCsv, 'series,timeout_ms,solved,pct\n' +
        curves.flatMap((c) => c.points.map((p) => `${c.label},${p.timeout_ms},${p.solved},${p.pct.toFixed(2)}`)).join('\n') + '\n');
    fs.writeFileSync(options.outSvg, renderSvg(curves, options));
    process.stderr.write(`wrote ${options.outCsv} and ${options.outSvg}\n`);
}

main();
