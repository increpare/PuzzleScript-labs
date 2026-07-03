#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_REGISTRY_PATH = path.resolve(__dirname, 'solver_benchmark_slices.json');

function usage() {
    process.stderr.write([
        'Usage: node src/tests/generate_solver_benchmark_slice_manifest.js <slice-name>',
        '  [--registry PATH] [--out PATH] [--corpus PATH]',
    ].join('\n') + '\n');
}

function stableHash(seed, value) {
    return crypto.createHash('sha256').update(`${seed}\0${value}`).digest('hex');
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
    const registry = readJson(registryPath);
    if (registry.schema_version !== 1 || !Array.isArray(registry.slices)) {
        throw new Error(`invalid slice registry: ${registryPath}`);
    }
    return registry;
}

function findSlice(registry, name) {
    const slice = registry.slices.find((candidate) => candidate.name === name);
    if (!slice) {
        throw new Error(`unknown benchmark slice: ${name}`);
    }
    return slice;
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
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.txt')) {
                out.push(full);
            }
        }
    }
    return out.sort((left, right) => left.localeCompare(right));
}

function trimLine(line) {
    return line.trim();
}

function isDividerLine(line) {
    const stripped = trimLine(line);
    return stripped.length > 0 && /^=+$/.test(stripped);
}

function isCommentLine(line) {
    const stripped = trimLine(line);
    return stripped.length > 0 && stripped.startsWith('(');
}

function splitLines(source) {
    const normalized = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (normalized.endsWith('\n')) {
        return normalized.slice(0, -1).split('\n');
    }
    return normalized.length > 0 ? normalized.split('\n') : [''];
}

function findSourceLevels(source) {
    const lines = splitLines(source);
    const levels = [];
    let index = lines.findIndex((line) => trimLine(line).toLowerCase() === 'levels');
    if (index < 0) {
        return levels;
    }
    index++;
    let levelIndex = 0;
    while (index < lines.length) {
        const stripped = trimLine(lines[index]);
        const lower = stripped.toLowerCase();
        if (stripped.length === 0 || isDividerLine(lines[index]) || isCommentLine(lines[index])) {
            index++;
            continue;
        }
        if (lower === 'message' || lower.startsWith('message ')) {
            levels.push({ level: levelIndex++, message: true });
            index++;
            continue;
        }
        levels.push({ level: levelIndex++, message: false });
        index++;
        while (index < lines.length && trimLine(lines[index]).length > 0) {
            index++;
        }
    }
    return levels;
}

function firstPlayableLevel(source) {
    const playable = findSourceLevels(source).find((level) => !level.message);
    return playable ? playable.level : 0;
}

function discoverGames(corpusPath) {
    return walkTxtFiles(corpusPath).map((gamePath) => {
        const game = path.relative(corpusPath, gamePath);
        return {
            game,
            path: gamePath,
            source: fs.readFileSync(gamePath, 'utf8'),
        };
    });
}

function seededOrder(items, seed, keyFn) {
    return items.slice().sort((left, right) => {
        const leftKey = keyFn(left);
        const rightKey = keyFn(right);
        const hashCompare = stableHash(seed, leftKey).localeCompare(stableHash(seed, rightKey));
        return hashCompare || leftKey.localeCompare(rightKey);
    });
}

function targetForGame(entry, timeoutMs, reason) {
    return {
        game: entry.game,
        level: firstPlayableLevel(entry.source),
        first_solved_timeout_ms: timeoutMs,
        selection_reason: reason,
    };
}

function materializeSeededGameSample(slice, corpusPath) {
    const selection = slice.selection || {};
    const limit = Number(selection.target_games || selection.target_levels || 0);
    if (!Number.isFinite(limit) || limit <= 0) {
        throw new Error(`${slice.name}: selection target count must be positive`);
    }
    return seededOrder(discoverGames(corpusPath), selection.seed || slice.name, (entry) => entry.game)
        .slice(0, limit)
        .map((entry) => targetForGame(entry, slice.timeout_ms, 'seeded_game_sample'));
}

function hintMatches(entry, hints) {
    const source = entry.source.toLowerCase();
    const game = entry.game.toLowerCase();
    return hints.filter((hint) => source.includes(hint.toLowerCase()) || game.includes(hint.toLowerCase()));
}

function materializeMechanicBiasedSample(slice, corpusPath) {
    const selection = slice.selection || {};
    const limit = Number(selection.target_levels || selection.target_games || 0);
    if (!Number.isFinite(limit) || limit <= 0) {
        throw new Error(`${slice.name}: selection target count must be positive`);
    }
    const hints = Array.isArray(selection.mechanic_hints) ? selection.mechanic_hints : [];
    const games = seededOrder(discoverGames(corpusPath), selection.seed || slice.name, (entry) => entry.game);
    const hinted = [];
    const fallback = [];
    for (const entry of games) {
        const matches = hintMatches(entry, hints);
        if (matches.length > 0) {
            hinted.push({ entry, matches });
        } else {
            fallback.push(entry);
        }
    }
    return hinted.map(({ entry, matches }) =>
        targetForGame(entry, slice.timeout_ms, `mechanic_hint:${matches.join('|')}`)
    ).concat(fallback.map((entry) =>
        targetForGame(entry, slice.timeout_ms, 'seeded_fill')
    )).slice(0, limit);
}

function existingGame(corpusPath, game) {
    const resolved = path.resolve(corpusPath, game);
    const relative = path.relative(corpusPath, resolved);
    return !relative.startsWith('..') && !path.isAbsolute(relative) && fs.existsSync(resolved) && fs.statSync(resolved).isFile();
}

function materializeRankedSample(slice, corpusPath, registryPath) {
    const selection = slice.selection || {};
    const limit = Number(selection.target_levels || selection.target_games || 0);
    if (!Number.isFinite(limit) || limit <= 0) {
        throw new Error(`${slice.name}: selection target count must be positive`);
    }
    const registryDir = path.dirname(registryPath);
    const targets = [];
    const seen = new Set();
    for (const rankingPath of selection.source_rankings || []) {
        const resolved = path.resolve(registryDir, rankingPath);
        if (!fs.existsSync(resolved)) {
            continue;
        }
        const ranking = readJson(resolved);
        for (const target of ranking.targets || []) {
            if (!target || typeof target.game !== 'string' || !Number.isInteger(target.level)) {
                continue;
            }
            if (!existingGame(corpusPath, target.game)) {
                continue;
            }
            const key = `${target.game}\0${target.level}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            targets.push({
                game: target.game,
                level: target.level,
                first_solved_timeout_ms: Number(target.first_solved_timeout_ms || target.timeout_ms || slice.timeout_ms),
                selection_reason: `source_ranking:${path.relative(registryDir, resolved)}`,
            });
            if (targets.length >= limit) {
                return targets;
            }
        }
    }
    if (targets.length >= limit) {
        return targets;
    }
    for (const target of materializeSeededGameSample(slice, corpusPath)) {
        const key = `${target.game}\0${target.level}`;
        if (!seen.has(key)) {
            seen.add(key);
            targets.push(Object.assign({}, target, { selection_reason: 'ranked_fill' }));
            if (targets.length >= limit) {
                return targets;
            }
        }
    }
    return targets;
}

function materializeTargets(slice, corpusPath, registryPath) {
    const selection = slice.selection || {};
    if (selection.type === 'seeded-game-sample') {
        return materializeSeededGameSample(slice, corpusPath);
    }
    if (selection.type === 'seeded-mechanic-biased-level-sample') {
        return materializeMechanicBiasedSample(slice, corpusPath);
    }
    if (selection.type === 'seeded-hard-tail-level-sample') {
        return materializeRankedSample(slice, corpusPath, registryPath);
    }
    throw new Error(`${slice.name}: unsupported selection type: ${selection.type}`);
}

function materializeSlice(name, options = {}) {
    const registryPath = path.resolve(options.registry_path || DEFAULT_REGISTRY_PATH);
    const registry = loadRegistry(registryPath);
    const slice = findSlice(registry, name);
    const corpusPath = path.resolve(options.corpus_path || slice.corpus);
    const targets = materializeTargets(slice, corpusPath, registryPath);
    return {
        schema_version: 1,
        kind: 'solver_benchmark_slice',
        generated_at: options.generated_at || new Date().toISOString(),
        name: slice.name,
        purpose: slice.purpose || '',
        registry: path.relative(process.cwd(), registryPath),
        corpus: path.relative(process.cwd(), corpusPath),
        timeout_ms: slice.timeout_ms,
        selection: slice.selection,
        target_count: targets.length,
        targets,
    };
}

function writeSliceManifest(manifest, outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function parseArgs(argv) {
    const args = argv.slice(2);
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        usage();
        process.exit(args.length === 0 ? 1 : 0);
    }
    const options = {
        name: args.shift(),
        registry_path: DEFAULT_REGISTRY_PATH,
        out_path: null,
        corpus_path: null,
    };
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--registry' && index + 1 < args.length) {
            options.registry_path = path.resolve(args[++index]);
        } else if (arg === '--out' && index + 1 < args.length) {
            options.out_path = path.resolve(args[++index]);
        } else if (arg === '--corpus' && index + 1 < args.length) {
            options.corpus_path = path.resolve(args[++index]);
        } else {
            throw new Error(`unsupported argument: ${arg}`);
        }
    }
    return options;
}

function main(argv = process.argv) {
    const options = parseArgs(argv);
    const manifest = materializeSlice(options.name, options);
    if (options.out_path) {
        writeSliceManifest(manifest, options.out_path);
        process.stdout.write(`generate_solver_benchmark_slice_manifest wrote ${options.out_path} targets=${manifest.targets.length}\n`);
    } else {
        process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    }
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
    materializeSlice,
    writeSliceManifest,
};
