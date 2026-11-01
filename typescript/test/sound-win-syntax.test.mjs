import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource, readAuthoredSource } from '../build/source-reader.js';
import { resolveDeclarations } from '../build/declarations.js';
import { compileSounds, compileWinConditions } from '../build/source-game-data.js';
import { WinQuantifier } from '../build/win-conditions.js';
import { walkSourceLexically } from '../build/source-lexical.js';
import { AcceptedSoundKind, SoundEventKind, SoundVerb, SoundDirectionFamily, SoundSeedKind } from '../build/source-sound-syntax.js';
import { WinSyntaxKind, WinTargetKind } from '../build/source-win-syntax.js';
import { SourceLineKind, SourceSectionKind } from '../build/source-model.js';
import { movementSource } from './scenarios.mjs';

function prepare(sounds = 'sfx0 001', wins = 'all Player on Crate') {
  const { document } = readSource(movementSource({ sounds }).replace('winconditions\n', `winconditions\n${wins}\n`));
  return { document, declarations: resolveDeclarations(document).declarations };
}
function forbidRead(object, field) {
  Object.defineProperty(object, field, { configurable: true,
    get() { throw new Error('Compiler tried to read raw sound/win evidence: ' + field); } });
}

test('sound compilation consumes recovered syntax without raw words or physical source', () => {
  const { document, declarations } = prepare();
  forbidRead(document.sounds[0], 'words');
  forbidRead(document, 'source');
  for (const line of document.lines) forbidRead(line, 'original');
  const result = compileSounds(document, declarations, () => assert.fail('unexpected sound diagnostic'));
  assert.deepEqual([...result.sounds.sfx], [[0, '001']]);
});

test('win compilation consumes recovered syntax without raw words or physical source', () => {
  const { document, declarations } = prepare();
  forbidRead(document.winConditions[0], 'words');
  forbidRead(document, 'source');
  for (const line of document.lines) forbidRead(line, 'original');
  const result = compileWinConditions(document, declarations, () => assert.fail('unexpected win diagnostic'));
  assert.equal(result[0].quantifier, WinQuantifier.All);
  assert.deepEqual([...result[0].target.objects].map(object => object.name), ['crate']);
});

test('changing the recovered sound definition changes compilation without changing authored words', () => {
  const { document, declarations } = prepare('sfx0 001\nsfx1 002');
  const [first, second] = document.sounds;
  const result = compileSounds({ ...document, sounds: [{ ...first, definition: second.definition }] }, declarations, () => {});
  assert.deepEqual([...result.sounds.sfx], [[1, '002']]);
  assert.equal(first.words[0].spelling, 'sfx0');
});

test('changing the recovered win definition changes compilation without changing authored words', () => {
  const { document, declarations } = prepare('', 'all Player on Crate\nno Crate');
  const [first, second] = document.winConditions;
  const result = compileWinConditions({ ...document, winConditions: [{ ...first, definition: second.definition }] }, declarations, () => {});
  assert.equal(result[0].quantifier, WinQuantifier.No);
  assert.deepEqual([...result[0].subject.objects].map(object => object.name), ['crate']);
  assert.equal(first.words[0].spelling, 'all');
});

test('sound definitions bind accepted tokens once to their exact authored identities', () => {
  const { document } = prepare('sFx10 000123\nPlayer MoVe Left UP 00456\nPlayer move up down\nPlayer create');
  const [event, target, directionSeed, verbSeed] = document.sounds;
  assert.equal(event.definition.kind, AcceptedSoundKind.Event);
  assert.equal(event.definition.event.kind, SoundEventKind.SFX);
  assert.equal(event.definition.event.index, 10);
  assert.equal(event.definition.event.token.word, event.words[0]);
  assert.equal(event.definition.seed.word, event.words[1]);
  assert.equal(event.definition.seed.value, '000123');
  assert.equal(target.definition.kind, AcceptedSoundKind.Target);
  assert.equal(target.definition.target.word, target.words[0]);
  assert.equal(target.definition.verb.kind, SoundVerb.Move);
  assert.equal(target.definition.verb.token.word, target.words[1]);
  assert.deepEqual(target.definition.verb.directions.map(direction => direction.family), [SoundDirectionFamily.Left, SoundDirectionFamily.Up]);
  for (const [index, direction] of target.definition.verb.directions.entries()) assert.equal(direction.token.word, target.words[index + 2]);
  assert.equal(target.definition.seed.kind, SoundSeedKind.Numeric);
  assert.equal(target.definition.seed.token.word, target.words[4]);
  assert.equal(directionSeed.definition.seed.kind, SoundSeedKind.Recovered);
  assert.equal(directionSeed.definition.seed.token.word, directionSeed.words[3]);
  assert.deepEqual(directionSeed.definition.verb.directions.map(direction => direction.family), [SoundDirectionFamily.Up]);
  assert.equal(verbSeed.definition.seed.kind, SoundSeedKind.Recovered);
  assert.equal(verbSeed.definition.seed.token, verbSeed.definition.verb.token);
  for (const sound of document.sounds) assert.equal(document.source.slice(sound.span.start.offset, sound.span.end.offset).trim(), sound.words.map(word => word.spelling).join(' '));
});

test('source-time target acceptance is final before domain lookup during compilation', () => {
  const { document, declarations } = prepare('Player move 003\nLater move 004');
  assert.equal(document.sounds[1].definition, null);
  const report = () => assert.fail('the compiler must not repeat source rejection');
  const result = compileSounds(document, { ...declarations, firstDeclarationWords: new Map() }, report);
  assert.deepEqual(result.movementSounds.flat().map(sound => sound.seed), ['003']);
  const later = readSource(movementSource({ sounds: 'Later move 004' }).replace('collisionlayers\n', 'legend\nLater = Player\ncollisionlayers\n'));
  assert.equal(later.document.sounds[0].definition, null, 'a later declaration cannot reaccept an earlier sound');
});

test('rule sound vocabulary comes from the same retained event definitions', () => {
  const lexical = walkSourceLexically(movementSource({ sounds: 'sfx0\nsfx1 001\nsfx2 nope\nsfx3 123 )\nPlayer' }), false);
  assert.deepEqual([...lexical.definedSounds], ['sfx0', 'sfx1']);
  assert.deepEqual([...lexical.soundDefinitions.values()].map(definition => definition.kind),
    [AcceptedSoundKind.BareEvent, AcceptedSoundKind.Event, AcceptedSoundKind.BareTarget]);
});

test('win syntax retains the native physical capture independently of authored comment views', () => {
  const { document } = prepare('', 'all Player (c) on Crate\n(c)all Player on Crate\nall (c)Player on Crate\n) all Player on Crate');
  const [truncated, insideComment, missing, skipped] = document.winConditions;
  assert.equal(truncated.definition.kind, WinSyntaxKind.Clause);
  assert.equal(truncated.definition.quantifierToken.word, truncated.words[0]);
  assert.equal(truncated.definition.subjectToken.word, truncated.words[1]);
  assert.equal(truncated.definition.target.kind, WinTargetKind.Everywhere);
  assert.deepEqual(truncated.words.map(word => word.spelling), ['all', 'Player', 'on', 'Crate']);
  assert.equal(insideComment.definition.quantifier, WinQuantifier.Some);
  const token = insideComment.definition.quantifierToken;
  assert.equal(token.value, 'c)all');
  assert.equal(document.source.slice(token.word.span.start.offset, token.word.span.end.offset), 'c)all');
  assert.equal(missing.definition.kind, WinSyntaxKind.MissingSubject);
  assert.equal(missing.definition.quantifierToken.word, missing.words[0]);
  assert.equal(skipped.definition, null, 'a skipped logical SOL cannot invent win registration');
});

test('recovered win tokens preserve expanding Unicode values and exact authored spans', () => {
  const { document } = readSource(movementSource().replace('Player\nwhite', 'Player İ\nwhite')
    .replace('winconditions\n', 'winconditions\n(c)ALL İ on Crate\n'));
  const win = document.winConditions[0].definition;
  assert.equal(win.quantifier, WinQuantifier.Some);
  assert.equal(win.quantifierToken.value, 'c)all');
  assert.equal(win.subjectToken.value, 'i̇');
  assert.equal(win.subjectToken.word, document.winConditions[0].words[1]);
  assert.equal(win.subjectToken.word.spelling, 'İ');
  assert.equal(win.subjectToken.word.span.end.offset - win.subjectToken.word.span.start.offset, 1);
  assert.equal(win.target.token.word.spelling, 'Crate');
});

test('sound and win syntax discriminants are numeric enums', () => {
  for (const enumeration of [AcceptedSoundKind, SoundEventKind, SoundVerb, SoundDirectionFamily, SoundSeedKind, WinSyntaxKind, WinTargetKind]) {
    for (const name of Object.keys(enumeration).filter(name => Number.isNaN(Number(name)))) assert.equal(typeof enumeration[name], 'number');
  }
});

test('a consumed logical start keeps heading-shaped sound text in its actual section', () => {
  for (const sounds of [') sounds sfx0 123', ') rules Player move 123']) {
    const source = movementSource({ sounds });
    const lexical = walkSourceLexically(source, false);
    assert.equal(lexical.soundDefinitions.size, 1, 'the source visit already retained its accepted definition');
    const { document } = readAuthoredSource(source, lexical);
    assert.equal(document.sounds.length, 1, 'authored grouping must not hide the retained sound');
    const sound = document.sounds[0];
    assert.notEqual(sound.definition, null);
    const line = document.lines[sound.span.start.line - 1];
    assert.equal(line.kind, SourceLineKind.Entry);
    assert.equal(document.sections[sound.sectionId].kind, SourceSectionKind.Sounds);
    assert.deepEqual(sound.words.map(word => word.spelling), sounds.slice(2).split(' '));
    assert.equal(document.sections.filter(section => section.kind === SourceSectionKind.Sounds).length, 1);
  }
});

test('logical heading ownership still preserves later raw evidence after a capped walk', () => {
  const source = Array.from({ length: 6 }, (_, index) => `unknown${index}`).join('\n') + '\nSOUNDS\n) sounds sfx0 123';
  const lexical = walkSourceLexically(source, true);
  assert.notEqual(lexical.stop, null);
  assert.equal(lexical.soundDefinitions.size, 0);
  const { document } = readAuthoredSource(source, lexical);
  assert.equal(document.sections.length, 1, 'authored headings after the cap remain visible');
  assert.equal(document.sections[0].kind, SourceSectionKind.Sounds);
  assert.equal(document.sounds.length, 1);
  assert.deepEqual(document.sounds[0].words.map(word => word.spelling), ['sounds', 'sfx0', '123']);
  assert.equal(document.sounds[0].definition, null, 'raw grouping cannot invent a source registration after the cap');
});
