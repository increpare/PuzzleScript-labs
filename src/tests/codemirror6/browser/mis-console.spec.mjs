import {expect, test} from "@playwright/test"

// The MIS95 console under the board: panel swapping with the code tab,
// Output / Compiled / Trace, rule breakpoints and stepping (mis_console.js).
const source = `title Console test
run_rules_on_level_start

========
OBJECTS
========

Background
black

Player
white

Crate
orange

Mark
red

=======
LEGEND
=======

. = Background
P = Player
* = Crate

=======
SOUNDS
=======

================
COLLISIONLAYERS
================

Background
Mark
Player, Crate

======
RULES
======

[ Player no Mark ] -> [ Player Mark ]
startloop
[ > Player | Crate ] -> [ > Player | > Crate ]
endloop

==============
WINCONDITIONS
==============

=======
LEVELS
=======

P*..
`
const lineOf = text => source.split("\n").indexOf(text) + 1
const MARK_LINE = lineOf("[ Player no Mark ] -> [ Player Mark ]")
const PUSH_LINE = lineOf("[ > Player | Crate ] -> [ > Player | > Crate ]")

async function openMIS(page, text = source, name = "console.txt") {
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await page.goto("/mis.html?genWorkers=1")
  await page.waitForFunction(() => !!window.misApp?.model)
  await page.locator("#file-input").setInputFiles({name, mimeType: "text/plain", buffer: Buffer.from(text)})
  await page.waitForFunction(name => misApp.fileName === name, name)
  return {errors, editor: page.locator("#tab-source .cm-editor")}
}

// Clicks the breakpoint margin beside a 1-based source line.
async function clickBreakpointMargin(page, editor, line) {
  const point = await editor.evaluate((root, line) => {
    const view = root.misEditor.view
    root.misEditor.scrollLineIntoView(line)
    const coords = view.coordsAtPos(view.state.doc.line(line).from)
    const gutter = root.querySelector(".mis-bp-gutter").getBoundingClientRect()
    return {x: gutter.left + gutter.width / 2, y: (coords.top + coords.bottom) / 2}
  }, line)
  await page.mouse.click(point.x, point.y)
}

// Picks a Run menu item by its label.
async function runMenu(page, label) {
  await page.locator('#menubar .menu-trigger[aria-label="Run"]').click()
  await page.locator("#menu-run [role^=menuitem]").filter({hasText: label}).click()
}

async function play(page) {
  await page.locator('#mode-seg [data-mode="play"]').click()
  await page.locator("#board").click()
}

test("the panel under the board follows the code tab", async ({page}) => {
  const {errors} = await openMIS(page)
  await expect(page.locator("#suggest")).toBeVisible()
  await expect(page.locator("#console")).toBeHidden()
  await page.locator('#tabs [data-tab="source"]').click()
  await expect(page.locator("#console")).toBeVisible()
  await expect(page.locator("#suggest")).toBeHidden()
  await page.locator('#tabs [data-tab="help"]').click()
  await expect(page.locator("#console")).toBeVisible()
  await page.locator('#tabs [data-tab="transform"]').click()
  await expect(page.locator("#suggest")).toBeVisible()
  await expect(page.locator("#console")).toBeHidden()
  expect(errors).toEqual([])
})

test("Compiled lists each rule line's compiled rules and the loop markers", async ({page}) => {
  const {errors} = await openMIS(page)
  await page.locator('#tabs [data-tab="source"]').click()
  await page.locator('#console-tabs [data-ctab="compiled"]').click()
  const compiled = page.locator("#console-compiled")
  await expect(compiled.locator(".c-loop .col-ln")).toHaveText([String(PUSH_LINE - 1), String(PUSH_LINE + 1)])
  await expect(compiled.locator(".c-loop .t-text")).toHaveText(["startloop", "endloop"])
  // Win95 tree: a [+] box on a closed line, connectors on its compiled rules.
  await expect(compiled.locator(`.c-line[data-line="${PUSH_LINE}"] .tv-box:not(.open)`)).toHaveCount(1)
  const push = compiled.locator(`.c-line[data-line="${PUSH_LINE}"]`)
  await expect(push).toContainText("(4 rules)")
  await push.click()
  await expect(compiled.locator(".c-sub")).toHaveCount(4)
  await expect(compiled.locator(".c-sub .tv-line.last")).toHaveCount(1)
  await expect(compiled.locator("a")).toHaveCount(0)
  expect(errors).toEqual([])
})

test("Trace records level-start rules and moves; hovering a row previews the board", async ({page}) => {
  const {errors} = await openMIS(page)
  await page.locator('#tabs [data-tab="source"]').click()
  await page.locator('#console-tabs [data-ctab="trace"]').click()
  await play(page)
  const trace = page.locator("#console-trace")
  await expect(trace.locator(".t-turn").first()).toContainText("level start")
  await expect(trace.locator(`.t-row.k-rule[data-line="${MARK_LINE}"] .col-ln`)).toHaveText(String(MARK_LINE))
  await page.keyboard.press("ArrowRight")
  await expect(page.locator("#play-moves")).toHaveText("1 moves")
  await expect(trace.locator(".t-turn").last()).toContainText("right (1 rule)")
  await trace.locator(".t-row.k-begin").last().hover()
  await expect(page.locator("#board-banner")).toContainText("before the move")
  await page.mouse.move(0, 0)
  await expect(page.locator("#board-banner")).not.toContainText("Trace")
  // Double-click opens the row's line in the source.
  await trace.locator(".t-row.k-rule").last().dblclick()
  await expect.poll(() => page.evaluate(() => document.querySelector("#tab-source .cm-editor").misEditor.getCursor().line + 1)).toBe(PUSH_LINE)
  expect(errors).toEqual([])
})

test("a breakpoint pauses a move, steps through it and commits it at the end", async ({page}) => {
  const {errors, editor} = await openMIS(page)
  await page.locator('#tabs [data-tab="source"]').click()
  await clickBreakpointMargin(page, editor, PUSH_LINE)
  expect(await editor.evaluate(root => root.misEditor.getBreakpoints())).toEqual([PUSH_LINE])
  await page.locator('#tabs [data-tab="transform"]').click()
  await play(page)
  await page.keyboard.press("ArrowRight")

  // Hitting the breakpoint brings up the source and the trace, whose toolbar
  // holds the step buttons (enabled only while paused).
  const next = page.locator("#dbg-step")
  await expect(next).toBeEnabled()
  await expect(page.locator("#console")).toBeVisible()
  await expect(page.locator('#console-tabs [data-ctab="trace"]')).toHaveClass(/\bon\b/)
  await expect(page.locator("#console-trace-page #debug-bar")).toBeVisible()
  await expect(page.locator("#board-banner")).toContainText("step ")
  await expect(page.locator("#console-trace .t-row.cur")).toContainText(String(PUSH_LINE))
  await expect(editor.locator(".mis-paused-line")).toContainText("> Player | Crate")
  await expect(page.locator("#board-banner")).toContainText(`after line ${PUSH_LINE}`)
  await expect(page.locator("#play-moves")).toHaveText("0 moves")
  await expect(page.locator("#designer-mode")).toHaveText("[Break]")
  await page.locator('#menubar .menu-trigger[aria-label="Run"]').click()
  await expect(page.locator("#menu-run [role=menuitem]").filter({hasText: "Next step"})).toBeEnabled()
  await page.keyboard.press("Escape") // closes the menu only
  await expect(next).toBeEnabled()

  await page.keyboard.press("b")
  await expect(page.locator("#board-banner")).toContainText("movement applied")
  await page.keyboard.press("n")
  await expect(page.locator("#board-banner")).toContainText(`after line ${PUSH_LINE}`)
  await page.keyboard.press("ArrowLeft") // other keys are held while paused
  await expect(page.locator("#play-moves")).toHaveText("0 moves")

  await page.keyboard.press("c")
  await expect(next).toBeDisabled()
  await expect(page.locator("#debug-bar")).toBeVisible() // stays, greyed out
  await expect(page.locator("#play-moves")).toHaveText("1 moves")
  await expect(page.locator("#designer-mode")).toHaveText("[Play]")
  await page.locator('#menubar .menu-trigger[aria-label="Run"]').click()
  await expect(page.locator("#menu-run [role=menuitem]").filter({hasText: "Next step"})).toBeDisabled()
  await page.keyboard.press("Escape")
  await expect(editor.locator(".mis-paused-line")).toHaveCount(0)

  await expect(page.locator("#break-btn")).toHaveAttribute("aria-pressed", "true")
  await runMenu(page, "Stop at breakpoints")
  await page.locator("#board").click()
  await page.keyboard.press("ArrowRight")
  await expect(page.locator("#play-moves")).toHaveText("2 moves")
  await expect(next).toBeDisabled()
  await expect(page.locator("#break-btn")).toHaveAttribute("aria-pressed", "false")
  expect(errors).toEqual([])
})

test("breakpoints are saved with the game and follow their rule", async ({page}) => {
  const {errors, editor} = await openMIS(page)
  await page.locator('#tabs [data-tab="source"]').click()
  await clickBreakpointMargin(page, editor, PUSH_LINE)
  await page.waitForFunction(() => /\(MIS breakpoints\n\[ > player \| crate \]/i.test(JSON.parse(localStorage.getItem("mis-autosave") || "{}").text || ""))

  // Margin clicks off a rule line are refused.
  await clickBreakpointMargin(page, editor, PUSH_LINE + 1)
  expect(await editor.evaluate(root => root.misEditor.getBreakpoints())).toEqual([PUSH_LINE])

  // Typing above the rule moves the breakpoint with it.
  await editor.evaluate(root => {
    const view = root.misEditor.view
    view.dispatch({changes: {from: 0, insert: "(new first line)\n"}})
  })
  await page.waitForFunction(line => document.querySelector("#tab-source .cm-editor").misEditor.getBreakpoints()[0] === line && misApp.source.startsWith("(new"), PUSH_LINE + 1)

  // A file carrying the comment block opens with its breakpoint.
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem("mis-autosave") || "{}").text || "").startsWith("(new"))
  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem("mis-autosave"))).text
  expect(saved).toContain("(MIS breakpoints")
  page.once("dialog", dialog => dialog.accept()) // discard unsaved changes
  await page.locator("#file-input").setInputFiles({name: "reopened.txt", mimeType: "text/plain", buffer: Buffer.from(saved)})
  await page.waitForFunction(() => misApp.fileName === "reopened.txt")
  expect(await editor.evaluate(root => root.misEditor.getBreakpoints())).toEqual([PUSH_LINE + 1])
  expect(await page.evaluate(() => misApp.source.includes("MIS breakpoints"))).toBe(false)
  expect(errors).toEqual([])
})

test("the console works from the keyboard and tells screen readers what happened", async ({page}) => {
  const {errors, editor} = await openMIS(page)
  await page.locator('#tabs [data-tab="source"]').click()

  // Tabs: one tab stop, arrows move the selection.
  const traceTab = page.locator("#console-tab-trace")
  await traceTab.click()
  await expect(traceTab).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("ArrowLeft")
  await expect(page.locator("#console-tab-compiled")).toBeFocused()
  await expect(page.locator("#console-tab-compiled")).toHaveAttribute("aria-selected", "true")
  await expect(traceTab).toHaveAttribute("tabindex", "-1")
  await page.keyboard.press("End")
  await expect(traceTab).toBeFocused()

  // F9 in the editor toggles a breakpoint on the cursor's line.
  await editor.evaluate((root, line) => root.misEditor.setCursor(line - 1, 0), PUSH_LINE)
  await page.keyboard.press("F9")
  expect(await editor.evaluate(root => root.misEditor.getBreakpoints())).toEqual([PUSH_LINE])
  await runMenu(page, "Stop at breakpoints")

  // Trace rows are a tree: arrows preview the board without moving the player.
  await play(page)
  await page.keyboard.press("ArrowRight")
  await expect(page.locator("#play-moves")).toHaveText("1 moves")
  const tree = page.locator('#console-trace [role="tree"]')
  await expect(tree.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1)
  await tree.locator('[role="treeitem"][tabindex="0"]').focus()
  await expect(page.locator(":focus")).toHaveAttribute("aria-level", "1")
  await page.keyboard.press("ArrowDown")
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", "before the move")
  await expect(page.locator("#board-banner")).toContainText("before the move")
  await expect(page.locator("#play-moves")).toHaveText("1 moves")
  await page.keyboard.press("ArrowLeft")
  await expect(page.locator(":focus")).toHaveAttribute("aria-expanded", "true")
  await page.keyboard.press("ArrowLeft")
  await expect(page.locator(":focus")).toHaveAttribute("aria-expanded", "false")
  await page.keyboard.press("Enter")
  await expect(page.locator(":focus")).toHaveAttribute("aria-expanded", "true")

  // A pause is announced, and focus returns from the debug bar when it closes.
  await page.locator("#break-btn").click() // the toolbar toggle
  await expect(page.locator("#break-btn")).toHaveAttribute("aria-pressed", "true")
  await play(page)
  await page.keyboard.press("ArrowRight")
  await expect(page.locator("#dbg-step")).toBeEnabled()
  await expect(page.locator("#play-tools")).toHaveClass(/\bpaused\b/) // greyed, not hidden: the board stays put
  await expect(page.locator("#console-live")).toContainText(`Paused at the breakpoint on line ${PUSH_LINE}`)
  await expect(editor.locator(".mis-paused-arrow")).toHaveCount(1)
  await page.keyboard.press("b")
  await expect(page.locator("#console-live")).toContainText("Step")
  await page.keyboard.press("n") // back on the breakpoint, so Continue runs to the end
  await page.locator("#dbg-continue").focus()
  await page.keyboard.press("Enter")
  await expect(page.locator("#dbg-step")).toBeDisabled()
  await expect(page.locator("#play-tools")).not.toHaveClass(/\bpaused\b/)
  await expect(page.locator("#console-live")).toHaveText("Move finished.")
  expect(await page.evaluate(() => document.getElementById("debug-bar").contains(document.activeElement))).toBe(false)
  expect(errors).toEqual([])
})

test("the source tab shows a one-line summary that opens Output", async ({page}) => {
  const broken = source.replace("[ Player no Mark ] -> [ Player Mark ]", "[ Player no Mark ] -> [ Player Mark ]\n[ Nonsense ] -> [ ]")
  const {errors} = await openMIS(page, broken, "broken.txt")
  await page.locator('#tabs [data-tab="source"]').click()
  await page.locator('#console-tabs [data-ctab="trace"]').click()
  const diag = page.locator("#source-diag")
  await expect(diag.locator(".diag-more a")).toContainText("error")
  await expect(diag.locator("[data-line]")).toHaveCount(0)
  await diag.locator(".diag-more a").click()
  await expect(page.locator('#console-tabs [data-ctab="output"]')).toHaveClass(/\bon\b/)
  await expect(page.locator("#console-output .o-row.k-error").filter({hasText: "Nonsense"}).first()).toBeVisible()
  expect(errors).toEqual([])
})
