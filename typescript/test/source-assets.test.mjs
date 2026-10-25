import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from '../build/source-reader.js';
import { resolveDeclarations } from '../build/declarations.js';
import * as sourceTypes from '../build/source-model.js';
import { createSourceAssetsOracle } from './legacy-source-assets.cjs';
import { movementSource } from './scenarios.mjs';
import { compileGameData } from '../build/source-game-data.js';
import { compileSourceRules } from '../build/source-rule-compiler.js';
const assets = await import('../build/source-assets.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const colors = await import('../build/colors.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const oracle = createSourceAssetsOracle({ readSource, resolveDeclarations, ...sourceTypes, ...assets, ...colors });
test('independent source assets match the actual native producers', () => {
  assert.equal(typeof assets.compileObjectSprites, 'function');
  assert.equal(typeof assets.compileDisplayColors, 'function');
  oracle.compareFixture({ name: 'default appearances', source: movementSource() });
});

const fixture = (objects = 'Background .\nBlack\n\nPlayer P\nWhite', metadata = '') => ({ name: objects + metadata,
  source: `${metadata}\nOBJECTS\n${objects}\nLEGEND\nSOUNDS\nCOLLISIONLAYERS\nBackground\nPlayer\nRULES\nWINCONDITIONS\nLEVELS\nP.` });

const fifthRowFixture = suffix => fixture(`Background .\nBlack\n00000\n00000\n00000\n00000\n00000${suffix}\n\nPlayer P\nWhite`);
test('the fifth accepted pixel of row five immediately turns the suffix into a canonical alias', () => {
  const item = fifthRowFixture('0');
  item.source = item.source.replace('RULES\nWINCONDITIONS', 'RULES\n[ 0 ] -> [ 0 ]\nWINCONDITIONS').replace('LEVELS\nP.', 'LEVELS\n0P');
  const entry = oracle.nativeAssetEntry(item.source);
  assert.equal(entry.errorCount, 0);
  assert.deepEqual(entry.rows.background, Array(5).fill('00000'));
  assert.equal(entry.aliases.find(alias => alias.name === '0').target, 'background');
  const { document, declarations, result } = oracle.compareFixture(item);
  const source = document.objects[0], row = source.spriteRows[4];
  assert.equal(row.text, '000000');
  assert.equal(row.glyphs.length, 6);
  assert.equal(source.definitionSpriteRows[4].length, 5);
  const alias = source.definitionNames.find(token => token.value === '0');
  assert.equal(alias.word, row.glyphs[5]);
  assert.equal(alias.word.span.start.line, entry.aliases.find(alias => alias.name === '0').line);
  const background = [...declarations.objectSources.keys()].find(object => object.name === 'background');
  assert.equal(declarations.names.get('0').object, background);
  assert.equal(declarations.names.get('0').word, alias.word);
  assert.equal(declarations.ruleNames.synonyms.get('0'), 'background');
  assert.deepEqual([...declarations.glyphs.get('0')], [background]);
  const data = oracle.independently(() => compileGameData(document, declarations));
  assert.deepEqual([...data.data.levels[0].board.rows[0][0].objects], [background]);
  const rules = oracle.independently(() => compileSourceRules(document, declarations));
  assert.deepEqual(rules.diagnostics, []);
  assert.deepEqual([...rules.data.earlyRules.groups[0].rules[0].rows[0][0].requiredObjects], [background]);
  assert.deepEqual(result.diagnostics, []);
});

for (const [suffix, expected] of [[' 0', ['0']], ['(comment)0', ['0']], ['0(comment)1', ['0', '1']],
  ['(outer(inner))01', ['01']], [' MiXeD', ['mixed']], [')0', ['0']]]) {
  test('completed fifth-row suffix aliases follow the native midline name grammar: ' + suffix, () => {
    const item = fifthRowFixture(suffix);
    const entry = oracle.nativeAssetEntry(item.source);
    assert.equal(entry.errorCount, 0);
    const { document, declarations } = oracle.compareFixture(item);
    const aliases = document.objects[0].definitionNames.slice(2);
    assert.deepEqual(aliases.map(token => token.value), expected);
    assert.deepEqual(entry.aliases.filter(alias => expected.includes(alias.name)).map(alias => alias.name), expected);
    for (const alias of aliases) {
      assert.equal(item.source.slice(alias.word.span.start.offset, alias.word.span.end.offset), alias.word.spelling);
      assert.equal(declarations.names.get(alias.value).word, alias.word);
    }
  });
}

for (const [continuation, colors, rows] of [
  ['Blue', ['black', 'blue'], Array(5).fill('00000')],
  ['Green', ['black', 'green'], Array(5).fill('00000')],
  ['(comment)Blue', ['black', 'blue'], Array(5).fill('00000')],
  ['Blue (comment)Red', ['black', 'blue', 'red'], Array(5).fill('00000')],
  ['Blue\n1', ['black', 'blue'], ['1']],
  ['Blue\n(comment)1', ['black', 'blue'], ['1']],
  ['Blue\nCrate C\nRed', ['black', 'blue'], Array(5).fill('00000')],
]) {
  test('suffix aliases await another color line and preserve the old sprite until replacement: ' + continuation, () => {
    const item = fifthRowFixture('0');
    item.source = item.source.replace('000000\n\nPlayer', `000000\n${continuation}\n\nPlayer`);
    if (continuation.includes('Crate')) item.source = item.source.replace('COLLISIONLAYERS\nBackground\nPlayer', 'COLLISIONLAYERS\nBackground\nPlayer, Crate');
    const entry = oracle.nativeAssetEntry(item.source);
    assert.equal(entry.errorCount, 0);
    assert.deepEqual(entry.rows.background, rows);
    const { document, native } = oracle.compareFixture(item);
    const background = document.objects[0];
    assert.deepEqual(background.definitionColors.map(token => token.value), colors);
    background.definitionColors.forEach((token, index) => assert.equal(token.word, background.colors[index], 'accepted colors link to this physical line'));
    assert.deepEqual(native.raw.find(object => object.name === 'background').colors, colors);
    assert.equal(background.colorLine.original, 'Black');
    for (const word of background.colors) assert.equal(item.source.slice(word.span.start.offset, word.span.end.offset), word.spelling);
    assert.equal(background.spriteRows[4].text, '000000');
    if (rows.length === 1) {
      assert.equal(background.spriteRows[5].text, '1');
      assert.equal(background.definitionSpriteRows[0][0].word, background.spriteRows[5].glyphs[0]);
    }
  });
}

test('a suffix rejected as an existing concrete name leaves the next physical line awaiting a primary', () => {
  const item = fifthRowFixture('Background');
  item.source = item.source.replace('00000Background\n\nPlayer', '00000Background\nBlue B\nRed\n\nPlayer')
    .replace('COLLISIONLAYERS\nBackground\nPlayer', 'COLLISIONLAYERS\nBackground\nPlayer, Blue');
  const entry = oracle.nativeAssetEntry(item.source);
  assert.equal(entry.errorCount, 1);
  assert.equal(entry.aliases.some(alias => alias.name === 'background'), false);
  const { declarations } = oracle.compareFixture(item);
  assert.deepEqual(declarations.objects.map(object => object.name), ['background', 'blue', 'player']);
});

test('junk before a midline comment resumes the prior accepted row using its existing length', () => {
  const item = fixture('Background .\nBlack\n00000\nA(comment)00000\n00000\n00000\n00000\n\nPlayer P\nWhite');
  const entry = oracle.nativeAssetEntry(item.source);
  assert.equal(entry.errorCount, 1);
  assert.deepEqual(entry.rows.background, ['000000', '00000', '00000', '00000']);
  const { document, result } = oracle.compareFixture(item);
  assert.deepEqual(document.objects[0].spriteRows.map(row => row.text), ['00000', 'A00000', '00000', '00000', '00000']);
  const continuation = document.objects[0].definitionSpriteRows[0][5];
  assert.equal(continuation.word, document.objects[0].spriteRows[1].glyphs[1]);
  const sprite = result.sprites.values().next().value;
  assert.equal(sprite.pixels.length, 4);
  assert.ok(sprite.pixels.every(row => row.length === 4));
});

test('an unmatched close consumes logical SOL so later metadata remains authored but is not accepted', () => {
  const item = fixture(undefined, 'text_color red\n)text_color blue\ncolor_palette ega\n)color_palette 3');
  const entry = oracle.nativeAssetEntry(item.source);
  assert.equal(entry.errorCount, 0);
  assert.deepEqual(entry.metadata, ['text_color', 'red', 'color_palette', 'ega']);
  const { document, declarations, result, display } = oracle.compareFixture(item);
  assert.deepEqual(document.metadata.map(source => source.accepted), [true, false, true, false]);
  assert.deepEqual(document.metadata.map(source => source.authoredValue), ['red', 'blue', 'ega', '3']);
  assert.equal(result.palette.name, 'ega');
  assert.equal(display.textColor, '#ff5555');
  const data = oracle.independently(() => compileGameData(document, declarations));
  assert.deepEqual([...data.metadata], [['text_color', 'red'], ['color_palette', 'ega']]);
});

for (const continuation of ['(comment)00000', '(outer(inner))00000', 'A(outer(inner))00000',
  'A(comment\n)00000', ')00000', ')(comment)00000']) {
  test('sprite logical SOL follows actual leading, nested and multiline comment visits: ' + continuation, () => {
    oracle.compareFixture(fixture(`Background .\nBlack\n00000\n${continuation}\n00000\n00000\n00000\n\nPlayer P\nWhite`));
  });
}

for (const metadata of ['(comment)text_color blue', '(outer(inner))text_color blue', '(comment\n)text_color blue',
  ')text_color blue', ')(comment)text_color blue', '(comment))text_color blue', 'text_color red (comment)text_color blue']) {
  test('metadata logical SOL follows actual leading, nested and multiline comment visits: ' + metadata, () => {
    const { document, declarations, native } = oracle.compareFixture(fixture(undefined, metadata));
    const accepted = document.metadata.filter(source => source.accepted).flatMap(source => [source.key.normalized, source.value]);
    assert.deepEqual(accepted, native.metadata);
    assert.deepEqual([...oracle.independently(() => compileGameData(document, declarations)).metadata], Array.from({ length: native.metadata.length / 2 },
      (_unused, index) => native.metadata.slice(index * 2, index * 2 + 2)));
  });
}

test('ignored metadata cannot change session flags, dimension validation or retained title values', () => {
  const item = fixture(undefined, 'title Retained\n)title Ignored\n)noundo\n)flickscreen invalid');
  const { document, declarations, native } = oracle.compareFixture(item);
  assert.deepEqual(native.metadata, ['title', 'Retained']);
  const result = oracle.independently(() => compileGameData(document, declarations));
  assert.deepEqual([...result.metadata], [['title', 'Retained']]);
  assert.equal(result.data.metadata.noUndo, false);
  assert.deepEqual(result.diagnostics, []);
});
test('all fourteen static palettes and numeric aliases retain exact native values', () => {
  oracle.comparePalettes();
  for (const name of colors.colorPalettes.keys()) oracle.compareFixture(fixture(undefined, `color_palette ${name}`));
  for (const number of colors.colorPaletteAliases.keys()) oracle.compareFixture(fixture(undefined, `color_palette ${number}`));
});
for (const metadata of ['', 'color_palette ega\ncolor_palette absent', 'color_palette ega\ncolor_palette absent\ncolor_palette 3',
  'color_palette absent\ncolor_palette missing', 'color_palette']) {
  test('palette visits every accepted metadata occurrence: ' + metadata, () => oracle.compareFixture(fixture(undefined, metadata)));
}
for (const line of ['redblue #aBc #AABBCC transparent grey gray', 'notacolor red', 'red junk blue',
  '#12 red', 'red ? blue (comment) green', 'red(comment)blue', 'red\tblue',
  'red)blue', 'red (nested (comment)) blue',
  'red red red red red red red red red red red']) {
  test('accepted color tokens retain authored evidence: ' + line, () => {
    const item = fixture(`Background .\n${line}\n\nPlayer P\nWhite`);
    const { document } = oracle.compareFixture(item);
    for (const word of document.objects[0].colors) assert.equal(item.source.slice(word.span.start.offset, word.span.end.offset), word.spelling);
  });
}
for (const rows of ['0', '01\n0.\n0', '000000\n00000\n00000\n00000\n00000',
  '000000(comment)0000\n00000\n00000\n00000\n00000',
  '0000\n0000\n0000\n0000\n0000\n0000', '00A00\n00000\n00000\n00000\n00000',
  '0 0 0 0 0\n00000\n00000\n00000\n00000', '0(comment)0000\n00000\n00000\n00000\n00000',
  '99999\n.....\n00000\n00000\n00000']) {
  test('native accepted sprite rows and square recovery: ' + rows, () => oracle.compareFixture(fixture(`Background .\nBlack\n${rows}\n\nPlayer P\nWhite`)));
}
for (const metadata of ['background_color red\ntext_color blue\ncolor_palette 1', 'background_color #AbC\ntext_color transparent',
  'background_color invalid\ntext_color invalid', 'background_color red\nbackground_color invalid\ntext_color invalid\ntext_color white',
  'background_color red\nbackground_color\ntext_color blue\ntext_color']) {
  test('display metadata accepts final values and validates text before background: ' + metadata, () => oracle.compareFixture(fixture(undefined, metadata)));
}

test('shared helpers trim, retain exact valid spelling, and reject noncolors', () => {
  assert.equal(colors.colorToHex(colors.colorPalettes.get('arnecolors'), ' grey '), '#9d9d9d');
  assert.equal(colors.colorToHex(colors.colorPalettes.get('arnecolors'), ' #AbCdEf '), '#AbCdEf');
  for (const value of [' #ABC ', '#aBcDef', 'transparent', 'grey', 'gray']) assert.equal(colors.isColor(value), true, value);
  for (const value of ['Red', '#AB', '#ABCD', '#ABCDE', '#ABCDEFG', 'bogus']) assert.equal(colors.isColor(value), false, value);
  assert.equal(colors.paletteName('01'), '01');
  assert.equal(colors.paletteName('1'), 'mastersystem');
});

test('invalid effective colors diagnose after the ten-color limit and retain the accepted count', () => {
  const item = fixture();
  const values = ['red', 'invalid', ...Array(9).fill('blue')];
  const { result } = oracle.compareFixture(item, {
    afterParse: parsed => { parsed.objects.background.colors = [...values]; },
    afterRead: document => {
      const object = document.objects[0], word = object.colors[0];
      object.definitionColors.splice(0, object.definitionColors.length, ...values.map(value => ({ value, word })));
    },
  });
  assert.deepEqual(result.diagnostics.map(issue => issue.code), ['too-many-sprite-colors', 'invalid-object-color']);
  assert.equal(result.sprites.values().next().value.colors[1], '#ff00ff');
});

test('explicit invalid pixels model native nonnumeric compiler input without a numeric sentinel', () => {
  const rows = ['0a', '.0', '9'];
  const { result } = oracle.compareFixture(fixture(), {
    afterParse: parsed => { parsed.objects.background.spritematrix = rows; },
    afterRead: document => {
      const source = document.objects[0], word = source.colors[0];
      source.definitionSpriteRows.push(...rows.map(row => [...row].map(value => ({ value, word }))));
    },
  });
  const pixels = result.sprites.values().next().value.pixels;
  assert.deepEqual(pixels[0][1], { kind: assets.SpritePixelKind.Invalid });
  assert.deepEqual(pixels[0][2], { kind: assets.SpritePixelKind.Invalid });
  assert.deepEqual(pixels[1][0], { kind: assets.SpritePixelKind.Transparent });
  assert.deepEqual(pixels[2][0], { kind: assets.SpritePixelKind.Color, color: 9 });
});

test('numeric dictionary keys precede ordinary objects for appearance and diagnostic ordering', () => {
  const item = fixture('Background .\ninvalid\n\n10\ninvalid\n\n2\ninvalid\n\nPlayer P\ninvalid');
  const { result } = oracle.compareFixture(item);
  assert.deepEqual([...result.sprites.keys()].map(object => object.name), ['2', '10', 'background', 'player']);
  assert.deepEqual(result.diagnostics.map(issue => issue.message), ['2', '10', 'background', 'player'].map(name => `color not specified for object "${name}".`));
});

test('palette errors have explicit line zero and no fabricated authored span', () => {
  const { result } = oracle.compareFixture(fixture(undefined, 'color_palette missing'));
  assert.equal(result.diagnostics[0].reportedLine, 0);
  assert.equal(result.diagnostics[0].span, null);
  assert.equal(sourceTypes.SourceDiagnosticPhase.Reader, 0);
  assert.equal(sourceTypes.SourceDiagnosticPhase.Declarations, 1);
  assert.equal(sourceTypes.SourceDiagnosticPhase.GameData, 2);
  assert.equal(sourceTypes.SourceDiagnosticPhase.Rules, 3);
  assert.equal(sourceTypes.SourceDiagnosticPhase.Assets, 4);
});

test('authored junk suffix stays intact while only accepted prefix supplies pixels', () => {
  const { document, result, native } = oracle.compareFixture(fixture('Background .\nBlack\n11A11\n00000\n00000\n00000\n00000\n\nPlayer P\nWhite'));
  const source = document.objects[0], row = source.spriteRows[0];
  assert.equal(row.text, '11A11');
  assert.deepEqual(row.glyphs.map(glyph => glyph.spelling), ['1', '1', 'A', '1', '1']);
  assert.equal(source.definitionSpriteRows[0].map(token => token.value).join(''), '11');
  for (const token of source.definitionSpriteRows[0]) assert.ok(row.glyphs.includes(token.word), 'accepted pixels link to unchanged authored glyphs');
  assert.equal(result.sprites.values().next().value.pixels[0][2].kind, assets.SpritePixelKind.Invalid);
  assert.ok(native.parserDiagnostics.some(issue => issue.message === 'Unknown junk in spritematrix for object BACKGROUND.'));
});

test('the original Unknown junk in spritematrix fixture retains native accepted rows', () => {
  const item = oracle.compilationFixtures().find(item => item.name === 'Unknown junk in spritematrix');
  assert.ok(item, 'original compilation fixture');
  oracle.compareFixture(item);
});

test('orphan identity receives no independently authored appearance', () => {
  const item = { name: 'orphan appearance', source: movementSource().replace('Player, Crate, Wall', 'Player, Crate\nBackground') };
  const { declarations, result } = oracle.compareFixture(item);
  assert.notEqual(declarations.orphanedObject, null);
  assert.equal(result.sprites.has(declarations.orphanedObject), false);
  assert.equal(result.sprites.has(declarations.orphanedObject.orphanedFrom), true);
});

test('comparison rejects corrupted palette, pixel, default dimensions and diagnostic order', () => {
  const base = fixture();
  assert.throws(() => oracle.compareFixture(base, { compileObjectSprites: (...args) => {
    const result = assets.compileObjectSprites(...args);
    return { ...result, palette: { ...result.palette, name: 'ega' } };
  } }), /selected palette/);
  assert.throws(() => oracle.compareFixture(base, { compileObjectSprites: (...args) => {
    const result = assets.compileObjectSprites(...args), sprites = new Map(result.sprites);
    const [object, sprite] = sprites.entries().next().value;
    const pixels = sprite.pixels.map(row => [...row]);
    pixels[0][0] = { kind: assets.SpritePixelKind.Transparent };
    sprites.set(object, { ...sprite, pixels });
    return { ...result, sprites };
  } }), /object appearances/);
  assert.throws(() => oracle.compareFixture(base, { compileObjectSprites: (...args) => {
    const result = assets.compileObjectSprites(...args), sprites = new Map(result.sprites);
    const [object, sprite] = sprites.entries().next().value;
    sprites.set(object, { ...sprite, pixels: sprite.pixels.slice(1) });
    return { ...result, sprites };
  } }), /object appearances/);
  assert.throws(() => oracle.compareFixture(fixture(undefined, 'text_color invalid\nbackground_color invalid'), { compileDisplayColors: (...args) => {
    const result = assets.compileDisplayColors(...args);
    return { ...result, diagnostics: [...result.diagnostics].reverse() };
  } }), /ordered raw display diagnostics/);
});

test('native schema guards reject unknown raw and compiled appearance members', () => {
  assert.throws(() => oracle.compareFixture(fixture(), { afterParse: parsed => { parsed.objects.background.extraAppearance = true; } }), /Unsupported vanilla raw asset object field/);
  assert.throws(() => oracle.compareFixture(fixture(), { afterObjects: parsed => { parsed.objects.background.extraAppearance = true; } }), /Unsupported vanilla compiled asset object field/);
  assert.throws(() => oracle.compareFixture(fixture(), { afterParse: parsed => { parsed.objects.background.colors.extraColorMeaning = true; } }), /complete array fields/);
  assert.throws(() => oracle.compareFixture(fixture(), { afterObjects: parsed => { parsed.objects.background.spritematrix[0].extraPixelMeaning = true; } }), /complete array fields/);
});

test('candidate compilation cannot call native parser, compiler, or gameplay producers', () => {
  for (const name of ['loadFile', 'generateExtraMembers', 'generateSpriteMatrix', 'formatHomePage', 'processInput']) {
    assert.throws(() => oracle.compareFixture(fixture(), { compileObjectSprites: () => globalThis[name]() }), new RegExp('Candidate called native ' + name));
  }
  assert.throws(() => oracle.compareFixture(fixture(), { compileObjectSprites: () => new Function('return new codeMirrorFn()')() }), /Candidate called native codeMirrorFn/);
});

test('mutating the supplied display palette is rejected even through a frozen Map', () => {
  assert.throws(() => oracle.compareFixture(fixture(), { compileDisplayColors: (document, palette) => {
    palette.colors.set('red', '#bad');
    return assets.compileDisplayColors(document, palette);
  } }), /display palette unchanged/);
});

test('native appearance diagnostics remain separate from later background declaration diagnostics', () => {
  const item = fixture('Grass .\nInvalid\n\nWater W\nBlue\n\nPlayer P\nWhite');
  item.source = item.source.replace('LEGEND\n', 'LEGEND\nBackground = Grass or Water\n').replace('COLLISIONLAYERS\nBackground\nPlayer', 'COLLISIONLAYERS\nGrass\nWater\nPlayer');
  const { native, result } = oracle.compareFixture(item);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(native.declarationDiagnostics.length, 1);
  assert.equal(native.declarationDiagnostics[0].message, 'Background objects must be on the same layer');
  assert.deepEqual(native.extraMemberDiagnostics, [...native.diagnostics, ...native.declarationDiagnostics]);
});

test('all 478 original sources match every native object appearance and display color', t => {
  const fixtures = oracle.corpusFixtures();
  assert.equal(fixtures.length, 478);
  const totals = { sources: 0, objects: 0, pixels: 0, colors: 0, objectDiagnostics: 0, displayDiagnostics: 0 };
  for (const item of fixtures) {
    const { result, display } = oracle.compareFixture(item);
    totals.sources++; totals.objects += result.sprites.size;
    for (const sprite of result.sprites.values()) {
      totals.pixels += sprite.pixels.reduce((sum, row) => sum + row.length, 0);
      totals.colors += sprite.colors.length;
    }
    totals.objectDiagnostics += result.diagnostics.length;
    totals.displayDiagnostics += display.diagnostics.length;
  }
  t.diagnostic(JSON.stringify(totals));
  assert.deepEqual(totals, { sources: 478, objects: 12196, pixels: 304900, colors: 22867, objectDiagnostics: 3, displayDiagnostics: 0 });
});
