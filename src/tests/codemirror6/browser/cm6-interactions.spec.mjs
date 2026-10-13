import {expect, test} from "@playwright/test"
import {readFile} from "node:fs/promises"

const shortcuts = JSON.parse(await readFile(
  new URL("../baselines/cm5/shortcuts.json", import.meta.url),
  "utf8"
))

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

async function installGetValueSpy(page) {
  await page.addInitScript(() => {
    let api
    Object.defineProperty(window, "PuzzleScriptEditorAPI", {
      configurable: true,
      get: () => api,
      set(value) {
        api = Object.freeze({
          ...value,
          createPuzzleScriptEditor(driver) {
            const editor = value.createPuzzleScriptEditor(driver)
            const getValue = editor.getValue
            return Object.freeze({
              ...editor,
              getValue(...args) {
                window.__getValueCalls++
                return getValue(...args)
              }
            })
          }
        })
      }
    })
    window.__getValueCalls = 0
  })
}

async function historySnapshot(page) {
  return page.locator(".cm-content").evaluate(content => {
    const selection = content.ownerDocument.defaultView.getSelection()
    const lines = Array.from(content.querySelectorAll(":scope > .cm-line"))
    function point(node, offset) {
      const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
      const line = element && element.closest(".cm-line")
      if (!line || !content.contains(line)) return null
      const range = document.createRange()
      range.setStart(line, 0)
      range.setEnd(node, offset)
      return {line: lines.indexOf(line), ch: range.toString().length}
    }
    const editor = document.getElementById("code").editorreference
    return {
      value: editor.getValue(),
      selections: [{
        anchor: point(selection.anchorNode, selection.anchorOffset),
        head: point(selection.focusNode, selection.focusOffset)
      }],
      dirty: editor.isDirty()
    }
  })
}

test("replaceDocument is a CM5-compatible history event between user edits", async ({page}) => {
  await openCandidate(page)
  const expected = shortcuts.pc.replaceDocumentHistory
  await page.evaluate(() => {
    const editor = document.getElementById("code").editorreference
    editor.replaceDocument("initial")
    editor.clearHistory()
    editor.markClean()
    editor.revealLine(0, {cursor: 7})
    editor.focus()
  })

  await page.keyboard.type("?")
  expect(await historySnapshot(page)).toEqual(expected.afterPriorUserEdit)
  await page.evaluate(() => document.getElementById("code").editorreference.replaceDocument("clean"))
  expect(await historySnapshot(page)).toEqual(expected.afterReplaceDocument)
  await page.keyboard.type("!")
  expect(await historySnapshot(page)).toEqual(expected.afterFollowingUserEdit)

  const modifier = process.platform === "darwin" ? "Meta" : "Control"
  for (const [name, shortcut] of [
    ["afterUndo", `${modifier}+z`],
    ["afterSecondUndo", `${modifier}+z`],
    ["afterRedo", `${modifier}+Shift+z`],
    ["afterSecondRedo", `${modifier}+Shift+z`]
  ]) {
    await page.keyboard.press(shortcut)
    const actual = await historySnapshot(page)
    if (name === "afterRedo") {
      expect({value: actual.value, dirty: actual.dirty}, name).toEqual({
        value: expected[name].value,
        dirty: expected[name].dirty
      })
      expect(expected[name].selections, "the frozen CM5 redo cursor remains documented").toEqual([{
        anchor: {line: 0, ch: 0},
        head: {line: 0, ch: 0}
      }])
      expect(actual.selections, "stock CM6 maps the pre-replacement cursor through the redone change").toEqual([{
        anchor: {line: 0, ch: actual.value.length},
        head: {line: 0, ch: actual.value.length}
      }])
    } else {
      expect(actual, name).toEqual(expected[name])
    }
  }
})

test("dirty state follows mark clean, typing, undo, and redo without reading source", async ({page}) => {
  await installGetValueSpy(page)
  await openCandidate(page)

  await expect(page.locator("#saveClickLink")).toHaveText("SAVE")
  expect(await page.evaluate(() =>
    document.getElementById("code").editorreference.isDirty())).toBe(false)

  await page.evaluate(() =>
    document.getElementById("code").editorreference.replaceDocument("title clean state"))
  await expect(page.locator("#saveClickLink")).toHaveText("SAVE*")
  expect(await page.evaluate(() =>
    document.getElementById("code").editorreference.isDirty())).toBe(true)

  await page.evaluate(() => document.getElementById("code").editorreference.markClean())
  await expect(page.locator("#saveClickLink")).toHaveText("SAVE")
  expect(await page.evaluate(() =>
    document.getElementById("code").editorreference.isDirty())).toBe(false)

  await page.evaluate(() => {
    const editor = document.getElementById("code").editorreference
    editor.revealLine(0, {cursor: 999})
    window.__getValueCalls = 0
    editor.focus()
  })
  await page.keyboard.type("!")
  await expect(page.locator("#saveClickLink")).toHaveText("SAVE*")
  expect(await page.evaluate(() =>
    document.getElementById("code").editorreference.isDirty())).toBe(true)
  expect(await page.evaluate(() => window.__getValueCalls)).toBe(0)

  const modifier = process.platform === "darwin" ? "Meta" : "Control"
  await page.keyboard.press(`${modifier}+z`)
  await expect(page.locator("#saveClickLink")).toHaveText("SAVE")
  expect(await page.evaluate(() =>
    document.getElementById("code").editorreference.isDirty())).toBe(false)
  expect(await page.evaluate(() => window.__getValueCalls)).toBe(0)

  await page.keyboard.press(`${modifier}+Shift+z`)
  await expect(page.locator("#saveClickLink")).toHaveText("SAVE*")
  expect(await page.evaluate(() =>
    document.getElementById("code").editorreference.isDirty())).toBe(true)
  expect(await page.evaluate(() => window.__getValueCalls)).toBe(0)
})

test("only exact SOUND and modified LEVEL tokens dispatch application callbacks", async ({page}) => {
  await openCandidate(page)
  await page.evaluate(source => {
    window.__interactionCalls = []
    window.playSound = (seed, immediate) => window.__interactionCalls.push(["sound", seed, immediate])
    window.compile = command => window.__interactionCalls.push(["compile", command])
    document.getElementById("code").editorreference.replaceDocument(source)
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
    editor.replaceDocument("title paste")
    editor.revealLine(0, {cursor: 11})
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

  await page.evaluate(() => document.getElementById("code").editorreference.replaceDocument("changed"))
  await expect(page.locator("#saveClickLink")).toHaveText("SAVE*")
  await page.evaluate(source => document.getElementById("code").editorreference.replaceDocument(source), cleanSource)
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
