#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function usage() {
    console.error([
        'Usage: node src/tests/generate_solver_corpus_manifest.js <solver_tests_dir> <out.json>',
        '  [--puzzlescript-cpp PATH] [--timeout-ms N] [--strategy NAME]',
        '  [--max-games N] [--max-targets N]',
    ].join('\n'));
    process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 2) {
    usage();
}

const corpusPath = path.resolve(args[0]);
const outPath = path.resolve(args[1]);
let puzzlescriptCpp = path.resolve('build/native/puzzlescript_cpp');
let timeoutMs = 10000;
let strategy = 'weighted-astar';
let maxGames = null;
let maxTargets = null;

function parsePositiveInt(value, label) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${label} must be a positive integer: ${value}`);
    }
    return parsed;
}

for (let index = 2; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--puzzlescript-cpp' && index + 1 < args.length) {
        puzzlescriptCpp = path.resolve(args[++index]);
    } else if (arg === '--timeout-ms' && index + 1 < args.length) {
        timeoutMs = parsePositiveInt(args[++index], '--timeout-ms');
    } else if (arg === '--strategy' && index + 1 < args.length) {
        strategy = args[++index];
    } else if (arg === '--max-games' && index + 1 < args.length) {
        maxGames = parsePositiveInt(args[++index], '--max-games');
    } else if (arg === '--max-targets' && index + 1 < args.length) {
        maxTargets = parsePositiveInt(args[++index], '--max-targets');
    } else {
        usage();
    }
}

function walkTxtFiles(root) {
    const out = [];
    const stack = [root];
    while (stack.length > 0) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
            } else if (entry.isFile() && entry.name.endsWith('.txt')) {
                out.push(full);
            }
        }
    }
    return out.sort((a, b) => a.localeCompare(b));
}

function normalizedSectionName(line) {
    return line.replace(/=/g, '').trim().toUpperCase();
}

function randomRuleHits(gameFile) {
    const knownSections = new Set([
        'OBJECTS',
        'LEGEND',
        'SOUNDS',
        'COLLISIONLAYERS',
        'RULES',
        'WINCONDITIONS',
        'LEVELS',
    ]);
    const lines = fs.readFileSync(gameFile, 'utf8').split(/\r?\n/);
    const hits = [];
    let inRules = false;
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const trimmed = line.trim();
        const section = normalizedSectionName(line);
        if (knownSections.has(section)) {
            inRules = section === 'RULES';
            continue;
        }
        if (!inRules || trimmed.length === 0 || trimmed.startsWith('(')) {
            continue;
        }
        if (/\brandom(?:dir)?\b/i.test(line)) {
            hits.push(index + 1);
        }
    }
    return hits;
}

function levelCountForGame(gameFile) {
    const sourcePath = path.relative(process.cwd(), gameFile);
    const result = spawnSync(
        puzzlescriptCpp,
        ['compile', sourcePath, '--emit-ir-json'],
        {
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
        }
    );
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`compile failed for ${sourcePath}\n${result.stderr || result.stdout}`);
    }
    const ir = JSON.parse(result.stdout);
    const levels = ir.game?.levels;
    if (!Array.isArray(levels) || levels.length === 0) {
        throw new Error(`compile returned no levels for ${sourcePath}`);
    }
    return levels.length;
}

if (!fs.existsSync(puzzlescriptCpp)) {
    throw new Error(`puzzlescript_cpp not found: ${puzzlescriptCpp}`);
}

const allGames = walkTxtFiles(corpusPath);
const eligibleGames = [];
const randomExcluded = [];
for (const gameFile of allGames) {
    const hits = randomRuleHits(gameFile);
    if (hits.length > 0) {
        randomExcluded.push({
            game: path.relative(corpusPath, gameFile),
            hits,
        });
        continue;
    }
    eligibleGames.push(gameFile);
}

let selectedGames = eligibleGames;
if (maxGames !== null) {
    selectedGames = eligibleGames.slice(0, maxGames);
}

const targets = [];
for (let index = 0; index < selectedGames.length; index++) {
    const gameFile = selectedGames[index];
    const game = path.relative(corpusPath, gameFile);
    process.stderr.write(`generate_solver_corpus_manifest ${index + 1}/${selectedGames.length} ${game}\n`);
    const levelCount = levelCountForGame(gameFile);
    for (let level = 0; level < levelCount; level++) {
        targets.push({
            game,
            level,
            timeout_ms: timeoutMs,
        });
        if (maxTargets !== null && targets.length >= maxTargets) {
            break;
        }
    }
    if (maxTargets !== null && targets.length >= maxTargets) {
        break;
    }
}

const manifest = {
    schema_version: 1,
    kind: 'solver_corpus_group',
    generated_at: new Date().toISOString(),
    corpus: corpusPath,
    strategy,
    timeout_ms: timeoutMs,
    random_excluded_games: randomExcluded,
    eligible_game_count: eligibleGames.length,
    selected_game_count: selectedGames.length,
    target_count: targets.length,
    targets,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(
    `generate_solver_corpus_manifest wrote ${outPath}`
    + ` targets=${targets.length}`
    + ` games=${selectedGames.length}/${eligibleGames.length}`
    + ` random_excluded=${randomExcluded.length}\n`
);
