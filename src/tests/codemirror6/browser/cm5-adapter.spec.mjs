import {expect, test} from "@playwright/test"

test.skip(process.env.RUN_CM5_BASELINE !== "1", "CM5 compatibility tests are opt-in after product cutover")

async function openCM5(page) {
  await page.goto("/tests/codemirror6/generated/cm5-editor.html")
  await page.waitForFunction(() => {
    const code = document.getElementById("code")
    return !!(code && code.editorreference && document.querySelector(".CodeMirror")?.CodeMirror)
  })
}

test("the narrow adapter preserves CM5 value, selection, history, focus, and navigation", async ({page}) => {
  await openCM5(page)
  const result = await page.evaluate(() => {
    const editor = document.getElementById("code").editorreference
    const raw = document.querySelector(".CodeMirror").CodeMirror
    const point = value => ({line: value.line, ch: value.ch})
    const selection = () => raw.listSelections().map(range => ({
      anchor: point(range.anchor),
      head: point(range.head)
    }))

    editor.replaceDocument("alpha\nbeta")
    const afterSetValue = selection()

    editor.revealLine(99, {cursor: 99})
    const clippedAfter = point(raw.getCursor())
    editor.revealLine(-99, {cursor: -99})
    const clippedBefore = point(raw.getCursor())

    raw.setSelection({line: 0, ch: 0}, {line: 1, ch: 4})
    editor.replaceSelection("replacement")
    const afterReplacement = {value: editor.getValue(), selection: selection()}

    editor.replaceDocument("fresh")
    editor.clearHistory()
    raw.undo()
    const afterClearedUndo = {value: editor.getValue(), history: raw.historySize()}

    editor.focus()
    const input = editor.getInputElement()
    const focused = document.activeElement === input
    editor.blur()
    const blurred = document.activeElement !== input

    editor.replaceDocument(Array.from({length: 60}, (_, index) => `line ${index + 1}`).join("\n"))
    const revealCalls = []
    document.getElementById("code").editorreference = Object.freeze({
      ...editor,
      revealLine(line, options) {
        revealCalls.push([line, options])
        editor.revealLine(line, options)
      }
    })
    try {
      jumpToLine(30)
    } finally {
      document.getElementById("code").editorreference = editor
    }
    const errorNavigationCursor = point(raw.getCursor())
    const navigationScroll = raw.getScrollInfo()
    const navigationCoordinates = raw.cursorCoords(null, "local")

    return {
      keys: Object.keys(editor).sort(),
      leakedDoc: editor.doc,
      leakedDisplay: editor.display,
      afterSetValue,
      clippedAfter,
      clippedBefore,
      afterReplacement,
      afterClearedUndo,
      focused,
      blurred,
      errorNavigationCursor,
      revealCalls,
      navigationCenterDelta: Math.abs(
        navigationCoordinates.top - (navigationScroll.top + navigationScroll.clientHeight / 2)
      )
    }
  })

  const {navigationCenterDelta, ...semanticResult} = result
  expect(semanticResult).toEqual({
    keys: [
      "blur", "clearHistory", "focus", "getInputElement", "getValue", "isDirty",
      "markClean", "replaceDocument", "replaceSelection", "revealLine", "setValue"
    ],
    leakedDoc: undefined,
    leakedDisplay: undefined,
    afterSetValue: [{anchor: {line: 0, ch: 0}, head: {line: 0, ch: 0}}],
    clippedAfter: {line: 1, ch: 4},
    clippedBefore: {line: 0, ch: 0},
    afterReplacement: {
      value: "replacement",
      selection: [{anchor: {line: 0, ch: 11}, head: {line: 0, ch: 11}}]
    },
    afterClearedUndo: {value: "fresh", history: {undo: 0, redo: 0}},
    focused: true,
    blurred: true,
    errorNavigationCursor: {line: 29, ch: 0},
    revealCalls: [[29, {cursor: 0, y: "center"}]]
  })
  expect(navigationCenterDelta).toBeLessThan(30)
})

test("image paste still enters through the narrow editor operations", async ({page}) => {
  await openCM5(page)
  await page.evaluate(() => {
    const editor = document.getElementById("code").editorreference
    editor.replaceDocument("alpha")
    editor.revealLine(0, {cursor: 5})
    imageBlobToObjectText = () => Promise.resolve("\nPASTED\n")
    const event = new Event("paste", {bubbles: true, cancelable: true})
    Object.defineProperty(event, "clipboardData", {
      value: {items: [{type: "image/png", getAsFile: () => ({})}]}
    })
    document.querySelector(".CodeMirror").dispatchEvent(event)
  })

  await expect.poll(() => page.evaluate(() => document.getElementById("code").editorreference.getValue()))
    .toBe("alpha\nPASTED\n")
  await expect.poll(() => page.evaluate(() => {
    const editor = document.getElementById("code").editorreference
    return document.activeElement === editor.getInputElement()
  })).toBe(true)
})
