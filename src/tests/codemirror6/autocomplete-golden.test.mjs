import assert from "node:assert/strict"
import {test} from "node:test"

import {autocompleteCases} from "./fixtures/autocomplete-cases.js"
import {cm5TokenAt, createAutocompleteHarness, runCm5AutocompleteCase} from "./parser-support.mjs"

test("the pure autocomplete API is DOM-free and preserves the stable result shape", async () => {
  const harness = await createAutocompleteHarness()
  const fixture = autocompleteCases[0]
  const token = cm5TokenAt(fixture.source, fixture.cursor, harness.parser, harness.StringStream)
  const lines = fixture.source.split("\n")
  const result = harness.autocomplete.complete({
    line: lines[fixture.cursor.line],
    previousLine: "",
    cursor: fixture.cursor.ch,
    token,
    state: token.state
  })

  assert.equal(Object.isFrozen(harness.autocomplete), true)
  assert.equal(Object.isFrozen(harness.autocomplete.excludedKeyCodes), true)
  assert.equal(harness.autocomplete.excludedKeyCodes[190], undefined)
  assert.deepEqual(
    {from: result.from, to: result.to, list: result.list.map(({text, extra, tag}) => ({text, extra, tag}))},
    {from: fixture.expected.from.ch, to: fixture.expected.to.ch, list: fixture.expected.list}
  )
  assert.equal(result.list.some(item => "render" in item), false)
})

test("the registered CM5 helper matches the captured autocomplete corpus", async t => {
  for (const fixture of autocompleteCases) {
    await t.test(fixture.name, async () => {
      assert.ok(fixture.expected, `missing captured result for ${fixture.name}`)
      const harness = await createAutocompleteHarness()
      const actual = runCm5AutocompleteCase(fixture, harness)
      assert.equal(actual.tokenReads, 1)
      assert.deepEqual(actual.result, fixture.expected)
    })
  }
})
