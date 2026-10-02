export const surfaces = [
  "empty", "full-page", "representative-syntax", "active-line-gutter",
  "wrapped", "autocomplete", "search-replace", "dynamic-colours"
]

export const representativeSource = `title CM5 Baseline
author PuzzleScript
background_color black
text_color white

OBJECTS
Background
black
00000
00000
00000
00000
00000

Player
white blue
.000.
.010.
.000.
.....
.....

Target
yellow
.....
..0..
.000.
..0..
.....

LEGEND
P = Player
T = Target

SOUNDS
sfx0 123456
Player move 123456

COLLISIONLAYERS
Background
Player, Target

RULES
[ > Player | Target ] -> [ > Player | Target ] sfx0

WINCONDITIONS
all Player on Target

LEVELS
P.T
`

export const dynamicColourSource = `OBJECTS
Named
red
00000
00000
00000
00000
00000

Hex
#Ff00aA
00000
00000
00000
00000
00000
`

export const wrappedSource = `title ${"wrap ".repeat(180)}\n`

export async function setEditorSource(page, source, cursor = {line: 0, ch: 0}) {
  await page.evaluate(({source, cursor}) => {
    const cm = document.querySelector(".CodeMirror").CodeMirror
    cm.setValue(source)
    cm.clearHistory()
    cm.setCursor(cursor)
    cm.focus()
  }, {source, cursor})
}

export async function setTheme(page, theme) {
  await page.evaluate(theme => {
    const light = theme === "light"
    document.body.style.colorScheme = light ? "light" : "dark"
    document.body.classList.toggle("light-theme", light)
    document.body.classList.toggle("dark-theme", !light)
  }, theme)
}

export async function rectFor(page, selector) {
  return page.evaluate(selector => {
    const element = document.querySelector(selector)
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return {x: rect.x, y: rect.y, width: rect.width, height: rect.height}
  }, selector)
}

export async function editorMeasurements(page) {
  return page.evaluate(() => {
    const root = document.querySelector(".CodeMirror")
    const gutter = document.querySelector(".CodeMirror-gutters")
    const line = document.querySelector(".CodeMirror-line")
    const scroller = document.querySelector(".CodeMirror-scroll")
    const rect = element => {
      const value = element.getBoundingClientRect()
      return {x: value.x, y: value.y, width: value.width, height: value.height}
    }
    const style = getComputedStyle(line)
    return {
      root: rect(root),
      gutter: rect(gutter),
      scroller: rect(scroller),
      line: rect(line),
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      tabSize: style.tabSize,
      editorTabSize: document.querySelector(".CodeMirror").CodeMirror.getOption("tabSize")
    }
  })
}
