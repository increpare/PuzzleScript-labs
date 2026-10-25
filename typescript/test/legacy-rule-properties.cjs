'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPuzzleScript } = require('./native-host.cjs');

function createRulePropertiesOracle(types) {
  loadPuzzleScript({ includeTests: true });
  const qualifierNames = ['', 'up', 'down', 'left', 'right', 'action', 'stationary', 'no', 'random', 'randomdir',
    'horizontal', 'vertical', 'orthogonal', 'moving', '>', '<', '^', 'v', 'parallel', 'perpendicular',
    'horizontal_par', 'vertical_par', 'horizontal_perp', 'vertical_perp', '...'];
  const directionNames = ['up', 'down', 'left', 'right', 'action'];
  const commandNames = ['cancel', 'restart', 'win', 'checkpoint', 'again', 'message', 'sound'];
  const producers = [...new Set(['compiler.js', 'parser.js'].flatMap(file => {
    const source = fs.readFileSync(path.join(__dirname, './vanilla/js', file), 'utf8');
    return [...source.matchAll(/^function (\w+)\s*\(/gm)].map(match => match[1]);
  }))];
  const nativeView = rules => rules.map(rule => ({ line: rule.lineNumber, sourceGroup: rule.groupNumber,
    direction: rule.direction, lhs: structuredClone(rule.lhs), rhs: structuredClone(rule.rhs),
    late: rule.late, rigid: rule.rigid, random: rule.randomRule, commands: structuredClone(rule.commands) }));

  function nativeStages(source, options = {}) {
    resetParserErrorState();
    const processor = new codeMirrorFn();
    const parsed = processor.startState();
    // Every native record comes from original text and actual native producers.
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
    const invalidBeforeMovement = parsed.invalid === true;
    parsed.invalid = false;
    const movement = named.flatMap(rule => concretizeMovingRule(parsed, rule, rule.lineNumber));
    const movementInvalid = parsed.invalid === true;
    const before = nativeView(movement);
    options.beforeProperties?.({ rules: before, syntaxInvalid: invalidBeforeMovement, movementInvalid });
    const diagnostics = [], expanded = [], owners = [];
    const loggerNames = ['logError', 'logWarning', 'logWarningNoLine'];
    const originals = loggerNames.map(name => globalThis[name]);
    try {
      globalThis.logError = (message, line) => diagnostics.push({ message, line: line ?? null,
        severity: types.SourceDiagnosticSeverity.Error, countsAsError: true });
      globalThis.logWarning = (message, line) => diagnostics.push({ message, line: line ?? null,
        severity: types.SourceDiagnosticSeverity.Warning, countsAsError: line === undefined });
      globalThis.logWarningNoLine = message => diagnostics.push({ message, line: null,
        severity: types.SourceDiagnosticSeverity.Warning, countsAsError: true });
      movement.forEach((rule, index) => {
        const variants = concretizePropertyRule(parsed, rule, rule.lineNumber);
        expanded.push(...variants);
        owners.push(...variants.map(() => index));
      });
    } finally {
      loggerNames.forEach((name, index) => { globalThis[name] = originals[index]; });
    }
    const after = nativeView(expanded);
    const propertyInvalid = parsed.invalid === true;
    expanded.forEach(rule => makeSpawnedObjectsStationary(parsed, rule, rule.lineNumber));
    return { before, after, spawned: nativeView(expanded), diagnostics, owners, invalidBeforeMovement,
      movementInvalid, propertyInvalid, syntaxCount: syntax.length, namedCount: named.length };
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
    const originalParser = codeMirrorFn, originalStream = CodeMirror.StringStream;
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

  function checkRecords(rules, inputs, owners, declarations, stage) {
    assert.notEqual(rules, inputs, 'new ' + stage + ' collection');
    rules.forEach((rule, index) => {
      const input = inputs[owners[index]];
      assert.notEqual(rule, input, 'new ' + stage + ' rule');
      assert.deepEqual(Object.keys(rule).sort(), Object.keys(input).sort(), 'no leaked rule bookkeeping');
      for (const key of ['source', 'sourceGroup', 'commands', 'direction', 'late', 'rigid', 'random']) {
        assert.equal(rule[key], input[key], 'preserve ' + key + ' identity/value');
      }
      for (const side of ['lhs', 'rhs']) {
        assert.notEqual(rule[side], input[side], 'new ' + stage + ' side');
        assert.equal(rule[side].length, input[side].length, 'preserved row count');
        rule[side].forEach((row, rowIndex) => {
          const originalRow = input[side][rowIndex];
          assert.notEqual(row, originalRow, 'new ' + stage + ' row');
          assert.equal(row.length, originalRow.length, 'preserved cell count');
          row.forEach((cell, cellIndex) => {
            const original = originalRow[cellIndex];
            assert.notEqual(cell, original, 'new ' + stage + ' cell');
            const origins = original.flatMap(term => {
              // Only the negative-property sweep changes the slot count.
              const members = stage === 'property' && term.qualifier === types.RuleQualifier.No
                ? declarations.ruleNames.properties.get(term.name) : undefined;
              return members === undefined ? [term.origin] : members.map(() => term.origin);
            });
            assert.equal(cell.length, origins.length, 'preserved expanded term count');
            cell.forEach((term, termIndex) => {
              assert.deepEqual(Object.keys(term).sort(), ['name', 'origin', 'qualifier'], 'no leaked term bookkeeping');
              assert.ok(!original.includes(term), 'new ' + stage + ' term');
              assert.equal(term.origin, origins[termIndex], 'preserve origin identity');
            });
          });
        });
      }
    });
  }

  function diagnosticView(document, diagnostics) {
    return diagnostics.map(issue => {
      assert.equal(issue.phase, types.SourceDiagnosticPhase.Rules, 'property diagnostic phase');
      assert.equal(issue.code, 'ambiguous-rule-property', 'property diagnostic code');
      assert.notEqual(issue.span, null, 'property diagnostic has evidence');
      for (const position of [issue.span.start, issue.span.end]) {
        const line = document.lines[position.line - 1];
        assert.ok(line !== undefined && position.column >= 1 && position.column <= line.original.length + 1, 'diagnostic evidence bounds');
        assert.equal(position.offset, line.span.start.offset + position.column - 1, 'diagnostic evidence offset');
      }
      return { message: issue.message, line: issue.span.start.line, severity: issue.severity, countsAsError: issue.countsAsError };
    });
  }

  function candidateStages(source, options = {}) {
    let inputs, snapshot, result, spawned;
    independently(() => {
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
      const movement = types.expandRuleMovements(named.rules);
      freezeInput(movement);
      inputs = { document, declarations, syntax, negatives, oriented, named, movement };
      snapshot = structuredClone(inputs);
      result = (options.expandRuleProperties ?? types.expandRuleProperties)(movement.rules, declarations);
      assert.deepEqual(inputs, snapshot, 'property inputs are unchanged');
      freezeInput(result);
      const beforeSpawn = structuredClone({ inputs, result });
      spawned = (options.inferSpawnedStationary ?? types.inferSpawnedStationary)(result.rules, declarations);
      assert.deepEqual({ inputs, result }, beforeSpawn, 'spawn inputs are unchanged');
    });
    return { ...inputs, result, spawned };
  }

  function compareFixture(fixture, options = {}) {
    const expected = nativeStages(fixture.source);
    const candidate = candidateStages(fixture.source, options);
    const { document, declarations, movement, result, spawned } = candidate;
    assert.deepEqual(candidateView(movement.rules), expected.before, fixture.name + ': before properties');
    assert.deepEqual(candidateView(result.rules), expected.after, fixture.name + ': complete property sequence');
    assert.deepEqual(candidateView(spawned), expected.spawned, fixture.name + ': complete spawn sequence');
    assert.deepEqual(diagnosticView(document, result.diagnostics), expected.diagnostics, fixture.name + ': property diagnostics');
    assert.equal(movement.abortsCompilation, expected.movementInvalid, fixture.name + ': separate movement invalid state');
    assert.equal(expected.propertyInvalid, expected.movementInvalid, 'property ambiguity does not newly set native invalid');
    assert.deepEqual(Object.keys(result).sort(), ['diagnostics', 'rules'], 'no leaked result bookkeeping');
    checkRecords(result.rules, movement.rules, expected.owners, declarations, 'property');
    checkRecords(spawned, result.rules, spawned.map((_, index) => index), declarations, 'spawn');
    return { ...candidate, expected };
  }
  return { compareFixture, nativeStages, candidateStages, independently, producers,
    corpusFixtures: () => testdata.map(([name, data]) => ({ name, source: data[0] })) };
}

module.exports = { createRulePropertiesOracle };
