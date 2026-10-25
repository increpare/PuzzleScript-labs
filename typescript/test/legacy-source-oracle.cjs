'use strict';

const assert = require('node:assert/strict');
const { loadPuzzleScript } = require('./native-host.cjs');
const { buildParserStateSnapshot } = require('./support/parser-snapshot.cjs');

function createSourceOracle(types) {
  loadPuzzleScript({ includeTests: true });

  function checkSpans(fixture, document) {
    assert.equal(document.source, fixture.source, fixture.name + ': original source');
    const originals = fixture.source.split('\n');
    assert.equal(document.lines.length, originals.length, fixture.name + ': physical source lines');
    let offset = 0;
    for (let index = 0; index < originals.length; index++) {
      const line = document.lines[index];
      const text = originals[index];
      assert.equal(line.original, text, fixture.name + ': physical source line ' + index);
      assert.deepEqual(line.span, {
        start: { offset, line: index + 1, column: 1 },
        end: { offset: offset + text.length, line: index + 1, column: text.length + 1 },
      }, fixture.name + ': source span line ' + (index + 1));
      offset += text.length + 1;
    }
    const seen = new Set();
    function checkSpan(span) {
      assert.ok(span !== null && typeof span === 'object' && span.start !== undefined && span.end !== undefined,
        fixture.name + ': source span shape');
      const { start, end } = span;
      assert.ok(start.offset <= end.offset, fixture.name + ': source span order');
      for (const position of [start, end]) {
        const line = document.lines[position.line - 1];
        assert.ok(line !== undefined && position.column >= 1 && position.column <= line.original.length + 1,
          fixture.name + ': source span position');
        assert.equal(position.offset, line.span.start.offset + position.column - 1, fixture.name + ': source span offset');
      }
    }
    function visit(node) {
      if (node === null || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      if (typeof node.spelling === 'string') {
        checkSpan(node.span);
        assert.equal(fixture.source.slice(node.span.start.offset, node.span.end.offset), node.spelling, fixture.name + ': source span spelling');
        assert.equal(node.normalized, node.spelling.toLowerCase(), fixture.name + ': normalized source word');
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === 'span' || key.endsWith('Span')) checkSpan(value);
        visit(value);
      }
    }
    visit(document);
  }

  function authoredView(document) {
    return {
      sections: document.sections.map(section => section.name.normalized),
      metadata: document.metadata.filter(entry => entry.accepted).flatMap(entry => [entry.key.normalized, entry.value]),
      // The authored AST retains invalid declaration attempts. The legacy
      // parser's object dictionary contains only accepted primary names.
      objects: document.objects.filter(object => object.validPrimaryName).map(object => ({
        name: object.definitionNames[0].value, line_number: object.primaryName.span.start.line,
        colors: object.colors.map(color => color.normalized),
        spritematrix: object.spriteRows === null ? [] : object.spriteRows.map(row => row.text),
      })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      rules: document.rules.map(rule => ({ rule: rule.legacyCapturedText,
        line_number: rule.originalLine.span.start.line, mixed_case: rule.compilerLine })),
      levels: document.levels.map(level => 'rows' in level
        ? { kind: 'level', line_number: level.rows[0].span.start.line, rows: level.rows.map(row => row.text.toLowerCase()) }
        : { kind: 'message', line_number: level.keyword.span.start.line, message: level.text }),
    };
  }
  function nativeRuleStructures(source) {
    const processor = new codeMirrorFn();
    const parsed = processor.startState();
    for (const line of source.split('\n')) {
      const stream = new CodeMirror.StringStream(line, 4);
      do { processor.token(stream, parsed); } while (!stream.eol());
    }
    // The rule syntax pass consults only property-name membership for one
    // diagnostic. No property expansion, masks or compiled plans are needed.
    parsed.propertiesDict = Object.fromEntries(parsed.legend_properties.map(entry => [entry[0], entry.slice(1)]));
    const priorRules = [];
    const structures = [];
    let skippedErroredRules = 0;
    let rejectedRuleStructures = 0;
    for (const captured of parsed.rules) {
      const previousCompiling = compiling;
      const beforeErrors = errorCount;
      let rule;
      compiling = true;
      try { rule = processRuleString(captured, parsed, priorRules); }
      finally { compiling = previousCompiling; }
      const hasErrors = errorCount !== beforeErrors;
      if (hasErrors) skippedErroredRules++;
      if (rule === null) {
        rejectedRuleStructures++;
        continue;
      }
      if (rule.bracket === undefined) priorRules.push(rule);
      // The authored AST preserves unresolved/errorful terms. Native compiler
      // recovery can discard those terms; compare validated structures only.
      // Errorful rule diagnostics/execution remain the full compiler's gate.
      if (!hasErrors) structures.push({ line: captured[1], rule });
    }
    return { structures, skippedErroredRules, rejectedRuleStructures };
  }
  function compareRuleStructures(fixture, document, native) {
    // Native syntax output collects a row only at its closing bracket. The
    // authored AST also keeps unterminated rows for diagnostics and source spans;
    // those are checked independently by source preservation tests.
    const completed = rows => rows.filter(row => row.closingBracket !== null);
    const cells = rows => completed(rows).map(row => row.cells.map(cell => cell.kind === types.SourceRuleCellKind.Ellipsis
      ? ['...', '...'] : cell.terms.flatMap(term => [term.qualifier?.normalized ?? '', term.name?.normalized ?? null])));
    function effectiveDirections(rule, prefixes) {
      const directions = prefixes.flatMap(word => simpleAbsoluteDirections.includes(word) ? [word]
        : directionaggregates[word] ?? []);
      if (directions.length === 0) directions.push(...directionaggregates.orthogonal);
      const relative = rows => completed(rows).some(row => row.cells.some(cell => cell.terms?.some(term =>
        relativeDirections.includes(term.qualifier?.normalized))));
      const directional = completed(rule.lhs).some(row => row.cells.length > 1) || relative(rule.lhs) || relative(rule.rhs);
      return directional ? directions : directions.slice(0, 1);
    }
    for (const { line, rule } of native) {
      const actual = document.rules.find(candidate => candidate.span.start.line === line);
      assert.ok(actual !== undefined, fixture.name + ': authored rule structure missing line ' + line);
      if (rule.bracket !== undefined) {
        assert.equal(actual.kind, rule.bracket === 1 ? types.SourceRuleKind.StartLoop : types.SourceRuleKind.EndLoop,
          fixture.name + ': authored rule structure loop line ' + line);
      } else {
        assert.ok('lhs' in actual, fixture.name + ': authored rule structure pattern line ' + line);
        const prefixes = actual.prefixWords.map(word => word.normalized);
        assert.deepEqual({
          directions: effectiveDirections(actual, prefixes),
          late: prefixes.includes('late'), rigid: prefixes.includes('rigid'), random: prefixes.includes('random'),
          lhs: cells(actual.lhs), rhs: cells(actual.rhs),
          commands: actual.commands.map(command => command.kind === types.SourceRuleCommandKind.Message
            ? [command.word.normalized, command.legacyPayload] : [command.word.normalized]),
        }, { directions: rule.directions, late: rule.late, rigid: rule.rigid, random: rule.randomRule,
          lhs: rule.lhs, rhs: rule.rhs, commands: rule.commands }, fixture.name + ': authored rule structure line ' + line);
      }
    }
  }
  function readIndependently(fixture, options) {
    const producers = ['compile', 'loadFile', 'processRuleString', 'tokenizeRuleLine'];
    const originals = new Map(producers.map(name => [name, globalThis[name]]));
    for (const name of producers) globalThis[name] = () => { throw new Error('TS source reader called JS producer ' + name); };
    // codeMirrorFn is a global lexical binding, not a globalThis property.
    const originalParser = codeMirrorFn;
    codeMirrorFn = function() { throw new Error('TS source reader called JS producer codeMirrorFn'); };
    let result;
    try {
      result = (options.readSource ?? types.readSource)(fixture.source);
    } finally {
      codeMirrorFn = originalParser;
      for (const [name, original] of originals) globalThis[name] = original;
    }
    checkSpans(fixture, result.document);
    return result;
  }
  function compareFixture(fixture, options = {}) {
    const native = buildParserStateSnapshot(fixture.source).parser_state;
    const nativeRules = nativeRuleStructures(fixture.source);
    const result = readIndependently(fixture, options);
    assert.deepEqual(authoredView(result.document), {
      sections: native.visited_sections, metadata: native.metadata_pairs, objects: native.objects,
      rules: native.rules, levels: native.levels.filter(level => level.kind === 'message' || level.rows.length > 0),
    }, fixture.name + ': common authored source');
    compareRuleStructures(fixture, result.document, nativeRules.structures);
    return { objects: result.document.objects.length, rules: result.document.rules.length,
      levels: result.document.levels.length, lines: result.document.lines.length,
      ruleStructures: nativeRules.structures.length, skippedErroredRules: nativeRules.skippedErroredRules,
      rejectedRuleStructures: nativeRules.rejectedRuleStructures };
  }
  const corpusFixtures = () => testdata.map(([name, data]) => ({ name, source: data[0] }));
  const compilationFixtures = () => errormessage_testdata.map(([name, data]) => ({ name, source: data[0] }));
  const checkPreservation = (fixture, options = {}) => readIndependently(fixture, options);
  return { compareFixture, corpusFixtures, compilationFixtures, checkPreservation };
}
module.exports = { createSourceOracle };
