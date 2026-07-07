#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { compileGameFile, replaySolutionOnCurrentCompiledState } = require('./run_solver_tests_js');

if (process.argv.length < 3) {
    console.error('Usage: node src/tests/run_generator_remix_smoke.js <puzzlescript_generator> [game.txt]');
    process.exit(2);
}

const generatorPath = path.resolve(process.argv[2]);
const repoRoot = path.resolve(__dirname, '..', '..');
const gamePath = path.resolve(process.argv[3] || path.join(repoRoot, 'src/demo/sokoban_basic.txt'));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psgen-remix-smoke-'));
const outPath = path.join(tempDir, 'remixed_game.txt');
const templatePath = path.join(tempDir, 'remixed_game.template.txt');
const solverTimeoutMs = process.env.PS_GENERATOR_SMOKE_SOLVER_TIMEOUT_MS || '2000';
const timeScale = Number(process.env.PS_GENERATOR_SMOKE_TIME_SCALE || '1');

const COMPACT_TO_TOKEN = {
    U: 'up',
    D: 'down',
    L: 'left',
    R: 'right',
    A: 'action',
};

function parseSolutionComment(line) {
    const match = line.match(/^\(solution:\s*([^)]+)\)$/);
    if (!match) {
        return null;
    }
    const compact = match[1].replace(/\s+/g, '');
    const solution = [];
    for (const ch of compact) {
        const token = COMPACT_TO_TOKEN[ch];
        assert.ok(token, `unknown compact solution character: ${ch}`);
        solution.push(token);
    }
    return solution;
}

function parseGeneratedLevels(source) {
    const lines = source.split(/\r?\n/);
    const levelsIndex = lines.findIndex((line) => line.trim().toLowerCase() === 'levels');
    assert.ok(levelsIndex >= 0, 'generated game should contain LEVELS section');

    const levels = [];
    let index = levelsIndex + 1;
    while (index < lines.length && /^=+$/.test(lines[index].trim())) {
        index += 1;
    }

    while (index < lines.length) {
        while (index < lines.length && lines[index].trim() === '') {
            index += 1;
        }
        if (index >= lines.length) {
            break;
        }
        if (/^[A-Z_]+$/i.test(lines[index].trim()) && lines[index].trim().toLowerCase() !== 'message') {
            break;
        }

        const blockComment = lines[index].trim();
        if (!blockComment.startsWith('(block:')) {
            index += 1;
            continue;
        }
        index += 1;
        assert.ok(index < lines.length, 'level missing solution comment');
        const solution = parseSolutionComment(lines[index].trim());
        assert.ok(solution, 'level missing solution comment');
        index += 1;

        const rows = [];
        while (index < lines.length) {
            const row = lines[index];
            if (row.trim() === '') {
                index += 1;
                break;
            }
            if (row.trim().startsWith('(block:') || /^[A-Z_]+$/i.test(row.trim())) {
                break;
            }
            rows.push(row);
            index += 1;
        }
        assert.ok(rows.length > 0, 'generated level should contain row data');
        levels.push({ solution, rows });
    }

    return levels;
}

function countTemplatizedBlocks(gamePath) {
    const result = spawnSync(generatorPath, [gamePath, '--templatize'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.strictEqual(result.status, 0, `templatize failed:\n${result.stderr || result.stdout}`);
    return (result.stdout.match(/^dimensions:/gm) || []).length;
}

function runGeneratorUntilStopped(args, stopAfterMs) {
    return new Promise((resolve, reject) => {
        const child = spawn(generatorPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });

        const timer = setTimeout(() => {
            child.kill('SIGTERM');
        }, stopAfterMs);

        child.on('error', reject);
        child.on('close', (code, signal) => {
            clearTimeout(timer);
            resolve({ code, signal, stdout, stderr });
        });
    });
}

async function main() {
    assert.ok(fs.existsSync(generatorPath), `generator binary not found: ${generatorPath}`);
    assert.ok(fs.existsSync(gamePath), `game fixture not found: ${gamePath}`);

    const expectedPlayableLevels = countTemplatizedBlocks(gamePath);
    assert.ok(expectedPlayableLevels > 0, 'fixture should contain playable levels');

    const commonArgs = [
        gamePath,
        '--remix',
        '--out', outPath,
        '--jobs', '1',
        '--seed', '11',
        '--solver-timeout-ms', solverTimeoutMs,
        '--inactivity-start', '500ms',
        '--dedupe-max', '4096',
    ];

    const firstRun = await runGeneratorUntilStopped(commonArgs, Math.ceil(15000 * timeScale));
    assert.ok(fs.existsSync(outPath), 'remix should create --out file');
    assert.ok(fs.existsSync(templatePath), 'remix should create .template.txt beside --out');
    const templateSource = fs.readFileSync(templatePath, 'utf8');
    assert.strictEqual(
        (templateSource.match(/^dimensions:/gm) || []).length,
        expectedPlayableLevels,
        'template file should contain one block per playable level'
    );

    let generatedSource = fs.readFileSync(outPath, 'utf8');
    let levels = parseGeneratedLevels(generatedSource);
    if (levels.length < expectedPlayableLevels) {
        const secondRun = await runGeneratorUntilStopped(commonArgs, Math.ceil(25000 * timeScale));
        assert.ok(
            secondRun.code === 0 || secondRun.signal === 'SIGTERM',
            `remix should exit cleanly on SIGTERM\nstdout:\n${secondRun.stdout}\nstderr:\n${secondRun.stderr}`
        );
        generatedSource = fs.readFileSync(outPath, 'utf8');
        levels = parseGeneratedLevels(generatedSource);
    }

    assert.ok(levels.length > 0, 'remixed game should contain at least one generated level');
    assert.ok(
        levels.length <= expectedPlayableLevels,
        `remix should emit at most one generated level per original playable level (got ${levels.length}, expected <= ${expectedPlayableLevels})`
    );

    const compiled = compileGameFile(outPath, { quiet: true });
    for (let parsedIndex = 0; parsedIndex < levels.length; parsedIndex++) {
        const replay = replaySolutionOnCurrentCompiledState(compiled.game, parsedIndex, levels[parsedIndex].solution);
        assert.strictEqual(
            replay.status,
            'solved',
            `solution replay failed for remixed level ${parsedIndex}: ${replay.status}${replay.error ? ` (${replay.error})` : ''}`
        );
    }

    console.log('generator_remix_smoke passed');
}

main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
});
