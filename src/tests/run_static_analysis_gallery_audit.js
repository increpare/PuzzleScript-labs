#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const save = (file, value) => {
    fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2) + '\n');
    fs.renameSync(file + '.tmp', file);
};
function loadManifest(file) {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(manifest.entries)) throw new Error('Manifest must contain entries');
    return manifest.entries.map((entry, index) => {
        const sourcePath = path.resolve(path.dirname(file), entry.sourceFile);
        const actualHash = sha256(fs.readFileSync(sourcePath));
        if (actualHash !== entry.sha256) throw new Error(`${entry.title}: source hash mismatch`);
        return { index, title: entry.title, sourcePath, sha256: actualHash, sourceStatus: entry.status };
    });
}
function mulberry32(seed) {
    return () => {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
        value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
        return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
}
function parseArgs(argv) {
    const options = { manifest: null, out: path.resolve('build/static-analysis-gallery-audit'), jobs: 4,
        iterations: 2, inputLength: 80, timeoutMs: 600000, caseTimeoutMs: 30000, maxProbes: 1000, maxTuples: 128,
        seed: 'static-soundness-2026-10-25', game: null, level: null, resume: false };
    const names = { '--manifest': 'manifest', '--out': 'out', '--jobs': 'jobs', '--iterations': 'iterations',
        '--input-length': 'inputLength', '--timeout-ms': 'timeoutMs', '--case-timeout-ms': 'caseTimeoutMs', '--max-probes': 'maxProbes',
        '--max-tuples': 'maxTuples', '--seed': 'seed', '--game': 'game', '--level': 'level' };
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === '--resume') { options.resume = true; continue; }
        if (argv[i] === '--help') { options.help = true; continue; }
        const name = names[argv[i]];
        if (!name || argv[i + 1] === undefined) throw new Error(`Unknown/missing argument: ${argv[i]}`);
        const value = argv[++i];
        options[name] = typeof options[name] === 'number' || name === 'level' ? Number(value) : value;
    }
    for (const name of ['jobs', 'iterations', 'inputLength', 'timeoutMs', 'caseTimeoutMs', 'maxProbes', 'maxTuples']) {
        if (!Number.isInteger(options[name]) || options[name] < (name === 'maxProbes' ? 0 : 1)) throw new Error(`${name} must be a positive integer`);
    }
    if (options.level !== null && (!Number.isInteger(options.level) || options.level < 0)) throw new Error('level must be a nonnegative integer');
    if (!options.help && !options.manifest) throw new Error('--manifest PATH is required');
    options.out = path.resolve(options.out);
    if (options.manifest) options.manifest = path.resolve(options.manifest);
    return options;
}
function sumInto(target, source) {
    for (const [key, value] of Object.entries(source || {})) target[key] = (target[key] || 0) + value;
}
async function worker(jobPath) {
    const { entry, options, signature, harnessDigest, resumePartial } = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
    if (harnessHash() !== harnessDigest) throw new Error('Audit sources changed after launch; use a new run directory');
    const { analyzeSource } = require('./ps_static_analysis');
    const contracts = require('./run_static_analysis_runtime_contracts_node');
    const { generateSafeInputs } = require('./fuzz_static_contracts');
    const { inventoryClaims, addRuntimeCoverage } = require('./static_analysis_dynamic_coverage');
    const file = path.join(options.out, `game-${entry.index}.json`);
    const result = resumePartial ? JSON.parse(fs.readFileSync(file, 'utf8')) : { ...entry, signature, status: 'running', levels: [], casesPassed: 0,
        casesAttempted: 0, inputCount: 0, failures: [], skips: {}, intraTurnChecks: {}, coverage: [], traces: [] };
    if (result.signature !== signature) throw new Error('Partial result signature changed');
    if (result.activeCase) { result.casesAttempted--; delete result.activeCase; }
    result.status = 'running';
    const source = fs.readFileSync(entry.sourcePath, 'utf8');
    if (sha256(source) !== entry.sha256) throw new Error('Source changed after manifest verification');
    const report = analyzeSource(source, { sourcePath: entry.sourcePath });
    if (report.status !== 'ok') {
        result.status = 'analysis-unavailable'; result.analysisErrors = report.errors;
        save(file, result); return;
    }
    if (!resumePartial) result.coverage = inventoryClaims(report);
    const contract = contracts.staticContractForSource(source, entry.title, { report });
    result.levels = report.ps_tagged.levels.filter(level => level.kind === 'level').map(level => level.index)
        .filter(index => options.level === null || index === options.level);
    const completed = new Set(result.traces.concat(result.failures).map(caseKey));
    save(file, result);
    for (const levelIndex of result.levels) {
        for (let iteration = 0; iteration < options.iterations; iteration++) {
            for (const inputMode of ['forward', 'mixed']) {
                if (completed.has(caseKey({ levelIndex, iteration, inputMode }))) continue;
                const seedText = `${options.seed}#${entry.sha256}#${levelIndex}#${iteration}#${inputMode}`;
                const seed = crypto.createHash('sha256').update(seedText).digest().readUInt32LE(0);
                const trace = { levelIndex, iteration, inputMode, seed, inputs: [] };
                const label = `${entry.title}#L${levelIndex}#${inputMode}#${iteration}`;
                result.casesAttempted++;
                // Save before entering the engine so timeouts name the exact case.
                result.activeCase = trace; save(file, result);
                if (process.send) process.send({ type: 'case-start', key: caseKey(trace) });
                try {
                    trace.inputs = generateSafeInputs(label, source, levelIndex, seed, mulberry32(seed), options.inputLength, { inputMode });
                    const expected = convertLevelToString();
                    result.activeCase = trace; save(file, result);
                    const checked = contracts.runSimulationWithStaticChecks(label,
                        [source, trace.inputs, expected, levelIndex, seed, null], {
                            staticContract: contract, checkExplicitSeed: true,
                            intraTurn: { maxProbes: options.maxProbes, maxTuples: options.maxTuples },
                        });
                    addRuntimeCoverage(result.coverage, checked);
                    if (checked.intraTurn) {
                        sumInto(result.intraTurnChecks, checked.intraTurn.checks);
                        sumInto(result.skips, checked.intraTurn.skipped);
                    }
                    if (trace.inputs.length === 0) sumInto(result.skips, { zero_input_trace: 1 });
                    result.casesPassed++; result.inputCount += trace.inputs.length;
                    result.traces.push({ levelIndex, iteration, inputMode, seed, inputCount: trace.inputs.length });
                } catch (error) {
                    if (error.runtimeCoverage) {
                        addRuntimeCoverage(result.coverage, error.runtimeCoverage);
                        if (error.runtimeCoverage.intraTurn) {
                            sumInto(result.intraTurnChecks, error.runtimeCoverage.intraTurn.checks);
                            sumInto(result.skips, error.runtimeCoverage.intraTurn.skipped);
                        }
                    }
                    const failure = { ...trace, kind: 'contract-or-runtime', certificate: error.certificate || null, error: error.message, stack: error.stack };
                    result.failures.push(failure);
                    fs.mkdirSync(path.join(options.out, 'sources'), { recursive: true });
                    fs.writeFileSync(path.join(options.out, 'sources', `game-${entry.index}.txt`), source);
                }
                delete result.activeCase; save(file, result);
                if (process.send) process.send({ type: 'case-end', key: caseKey(trace) });
            }
        }
    }
    result.status = 'complete'; save(file, result);
    if (harnessHash() !== harnessDigest) throw new Error('Audit sources changed during execution; rerun this game');
}
function caseKey(trace) { return `${trace.levelIndex}:${trace.iteration}:${trace.inputMode}`; }
function markCaseTimeout(result, milliseconds, expectedKey = null) {
    if (!result.activeCase || (expectedKey !== null && caseKey(result.activeCase) !== expectedKey)) return false;
    result.failures.push({ ...result.activeCase, kind: 'case-timeout', certificate: null,
        error: `Trace exceeded ${milliseconds} ms; continued with the remaining traces` });
    delete result.activeCase;
    return true;
}
function harnessHash() {
    // Follow CommonJS dependencies plus the engine/semantic compiler's VM
    // script lists. Unrelated MIS editor work must not invalidate an audit.
    const root = path.resolve(__dirname, '..');
    const hash = crypto.createHash('sha256');
    const visited = new Set();
    function visit(file) {
        file = path.resolve(file);
        if (visited.has(file)) return;
        visited.add(file);
        const source = fs.readFileSync(file, 'utf8');
        hash.update(path.relative(root, file)); hash.update(source);
        for (const match of source.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
            if (!match[1].startsWith('.')) continue;
            let dependency;
            try { dependency = require.resolve(path.resolve(path.dirname(file), match[1])); }
            catch (_error) { hash.update(`missing:${file}:${match[1]}`); continue; }
            visit(dependency);
        }
    }
    visit(__filename);
    const { SOURCE_FILES } = require('./js_oracle/lib/puzzlescript_node_env');
    for (const file of SOURCE_FILES.concat(['js/semantic_compile.js', 'tests/resources/testingFrameWork.js',
        'tests/resources/testdata.js', 'tests/resources/errormessage_testdata.js'])) visit(path.join(root, file));
    // canonicalize.js owns a separate list of VM-loaded scripts.
    for (const match of fs.readFileSync(path.join(root, 'canonicalize.js'), 'utf8').matchAll(/['"](js\/[^'"]+\.js)['"]/g)) {
        visit(path.join(root, match[1]));
    }
    hash.update(fs.readFileSync(path.join(root, '..', 'package-lock.json')));
    hash.update(process.version);
    hash.update(JSON.stringify(Object.entries(process.env).filter(([key]) => key.startsWith('PUZZLESCRIPT_') || key === 'NODE_OPTIONS').sort()));
    return hash.digest('hex');
}
function summarize(results, total, options, signature) {
    const summary = { signature, options, updatedAt: new Date().toISOString(), gamesTotal: total,
        gamesCompleted: results.filter(result => result.status === 'complete').length,
        analysisUnavailable: results.filter(result => result.status === 'analysis-unavailable').length,
        interruptedGames: results.filter(result => !['complete', 'analysis-unavailable'].includes(result.status)).length,
        playableLevels: 0, casesAttempted: 0, casesPassed: 0, inputCount: 0, failures: 0, timeoutCases: 0, skips: {}, intraTurnChecks: {}, coverage: [] };
    const coverage = new Map();
    for (const result of results) {
        summary.playableLevels += result.levels.length;
        for (const key of ['casesAttempted', 'casesPassed', 'inputCount']) summary[key] += result[key];
        summary.failures += result.failures.length;
        summary.timeoutCases += result.failures.filter(failure => failure.kind === 'case-timeout').length;
        sumInto(summary.skips, result.skips); sumInto(summary.intraTurnChecks, result.intraTurnChecks);
        for (const row of result.coverage) {
            if (!coverage.has(row.id)) coverage.set(row.id, { ...row, emitted: 0, certificates: 0, checks: 0, failures: 0 });
            const totalRow = coverage.get(row.id);
            for (const key of ['emitted', 'certificates', 'checks', 'failures']) totalRow[key] += row[key] || 0;
        }
    }
    summary.coverage = [...coverage.values()].sort((a, b) => a.id.localeCompare(b.id));
    summary.uncheckedClaims = summary.coverage.filter(row => row.status === 'unchecked').map(row => row.id);
    summary.unexercisedClaims = summary.coverage.filter(row => row.checker && row.certificates > 0 && row.checks === 0 && row.failures === 0).map(row => row.id);
    return summary;
}
async function run(options) {
    const entries = loadManifest(options.manifest).filter(entry => !options.game || entry.title.toLowerCase().includes(options.game.toLowerCase()));
    if (entries.length === 0) throw new Error('No gallery entries matched');
    fs.mkdirSync(options.out, { recursive: true });
    const configuration = { ...options }; delete configuration.out; delete configuration.resume; delete configuration.jobs;
    const harnessDigest = harnessHash();
    const signature = sha256(JSON.stringify({ configuration, manifest: sha256(fs.readFileSync(options.manifest)), harness: harnessDigest }));
    const results = [], pending = [];
    for (const entry of entries) {
        const file = path.join(options.out, `game-${entry.index}.json`);
        if (fs.existsSync(file)) {
            const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (!options.resume) throw new Error(`Output exists: ${file}; use --resume or a new --out`);
            if (previous.signature !== signature) throw new Error('Resume configuration, source manifest or harness changed; use a new --out');
            if (['complete', 'analysis-unavailable'].includes(previous.status)) { results.push(previous); continue; }
        }
        pending.push(entry);
    }
    let next = 0;
    async function slot() {
        while (next < pending.length) {
            const entry = pending[next++], file = path.join(options.out, `game-${entry.index}.json`);
            const jobPath = path.join(options.out, `job-${entry.index}.json`);
            const deadline = Date.now() + options.timeoutMs;
            let resumePartial = false, result, outcome;
            do {
                save(jobPath, { entry, options, signature, harnessDigest, resumePartial });
                const log = fs.openSync(path.join(options.out, `game-${entry.index}.log`), resumePartial ? 'a' : 'w');
                outcome = await new Promise(resolve => {
                    const child = fork(__filename, ['--worker', jobPath], { stdio: ['ignore', log, log, 'ipc'] });
                    let timedOut = false, caseTimedOut = false, killTimer, caseTimer, currentCaseKey = null, timedOutCaseKey = null;
                    const terminate = () => {
                        child.kill('SIGTERM');
                        killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
                    };
                    const timer = setTimeout(() => { timedOut = true; terminate(); }, Math.max(1, deadline - Date.now()));
                    child.on('message', message => {
                        if (message.type === 'case-end' && message.key === currentCaseKey) {
                            clearTimeout(caseTimer); currentCaseKey = null; return;
                        }
                        if (message.type !== 'case-start') return;
                        clearTimeout(caseTimer);
                        currentCaseKey = message.key;
                        caseTimer = setTimeout(() => {
                            caseTimedOut = true; timedOutCaseKey = message.key; terminate();
                        }, options.caseTimeoutMs);
                    });
                    const finish = value => {
                        clearTimeout(timer); clearTimeout(caseTimer); clearTimeout(killTimer);
                        resolve({ ...value, timedOut, caseTimedOut, timedOutCaseKey });
                    };
                    child.on('error', error => finish({ error: error.message }));
                    child.on('exit', code => finish({ code }));
                });
                fs.closeSync(log);
                result = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {
                    ...entry, signature, levels: [], casesAttempted: 0, casesPassed: 0, inputCount: 0, failures: [], skips: {}, coverage: [],
                };
                if (outcome.caseTimedOut) {
                    const marked = markCaseTimeout(result, options.caseTimeoutMs, outcome.timedOutCaseKey);
                    save(file, result);
                    if (marked) {
                        fs.mkdirSync(path.join(options.out, 'sources'), { recursive: true });
                        fs.copyFileSync(entry.sourcePath, path.join(options.out, 'sources', `game-${entry.index}.txt`));
                    }
                    // A completed case may have saved before its end message
                    // was delivered. Resume without blaming a later active case.
                    resumePartial = true;
                } else resumePartial = false;
            } while (resumePartial && !outcome.timedOut && Date.now() < deadline);
            if (outcome.timedOut || outcome.code !== 0 || outcome.error) {
                result.status = outcome.timedOut ? 'timeout' : 'worker-error';
                result.workerError = outcome;
                save(file, result);
            }
            results.push(result);
            save(path.join(options.out, 'summary.json'), summarize(results, entries.length, options, signature));
            console.log(`[${results.length}/${entries.length}] ${entry.title}: ${result.status}, ${result.casesPassed}/${result.casesAttempted} traces, ${result.failures.length} failures`);
        }
    }
    await Promise.all(Array.from({ length: Math.min(options.jobs, Math.max(1, pending.length)) }, slot));
    const summary = summarize(results, entries.length, options, signature);
    save(path.join(options.out, 'summary.json'), summary);
    return summary;
}
if (require.main === module) {
    if (process.argv[2] === '--worker') {
        worker(process.argv[3]).catch(error => { console.error(error.stack); process.exitCode = 1; });
    } else {
        Promise.resolve().then(() => parseArgs(process.argv)).then(options => {
            if (options.help) { console.log('Usage: node src/tests/run_static_analysis_gallery_audit.js --manifest PATH [--out PATH] [--jobs 4] [--iterations 2] [--input-length 80] [--seed TEXT] [--game TEXT] [--level N] [--resume]'); return; }
            return run(options).then(result => { if (result.failures || result.interruptedGames) process.exitCode = 1; });
        }).catch(error => { console.error(error.stack); process.exitCode = 1; });
    }
}
module.exports = { loadManifest, parseArgs, summarize, run, markCaseTimeout };
