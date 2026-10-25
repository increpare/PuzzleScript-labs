#!/usr/bin/env node
'use strict';

const fs = require('fs');

const { decanonicalizeSemantic } = require('./js/decanonicalize_core');

function parseCanonicalFile(inputPath) {
    return JSON.parse(fs.readFileSync(inputPath, 'utf8'));
}

function main() {
    const args = process.argv.slice(2);
    if (args.length < 1 || args.includes('--help') || args.includes('-h')) {
        console.error('Usage: node src/decanonicalize.js <input.json> [output.ps]');
        console.error('');
        console.error('Rehydrates semantic canonical PuzzleScript JSON into a valid PuzzleScript source file.');
        process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
    }

    const inputFile = args[0];
    const outputFile = args[1];
    const canonical = parseCanonicalFile(inputFile);
    const source = decanonicalizeSemantic(canonical);

    if (outputFile) {
        fs.writeFileSync(outputFile, source, 'utf8');
    } else {
        process.stdout.write(source);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    decanonicalizeSemantic,
};
