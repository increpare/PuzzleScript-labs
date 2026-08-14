#!/usr/bin/env node

import {randomUUID} from "node:crypto"
import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises"
import path from "node:path"
import {fileURLToPath, pathToFileURL} from "node:url"

import {chromium} from "@playwright/test"

import {buildPerformancePages} from "../build-performance-pages.mjs"
import {autocompleteCases} from "../fixtures/autocomplete-cases.js"
import {distantPosition, largeSource} from "../fixtures/large-source.js"
import {representativeSource} from "../browser/helpers.mjs"
import {
  connectSafari,
  safariExecute,
  WEBDRIVER_SCRIPT_TIMEOUT_MS,
  webdriverRequest,
  withSafariSessionLifecycle
} from "./safari-webdriver.mjs"

export {
  connectSafari,
  safariExecute,
  terminateOwnedDriver,
  webdriverRequest,
  withSafariSessionLifecycle
} from "./safari-webdriver.mjs"

const directory = path.dirname(fileURLToPath(import.meta.url))
const harnessPath = path.join(directory, "harness.js")
const WARMUP_COUNT = 5
const SAMPLE_COUNT = 20
const SCENARIO_NAMES = Object.freeze([
  "keyToNextPaint",
  "autocompleteVisible",
  "hundredApiEdits",
  "replaceDocumentSync",
  "replaceDocumentSettled",
  "loadDistantJumpExact",
  "cursorFocusSearchSettled"
])

function usageError(message) {
  return new Error(`${message}\nUsage: --browser chrome|safari --surface cm5|cm6 ` +
    "--base-url http://127.0.0.1:4173 --output /path/to/result.json")
}

export function parseArguments(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index]
    const value = argv[index + 1]
    if (!option || !option.startsWith("--") || value === undefined) {
      throw usageError(`Invalid argument: ${option || "<missing>"}`)
    }
    const key = option.slice(2)
    if (!["browser", "surface", "base-url", "output"].includes(key)) {
      throw usageError(`Unknown option: ${option}`)
    }
    values[key] = value
  }

  for (const option of ["browser", "surface", "base-url", "output"]) {
    if (!values[option]) throw usageError(`Missing required --${option}`)
  }
  if (!["chrome", "safari"].includes(values.browser)) {
    throw usageError("--browser must be chrome|safari")
  }
  if (!["cm5", "cm6"].includes(values.surface)) {
    throw usageError("--surface must be cm5|cm6")
  }

  return {
    browser: values.browser,
    surface: values.surface,
    baseUrl: values["base-url"].replace(/\/+$/, ""),
    output: values.output
  }
}

export function surfaceUrl(options) {
  const pathname = options.surface === "cm5"
    ? "/tests/codemirror6/generated/cm5-editor.html"
    : "/editor.html"
  return options.baseUrl + pathname
}

function cursorAtEnd(source) {
  const lines = source.split("\n")
  return {line: lines.length - 1, column: lines[lines.length - 1].length}
}

function harnessInputs() {
  const completionCase = autocompleteCases.find(candidate => candidate.name === "rule-directions")
  if (!completionCase) throw new Error("Missing rule-directions autocomplete fixture")
  const key = completionCase.source.slice(-1)
  const source = completionCase.source.slice(0, -1)
  return {
    representativeSource,
    largeSource,
    distantLine: largeSource.slice(0, distantPosition).split("\n").length - 1,
    distantColumn: 39,
    completion: {
      source,
      cursor: cursorAtEnd(source),
      key,
      expectedLabels: completionCase.expected.list.map(item => item.text)
    }
  }
}

function summarize(values) {
  const samples = values.slice().sort((left, right) => left - right)
  const midpoint = Math.floor(samples.length / 2)
  return {
    samples,
    median: samples.length % 2 ? samples[midpoint] : (samples[midpoint - 1] + samples[midpoint]) / 2,
    p95: samples[Math.ceil(samples.length * 0.95) - 1],
    min: samples[0],
    max: samples[samples.length - 1]
  }
}

function validateKeys(value, expectedKeys, label) {
  const actualKeys = value && typeof value === "object" ? Object.keys(value).sort() : []
  const expected = [...expectedKeys].sort()
  if (JSON.stringify(actualKeys) !== JSON.stringify(expected)) {
    throw new Error(`${label} keys must be exactly: ${expectedKeys.join(", ")}`)
  }
}

function validateSummary(summary, label) {
  validateKeys(summary, ["samples", "median", "p95", "min", "max"], label)
  if (!summary || !Array.isArray(summary.samples) || summary.samples.length !== SAMPLE_COUNT ||
      summary.samples.some(value => !Number.isFinite(value))) {
    throw new Error(`${label}.samples must contain exactly ${SAMPLE_COUNT} finite results`)
  }
  for (const field of ["median", "p95", "min", "max"]) {
    if (!Number.isFinite(summary[field])) throw new Error(`${label}.${field} is not finite`)
  }
  const expected = summarize(summary.samples)
  for (const field of ["median", "p95", "min", "max"]) {
    if (summary[field] !== expected[field]) {
      throw new Error(`${label}.${field} is inconsistent with its samples`)
    }
  }
  if (summary.samples.some((value, index) => index > 0 && summary.samples[index - 1] > value)) {
    throw new Error(`${label}.samples must be sorted`)
  }
}

export function validateHeapResults(heap) {
  if (!heap || heap.supported !== true) throw new Error("Chrome heap results must be supported")
  validateSummary(heap.initial, "heap.initial")
  validateSummary(heap.large, "heap.large")
}

export function validateBenchmarkResults(result, expected) {
  validateKeys(result, [
    "capturedAt",
    "surface",
    "url",
    "browser",
    "environment",
    "warmups",
    "samples",
    "sourceLengths",
    "summaries",
    "heap"
  ], "top-level")
  if (!expected || !["chrome", "safari"].includes(expected.browser) ||
      !["cm5", "cm6"].includes(expected.surface) || typeof expected.url !== "string") {
    throw new Error("Expected browser, surface, and URL are required for result validation")
  }
  if (typeof result.capturedAt !== "string" || !Number.isFinite(Date.parse(result.capturedAt))) {
    throw new Error("capturedAt must be a valid timestamp")
  }
  if (result.surface !== expected.surface) {
    throw new Error(`surface must equal ${expected.surface}`)
  }
  if (result.url !== expected.url) throw new Error(`url must equal ${expected.url}`)

  validateKeys(result.browser, ["name", "version"], "browser")
  if (result.browser.name !== expected.browser) {
    throw new Error(`browser.name must equal ${expected.browser}`)
  }
  if (typeof result.browser.version !== "string" || result.browser.version.length === 0) {
    throw new Error("browser.version must be a non-empty string")
  }

  validateKeys(result.environment, ["visibilityState", "pageErrors"], "environment")
  if (result.environment.visibilityState !== "visible") {
    throw new Error("environment.visibilityState must equal visible")
  }
  if (!Array.isArray(result.environment.pageErrors) || result.environment.pageErrors.length !== 0) {
    throw new Error("environment.pageErrors must be an empty array")
  }

  if (result?.warmups !== WARMUP_COUNT) throw new Error(`warmups must equal ${WARMUP_COUNT}`)
  if (result.samples !== SAMPLE_COUNT) throw new Error(`samples must equal ${SAMPLE_COUNT}`)

  const inputs = harnessInputs()
  const expectedLengths = {
    representative: inputs.representativeSource.length,
    completion: inputs.completion.source.length + inputs.completion.key.length,
    large: inputs.largeSource.length
  }
  validateKeys(result.sourceLengths, Object.keys(expectedLengths), "sourceLengths")
  for (const [name, expected] of Object.entries(expectedLengths)) {
    if (result.sourceLengths?.[name] !== expected) {
      throw new Error(`sourceLengths.${name} must equal ${expected}`)
    }
  }

  const names = Object.keys(result.summaries || {}).sort()
  const expectedNames = [...SCENARIO_NAMES].sort()
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    throw new Error(`scenario keys must be exactly: ${SCENARIO_NAMES.join(", ")}`)
  }
  for (const name of SCENARIO_NAMES) validateSummary(result.summaries[name], name)

  if (expected.browser === "chrome") {
    validateKeys(result.heap, ["supported", "unit", "initial", "large"], "heap")
    if (result.heap.unit !== "MiB") throw new Error("heap.unit must equal MiB")
    validateHeapResults(result.heap)
  } else {
    validateKeys(result.heap, ["supported", "reason"], "heap")
    if (result.heap.supported !== false) throw new Error("Safari heap.supported must be false")
    if (typeof result.heap.reason !== "string" || result.heap.reason.length === 0) {
      throw new Error("heap.reason must be a non-empty string")
    }
  }
}

export async function writeJsonAtomically(outputPath, value, overrides = {}) {
  const fileSystem = {mkdir, writeFile, rename, rm, ...overrides}
  const destination = path.resolve(outputPath)
  const outputDirectory = path.dirname(destination)
  const temporaryPath = path.join(
    outputDirectory,
    `.${path.basename(destination)}.${process.pid}.${randomUUID()}.tmp`
  )
  await fileSystem.mkdir(outputDirectory, {recursive: true})
  try {
    await fileSystem.writeFile(temporaryPath, JSON.stringify(value, null, 2) + "\n")
    await fileSystem.rename(temporaryPath, destination)
  } catch (error) {
    try {
      await fileSystem.rm(temporaryPath, {force: true})
    } catch {}
    throw error
  }
}

async function waitForChromeEditor(page, surface) {
  const selector = surface === "cm5" ? ".CodeMirror" : ".cm-editor"
  await page.waitForSelector(selector, {state: "visible", timeout: 30_000})
  const mounted = await page.evaluate(() => Boolean(document.querySelector("#code")?.editorreference))
  if (!mounted) throw new Error("Expected editor adapter is missing")
}

function throwPageErrors(pageErrors, label) {
  if (pageErrors.length) throw new Error(`${label} page errors: ${pageErrors.join("; ")}`)
}

async function runHeapSettleScenario(page, name, inputs) {
  await page.evaluate(
    ({name, inputs}) => window.PuzzleScriptPerformance.runScenario(name, inputs),
    {name, inputs}
  )
}

export async function collectChromeHeap(browser, url, surface, inputs, suppliedHarnessSource) {
  const heapHarnessSource = suppliedHarnessSource ?? await readFile(harnessPath, "utf8")
  const initial = []
  const large = []
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const page = await browser.newPage({viewport: {width: 1280, height: 900}})
    const pageErrors = []
    page.on("pageerror", error => pageErrors.push(String(error)))
    try {
      await page.goto(url, {waitUntil: "networkidle"})
      await waitForChromeEditor(page, surface)
      throwPageErrors(pageErrors, `Chrome heap sample ${index + 1}`)
      await page.addScriptTag({content: heapHarnessSource})
      await runHeapSettleScenario(page, "currentMountSettled", inputs)
      throwPageErrors(pageErrors, `Chrome initial heap sample ${index + 1}`)
      const session = await page.context().newCDPSession(page)
      await session.send("HeapProfiler.collectGarbage")
      const initialUsage = await session.send("Runtime.getHeapUsage")
      initial.push(initialUsage.usedSize / 1024 / 1024)
      await runHeapSettleScenario(page, "loadDistantJumpExact", inputs)
      throwPageErrors(pageErrors, `Chrome large heap sample ${index + 1}`)
      await session.send("HeapProfiler.collectGarbage")
      const largeUsage = await session.send("Runtime.getHeapUsage")
      large.push(largeUsage.usedSize / 1024 / 1024)
    } finally {
      await page.close()
    }
  }
  const result = {supported: true, unit: "MiB", initial: summarize(initial), large: summarize(large)}
  validateHeapResults(result)
  return result
}

export function launchInstalledChrome(chromiumImplementation = chromium) {
  return chromiumImplementation.launch({channel: "chrome"})
}

async function runChrome(options, harnessSource, inputs) {
  const browser = await launchInstalledChrome()
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 900}})
    const pageErrors = []
    page.on("pageerror", error => pageErrors.push(String(error)))
    await page.goto(surfaceUrl(options), {waitUntil: "networkidle"})
    await waitForChromeEditor(page, options.surface)
    await page.addScriptTag({content: harnessSource})
    const result = await page.evaluate(inputs => window.PuzzleScriptPerformance.runAll(inputs), inputs)
    const environment = await page.evaluate(() => ({visibilityState: document.visibilityState}))
    if (environment.visibilityState !== "visible") throw new Error("Chrome benchmark page is backgrounded")
    if (pageErrors.length) throw new Error(`Chrome page errors: ${pageErrors.join("; ")}`)
    const version = browser.version()
    await page.close()
    const heap = await collectChromeHeap(browser, surfaceUrl(options), options.surface, inputs, harnessSource)
    return {browser: {name: "chrome", version}, environment: {...environment, pageErrors}, ...result, heap}
  } finally {
    await browser.close()
  }
}

async function waitForSafariEditor(sessionId, surface) {
  const selector = surface === "cm5" ? ".CodeMirror" : ".cm-editor"
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await safariExecute(sessionId,
      "return !!document.querySelector(arguments[0]) && !!document.querySelector('#code').editorreference",
      [selector])) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error("Expected Safari editor root or adapter is missing")
}

async function runSafari(options, harnessSource, inputs) {
  return withSafariSessionLifecycle(
    connectSafari,
    sessionId => webdriverRequest(`/session/${sessionId}`, "DELETE"),
    async ({sessionId, capabilities}) => {
      await webdriverRequest(`/session/${sessionId}/timeouts`, "POST", {script: WEBDRIVER_SCRIPT_TIMEOUT_MS})
      await webdriverRequest(`/session/${sessionId}/window/rect`, "POST", {width: 1280, height: 900})
      await webdriverRequest(`/session/${sessionId}/url`, "POST", {url: surfaceUrl(options)})
      await waitForSafariEditor(sessionId, options.surface)
      await safariExecute(sessionId, [
        "window.__puzzleScriptPerformanceErrors = [];",
        "window.addEventListener('error', event => window.__puzzleScriptPerformanceErrors.push(String(event.error || event.message)));",
        "(0, eval)(arguments[0]);",
        "return true;"
      ].join("\n"), [harnessSource])
      const result = await safariExecute(sessionId, [
        "const done = arguments[arguments.length - 1];",
        "Promise.resolve(window.PuzzleScriptPerformance.runAll(arguments[0]))",
        "  .then(value => done({value}))",
        "  .catch(error => done({error: String(error && (error.stack || error.message) || error)}));"
      ].join("\n"), [inputs], true)
      if (result.error) throw new Error(result.error)
      const environment = await safariExecute(sessionId,
        "return {visibilityState: document.visibilityState, pageErrors: window.__puzzleScriptPerformanceErrors.slice()}"
      )
      if (environment.visibilityState !== "visible") throw new Error("Safari benchmark page is backgrounded")
      if (environment.pageErrors.length) throw new Error(`Safari page errors: ${environment.pageErrors.join("; ")}`)
      return {
        browser: {name: "safari", version: capabilities.browserVersion || "unknown"},
        environment,
        ...result.value,
        heap: {supported: false, reason: "SafariDriver does not expose repeatable JavaScript heap usage"}
      }
    }
  )
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  await buildPerformancePages()
  const harnessSource = await readFile(harnessPath, "utf8")
  const inputs = harnessInputs()
  const measurements = options.browser === "chrome"
    ? await runChrome(options, harnessSource, inputs)
    : await runSafari(options, harnessSource, inputs)
  const output = {
    capturedAt: new Date().toISOString(),
    surface: options.surface,
    url: surfaceUrl(options),
    ...measurements
  }
  validateBenchmarkResults(output, {
    browser: options.browser,
    surface: options.surface,
    url: surfaceUrl(options)
  })
  await writeJsonAtomically(options.output, output)
  console.log(`Wrote ${options.output}`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
