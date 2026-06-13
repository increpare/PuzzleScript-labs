#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { canonicalizeSource } = require('../canonicalize');
const { decanonicalizeSemantic } = require('../decanonicalize');

function usage() {
    console.error('Usage: node src/tests/run_solver_portfolio_regression.js <puzzlescript_solver> [solver_tests_dir]');
    process.exit(1);
}

if (process.argv.length < 3) {
    usage();
}

const solverPath = path.resolve(process.argv[2]);
const sourceCorpus = path.resolve(process.argv[3] || 'src/tests/solver_tests');
const timeoutMs = 1000;
const targets = [
    {
        game: 'limerick.txt',
        level: 3,
        canonicalRoundTrip: true,
        requireJsSolved: true,
        expectCompactNodeStorage: true,
    },
    {
        game: 'kettle.txt',
        level: 25,
        canonicalRoundTrip: false,
        requireJsSolved: false,
    },
    {
        game: 'Legend of Swixero.txt',
        level: 5,
        canonicalRoundTrip: true,
        requireJsSolved: true,
        maxExpanded: 5000,
    },
    {
        game: 'Varifocal Nightmare.txt',
        level: 9,
        canonicalRoundTrip: false,
        requireJsSolved: true,
        nativeArgs: ['--compact-node-storage'],
    },
    {
        game: 'Pushy-V Pully-H.txt',
        level: 15,
        canonicalRoundTrip: false,
        requireJsSolved: false,
        maxExpanded: 5000,
    },
];

function runJson(command, args, label) {
    const result = spawnSync(command, args, {
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
    });
    if (result.error) {
        throw new Error(`${label} failed to run: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(`${label} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    }
    try {
        return JSON.parse(result.stdout);
    } catch (error) {
        throw new Error(`${label} did not emit JSON: ${error.message}\nstdout:\n${result.stdout}`);
    }
}

function solveWithJs(corpusDir, target) {
    return runJson(process.execPath, [
        path.join(__dirname, 'run_solver_tests_js.js'),
        corpusDir,
        '--timeout-ms', String(timeoutMs),
        '--strategy', 'portfolio',
        '--game', target.game,
        '--level', String(target.level),
        '--no-solutions',
        '--quiet',
        '--json',
    ], 'JS solver').results[0];
}

function solveWithNative(corpusDir, target) {
    return runJson(solverPath, [
        corpusDir,
        '--timeout-ms', String(timeoutMs),
        '--jobs', '1',
        '--strategy', 'portfolio',
        '--game', target.game,
        '--level', String(target.level),
        '--no-solutions',
        '--quiet',
        '--json',
        ...(target.nativeArgs || []),
    ], 'native solver').results[0];
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-portfolio-regression-'));
try {
    const passed = [];
    for (const target of targets) {
        const sourcePath = path.join(sourceCorpus, target.game);
        const source = fs.readFileSync(sourcePath, 'utf8');
        const corpusDir = target.canonicalRoundTrip ? path.join(workDir, `${target.game}-${target.level}`) : sourceCorpus;
        if (target.canonicalRoundTrip) {
            fs.mkdirSync(corpusDir, { recursive: true });
            const canonical = canonicalizeSource(source, 'semantic', { sourcePath });
            const roundTripped = decanonicalizeSemantic(canonical);
            fs.writeFileSync(path.join(corpusDir, target.game), roundTripped);
        }

        const js = target.requireJsSolved ? solveWithJs(corpusDir, target) : null;
        if (target.requireJsSolved && (!js || js.status !== 'solved')) {
            throw new Error(
                `regression fixture invalid: JS ${target.game}#${target.level} status ${js && js.status}, expected solved`
            );
        }

        const native = solveWithNative(corpusDir, target);
        if (!native || native.status !== 'solved') {
            const label = target.requireJsSolved ? 'canonical JS-solved' : 'native regression';
            throw new Error(
                `native portfolio missed ${label} ${target.game}#${target.level}: ` +
                `status=${native && native.status} elapsed_ms=${native && native.elapsed_ms} ` +
                `expanded=${native && native.expanded} heuristic=${native && native.heuristic}`
            );
        }
        if (target.maxExpanded !== undefined && native.expanded > target.maxExpanded) {
            throw new Error(
                `native portfolio over-expanded ${target.game}#${target.level}: ` +
                `expanded=${native.expanded}, expected <= ${target.maxExpanded}; ` +
                `elapsed_ms=${native.elapsed_ms} strategy=${native.strategy} heuristic=${native.heuristic}`
            );
        }
        if (target.expectCompactNodeStorage && !native.compact_node_storage) {
            throw new Error(
                `native portfolio did not use compact node storage for ${target.game}#${target.level}: ` +
                `strategy=${native.strategy} compact_node_storage=${native.compact_node_storage}`
            );
        }
        passed.push(
            `${target.game}#${target.level}` +
            `${js ? ` js_ms=${js.elapsed_ms}` : ''}` +
            ` native_ms=${native.elapsed_ms} native_strategy=${native.strategy}` +
            `${target.nativeArgs ? ` native_args=${target.nativeArgs.join(',')}` : ''}`
        );
    }

    process.stdout.write(`solver_portfolio_regression passed ${passed.join('; ')}\n`);
} finally {
    fs.rmSync(workDir, { recursive: true, force: true });
}
