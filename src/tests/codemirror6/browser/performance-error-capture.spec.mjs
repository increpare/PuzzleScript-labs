import {expect, test} from "@playwright/test"

import {transformCM6PerformanceHtml} from "../build-performance-pages.mjs"

test("performance bootstrap captures load-time and post-mount failures", async ({page}) => {
  const html = transformCM6PerformanceHtml([
    "<!doctype html><html><head></head><body>",
    "<script>throw new SyntaxError('load exploded')</script>",
    "<script>Promise.reject(new TypeError('load promise exploded'))</script>",
    "<div id='mounted'></div>",
    "</body></html>"
  ].join(""))

  await page.route("**/performance-error-capture-fixture.html", route => route.fulfill({
    body: html,
    contentType: "text/html"
  }))
  await page.goto("/tests/codemirror6/generated/performance-error-capture-fixture.html")
  await expect.poll(() => page.evaluate(
    () => window.__puzzleScriptPerformanceErrors.length
  )).toBe(2)

  await page.evaluate(() => { void Promise.reject(new RangeError("post-mount promise exploded")) })
  await expect.poll(() => page.evaluate(
    () => window.__puzzleScriptPerformanceErrors.slice()
  )).toEqual([
    "error: SyntaxError: load exploded",
    "unhandledrejection: TypeError: load promise exploded",
    "unhandledrejection: RangeError: post-mount promise exploded"
  ])
})

for (const surface of [
  {name: "CM5", path: "/tests/codemirror6/generated/cm5-editor.html", root: ".CodeMirror"},
  {name: "CM6", path: "/tests/codemirror6/generated/cm6-performance-editor.html", root: ".cm-editor"}
]) {
  test(`generated ${surface.name} benchmark page mounts with an empty error buffer`, async ({page}) => {
    await page.goto(surface.path, {waitUntil: "networkidle"})
    await expect(page.locator(surface.root)).toBeVisible()
    await expect.poll(() => page.evaluate(
      () => Boolean(document.querySelector("#code")?.editorreference)
    )).toBe(true)
    await expect.poll(() => page.evaluate(
      () => window.__puzzleScriptPerformanceErrors?.slice()
    )).toEqual([])
  })
}
