import {expect, test} from "@playwright/test"

test.skip(process.env.RUN_CM5_BASELINE !== "1", "CM5 compatibility tests are opt-in after product cutover")

test("the extracted candidate generator preserves CM5 completion behaviour", async ({page}) => {
  await page.goto("/editor.html")
  await page.waitForFunction(() => {
    const code = document.getElementById("code")
    return !!(code && code.editorreference && window.PuzzleScriptAutocomplete)
  })

  const result = await page.evaluate(() => {
    const cm = document.getElementById("code").editorreference
    cm.setValue("tit")
    cm.setCursor({line: 0, ch: 3})
    cm.focus()
    const completion = CodeMirror.hint.anyword(cm, {})
    CodeMirror.commands.autocomplete(cm, null, {completeSingle: false})
    return {
      first: completion.list[0] && {
        text: completion.list[0].text,
        extra: completion.list[0].extra,
        tag: completion.list[0].tag
      },
      from: {line: completion.from.line, ch: completion.from.ch},
      to: {line: completion.to.line, ch: completion.to.ch}
    }
  })

  expect(result).toEqual({
    first: {text: "title", extra: "My Amazing Puzzle Game", tag: "METADATA"},
    from: {line: 0, ch: 0},
    to: {line: 0, ch: 3}
  })
  await expect(page.locator(".CodeMirror-hints")).toBeVisible()
  await expect(page.locator(".CodeMirror-hint").first()).toContainText("title")

  await page.keyboard.press("Enter")
  await expect.poll(() => page.evaluate(() => document.getElementById("code").editorreference.getValue()))
    .toBe("title")
})
