import assert from "node:assert/strict"
import {test} from "node:test"

import {ensureSyntaxTree, syntaxTree, syntaxTreeAvailable} from "@codemirror/language"
import {EditorState} from "@codemirror/state"
import {Decoration} from "@codemirror/view"

import {styleFromHexCode} from "../../js/codemirror6/dynamic-colors.js"
import {ensureExactPrefix, exactPrefix, setExactPrefix} from "../../js/codemirror6/exact-prefix.js"
import {createPuzzleScriptLanguage} from "../../js/codemirror6/stream-language.js"
import {
  buildTokenDecorations,
  classesForStyle,
  dynamicHexForStyle,
  presentationClasses,
  updateTokenDecorations
} from "../../js/codemirror6/token-presentation.js"
import {distantPosition, largeSource} from "./fixtures/large-source.js"
import {createParserHarness} from "./parser-support.mjs"

function collectMarks(decorations) {
  const marks = []
  decorations.between(0, 1_000_000, (from, to, value) => {
    marks.push({from, to, class: value.spec.class, attributes: value.spec.attributes})
  })
  return marks
}

test("PuzzleScript style strings map to exact legacy classes and dynamic colours", () => {
  assert.deepEqual(classesForStyle("COLOR BOLDCOLOR COLOR-RED"),
    ["cm-COLOR", "cm-BOLDCOLOR", "cm-COLOR-RED"])
  assert.equal(dynamicHexForStyle("MULTICOLOR#Ff00aA"), "#Ff00aA")
  assert.equal(dynamicHexForStyle("COLOR COLOR-#123"), "#123")
  assert.deepEqual(presentationClasses("MULTICOLOR#Ff00aA"), ["cm-COLOR"])
  assert.deepEqual(presentationClasses("COLOR COLOR-#123"), ["cm-COLOR", "cm-COLOR-#123"])
  assert.equal(dynamicHexForStyle("NAME"), null)
  assert.equal(styleFromHexCode("#000"), "color: hsl(0,0%,34%)")
  assert.equal(styleFromHexCode("#123"), "color: hsl(210,50%,34%)")
  assert.equal(styleFromHexCode("#Ff00aA"), "color:#Ff00aA")
})

test("token decorations refuse an approximate viewport", async () => {
  const harness = await createParserHarness()
  const language = createPuzzleScriptLanguage(harness.parser)
  const state = EditorState.create({
    doc: "OBJECTS\nPlayer\n#Ff00aA\n00000\n",
    extensions: [language, exactPrefix]
  })
  const view = {state, visibleRanges: [{from: 0, to: state.doc.length}]}
  assert.strictEqual(buildTokenDecorations(view), Decoration.none)
})

test("token decorations come from decoded tree nodes and preserve dynamic-colour forms", async () => {
  const harness = await createParserHarness()
  const language = createPuzzleScriptLanguage(harness.parser)
  let state = EditorState.create({
    doc: "OBJECTS\nPlayer\n#Ff00aA\n00000\n",
    extensions: [language, exactPrefix]
  })
  assert.ok(ensureSyntaxTree(state, state.doc.length, 1_000))
  state = state.update({effects: setExactPrefix.of(state.doc.length)}).state

  const marks = collectMarks(buildTokenDecorations({
    state,
    visibleRanges: [{from: 0, to: state.doc.length}]
  }))
  const multilineColour = marks.find(mark => mark.class === "cm-COLOR")
  const spriteColour = marks.find(mark => mark.class.includes("cm-BOLDCOLOR"))

  assert.ok(multilineColour)
  assert.match(multilineColour.attributes.style, /^color:/)
  assert.ok(spriteColour)
  assert.match(spriteColour.class, /cm-COLOR-#FF00AA/)
  assert.match(spriteColour.attributes.style, /^color:/)
})

test("document edits retain mapped exact decorations until the replacement tree is exact", async () => {
  const harness = await createParserHarness()
  const language = createPuzzleScriptLanguage(harness.parser)
  let state = EditorState.create({
    doc: "OBJECTS\nPlayer\n#Ff00aA\n00000\n",
    extensions: [language, exactPrefix]
  })
  assert.ok(ensureSyntaxTree(state, state.doc.length, 1_000))
  state = state.update({effects: setExactPrefix.of(state.doc.length)}).state

  const visibleRanges = [{from: 0, to: state.doc.length}]
  const previous = buildTokenDecorations({state, visibleRanges})
  const transaction = state.update({changes: {from: 15, insert: "x"}})
  assert.equal(
    transaction.state.field(exactPrefix),
    transaction.startState.doc.lineAt(15).from
  )

  const retained = updateTokenDecorations({
    view: {
      state: transaction.state,
      visibleRanges: [{from: 0, to: transaction.state.doc.length}]
    },
    docChanged: true,
    changes: transaction.changes
  }, previous)

  assert.notStrictEqual(retained, Decoration.none)
  assert.ok(collectMarks(retained).length > 0)
})

test("a retained prefix cannot rebuild decorations from an unavailable mapped tree", async () => {
  const harness = await createParserHarness()
  const language = createPuzzleScriptLanguage(harness.parser)
  let state = EditorState.create({
    doc: largeSource,
    extensions: [language, exactPrefix]
  })
  assert.ok(ensureSyntaxTree(state, state.doc.length, 2_000))
  state = state.update({effects: setExactPrefix.of(state.doc.length)}).state

  const line = state.doc.lineAt(distantPosition)
  const visibleRanges = [{from: line.from, to: line.to}]
  const previous = buildTokenDecorations({state, visibleRanges})
  assert.ok(collectMarks(previous).length > 0)

  const transaction = state.update({changes: {from: state.doc.length, insert: "("}})
  assert.ok(transaction.state.field(exactPrefix) >= line.to)
  assert.equal(syntaxTreeAvailable(transaction.state, line.to), false)
  const view = {state: transaction.state, visibleRanges}
  assert.strictEqual(buildTokenDecorations(view), Decoration.none)

  const retained = updateTokenDecorations({
    view,
    docChanged: true,
    changes: transaction.changes
  }, previous)
  assert.deepEqual(collectMarks(retained), collectMarks(previous.map(transaction.changes)))
  assert.equal(collectMarks(retained).length, 80)

  view.dispatches = 0
  view.dispatch = spec => {
    view.dispatches++
    view.state = view.state.update(spec).state
  }
  assert.equal(ensureExactPrefix(view, line.to, 2_000), true)
  assert.equal(view.dispatches, 1)
  assert.ok(syntaxTree(view.state).length >= line.to)

  const rebuilt = updateTokenDecorations({view, docChanged: false}, retained)
  assert.equal(collectMarks(rebuilt).length, 80)
})
