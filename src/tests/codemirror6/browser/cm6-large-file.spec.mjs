import {expect, test} from "@playwright/test"

import {largeSource} from "../fixtures/large-source.js"

const editableLargeSource = `${largeSource}mes`
const autocompleteLine = editableLargeSource.split("\n").length - 1
const distantLevelLine = Math.floor(autocompleteLine / 2)
const afterViewportLine = distantLevelLine + 200
const undoKey = process.platform === "darwin" ? "Meta+z" : "Control+z"
const redoKey = process.platform === "darwin" ? "Shift+Meta+z" : "Shift+Control+z"

async function showDistantRendering(page, levelLine = distantLevelLine) {
  await page.evaluate(({levelLine}) => {
    const editor = document.getElementById("code").editorreference
    editor.revealLine(levelLine, {cursor: 40})
    editor.focus()
  }, {levelLine})
  await expect(page.locator(".cm-LEVEL").last()).toBeVisible()
  await expect(page.locator(".cm-METADATA, .cm-ERROR")).toHaveCount(0)
}

async function showDistantAutocomplete(
  page,
  levelLine = distantLevelLine,
  completionLine = autocompleteLine
) {
  await showDistantRendering(page, levelLine)
  await page.evaluate(({completionLine}) => {
    document.getElementById("code").editorreference.revealLine(completionLine, {cursor: 3})
  }, {completionLine})
  await page.keyboard.press("Backspace")
  await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible()
  await expect(page.locator(".cm-completionLabel").first()).toContainText("message")
  await page.keyboard.press("Escape")
  await page.keyboard.type("s")
  await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible()
  await expect(page.locator(".cm-completionLabel").first()).toContainText("message")
  await page.keyboard.press("Escape")
}

test("distant rendering and autocomplete wait for exact StreamLanguage state", async ({page}) => {
  expect(editableLargeSource.length).toBeGreaterThan(120_000)
  await page.goto("/tests/codemirror6/generated/editor.html")
  await page.waitForFunction(() => !!document.querySelector(".cm-editor") &&
    !!document.getElementById("code")?.editorreference)

  await page.evaluate(({source, line}) => {
    const editor = document.getElementById("code").editorreference
    editor.replaceDocument(source)
    editor.clearHistory()
    editor.revealLine(line, {cursor: 40})
    editor.focus()
  }, {source: editableLargeSource, line: distantLevelLine})
  await showDistantAutocomplete(page)
  expect(await page.evaluate(() => document.getElementById("code").editorreference.getValue()))
    .toBe(editableLargeSource)

  // Edit after the distant viewport, then exercise exact undo and redo paths.
  await page.evaluate(({line}) => {
    const editor = document.getElementById("code").editorreference
    editor.revealLine(line, {cursor: 0})
    editor.replaceSelection("( suffix edit )\n")
  }, {line: afterViewportLine})
  await showDistantRendering(page, distantLevelLine)
  await page.keyboard.press(undoKey)
  await showDistantRendering(page)
  await page.keyboard.press(redoKey)
  await showDistantAutocomplete(page, distantLevelLine, autocompleteLine + 1)

  // The before-viewport edit is pathological and must preserve the exact LEVEL
  // state after the 10,001-character rollback, including undo and redo.
  await page.evaluate(longLine => {
    const editor = document.getElementById("code").editorreference
    editor.revealLine(0, {cursor: 0})
    editor.replaceSelection(`${longLine}\n`)
  }, "x".repeat(10_001))
  await showDistantRendering(page, distantLevelLine + 1)
  await page.keyboard.press(undoKey)
  await showDistantRendering(page, distantLevelLine)
  await page.keyboard.press(redoKey)
  await showDistantAutocomplete(page, distantLevelLine + 1, autocompleteLine + 2)
})
