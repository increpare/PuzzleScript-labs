#!/usr/bin/env node

import {randomUUID} from "node:crypto"
import {execFile} from "node:child_process"
import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises"
import path from "node:path"
import {promisify} from "node:util"
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
const execFileAsync = promisify(execFile)
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
    "--base-url http://127.0.0.1:4173 --output /path/to/result.json [--cpu-throttle 4]")
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
    if (!["browser", "surface", "base-url", "output", "cpu-throttle"].includes(key)) {
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
  if (values["cpu-throttle"] !== undefined) {
    if (values.browser !== "chrome") throw usageError("--cpu-throttle is Chrome only")
    if (values["cpu-throttle"] !== "4") throw usageError("--cpu-throttle must equal 4")
  }

  return {
    browser: values.browser,
    surface: values.surface,
    baseUrl: values["base-url"].replace(/\/+$/, ""),
    output: values.output,
    ...(values["cpu-throttle"] === undefined ? {} : {cpuThrottle: 4})
  }
}

export function surfaceUrl(options) {
  const pathname = options.surface === "cm5"
    ? "/tests/codemirror6/generated/cm5-editor.html"
    : "/tests/codemirror6/generated/cm6-performance-editor.html"
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

function serializePerformanceError(value) {
  if (value && typeof value === "object") {
    let name = ""
    let message = ""
    try {
      if (typeof value.name === "string") name = value.name
    } catch {}
    try {
      if (typeof value.message === "string") message = value.message
    } catch {}
    if (name || message) return name && message ? `${name}: ${message}` : name || message
    try {
      const json = JSON.stringify(value)
      if (json !== undefined) return json
    } catch {}
  }
  try {
    return String(value)
  } catch {
    return "[unserializable error]"
  }
}

function capturedPageError(value) {
  return `error: ${serializePerformanceError(value)}`
}

export function mergePerformancePageErrors(nativeErrors, pageBuffer) {
  for (const errors of [nativeErrors, pageBuffer]) {
    if (!Array.isArray(errors) || errors.some(error => typeof error !== "string")) {
      throw new Error("Performance error buffer must be an array of strings")
    }
  }
  return [...new Set([...nativeErrors, ...pageBuffer])]
}

async function readChromePageErrors(page, nativeErrors) {
  const pageBuffer = await page.evaluate(
    () => window.__puzzleScriptPerformanceErrors?.slice()
  )
  return mergePerformancePageErrors(nativeErrors, pageBuffer)
}

async function requireNoChromePageErrors(page, nativeErrors, label) {
  throwPageErrors(await readChromePageErrors(page, nativeErrors), label)
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
    page.on("pageerror", error => pageErrors.push(capturedPageError(error)))
    try {
      await page.goto(url, {waitUntil: "networkidle"})
      await waitForChromeEditor(page, surface)
      await requireNoChromePageErrors(page, pageErrors, `Chrome heap sample ${index + 1}`)
      await page.addScriptTag({content: heapHarnessSource})
      await runHeapSettleScenario(page, "currentMountSettled", inputs)
      await requireNoChromePageErrors(page, pageErrors, `Chrome initial heap sample ${index + 1}`)
      const session = await page.context().newCDPSession(page)
      await session.send("HeapProfiler.collectGarbage")
      const initialUsage = await session.send("Runtime.getHeapUsage")
      initial.push(initialUsage.usedSize / 1024 / 1024)
      await runHeapSettleScenario(page, "loadDistantJumpExact", inputs)
      await requireNoChromePageErrors(page, pageErrors, `Chrome large heap sample ${index + 1}`)
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

export async function applyChromeCpuThrottle(page, rate) {
  const session = await page.context().newCDPSession(page)
  await session.send("Emulation.setCPUThrottlingRate", {rate})
}

async function runChrome(options, harnessSource, inputs) {
  const browser = await launchInstalledChrome()
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 900}})
    const pageErrors = []
    page.on("pageerror", error => pageErrors.push(capturedPageError(error)))
    if (options.cpuThrottle) await applyChromeCpuThrottle(page, options.cpuThrottle)
    await page.goto(surfaceUrl(options), {waitUntil: "networkidle"})
    await waitForChromeEditor(page, options.surface)
    await requireNoChromePageErrors(page, pageErrors, "Chrome load")
    await page.addScriptTag({content: harnessSource})
    const result = await page.evaluate(inputs => window.PuzzleScriptPerformance.runAll(inputs), inputs)
    const environment = await page.evaluate(() => ({
      visibilityState: document.visibilityState,
      pageErrors: window.__puzzleScriptPerformanceErrors?.slice()
    }))
    if (environment.visibilityState !== "visible") throw new Error("Chrome benchmark page is backgrounded")
    environment.pageErrors = mergePerformancePageErrors(pageErrors, environment.pageErrors)
    throwPageErrors(environment.pageErrors, "Chrome")
    const version = browser.version()
    await page.close()
    const heap = await collectChromeHeap(browser, surfaceUrl(options), options.surface, inputs, harnessSource)
    return {browser: {name: "chrome", version}, environment, ...result, heap}
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

async function activateInstalledSafari() {
  await execFileAsync("/usr/bin/open", ["-a", "Safari"])
}

export async function ensureSafariForeground(sessionId, overrides = {}) {
  const execute = overrides.execute || safariExecute
  const activate = overrides.activate || activateInstalledSafari
  const delay = overrides.delay || (milliseconds =>
    new Promise(resolve => setTimeout(resolve, milliseconds)))
  let activated = false
  for (let attempt = 0; attempt < 300; attempt++) {
    const visibility = await execute(sessionId, "return document.visibilityState")
    if (visibility === "visible") return
    if (!activated) {
      await activate()
      activated = true
    }
    await delay(100)
  }
  throw new Error("Safari benchmark visibilityState remained hidden after 30s foreground wait")
}

const safariScenarioBatchScript = [
  "const inputs = arguments[0];",
  "const name = arguments[1];",
  "const warmups = arguments[2];",
  "const samples = arguments[3];",
  "const done = arguments[arguments.length - 1];",
  "(async () => {",
  "  for (let index = 0; index < warmups; index++) {",
  "    await window.PuzzleScriptPerformance.runScenario(name, inputs);",
  "  }",
  "  const values = [];",
  "  for (let index = 0; index < samples; index++) {",
  "    values.push(await window.PuzzleScriptPerformance.runScenario(name, inputs));",
  "  }",
  "  return samples === 1 ? values[0] : window.PuzzleScriptPerformance.summarize(values);",
  "})()",
  "  .then(value => done({status: 'success', value}))",
  "  .catch(error => {",
  "    const message = String(error && error.message || error);",
  "    const stack = String(error && error.stack || '');",
  "    done({status: 'failure', message: stack && !stack.includes(message) ? message + '\\n' + stack : message});",
  "  });"
].join("\n")

async function runSafariScenarioBatch(sessionId, inputs, name, warmups, samples, execute) {
  const result = await execute(
    sessionId,
    safariScenarioBatchScript,
    [inputs, name, warmups, samples],
    true
  )
  if (!result || result.status !== "success") {
    throw new Error(result?.message || "Safari benchmark scenario returned an invalid result")
  }
  return result.value
}

export async function collectSafariScenarioSummaries(
  sessionId,
  inputs,
  execute = safariExecute
) {
  const summaries = {}
  for (const name of SCENARIO_NAMES) {
    if (name !== "loadDistantJumpExact") {
      summaries[name] = await runSafariScenarioBatch(
        sessionId,
        inputs,
        name,
        WARMUP_COUNT,
        SAMPLE_COUNT,
        execute
      )
      continue
    }

    const samples = []
    for (let index = 0; index < SAMPLE_COUNT; index++) {
      samples.push(await runSafariScenarioBatch(
        sessionId,
        inputs,
        name,
        index === 0 ? WARMUP_COUNT : 0,
        1,
        execute
      ))
    }
    summaries[name] = summarize(samples)
  }
  return summaries
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
      await ensureSafariForeground(sessionId)
      const loadErrors = mergePerformancePageErrors([], await safariExecute(
        sessionId,
        "return window.__puzzleScriptPerformanceErrors && window.__puzzleScriptPerformanceErrors.slice()"
      ))
      throwPageErrors(loadErrors, "Safari load")
      await safariExecute(sessionId, [
        "(0, eval)(arguments[0]);",
        "return true;"
      ].join("\n"), [harnessSource])
      const summaries = await collectSafariScenarioSummaries(sessionId, inputs)
      const environment = await safariExecute(sessionId,
        "return {visibilityState: document.visibilityState, pageErrors: window.__puzzleScriptPerformanceErrors && window.__puzzleScriptPerformanceErrors.slice()}"
      )
      if (environment.visibilityState !== "visible") throw new Error("Safari benchmark page is backgrounded")
      environment.pageErrors = mergePerformancePageErrors([], environment.pageErrors)
      throwPageErrors(environment.pageErrors, "Safari")
      return {
        browser: {name: "safari", version: capabilities.browserVersion || "unknown"},
        environment,
        warmups: WARMUP_COUNT,
        samples: SAMPLE_COUNT,
        sourceLengths: {
          representative: inputs.representativeSource.length,
          completion: inputs.completion.source.length + inputs.completion.key.length,
          large: inputs.largeSource.length
        },
        summaries,
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
