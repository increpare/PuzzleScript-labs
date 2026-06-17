#!/usr/bin/env node
'use strict';

// Compare two solver-timeout-curve JSON runs (e.g. original vs canonical).
//
// Usage:
//   node src/tests/compare_solver_timeout_curve_json.js \
//     build/solver-timeout-curve/js.json \
//     build/solver-timeout-curve/js-canonical.json

const fs = require('fs');
const path = require('path');

function usage(exitCode) {
    const message = [
        'Usage: node src/tests/compare_solver_timeout_curve_json.js <orig.json> <canonical.json> [options]',
        '  --max-ms N     Compare at this timeout threshold (default: meta.max_ms or 1000)',
        '  --json         Print JSON summary',
    ].join('\n');
    (exitCode === 0 ? process.stdout : process.stderr).write(`${message}\n`);
    process.exit(exitCode);
}

function parseArgs(argv) {
    const options = {
        origPath: null,
        canonPath: null,
        maxMs: null,
        json: false,
    };
    const args = argv.slice(2);
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--help' || arg === '-h') {
            usage(0);
        } else if (arg === '--max-ms' && index + 1 < args.length) {
            options.maxMs = Math.max(1, Number.parseInt(args[++index], 10) || 1000);
        } else if (arg === '--json') {
            options.json = true;
        } else if (!options.origPath) {
            options.origPath = path.resolve(arg);
        } else if (!options.canonPath) {
            options.canonPath = path.resolve(arg);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    if (!options.origPath || !options.canonPath) {
        usage(1);
    }
    return options;
}

function loadResults(jsonPath) {
    const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const results = payload.results || payload;
    const byKey = new Map();
    for (const result of results) {
        if (result.level < 0) {
            continue;
        }
        byKey.set(`${result.game}#${result.level}`, result);
    }
    return { payload, byKey };
}

function solvedAt(result, maxMs) {
    return result.status === 'solved' && Number.isFinite(result.elapsed_ms) && result.elapsed_ms <= maxMs;
}

function compareSolverJson(origPath, canonPath, options = {}) {
    const orig = loadResults(origPath);
    const canon = loadResults(canonPath);
    const maxMs = options.maxMs
        ?? orig.payload.meta?.max_ms
        ?? canon.payload.meta?.max_ms
        ?? 1000;
    const keys = new Set([...orig.byKey.keys(), ...canon.byKey.keys()]);
    const gained = [];
    const lost = [];
    const changed = [];
    const byGame = new Map();
    for (const key of keys) {
        const left = orig.byKey.get(key);
        const right = canon.byKey.get(key);
        const leftSolved = left ? solvedAt(left, maxMs) : false;
        const rightSolved = right ? solvedAt(right, maxMs) : false;
        if (leftSolved === rightSolved) {
            continue;
        }
        const [game, levelText] = key.split('#');
        const level = Number.parseInt(levelText, 10);
        const entry = {
            game,
            level,
            orig_status: left ? left.status : 'missing',
            canon_status: right ? right.status : 'missing',
            orig_elapsed_ms: left ? left.elapsed_ms : null,
            canon_elapsed_ms: right ? right.elapsed_ms : null,
            orig_strategy: left ? left.strategy : null,
            canon_strategy: right ? right.strategy : null,
        };
        changed.push(entry);
        if (!byGame.has(game)) {
            byGame.set(game, { gained: 0, lost: 0, levels: [] });
        }
        const gameEntry = byGame.get(game);
        gameEntry.levels.push(entry);
        if (!leftSolved && rightSolved) {
            gained.push(entry);
            gameEntry.gained++;
        } else {
            lost.push(entry);
            gameEntry.lost++;
        }
    }
    const origSolved = [...orig.byKey.values()].filter((result) => solvedAt(result, maxMs)).length;
    const canonSolved = [...canon.byKey.values()].filter((result) => solvedAt(result, maxMs)).length;
    const gamesWithFlips = [...byGame.entries()]
        .filter(([, stats]) => stats.gained > 0 || stats.lost > 0)
        .sort((a, b) => (b[1].gained + b[1].lost) - (a[1].gained + a[1].lost));
    return {
        origPath,
        canonPath,
        max_ms: maxMs,
        orig_solved: origSolved,
        canon_solved: canonSolved,
        net: canonSolved - origSolved,
        flip_count: changed.length,
        gained_count: gained.length,
        lost_count: lost.length,
        games_with_flips: gamesWithFlips.length,
        gained,
        lost,
        changed,
        by_game: Object.fromEntries(gamesWithFlips),
    };
}

function printHuman(summary) {
    process.stdout.write(`compare_solver_timeout_curve_json max_ms=${summary.max_ms}\n`);
    process.stdout.write(`  orig solved: ${summary.orig_solved}\n`);
    process.stdout.write(`  canon solved: ${summary.canon_solved}\n`);
    process.stdout.write(`  net: ${summary.net >= 0 ? '+' : ''}${summary.net}\n`);
    process.stdout.write(`  flips: ${summary.flip_count} (${summary.gained_count} gained, ${summary.lost_count} lost) across ${summary.games_with_flips} games\n`);
    if (summary.gained.length > 0) {
        process.stdout.write('\nCanonical gained:\n');
        for (const entry of summary.gained.sort((a, b) => a.game.localeCompare(b.game) || a.level - b.level)) {
            process.stdout.write(`  + ${entry.game}#${entry.level} (${entry.orig_status} -> ${entry.canon_status}, ${entry.canon_elapsed_ms}ms)\n`);
        }
    }
    if (summary.lost.length > 0) {
        process.stdout.write('\nCanonical lost:\n');
        for (const entry of summary.lost.sort((a, b) => a.game.localeCompare(b.game) || a.level - b.level)) {
            process.stdout.write(`  - ${entry.game}#${entry.level} (${entry.orig_status} -> ${entry.canon_status}, orig ${entry.orig_elapsed_ms}ms)\n`);
        }
    }
}

function main() {
    const options = parseArgs(process.argv);
    const summary = compareSolverJson(options.origPath, options.canonPath, options);
    if (options.json) {
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
        printHuman(summary);
    }
}

module.exports = {
    parseArgs,
    compareSolverJson,
    solvedAt,
};

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
        process.exit(2);
    }
}
