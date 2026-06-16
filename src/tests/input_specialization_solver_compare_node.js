#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const RUNNER = path.join(__dirname, 'run_solver_tests_js.js');

function usage() {
    process.stderr.write(
        'Usage: node src/tests/input_specialization_solver_compare_node.js <corpus_dir> [runner args...]\n',
    );
    process.exit(2);
}

function resultKey(result) {
    return `${result.game}\u0000${result.level}`;
}

function runSolver(corpus, runnerArgs, enabled) {
    const env = {
        ...process.env,
        PUZZLESCRIPT_INPUT_SPECIALIZATION: enabled ? '1' : '0',
    };
    const child = spawnSync(
        process.execPath,
        [
            RUNNER,
            corpus,
            ...runnerArgs,
            '--quiet',
            '--json',
            '--solutions-dir',
            path.join('build', 'input-specialized-rule-sets', enabled ? 'solutions-on' : 'solutions-off'),
        ],
        { env, encoding: 'utf8', maxBuffer: 1024 * 1024 * 256 },
    );
    if (child.status !== 0) {
        throw new Error(`solver run failed (${enabled ? 'on' : 'off'}): ${child.stderr || child.stdout}`);
    }
    return JSON.parse(child.stdout);
}

function compareRuns(offJson, onJson) {
    const failures = [];
    const offResults = new Map((offJson.results || []).map(result => [resultKey(result), result]));
    const onResults = new Map((onJson.results || []).map(result => [resultKey(result), result]));

    for (const [key, off] of offResults.entries()) {
        const on = onResults.get(key);
        if (!on) {
            failures.push(`${off.game} level ${off.level}: missing in feature-on run`);
            continue;
        }
        if (off.status === 'solved') {
            if (on.status !== 'solved') {
                failures.push(`${off.game} level ${off.level}: solved off but ${on.status} on`);
                continue;
            }
            const offSolution = JSON.stringify(off.solution || []);
            const onSolution = JSON.stringify(on.solution || []);
            if (offSolution !== onSolution) {
                failures.push(`${off.game} level ${off.level}: solved solution differs`);
            }
            if ((off.expanded || 0) !== (on.expanded || 0)) {
                failures.push(`${off.game} level ${off.level}: expanded differs (${off.expanded || 0} off, ${on.expanded || 0} on)`);
            }
            if ((off.generated || 0) !== (on.generated || 0)) {
                failures.push(`${off.game} level ${off.level}: generated differs (${off.generated || 0} off, ${on.generated || 0} on)`);
            }
        } else if (off.status !== on.status) {
            const allowedImprovement = off.status === 'timeout' && (on.status === 'exhausted' || on.status === 'solved');
            if (!allowedImprovement) {
                failures.push(`${off.game} level ${off.level}: status differs (${off.status} off, ${on.status} on)`);
            }
        }
    }

    return failures;
}

function main(argv = process.argv) {
    const args = argv.slice(2);
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        usage();
    }
    const corpus = args.shift();
    const offJson = runSolver(corpus, args, false);
    const onJson = runSolver(corpus, args, true);
    const failures = compareRuns(offJson, onJson);
    if (failures.length > 0) {
        process.stderr.write('input_specialization_solver_compare_node: failed\n');
        for (const failure of failures) {
            process.stderr.write(`${failure}\n`);
        }
        return 1;
    }
    const offTotals = offJson.totals || {};
    const onTotals = onJson.totals || {};
    process.stdout.write(
        `input_specialization_solver_compare_node: ok levels=${offTotals.levels || 0} ` +
        `solved_off=${offTotals.solved || 0} solved_on=${onTotals.solved || 0} ` +
        `step_ms_off=${Number(offTotals.step_ms || 0).toFixed(3)} ` +
        `step_ms_on=${Number(onTotals.step_ms || 0).toFixed(3)}\n`,
    );
    return 0;
}

if (require.main === module) {
    try {
        process.exitCode = main();
    } catch (error) {
        process.stderr.write(`${error && error.message ? error.message : error}\n`);
        process.exitCode = 1;
    }
}

module.exports = {
    compareRuns,
    main,
    runSolver,
};
