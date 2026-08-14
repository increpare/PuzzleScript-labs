import {expect, test} from "@playwright/test"
import {readFile} from "node:fs/promises"

const validDemo = await readFile(new URL("../../../demo/actiontest.txt", import.meta.url), "utf8")

async function openProduct(page) {
  await page.goto("/editor.html")
  await page.waitForFunction(() => !!document.getElementById("code")?.editorreference)
}

async function setSource(page, source, line = 0, column = 0) {
  await page.evaluate(({source, line, column}) => {
    const editor = document.getElementById("code").editorreference
    editor.setValue(source)
    editor.setCursor(line, column)
    editor.focus()
  }, {source, line, column})
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
