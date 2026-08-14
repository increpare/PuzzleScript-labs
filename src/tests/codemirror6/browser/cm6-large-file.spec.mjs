import {expect, test} from "@playwright/test"

import {largeSource} from "../fixtures/large-source.js"

test("distant rendering and autocomplete wait for exact StreamLanguage state", async ({page}) => {
  expect(largeSource.length).toBeGreaterThan(120_000)
  await page.goto("/tests/codemirror6/generated/editor.html")
  await page.waitForFunction(() => !!document.querySelector(".cm-editor") &&
    !!document.getElementById("code")?.editorreference)

  await page.evaluate(source => {
    const editor = document.getElementById("code").editorreference
    editor.setValue(source)
    editor.setCursor(999_999, 999_999)
    editor.focus()
  }, largeSource)
  expect(await page.locator(".cm-METADATA, .cm-ERROR").count()).toBe(0)
  await expect(page.locator(".cm-LEVEL").last()).toBeVisible()

  await page.evaluate(() => {
    const editor = document.getElementById("code").editorreference
    editor.setCursor(0, 0)
    editor.replaceSelection("( prefix edit )\n")
    editor.setCursor(999_999, 999_999)
  })
  expect(await page.locator(".cm-METADATA, .cm-ERROR").count()).toBe(0)
  await expect(page.locator(".cm-LEVEL").last()).toBeVisible()

  await page.keyboard.press("Enter")
  await page.keyboard.type("mes")
  await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible()
  await expect(page.locator(".cm-completionLabel").first()).toContainText("message")
})
