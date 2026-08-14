import assert from "node:assert/strict"
import {test} from "node:test"

import {ensureSyntaxTree} from "@codemirror/language"
import {EditorState} from "@codemirror/state"

import {exactPrefix, setExactPrefix} from "../../js/codemirror6/exact-prefix.js"
import {
  classifyPuzzleScriptToken,
  dispatchPuzzleScriptInteraction,
  notifyPuzzleScriptChange,
  puzzleScriptTokenAtPosition
} from "../../js/codemirror6/interactions.js"
import {createPuzzleScriptLanguage} from "../../js/codemirror6/stream-language.js"
import {createParserHarness} from "./parser-support.mjs"

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

async function exactState() {
  const harness = await createParserHarness()
  const language = createPuzzleScriptLanguage(harness.parser)
  const approximate = EditorState.create({doc: source, extensions: [language, exactPrefix]})
  assert.ok(ensureSyntaxTree(approximate, approximate.doc.length, 1_000))
  const state = approximate.update({effects: setExactPrefix.of(approximate.doc.length)}).state
  return {state, approximate, language}
}

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
