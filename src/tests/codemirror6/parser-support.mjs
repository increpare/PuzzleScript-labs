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
let autocompleteFactoryPromise

async function parserFactory() {
  if (!factoryPromise) {
    factoryPromise = Promise.all(parserSourceFiles.map(file => readFile(path.join(root, file), "utf8")))
      .then(sources => new Function(
        "consolePrint",
        "jumpToLine",
        sources.join("\n") + `
return {
  parser: new codeMirrorFn(),
  StringStream: CodeMirror.StringStream,
  getErrorState: () => ({errorStrings: errorStrings.slice(), errorCount}),
  resetErrors: resetParserErrorState,
  setCompiling: value => { compiling = value }
};`
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

export async function createAutocompleteHarness() {
  if (!autocompleteFactoryPromise) {
    autocompleteFactoryPromise = Promise.all([
      ...parserSourceFiles.slice(0, -1).map(file => readFile(path.join(root, file), "utf8")),
      readFile(path.join(root, "src/js/codemirror/rule-transform.js"), "utf8"),
      readFile(path.join(root, "src/js/parser.js"), "utf8"),
      readFile(path.join(root, "src/js/compiler.js"), "utf8"),
      readFile(path.join(root, "src/js/puzzlescript-autocomplete.js"), "utf8").catch(error => {
        if (error.code === "ENOENT") return ""
        throw error
      }),
      readFile(path.join(root, "src/js/codemirror/anyword-hint.js"), "utf8")
    ]).then(parts => {
      const anyword = parts.pop()
      const autocomplete = parts.pop()
      const sources = parts.join("\n")
      return new Function(
        "consolePrint",
        "jumpToLine",
        `${sources}
var window = {};
var registeredHint = null;
CodeMirror.Pos = (line, ch) => ({line, ch});
CodeMirror.registerHelper = (kind, name, helper) => { if (kind === "hint" && name === "anyword") registeredHint = helper };
${autocomplete}
var PuzzleScriptAutocomplete = window.PuzzleScriptAutocomplete;
${anyword}
return {
  parser: new codeMirrorFn(),
  StringStream: CodeMirror.StringStream,
  hint: registeredHint,
  autocomplete: PuzzleScriptAutocomplete
};`
      )
    })
  }
  const factory = await autocompleteFactoryPromise
  return factory(() => {}, () => {})
}

export function cm5TokenAt(source, cursor, parser, LocalStringStream) {
  const lines = source.split("\n")
  const state = parser.startState(2)

  function readLocalToken(stream) {
    stream.start = stream.pos
    for (let attempt = 0; attempt < 10; attempt++) {
      const type = parser.token(stream, state)
      if (stream.pos > stream.start) return type
    }
    throw new Error("PuzzleScript parser failed to advance its stream")
  }

  for (let lineNumber = 0; lineNumber < cursor.line; lineNumber++) {
    const stream = new LocalStringStream(lines[lineNumber] || "", 4)
    if (stream.eol()) parser.blankLine(state, 2)
    else while (!stream.eol()) readLocalToken(stream)
  }

  const stream = new LocalStringStream(lines[cursor.line] || "", 4)
  let type = null
  while (stream.pos < cursor.ch && !stream.eol()) type = readLocalToken(stream)
  return {
    start: stream.start,
    end: stream.pos,
    string: stream.current(),
    type: type || null,
    state
  }
}

export function runCm5AutocompleteCase(fixture, harness) {
  const lines = fixture.source.split("\n")
  const token = cm5TokenAt(fixture.source, fixture.cursor, harness.parser, harness.StringStream)
  let tokenReads = 0
  const editor = {
    getCursor: () => fixture.cursor,
    getLine: line => lines[line],
    getTokenAt() {
      tokenReads++
      return token
    }
  }
  const result = harness.hint(editor, {})
  return {
    result: {
      from: result.from,
      to: result.to,
      list: result.list.map(({text, extra, tag}) => ({text, extra, tag}))
    },
    tokenReads
  }
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
