import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {test} from "node:test"
import vm from "node:vm"

import {transformCM5ComparisonHtml} from "./build-performance-pages.mjs"
import {parseArguments, surfaceUrl} from "./performance/run-installed-browser.mjs"

const editorHtml = await readFile(new URL("../../editor.html", import.meta.url), "utf8")

function count(source, needle) {
  return source.split(needle).length - 1
}

test("CM5 comparison generation is exact and idempotent from active CM6 markup", () => {
  const output = transformCM5ComparisonHtml(editorHtml)
  const scripts = [
    "codemirror.js",
    "panel.js",
    "active-line.js",
    "dialog.js",
    "searchcursor.js",
    "search.js",
    "match-highlighter.js",
    "show-hint.js",
    "anyword-hint.js",
    "comment.js"
  ]

  assert.equal(count(output, '<base href="../../../">'), 1)
  for (const script of scripts) {
    assert.equal(count(output, `src="js/codemirror/${script}"`), 1, script)
  }
  assert.equal(count(output, 'src="js/editor-cm5.js"'), 1)
  assert.equal(count(output, 'src="js/editor-api.js"'), 1)
  assert.equal(count(output, 'src="js/editor.js"'), 1)
  assert.equal(count(output, 'href="css/codemirror.css"'), 1)
  assert.equal(count(output, 'src="js/codemirror6.bundle.js"'), 0)
  assert.equal(count(output, 'src="js/editor-cm6.js"'), 0)
  assert.equal(count(output, 'href="css/editor-cm6.css"'), 0)
  assert.ok(output.indexOf("js/codemirror/codemirror.js") < output.indexOf("js/editor-cm5.js"))
  assert.ok(output.indexOf("js/codemirror/show-hint.js") < output.indexOf("js/codemirror/rule-transform.js"))
  assert.ok(output.indexOf("js/codemirror/rule-transform.js") < output.indexOf("js/puzzlescript-autocomplete.js"))
  assert.ok(output.indexOf("js/puzzlescript-autocomplete.js") < output.indexOf("js/codemirror/anyword-hint.js"))
  assert.ok(output.indexOf("js/editor-api.js") < output.indexOf("js/editor-cm5.js"))
  assert.ok(output.indexOf("js/editor-cm5.js") < output.indexOf("js/editor.js"))
  assert.equal(transformCM5ComparisonHtml(output), output)
})

test("performance harness exposes only its frozen API and summarizes a sorted copy", async () => {
  const source = await readFile(new URL("performance/harness.js", import.meta.url), "utf8")
  const context = vm.createContext({window: {}})
  vm.runInContext(source, context)

  const api = context.window.PuzzleScriptPerformance
  assert.deepEqual(Object.keys(api), ["runAll", "runScenario", "summarize"])
  assert.equal(Object.isFrozen(api), true)

  const samples = [20, 1, 5, 4, 3, 2, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
  const summary = JSON.parse(JSON.stringify(api.summarize(samples)))
  assert.deepEqual(samples, [20, 1, 5, 4, 3, 2, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
  assert.deepEqual(summary, {
    samples: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    median: 10.5,
    p95: 19,
    min: 1,
    max: 20
  })
})

test("installed-browser arguments require a complete explicit destination", () => {
  assert.deepEqual(parseArguments([
    "--browser", "chrome",
    "--surface", "cm5",
    "--base-url", "http://127.0.0.1:4173/",
    "--output", "/tmp/result.json"
  ]), {
    browser: "chrome",
    surface: "cm5",
    baseUrl: "http://127.0.0.1:4173",
    output: "/tmp/result.json"
  })
  assert.equal(
    surfaceUrl({surface: "cm5", baseUrl: "http://127.0.0.1:4173"}),
    "http://127.0.0.1:4173/tests/codemirror6/generated/cm5-editor.html"
  )
  assert.equal(
    surfaceUrl({surface: "cm6", baseUrl: "http://127.0.0.1:4173"}),
    "http://127.0.0.1:4173/editor.html"
  )
  assert.throws(() => parseArguments(["--browser", "safari"]), /--surface/)
  assert.throws(() => parseArguments([
    "--browser", "edge", "--surface", "cm6", "--base-url", "http://example.test", "--output", "x"
  ]), /chrome\|safari/)
})
