import {expect, test} from "@playwright/test"
import {writeFile} from "node:fs/promises"
import path from "node:path"
import {fileURLToPath} from "node:url"

import {
  dynamicColourSource,
  editorMeasurements,
  rectFor,
  representativeSource,
  setEditorSource,
  setTheme,
  surfaces,
  wrappedSource
} from "./helpers.mjs"

test.skip(process.env.RUN_CM5_BASELINE !== "1", "CM5 baseline tests are opt-in after product cutover")

if (process.env.RUN_CM5_BASELINE === "1" && process.env.UPDATE_CM5_BASELINES !== "1") {
  throw new Error("Set UPDATE_CM5_BASELINES=1 only when intentionally capturing the CM5 baseline")
}

const here = path.dirname(fileURLToPath(import.meta.url))
const baselineDir = path.resolve(here, "../baselines/cm5")

async function openCM5(page) {
  await page.goto("/editor.html")
  await page.waitForFunction(() => {
    const code = document.getElementById("code")
    return !!(code && code.editorreference && document.querySelector(".CodeMirror"))
  })
  await page.evaluate(() => document.fonts && document.fonts.ready)
}

async function capture(page, projectName, theme, surface, fullPage = false) {
  if (!surfaces.includes(surface)) throw new Error(`Unknown baseline surface: ${surface}`)
  const output = path.join(baselineDir, `${projectName}-${theme}-${surface}.png`)
  const options = {path: output, animations: "disabled", caret: "hide"}
  if (fullPage) await page.screenshot({...options, fullPage: true})
  else await page.locator(surface === "search-replace" ? "#leftpanel" : ".CodeMirror").screenshot(options)
}

async function captureTheme(page, projectName, theme) {
  await setTheme(page, theme)

  await setEditorSource(page, "")
  await capture(page, projectName, theme, "empty")

  await setEditorSource(page, representativeSource, {line: 52, ch: 1})
  await capture(page, projectName, theme, "full-page", true)
  await capture(page, projectName, theme, "representative-syntax")
  await capture(page, projectName, theme, "active-line-gutter")

  await setEditorSource(page, wrappedSource, {line: 0, ch: 300})
  await capture(page, projectName, theme, "wrapped")

  await setEditorSource(page, "tit", {line: 0, ch: 3})
  await page.keyboard.type("l")
  await expect(page.locator(".CodeMirror-hints")).toBeVisible()
  await capture(page, projectName, theme, "autocomplete")
  await page.keyboard.press("Escape")

  await setEditorSource(page, "Alpha alpha ALPHA", {line: 0, ch: 0})
  await page.keyboard.press("Meta+f")
  await expect(page.locator(".CodeMirror-search-panel")).toBeVisible()
  await page.locator('.CodeMirror-search-field[name="search"]').fill("alpha")
  await capture(page, projectName, theme, "search-replace")
  await page.keyboard.press("Escape")

  await setEditorSource(page, dynamicColourSource, {line: 2, ch: 4})
  await capture(page, projectName, theme, "dynamic-colours")
}

test("capture immutable CM5 visual and geometry baseline", async ({page}, testInfo) => {
  await openCM5(page)

  for (const theme of ["light", "dark"]) await captureTheme(page, testInfo.project.name, theme)

  await setTheme(page, "dark")
  await setEditorSource(page, representativeSource, {line: 52, ch: 1})
  const measurements = await editorMeasurements(page)

  await setEditorSource(page, wrappedSource, {line: 0, ch: 300})
  measurements.wrappedLine = await rectFor(page, ".CodeMirror-line")

  await setEditorSource(page, "tit", {line: 0, ch: 3})
  await page.keyboard.type("l")
  await expect(page.locator(".CodeMirror-hints")).toBeVisible()
  measurements.autocomplete = await rectFor(page, ".CodeMirror-hints")
  await page.keyboard.press("Escape")

  await setEditorSource(page, "Alpha alpha ALPHA", {line: 0, ch: 0})
  await page.keyboard.press("Meta+f")
  await expect(page.locator(".CodeMirror-search-panel")).toBeVisible()
  measurements.searchPanel = await rectFor(page, ".CodeMirror-search-panel")
  measurements.rootWithSearch = await rectFor(page, ".CodeMirror")

  await writeFile(
    path.join(baselineDir, `measurements-${testInfo.project.name}.json`),
    JSON.stringify(measurements, null, 2) + "\n"
  )
})

async function captureShortcutData(page, platform) {
  return page.evaluate(platform => {
    const cm = document.querySelector(".CodeMirror").CodeMirror

    function label(binding) {
      return typeof binding === "string" ? binding : `function:${binding.name || "anonymous"}`
    }

    function rawMap(map) {
      const result = {}
      for (const [key, binding] of Object.entries(map)) {
        if (key === "name" || key === "fallthrough" || key === "attach" || key === "detach") continue
        result[key] = label(binding)
      }
      return result
    }

    function isRunnable(binding) {
      return typeof binding === "function" ||
        (typeof binding === "string" && typeof CodeMirror.commands[binding] === "function")
    }

    function addMap(result, map) {
      for (const [key, binding] of Object.entries(map)) {
        if (key === "name" || key === "fallthrough" || key === "attach" || key === "detach") continue
        if (!(key in result) && isRunnable(binding)) result[key] = label(binding)
      }
      const fallthrough = map.fallthrough == null ? [] :
        (Array.isArray(map.fallthrough) ? map.fallthrough : [map.fallthrough])
      for (const next of fallthrough) addMap(result, typeof next === "string" ? CodeMirror.keyMap[next] : next)
    }

    function effectiveMap(mapName) {
      const result = {}
      addMap(result, cm.options.extraKeys || {})
      addMap(result, CodeMirror.keyMap[mapName])
      return result
    }

    function eventFor(bindingName) {
      const parts = bindingName.split("-")
      const base = parts.pop()
      const entry = Object.entries(CodeMirror.keyNames).find(([, name]) => name === base)
      if (!entry) throw new Error(`No CM5 key code for ${bindingName}`)
      return {
        keyCode: Number(entry[0]),
        shiftKey: parts.includes("Shift"),
        ctrlKey: parts.includes("Ctrl"),
        altKey: parts.includes("Alt"),
        metaKey: parts.includes("Cmd"),
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() { this.defaultPrevented = true },
        stopPropagation() { this.propagationStopped = true }
      }
    }

    function resetFor(bindingName, popup) {
      CodeMirror.commands.clearSearch(cm)
      cm.closeHint()
      cm.setValue("  alpha beta\nsecond line\nthird line")
      cm.clearHistory()
      cm.setCursor({line: 1, ch: 6})
      if (/\bundo\b/i.test(bindingName)) cm.replaceSelection("X")
      if (/redo/i.test(bindingName)) {
        cm.replaceSelection("X")
        cm.undo()
      }
      if (popup) {
        cm.setValue("tit")
        cm.setCursor({line: 0, ch: 3})
        CodeMirror.commands.autocomplete(cm, null, {completeSingle: false})
      }
      cm.focus()
    }

    function snapshot(event) {
      return {
        value: cm.getValue(),
        selections: cm.listSelections().map(range => ({anchor: range.anchor, head: range.head})),
        overwrite: !!cm.state.overwrite,
        searchOpen: !!cm.getWrapperElement().querySelector(".CodeMirror-search-panel"),
        completionOpen: !!cm.state.completionActive,
        defaultPrevented: event.defaultPrevented,
        propagationStopped: event.propagationStopped
      }
    }

    function outcomesFor(bindings, popup = false) {
      const outcomes = {}
      for (const bindingName of Object.keys(bindings)) {
        resetFor(bindingName, popup)
        const event = eventFor(bindingName)
        cm.triggerOnKeyDown(event)
        outcomes[bindingName] = snapshot(event)
      }
      return outcomes
    }

    cm.setValue("tit")
    cm.setCursor({line: 0, ch: 3})
    CodeMirror.commands.autocomplete(cm, null, {completeSingle: false})
    const popupMap = cm.state.keyMaps.length ? rawMap(cm.state.keyMaps[0]) : {}
    cm.closeHint()

    const defaultName = platform === "mac" ? "macDefault" : "pcDefault"
    const effective = effectiveMap(defaultName)
    return {
      platform,
      raw: {
        basic: rawMap(CodeMirror.keyMap.basic),
        pcDefault: rawMap(CodeMirror.keyMap.pcDefault),
        macDefault: rawMap(CodeMirror.keyMap.macDefault),
        emacsy: rawMap(CodeMirror.keyMap.emacsy),
        extra: rawMap(cm.options.extraKeys || {}),
        popup: popupMap
      },
      effective,
      effectiveBindingNames: Object.keys(effective),
      popupBindingNames: Object.keys(popupMap),
      outcomes: outcomesFor(effective),
      popupOutcomes: outcomesFor(popupMap, true)
    }
  }, platform)
}

async function captureApplicationShortcuts(page, platform) {
  await page.evaluate(() => {
    window.__psShortcutCallbacks = {save: 0, rebuild: 0, run: 0, dump: 0, gif: 0}
    saveClick = () => window.__psShortcutCallbacks.save++
    rebuildClick = () => window.__psShortcutCallbacks.rebuild++
    runClick = () => window.__psShortcutCallbacks.run++
    dumpTestCase = () => window.__psShortcutCallbacks.dump++
    makeGIF = () => window.__psShortcutCallbacks.gif++
  })

  const primary = platform === "mac" ? "Meta" : "Control"
  const presses = [
    ["save", `${primary}+s`],
    ["rebuild", `${primary}+Enter`],
    ["run", `Shift+${primary}+Enter`],
    ["dump", `${primary}+j`],
    ["gif", `${primary}+k`]
  ]
  if (platform === "mac") {
    presses.push(
      ["ctrl-save", "Control+s"],
      ["ctrl-rebuild", "Control+Enter"],
      ["ctrl-run", "Shift+Control+Enter"],
      ["ctrl-dump", "Control+j"],
      ["ctrl-gif", "Control+k"]
    )
  }

  const results = {}
  for (const [name, shortcut] of presses) {
    await page.evaluate(() => {
      const cm = document.querySelector(".CodeMirror").CodeMirror
      cm.setValue("alpha\nbeta")
      cm.clearHistory()
      cm.setCursor({line: 0, ch: 2})
      cm.focus()
      for (const key of Object.keys(window.__psShortcutCallbacks)) window.__psShortcutCallbacks[key] = 0
    })
    await page.keyboard.press(shortcut)
    results[name] = await page.evaluate(() => ({
      callbacks: {...window.__psShortcutCallbacks},
      value: document.getElementById("code").editorreference.getValue()
    }))
  }
  return results
}

test("capture CM5 PC and Mac shortcut compatibility matrix", async ({browser}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "shortcut structure is browser-engine independent")

  const matrices = {}
  for (const platform of ["pc", "mac"]) {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:4173",
      viewport: {width: 1440, height: 900},
      deviceScaleFactor: 1
    })
    await context.addInitScript(platform => {
      Object.defineProperty(navigator, "platform", {
        configurable: true,
        get: () => platform === "mac" ? "MacIntel" : "Win32"
      })
    }, platform)
    const page = await context.newPage()
    await openCM5(page)
    matrices[platform] = await captureShortcutData(page, platform)
    matrices[platform].applicationOutcomes = await captureApplicationShortcuts(page, platform)
    await context.close()
  }

  await writeFile(path.join(baselineDir, "shortcuts.json"), JSON.stringify(matrices, null, 2) + "\n")
})
