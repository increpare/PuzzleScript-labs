'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPuzzleScript } = require('./native-host.cjs');

function createRuleMovementsOracle(types) {
  loadPuzzleScript({ includeTests: true });
  const qualifierNames = ['', 'up', 'down', 'left', 'right', 'action', 'stationary', 'no', 'random', 'randomdir',
    'horizontal', 'vertical', 'orthogonal', 'moving', '>', '<', '^', 'v', 'parallel', 'perpendicular',
    'horizontal_par', 'vertical_par', 'horizontal_perp', 'vertical_perp', '...'];
  const directionNames = ['up', 'down', 'left', 'right', 'action'];
  const commandNames = ['cancel', 'restart', 'win', 'checkpoint', 'again', 'message', 'sound'];
  // Guard every native parser/compiler producer, including later passes.
  const producers = [...new Set(['compiler.js', 'parser.js'].flatMap(file => {
    const source = fs.readFileSync(path.join(__dirname, './vanilla/js', file), 'utf8');
    return [...source.matchAll(/^function (\w+)\s*\(/gm)].map(match => match[1]);
  }))];

  const nativeView = rules => rules.map(rule => ({ line: rule.lineNumber, sourceGroup: rule.groupNumber,
    direction: rule.direction, lhs: structuredClone(rule.lhs), rhs: structuredClone(rule.rhs),
    late: rule.late, rigid: rule.rigid, random: rule.randomRule, commands: structuredClone(rule.commands) }));

  function nativeStages(source) {
    resetParserErrorState();
    const processor = new codeMirrorFn();
    const parsed = processor.startState();
    // Only original source tuples enter the native path. Candidate data never does.
    for (const line of source.split('\n')) {
      const stream = new CodeMirror.StringStream(line, 4);
      do { processor.token(stream, parsed); } while (!stream.eol());
    }
    generateExtraMembers(parsed);
    generateMasks(parsed);
    const syntax = [];
    for (const tuple of parsed.rules) {
      const rule = processRuleString(tuple, parsed, syntax);
      if (rule !== null && rule.bracket === undefined) syntax.push(rule);
    }
    checkSuperfluousCoincidences(parsed, syntax);
    const named = [];
    for (const rule of syntax) for (const direction of rule.directions) {
      const copy = deepCloneRule(rule);
      copy.direction = direction;
      convertRelativeDirsToAbsolute(copy);
      rewriteUpLeftRules(copy);
      atomizeAggregates(parsed, copy);
      rephraseSynonyms(parsed, copy);
      named.push(copy);
    }
    const before = nativeView(named);
    const invalidBeforeMovement = parsed.invalid === true;
    // Earlier invalidity cannot be mistaken for this pass's own abort signal.
    parsed.invalid = false;
    const diagnostics = [];
    const originals = ['logError', 'logWarning', 'logWarningNoLine'].map(name => globalThis[name]);
    const rules = [], owners = [];
    try {
      globalThis.logError = (message, line) => diagnostics.push({ message, line: line ?? null,
        severity: types.SourceDiagnosticSeverity.Error, countsAsError: true });
      globalThis.logWarning = (message, line) => diagnostics.push({ message, line: line ?? null,
        severity: types.SourceDiagnosticSeverity.Warning, countsAsError: line === undefined });
      globalThis.logWarningNoLine = message => diagnostics.push({ message, line: null,
        severity: types.SourceDiagnosticSeverity.Warning, countsAsError: true });
      named.forEach((rule, index) => {
        const variants = concretizeMovingRule(parsed, rule, rule.lineNumber);
        rules.push(...variants);
        owners.push(...variants.map(() => index));
      });
    } finally {
      ['logError', 'logWarning', 'logWarningNoLine'].forEach((name, index) => { globalThis[name] = originals[index]; });
    }
    return { before, after: nativeView(rules), owners, diagnostics, invalidBeforeMovement,
      abortsCompilation: parsed.invalid === true, syntaxCount: syntax.length, captured: parsed.rules.length };
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
    const originalStream = CodeMirror.StringStream;
    try {
      for (const name of producers) globalThis[name] = () => { throw new Error('Candidate called native ' + name); };
      codeMirrorFn = function() { throw new Error('Candidate called native codeMirrorFn'); };
      CodeMirror.StringStream = function() { throw new Error('Candidate called native CodeMirror.StringStream'); };
      return callback();
    } finally {
      codeMirrorFn = originalParser;
      CodeMirror.StringStream = originalStream;
      producers.forEach((name, index) => { globalThis[name] = originals[index]; });
    }
  }

  function candidateView(rules) {
    const rows = side => side.map(row => row.map(cell => cell.flatMap(term => {
      assert.ok(Number.isInteger(term.qualifier) && qualifierNames[term.qualifier] !== undefined, 'numeric qualifier');
      assert.equal(typeof term.name, 'string', 'named terms retain string identities');
      return [qualifierNames[term.qualifier], term.name];
    })));
    return rules.map(rule => {
      assert.ok(Number.isInteger(rule.direction) && directionNames[rule.direction] !== undefined, 'numeric orientation');
      return { line: rule.source.originalLine.span.start.line, sourceGroup: rule.sourceGroup,
        direction: directionNames[rule.direction], lhs: rows(rule.lhs), rhs: rows(rule.rhs),
        late: rule.late, rigid: rule.rigid, random: rule.random,
        commands: rule.commands.map(command => command.kind === types.CommandKind.Sound ? ['sfx' + command.index]
          : command.kind === types.CommandKind.Message ? ['message', command.text] : [commandNames[command.kind]]) };
    });
  }

  function checkRecords(result, inputs, owners) {
    assert.deepEqual(Object.keys(result).sort(), ['abortsCompilation', 'diagnostics', 'rules'], 'no leaked result bookkeeping');
    assert.notEqual(result.rules, inputs, 'new movement collection');
    result.rules.forEach((rule, index) => {
      const input = inputs[owners[index]];
      assert.notEqual(rule, input, 'new movement rule');
      assert.deepEqual(Object.keys(rule).sort(), Object.keys(input).sort(), 'no leaked rule bookkeeping');
      for (const key of ['source', 'sourceGroup', 'commands', 'direction', 'late', 'rigid', 'random']) {
        assert.equal(rule[key], input[key], 'preserve ' + key + ' identity/value');
      }
      for (const side of ['lhs', 'rhs']) {
        assert.notEqual(rule[side], input[side], 'new movement side');
        assert.equal(rule[side].length, input[side].length, 'movement row count');
        rule[side].forEach((row, rowIndex) => {
          const originalRow = input[side][rowIndex];
          assert.notEqual(row, originalRow, 'new movement row');
          assert.equal(row.length, originalRow.length, 'movement cell count');
          row.forEach((cell, cellIndex) => {
            const original = originalRow[cellIndex];
            assert.notEqual(cell, original, 'new movement cell');
            assert.equal(cell.length, original.length, 'movement term count');
            cell.forEach((term, termIndex) => {
              assert.deepEqual(Object.keys(term).sort(), ['name', 'origin', 'qualifier'], 'no leaked term bookkeeping');
              assert.notEqual(term, original[termIndex], 'new movement term');
              assert.equal(term.origin, original[termIndex].origin, 'preserve movement origin identity');
            });
          });
        });
      }
    });
  }

  function diagnosticView(document, diagnostics) {
    return diagnostics.map(issue => {
      assert.equal(issue.phase, types.SourceDiagnosticPhase.Rules, 'movement diagnostic phase');
      assert.equal(issue.code, 'ambiguous-rule-movement', 'movement diagnostic code');
      assert.notEqual(issue.span, null, 'movement diagnostic has evidence');
      for (const position of [issue.span.start, issue.span.end]) {
        const line = document.lines[position.line - 1];
        assert.ok(line !== undefined && position.column >= 1 && position.column <= line.original.length + 1, 'diagnostic evidence bounds');
        assert.equal(position.offset, line.span.start.offset + position.column - 1, 'diagnostic evidence offset');
      }
      return { message: issue.message, line: issue.span.start.line, severity: issue.severity, countsAsError: issue.countsAsError };
    });
  }

  function candidateStages(source, options = {}) {
    let inputs, snapshot;
    const result = independently(() => {
      const { document } = (options.readSource ?? types.readSource)(source);
      freezeInput(document);
      const { declarations } = types.resolveDeclarations(document);
      freezeInput(declarations);
      const syntax = types.recoverRuleSyntax(document, declarations);
      freezeInput(syntax);
      const negatives = types.checkEarlyNegativeTerms(syntax.rules, declarations);
      freezeInput(negatives);
      const oriented = types.orientRules(negatives.rules);
      freezeInput(oriented);
      const named = types.expandRuleNames(oriented, declarations);
      freezeInput(named);
      inputs = { document, declarations, syntax, negatives, oriented, named };
      snapshot = structuredClone(inputs);
      return (options.expandRuleMovements ?? types.expandRuleMovements)(named.rules);
    });
    assert.deepEqual(inputs, snapshot, 'movement inputs are unchanged');
    return { ...inputs, result };
  }

  function compareFixture(fixture, options = {}) {
    const expected = nativeStages(fixture.source);
    const candidate = candidateStages(fixture.source, options);
    const { document, named, result } = candidate;
    assert.deepEqual(candidateView(named.rules), expected.before, fixture.name + ': before movements');
    assert.deepEqual(candidateView(result.rules), expected.after, fixture.name + ': complete movement sequence');
    assert.deepEqual(diagnosticView(document, result.diagnostics), expected.diagnostics, fixture.name + ': movement diagnostics');
    assert.equal(result.abortsCompilation, expected.abortsCompilation, fixture.name + ': movement stage invalid');
    checkRecords(result, named.rules, expected.owners);
    return { ...candidate, expected };
  }
  return { compareFixture, nativeStages, candidateStages, independently, producers,
    corpusFixtures: () => testdata.map(([name, data]) => ({ name, source: data[0] })) };
}

module.exports = { createRuleMovementsOracle };
