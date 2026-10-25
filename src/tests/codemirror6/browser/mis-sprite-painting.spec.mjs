import {expect, test} from "@playwright/test"

const source = `title Sprite painting
OBJECTS
Player P
red #123456 blue
00000
0...0
0.1.0
0...0
00000

Wall W
white green
11111
1...1
1...1
1...1
11111

LEGEND

SOUNDS

COLLISIONLAYERS
Player, Wall

RULES
(00000 red #123456)
[ Player ] -> [ Player ]

WINCONDITIONS

LEVELS
PW
`

const modifier = process.platform === "darwin" ? "Meta" : "Control"

async function openMIS(page) {
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await page.goto("/mis.html?genWorkers=1")
  await page.waitForFunction(() => !!window.misApp?.model)
  await page.locator('[data-tab="source"]').click()
  const editor = page.locator("#tab-source .cm-editor")
  await editor.evaluate((root, source) => {
    root.misEditor.setValue(source)
    root.misEditor.view.dispatch({selection: {anchor: 0}})
    root.misEditor.focus()
  }, source)
  await expect(editor.locator(".mis-sprite-brush")).toHaveCount(2)
  return {editor, errors}
}

const colour = (editor, sprite, index) => editor.locator(`.mis-sprite-colour[data-sprite="${sprite}"][data-colour="${index}"]`)
const pixel = (editor, sprite, row, column) => editor.locator(`.mis-sprite-pixel[data-sprite="${sprite}"][data-row="${row}"][data-column="${column}"]`)
const text = editor => editor.evaluate(root => root.misEditor.getValue())

test("MIS palettes select an independent brush without editing source", async ({page}, testInfo) => {
  const {editor, errors} = await openMIS(page)
  await expect(colour(editor, "player", 0)).toHaveClass(/mis-sprite-brush/)
  await expect(colour(editor, "wall", 0)).toHaveClass(/mis-sprite-brush/)
  await colour(editor, "player", 1).hover()
  await page.keyboard.down(modifier)
  await expect(colour(editor, "player", 1)).toHaveCSS("cursor", /mis-eyedropper/)
  await colour(editor, "player", 1).click({modifiers: [modifier]})
  await page.keyboard.up(modifier)
  await expect(colour(editor, "player", 1)).toHaveClass(/mis-sprite-brush/)
  await expect(colour(editor, "player", 0)).not.toHaveClass(/mis-sprite-brush/)
  await expect(colour(editor, "wall", 0)).toHaveClass(/mis-sprite-brush/)
  expect(await text(editor)).toBe(source)
  await editor.screenshot({path: testInfo.outputPath("sprite-brush.png")})
  expect(errors).toEqual([])
})

test("MIS sprite painting and erasing edit only the intended pixel and undo separately", async ({page}) => {
  const {editor, errors} = await openMIS(page)
  await colour(editor, "player", 2).click({modifiers: [modifier]})
  await pixel(editor, "player", 1, 1).click({modifiers: [modifier]})
  const painted = source.replace("0...0", "02..0")
  expect(await text(editor)).toBe(painted)
  await pixel(editor, "player", 1, 1).click({button: "right"})
  expect(await text(editor)).toBe(source)
  await page.keyboard.press(`${modifier}+z`)
  expect(await text(editor)).toBe(painted)
  await page.keyboard.press(`${modifier}+z`)
  expect(await text(editor)).toBe(source)
  await page.keyboard.press(`${modifier}+Shift+z`)
  expect(await text(editor)).toBe(painted)
  expect(errors).toEqual([])
})

test("a fast MIS brush drag fills skipped pixels and is one undo step", async ({page}) => {
  const {editor, errors} = await openMIS(page)
  await colour(editor, "player", 1).click({modifiers: [modifier]})
  const start = pixel(editor, "player", 3, 0), end = pixel(editor, "player", 3, 4)
  await start.hover()
  const a = await start.boundingBox(), b = await end.boundingBox()
  await page.keyboard.down(modifier)
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.up()
  await page.keyboard.up(modifier)
  const lines = source.split("\n"); lines[7] = "11111"
  expect(await text(editor)).toBe(lines.join("\n"))
  await page.keyboard.press(`${modifier}+z`)
  expect(await text(editor)).toBe(source)
  await page.keyboard.press(`${modifier}+Shift+z`)
  expect(await text(editor)).toBe(lines.join("\n"))
  expect(errors).toEqual([])
})

test("the ordinary PuzzleScript editor has no MIS sprite brush UI", async ({page}) => {
  await page.goto("/editor.html")
  await page.waitForFunction(() => !!document.getElementById("code")?.editorreference)
  await page.evaluate(source => document.getElementById("code").editorreference.replaceDocument(source), source)
  await expect(page.locator(".cm-BOLDCOLOR").first()).toBeVisible()
  await expect(page.locator(".mis-sprite-brush, .mis-sprite-pixel")).toHaveCount(0)
})

test("Ctrl selects and paints on Windows without relying on macOS native Control-click", async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "platform", {get: () => "Win32"}))
  const {editor, errors} = await openMIS(page)
  await page.keyboard.down("Control")
  const selected = colour(editor, "player", 1)
  await selected.hover()
  const a = await selected.boundingBox()
  await selected.dispatchEvent("mousedown", {button: 0, buttons: 1, ctrlKey: true,
    clientX: a.x + a.width / 2, clientY: a.y + a.height / 2})
  const target = pixel(editor, "player", 1, 1), b = await target.boundingBox()
  await target.dispatchEvent("mousedown", {button: 0, buttons: 1, ctrlKey: true,
    clientX: b.x + b.width / 2, clientY: b.y + b.height / 2})
  await editor.dispatchEvent("mouseup", {button: 0, buttons: 0, ctrlKey: true})
  await page.keyboard.up("Control")
  expect(await text(editor)).toBe(source.replace("0...0", "01..0"))
  expect(errors).toEqual([])
})

test("a brush stroke cannot cross into another sprite and releasing the modifier ends it", async ({page}) => {
  const {editor, errors} = await openMIS(page)
  await colour(editor, "player", 2).click({modifiers: [modifier]})
  await pixel(editor, "player", 1, 1).hover()
  const a = await pixel(editor, "player", 1, 1).boundingBox()
  const b = await pixel(editor, "wall", 1, 1).boundingBox()
  await page.keyboard.down(modifier)
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.keyboard.up(modifier)
  await page.mouse.move(a.x + a.width * 1.5, a.y + a.height / 2)
  await page.mouse.up()
  expect(await text(editor)).toBe(source.replace("0...0", "02..0"))
  await expect(editor).not.toHaveClass(/mis-sprite-modifier/)
  await page.keyboard.press(`${modifier}+z`)
  expect(await text(editor)).toBe(source)
  expect(errors).toEqual([])
})

test("opening another game resets brushes with the same object names", async ({page}) => {
  page.on("dialog", dialog => dialog.accept())
  const {editor, errors} = await openMIS(page)
  await colour(editor, "player", 2).click({modifiers: [modifier]})
  await expect(colour(editor, "player", 2)).toHaveClass(/mis-sprite-brush/)
  await expect.poll(() => page.evaluate(() => misApp.source)).toBe(source)
  const next = source.replace("title Sprite painting", "title Another game")
  await page.locator("#file-input").setInputFiles({name: "another-game.txt", mimeType: "text/plain", buffer: Buffer.from(next)})
  await page.waitForFunction(() => misApp.fileName === "another-game.txt")
  await expect(colour(editor, "player", 0)).toHaveClass(/mis-sprite-brush/)
  expect(await text(editor)).toBe(next)
  expect(errors).toEqual([])
})
