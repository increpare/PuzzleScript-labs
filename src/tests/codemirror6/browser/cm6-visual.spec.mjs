import {expect, test} from "@playwright/test"

import {
  dynamicColourSource,
  representativeSource,
  setTheme,
  surfaces,
  wrappedSource
} from "./helpers.mjs"

test.skip(({browserName}) => browserName !== "chromium", "pixel baseline is pinned to Chromium")

async function openEditor(page, path) {
  await page.goto(path)
  await page.waitForFunction(() => !!document.querySelector(".cm-editor") &&
    !!document.getElementById("code")?.editorreference)
  await page.evaluate(() => document.fonts && document.fonts.ready)
}

async function setSource(page, source, line = 0, column = 0) {
  await page.evaluate(({source, line, column}) => {
    const editor = document.getElementById("code").editorreference
    editor.setValue(source)
    editor.clearHistory()
    editor.setCursor(line, column)
    editor.focus()
  }, {source, line, column})
  await page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

async function compare(page, theme, surface, fullPage = false) {
  expect(surfaces).toContain(surface)
  const options = {animations: "disabled", caret: "hide", maxDiffPixels: 0}
  if (fullPage) {
    await expect(page).toHaveScreenshot(`${theme}-${surface}.png`, {...options, fullPage: true})
  } else {
    const selector = surface === "search-replace" ? "#leftpanel" : ".cm-editor"
    await expect(page.locator(selector)).toHaveScreenshot(`${theme}-${surface}.png`, options)
  }
}

for (const target of [
  {name: "candidate", path: "/tests/codemirror6/generated/editor.html"},
  {name: "product", path: "/editor.html"},
]) {
  for (const theme of ["light", "dark"]) {
    test(`CM6 ${target.name} ${theme} surfaces match the frozen CM5 pixels`, async ({page}) => {
      await openEditor(page, target.path)
      await setTheme(page, theme)

      await setSource(page, "")
      await compare(page, theme, "empty")

      await setSource(page, representativeSource, 52, 1)
      await compare(page, theme, "full-page", true)
      await compare(page, theme, "representative-syntax")
      await compare(page, theme, "active-line-gutter")

      await setSource(page, wrappedSource, 0, 300)
      await compare(page, theme, "wrapped")

      await setSource(page, "")
      await page.keyboard.type("titl")
      await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible()
      await compare(page, theme, "autocomplete")
      await page.keyboard.press("Escape")

      await setSource(page, "Alpha alpha ALPHA", 0, 0)
      await page.keyboard.press(process.platform === "darwin" ? "Meta+f" : "Control+f")
      await expect(page.locator(".cm-search")).toBeVisible()
      const search = page.locator('.cm-search input[name="search"]')
      await search.fill("")
      await search.pressSequentially("alpha")
      await expect(page.locator(".cm-searchMatch")).toHaveCount(3)
      await compare(page, theme, "search-replace")
      await page.keyboard.press("Escape")

      await setSource(page, dynamicColourSource, 2, 4)
      await compare(page, theme, "dynamic-colours")
    })
  }
}
