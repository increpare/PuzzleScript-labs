import {expect, test} from "@playwright/test"

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

  await setSource(page, "ti", 0, 2)
  await page.keyboard.type("t")
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
