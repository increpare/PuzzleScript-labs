import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {test} from "node:test"

import {history, undo} from "@codemirror/commands"
import {EditorSelection, EditorState} from "@codemirror/state"

import {createCM6EditorDriver} from "../../js/codemirror6/editor-adapter.js"

const apiPath = new URL("../../js/editor-api.js", import.meta.url)

async function loadAPI() {
  const source = await readFile(apiPath, "utf8")
  const window = {}
  new Function("window", source)(window)
  return window.PuzzleScriptEditorAPI
}

test("the application adapter exposes only the ten approved editor operations", async () => {
  const api = await loadAPI()
  const calls = []
  const driver = {}
  for (const method of [
    "getValue", "setValue", "clearHistory", "focus", "blur", "replaceSelection",
    "setCursor", "scrollToLine", "getLastLine", "getInputElement"
  ]) {
    driver[method] = (...args) => {
      calls.push([method, ...args])
      return `${method}-result`
    }
  }

  const editor = api.createPuzzleScriptEditor(driver)
  assert.deepEqual(Object.keys(editor).sort(), [
    "blur", "clearHistory", "focus", "getInputElement", "getLastLine",
    "getValue", "replaceSelection", "scrollToLine", "setCursor", "setValue"
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
  assert.deepEqual(calls, [
    ["getValue"], ["setValue", "source"], ["clearHistory"], ["focus"], ["blur"],
    ["replaceSelection", "text"], ["setCursor", 7, 3], ["scrollToLine", 11],
    ["getLastLine"], ["getInputElement"]
  ])
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
  const driver = api.createCM5EditorDriver(cm)

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
  assert.deepEqual(calls, [
    ["setValue", "source"], ["clearHistory"], ["focus"], ["input.blur"],
    ["replaceSelection", "text"], ["setCursor", 7, 3],
    ["scrollIntoView", {line: 11, ch: 0}]
  ])
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

  const driver = createCM6EditorDriver(view, extensions)
  assert.deepEqual(Object.keys(driver).sort(), [
    "blur", "clearHistory", "focus", "getInputElement", "getLastLine",
    "getValue", "replaceSelection", "scrollToLine", "setCursor", "setValue"
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
  assert.deepEqual(calls, [["setState"], ["focus"], ["blur"]])
})
