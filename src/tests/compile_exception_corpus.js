#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
    compileSemanticSource,
    validateCompileSource,
} = require('../canonicalize');

const DEFAULT_CPP_TIMEOUT_MS = 120000;

function resolveCppCli(cliPath) {
    if (cliPath) {
        const resolved = path.resolve(cliPath);
        if (!fs.existsSync(resolved)) {
            throw new Error(`C++ compiler CLI not found: ${resolved}`);
        }
        return resolved;
    }
    const candidates = [
        process.env.PUZZLESCRIPT_CPP,
        path.resolve('build/native/puzzlescript_cpp'),
        path.resolve('build/puzzlescript_cpp'),
    ].filter(Boolean);
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    throw new Error('C++ compiler CLI not found (build with make build, or pass --cpp-cli PATH)');
}

function formatThrown(error) {
    return {
        message: error && error.message ? error.message : String(error),
        stack: error && error.stack ? error.stack : null,
    };
}

function tryJsSemanticCompile(source, sourcePath) {
    try {
        compileSemanticSource(source, {
            throwOnError: false,
            sourcePath,
        });
        return null;
    } catch (error) {
        return formatThrown(error);
    }
}

function tryJsValidateCompile(source, sourcePath) {
    try {
        validateCompileSource(source, { sourcePath });
        return null;
    } catch (error) {
        return formatThrown(error);
    }
}

function tryCppCompile(sourcePath, cliPath, timeoutMs = DEFAULT_CPP_TIMEOUT_MS) {
    const result = spawnSync(cliPath, ['compile', sourcePath, '--diagnostics'], {
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error) {
        return {
            message: result.error.code === 'ETIMEDOUT'
                ? `timed out after ${timeoutMs}ms`
                : result.error.message,
            signal: result.error.code === 'ETIMEDOUT' ? 'ETIMEDOUT' : null,
        };
    }
    if (result.status !== 0 || result.signal) {
        return {
            message: `puzzlescript_cpp exited status=${result.status} signal=${result.signal || 'null'}`,
            signal: result.signal,
            stderr: (result.stderr || '').slice(0, 4000),
            stdout: (result.stdout || '').slice(0, 1000),
        };
    }
    return null;
}

function freshStats() {
    return {
        tested: 0,
        readErrors: 0,
        jsSemanticExceptions: 0,
        jsValidateExceptions: 0,
        cppExceptions: 0,
    };
}

function activeJsModes(jsMode) {
    if (jsMode === 'semantic') return ['semantic'];
    if (jsMode === 'validate') return ['validate'];
    if (jsMode === 'both') return ['semantic', 'validate'];
    throw new Error(`--js-mode must be semantic, validate, or both (got ${jsMode})`);
}

function activeCompilers(compiler) {
    if (compiler === 'js') return ['js'];
    if (compiler === 'cpp') return ['cpp'];
    if (compiler === 'both') return ['js', 'cpp'];
    throw new Error(`--compiler must be js, cpp, or both (got ${compiler})`);
}

function auditCompileExceptions(source, game, options) {
    const compilers = activeCompilers(options.compiler);
    const jsModes = activeJsModes(options.jsMode);
    const sourcePath = options.sourcePath || game;
    const failures = [];

    if (compilers.includes('js')) {
        if (jsModes.includes('semantic')) {
            const thrown = tryJsSemanticCompile(source, sourcePath);
            if (thrown) {
                failures.push({
                    phase: 'js_semantic',
                    ...thrown,
                });
            }
        }
        if (jsModes.includes('validate')) {
            const thrown = tryJsValidateCompile(source, sourcePath);
            if (thrown) {
                failures.push({
                    phase: 'js_validate',
                    ...thrown,
                });
            }
        }
    }

    if (compilers.includes('cpp')) {
        const filePath = options.filePath;
        if (!filePath) {
            throw new Error('auditCompileExceptions requires filePath when --compiler includes cpp');
        }
        const thrown = tryCppCompile(filePath, options.cppCli, options.cppTimeoutMs);
        if (thrown) {
            failures.push({
                phase: 'cpp',
                ...thrown,
            });
        }
    }

    return {
        outcome: failures.length === 0 ? 'passed' : 'exception',
        failures,
    };
}

function failureRecord(game, gameIndex, auditResult) {
    if (auditResult.outcome === 'passed') {
        return null;
    }
    const primary = auditResult.failures[0];
    return {
        at: new Date().toISOString(),
        game,
        gameIndex,
        phase: primary.phase,
        failures: auditResult.failures,
        message: primary.message,
        stack: primary.stack || null,
    };
}

function updateStats(stats, auditResult, readError) {
    if (readError) {
        stats.readErrors++;
        return;
    }
    stats.tested++;
    for (const failure of auditResult.failures || []) {
        if (failure.phase === 'js_semantic') stats.jsSemanticExceptions++;
        else if (failure.phase === 'js_validate') stats.jsValidateExceptions++;
        else if (failure.phase === 'cpp') stats.cppExceptions++;
    }
}

function countExceptionFailures(stats) {
    return (stats.jsSemanticExceptions || 0)
        + (stats.jsValidateExceptions || 0)
        + (stats.cppExceptions || 0)
        + (stats.readErrors || 0);
}

module.exports = {
    DEFAULT_CPP_TIMEOUT_MS,
    activeCompilers,
    activeJsModes,
    auditCompileExceptions,
    countExceptionFailures,
    failureRecord,
    formatThrown,
    freshStats,
    resolveCppCli,
    tryCppCompile,
    tryJsSemanticCompile,
    tryJsValidateCompile,
    updateStats,
};
