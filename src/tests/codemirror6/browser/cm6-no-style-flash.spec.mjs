import {expect, test} from "@playwright/test"

import {representativeSource} from "./helpers.mjs"

test.skip(({browserName}) => browserName !== "chromium", "DOM presentation regression is pinned to Chromium")

test("an edit retains exact syntax decorations while reparsing is pending", async ({page}) => {
  await page.addInitScript(() => {
    let nextHandle = 1
    const callbacks = new Map()
    window.requestIdleCallback = callback => {
      const handle = nextHandle++
      callbacks.set(handle, callback)
      return handle
    }
    window.cancelIdleCallback = handle => callbacks.delete(handle)
    window.__runIdleCallbacks = () => {
      const pending = Array.from(callbacks.values())
      callbacks.clear()
      for (const callback of pending) {
        callback({didTimeout: false, timeRemaining: () => 50})
      }
      return pending.length
    }
  })

  await page.goto("/tests/codemirror6/generated/editor.html")
  await page.waitForFunction(() => !!document.getElementById("code")?.editorreference)
  await page.evaluate(source => {
    const editor = document.getElementById("code").editorreference
    editor.setValue(source)
    editor.setCursor(0, 0)
    editor.focus()
  }, representativeSource)

  await expect.poll(async () => {
    await page.evaluate(() => {
      for (let attempt = 0; attempt < 20; attempt++) {
        if (!window.__runIdleCallbacks()) break
      }
    })
    return page.locator(".cm-SECTION, .cm-NAME, .cm-COLOR, .cm-METADATA").count()
  }).toBeGreaterThan(20)

  const before = await page.locator(".cm-SECTION, .cm-NAME, .cm-COLOR, .cm-METADATA").count()
  const immediatelyAfterEdit = await page.evaluate(() => {
    const editor = document.getElementById("code").editorreference
    editor.replaceSelection("x")
    return document.querySelectorAll(".cm-SECTION, .cm-NAME, .cm-COLOR, .cm-METADATA").length
  })

  expect(immediatelyAfterEdit).toBe(before)
})
