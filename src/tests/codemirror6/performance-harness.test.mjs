import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {test} from "node:test"
import vm from "node:vm"

import {transformCM5ComparisonHtml} from "./build-performance-pages.mjs"
import {
  collectChromeHeap,
  launchInstalledChrome,
  parseArguments,
  surfaceUrl,
  validateHeapResults,
  withSafariSessionLifecycle
} from "./performance/run-installed-browser.mjs"

const editorHtml = await readFile(new URL("../../editor.html", import.meta.url), "utf8")

function count(source, needle) {
  return source.split(needle).length - 1
}

const cm5ScriptWhitelist = [
  "js/Blob.js",
  "js/FileSaver.js",
  "js/jsgif/LZWEncoder.js",
  "js/jsgif/NeuQuant.js",
  "js/jsgif/GIFEncoder.js",
  "js/storagewrapper.js",
  "js/debug.js",
  "js/bitvec.js",
  "js/level.js",
  "js/languageConstants.js",
  "js/globalVariables.js",
  "js/font.js",
  "js/rng.js",
  "js/riffwave.js",
  "js/sfxr.js",
  "js/colorhelpers.js",
  "js/codemirror/codemirror.js",
  "js/codemirror/panel.js",
  "js/codemirror/active-line.js",
  "js/codemirror/dialog.js",
  "js/codemirror/searchcursor.js",
  "js/codemirror/search.js",
  "js/codemirror/match-highlighter.js",
  "js/codemirror/show-hint.js",
  "js/codemirror/rule-transform.js",
  "js/puzzlescript-autocomplete.js",
  "js/codemirror/anyword-hint.js",
  "js/codemirror/comment.js",
  "js/colors.js",
  "js/graphics.js",
  "js/mobile.js",
  "js/inputoutput.js",
  "js/console.js",
  "js/buildStandalone.js",
  "js/engine.js",
  "js/parser.js",
  "js/github.js",
  "js/imagepaste.js",
  "js/editor-api.js",
  "js/editor-cm5.js",
  "js/editor.js",
  "js/compiler.js",
  "js/soundbar.js",
  "js/toolbar.js",
  "js/layout.js",
  "js/addlisteners.js",
  "js/addlisteners_editor.js",
  "js/makegif.js"
]

function scriptSources(source) {
  return Array.from(source.matchAll(/<script\s+src=["']([^"']+)["']\s*><\/script>/gi), match => match[1])
}

function performanceInputs() {
  return {
    representativeSource: "title Representative\n",
    largeSource: "OBJECTS\nPlayer\nred\n.....\n.....\n.....\n.....\n.....\n\nLEVELS\nP\n",
    distantLine: 10,
    distantColumn: 0,
    completion: {source: "RULES\nr", cursor: {line: 1, column: 1}, key: "i"}
  }
}

function createHarnessContext({
  visibleLine = 10,
  lineTop = 10,
  levelTop = lineTop,
  cursorTop = lineTop
} = {}) {
  const calls = []
  const classes = new Set()
  const input = {dispatchEvent(event) { calls.push(["event", event.type, event.key]) }}
  const editor = {
    setValue(value) { calls.push(["setValue", value]) },
    clearHistory() { calls.push(["clearHistory"]) },
    setCursor(line, column) { calls.push(["setCursor", line, column]) },
    revealLine(line, options) { calls.push(["revealLine", line, options]) },
    focus() { calls.push(["focus"]) },
    blur() { calls.push(["blur"]) },
    replaceSelection(value) { calls.push(["replaceSelection", value]) },
    getInputElement() { return input }
  }
  const rect = (top, bottom) => ({top, bottom, left: 0, right: 100, width: 100, height: bottom - top})
  const scroller = {scrollLeft: 5, scrollTop: 0, scrollHeight: 46_904, clientHeight: 100,
    getBoundingClientRect: () => rect(0, 100)}
  const level = {textContent: "P", getBoundingClientRect: () => rect(levelTop, levelTop + 10)}
  const gutter = {textContent: String(visibleLine + 1), getBoundingClientRect: () => rect(lineTop, lineTop + 10)}
  const cursor = {getBoundingClientRect: () => rect(cursorTop, cursorTop + 10)}
  const root = {
    getBoundingClientRect: () => rect(0, 200),
    querySelectorAll(selector) {
      if (selector === ".cm-LEVEL") return [level]
      if (selector === ".cm-METADATA,.cm-ERROR") return []
      if (selector === ".cm-cursor,.CodeMirror-cursor") return [cursor]
      if (selector.includes("gutterElement") || selector.includes("CodeMirror-linenumber")) return [gutter]
      return []
    }
  }
  const completion = {getBoundingClientRect: () => rect(10, 20)}
  const textarea = {editorreference: editor}
  const document = {
    body: {
      style: {},
      classList: {
        add(value) { classes.add(value) },
        remove(value) { classes.delete(value) }
      }
    },
    documentElement: {},
    querySelector(selector) {
      if (selector === "#code") return textarea
      if (selector === ".cm-editor") return root
      if (selector === ".CodeMirror") return null
      if (selector === ".CodeMirror-scroll,.cm-scroller") return scroller
      if (selector === ".CodeMirror-search-panel,.cm-search") return {}
      return null
    },
    querySelectorAll(selector) {
      return selector === ".CodeMirror-hints,.cm-tooltip-autocomplete" ? [completion] : []
    }
  }
  let clock = 0
  const context = vm.createContext({
    document,
    getComputedStyle: () => ({visibility: "visible", display: "block"}),
    KeyboardEvent: class {
      constructor(type, options) { this.type = type; Object.assign(this, options) }
    },
    MutationObserver: class { observe() {}; disconnect() {} },
    navigator: {platform: "MacIntel"},
    performance: {now: () => ++clock},
    requestAnimationFrame: callback => callback(),
    window: {scrollTo() { calls.push(["scrollTo"]) }}
  })
  return {context, calls, classes, editor, scroller}
}

async function loadHarness(context) {
  const source = await readFile(new URL("performance/harness.js", import.meta.url), "utf8")
  vm.runInContext(source, context)
  return context.window.PuzzleScriptPerformance
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

test("CM5 comparison scripts are reconstructed exclusively from the historical whitelist", () => {
  const input = editorHtml.replace("</body>", [
    '<script src="js/future-cm6-private.js"></script>',
    '<script defer src="js/future-cm6-defer-first.js"></script>',
    "<script src='js/future-cm6-src-first.js' defer></script>",
    '<script type="text/javascript" src = "js/future-cm6-spaced.js" async></script>',
    "</body>"
  ].join("\n"))
  const output = transformCM5ComparisonHtml(input)

  assert.deepEqual(scriptSources(output), cm5ScriptWhitelist)
  assert.equal(output.includes("future-cm6-private.js"), false)
  assert.equal(output.includes("future-cm6-defer-first.js"), false)
  assert.equal(output.includes("future-cm6-src-first.js"), false)
  assert.equal(output.includes("future-cm6-spaced.js"), false)
  assert.equal(output.includes("puzzlescript-stream.js"), false)
  assert.equal(output.includes("codemirror6.bundle.js"), false)
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

test("performance harness runs exactly seven scenarios with 5 warmups and 20 restored samples", async () => {
  const fixture = createHarnessContext()
  const api = await loadHarness(fixture.context)
  const result = await api.runAll(performanceInputs())

  assert.equal(result.warmups, 5)
  assert.equal(result.samples, 20)
  assert.deepEqual(Object.keys(result.summaries), [
    "keyToNextPaint",
    "autocompleteVisible",
    "hundredApiEdits",
    "replaceDocumentSync",
    "replaceDocumentSettled",
    "loadDistantJumpExact",
    "cursorFocusSearchSettled"
  ])
  for (const summary of Object.values(result.summaries)) assert.equal(summary.samples.length, 20)
  assert.equal(fixture.calls.filter(call => call[0] === "setValue").length, 10 * 25)
  assert.equal(fixture.calls.filter(call => call[0] === "clearHistory").length, 7 * 25)
  assert.equal(fixture.calls.filter(call => call[0] === "revealLine").length, 9 * 25)
  assert.equal(fixture.calls.filter(call => call[0] === "focus").length, 8 * 25)
  assert.equal(fixture.classes.has("dark-theme"), true)
  assert.equal(fixture.scroller.scrollLeft, 0)
  assert.equal(fixture.scroller.scrollTop, 0)
})

test("distant exactness rejects a no-op reveal with an unrelated visible LEVEL", async () => {
  const fixture = createHarnessContext({visibleLine: 0})
  const api = await loadHarness(fixture.context)
  await assert.rejects(
    api.runScenario("loadDistantJumpExact", performanceInputs()),
    /Timed out waiting for exact distant LEVEL rendering/
  )
  assert.equal(fixture.scroller.scrollTop, 0)
  assert.equal(fixture.scroller.scrollHeight, 46_904)
})

test("distant exactness requires the visible cursor to be on the requested line", async () => {
  const fixture = createHarnessContext({visibleLine: 10, levelTop: 10, cursorTop: 70})
  const api = await loadHarness(fixture.context)
  await assert.rejects(
    api.runScenario("loadDistantJumpExact", performanceInputs()),
    /Timed out waiting for exact distant LEVEL rendering/
  )
})

test("distant exactness rejects a target line whose visible LEVEL belongs to a neighbor", async () => {
  const fixture = createHarnessContext({visibleLine: 10, lineTop: 10, cursorTop: 10, levelTop: 30})
  const api = await loadHarness(fixture.context)
  await assert.rejects(
    api.runScenario("loadDistantJumpExact", performanceInputs()),
    /Timed out waiting for exact distant LEVEL rendering/
  )
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

test("Chrome heap validation rejects nonfinite samples and summaries", () => {
  const summary = values => ({samples: values, median: values[0], p95: values[0], min: values[0], max: values[0]})
  assert.doesNotThrow(() => validateHeapResults({
    supported: true,
    initial: summary([2.5]),
    large: summary([5.5])
  }))
  assert.throws(() => validateHeapResults({
    supported: true,
    initial: summary([Number.NaN]),
    large: summary([5.5])
  }), /heap\.initial\.samples/)
  assert.throws(() => validateHeapResults({
    supported: true,
    initial: {...summary([2.5]), p95: Number.POSITIVE_INFINITY},
    large: summary([5.5])
  }), /heap\.initial\.p95/)
})

test("Chrome heap collection uses a fresh page and CDP garbage collection for every sample", async () => {
  const calls = {pages: 0, closed: 0, garbageCollections: 0, heapUsage: 0}
  const browser = {
    async newPage(options) {
      calls.pages += 1
      assert.deepEqual(options, {viewport: {width: 1280, height: 900}})
      return {
        async goto() {},
        async waitForSelector() {},
        async evaluate(callback, argument) {
          if (argument === undefined) return true
          return callback.toString().includes("requestAnimationFrame") ? undefined : true
        },
        context() {
          return {
            async newCDPSession() {
              return {
                async send(command) {
                  if (command === "HeapProfiler.collectGarbage") calls.garbageCollections += 1
                  if (command === "Runtime.getHeapUsage") {
                    calls.heapUsage += 1
                    return {usedSize: 3 * 1024 * 1024}
                  }
                }
              }
            }
          }
        },
        async close() { calls.closed += 1 }
      }
    }
  }

  const heap = await collectChromeHeap(browser, "http://example.test/editor.html", "cm6", {
    largeSource: "x".repeat(129_721)
  })
  assert.deepEqual(calls, {pages: 20, closed: 20, garbageCollections: 40, heapUsage: 40})
  assert.equal(heap.initial.samples.length, 20)
  assert.equal(heap.large.samples.length, 20)
})

test("Chrome runner launches the installed Chrome channel", async () => {
  const calls = []
  const expectedBrowser = {}
  const actualBrowser = await launchInstalledChrome({
    async launch(options) {
      calls.push(options)
      return expectedBrowser
    }
  })
  assert.equal(actualBrowser, expectedBrowser)
  assert.deepEqual(calls, [{channel: "chrome"}])
})

test("Safari lifecycle always deletes sessions and stops only a driver it started", async () => {
  const deleted = []
  const stopped = []
  const ownedDriver = {kill(signal) { stopped.push(signal) }}

  await assert.rejects(withSafariSessionLifecycle(
    async () => ({driver: ownedDriver, sessionId: "owned"}),
    async sessionId => { deleted.push(sessionId) },
    async () => { throw new Error("benchmark failed") }
  ), /benchmark failed/)
  const result = await withSafariSessionLifecycle(
    async () => ({driver: null, sessionId: "existing"}),
    async sessionId => { deleted.push(sessionId) },
    async connection => connection.sessionId
  )

  assert.equal(result, "existing")
  assert.deepEqual(deleted, ["owned", "existing"])
  assert.deepEqual(stopped, ["SIGTERM"])
})
