import assert from "node:assert/strict"
import {test} from "node:test"

import {EditorState, createPuzzleScriptLanguage, ensureSyntaxTree, exactPrefix, setExactPrefix} from "./plugin-test-support.mjs"
import {createParserHarness} from "./parser-support.mjs"
await import("../../js/mis/mis_sprite_painting.js")
const {spriteCatalog, pixelLine, brushIndex, brushes, selectBrush, resetBrushes} = globalThis.MISSpritePainting

const source = `title red 00000
OBJECTS
Player P
red (blue #123456) #123456
  00000
  0...0
  0.1.0
  0...0
  00000

Invisible
transparent

LEGEND
P = Player

SOUNDS

COLLISIONLAYERS
Player

RULES
(00000 red)

WINCONDITIONS

LEVELS
P
`

async function parsed(document = source) {
  const {parser} = await createParserHarness()
  let state = EditorState.create({doc: document, extensions: [
    createPuzzleScriptLanguage(parser), exactPrefix, brushes
  ]})
  assert.ok(ensureSyntaxTree(state, state.doc.length, 1000))
  return state.update({effects: setExactPrefix.of(state.doc.length)}).state
}

test("sprite brushes use exact parser ranges, skipping comments, inline aliases and gridless objects", async () => {
  const state = await parsed(), sprites = spriteCatalog(state)
  assert.equal(sprites.length, 1)
  const sprite = sprites[0]
  assert.equal(sprite.name, "player")
  assert.deepEqual(sprite.palette.map(t => state.sliceDoc(t.from, t.to)), ["red", "#123456"])
  assert.equal(sprite.pixels.length, 25)
  assert.deepEqual(sprite.pixels.map(t => state.sliceDoc(t.from, t.to)).join(""), "000000...00.1.00...000000")
  assert.deepEqual(sprite.pixels[24], {
    kind: "pixel", name: "player", from: source.indexOf("  00000\n\n") + 6,
    to: source.indexOf("  00000\n\n") + 7, row: 4, column: 4
  })
  const stale = state.update({changes: {from: 0, insert: "\n"}}).state
  assert.deepEqual(spriteCatalog(stale), [])
})

test("each sprite has its own brush and a removed palette entry falls back to colour zero", async () => {
  const state = await parsed(), sprite = spriteCatalog(state)[0]
  const selectedState = state.update({effects: selectBrush.of({name: "player", index: 1})}).state
  const selected = selectedState.field(brushes)
  assert.equal(brushIndex(sprite, selected), 1)
  assert.equal(brushIndex({...sprite, name: "other"}, selected), 0)
  assert.equal(brushIndex({...sprite, palette: sprite.palette.slice(0, 1)}, selected), 0)
  assert.equal(selectedState.update({effects: resetBrushes.of(true)}).state.field(brushes).size, 0)
})

test("fast brush motion interpolates in either direction without missing cells", () => {
  assert.deepEqual(pixelLine({row: 1, column: 0}, {row: 1, column: 4}), [0, 1, 2, 3, 4].map(column => ({row: 1, column})))
  assert.deepEqual(pixelLine({row: 4, column: 4}, {row: 0, column: 0}), [4, 3, 2, 1, 0].map(n => ({row: n, column: n})))
})
