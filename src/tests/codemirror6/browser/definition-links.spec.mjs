import {expect, test} from "@playwright/test"

const source = `title Player
OBJECTS
Player P
red
00000
00000
00000
00000
00000

LEGEND
Hero = Player

SOUNDS

COLLISIONLAYERS
Player

RULES
[ Player Hero ] -> [ Player ] (Player)

WINCONDITIONS

LEVELS
P
`

async function modifiedClick(locator, modifier, platform) {
  if (platform !== "pc" || process.platform !== "darwin") return locator.click({modifiers: [modifier]})
  // macOS turns a native Control-click into a secondary click, even when the
  // browser's navigator.platform is overridden to exercise Windows behavior.
  const box = await locator.boundingBox()
  await locator.dispatchEvent("mousedown", {
    button: 0, ctrlKey: true, clientX: box.x + 3, clientY: box.y + box.height / 2
  })
}

for (const platform of ["pc", "mac"]) {
  test(`${platform} object links follow declarations and clear when the modifier is released`, async ({page}) => {
    await page.addInitScript(platform => {
      Object.defineProperty(navigator, "platform", {get: () => platform === "mac" ? "MacIntel" : "Win32"})
    }, platform)
    await page.goto("/editor.html")
    await page.waitForFunction(() => !!document.getElementById("code")?.editorreference)
    await page.evaluate(source => {
      const editor = document.getElementById("code").editorreference
      editor.replaceDocument(source)
      editor.markClean()
      editor.revealLine(source.split("\n").findIndex(line => line.startsWith("[ Player")), {cursor: 0})
      editor.focus()
    }, source)
    const rule = page.locator(".cm-line").filter({hasText: "[ Player Hero ]"})
    const player = rule.locator(".cm-NAME").first()
    await expect(player).toBeVisible()
    await player.hover()
    await expect(player).not.toHaveCSS("cursor", "pointer")
    const modifier = platform === "mac" ? "Meta" : "Control"
    await page.keyboard.down(modifier)
    await expect(player).toHaveCSS("cursor", "pointer")
    await expect(player).toHaveCSS("text-decoration-line", "underline")
    await expect(rule.locator(".cm-comment").first()).not.toHaveCSS("cursor", "pointer")
    await modifiedClick(player, modifier, platform)
    await expect.poll(() => page.evaluate(() => window.getSelection().toString())).toBe("Player")
    // Verify the selection belongs to the declaration rather than the reference.
    await expect.poll(() => page.evaluate(() => window.getSelection().anchorNode.parentElement.closest(".cm-line").textContent)).toBe("Player P")
    await page.keyboard.up(modifier)
    const declaration = page.locator(".cm-line").filter({hasText: /^Player P$/}).locator(".cm-NAME").first()
    await expect(declaration).not.toHaveCSS("cursor", "pointer")
    await page.evaluate(source => document.getElementById("code").editorreference.revealLine(
      source.split("\n").findIndex(line => line.startsWith("[ Player")), {cursor: 0}), source)
    await modifiedClick(rule.locator(".cm-NAME").filter({hasText: /^Hero\s*$/}), modifier, platform)
    await expect.poll(() => page.evaluate(() => window.getSelection().anchorNode.parentElement.closest(".cm-line").textContent)).toBe("Hero = Player")
    expect(await page.evaluate(() => document.getElementById("code").editorreference.isDirty())).toBe(false)
    expect(await page.evaluate(() => document.getElementById("code").editorreference.getValue())).toBe(source)
    await page.keyboard.down(modifier)
    await page.evaluate(() => window.dispatchEvent(new Event("blur")))
    await expect(page.locator(".puzzlescript-definition-links")).toHaveCount(0)
    await page.keyboard.up(modifier)
  })
}

test("MIS source and transform object links navigate into the source tab", async ({page}) => {
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await page.goto("/mis.html?genWorkers=1")
  await page.waitForFunction(() => window.misApp?.model)
  const sourceEditor = page.locator("#tab-source .cm-editor")
  const transformEditor = page.locator("#tab-transform .cm-editor")
  await sourceEditor.evaluate((root, source) => root.misEditor.setValue(source), source)
  await expect.poll(() => page.evaluate(() => misApp.source)).toBe(source)
  await page.locator('[data-tab="source"]').click()
  await sourceEditor.evaluate((root, source) => root.misEditor.setCursor(
    source.split("\n").findIndex(line => line.startsWith("[ Player")), 0), source)
  const modifier = process.platform === "darwin" ? "Meta" : "Control"
  await sourceEditor.locator(".cm-line").filter({hasText: "[ Player Hero ]"}).locator(".cm-NAME").first().click({modifiers: [modifier]})
  expect(await sourceEditor.evaluate(root => root.misEditor.getCursor())).toEqual({line: 2, ch: 6})
  await page.locator('[data-tab="transform"]').click()
  await transformEditor.evaluate(root => root.misEditor.setValue("choose 1 [ Hero ] -> [ Player ]"))
  await transformEditor.locator(".cm-NAME").filter({hasText: /^Hero\s*$/}).click({modifiers: [modifier]})
  await expect(page.locator("#tab-source")).toBeVisible()
  await expect.poll(() => sourceEditor.evaluate(root => root.misEditor.getCursor())).toEqual({line: 11, ch: 4})
  expect(await sourceEditor.evaluate(root => root.misEditor.getValue())).toBe(source)
  expect(await transformEditor.evaluate(root => root.misEditor.getValue())).toBe("choose 1 [ Hero ] -> [ Player ]")
  // Both panels use the source parser's long-line rollback when resolving
  // declaration locations, including names inherited by transform code.
  const longSource = source.replace("title Player", "title " + "x".repeat(10_001))
  await sourceEditor.evaluate((root, source) => root.misEditor.setValue(source), longSource)
  await expect.poll(() => page.evaluate(() => misApp.source)).toBe(longSource)
  await page.locator('[data-tab="transform"]').click()
  await transformEditor.locator(".cm-NAME").filter({hasText: /^Hero\s*$/}).click({modifiers: [modifier]})
  await expect(page.locator("#tab-source")).toBeVisible()
  expect(await sourceEditor.evaluate(root => root.misEditor.getCursor())).toEqual({line: 11, ch: 4})
  expect(errors).toEqual([])
})

test("the right half of a single-character object link navigates to its declaration", async ({page}) => {
  await page.goto("/editor.html")
  await page.waitForFunction(() => !!document.getElementById("code")?.editorreference)
  await page.evaluate(source => {
    const editor = document.getElementById("code").editorreference
    editor.replaceDocument(source.replace("[ Player Hero ] -> [ Player ] (Player)", "[P] -> [P]"))
    editor.focus()
  }, source)
  const glyph = page.locator(".cm-line").filter({hasText: "[P] -> [P]"}).locator(".cm-NAME").first()
  await expect(glyph).toBeVisible()
  await glyph.hover()
  const modifier = process.platform === "darwin" ? "Meta" : "Control"
  await page.keyboard.down(modifier)
  const box = await glyph.boundingBox()
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2)
  await page.keyboard.up(modifier)
  await expect.poll(() => page.evaluate(() => window.getSelection().toString())).toBe("P")
  await expect.poll(() => page.evaluate(() => window.getSelection().anchorNode.parentElement.closest(".cm-line").textContent)).toBe("Player P")
})
