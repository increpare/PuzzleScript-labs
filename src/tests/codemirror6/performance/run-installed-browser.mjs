#!/usr/bin/env node

import {spawn} from "node:child_process"
import {mkdir, readFile, writeFile} from "node:fs/promises"
import path from "node:path"
import {fileURLToPath, pathToFileURL} from "node:url"

import {chromium} from "@playwright/test"

import {buildPerformancePages} from "../build-performance-pages.mjs"
import {autocompleteCases} from "../fixtures/autocomplete-cases.js"
import {distantPosition, largeSource} from "../fixtures/large-source.js"
import {representativeSource} from "../browser/helpers.mjs"

const directory = path.dirname(fileURLToPath(import.meta.url))
const harnessPath = path.join(directory, "harness.js")
const SAFARIDRIVER = "http://127.0.0.1:4444"
const SAMPLE_COUNT = 20

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
    completion: {source, cursor: cursorAtEnd(source), key}
  }
}

function assertFiniteResults(result) {
  for (const [name, summary] of Object.entries(result.summaries || {})) {
    for (const field of ["median", "p95", "min", "max"]) {
      if (!Number.isFinite(summary[field])) throw new Error(`${name}.${field} is not finite`)
    }
    if (!Array.isArray(summary.samples) || summary.samples.some(value => !Number.isFinite(value))) {
      throw new Error(`${name}.samples contains a non-finite result`)
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

function validateSummary(summary, label) {
  if (!summary || !Array.isArray(summary.samples) || summary.samples.length === 0 ||
      summary.samples.some(value => !Number.isFinite(value))) {
    throw new Error(`${label}.samples contains a non-finite result`)
  }
  for (const field of ["median", "p95", "min", "max"]) {
    if (!Number.isFinite(summary[field])) throw new Error(`${label}.${field} is not finite`)
  }
}

export function validateHeapResults(heap) {
  if (!heap || heap.supported !== true) throw new Error("Chrome heap results must be supported")
  validateSummary(heap.initial, "heap.initial")
  validateSummary(heap.large, "heap.large")
}

async function waitForChromeEditor(page, surface) {
  const selector = surface === "cm5" ? ".CodeMirror" : ".cm-editor"
  await page.waitForSelector(selector, {state: "visible", timeout: 30_000})
  const mounted = await page.evaluate(() => Boolean(document.querySelector("#code")?.editorreference))
  if (!mounted) throw new Error("Expected editor adapter is missing")
}

export async function collectChromeHeap(browser, url, surface, inputs) {
  const initial = []
  const large = []
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const page = await browser.newPage({viewport: {width: 1280, height: 900}})
    try {
      await page.goto(url, {waitUntil: "networkidle"})
      await waitForChromeEditor(page, surface)
      const session = await page.context().newCDPSession(page)
      await session.send("HeapProfiler.collectGarbage")
      const initialUsage = await session.send("Runtime.getHeapUsage")
      initial.push(initialUsage.usedSize / 1024 / 1024)
      await page.evaluate(source => {
        const editor = document.querySelector("#code").editorreference
        ;(editor.replaceDocument || editor.setValue).call(editor, source)
        return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      }, inputs.largeSource)
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
    assertFiniteResults(result)
    if (environment.visibilityState !== "visible") throw new Error("Chrome benchmark page is backgrounded")
    if (pageErrors.length) throw new Error(`Chrome page errors: ${pageErrors.join("; ")}`)
    const version = browser.version()
    await page.close()
    const heap = await collectChromeHeap(browser, surfaceUrl(options), options.surface, inputs)
    return {browser: {name: "chrome", version}, environment: {...environment, pageErrors}, ...result, heap}
  } finally {
    await browser.close()
  }
}

async function webdriverRequest(pathname, method = "GET", body) {
  const response = await fetch(SAFARIDRIVER + pathname, {
    method,
    headers: body === undefined ? undefined : {"content-type": "application/json"},
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  })
  const payload = await response.json()
  if (!response.ok || payload.value?.error) {
    throw new Error(payload.value?.message || `SafariDriver ${method} ${pathname} failed (${response.status})`)
  }
  return payload.value
}

async function waitForSafariDriver(process) {
  const deadline = Date.now() + 20_000
  let lastError
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`safaridriver exited with ${process.exitCode}`)
    try {
      await webdriverRequest("/status")
      return
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }
  throw new Error(`safaridriver did not become ready: ${lastError}`)
}

async function connectSafari() {
  let driver = null
  try {
    await webdriverRequest("/status")
  } catch {
    driver = spawn("safaridriver", ["-p", "4444"], {stdio: ["ignore", "pipe", "pipe"]})
    await waitForSafariDriver(driver)
  }

  try {
    const value = await webdriverRequest("/session", "POST", {
      capabilities: {alwaysMatch: {browserName: "safari"}}
    })
    return {driver, sessionId: value.sessionId, capabilities: value.capabilities || {}}
  } catch (error) {
    if (driver) driver.kill("SIGTERM")
    throw error
  }
}

async function safariExecute(sessionId, script, args = [], async = false) {
  return webdriverRequest(
    `/session/${sessionId}/execute/${async ? "async" : "sync"}`,
    "POST",
    {script, args}
  )
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

export async function withSafariSessionLifecycle(connect, deleteSession, operation) {
  const connection = await connect()
  try {
    return await operation(connection)
  } finally {
    try {
      await deleteSession(connection.sessionId)
    } finally {
      if (connection.driver) connection.driver.kill("SIGTERM")
    }
  }
}

async function runSafari(options, harnessSource, inputs) {
  return withSafariSessionLifecycle(
    connectSafari,
    sessionId => webdriverRequest(`/session/${sessionId}`, "DELETE"),
    async ({sessionId, capabilities}) => {
      await webdriverRequest(`/session/${sessionId}/timeouts`, "POST", {script: 600_000})
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
      assertFiniteResults(result.value)
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
  await mkdir(path.dirname(path.resolve(options.output)), {recursive: true})
  await writeFile(options.output, JSON.stringify(output, null, 2) + "\n")
  console.log(`Wrote ${options.output}`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
