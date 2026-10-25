import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import test from "node:test"
import {createParserHarness} from "./parser-support.mjs"

await import("../../js/codemirror6/runtime/dist/codemirror6-runtime.js")
await import("../../js/codemirror6/plugins/bootstrap.js")
await import("../../js/codemirror6/plugins/symbol-info.js").catch(error => {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error
})
let api
try { api = globalThis.PuzzleScriptCM6Plugins.require("symbol-info") } catch {}
const {Text} = globalThis.PuzzleScriptCM6Runtime
const colors = new Function(await readFile(new URL("../../js/colors.js", import.meta.url), "utf8") + ";return {palettes:colorPalettes,paletteAliases:colorPalettesAliases}")()

async function index(source, options = colors) {
  assert.ok(api, "symbol-info plugin is installed")
  const harness = await createParserHarness()
  const before = harness.getErrorState()
  const result = api.buildSymbolIndex(Text.of(source.split("\n")), harness.parser, options)
  assert.deepEqual(harness.getErrorState(), before, "indexing does not change parser diagnostics")
  assert.equal(harness.diagnostics.length, 0)
  return result
}
const source = `title Example
color_palette 1

OBJECTS

Background .
black

Crate C
red transparent #abc
012..
.....
.....
.....
.....

Rock R
blue

Player P
white

LEGEND
, = Crate
Box = Crate
Heavy = Box or Rock
Pushable = Heavy or Player
FloorPair = Background and Crate
Scene = FloorPair and Player

SOUNDS
COLLISIONLAYERS
Background
Pushable
RULES
[ Crate Crate ] -> [ Crate ] (Pushable)
[ Pushable ] -> [ Pushable ] message Crate
[ Box ] -> [ Box ]
[ Scene ] -> [ Scene ]
message Crate
startloop
( Crate -> Pushable )
WINCONDITIONS
some Crate on Background
LEVELS
CP
`

test("preserves mixed case names and physical positions, including inline and punctuation aliases", async () => {
  const model = await index(source)
  const crate = model.symbols.get("crate")
  assert.equal(crate.label, "Crate")
  assert.equal(crate.kind, "object")
  assert.equal(crate.line, 9)
  assert.equal(crate.from, source.indexOf("Crate C"))
  assert.equal(crate.to, crate.from + 5)
  assert.equal(crate.definition, "Crate C")
  assert.deepEqual(crate.objects, ["crate"])
  assert.deepEqual(model.symbols.get("c").members, ["crate"])
  assert.equal(model.symbols.get("c").label, "C")
  assert.equal(model.symbols.get(",").kind, "alias")
  assert.deepEqual(model.symbols.get(",").objects, ["crate"])
  assert.equal(model.symbols.get("heavy").definition, "Heavy = Box or Rock")
})

test("keeps authored graph relationships through OR, AND, and aliases", async () => {
  const model = await index(source)
  assert.deepEqual(model.symbols.get("pushable").members, ["heavy", "player"])
  assert.deepEqual(model.symbols.get("pushable").objects, ["crate", "rock", "player"])
  assert.deepEqual(model.symbols.get("scene").members, ["floorpair", "player"])
  assert.deepEqual(model.symbols.get("scene").objects, ["background", "crate", "player"])
  const result = api.inspectSymbol(model, "CrAtE")
  assert.deepEqual(result.includedIn.map(({symbol, via}) => [symbol.name, via]), [
    ["heavy", ["box"]], ["pushable", ["heavy", "box"]],
    ["floorpair", []], ["scene", ["floorpair"]]
  ])
  assert.deepEqual(api.inspectSymbol(model, "pushable").members.map(s => s.name), ["heavy", "player"])
  assert.deepEqual(api.inspectSymbol(model, "pushable").objects.map(s => s.name), ["crate", "rock", "player"])
  assert.equal(api.inspectSymbol(model, "missing"), null)
})

test("resolves actual palette aliases, sprite indexes, defaults, and property collision layers", async () => {
  const model = await index(source)
  assert.deepEqual(model.symbols.get("crate").sprite, {
    rows: ["012..", ".....", ".....", ".....", "....."],
    colors: [colors.palettes.mastersystem.red, "transparent", "#abc"]
  })
  assert.deepEqual(model.symbols.get("rock").sprite.rows, Array(5).fill("00000"))
  assert.equal(model.symbols.get("crate").layer, 2)
  assert.equal(model.symbols.get("pushable").layer, 2)
  assert.equal(model.symbols.get("box").layer, 2)
  assert.equal(model.symbols.get("scene").layer, null)
  assert.equal((await index("OBJECTS\nCrate\nred\n")).symbols.get("crate").sprite.colors[0], colors.palettes.arnecolors.red)
  const invalid = await index("OBJECTS\nCrate\nnotacolor\n")
  assert.deepEqual(invalid.symbols.get("crate").sprite.colors, ["#ff00ff"])
})

test("collision layers retain their source declaration and expanded object names", async () => {
  const model = await index(source)
  const layer = api.inspectSymbol(model, "crate").collisionLayer
  const from = source.indexOf("\nPushable\n", source.indexOf("COLLISIONLAYERS")) + 1
  assert.ok(layer, "the layer declaration is available")
  assert.equal(layer.from, from)
  assert.equal(layer.to, from + "Pushable".length)
  assert.equal(layer.text, "Pushable")
  assert.deepEqual(layer.entities, [{name: "pushable", label: "Pushable"}])
  assert.deepEqual(layer.objects, ["crate", "rock", "player"])
  assert.equal(api.inspectSymbol(model, "Box").collisionLayer, layer)
  assert.equal(api.inspectSymbol(model, "scene").collisionLayer, null)
})

test("counts direct and indirect authored rules once and excludes comments, messages, and headings", async () => {
  const model = await index(source)
  assert.equal(model.rules.length, 4)
  assert.deepEqual(model.rules[0].names, ["crate"])
  assert.equal(model.rules[0].text, "[ Crate Crate ] -> [ Crate ] (Pushable)")
  assert.equal(model.rules[0].from, source.indexOf("[ Crate Crate ]"))
  assert.equal(model.rules[0].to, model.rules[0].from + model.rules[0].text.length)
  const detail = api.inspectSymbol(model, "crate")
  assert.deepEqual(detail.directRules, [model.rules[0]])
  assert.deepEqual(detail.indirectRules, model.rules.slice(1))
})

test("stops tokenization at LEVELS and preserves names when a draft is incomplete", async () => {
  const harness = await createParserHarness()
  let calls = 0
  const parser = {...harness.parser, token(stream, state) {
    calls++
    assert.notEqual(state.section, "levels", "map data must never be tokenized")
    return harness.parser.token(stream, state)
  }}
  assert.ok(api)
  const model = api.buildSymbolIndex(Text.of((source + "C".repeat(100000)).split("\n")), parser, colors)
  assert.ok(calls > 0)
  assert.ok(model.symbols.has("crate"))
  const draft = await index("OBJECTS\nCrate\nred\n\nLEGEND\nLoop = Loop\nBroken =\n\nRULES\n[ Crate")
  assert.ok(draft.symbols.has("crate"))
  assert.doesNotThrow(() => api.inspectSymbol(draft, "loop"))
})

test("inspector graph traversal tolerates cycles and deduplicates shared paths", async () => {
  assert.ok(api)
  const crate = {name:"crate", kind:"object", members:[], objects:["crate"]}
  const a = {name:"a", kind:"property", members:["b", "crate"], objects:["crate"]}
  const b = {name:"b", kind:"property", members:["a", "crate"], objects:["crate"]}
  const model = {symbols:new Map([["crate", crate], ["a", a], ["b", b]]), rules:[]}
  const detail = api.inspectSymbol(model, "crate")
  assert.deepEqual(detail.includedIn.map(({symbol}) => symbol.name), ["a", "b"])
})


test("aliases inherit membership and a directly mentioned property rule is excluded from indirect rules", async () => {
  const model = await index(source)
  const alias = api.inspectSymbol(model, "C")
  assert.deepEqual(alias.includedIn.map(({symbol}) => symbol.name), ["heavy", "pushable", "floorpair", "scene"])
  assert.deepEqual(alias.indirectRules, model.rules)
  const pushable = api.inspectSymbol(model, "Pushable")
  assert.deepEqual(pushable.directRules, [model.rules[1]])
  assert.deepEqual(pushable.indirectRules, [])
})

test("comment text cannot declare members, even when the comment precedes a declaration", async () => {
  const model = await index("OBJECTS\nCrate\nred\n\nRock\nblue\n\nLEGEND\n(ignored) Heavy = Crate (or Ignored) or Rock\n")
  assert.deepEqual(model.symbols.get("heavy").members, ["crate", "rock"])
  assert.deepEqual([...model.symbols.keys()], ["crate", "rock", "heavy"])
})
