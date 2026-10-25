#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const canonicalizer = require('../canonicalize');
const nodeAnalysis = require('./ps_static_analysis');
const nodeDecanonicalizer = require('../decanonicalize');

// A browser CommonJS loader must only need JavaScript sources, with no Node
// builtins, filesystem, process or crypto available inside the loaded modules.
function loadPortable(relativePath, cache = new Map()) {
    const filename = path.resolve(__dirname, relativePath);
    assert.ok(fs.existsSync(filename), `portable module exists: ${relativePath}`);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const context = vm.createContext({ module, exports: module.exports, require(specifier) {
        assert.ok(specifier.startsWith('.'), `portable require is relative: ${specifier}`);
        const dependency = path.resolve(path.dirname(filename), specifier);
        return loadPortable(dependency.endsWith('.js') ? dependency : `${dependency}.js`, cache);
    } });
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    return module.exports;
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }

const portableCanonicalizerModule = loadPortable('../js/canonicalize_core.js');
assert.strictEqual(typeof portableCanonicalizerModule.createCanonicalizer, 'function');
const portableCanonicalizer = portableCanonicalizerModule.createCanonicalizer();
const portableAnalysis = loadPortable('../js/static_analysis.js');
const portableDecanonicalizer = loadPortable('../js/decanonicalize_core.js');

const source = `title Portable semantics

objects

Background
black

Player
blue

Mark
red

Decor
yellow

legend

. = Background
P = Player
M = Mark
D = Decor

sounds

collisionlayers

Background
Player
Mark
Decor

rules

[ action Player ] -> [ Player Mark ]
late [ Mark ] -> [ ]

winconditions

no Player

levels

P.
`;
const compiled = canonicalizer.compileSemanticSource(source);
const semantic = portableCanonicalizer.canonicalizeSemanticStateWithObjectMap(compiled.state);
assert.deepStrictEqual(plain(semantic.canonical), plain(canonicalizer.canonicalizeSource(source, 'semantic')));
assert.deepStrictEqual(plain(Array.from(semantic.objectMap)), plain(Array.from(canonicalizer.canonicalizeSemanticWithObjectMap(source).objectMap)));

const uncollapsed = portableCanonicalizer.canonicalizeSemanticStateWithObjectMap(compiled.state, { collapseEquivalentObjects: false });
assert.strictEqual(uncollapsed.objectMap.size, Object.keys(compiled.state.objects).length);
assert.ok(Array.from(uncollapsed.objectMap.values()).every(Boolean), 'uncollapsed map retains every declared object');
assert.strictEqual(new Set(uncollapsed.objectMap.values()).size, uncollapsed.objectMap.size, 'uncollapsed map is one-to-one');
for (const object of Object.keys(compiled.state.objects)) {
    const layer = compiled.state.objects[object].layer;
    assert.ok(uncollapsed.canonical.collisionLayers[layer].includes(uncollapsed.objectMap.get(object)));
}
assert.strictEqual(uncollapsed.displayNames.get('mark'), 'Mark');
assert.deepStrictEqual(plain(uncollapsed.canonical), plain(canonicalizer.canonicalizeSource(source, 'semantic', { collapseEquivalentObjects: false })));

assert.strictEqual(portableDecanonicalizer.decanonicalizeSemantic(semantic.canonical), nodeDecanonicalizer.decanonicalizeSemantic(semantic.canonical));
const familyFilter = ['mergeability', 'movement_action', 'win_relevance'];
const report = portableAnalysis.analyzeCompiledState(compiled.state, { familyFilter });
assert.deepStrictEqual(plain(report), plain(nodeAnalysis.analyzeSource(source, { familyFilter })));
const arbitrary = portableAnalysis.analyzeCompiledState(compiled.state, { arbitraryBoards: true, familyFilter });
assert.ok(arbitrary.ps_tagged.objects.every(object => object.tags.present_in_all_levels && !object.tags.present_in_no_levels));
assert.deepStrictEqual(plain(arbitrary.ps_tagged.levels[0].objects_present), ['Background', 'Decor', 'Mark', 'Player']);
assert.ok(arbitrary.ps_tagged.objects.find(object => object.name === 'Mark').tags.present_in_all_levels);
const noLevelFacts = portableAnalysis.analyzeCompiledState(compiled.state, { arbitraryBoards: true });
assert.deepStrictEqual(plain(noLevelFacts.facts.per_level_object_universe), [], 'arbitrary-board reports do not emit authored-level facts');
assert.ok(!Object.prototype.hasOwnProperty.call(noLevelFacts.ps_tagged.levels[0].tags, 'reachable_objects'));
assert.ok(!nodeAnalysis.analyzeSource(source).ps_tagged.objects.find(object => object.name === 'Mark').tags.present_in_all_levels, 'Node default retains authored-level analysis');
const withoutTagged = portableAnalysis.analyzeCompiledState(compiled.state, { includePsTagged: false, includeSourceText: true, sourceText: source });
assert.ok(!Object.prototype.hasOwnProperty.call(withoutTagged, 'ps_tagged'));
assert.strictEqual(withoutTagged.source.text, source);

assert.strictEqual(typeof loadPortable('../js/semantic_compile.js').psCompileSemantic, 'function');
const semanticCompileSource = fs.readFileSync(path.join(__dirname, '../js/semantic_compile.js'), 'utf8');
canonicalizer.evalInRuntime(semanticCompileSource, 'semantic_compile.js');
const sharedCompiled = canonicalizer.evalInRuntime(`psCompileSemantic(${JSON.stringify(source)})`);
assert.strictEqual(sharedCompiled.errorCount, 0);
assert.deepStrictEqual(plain(portableCanonicalizer.canonicalizeSemanticStateWithObjectMap(sharedCompiled.state).canonical), plain(semantic.canonical));

for (const filename of ['notsnake.txt', 'blockfaker.txt']) {
    const demo = fs.readFileSync(path.join(__dirname, '../demo', filename), 'utf8');
    const state = canonicalizer.compileSemanticSource(demo).state;
    const result = portableCanonicalizer.canonicalizeSemanticStateWithObjectMap(state);
    assert.deepStrictEqual(plain(result.canonical), plain(canonicalizer.canonicalizeSource(demo, 'semantic')), `${filename}: browser canonical parity`);
    assert.strictEqual(portableDecanonicalizer.decanonicalizeSemantic(result.canonical), nodeDecanonicalizer.decanonicalizeSemantic(result.canonical));
}
console.log('Portable semantic compiler, canonicalizer, decanonicalizer and analyzer parity tests passed.');
