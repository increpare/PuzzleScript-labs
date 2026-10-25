'use strict';

const assert = require('node:assert/strict');
const { loadPuzzleScript } = require('./native-host.cjs');
const { nativeSourceObjects, candidateObjectLabels, orphanLabel } = require('./legacy-source-objects.cjs');

// Native parsing and preceding declaration stages receive only original source.
// No candidate tokens, names, layers, or rule arrays enter the native pass.
function createRuleNegativesOracle(types, { nativeAlreadyLoaded = false } = {}) {
  if (!nativeAlreadyLoaded) loadPuzzleScript({ includeTests: true });
  const qualifierNames = ['', 'up', 'down', 'left', 'right', 'action', 'stationary', 'no', 'random', 'randomdir',
    'horizontal', 'vertical', 'orthogonal', 'moving', '>', '<', '^', 'v', 'parallel', 'perpendicular',
    'horizontal_par', 'vertical_par', 'horizontal_perp', 'vertical_perp', '...'];
  const directionNames = ['up', 'down', 'left', 'right', 'action'];
  const commandNames = ['cancel', 'restart', 'win', 'checkpoint', 'again', 'message', 'sound'];

  const nativeView = rules => rules.map(rule => ({ line: rule.lineNumber, sourceGroup: rule.groupNumber,
    directions: [...rule.directions], lhs: structuredClone(rule.lhs), rhs: structuredClone(rule.rhs),
    late: rule.late, rigid: rule.rigid, random: rule.randomRule, commands: structuredClone(rule.commands) }));

  function nativeNegatives(source) {
    resetParserErrorState();
    const processor = new codeMirrorFn();
    const parsed = processor.startState();
    for (const line of source.split('\n')) {
      const stream = new CodeMirror.StringStream(line, 4);
      do { processor.token(stream, parsed); } while (!stream.eol());
    }
    generateExtraMembers(parsed);
    generateMasks(parsed);
    const projection = nativeSourceObjects(parsed);
    const lookups = {
      orphanedObject: projection.orphanedName === null ? null : orphanLabel(projection.orphanedName),
      raw: Object.keys(parsed.objects).sort((a, b) => parsed.objects[a].lineNumber - parsed.objects[b].lineNumber).map(name => {
        const mask = new BitVec(parsed.STRIDE_OBJ);
        mask.ibitset(parsed.objects[name].id);
        return [name, projection.members(mask).sort()];
      }),
      named: Object.keys(parsed.objectMasks).filter(name => name !== '\nall\n').sort()
        .map(name => [name, projection.members(parsed.objectMasks[name]).sort()]),
    };
    const rules = [];
    for (const tuple of parsed.rules) {
      const rule = processRuleString(tuple, parsed, rules);
      // Ordinary predecessors, including errored rules, alone establish '+' groups.
      if (rule !== null && rule.bracket === undefined) rules.push(rule);
    }
    const before = nativeView(rules);
    const diagnostics = [];
    const loggerNames = ['logError', 'logWarning', 'logWarningNoLine'];
    const originals = loggerNames.map(name => globalThis[name]);
    try {
      globalThis.logError = (message, line) => diagnostics.push({ message, line: line ?? null,
        severity: types.SourceDiagnosticSeverity.Error, countsAsError: true });
      globalThis.logWarning = (message, line) => diagnostics.push({ message, line: line ?? null,
        severity: types.SourceDiagnosticSeverity.Warning, countsAsError: line === undefined });
      globalThis.logWarningNoLine = message => diagnostics.push({ message, line: null,
        severity: types.SourceDiagnosticSeverity.Warning, countsAsError: true });
      checkSuperfluousCoincidences(parsed, rules);
    } finally {
      loggerNames.forEach((name, index) => { globalThis[name] = originals[index]; });
    }
    return { before, after: nativeView(rules), diagnostics, captured: parsed.rules.length, lookups };
  }

  function freezeInput(value, seen = new Set()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (value instanceof Map) for (const [key, child] of value) { freezeInput(key, seen); freezeInput(child, seen); }
    else if (value instanceof Set) for (const child of value) freezeInput(child, seen);
    else for (const child of Object.values(value)) freezeInput(child, seen);
    Object.freeze(value);
  }

  function independently(callback) {
    const producers = ['compile', 'loadFile', 'processRuleString', 'tokenizeRuleLine', 'findIndexAfterToken',
      'generateExtraMembers', 'generateMasks', 'lookupLegendName', 'checkSuperfluousCoincidences'];
    const originals = producers.map(name => globalThis[name]);
    const originalParser = codeMirrorFn;
    try {
      for (const name of producers) globalThis[name] = () => { throw new Error('Candidate called native ' + name); };
      codeMirrorFn = function() { throw new Error('Candidate called native codeMirrorFn'); };
      return callback();
    } finally {
      codeMirrorFn = originalParser;
      producers.forEach((name, index) => { globalThis[name] = originals[index]; });
    }
  }

  function candidateView(rules) {
    const rows = side => side.map(row => row.map(cell => cell.flatMap(term => {
      assert.ok(Number.isInteger(term.qualifier) && qualifierNames[term.qualifier] !== undefined, 'numeric qualifier');
      return [qualifierNames[term.qualifier], term.name];
    })));
    return rules.map(rule => ({ line: rule.source.originalLine.span.start.line, sourceGroup: rule.sourceGroup,
      directions: rule.directions.map(direction => directionNames[direction]), lhs: rows(rule.lhs), rhs: rows(rule.rhs),
      late: rule.late, rigid: rule.rigid, random: rule.random,
      commands: rule.commands.map(command => command.kind === types.CommandKind.Sound ? ['sfx' + command.index]
        : command.kind === types.CommandKind.Message ? ['message', command.text] : [commandNames[command.kind]]) }));
  }

  function diagnosticView(document, diagnostics) {
    return diagnostics.map(issue => {
      assert.equal(issue.phase, types.SourceDiagnosticPhase.Rules, 'rule diagnostic phase');
      assert.ok(issue.code.length > 0, 'structured diagnostic code');
      assert.notEqual(issue.span, null, 'negative diagnostic has rule evidence');
      for (const position of [issue.span.start, issue.span.end]) {
        const line = document.lines[position.line - 1];
        assert.ok(line !== undefined && position.column >= 1 && position.column <= line.original.length + 1, 'diagnostic evidence bounds');
        assert.equal(position.offset, line.span.start.offset + position.column - 1, 'diagnostic evidence offset');
      }
      return { message: issue.message, line: issue.span.start.line, severity: issue.severity, countsAsError: issue.countsAsError };
    });
  }

  function compareFixture(fixture, options = {}) {
    const expected = nativeNegatives(fixture.source);
    let document;
    let declarations;
    let syntax;
    let snapshots;
    const result = independently(() => {
      ({ document } = (options.readSource ?? types.readSource)(fixture.source));
      freezeInput(document);
      ({ declarations } = (options.resolveDeclarations ?? types.resolveDeclarations)(document));
      const label = candidateObjectLabels(declarations, fixture.name);
      assert.deepEqual({
        orphanedObject: declarations.orphanedObject === null ? null : label(declarations.orphanedObject),
        raw: [...declarations.rawObjectLookups].map(([object, members]) => [label(object), [...members].map(label).sort()]),
        named: [...declarations.namedObjects].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
          .map(([name, members]) => [name, [...members].map(label).sort()]),
      }, expected.lookups, fixture.name + ': independent raw and final object lookups');
      syntax = (options.recoverRuleSyntax ?? types.recoverRuleSyntax)(document, declarations);
      assert.deepEqual(candidateView(syntax.rules), expected.before, fixture.name + ': syntax before early negatives');
      snapshots = structuredClone({ document, declarations, syntax });
      freezeInput(declarations);
      freezeInput(syntax);
      return (options.checkEarlyNegativeTerms ?? types.checkEarlyNegativeTerms)(syntax.rules, declarations);
    });
    assert.deepEqual({ document, declarations, syntax }, snapshots, fixture.name + ': inputs are unchanged');
    assert.deepEqual(candidateView(result.rules), expected.after, fixture.name + ': effective early negatives');
    assert.deepEqual(diagnosticView(document, result.diagnostics), expected.diagnostics, fixture.name + ': early negative diagnostics');
    assert.notEqual(result.rules, syntax.rules, 'new rule collection');
    assert.equal(result.rules.length, syntax.rules.length, 'preserve rule count');
    result.rules.forEach((rule, index) => {
      const original = syntax.rules[index];
      assert.notEqual(rule, original, 'new rule record');
      for (const key of ['source', 'sourceGroup', 'directions', 'commands', 'late', 'rigid', 'random']) {
        assert.equal(rule[key], original[key], 'preserve ' + key + ' identity/value');
      }
      for (const side of ['lhs', 'rhs']) {
        assert.equal(rule[side].length, original[side].length, 'preserve row count');
        rule[side].forEach((row, rowIndex) => {
          assert.equal(row.length, original[side][rowIndex].length, 'preserve cell count');
          row.forEach((cell, cellIndex) => {
            const authored = original[side][rowIndex][cellIndex];
            let previous = -1;
            for (const term of cell) {
              const at = authored.indexOf(term, previous + 1);
              assert.ok(at > previous, 'retained term identity, origin and order');
              previous = at;
            }
          });
        });
      }
    });
    return { document, declarations, syntax, result, expected, captured: expected.captured };
  }
  return { compareFixture, independently, nativeNegatives,
    corpusFixtures: () => testdata.map(([name, data]) => ({ name, source: data[0] })) };
}

module.exports = { createRuleNegativesOracle };
