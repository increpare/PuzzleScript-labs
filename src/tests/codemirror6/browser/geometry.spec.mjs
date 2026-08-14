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
    editor.setValue(source)
    editor.clearHistory()
    editor.setCursor(line, column)
    editor.focus()
  }, {source, line, column})
  await page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

function expectNumber(actual, expected, label) {
  expect.soft(Math.abs(actual - expected), label).toBeLessThanOrEqual(0.02)
}

function expectRect(actual, expected, label) {
  for (const property of ["x", "y", "width", "height"]) {
    expectNumber(actual[property], expected[property], `${label}.${property}`)
  }
}

async function rect(page, selector) {
  return page.locator(selector).first().evaluate(element => {
    const value = element.getBoundingClientRect()
    return {x: value.x, y: value.y, width: value.width, height: value.height}
  })
}

for (const target of [
  {name: "candidate", path: "/tests/codemirror6/generated/editor.html"},
  {name: "product", path: "/editor.html"},
]) {
  test(`CM6 ${target.name} matches the frozen CM5 editor geometry`, async ({page}, testInfo) => {
    const baseline = baselineByProject[testInfo.project.name]
    await openEditor(page, target.path)
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
    expectRect(await rect(page, ".cm-tooltip-autocomplete"), baseline.autocomplete, "autocomplete")
    await page.keyboard.press("Escape")

    await setSource(page, "Alpha alpha ALPHA", 0, 0)
    await page.keyboard.press(testInfo.project.name === "webkit" ? "Meta+f" :
      (process.platform === "darwin" ? "Meta+f" : "Control+f"))
    await expect(page.locator(".cm-search")).toBeVisible()
    expectRect(await rect(page, ".cm-search"), baseline.searchPanel, "searchPanel")
    expectRect(await rect(page, ".cm-scroller"), baseline.rootWithSearch, "editorContentWithSearch")
  })
}
