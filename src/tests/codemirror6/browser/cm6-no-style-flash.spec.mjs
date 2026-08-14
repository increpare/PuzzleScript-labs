import {expect, test} from "@playwright/test"

import {representativeSource} from "./helpers.mjs"

const mod = process.platform === "darwin" ? "Meta" : "Control"
const tokenSelector = ".cm-SECTION, .cm-NAME, .cm-COLOR, .cm-METADATA"

async function guardedEdit(page, label, edit) {
  await page.evaluate(currentLabel => {
    window.__tokenClassGuard.label = currentLabel
  }, label)
  await edit()
  await page.evaluate(() => new Promise(resolve => queueMicrotask(resolve)))
  expect(await page.locator(tokenSelector).count()).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.__tokenClassGuard.zeroes)).toEqual([])
}

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
    return page.locator(tokenSelector).count()
  }).toBeGreaterThan(20)

  await page.evaluate(selector => {
    const editor = document.querySelector(".cm-editor")
    const guard = window.__tokenClassGuard = {label: "setup", zeroes: [], mutations: 0}
    new MutationObserver(records => {
      guard.mutations += records.length
      if (!document.querySelector(selector)) guard.zeroes.push(guard.label)
    }).observe(editor, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"]
    })
  }, tokenSelector)

  await guardedEdit(page, "typing", async () => {
    await page.keyboard.type("xyz")
    await expect.poll(() => page.evaluate(() =>
      document.getElementById("code").editorreference.getValue().startsWith("xyz"))).toBe(true)
  })

  await page.keyboard.press(`${mod}+f`)
  await expect(page.locator(".cm-search")).toBeVisible()
  await page.locator('.cm-search [name="search"]').fill("player")
  await page.locator('.cm-search input[name="replace"]').fill("actor")
  await page.locator('.cm-search button[name="next"]').click()

  await guardedEdit(page, "search Replace", async () => {
    await page.locator('.cm-search button[name="replace"]').click()
    await expect.poll(() => page.evaluate(() =>
      document.getElementById("code").editorreference.getValue().includes("actor"))).toBe(true)
  })

  await guardedEdit(page, "search Replace All", async () => {
    await page.locator('.cm-search button[name="replaceAll"]').click()
    await expect.poll(() => page.evaluate(() =>
      document.getElementById("code").editorreference.getValue().toLowerCase()
        .includes("player"))).toBe(false)
  })

  await page.keyboard.press("Escape")
  await page.evaluate(() => document.getElementById("code").editorreference.focus())
  await guardedEdit(page, "undo", () => page.keyboard.press(`${mod}+z`))
  await guardedEdit(page, "redo", () => page.keyboard.press(`${mod}+Shift+z`))

  expect(await page.evaluate(() => window.__tokenClassGuard.mutations)).toBeGreaterThan(0)
})
