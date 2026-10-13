import {expect, test} from "@playwright/test"
import {readFile} from "node:fs/promises"

import {autocompleteCases} from "../fixtures/autocomplete-cases.js"

const validDemo = await readFile(new URL("../../../demo/actiontest.txt", import.meta.url), "utf8")

async function openProduct(page) {
  await page.goto("/editor.html")
  await page.waitForFunction(() => !!document.getElementById("code")?.editorreference)
}

async function installCompletionTimerProbe(page) {
  await page.addInitScript(() => {
    const nativeSetTimeout = window.setTimeout.bind(window)
    let armed = false
    let activeTimer = null
    let nextTimerId = 0
    let delays = []
    window.__completionTimerProbe = Object.freeze({
      start() {
        delays = []
        armed = true
      },
      async stop() {
        await new Promise(resolve => nativeSetTimeout(resolve, 0))
        armed = false
        return delays.slice()
      }
    })
    window.setTimeout = function(callback, delay = 0, ...args) {
      const timer = {id: ++nextTimerId, delay, parentId: activeTimer && activeTimer.id}
      if (armed) delays.push(timer)
      return nativeSetTimeout((...callbackArgs) => {
        const previousTimer = activeTimer
        activeTimer = timer
        try {
          callback(...callbackArgs)
        } finally {
          activeTimer = previousTimer
        }
      }, delay, ...args)
    }
  })
}

async function setSource(page, source, line = 0, column = 0) {
  await page.evaluate(({source, line, column}) => {
    const editor = document.getElementById("code").editorreference
    editor.replaceDocument(source)
    editor.revealLine(line, {cursor: column})
    editor.focus()
  }, {source, line, column})
}

async function dispatchKeyCode(page, type, {key, code, keyCode, modifiers = {}}) {
  await page.locator(".cm-content").dispatchEvent(type, {
    key,
    code,
    keyCode,
    which: keyCode,
    bubbles: true,
    cancelable: true,
    ...modifiers
  })
}

async function insertWithKeyCode(page, text, keyEvent) {
  await dispatchKeyCode(page, "keydown", keyEvent)
  await page.keyboard.insertText(text)
  await dispatchKeyCode(page, "keyup", keyEvent)
}

async function dispatchClipboard(page, type, text = "") {
  await page.locator(".cm-content").evaluate((content, {type, text}) => {
    const data = new DataTransfer()
    if (text) data.setData("text/plain", text)
    // Firefox ignores ClipboardEventInit.clipboardData for constructed events.
    const event = new Event(type, {bubbles: true, cancelable: true})
    Object.defineProperty(event, "clipboardData", {value: data})
    content.dispatchEvent(event)
  }, {type, text})
}

async function expectTitleCompletion(page) {
  await expect(page.locator(".cm-tooltip-autocomplete")).toHaveCount(1)
  await expect(page.locator(".cm-completionLabel", {hasText: /^title$/})).toHaveCount(1)
}

test("the active product loads one CM6 editor and no CM5 editor", async ({page}) => {
  await openProduct(page)

  await expect(page.locator(".cm-editor")).toHaveCount(1)
  await expect(page.locator(".CodeMirror")).toHaveCount(0)
  await expect(page.locator("#leftpanel")).toBeVisible()
  await expect(page.locator("#gameCanvas")).toBeVisible()
})

test("the active product preserves the critical editor smoke path", async ({page}) => {
  await openProduct(page)

  await setSource(page, "alpha\nbeta")
  await page.evaluate(() => {
    window.__productCompileCalls = []
    window.compile = command => window.__productCompileCalls.push(command)
  })
  await page.locator("#runClickLink").click()
  expect(await page.evaluate(() => window.__productCompileCalls)).toEqual([["restart"]])

  await setSource(page, "")
  await page.keyboard.type("tit")
  expect(await page.evaluate(() => document.getElementById("code").editorreference.getValue())).toBe("tit")
  await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible()
  await expect(page.locator(".cm-completionLabel").first()).toHaveText("title")
  await page.keyboard.press("Enter")
  expect(await page.evaluate(() => document.getElementById("code").editorreference.getValue())).toBe("title")

  await setSource(page, "alpha\nbeta", 0, 2)
  await page.keyboard.press("Control+/")
  expect(await page.evaluate(() => document.getElementById("code").editorreference.getValue())).toBe("( alpha )\nbeta")

  await page.keyboard.press(process.platform === "darwin" ? "Meta+f" : "Control+f")
  await expect(page.locator(".cm-search")).toBeVisible()
  await expect(page.locator('.cm-search [name="case"]')).toBeDisabled()
})

test("native autocomplete activation covers typing, exclusions, IME, and layout key codes", async ({page}) => {
  await installCompletionTimerProbe(page)
  await openProduct(page)

  await setSource(page, "")
  await page.evaluate(() => window.__completionTimerProbe.start())
  await page.keyboard.type("t")
  await expectTitleCompletion(page)
  const nativeTypingTimers = await page.evaluate(() => window.__completionTimerProbe.stop())
  const nativeTimerIds = new Set(nativeTypingTimers.map(timer => timer.id))
  expect(nativeTypingTimers.filter(timer =>
    timer.delay === 50 && nativeTimerIds.has(timer.parentId))).toEqual([])
  await page.keyboard.press("Escape")

  // Calibrate the public timer probe against the approved explicit-start path.
  await setSource(page, "titt", 0, 4)
  await page.evaluate(() => window.__completionTimerProbe.start())
  await page.keyboard.press("Backspace")
  await expectTitleCompletion(page)
  const explicitStartTimers = await page.evaluate(() => window.__completionTimerProbe.stop())
  const explicitTimerIds = new Set(explicitStartTimers.map(timer => timer.id))
  expect(explicitStartTimers.some(timer =>
    timer.delay === 50 && explicitTimerIds.has(timer.parentId))).toBe(true)
  await page.keyboard.press("Escape")

  await setSource(page, "")
  await page.keyboard.type("title")
  expect(await page.evaluate(() => document.getElementById("code").editorreference.getValue())).toBe("title")
  await expect(page.locator(".cm-tooltip-autocomplete")).toHaveCount(0)

  for (const keyEvent of [
    {key: ";", code: "Semicolon", keyCode: 186},
    {key: "/", code: "Slash", keyCode: 191}
  ]) {
    await setSource(page, "ti", 0, 2)
    await insertWithKeyCode(page, "t", keyEvent)
    await expect(page.locator(".cm-tooltip-autocomplete")).toBeHidden()
  }

  await setSource(page, "ti", 0, 2)
  await page.locator(".cm-content").dispatchEvent("compositionstart", {data: "", bubbles: true})
  await page.keyboard.insertText("t")
  await page.locator(".cm-content").dispatchEvent("compositionend", {data: "t", bubbles: true})
  await expectTitleCompletion(page)
  await page.keyboard.press("Escape")

  // Key codes 190 and 222 must remain eligible for German-layout-sensitive > and quote input.
  for (const keyEvent of [
    {key: ">", code: "Period", keyCode: 190, modifiers: {shiftKey: true}},
    {key: "'", code: "Quote", keyCode: 222}
  ]) {
    await setSource(page, "ti", 0, 2)
    await insertWithKeyCode(page, "t", keyEvent)
    await expectTitleCompletion(page)
    await page.keyboard.press("Escape")
  }
})

test("fallback autocomplete handles delete, paste, and cut once per edit", async ({page}) => {
  await openProduct(page)

  for (const fixture of [
    {key: "Backspace", source: "titt", column: 4},
    {key: "Delete", source: "titx", column: 3}
  ]) {
    await setSource(page, fixture.source, 0, fixture.column)
    await page.keyboard.press(fixture.key)
    expect(await page.evaluate(() => document.getElementById("code").editorreference.getValue())).toBe("tit")
    await expectTitleCompletion(page)
    await page.keyboard.press("Escape")
  }

  for (const keyboard of [true, false]) {
    await setSource(page, "ti", 0, 2)
    if (keyboard) {
      await dispatchKeyCode(page, "keydown", {
        key: "v", code: "KeyV", keyCode: 86, modifiers: {ctrlKey: true}
      })
    }
    await dispatchClipboard(page, "paste", "t")
    if (keyboard) {
      await dispatchKeyCode(page, "keyup", {
        key: "v", code: "KeyV", keyCode: 86, modifiers: {ctrlKey: true}
      })
    }
    expect(await page.evaluate(() => document.getElementById("code").editorreference.getValue())).toBe("tit")
    await expectTitleCompletion(page)
    await page.keyboard.press("Escape")
  }

  for (const keyboard of [true, false]) {
    await setSource(page, "titx", 0, 3)
    await page.keyboard.press("Shift+ArrowRight")
    if (keyboard) {
      await dispatchKeyCode(page, "keydown", {
        key: "x", code: "KeyX", keyCode: 88, modifiers: {ctrlKey: true}
      })
    }
    await dispatchClipboard(page, "cut")
    if (keyboard) {
      await dispatchKeyCode(page, "keyup", {
        key: "x", code: "KeyX", keyCode: 88, modifiers: {ctrlKey: true}
      })
    }
    expect(await page.evaluate(() => document.getElementById("code").editorreference.getValue())).toBe("tit")
    await expectTitleCompletion(page)
    await page.keyboard.press("Escape")
  }
})

test("autocomplete popup navigation, accept, and escape preserve the captured bindings", async ({page}) => {
  await openProduct(page)
  const fixture = autocompleteCases.find(candidate => candidate.name === "rule-directions")
  const prefix = fixture.source.slice(0, -1)
  await setSource(page, prefix, fixture.cursor.line, fixture.cursor.ch - 1)
  await page.keyboard.type(fixture.source.slice(-1))

  await expect(page.locator(".cm-tooltip-autocomplete")).toHaveCount(1)
  await expect(page.locator(".cm-completionLabel")).toHaveText(["right", "rigid"])
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")
  expect(await page.evaluate(() => document.getElementById("code").editorreference.getValue()))
    .toBe(prefix.slice(0, prefix.length - 1) + "rigid")

  await setSource(page, "ti", 0, 2)
  await page.keyboard.type("t")
  await expectTitleCompletion(page)
  await page.keyboard.press("Escape")
  await expect(page.locator(".cm-tooltip-autocomplete")).toBeHidden()
})

test("wrapped product editor does not reserve a horizontal scrollbar", async ({page}) => {
  await openProduct(page)
  await setSource(page, `title ${"wrap ".repeat(500)}`)
  await page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))))

  const scroller = await page.locator(".cm-scroller").evaluate(element => ({
    overflowX: getComputedStyle(element).overflowX,
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))
  expect(scroller.overflowX).toBe("auto")
  expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth)
})

test("the active product compiles and exports a known-valid game", async ({page}) => {
  const pageErrors = []
  page.on("pageerror", error => pageErrors.push(error.message))
  await openProduct(page)
  await setSource(page, validDemo)

  await page.locator("#runClickLink").click()
  await expect(page.locator("#consoletextarea")).toContainText("Successful Compilation")
  await expect(page).toHaveTitle(/Simple Action Example/)

  await page.evaluate(() => {
    window.__exportedStandalone = null
    window.saveAs = (payload, type, name) => {
      window.__exportedStandalone = {payload, type, name}
    }
  })
  await page.locator("#exportClickLink").click()
  await page.waitForFunction(() => !!window.__exportedStandalone)
  const exported = await page.evaluate(() => window.__exportedStandalone)

  expect(exported.name).toBe("Simple Action Example.html")
  expect(exported.payload).toContain("Simple Action Example")
  expect(exported.payload).not.toContain("PuzzleScriptCM6")
  expect(exported.payload).not.toContain("cm-editor")
  expect(pageErrors).toEqual([])
})
