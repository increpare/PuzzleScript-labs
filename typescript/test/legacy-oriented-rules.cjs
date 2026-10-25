'use strict';

const assert = require('node:assert/strict');
const { loadPuzzleScript } = require('./native-host.cjs');

// The native path parses original text and runs its actual preceding passes.
// Candidate terms, declarations and direction arrays never enter native code.
function createOrientedRulesOracle(types) {
  loadPuzzleScript({ includeTests: true });
  const qualifierNames = ['', 'up', 'down', 'left', 'right', 'action', 'stationary', 'no', 'random', 'randomdir',
    'horizontal', 'vertical', 'orthogonal', 'moving', '>', '<', '^', 'v', 'parallel', 'perpendicular',
    'horizontal_par', 'vertical_par', 'horizontal_perp', 'vertical_perp', '...'];
  const directionNames = ['up', 'down', 'left', 'right', 'action'];
  const commandNames = ['cancel', 'restart', 'win', 'checkpoint', 'again', 'message', 'sound'];
  const producers = ['compile', 'loadFile', 'processRuleString', 'tokenizeRuleLine', 'findIndexAfterToken',
    'generateExtraMembers', 'generateMasks', 'lookupLegendName', 'checkSuperfluousCoincidences',
    'rulesToArray', 'deepCloneRule', 'convertRelativeDirsToAbsolute', 'absolutifyRuleCell',
    'rewriteUpLeftRules', 'containsEllipsis', 'atomizeAggregates', 'atomizeCellAggregates', 'rephraseSynonyms'];

  const nativeView = (rules, oriented) => rules.map(rule => ({ line: rule.lineNumber, sourceGroup: rule.groupNumber,
    ...(oriented ? { direction: rule.direction } : { directions: [...rule.directions] }),
    lhs: structuredClone(rule.lhs), rhs: structuredClone(rule.rhs), late: rule.late, rigid: rule.rigid,
    random: rule.randomRule, commands: structuredClone(rule.commands) }));

  function nativeStages(source, options = {}) {
    resetParserErrorState();
    const processor = new codeMirrorFn();
    const parsed = processor.startState();
    for (const line of source.split('\n')) {
      const stream = new CodeMirror.StringStream(line, 4);
      do { processor.token(stream, parsed); } while (!stream.eol());
    }
    generateExtraMembers(parsed);
    generateMasks(parsed);
    const rules = [];
    for (const tuple of parsed.rules) {
      const rule = processRuleString(tuple, parsed, rules);
      if (rule !== null && rule.bracket === undefined) rules.push(rule);
    }
    const syntax = nativeView(rules, false);
    checkSuperfluousCoincidences(parsed, rules);
    // Artificial boundary fixtures start from separately parsed native records.
    // Native syntax rejects unequal row counts, so this fixed edit tests only
    // the public stage's behavior on an unmatched RHS row.
    if (options.lhsRowsAtStageBoundary !== undefined) {
      for (const rule of rules) rule.lhs = rule.lhs.slice(0, options.lhsRowsAtStageBoundary);
    }
    const before = nativeView(rules, false);
    const oriented = [];
    // Deliberately use deepCloneRule for every retained selector, including repeats.
    for (const rule of rules) for (const direction of rule.directions) {
      const copy = deepCloneRule(rule);
      copy.direction = direction;
      convertRelativeDirsToAbsolute(copy);
      rewriteUpLeftRules(copy);
      oriented.push(copy);
    }
    const beforeNames = nativeView(oriented, true);
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
      for (const rule of oriented) {
        atomizeAggregates(parsed, rule);
        rephraseSynonyms(parsed, rule);
      }
    } finally {
      loggerNames.forEach((name, index) => { globalThis[name] = originals[index]; });
    }
    return { syntax, before, beforeNames, after: nativeView(oriented, true), diagnostics,
      aggregates: structuredClone(parsed.aggregatesDict), captured: parsed.rules.length };
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

  function candidateView(rules, oriented) {
    const rows = side => side.map(row => row.map(cell => cell.flatMap(term => {
      assert.ok(Number.isInteger(term.qualifier) && qualifierNames[term.qualifier] !== undefined, 'numeric qualifier');
      assert.equal(typeof term.name, 'string', 'named terms retain string identities');
      return [qualifierNames[term.qualifier], term.name];
    })));
    return rules.map(rule => {
      if (oriented) {
        assert.equal(Object.hasOwn(rule, 'directions'), false, 'oriented records omit obsolete directions');
        assert.ok(Number.isInteger(rule.direction) && directionNames[rule.direction] !== undefined, 'numeric orientation');
      }
      return { line: rule.source.originalLine.span.start.line, sourceGroup: rule.sourceGroup,
        ...(oriented ? { direction: directionNames[rule.direction] } : { directions: rule.directions.map(dir => directionNames[dir]) }),
        lhs: rows(rule.lhs), rhs: rows(rule.rhs), late: rule.late, rigid: rule.rigid, random: rule.random,
        commands: rule.commands.map(command => command.kind === types.CommandKind.Sound ? ['sfx' + command.index]
          : command.kind === types.CommandKind.Message ? ['message', command.text] : [commandNames[command.kind]]) };
    });
  }

  function checkHeader(rule, input) {
    assert.notEqual(rule, input, 'new rule record');
    for (const key of ['source', 'sourceGroup', 'commands', 'late', 'rigid', 'random']) {
      assert.equal(rule[key], input[key], 'preserve ' + key + ' identity/value');
    }
  }

  function checkOrientations(oriented, before) {
    assert.notEqual(oriented, before, 'new orientation collection');
    let index = 0;
    for (const input of before) for (const direction of input.directions) {
      const rule = oriented[index++];
      checkHeader(rule, input);
      const reversed = rule.direction !== direction;
      for (const side of ['lhs', 'rhs']) {
        assert.notEqual(rule[side], input[side], 'new orientation side');
        assert.equal(rule[side].length, input[side].length, 'orientation row count');
        rule[side].forEach((row, rowIndex) => {
          const originalRow = input[side][rowIndex];
          const reverse = reversed && (side === 'lhs' || rowIndex < input.lhs.length);
          assert.notEqual(row, originalRow, 'new orientation row');
          assert.equal(row.length, originalRow.length, 'orientation cell count');
          row.forEach((cell, cellIndex) => {
            const original = originalRow[reverse ? row.length - 1 - cellIndex : cellIndex];
            assert.notEqual(cell, original, 'new orientation cell');
            assert.equal(cell.length, original.length, 'orientation term count');
            cell.forEach((term, termIndex) => {
              assert.notEqual(term, original[termIndex], 'new oriented term');
              assert.equal(term.origin, original[termIndex].origin, 'preserve orientation evidence identity');
            });
          });
        });
      }
    }
    assert.equal(index, oriented.length, 'every retained selector');
  }

  function checkNames(rules, before, aggregates) {
    assert.notEqual(rules, before, 'new name-expansion collection');
    assert.equal(rules.length, before.length, 'name expansion preserves variants');
    rules.forEach((rule, ruleIndex) => {
      const input = before[ruleIndex];
      checkHeader(rule, input);
      assert.equal(rule.direction, input.direction, 'preserve orientation');
      for (const side of ['lhs', 'rhs']) {
        assert.notEqual(rule[side], input[side], 'new expanded side');
        assert.equal(rule[side].length, input[side].length, 'name expansion row count');
        rule[side].forEach((row, rowIndex) => {
          const originalRow = input[side][rowIndex];
          assert.notEqual(row, originalRow, 'new expanded row');
          assert.equal(row.length, originalRow.length, 'name expansion cell count');
          row.forEach((cell, cellIndex) => {
            const original = originalRow[cellIndex];
            assert.notEqual(cell, original, 'new expanded cell');
            // Native values are compared separately. Here each retained/appended
            // slot follows its authored evidence, including duplicate names.
            const provenance = original.map(term => ({ name: term.name, origin: term.origin }));
            for (let index = 0; index < provenance.length; index++) {
              const term = provenance[index];
              const members = aggregates[term.name];
              if (members === undefined) continue;
              term.name = members[0];
              for (const name of members.slice(1)) provenance.push({ name, origin: term.origin });
            }
            assert.equal(cell.length, provenance.length, 'expanded term count');
            cell.forEach((term, termIndex) => {
              assert.ok(!original.includes(term), 'new expanded term');
              assert.equal(term.origin, provenance[termIndex].origin, 'preserve expanded evidence identity');
            });
          });
        });
      }
    });
  }

  function diagnosticView(document, diagnostics) {
    return diagnostics.map(issue => {
      assert.equal(issue.phase, types.SourceDiagnosticPhase.Rules, 'rule diagnostic phase');
      assert.ok(issue.code.length > 0, 'structured diagnostic code');
      assert.notEqual(issue.span, null, 'name diagnostic has evidence');
      for (const position of [issue.span.start, issue.span.end]) {
        const line = document.lines[position.line - 1];
        assert.ok(line !== undefined && position.column >= 1 && position.column <= line.original.length + 1, 'diagnostic evidence bounds');
        assert.equal(position.offset, line.span.start.offset + position.column - 1, 'diagnostic evidence offset');
      }
      return { message: issue.message, line: issue.span.start.line, severity: issue.severity, countsAsError: issue.countsAsError };
    });
  }

  function candidateStages(source, options = {}) {
    let document, declarations, syntax, negatives, orientationInputs, oriented, snapshots;
    const result = independently(() => {
      ({ document } = (options.readSource ?? types.readSource)(source));
      freezeInput(document);
      ({ declarations } = (options.resolveDeclarations ?? types.resolveDeclarations)(document));
      freezeInput(declarations);
      syntax = (options.recoverRuleSyntax ?? types.recoverRuleSyntax)(document, declarations);
      freezeInput(syntax);
      negatives = (options.checkEarlyNegativeTerms ?? types.checkEarlyNegativeTerms)(syntax.rules, declarations);
      freezeInput(negatives);
      orientationInputs = options.lhsRowsAtStageBoundary === undefined ? negatives.rules
        : negatives.rules.map(rule => ({ ...rule, lhs: rule.lhs.slice(0, options.lhsRowsAtStageBoundary) }));
      freezeInput(orientationInputs);
      snapshots = structuredClone({ document, declarations, syntax, negatives, orientationInputs });
      oriented = (options.orientRules ?? types.orientRules)(orientationInputs);
      assert.deepEqual({ document, declarations, syntax, negatives, orientationInputs }, snapshots, 'orientation inputs are unchanged');
      freezeInput(oriented);
      snapshots = structuredClone({ document, declarations, syntax, negatives, orientationInputs, oriented });
      return (options.expandRuleNames ?? types.expandRuleNames)(oriented, declarations);
    });
    assert.deepEqual({ document, declarations, syntax, negatives, orientationInputs, oriented }, snapshots, 'name expansion inputs are unchanged');
    return { document, declarations, syntax, negatives, orientationInputs, oriented, result };
  }

  function compareFixture(fixture, options = {}) {
    const expected = nativeStages(fixture.source, options);
    const candidate = candidateStages(fixture.source, options);
    const { document, syntax, orientationInputs, oriented, result } = candidate;
    assert.deepEqual(candidateView(syntax.rules, false), expected.syntax, fixture.name + ': original syntax');
    assert.deepEqual(candidateView(orientationInputs, false), expected.before, fixture.name + ': before orientations');
    assert.deepEqual(candidateView(oriented, true), expected.beforeNames, fixture.name + ': effective orientations');
    assert.deepEqual(candidateView(result.rules, true), expected.after, fixture.name + ': effective expanded names');
    assert.deepEqual(diagnosticView(document, result.diagnostics), expected.diagnostics, fixture.name + ': name-expansion diagnostics');
    checkOrientations(oriented, orientationInputs);
    checkNames(result.rules, oriented, expected.aggregates);
    return { ...candidate, expected, captured: expected.captured };
  }
  return { compareFixture, candidateStages, nativeStages, independently, producers,
    corpusFixtures: () => testdata.map(([name, data]) => ({ name, source: data[0] })) };
}
module.exports = { createOrientedRulesOracle };
