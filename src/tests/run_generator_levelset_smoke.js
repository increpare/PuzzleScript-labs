#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { compileGameFile, replaySolutionOnCurrentCompiledState } = require('./run_solver_tests_js');

if (process.argv.length < 3) {
    console.error('Usage: node src/tests/run_generator_levelset_smoke.js <puzzlescript_generator> [game.txt] [spec.gen]');
    process.exit(2);
}

const generatorPath = path.resolve(process.argv[2]);
const repoRoot = path.resolve(__dirname, '..', '..');
const gamePath = path.resolve(process.argv[3] || path.join(repoRoot, 'src/demo/sokoban_basic.txt'));
const specPath = path.resolve(process.argv[4] || path.join(__dirname, 'generator_presets/sokoban_levelset_tiny.gen'));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psgen-levelset-smoke-'));
const outPath = path.join(tempDir, 'generated_game.txt');

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
    assert.ok(fs.existsSync(specPath), `spec fixture not found: ${specPath}`);

    const commonArgs = [
        gamePath,
        specPath,
        '--out', outPath,
        '--jobs', '1',
        '--seed', '7',
    '--solver-timeout-ms', '2000',
    '--inactivity-start', '500ms',
        '--dedupe-max', '4096',
    ];

  const firstRun = await runGeneratorUntilStopped(commonArgs, 12000);
  assert.ok(fs.existsSync(outPath), 'generator should create --out file');

  let generatedSource = fs.readFileSync(outPath, 'utf8');
  let levels = parseGeneratedLevels(generatedSource);
  if (levels.length === 0) {
    const secondRun = await runGeneratorUntilStopped(commonArgs, 20000);
    assert.ok(
      secondRun.code === 0 || secondRun.signal === 'SIGTERM',
      `generator should exit cleanly on SIGTERM\nstdout:\n${secondRun.stdout}\nstderr:\n${secondRun.stderr}`
    );
    generatedSource = fs.readFileSync(outPath, 'utf8');
    levels = parseGeneratedLevels(generatedSource);
  }
    assert.ok(levels.length > 0, 'generated game should contain at least one level');

    const compiled = compileGameFile(outPath, { quiet: true });

    let parsedIndex = 0;
    for (let levelIndex = 0; levelIndex < state.levels.length && parsedIndex < levels.length; levelIndex++) {
        if (state.levels[levelIndex].message !== undefined) {
            continue;
        }
        const replay = replaySolutionOnCurrentCompiledState(compiled.game, levelIndex, levels[parsedIndex].solution);
        assert.strictEqual(
            replay.status,
            'solved',
            `solution replay failed for generated level ${parsedIndex} (compiled index ${levelIndex}): ${replay.status}${replay.error ? ` (${replay.error})` : ''}`
        );
        parsedIndex += 1;
    }
    assert.strictEqual(parsedIndex, levels.length, 'every parsed generated level should replay on a compiled grid level');

    const crashOutPath = path.join(tempDir, 'generated_game_crash.txt');
    const crashRun = spawn(generatorPath, [
        ...commonArgs.slice(0, -1),
        crashOutPath,
        '--seed', '9',
    ], { stdio: 'ignore' });

    await new Promise((resolve) => setTimeout(resolve, 2500));
    crashRun.kill('SIGTERM');
    await new Promise((resolve) => {
        crashRun.on('close', resolve);
    });

    assert.ok(fs.existsSync(crashOutPath), 'SIGTERM should leave a valid output file');
    compileGameFile(crashOutPath, { quiet: true });

    console.log('generator_levelset_smoke passed');
}

main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
});
