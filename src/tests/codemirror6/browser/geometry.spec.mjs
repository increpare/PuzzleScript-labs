import {expect, test} from "@playwright/test"
import {readFile} from "node:fs/promises"

import {representativeSource, wrappedSource} from "./helpers.mjs"

const baselineByProject = Object.fromEntries(await Promise.all(
  ["chromium", "firefox", "webkit"].map(async project => [
    project,
    JSON.parse(await readFile(new URL(`../baselines/cm5/measurements-${project}.json`, import.meta.url), "utf8"))
  ])
))

async function openEditor(page, path) {
  await page.goto(path)
  await page.waitForFunction(() => !!document.querySelector(".cm-editor") &&
    !!document.getElementById("code")?.editorreference)
  await page.evaluate(() => document.fonts && document.fonts.ready)
}

async function setSource(page, source, line = 0, column = 0) {
  await page.evaluate(({source, line, column}) => {
    const editor = document.getElementById("code").editorreference
    editor.replaceDocument(source)
    editor.clearHistory()
    editor.revealLine(line, {cursor: column})
    editor.focus()
  }, {source, line, column})
  await page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.waitForFunction(() => {
    const root = document.querySelector(".cm-editor")?.getBoundingClientRect()
    const line = document.querySelector(".cm-line")?.getBoundingClientRect()
    return root && line && line.bottom > root.top && line.top < root.bottom
  })
}

function expectNumber(actual, expected, label) {
  expect.soft(Math.abs(actual - expected), label).toBeLessThanOrEqual(0.02)
}

function expectRect(actual, expected, label) {
  for (const property of ["x", "y", "width", "height"]) {
    expectNumber(actual[property], expected[property], `${label}.${property}`)
  }
}

function expectSelectionRect(actual, expected, label) {
  expect.soft(Math.abs(actual.x - expected.x), `${label}.x`).toBeLessThanOrEqual(0.05)
  expect.soft(Math.abs(actual.width - expected.width), `${label}.width`).toBeLessThanOrEqual(0.05)
  expect.soft(Math.abs(actual.y - expected.y), `${label}.y`).toBeLessThanOrEqual(1.5)
  expect.soft(Math.abs(actual.height - expected.height), `${label}.height`).toBeLessThanOrEqual(3)
}

function visualRow(value, origin) {
  const row = Math.round((value - origin) / 16)
  return row === 0 ? 0 : row
}

function expectWrappedLine(actual, expected, actualOrigin, expectedOrigin, label) {
  expectNumber(actual.x, expected.x, `${label}.x`)
  expectNumber(actual.width, expected.width, `${label}.width`)
  expect.soft(Math.round(actual.height / 16), `${label}.rowCount`).toBe(
    Math.round(expected.height / 16)
  )
  expect.soft(visualRow(actual.y, actualOrigin), `${label}.startRow`).toBe(
    visualRow(expected.y, expectedOrigin)
  )
}

async function rect(page, selector) {
  return page.locator(selector).first().evaluate(element => {
    const value = element.getBoundingClientRect()
    return {x: value.x, y: value.y, width: value.width, height: value.height}
  })
}

const legacyStylesheets = ["codemirror.css", "midnight.css", "dialog.css", "show-hint.css"]

async function blockLegacyStylesheets(page, stylesheets) {
  const requested = []
  const blocked = new Set(stylesheets)
  await page.route("**/css/*.css", async route => {
    const filename = new URL(route.request().url()).pathname.split("/").pop()
    if (!blocked.has(filename)) return route.continue()
    requested.push(filename)
    await route.abort()
  })
  return requested
}

async function expectCM5Geometry(page, baseline, projectName) {
  await setSource(page, representativeSource, 52, 1)

  const actual = await page.evaluate(() => {
    const root = document.querySelector(".cm-editor")
    const gutter = document.querySelector(".cm-gutters")
    const scroller = document.querySelector(".cm-scroller")
    const line = document.querySelector(".cm-line")
    const box = element => {
      const value = element.getBoundingClientRect()
      return {x: value.x, y: value.y, width: value.width, height: value.height}
    }
    const style = getComputedStyle(line)
    return {
      root: box(root),
      gutter: box(gutter),
      scroller: box(scroller),
      line: box(line),
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      tabSize: style.tabSize
    }
  })

  expectRect(actual.root, baseline.root, "root")
  expectNumber(actual.gutter.width, 29, "gutter.width")
  expectRect(actual.line, baseline.line, "line")
  expect.soft(actual.fontFamily).toBe(baseline.fontFamily)
  expect.soft(actual.fontSize).toBe(baseline.fontSize)
  expect.soft(actual.lineHeight).toBe(baseline.lineHeight)
  expect.soft(actual.paddingLeft).toBe(baseline.paddingLeft)
  expect.soft(actual.paddingRight).toBe(baseline.paddingRight)
  expect.soft(actual.tabSize).toBe(baseline.tabSize)

  await setSource(page, wrappedSource, 0, 300)
  expectRect(await rect(page, ".cm-line"), baseline.wrappedLine, "wrappedLine")

  await setSource(page, "")
  await page.keyboard.type("titl")
  await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible()
  await page.waitForFunction(() =>
    document.querySelector(".cm-tooltip-autocomplete")?.getBoundingClientRect().top > -9999)
  expectRect(await rect(page, ".cm-tooltip-autocomplete"), baseline.autocomplete, "autocomplete")
  await page.keyboard.press("Escape")

  await setSource(page, "Alpha alpha ALPHA", 0, 0)
  await page.keyboard.press(projectName === "webkit" ? "Meta+f" :
    (process.platform === "darwin" ? "Meta+f" : "Control+f"))
  await expect(page.locator(".cm-search")).toBeVisible()
  expectRect(await rect(page, ".cm-search"), baseline.searchPanel, "searchPanel")
  expectRect(await rect(page, ".cm-scroller"), baseline.rootWithSearch, "editorContentWithSearch")
}

const wrapFidelitySource = [
  "word ".repeat(30),
  "x".repeat(70) + " ",
  "\talpha\tbeta\tgamma ".repeat(12),
  "x".repeat(180),
  "selection geometry across a wrapped line ".repeat(4)
].join("\n")

async function openComparisonEditor(page, path, rootSelector) {
  await page.goto(path)
  await page.waitForFunction(rootSelector => !!document.querySelector(rootSelector) &&
    !!document.getElementById("code")?.editorreference, rootSelector)
  await page.evaluate(() => document.fonts && document.fonts.ready)
}

async function wrapGeometry(page, implementation) {
  const lineSelector = implementation === "cm5" ? ".CodeMirror-line" : ".cm-line"
  const cursorSelector = implementation === "cm5" ? ".CodeMirror-cursor" : ".cm-cursor"
  const selectionSelector = implementation === "cm5"
    ? ".CodeMirror-selected"
    : ".cm-selectionBackground"

  await page.evaluate(source => {
    const editor = document.getElementById("code").editorreference
    editor.replaceDocument(source)
    editor.clearHistory()
    editor.revealLine(1, {cursor: 70})
    editor.focus()
  }, wrapFidelitySource)
  await page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))))

  const lines = await page.locator(lineSelector).evaluateAll(elements => elements.map(element => {
    const value = element.getBoundingClientRect()
    return {x: value.x, y: value.y, width: value.width, height: value.height}
  }))
  const cursor = await rect(page, cursorSelector)

  await page.evaluate(() => {
    const editor = document.getElementById("code").editorreference
    editor.revealLine(4, {cursor: 65})
    editor.focus()
  })
  await page.keyboard.press("Shift+ArrowRight")
  await page.keyboard.press("Shift+ArrowRight")
  await page.keyboard.press("Shift+ArrowRight")
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
  const selection = await page.locator(selectionSelector).evaluateAll(elements => elements
    .map(element => {
      const value = element.getBoundingClientRect()
      return {x: value.x, y: value.y, width: value.width, height: value.height}
    })
    .filter(value => value.width > 0 && value.height > 0))

  return {lines, cursor, selection}
}

async function setComparisonSource(page, source) {
  await page.evaluate(source => {
    const editor = document.getElementById("code").editorreference
    editor.replaceDocument(source)
    editor.clearHistory()
    editor.revealLine(0, {cursor: 0})
    editor.focus()
  }, source)
  await page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

test("CM6 uses the frozen CM5 wrapping rules", async ({page}) => {
  await openEditor(page, "/editor.html")
  await setSource(page, "x".repeat(70) + " ", 0, 70)

  const wrapping = await page.locator(".cm-line").first().evaluate(line => {
    const style = getComputedStyle(line)
    return {
      whiteSpace: style.whiteSpace,
      wordBreak: style.wordBreak,
      overflowWrap: style.overflowWrap
    }
  })

  expect(wrapping).toEqual({
    whiteSpace: "pre-wrap",
    wordBreak: "normal",
    overflowWrap: "break-word"
  })
})

test("CM6 wraps spaces, tabs, words, and long tokens with CM5 caret and selection geometry", async ({page, context}) => {
  const cm5Page = await context.newPage()
  try {
    await openComparisonEditor(
      cm5Page,
      "/tests/codemirror6/generated/cm5-editor.html",
      ".CodeMirror"
    )
    await openComparisonEditor(page, "/editor.html", ".cm-editor")

    const cm5 = await wrapGeometry(cm5Page, "cm5")
    const cm6 = await wrapGeometry(page, "cm6")

    expect(cm6.lines).toHaveLength(cm5.lines.length)
    for (let index = 0; index < cm5.lines.length; index++) {
      expectWrappedLine(
        cm6.lines[index],
        cm5.lines[index],
        cm6.lines[0].y,
        cm5.lines[0].y,
        `line[${index}]`
      )
    }
    expectNumber(cm6.cursor.x, cm5.cursor.x, "trailingSpaceCursor.x")
    expectNumber(cm6.cursor.width, cm5.cursor.width, "trailingSpaceCursor.width")
    expectNumber(cm6.cursor.height, cm5.cursor.height, "trailingSpaceCursor.height")
    expect(visualRow(cm6.cursor.y, cm6.lines[1].y)).toBe(
      visualRow(cm5.cursor.y, cm5.lines[1].y)
    )
    expect(cm6.selection).toHaveLength(cm5.selection.length)
    for (let index = 0; index < cm5.selection.length; index++) {
      expectSelectionRect(cm6.selection[index], cm5.selection[index], `selection[${index}]`)
      expect(visualRow(cm6.selection[index].y, cm6.lines[4].y)).toBe(
        visualRow(cm5.selection[index].y, cm5.lines[4].y)
      )
    }
  } finally {
    await cm5Page.close()
  }
})

test("CM6 search keeps the CM5 control rows and geometry at narrow editor widths", async ({page, context}, testInfo) => {
  await page.setViewportSize({width: 1280, height: 900})
  const cm5Page = await context.newPage()
  await cm5Page.setViewportSize({width: 1280, height: 900})
  try {
    await openComparisonEditor(
      cm5Page,
      "/tests/codemirror6/generated/cm5-editor.html",
      ".CodeMirror"
    )
    await openComparisonEditor(page, "/editor.html", ".cm-editor")
    await setComparisonSource(cm5Page, "Alpha alpha ALPHA")
    await setComparisonSource(page, "Alpha alpha ALPHA")
    const shortcut = testInfo.project.name === "webkit" || process.platform === "darwin"
      ? "Meta+f"
      : "Control+f"
    await cm5Page.keyboard.press(shortcut)
    await page.keyboard.press(shortcut)
    await expect(cm5Page.locator(".CodeMirror-search-panel")).toBeVisible()
    await expect(page.locator(".cm-search")).toBeVisible()

    const controlRowMap = async (target, selector) => target.locator(selector).evaluateAll(elements => {
      const controls = elements.map(element => {
        const value = element.getBoundingClientRect()
        const name = element.name === "wholeWord" ? "word" :
          (element.name === "regexp" ? "re" : element.name)
        return {name, y: value.y,
          width: value.width, height: value.height}
      }).filter(value => value.name !== "close" && value.width > 0 && value.height > 0)
        .sort((left, right) => left.y - right.y)
      const rows = []
      for (const control of controls) {
        if (!rows.length || control.y - rows[rows.length - 1].start > 8) {
          rows.push({start: control.y, names: []})
        }
        rows[rows.length - 1].names.push(control.name)
      }
      return Object.fromEntries(rows.flatMap((row, index) =>
        row.names.map(name => [name, index])))
    })

    for (const viewportWidth of [1280, 1100]) {
      await page.setViewportSize({width: viewportWidth, height: 900})
      await cm5Page.setViewportSize({width: viewportWidth, height: 900})
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
      await cm5Page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
      expectRect(
        await rect(page, ".cm-search"),
        await rect(cm5Page, ".CodeMirror-search-panel"),
        `narrowSearchPanel[${viewportWidth}]`
      )
      expect(await controlRowMap(page, ".cm-search input, .cm-search button")).toEqual(
        await controlRowMap(
          cm5Page,
          ".CodeMirror-search-panel input, .CodeMirror-search-panel button"
        )
      )
    }
  } finally {
    await cm5Page.close()
  }
})

for (const target of [
  {name: "candidate", path: "/tests/codemirror6/generated/editor.html"},
  {name: "product", path: "/editor.html"},
]) {
  test(`CM6 ${target.name} matches the frozen CM5 editor geometry`, async ({page}, testInfo) => {
    const baseline = baselineByProject[testInfo.project.name]
    await openEditor(page, target.path)
    await expectCM5Geometry(page, baseline, testInfo.project.name)
  })
}

for (const disabled of [
  ...legacyStylesheets.map(stylesheet => [stylesheet]),
  legacyStylesheets
]) {
  test(`CM6 geometry does not depend on ${disabled.join(", ")}`, async ({page}, testInfo) => {
    const blocked = await blockLegacyStylesheets(page, disabled)
    await openEditor(page, "/tests/codemirror6/generated/cm6-legacy-css-proof.html")
    expect(blocked.slice().sort()).toEqual(disabled.slice().sort())
    await expectCM5Geometry(
      page,
      baselineByProject[testInfo.project.name],
      testInfo.project.name
    )
  })

  test(`CM6 preserves pre-toolbar theme globals without ${disabled.join(", ")}`, async ({page}) => {
    const blocked = await blockLegacyStylesheets(page, disabled)
    await page.route(/\/js\/.*\.js(?:\?|$)/, route => route.abort())
    await page.goto("/tests/codemirror6/generated/cm6-legacy-css-proof.html", {waitUntil: "load"})
    expect(blocked.slice().sort()).toEqual(disabled.slice().sort())

    await page.evaluate(() => {
      window.__soundClicks = 0
      const systemMessage = document.createElement("span")
      systemMessage.id = "css-proof-system-message"
      systemMessage.className = "systemMessage"
      systemMessage.textContent = "Successful Compilation"
      document.body.append(systemMessage)

      const noColorLink = document.createElement("span")
      noColorLink.id = "css-proof-nocolorlink"
      noColorLink.className = "nocolorlink"
      noColorLink.textContent = "PuzzleScript"
      document.querySelector("#uppertoolbar").append(noColorLink)

      const sound = document.createElement("span")
      sound.id = "css-proof-sound"
      sound.className = "cm-SOUND"
      sound.textContent = "123456"
      sound.onclick = () => { window.__soundClicks += 1 }
      document.body.append(sound)
    })

    const themeGlobals = theme => page.evaluate(theme => {
      if (theme) {
        const light = theme === "light"
        document.body.style.colorScheme = theme
        document.body.classList.toggle("light-theme", light)
        document.body.classList.toggle("dark-theme", !light)
      }
      const noColorLink = getComputedStyle(document.querySelector("#css-proof-nocolorlink"))
      const toolbar = getComputedStyle(document.querySelector("#uppertoolbar"))
      const systemMessage = getComputedStyle(document.querySelector("#css-proof-system-message"))
      const sound = getComputedStyle(document.querySelector("#css-proof-sound"))
      return {
        rootScheme: getComputedStyle(document.documentElement).colorScheme,
        bodyScheme: getComputedStyle(document.body).colorScheme,
        bodyClassName: document.body.className,
        noColorLinkColor: noColorLink.color,
        toolbarColor: toolbar.color,
        systemMessageColor: systemMessage.color,
        soundColor: sound.color,
        soundCursor: sound.cursor,
        soundDecoration: sound.textDecorationLine
      }
    }, theme)

    const initial = await themeGlobals(null)
    expect(initial).toMatchObject({
      rootScheme: "light dark",
      bodyScheme: "dark",
      bodyClassName: "",
      systemMessageColor: "rgb(255, 255, 255)",
      soundColor: "rgb(255, 165, 0)",
      soundCursor: "pointer",
      soundDecoration: "underline"
    })
    expect(initial.noColorLinkColor).toBe(initial.toolbarColor)

    const light = await themeGlobals("light")
    expect(light).toMatchObject({
      rootScheme: "light dark",
      bodyScheme: "light",
      systemMessageColor: "rgb(91, 74, 152)",
      soundColor: "rgb(255, 165, 0)",
      soundCursor: "pointer",
      soundDecoration: "underline"
    })
    expect(light.noColorLinkColor).toBe(light.toolbarColor)

    const dark = await themeGlobals("dark")
    expect(dark).toMatchObject({
      rootScheme: "light dark",
      bodyScheme: "dark",
      systemMessageColor: "rgb(255, 255, 255)",
      soundColor: "rgb(255, 165, 0)",
      soundCursor: "pointer",
      soundDecoration: "underline"
    })
    expect(dark.noColorLinkColor).toBe(dark.toolbarColor)

    expect(await page.evaluate(() => {
      document.querySelector("#css-proof-sound").click()
      return window.__soundClicks
    })).toBe(1)
  })
}
