#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const PLAYABLE_STATUSES = new Set(['solved', 'timeout', 'exhausted']);

function buildMixedGameManifest(payload, timeoutMs) {
    if (!payload || !Array.isArray(payload.results)) {
        throw new Error('sibling prior focus manifest: expected top-level results array');
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error('sibling prior focus manifest: timeout must be a positive number');
    }

    const games = new Map();
    for (const result of payload.results) {
        if (!result || typeof result.game !== 'string'
            || !Number.isInteger(result.level) || result.level < 0
            || !PLAYABLE_STATUSES.has(result.status)) {
            continue;
        }
        if (!games.has(result.game)) {
            games.set(result.game, []);
        }
        games.get(result.game).push(result);
    }

    const targets = [];
    let mixedGames = 0;
    for (const [game, results] of games) {
        const hasSolved = results.some((result) => result.status === 'solved');
        const hasUnsolved = results.some((result) => result.status !== 'solved');
        if (!hasSolved || !hasUnsolved) {
            continue;
        }
        mixedGames++;
        for (const result of results) {
            targets.push({ game, level: result.level });
        }
    }
    targets.sort((left, right) =>
        left.game.localeCompare(right.game) || left.level - right.level
    );

    return {
        schema_version: 1,
        purpose: 'TX3 warm-start sibling-solution Markov prior preflight',
        timeout_ms: timeoutMs,
        targets,
        summary: {
            mixed_games: mixedGames,
            targets: targets.length,
        },
    };
}

function parseArgs(argv) {
    const args = argv.slice(2);
    if (args.length < 2) {
        throw new Error('Usage: node src/tests/build_solver_sibling_prior_focus_manifest.js TRAINING_JSON OUT_JSON [--timeout-ms 500]');
    }
    const options = {
        inputPath: path.resolve(args[0]),
        outputPath: path.resolve(args[1]),
        timeoutMs: 500,
    };
    for (let index = 2; index < args.length; index++) {
        if (args[index] === '--timeout-ms' && index + 1 < args.length) {
            options.timeoutMs = Number(args[++index]);
        } else {
            throw new Error(`unsupported argument: ${args[index]}`);
        }
    }
    return options;
}

function main(argv = process.argv) {
    const options = parseArgs(argv);
    const payload = JSON.parse(fs.readFileSync(options.inputPath, 'utf8'));
    const manifest = buildMixedGameManifest(payload, options.timeoutMs);
    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    fs.writeFileSync(options.outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(
        `sibling_prior_focus_manifest games=${manifest.summary.mixed_games} targets=${manifest.summary.targets} output=${options.outputPath}\n`
    );
    return manifest;
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`${error && error.message ? error.message : error}\n`);
        process.exit(1);
    }
}

module.exports = {
    buildMixedGameManifest,
    main,
    parseArgs,
};
