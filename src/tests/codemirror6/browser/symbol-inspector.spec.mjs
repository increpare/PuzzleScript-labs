import {expect, test} from "@playwright/test"

const sprite = (name, color) => `${name}\n${color}\n.....\n.000.\n.000.\n.000.\n.....\n`
const source = `title Inspector
OBJECTS
${sprite("Background", "black")}
${sprite("Player P", "blue")}
${sprite("Crate C", "red")}
${sprite("Rock R", "grey")}
${sprite("Goal G", "yellow")}
LEGEND
Box = Crate
Heavy = Crate or Rock
Alias = Heavy
Pushable = Heavy or Player
CrateOnGoal = Crate and Goal

SOUNDS

COLLISIONLAYERS
Background
Crate, Rock, Player
Goal

RULES
[ > Player | Crate ] -> [ > Player | > Crate ] (Crate)
[ Pushable ] -> [ Pushable ]
[ Box ] -> [ Box ]
[ CrateOnGoal ] -> [ CrateOnGoal ]

WINCONDITIONS
all Crate on Goal

LEVELS
PCG
`

async function openMain(page) {
  await page.goto("/editor.html")
  await page.waitForFunction(() => !!document.getElementById("code")?.editorreference)
  await page.evaluate(source => {
    const editor = document.getElementById("code").editorreference
    editor.replaceDocument(source)
    editor.markClean()
    editor.focus()
  }, source)
}

async function hoverName(page, lineText, name) {
  await page.evaluate(lineText => {
    const editor = document.getElementById("code").editorreference
    const line = editor.getValue().split("\n").findIndex(line => line.includes(lineText))
    editor.revealLine(line, {cursor: 0, y: "center"})
  }, lineText)
  const line = page.locator(".cm-line").filter({hasText: lineText})
  await line.locator(".cm-NAME").filter({hasText: new RegExp(`^${name}\\s*$`)}).first().hover()
  const card = page.locator(".ps-symbol-hover")
  await expect(card).toBeVisible()
  return card
}

async function hoverGlyph(page, editor, lineText, column) {
  const point = await editor.evaluate((root, {lineText, column}) => {
    const view = PuzzleScriptCM6Runtime.EditorView.findFromDOM(root)
    const line = Array.from({length: view.state.doc.lines}, (_, i) => view.state.doc.line(i + 1))
      .find(line => line.text === lineText)
    view.dispatch({selection: {anchor: line.from}, effects:
      PuzzleScriptCM6Runtime.EditorView.scrollIntoView(line.from, {y: "center"})})
    const box = view.coordsAtPos(line.from + column)
    return {x: box.left + 2, y: (box.top + box.bottom) / 2}
  }, {lineText, column})
  await page.mouse.move(point.x, point.y)
  return page.locator(".ps-symbol-hover")
}

test("each level glyph inspects its own alias, aggregate or single-character object", async ({page}) => {
  await openMain(page)
  await page.evaluate(text => {
    const editor = document.getElementById("code").editorreference
    editor.replaceDocument(text)
    editor.markClean()
  }, source.replace("LEGEND\n", `${sprite("x", "pink")}\nLEGEND\n`)
    .replace("\nSOUNDS\n", "\n, = Box\n. = Crate and Goal\n\nSOUNDS\n")
    .replace("PCG\n", "PC,.x\n"))
  const editor = page.locator(".cm-editor").first()
  for (const [column, name, definition] of [
    [0, "P", "Player"], [1, "C", "Crate"], [2, ",", ", = Box"],
    [3, ".", ". = Crate and Goal"], [4, "x", "Object"]
  ]) {
    const card = await hoverGlyph(page, editor, "PC,.x", column)
    await expect(card.getByRole("heading", {name, exact: true})).toBeVisible()
    await expect(card).toContainText(definition)
    await expect(card.locator("canvas").first()).toBeVisible()
    if (name === ".") await expect(card.locator("canvas[aria-label='. combined sprite']")).toBeVisible()
    await page.keyboard.press("Escape")
  }
  const card = await hoverGlyph(page, editor, "PC,.x", 3)
  await card.getByRole("button", {name: "Pin inspector"}).click()
  const panel = page.locator(".ps-symbol-inspector")
  await expect(panel.getByRole("heading", {name: ".", exact: true})).toBeVisible()
  await panel.getByRole("button", {name: /Declaration · line/}).click()
  await expect.poll(() => page.evaluate(() => {
    const view = PuzzleScriptCM6Runtime.EditorView.findFromDOM(document.querySelector(".cm-editor"))
    return {selected: view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to),
      line: view.state.doc.lineAt(view.state.selection.main.from).text}
  })).toEqual({selected: ".", line: ". = Crate and Goal"})
  expect(await page.evaluate(() => document.getElementById("code").editorreference.isDirty())).toBe(false)
})

test("level messages, comments and invalid glyphs do not open symbol hovers", async ({page}) => {
  await openMain(page)
  await page.evaluate(() => {
    const editor = document.getElementById("code").editorreference
    editor.replaceDocument(editor.getValue() + "\nmessage P\n\n(C)\n\n?\n")
  })
  const editor = page.locator(".cm-editor").first()
  for (const [line, column] of [["message P", 8], ["(C)", 1], ["?", 0]]) {
    await hoverGlyph(page, editor, line, column)
    await page.waitForTimeout(600)
    await expect(page.locator(".ps-symbol-hover")).toHaveCount(0)
  }
})

test("MIS source level glyphs show the same inspector and can be pinned", async ({page}) => {
  await page.goto("/mis.html?genWorkers=1")
  await page.waitForFunction(() => window.misApp?.model)
  const editor = page.locator("#tab-source .cm-editor")
  await editor.evaluate((root, text) => root.misEditor.setValue(text), source)
  await page.locator('[data-tab="source"]').click()
  const card = await hoverGlyph(page, editor, "PCG", 1)
  await expect(card.getByRole("heading", {name: "C", exact: true})).toBeVisible()
  await expect(card.locator("canvas").first()).toBeVisible()
  await card.getByRole("button", {name: "Pin inspector"}).click()
  await expect(editor.locator(".ps-symbol-inspector")).toContainText("Crate")
  expect(await editor.evaluate(root => root.misEditor.getValue())).toBe(source)
})

test("object hovers show sprites, layers, memberships and authored rule counts", async ({page}, testInfo) => {
  await openMain(page)
  const card = await hoverName(page, "[ > Player | Crate ]", "Crate")
  await expect(card.getByRole("heading", {name: "Crate", exact: true})).toBeVisible()
  await expect(card.locator("canvas").first()).toHaveAttribute("aria-label", "Crate sprite")
  await expect(card.locator(".ps-symbol-layer")).toHaveText("Layer: Crate, Rock, Player")
  await expect(card).toContainText("Heavy")
  await expect(card).toContainText("Pushable")
  await expect(card).toContainText("via Heavy")
  await expect(card).toContainText("CrateOnGoal")
  await expect(card.getByRole("button", {name: /4 rules/})).toBeVisible()
  await page.screenshot({path: testInfo.outputPath("object-hover.png")})
  expect(await page.evaluate(() => document.getElementById("code").editorreference.isDirty())).toBe(false)
  await page.keyboard.press("Escape")
  await expect(card).toHaveCount(0)
})

test("properties and aggregates show their definitions and member sprites", async ({page}) => {
  await openMain(page)
  let card = await hoverName(page, "[ Pushable ]", "Pushable")
  await expect(card).toContainText("Property")
  await expect(card).toContainText("Pushable = Heavy or Player")
  await expect(card.locator("canvas")).not.toHaveCount(0)
  await expect(card.locator("canvas[aria-label='Crate sprite']")).toBeVisible()
  await expect(card.locator("canvas[aria-label='Rock sprite']")).toBeVisible()
  await page.keyboard.press("Escape")
  card = await hoverName(page, "Alias = Heavy", "Alias")
  await expect(card).toContainText("Alias = Heavy")
  await expect(card.locator(".ps-symbol-heading canvas")).toHaveCount(0)
  await expect(card.locator("canvas[aria-label='Crate sprite']")).toBeVisible()
  await expect(card.locator("canvas[aria-label='Rock sprite']")).toBeVisible()
  await page.keyboard.press("Escape")
  card = await hoverName(page, "[ CrateOnGoal ]", "CrateOnGoal")
  await expect(card).toContainText("Aggregate")
  await expect(card).toContainText("CrateOnGoal = Crate and Goal")
  await expect(card.locator("canvas[aria-label='CrateOnGoal combined sprite']")).toBeVisible()
})

test("pinning keeps a symbol stable, lists navigable rules, and updates from uncompiled edits", async ({page}, testInfo) => {
  await openMain(page)
  const card = await hoverName(page, "[ > Player | Crate ]", "Crate")
  await card.getByRole("button", {name: "Pin inspector"}).click()
  const panel = page.locator(".ps-symbol-inspector")
  await expect(panel).toBeVisible()
  await expect(panel).toContainText("Direct mentions (1)")
  const indirect = panel.locator("details")
  await expect(indirect.locator("summary")).toHaveText("Through properties and aliases (3)")
  await indirect.locator("summary").click()
  await expect(indirect.getByRole("button", {name: /Go to rule on line/})).toHaveCount(3)
  await panel.getByRole("button", {name: /Go to rule on line/}).first().click()
  expect(await page.evaluate(() => window.getSelection().toString())).toContain("[ > Player | Crate ]")
  await hoverName(page, "[ Pushable ]", "Pushable")
  await expect(panel.getByRole("heading", {name: "Crate", exact: true})).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.locator(".ps-symbol-hover")).toHaveCount(0)
  await expect(panel).toBeVisible()
  await page.screenshot({path: testInfo.outputPath("pinned-inspector.png")})
  expect(await page.evaluate(() => document.getElementById("code").editorreference.isDirty())).toBe(false)
  const beforeColor = await panel.locator("canvas").first().evaluate(canvas =>
    Array.from(canvas.getContext("2d").getImageData(2, 2, 1, 1).data))
  await page.evaluate(() => {
    const editor = document.getElementById("code").editorreference
    editor.replaceDocument(editor.getValue().replace("Crate and Goal", "Crate and Player")
      .replace("Crate C\nred", "Crate C\ngreen"))
  })
  await expect.poll(() => panel.locator("canvas").first().evaluate(canvas =>
    Array.from(canvas.getContext("2d").getImageData(2, 2, 1, 1).data))).not.toEqual(beforeColor)
  await panel.getByRole("button", {name: "Inspect CrateOnGoal"}).click()
  await expect(panel).toContainText("CrateOnGoal = Crate and Player")
  await page.evaluate(() => {
    const editor = document.getElementById("code").editorreference
    editor.replaceDocument(editor.getValue().replaceAll("CrateOnGoal", "Stack"))
  })
  await expect(panel).toContainText("This name is no longer declared")
  await panel.getByRole("button", {name: "Close symbol inspector"}).click()
  await expect(panel).toHaveCount(0)
})

test("MIS transform hovers inspect the game and pin into its Source tab", async ({page}, testInfo) => {
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await page.goto("/mis.html?genWorkers=1")
  await page.waitForFunction(() => window.misApp?.model)
  const sourceEditor = page.locator("#tab-source .cm-editor")
  const transformEditor = page.locator("#tab-transform .cm-editor")
  await sourceEditor.evaluate((root, text) => root.misEditor.setValue(text), source)
  await expect.poll(() => page.evaluate(() => misApp.source)).toBe(source)
  await page.locator('[data-tab="transform"]').click()
  await transformEditor.evaluate(root => root.misEditor.setValue("choose 1 [ Crate ] -> [ Crate ]"))
  await transformEditor.locator(".cm-NAME").first().hover()
  const card = page.locator(".ps-symbol-hover")
  await expect(card.locator(".ps-symbol-layer")).toHaveText("Layer: Crate, Rock, Player")
  await page.screenshot({path: testInfo.outputPath("mis-hover.png")})
  await card.getByRole("button", {name: "Pin inspector"}).click()
  await expect(page.locator("#tab-source")).toBeVisible()
  const panel = sourceEditor.locator(".ps-symbol-inspector")
  await expect(panel.getByRole("heading", {name: "Crate", exact: true})).toBeVisible()
  await page.screenshot({path: testInfo.outputPath("mis-inspector.png")})
  expect(await transformEditor.evaluate(root => root.misEditor.getValue())).toBe("choose 1 [ Crate ] -> [ Crate ]")
  expect(errors).toEqual([])
})

test("collision-layer names stay on one line and jump to the layer declaration", async ({page}) => {
  await openMain(page)
  const card = await hoverName(page, "[ > Player | Crate ]", "Crate")
  const layer = card.getByRole("button", {name: "Go to collision layer: Crate, Rock, Player"})
  await expect(layer).toBeVisible()
  await expect(layer).toHaveCSS("white-space", "nowrap")
  await expect(layer).toHaveCSS("text-overflow", "ellipsis")
  await layer.click()
  await expect.poll(() => page.evaluate(() => window.getSelection().toString())).toBe("Crate, Rock, Player")
  expect(await page.evaluate(() => document.getElementById("code").editorreference.isDirty())).toBe(false)
})

test("collision layers retain authored property names and distinguish indirect membership", async ({page}) => {
  await openMain(page)
  await page.evaluate(() => {
    const editor = document.getElementById("code").editorreference
    editor.replaceDocument(editor.getValue().replace("Crate, Rock, Player", "Pushable"))
    editor.markClean()
  })
  const card = await hoverName(page, "[ > Player | Crate ]", "Crate")
  const layer = card.locator(".ps-symbol-layer")
  await expect(layer).toHaveText("Layer: Pushable")
  await expect(layer.locator(".ps-symbol-layer-indirect")).toHaveText("Pushable")
  await expect(layer.locator(".ps-symbol-layer-indirect")).toHaveAttribute("title", "Includes Crate indirectly")
  await layer.click()
  await expect.poll(() => page.evaluate(() => window.getSelection().toString())).toBe("Pushable")
  const section = source.split("\n").findIndex(line => line === "COLLISIONLAYERS")
  expect(await page.evaluate(() => {
    const view = PuzzleScriptCM6Runtime.EditorView.findFromDOM(document.querySelector(".cm-editor"))
    return view.state.doc.lineAt(view.state.selection.main.from).number
  })).toBe(section + 3)
})
