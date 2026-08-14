import assert from "node:assert/strict"
import {test} from "node:test"

import {ensureSyntaxTree, syntaxTree, syntaxTreeAvailable} from "@codemirror/language"
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
    dispatches: 0,
    dispatch(spec) {
      this.dispatches++
      this.state = this.state.update(spec).state
    }
  }
}

const editSource = "alpha\nbravo\ncharlie\ndelta\necho\nfoxtrot\n"

function earliestFromA(changes) {
  let earliest = Infinity
  changes.iterChanges(fromA => { earliest = Math.min(earliest, fromA) })
  return earliest
}

function exactState(source = editSource) {
  let state = EditorState.create({doc: source, extensions: [exactPrefix]})
  state = state.update({effects: setExactPrefix.of(state.doc.length)}).state
  return state
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

test("document changes retain the exact prefix through the earliest changed line", async t => {
  const bravo = editSource.indexOf("bravo")
  const charlie = editSource.indexOf("charlie")
  const delta = editSource.indexOf("delta")
  const echo = editSource.indexOf("echo")
  const fixtures = [
    {name: "insertion", changes: {from: charlie + 2, insert: "!"}},
    {name: "deletion", changes: {from: delta + 1, to: delta + 3}},
    {name: "replacement", changes: {from: echo + 1, to: echo + 3, insert: "XX"}},
    {
      name: "deleted newline",
      changes: {from: charlie - 1, to: charlie}
    },
    {name: "inserted newline", changes: {from: delta + 2, insert: "\n"}},
    {
      name: "multiple change ranges",
      changes: [
        {from: bravo + 2, to: bravo + 3, insert: "R"},
        {from: echo + 2, insert: "!"}
      ]
    },
    {name: "edit before viewport", changes: {from: bravo + 1, insert: "!"}},
    {name: "edit after viewport", changes: {from: echo + 1, insert: "!"}}
  ]

  for (const fixture of fixtures) {
    await t.test(fixture.name, () => {
      const state = exactState()
      const transaction = state.update({changes: fixture.changes})
      const earliest = earliestFromA(transaction.changes)
      const expected = Math.min(
        state.field(exactPrefix),
        transaction.startState.doc.lineAt(earliest).from
      )
      assert.equal(transaction.state.field(exactPrefix), expected)
    })
  }
})

test("exact-prefix effects are applied after invalidation and clamped to the new document", () => {
  const state = exactState()
  const transaction = state.update({
    changes: {from: editSource.indexOf("charlie") + 2, insert: "!"},
    effects: setExactPrefix.of(Number.MAX_SAFE_INTEGER)
  })
  assert.equal(transaction.state.field(exactPrefix), transaction.state.doc.length)
})

test("an already-covered exact-prefix request dispatches no effect", async () => {
  const harness = await createParserHarness()
  const language = createPuzzleScriptLanguage(harness.parser)
  let state = EditorState.create({doc: "OBJECTS\n", extensions: [language, exactPrefix]})
  assert.ok(ensureSyntaxTree(state, state.doc.length, 1_000))
  state = state.update({effects: setExactPrefix.of(state.doc.length)}).state
  const view = mockView(state, {from: 0, to: state.doc.length})
  assert.equal(ensureExactPrefix(view, state.doc.length), true)
  assert.equal(view.dispatches, 0)
})

test("a retained prefix is not exact until the mapped syntax tree is available", async () => {
  const harness = await createParserHarness()
  const language = createPuzzleScriptLanguage(harness.parser)
  let state = EditorState.create({doc: largeSource, extensions: [language, exactPrefix]})
  assert.ok(ensureSyntaxTree(state, state.doc.length, 2_000))
  state = state.update({effects: setExactPrefix.of(state.doc.length)}).state

  const target = state.doc.length - 1
  state = state.update({changes: {from: state.doc.length, insert: "("}}).state
  assert.ok(state.field(exactPrefix) >= target)
  assert.equal(syntaxTreeAvailable(state, target), false)
  assert.ok(syntaxTree(state).length < target)
  assert.throws(() => getTokenAtPosition(state, language, target), /exact prefix/i)

  const view = mockView(state, {from: target, to: target})
  assert.equal(ensureExactPrefix(view, target, 2_000), true)
  assert.equal(view.dispatches, 1)
  assert.ok(syntaxTree(view.state).length >= target)
  assert.doesNotThrow(() => getTokenAtPosition(view.state, language, target))
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
