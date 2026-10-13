import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {test} from "node:test"

import {CompletionContext, insertCompletionText} from "@codemirror/autocomplete"
import {
  EditorState,
  ensureSyntaxTree,
  syntaxTree,
  syntaxTreeAvailable,
  Transaction
} from "./plugin-test-support.mjs"

import * as autocompleteModule from "./plugin-test-support.mjs"
import {exactPrefix, setExactPrefix} from "./plugin-test-support.mjs"
import {createPuzzleScriptLanguage} from "./plugin-test-support.mjs"
import {autocompleteCases} from "./fixtures/autocomplete-cases.js"
import {largeSource} from "./fixtures/large-source.js"
import {createAutocompleteHarness} from "./parser-support.mjs"

const {
  createPuzzleScriptAutocompleteActivationCleanup,
  createPuzzleScriptAutocompleteActivationController,
  puzzleScriptCompletionKeymap,
  puzzleScriptCompletionSource
} = autocompleteModule

const excludedKeyCodes = Object.freeze({
  "186": "semicolon",
  "191": "slash"
})

function controlledScheduler() {
  let nextId = 0
  const callbacks = new Map()
  return {
    schedule(callback) {
      const id = ++nextId
      callbacks.set(id, callback)
      return id
    },
    cancel(id) {
      callbacks.delete(id)
    },
    flush() {
      for (const [id, callback] of [...callbacks]) {
        callbacks.delete(id)
        callback()
      }
    },
    get size() {
      return callbacks.size
    }
  }
}

function activationFixture() {
  assert.equal(typeof createPuzzleScriptAutocompleteActivationController, "function")
  const scheduler = controlledScheduler()
  const starts = []
  const controller = createPuzzleScriptAutocompleteActivationController({
    excludedKeyCodes,
    start: view => starts.push(view),
    schedule: callback => scheduler.schedule(callback),
    cancel: id => scheduler.cancel(id)
  })
  return {controller, scheduler, starts, view: {name: "view"}}
}

function userTransaction(state, userEvent, changes) {
  return state.update({
    changes,
    annotations: Transaction.userEvent.of(userEvent)
  })
}

async function exactState(source, language) {
  let state = EditorState.create({doc: source, extensions: [language, exactPrefix]})
  assert.ok(ensureSyntaxTree(state, state.doc.length, 1_000))
  state = state.update({effects: setExactPrefix.of(state.doc.length)}).state
  return state
}

function expectedAppliedSource(fixture, from, to, text) {
  return fixture.source.slice(0, from) + text + fixture.source.slice(to)
}

test("the CM6 source preserves every captured CM5 completion", async t => {
  const harness = await createAutocompleteHarness()
  const language = createPuzzleScriptLanguage(harness.parser)
  const source = puzzleScriptCompletionSource({language, complete: harness.autocomplete.complete})

  for (const fixture of autocompleteCases) {
    await t.test(fixture.name, async () => {
      const state = await exactState(fixture.source, language)
      const line = state.doc.line(fixture.cursor.line + 1)
      const position = line.from + fixture.cursor.ch
      const actual = await source(new CompletionContext(state, position, false))

      if (fixture.expected.list.length === 0) {
        assert.ok(actual === null || actual.options.length === 0)
        return
      }

      assert.ok(actual)
      assert.equal(actual.from, line.from + fixture.expected.from.ch)
      assert.equal(actual.to, line.from + fixture.expected.to.ch)
      assert.equal(actual.filter, false)
      assert.deepEqual(
        actual.options.map(({label, psExtra, psTag, type, apply, displayLabel}) => ({
          label, psExtra, psTag, type, apply, displayLabel
        })),
        fixture.expected.list.map(item => ({
          label: item.text,
          psExtra: item.extra || "",
          psTag: item.tag || null,
          type: item.tag || undefined,
          apply: item.text,
          displayLabel: ""
        }))
      )

      const first = actual.options[0]
      const transaction = insertCompletionText(state, first.apply, actual.from, actual.to)
      const applied = state.update(transaction).state.doc.toString()
      assert.equal(applied, expectedAppliedSource(fixture, actual.from, actual.to, first.apply))
    })
  }
})

test("the CM6 source refuses unavailable exact state instead of guessing", async () => {
  const harness = await createAutocompleteHarness()
  const language = createPuzzleScriptLanguage(harness.parser)
  const state = EditorState.create({doc: "title ti", extensions: [language, exactPrefix]})
  const source = puzzleScriptCompletionSource({language, complete: harness.autocomplete.complete})

  assert.equal(await source(new CompletionContext(state, state.doc.length, false)), null)
})

test("completion never trusts a retained prefix without an available syntax tree", async () => {
  const harness = await createAutocompleteHarness()
  const language = createPuzzleScriptLanguage(harness.parser)
  const lastLevelStart = largeSource.lastIndexOf("\n", largeSource.length - 2) + 1
  const completionSource = largeSource.slice(0, lastLevelStart) + "mes\n"
  const position = completionSource.length - 1
  let state = await exactState(completionSource, language)
  state = state.update({changes: {from: state.doc.length, insert: "("}}).state
  assert.ok(state.field(exactPrefix) >= position)
  assert.equal(syntaxTreeAvailable(state, position), false)

  const source = puzzleScriptCompletionSource({language, complete: harness.autocomplete.complete})
  assert.equal(await source(new CompletionContext(state, position, false)), null)

  const view = {
    state,
    dispatches: 0,
    dispatch(spec) {
      this.dispatches++
      this.state = this.state.update(spec).state
    }
  }
  const result = await source(new CompletionContext(view.state, position, false, view))
  assert.ok(result)
  assert.equal(result.options[0].label, "message")
  assert.equal(view.dispatches, 1)
  assert.ok(syntaxTree(view.state).length >= position)
})

test("native typing activation uses the public zero-delay configuration", async () => {
  const implementation = await readFile(
    new URL("../../js/codemirror6/plugins/autocomplete.js", import.meta.url),
    "utf8"
  )
  assert.match(implementation, /activateOnTyping:\s*true/)
  assert.match(implementation, /activateOnTypingDelay:\s*0/)
  assert.doesNotMatch(implementation, /activateOnTyping:\s*false/)
})

test("the activation controller has the frozen public shape", () => {
  const {controller} = activationFixture()
  assert.equal(Object.isFrozen(controller), true)
  assert.deepEqual(Object.keys(controller), [
    "keydown",
    "observeTransactions",
    "keyup",
    "allows",
    "destroy"
  ])
})

test("eligible input.type allows its exact document and suppresses keyup fallback", () => {
  const {controller, scheduler, starts, view} = activationFixture()
  const state = EditorState.create({doc: "ti"})
  controller.keydown({keyCode: 84, which: 0})
  const transaction = userTransaction(state, "input.type", {from: 2, insert: "t"})

  controller.observeTransactions([transaction], transaction.newDoc)
  controller.keyup(null, view)
  controller.keyup({keyCode: 84, which: 0}, view)
  scheduler.flush()

  assert.equal(controller.allows(transaction.newDoc), true)
  assert.equal(controller.allows(state.doc), false)
  assert.deepEqual(starts, [])
})

test("keyup without an approved transaction never authorizes completion", async t => {
  const cases = [
    {
      name: "navigation without an edit",
      state: EditorState.create({doc: "ti"}),
      keydowns: [{keyCode: 40, which: 0}],
      keyups: [{keyCode: 40, which: 0}]
    },
    {
      name: "ordinary keydown without a transaction",
      state: EditorState.create({doc: "ti"}),
      keydowns: [{keyCode: 190, which: 0}],
      keyups: [{keyCode: 190, which: 0}]
    },
    {
      name: "constructed key with code zero",
      state: EditorState.create({doc: "ti"}),
      keydowns: [{keyCode: 0, which: 0}],
      keyups: [{keyCode: 0, which: 0}]
    },
    {
      name: "constructed key with missing codes",
      state: EditorState.create({doc: "ti"}),
      keydowns: [{}],
      keyups: [{}]
    }
  ]

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const {controller, scheduler, starts, view} = activationFixture()
      view.state = fixture.state
      for (const event of fixture.keydowns) controller.keydown(event)
      for (const event of fixture.keyups) controller.keyup(event, view)
      scheduler.flush()

      assert.equal(controller.allows(fixture.state.doc), false)
      assert.deepEqual(starts, [])
    })
  }
})

test("API edits followed by keyup do not authorize explicit completion", () => {
  const {controller, scheduler, starts, view} = activationFixture()
  const state = EditorState.create({doc: "r"})
  controller.keydown({keyCode: 73, which: 0})
  const edit = state.update({changes: {from: 1, insert: "i"}})
  view.state = edit.state

  controller.observeTransactions([edit], edit.newDoc)
  controller.keyup({keyCode: 73, which: 0}, view)
  scheduler.flush()

  assert.equal(controller.allows(edit.newDoc), false)
  assert.deepEqual(starts, [])
})

test("an excluded key blocks native completion for its resulting document", () => {
  const {controller, scheduler, starts, view} = activationFixture()
  const state = EditorState.create({doc: "title"})
  controller.keydown({keyCode: 186, which: 0})
  const transaction = userTransaction(state, "input.type", {from: 5, insert: ";"})

  controller.observeTransactions([transaction], transaction.newDoc)
  controller.keyup({keyCode: 186, which: 0}, view)
  scheduler.flush()

  assert.equal(controller.allows(transaction.newDoc), false)
  assert.deepEqual(starts, [])
})

test("releasing Shift after excluded Shift+Slash typing preserves the denial", () => {
  const {controller, scheduler, starts, view} = activationFixture()
  const state = EditorState.create({doc: "ti"})
  controller.keydown({keyCode: 16, which: 0})
  controller.keydown({keyCode: 191, which: 0})
  const transaction = userTransaction(state, "input.type", {from: 2, insert: "/"})
  view.state = transaction.state

  controller.observeTransactions([transaction], transaction.newDoc)
  controller.keyup({keyCode: 191, which: 0}, view)
  controller.keyup({keyCode: 16, which: 0}, view)
  scheduler.flush()

  assert.equal(controller.allows(transaction.newDoc), false)
  assert.deepEqual(starts, [])
})

test("missing conventional key codes, composition, and IME typing are eligible", async t => {
  const cases = [
    {name: "no keydown", keydown: null},
    {name: "missing key code", keydown: {keyCode: 0, which: 0}},
    {name: "composition key", keydown: {keyCode: 229, which: 0, isComposing: true}},
    {name: "IME input", keydown: {which: 229, isComposing: true}}
  ]
  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const {controller, scheduler, starts, view} = activationFixture()
      const state = EditorState.create({doc: "tit"})
      if (fixture.keydown) controller.keydown(fixture.keydown)
      const transaction = userTransaction(state, "input.type", {from: 3, insert: "l"})
      controller.observeTransactions([transaction], transaction.newDoc)
      controller.keyup(fixture.keydown, view)
      scheduler.flush()
      assert.equal(controller.allows(transaction.newDoc), true)
      assert.deepEqual(starts, [])
    })
  }
})

test("delete, paste, and cut modes coalesce to one explicit fallback", async t => {
  const cases = [
    {
      name: "Backspace",
      event: "delete.backward",
      keydown: {keyCode: 8, which: 0},
      source: "ti",
      changes: {from: 1, to: 2}
    },
    {
      name: "Delete",
      event: "delete.forward",
      keydown: {keyCode: 46, which: 0},
      source: "ti",
      changes: {from: 1, to: 2}
    },
    {
      name: "keyboard paste",
      event: "input.paste",
      keydown: {keyCode: 86, which: 0},
      source: "ti",
      changes: {from: 2, insert: "t"}
    },
    {
      name: "keyboard cut",
      event: "delete.cut",
      keydown: {keyCode: 88, which: 0},
      source: "tit",
      changes: {from: 2, to: 3}
    },
    {
      name: "direct paste",
      event: "input.paste",
      keydown: null,
      source: "ti",
      changes: {from: 2, insert: "t"}
    },
    {
      name: "direct cut",
      event: "delete.cut",
      keydown: null,
      source: "tit",
      changes: {from: 2, to: 3}
    }
  ]

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const {controller, scheduler, starts, view} = activationFixture()
      const state = EditorState.create({doc: fixture.source})
      if (fixture.keydown) controller.keydown(fixture.keydown)
      const transaction = userTransaction(state, fixture.event, fixture.changes)
      view.state = transaction.state
      controller.observeTransactions([transaction], transaction.newDoc)

      // The update listener handles direct operations; a later DOM keyup must not duplicate it.
      controller.keyup(null, view)
      controller.keyup(fixture.keydown, view)
      controller.keyup(fixture.keydown, view)
      assert.equal(scheduler.size, 1)
      scheduler.flush()

      assert.equal(controller.allows(transaction.newDoc), true)
      assert.deepEqual(starts, [view])
    })
  }
})

test("native typing cancels a queued fallback and destroy cancels pending work", () => {
  const fallback = activationFixture()
  const state = EditorState.create({doc: "ti"})
  fallback.controller.keydown({keyCode: 8, which: 0})
  const deletion = userTransaction(state, "delete.backward", {from: 1, to: 2})
  fallback.controller.observeTransactions([deletion], deletion.newDoc)
  fallback.controller.keyup(null, fallback.view)
  assert.equal(fallback.scheduler.size, 1)

  fallback.controller.keydown({keyCode: 84, which: 0})
  const typing = userTransaction(deletion.state, "input.type", {from: 1, insert: "t"})
  fallback.controller.observeTransactions([typing], typing.newDoc)
  assert.equal(fallback.scheduler.size, 0)
  fallback.scheduler.flush()
  assert.deepEqual(fallback.starts, [])
  assert.equal(fallback.controller.allows(deletion.newDoc), false)
  assert.equal(fallback.controller.allows(typing.newDoc), true)

  const destroyed = activationFixture()
  destroyed.controller.keydown({keyCode: 46, which: 0})
  const forward = userTransaction(state, "delete.forward", {from: 1, to: 2})
  destroyed.controller.observeTransactions([forward], forward.newDoc)
  destroyed.controller.keyup(null, destroyed.view)
  destroyed.controller.destroy()
  assert.equal(destroyed.scheduler.size, 0)
  destroyed.scheduler.flush()
  assert.deepEqual(destroyed.starts, [])
  assert.equal(destroyed.controller.allows(forward.newDoc), false)
})

test("activation cleanup survives setState plugin recreation but destroys the final view", async () => {
  assert.equal(typeof createPuzzleScriptAutocompleteActivationCleanup, "function")
  const fixture = activationFixture()
  const state = EditorState.create({doc: "ti"})
  fixture.controller.keydown({keyCode: 8, which: 0})
  const deletion = userTransaction(state, "delete.backward", {from: 1, to: 2})
  fixture.controller.observeTransactions([deletion], deletion.newDoc)
  fixture.controller.keyup(null, fixture.view)
  assert.equal(fixture.scheduler.size, 1)

  const cleanup = createPuzzleScriptAutocompleteActivationCleanup(fixture.controller)
  const oldPlugin = cleanup.create()
  oldPlugin.destroy()
  const replacementPlugin = cleanup.create()
  await Promise.resolve()

  assert.equal(fixture.controller.allows(deletion.newDoc), true)
  assert.equal(fixture.scheduler.size, 1)

  replacementPlugin.destroy()
  await Promise.resolve()

  assert.equal(fixture.controller.allows(deletion.newDoc), false)
  assert.equal(fixture.scheduler.size, 0)
  fixture.scheduler.flush()
  assert.deepEqual(fixture.starts, [])
})

test("rapid eligible typing supersedes blocked and obsolete documents", () => {
  const {controller, scheduler, starts, view} = activationFixture()
  const state = EditorState.create({doc: "title"})

  controller.keydown({keyCode: 186, which: 0})
  const blocked = userTransaction(state, "input.type", {from: 5, insert: ";"})
  controller.observeTransactions([blocked], blocked.newDoc)
  assert.equal(controller.allows(blocked.newDoc), false)

  controller.keydown({keyCode: 84, which: 0})
  const current = userTransaction(blocked.state, "input.type", {from: 6, insert: "t"})
  controller.observeTransactions([current], current.newDoc)
  controller.keyup({keyCode: 84, which: 0}, view)
  scheduler.flush()

  assert.equal(controller.allows(state.doc), false)
  assert.equal(controller.allows(blocked.newDoc), false)
  assert.equal(controller.allows(current.newDoc), true)
  assert.deepEqual(starts, [])
})

test("the completion source rejects a document denied by activation policy", async () => {
  const harness = await createAutocompleteHarness()
  const language = createPuzzleScriptLanguage(harness.parser)
  const state = await exactState("title ti", language)
  let completionCalls = 0
  const source = puzzleScriptCompletionSource({
    language,
    allows: () => false,
    complete: input => {
      completionCalls++
      return harness.autocomplete.complete(input)
    }
  })

  assert.equal(await source(new CompletionContext(state, state.doc.length, false)), null)
  assert.equal(completionCalls, 0)
})

test("the completion keymap contains only the captured CM5 popup bindings", () => {
  assert.deepEqual(
    puzzleScriptCompletionKeymap.map(binding => binding.key || binding.mac),
    ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", "Enter", "Tab", "Escape", "Ctrl-p", "Ctrl-n"]
  )
  assert.equal(puzzleScriptCompletionKeymap.some(binding => binding.key === "Ctrl-Space"), false)

  const inactiveView = {
    state: EditorState.create(),
    dispatch() {
      throw new Error("an inactive completion command must not dispatch")
    }
  }
  for (const binding of puzzleScriptCompletionKeymap) {
    assert.equal(binding.run(inactiveView), false, `${binding.key} must fall through when the popup is closed`)
  }
})
