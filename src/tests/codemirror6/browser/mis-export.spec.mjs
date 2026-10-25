import {expect, test} from "@playwright/test"
import {readFile} from "node:fs/promises"
import {pathToFileURL} from "node:url"

// File ▸ Export as HTML writes a single-file playable game from the
// standalone template, like the editor's Export.
test("File ▸ Export as HTML downloads a game that plays on its own", async ({page, browser}, testInfo) => {
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await page.goto("/mis.html?genWorkers=1&demo=demo/microban.txt")
  await page.waitForFunction(() => window.misApp?.model?.metadata?.title === "Microban")

  await page.locator('#menubar .menu-trigger[aria-label="File"]').click()
  const downloading = page.waitForEvent("download")
  await page.locator("#menu-file [role=menuitem]").filter({hasText: "Export as HTML"}).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe("Microban.html")
  const file = testInfo.outputPath("Microban.html")
  await download.saveAs(file)

  const html = await readFile(file, "utf8")
  expect(html).not.toContain("__GAMEDAT__")
  expect(html).not.toContain("MIS transform")
  expect(errors).toEqual([])

  // The exported page runs by itself, from a file, with the game loaded.
  const game = await browser.newPage()
  const gameErrors = []
  game.on("pageerror", error => gameErrors.push(error.message))
  await game.goto(pathToFileURL(file).href)
  await expect(game).toHaveTitle(/Microban/)
  await game.waitForFunction(() => typeof state !== "undefined" && state.levels && state.levels.length > 0)
  expect(await game.evaluate(() => state.metadata.title)).toBe("Microban")
  await expect(game.locator("canvas")).toHaveCount(1)
  expect(gameErrors).toEqual([])
  await game.close()
})
