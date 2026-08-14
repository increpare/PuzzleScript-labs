import assert from "node:assert/strict"
import {test} from "node:test"

import {decodeStyleToken, encodeStyleToken, isStyleToken} from "../../js/codemirror6/style-token.js"
import {
  CM5_MAX_HIGHLIGHT_LENGTH,
  createPuzzleScriptLanguage,
  wrapPuzzleScriptParser
} from "../../js/codemirror6/stream-language.js"
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

test("style identities are lossless and collision-free", () => {
  const style = "COLOR BOLDCOLOR COLOR-#Ff00aA"
  assert.equal(decodeStyleToken(encodeStyleToken(style)), style)
  assert.notEqual(encodeStyleToken("A B"), encodeStyleToken("A_B"))
  assert.equal(encodeStyleToken(null), null)
  assert.equal(decodeStyleToken("not-a-puzzlescript-token"), null)
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
