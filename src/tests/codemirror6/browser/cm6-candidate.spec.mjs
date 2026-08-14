import {expect, test} from "@playwright/test"

async function openCandidate(page) {
  await page.goto("/tests/codemirror6/generated/editor.html")
  await page.waitForFunction(() => !!document.querySelector(".cm-editor") &&
    !!document.getElementById("code")?.editorreference)
}

async function setSource(page, source, line = 0, column = 0) {
  await page.evaluate(({source, line, column}) => {
    const editor = document.getElementById("code").editorreference
    editor.setValue(source)
    editor.setCursor(line, column)
    editor.focus()
  }, {source, line, column})
}

test("the test-only page contains one CM6 editor and preserves the application shell", async ({page}) => {
  await openCandidate(page)
  await expect(page.locator(".cm-editor")).toHaveCount(1)
  await expect(page.locator(".CodeMirror")).toHaveCount(0)
  await expect(page.locator("#leftpanel")).toBeVisible()
  await expect(page.locator("#gameCanvas")).toBeVisible()
  expect(await page.evaluate(() => Object.keys(document.getElementById("code").editorreference).sort())).toEqual([
    "blur", "clearHistory", "focus", "getInputElement", "getLastLine",
    "getValue", "replaceSelection", "scrollToLine", "setCursor", "setValue"
  ])
})

test("the narrow adapter, compile path, navigation, autocomplete, comments, and movement work", async ({page}) => {
  await openCandidate(page)

  await setSource(page, "alpha\nbeta")
  await page.evaluate(() => {
    const editor = document.getElementById("code").editorreference
    editor.setCursor(99, 99)
    editor.replaceSelection("!")
  })
  expect(await page.evaluate(() => document.getElementById("code").editorreference.getValue())).toBe("alpha\nbeta!")

  await page.evaluate(() => {
    window.__compileCalls = []
    window.compile = command => window.__compileCalls.push(command)
  })
  await page.locator("#runClickLink").click()
  expect(await page.evaluate(() => window.__compileCalls)).toEqual([["restart"]])

  await setSource(page, Array.from({length: 60}, (_, index) => `line ${index + 1}`).join("\n"))
  await page.evaluate(() => jumpToLine(30))
  await expect(page.locator(".cm-activeLine")).toContainText("line 30")

  await setSource(page, "")
  await page.keyboard.type("tit")
  expect(await page.evaluate(() => document.getElementById("code").editorreference.getValue())).toBe("tit")
  await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible()
  await expect(page.locator(".cm-completionLabel").first()).toContainText("title")
  await page.keyboard.press("Enter")
  expect(await page.evaluate(() => document.getElementById("code").editorreference.getValue())).toBe("title")

  await setSource(page, "alpha\nbeta", 0, 2)
  await page.keyboard.press("Control+/")
  expect(await page.evaluate(() => document.getElementById("code").editorreference.getValue())).toBe("( alpha )\nbeta")
  await page.keyboard.press("Control+/")
  expect(await page.evaluate(() => document.getElementById("code").editorreference.getValue())).toBe("alpha\nbeta")

  await setSource(page, "alpha\nbeta\ngamma", 1, 2)
  await page.keyboard.press("Shift+Control+ArrowUp")
  expect(await page.evaluate(() => document.getElementById("code").editorreference.getValue())).toBe("beta\nalpha\ngamma")
  await page.keyboard.press("Shift+Control+ArrowDown")
  expect(await page.evaluate(() => document.getElementById("code").editorreference.getValue())).toBe("alpha\nbeta\ngamma")

  expect(await page.evaluate(() => document.activeElement === document.querySelector(".cm-content"))).toBe(true)
  await page.evaluate(() => document.getElementById("code").editorreference.blur())
  expect(await page.evaluate(() => document.activeElement === document.querySelector(".cm-content"))).toBe(false)
})

test("modifier-clicks cannot create multiple selections", async ({page}) => {
  await openCandidate(page)
  await setSource(page, "alpha beta gamma", 0, 0)
  const line = page.locator(".cm-line").first()
  await line.dblclick({position: {x: 15, y: 8}})
  await line.click({position: {x: 80, y: 8}, modifiers: ["Alt"]})
  await line.click({position: {x: 100, y: 8}, modifiers: ["Control"]})
  await line.click({position: {x: 120, y: 8}, modifiers: ["Meta"]})
  await expect(page.locator(".cm-selectionBackground")).toHaveCount(0)
})
