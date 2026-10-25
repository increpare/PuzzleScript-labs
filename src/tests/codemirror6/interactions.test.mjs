import assert from "node:assert/strict"
import {test} from "node:test"

import {ensureSyntaxTree, EditorState} from "./plugin-test-support.mjs"

import {exactPrefix, setExactPrefix} from "./plugin-test-support.mjs"
import {
  classifyPuzzleScriptToken,
  dispatchPuzzleScriptInteraction,
  notifyPuzzleScriptChange,
  puzzleScriptDefinitionAtPosition,
  puzzleScriptTokenAtPosition
} from "./plugin-test-support.mjs"
import {createPuzzleScriptLanguage} from "./plugin-test-support.mjs"
import {cm5TokenAt, createParserHarness} from "./parser-support.mjs"

const source = `title 123
OBJECTS
Player P
red
00000
00000
00000
00000
00000

SOUNDS
Player move up 123

COLLISIONLAYERS
Player

RULES

WINCONDITIONS

LEVELS
P
`

async function exactState(document = source) {
  const harness = await createParserHarness()
  const language = createPuzzleScriptLanguage(harness.parser)
  const approximate = EditorState.create({doc: document, extensions: [language, exactPrefix]})
  assert.ok(ensureSyntaxTree(approximate, approximate.doc.length, 1_000))
  const state = approximate.update({effects: setExactPrefix.of(approximate.doc.length)}).state
  return {state, approximate, language}
}

const definitionSource = source.replace("SOUNDS", "LEGEND\nHero = Player\n! = Player\nActors = Player or Hero\n\nSOUNDS")
  .replace("RULES\n", "RULES\n[ pLaYeR Hero Actors ! ] -> [ Player ] (Player)\n")

test("object links resolve case-insensitive names, aliases, properties and punctuation", async () => {
  const {state, language} = await exactState(definitionSource)
  assert.equal(typeof puzzleScriptDefinitionAtPosition, "function")
  for (const [reference, declaration] of [
    ["pLaYeR", "Player"], ["Hero Actors", "Hero"], ["Actors !", "Actors"], ["! ]", "!"]
  ]) {
    const position = definitionSource.indexOf(reference, definitionSource.indexOf("RULES"))
    const result = puzzleScriptDefinitionAtPosition(state, language, position)
    const from = definitionSource.indexOf(declaration, definitionSource.indexOf("OBJECTS"))
    assert.deepEqual(result, {from, to: from + declaration.length})
  }
  // The inline alias belongs to the same object declaration line.
  const inline = definitionSource.indexOf(" P\n") + 1
  assert.deepEqual(puzzleScriptDefinitionAtPosition(state, language, inline), {from: inline, to: inline + 1})
})

test("object links exclude comments, metadata, level glyphs and inexact parser state", async () => {
  const {state, language, approximate} = await exactState(definitionSource)
  assert.equal(typeof puzzleScriptDefinitionAtPosition, "function")
  for (const position of [0, definitionSource.indexOf("(Player)") + 1, definitionSource.lastIndexOf("\nP\n") + 1]) {
    assert.equal(puzzleScriptDefinitionAtPosition(state, language, position), null)
  }
  const reference = definitionSource.indexOf("pLaYeR")
  assert.equal(puzzleScriptDefinitionAtPosition(approximate, language, reference), null)
  const edited = state.update({changes: {from: 0, insert: "\n"}}).state
  assert.equal(puzzleScriptDefinitionAtPosition(edited, language, reference + 1), null)
})

test("parser checkpoints preserve declaration locations for legend names", async () => {
  const {parser, StringStream} = await createParserHarness()
  const parsed = cm5TokenAt(definitionSource, {
    line: definitionSource.split("\n").length - 1, ch: 0
  }, parser, StringStream).state
  const copy = parser.copyState(parsed)
  for (const key of ["legend_synonyms", "legend_properties", "legend_aggregates"]) {
    assert.deepEqual(copy[key].map(entry => entry.lineNumber), parsed[key].map(entry => entry.lineNumber))
  }
})

test("object links account for parser rollback on pathological long lines", async () => {
  const document = definitionSource.replace("title 123", "title " + "x".repeat(10_001))
  const {state, language} = await exactState(document)
  const from = document.indexOf("Player", document.indexOf("OBJECTS"))
  assert.deepEqual(puzzleScriptDefinitionAtPosition(state, language, document.indexOf("pLaYeR")), {
    from, to: from + "Player".length
  })
})

test("token hit testing accepts only exact parser-produced SOUND and LEVEL ranges", async () => {
  const {state, approximate} = await exactState()
  const soundStart = source.indexOf("123", source.indexOf("SOUNDS"))
  const titleNumber = source.indexOf("123")
  const levelStart = source.lastIndexOf("\nP\n") + 1

  assert.deepEqual(puzzleScriptTokenAtPosition(state, soundStart + 1), {
    from: soundStart,
    to: soundStart + 3,
    text: "123",
    style: "SOUND",
    line: state.doc.lineAt(soundStart).number - 1
  })
  assert.equal(puzzleScriptTokenAtPosition(state, titleNumber + 1)?.style === "SOUND", false)
  assert.equal(puzzleScriptTokenAtPosition(state, levelStart)?.style, "LEVEL")

  assert.equal(puzzleScriptTokenAtPosition(approximate, soundStart + 1), null)
})

test("semantic actions require exact style names and a modifier for levels", () => {
  const sound = {style: "SOUND", text: "123", line: 10}
  const level = {style: "LEVEL", text: "P", line: 21}
  assert.deepEqual(classifyPuzzleScriptToken(sound, {}), {type: "sound", seed: 123})
  assert.equal(classifyPuzzleScriptToken({...sound, style: "NOTSOUND"}, {}), null)
  assert.equal(classifyPuzzleScriptToken(level, {}), null)
  assert.deepEqual(classifyPuzzleScriptToken(level, {ctrlKey: true}), {type: "level", line: 21})
  assert.deepEqual(classifyPuzzleScriptToken(level, {metaKey: true}), {type: "level", line: 21})
})

test("interaction dispatch invokes only the intended callback", () => {
  const calls = []
  const callbacks = {
    onSound: seed => calls.push(["sound", seed]),
    onLevel: line => calls.push(["level", line])
  }
  assert.equal(dispatchPuzzleScriptInteraction({type: "sound", seed: 456}, callbacks), true)
  assert.equal(dispatchPuzzleScriptInteraction({type: "level", line: 17}, callbacks), true)
  assert.equal(dispatchPuzzleScriptInteraction(null, callbacks), false)
  assert.deepEqual(calls, [["sound", 456], ["level", 17]])
})

test("dirty-state notification runs only for document changes", () => {
  const calls = []
  const doc = {toString() { throw new Error("must not stringify") }}
  notifyPuzzleScriptChange({docChanged: false, state: {doc: "ignored"}}, value => calls.push(value))
  notifyPuzzleScriptChange({docChanged: true, state: {doc}}, value => calls.push(value))
  assert.deepEqual(calls, [doc])
})
