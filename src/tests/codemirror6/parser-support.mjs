import {readFile} from "node:fs/promises"
import path from "node:path"
import {fileURLToPath} from "node:url"

import {StringStream} from "@codemirror/language"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const parserSourceFiles = [
  "src/js/languageConstants.js",
  "src/js/colors.js",
  "src/js/puzzlescript-stream.js",
  "src/js/parser.js"
]

let factoryPromise

async function parserFactory() {
  if (!factoryPromise) {
    factoryPromise = Promise.all(parserSourceFiles.map(file => readFile(path.join(root, file), "utf8")))
      .then(sources => new Function(
        "consolePrint",
        "jumpToLine",
        sources.join("\n") + "\nreturn {parser: new codeMirrorFn(), StringStream: CodeMirror.StringStream};"
      ))
  }
  return factoryPromise
}

export async function createParserHarness() {
  const diagnostics = []
  const factory = await parserFactory()
  const result = factory((message, urgent) => diagnostics.push({message, urgent: !!urgent}), () => {})
  return {...result, diagnostics}
}

function readToken(token, stream, state) {
  stream.start = stream.pos
  for (let attempt = 0; attempt < 10; attempt++) {
    const style = token(stream, state)
    if (stream.pos > stream.start) return style
  }
  throw new Error("PuzzleScript parser failed to advance its stream")
}

function eachSourceLine(source, visit) {
  let from = 0
  while (from < source.length) {
    const newline = source.indexOf("\n", from)
    const to = newline < 0 ? source.length : newline
    visit(source.slice(from, to), from)
    if (newline < 0) break
    from = newline + 1
  }
}

export function directParserTrace(source, parser, LocalStringStream, maxHighlightLength = 10_000) {
  let state = parser.startState(2)
  const tokens = []

  eachSourceLine(source, (line, lineFrom) => {
    const stateBeforeLongLine = line.length > maxHighlightLength ? parser.copyState(state) : null
    const stream = new LocalStringStream(line, 4)
    if (stream.eol()) {
      parser.blankLine(state, 2)
    } else {
      while (!stream.eol()) {
        let style = null
        if (stream.pos > maxHighlightLength) {
          stream.start = stream.pos
          stream.skipToEnd()
        } else {
          style = readToken(parser.token, stream, state)
        }
        if (style) tokens.push({from: lineFrom + stream.start, to: lineFrom + stream.pos, style})
      }
    }
    if (stateBeforeLongLine) state = stateBeforeLongLine
  })

  return {tokens, state: parser.copyState(state)}
}

export function wrappedParserTrace(source, spec, decodeStyleToken) {
  const state = spec.startState(2)
  const tokens = []

  eachSourceLine(source, (line, lineFrom) => {
    const stream = new StringStream(line, 4, 2)
    if (stream.eol()) {
      spec.blankLine(state, 2)
    } else {
      while (!stream.eol()) {
        const encodedStyle = readToken(spec.token, stream, state)
        if (encodedStyle) {
          tokens.push({
            from: lineFrom + stream.start,
            to: lineFrom + stream.pos,
            style: decodeStyleToken(encodedStyle)
          })
        }
      }
    }
  })

  return {tokens, state: spec.copyState(state).inner}
}

export function canonicalState(value) {
  if (value === undefined) return {type: "undefined"}
  if (value === null || typeof value !== "object") return value
  if (value instanceof Set) return {type: "set", values: [...value].sort().map(canonicalState)}
  if (Array.isArray(value)) {
    const properties = {}
    for (const key of Object.keys(value)) {
      if (!/^(0|[1-9]\d*)$/.test(key)) properties[key] = canonicalState(value[key])
    }
    return {type: "array", values: value.map(canonicalState), properties}
  }
  const result = {}
  for (const key of Object.keys(value).sort()) result[key] = canonicalState(value[key])
  return result
}
