import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {test} from "node:test"

import {
  EditorSelection,
  EditorState,
  EditorView,
  history,
  isolateHistory,
  redo,
  Text,
  undo,
  undoSelection
} from "./plugin-test-support.mjs"

import {
  createCleanDocumentTracker,
  createCM6EditorDriver
} from "./plugin-test-support.mjs"

const apiPath = new URL("../../js/editor-api.js", import.meta.url)
const shortcuts = JSON.parse(await readFile(
  new URL("./baselines/cm5/shortcuts.json", import.meta.url),
  "utf8"
))

async function loadAPI() {
  const source = await readFile(apiPath, "utf8")
  const window = {}
  new Function("window", source)(window)
  return window.PuzzleScriptEditorAPI
}

test("the application adapter exposes only semantic editor operations", async () => {
  const api = await loadAPI()
  const calls = []
  const driver = {}
  for (const method of [
    "getValue", "replaceDocument", "clearHistory", "focus", "blur",
    "replaceSelection", "revealLine", "getInputElement", "markClean", "isDirty"
  ]) {
    driver[method] = (...args) => {
      calls.push([method, ...args])
      return `${method}-result`
    }
  }

  const editor = api.createPuzzleScriptEditor(driver)
  assert.deepEqual(Object.keys(editor).sort(), [
    "blur", "clearHistory", "focus", "getInputElement", "getValue", "isDirty",
    "markClean", "replaceDocument", "replaceSelection", "revealLine", "setValue"
  ])
  assert.equal(Object.isFrozen(editor), true)
  assert.equal(editor.doc, undefined)
  assert.equal(editor.display, undefined)

  assert.equal(editor.getValue(), "getValue-result")
  assert.equal(editor.replaceDocument("source"), undefined)
  assert.equal(editor.clearHistory(), undefined)
  assert.equal(editor.focus(), undefined)
  assert.equal(editor.blur(), undefined)
  assert.equal(editor.replaceSelection("text"), undefined)
  assert.equal(editor.revealLine(7, {cursor: 3, y: "center"}), undefined)
  assert.equal(editor.getInputElement(), "getInputElement-result")
  assert.equal(editor.markClean(), undefined)
  assert.equal(editor.isDirty(), "isDirty-result")
  assert.deepEqual(calls, [
    ["getValue"], ["replaceDocument", "source"], ["clearHistory"], ["focus"],
    ["blur"], ["replaceSelection", "text"],
    ["revealLine", 7, {cursor: 3, y: "center"}], ["getInputElement"],
    ["markClean"], ["isDirty"]
  ])
})

test("setValue is a temporary compatibility alias for replaceDocument", async () => {
  const api = await loadAPI()
  const calls = []
  const editor = api.createPuzzleScriptEditor({
    replaceDocument(text) {
      calls.push(text)
      return EditorState.create({doc: text})
    }
  })

  assert.equal(editor.setValue("compatibility source"), undefined)
  assert.deepEqual(calls, ["compatibility source"])
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

test("the CM5 driver translates semantic replacement and navigation without exposing CM5", async () => {
  const api = await loadAPI()
  const calls = []
  const input = {blur: () => calls.push(["input.blur"])}
  let value = "value"
  const cm = {
    getValue: () => value,
    setValue: text => { value = text; calls.push(["setValue", text]) },
    clearHistory: () => calls.push(["clearHistory"]),
    focus: () => calls.push(["focus"]),
    getInputField: () => input,
    replaceSelection: text => calls.push(["replaceSelection", text]),
    setCursor: (line, column) => calls.push(["setCursor", line, column]),
    scrollIntoView: (position, margin) => calls.push(["scrollIntoView", position, margin]),
    lastLine: () => 14,
    getLine: line => line === 14 ? "last" : "line",
    getScrollInfo: () => ({clientHeight: 300}),
    operation(callback) {
      calls.push(["operation"])
      callback()
    }
  }
  const transitions = []
  const driver = api.createCM5EditorDriver(cm, dirty => transitions.push(dirty))

  assert.equal(driver.getValue(), "value")
  driver.replaceDocument("source")
  driver.clearHistory()
  driver.focus()
  driver.blur()
  driver.replaceSelection("text")
  driver.revealLine(99, {cursor: 99, y: "center"})
  assert.equal(driver.getInputElement(), input)
  assert.equal(driver.isDirty(), false)
  driver.documentChanged()
  assert.equal(driver.isDirty(), true)
  driver.markClean()
  assert.equal(Object.isFrozen(driver), true)
  assert.equal(driver.cm, undefined)
  assert.deepEqual(calls, [
    ["setValue", "source"], ["clearHistory"], ["focus"], ["input.blur"],
    ["replaceSelection", "text"], ["operation"], ["setCursor", 14, 4],
    ["scrollIntoView", {line: 14, ch: 4}, 150]
  ])
  assert.deepEqual(transitions, [true, false])
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

test("replaceDocument is one normal undoable CM6 dispatch with one dirty notification", () => {
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
    calls.push(["dispatch", specs])
    view.state = view.state.update(...specs).state
    tracker.documentChanged(view.state.doc)
  }

  const transitions = []
  const tracker = createCleanDocumentTracker(
    view.state.doc,
    (left, right) => left.eq(right),
    dirty => transitions.push(dirty)
  )
  const driver = createCM6EditorDriver(view, extensions, tracker)
  driver.replaceDocument("alpha\nbeta")
  assert.equal(calls.length, 1)
  assert.equal(driver.getValue(), "alpha\nbeta")
  assert.deepEqual(view.state.selection.main, EditorSelection.cursor(0))
  const replacementEffect = calls[0][1][0].effects
  assert.equal(replacementEffect.value.range.from, 0)
  assert.equal(replacementEffect.value.y, "nearest")
  assert.deepEqual(transitions, [true])
  assert.equal(undo(view), true)
  assert.equal(driver.getValue(), "initial")
  assert.deepEqual(transitions, [true, false])
})

test("replaceDocument is its own CM5-compatible history event between user edits", () => {
  const extensions = [history()]
  const view = {
    state: EditorState.create({
      doc: "initial",
      selection: EditorSelection.cursor(7),
      extensions
    })
  }
  const tracker = createCleanDocumentTracker(
    view.state.doc,
    (left, right) => left.eq(right),
    () => {}
  )
  view.dispatch = (...specs) => {
    view.state = view.state.update(...specs).state
    tracker.documentChanged(view.state.doc)
  }
  const driver = createCM6EditorDriver(view, extensions, tracker)
  const snapshot = () => ({
    value: driver.getValue(),
    selections: view.state.selection.ranges.map(range => {
      const point = position => {
        const line = view.state.doc.lineAt(position)
        return {line: line.number - 1, ch: position - line.from}
      }
      return {anchor: point(range.anchor), head: point(range.head)}
    }),
    dirty: driver.isDirty()
  })
  const type = text => {
    const position = view.state.selection.main.head
    view.dispatch({
      changes: {from: position, insert: text},
      selection: EditorSelection.cursor(position + text.length),
      userEvent: "input.type"
    })
  }

  const expected = shortcuts.pc.replaceDocumentHistory
  type("?")
  assert.deepEqual(snapshot(), expected.afterPriorUserEdit)
  driver.replaceDocument("clean")
  assert.deepEqual(snapshot(), expected.afterReplaceDocument)
  type("!")
  assert.deepEqual(snapshot(), expected.afterFollowingUserEdit)

  for (const [name, command] of [
    ["afterUndo", undo],
    ["afterSecondUndo", undo],
    ["afterRedo", redo],
    ["afterSecondRedo", redo]
  ]) {
    assert.equal(command(view), true, name)
    const actual = snapshot()
    if (name === "afterRedo") {
      assert.deepEqual(
        {value: actual.value, dirty: actual.dirty},
        {value: expected[name].value, dirty: expected[name].dirty},
        name
      )
      assert.deepEqual(expected[name].selections, [{
        anchor: {line: 0, ch: 0},
        head: {line: 0, ch: 0}
      }], "the frozen CM5 redo cursor remains documented")
      assert.deepEqual(actual.selections, [{
        anchor: {line: 0, ch: actual.value.length},
        head: {line: 0, ch: actual.value.length}
      }], "stock CM6 maps the pre-replacement cursor through the redone change")
    } else {
      assert.deepEqual(actual, expected[name], name)
    }
  }
})

test("revealLine clips line and cursor and combines selection and scrolling in one dispatch", () => {
  const calls = []
  const view = {
    state: EditorState.create({doc: "alpha\nbeta\ngamma"}),
    dispatch(spec) {
      calls.push(spec)
      this.state = this.state.update(spec).state
    }
  }
  const tracker = createCleanDocumentTracker(view.state.doc, (left, right) => left.eq(right), () => {})
  const driver = createCM6EditorDriver(view, [], tracker)

  driver.revealLine(99, {cursor: 99, y: "center"})
  assert.equal(calls.length, 1)
  assert.equal(view.state.selection.main.head, view.state.doc.length)
  assert.equal(calls[0].effects.value.range.from, view.state.doc.length)
  assert.equal(calls[0].effects.value.y, "center")

  calls.length = 0
  const selectionBefore = view.state.selection
  driver.revealLine(-99)
  assert.equal(calls.length, 1)
  assert.equal(view.state.selection, selectionBefore)
  assert.equal(calls[0].selection, undefined)
  assert.equal(calls[0].effects.value.range.from, 0)
  assert.equal(calls[0].effects.value.y, "nearest")

  calls.length = 0
  driver.revealLine(1, {cursor: 0, y: "center"})
  assert.equal(calls.length, 1)
  assert.equal(view.state.selection.main.head, 6)
  assert.equal(calls[0].effects.value.range.from, 6)
  assert.equal(calls[0].effects.value.y, "center")
})

test("programmatic revealLine cursor placement stays out of user selection history", () => {
  const extensions = [history()]
  const view = {
    state: EditorState.create({doc: "alpha\nbeta\ngamma", extensions})
  }
  view.dispatch = (...specs) => { view.state = view.state.update(...specs).state }
  const tracker = createCleanDocumentTracker(view.state.doc, (left, right) => left.eq(right), () => {})
  const driver = createCM6EditorDriver(view, extensions, tracker)

  driver.revealLine(1, {cursor: 2})
  assert.equal(view.state.selection.main.head, 8)
  assert.equal(undoSelection(view), false)
  assert.equal(view.state.selection.main.head, 8)

  view.dispatch({selection: EditorSelection.cursor(6), userEvent: "select"})
  assert.equal(undoSelection(view), true)
  assert.equal(view.state.selection.main.head, 8)
  assert.equal(undoSelection(view), false)
})

test("programmatic revealLine separates a later user edit from prior document replacement", () => {
  const extensions = [history()]
  const view = {
    state: EditorState.create({doc: "initial", extensions})
  }
  view.dispatch = (...specs) => { view.state = view.state.update(...specs).state }
  const tracker = createCleanDocumentTracker(view.state.doc, (left, right) => left.eq(right), () => {})
  const driver = createCM6EditorDriver(view, extensions, tracker)

  driver.replaceDocument("clean")
  tracker.markClean(view.state.doc)
  driver.revealLine(0, {cursor: 5})
  view.dispatch({changes: {from: 5, insert: "!"}, userEvent: "input.type"})

  assert.equal(view.state.doc.toString(), "clean!")
  assert.equal(undo(view), true)
  assert.equal(view.state.doc.toString(), "clean")
})

test("the CM6 driver keeps implementation types private", () => {
  const calls = []
  const extensions = [history()]
  const contentDOM = {blur: () => calls.push(["blur"])}
  const view = {
    state: EditorState.create({doc: "initial", extensions}),
    contentDOM,
    dispatch(...specs) { this.state = this.state.update(...specs).state },
    focus: () => calls.push(["focus"]),
    setState(state) { calls.push(["setState"]); this.state = state }
  }
  const tracker = createCleanDocumentTracker(view.state.doc, (left, right) => left.eq(right), () => {})
  const driver = createCM6EditorDriver(view, extensions, tracker)
  assert.deepEqual(Object.keys(driver).sort(), [
    "blur", "clearHistory", "focus", "getInputElement", "getValue", "isDirty",
    "markClean", "replaceDocument", "replaceSelection", "revealLine", "setValue"
  ])
  assert.equal(driver.view, undefined)

  view.dispatch({selection: {anchor: 0, head: view.state.doc.length}})
  driver.replaceSelection("replacement")
  assert.equal(driver.getValue(), "replacement")
  assert.equal(view.state.selection.main.head, 11)

  driver.replaceDocument("fresh")
  driver.clearHistory()
  assert.equal(undo(view), false)
  assert.equal(driver.getValue(), "fresh")

  driver.focus()
  driver.blur()
  assert.equal(driver.getInputElement(), contentDOM)
  driver.markClean()
  assert.equal(driver.isDirty(), false)
  assert.deepEqual(calls, [["setState"], ["focus"], ["blur"]])
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
    driver.replaceDocument("gamma\ndelta")
    driver.clearHistory()
    driver.focus()
    driver.blur()
    driver.replaceSelection("x")
    driver.revealLine(1, {cursor: 2})
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
