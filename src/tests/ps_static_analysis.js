#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { compileSemanticSource, validateCompileSource } = require('../canonicalize');

const { SCHEMA, analyzeCompiledState, emptyFacts } = require('../js/static_analysis');

function analyzeSource(source, options = {}) {
    const sourcePath = options.sourcePath || '<memory>';
    const sourceInfo = { path: sourcePath };
    if (options.includeSourceText === true) sourceInfo.text = source;
    let compiled;
    try {
        compiled = compileSemanticSource(source, {
            includeWinConditions: true,
            throwOnError: false,
        });
    } catch (error) {
        return {
            schema: SCHEMA,
            source: sourceInfo,
            status: 'compile_error',
            errors: [error && error.message ? error.message : String(error)],
            ps_tagged: null,
            facts: emptyFacts(),
            summary: { proved: 0, candidate: 0, rejected: 0 },
        };
    }

    if (compiled.errorCount > 0 || compiled.state === null || compiled.state.invalid) {
        return {
            schema: SCHEMA,
            source: sourceInfo,
            status: 'compile_error',
            errors: compiled.errorStrings.slice(),
            ps_tagged: null,
            facts: emptyFacts(),
            summary: { proved: 0, candidate: 0, rejected: 0 },
        };
    }

    // The semantic compile stops before rulesToMask, so it accepts some games
    // the real engine rejects (e.g. same-cell overlap writes). Run the
    // full-engine validation gate and refuse to analyze anything the engine
    // would reject at compile time. See STATIC_ANALYSIS_SOUNDNESS.md.
    let validation;
    try {
        validation = validateCompileSource(source, { includeWinConditions: true });
    } catch (error) {
        return {
            schema: SCHEMA,
            source: sourceInfo,
            status: 'compile_error',
            errors: [error && error.message ? error.message : String(error)],
            ps_tagged: null,
            facts: emptyFacts(),
            summary: { proved: 0, candidate: 0, rejected: 0 },
        };
    }
    if (!validation.ok) {
        return {
            schema: SCHEMA,
            source: sourceInfo,
            status: 'compile_error',
            errors: validation.errorStrings.slice(),
            ps_tagged: null,
            facts: emptyFacts(),
            summary: { proved: 0, candidate: 0, rejected: 0 },
        };
    }

    return analyzeCompiledState(compiled.state, Object.assign({}, options, { sourcePath, sourceText: source }));
}

function analyzeFile(filePath, options = {}) {
    const resolved = path.resolve(filePath);
    const source = fs.readFileSync(resolved, 'utf8');
    return analyzeSource(source, Object.assign({}, options, { sourcePath: filePath }));
}

function discoverInputFiles(inputs) {
    const files = [];
    for (const input of inputs) {
        const stat = fs.statSync(input);
        if (stat.isDirectory()) {
            for (const entry of fs.readdirSync(input).sort()) {
                const fullPath = path.join(input, entry);
                if (fs.statSync(fullPath).isFile() && fullPath.endsWith('.txt')) {
                    files.push(fullPath);
                }
            }
        } else {
            files.push(input);
        }
    }
    return files;
}

function analyzePaths(inputs, options = {}) {
    return discoverInputFiles(inputs)
        .filter(filePath => !options.gameFilter || filePath.toLowerCase().includes(options.gameFilter.toLowerCase()))
        .map(filePath => analyzeFile(filePath, options));
}

module.exports = {
    SCHEMA,
    analyzeFile,
    analyzePaths,
    analyzeSource,
    analyzeCompiledState,
    discoverInputFiles,
};
