import assert from 'node:assert/strict';
import test from 'node:test';
import * as sourceTypes from '../build/source-model.js';
import { createSourceParserOracle } from './legacy-source-parser.cjs';
import { readSource } from '../build/source-reader.js';
import { resolveDeclarations } from '../build/declarations.js';
import { compileGameData } from '../build/source-game-data.js';
import { movementSource } from './scenarios.mjs';
import { walkSourceLexically } from '../build/source-lexical.js';
import { readAuthoredSource } from '../build/source-reader.js';
import { buildParserStateSnapshot } from './support/parser-snapshot.cjs';
const parser = await import('../build/source-parser.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const diagnostics = await import('../build/source-diagnostics.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const oracle = createSourceParserOracle({ ...sourceTypes, ...parser });

test('the source parser exposes independent native visits and authored evidence', () => {
  assert.equal(typeof parser.parseSource, 'function');
  oracle.compareFixture({ name: 'constructed empty source', source: '' });
});

test('the issue collector follows native deduplication, urgency and no-line warning counts', () => {
  assert.equal(typeof diagnostics.createSourceIssueCollection, 'function');
  const calls = [
    ['same', 0, false, 'errorText', true], ['same', 0, false, 'errorText', true],
    ['same', 1, false, 'errorText', true], ['same', 1, false, 'warningText', false],
    ['same', 0, true, 'errorText', true], ['same', undefined, false, 'warningText', true],
  ];
  const native = oracle.collect(() => calls.forEach(call => globalThis.logIssue(...call, false)));
  const collected = diagnostics.createSourceIssueCollection();
  for (const [message, line, urgent, className, countsAsError] of calls) diagnostics.collectSourceIssue(collected, {
    code: 'constructed', message, reportedLine: line ?? null, urgent,
    severity: className === 'warningText' ? sourceTypes.SourceDiagnosticSeverity.Warning : sourceTypes.SourceDiagnosticSeverity.Error,
    countsAsError, span: null, phase: sourceTypes.SourceDiagnosticPhase.Reader,
  });
  assert.deepEqual(oracle.view(collected.rawDiagnostics), native.raw);
  assert.deepEqual(oracle.view(collected.diagnostics), native.recorded);
  assert.equal(collected.errorCount, native.errorCount);
});

test('the global issue cap counts recorded issues and interrupts only after recording issue 101', () => {
  assert.equal(typeof diagnostics.createSourceIssueCollection, 'function');
  const native = oracle.collect(() => {
    for (let index = 0; index < 102; index++) {
      logWarning('duplicate', 1);
      logWarning('unique ' + index, index);
    }
  });
  const collected = diagnostics.createSourceIssueCollection();
  for (let index = 0; index < 102; index++) {
    const issue = message => ({ code: 'constructed', message, reportedLine: message === 'duplicate' ? 1 : index,
      severity: 0, countsAsError: false, span: null, phase: sourceTypes.SourceDiagnosticPhase.Reader });
    if (diagnostics.collectSourceIssue(collected, issue('duplicate'))) break;
    if (diagnostics.collectSourceIssue(collected, issue('unique ' + index))) break;
  }
  assert.deepEqual(oracle.view(collected.rawDiagnostics), native.raw);
  assert.deepEqual(oracle.view(collected.diagnostics), native.recorded);
  assert.equal(collected.diagnostics.length, 101);
});

test('all existing compilation sources match actual native parser visits and post-token exits', () => {
  const fixtures = oracle.compilationFixtures();
  assert.equal(fixtures.length, 335);
  let raw = 0, recorded = 0, exits = 0;
  for (const fixture of fixtures) {
    const { native } = oracle.compareFixture(fixture);
    raw += native.raw.length; recorded += native.recorded.length;
    if (native.reason !== null) exits++;
  }
  assert.deepEqual({ raw, recorded, exits }, { raw: 234, recorded: 210, exits: 3 });
});

test('collector deduplication uses displayed line and severity while ignoring code, phase and authored location', () => {
  const collected = diagnostics.createSourceIssueCollection();
  const position = { offset: 0, line: 1, column: 1 };
  const original = { code: 'first', message: 'same', severity: 0, countsAsError: false,
    span: { start: position, end: position }, phase: sourceTypes.SourceDiagnosticPhase.Reader };
  const calls = [original, { ...original, code: 'different', phase: sourceTypes.SourceDiagnosticPhase.Rules, span: null, reportedLine: 1 },
    { ...original, reportedLine: 0 }, { ...original, reportedLine: null, countsAsError: true },
    { ...original, severity: 1, countsAsError: false }];
  const native = oracle.collect(() => calls.forEach(issue => logIssue(issue.message,
    issue.reportedLine === null ? undefined : issue.reportedLine ?? issue.span?.start.line,
    false, issue.severity === 0 ? 'warningText' : 'errorText', issue.countsAsError, false)));
  calls.forEach(issue => diagnostics.collectSourceIssue(collected, issue));
  assert.deepEqual(oracle.view(collected.rawDiagnostics), native.raw);
  assert.deepEqual(oracle.view(collected.diagnostics), native.recorded);
  assert.equal(collected.errorCount, native.errorCount);
  assert.equal(collected.diagnostics.length, 4);
});

test('all original simulation sources retain their native nonzero parser issues without rejecting the game', () => {
  const fixtures = oracle.corpusFixtures();
  assert.equal(fixtures.length, 492);
  let raw = 0, recorded = 0, errors = 0, sourcesWithIssues = 0;
  for (const fixture of fixtures) {
    const { native } = oracle.compareFixture(fixture);
    raw += native.raw.length; recorded += native.recorded.length; errors += native.errorCount;
    if (native.raw.length > 0) sourcesWithIssues++;
    assert.equal(native.reason, null);
  }
  assert.deepEqual({ raw, recorded, errors, sourcesWithIssues }, { raw: 144, recorded: 144, errors: 14, sourcesWithIssues: 69 });
});

for (const key of ['title', 'author', 'homepage']) for (const prefix of ['', '(prefix)', '(prefix\n)']) {
  test('constructed literal metadata accepts the native physical visit casing: ' + JSON.stringify(prefix + key), () => {
    const source = movementSource().replace('title TypeScript movement comparison', prefix + key + ' MiXeD');
    const { native, result } = oracle.compareFixture({ name: source, source });
    assert.deepEqual(result.document.metadata.filter(item => item.accepted).flatMap(item => [item.key.normalized, item.value]), native.state.metadata);
    const document = readSource(source).document;
    assert.equal(document.metadata[0].authoredValue, 'MiXeD');
    const declarations = resolveDeclarations(document).declarations;
    assert.equal(compileGameData(document, declarations).metadata.get(key), 'MiXeD');
    const compiled = oracle.nativeMetadata(source);
    assert.equal(compiled.errorCount, 0);
    assert.equal(compiled.metadata[key], compileGameData(document, declarations).metadata.get(key));
  });
}

for (const prefix of ['', '(prefix)', '(prefix\n)']) test('constructed level message literal uses its actual native visit: ' + JSON.stringify(prefix), () => {
  const source = movementSource({ level: prefix + 'message MiXeD (Keep)' });
  const { native, result } = oracle.compareFixture({ name: 'constructed message reentry ' + prefix, source });
  const message = result.document.levels[0];
  assert.equal(message.authoredText, 'MiXeD (Keep)');
  assert.equal(source.slice(message.textSpan.start.offset, message.textSpan.end.offset), message.authoredText);
  assert.equal(message.text, native.state.levels.find(level => level[0] === '\n')[1]);
  const document = readSource(source).document;
  const compiled = oracle.nativeMetadata(source);
  assert.equal(compiled.errorCount, 0);
  assert.deepEqual(compiled.messages, ['MiXeD (Keep)']);
  assert.equal(compileGameData(document, resolveDeclarations(document).declarations).data.levels[0].text, compiled.messages[0]);
});

test('parser stops retain later authored text without accepting later lexical definitions', () => {
  const source = Array.from({ length: 6 }, (_, index) => 'unknown' + index).join('\n') + '\ntitle AFTER\nOBJECTS\nLater\nRed';
  const { result } = oracle.compareFixture({ name: 'constructed stopped prelude', source });
  assert.equal(result.outcome.kind, parser.SourceParserOutcomeKind.Stopped);
  assert.equal(result.document.metadata.at(-1).authoredValue, 'AFTER');
  assert.equal(result.document.metadata.at(-1).accepted, false);
  assert.deepEqual(result.document.objects[0].definitionNames, []);
});

test('single-character keyword aliases and legend names avoid warnings while primary names still warn', () => {
  const source = 'OBJECTS\nPlayer P > < ^ | [ ] V\nWhite\n\nV\nRed\nLEGEND\nv = Player\n> = Player\n^ = Player\nUp = Player';
  const { native } = oracle.compareFixture({ name: 'single-character keyword name roles', source });
  assert.deepEqual(native.raw.filter(issue => issue.message.includes('this is a keyword')).map(issue => [issue.line, issue.message]), [
    [5, 'You named an object "V", but this is a keyword. Don\'t do that!'],
    [11, 'You named an object "UP", but this is a keyword. Don\'t do that!'],
  ]);
});

test('collision-layer warnings include native recovery guidance in their exact visit order', () => {
  const source = 'OBJECTS\nA\nRed\n\nB\nBlue\nLEGEND\np = A or B\nSOUNDS\nCOLLISIONLAYERS\nA\nB\np,p';
  const { native } = oracle.compareFixture({ name: 'multiple collision layers recovery guidance', source });
  assert.deepEqual(native.raw.map(issue => issue.message), [
    'Object "P" included in multiple collision layers ( layers #1, #2, #3 ). You should fix this! (The compiler will just pick one layer to assign it to).',
    'Object "P" included in multiple collision layers ( layers #1, #2, #3 ). You should fix this! (The compiler will just pick one layer to assign it to).',
    'Object "P" included explicitly multiple times in the same layer. Don\'t do that innit.',
  ]);
});

test('native parser snapshots retain the current source line and actual rule-row state', () => {
  const line = '(prefix) [ Player ] [ Player ] -> [ Player ] message MiXeD';
  const source = movementSource({ rules: line }).split('\nwinconditions')[0].trimEnd();
  const { parser_state: state } = buildParserStateSnapshot(source);
  assert.equal(state.current_line_mixed_case, line);
  assert.equal(state.lhs_rhs_rowcount_difference, 1);
  assert.equal(state.rhs_pattern_started, true);
  assert.equal(Object.hasOwn(state, 'bracket_balance'), false);
  assert.equal(state.rules.at(-1).mixed_case, line);
});

test('editor blank-line visits and token-by-token state copies match the native compiler parser', () => {
  const source = movementSource({
    rules: '(prefix) [ Player ] -> message MiXeD\n\n[ Player ] [ Crate ] -> [ Player ]',
    level: 'PC.\n\nmessage End MiXeD\n\nPC.',
  }).replace('Player\nwhite', 'Player Alias > V\nwhite')
    .replace('C = Crate', 'C = Crate\nEither = Player or Crate\nBoth = Player and Crate');
  const { native } = oracle.compareFixture({ name: 'editor blank-line and copied-state parity', source });
  const editor = oracle.nativeEditorParser(source);
  // Native copyState explicitly adds uncompiled strides and omits its unused subsection.
  assert.equal(native.state.subsection, '');
  assert.equal(Object.hasOwn(editor.state, 'subsection'), false);
  for (const field of ['STRIDE_OBJ', 'STRIDE_MOV']) {
    assert.equal(Object.hasOwn(editor.state, field), true);
    assert.equal(editor.state[field], undefined);
  }
  assert.deepEqual({ ...editor, state: { ...editor.state, subsection: '' } },
    { ...native, state: { ...native.state, STRIDE_OBJ: undefined, STRIDE_MOV: undefined } });
  assert.equal(editor.state.lineNumber, source.split('\n').length);
  assert.equal(editor.state.original_case_names.alias, 'Alias');
  assert.equal(editor.state.original_case_names.either, 'Either');
  for (const field of ['legend_synonyms', 'legend_properties', 'legend_aggregates']) {
    assert.ok(editor.state[field].length > 0);
    for (const entry of editor.state[field]) assert.equal(typeof entry.lineNumber, 'number');
  }
});

const constructed = [
  ')\n((outer\ninner))\nOBJECTS junk\n= wrong\nLEGEND\nOBJECTS\nSOUNDS\nLEVELS\nZ',
  'title\ntitle First\ntitle Next\nnoaction extra\nyoutube v\nbackground_color red(mid) tail\n<bad&>',
  'OBJECTS\nUp @ @\nRed junk(comment)Blue\n9.0X(comment)1\n000000(comment)1\n00000\n00000\n00000\n00000 suffix\nGreen',
  'OBJECTS\nA\nRed\n\nB\nBlue\nLEGEND\nx\ny nope\nz = A or\np = A or B and A\na = A\nx = x and A\nx = A and A\np = A and z',
  'OBJECTS\nA\nRed\n\nB\nBlue\nLEGEND\np = A or B\na = A and B\nb = a or A\nc = p and A\nSOUNDS\nSFX10 1 trailing\nA move up down 12 junk\nA action up\nundefined move 1\n! 1 (x) 1 A',
  'OBJECTS\nBackground .\nBlack\n\nA a\nRed\n\nB b\nBlue\nLEGEND\np = A or B\nab = A and B\nSOUNDS\nCOLLISIONLAYERS\nA,A\np\nBackground,A\nA Background\nab ! undefined\nRULES\nA -> [ A ]\n[ unknown ] -> [ A ]\nWINCONDITIONS\nsure unknown off A extra\nLEVELS\nmessageNoSpace\na\nab\n?',
];
constructed.forEach((source, index) => test('constructed parser branch recovery ' + index, () => {
  oracle.compareFixture({ name: 'constructed branch recovery ' + index, source });
}));

for (const source of ['OBJECTS\nconstructor\nRed',
  'OBJECTS\nA constructor __proto__\nRed\nLEGEND\nconstructor = A\n__proto__ = A\nSOUNDS\nconstructor move 1\nCOLLISIONLAYERS\nconstructor\nRULES\n[ constructor ] -> [ A ]']) {
  test('the raw object namespace preserves native inherited-name lookup: ' + source.split('\n')[1], () => {
    oracle.compareFixture({ name: 'constructed raw inherited-name namespace', source });
  });
}

test('the sixth error check waits for every diagnostic in the current token visit', () => {
  const source = Array.from({ length: 5 }, (_, index) => 'unknown' + index).join('\n') +
    '\nOBJECTS\nA\nRed\nLEGEND\nA = missing\nSOUNDS\nnotReached 1';
  const { native, result } = oracle.compareFixture({ name: 'constructed two errors in final token', source });
  assert.equal(native.errorCount, 7);
  assert.equal(result.outcome.cursor.line, 10);
  assert.equal(result.document.sounds.length, 1);
  assert.equal(result.document.sounds[0].eventDefinition, null);
  assert.ok(!result.rawDiagnostics.some(item => item.message.includes('notreached')));
});

test('the global warning cap stops during a visit, while repeated raw visits do not consume it', () => {
  const source = ')\n'.repeat(101) + 'title AFTER';
  const { result } = oracle.compareFixture({ name: 'constructed issue cap', source });
  assert.equal(result.outcome.reason, parser.SourceParserStopReason.Issues);
  assert.equal(result.diagnostics.length, 101);
  assert.equal(result.errorCount, 0);
  const duplicates = oracle.compareFixture({ name: 'constructed repeated raw warning', source: ')'.repeat(200) }).result;
  assert.equal(duplicates.rawDiagnostics.length, 200);
  assert.equal(duplicates.diagnostics.length, 1);
  assert.equal(duplicates.outcome.kind, parser.SourceParserOutcomeKind.Complete);
});

test('the global cap can interrupt an object visit before the name is accepted', () => {
  const source = ')\n'.repeat(100) + 'OBJECTS\nUp laterAlias\nRed';
  const { result } = oracle.compareFixture({ name: 'constructed cap inside name visit', source });
  assert.equal(result.diagnostics.length, 101);
  assert.equal(result.document.objects[0].primaryName.spelling, 'Up');
  assert.deepEqual(result.document.objects[0].definitionNames, []);
  assert.deepEqual(result.document.objects[0].definitionColors, []);
});

test('an effective lowercase cursor maps to valid authored positions after Unicode expansion', () => {
  const source = 'OBJECTS\nA İ\nRed\nLEGEND\nSOUNDS\nCOLLISIONLAYERS\nA\nRULES\n[ İ ] -> missing0 missing1 missing2 missing3 missing4 missing5';
  const { result } = oracle.compareFixture({ name: 'constructed expanded lowercase cursor', source });
  assert.equal(result.outcome.cursor.column, source.split('\n').at(-1).length + 1);
  assert.equal(result.outcome.cursor.offset, source.length);
});

test('the authored facade preserves frozen shared lexical evidence and token identity', () => {
  const source = movementSource();
  const lexical = oracle.independently(() => walkSourceLexically(source, false));
  const freeze = value => {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
    if (value instanceof Map) for (const [key, child] of value) { freeze(key); freeze(child); }
    else if (value instanceof Set) for (const child of value) freeze(child);
    else for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  freeze(lexical);
  const before = structuredClone(lexical);
  const result = oracle.independently(() => readAuthoredSource(source, lexical));
  assert.deepEqual(lexical, before);
  assert.equal(result.document.objects[0].definitionNames[0].word, result.document.objects[0].primaryName);
});

test('shared metadata keys retain normalized accepted values after restoring literal source casing', () => {
  const lexical = oracle.independently(() => walkSourceLexically('TiTle MiXeD\nAuThOr NaMe\nHoMePaGe HTTPS://Example', false));
  assert.deepEqual(lexical.metadata.map(entry => [entry.key.value, entry.value]), [
    ['title', 'MiXeD'], ['author', 'NaMe'], ['homepage', 'HTTPS://Example'],
  ]);
  assert.deepEqual(lexical.metadata.map(entry => entry.key.word.spelling), ['TiTle', 'AuThOr', 'HoMePaGe']);
});

test('the parser comparison rejects corrupted diagnostics, deduplication, counts, cursors and later visits', () => {
  const stopped = { name: 'constructed stop corruption', source: 'unknown\n'.repeat(6) + 'unreached' };
  const duplicate = { name: 'constructed duplicate corruption', source: ')))' };
  const corruptions = [
    [duplicate, result => { result.rawDiagnostics[0] = { ...result.rawDiagnostics[0], message: 'changed' }; }],
    [duplicate, result => { result.diagnostics.push(result.diagnostics[0]); }],
    [duplicate, result => { result.errorCount++; }],
    [stopped, result => { result.outcome = { ...result.outcome, cursor: { ...result.outcome.cursor, column: 1 } }; }],
    [stopped, result => { result.rawDiagnostics.push({ ...result.rawDiagnostics[0], message: 'unreached' }); }],
    [duplicate, result => { result.rawDiagnostics[0] = { ...result.rawDiagnostics[0], unsupported: true }; }],
  ];
  for (const [fixture, corrupt] of corruptions) assert.throws(() => oracle.compareFixture(fixture, source => {
    const result = parser.parseSource(source); corrupt(result); return result;
  }), { name: 'AssertionError' });
  assert.throws(() => oracle.compareFixture(duplicate, source => { loadFile(source); return parser.parseSource(source); }), /Candidate called native loadFile/);
});

test('the parser comparison rejects an incorrect stopped cursor offset even when line and column match', () => {
  const fixture = { name: 'constructed stopped offset corruption', source: 'unknown\n'.repeat(6) + 'unreached' };
  for (const offset of [-1, 0, fixture.source.length + 1]) assert.throws(() => oracle.compareFixture(fixture, source => {
    const result = parser.parseSource(source);
    return { ...result, outcome: { ...result.outcome, cursor: { ...result.outcome.cursor, offset } } };
  }), { name: 'AssertionError' });
});
