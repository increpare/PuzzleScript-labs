'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPuzzleScript, SOURCE_FILES } = require('./native-host.cjs');
const { assertVanillaFields } = require('./vanilla-fields.cjs');

function createSourceAssetsOracle(types) {
  loadPuzzleScript({ includeTests: true });
  // Keep every raw extra-member diagnostic. Its palette/appearance block runs
  // before legend/background resolution in the same native function. Record
  // the actual native call sites to distinguish those existing boundaries,
  // without filtering by wording or reimplementing any producer.
  const nativeRoot = path.join(__dirname, './vanilla');
  let prefix = 'var exports=undefined; var module=undefined;\n';
  let compilerOffset;
  for (const file of SOURCE_FILES) {
    prefix += `\n// ---- ${file} ----\n`;
    if (file === 'js/compiler.js') { compilerOffset = prefix.split('\n').length - 1; break; }
    prefix += fs.readFileSync(path.join(nativeRoot, file), 'utf8') + '\n';
  }
  const compilerSource = fs.readFileSync(path.join(nativeRoot, 'js/compiler.js'), 'utf8');
  const lineAt = marker => compilerOffset + compilerSource.slice(0, compilerSource.indexOf(marker)).split('\n').length;
  const assetStart = lineAt('//get colorpalette name'), assetEnd = lineAt('let mask = blankMask.concat([]);');
  const producers = [...new Set(['parser.js', 'compiler.js', 'engine.js'].flatMap(file =>
    [...fs.readFileSync(path.join(__dirname, './vanilla/js', file), 'utf8').matchAll(/^function (\w+)\s*\(/gm)].map(match => match[1])))];
  function capture(callback, sites) {
    const diagnostics = [], names = ['logError', 'logWarning', 'logErrorNoLine', 'logWarningNoLine'];
    const originals = names.map(name => globalThis[name]);
    try {
      names.forEach((name, index) => { globalThis[name] = (message, line) => {
        if (sites) {
          const call = /at \w+ \(vanilla_puzzlescript_sources\.js:(\d+):\d+\)/u.exec(new Error().stack);
          assert.ok(call, 'native diagnostic call site');
          sites.push(Number(call[1]));
        }
        diagnostics.push({ message, line: index > 1 ? null : line ?? null,
          severity: index % 2 === 0 ? types.SourceDiagnosticSeverity.Error : types.SourceDiagnosticSeverity.Warning,
          countsAsError: index % 2 === 0 || line === undefined });
      }; });
      callback();
    } finally { names.forEach((name, index) => { globalThis[name] = originals[index]; }); }
    return diagnostics;
  }
  function independently(callback) {
    const originals = producers.map(name => globalThis[name]), originalParser = codeMirrorFn;
    try {
      producers.forEach(name => { globalThis[name] = () => { throw new Error('Candidate called native ' + name); }; });
      codeMirrorFn = function() { throw new Error('Candidate called native codeMirrorFn'); };
      return callback();
    } finally {
      codeMirrorFn = originalParser;
      producers.forEach((name, index) => { globalThis[name] = originals[index]; });
    }
  }
  function freeze(value, seen = new Set()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (value instanceof Map) for (const [key, child] of value) { freeze(key, seen); freeze(child, seen); }
    else if (value instanceof Set) for (const child of value) freeze(child, seen);
    else for (const child of Object.values(value)) freeze(child, seen);
    Object.freeze(value);
  }
  function array(kind, value) {
    assert.ok(Array.isArray(value), kind + ': ordinary array');
    assert.deepEqual(Object.keys(value), Array.from({ length: value.length }, (_unused, index) => String(index)), kind + ': complete array fields');
    return value;
  }
  const diagnosticView = items => items.map(item => {
    assertVanillaFields('candidate asset diagnostic', item, ['code', 'message', 'span', 'reportedLine', 'severity', 'countsAsError', 'phase']);
    assert.equal(typeof item.code, 'string');
    assert.equal(item.phase, types.SourceDiagnosticPhase.Assets, 'asset diagnostic phase');
    return { message: item.message, line: item.reportedLine === undefined ? item.span?.start.line ?? null : item.reportedLine,
      severity: item.severity, countsAsError: item.countsAsError };
  });
  function nativeAssets(source, options = {}) {
    resetParserErrorState();
    const processor = new codeMirrorFn(), parsed = processor.startState();
    const parserDiagnostics = capture(() => {
      for (const line of source.split('\n')) {
        const stream = new CodeMirror.StringStream(line, 4);
        do { processor.token(stream, parsed); } while (!stream.eol());
      }
    });
    options.afterParse?.(parsed);
    const raw = Object.entries(parsed.objects).map(([name, object]) => {
      assertVanillaFields('raw asset object', object, ['lineNumber', 'colors', 'spritematrix']);
      const colors = array('raw colors', object.colors), rows = array('raw sprite rows', object.spritematrix);
      assert.ok(colors.every(color => typeof color === 'string'), 'raw color values');
      assert.ok(rows.every(row => typeof row === 'string'), 'raw sprite row values');
      return { name, line: object.lineNumber, colors: [...colors], rows: [...rows] };
    });
    const metadata = [...parsed.metadata], metadataLines = { ...parsed.metadata_lines };
    const sites = [];
    const extraMemberDiagnostics = capture(() => generateExtraMembers(parsed), sites);
    const diagnostics = extraMemberDiagnostics.filter((_issue, index) => sites[index] >= assetStart && sites[index] < assetEnd);
    const declarationDiagnostics = extraMemberDiagnostics.filter((_issue, index) => sites[index] < assetStart || sites[index] >= assetEnd);
    options.afterObjects?.(parsed);
    const sprites = Object.entries(parsed.objects).map(([name, object]) => {
      assertVanillaFields('compiled asset object', object, ['lineNumber', 'colors', 'spritematrix', 'id', 'layer']);
      return [name, { colors: [...array('compiled colors', object.colors)], pixels: array('compiled sprite rows', object.spritematrix).map(row =>
        array('compiled pixels', row).map(pixel => {
          assert.ok(Number.isNaN(pixel) || Number.isInteger(pixel) && pixel >= -1, 'native pixel value');
          return pixel === -1 ? { kind: 'transparent' } : Number.isNaN(pixel) ? { kind: 'invalid' } : { kind: 'color', color: pixel };
        })) }];
    });
    const paletteName = Object.entries(colorPalettes).find(([, table]) => table === colorPalette)?.[0];
    assert.ok(paletteName, 'native selected palette identity');
    // Actual display boundary receives the metadata Map conversion. Other
    // twiddleMetaData conversions do not supply display color inputs.
    twiddleMetaData(parsed);
    const displayDiagnostics = capture(() => formatHomePage(parsed));
    return { parserDiagnostics, extraMemberDiagnostics, declarationDiagnostics, raw, metadata, metadataLines,
      palette: { name: paletteName, colors: [...Object.entries(colorPalette)] }, sprites, diagnostics,
      display: { backgroundColor: parsed.bgcolor, textColor: parsed.fgcolor }, displayDiagnostics };
  }
  function candidateSprites(result, declarations) {
    assert.deepEqual(Object.keys(result).sort(), ['diagnostics', 'palette', 'sprites']);
    assert.deepEqual(Object.keys(result.palette).sort(), ['colors', 'name']);
    assert.ok(result.palette.colors instanceof Map);
    assert.ok(result.sprites instanceof Map);
    assert.equal(result.sprites.size, declarations.objectSources.size, 'one appearance per authored canonical object');
    return [...result.sprites].map(([object, sprite]) => {
      assert.ok(declarations.objectSources.has(object), 'canonical authored appearance key');
      assert.notEqual(object, declarations.orphanedObject, 'no independent orphan appearance');
      assert.deepEqual(Object.keys(sprite).sort(), ['colors', 'pixels']);
      return [object.name, { colors: [...sprite.colors], pixels: sprite.pixels.map(row => row.map(pixel => {
        switch (pixel.kind) {
          case types.SpritePixelKind.Transparent: assert.deepEqual(Object.keys(pixel), ['kind']); return { kind: 'transparent' };
          case types.SpritePixelKind.Invalid: assert.deepEqual(Object.keys(pixel), ['kind']); return { kind: 'invalid' };
          case types.SpritePixelKind.Color: assert.deepEqual(Object.keys(pixel).sort(), ['color', 'kind']); return { kind: 'color', color: pixel.color };
          default: assert.fail('unknown candidate pixel kind');
        }
      })) }];
    });
  }
  function compareFixture(fixture, options = {}) {
    const native = nativeAssets(fixture.source, options);
    let document, declarations, result, display;
    independently(() => {
      ({ document } = types.readSource(fixture.source));
      ({ declarations } = types.resolveDeclarations(document));
      options.afterRead?.(document, declarations);
      freeze(document); freeze(declarations);
      const before = structuredClone({ document, declarations });
      result = (options.compileObjectSprites ?? types.compileObjectSprites)(document, declarations);
      assert.deepEqual({ document, declarations }, before, 'asset inputs unchanged');
      freeze(result.palette);
      const paletteBefore = structuredClone(result.palette);
      display = (options.compileDisplayColors ?? types.compileDisplayColors)(document, result.palette);
      assert.deepEqual(result.palette, paletteBefore, 'display palette unchanged');
    });
    const raw = [...declarations.objectSources].map(([object, source]) => ({ name: object.name,
      line: source.primaryName.span.start.line, colors: source.definitionColors.map(token => token.value),
      rows: source.definitionSpriteRows.map(row => row.map(token => token.value).join('')) }));
    const byName = values => [...values].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    assert.deepEqual(byName(raw), byName(native.raw), fixture.name + ': accepted asset tokens');
    assert.deepEqual({ name: result.palette.name, colors: [...result.palette.colors] }, native.palette, fixture.name + ': selected palette');
    assert.deepEqual(candidateSprites(result, declarations), native.sprites, fixture.name + ': object appearances');
    assert.deepEqual(diagnosticView(result.diagnostics), native.diagnostics, fixture.name + ': ordered raw object asset diagnostics');
    assert.deepEqual(Object.keys(display).sort(), ['backgroundColor', 'diagnostics', 'textColor']);
    assert.deepEqual({ backgroundColor: display.backgroundColor, textColor: display.textColor }, native.display, fixture.name + ': display colors');
    assert.deepEqual(diagnosticView(display.diagnostics), native.displayDiagnostics, fixture.name + ': ordered raw display diagnostics');
    return { native, document, declarations, result, display };
  }
  function comparePalettes() {
    assert.equal(types.colorPalettes.size, 14);
    assert.deepEqual([...types.colorPalettes].map(([name, colors]) => [name, [...colors]]),
      Object.entries(colorPalettes).map(([name, colors]) => [name, Object.entries(colors)]));
    assert.deepEqual([...types.colorPaletteAliases], Object.entries(colorPalettesAliases).map(([number, name]) => [Number(number), name]));
  }
  function nativeAssetEntry(source) {
    resetParserErrorState();
    const original = generateExtraMembers, wasCompiling = compiling;
    let entry;
    try {
      compiling = true;
      globalThis.generateExtraMembers = parsed => {
        entry = { errorCount, metadata: [...parsed.metadata], rows: Object.fromEntries(Object.entries(parsed.objects)
          .map(([name, object]) => [name, [...object.spritematrix]])), aliases: parsed.legend_synonyms
          .map(alias => ({ name: alias[0], target: alias[1], line: alias.lineNumber })) };
        return original(parsed);
      };
      loadFile(source);
    } finally { globalThis.generateExtraMembers = original; compiling = wasCompiling; }
    assert.ok(entry, 'actual loadFile reaches the asset boundary');
    return entry;
  }
  return { compareFixture, comparePalettes, independently, nativeAssets, nativeAssetEntry,
    corpusFixtures: () => testdata.map(([name, data]) => ({ name, source: data[0] })),
    compilationFixtures: () => errormessage_testdata.map(([name, data]) => ({ name, source: data[0] })) };
}
module.exports = { createSourceAssetsOracle };
