import {
  StringStream,
  getIndentUnit,
  syntaxTree,
  syntaxTreeAvailable
} from "@codemirror/language"
import {Tree} from "@lezer/common"

import {exactPrefix} from "./exact-prefix.js"
import {decodeStyleToken} from "./style-token.js"

export function assertPinnedStreamLanguage(language) {
  if (!language || !language.stateAfter || !language.streamParser ||
      typeof language.streamParser.copyState !== "function") {
    throw new Error("Unsupported @codemirror/language StreamLanguage internals; expected 6.12.4")
  }
}

// Pinned from @codemirror/language 6.12.4 stream-parser.ts. Keeping this walk
// local makes the private stateAfter dependency explicit and easy to audit.
function findState(language, tree, offset, startPosition, before) {
  const state = offset >= startPosition && offset + tree.length <= before &&
    tree.prop(language.stateAfter)
  if (state) {
    return {
      state: language.streamParser.copyState(state),
      position: offset + tree.length
    }
  }
  for (let index = tree.children.length - 1; index >= 0; index--) {
    const child = tree.children[index]
    const position = offset + tree.positions[index]
    if (child instanceof Tree && position < before) {
      const found = findState(language, child, position, startPosition, before)
      if (found) return found
    }
  }
  return null
}

function readToken(token, stream, state) {
  stream.start = stream.pos
  for (let attempt = 0; attempt < 10; attempt++) {
    const style = token(stream, state)
    if (stream.pos > stream.start) return style
  }
  throw new Error("PuzzleScript parser failed to advance its stream")
}

function advanceCompleteLine(parser, state, text, tabSize, indentUnit) {
  const stream = new StringStream(text, tabSize, indentUnit)
  if (stream.eol()) {
    parser.blankLine(state, indentUnit)
    return
  }
  while (!stream.eol()) readToken(parser.token, stream, state)
}

export function getTokenAtPosition(editorState, language, position) {
  assertPinnedStreamLanguage(language)
  const document = editorState.doc
  const clippedPosition = Math.min(Math.max(0, position), document.length)
  const line = document.lineAt(clippedPosition)
  const parsedExactlyThrough = editorState.field(exactPrefix, false)
  if (parsedExactlyThrough === undefined || parsedExactlyThrough < line.from ||
      !syntaxTreeAvailable(editorState, line.from)) {
    throw new Error("PuzzleScript parser state requires an exact prefix through the current line")
  }

  const parser = language.streamParser
  const indentUnit = getIndentUnit(editorState)
  const checkpoint = findState(language, syntaxTree(editorState), 0, 0, line.from)
  let wrappedState = checkpoint ? checkpoint.state : parser.startState(indentUnit)
  let statePosition = checkpoint ? checkpoint.position : 0

  while (statePosition < line.from) {
    const completeLine = document.lineAt(statePosition)
    if (completeLine.from !== statePosition || completeLine.to >= line.from) {
      throw new Error("Unsupported StreamLanguage checkpoint position; expected a complete line boundary")
    }
    advanceCompleteLine(parser, wrappedState, completeLine.text, editorState.tabSize, indentUnit)
    statePosition = completeLine.to + 1
  }

  const column = clippedPosition - line.from
  const stream = new StringStream(line.text, editorState.tabSize, indentUnit)
  let encodedStyle = null
  while (stream.pos < column && !stream.eol()) {
    encodedStyle = readToken(parser.token, stream, wrappedState)
  }

  return {
    start: stream.start,
    end: stream.pos,
    string: stream.current(),
    type: encodedStyle ? decodeStyleToken(encodedStyle) : null,
    state: wrappedState.inner
  }
}
