import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import vm from "node:vm"
import {test} from "node:test"

import {StringStream as OfficialStringStream} from "@codemirror/language"

const countColumn = function(string, end, tabSize, startIndex, startValue) {
  if (end == null) {
    end = string.search(/[^\s\u00a0]/)
    if (end === -1) end = string.length
  }
  for (let i = startIndex || 0, n = startValue || 0;;) {
    const nextTab = string.indexOf("\t", i)
    if (nextTab < 0 || nextTab >= end) return n + (end - i)
    n += nextTab - i
    n += tabSize - (n % tabSize)
    i = nextTab + 1
  }
}

async function loadLocalStringStream(filename) {
  const source = await readFile(filename, "utf8")
  const context = vm.createContext({countColumn})
  vm.runInContext(source, context, {filename})
  return context.CodeMirror.StringStream
}

function normalize(value) {
  if (value == null) return null
  if (Array.isArray(value)) return value.map(normalize)
  return value
}

function observe(stream, returned) {
  return {
    returned: normalize(returned),
    pos: stream.pos,
    start: stream.start,
    current: stream.current()
  }
}

function runTrace(StringStream) {
  const create = string => new StringStream(string, 4, 4)
  const trace = {}

  const sequence = create("ab  CD\tz")
  trace.initial = {
    eol: sequence.eol(),
    sol: sequence.sol(),
    peek: sequence.peek(),
    current: sequence.current()
  }
  trace.next = observe(sequence, sequence.next())
  trace.solAfterNext = sequence.sol()
  trace.eatString = observe(sequence, sequence.eat("b"))
  trace.eatMiss = observe(sequence, sequence.eat("x"))
  trace.eatSpace = observe(sequence, sequence.eatSpace())
  trace.matchStringNoConsume = observe(sequence, sequence.match("cd", false, true))
  trace.matchStringConsume = observe(sequence, sequence.match("cd", true, true))
  trace.skipTo = observe(sequence, sequence.skipTo("z"))
  trace.nextAtTarget = observe(sequence, sequence.next())
  trace.eolAtEnd = sequence.eol()
  trace.backUp = observe(sequence, sequence.backUp(2))

  const eatWhile = create("123abc")
  trace.eatWhileRegexp = observe(eatWhile, eatWhile.eatWhile(/[0-9]/))
  trace.eatWhilePredicate = observe(eatWhile, eatWhile.eatWhile(ch => ch < "c"))

  const skip = create("alpha")
  trace.skipToMiss = observe(skip, skip.skipTo("z"))
  trace.skipToEnd = observe(skip, skip.skipToEnd())

  const regexp = create("abc123")
  trace.regexpNoConsume = observe(regexp, regexp.match(/^abc/, false))
  trace.regexpConsume = observe(regexp, regexp.match(/^abc/))
  trace.regexpMiss = observe(regexp, regexp.match(/^xyz/))
  trace.stringMiss = observe(regexp, regexp.match("XYZ", true, true))

  const columns = create("\t  token")
  columns.pos = columns.start = 3
  trace.column = columns.column()
  trace.indentation = columns.indentation()
  trace.columnState = observe(columns, null)

  const whitespace = create(" \t\u00a0word")
  trace.unicodeSpace = observe(whitespace, whitespace.eatSpace())
  trace.peekAfterSpace = whitespace.peek()

  return trace
}

test("PuzzleScript stream matches the old local and official CM6 StringStream behavior", async () => {
  const [puzzleScriptStream, oldLocalStream] = await Promise.all([
    loadLocalStringStream("src/js/puzzlescript-stream.js"),
    loadLocalStringStream("src/js/codemirror/stringstream.js")
  ])

  const extracted = runTrace(puzzleScriptStream)
  assert.deepEqual(extracted, runTrace(oldLocalStream))
  assert.deepEqual(extracted, runTrace(OfficialStringStream))
})
