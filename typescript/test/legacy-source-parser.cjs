'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPuzzleScript } = require('./native-host.cjs');
const { assertVanillaFields } = require('./vanilla-fields.cjs');

function createSourceParserOracle(types) {
  loadPuzzleScript({ includeTests: true });
  const producers = [...new Set(['parser.js', 'compiler.js', 'engine.js'].flatMap(file =>
    [...fs.readFileSync(path.join(__dirname, './vanilla/js', file), 'utf8').matchAll(/^function (\w+)\s*\(/gm)].map(match => match[1])))];
  function independently(callback) {
    const originals = producers.map(name => globalThis[name]), originalParser = codeMirrorFn;
    try {
      producers.forEach(name => { globalThis[name] = () => { throw new Error('Candidate called native ' + name); }; });
      codeMirrorFn = function() { throw new Error('Candidate called native codeMirrorFn'); };
      return callback();
    } finally {
      codeMirrorFn = originalParser;
      producers.forEach((name, index) => { globalThis[name] = originals[index]; });
    }
  }
  function collect(callback) {
    resetParserErrorState();
    const raw = [], recorded = [], original = logIssue, wasCompiling = compiling;
    try {
      compiling = true;
      globalThis.logIssue = function(message, line, urgent, className, countsAsError, printUrgent) {
        const issue = { message, line: line ?? null, severity: className === 'warningText' ? 0 : 1,
          countsAsError, urgent: Boolean(urgent) };
        raw.push(issue);
        const length = errorStrings.length;
        try { return original(message, line, urgent, className, countsAsError, printUrgent); }
        finally { if (errorStrings.length > length) recorded.push(issue); }
      };
      let stopped = false;
      try { callback(); } catch (error) {
        if (error.message !== 'Too many errors/warnings; aborting compilation.') throw error;
        stopped = true;
      }
      return { raw, recorded, errorCount, stopped, formatted: [...errorStrings] };
    } finally { globalThis.logIssue = original; compiling = wasCompiling; }
  }
  function nativeParser(source, editorVisits = false) {
    const processor = new codeMirrorFn();
    let state = processor.startState();
    let cursor = { line: 1, column: 1 }, reason = null;
    const issues = collect(() => {
      const lines = source.split('\n');
      for (let index = 0; index < lines.length; index++) {
        if (editorVisits && lines[index] === '') {
          processor.blankLine(state);
          state = processor.copyState(state);
          cursor = { line: index + 1, column: 1 };
          if (errorCount > 5) { reason = types.SourceParserStopReason.Errors; return; }
          continue;
        }
        const stream = new CodeMirror.StringStream(lines[index], 4);
        do {
          try { processor.token(stream, state); }
          finally {
            let authored = 0, normalized = 0;
            if (stream.string === lines[index]) authored = stream.pos;
            else for (const character of lines[index]) {
              if (normalized >= stream.pos) break;
              authored += character.length; normalized += character.toLowerCase().length;
            }
            cursor = { line: index + 1, column: authored + 1 };
          }
          if (editorVisits) state = processor.copyState(state);
          if (errorCount > 5) { reason = types.SourceParserStopReason.Errors; return; }
        } while (!stream.eol());
      }
    });
    assertVanillaFields('parser state', state, ['objects', 'lineNumber', 'commentLevel', 'section', 'visitedSections',
      'line_should_end', 'line_should_end_because', 'sol_after_comment', 'inside_cell', 'lhs_rhs_rowcount_difference', 'arrow_passed',
      'rhs_pattern_started',
      'rule_prelude', 'objects_candname', 'objects_section', 'objects_spritematrix', 'collisionLayers', 'tokenIndex',
      'current_line_wip_array', 'current_line_mixed_case', 'legend_synonyms', 'legend_aggregates', 'legend_properties', 'sounds', 'rules', 'names',
      'winconditions', 'metadata', 'metadata_lines', 'original_case_names', 'original_line_numbers', 'abbrevNames', 'levels',
      ...(editorVisits ? ['STRIDE_OBJ', 'STRIDE_MOV'] : ['subsection'])]);
    if (issues.stopped) reason = types.SourceParserStopReason.Issues;
    return { ...issues, cursor, reason, section: state.section || null, state };
  }
  function view(items) {
    assert.ok(Array.isArray(items), 'ordinary diagnostic array');
    return items.map(issue => {
      assertVanillaFields('source diagnostic', issue, ['code', 'message', 'reportedLine', 'severity', 'countsAsError', 'urgent', 'span', 'phase']);
      assert.equal(typeof issue.code, 'string');
      return { message: issue.message,
        line: issue.reportedLine === undefined ? issue.span?.start.line ?? null : issue.reportedLine,
        severity: issue.severity, countsAsError: issue.countsAsError, urgent: issue.urgent ?? false };
    });
  }
  function compareFixture(fixture, candidate = types.parseSource) {
    const native = nativeParser(fixture.source);
    const result = independently(() => candidate(fixture.source));
    assert.deepEqual(Object.keys(result).sort(), ['diagnostics', 'document', 'errorCount', 'outcome', 'rawDiagnostics']);
    for (const issue of [...result.rawDiagnostics, ...result.diagnostics]) if (issue.span !== null) {
      assert.equal(issue.phase, types.SourceDiagnosticPhase.Reader);
      for (const position of [issue.span.start, issue.span.end]) {
        const lines = fixture.source.split('\n');
        assert.ok(position.line >= 1 && position.line <= lines.length, 'authored issue line');
        assert.ok(position.column >= 1 && position.column <= lines[position.line - 1].length + 1, 'authored issue column');
        assert.equal(position.offset, lines.slice(0, position.line - 1).reduce((sum, line) => sum + line.length + 1, 0) + position.column - 1);
      }
      assert.ok(issue.span.end.offset >= issue.span.start.offset);
    }
    assert.equal(result.document.source, fixture.source, fixture.name + ': authored source');
    assert.deepEqual(view(result.rawDiagnostics), native.raw, fixture.name + ': raw parser visits');
    assert.deepEqual(view(result.diagnostics), native.recorded, fixture.name + ': recorded parser issues');
    assert.equal(result.errorCount, native.errorCount, fixture.name + ': recorded error count');
    assert.equal(result.outcome.kind, native.reason === null ? types.SourceParserOutcomeKind.Complete : types.SourceParserOutcomeKind.Stopped,
      fixture.name + ': parser outcome');
    if (native.reason !== null) {
      assert.deepEqual(Object.keys(result.outcome).sort(), ['cursor', 'kind', 'reason', 'section']);
      assert.equal(result.outcome.reason, native.reason, fixture.name + ': stopping reason');
      const lines = fixture.source.split('\n'), cursor = result.outcome.cursor;
      const expectedCursor = { ...native.cursor, offset: lines.slice(0, native.cursor.line - 1)
        .reduce((sum, line) => sum + line.length + 1, 0) + native.cursor.column - 1 };
      assert.ok(cursor.line >= 1 && cursor.line <= lines.length, fixture.name + ': stopping cursor line bounds');
      assert.ok(cursor.column >= 1 && cursor.column <= lines[cursor.line - 1].length + 1, fixture.name + ': stopping cursor column bounds');
      assert.ok(cursor.offset >= 0 && cursor.offset <= fixture.source.length, fixture.name + ': stopping cursor offset bounds');
      assert.deepEqual(cursor, expectedCursor, fixture.name + ': stopping cursor');
      assert.equal(result.outcome.section, native.section === null ? null : ['objects', 'legend', 'sounds', 'collisionlayers', 'rules', 'winconditions', 'levels'].indexOf(native.section));
    } else assert.deepEqual(Object.keys(result.outcome), ['kind']);
    return { native, result };
  }
  function nativeMetadata(source) {
    let state;
    const issues = collect(() => { state = loadFile(source); });
    assert.ok(state, 'actual native loadFile produces a state for this constructed metadata case');
    return { metadata: { ...state.metadata }, messages: state.levels.filter(level => level.message !== undefined).map(level => level.message),
      errorCount: issues.errorCount };
  }
  return { collect, nativeParser, nativeEditorParser: source => nativeParser(source, true), compareFixture, independently, view, nativeMetadata,
    compilationFixtures: () => errormessage_testdata.map(([name, data]) => ({ name, source: data[0] })),
    corpusFixtures: () => testdata.map(([name, data]) => ({ name, source: data[0] })) };
}
module.exports = { createSourceParserOracle };
