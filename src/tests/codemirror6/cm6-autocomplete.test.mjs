import assert from "node:assert/strict"
import {test} from "node:test"

import {CompletionContext, insertCompletionText} from "@codemirror/autocomplete"
import {ensureSyntaxTree, syntaxTree, syntaxTreeAvailable} from "@codemirror/language"
import {EditorState} from "@codemirror/state"

import {
  puzzleScriptCompletionKeymap,
  puzzleScriptCompletionSource
} from "../../js/codemirror6/autocomplete.js"
import {exactPrefix, setExactPrefix} from "../../js/codemirror6/exact-prefix.js"
import {createPuzzleScriptLanguage} from "../../js/codemirror6/stream-language.js"
import {autocompleteCases} from "./fixtures/autocomplete-cases.js"
import {largeSource} from "./fixtures/large-source.js"
import {createAutocompleteHarness} from "./parser-support.mjs"

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
