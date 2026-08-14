import {expect, test} from "@playwright/test"

const interactionSource = `title 123
OBJECTS
Player P
red
00000
00000
00000
00000
00000

SOUNDS
Player move up 123456

COLLISIONLAYERS
Player

RULES

WINCONDITIONS

LEVELS
P
`

async function openCandidate(page) {
  await page.goto("/tests/codemirror6/generated/editor.html")
  await page.waitForFunction(() => !!document.querySelector(".cm-editor") &&
    !!document.getElementById("code")?.editorreference)
}

test("only exact SOUND and modified LEVEL tokens dispatch application callbacks", async ({page}) => {
  await openCandidate(page)
  await page.evaluate(source => {
    window.__interactionCalls = []
    window.playSound = (seed, immediate) => window.__interactionCalls.push(["sound", seed, immediate])
    window.compile = command => window.__interactionCalls.push(["compile", command])
    document.getElementById("code").editorreference.setValue(source)
  }, interactionSource)

  const sound = page.locator(".cm-SOUND").filter({hasText: "123456"})
  const level = page.locator(".cm-LEVEL").filter({hasText: "P"}).last()
  await expect(sound).toBeVisible()
  await expect(level).toBeVisible()

  await page.locator(".cm-line").first().click()
  expect(await page.evaluate(() => window.__interactionCalls)).toEqual([])
  await sound.click()
  expect(await page.evaluate(() => window.__interactionCalls)).toEqual([
    ["sound", 123456, true]
  ])

  await level.click()
  expect(await page.evaluate(() => window.__interactionCalls)).toHaveLength(1)
  await level.click({modifiers: [process.platform === "darwin" ? "Meta" : "Control"]})
  expect(await page.evaluate(() => window.__interactionCalls)).toEqual([
    ["sound", 123456, true],
    ["compile", ["levelline", interactionSource.split("\n").lastIndexOf("P")]]
  ])
  expect(await page.evaluate(() => document.activeElement === document.querySelector(".cm-content"))).toBe(false)
})

test("image paste inserts the existing 5x5 object format and restores focus", async ({page}) => {
  await openCandidate(page)
  await page.evaluate(() => {
    const editor = document.getElementById("code").editorreference
    editor.setValue("title paste")
    editor.setCursor(0, 11)
    editor.focus()
  })
  await page.locator(".cm-content").evaluate(async target => {
    const canvas = document.createElement("canvas")
    canvas.width = 5
    canvas.height = 5
    const context = canvas.getContext("2d")
    context.fillStyle = "#ff0000"
    context.fillRect(0, 0, 5, 5)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"))
    const event = new Event("paste", {bubbles: true, cancelable: true})
    Object.defineProperty(event, "clipboardData", {
      value: {items: [{type: "image/png", getAsFile: () => blob}]}
    })
    target.dispatchEvent(event)
  })

  await expect.poll(() => page.evaluate(() =>
    document.getElementById("code").editorreference.getValue())).toBe(
      "title paste\npasted_1\n#FF0000\n00000\n00000\n00000\n00000\n00000\n"
    )
  await expect.poll(() => page.evaluate(() =>
    document.activeElement === document.querySelector(".cm-content"))).toBe(true)
})

test("text and exported-HTML drops use shared loading and dirty-state paths", async ({page}) => {
  await openCandidate(page)
  const cleanSource = await page.evaluate(() => document.getElementById("code").editorreference.getValue())

  await page.evaluate(() => document.getElementById("code").editorreference.setValue("changed"))
  await expect(page.locator("#saveClickLink")).toHaveText("SAVE*")
  await page.evaluate(source => document.getElementById("code").editorreference.setValue(source), cleanSource)
  await expect(page.locator("#saveClickLink")).toHaveText("SAVE")

  await page.locator(".cm-content").evaluate(target => {
    const file = new File(["title text drop"], "game.txt", {type: "text/plain"})
    const event = new Event("drop", {bubbles: true, cancelable: true})
    Object.defineProperty(event, "dataTransfer", {value: {files: [file]}})
    target.dispatchEvent(event)
  })
  await expect.poll(() => page.evaluate(() =>
    document.getElementById("code").editorreference.getValue())).toBe("title text drop")

  await page.locator(".cm-content").evaluate(target => {
    const exported = 'sourceCode="title html drop";compile(["restart"]'
    const file = new File([exported], "game.html", {type: "text/html"})
    const event = new Event("drop", {bubbles: true, cancelable: true})
    Object.defineProperty(event, "dataTransfer", {value: {files: [file]}})
    target.dispatchEvent(event)
  })
  await expect.poll(() => page.evaluate(() =>
    document.getElementById("code").editorreference.getValue())).toBe("title html drop")
})
