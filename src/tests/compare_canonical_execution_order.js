#!/usr/bin/env node
'use strict';

// Compare partitions, not literal hash changes. Re-hashing every game does not
// itself mean an equivalence class has split. Each source is compiled once per
// projection; exact byte duplicates retain every original corpus filename.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const { canonicalizeSource, hashCanonical } = require('../canonicalize');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

if (process.argv.includes('--worker')) {
    process.on('message', item => {
        const record = { ...item, projections: {} };
        try {
            const text = fs.readFileSync(item.path, 'utf8');
            if (sha(Buffer.from(text)) !== item.sourceHash) throw new Error('Source changed during audit');
            const projections = item.includeSourceProjection ? ['legacy', 'source', 'dependency'] : ['legacy', 'dependency'];
            for (const name of projections) {
                record.stage = name;
                process.send({ stage: name, projections: record.projections });
                const start = performance.now();
                const canonical = canonicalizeSource(text, item.mode, { executionOrder: name });
                record.projections[name] = { hash: hashCanonical(canonical), rules: canonical.rules.length,
                    groups: new Set(canonical.rules.map(rule => rule.groupNumber)).size,
                    milliseconds: Math.round(performance.now() - start) };
            }
            delete record.stage;
        } catch (error) {
            record.error = String(error && error.message || error).slice(0, 1600);
        }
        process.send({ record });
    });
} else if (require.main === module) {
    main().catch(error => { console.error(error); process.exitCode = 1; });
}

async function main() {
    const args = process.argv.slice(2);
    const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
    const corpus = path.resolve(option('--corpus', path.join(__dirname, 'solver_tests')));
    const out = path.resolve(option('--out', 'build/canonical-execution-order'));
    const mode = option('--mode', 'semantic');
    const jobs = Number(option('--jobs', 4));
    const timeout = Number(option('--timeout-ms', 20000));
    const limit = Number(option('--limit', Infinity));
    const includeSourceProjection = args.includes('--include-source-projection');
    if (!['semantic', 'mechanics', 'ruleset', 'family'].includes(mode) || !Number.isInteger(jobs) || jobs < 1 || jobs > 16) {
        throw new Error('Invalid mode or job count');
    }
    fs.mkdirSync(out, { recursive: true });
    const recordFile = path.join(out, 'records.jsonl');
    const resume = args.includes('--resume');
    if (fs.existsSync(recordFile) && !resume) throw new Error('Output already exists; choose a new --out directory or --resume');
    const files = fs.readdirSync(corpus).filter(name => name.endsWith('.txt')).sort().slice(0, limit);
    const bySource = new Map();
    for (const file of files) {
        const sourcePath = path.join(corpus, file), bytes = fs.readFileSync(sourcePath);
        const sourceHash = sha(bytes), text = bytes.toString('utf8');
        if (!bySource.has(sourceHash)) bySource.set(sourceHash, { sourceHash, path: sourcePath, mode, includeSourceProjection,
            title: (/^\s*title\s+([^\r\n]+)/mi.exec(text) || [])[1] || path.basename(file, '.txt'), files: [] });
        bySource.get(sourceHash).files.push(file);
    }
    const records = resume && fs.existsSync(recordFile) ? fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    const completed = new Set(records.map(record => record.sourceHash));
    for (const record of records) {
        const input = bySource.get(record.sourceHash);
        if (!input || JSON.stringify(input.files) !== JSON.stringify(record.files) || input.mode !== record.mode) {
            throw new Error('Resume inputs do not match the saved audit');
        }
    }
    const queue = Array.from(bySource.values()).filter(record => !completed.has(record.sourceHash));
    const total = bySource.size;
    const startedAt = new Date().toISOString();
    const manifestPath = path.join(out, 'manifest.json');
    const previous = resume && fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath)) : null;
    const manifest = { startedAt: previous ? previous.startedAt : startedAt, corpus, mode, jobs, timeout,
        files: files.length, uniqueSources: total,
        code: Object.fromEntries(['src/js/compiler.js', 'src/js/semantic_compile.js', 'src/js/canonicalize_core.js',
            'src/js/canonicalize_order.js', 'src/js/decanonicalize_core.js', 'src/tests/compare_canonical_execution_order.js']
            .map(file => [file, sha(fs.readFileSync(path.join(__dirname, '../..', file)))])) };
    if (previous) {
        for (const [file, hash] of Object.entries(previous.code)) {
            if (file !== 'src/tests/compare_canonical_execution_order.js' && manifest.code[file] !== hash) {
                throw new Error('Projection code changed; cannot resume this audit: ' + file);
            }
        }
    }
    manifest.sessions = [...(previous ? previous.sessions || [{ startedAt: previous.startedAt, jobs: previous.jobs, timeout: previous.timeout }] : []),
        { startedAt, jobs, timeout, includeSourceProjection, resumedAfterSources: records.length,
            runnerHash: manifest.code['src/tests/compare_canonical_execution_order.js'] }];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, () => new Promise(resolve => {
        let child, active, stage, timer, partial;
        const start = () => {
            child = fork(__filename, ['--worker'], { execArgv: ['--max-old-space-size=768'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
            let stderr = '';
            child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-1500); });
            child.on('message', message => {
                if (message.stage) { stage = message.stage; partial = message.projections || {}; return; }
                if (message.record) finish(message.record);
            });
            child.on('exit', (code, signal) => {
                if (active) finish({ ...active, projections: partial || {}, stage, error: 'Worker exited: ' + (signal || code) + ' ' + stderr }, true);
            });
            next();
        };
        const finish = (record, restart = false) => {
            clearTimeout(timer);
            if (!active) return;
            active = null;
            records.push(record);
            fs.appendFileSync(recordFile, JSON.stringify(record) + '\n');
            if (records.length % 100 === 0 || records.length === total) {
                console.error(`${mode}: ${records.length}/${total} sources; ${records.filter(r => r.error).length} excluded`);
                fs.writeFileSync(path.join(out, 'progress.json'), JSON.stringify({ completed: records.length, total,
                    errors: records.filter(r => r.error).length, updatedAt: new Date().toISOString() }));
            }
            if (restart) start(); else next();
        };
        const next = () => {
            if (cursor >= queue.length) { child.disconnect(); resolve(); return; }
            active = queue[cursor++]; stage = 'starting'; partial = {};
            child.send(active);
            timer = setTimeout(() => { child.kill('SIGKILL'); }, timeout);
        };
        start();
    })));
    const summary = summarize(records);
    Object.assign(summary, { startedAt: manifest.startedAt, finishedAt: new Date().toISOString(), corpus, mode, files: files.length, uniqueSources: total });
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    fs.writeFileSync(path.join(out, 'REPORT.md'), renderReport(summary));
    console.log(JSON.stringify({ ...summary.counts, report: path.join(out, 'REPORT.md') }));
}

function summarize(records) {
    const complete = records.filter(r => !r.error && r.projections.dependency);
    const classes = name => {
        const groups = new Map();
        for (const record of complete.filter(record => record.projections[name])) {
            const hash = record.projections[name].hash;
            if (!groups.has(hash)) groups.set(hash, []);
            groups.get(hash).push(record);
        }
        return groups;
    };
    const legacy = classes('legacy'), source = classes('source'), dependency = classes('dependency');
    const describe = (groups, target) => Array.from(groups, ([hash, members]) => {
        const targetGroups = new Map();
        for (const member of members) {
            const other = member.projections[target].hash;
            if (!targetGroups.has(other)) targetGroups.set(other, []);
            targetGroups.get(other).push(member);
        }
        return { hash, sources: members.length, files: members.reduce((n, r) => n + r.files.length, 0),
            branches: Array.from(targetGroups, ([hash, members]) => ({ hash, members: members.map(r => ({ title: r.title,
                files: r.files, sourceHash: r.sourceHash, sourceOrderHash: r.projections.source?.hash || null,
                rules: Object.fromEntries(Object.entries(r.projections).map(([name, p]) => [name, p.rules])) })) })) };
    }).filter(group => group.branches.length > 1).sort((a, b) => b.files - a.files || a.hash.localeCompare(b.hash));
    const splits = describe(legacy, 'dependency'), merges = describe(dependency, 'legacy');
    return { counts: { comparableSources: complete.length, comparableFiles: complete.reduce((n, r) => n + r.files.length, 0),
        excludedSources: records.length - complete.length, legacyClasses: legacy.size,
        sourceOrderComparedSources: complete.filter(r => r.projections.source).length,
        sourceOrderClasses: complete.every(r => r.projections.source) ? source.size : null,
        dependencyClasses: dependency.size, splitLegacyClasses: splits.length, mergedNewClasses: merges.length,
        splitSources: splits.reduce((n, g) => n + g.sources, 0), mergeSources: merges.reduce((n, g) => n + g.sources, 0),
        splitFiles: splits.reduce((n, g) => n + g.files, 0), mergeFiles: merges.reduce((n, g) => n + g.files, 0) },
        splits, merges, exclusions: records.filter(r => r.error).map(r => ({ title: r.title, files: r.files, stage: r.stage,
            completedProjections: Object.keys(r.projections), error: r.error })) };
}

function renderReport(s) {
    const c = s.counts;
    const lines = [`# Canonical execution-order experiment: ${s.mode}`, '',
        `Corpus: ${s.corpus}`, '', `Finished: ${s.finishedAt}`, '',
        `Compared **${c.comparableFiles} files / ${c.comparableSources} distinct source byte sequences**. ` +
        `Excluded ${c.excludedSources} sources; reasons are recorded in summary.json.`, '',
        '| Projection | Equivalence classes |', '| --- | ---: |', `| Previous projection | ${c.legacyClasses} |`,
        ...(c.sourceOrderClasses === null ? [] : [`| Order-preserving compilation, no reordering | ${c.sourceOrderClasses} |`]),
        `| Order-preserving compilation + certified reordering | ${c.dependencyClasses} |`, '',
        `**${c.splitLegacyClasses} previous classes split**, involving ${c.splitFiles} files. ` +
        `**${c.mergedNewClasses} new classes merge previously distinct classes**, involving ${c.mergeFiles} files.`, '',
        `The optional source-order-only control was computed for ${c.sourceOrderComparedSources} comparable sources. ` +
        'Counts describe partitions, not changed hash strings. A class can participate in both a split and a merge. ' +
        'A split is evidence that the projections distinguish programs differently, not proof that every branch has different gameplay. ' +
        'The Snortal regression independently establishes an observable order difference.', '',
        'The experiment is opt-in (`executionOrder: "dependency"`). It preserves existing projection choices about sounds, ' +
        'messages, checkpoints and inert objects; it is not a claim of complete behavioral equivalence.', ''];
    for (const [label, groups] of [['Previously merged classes that split', s.splits], ['Previously distinct classes that merge', s.merges]]) {
        lines.push('## ' + label, '', '| Class | Files | Branches | Representative titles |', '| --- | ---: | ---: | --- |');
        for (const group of groups.slice(0, 40)) {
            const names = group.branches.map(branch => Array.from(new Set(branch.members.map(r => r.title))).slice(0, 2).join(', '));
            lines.push(`| ${group.hash.slice(0, 12)} | ${group.files} | ${group.branches.length} | ${names.join(' / ').replace(/\|/g, '\\|')} |`);
        }
        if (!groups.length) lines.push('| None | 0 | 0 | |');
        lines.push('', 'Full membership, source hashes and rule counts for every branch are in summary.json.', '');
    }
    return lines.join('\n') + '\n';
}

module.exports = { summarize, renderReport };
