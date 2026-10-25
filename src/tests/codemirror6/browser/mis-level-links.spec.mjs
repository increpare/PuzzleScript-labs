import {expect, test} from "@playwright/test"
import {readFile} from "node:fs/promises"

const demo = await readFile(new URL("../../../demo/sokoban_basic.txt", import.meta.url), "utf8")
const source = demo.slice(0, demo.indexOf("\nLEVELS\n")) + `
LEVELS
P.

message Between levels

###
#P#
###

(a comment with P)
P...
`

async function openMIS(page, platform) {
  if (platform) await page.addInitScript(platform => {
    Object.defineProperty(navigator, "platform", {get: () => platform === "mac" ? "MacIntel" : "Win32"})
  }, platform)
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await page.goto("/mis.html?genWorkers=1")
  await page.waitForFunction(() => !!window.misApp?.model)
  await page.locator("#file-input").setInputFiles({name: "level-links.txt", mimeType: "text/plain", buffer: Buffer.from(source)})
  await page.waitForFunction(() => misApp.fileName === "level-links.txt")
  await page.locator('[data-tab="source"]').click()
  const editor = page.locator("#tab-source .cm-editor")
  await reveal(editor, source, "#P#")
  return {editor, errors}
}

async function reveal(editor, text, line) {
  await editor.evaluate((root, {text, line}) => {
    const index = text.split("\n").findIndex(row => row === line)
    root.misEditor.setCursor(index, 0)
    root.misEditor.scrollIntoView({line: index, ch: 0})
  }, {text, line})
}

async function modifiedClick(locator, platform) {
  await expect(locator).toBeVisible()
  if (platform !== "pc" || process.platform !== "darwin") {
    await locator.click({modifiers: [platform === "pc" ? "Control" : "Meta"]})
  } else {
    // Native macOS Control-click is a context click, even with a PC platform override.
    const box = await locator.boundingBox()
    await locator.dispatchEvent("mousedown", {button: 0, ctrlKey: true,
      clientX: box.x + box.width / 2, clientY: box.y + box.height / 2})
  }
}

for (const platform of ["mac", "pc"]) {
  test(`${platform} modifier-clicking a source level selects it in the MIS board`, async ({page}) => {
    const {editor, errors} = await openMIS(page, platform)
    const glyph = editor.locator(".cm-line").filter({hasText: /^#P#$/}).locator(".cm-LEVEL").last()
    await glyph.click()
    expect(await page.evaluate(() => misApp.levelIndex)).toBe(0)
    const modifier = platform === "mac" ? "Meta" : "Control"
    await page.keyboard.down(modifier)
    await expect(glyph).toHaveCSS("cursor", "pointer")
    await modifiedClick(glyph, platform)
    await page.keyboard.up(modifier)
    await expect.poll(() => page.evaluate(() => misApp.levelIndex)).toBe(2)
    expect(await page.evaluate(() => ({w: misApp.board.w, h: misApp.board.h}))).toEqual({w: 3, h: 3})
    await expect(page.locator('.level-item.current[data-level-index="2"]')).toBeVisible()
    expect(await editor.evaluate(root => root.contains(document.activeElement))).toBe(false)
    expect(await editor.evaluate(root => root.misEditor.getValue())).toBe(source)
    expect(await page.evaluate(() => misApp.dirty)).toBe(false)
    expect(errors).toEqual([])
  })
}

test("source level links account for recent edits before the compile debounce", async ({page}) => {
  const platform = process.platform === "darwin" ? "mac" : "pc"
  const {editor, errors} = await openMIS(page, platform)
  const edited = source.replace("\nLEVELS\n", "\nLEVELS\nmessage New introduction\n\n")
  await editor.evaluate((root, edited) => root.misEditor.setValue(edited), edited)
  await reveal(editor, edited, "#P#")
  await modifiedClick(editor.locator(".cm-line").filter({hasText: /^#P#$/}).locator(".cm-LEVEL").first(), platform)
  await expect.poll(() => page.evaluate(() => misApp.levelIndex)).toBe(3)
  expect(await page.evaluate(() => ({w: misApp.board.w, h: misApp.board.h}))).toEqual({w: 3, h: 3})
  expect(await editor.evaluate(root => root.misEditor.getValue())).toBe(edited)
  expect(errors).toEqual([])
})

test("modified clicks on level comments and messages do not select another board", async ({page}) => {
  const platform = process.platform === "darwin" ? "mac" : "pc"
  const {editor, errors} = await openMIS(page, platform)
  await modifiedClick(editor.locator(".cm-line").filter({hasText: /^message Between levels$/}), platform)
  expect(await page.evaluate(() => misApp.levelIndex)).toBe(0)
  await modifiedClick(editor.locator(".cm-line").filter({hasText: /^\(a comment with P\)$/}), platform)
  expect(await page.evaluate(() => misApp.levelIndex)).toBe(0)
  expect(await editor.evaluate(root => root.misEditor.getValue())).toBe(source)
  expect(errors).toEqual([])
})

test("level links do not navigate using a stale model after invalid source edits", async ({page}) => {
  const platform = process.platform === "darwin" ? "mac" : "pc"
  const {editor, errors} = await openMIS(page, platform)
  const invalid = source.replace("Player, Wall, Crate", "NotAnObject")
  expect(invalid).not.toBe(source)
  await editor.evaluate((root, text) => root.misEditor.setValue(text), invalid)
  await reveal(editor, invalid, "#P#")
  await modifiedClick(editor.locator(".cm-line").filter({hasText: /^#P#$/}).locator(".cm-LEVEL").first(), platform)
  expect(await page.evaluate(() => misApp.levelIndex)).toBe(0)
  expect(await editor.evaluate(root => root.misEditor.getValue())).toBe(invalid)
  expect(errors).toEqual([])
})
