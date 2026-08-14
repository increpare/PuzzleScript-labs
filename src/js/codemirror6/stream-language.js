import {StreamLanguage} from "@codemirror/language"
import {Tag} from "@lezer/highlight"

import {encodeStyleToken, isStyleToken} from "./style-token.js"

export const CM5_MAX_HIGHLIGHT_LENGTH = 10_000

const puzzleTokenTag = Tag.define()
const tokenTable = new Proxy(Object.create(null), {
  get(target, property) {
    return typeof property === "string" && isStyleToken(property) ? puzzleTokenTag : target[property]
  }
})

export function wrapPuzzleScriptParser(parser) {
  return {
    name: "puzzle",
    mergeTokens: false,
    tokenTable,
    languageData: {wordChars: "#"},
    startState(indentUnit) {
      return {inner: parser.startState(indentUnit), lineStart: null, discardRestOfLine: false}
    },
    copyState(state) {
      return {
        inner: parser.copyState(state.inner),
        lineStart: state.lineStart && parser.copyState(state.lineStart),
        discardRestOfLine: state.discardRestOfLine
      }
    },
    blankLine(state, indentUnit) {
      parser.blankLine(state.inner, indentUnit)
      state.lineStart = null
      state.discardRestOfLine = false
    },
    token(stream, state) {
      if (stream.sol()) {
        state.lineStart = parser.copyState(state.inner)
        state.discardRestOfLine = false
      }
      if (state.discardRestOfLine) {
        stream.skipToEnd()
        return null
      }
      const style = parser.token(stream, state.inner)
      if (stream.pos > CM5_MAX_HIGHLIGHT_LENGTH) {
        state.inner = parser.copyState(state.lineStart)
        state.discardRestOfLine = true
      }
      return encodeStyleToken(style)
    }
  }
}

export function createPuzzleScriptLanguage(parser) {
  return StreamLanguage.define(wrapPuzzleScriptParser(parser))
}
