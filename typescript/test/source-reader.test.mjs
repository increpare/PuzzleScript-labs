import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readSource } from '../build/source-reader.js';
import { leadingContent, leadingContentStart } from '../build/source-text.js';
import * as sourceModel from '../build/source-model.js';
const { SourceLineKind, SourceDiagnosticSeverity, SourceDiagnosticPhase } = sourceModel;
const require = createRequire(import.meta.url);
let legacyLoaded = false;
function legacySource() {
  if (!legacyLoaded) {
    require('./native-host.cjs').loadPuzzleScript();
    legacyLoaded = true;
  }
  return require('./support/parser-snapshot.cjs');
}

test('empty source retains the original text and its one empty physical line', () => {
  const { document, diagnostics } = readSource('');
  assert.equal(document.source, '');
  assert.deepEqual(document.lines.map(line => line.original), ['']);
  assert.deepEqual(document.sections, []);
  assert.deepEqual(document.metadata, []);
  assert.deepEqual(diagnostics, []);
});

test('nested comments keep offsets across lines and unmatched closing comments warn', () => {
  const source = '(outer (nested\ncomment) done)\ntitle Keep (stop) ignored\n)\nOBJECTS\n';
  const { document, diagnostics } = readSource(source);
  assert.deepEqual(document.lines.map(line => line.original), source.split('\n'));
  assert.equal(document.lines[0].kind, SourceLineKind.Comment);
  assert.equal(document.lines[1].kind, SourceLineKind.Comment);
  assert.equal(document.metadata[0].value, 'Keep');
  assert.equal(document.metadata[0].authoredValue, 'Keep');
  assert.equal(document.comments.length, 3);
  const outer = document.comments[0];
  assert.deepEqual(outer.span.start, { offset: 0, line: 1, column: 1 });
  assert.deepEqual(outer.span.end, { offset: source.indexOf('\ntitle'), line: 2, column: 15 });
  const unmatched = diagnostics.find(diagnostic => diagnostic.code === 'unmatched-comment-close');
  assert.equal(unmatched.severity, SourceDiagnosticSeverity.Warning);
  assert.equal(unmatched.countsAsError, false);
  assert.equal(unmatched.phase, SourceDiagnosticPhase.Reader);
  assert.equal(unmatched.span.start.line, 4);
  assert.equal(unmatched.span.end.offset - unmatched.span.start.offset, 1);
});

test('metadata preserves authored spelling, ordered duplicates, flag values and invalid lines', () => {
  const source = 'title First\ntitle SECOND\nAUTHOR Dr. J\nhomepage HTTPS://Example.test/A\nbackground_color RED\nnoaction\nMystery Keep Me\ntitle (no value)\n(objects never closed';
  const { document, diagnostics } = readSource(source);
  assert.deepEqual(document.metadata.map(entry => [entry.key.normalized, entry.authoredValue, entry.value]), [
    ['title', 'First', 'First'], ['title', 'SECOND', 'SECOND'], ['author', 'Dr. J', 'Dr. J'],
    ['homepage', 'HTTPS://Example.test/A', 'HTTPS://Example.test/A'], ['background_color', 'RED', 'red'],
    ['noaction', '', 'true'], ['mystery', 'Keep Me', 'keep me'], ['title', '', ''],
  ]);
  assert.equal(document.lines[6].kind, SourceLineKind.Invalid);
  assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'metadata-value-missing'));
  assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'unknown-metadata'));
  assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'unclosed-comment'));
});

test('metadata acceptance and shared logical SOL retain source evidence through leading comments and unmatched closes', () => {
  const source = 'text_color red\n)text_color blue\n(comment)color_palette ega\n(outer\n(inner))background_color black\n)(comment)noundo';
  const { document } = readSource(source);
  const native = legacySource().buildParserStateSnapshot(source).parser_state;
  assert.deepEqual(document.metadata.filter(entry => entry.accepted).flatMap(entry => [entry.key.normalized, entry.value]), native.metadata_pairs);
  assert.deepEqual(document.metadata.map(entry => entry.accepted), [true, false, true, true, false]);
  for (const entry of document.metadata) assert.equal(source.slice(entry.key.span.start.offset, entry.key.span.end.offset), entry.key.spelling);
  for (const [line, depth, expected] of [[document.lines[1], 0, false], [document.lines[2], 0, true],
    [document.lines[4], 1, true], [document.lines[5], 0, false]]) {
    const content = leadingContent(line, depth);
    assert.equal(content.startOfLine, expected);
    assert.equal(content.start, leadingContentStart(line, depth));
  }
});

test('metadata keys accept their Unicode word prefix without whitespace before value punctuation', () => {
  const source = 'title: Hello\nauthor- Name\nhomepage=https://Example.test\nbackground_color=RED\nOBJECTS';
  const { document, diagnostics } = readSource(source);
  assert.deepEqual(document.metadata.map(entry => [entry.key.spelling, entry.authoredValue, entry.value]), [
    ['title', ': Hello', ': Hello'], ['author', '- Name', '- Name'], ['homepage', '=https://Example.test', '=https://Example.test'],
    ['background_color', '=RED', '=red'],
  ]);
  assert.equal(document.metadata[0].key.span.end.column, 6);
  assert.deepEqual(diagnostics, []);
  const { buildParserStateSnapshot } = legacySource();
  assert.deepEqual(document.metadata.flatMap(entry => [entry.key.normalized, entry.value]), buildParserStateSnapshot(source).parser_state.metadata_pairs);
});

test('unmatched closing parentheses remain in authored metadata values and level glyph rows', () => {
  const source = 'title Hello)\nOBJECTS\nLEVELS\nA)';
  const { document } = readSource(source);
  assert.equal(document.metadata[0].authoredValue, 'Hello)');
  assert.equal(document.metadata[0].value, 'Hello)');
  assert.equal(document.levels[0].rows[0].text, 'A)');
  assert.deepEqual(document.levels[0].rows[0].glyphs.map(word => word.spelling), ['A', ')']);
  const { buildParserStateSnapshot } = legacySource();
  const native = buildParserStateSnapshot(source).parser_state;
  assert.deepEqual(document.metadata.flatMap(entry => [entry.key.normalized, entry.value]), native.metadata_pairs);
  assert.deepEqual(document.levels[0].rows.map(row => row.text.toLowerCase()), native.levels[0].rows);
});

test('equals-only level separators require the physical remainder to contain only equals and whitespace', () => {
  const source = 'LEVELS\n===\n===)\n=== (comment)\nA';
  const { document } = readSource(source);
  assert.equal(document.lines[1].kind, SourceLineKind.Separator);
  assert.equal(document.lines[2].kind, SourceLineKind.Entry);
  assert.equal(document.lines[3].kind, SourceLineKind.Entry);
  assert.deepEqual(document.levels[0].rows.map(row => row.text), ['===)', '===', 'A']);
  const { buildParserStateSnapshot } = legacySource();
  assert.deepEqual(document.levels[0].rows.map(row => row.text.toLowerCase()), buildParserStateSnapshot(source).parser_state.levels[0].rows);
});

test('CR and Unicode whitespace retain source spans and columns count UTF-16 units', () => {
  const source = '\u2003title Astral 😀\r\nOBJECTS\r\n';
  const { document } = readSource(source);
  assert.equal(document.lines[0].original, '\u2003title Astral 😀\r');
  assert.deepEqual(document.metadata[0].key.span.start, { offset: 1, line: 1, column: 2 });
  assert.equal(document.lines[0].span.end.column, document.lines[0].original.length + 1);
  assert.equal(document.sections[0].name.span.start.offset, source.indexOf('OBJECTS'));
});

test('level section words become glyph rows and ragged grids retain UTF-16 glyphs', () => {
  const source = 'LEVELS\nRULES\n=😀\n===\n\nmessage Welcome (Keep) [Brackets]\nmessage\nmessageNoSpace\n\nA\nABC';
  const { document } = readSource(source);
  assert.equal(document.sections.length, 1);
  assert.deepEqual(document.levels[0].rows.map(row => row.text), ['RULES', '=😀']);
  assert.deepEqual(document.levels[0].rows[1].glyphs.map(glyph => glyph.spelling), ['=', '\ud83d', '\ude00']);
  assert.equal(document.levels[0].rows[1].glyphs[2].span.start.column, 3);
  assert.equal(document.lines[3].kind, SourceLineKind.Separator);
  assert.deepEqual(document.levels.slice(1, 4).map(level => level.text), ['Welcome (Keep) [Brackets]', '', 'NoSpace']);
  assert.deepEqual(document.levels[4].rows.map(row => row.text), ['A', 'ABC']);
  assert.equal(document.comments.length, 0);
});

test('metadata and all ordered empty section occurrences retain source locations', () => {
  const source = 'title A Little Game\n\nOBJECTS\n===\nLEGEND\nSOUNDS\nCOLLISIONLAYERS\nRULES\nRULES\nWINCONDITIONS\nLEVELS\n';
  const { document, diagnostics } = readSource(source);
  assert.equal(document.source, source);
  assert.equal(document.metadata[0].key.normalized, 'title');
  assert.equal(document.metadata[0].value, 'A Little Game');
  assert.deepEqual(document.sections.map(section => section.name.normalized),
    ['objects', 'legend', 'sounds', 'collisionlayers', 'rules', 'rules', 'winconditions', 'levels']);
  assert.deepEqual(document.sections.map(section => section.id), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(document.sections[0].heading.span.start.line, 3);
  assert.equal(document.lines.length, source.split('\n').length);
  assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'duplicate-section'));
});

test('object names, broad aliases, colors and optional sprites retain their authored declarations', () => {
  const source = 'OBJECTS\nPläyer_١ P @\nRED #abc\nCrate C\nBrown\n00000\n0...0\n0...0\n0...0\n00000\nWall W\nGray\n\n.Bad !\nBlue\n\nPläyer_١ duplicate\nGreen';
  const { document, diagnostics } = readSource(source);
  assert.deepEqual(document.objects.map(object => object.primaryName.spelling), ['Pläyer_١', 'Crate', 'Wall', '.Bad', 'Pläyer_١']);
  assert.deepEqual(document.objects[0].aliases.map(alias => alias.spelling), ['P', '@']);
  assert.deepEqual(document.objects[0].colors.map(color => [color.spelling, color.normalized]), [['RED', 'red'], ['#abc', '#abc']]);
  assert.equal(document.objects[0].spriteRows, null);
  assert.deepEqual(document.objects[1].spriteRows.map(row => row.text), ['00000', '0...0', '0...0', '0...0', '00000']);
  assert.equal(document.objects[2].spriteRows, null);
  assert.equal(document.objects[3].validPrimaryName, false);
  assert.equal(document.objects[4].primaryName.normalized, 'pläyer_١');
  assert.equal(document.objects[0].sectionId, 0);
  assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'invalid-object-name'));
});

test('raw malformed sprite dimensions and glyphs are retained for later validation', () => {
  const { document } = readSource('OBJECTS\nThing\nRed\n000\n00X000\n.\n\nOther\nBlue');
  assert.deepEqual(document.objects[0].spriteRows.map(row => row.text), ['000', '00X000', '.']);
  assert.equal(document.objects[0].spriteRows[1].span.start.line, 5);
  assert.equal(document.objects[1].primaryName.spelling, 'Other');
});

test('a completed fifth sprite row permits the next object despite earlier malformed row widths', () => {
  const { buildParserStateSnapshot } = legacySource();
  for (const first of ['000', '000000']) {
    const source = 'OBJECTS\nA\nRed\n' + first + '\n00000\n00000\n00000\n00000\nB\nBlue';
    const { document } = readSource(source);
    assert.deepEqual(document.objects.map(object => object.primaryName.spelling), ['A', 'B'], first);
    assert.deepEqual(document.objects[0].spriteRows.map(row => row.text), [first, '00000', '00000', '00000', '00000']);
    assert.deepEqual(document.objects[1].colors.map(word => word.normalized), ['blue']);
    assert.deepEqual(document.objects.map(object => object.primaryName.normalized).sort(), buildParserStateSnapshot(source).parser_state.objects.map(object => object.name));
  }
});

test('adjacent hexadecimal and named colors use separate authored tokens without losing spans', () => {
  const source = 'OBJECTS\nArrow\n#2eb82e #ff3300#330000 #ffcc00 REDblue unknown';
  const { document } = readSource(source);
  assert.deepEqual(document.objects[0].colors.map(word => word.spelling), ['#2eb82e', '#ff3300', '#330000', '#ffcc00', 'RED', 'blue', 'unknown']);
  for (const word of document.objects[0].colors) assert.equal(source.slice(word.span.start.offset, word.span.end.offset), word.spelling);
});

test('a Unicode primary-name prefix is followed by broader aliases even without whitespace', () => {
  const source = 'OBJECTS\nBad-name !\nRed\n\nΩmega@\nBlue';
  const { document } = readSource(source);
  assert.deepEqual(document.objects.map(object => object.primaryName.spelling), ['Bad', 'Ωmega']);
  assert.deepEqual(document.objects.map(object => object.aliases.map(alias => alias.spelling)), [['-name', '!'], ['@']]);
  assert.ok(document.objects.every(object => object.validPrimaryName));
  assert.equal(document.objects[0].aliases[0].span.start.column, 4);
});

test('sprite comments retain raw physical rows and individual authored glyph locations', () => {
  const source = 'OBJECTS\nThing\nRed\n00(comment)000\n00000\n00000\n00000\n00000\nOther\nBlue';
  const { document } = readSource(source);
  assert.equal(document.objects.length, 2);
  const row = document.objects[0].spriteRows[0];
  assert.equal(row.original, '00(comment)000');
  assert.equal(row.text, '00000');
  assert.deepEqual(row.glyphs.map(word => word.span.start.column), [1, 2, 12, 13, 14]);
});

test('legend entries preserve synonyms, member order, malformed operators and forward references', () => {
  const { document } = readSource('LEGEND\nP=Player\nThings = Crate or Player or Future\nPair = Crate and Player\nBad = Player or Crate and Future\nMissing =\nWrong Player\nP = Other');
  assert.deepEqual(document.legend.map(entry => entry.kind), [0, 1, 2, 3, 3, 3, 0]);
  assert.deepEqual(document.legend[1].references.map(word => word.spelling), ['Crate', 'Player', 'Future']);
  assert.deepEqual(document.legend[3].operators.map(word => word.normalized), ['or', 'and']);
  assert.deepEqual(document.legend[5].words.map(word => word.spelling), ['Wrong', 'Player']);
  assert.equal(document.legend[6].name.spelling, 'P');
});

test('an initial AND keeps aggregate recovery after a later malformed operator', () => {
  for (const operator of ['or', 'unexpected']) {
    const { document, diagnostics } = readSource('LEGEND\nMixed = Player and Crate ' + operator + ' Wall');
    assert.equal(document.legend[0].kind, sourceModel.SourceLegendKind.Aggregate);
    assert.deepEqual(document.legend[0].references.map(word => word.spelling), ['Player', 'Crate', 'Wall']);
    assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'invalid-legend-operator'));
  }
});

test('legend definition words retain only the native recognized prefix while raw authored words stay intact', () => {
  for (const [text, expected] of [
    ['X = Player!', ['X', '=', 'Player']],
    ['X = Player #', ['X', '=', 'Player']],
    ['X = Player=', ['X', '=', 'Player']],
    ['X = Player! or Crate', ['X', '=', 'Player']],
    ['X = Player or Crate!', ['X', '=', 'Player', 'or', 'Crate']],
    ['X = Player and Crate!', ['X', '=', 'Player', 'and', 'Crate']],
    ['X = Player or! Crate', ['X', '=', 'Player', 'or']],
    ['X = Player! (comment) or Crate', ['X', '=', 'Player', 'or', 'Crate']],
    ['! = 綠_2!', ['!', '=', '綠_2']],
  ]) {
    const { document } = readSource(`LEGEND\n${text}`);
    const declaration = document.legend[0];
    assert.deepEqual(declaration.definitionWords.map(token => token.word.spelling), expected, text);
    assert.equal(declaration.definitionWords[0].word, declaration.words[0], text);
    assert.equal(declaration.definitionWords[1].word, declaration.words[1], text);
    for (const { word, value } of declaration.definitionWords) {
      assert.equal(document.source.slice(word.span.start.offset, word.span.end.offset), word.spelling, text);
      assert.equal(value, word.normalized, text);
    }
    assert.ok(declaration.words.some(word => /[!#=]/u.test(word.spelling)), text);
  }
});

test('lexically recovered legend names take precedence over command words', () => {
  for (const declaration of ['message = Player!', 'message = message or Player and Crate']) {
    const { document } = readSource(`OBJECTS\nPlayer\nwhite\n\nCrate\nred\nLEGEND\n${declaration}\nRULES\n[ Player ] -> [ Player message ]`);
    const rule = document.rules[0];
    assert.deepEqual(rule.commands, [], declaration);
    assert.equal(rule.rhs[0].cells[0].terms[1].name.normalized, 'message', declaration);
  }
});

test('a rejected empty property does not shadow a rule command', () => {
  const source = 'OBJECTS\nPlayer\nwhite\n\nCrate\nred\nLEGEND\nPair = Player and Crate\nmessage = Pair or Pair\nRULES\n[ Player ] -> [ Player message ]';
  const { document, diagnostics } = readSource(source);
  const rule = document.rules[0];
  assert.equal(rule.commands[0]?.kind, sourceModel.SourceRuleCommandKind.Message);
  assert.equal(rule.commands[0].authoredPayload, ']');
  // Native syntax commits rows only at a closing bracket. The authored AST
  // retains this partial row, whose final bracket was consumed by MESSAGE.
  assert.equal(rule.rhs[0].closingBracket, null);
  assert.deepEqual(rule.rhs[0].cells[0].terms.map(term => term.name.spelling), ['Player']);
  assert.equal(rule.legacyCapturedText, '[ player ] -> [ player message ]');
  assert.equal(rule.originalLine.original, source.split('\n').at(-1));
  assert.equal(rule.kind, sourceModel.SourceRuleKind.Invalid);
  assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'unclosed-rule-row'));
});

test('collision layers read name tokens while retaining rejected punctuation in authored words', () => {
  const { document } = readSource('COLLISIONLAYERS\nPlayer, Crate, # $Wall');
  assert.deepEqual(document.collisionLayers[0].names.map(word => word.spelling), ['Player', 'Crate', 'Wall']);
  assert.ok(document.collisionLayers[0].words.some(word => word.spelling.includes('#')));
});

test('sounds, unnamed collision layers and wins retain ordered unresolved words', () => {
  const source = 'SOUNDS\nSFX0 123\nPlayer Move Left UP 456\nPlayer Action 789\nOops Weird nonseed extra\nCOLLISIONLAYERS\nBackground\nPlayer,Crate Player\nWINCONDITIONS\nALL Crate ON Target\nno Player\nmaybe Thing toward Other extra';
  const { document } = readSource(source);
  assert.deepEqual(document.sounds[0].words.map(word => word.spelling), ['SFX0', '123']);
  assert.equal(document.sounds[0].event.normalized, 'sfx0');
  assert.equal(document.sounds[1].target.spelling, 'Player');
  assert.equal(document.sounds[1].action.normalized, 'move');
  assert.deepEqual(document.sounds[1].directions.map(word => word.normalized), ['left', 'up']);
  assert.equal(document.sounds[2].action.normalized, 'action');
  assert.deepEqual(document.sounds[3].words.map(word => word.spelling), ['Oops', 'Weird', 'nonseed', 'extra']);
  assert.deepEqual(document.collisionLayers.map(layer => layer.names.map(name => name.spelling)), [['Background'], ['Player', 'Crate', 'Player']]);
  assert.ok(document.collisionLayers.every(layer => !('name' in layer)));
  assert.equal(document.winConditions[0].quantifier.normalized, 'all');
  assert.equal(document.winConditions[0].subject.spelling, 'Crate');
  assert.equal(document.winConditions[0].target.spelling, 'Target');
  assert.deepEqual(document.winConditions[2].words.map(word => word.spelling), ['maybe', 'Thing', 'toward', 'Other', 'extra']);
  assert.ok(document.objects.length === 0);
});

const rulesSource = rules => 'OBJECTS\nPlayer P\nRed\n\nCrate C\nBrown\nLEGEND\nThings = Player or Crate\nSOUNDS\nCOLLISIONLAYERS\nPlayer, Crate\nRULES\n' + rules;

test('rules preserve ordered prefixes, bracket rows, cells, qualifiers, ellipsis and commands', () => {
  const source = rulesSource('+ random horizontal rigid [ > Player|Crate|...|no Things]->[ > Player| > Crate|...|random Things] sfx0 again\nstartloop\nendloop');
  const { document } = readSource(source);
  const rule = document.rules[0];
  assert.equal(rule.kind, 0);
  assert.deepEqual(rule.prefixWords.map(word => word.normalized), ['+', 'random', 'horizontal', 'rigid']);
  assert.equal(rule.lhs.length, 1);
  assert.equal(rule.rhs.length, 1);
  assert.equal(rule.lhs[0].cells.length, 4);
  assert.equal(rule.lhs[0].cells[0].terms[0].qualifier.spelling, '>');
  assert.equal(rule.lhs[0].cells[0].terms[0].name.spelling, 'Player');
  assert.equal(rule.lhs[0].cells[1].terms[0].qualifier, null);
  assert.equal(rule.lhs[0].cells[2].kind, 1);
  assert.equal(rule.lhs[0].cells[3].terms[0].qualifier.normalized, 'no');
  assert.deepEqual(rule.commands.map(command => command.word.normalized), ['sfx0', 'again']);
  assert.equal(document.rules[1].kind, 1);
  assert.equal(document.rules[2].kind, 2);
  assert.equal(rule.originalLine.original, source.split('\n').at(-3));
});

test('rule token boundaries split brackets, pipes, arrows and leading plus but preserve adjacent qualifier spelling', () => {
  const { document } = readSource(rulesSource('+[>Player|Crate]->[>Player|>Crate] win'));
  const rule = document.rules[0];
  assert.deepEqual(rule.tokens.map(word => word.normalized), ['+', '[', '>player', '|', 'crate', ']', '->', '[', '>player', '|', '>crate', ']', 'win']);
  assert.equal(rule.lhs[0].cells[0].terms[0].name.spelling, '>Player');
  assert.equal(rule.lhs[0].cells[0].terms[0].qualifier, null);
  assert.equal(rule.lhs[0].cells[0].terms[0].name.span.start.column, 3);
});

test('rules retain their first-comment capture without reconnecting physical fragments', () => {
  const line = '[ Player ] (ignored) -> [ Crate ]';
  const { document, diagnostics } = readSource(rulesSource(line + '\n[ Player ] -> [ Crate ] (tail) again'));
  assert.equal(document.rules[0].originalLine.original, line);
  assert.equal(document.rules[0].legacyCapturedText, '[ player ] ');
  assert.equal(document.rules[0].rhs.length, 0);
  assert.equal(document.rules[0].kind, 3);
  assert.deepEqual(document.rules[1].commands, []);
  assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'rule-arrow-missing'));
});

test('rule message literals after leading comments cannot swallow the next physical rule', () => {
  const { buildParserStateSnapshot } = legacySource();
  for (const prefix of ['(prefix) ', '(comment\n) ']) {
    const source = rulesSource(prefix + '[ Player ] -> message Hello (unclosed\n[ Player ] -> [ Player ]');
    const { document, diagnostics } = readSource(source);
    const legacy = buildParserStateSnapshot(source).parser_state;
    assert.equal(document.rules.length, 2, prefix);
    assert.equal(document.comments.length, 1, prefix);
    assert.equal(document.rules[0].commands[0].authoredPayload, 'Hello (unclosed', prefix);
    assert.equal(document.rules[1].kind, sourceModel.SourceRuleKind.Ordinary, prefix);
    assert.ok(!diagnostics.some(diagnostic => diagnostic.code === 'unclosed-comment'), prefix);
    assert.deepEqual(document.rules.map(rule => rule.legacyCapturedText), legacy.rules.map(rule => rule.rule), prefix);
    for (const rule of document.rules) assert.equal(document.source.slice(rule.legacyCapturedSpan.start.offset, rule.legacyCapturedSpan.end.offset).toLowerCase(), rule.legacyCapturedText);
  }
});

test('bracketless malformed message rules still protect literal parentheses from comment state', () => {
  for (const line of ['message Hello (unclosed', '-> message Hi (unclosed']) {
    const { document, diagnostics } = readSource(rulesSource(line + '\n[ Player ] -> [ Player ]'));
    assert.equal(document.rules.length, 2, line);
    assert.equal(document.rules[0].kind, sourceModel.SourceRuleKind.Invalid, line);
    assert.equal(document.rules[1].kind, sourceModel.SourceRuleKind.Ordinary, line);
    assert.equal(document.comments.length, 0, line);
    assert.ok(!diagnostics.some(diagnostic => diagnostic.code === 'unclosed-comment'), line);
  }
});

test('parentheses inside a rule word are authored spelling rather than comment boundaries', () => {
  const { buildParserStateSnapshot } = legacySource();
  for (const line of ['[ Player(foo ] -> [ Player ]', '[ Player) ] -> [ Player ]', '[ Player(foo ] -> message Hi (unclosed']) {
    const source = rulesSource(line + '\n[ Player ] -> [ Player ]');
    const { document, diagnostics } = readSource(source);
    assert.equal(document.rules.length, 2, line);
    assert.equal(document.comments.length, 0, line);
    assert.ok(!diagnostics.some(diagnostic => ['unclosed-comment', 'unmatched-comment-close'].includes(diagnostic.code)), line);
    assert.deepEqual(document.rules.map(rule => rule.legacyCapturedText), buildParserStateSnapshot(source).parser_state.rules.map(rule => rule.rule), line);
  }
});

test('rule messages use the original line with case and punctuation and keep the legacy empty payload', () => {
  const { document } = readSource(rulesSource('[ Player ] -> message Hello (Keep) [This] | -> 😀\n[ Player ] -> message'));
  const message = document.rules[0].commands[0];
  assert.equal(message.authoredPayload, 'Hello (Keep) [This] | -> 😀');
  assert.equal(message.legacyPayload, message.authoredPayload);
  assert.equal(document.rules[0].legacyCapturedText, '[ player ] -> message hello ');
  assert.equal(document.rules[0].commands.length, 1);
  assert.equal(document.comments.length, 0);
  assert.equal(document.rules[1].commands[0].authoredPayload, '');
  assert.equal(document.rules[1].commands[0].legacyPayload, ' ');
  const payloadStart = message.payloadSpan.start.offset;
  assert.equal(document.source.slice(payloadStart, message.payloadSpan.end.offset), message.authoredPayload);
});

test('declared object and legend names precede command interpretation including message and checkpoint', () => {
  const source = 'OBJECTS\nMessage M\nRed\n\nCheckpoint C\nBlue\nLEGEND\nAgain = Message\nRULES\n[ Message Checkpoint ] -> [ Checkpoint Message ] again\n[ Message ] -> message (comment)';
  const { document } = readSource(source);
  assert.equal(document.rules[0].lhs[0].cells[0].terms[0].name.normalized, 'message');
  assert.equal(document.rules[0].commands.length, 0);
  assert.deepEqual(document.rules[0].trailingWords.map(word => word.normalized), ['again']);
  assert.equal(document.rules[1].commands.length, 0);
  assert.deepEqual(document.rules[1].trailingWords.map(word => word.normalized), ['message']);
  assert.equal(document.comments.length, 1);
});

test('commands inside replacement cells remain ordered commands and warn without becoming object terms', () => {
  const names = ['sfx0', 'win', 'cancel', 'again', 'restart', 'checkpoint'];
  const source = rulesSource('[ Player ] -> [ Player ' + names.join(' ') + ' ]').replace('SOUNDS\n', 'SOUNDS\nsfx0 123\n');
  const { document, diagnostics } = readSource(source);
  const rule = document.rules[0];
  assert.equal(rule.kind, sourceModel.SourceRuleKind.Ordinary);
  assert.deepEqual(rule.commands.map(command => command.word.normalized), names);
  assert.deepEqual(rule.rhs[0].cells[0].terms.map(term => term.name.normalized), ['player']);
  assert.deepEqual(rule.rhs[0].cells[0].words.map(word => word.normalized), ['player', ...names]);
  const misplaced = diagnostics.filter(diagnostic => diagnostic.code === 'command-inside-row');
  assert.equal(misplaced.length, names.length);
  assert.ok(misplaced.every(diagnostic => diagnostic.severity === SourceDiagnosticSeverity.Warning && !diagnostic.countsAsError));

  legacySource();
  const physical = rule.originalLine.original;
  const legacy = globalThis.processRuleString([physical.toLowerCase(), rule.span.start.line, physical], {
    names: new Set(['player', 'crate', 'things']), sounds: [[['sfx0', 'SOUNDEVENT'], ['123', 'SOUND'], 1]], propertiesDict: {},
  }, []);
  assert.deepEqual(rule.commands.map(command => command.word.normalized), legacy.commands.map(command => command[0]));
  assert.deepEqual(rule.rhs[0].cells[0].terms.map(term => [term.qualifier?.normalized ?? '', term.name.normalized]),
    Array.from({ length: legacy.rhs[0][0].length / 2 }, (_, index) => legacy.rhs[0][0].slice(index * 2, index * 2 + 2)));
});

test('a command inside a detection cell is retained with an error while declared command names stay objects', () => {
  const first = readSource(rulesSource('[ Player win ] -> [ Player ]'));
  assert.equal(first.document.rules[0].kind, sourceModel.SourceRuleKind.Invalid);
  assert.deepEqual(first.document.rules[0].commands.map(command => command.word.normalized), ['win']);
  assert.deepEqual(first.document.rules[0].lhs[0].cells[0].terms.map(term => term.name.normalized), ['player']);
  assert.ok(first.diagnostics.some(diagnostic => diagnostic.code === 'command-before-arrow' && diagnostic.countsAsError));
  const second = readSource('OBJECTS\nPlayer\nRed\n\nWin\nBlue\nRULES\n[ Player ] -> [ Player Win ]');
  assert.equal(second.document.rules[0].commands.length, 0);
  assert.deepEqual(second.document.rules[0].rhs[0].cells[0].terms.map(term => term.name.spelling), ['Player', 'Win']);
});

test('malformed declarations remain authored evidence without shadowing a later command', () => {
  for (const declaration of ['message =', 'message = Player or', 'message = Player or Player and Player']) {
    const source = 'OBJECTS\nPlayer\nRed\nLEGEND\n' + declaration + '\nRULES\n[ Player ] -> message Hello';
    const { document } = readSource(source);
    assert.equal(document.legend.length, 1);
    assert.equal(document.legend[0].kind, sourceModel.SourceLegendKind.Invalid);
    assert.equal(document.rules[0].commands[0]?.authoredPayload, 'Hello', declaration);
  }
  const malformedObject = readSource('OBJECTS\nPlayer\nRed\n\n.Bad message\nBlue\nRULES\n[ Player ] -> message Hello').document;
  assert.equal(malformedObject.objects[1].validPrimaryName, false);
  assert.equal(malformedObject.rules[0].commands[0]?.authoredPayload, 'Hello');
  const unresolved = readSource('OBJECTS\nPlayer\nRed\nLEGEND\nmessage = Unknown\nRULES\n[ Player ] -> message Hello').document;
  assert.equal(unresolved.legend[0].kind, sourceModel.SourceLegendKind.Synonym);
  assert.equal(unresolved.rules[0].commands.length, 0);
});

test('malformed rules and loops remain ordered entries with recoverable authored tokens', () => {
  const { document, diagnostics } = readSource(rulesSource('startloop extra\n[ no ] -> [ Player\n[ Player ] -> [ Crate ] -> [ Player ]\nNonsense\n[ ... Player ] -> [ ... ]'));
  assert.equal(document.rules.length, 5);
  assert.ok(document.rules.every(rule => rule.kind === 3));
  assert.equal(document.rules[1].lhs[0].cells[0].terms[0].name, null);
  assert.equal(document.rules[4].lhs[0].cells[0].kind, 2);
  assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'unclosed-rule-row'));
  assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'duplicate-rule-arrow'));
});

test('authored model discriminants are numeric enums', () => {
  for (const [name, members] of Object.entries({ SourceSectionKind: ['Objects', 'Legend', 'Sounds', 'CollisionLayers', 'Rules', 'WinConditions', 'Levels'],
    SourceLineKind: ['Blank', 'Comment', 'Separator', 'Heading', 'Entry', 'Invalid'], SourceLegendKind: ['Synonym', 'Property', 'Aggregate', 'Invalid'],
    SourceSoundKind: ['Event', 'Target', 'Invalid'], SourceRuleKind: ['Ordinary', 'StartLoop', 'EndLoop', 'Invalid'],
    SourceRuleCellKind: ['Contents', 'Ellipsis', 'Invalid'], SourceLevelKind: ['Grid', 'Message'], SourceWinConditionKind: ['Valid', 'Invalid'],
    SourceRuleCommandKind: ['SoundEffect', 'Cancel', 'Checkpoint', 'Restart', 'Win', 'Message', 'Again'] })) {
    for (const member of members) assert.equal(typeof sourceModel[name][member], 'number', name + '.' + member);
  }
});

test('empty physical lines inside multiline comments do not split object or level entries', () => {
  const source = 'OBJECTS\nPlayer\n(comment\n\n)\nRed\nLEVELS\nP\n(comment\n\n)\nPP';
  const { document } = readSource(source);
  assert.equal(document.objects.length, 1);
  assert.deepEqual(document.objects[0].colors.map(word => word.normalized), ['red']);
  assert.equal(document.lines[3].kind, SourceLineKind.Comment);
  assert.equal(document.levels.length, 1);
  assert.deepEqual(document.levels[0].rows.map(row => row.text), ['P', 'PP']);
});

test('level messages after a closing comment still consume original literal payloads', () => {
  const source = 'LEVELS\n(prefix) message Hello (Keep) [Me]\nP\n(prefix\n) message Second (Keep)\nP';
  const { document } = readSource(source);
  assert.deepEqual(document.levels.filter(level => level.kind === sourceModel.SourceLevelKind.Message).map(level => level.authoredText), ['Hello (Keep) [Me]', 'Second (Keep)']);
  assert.deepEqual(document.levels.filter(level => level.kind === sourceModel.SourceLevelKind.Message).map(level => level.text), ['hello (keep) [me]', 'second (keep)']);
  assert.equal(document.comments.length, 2);
  assert.deepEqual(document.levels.filter(level => level.kind === sourceModel.SourceLevelKind.Grid).map(level => level.rows.map(row => row.text)), [['P'], ['P']]);
});

test('heading punctuation and malformed separators retain their structural line kind', () => {
  const { document, diagnostics } = readSource('OBJECTS junk\n===junk\nLEGEND] trailing\nRULESMore\nLEVELS\n===x');
  assert.deepEqual(document.sections.map(section => section.name.spelling), ['OBJECTS', 'LEGEND', 'LEVELS']);
  assert.deepEqual(document.sections[0].trailingWords.map(word => word.spelling), ['junk']);
  assert.deepEqual(document.sections[1].trailingWords.map(word => word.spelling), [']', 'trailing']);
  assert.equal(document.lines[1].kind, SourceLineKind.Separator);
  assert.equal(document.lines[3].kind, SourceLineKind.Invalid);
  assert.equal(document.levels[0].rows[0].text, '===x');
  assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'heading-trailing-text'));
  assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'separator-trailing-text'));
});

test('legend equality punctuation keeps raw malformed evidence and captures a valid prefix before the extra equals', () => {
  const { document } = readSource('LEGEND\nA = B = C\nA = =\n= Player\nA = Player and');
  assert.ok(document.legend.every(entry => entry.kind === sourceModel.SourceLegendKind.Invalid));
  assert.equal(document.legend.length, 3);
  assert.equal(document.lines[3].kind, SourceLineKind.Separator);
  assert.deepEqual(document.legend[1].words.map(word => word.spelling), ['A', '=', '=']);
  assert.deepEqual(document.legend[0].definitionWords.map(token => token.word.spelling), ['A', '=', 'B']);
  assert.deepEqual(document.legend[1].definitionWords.map(token => token.word.spelling), ['A', '=']);
});

test('a rule without a replacement or command remains an invalid entry', () => {
  const { document, diagnostics } = readSource(rulesSource('[ Player ] ->'));
  assert.equal(document.rules[0].kind, sourceModel.SourceRuleKind.Invalid);
  assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'rule-consequence-missing'));
});

test('isolated JS authored snapshots agree on declaration order, captures and case-preserving messages', () => {
  const { buildParserStateSnapshot } = legacySource();
  const source = ['title A Case Study', 'author Someone', 'noaction', '', 'OBJECTS', 'Player P', 'RED', '', 'Background B', 'Green', '',
    'Crate C', 'Blue', '', 'Target T', 'Yellow', '', 'LEGEND', 'X = Crate', 'Movables = Player or Crate', 'Together = Player and Target', '',
    'SOUNDS', 'sfx0 123', 'Player move left up 456', '', 'COLLISIONLAYERS', 'Background', 'Player, Crate, Target', '', 'RULES',
    '[ Player ] -> [ Player ] again', '[ Player ] -> message HeLLo (World) [Keep]', '', 'WINCONDITIONS', 'all Crate on Target', '',
    'LEVELS', 'BPC', 'BXT', '', 'message Welcome (Keep) [Me]'].join('\n');
  const legacy = buildParserStateSnapshot(source).parser_state;
  const { document, diagnostics } = readSource(source);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(document.sections.map(section => section.name.normalized), legacy.visited_sections);
  assert.deepEqual(document.metadata.flatMap(entry => [entry.key.normalized, entry.value]), legacy.metadata_pairs);
  assert.deepEqual(document.objects.map(object => ({ name: object.primaryName.normalized, line_number: object.primaryName.span.start.line,
    colors: object.colors.map(word => word.normalized), spritematrix: object.spriteRows?.map(row => row.text) ?? [] })).sort((a, b) => a.name.localeCompare(b.name)), legacy.objects);
  for (const [kind, key] of [[0, 'legend_synonyms'], [1, 'legend_properties'], [2, 'legend_aggregates']]) {
    const entries = document.legend.filter(entry => entry.kind === kind);
    const names = new Set(entries.map(entry => entry.name.normalized));
    assert.deepEqual(entries.map(entry => ({ name: entry.name.normalized, items: entry.references.map(word => word.normalized), line_number: entry.span.start.line })),
      legacy[key].filter(entry => names.has(entry.name)));
  }
  assert.deepEqual(document.sounds.map(sound => sound.words.map(word => word.normalized)), legacy.sounds.map(sound => sound.tokens.map(token => token.text)));
  assert.deepEqual(document.collisionLayers.map(layer => layer.names.map(word => word.normalized)), legacy.collision_layers);
  assert.deepEqual(document.rules.map(rule => ({ rule: rule.legacyCapturedText, line_number: rule.span.start.line, mixed_case: rule.originalLine.original })), legacy.rules);
  assert.deepEqual(document.winConditions.map(win => win.words.map(word => word.normalized)), legacy.winconditions.map(win => win.tokens));
  assert.deepEqual(document.levels.map(level => level.kind === sourceModel.SourceLevelKind.Message ? { kind: 'message', line_number: level.span.start.line, message: level.text }
    : { kind: 'level', line_number: level.span.start.line, rows: level.rows.map(row => row.text.toLowerCase()) }), legacy.levels.filter(level => level.kind === 'message' || level.rows.length > 0));
});
