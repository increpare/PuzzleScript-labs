#!/usr/bin/env node
'use strict';

// Replay an input sequence on a PuzzleScript game file using the JS solver engine
// path (stepSolverAction). Exit 1 if the sequence wins the level, 0 otherwise.
//
// Usage:
//   node src/tests/replay_solution.js <game.txt> <level> right,right,action
//   node src/tests/replay_solution.js <game.txt> <level> -- right right action
//   node src/tests/replay_solution.js <game.txt> <level> --solution-json '["right"]'
//   node src/tests/replay_solution.js <game.txt> <level> right --json
//
// Tokens: up, left, down, right, action

const { replaySolutionOnGameFile } = require('./run_solver_tests_js');

const VALID_TOKENS = new Set(['up', 'left', 'down', 'right', 'action']);

function usage(exitCode) {
    const message = [
        'Usage: node src/tests/replay_solution.js <game.txt> <level> [inputs...]',
        '       node src/tests/replay_solution.js <game.txt> <level> --inputs right,right,action',
        '       node src/tests/replay_solution.js <game.txt> <level> --solution-json \'["right"]\'',
        '  --json   print JSON result to stdout',
        '  Exit code: 1 if solved, 0 otherwise',
    ].join('\n');
    (exitCode === 0 ? process.stdout : process.stderr).write(`${message}\n`);
    process.exit(exitCode);
}

function parseLevel(value) {
    const level = Number.parseInt(value, 10);
    if (!Number.isInteger(level) || level < 0) {
        throw new Error(`level must be a non-negative integer: ${value}`);
    }
    return level;
}

function normalizeToken(token) {
    const normalized = String(token).trim().toLowerCase();
    if (!VALID_TOKENS.has(normalized)) {
        throw new Error(`unknown input token: ${token}`);
    }
    return normalized;
}

function parseCommaSeparatedInputs(value) {
    return String(value)
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map(normalizeToken);
}

function parseArgs(argv) {
    const options = {
        gamePath: null,
        level: null,
        solution: [],
        json: false,
    };
    const args = argv.slice(2);
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--help' || arg === '-h') {
            usage(0);
        } else if (arg === '--json') {
            options.json = true;
        } else if (arg === '--inputs' && index + 1 < args.length) {
            options.solution.push(...parseCommaSeparatedInputs(args[++index]));
        } else if (arg === '--solution-json' && index + 1 < args.length) {
            const parsed = JSON.parse(args[++index]);
            if (!Array.isArray(parsed)) {
                throw new Error('--solution-json must be a JSON array of input tokens');
            }
            options.solution.push(...parsed.map(normalizeToken));
        } else if (arg === '--') {
            options.solution.push(...args.slice(index + 1).map(normalizeToken));
            break;
        } else if (options.gamePath === null) {
            options.gamePath = arg;
        } else if (options.level === null) {
            options.level = parseLevel(arg);
        } else if (arg.includes(',')) {
            options.solution.push(...parseCommaSeparatedInputs(arg));
        } else {
            options.solution.push(normalizeToken(arg));
        }
    }
    if (!options.gamePath || options.level === null) {
        usage(1);
    }
    return options;
}

function main() {
    const options = parseArgs(process.argv);
    const replay = replaySolutionOnGameFile(options.gamePath, options.level, options.solution);
    const payload = {
        game: options.gamePath,
        level: options.level,
        solution: options.solution,
        status: replay.status,
        steps: replay.steps,
        solved: replay.status === 'solved',
    };
    if (replay.error) {
        payload.error = replay.error;
    }
    if (options.json) {
        process.stdout.write(`${JSON.stringify(payload)}\n`);
    } else if (replay.status !== 'solved') {
        process.stderr.write(`${replay.status}${replay.error ? `: ${replay.error}` : ''}\n`);
    }
    process.exit(replay.status === 'solved' ? 1 : 0);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`${error && error.message ? error.message : error}\n`);
        process.exit(0);
    }
}

module.exports = {
    parseArgs,
    VALID_TOKENS,
};
