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
//       [--from-json results.json] [--out-svg path] [--out-csv path]
//       [-- extra args passed to run_solver_tests_js.js]
//
// Examples:
//   node src/tests/solver_timeout_curve.js                      # solver_tests, 50..1000ms
//   node src/tests/solver_timeout_curve.js --from-json run.json # re-plot existing run

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
    const options = {
        corpus: 'src/tests/solver_tests',
        maxMs: 1000,
        stepMs: 50,
        fromJson: null,
        outSvg: 'build/solver_timeout_curve.svg',
        outCsv: 'build/solver_timeout_curve.csv',
        passthrough: [],
    };
    const args = argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--max-ms') {
            options.maxMs = Math.max(1, Number.parseInt(args[++i], 10) || 1000);
        } else if (arg === '--step-ms') {
            options.stepMs = Math.max(1, Number.parseInt(args[++i], 10) || 50);
        } else if (arg === '--from-json') {
            options.fromJson = args[++i];
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
    return options;
}

function runCorpus(options) {
    const runnerArgs = [
        path.join(__dirname, 'run_solver_tests_js.js'),
        options.corpus,
        '--timeout-ms', String(options.maxMs),
        '--quiet', '--json', '--no-solutions',
        ...options.passthrough,
    ];
    process.stderr.write(`running corpus at ${options.maxMs}ms timeout (serial; this is the slow part)...\n`);
    const child = spawnSync(process.execPath, runnerArgs, {
        encoding: 'utf8',
        maxBuffer: 1 << 28,
    });
    if (child.status !== 0) {
        throw new Error(`corpus run failed (exit ${child.status}): ${String(child.stderr).slice(0, 500)}`);
    }
    return JSON.parse(child.stdout);
}

function flattenLevels(payload) {
    const out = [];
    for (const entry of (payload.results || payload)) {
        for (const level of (entry.levels || [entry])) {
            out.push(level);
        }
    }
    return out;
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

function renderAscii(curve) {
    const width = 50;
    const max = Math.max(...curve.points.map((p) => p.solved), 1);
    let out = `cumulative solves out of ${curve.playable} playable levels\n`;
    for (const p of curve.points) {
        const bar = '#'.repeat(Math.round(p.solved / max * width));
        out += `${String(p.timeout_ms).padStart(5)}ms |${bar.padEnd(width)}| ${String(p.solved).padStart(4)}  (${p.pct.toFixed(1)}%)\n`;
    }
    return out;
}

function renderSvg(curve, options) {
    const W = 720, H = 420, mL = 60, mR = 20, mT = 30, mB = 45;
    const plotW = W - mL - mR, plotH = H - mT - mB;
    const maxX = options.maxMs;
    const maxY = Math.max(curve.totalSolvedAtMax, 1) * 1.05;
    const x = (ms) => mL + ms / maxX * plotW;
    const y = (n) => mT + plotH - n / maxY * plotH;
    const pts = [[0, 0], ...curve.points.map((p) => [p.timeout_ms, p.solved])];
    const poly = pts.map(([ms, n]) => `${x(ms).toFixed(1)},${y(n).toFixed(1)}`).join(' ');
    let grid = '';
    for (let t = 0; t <= maxX; t += Math.max(options.stepMs * 2, 100)) {
        grid += `<line x1="${x(t)}" y1="${mT}" x2="${x(t)}" y2="${mT + plotH}" stroke="#eee"/>` +
            `<text x="${x(t)}" y="${H - mB + 16}" font-size="11" text-anchor="middle" fill="#555">${t}</text>`;
    }
    const yticks = 6;
    for (let i = 0; i <= yticks; i++) {
        const n = Math.round(maxY / yticks * i);
        grid += `<line x1="${mL}" y1="${y(n)}" x2="${mL + plotW}" y2="${y(n)}" stroke="#eee"/>` +
            `<text x="${mL - 8}" y="${y(n) + 4}" font-size="11" text-anchor="end" fill="#555">${n}</text>`;
    }
    const last = curve.points[curve.points.length - 1];
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="sans-serif">
<rect width="${W}" height="${H}" fill="white"/>
${grid}
<polyline points="${poly}" fill="none" stroke="#2266cc" stroke-width="2.5"/>
<line x1="${mL}" y1="${mT + plotH}" x2="${mL + plotW}" y2="${mT + plotH}" stroke="#333"/>
<line x1="${mL}" y1="${mT}" x2="${mL}" y2="${mT + plotH}" stroke="#333"/>
<text x="${W / 2}" y="18" font-size="14" text-anchor="middle">JS solver: cumulative levels solved vs timeout (${curve.playable} playable levels)</text>
<text x="${W / 2}" y="${H - 8}" font-size="12" text-anchor="middle" fill="#333">timeout (ms)</text>
<text x="${x(last.timeout_ms) - 6}" y="${y(last.solved) - 8}" font-size="12" text-anchor="end" fill="#2266cc">${last.solved} (${last.pct.toFixed(1)}%)</text>
</svg>\n`;
}

function main() {
    const options = parseArgs(process.argv);
    const payload = options.fromJson
        ? JSON.parse(fs.readFileSync(options.fromJson, 'utf8'))
        : runCorpus(options);
    const curve = buildCurve(flattenLevels(payload), options);
    process.stdout.write(renderAscii(curve));
    fs.mkdirSync(path.dirname(options.outCsv), { recursive: true });
    fs.writeFileSync(options.outCsv, 'timeout_ms,solved,pct\n' +
        curve.points.map((p) => `${p.timeout_ms},${p.solved},${p.pct.toFixed(2)}`).join('\n') + '\n');
    fs.writeFileSync(options.outSvg, renderSvg(curve, options));
    process.stderr.write(`wrote ${options.outCsv} and ${options.outSvg}\n`);
}

main();
