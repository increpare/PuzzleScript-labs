#!/usr/bin/env node
'use strict';

/**
 * Scan JS static / canonicalizer fixture sources, keep those with Lean-supported
 * static tags (currently `inert_command_only`), export IR, write a Lean manifest.
 *
 * Usage (repo root):
 *   node scripts/lean_inert_static_prepare.js --out-dir build/lean-inert-static
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { analyzeSource } = require('../src/tests/ps_static_analysis');
const { loadPuzzleScript } = require('../src/tests/js_oracle/lib/puzzlescript_node_env');

const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCE_ROOTS = [
    path.join(REPO_ROOT, 'src/tests/static_analysis_testdata'),
    path.join(REPO_ROOT, 'src/tests/canonicalizer_testdata'),
];
const SOURCE_EXTS = new Set(['.txt', '.puzzlescript']);
/** Tags Lean asserts today; expand as more analyses land. */
const SUPPORTED_TAGS = ['inert_command_only'];

function parseArgs(argv) {
    let outDir = path.join(REPO_ROOT, 'build', 'lean-inert-static');
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--out-dir' && argv[i + 1]) {
            outDir = path.resolve(argv[++i]);
        } else if (arg === '--help' || arg === '-h') {
            console.log(`Usage: node scripts/lean_inert_static_prepare.js [--out-dir DIR]

Walk static_analysis_testdata + canonicalizer_testdata sources, keep fixtures with
any Lean-supported tag (${SUPPORTED_TAGS.join(', ')}), export IR, write manifest.json.
`);
            process.exit(0);
        } else {
            console.error(`Unknown argument: ${arg}`);
            process.exit(2);
        }
    }
    return { outDir };
}

function walkSources(dir, acc = []) {
    if (!fs.existsSync(dir)) return acc;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            walkSources(p, acc);
        } else if (ent.isFile() && SOURCE_EXTS.has(path.extname(ent.name))) {
            acc.push(p);
        }
    }
    return acc;
}

function fixtureName(absPath) {
    const rel = path.relative(REPO_ROOT, absPath);
    if (rel.startsWith(`src/tests/static_analysis_testdata${path.sep}`)) {
        return rel
            .slice(`src/tests/static_analysis_testdata${path.sep}`.length)
            .replace(/\.(txt|puzzlescript)$/, '')
            .split(path.sep)
            .join('/');
    }
    if (rel.startsWith(`src/tests/canonicalizer_testdata${path.sep}`)) {
        return `canonicalizer/${path.basename(absPath).replace(/\.(txt|puzzlescript)$/, '')}`;
    }
    return rel.replace(/\.(txt|puzzlescript)$/, '');
}

function countInertCommandOnly(report) {
    let n = 0;
    for (const section of (report.ps_tagged && report.ps_tagged.rule_sections) || []) {
        for (const group of section.groups || []) {
            for (const rule of group.rules || []) {
                if (rule.tags && rule.tags.inert_command_only === true) n += 1;
            }
        }
    }
    return n;
}

function supportedTagCounts(report) {
    return {
        inert_command_only: countInertCommandOnly(report),
    };
}

function hasAnySupportedTag(counts) {
    return SUPPORTED_TAGS.some((tag) => (counts[tag] || 0) > 0);
}

/** Map runtime-contract / suite input tokens → Lean `parseMovementInputToken`. */
function toLeanInput(token) {
    const t = String(token).trim().toUpperCase();
    switch (t) {
        case 'U':
        case 'UP':
            return '0';
        case 'L':
        case 'LEFT':
            return '1';
        case 'D':
        case 'DOWN':
            return '2';
        case 'R':
        case 'RIGHT':
            return '3';
        case 'A':
        case 'ACTION':
            return '4';
        case 'UNDO':
            return 'undo';
        case 'RESTART':
            return 'restart';
        case 'TICK':
            return 'tick';
        default:
            if (/^[0-4]$/.test(String(token).trim())) return String(token).trim();
            throw new Error(`unsupported input token for Lean: ${token}`);
    }
}

function siblingJsonInputs(sourcePath) {
    const ext = path.extname(sourcePath);
    const jsonPath = sourcePath.slice(0, -ext.length) + '.json';
    if (!fs.existsSync(jsonPath)) return [];
    try {
        const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        if (!Array.isArray(payload.inputs)) return [];
        return payload.inputs.map(toLeanInput);
    } catch (_e) {
        return [];
    }
}

function exportIr(sourcePath, irPath) {
    const result = spawnSync(
        process.execPath,
        [
            path.join(REPO_ROOT, 'src/tests/js_oracle/export_ir_json.js'),
            sourcePath,
            irPath,
            '--level',
            '0',
        ],
        { encoding: 'utf8' }
    );
    if (result.status !== 0) {
        const err = (result.stderr || result.stdout || '').trim();
        throw new Error(err || `export_ir_json failed (${result.status})`);
    }
}

function main() {
    const { outDir } = parseArgs(process.argv);
    loadPuzzleScript();
    fs.mkdirSync(outDir, { recursive: true });

    const sources = [];
    for (const root of SOURCE_ROOTS) {
        walkSources(root, sources);
    }
    sources.sort();

    const cases = [];
    let skippedNoTags = 0;
    let skippedAnalyze = 0;
    let skippedExport = 0;
    const usedIrNames = new Set();

    for (const sourcePath of sources) {
        const name = fixtureName(sourcePath);
        let report;
        try {
            report = analyzeSource(fs.readFileSync(sourcePath, 'utf8'), { sourcePath });
        } catch (e) {
            skippedAnalyze += 1;
            console.warn(`skip analyze error ${name}: ${e && e.message ? e.message : e}`);
            continue;
        }
        if (report && report.status && report.status !== 'ok') {
            skippedAnalyze += 1;
            continue;
        }
        const tagCounts = supportedTagCounts(report);
        if (!hasAnySupportedTag(tagCounts)) {
            skippedNoTags += 1;
            continue;
        }

        let irBase = `${name.replace(/\//g, '__')}.ir.json`;
        if (usedIrNames.has(irBase)) {
            skippedExport += 1;
            console.warn(`skip duplicate ir name ${irBase} for ${name}`);
            continue;
        }
        usedIrNames.add(irBase);
        const irPath = path.join(outDir, irBase);
        try {
            exportIr(sourcePath, irPath);
        } catch (e) {
            skippedExport += 1;
            console.warn(`skip export ${name}: ${e && e.message ? e.message : e}`);
            continue;
        }

        cases.push({
            name,
            source: path.relative(REPO_ROOT, sourcePath).split(path.sep).join('/'),
            ir_file: irBase,
            expect_inert: tagCounts.inert_command_only,
            inputs: siblingJsonInputs(sourcePath),
            tags: tagCounts,
        });
    }

    const manifest = {
        schema: 'lean-inert-static-manifest-v1',
        supported_tags: SUPPORTED_TAGS,
        scanned: sources.length,
        skipped_no_supported_tags: skippedNoTags,
        skipped_analyze: skippedAnalyze,
        skipped_export: skippedExport,
        cases,
    };
    const manifestPath = path.join(outDir, 'manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(
        `lean_inert_static_prepare: scanned=${sources.length} cases=${cases.length} ` +
            `skip_no_tags=${skippedNoTags} skip_analyze=${skippedAnalyze} skip_export=${skippedExport}`
    );
    console.log(`wrote ${path.relative(REPO_ROOT, manifestPath)}`);
}

main();
