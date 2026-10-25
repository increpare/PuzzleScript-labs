'use strict';

const assert = require('node:assert/strict');
const { loadPuzzleScript } = require('./native-host.cjs');

// The native parser supplies its own tuples; no candidate tokens or authored
// term arrays are ever supplied to processRuleString.
// Reuse requires an earlier oracle to have loaded and verified this pinned host
// with tests. Native tuples and candidate producer guards remain unchanged.
function createRuleSyntaxOracle(types, { nativeAlreadyLoaded = false } = {}) {
  if (!nativeAlreadyLoaded) loadPuzzleScript({ includeTests: true });
  const qualifierNames = ['', 'up', 'down', 'left', 'right', 'action', 'stationary', 'no', 'random', 'randomdir',
    'horizontal', 'vertical', 'orthogonal', 'moving', '>', '<', '^', 'v', 'parallel', 'perpendicular',
    'horizontal_par', 'vertical_par', 'horizontal_perp', 'vertical_perp', '...'];
  const directionNames = ['up', 'down', 'left', 'right', 'action'];
  const commandNames = ['cancel', 'restart', 'win', 'checkpoint', 'again', 'message', 'sound'];

  function nativeSyntax(source) {
    resetParserErrorState();
    const processor = new codeMirrorFn();
    const parsed = processor.startState();
    for (const line of source.split('\n')) {
      const stream = new CodeMirror.StringStream(line, 4);
      do { processor.token(stream, parsed); } while (!stream.eol());
    }
    // Syntax consults the final property namespace, including promoted aliases.
    // Run the actual preceding native stage before capturing syntax diagnostics.
    generateExtraMembers(parsed);
    const prior = [];
    const rules = [];
    const loops = [];
    const diagnostics = [];
    const loggers = ['logError', 'logWarning', 'logWarningNoLine'];
    const originals = loggers.map(name => globalThis[name]);
    try {
      globalThis.logError = (message, line) => diagnostics.push({ message, line: line ?? null, severity: types.SourceDiagnosticSeverity.Error, countsAsError: true });
      globalThis.logWarning = (message, line) => diagnostics.push({ message, line: line ?? null, severity: types.SourceDiagnosticSeverity.Warning, countsAsError: line === undefined });
      globalThis.logWarningNoLine = message => diagnostics.push({ message, line: null, severity: types.SourceDiagnosticSeverity.Warning, countsAsError: true });
      for (const tuple of parsed.rules) {
        const rule = processRuleString(tuple, parsed, prior);
        if (rule === null) continue;
        if (rule.bracket !== undefined) loops.push({ line: tuple[1], bracket: rule.bracket });
        else {
          prior.push(rule); // Keep every non-null ordinary predecessor, including errored rules.
          rules.push({ line: rule.lineNumber, sourceGroup: rule.groupNumber, directions: rule.directions,
            lhs: rule.lhs, rhs: rule.rhs, late: rule.late, rigid: rule.rigid, random: rule.randomRule, commands: rule.commands });
        }
      }
    } finally {
      loggers.forEach((name, index) => { globalThis[name] = originals[index]; });
    }
    return { rules, loops, abortsCompilation: parsed.invalid === true,
      diagnostics, captured: parsed.rules.length };
  }

  function freezeSource(value) {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
    for (const child of Object.values(value)) freezeSource(child);
    Object.freeze(value);
  }

  function independently(callback) {
    const producers = ['compile', 'loadFile', 'processRuleString', 'tokenizeRuleLine', 'findIndexAfterToken',
      'generateExtraMembers', 'generateMasks', 'lookupLegendName'];
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

  function candidateView(document, result) {
    const rows = side => side.map(row => row.map(cell => cell.flatMap(term => {
      assert.ok(Number.isInteger(term.qualifier) && qualifierNames[term.qualifier] !== undefined, 'numeric qualifier');
      const { start, end } = term.origin;
      assert.ok(start.offset < end.offset, 'nonempty term evidence');
      assert.equal(start.line, end.line, 'one physical line per term');
      for (const position of [start, end]) {
        assert.ok(position.column >= 1 && position.column <= document.lines[position.line - 1].original.length + 1, 'term evidence bounds');
        assert.equal(position.offset, document.lines[position.line - 1].span.start.offset + position.column - 1, 'term evidence offset');
      }
      return [qualifierNames[term.qualifier], term.name];
    })));
    return {
      rules: result.rules.map(rule => {
        assert.ok(document.rules.includes(rule.source), 'preserve authored rule identity');
        return { line: rule.source.originalLine.span.start.line, sourceGroup: rule.sourceGroup,
          directions: rule.directions.map(direction => directionNames[direction]), lhs: rows(rule.lhs), rhs: rows(rule.rhs),
          late: rule.late, rigid: rule.rigid, random: rule.random,
          commands: rule.commands.map(command => command.kind === types.CommandKind.Sound ? ['sfx' + command.index]
            : command.kind === types.CommandKind.Message ? ['message', command.text] : [commandNames[command.kind]]) };
      }),
      loops: result.loops.map(loop => {
        assert.ok(document.rules.includes(loop), 'preserve authored loop identity');
        return { line: loop.originalLine.span.start.line, bracket: loop.kind === types.SourceRuleKind.StartLoop ? 1 : -1 };
      }),
      abortsCompilation: result.abortsCompilation,
      diagnostics: result.diagnostics.map(issue => {
        assert.equal(issue.phase, types.SourceDiagnosticPhase.Rules, 'rule diagnostic phase');
        assert.ok(issue.code.length > 0, 'structured diagnostic code');
        if (issue.span !== null) {
          assert.ok(issue.span.start.offset <= issue.span.end.offset, 'diagnostic evidence order');
          for (const position of [issue.span.start, issue.span.end]) {
            const line = document.lines[position.line - 1];
            assert.ok(line !== undefined && position.column >= 1 && position.column <= line.original.length + 1, 'diagnostic evidence bounds');
            assert.equal(position.offset, line.span.start.offset + position.column - 1, 'diagnostic evidence offset');
          }
        }
        return { message: issue.message, line: issue.span?.start.line ?? null, severity: issue.severity, countsAsError: issue.countsAsError };
      }),
    };
  }

  function compareFixture(fixture, options = {}) {
    const expected = nativeSyntax(fixture.source);
    let document;
    let before;
    const result = independently(() => {
      ({ document } = (options.readSource ?? types.readSource)(fixture.source));
      before = structuredClone(document);
      freezeSource(document);
      const { declarations } = (options.resolveDeclarations ?? types.resolveDeclarations)(document);
      return (options.recoverRuleSyntax ?? types.recoverRuleSyntax)(document, declarations);
    });
    const actual = candidateView(document, result);
    assert.deepEqual(actual, { rules: expected.rules, loops: expected.loops, abortsCompilation: expected.abortsCompilation,
      diagnostics: expected.diagnostics }, fixture.name + ': effective rule syntax');
    assert.deepEqual(document, before, fixture.name + ': authored AST is unchanged');
    return { document, result, captured: expected.captured, rules: result.rules.length, loops: result.loops.length,
      diagnostics: result.diagnostics.length, aborted: result.abortsCompilation ? 1 : 0 };
  }
  return { compareFixture, independently, corpusFixtures: () => testdata.map(([name, data]) => ({ name, source: data[0] })) };
}
module.exports = { createRuleSyntaxOracle };
