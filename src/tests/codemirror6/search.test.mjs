import assert from "node:assert/strict"
import {test} from "node:test"

import {SearchQuery, getSearchQuery, EditorState} from "./plugin-test-support.mjs"

import {
  forceCaseInsensitive,
  puzzleScriptSearch,
  puzzleScriptSearchKeymap
} from "./plugin-test-support.mjs"

test("forceCaseInsensitive copies every query option and changes only case sensitivity", () => {
  const marker = () => true
  for (const literal of [false, true]) {
    for (const regexp of [false, true]) {
      for (const wholeWord of [false, true]) {
        const query = new SearchQuery({
          search: regexp ? "a.*a" : "Alpha\\nBeta",
          caseSensitive: true,
          literal,
          regexp,
          replace: "$1 replacement",
          wholeWord,
          test: marker
        })
        const actual = forceCaseInsensitive(query)
        assert.notEqual(actual, query)
        assert.equal(actual.search, query.search)
        assert.equal(actual.caseSensitive, false)
        assert.equal(actual.literal, query.literal)
        assert.equal(actual.regexp, query.regexp)
        assert.equal(actual.replace, query.replace)
        assert.equal(actual.wholeWord, query.wholeWord)
        assert.equal(actual.test, query.test)
      }
    }
  }

  const alreadyInsensitive = new SearchQuery({search: "alpha", caseSensitive: false})
  assert.equal(forceCaseInsensitive(alreadyInsensitive), alreadyInsensitive)
})

test("PuzzleScript search starts case-insensitive and binds no stock extras", () => {
  const state = EditorState.create({doc: "Alpha alpha ALPHA", extensions: puzzleScriptSearch()})
  assert.equal(getSearchQuery(state).caseSensitive, false)

  const serialized = JSON.stringify(puzzleScriptSearchKeymap)
  assert.equal(serialized.includes("F3"), false)
  assert.equal(serialized.includes("Mod-d"), false)
})
