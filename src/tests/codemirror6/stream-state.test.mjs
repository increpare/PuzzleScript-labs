import assert from "node:assert/strict"
import {test} from "node:test"

import {ensureSyntaxTree, EditorState} from "./plugin-test-support.mjs"

import {exactPrefix, setExactPrefix} from "./plugin-test-support.mjs"
import {createPuzzleScriptLanguage} from "./plugin-test-support.mjs"
import {
  assertPinnedStreamLanguage,
  getTokenAtPosition
} from "./plugin-test-support.mjs"
import {createParserHarness, directParserTrace} from "./parser-support.mjs"

const source = "OBJECTS\nPlayer\nred\n.....\n.....\n.....\n.....\n.....\n\nLEGEND\nHero = Player"
const targetLineNumber = 11

// Captured from CM5's actual editor.getTokenAt({line: 10, ch}, true).
const expected = [
  {ch: 0, start: 0, end: 0, string: "", type: null, lineNumber: 9, tokenIndex: 0, current: [], synonyms: []},
  {ch: 2, start: 0, end: 4, string: "hero", type: "NAME", lineNumber: 10, tokenIndex: 1, current: ["hero"], synonyms: []},
  {ch: 4, start: 0, end: 4, string: "hero", type: "NAME", lineNumber: 10, tokenIndex: 1, current: ["hero"], synonyms: []},
  {ch: 5, start: 4, end: 7, string: " = ", type: "ASSIGNMENT", lineNumber: 10, tokenIndex: 2, current: ["hero", "="], synonyms: []},
  {ch: 6, start: 4, end: 7, string: " = ", type: "ASSIGNMENT", lineNumber: 10, tokenIndex: 2, current: ["hero", "="], synonyms: []},
  {ch: 7, start: 4, end: 7, string: " = ", type: "ASSIGNMENT", lineNumber: 10, tokenIndex: 2, current: ["hero", "="], synonyms: []},
  {ch: 8, start: 7, end: 13, string: "player", type: "NAME", lineNumber: 10, tokenIndex: 3, current: ["hero", "=", "player"], synonyms: [["hero", "player"]]},
  {ch: 13, start: 7, end: 13, string: "player", type: "NAME", lineNumber: 10, tokenIndex: 3, current: ["hero", "=", "player"], synonyms: [["hero", "player"]]}
]

function stateSummary(state) {
  return {
    lineNumber: state.lineNumber,
    section: state.section,
    tokenIndex: state.tokenIndex,
    current: [...state.current_line_wip_array],
    objects: Object.keys(state.objects),
    synonyms: state.legend_synonyms.map(entry => [...entry])
  }
}

async function exactEditorState(harness) {
  const language = createPuzzleScriptLanguage(harness.parser)
  let state = EditorState.create({doc: source, extensions: [language, exactPrefix]})
  assert.ok(ensureSyntaxTree(state, state.doc.length, 1_000))
  state = state.update({effects: setExactPrefix.of(state.doc.length)}).state
  return {language, state}
}

test("the state bridge rejects unsupported StreamLanguage internals", () => {
  assert.throws(() => assertPinnedStreamLanguage({}), /expected 6\.12\.4/)
})

test("getTokenAtPosition matches captured CM5 token boundaries and parser state", async () => {
  const harness = await createParserHarness()
  const {language, state} = await exactEditorState(harness)
  const line = state.doc.line(targetLineNumber)

  for (const fixture of expected) {
    const actual = getTokenAtPosition(state, language, line.from + fixture.ch)
    assert.equal(actual.start, fixture.start, `start at column ${fixture.ch}`)
    assert.equal(actual.end, fixture.end, `end at column ${fixture.ch}`)
    assert.equal(actual.string, fixture.string, `string at column ${fixture.ch}`)
    assert.equal(actual.type, fixture.type, `type at column ${fixture.ch}`)
    assert.deepEqual(stateSummary(actual.state), {
      lineNumber: fixture.lineNumber,
      section: "legend",
      tokenIndex: fixture.tokenIndex,
      current: fixture.current,
      objects: ["player"],
      synonyms: fixture.synonyms
    })
  }
})

test("repeated state queries do not change parser diagnostics or multiply compile messages", async () => {
  const harness = await createParserHarness()
  const {language, state} = await exactEditorState(harness)
  const line = state.doc.line(targetLineNumber)
  const beforeQueries = harness.getErrorState()

  for (let index = 0; index < 5; index++) {
    getTokenAtPosition(state, language, line.from + 8)
  }
  assert.deepEqual(harness.getErrorState(), beforeQueries)

  const malformed = "OBJECTS trailing junk\nPlayer\nnot-a-colour\n"
  harness.setCompiling(true)
  harness.resetErrors()
  directParserTrace(malformed, harness.parser, harness.StringStream)
  const firstCompile = harness.getErrorState()
  assert.ok(firstCompile.errorCount > 0)

  harness.resetErrors()
  directParserTrace(malformed, harness.parser, harness.StringStream)
  assert.deepEqual(harness.getErrorState(), firstCompile)
})
