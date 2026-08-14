import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {test} from "node:test"

import {history, isolateHistory, redo, undo} from "@codemirror/commands"
import {EditorSelection, EditorState, Text} from "@codemirror/state"

import {
  createCleanDocumentTracker,
  createCM6EditorDriver
} from "../../js/codemirror6/editor-adapter.js"

const apiPath = new URL("../../js/editor-api.js", import.meta.url)

async function loadAPI() {
  const source = await readFile(apiPath, "utf8")
  const window = {}
  new Function("window", source)(window)
  return window.PuzzleScriptEditorAPI
}

test("the application adapter exposes only the twelve approved editor operations", async () => {
  const api = await loadAPI()
  const calls = []
  const driver = {}
  for (const method of [
    "getValue", "setValue", "clearHistory", "focus", "blur", "replaceSelection",
    "setCursor", "scrollToLine", "getLastLine", "getInputElement", "markClean",
    "isDirty"
  ]) {
    driver[method] = (...args) => {
      calls.push([method, ...args])
      return `${method}-result`
    }
  }

  const editor = api.createPuzzleScriptEditor(driver)
  assert.deepEqual(Object.keys(editor).sort(), [
    "blur", "clearHistory", "focus", "getInputElement", "getLastLine",
    "getValue", "isDirty", "markClean", "replaceSelection", "scrollToLine",
    "setCursor", "setValue"
  ])
  assert.equal(Object.isFrozen(editor), true)
  assert.equal(editor.doc, undefined)
  assert.equal(editor.display, undefined)

  assert.equal(editor.getValue(), "getValue-result")
  assert.equal(editor.setValue("source"), "setValue-result")
  assert.equal(editor.clearHistory(), "clearHistory-result")
  assert.equal(editor.focus(), "focus-result")
  assert.equal(editor.blur(), "blur-result")
  assert.equal(editor.replaceSelection("text"), "replaceSelection-result")
  assert.equal(editor.setCursor(7, 3), "setCursor-result")
  assert.equal(editor.scrollToLine(11), "scrollToLine-result")
  assert.equal(editor.getLastLine(), "getLastLine-result")
  assert.equal(editor.getInputElement(), "getInputElement-result")
  assert.equal(editor.markClean(), "markClean-result")
  assert.equal(editor.isDirty(), "isDirty-result")
  assert.deepEqual(calls, [
    ["getValue"], ["setValue", "source"], ["clearHistory"], ["focus"], ["blur"],
    ["replaceSelection", "text"], ["setCursor", 7, 3], ["scrollToLine", 11],
    ["getLastLine"], ["getInputElement"], ["markClean"], ["isDirty"]
  ])
})

test("clean document tracking emits only dirty-state transitions through undo and redo", () => {
  const transitions = []
  const extensions = [history()]
  let state = EditorState.create({doc: "alpha", extensions})
  const tracker = createCleanDocumentTracker(
    state.doc,
    (left, right) => left.eq(right),
    dirty => transitions.push(dirty)
  )
  const view = {
    get state() { return state },
    dispatch(...specs) {
      state = state.update(...specs).state
      tracker.documentChanged(state.doc)
    }
  }

  assert.equal(tracker.isDirty(), false)
  assert.equal(Object.isFrozen(tracker), true)

  view.dispatch({changes: {from: 0, to: 5, insert: "bravo"}})
  assert.equal(tracker.isDirty(), true)
  assert.deepEqual(transitions, [true])

  view.dispatch({changes: {from: 0, to: 5, insert: "charl"}})
  assert.equal(tracker.isDirty(), true)
  assert.deepEqual(transitions, [true])

  tracker.markClean(state.doc)
  assert.equal(tracker.isDirty(), false)
  assert.deepEqual(transitions, [true, false])

  view.dispatch({
    changes: {from: 0, to: 5, insert: "delta"},
    annotations: isolateHistory.of("before")
  })
  assert.equal(tracker.isDirty(), true)
  assert.equal(undo(view), true)
  assert.equal(tracker.isDirty(), false)
  assert.equal(redo(view), true)
  assert.equal(tracker.isDirty(), true)
  assert.deepEqual(transitions, [true, false, true, false, true])
})

test("the CM5 driver translates the narrow operations without exposing CM5", async () => {
  const api = await loadAPI()
  const calls = []
  const input = {blur: () => calls.push(["input.blur"])}
  const cm = {
    getValue: () => "value",
    setValue: text => calls.push(["setValue", text]),
    clearHistory: () => calls.push(["clearHistory"]),
    focus: () => calls.push(["focus"]),
    getInputField: () => input,
    replaceSelection: text => calls.push(["replaceSelection", text]),
    setCursor: (line, column) => calls.push(["setCursor", line, column]),
    scrollIntoView: position => calls.push(["scrollIntoView", position]),
    lastLine: () => 14
  }
  const transitions = []
  const driver = api.createCM5EditorDriver(cm, dirty => transitions.push(dirty))

  assert.equal(driver.getValue(), "value")
  driver.setValue("source")
  driver.clearHistory()
  driver.focus()
  driver.blur()
  driver.replaceSelection("text")
  driver.setCursor(7, 3)
  driver.scrollToLine(11)
  assert.equal(driver.getLastLine(), 14)
  assert.equal(driver.getInputElement(), input)
  assert.equal(driver.isDirty(), false)
  driver.documentChanged()
  assert.equal(driver.isDirty(), false)
  driver.markClean()
  assert.deepEqual(calls, [
    ["setValue", "source"], ["clearHistory"], ["focus"], ["input.blur"],
    ["replaceSelection", "text"], ["setCursor", 7, 3],
    ["scrollIntoView", {line: 11, ch: 0}]
  ])
  assert.deepEqual(transitions, [])
})

test("the CM5 comparison driver exposes the same clean-state transitions with strings", async () => {
  const api = await loadAPI()
  const transitions = []
  let document = "alpha"
  const driver = api.createCM5EditorDriver(
    {getValue: () => document},
    dirty => transitions.push(dirty)
  )

  assert.equal(driver.isDirty(), false)
  document = "bravo"
  driver.documentChanged()
  assert.equal(driver.isDirty(), true)
  document = "charl"
  driver.documentChanged()
  assert.deepEqual(transitions, [true])

  driver.markClean()
  assert.equal(driver.isDirty(), false)
  document = "delta"
  driver.documentChanged()
  document = "charl"
  driver.documentChanged()
  document = "delta"
  driver.documentChanged()
  assert.deepEqual(transitions, [true, false, true, false, true])
})

test("the CM6 driver preserves the captured CM5 adapter behaviour", () => {
  const calls = []
  const extensions = [history()]
  const contentDOM = {
    blur: () => calls.push(["blur"])
  }
  const view = {
    state: EditorState.create({doc: "initial", extensions}),
    contentDOM,
    dispatch: null,
    focus: () => calls.push(["focus"]),
    setState(state) {
      calls.push(["setState"])
      this.state = state
    }
  }
  view.dispatch = (...specs) => {
    view.state = view.state.update(...specs).state
  }

  const transitions = []
  const tracker = createCleanDocumentTracker(
    view.state.doc,
    (left, right) => left.eq(right),
    dirty => transitions.push(dirty)
  )
  const driver = createCM6EditorDriver(view, extensions, tracker)
  assert.deepEqual(Object.keys(driver).sort(), [
    "blur", "clearHistory", "focus", "getInputElement", "getLastLine",
    "getValue", "isDirty", "markClean", "replaceSelection", "scrollToLine",
    "setCursor", "setValue"
  ])
  assert.equal(driver.view, undefined)

  driver.setValue("alpha\nbeta")
  assert.equal(driver.getValue(), "alpha\nbeta")
  assert.deepEqual(view.state.selection.main, EditorSelection.cursor(0))

  driver.setCursor(99, 99)
  assert.equal(view.state.selection.main.head, view.state.doc.length)
  driver.setCursor(-99, -99)
  assert.equal(view.state.selection.main.head, 0)

  view.dispatch({selection: {anchor: 0, head: view.state.doc.length}})
  driver.replaceSelection("replacement")
  assert.equal(driver.getValue(), "replacement")
  assert.equal(view.state.selection.main.head, 11)

  driver.setValue("fresh")
  driver.clearHistory()
  assert.equal(undo(view), false)
  assert.equal(driver.getValue(), "fresh")

  driver.setValue("one\ntwo\nthree")
  assert.equal(driver.getLastLine(), 2)
  driver.scrollToLine(99)
  driver.focus()
  driver.blur()
  assert.equal(driver.getInputElement(), contentDOM)
  driver.markClean()
  assert.equal(driver.isDirty(), false)
  assert.deepEqual(calls, [["setState"], ["focus"], ["blur"]])
  assert.deepEqual(transitions, [])
})

test("getValue is the only CM6 driver operation that stringifies Text", () => {
  const extensions = [history()]
  const contentDOM = {blur() {}}
  const view = {
    state: EditorState.create({doc: "alpha\nbeta", extensions}),
    contentDOM,
    dispatch(...specs) {
      this.state = this.state.update(...specs).state
      tracker.documentChanged(this.state.doc)
    },
    focus() {},
    setState(state) { this.state = state }
  }
  const tracker = createCleanDocumentTracker(
    view.state.doc,
    (left, right) => left.eq(right),
    () => {}
  )
  const driver = createCM6EditorDriver(view, extensions, tracker)
  const originalToString = Text.prototype.toString
  let stringifications = 0
  Text.prototype.toString = function() {
    stringifications++
    return originalToString.call(this)
  }

  try {
    driver.setValue("gamma\ndelta")
    driver.clearHistory()
    driver.focus()
    driver.blur()
    driver.replaceSelection("x")
    driver.setCursor(1, 2)
    driver.scrollToLine(1)
    driver.getLastLine()
    driver.getInputElement()
    driver.markClean()
    driver.isDirty()
    assert.equal(stringifications, 0)

    assert.equal(driver.getValue(), "xgamma\ndelta")
    assert.equal(stringifications, 1)
  } finally {
    Text.prototype.toString = originalToString
  }
})
