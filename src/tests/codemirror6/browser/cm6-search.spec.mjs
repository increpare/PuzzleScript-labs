import {expect, test} from "@playwright/test"

const mod = process.platform === "darwin" ? "Meta" : "Control"

async function openCandidate(page, source) {
  await page.goto("/tests/codemirror6/generated/editor.html")
  await page.waitForFunction(() => !!document.querySelector(".cm-editor") &&
    !!document.getElementById("code")?.editorreference)
  await page.evaluate(value => {
    const editor = document.getElementById("code").editorreference
    editor.replaceDocument(value)
    editor.revealLine(0, {cursor: 0})
    editor.focus()
  }, source)
}

async function openSearch(page) {
  await page.keyboard.press(`${mod}+f`)
  await expect(page.locator(".cm-search")).toBeVisible()
  const caseControl = page.locator('.cm-search [name="case"]')
  await expect(caseControl).toBeDisabled()
  await expect(caseControl).not.toBeChecked()
  await expect(caseControl.locator("xpath=ancestor::label[1]")).toBeHidden()
}

async function setQuery(page, value) {
  const input = page.locator('.cm-search [name="search"]')
  await input.fill("")
  await input.pressSequentially(value)
  await expect(page.locator(".cm-searchMatch")).not.toHaveCount(0)
  await expect(page.locator('.cm-search [name="case"]')).not.toBeChecked()
}

test("stock search remains case-insensitive for literal, regexp, selection, navigation, and word modes", async ({page}) => {
  await openCandidate(page, "Alpha alpha ALPHA alphabet")
  await openSearch(page)
  await setQuery(page, "alpha")
  await expect(page.locator(".cm-searchMatch")).toHaveCount(4)

  await page.locator('.cm-search [name="word"]').check()
  await expect(page.locator(".cm-searchMatch")).toHaveCount(3)
  await page.locator('.cm-search [name="word"]').uncheck()

  const selected = page.locator(".cm-searchMatch-selected")
  await page.locator('.cm-search button[name="next"]').click()
  await expect(selected).toHaveCount(1)
  const first = await selected.boundingBox()
  await page.locator('.cm-search button[name="next"]').click()
  const second = await selected.boundingBox()
  expect(second?.x).not.toBe(first?.x)
  await page.locator('.cm-search button[name="prev"]').click()
  expect((await selected.boundingBox())?.x).toBe(first?.x)
  for (let index = 0; index < 4; index++) {
    await page.locator('.cm-search button[name="next"]').click()
  }
  expect((await selected.boundingBox())?.x).toBe(first?.x)

  await page.locator('.cm-search [name="re"]').check()
  await setQuery(page, "a(?:lpha)")
  await expect(page.locator(".cm-searchMatch")).toHaveCount(4)

  await page.keyboard.press("Escape")
  await expect(page.locator(".cm-search")).toHaveCount(0)
  await page.evaluate(() => {
    const editor = document.getElementById("code").editorreference
    editor.revealLine(0, {cursor: 0})
    editor.focus()
  })
  await page.keyboard.down("Shift")
  for (let index = 0; index < 5; index++) await page.keyboard.press("ArrowRight")
  await page.keyboard.up("Shift")
  await openSearch(page)
  await expect(page.locator('.cm-search [name="search"]')).toHaveValue("Alpha")
})

test("replace operations, malformed regexps, and zero-width regexps are safe and insensitive", async ({page}) => {
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await openCandidate(page, "Alpha alpha ALPHA")
  await openSearch(page)
  await setQuery(page, "alpha")
  await page.locator('.cm-search input[name="replace"]').fill("omega")
  await page.locator('.cm-search button[name="next"]').click()
  await page.locator('.cm-search button[name="replace"]').click()
  await expect.poll(() => page.evaluate(() =>
    document.getElementById("code").editorreference.getValue())).toBe("omega alpha ALPHA")
  await page.locator('.cm-search button[name="replaceAll"]').click()
  await expect.poll(() => page.evaluate(() =>
    document.getElementById("code").editorreference.getValue())).toBe("omega omega omega")

  await page.evaluate(() => document.getElementById("code").editorreference.replaceDocument("aaa"))
  await page.locator('.cm-search [name="re"]').check()
  await page.locator('.cm-search [name="search"]').fill("[")
  await page.locator('.cm-search input[name="replace"]').fill("broken")
  await page.locator('.cm-search button[name="replaceAll"]').click()
  expect(await page.evaluate(() => document.getElementById("code").editorreference.getValue())).toBe("aaa")

  await page.locator('.cm-search [name="search"]').fill("(?=a)")
  for (let index = 0; index < 8; index++) {
    await page.locator('.cm-search button[name="next"]').click()
  }
  expect(errors).toEqual([])
})

test("a case-sensitive query entering through the panel is immediately corrected", async ({page}) => {
  await openCandidate(page, "Alpha alpha ALPHA")
  await openSearch(page)
  await page.locator('.cm-search [name="case"]').evaluate(control => {
    control.disabled = false
    control.checked = true
    control.dispatchEvent(new Event("change", {bubbles: true}))
  })
  await expect(page.locator('.cm-search [name="case"]')).toBeDisabled()
  await expect(page.locator('.cm-search [name="case"]')).not.toBeChecked()
  await setQuery(page, "alpha")
  await expect(page.locator(".cm-searchMatch")).toHaveCount(3)
})
