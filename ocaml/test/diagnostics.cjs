#!/usr/bin/env node
'use strict';
// Compiler observations only: the oracle's installation boundary is observed
// without entering gameplay. No diagnostic text or expected source is rewritten.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { loadPuzzleScript, ORACLE_SOURCE } = require('../../typescript/test/native-host.cjs');
assert.deepEqual(ORACLE_SOURCE, require('../oracle-source.json'));
loadPuzzleScript({ includeTests: true });
unitTesting = true;
const { observe: oracle } = require('./compile-observation.cjs');
const directory = path.join(__dirname, 'results');
fs.mkdirSync(directory, { recursive: true });
const runDirectory = fs.mkdtempSync(path.join(directory, 'diagnostics-'));
const bytes = fs.readFileSync(path.join(__dirname, '../_build/default/cli/main.exe'));
const binarySha256 = crypto.createHash('sha256').update(bytes).digest('hex');
const binary = path.join(runDirectory, 'candidate-' + binarySha256 + '.exe');
fs.writeFileSync(binary, bytes, { flag: 'wx', mode: 0o755 });
const metadata = process.argv.includes('--metadata');
const assets = process.argv.includes('--assets');
const names = process.argv.includes('--names');
const events = process.argv.includes('--events');
const rules = process.argv.includes('--rules');
const levels = process.argv.includes('--levels');
const sections = process.argv.includes('--sections');
const recovery = process.argv.find(argument => argument.startsWith('--recovery='));
assert.ok([metadata, assets, names, events, rules, levels, sections, recovery].filter(Boolean).length <= 1, 'Choose one compiler fixture family');
const recoveryCount = Number(recovery?.split('=')[1] ?? 0);
const recoverySeed = process.argv.find(argument => argument.startsWith('--campaign-seed='))?.slice('--campaign-seed='.length) ?? 'ocaml-recovery-2026-11-07';
assert.ok(!recovery || Number.isSafeInteger(recoveryCount) && recoveryCount > 0);
const filter = process.argv.slice(2).find(argument => !argument.startsWith('--')) ?? '';
const baseSource = fs.readFileSync(path.join(__dirname, '../examples/push.ps'), 'utf8');
const sprite = (rows, color = 'white') => 'Player\n' + color + '\n' + rows.join('\n');
const pushRule = '\n[ > Player | Crate ] -> [ > Player | > Crate ]\n';
assert.ok(baseSource.includes(pushRule));
const ruleBlocks = [
  ['plain replacement', '[ Player ] -> [ Player ]'],
  ['glued punctuation', '[> Player|Crate]->[> Player|> Crate]'],
  ['glued message', '[Player]->message (literal parentheses)'],
  ['empty message', '[ Player ] -> message'],
  ['leading known object', 'Player [ Player ] -> [ Player ]'],
  ['unknown header', 'Missing [ Player ] -> [ Player ]'],
  ...['^', 'v', '<', '>', 'parallel', 'perpendicular', 'moving', 'randomdir', '123'].map(word => ['header ' + word, word + ' [ Player ] -> [ Player ]']),
  ['first join', '+ [ Player ] -> [ Player ]'],
  ['attached first join', '+[Player]->[Player]'],
  ['misplaced join', '[ Player ] -> [ Player ]\nright + [ Player ] -> [ Player ]'],
  ['double join', '[ Player ] -> [ Player ]\n+ + [ Player ] -> [ Player ]'],
  ['joined random', '[ Player ] -> [ Player ]\n+ random [ Player ] -> [ Player ]'],
  ['random before misplaced join', '[ Player ] -> [ Player ]\nrandom + [ Player ] -> [ Player ]'],
  ['attached noninitial plus', 'up+[Player]->[Player]'],
  ['joined late then early', 'late [ Player ] -> [ Player ]\n+ [ Player ] -> [ Player ]'],
  ['joined early then late', '[ Player ] -> [ Player ]\n+ late [ Player ] -> [ Player ]'],
  ['late rigid', 'late rigid [ Player ] -> [ Player ]'],
  ['multiple qualifiers', '[ action right Player ] -> [ Player ]'],
  ['qualifier without object', '[ > ] -> [ ]'],
  ['qualifier before bar', '[ > | Player ] -> [ Player | ]'],
  ['nested opening', '[[Player]] -> [Player]'],
  ['nested opening after contents', '[Player [Crate]] -> [Player]'],
  ['extra closing', '[Player] ] -> [Player]'],
  ['unclosed right side', '[Player] -> [Player'],
  ['arrow within a row', '[ -> [Player] -> [Player]'],
  ['second arrow', '[Player] -> [Player] -> [Player]'],
  ['object outside row', '[Player] -> [Player] Player'],
  ['movement outside row', '[Player] -> [Player] right'],
  ['bar outside row', '[Player] -> [Player] |'],
  ['unknown cell name', '[Player Missing] -> [Player]'],
  ['unknown movement name', '[> Missing] -> []'],
  ['repeated concrete object', '[Player Player] -> [Player]'],
  ['repeated negative object', '[no Wall no Wall] -> [no Wall]'],
  ['impossible overlap', '[Player Crate] -> [Player]'],
  ['misplaced early command', '[Player cancel] -> [Player]'],
  ['misplaced replacement command', '[Player] -> [Player cancel]'],
  ['command before another pattern', '[Player] -> cancel [Player]'],
  ['missing sound', '[Player] -> sfx0'],
  ['command without arrow', '[Player] win'],
  ['missing arrow', '[Player] [Player]'],
  ['empty rule reference', '->'],
  ['movement after ellipsis', '[... right] -> []'],
  ['ellipsis after pending movement', '[right ...] -> []'],
  ['misplaced ellipsis', '[Player] -> [Player] ...'],
  ['balanced loop', 'startloop\n[Player] -> [Player]\nendloop'],
  ['missing loop end', 'startloop\n[Player] -> [Player]'],
  ['unexpected loop end', 'endloop'],
  ['nested loops', 'startloop\nstartloop\n[Player] -> [Player]\nendloop\nendloop'],
  ['loop crossing a joined group', '[Player] -> [Player]\nstartloop\n+ [Player] -> [Player]\nendloop'],
  ['loop with rejected group', 'startloop\n[Player Crate] -> [Player]\nendloop'],
  ['thirty-one rigid groups', Array(31).fill('rigid [Player] -> [Player]').join('\n')],
];
const ruleFixtures = [
  ...ruleBlocks.map(([name, block]) => ({ name, source: baseSource.replace(pushRule, '\n' + block + '\n') })),
  ...[
    ['repeated property', 'Thing = Player or Crate', '[ Thing Thing ] -> [ Thing ]'],
    ['one possible alternative', 'Thing = Player or Background', '[ Thing Crate ] -> [ Thing Crate ]'],
    ['multiple impossible alternatives', 'Thing = Player or Background', '[ Thing Player Background ] -> [ Thing Player Background ]'],
  ].map(([name, legend, block]) => ({ name, source: baseSource.replace('\nsounds\n', '\n' + legend + '\n\nsounds\n').replace(pushRule, '\n' + block + '\n') })),
  ...['left', 'right'].flatMap(side =>
    (side === 'left' ? ['Player', 'Actor', 'Across', 'Pair', 'Alias', 'Other'] : ['Player', 'Crate', 'Pair', 'Alias']).flatMap(positive =>
      ['Player', 'Wall', 'Actor', 'Across', 'Pair', 'Alias'].map(negative => {
        const cell = '[ ' + positive + ' no ' + negative + ' ]';
        const block = side === 'left' ? cell + ' -> cancel' : '[ Player ] -> ' + cell;
        return { name: 'exclusions: ' + side + ' ' + positive + ' no ' + negative,
          source: baseSource.replace('\nsounds\n', '\nActor = Player or Crate\nAcross = Player or Background\nPair = Player and Background\nAlias = Player\nOther = Crate or Wall\n\nsounds\n')
            .replace(pushRule, '\n' + block + '\n') };
      }))),
  ...[
    ['two contradictory cells', '[ Player no Player | Player no Player ] -> cancel'],
    ['all concrete conflicts in the first cell', '[ Player Background no Player no Background ] -> cancel'],
    ['mixed phases retain diagnostic source order', 'late [ Player no Player ] -> cancel\n[ Crate no Crate ] -> cancel'],
    ['exclusions across overlapping rows', '[ Player no Crate ] [ no Crate ] -> [ Player ] [ no Crate ]'],
    ['repeated shared exclusions', '[ no Crate no Wall ] -> [ no Crate no Wall ]'],
    ['contradictory random opener', 'random [ Player no Player ] -> [ Player ]\n+ [ Player ] -> [ Player ]'],
    ['contradictory rigid opener', 'rigid [ Player no Player ] -> [ Player ]\n+ [ Player ] -> [ Player ]'],
    ['contradiction before impossible overlap', '[ Player Crate no Player ] -> [ Player ]'],
  ].map(([name, block]) => ({ name: 'exclusions: ' + name, source: baseSource.replace(pushRule, '\n' + block + '\n') })),
  ...['right', 'left', 'up'].flatMap(direction =>
    ['Player', '...', '... Player', 'Player ...', '... ...', '> ...', '> ... Player', '... > Player', 'no ... Player'].flatMap(left =>
      ['...', '', '... Player', 'Player ...', '> ... Player'].map(right => ({
        name: 'ellipsis recovery: ' + direction + ' [' + left + '] -> [' + right + ']',
        source: baseSource.replace(pushRule, '\n' + direction + ' [ Player | ' + left + ' | Crate ] -> [ Player | ' + right + ' | Crate ]\n'),
      })))),
  ...[
    ['beginning', '[ ... | Player ] -> [ | Player ]'],
    ['end', '[ Player | ... ] -> [ Player | ]'],
    ['both ends', '[ ... | Player | ... ] -> [ ... | Player | ... ]'],
    ['command only at the end', '[ Player | ... ] -> cancel'],
    ['neighboring gaps', '[ Player | ... | ... | Crate ] -> [ Player | ... | ... | Crate ]'],
    ['three gaps', '[ Player | ... | Crate | ... | Wall | ... | Background ] -> cancel'],
    ['three neighboring gaps', '[ Player | ... | ... | ... | Crate ] -> cancel'],
    ['discarded random gap opener', 'random [ Player ... ] -> [ Player ]\n+ [ Player ] -> [ Player ]'],
    ['gap before forbidden random match', '[ ... | random Player ] -> cancel'],
    ['forbidden random match before gap', '[ random Player | ... ] -> cancel'],
    ['discarded overlap suppresses right conflict', '[ Player Crate ] -> [ Player Crate ]'],
    ['singleton random spawn', '[ Player ] -> [ random Crate ]'],
    ['regular before random spawn', '[ Player ] -> [ Player random Crate ]'],
    ['random spawn before regular', '[ Player ] -> [ random Crate Player ]'],
    ['random spawn of the required object', '[ Player ] -> [ random Player Player ]'],
    ['concrete replacements conflict', '[ Player ] -> [ Crate Wall ]'],
    ['late discard precedes early gap warning', '[ Player | ... | ... | Crate ] -> cancel\nlate [ Player Crate ] -> cancel'],
    ['gap diagnostics precede rigid limit', Array(31).fill('rigid [Player] -> [Player]').join('\n') + '\nlate [ Player | ... | ... | Crate ] -> cancel'],
  ].map(([name, block]) => ({ name: 'lowering: ' + name, source: baseSource.replace(pushRule, '\n' + block + '\n') })),
  ...['right', 'left', 'up'].flatMap(direction =>
    ['vertical', 'horizontal', 'moving', 'orthogonal', 'parallel', 'perpendicular'].flatMap(movement => [
      '[ ' + movement + ' Actor | > Player ] -> [ | ' + movement + ' Actor ]',
      '[ ' + movement + ' Player | ' + movement + ' Crate ] -> [ ' + movement + ' Crate | ' + movement + ' Player ]',
      '[ ' + movement + ' Player | ' + movement + ' Player | ] -> [ | | ' + movement + ' Player ]',
      '[ ' + movement + ' Player | ] -> [ | ' + movement + ' Wall ]',
      '[ ' + movement + ' Player ' + movement + ' Background | ] -> [ | ' + movement + ' Crate ]',
      '[ ' + movement + ' Actor | Actor ] -> [ Actor | ' + movement + ' Actor ]',
    ].map(block => ({ name: 'bindings: ' + direction + ' ' + block,
      source: baseSource.replace('\nsounds\n', '\nActor = Player or Crate\n\nsounds\n').replace(pushRule, '\n' + direction + ' ' + block + '\n') })))),
  ...[
    ['unique property transport', '[ Actor | ] -> [ | Actor ]'],
    ['local repeated property', '[ Actor | Actor ] -> [ Actor | Actor ]'],
    ['ambiguous property transport', '[ Actor | Actor | ] -> [ Actor | Actor | Actor ]'],
    ['missing source', '[ Player ] -> [ Actor ]'],
    ['last unresolved property', '[ Player ] -> [ Actor Across ]'],
    ['random properties need no inference', '[ Player ] -> [ random Actor ]'],
    ['random source is not evidence', '[ random Actor ] -> [ Actor ]'],
    ['multiple-layer property transport', '[ Across | ] -> [ | Across ]'],
    ['ambiguous multiple-layer transport', '[ Across | Across | ] -> [ Across | Across | Across ]'],
    ['discarded property opener', 'random [ Player ] -> [ Actor ]\n+ [ Player ] -> [ Player ]'],
    ['movement errors precede property errors', '[ Player ] -> [ Actor ]\nright [ vertical Player | vertical Player | ] -> [ | | vertical Player ]'],
    ['unresolved movement still checks its property', 'right [ vertical Player | vertical Player | ] -> [ | | vertical Actor ]'],
  ].map(([name, block]) => ({ name: 'bindings: ' + name,
    source: baseSource.replace('\nsounds\n', '\nActor = Player or Crate\nAcross = Player or Background\n\nsounds\n').replace(pushRule, '\n' + block + '\n') })),
];
const soundBlocks = [
  ['simple slot', 'sfx0 12345'], ['slot ten with leading zeroes', 'SFX10 001234'],
  ['zero seed', 'sfx0 0'], ['incomplete event', 'sfx0'], ['incomplete object', 'Player'],
  ['missing movement seed', 'Player move'], ['final direction as seed', 'Player move right'],
  ['two directions without seed', 'Player move up left'], ['missing creation seed', 'Player create'],
  ['creation', 'Player create 12345'], ['destruction', 'Player destroy 12345'],
  ['action verb', 'Player action 12345'], ['movement groups', 'Player move up horizontal 12345'],
  ['failure group', 'Player cantmove vertical 12345'], ['repeated directions', 'Player move up up 12345'],
  ['direction without boundary', 'Player move orthogonal123'], ['verb without boundary', 'Player move123'],
  ['unicode after verb', 'Player moveΣ 12345'], ['exponent seed', 'Player move 1e2'],
  ['decimal seed', 'Player move 123.45'], ['unicode after seed', 'Player move 123é'],
  ['underscore after seed', 'Player move 123_'], ['negative seed', 'Player move -123'],
  ['punctuation at start', "'"], ['unknown name', 'Missing 12345'], ['numeric name', '12345'],
  ['bare verb', 'move 12345'], ['bare direction', 'up 12345'], ['seed without verb', 'Player 12345'],
  ['action as direction', 'Player move action 12345'], ['direction on creation', 'Player create up 12345'],
  ['failed event suffix', 'sfx0 nope sfx1'], ['extra event token', 'sfx0 12345 move'],
  ['extra object token', 'Player move 12345 extra'], ['redefined event', 'sfx0 12345\nsfx0 54321'],
  ['incomplete redefinition', 'sfx0 12345\nsfx0'], ['discarded prefix before definition', 'sfx0 999 extra\nsfx0 12345'],
  ['trailing comment', 'sfx0 12345 (comment)'], ['comment before seed', 'sfx0 (comment) 12345'],
  ['comment between verb and seed', 'Player move (comment) 12345'],
  ['nested comment before seed', 'sfx0 (outer (inner) comment) 12345'],
  ['closing comment at event end', 'sfx0 12345)'], ['closing comment then event whitespace', 'sfx0 12345) '],
  ['closing comment at object end', 'Player move right 123)'], ['closing comment then object whitespace', 'Player move right 123) '],
  ['closing comment after failed direction', 'Player move wrong) 123'],
  ['recovery fallback consumes closing comment', 'sfx0 nope 123)'],
  ['closing comment after failed seed', 'Player move 123extra)'],
  ['event interrupted across lines', 'sfx0 (multiline\ncomment)12345'],
  ['failed suffix with another comment', 'sfx0 (multiline\ncomment)12345 (tail)'],
  ['sixth-error stopping', Array.from({ length: 7 }, (_, n) => 'Missing' + n).join('\n')],
];
const winBlocks = [
  ['negative', 'no Player'], ['existential alias', 'any Crate'], ['uppercase', 'ALL Crate ON Player'],
  ['missing subject', 'no'], ['bad quantifier', 'maybe Player'], ['unknown subject', 'no Missing'],
  ['missing target', 'all Player on'], ['missing separator', 'all Player Crate'],
  ['bad separator', 'all Player blah Crate'], ['excess target words', 'all Player on Crate extra'],
  ['unknown target', 'all Player on Missing'], ['punctuation separator', "all Player ' Crate"],
  ['punctuation in captured target', 'all Player on Crate?'],
  ['repeated extra tokens', 'all Player on Crate extra more more'],
  ['sixth-error stopping', 'all Player on Crate a b c d e f g'],
  ['comment after quantifier', 'no (comment)'], ['comment before condition', '(comment) no Player'],
  ['captured prefix ignores suffix', 'no Player (comment) Unknown'],
  ['comment inside subject', 'no Play(comment)er'], ['unknown unicode name', 'no Playé'],
  ['next-line is not whitespace', 'no Player\u0085on Crate'], ['unicode whitespace', 'all\u00a0Crate\ufeffon\u202fPlayer'],
  ['quantifier prefix', 'noon Player'], ['numeric subject', 'all 123'],
  ['punctuation first', "' Player"], ['multiple conditions', 'no Player\nsome Crate on Player'],
];
const eventFixtures = [
  ...soundBlocks.map(([name, block]) => ({ name: 'sound: ' + name, source: baseSource.replace('\nsounds\n', '\nsounds\n' + block + '\n') })),
  ...winBlocks.map(([name, block]) => ({ name: 'win: ' + name, source: baseSource.replace('\nno Player\n', '\n' + block + '\n') })),
  ...['move 12345', 'create 12345'].map(body => ({ name: 'sound: unresolved alias ' + body,
    source: baseSource.replace('\nsounds\n', '\nGhost = Missing\n\nsounds\nGhost ' + body + '\n') })),
  ...['create 12345', 'move'].map(body => ({ name: 'sound: aggregate target ' + body,
    source: baseSource.replace('\nsounds\n', '\nTogether = Background and Player\n\nsounds\nTogether ' + body + '\n') })),
];
const nameBlocks = [
  ['plain alias', 'Choice = Crate'], ['forward alias', 'Choice = Later\nLater = Crate'],
  ['three-link alias pass', 'First = Second\nSecond = Third\nThird = Crate'],
  ['reverse alias order', 'Third = Crate\nSecond = Third\nFirst = Second'],
  ['numeric alias enumeration', '20 = 3\n3 = 1\n1 = Crate'],
  ['forward property member', 'Color = Later or Wall\nLater = Crate'],
  ['shared property alias', 'Color = Inner or Wall\nHue = Color\nInner = Crate or Player'],
  ['redefined property', 'Color = Crate or Wall\nHue = Color\nColor = Wall or Player'],
  ['alias and property coexist', 'Choice = Crate\nChoice = Wall or Player'],
  ['property then alias coexist', 'Choice = Wall or Player\nChoice = Crate'],
  ['aggregate and alias coexist', 'Choice = Background and Player\nChoice = Crate'],
  ['alias then aggregate coexist', 'Choice = Crate\nChoice = Background and Player'],
  ['property and aggregate coexist', 'Choice = Crate or Wall\nChoice = Background and Player'],
  ['aggregate then property coexist', 'Choice = Background and Player\nChoice = Crate or Wall'],
  ['redefined concrete property', 'Crate = Player or Wall'],
  ['redefined player property', 'Player = Crate or Wall'],
  ['redefined concrete alias', 'Crate = Wall'],
  ['compound alias promotion', 'Choice = Color\nColor = Crate or Wall'],
  ['alias promotion after an alias', 'Choice = Bridge\nBridge = Color\nColor = Crate or Wall'],
  ['cross-kind aggregate', 'Color = Crate or Wall\nTogether = Color and Background'],
  ['cross-kind property', 'Together = Crate and Background\nColor = Together or Wall'],
  ['numeric cross-kind diagnostic order', 'A = Crate or Wall\n20 = A and Background\n3 = A and Background'],
  ['shared cross-kind compound', 'Color = Crate or Wall\nTogether = Color and Background\nAlias = Together'],
  ['synonym cycle closing link', 'First = Second\nSecond = First'],
  ['recursive property members', 'First = Second or Wall\nSecond = First or Crate'],
  ['property direct self recovery', 'Color = Color or Crate'],
  ['aggregate direct self recovery', 'Together = Together and Crate'],
  ['ordinary orthogonal alias', 'orthogonal = Crate'],
  ['keyword action alias', 'action = Crate'],
  ['unicode alias', 'ΟΣ = Crate\nChoice = ΟΣ'],
  ['undeclared prototype name', 'Choice = __proto__'],
  ['repeated property member', 'Color = Crate or Crate'],
];
const assetBlocks = [
  ['solid one color', 'Player\nwhite'], ['solid multiple colors', 'Player\nwhite blue'],
  ['concatenated colors', 'Player\nwhiteblue'], ['hex colors', 'Player\n#fff #123456'],
  ['bad hex color', 'Player\n#12 red'], ['bad color word', 'Player\nwhite blur red'],
  ['more than ten colors', 'Player\n' + Array(11).fill('white').join(' ')],
  ['missing colors', 'Player'], ['blank before colors', 'Player\n\nwhite'],
  ['duplicate primary', 'Player\nwhite\n\nPlayer\nred'], ['duplicate alias', 'Player P P\nwhite'],
  ['alias shadows later primary', 'Player Crate\nwhite'],
  ['five rows', sprite(Array(5).fill('00000'))], ['four rows', sprite(Array(4).fill('00000'))],
  ['five short rows', sprite(Array(5).fill('0000'))], ['six rows', sprite(Array(6).fill('00000'))],
  ['long middle row', sprite(['00000', '00000', '0000000', '00000', '00000'])],
  ['long final row', sprite(['00000', '00000', '00000', '00000', '0000000'])],
  ['junk in sprite', sprite(['00000', '00x00', '00000', '00000', '00000'])],
  ['out of range pixel', sprite(['20000', '00000', '00000', '00000', '00000'])],
  ['repeated bad pixels', sprite(['22222', '22222', '00000', '00000', '00000'])],
  ['all transparent', sprite(Array(5).fill('.....'))], ['spaces within rows', sprite(Array(5).fill('0 0 0 0 0'))],
  ['comments between rows', sprite(['00000', '(comment)', '00000', '00000', '00000', '00000'])],
  ['unlayered numeric declaration order', 'Player\nwhite\n\n2\nred\n\n1\nblue'],
  ['numeric order across compiler phases', 'Player\nwhite\n\n20\nred blue\n\n3\nblack white'],
];
const levelBlocks = [
  ['ordinary row', 'PC.#'], ['unknown at first cell', '?PC#'], ['unknown at last column', 'PC.?\n....'],
  ['unknown below first cell', 'P.\n?.'], ['unknown after a filled column', 'P?\n.C'],
  ['repeated invalid glyph', 'P???'], ['unknown in each row', 'P?\n.?'],
  ['cropped invalid suffix', 'P.\n..??'], ['short row repeats its last glyph', 'PC.#\nP'],
  ['internal spaces', 'P  ?'], ['internal tab', 'P\tC'], ['internal Unicode space', 'P\u00a0C'],
  ['next-line is a glyph', 'P\u0085C'], ['astral glyph', 'P😀'], ['astral at first cell', '😀P'],
  ['lowercase expansion', 'Pİ'], ['contextual final sigma', 'ΟΣ'], ['sharp-s glyph', 'Pß'],
  ['leading comment', '(leading)P.'], ['captured prefix', 'P.(comment) C#'],
  ['invalid captured suffix', 'P(comment)?'], ['multiple trailing comments', 'P.(one) (two)'],
  ['multiline comment restart', 'P.(multi\ncomment)C#'],
  ['comment-only rows', '(one)\nP.\n(two)\n.C'], ['blank separates boards', 'P.\n\n.C'],
  ['equals separator', 'P.\n===\n.C'], ['comment changes equals recognition', 'P.\n=== (comment)\n.C'],
  ['closing comment before row', ')P.'], ['closing comment within row', 'P.)?'],
  ['message before board', 'message Before\nPC.#'], ['message after board', 'PC.#\nmessage After'],
  ['message between boards', 'P.\nmessage Between\n.C'], ['empty message', 'message\nP.'],
  ['glued ASCII message', 'messageHello'], ['Unicode message boundary', 'messageÉ'], ['underscore message boundary', 'message_foo'],
  ['literal message parentheses', 'message One (two) Three'],
  ['closing parenthesis starts a message', 'message )))'],
  ['closing parenthesis after a word stays literal', 'message One ) Two'],
  ['leading comment before literal open parenthesis', '(leading)message (literal\nP.'],
  ['leading comment before literal closing parenthesis', '(leading)message )\nP.'],
  ['multiline leading comment before literal message', '(multi\nline)message (literal\nP.'],
  ['case-expanded comment before message', '(İ)message Hello'],
  ['case expansion splits a surrogate', '(İ)message 😀'],
  ['twelve full message lines', 'message ' + 'a'.repeat(408)], ['thirteen message lines', 'message ' + 'a'.repeat(409)],
  ['twelve wrapped word lines', 'message ' + 'word '.repeat(84)], ['thirteen wrapped word lines', 'message ' + 'word '.repeat(85)],
  ['astral message wrapping', 'message ' + '😀'.repeat(205)],
  ['line separators in a message', 'message ' + 'abc\u2028'.repeat(110)],
  ['sixth source error stops reading', 'P?\nP?\nP?\nP?\nP?\nP?\nP?'],
];
const levelFixtures = [
  ...levelBlocks.map(([name, block]) => ({ name, source: baseSource.replace(/\nlevels\n[\s\S]*$/, '\nlevels\n' + block + '\n') })),
  ...[
    ['single-layer property glyph', 'a = Player or Crate', 'Pa'],
    ['multiple-layer property glyph', 'a = Player or Background', 'Pa'],
    ['source alias of a property', 'Thing = Player or Crate\na = Thing', 'Pa'],
    ['sharp-s alias', 'ß = Crate', 'Pß'],
    ['BMP Unicode alias', 'é = Crate', 'PÉ'],
    ['astral alias cannot name a code unit', '😀 = Crate', 'P😀'],
    ['expanded alias cannot name one unit', 'İ = Crate', 'Pİ'],
  ].map(([name, legend, block]) => ({ name, source: baseSource.replace('\nsounds\n', '\n' + legend + '\n\nsounds\n')
    .replace(/\nlevels\n[\s\S]*$/, '\nlevels\n' + block + '\n') })),
];
const metadataFixtures = [
  ...[
    '2x3', '2X3', '2.0x3', '1e2x3', '4e-1x3', '0x2', 'broken', '2x0', '-2x3',
    '2x1.5', '2_x3', '2147483648x3', '1xNaN', '1xInfinity', '2x', 'x',
  ].flatMap(value => ['flickscreen', 'zoomscreen'].map(key => ({ name: key + ' ' + value, source: key + ' ' + value + '\n' + baseSource }))),
  ...[
    'mastersystem', 'gameboycolour', 'amiga', 'arnecolors', 'famicom', 'atari', 'pastel', 'ega', 'amstrad',
    'proteus_mellow', 'proteus_rich', 'proteus_night', 'c64', 'whitingjp',
    ...Array.from({ length: 14 }, (_, index) => String(index + 1)),
    '0', '15', '41', '01', '1.0', '-1', '+1', '0x4', 'arnecolorsx', 'constructor', '__proto__', 'transparent',
  ].map(value => ({ name: 'palette ' + value, source: 'color_palette ' + value + '\n' + baseSource })),
  ...[
    'white', 'White', 'transparent', 'BLACK', '#123', '#ABC', '#123456', '#aBcDeF', '#12', '#1234',
    '#12345678', 'bluu', 'constructor', '__proto__', 'red blue', ' red ',
  ].flatMap(value => ['text_color', 'background_color'].map(key => ({ name: key + ' ' + value, source: key + ' ' + value + '\n' + baseSource }))),
  ...[
    ['two invalid colors', 'text_color bad\nbackground_color worse'],
    ['reversed color source order', 'background_color bad\ntext_color worse'],
    ['final valid color wins', 'text_color bad\ntext_color white'],
    ['final invalid color wins', 'text_color white\ntext_color bad'],
    ['palette declarations all checked', 'color_palette missing\ncolor_palette arnecolors'],
    ['repeated invalid palette deduplicates', 'color_palette missing\ncolor_palette missing'],
    ['different invalid palettes remain ordered', 'color_palette first\ncolor_palette second'],
  ].map(([name, block]) => ({ name, source: block + '\n' + baseSource })),
];
const fixtures = (recovery ? Array.from({ length: recoveryCount }, (_, index) => require('./recovery-generation.cjs').construct(recoverySeed, index))
  : sections ? require('./section-fixtures.cjs')(baseSource) : levels ? levelFixtures : rules ? ruleFixtures : events ? eventFixtures : names ? nameBlocks.map(([name, block]) => ({ name, source: baseSource.replace('\nsounds\n', '\n' + block + '\n\nsounds\n') }))
  : assets ? assetBlocks.map(([name, block]) => ({ name, source: baseSource.replace('Player\nwhite', block) })) : metadata ? metadataFixtures
  : errormessage_testdata.map(([name, payload]) => ({ name, source: payload[0], historicalMessages: payload[1], historicalErrorCount: payload[2] })))
  .filter(fixture => fixture.name.toLowerCase().includes(filter.toLowerCase()));
assert.ok(fixtures.length, 'No selected compiler fixtures');
const report = { revision: ORACLE_SOURCE.revision, binarySha256, binary, metadata, assets, names, events, rules, levels, sections, filter,
  campaign: recovery ? { seed: recoverySeed, count: recoveryCount, distinctSources: new Set(fixtures.map(value => value.identity)).size,
    constructionSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'recovery-generation.cjs'))).digest('hex') } : null,
  startedAt: new Date().toISOString(), fixtures: fixtures.length, matched: 0, failures: [], processFailures: [], oracleExceptions: [], referenceAborts: [] };
for (const [index, fixture] of fixtures.entries()) {
  const sourceFile = path.join(runDirectory, 'source-' + index + '.ps');
  fs.writeFileSync(sourceFile, fixture.source);
  const result = spawnSync(binary, ['--compile-only', sourceFile], { encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
  let actual;
  try {
    assert.ok(result.status === 0 || result.status === 2, 'Expected a structured compiler result');
    actual = JSON.parse(result.stdout.trim());
    assert.equal(actual.phase, 'compile');
    actual = { accepted: actual.accepted, errorCount: actual.errorCount,
      diagnostics: actual.diagnostics.map(({ line, severity, message }) => ({ line, severity, message })) };
  } catch (error) {
    report.processFailures.push({ name: fixture.name, sourceFile, status: result.status, error: result.error?.message ?? error.message, stdout: result.stdout, stderr: result.stderr });
    continue;
  }
  const { exception, ...expected } = oracle(fixture.source);
  // The pinned parser deliberately throws at its diagnostic-count ceiling.
  // Treat only that explicit terminal state as a checked compiler rejection;
  // arbitrary reference crashes still fail the audit and remain separate.
  const controlledAbort = exception !== null && expected.accepted === false && expected.diagnostics.length > 100 &&
    ['Too many errors/warnings; aborting compilation.', 'Too many errors/warnings; noping out.'].includes(exception);
  if (controlledAbort) report.referenceAborts.push({ name: fixture.name, reason: exception });
  else if (exception !== null) {
    // A crashed compiler has not produced a completed diagnostic outcome.
    // Preserve both observations and keep the run nonzero, without counting
    // an incomplete reference result again as a diagnostic mismatch.
    report.oracleExceptions.push({ name: fixture.name, sourceFile, exception, actual, partialReference: expected });
    continue;
  }
  try {
    assert.deepEqual(actual, expected);
    if (exception === null || controlledAbort) report.matched++;
  } catch (error) {
    report.failures.push({ name: fixture.name, sourceFile, actual, expected, historicalMessages: fixture.historicalMessages, historicalErrorCount: fixture.historicalErrorCount });
  }
}
report.finishedAt = new Date().toISOString();
const file = path.join(runDirectory, 'report.json');
const reportJson = JSON.stringify(report, null, 2) + '\n';
fs.writeFileSync(file, reportJson);
fs.writeFileSync(path.join(directory, recovery ? 'recovery-diagnostics.json' : sections ? 'section-diagnostics.json' : levels ? 'level-diagnostics.json' : rules ? 'rule-diagnostics.json' : events ? 'event-diagnostics.json' : names ? 'name-diagnostics.json' : assets ? 'asset-diagnostics.json' : metadata ? 'metadata-diagnostics.json' : 'corpus-diagnostics.json'), reportJson);
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'), binarySha256);
console.log(JSON.stringify({ fixtures: report.fixtures, matched: report.matched, mismatches: report.failures.length,
  processFailures: report.processFailures.length, oracleExceptions: report.oracleExceptions.length, referenceAborts: report.referenceAborts.length, report: file }, null, 2));
if (report.failures.length || report.processFailures.length || report.oracleExceptions.length) process.exitCode = 1;
