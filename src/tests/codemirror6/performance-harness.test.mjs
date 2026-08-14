import assert from "node:assert/strict"
import {mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import path from "node:path"
import {test} from "node:test"
import {EventEmitter} from "node:events"
import vm from "node:vm"

import {transformCM5ComparisonHtml} from "./build-performance-pages.mjs"
import performanceSettleConfig from "./performance-settle.config.mjs"
import {
  collectChromeHeap,
  connectSafari,
  launchInstalledChrome,
  parseArguments,
  safariExecute,
  surfaceUrl,
  terminateOwnedDriver,
  validateBenchmarkResults,
  validateHeapResults,
  writeJsonAtomically,
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

const performanceScenarioNames = [
  "keyToNextPaint",
  "autocompleteVisible",
  "hundredApiEdits",
  "replaceDocumentSync",
  "replaceDocumentSettled",
  "loadDistantJumpExact",
  "cursorFocusSearchSettled"
]

function validSummary() {
  const samples = Array.from({length: 20}, (_, index) => index + 1)
  return {samples, median: 10.5, p95: 19, min: 1, max: 20}
}

function validBenchmarkResults({browser = "chrome", surface = "cm6"} = {}) {
  const url = surface === "cm5"
    ? "http://127.0.0.1:4173/tests/codemirror6/generated/cm5-editor.html"
    : "http://127.0.0.1:4173/editor.html"
  return {
    capturedAt: "2026-08-14T12:00:00.000Z",
    surface,
    url,
    browser: {name: browser, version: "1.2.3"},
    environment: {visibilityState: "visible", pageErrors: []},
    warmups: 5,
    samples: 20,
    sourceLengths: {representative: 448, completion: 432, large: 129_721},
    summaries: Object.fromEntries(performanceScenarioNames.map(name => [name, validSummary()])),
    heap: browser === "chrome"
      ? {supported: true, unit: "MiB", initial: validSummary(), large: validSummary()}
      : {supported: false, reason: "SafariDriver does not expose repeatable JavaScript heap usage"}
  }
}

function validationOptions(result) {
  return {browser: result.browser.name, surface: result.surface, url: result.url}
}

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
  let currentValue = ""
  const input = {dispatchEvent(event) { calls.push(["event", event.type, event.key]) }}
  const editor = {
    getValue() { return currentValue },
    setValue(value) { currentValue = value; calls.push(["setValue", value]) },
    clearHistory() { calls.push(["clearHistory"]) },
    setCursor(line, column) { calls.push(["setCursor", line, column]) },
    revealLine(line, options) { calls.push(["revealLine", line, options]) },
    focus() { calls.push(["focus"]) },
    blur() { calls.push(["blur"]) },
    replaceSelection(value) { currentValue += value; calls.push(["replaceSelection", value]) },
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
    setTimeout,
    clearTimeout,
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

test("CM5 comparison removes CM6 stylesheet tags independent of attribute order", () => {
  const input = editorHtml.replace("</head>", [
    '<link data-owner="cm6" href="css/editor-cm6.css" rel="stylesheet" media="screen">',
    "<link href='css/editor-cm6.css' disabled rel='stylesheet'>",
    "</head>"
  ].join("\n"))
  const output = transformCM5ComparisonHtml(input)

  assert.equal(output.includes("data-owner=\"cm6\""), false)
  assert.equal(output.includes("disabled rel='stylesheet'"), false)
  assert.equal(output.includes("css/editor-cm6.css"), false)
  assert.equal(count(output, 'href="css/codemirror.css"'), 1)
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

test("focused settle config matches only the intended browser contract", () => {
  assert.equal(performanceSettleConfig.testMatch, "performance-settle.spec.mjs")
  assert.equal(performanceSettleConfig.projects.length, 1)
  assert.equal(performanceSettleConfig.projects[0].name, "chromium")
})

test("benchmark validation enforces the exact baseline contract", () => {
  const chrome = validBenchmarkResults()
  const safari = validBenchmarkResults({browser: "safari", surface: "cm5"})
  assert.doesNotThrow(() => validateBenchmarkResults(chrome, validationOptions(chrome)))
  assert.doesNotThrow(() => validateBenchmarkResults(safari, validationOptions(safari)))

  for (const [label, mutate] of [
    ["warmups", result => { result.warmups = 4 }],
    ["samples", result => { result.samples = 19 }],
    ["sourceLengths.large", result => { result.sourceLengths.large -= 1 }],
    ["scenario keys", result => { result.summaries.extra = validSummary() }],
    ["keyToNextPaint\\.samples", result => { result.summaries.keyToNextPaint.samples.pop() }],
    ["keyToNextPaint\\.median", result => { result.summaries.keyToNextPaint.median = 10 }],
    ["heap\\.large\\.samples", result => { result.heap.large.samples.pop() }],
    ["browser keys", result => { result.browser.extra = true }],
    ["browser\\.name", result => { result.browser.name = "safari" }],
    ["environment\\.pageErrors", result => { result.environment.pageErrors.push("boom") }],
    ["heap\\.unit", result => { result.heap.unit = "bytes" }],
    ["top-level keys", result => { result.extra = true }]
  ]) {
    const result = validBenchmarkResults()
    mutate(result)
    assert.throws(() => validateBenchmarkResults(result, {
      browser: "chrome",
      surface: "cm6",
      url: "http://127.0.0.1:4173/editor.html"
    }), new RegExp(label))
  }

  safari.heap.reason = ""
  assert.throws(() => validateBenchmarkResults(safari, validationOptions(safari)), /heap\.reason/)
})

test("every checked performance baseline satisfies the explicit final-output schema", async () => {
  for (const [filename, browser, surface] of [
    ["cm5-chrome.json", "chrome", "cm5"],
    ["pre-cm6-chrome.json", "chrome", "cm6"],
    ["cm5-safari.json", "safari", "cm5"],
    ["pre-cm6-safari.json", "safari", "cm6"]
  ]) {
    const result = JSON.parse(await readFile(new URL(`performance/baselines/${filename}`, import.meta.url)))
    assert.doesNotThrow(() => validateBenchmarkResults(result, {
      browser,
      surface,
      url: surface === "cm5"
        ? "http://127.0.0.1:4173/tests/codemirror6/generated/cm5-editor.html"
        : "http://127.0.0.1:4173/editor.html"
    }), filename)
  }
})

test("benchmark output uses a sibling temporary file and preserves the old file on interruption", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "puzzlescript-performance-"))
  t.after(() => rm(directory, {recursive: true, force: true}))
  const outputPath = path.join(directory, "baseline.json")
  await writeFile(outputPath, "old\n")

  await assert.rejects(writeJsonAtomically(outputPath, {fresh: true}, {
    async writeFile(temporaryPath, contents) {
      assert.equal(path.dirname(temporaryPath), directory)
      assert.notEqual(temporaryPath, outputPath)
      await writeFile(temporaryPath, contents)
      throw new Error("interrupted write")
    }
  }), /interrupted write/)

  assert.equal(await readFile(outputPath, "utf8"), "old\n")
  assert.deepEqual(await readdir(directory), ["baseline.json"])

  await writeJsonAtomically(outputPath, {fresh: true})
  assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), {fresh: true})
})

test("Chrome heap validation rejects nonfinite samples and summaries", () => {
  const summary = value => ({samples: Array(20).fill(value), median: value, p95: value, min: value, max: value})
  assert.doesNotThrow(() => validateHeapResults({
    supported: true,
    initial: summary(2.5),
    large: summary(5.5)
  }))
  assert.throws(() => validateHeapResults({
    supported: true,
    initial: summary(Number.NaN),
    large: summary(5.5)
  }), /heap\.initial\.samples/)
  assert.throws(() => validateHeapResults({
    supported: true,
    initial: {...summary(2.5), p95: Number.POSITIVE_INFINITY},
    large: summary(5.5)
  }), /heap\.initial\.p95/)
})

test("Chrome heap collection uses a fresh page and CDP garbage collection for every sample", async () => {
  const calls = {
    pages: 0,
    closed: 0,
    garbageCollections: 0,
    heapUsage: 0,
    harnessScripts: 0,
    currentMountSettles: 0,
    largeSettles: 0
  }
  const browser = {
    async newPage(options) {
      calls.pages += 1
      assert.deepEqual(options, {viewport: {width: 1280, height: 900}})
      let pageErrorHandler
      let navigated = false
      return {
        on(event, handler) {
          assert.equal(navigated, false)
          assert.equal(event, "pageerror")
          pageErrorHandler = handler
        },
        async goto() {
          assert.equal(typeof pageErrorHandler, "function")
          navigated = true
        },
        async waitForSelector() {},
        async addScriptTag({content}) {
          assert.equal(content, "/* harness */")
          calls.harnessScripts += 1
        },
        async evaluate(callback, argument) {
          if (argument === undefined) return true
          if (argument.name === "currentMountSettled") {
            assert.equal(argument.inputs.largeSource.length, 129_721)
            calls.currentMountSettles += 1
          } else if (argument.name === "loadDistantJumpExact") {
            assert.equal(argument.inputs.largeSource.length, 129_721)
            calls.largeSettles += 1
          } else {
            throw new Error(`Unexpected heap evaluation: ${JSON.stringify(argument)}`)
          }
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
    ...performanceInputs(),
    largeSource: "x".repeat(129_721)
  }, "/* harness */")
  assert.deepEqual(calls, {
    pages: 20,
    closed: 20,
    garbageCollections: 40,
    heapUsage: 40,
    harnessScripts: 20,
    currentMountSettles: 20,
    largeSettles: 20
  })
  assert.equal(heap.initial.samples.length, 20)
  assert.equal(heap.large.samples.length, 20)
})

test("Chrome heap rejects a page error attached before navigation and still closes the sample", async () => {
  const order = []
  const browser = {
    async newPage() {
      let pageErrorHandler
      return {
        on(event, handler) { order.push(`on:${event}`); pageErrorHandler = handler },
        async goto() { order.push("goto"); pageErrorHandler(new Error("parser exploded")) },
        async waitForSelector() {},
        async evaluate() { return true },
        async addScriptTag() {},
        async close() { order.push("close") }
      }
    }
  }

  await assert.rejects(collectChromeHeap(browser, "http://example.test/editor.html", "cm6", {
    ...performanceInputs(),
    largeSource: "x".repeat(129_721)
  }, "/* harness */"), /parser exploded/)
  assert.deepEqual(order, ["on:pageerror", "goto", "close"])
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
    async () => { throw new Error("benchmark failed") },
    async driver => { driver.kill("SIGTERM") }
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

test("Safari async benchmark requests outlive the configured script timeout", async () => {
  const calls = []
  const request = async (...args) => { calls.push(args); return true }

  await safariExecute("session", "return true", [], false, request)
  await safariExecute("session", "done()", [], true, request)

  assert.equal(calls[0][3], 30_000)
  assert.equal(calls[1][3], 610_000)
})

test("Safari connection terminates an owned driver when readiness fails", async () => {
  const stopped = []
  const driver = {exitCode: null}

  await assert.rejects(connectSafari({
    async request(pathname) {
      if (pathname === "/status") throw new Error("no existing driver")
      throw new Error(`unexpected request ${pathname}`)
    },
    spawnDriver() { return driver },
    async waitForDriver() { throw new Error("readiness failed") },
    async stopDriver(value) { stopped.push(value) }
  }), /readiness failed/)

  assert.deepEqual(stopped, [driver])
})

test("Safari cleanup aggregates deletion failure with the primary error and stops its driver", async () => {
  const stopped = []
  const primary = new Error("benchmark failed")
  const deletion = new Error("delete failed")
  const driver = {}

  await assert.rejects(withSafariSessionLifecycle(
    async () => ({driver, sessionId: "owned"}),
    async () => { throw deletion },
    async () => { throw primary },
    async value => { stopped.push(value) }
  ), error => {
    assert.equal(error instanceof AggregateError, true)
    assert.deepEqual(error.errors, [primary, deletion])
    assert.equal(error.cause, primary)
    return true
  })
  assert.deepEqual(stopped, [driver])
})

test("owned Safari driver termination escalates from TERM to KILL and awaits exit", async () => {
  const driver = new EventEmitter()
  const signals = []
  driver.exitCode = null
  driver.signalCode = null
  driver.kill = signal => {
    signals.push(signal)
    if (signal === "SIGKILL") queueMicrotask(() => {
      driver.signalCode = signal
      driver.emit("exit", null, signal)
    })
    return true
  }

  await terminateOwnedDriver(driver, {termTimeout: 1, killTimeout: 100})
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"])
})
