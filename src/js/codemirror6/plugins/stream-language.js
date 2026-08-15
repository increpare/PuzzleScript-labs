(function(host) {
"use strict"

const {StreamLanguage, Tag} = host.requireRuntime(["StreamLanguage", "Tag"])
const {encodeStyleToken, isStyleToken} = host.require("style-token")

const CM5_MAX_HIGHLIGHT_LENGTH = 10_000

const puzzleTokenTag = Tag.define()
const tokenTable = new Proxy(Object.create(null), {
  get(target, property) {
    return typeof property === "string" && isStyleToken(property) ? puzzleTokenTag : target[property]
  }
})

function wrapPuzzleScriptParser(parser) {
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
        state.lineStart = stream.string.length > CM5_MAX_HIGHLIGHT_LENGTH
          ? parser.copyState(state.inner)
          : null
        state.discardRestOfLine = false
      }
      if (state.discardRestOfLine) {
        stream.skipToEnd()
        return null
      }
      const style = parser.token(stream, state.inner)
      if (stream.pos > CM5_MAX_HIGHLIGHT_LENGTH) {
        if (!state.lineStart) throw new Error("Missing long-line rollback state")
        state.inner = parser.copyState(state.lineStart)
        state.discardRestOfLine = true
      }
      return encodeStyleToken(style)
    }
  }
}

function createPuzzleScriptLanguage(parser) {
  return StreamLanguage.define(wrapPuzzleScriptParser(parser))
}

host.define("stream-language", {
  CM5_MAX_HIGHLIGHT_LENGTH,
  createPuzzleScriptLanguage,
  wrapPuzzleScriptParser
})
})(globalThis.PuzzleScriptCM6Plugins)
