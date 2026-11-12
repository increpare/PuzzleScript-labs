#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadPuzzleScript } = require('./js_oracle/lib/puzzlescript_node_env');
const { collectParserPhaseDiagnostics, buildParserStateSnapshot } = require('./js_oracle/lib/puzzlescript_parser_snapshot');
const { validateSingleLayerObjects } = require('./js_oracle/lib/puzzlescript_semantic_program');
const root = path.resolve(__dirname, '../..');
const cli = path.resolve(process.argv[2] || 'build/native/puzzlescript_cpp');
const fixtures = path.join(root, 'native/tests/fixtures/compiler_fuzz');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-compiler-fuzz-'));
function run(command, args) {
    const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
}
function canonicalDiagnostic(text) {
    return text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[a-zA-Z][^>]*>/g, '')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .split('\n').map(line => line.trim()).join('\n').trim();
}
try {
    loadPuzzleScript();
    const sources = fs.readdirSync(fixtures).filter(name => name.endsWith('.txt')).sort()
        .map(name => ({ name, source: fs.readFileSync(path.join(fixtures, name), 'utf8') }));
    const bundle = path.join(temporary, 'parser.ndjson');
    fs.writeFileSync(bundle, sources.map(({ name, source }, index) => JSON.stringify({
        index, name, source, reference: collectParserPhaseDiagnostics(source + '\n').map(canonicalDiagnostic),
    })).join('\n') + '\n');
    const failures = [];
    const parser = buildParserStateSnapshot(fs.readFileSync(path.join(fixtures, 'comment_line_splits_level.txt'), 'utf8')).parser_state;
    assert(parser.names.includes('player'), 'Parser snapshots must retain names stored as a Set');
    assert(parser.abbrev_names.includes('p'), 'Parser snapshots must retain glyphs stored as a Set');
    for (const name of ['duplicate_alias', 'invalid_legend', 'hyphen_legend', 'prototype_synonym', 'prototype_property', 'prototype_aggregate']) {
        const file = path.join(fixtures, name + '.txt');
        const jsState = buildParserStateSnapshot(fs.readFileSync(file, 'utf8') + '\n').parser_state;
        const cppState = JSON.parse(run(cli, ['compile', file, '--emit-parser-state'])).parser_state;
        for (const field of ['names', 'abbrev_names', 'original_case_names', 'original_line_numbers', 'legend_aggregates', 'legend_properties']) {
            assert.deepEqual(cppState[field], jsState[field], name + ': ' + field);
        }
    }
    assert.deepEqual(validateSingleLayerObjects({ semantic_program: { objects: [
        { name: '__proto__', id: 0, layer: 0 }, { name: 'constructor', id: 1, layer: 1 },
    ] } }), []);
    const controlPath = path.join(fixtures, 'control_json.txt');
    const controlJs = buildParserStateSnapshot(fs.readFileSync(controlPath, 'utf8') + '\n').parser_state;
    const controlCpp = JSON.parse(run(cli, ['compile', controlPath, '--emit-parser-state'])).parser_state;
    assert.deepEqual(controlCpp.rules, controlJs.rules, 'Control characters must round-trip through parser JSON');
    for (const name of ['comment_reactivation', 'leading_comment_rule', 'unmatched_close_rule', 'unmatched_close_comment_rule', 'unmatched_close_heading']) {
        const file = path.join(fixtures, name + '.txt');
        const jsState = buildParserStateSnapshot(fs.readFileSync(file, 'utf8') + '\n').parser_state;
        const cppState = JSON.parse(run(cli, ['compile', file, '--emit-parser-state'])).parser_state;
        assert.deepEqual(cppState.rules, jsState.rules, name + ': rule capture');
        assert.deepEqual(cppState.visited_sections, jsState.visited_sections, name + ': logical heading start');
    }
    try { run(cli, ['diagnostics-parity', bundle]); } catch (error) { failures.push(error.message); }
    const semanticCases = ['comment_line_splits_level', 'malformed_rule_retained', 'mixed_late_group', 'nbsp_legend', 'bom_trim',
        'comment_reactivation', 'leading_comment_rule', 'trailing_comment_rule', 'leading_comment_win',
        'prototype_synonym', 'prototype_property', 'prototype_aggregate'];
    for (const name of semanticCases) {
        const source = path.join(fixtures, name + '.txt');
        const js = JSON.parse(run(process.execPath, ['src/tests/js_oracle/export_ir_json.js', source, '--snapshot-phase', 'semantic']));
        const cpp = JSON.parse(run(cli, ['compile', source, '--emit-semantic-program']));
        try { assert.deepEqual(cpp, js, name); } catch (error) { failures.push(error.message); }
    }
    assert.equal(failures.length, 0, failures.join('\n'));
    console.log(`Compiler fuzz regressions: ${sources.length} diagnostic sources and ${semanticCases.length} semantic sources match JS`);
} finally {
    fs.rmSync(temporary, { recursive: true, force: true });
}
