import {expect, test} from "@playwright/test"
import {readFile} from "node:fs/promises"

const shortcuts = JSON.parse(await readFile(
  new URL("../baselines/cm5/shortcuts.json", import.meta.url),
  "utf8"
))

const compatibilityFixtures = {
  indentAuto: [
    {name: "cursor on first line", value: "  alpha\nbeta", cursor: {line: 0, ch: 1}},
    {name: "cursor copies previous indentation", value: "  alpha\nbeta", cursor: {line: 1, ch: 2}},
    {name: "cursor on blank line copies previous indentation", value: "  alpha\n\nbeta", cursor: {line: 1, ch: 0}},
    {
      name: "multiline selection leaves blank lines empty",
      value: "  alpha\nbeta\n\n    gamma\nomega",
      cursor: {line: 1, ch: 0},
      extend: ["Shift-Down", "Shift-Down", "Shift-Down"]
    }
  ],
  deleteLine: [
    {name: "cursor on first line", value: "first\nmiddle\nlast", cursor: {line: 0, ch: 2}},
    {name: "cursor on middle line", value: "first\nmiddle\nlast", cursor: {line: 1, ch: 3}},
    {name: "cursor on last line", value: "first\nmiddle\nlast", cursor: {line: 2, ch: 2}},
    {
      name: "selection ending at next line column zero includes that line",
      value: "first\nmiddle\nlast",
      cursor: {line: 0, ch: 2},
      extend: ["Shift-Down", "Shift-Home"]
    },
    {
      name: "backward multiline selection",
      value: "first\nmiddle\nlast\nafter",
      cursor: {line: 2, ch: 2},
      extend: ["Shift-Up", "Shift-Right"]
    }
  ]
}

function keyEvent(bindingName) {
  const parts = bindingName.split("-")
  const base = parts.pop()
  const aliases = {
    Esc: "Escape",
    Left: "ArrowLeft",
    Right: "ArrowRight",
    Up: "ArrowUp",
    Down: "ArrowDown"
  }
  const key = aliases[base] || (/^[A-Z]$/.test(base) ? base.toLowerCase() : base)
  return {
    key,
    code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key,
    shiftKey: parts.includes("Shift"),
    ctrlKey: parts.includes("Ctrl"),
    altKey: parts.includes("Alt"),
    metaKey: parts.includes("Cmd")
  }
}

async function openProduct(browser, platform) {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    viewport: {width: 1440, height: 900},
    deviceScaleFactor: 1
  })
  await context.addInitScript(platformName => {
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      get: () => platformName === "mac" ? "MacIntel" : "Win32"
    })
  }, platform)
  const page = await context.newPage()
  await page.goto("/editor.html")
  await page.waitForFunction(() => !!document.querySelector(".cm-content") &&
    !!document.getElementById("code")?.editorreference)
  return {context, page}
}

async function setSource(page, value, line = 1, ch = 6) {
  await page.evaluate(({value, line, ch}) => {
    const editor = document.getElementById("code").editorreference
    editor.replaceDocument(value)
    editor.revealLine(line, {cursor: ch})
    editor.clearHistory()
    editor.focus()
  }, {value, line, ch})
}

async function closeTransientUI(page) {
  const completion = page.locator(".cm-tooltip-autocomplete")
  if (await completion.count()) await dispatchShortcut(page, "Esc")
  const close = page.locator('.cm-search [name="close"]')
  if (await close.count()) await close.click()
}

async function dispatchShortcut(page, bindingName) {
  return page.locator(".cm-content").evaluate((content, init) => {
    const event = new KeyboardEvent("keydown", {bubbles: true, cancelable: true, ...init})
    content.dispatchEvent(event)
    return {
      defaultPrevented: event.defaultPrevented,
      propagationStopped: event.cancelBubble
    }
  }, keyEvent(bindingName))
}

async function setupOutcome(page, commandName, popup, platform) {
  await closeTransientUI(page)
  if (popup) {
    await setSource(page, "ti", 0, 2)
    await page.keyboard.insertText("t")
    await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible()
    return
  }

  await setSource(page, "  alpha beta\nsecond line\nthird line")
  if (commandName === "undo") await page.keyboard.insertText("X")
  if (commandName === "redo") {
    await page.keyboard.insertText("X")
    await dispatchShortcut(page, platform === "mac" ? "Cmd-Z" : "Ctrl-Z")
  }
  if (commandName === "undoSelection" || commandName === "redoSelection") {
    await page.evaluate(() => {
      const editor = document.getElementById("code").editorreference
      editor.revealLine(1, {cursor: 1})
      editor.clearHistory()
      editor.focus()
    })
    for (let index = 0; index < 5; index++) await dispatchShortcut(page, "Right")
    if (commandName === "redoSelection") {
      await dispatchShortcut(page, platform === "mac" ? "Cmd-U" : "Ctrl-U")
    }
  }
}

async function setupCompatibilityFixture(page, fixture) {
  await closeTransientUI(page)
  await setSource(page, fixture.value, fixture.cursor.line, fixture.cursor.ch)
  for (const bindingName of fixture.extend || []) await dispatchShortcut(page, bindingName)
}

async function editorSelection(page, fallback = null) {
  const selection = await page.locator(".cm-content").evaluate(content => {
    const selection = content.ownerDocument.defaultView.getSelection()
    function point(node, offset) {
      const lines = Array.from(content.querySelectorAll(":scope > .cm-line"))
      if (node === content) {
        if (offset < content.childNodes.length) {
          const line = content.childNodes[offset].nodeType === Node.ELEMENT_NODE &&
            content.childNodes[offset].matches(".cm-line")
            ? content.childNodes[offset]
            : content.childNodes[offset].querySelector?.(".cm-line")
          if (line) return {line: lines.indexOf(line), ch: 0}
        }
        const last = lines[lines.length - 1]
        return {line: lines.length - 1, ch: last.textContent.length}
      }
      const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
      const line = element && element.closest(".cm-line")
      if (!line || !content.contains(line)) return null
      const range = document.createRange()
      range.setStart(line, 0)
      range.setEnd(node, offset)
      return {line: lines.indexOf(line), ch: range.toString().length}
    }
    const anchor = point(selection.anchorNode, selection.anchorOffset)
    const head = point(selection.focusNode, selection.focusOffset)
    return anchor && head ? [{anchor, head}] : null
  })
  if (selection) return selection
  if (fallback) return fallback
  throw new Error("Editor selection is outside a CM6 line and no fallback was captured")
}

async function probeOverwriteAndReset(page) {
  const before = await page.evaluate(() => {
    const editor = document.getElementById("code").editorreference
    const value = editor.getValue()
    editor.revealLine(0, {cursor: 0})
    editor.focus()
    return value
  })
  await page.keyboard.insertText("~")
  const after = await page.evaluate(() => document.getElementById("code").editorreference.getValue())
  const overwrite = after.length === before.length
  if (overwrite) await dispatchShortcut(page, "Insert")
  return overwrite
}

async function snapshot(page, event, selectionBefore) {
  const value = await page.evaluate(() => document.getElementById("code").editorreference.getValue())
  const selections = await editorSelection(page, selectionBefore)
  const searchOpen = await page.locator(".cm-search").count() > 0
  const completionOpen = await page.locator(".cm-tooltip-autocomplete").count() > 0
  const overwrite = await probeOverwriteAndReset(page)
  return {
    value,
    selections,
    overwrite,
    searchOpen,
    completionOpen,
    ...event
  }
}

function expectedOutcome(platform, bindingName) {
  const expected = structuredClone(shortcuts[platform].outcomes[bindingName])
  const commandName = shortcuts[platform].effective[bindingName]
  // CM6's standard search keymap opens a panel to establish the first query.
  // CM5 silently ignored next/previous when no search query had existed yet.
  if (["findNext", "findPrev"].includes(commandName)) expected.searchOpen = true
  return expected
}

async function installApplicationShortcutSpies(page) {
  await page.evaluate(() => {
    window.__psShortcutCallbacks = {save: 0, rebuild: 0, run: 0, dump: 0, gif: 0}
    saveClick = () => window.__psShortcutCallbacks.save++
    rebuildClick = () => window.__psShortcutCallbacks.rebuild++
    runClick = () => window.__psShortcutCallbacks.run++
    dumpTestCase = () => window.__psShortcutCallbacks.dump++
    makeGIF = () => window.__psShortcutCallbacks.gif++
  })
}

async function replayApplicationShortcut(page, shortcut) {
  await closeTransientUI(page)
  await setSource(page, "alpha\nbeta", 0, 2)
  await page.evaluate(() => {
    for (const key of Object.keys(window.__psShortcutCallbacks)) {
      window.__psShortcutCallbacks[key] = 0
    }
  })
  await page.keyboard.press(shortcut)
  return page.evaluate(() => ({
    callbacks: {...window.__psShortcutCallbacks},
    value: document.getElementById("code").editorreference.getValue()
  }))
}

test("actual CM6 PC and Mac shortcut outcomes replay the frozen CM5 matrix", async ({browser}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "shortcut structure is browser-engine independent")

  for (const platform of ["pc", "mac"]) {
    const {context, page} = await openProduct(browser, platform)
    try {
      for (const [bindingName, commandLabel] of Object.entries(shortcuts[platform].effective)) {
        const commandName = commandLabel.replace(/^function:/, "")
        await test.step(`${platform} ${bindingName} (${commandName})`, async () => {
          await setupOutcome(page, commandName, false, platform)
          const selectionBefore = await editorSelection(page)
          const event = await dispatchShortcut(page, bindingName)
          const actual = await snapshot(page, event, selectionBefore)
          expect(actual).toEqual(expectedOutcome(platform, bindingName))
        })
      }

      for (const [bindingName, commandLabel] of Object.entries(shortcuts[platform].raw.popup)) {
        await setupOutcome(page, commandLabel.replace(/^function:/, ""), true, platform)
        const selectionBefore = await editorSelection(page)
        const event = await dispatchShortcut(page, bindingName)
        const actual = await snapshot(page, event, selectionBefore)
        expect(actual, `${platform} autocomplete ${bindingName}`)
          .toEqual(shortcuts[platform].popupOutcomes[bindingName])
      }

      for (const [commandName, fixtures] of Object.entries(compatibilityFixtures)) {
        const bindingName = commandName === "indentAuto"
          ? "Shift-Tab"
          : platform === "mac" ? "Cmd-D" : "Ctrl-D"
        for (const fixture of fixtures) {
          await test.step(`${platform} ${commandName}: ${fixture.name}`, async () => {
            await setupCompatibilityFixture(page, fixture)
            const selectionBefore = await editorSelection(page)
            const event = await dispatchShortcut(page, bindingName)
            const actual = await snapshot(page, event, selectionBefore)
            expect(actual).toEqual(
              shortcuts[platform].compatibilityOutcomes[commandName][fixture.name]
            )
          })
        }
      }

      await installApplicationShortcutSpies(page)
      const primary = platform === "mac" ? "Meta" : "Control"
      const applicationBindings = {
        save: `${primary}+s`,
        rebuild: `${primary}+Enter`,
        run: `Shift+${primary}+Enter`,
        dump: `${primary}+j`,
        gif: `${primary}+k`,
        ...(platform === "mac" ? {
          "ctrl-save": "Control+s",
          "ctrl-rebuild": "Control+Enter",
          "ctrl-run": "Shift+Control+Enter",
          "ctrl-dump": "Control+j",
          "ctrl-gif": "Control+k"
        } : {})
      }
      for (const [name, bindingName] of Object.entries(applicationBindings)) {
        await test.step(`${platform} application ${name}`, async () => {
          expect(await replayApplicationShortcut(page, bindingName))
            .toEqual(shortcuts[platform].applicationOutcomes[name])
        })
      }
    } finally {
      await context.close()
    }
  }
})
