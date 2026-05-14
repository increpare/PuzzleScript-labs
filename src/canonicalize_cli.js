#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const {
    buildComparisonHashes,
    canonicalizeFile,
    stableStringify,
} = require('./canonicalize');

function printUsage(exitCode) {
    console.error('Usage: node src/canonicalize_cli.js <input.ps> [output.json] [--mode structural|full|no-levels|mechanics|ruleset|semantic|family] [--static-opt [all|inert,cosmetic,cosmetic-rules,merge]] [--hashes]');
    console.error('');
    console.error('Writes a canonical JSON representation of a PuzzleScript game.');
    console.error('Default mode is "semantic": gameplay metadata + player/background roles + collision layers + compiled rules + compiled maps.');
    console.error('--static-opt applies the static optimizer before compiled canonical modes are serialized.');
    process.exit(exitCode);
}

const args = process.argv.slice(2);
if (args.length < 1 || args.includes('--help') || args.includes('-h')) {
    printUsage(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

const positional = [];
let mode = 'semantic';
let hashes = false;
let staticOptimizations = false;

for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--mode') {
        mode = args[i + 1];
        i++;
    } else if (arg === '--static-opt' || arg === '--optimize-static') {
        const next = args[i + 1];
        if (next && !next.startsWith('-')) {
            staticOptimizations = next;
            i++;
        } else {
            staticOptimizations = 'all';
        }
    } else if (arg.startsWith('--static-opt=')) {
        staticOptimizations = arg.slice('--static-opt='.length) || 'all';
    } else if (arg === '--hashes') {
        hashes = true;
    } else if (!arg.startsWith('-')) {
        positional.push(arg);
    }
}

const inputFile = positional[0];
const outputFile = positional[1];

if (!inputFile) {
    printUsage(1);
}
if (!fs.existsSync(inputFile)) {
    console.error(`Error: input file not found: ${inputFile}`);
    process.exit(1);
}

try {
    const options = { staticOptimizations };
    const canonical = canonicalizeFile(inputFile, mode, options);
    const serialized = stableStringify(canonical) + '\n';

    if (outputFile) {
        fs.writeFileSync(outputFile, serialized, 'utf8');
    } else {
        process.stdout.write(serialized);
    }

    if (hashes) {
        const source = fs.readFileSync(inputFile, 'utf8');
        const summary = {
            file: path.resolve(inputFile),
            hashes: buildComparisonHashes(source, options)
        };
        console.error(JSON.stringify(summary, null, 2));
    }
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
