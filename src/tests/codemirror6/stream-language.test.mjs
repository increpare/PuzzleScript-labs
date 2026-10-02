import assert from "node:assert/strict"
import {test} from "node:test"

import {history, undo, ensureSyntaxTree, StringStream, EditorState} from "./plugin-test-support.mjs"

import {exactPrefix, setExactPrefix} from "./plugin-test-support.mjs"
import {decodeStyleToken, encodeStyleToken, isStyleToken} from "./plugin-test-support.mjs"
import {
  CM5_MAX_HIGHLIGHT_LENGTH,
  createPuzzleScriptLanguage,
  wrapPuzzleScriptParser
} from "./plugin-test-support.mjs"
import {getTokenAtPosition} from "./plugin-test-support.mjs"
import {parserCases} from "./fixtures/parser-cases.js"
import {
  canonicalState,
  createParserHarness,
  directParserTrace,
  wrappedParserTrace
} from "./parser-support.mjs"

function treeTokens(tree) {
  const tokens = []
  tree.iterate({
    enter(node) {
      if (isStyleToken(node.name)) {
        tokens.push({from: node.from, to: node.to, style: decodeStyleToken(node.name)})
      }
    }
  })
  return tokens
}

function copyCountsForLine(line) {
  let allCopies = 0
  let rollbackSnapshots = 0
  const initialState = {generation: 0}
  const parser = {
    startState: () => initialState,
    copyState(state) {
      allCopies++
      // Count only the extra snapshot allocated at the start of a pathological
      // line. The detached restore copy and CM6-owned checkpoints are separate.
      if (state === initialState) rollbackSnapshots++
      return {generation: state.generation + 1}
    },
    blankLine: () => {},
    token(stream) {
      stream.skipToEnd()
      return null
    }
  }
  const wrapped = wrapPuzzleScriptParser(parser)
  const state = wrapped.startState(2)
  const stream = new StringStream(line, 4, 2)
  wrapped.token(stream, state)
  return {allCopies, rollbackSnapshots}
}

function copiesForLine(line) {
  return copyCountsForLine(line).rollbackSnapshots
}

async function parserStateAtFollowingObjects(state, language) {
  assert.ok(ensureSyntaxTree(state, state.doc.length, 1_000))
  state = state.update({effects: setExactPrefix.of(state.doc.length)}).state
  const objects = state.doc.toString().lastIndexOf("OBJECTS")
  assert.notEqual(objects, -1)
  return {
    state,
    parserState: canonicalState(getTokenAtPosition(state, language, objects + 2).state)
  }
}

async function freshParserStateAtFollowingObjects(source) {
  const harness = await createParserHarness()
  const language = createPuzzleScriptLanguage(harness.parser)
  const state = EditorState.create({doc: source, extensions: [language, exactPrefix]})
  return (await parserStateAtFollowingObjects(state, language)).parserState
}

test("style identities are lossless and collision-free", () => {
  const style = "COLOR BOLDCOLOR COLOR-#Ff00aA"
  assert.equal(decodeStyleToken(encodeStyleToken(style)), style)
  assert.notEqual(encodeStyleToken("A B"), encodeStyleToken("A_B"))
  assert.equal(encodeStyleToken(null), null)
  assert.equal(decodeStyleToken("not-a-puzzlescript-token"), null)
})

test("only pathological lines allocate a line-start rollback snapshot", () => {
  assert.equal(copiesForLine("x".repeat(9_999)), 0)
  assert.equal(copiesForLine("x".repeat(10_000)), 0)
  assert.equal(copiesForLine("x".repeat(10_001)), 1)
  assert.equal(copyCountsForLine("x".repeat(10_001)).allCopies, 2,
    "one rollback snapshot plus one detached restore copy")
})

test("edits and undo around a pathological line preserve the following section state", async () => {
  const source = `${"x".repeat(10_001)}\nOBJECTS\nPlayer\nred\n.....\n.....\n.....\n.....\n.....\n`
  const harness = await createParserHarness()
  const language = createPuzzleScriptLanguage(harness.parser)
  let state = EditorState.create({
    doc: source,
    extensions: [history(), language, exactPrefix]
  })

  state = state.update({changes: {from: 5_000, to: 5_001}}).state
  let parsed = await parserStateAtFollowingObjects(state, language)
  state = parsed.state
  assert.deepEqual(parsed.parserState, await freshParserStateAtFollowingObjects(state.doc.toString()))

  const view = {
    get state() { return state },
    dispatch(transaction) { state = transaction.state }
  }
  assert.equal(undo(view), true)
  parsed = await parserStateAtFollowingObjects(state, language)
  assert.deepEqual(parsed.parserState, await freshParserStateAtFollowingObjects(state.doc.toString()))
})

test("StreamLanguage preserves every styled parser span and final parser state", async t => {
  assert.equal(CM5_MAX_HIGHLIGHT_LENGTH, 10_000)
  assert.equal(parserCases.find(item => item.name === "line-at-9999").source.indexOf("\n"), 9_999)
  assert.equal(parserCases.find(item => item.name === "long-line-cutoff").source.indexOf("\n"), 10_001)

  for (const fixture of parserCases) {
    await t.test(fixture.name, async () => {
      const directHarness = await createParserHarness()
      const direct = directParserTrace(
        fixture.source,
        directHarness.parser,
        directHarness.StringStream,
        CM5_MAX_HIGHLIGHT_LENGTH
      )

      const languageHarness = await createParserHarness()
      const language = createPuzzleScriptLanguage(languageHarness.parser)
      const streamLanguageTokens = treeTokens(language.parser.parse(fixture.source))
      assert.deepEqual(streamLanguageTokens, direct.tokens.filter(token => token.style))

      const wrappedHarness = await createParserHarness()
      const wrapped = wrappedParserTrace(
        fixture.source,
        wrapPuzzleScriptParser(wrappedHarness.parser),
        decodeStyleToken
      )
      assert.deepEqual(wrapped.tokens, direct.tokens.filter(token => token.style))
      assert.deepEqual(canonicalState(wrapped.state), canonicalState(direct.state))
    })
  }
})
