#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { canonicalizeSource, compileSemanticSource } = require('../canonicalize');
const { decanonicalizeSemantic } = require('../decanonicalize');

function usage() {
    process.stderr.write(
        'Usage: node src/tests/write_solver_canonical_corpus.js <sourceCorpusDir> <outDir> [--static-optimizations PASSLIST]\n'
    );
    process.exit(2);
}

function parseArgs(argv) {
    const options = {
        sourceCorpus: null,
        outDir: null,
        staticOptimizations: 'all',
    };
    const args = argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--static-optimizations') {
            options.staticOptimizations = args[++i];
        } else if (options.sourceCorpus === null) {
            options.sourceCorpus = path.resolve(arg);
        } else if (options.outDir === null) {
            options.outDir = path.resolve(arg);
        } else {
            usage();
        }
    }
    if (!options.sourceCorpus || !options.outDir) {
        usage();
    }
    return options;
}

function listCorpusGames(corpusDir) {
    const games = [];
    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile() && entry.name.endsWith('.txt')) {
                games.push(path.relative(corpusDir, full));
            }
        }
    }
    walk(corpusDir);
    return games.sort();
}

function safeOutputPath(root, game) {
    const full = path.resolve(root, game);
    const rel = path.relative(root, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Game path escapes corpus: ${game}`);
    }
    return full;
}

function validateRehydratedSource(game, rehydrated) {
    try {
        compileSemanticSource(rehydrated, { sourcePath: game });
    } catch (error) {
        const detail = String(error.message || error).split('\n').slice(0, 8).join('\n');
        throw new Error(`canonical corpus rehydration failed for ${game}:\n${detail}`);
    }
}

function writeCanonicalSolverCorpus(sourceCorpusDir, outDir, staticOptimizations = 'all') {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    const games = listCorpusGames(sourceCorpusDir);
    if (games.length === 0) {
        throw new Error(`No .txt games found under ${sourceCorpusDir}`);
    }
    for (const game of games) {
        const sourcePath = safeOutputPath(sourceCorpusDir, game);
        const source = fs.readFileSync(sourcePath, 'utf8');
        const canonical = canonicalizeSource(source, 'semantic', {
            staticOptimizations,
            sourcePath: game,
        });
        const rehydrated = decanonicalizeSemantic(canonical);
        validateRehydratedSource(game, rehydrated);
        const outputPath = safeOutputPath(outDir, game);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, rehydrated, 'utf8');
    }
    return games.length;
}

if (require.main === module) {
    const options = parseArgs(process.argv);
    const count = writeCanonicalSolverCorpus(
        options.sourceCorpus,
        options.outDir,
        options.staticOptimizations
    );
    process.stderr.write(`write_solver_canonical_corpus: ${count} games -> ${options.outDir}\n`);
}

module.exports = {
    listCorpusGames,
    validateRehydratedSource,
    writeCanonicalSolverCorpus,
};
