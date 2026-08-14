import assert from "node:assert/strict"
import {test} from "node:test"

import {EditorState} from "@codemirror/state"

import {
  ExactPrefixScheduler,
  ensureExactPrefix,
  exactPrefix,
  setExactPrefix
} from "../../js/codemirror6/exact-prefix.js"
import {createPuzzleScriptLanguage} from "../../js/codemirror6/stream-language.js"
import {getTokenAtPosition} from "../../js/codemirror6/stream-state.js"
import {distantLineText, distantPosition, largeSource} from "./fixtures/large-source.js"
import {createParserHarness} from "./parser-support.mjs"

function mockView(state, viewport) {
  return {
    state,
    viewport,
    dispatch(spec) {
      this.state = this.state.update(spec).state
    }
  }
}

test("distant parser state is unavailable until the exact prefix has been parsed", async () => {
  assert.ok(largeSource.length > 120_000)
  const harness = await createParserHarness()
  const language = createPuzzleScriptLanguage(harness.parser)
  const state = EditorState.create({doc: largeSource, extensions: [language, exactPrefix]})
  const line = state.doc.lineAt(distantPosition)
  assert.equal(line.text, distantLineText)
  const view = mockView(state, {from: line.from, to: line.to})

  assert.equal(view.state.field(exactPrefix), 0)
  assert.throws(() => getTokenAtPosition(view.state, language, distantPosition), /exact prefix/i)

  const fresh = harness.parser.startState(2)
  const freshStream = new harness.StringStream(line.text, 4)
  harness.parser.token(freshStream, fresh)
  assert.notEqual(fresh.section, "levels")

  assert.equal(ensureExactPrefix(view, line.from, 2_000), true)
  assert.ok(view.state.field(exactPrefix) >= line.from)
  assert.equal(getTokenAtPosition(view.state, language, distantPosition).state.section, "levels")

  view.dispatch({changes: {from: 0, insert: "("}})
  assert.equal(view.state.field(exactPrefix), 0)
})

test("the idle scheduler cancels its pending callback when destroyed", async () => {
  const originalRequest = globalThis.requestIdleCallback
  const originalCancel = globalThis.cancelIdleCallback
  let cancelled = null
  globalThis.requestIdleCallback = () => 73
  globalThis.cancelIdleCallback = handle => { cancelled = handle }

  try {
    const harness = await createParserHarness()
    const language = createPuzzleScriptLanguage(harness.parser)
    const state = EditorState.create({doc: "OBJECTS\n", extensions: [language, exactPrefix]})
    const scheduler = new ExactPrefixScheduler(mockView(state, {from: 0, to: state.doc.length}))
    scheduler.destroy()
    assert.equal(cancelled, 73)
  } finally {
    if (originalRequest === undefined) delete globalThis.requestIdleCallback
    else globalThis.requestIdleCallback = originalRequest
    if (originalCancel === undefined) delete globalThis.cancelIdleCallback
    else globalThis.cancelIdleCallback = originalCancel
  }
})
