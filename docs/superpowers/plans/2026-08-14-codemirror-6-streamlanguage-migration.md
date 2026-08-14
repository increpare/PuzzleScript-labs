# CodeMirror 6 StreamLanguage Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PuzzleScript's modified CodeMirror 5 editor with a visually equivalent CodeMirror 6 editor that uses the existing `codeMirrorFn` stream parser unchanged as the sole language parser.

**Architecture:** A precompiled CM6 IIFE bundle receives `codeMirrorFn` and PuzzleScript callbacks at editor creation time. CM6's `StreamLanguage` runs a mechanical wrapper around that parser, an isolated state bridge reads StreamLanguage's stored checkpoints for exact autocomplete state, and a narrow PuzzleScript editor adapter prevents CM6 or CM5 internals from leaking into application code. CM5 remains the active product editor until the separate CM6 candidate passes parser, behaviour, browser, build, and screenshot gates.

**Tech Stack:** Existing browser-global JavaScript, CodeMirror 6 (`@codemirror/state` 6.7.1, `view` 6.43.8, `language` 6.12.4, `commands` 6.10.4, `search` 6.7.1, `autocomplete` 6.20.3), Lezer (`@lezer/common` 1.5.2, `@lezer/highlight` 1.2.3), esbuild 0.28.2, Node's built-in test runner, Playwright 1.62.1.

---

## Governing specification

Implement against `docs/superpowers/specs/2026-08-14-codemirror-6-streamlanguage-migration-design.md`. When this plan and the specification appear to conflict, stop and resolve the discrepancy in the documents before changing runtime code.

Hard invariants:

- Do not write a Lezer grammar.
- Do not add a second PuzzleScript tokenizer or regex highlighter.
- Do not ship a CM5/CM6 runtime toggle.
- Do not remove CM5 until every final gate passes.
- Do not accept intentional font, layout, wrapping, gutter, panel, or page-geometry changes.
- Keep search state case-insensitive, not merely its initial checkbox value.

## Target file structure

### Build and package files

- `package.json`: exact dependency pins and CM6 build/test commands.
- `package-lock.json`: locked dependency graph.
- `build-codemirror6.js`: deterministic esbuild IIFE generation and checked-output verification.
- `src/js/codemirror6/package.json`: scopes readable CM6 source files to ESM without changing the CommonJS repository root.
- `src/js/codemirror6.bundle.js`: committed generated browser bundle.
- `src/js/codemirror6.bundle.js.map`: committed generated source map.

### Parser and language files

- `src/js/puzzlescript-stream.js`: lightweight StringStream used by compiler/player/standalone/tests; no editor dependency.
- `src/js/codemirror6/style-token.js`: lossless style-string encoding used as StreamLanguage node identities.
- `src/js/codemirror6/stream-language.js`: mechanical wrapper around `codeMirrorFn`, including CM5 long-line semantics.
- `src/js/codemirror6/stream-state.js`: the only module allowed to access pinned StreamLanguage checkpoint internals.
- `src/js/codemirror6/exact-prefix.js`: exact-prefix state and bounded parsing coordinator.
- `src/js/codemirror6/token-presentation.js`: parser-token classes and dynamic-colour decorations.

### Editor feature files

- `src/js/puzzlescript-autocomplete.js`: editor-independent existing suggestion calculation.
- `src/js/codemirror/anyword-hint.js`: temporary thin CM5 autocomplete bridge, removed with CM5.
- `src/js/codemirror6/autocomplete.js`: native CM6 completion source and option rendering.
- `src/js/editor-api.js`: narrow application-facing editor contract and driver constructors.
- `src/js/editor-cm5.js`: temporary CM5-specific driver selected by the active product page before cutover.
- `src/js/codemirror6/editor-adapter.js`: CM6 implementation of the editor contract.
- `src/js/codemirror6/commands.js`: per-line comments and line movement key bindings.
- `src/js/codemirror6/search.js`: stock CM6 search configuration and case-insensitivity enforcement.
- `src/js/codemirror6/interactions.js`: sound/level clicks, image paste, and source drop.
- `src/js/codemirror6/index.js`: bundle entry and `window.PuzzleScriptCM6` factory.
- `src/js/editor-cm6.js`: CM6-specific driver selected first by the candidate page and then by the product page.
- `src/js/editor.js`: shared editor application bootstrap, loading/dirty/drop helpers, and debug-timeline utilities; contains no CM5 or CM6 APIs after Task 9.

### Styles and tests

- `src/css/editor-cm6.css`: CM6 mechanics, layout parity, panels, autocomplete, and search integration.
- `src/css/editor-theme.css`: shared PuzzleScript token colours and light/dark theme rules after cutover.
- `src/tests/codemirror6/*.test.mjs`: Node unit and contract tests.
- `src/tests/codemirror6/package.json`: scopes `.js` fixture/helper modules to ESM.
- `src/tests/codemirror6/fixtures/`: parser, autocomplete, long-line, and large-document fixtures.
- `src/tests/codemirror6/browser/*.spec.mjs`: Playwright interaction and visual tests.
- `src/tests/codemirror6/playwright.config.mjs`: local server and modern browser projects.
- `src/tests/codemirror6/build-candidate-page.mjs`: generates a test-only CM6 editor page from current product markup.
- `src/tests/codemirror6/baselines/cm5/`: committed CM5 visual baselines and measurement JSON.
- `docs/codemirror6-migration-ledger.md`: every local CM5 modification and its tested replacement.

Keep modules focused. In particular, do not merge `stream-state.js` into the editor adapter or put feature logic into the generated-bundle entry.

## Task 1: Pin dependencies and add a reproducible empty bundle pipeline

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `build-codemirror6.js`
- Create: `src/js/codemirror6/package.json`
- Create: `src/tests/codemirror6/package.json`
- Create: `src/js/codemirror6/index.js`
- Create: `src/js/codemirror6.bundle.js`
- Create: `src/js/codemirror6.bundle.js.map`
- Create: `src/tests/codemirror6/bundle.test.mjs`

- [ ] **Step 1: Add exact package versions and scripts**

Add this `scripts` object and add the listed packages without `^` or `~`. Preserve all current dependencies.

```json
{
  "scripts": {
    "build:codemirror": "node build-codemirror6.js",
    "check:codemirror": "node build-codemirror6.js --check",
    "test:codemirror": "node --test src/tests/codemirror6/*.test.mjs",
    "test:codemirror-browser": "playwright test --config src/tests/codemirror6/playwright.config.mjs"
  },
  "dependencies": {
    "@codemirror/autocomplete": "6.20.3",
    "@codemirror/commands": "6.10.4",
    "@codemirror/language": "6.12.4",
    "@codemirror/search": "6.7.1",
    "@codemirror/state": "6.7.1",
    "@codemirror/view": "6.43.8",
    "@lezer/common": "1.5.2",
    "@lezer/highlight": "1.2.3"
  },
  "devDependencies": {
    "@playwright/test": "1.62.1",
    "esbuild": "0.28.2"
  }
}
```

Run these separately:

1. `npm install --save-exact @codemirror/autocomplete@6.20.3 @codemirror/commands@6.10.4 @codemirror/language@6.12.4 @codemirror/search@6.7.1 @codemirror/state@6.7.1 @codemirror/view@6.43.8 @lezer/common@1.5.2 @lezer/highlight@1.2.3`
2. `npm install --save-dev --save-exact esbuild@0.28.2 @playwright/test@1.62.1`

Expected: `package-lock.json` changes and every newly added top-level version is exact.

Run: `node -e 'const lock=require("./package-lock.json"); if(lock.name!=="PuzzleScript") process.exit(1)'`

Expected: exit 0. Running npm from a worktree must not rename the lockfile package to the worktree directory name.

- [ ] **Step 2: Write the bundle contract test first**

Create both scoped package files with identical content:

```json
{"type": "module"}
```

Do not add `"type": "module"` to the repository-root `package.json`; `compile.js` and the bundle builder remain CommonJS.

Create `src/tests/codemirror6/bundle.test.mjs`:

```js
import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import test from "node:test"

test("checked-in CM6 bundle exposes only the PuzzleScript factory", async () => {
  const code = await readFile(new URL("../../js/codemirror6.bundle.js", import.meta.url), "utf8")
  assert.match(code, /PuzzleScriptCM6/)
  assert.doesNotMatch(code, /window\.CodeMirror\s*=/)
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test src/tests/codemirror6/bundle.test.mjs`

Expected: FAIL because `src/js/codemirror6.bundle.js` does not exist.

- [ ] **Step 4: Add the minimal bundle entry**

Create `src/js/codemirror6/index.js`:

```js
function createEditor() {
  throw new Error("PuzzleScript CM6 editor has not been assembled yet")
}

window.PuzzleScriptCM6 = Object.freeze({createEditor})
```

Create `build-codemirror6.js` with a stable output path and a `--check` mode that compares generated bytes without rewriting:

```js
#!/usr/bin/env node
"use strict"

const fs = require("fs")
const path = require("path")
const esbuild = require("esbuild")

const root = __dirname
const bundlePath = path.join(root, "src/js/codemirror6.bundle.js")
const mapPath = bundlePath + ".map"
const check = process.argv.includes("--check")

async function build() {
  const result = await esbuild.build({
    absWorkingDir: root,
    entryPoints: ["src/js/codemirror6/index.js"],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome110", "firefox110", "safari16", "edge110"],
    sourcemap: "external",
    sourcesContent: true,
    outfile: "src/js/codemirror6.bundle.js",
    write: false,
    legalComments: "eof"
  })
  const js = result.outputFiles.find(file => file.path === bundlePath).contents
  const map = result.outputFiles.find(file => file.path === mapPath).contents
  if (check) {
    if (!fs.existsSync(bundlePath) || !fs.existsSync(mapPath) ||
        !fs.readFileSync(bundlePath).equals(js) || !fs.readFileSync(mapPath).equals(map)) {
      throw new Error("CodeMirror bundle is stale; run npm run build:codemirror")
    }
  } else {
    fs.writeFileSync(bundlePath, js)
    fs.writeFileSync(mapPath, map)
  }
}

build().catch(error => {
  console.error(error.message || error)
  process.exitCode = 1
})
```

- [ ] **Step 5: Generate and verify the committed artifact**

Run these separately:

1. `npm run build:codemirror`
2. `npm run check:codemirror`
3. `node --test src/tests/codemirror6/bundle.test.mjs`

Expected: all three commands exit 0 and the test reports 1 pass.

- [ ] **Step 6: Commit the pipeline**

```bash
git add package.json package-lock.json build-codemirror6.js src/js/codemirror6 src/js/codemirror6.bundle.js src/js/codemirror6.bundle.js.map src/tests/codemirror6/package.json src/tests/codemirror6/bundle.test.mjs
git commit -m "build: add reproducible CodeMirror 6 bundle"
```

## Task 2: Freeze the CM5 baseline and migration ledger

**Files:**

- Create: `docs/codemirror6-migration-ledger.md`
- Create: `src/tests/codemirror6/playwright.config.mjs`
- Create: `src/tests/codemirror6/browser/cm5-baseline.spec.mjs`
- Create: `src/tests/codemirror6/browser/helpers.mjs`
- Create: `src/tests/codemirror6/baselines/cm5/measurements-chromium.json`
- Create: `src/tests/codemirror6/baselines/cm5/measurements-firefox.json`
- Create: `src/tests/codemirror6/baselines/cm5/measurements-webkit.json`
- Create: PNG files under `src/tests/codemirror6/baselines/cm5/`

- [ ] **Step 1: Install the three test browser engines**

Run: `npx playwright install chromium firefox webkit`

Expected: Chromium, Firefox, and WebKit are available to Playwright.

- [ ] **Step 2: Create a stable browser configuration**

Create `src/tests/codemirror6/playwright.config.mjs`:

```js
import {defineConfig, devices} from "@playwright/test"

export default defineConfig({
  testDir: "./browser",
  timeout: 30_000,
  expect: {timeout: 5_000},
  use: {baseURL: "http://127.0.0.1:4173", viewport: {width: 1440, height: 900}},
  webServer: {
    command: "python3 -m http.server 4173 --directory src",
    url: "http://127.0.0.1:4173/editor.html",
    reuseExistingServer: false
  },
  projects: [
    {name: "chromium", use: {...devices["Desktop Chrome"], deviceScaleFactor: 1}},
    {name: "firefox", use: {...devices["Desktop Firefox"], deviceScaleFactor: 1}},
    {name: "webkit", use: {...devices["Desktop Safari"], deviceScaleFactor: 1}}
  ]
})
```

- [ ] **Step 3: Add measurement and screenshot helpers**

Create `src/tests/codemirror6/browser/helpers.mjs` with explicit surfaces:

```js
export const surfaces = [
  "empty", "full-page", "representative-syntax", "active-line-gutter",
  "wrapped", "autocomplete", "search-replace", "dynamic-colours"
]

export async function editorMeasurements(page) {
  return page.evaluate(() => {
    const root = document.querySelector(".CodeMirror")
    const gutter = document.querySelector(".CodeMirror-gutters")
    const line = document.querySelector(".CodeMirror-line")
    const rect = element => {
      const r = element.getBoundingClientRect()
      return {x: r.x, y: r.y, width: r.width, height: r.height}
    }
    const style = getComputedStyle(line)
    return {
      root: rect(root),
      gutter: rect(gutter),
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight
    }
  })
}
```

- [ ] **Step 4: Write and run the CM5 capture test**

Create `src/tests/codemirror6/browser/cm5-baseline.spec.mjs`. It must load `editor.html`, wait for `.CodeMirror`, and capture every named surface in both light and dark modes. Set both the body class and `body.style.colorScheme` exactly as `setColorScheme` does. Use explicit stable sources for the empty editor, representative syntax covering every section, active line/gutter, wrapping, and named/dynamic hex colours. Type `Back` to open autocomplete and press `Control+f`/`Meta+f` to open the combined search/replace panel. Save screenshots to `baselines/cm5` only when `UPDATE_CM5_BASELINES=1`.

In the same spec, record an exhaustive effective shortcut matrix rather than sampling a few familiar keys. Derive it from `keyMap.basic`, `keyMap.pcDefault`, `keyMap.macDefault`, the Mac `emacsy` fallthrough, the `extraKeys` in `editor.js`, and the transient map in `show-hint.js`. Cover cursor/page/document/line/group movement, deletion, overwrite mode, tab/indent behaviour, newline-and-indent, single-selection escape, select all, undo/redo and selection undo/redo, find, next/previous match, replace-all, per-line comment, move-line up/down, save, and every autocomplete-popup key. Also exercise application-owned rebuild (`Mod-Enter`), run (`Shift-Mod-Enter`), dump test (`Mod-j`), and make GIF (`Mod-k`) to prove editor bindings do not consume them. For application-owned shortcuts, spy on the existing callback; for editing shortcuts, record text, selection, and overwrite/completion state after the key press. Store the stable platform-specific results in `baselines/cm5/shortcuts.json`, including the ordered list of effective binding names for PC and Mac.

At the top level of every `cm5-*.spec.mjs`, add:

```js
test.skip(process.env.RUN_CM5_BASELINE !== "1", "CM5 baseline tests are opt-in after product cutover")
```

Use this assertion guard so routine test runs cannot overwrite the baseline:

```js
if (process.env.UPDATE_CM5_BASELINES !== "1") {
  throw new Error("Set UPDATE_CM5_BASELINES=1 only when intentionally capturing the CM5 baseline")
}
```

Run: `RUN_CM5_BASELINE=1 UPDATE_CM5_BASELINES=1 npx playwright test src/tests/codemirror6/browser/cm5-baseline.spec.mjs --config src/tests/codemirror6/playwright.config.mjs`

Expected: screenshots for both themes and project-specific measurement JSON are written for Chromium, Firefox, and WebKit at 1440x900 with device scale factor 1. Include the Playwright project name in every generated filename so parallel projects never overwrite one another.

- [ ] **Step 5: Record every current CM5 modification**

Create `docs/codemirror6-migration-ledger.md` with this initial table and paste the exact matching file/line references below it:

```md
| CM5 modification | Existing location | CM6 replacement | Verification |
| --- | --- | --- | --- |
| Dynamic hex colours | `codemirror.js` DOM construction | parser-token decoration | dynamic-colour unit + screenshot |
| 29px historical gutter | `codemirror.js` gutter measurement | scoped CM6 gutter CSS | geometry JSON + screenshot |
| Search shortcut changes | `codemirror.js` key maps | CM6 keymap | search browser test |
| Mouse multiselect disabled | `codemirror.js` mouse config | single-selection state/config | pointer browser test |
| Per-line `( line )` comments | `comment.js` | CM6 state command | command unit test |
| CM6-like CM5 search panel | `search.js` | stock `@codemirror/search` | search browser test |
```

Run: `rg -n -i "puzzlescript" src/js/codemirror src/css/codemirror.css src/css/dialog.css src/css/show-hint.css src/css/midnight.css src/css/xq-light.css`

Review the output and use `apply_patch` to add each match to the table; do not leave an unclassified match.

- [ ] **Step 6: Commit the immutable baseline**

```bash
git add docs/codemirror6-migration-ledger.md src/tests/codemirror6/playwright.config.mjs src/tests/codemirror6/browser src/tests/codemirror6/baselines/cm5
git commit -m "test: freeze CodeMirror 5 editor baseline"
```

## Task 3: Separate the compiler's StringStream from CM5

**Files:**

- Create: `src/js/puzzlescript-stream.js`
- Create: `src/tests/codemirror6/stringstream.test.mjs`
- Modify: `src/tests/run_tests_node.js`
- Modify: `src/tests/tests.html`
- Modify: `src/play.html`
- Modify: `src/standalone.html`
- Modify: `src/standalone_inlined.txt` (regenerated tracked standalone template)
- Modify: `compile.js`
- Keep temporarily: `src/js/codemirror/stringstream.js`

- [ ] **Step 1: Write a behavioural comparison test**

Create `src/tests/codemirror6/stringstream.test.mjs` that evaluates each local stream implementation in a separate `vm` context and imports `StringStream` from `@codemirror/language`. Compare the parser-used operations with explicit `tabSize: 4`: `eol`, `sol`, `peek`, `next`, `eat`, `eatWhile`, `eatSpace`, `skipToEnd`, `skipTo`, `backUp`, `column`, `indentation`, `match`, and `current`.

The core assertion is:

```js
assert.deepEqual(runTrace("src/js/puzzlescript-stream.js"), runTrace("src/js/codemirror/stringstream.js"))
assert.deepEqual(runTrace("src/js/puzzlescript-stream.js"), runOfficialStringStreamTrace())
```

If the official stream exposes additional return metadata, normalize the trace to the values observed by `codeMirrorFn`; do not add unused official methods to the lightweight stream.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/tests/codemirror6/stringstream.test.mjs`

Expected: FAIL because `src/js/puzzlescript-stream.js` is missing.

- [ ] **Step 3: Relocate the implementation without editing its behaviour**

Copy the full contents of `src/js/codemirror/stringstream.js` to `src/js/puzzlescript-stream.js`. Change only its header to:

```js
// Minimal CodeMirror-compatible StringStream used by the PuzzleScript parser
// in the player, standalone export, compiler tests, and non-editor builds.
// This is parser infrastructure and does not provide a CodeMirror editor.
```

Do not delete the old file in this task.

- [ ] **Step 4: Switch every non-editor consumer**

Replace `js/codemirror/stringstream.js` with `js/puzzlescript-stream.js` in `src/play.html`, `src/standalone.html`, and `src/tests/tests.html`. Replace `js/codemirror/stringstream.js` with `js/puzzlescript-stream.js` in `src/tests/run_tests_node.js`, and replace `./src/js/codemirror/stringstream.js` with `./src/js/puzzlescript-stream.js` in `compile.js`'s player include list.

- [ ] **Step 5: Verify the stream and existing engine**

Run these separately:

1. `node --test src/tests/codemirror6/stringstream.test.mjs`
2. `node src/tests/run_tests_node.js`
3. Record the current `.build/buildnumber.txt`, run `node compile.js`, then use `apply_patch` to restore only the recorded build-number value.
4. `rg -n "js/puzzlescript-stream\.js" src/standalone_inlined.txt bin/play.html`

Expected: stream comparison passes; existing suite reports 750 passed, 0 failed, 0 errors; generated standalone/player output uses the new parser stream. `src/standalone_inlined.txt` is an intentional tracked change in this task; `bin/` is ignored.

- [ ] **Step 6: Commit the parser-infrastructure split**

```bash
git add src/js/puzzlescript-stream.js src/tests/codemirror6/stringstream.test.mjs src/tests/run_tests_node.js src/tests/tests.html src/play.html src/standalone.html src/standalone_inlined.txt compile.js
git commit -m "refactor: separate parser stream from CodeMirror editor"
```

## Task 4: Adapt `codeMirrorFn` through StreamLanguage and prove token equivalence

**Files:**

- Create: `src/js/codemirror6/style-token.js`
- Create: `src/js/codemirror6/stream-language.js`
- Create: `src/tests/codemirror6/parser-support.mjs`
- Create: `src/tests/codemirror6/stream-language.test.mjs`
- Create: `src/tests/codemirror6/fixtures/parser-cases.js`
- Modify: `src/js/codemirror6/index.js`

- [ ] **Step 1: Create representative parser fixtures**

Export fixtures covering prelude, objects, named and hex colours, legend, sounds, collision layers, rules, win conditions, levels, nested comments, mixed case, incomplete lines, malformed lines, blank lines, adjacent same-style tokens, a 9,999-character line, and a 10,001-character line followed by `OBJECTS`.

Use explicit fixture records:

```js
export const parserCases = [
  {name: "mixed-case-object", source: "OBJECTS\nPlayer\n#Ff00aA\n.....\n.....\n.....\n.....\n.....\n"},
  {name: "nested-comment", source: "( outside ( inside ) outside )\nOBJECTS\n"},
  {name: "long-line-cutoff", source: "title " + "x".repeat(10_001) + "\nOBJECTS\nPlayer\nred\n"}
]
```

- [ ] **Step 2: Write failing style-codec and parser-equivalence tests**

The tests must assert:

```js
assert.equal(decodeStyleToken(encodeStyleToken("COLOR BOLDCOLOR COLOR-#Ff00aA")),
             "COLOR BOLDCOLOR COLOR-#Ff00aA")
assert.notEqual(encodeStyleToken("A B"), encodeStyleToken("A_B"))
assert.deepEqual(streamLanguageTokens, directParserTokens.filter(token => token.style))
assert.deepEqual(stateAfterLongLine, directCm5CompatibleStateAfterLongLine)
```

StreamLanguage intentionally omits unstyled tokens from its tree, so compare every styled span and style name plus the final copied state. The direct tokenizer helper must use `codeMirrorFn.startState`, `blankLine`, `token`, and `copyState`; it must not contain syntax recognition.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test src/tests/codemirror6/stream-language.test.mjs`

Expected: FAIL because `style-token.js` and `stream-language.js` are missing.

- [ ] **Step 4: Implement lossless style identities**

Create `style-token.js` with an ASCII-safe, collision-free encoding. The style strings emitted by `codeMirrorFn` are ASCII; encode each UTF-16 code unit as four hex digits:

```js
const prefix = "ps_"

export function encodeStyleToken(style) {
  if (!style) return null
  let encoded = prefix
  for (let i = 0; i < style.length; i++) encoded += style.charCodeAt(i).toString(16).padStart(4, "0")
  return encoded
}

export function decodeStyleToken(name) {
  if (!name.startsWith(prefix) || (name.length - prefix.length) % 4) return null
  let style = ""
  for (let i = prefix.length; i < name.length; i += 4)
    style += String.fromCharCode(parseInt(name.slice(i, i + 4), 16))
  return style
}

export function isStyleToken(name) {
  return name.startsWith(prefix)
}
```

- [ ] **Step 5: Implement the mechanical stream wrapper**

Create `stream-language.js`. Its state shape and long-line logic must be exactly:

```js
import {StreamLanguage} from "@codemirror/language"
import {Tag} from "@lezer/highlight"
import {encodeStyleToken, isStyleToken} from "./style-token.js"

export const CM5_MAX_HIGHLIGHT_LENGTH = 10_000
const puzzleTokenTag = Tag.define()
const tokenTable = new Proxy(Object.create(null), {
  get(target, property) {
    return typeof property === "string" && isStyleToken(property) ? puzzleTokenTag : target[property]
  }
})

export function wrapPuzzleScriptParser(parser) {
  return {
    name: "puzzle",
    mergeTokens: false,
    tokenTable,
    languageData: {wordChars: "#"},
    startState(indentUnit) {
      return {inner: parser.startState(indentUnit), lineStart: null, discardRestOfLine: false}
    },
    copyState(state) {
      return {
        inner: parser.copyState(state.inner),
        lineStart: state.lineStart && parser.copyState(state.lineStart),
        discardRestOfLine: state.discardRestOfLine
      }
    },
    blankLine(state, indentUnit) {
      parser.blankLine(state.inner, indentUnit)
      state.lineStart = null
      state.discardRestOfLine = false
    },
    token(stream, state) {
      if (stream.sol()) {
        state.lineStart = parser.copyState(state.inner)
        state.discardRestOfLine = false
      }
      if (state.discardRestOfLine) {
        stream.skipToEnd()
        return null
      }
      const style = parser.token(stream, state.inner)
      if (stream.pos > CM5_MAX_HIGHLIGHT_LENGTH) {
        state.inner = parser.copyState(state.lineStart)
        state.discardRestOfLine = true
      }
      return encodeStyleToken(style)
    }
  }
}

export function createPuzzleScriptLanguage(parser) {
  return StreamLanguage.define(wrapPuzzleScriptParser(parser))
}
```

If the long-line tests expose a boundary difference, adjust only the cutoff comparison and wrapper flags until the recorded CM5 token/state fixture matches. Do not change `codeMirrorFn`.

- [ ] **Step 6: Export the factory and verify equivalence**

Update `index.js` to import `createPuzzleScriptLanguage` for later assembly, without creating a parser at bundle evaluation time.

Run these separately:

1. `node --test src/tests/codemirror6/stream-language.test.mjs`
2. `node src/tests/run_tests_node.js`

Expected: all parser fixtures match and the existing 750-test suite stays green.

- [ ] **Step 7: Commit the language adapter**

```bash
git add src/js/codemirror6 src/tests/codemirror6/fixtures src/tests/codemirror6/parser-support.mjs src/tests/codemirror6/stream-language.test.mjs
git commit -m "feat: adapt PuzzleScript parser with StreamLanguage"
```

## Task 5: Add exact parser-state queries and prefix coordination

**Files:**

- Create: `src/js/codemirror6/stream-state.js`
- Create: `src/js/codemirror6/exact-prefix.js`
- Create: `src/tests/codemirror6/stream-state.test.mjs`
- Create: `src/tests/codemirror6/exact-prefix.test.mjs`
- Create: `src/tests/codemirror6/fixtures/large-source.js`

- [ ] **Step 1: Write CM5 `getTokenAt` boundary fixtures**

Capture expected `{start, end, string, type, state}` summaries for cursor columns 0, token start, token middle, token end, whitespace, and end-of-line. Match CM5's loop condition: parse while `stream.pos < cursorColumn`, so column zero returns an empty token and the state at line start.

Assert semantic state fields, not object identity:

```js
assert.deepEqual(summary(actual.state), summary(expected.state))
assert.equal(actual.start, expected.start)
assert.equal(actual.end, expected.end)
assert.equal(actual.string, expected.string)
assert.equal(actual.type, expected.type)
```

- [ ] **Step 2: Write the large-prefix failure test**

Create a source longer than 120,000 characters whose distant viewport is in `LEVELS`, while a fresh parser incorrectly started there would remain in the prelude. Assert that no range is marked exact until `ensureExactPrefix` succeeds and that the distant state is `section === "levels"` afterward.

- [ ] **Step 3: Run both tests to verify they fail**

Run: `node --test src/tests/codemirror6/stream-state.test.mjs src/tests/codemirror6/exact-prefix.test.mjs`

Expected: FAIL because the state bridge and coordinator do not exist.

- [ ] **Step 4: Port the pinned upstream checkpoint walk into one module**

In `stream-state.js`, copy the small recursive `findState` algorithm from the pinned `@codemirror/language` 6.12.4 `stream-parser.ts`. Add this guard before using private members:

```js
export function assertPinnedStreamLanguage(language) {
  if (!language || !language.stateAfter || !language.streamParser ||
      typeof language.streamParser.copyState !== "function") {
    throw new Error("Unsupported @codemirror/language StreamLanguage internals; expected 6.12.4")
  }
}
```

Export `getTokenAtPosition(editorState, language, position)`. It must:

1. Clip `position` to the document.
2. Require an exact tree through the current line start.
3. Copy the nearest `stateAfter` checkpoint.
4. Advance the wrapped parser over complete intervening lines.
5. Tokenize the current line using CM5's `stream.pos < column` boundary.
6. Return the decoded parser style and `wrappedState.inner`.

Do not fall back to raw-text classification or a fresh parser at the distant line.

- [ ] **Step 5: Implement explicit exact-prefix state**

In `exact-prefix.js`, define a `StateEffect` and `StateField<number>` whose value resets to 0 on document changes and only advances after `ensureSyntaxTree` returns a tree spanning the requested prefix:

```js
import {ensureSyntaxTree, syntaxTreeAvailable} from "@codemirror/language"
import {StateEffect, StateField} from "@codemirror/state"

export const setExactPrefix = StateEffect.define()
export const exactPrefix = StateField.define({
  create: () => 0,
  update(value, transaction) {
    if (transaction.docChanged) value = 0
    for (const effect of transaction.effects) if (effect.is(setExactPrefix)) value = Math.max(value, effect.value)
    return value
  }
})

export function ensureExactPrefix(view, upto, timeout = 50) {
  const target = Math.min(upto, view.state.doc.length)
  const tree = ensureSyntaxTree(view.state, target, timeout)
  if (!tree || !syntaxTreeAvailable(view.state, target)) return false
  view.dispatch({effects: setExactPrefix.of(target)})
  return true
}
```

Add a bounded idle scheduler that repeatedly calls `ensureExactPrefix(view, view.viewport.to, 25)` and cancels its callback on plugin destruction.

- [ ] **Step 6: Verify exact state, diagnostic stability, and existing tests**

Add a test that snapshots `errorStrings`/`errorCount`, performs repeated state queries, compiles the same source, and proves compilation messages remain identical and unmultiplied.

Run these separately:

1. `node --test src/tests/codemirror6/stream-state.test.mjs src/tests/codemirror6/exact-prefix.test.mjs`
2. `node src/tests/run_tests_node.js`

Expected: all new tests pass; existing suite remains 750/750.

- [ ] **Step 7: Commit the state bridge**

```bash
git add src/js/codemirror6/stream-state.js src/js/codemirror6/exact-prefix.js src/tests/codemirror6
git commit -m "feat: provide exact StreamLanguage parser state"
```

## Task 6: Present parser tokens and dynamic colours without retokenizing

**Files:**

- Create: `src/js/codemirror6/dynamic-colors.js`
- Create: `src/js/codemirror6/token-presentation.js`
- Create: `src/tests/codemirror6/token-presentation.test.mjs`
- Modify: `src/js/codemirror6/index.js`
- Modify: `docs/codemirror6-migration-ledger.md`

- [ ] **Step 1: Write failing presentation tests**

Test exact mappings:

```js
assert.deepEqual(classesForStyle("COLOR BOLDCOLOR COLOR-RED"),
                 ["cm-COLOR", "cm-BOLDCOLOR", "cm-COLOR-RED"])
assert.equal(dynamicHexForStyle("MULTICOLOR#Ff00aA"), "#Ff00aA")
assert.equal(dynamicHexForStyle("COLOR COLOR-#123"), "#123")
assert.deepEqual(presentationClasses("MULTICOLOR#Ff00aA"), ["cm-COLOR"])
assert.deepEqual(presentationClasses("COLOR COLOR-#123"), ["cm-COLOR", "cm-COLOR-#123"])
assert.equal(dynamicHexForStyle("NAME"), null)
```

Create an incomplete-prefix editor state and assert `buildTokenDecorations` returns `Decoration.none` rather than styling the approximate viewport.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/tests/codemirror6/token-presentation.test.mjs`

Expected: FAIL because presentation modules are missing.

- [ ] **Step 3: Extract the existing dynamic-colour algorithm exactly**

Copy `styleFromHexCode` and its cache from the PuzzleScript block near the top of `src/js/codemirror/codemirror.js` into `dynamic-colors.js`. Export `styleFromHexCode`. Preserve its midnight-background contrast adjustment byte-for-byte; do not replace it with CSS `color: <hex>`. Leave the original CM5 block untouched while CM5 is still active; it disappears only with the final CM5 core deletion.

- [ ] **Step 4: Build decorations only from decoded tree nodes**

Implement:

```js
export function classesForStyle(style) {
  return style.split(/\s+/).filter(Boolean).map(name => "cm-" + name)
}

export function dynamicHexForStyle(style) {
  const match = style.match(/(?:^MULTICOLOR|(?:^|\s)COLOR-)(#[0-9a-fA-F]{3,8})(?:\s|$)/)
  return match ? match[1] : null
}
```

The decoration builder must iterate `syntaxTree(view.state)` nodes, decode only `ps_` node names, and create `Decoration.mark` ranges. Apply classes from the decoded style. When `MULTICOLOR#...` supplies a dynamic value, CM5 replaces that generated class with only `cm-COLOR`; do the same. For `COLOR COLOR-#...`, retain both returned classes and add the inline style. In both cases use the existing `styleFromHexCode` result.

Guard the builder with:

```js
if (view.state.field(exactPrefix) < Math.max(...view.visibleRanges.map(range => range.to)))
  return Decoration.none
```

- [ ] **Step 5: Regenerate the bundle and verify no independent tokenizer exists**

Run these separately:

1. `npm run build:codemirror`
2. `node --test src/tests/codemirror6/token-presentation.test.mjs`
3. `rg -n "codeMirrorFn|\.token\(" src/js/codemirror6`

Expected: tests pass; `.token(` appears only in `stream-language.js` and the state-replay code in `stream-state.js`, never in token presentation.

- [ ] **Step 6: Update the ledger and commit**

Mark dynamic colours as implemented but not yet browser/visual verified.

```bash
git add src/js/codemirror6 src/js/codemirror6.bundle.js src/js/codemirror6.bundle.js.map src/tests/codemirror6/token-presentation.test.mjs docs/codemirror6-migration-ledger.md
git commit -m "feat: render PuzzleScript tokens from StreamLanguage"
```

## Task 7: Extract autocomplete and preserve CM5 behaviour before CM6 uses it

**Files:**

- Create: `src/js/puzzlescript-autocomplete.js`
- Create: `src/tests/codemirror6/autocomplete-golden.test.mjs`
- Create: `src/tests/codemirror6/fixtures/autocomplete-cases.js`
- Create: `src/tests/codemirror6/browser/cm5-autocomplete.spec.mjs`
- Modify: `src/js/codemirror/anyword-hint.js`
- Modify: `src/editor.html`
- Modify: `compile.js`

- [ ] **Step 1: Capture golden completion cases through the current CM5 helper**

Create cases for prelude metadata, object-name generation, object colours, legend directional expansion, sounds, collision layers, rule directions/commands, rule mirror/rotate, win conditions, levels, comments, empty words, mid-word edits, and original-case object suggestions.

Each expected result records only stable fields:

```js
{
  name: "object-name-original-case",
  cursor: {line: 12, ch: 3},
  expected: {
    from: {line: 12, ch: 0},
    to: {line: 12, ch: 3},
    list: [{text: "Player", extra: "", tag: "NAME"}]
  }
}
```

Run the unmodified registered CM5 helper against fake editor methods `getCursor`, `getLine`, and `getTokenAt` to verify the golden data passes before refactoring.

- [ ] **Step 2: Extract a pure function while keeping the CM5 bridge green**

Move the candidate constants, rotation helpers, and the body of the current helper into a browser-global module. Keep the DOM-based CM5 `renderHint` function in `anyword-hint.js`; the pure module returns only its existing `{text, extra, tag}` metadata and must run without `document`:

```js
window.PuzzleScriptAutocomplete = Object.freeze({
  complete({line, previousLine, cursor, token, state, word = /[\w$#>-]+/, range = 500, list = []}) {
    return completePuzzleScript({line, previousLine, cursor, token, state, word, range, list})
  },
  excludedKeyCodes: Object.freeze({
    9: "tab", 13: "enter", 16: "shift", 17: "ctrl", 18: "alt", 19: "pause",
    20: "capslock", 27: "escape", 33: "pageup", 34: "pagedown", 35: "end",
    36: "home", 37: "left", 38: "up", 39: "right", 40: "down", 45: "insert",
    91: "left window key", 92: "right window key", 93: "select", 107: "add",
    109: "subtract", 110: "decimal point", 111: "divide", 112: "f1", 113: "f2",
    114: "f3", 115: "f4", 116: "f5", 117: "f6", 118: "f7", 119: "f8",
    120: "f9", 121: "f10", 122: "f11", 123: "f12", 144: "numlock",
    145: "scrolllock", 186: "semicolon", 187: "equalsign", 188: "comma",
    191: "slash", 192: "graveaccent", 220: "backslash"
  })
})
```

Define `completePuzzleScript` by moving the current candidate-generation body from the registered helper, from its `word`/`range` initialization through its final returned list. Replace `editor.getLine(cur.line)` with `line`, `editor.getLine(cur.line - 1)` with `previousLine`, `cur.ch` with `cursor`, and `editor.getTokenAt(cur)` with `token`. Mechanically replace `CodeMirror.Pos(cur.line, start)` results with numeric `start`, and `CodeMirror.Pos(cur.line, end)` with numeric `end`. Do not alter candidate arrays, ordering, matching, transformations, casing, tags, or details. The omitted key codes 189, 190, and 222 remain deliberately eligible, matching the comments in the current table.

Replace `anyword-hint.js`'s registered helper with this thin conversion:

```js
const result = PuzzleScriptAutocomplete.complete({
  line: editor.getLine(cur.line),
  previousLine: editor.getLine(cur.line - 1),
  cursor: cur.ch,
  token: editor.getTokenAt(cur),
  state: editor.getTokenAt(cur).state,
  word: options && options.word,
  range: options && options.range,
  list: options && options.list
})
return {
  list: result.list.map(item => ({...item, render: renderHint})),
  from: CodeMirror.Pos(cur.line, result.from),
  to: CodeMirror.Pos(cur.line, result.to)
}
```

Call `getTokenAt` once and reuse the result.

- [ ] **Step 3: Insert the pure script before the CM5 bridge**

In `src/editor.html`, load `js/puzzlescript-autocomplete.js` after `rule-transform.js` and before `codemirror/anyword-hint.js`. Insert the same file in `compile.js`'s editor include list at that position.

- [ ] **Step 4: Run golden, browser smoke, and engine tests**

Run these separately:

1. `node --test src/tests/codemirror6/autocomplete-golden.test.mjs`
2. `node src/tests/run_tests_node.js`
3. `RUN_CM5_BASELINE=1 npx playwright test src/tests/codemirror6/browser/cm5-autocomplete.spec.mjs --project=chromium --config src/tests/codemirror6/playwright.config.mjs`

Expected: golden results unchanged, 750/750 engine tests, and CM5 autocomplete opens with the same first item and replacement range.

- [ ] **Step 5: Commit the behaviour-preserving extraction**

```bash
git add src/js/puzzlescript-autocomplete.js src/js/codemirror/anyword-hint.js src/tests/codemirror6 src/editor.html compile.js
git commit -m "refactor: isolate PuzzleScript autocomplete logic"
```

## Task 8: Add native CM6 autocomplete using exact parser state

**Files:**

- Create: `src/js/codemirror6/autocomplete.js`
- Create: `src/tests/codemirror6/cm6-autocomplete.test.mjs`
- Modify: `src/js/codemirror6/index.js`

- [ ] **Step 1: Write failing CM6 conversion tests**

For every golden case, create an `EditorState`, obtain exact state through `getTokenAtPosition`, call the CM6 source, and compare semantic labels, PuzzleScript extra text/tag metadata, order, `from`, and applied replacement text with the golden CM5 result.

Also assert comment and unavailable-prefix cases return `null` or an empty result without guessing.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/tests/codemirror6/cm6-autocomplete.test.mjs`

Expected: FAIL because `codemirror6/autocomplete.js` is missing.

- [ ] **Step 3: Implement the native completion source**

Export `puzzleScriptCompletionSource({language, complete})`, which returns an async CM6 completion source. It must ensure the prefix through `context.pos`, query `getTokenAtPosition`, call the pure completion function, and map items exactly:

```js
return {
  from: line.from + result.from,
  to: line.from + result.to,
  filter: false,
  options: result.list.map(item => ({
    label: item.text,
    psExtra: item.extra || "",
    psTag: item.tag || null,
    type: item.tag || undefined,
    apply: item.text
  }))
}
```

Use `filter: false` because the existing pure function already defines case-insensitive filtering and order.

- [ ] **Step 4: Preserve key-release activation and option rendering**

Export `puzzleScriptAutocomplete(options)`, which creates the source with `puzzleScriptCompletionSource(options)` and returns the completion extension plus keyup handler. Configure CM6 `autocompletion({activateOnTyping: false, defaultKeymap: false, interactionDelay: 0, maxRenderedOptions: Number.MAX_SAFE_INTEGER, icons: false, override: [source], ...})`. `defaultKeymap: false` is mandatory because the extension otherwise installs its broad stock completion map even when `completionKeymap` is not imported explicitly. The zero interaction delay matches CM5's immediately usable popup, and the untruncated render limit preserves CM5's all-options list. Add a `keyup` DOM handler that calls `startCompletion(view)` unless `event.keyCode` is in the unchanged `excludedKeyCodes` table. Browser coverage must include one-item and 150-item lists, punctuation/close-character updates, single-click acceptance, and blur closure.

Use `addToOptions` to reproduce the current `renderHint` output with a `.cm-s-midnight` wrapper, a `cm-<tag>` span for the primary text, and the existing plain leading-space extra text. Do not map `psExtra` to CM6's stock `detail` field: the current renderer creates an orange element but appends only its unstyled text node, so displaying an orange or stock-styled detail would be a migration change. Suppress the duplicate stock visible label while retaining `label` for replacement/semantics, and verify accessible option text in the browser test. Do not introduce font or spacing CSS in JavaScript.

Export `puzzleScriptCompletionKeymap`, but do not spread CM6's stock `completionKeymap`. Match CM5's popup-only map exactly: Up/Down wrap, PageUp/PageDown clamp by one visible page, Home/End select first/last, Enter and Tab accept, Escape closes, and Mac Ctrl-P/Ctrl-N move up/down. Each command must return `false` when no completion is active so the normal editor binding or browser behaviour can run. Do not add Ctrl-Space or any other manual activation key that CM5 did not have.

- [ ] **Step 5: Verify and commit**

Run these separately:

1. `node --test src/tests/codemirror6/cm6-autocomplete.test.mjs`
2. `npm run build:codemirror`
3. `npm run check:codemirror`

Expected: all golden conversions pass and the bundle is current.

```bash
git add src/js/codemirror6 src/js/codemirror6.bundle.js src/js/codemirror6.bundle.js.map src/tests/codemirror6/cm6-autocomplete.test.mjs
git commit -m "feat: add native CodeMirror 6 autocomplete"
```

## Task 9: Introduce the narrow editor API while CM5 remains active

**Files:**

- Create: `src/js/editor-api.js`
- Create: `src/js/editor-cm5.js`
- Create: `src/tests/codemirror6/editor-api.test.mjs`
- Create: `src/tests/codemirror6/browser/cm5-adapter.spec.mjs`
- Modify: `src/js/editor.js`
- Modify: `src/js/compiler.js`
- Modify: `src/js/console.js`
- Modify: `src/js/inputoutput.js`
- Modify: `src/js/mobile.js`
- Modify: `src/js/toolbar.js`
- Modify: `src/js/imagepaste.js`
- Modify: `src/editor.html`
- Modify: `compile.js`

- [ ] **Step 1: Write the contract test around a fake driver**

Assert the application-facing methods and forbid leaked fields. In the CM5 browser adapter spec, record exact `setValue` cursor/selection placement, focus/blur state, full-selection replacement, last-line value, cursor clipping, scroll target, and the fact that `clearHistory` makes the immediately preceding `setValue` non-undoable:

```js
assert.deepEqual(Object.keys(editor).sort(), [
  "blur", "clearHistory", "focus", "getInputElement", "getLastLine",
  "getValue", "replaceSelection", "scrollToLine", "setCursor", "setValue"
])
assert.equal(editor.doc, undefined)
assert.equal(editor.display, undefined)
```

- [ ] **Step 2: Run the contract test to verify it fails**

Run: `node --test src/tests/codemirror6/editor-api.test.mjs`

Expected: FAIL because `editor-api.js` is missing.

- [ ] **Step 3: Implement the adapter constructor and CM5 driver**

Create a frozen adapter that forwards only the ten methods:

```js
function createPuzzleScriptEditor(driver) {
  return Object.freeze({
    getValue: () => driver.getValue(),
    setValue: text => driver.setValue(text),
    clearHistory: () => driver.clearHistory(),
    focus: () => driver.focus(),
    blur: () => driver.blur(),
    replaceSelection: text => driver.replaceSelection(text),
    setCursor: (line, column) => driver.setCursor(line, column),
    scrollToLine: line => driver.scrollToLine(line),
    getLastLine: () => driver.getLastLine(),
    getInputElement: () => driver.getInputElement()
  })
}

function createCM5EditorDriver(cm) {
  return {
    getValue: () => cm.getValue(),
    setValue: text => cm.setValue(text),
    clearHistory: () => cm.clearHistory(),
    focus: () => cm.focus(),
    blur: () => cm.getInputField().blur(),
    replaceSelection: text => cm.replaceSelection(text),
    setCursor: (line, column) => cm.setCursor(line, column),
    scrollToLine: line => cm.scrollIntoView({line, ch: 0}),
    getLastLine: () => cm.lastLine(),
    getInputElement: () => cm.getInputField()
  }
}
```

Expose both functions on `window.PuzzleScriptEditorAPI`.

- [ ] **Step 4: Split the CM5 driver from shared application code**

Move only CM5-owned code from `editor.js` into `editor-cm5.js`: `defineMode`, `registerHelper`, swap-line commands, `fromTextArea`, raw change/keyup/mousedown/drop event binding, theme option, and CM5 wrapper/input access. The file exposes one build-selected driver:

```js
window.PuzzleScriptEditorDriver = Object.freeze({
  create(options) {
    const cmEditor = CodeMirror.fromTextArea(options.textarea, {
      lineWrapping: true,
      lineNumbers: true,
      styleActiveLine: true,
      extraKeys: {
        "Ctrl-/": "toggleComment",
        "Cmd-/": "toggleComment",
        "Esc": CodeMirror.commands.clearSearch,
        "Shift-Ctrl-Up": "swapLineUp",
        "Shift-Ctrl-Down": "swapLineDown"
      }
    })
    cmEditor.setOption("theme", "midnight")
    cmEditor.on("change", () => options.callbacks.onChange(cmEditor.getValue()))
    cmEditor.on("keyup", (instance, event) => {
      const keyCode = String(event.keyCode || event.which)
      if (!options.autocomplete.excludedKeyCodes[keyCode])
        CodeMirror.commands.autocomplete(instance, null, {completeSingle: false})
    })
    cmEditor.on("mousedown", (instance, event) => {
      if (event.target.className === "cm-SOUND") {
        options.callbacks.onSound(parseInt(event.target.textContent, 10))
      } else if (event.target.className === "cm-LEVEL" && (event.ctrlKey || event.metaKey)) {
        document.activeElement.blur()
        cmEditor.getInputField().blur()
        prevent(event)
        options.callbacks.onLevel(instance.posFromMouse(event).line)
      }
    })
    cmEditor.on("drop", (instance, event) => {
      const file = event.dataTransfer.files[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => options.callbacks.onSourceDrop(file, reader.result)
      reader.onerror = () => consoleError(reader.error)
      reader.readAsText(file)
      prevent(event)
    })
    installImagePasteHandler(cmEditor)
    return PuzzleScriptEditorAPI.createPuzzleScriptEditor(
      PuzzleScriptEditorAPI.createCM5EditorDriver(cmEditor)
    )
  }
})
```

Keep in `editor.js`: initial textarea/save/demo/gist loading, `_editorDirty`, `_editorCleanState`, `checkEditorDirty`, `setEditorClean`, `getParameterByName`, `tryLoadGist`, `tryLoadFile`, `canExit`, `dropdownChange`, `unescapeSlashes`, `rip_source_from_html`, source-drop result handling, and every debug-timeline function currently below the drop handler.

After initial source selection, shared `editor.js` declares the global lexical binding and calls the one driver loaded by HTML:

```js
let editor = PuzzleScriptEditorDriver.create({
  textarea: code,
  autocomplete: PuzzleScriptAutocomplete,
  callbacks: {
    onChange: checkEditorDirty,
    onSourceDrop: loadDroppedSource,
    onSound: seed => playSound(seed, true),
    onLevel: line => compile(["levelline", line])
  },
  imagePaste: {imageBlobToObjectText}
})
code.editorreference = editor
_editorCleanState = editor.getValue()
```

`loadDroppedSource(file, rawText)` retains the current `.html` extraction, `.txt` validation, `setValue`, `clearHistory`, and console messages. There is no conditional that chooses a driver—the HTML includes exactly one driver script.

Load scripts in this order: `editor-api.js`, `editor-cm5.js`, `editor.js`. Add the same order to `compile.js`.

- [ ] **Step 5: Remove application reach-throughs**

Apply these exact substitutions outside the CM5 bootstrap:

- `editor.display.input.blur()` → `editor.blur()`
- `editor.doc.lastLine()` → `editor.getLastLine()`
- `editor.scrollIntoView(line)` → `editor.scrollToLine(line)`
- `editor.getInputField()` → `editor.getInputElement()`
- Image paste obtains its event target from `editor.getInputElement()` or an explicit wrapper passed by the driver; do not add `getWrapperElement()` to the public API.

Run: `rg -n "editor\.(doc|display|getInputField|getWrapperElement|setOption|on)" src/js --glob '!codemirror/**' --glob '!editor-cm5.js'`

Expected: no matches outside `src/js/editor.js`'s private `cmEditor` code.

- [ ] **Step 6: Verify active CM5 behaviour and commit**

Run these separately:

1. `node --test src/tests/codemirror6/editor-api.test.mjs`
2. `node src/tests/run_tests_node.js`
3. `RUN_CM5_BASELINE=1 npx playwright test src/tests/codemirror6/browser/cm5-adapter.spec.mjs --project=chromium --config src/tests/codemirror6/playwright.config.mjs`

Expected: adapter contract passes, engine remains 750/750, and editor focus/error navigation/image paste smoke checks pass.

```bash
git add src/js/editor-api.js src/js/editor-cm5.js src/js/editor.js src/js/compiler.js src/js/console.js src/js/inputoutput.js src/js/mobile.js src/js/toolbar.js src/js/imagepaste.js src/editor.html compile.js src/tests/codemirror6
git commit -m "refactor: isolate application editor API"
```

## Task 10: Implement CM6 editor adapter, comments, line movement, and search

**Files:**

- Create: `src/js/codemirror6/editor-adapter.js`
- Create: `src/js/codemirror6/commands.js`
- Create: `src/js/codemirror6/search.js`
- Create: `src/tests/codemirror6/commands.test.mjs`
- Create: `src/tests/codemirror6/search.test.mjs`
- Create: `src/tests/codemirror6/browser/cm6-search.spec.mjs`
- Modify: `src/js/codemirror6/index.js`

- [ ] **Step 1: Write command tests from current CM5 results**

Cover a cursor, partial selection, whole-line selection ending at column zero, blank lines, forward/backward selections, programmatically supplied multiple ranges, first/last-line movement, and one-step undo. Assert exact text and selection ranges after each command. Replay every entry in the Task 2 shortcut matrix against CM6 and compare editing outcomes, selection/overwrite/completion state, and callback counts. Add a structural assertion that the assembled CM6 binding-name lists equal the frozen PC and Mac lists, so an imported CM6 default cannot silently add a shortcut even when the test fixture would make it a no-op.

For comments, preserve this transformation:

```js
assert.equal(applyToggle("alpha\nbeta", lines(0, 1)), "( alpha )\n( beta )")
assert.equal(applyToggle("( alpha )\n( beta )", lines(0, 1)), "alpha\nbeta")
```

- [ ] **Step 2: Write stock-search invariants**

In the Node test, export and test a `forceCaseInsensitive(query)` helper. Given a `SearchQuery` with every combination of `literal`, `regexp`, `replace`, `wholeWord`, and `test`, it must return an equivalent query with only `caseSensitive` changed to false.

In `browser/cm6-search.spec.mjs`, specify the real-panel cases to run when Task 12 creates the candidate: create `Alpha alpha ALPHA`, open the standard search panel, and assert literal and regexp searches find all three variants. Assert selection-as-query, next/previous wrap, whole-word mode, replace, replace-all, an invalid regexp does not throw or replace text, a zero-width regexp advances without looping, the match-case control is disabled/hidden, and `getSearchQuery(state).caseSensitive === false` after every panel/keymap action.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test src/tests/codemirror6/commands.test.mjs src/tests/codemirror6/search.test.mjs`

Expected: FAIL because the modules are missing.

- [ ] **Step 4: Implement commands with CM6 transactions**

Implement the comment command by collecting selected line numbers, deciding once whether every nonblank selected line has a leading `(` and trailing `)`, and dispatching all changes in one transaction with the selection mapped through `ChangeSet`.

Bind:

```js
{key: "Mod-/", run: togglePuzzleScriptComment},
{key: "Shift-Ctrl-ArrowUp", run: moveLineUp},
{key: "Shift-Ctrl-ArrowDown", run: moveLineDown}
```

Export these application-editor bindings as `puzzleScriptKeymap`. Also export `puzzleScriptCoreKeymap`, an explicit CM6-command translation of the frozen CM5 `basic`, PC, Mac, and Mac-emacsy maps. Preserve platform differences with `mac`, `win`, and `linux` fields on bindings; do not approximate Cmd-only and Ctrl-only commands with `Mod` where CM5 distinguished them. CM5's Ctrl-S/Cmd-S entry names an undefined `save` editor command and therefore falls through to PuzzleScript's document-level save handler; preserve that observable behaviour by leaving it unbound in CM6. Implement small compatibility commands for any CM5 semantics CM6 does not supply directly, including overwrite toggle/typing and the recorded Tab, Shift-Tab, Escape, kill-line, open-line, transpose-character, and selection-history behaviours where required by the golden tests. Use CM6's native `moveLineUp`/`moveLineDown` only after the recorded selection and undo tests prove parity; otherwise keep the small PuzzleScript transaction command in this module.

The editor factory installs one ordered array with the popup-only autocomplete bindings first, PuzzleScript `extraKeys` second, and the explicit core bindings last. It must not install `defaultKeymap`, `historyKeymap`, or any broad preset. Leave `Mod-s`, `Mod-Enter`, `Shift-Mod-Enter`, `Mod-j`, and `Mod-k` unbound so the existing page-level handlers receive them exactly as under CM5.

- [ ] **Step 5: Configure standard search without forking it**

Export the resulting extensions as `puzzleScriptSearch()`. Use:

```js
search({top: true, caseSensitive: false, regexp: false, wholeWord: false})
```

Export an explicit `puzzleScriptSearchKeymap`; do not install CM6's stock `searchKeymap`, because it adds F3 and Mod-d bindings absent from PuzzleScript. Bind only the current CM5 commands: PC Ctrl-F/Ctrl-G/Shift-Ctrl-G/Shift-Ctrl-R, Mac Cmd-F/Cmd-G/Shift-Cmd-G/Shift-Cmd-Alt-F, and Escape to close the panel. Preserve the PC/Mac distinction with `mac`, `win`, and `linux` binding fields. A mount/update plugin finds the standard `[name=case]` checkbox, sets `disabled`, removes it from tab order, sets `aria-hidden`, and hides its containing label. On every update, assert the current query is case-insensitive; if a case-sensitive query enters through an exposed CM6 command, immediately dispatch a new `SearchQuery` copying `search`, `literal`, `regexp`, `replace`, `wholeWord`, and `test` with `caseSensitive: false`.

- [ ] **Step 6: Implement the narrow CM6 driver**

The driver closes over the exact `extensions` array used by the factory and must pass every recorded CM5 adapter behaviour from Task 9. `getValue()` returns `view.state.doc.toString()`. `setValue(text)` replaces `0..doc.length` and sets the selection to the recorded CM5 position. `replaceSelection(text)` dispatches `view.state.replaceSelection(text)`. It converts line/column positions with a clipping helper around `state.doc.line(line + 1).from + column`, uses `EditorView.scrollIntoView`, and returns `view.contentDOM` from `getInputElement`. `clearHistory()` replaces the state with `EditorState.create({doc: view.state.doc, selection: view.state.selection, extensions})`, preserving document, selection, language, callbacks, and configuration while creating empty history. It must not expose `EditorView` through the public adapter.

- [ ] **Step 7: Verify, rebuild, and commit**

Run these separately:

1. `node --test src/tests/codemirror6/commands.test.mjs src/tests/codemirror6/search.test.mjs src/tests/codemirror6/editor-api.test.mjs`
2. `npm run build:codemirror`
3. `npm run check:codemirror`

Expected: command/search/adapter tests pass and generated output is current.

```bash
git add src/js/codemirror6 src/js/codemirror6.bundle.js src/js/codemirror6.bundle.js.map src/tests/codemirror6
git commit -m "feat: add CM6 editing commands and search"
```

## Task 11: Port token interactions, image paste, source drop, and dirty state

**Files:**

- Create: `src/js/codemirror6/interactions.js`
- Create: `src/tests/codemirror6/interactions.test.mjs`
- Create: `src/tests/codemirror6/browser/cm6-interactions.spec.mjs`
- Modify: `src/js/imagepaste.js`
- Modify: `src/js/editor-cm5.js`
- Modify: `src/js/codemirror6/editor-adapter.js`
- Modify: `src/js/codemirror6/index.js`

- [ ] **Step 1: Write failing interaction tests**

Use state-level fakes in `interactions.test.mjs` for token lookup and callback dispatch. Add the real DOM/pointer/clipboard/drop cases to `browser/cm6-interactions.spec.mjs`, which will run once the candidate page exists in Task 12. Together they assert:

- Clicking the parser-produced `SOUND` range calls `playSound(Number(text), true)` once.
- Plain-clicking a `LEVEL` token does nothing.
- Ctrl-click and Meta-click on `LEVEL` call `compile(["levelline", zeroBasedLine])`, blur, and prevent refocus.
- Clicking text with the same characters but a non-`SOUND`/`LEVEL` parser token does nothing.
- Image paste produces the exact existing 5x5 object text.
- A `.txt` drop and exported `.html` drop load the same source as CM5.
- A document change updates `SAVE*`, and restoring the clean text restores `SAVE`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/tests/codemirror6/interactions.test.mjs`

Expected: FAIL because `codemirror6/interactions.js` is missing.

- [ ] **Step 3: Make image conversion editor-independent**

Keep `rgbToHex`, `quantizeColors`, `suggest_unused_name`, and `imageBlobToObjectText` in `imagepaste.js`. Change only the installer boundary to:

```js
function installImagePasteHandler(target, {getValue, replaceSelection, focus}) {
  target.addEventListener("paste", event => {
    const items = event.clipboardData && event.clipboardData.items
    if (!items) return
    const imageItem = Array.from(items).find(item => item.type.indexOf("image") !== -1)
    if (!imageItem) return
    event.preventDefault()
    event.stopPropagation()
    const blob = imageItem.getAsFile()
    if (!blob) return
    imageBlobToObjectText(blob, {getValue}).then(text => {
      replaceSelection(text)
      focus()
    }).catch(error => {
      consoleError("Paste image failed: " + (error && error.message ? error.message : String(error)))
    })
  }, true)
}
```

Update `editor-cm5.js` so it first creates the narrow adapter, then calls `installImagePasteHandler(cmEditor.getWrapperElement(), adapter)`, then returns the adapter. CM6 passes `view.dom` and its adapter methods. Do not duplicate the quantizer inside the bundle; provide it through the factory configuration.

- [ ] **Step 4: Implement parser-range token hit testing**

Resolve the StreamLanguage node at `view.posAtCoords({x: event.clientX, y: event.clientY})`, decode its style, and require an exact prefix through the token end. Dispatch only when the style's whitespace-separated names contain exactly `SOUND` or `LEVEL`.

- [ ] **Step 5: Port drop and dirty callbacks at the factory boundary**

The CM6 factory accepts:

```js
{
  parent,
  textarea,
  parser,
  autocomplete: {complete, excludedKeyCodes},
  callbacks: {
    onChange(source),
    onSourceDrop(file, source),
    onSound(seed),
    onLevel(line)
  },
  imagePaste: {imageBlobToObjectText}
}
```

Keep HTML source extraction (`rip_source_from_html`) in application code and pass the resulting source to the adapter. Dirty-state logic remains the existing comparison against `_editorCleanState`; the CM6 update listener invokes `onChange` only when `update.docChanged` is true, never for exact-prefix, selection, viewport, panel, or parse-completion transactions.

- [ ] **Step 6: Verify and commit**

Run these separately:

1. `node --test src/tests/codemirror6/interactions.test.mjs`
2. `node src/tests/run_tests_node.js`
3. `npm run build:codemirror`
4. `npm run check:codemirror`

Expected: interaction unit tests pass, engine remains 750/750, bundle is current.

```bash
git add src/js/codemirror6 src/js/editor-cm5.js src/js/imagepaste.js src/js/codemirror6.bundle.js src/js/codemirror6.bundle.js.map src/tests/codemirror6
git commit -m "feat: port PuzzleScript editor interactions to CM6"
```

## Task 12: Assemble a separate CM6 candidate editor page

**Files:**

- Create: `src/js/editor-cm6.js`
- Create: `src/tests/codemirror6/build-candidate-page.mjs`
- Create: `src/tests/codemirror6/candidate-page.test.mjs`
- Create: `src/tests/codemirror6/browser-global-setup.mjs`
- Create: `src/tests/codemirror6/browser/cm6-candidate.spec.mjs`
- Create: `src/tests/codemirror6/browser/cm6-large-file.spec.mjs`
- Modify: `src/tests/codemirror6/playwright.config.mjs`
- Modify: `.gitignore`
- Modify: `src/js/codemirror6/index.js`

- [ ] **Step 1: Write the candidate-page smoke test first**

Open `/tests/codemirror6/generated/editor.html` and assert:

```js
await expect(page.locator(".cm-editor")).toHaveCount(1)
await expect(page.locator(".CodeMirror")).toHaveCount(0)
await expect(page.locator("#leftpanel")).toBeVisible()
await expect(page.locator("#gameCanvas")).toBeVisible()
```

Then exercise value get/set, compile, error-line navigation, focus/blur, autocomplete, comments, and line movement through public UI or the narrow adapter. Run `cm6-search.spec.mjs` against this same page for the real stock panel, and run `cm6-interactions.spec.mjs` for sound/level clicks, image paste, source drop, and dirty state.

- [ ] **Step 2: Run the smoke test to verify it fails**

Run: `npx playwright test src/tests/codemirror6/browser/cm6-candidate.spec.mjs --project=chromium --config src/tests/codemirror6/playwright.config.mjs`

Expected: FAIL because the generated candidate page does not exist.

- [ ] **Step 3: Generate a test-only page from product markup**

`build-candidate-page.mjs` reads `src/editor.html` and produces an idempotent candidate: remove any existing `<base>`, the exact CM5 core/addon tags (`codemirror.js`, `panel.js`, `active-line.js`, `dialog.js`, `searchcursor.js`, `search.js`, `match-highlighter.js`, `show-hint.js`, `anyword-hint.js`, and `comment.js`), any existing `js/codemirror6.bundle.js` tag, and either driver (`js/editor-cm5.js` or `js/editor-cm6.js`). Keep the PuzzleScript-owned `codemirror/rule-transform.js`, `puzzlescript-autocomplete.js`, `editor-api.js`, and shared `editor.js`. Insert exactly one `<base href="../../../">`, one `js/codemirror6.bundle.js`, and one `js/editor-cm6.js` immediately before shared `js/editor.js`. Write to `src/tests/codemirror6/generated/editor.html` and ignore only `src/tests/codemirror6/generated/` in `.gitignore`. Add a generator unit test that runs the transformation against both the pre-cutover CM5 HTML and post-cutover CM6-shaped HTML and asserts each generated script occurs once.

The core generator assertions are:

```js
for (const input of [cm5ProductHtml, cm6ProductHtml]) {
  const output = transformCandidateHtml(input)
  assert.equal(count(output, '<base href="../../../">'), 1)
  assert.equal(count(output, 'src="js/codemirror6.bundle.js"'), 1)
  assert.equal(count(output, 'src="js/editor-cm6.js"'), 1)
  assert.equal(count(output, 'src="js/editor.js"'), 1)
  assert.equal(count(output, 'src="js/editor-cm5.js"'), 0)
  assert.match(output, /js\/codemirror\/rule-transform\.js/)
  assert.ok(output.indexOf('js/editor-cm6.js') < output.indexOf('js/editor.js'))
}
```

Do not add a query parameter, cookie, local-storage flag, or production conditional that selects an editor.

- [ ] **Step 4: Assemble the editor factory**

`window.PuzzleScriptCM6.createEditor(options)` must create one `EditorState` with explicit extensions rather than `basicSetup`:

```js
[
  lineNumbers(), highlightActiveLineGutter(), history({minDepth: 200, newGroupDelay: 1250}), drawSelection(),
  dropCursor(), highlightActiveLine(),
  EditorView.editorAttributes.of({class: "puzzlescript-editor"}),
  EditorState.tabSize.of(4), EditorState.allowMultipleSelections.of(false),
  EditorView.lineWrapping, language.extension, exactPrefix,
  tokenPresentation({language}),
  puzzleScriptAutocomplete({
    language,
    complete: options.autocomplete.complete,
    excludedKeyCodes: options.autocomplete.excludedKeyCodes
  }),
  puzzleScriptSearch(),
  puzzleScriptInteractions({language, callbacks: options.callbacks, imagePaste: options.imagePaste}),
  keymap.of([...puzzleScriptCompletionKeymap,
             ...puzzleScriptKeymap,
             ...puzzleScriptSearchKeymap,
             ...puzzleScriptCoreKeymap])
]
```

Do not install `defaultKeymap`, `historyKeymap`, `searchKeymap`, `completionKeymap`, `closeBrackets()`, `closeBracketsKeymap`, `rectangularSelection()`, or any extension that adds editing behaviour absent from the CM5 shortcut matrix. The pointer test must prove Alt/Option/Ctrl/Meta-click cannot add a second selection.

The factory receives `parser: codeMirrorFn()` at call time. `editor-cm6.js` exposes `window.PuzzleScriptEditorDriver.create(options)`, adds `parser: codeMirrorFn()` to those shared application options, and delegates to `PuzzleScriptCM6.createEditor`. It contains no loading, dirty-state, or debug-timeline functions.

To match `fromTextArea` placement, `editor-cm6.js` creates one host element with class `puzzlescript-editor-host`, inserts it immediately before the hidden `#code` textarea, and passes it as `parent`. Give that host only the measured 100%-width/height sizing needed to replace CM5's root in the form. `EditorView.editorAttributes` puts `puzzlescript-editor` on the actual `.cm-editor` root, so token, panel, and editor-mechanics rules are scoped to the real editor. Keep the textarea hidden. Shared `editor.js` sets `code.editorreference = editor` after adapter creation because existing page code may use that reference. Initialize the CM6 document from `code.value`; do not remove or move the surrounding form.

- [ ] **Step 5: Test exact large-file behaviour in a real view**

Load a 120,000+ character fixture, immediately scroll to the final `LEVELS` block, and assert no wrong `cm-METADATA`/`cm-ERROR` classes appear while parsing catches up. Wait for the exact-prefix marker, then assert `cm-LEVEL`. Edit before the viewport, repeat, and verify distant autocomplete uses `section === "levels"`.

- [ ] **Step 6: Verify all candidate behaviour and commit**

Run these separately:

1. `node --test src/tests/codemirror6/candidate-page.test.mjs`
2. `node src/tests/codemirror6/build-candidate-page.mjs`
3. `npx playwright test src/tests/codemirror6/browser/cm6-candidate.spec.mjs src/tests/codemirror6/browser/cm6-search.spec.mjs src/tests/codemirror6/browser/cm6-interactions.spec.mjs src/tests/codemirror6/browser/cm6-large-file.spec.mjs --project=chromium --config src/tests/codemirror6/playwright.config.mjs`

Expected: all four specs pass; active `src/editor.html` still directly loads CM5.

Export `buildCandidatePage` from `build-candidate-page.mjs`. Create `browser-global-setup.mjs`:

```js
import {buildCandidatePage} from "./build-candidate-page.mjs"

export default async function globalSetup() {
  await buildCandidatePage()
}
```

Set `globalSetup: "./browser-global-setup.mjs"` in `playwright.config.mjs`. The existing `test:codemirror-browser` package script remains a single Playwright command and now regenerates the ignored candidate page through configuration.

```bash
git add .gitignore src/js/editor-cm6.js src/js/codemirror6 src/js/codemirror6.bundle.js src/js/codemirror6.bundle.js.map src/tests/codemirror6
git commit -m "feat: assemble test-only CM6 editor candidate"
```

## Task 13: Match CM5 layout, theme, autocomplete, and stock search presentation

**Files:**

- Create: `src/css/editor-cm6.css`
- Create: `src/css/editor-theme.css`
- Create: `src/tests/codemirror6/browser/cm6-visual.spec.mjs`
- Create: `src/tests/codemirror6/browser/geometry.spec.mjs`
- Modify: `src/tests/codemirror6/build-candidate-page.mjs`
- Modify: `docs/codemirror6-migration-ledger.md`

- [ ] **Step 1: Write visual and geometry comparisons before parity CSS**

Use the CM5 screenshots and project-specific measurement JSON from Task 2. Assert exact values for root x/y/width/height, 29px line-number gutter, font family, font size, line height, wrapping points, four-pixel content padding, search-panel bounds, and autocomplete bounds within the same browser engine.

For screenshot comparison, use Playwright's screenshot matcher in Chromium with `animations: "disabled"`, `caret: "hide"`, and zero pixel tolerance for layout crops. Isolate the selection crop and allow only the agreed selection-colour difference there. Run exact numeric geometry comparisons in Chromium, Firefox, and WebKit against each engine's own CM5 measurements.

- [ ] **Step 2: Run the comparison to verify it fails**

Run: `npx playwright test src/tests/codemirror6/browser/cm6-visual.spec.mjs src/tests/codemirror6/browser/geometry.spec.mjs --project=chromium --config src/tests/codemirror6/playwright.config.mjs`

Expected: FAIL with CM6 default geometry/style differences.

- [ ] **Step 3: Create scoped CM6 mechanics and layout CSS**

Map only supported CM6 classes under `.puzzlescript-editor`:

```css
.puzzlescript-editor-host { width: 100%; height: 100%; }
.puzzlescript-editor.cm-editor { height: 100%; font-family: monospace; line-height: 1; }
.puzzlescript-editor .cm-scroller { overflow: auto; font-family: inherit; }
.puzzlescript-editor .cm-content { padding: 4px 0; }
.puzzlescript-editor .cm-line { padding: 0 4px; }
.puzzlescript-editor .cm-gutters { box-sizing: content-box; }
.puzzlescript-editor .cm-lineNumbers .cm-gutterElement { min-width: 20px; padding: 0 3px 0 5px; }
```

Tune explicit values against the baseline measurement test until the gutter is exactly 29px and the same source wraps at the same characters. Do not change surrounding `layout.css` unless the measurement proves an existing selector depends on the `.CodeMirror` root; in that case add `.puzzlescript-editor` to that selector without changing declarations.

- [ ] **Step 4: Move token colours into the shared theme stylesheet**

Copy every active token declaration from `midnight.css` into `editor-theme.css`, retaining the exact declarations and adding selectors for `.puzzlescript-editor`. Keep CM5 selectors until final removal so baseline comparisons remain possible.

Style the stock `.cm-search` panel using its existing DOM and PuzzleScript's current colours. Do not replace its markup. Style `.cm-tooltip-autocomplete` to the recorded CM5 popup bounds, font, padding, active row, and token preview.

- [ ] **Step 5: Test light/dark and every visual surface**

Run these separately:

1. `node src/tests/codemirror6/build-candidate-page.mjs`
2. `npx playwright test src/tests/codemirror6/browser/geometry.spec.mjs --config src/tests/codemirror6/playwright.config.mjs`
3. `npx playwright test src/tests/codemirror6/browser/cm6-visual.spec.mjs --project=chromium --config src/tests/codemirror6/playwright.config.mjs`

Expected: exact geometry assertions pass; screenshot differences are zero outside the separately masked selection crop.

- [ ] **Step 6: Update ledger and commit**

Mark gutter, token theme, autocomplete, standard search panel, active line, wrapping, and page layout as candidate-verified.

```bash
git add src/css/editor-cm6.css src/css/editor-theme.css src/tests/codemirror6 docs/codemirror6-migration-ledger.md
git commit -m "style: match CM5 editor layout in CM6"
```

## Task 14: Run pre-cutover cross-browser and release-candidate gates

**Files:**

- Modify only files required by demonstrated failures.
- Modify: `src/tests/codemirror6/playwright.config.mjs`
- Update: `docs/codemirror6-migration-ledger.md`

- [ ] **Step 1: Run all Node and bundle checks**

Run these separately:

1. `npm run check:codemirror`
2. `npm run test:codemirror`
3. `node src/tests/run_tests_node.js`

Expected: bundle current; all CM6 Node tests pass; engine reports 750 passed, 0 failed, 0 errors.

- [ ] **Step 2: Run the candidate in all three browser engines**

Run these separately:

1. `node src/tests/codemirror6/build-candidate-page.mjs`
2. `npm run test:codemirror-browser`

Expected: Chromium, Firefox, and WebKit projects pass all behaviour tests. Visual pixel assertions run only in the pinned Chromium project; geometry/behaviour run in all three.

- [ ] **Step 3: Run an Edge smoke test where Edge is installed**

Add a Playwright project with `channel: "msedge"` and run:

`npx playwright test src/tests/codemirror6/browser/cm6-candidate.spec.mjs --project=edge --config src/tests/codemirror6/playwright.config.mjs`

Expected: PASS. If the channel is unavailable on the execution host, record the exact skipped environment in the ledger and require the Edge smoke on a machine/CI runner with Edge before final removal.

- [ ] **Step 4: Run an actual Safari smoke test**

Playwright WebKit is automated coverage but is not the Safari application. On macOS, serve `src`, open the candidate URL in the current installed Safari, and manually run the product smoke checklist: text input, wrapping, autocomplete, search/replace, comments, line movement, sound/level clicks, image paste, source drop, focus transfer, light/dark layout, and compile/run. Record the Safari version and result in the ledger. This actual-Safari pass is mandatory before Task 17.

- [ ] **Step 5: Build the current CM5 product and candidate assets**

Run: `node compile.js`

Expected: release build exits 0 while CM5 remains the active product editor. Confirm the candidate bundle itself has already passed deterministic generation; it is not yet wired into release HTML.

Before running the build, require `git diff --exit-code -- .build/buildnumber.txt src/standalone_inlined.txt` to exit 0 and record the current build-number value. Afterward, require `git diff --exit-code -- src/standalone_inlined.txt` to remain 0 and use `apply_patch` to restore only `.build/buildnumber.txt` to the recorded value. If the precheck is not clean or the standalone template changes, stop and inspect rather than discarding it.

- [ ] **Step 6: Fix only evidenced failures and rerun their full gate**

For each failure, first add or tighten a regression assertion that fails, make the smallest fix, rerun the failing test, then rerun Steps 1–4. Do not make speculative refactors in this gate task.

- [ ] **Step 7: Commit the pre-cutover gate record**

Update the ledger with commands, browser versions, results, and any remaining externally required Edge run.

Commit each evidenced regression fix with only its test and implementation files before rerunning the gate. After all commands pass, commit the gate record separately:

```bash
git add docs/codemirror6-migration-ledger.md
git commit -m "test: verify CM6 candidate before cutover"
```

Do not proceed if any hard gate is failing or unperformed except an explicitly recorded Edge run that will be completed before Task 17.

## Task 15: Switch the product branch to CM6 in one explicit commit

**Files:**

- Modify: `src/editor.html`
- Modify: `compile.js`
- Modify: `src/js/editor-cm6.js`
- Modify: `src/css/editor-theme.css`
- Create: `src/tests/codemirror6/browser/product-editor.spec.mjs`
- Keep dormant: all CM5 core/addon/CSS files

- [ ] **Step 1: Write an active-product assertion that still fails**

Create or update a browser test that opens `/editor.html` and requires `.cm-editor`, rejects `.CodeMirror`, and repeats the candidate smoke suite.

Run: `npx playwright test src/tests/codemirror6/browser/product-editor.spec.mjs --project=chromium --config src/tests/codemirror6/playwright.config.mjs`

Expected: FAIL because the product page still loads CM5.

- [ ] **Step 2: Replace only the product editor assets**

In `src/editor.html`:

- Remove the CM5 core/addon script tags.
- Add `js/codemirror6.bundle.js` before `js/parser.js` or earlier; the bundle must not instantiate the parser at load time.
- Replace `js/editor-cm5.js` with `js/editor-cm6.js`; keep shared `js/editor.js` immediately afterward.
- Add `css/editor-cm6.css` and `css/editor-theme.css`.
- Keep old CSS files temporarily only if direct comparison still uses them; make their CM5 selectors inert because `.CodeMirror` no longer exists.

In `compile.js`, remove CM5 core/addons and `editor-cm5.js` from `includes_editor`; add the generated CM6 bundle and `editor-cm6.js` while retaining shared autocomplete, editor API, and `editor.js` in dependency order. Add the two new CSS files to combined CSS.

- [ ] **Step 3: Run product smoke and build**

Run these separately:

1. `npm run check:codemirror`
2. `npx playwright test src/tests/codemirror6/browser/product-editor.spec.mjs --project=chromium --config src/tests/codemirror6/playwright.config.mjs`
3. `node compile.js`

Expected: product page uses CM6, browser smoke passes, release build exits 0.

Apply the release-build hygiene from Task 14: require `.build/buildnumber.txt` and `src/standalone_inlined.txt` clean before the build, record the build number, require the standalone template unchanged afterward, and restore only the build-number value with `apply_patch`.

- [ ] **Step 4: Commit the atomic cutover**

```bash
git add src/editor.html compile.js src/js/editor-cm6.js src/css/editor-cm6.css src/css/editor-theme.css src/tests/codemirror6
git commit -m "feat: switch PuzzleScript editor to CodeMirror 6"
```

This commit is the product switch and must remain separable from CM5 deletion.

## Task 16: Verify the active CM6 product and standalone/release paths

**Files:**

- Modify only files required by failing regression tests.
- Modify: `DEVELOPMENT.md`
- Modify: `src/Documentation/credits.html`
- Modify: `src/Documentation/faq.html`
- Modify: `docs/codemirror6-migration-ledger.md`

- [ ] **Step 1: Run the full active-product suite**

Run these separately:

1. `npm run check:codemirror`
2. `npm run test:codemirror`
3. `node src/tests/run_tests_node.js`
4. `npm run test:codemirror-browser`

Expected: every test passes in Chromium, Firefox, and WebKit; engine remains 750/750.

- [ ] **Step 2: Verify release and standalone output**

Run: `node compile.js`

Then serve `bin` and smoke `bin/editor.html` in Chromium. Export a standalone game from the editor, load the result, and verify that compilation still uses `puzzlescript-stream.js` without loading CM6 in player/standalone pages.

Run: `rg -n "codemirror6\.bundle|cm-editor" src/play.html src/standalone.html bin/play.html`

Expected: no matches; editor page contains CM6, player/standalone do not.

Before the build, require `.build/buildnumber.txt` and `src/standalone_inlined.txt` to be clean and record the current build-number value. After recording the release/standalone result, assert `src/standalone_inlined.txt` is still unchanged and use `apply_patch` to restore only the build number. If the standalone template changes, inspect the source of nondeterminism or the missing integration change instead of discarding it.

- [ ] **Step 3: Re-run exact visual parity on the product URL**

Run the same light/dark, wrapped-line, autocomplete, search, dynamic-colour, gutter, and full-page comparisons against `/editor.html`, not the generated candidate URL.

Expected: geometry remains exact and only the approved selection crop differs.

- [ ] **Step 4: Document the checked-in bundle workflow and credits**

Add to `DEVELOPMENT.md`:

```md
### CodeMirror 6 bundle

The editor loads the committed `src/js/codemirror6.bundle.js`; running PuzzleScript does not require npm or a CDN. After changing files under `src/js/codemirror6/` or the pinned CM6 dependencies, run `npm run build:codemirror` and commit both the bundle and source map. CI/review should run `npm run check:codemirror`.

The new CodeMirror and Lezer dependencies are exact pins because `src/js/codemirror6/stream-state.js` reads the `stateAfter` and `streamParser` checkpoints stored by the pinned `StreamLanguage` implementation. Treat dependency changes as explicit migrations: inspect the upstream stream-parser source, update the contract if necessary, and run `npm run test:codemirror`, `node src/tests/run_tests_node.js`, and `npm run test:codemirror-browser` before committing regenerated output. Do not apply unattended version-range upgrades to these packages.
```

Update credits to say PuzzleScript uses CodeMirror 6 through its StreamLanguage compatibility API and retains its own stream parser. Update the FAQ's editor-reskin answer to point to `editor-theme.css` and `editor-cm6.css` instead of the removed `midnight.css`.

- [ ] **Step 5: Complete modern-browser evidence**

Run or record current Chrome, Firefox, the actual Safari application (in addition to Playwright WebKit), and Edge product smoke results. Task 17 may not start without all four installed browser families recorded as passing.

- [ ] **Step 6: Commit active-product verification fixes and docs**

Commit each demonstrated product regression fix with only its paired regression test and implementation file. Commit documentation and the verification record with:

```bash
git add DEVELOPMENT.md src/Documentation/credits.html src/Documentation/faq.html docs/codemirror6-migration-ledger.md
git commit -m "docs: document and verify CM6 editor build"
```

Inspect `git status --short` after `node compile.js`; do not stage build-number, `bin`, or standalone-template changes unless they are tracked project artifacts intentionally changed by the CM6 integration.

## Task 17: Remove dormant CM5 only after every gate passes

**Files:**

- Delete: `src/js/codemirror/codemirror.js`
- Delete: `src/js/codemirror/codemirror.js.bak`
- Delete: `src/js/codemirror/panel.js`
- Delete: `src/js/codemirror/active-line.js`
- Delete: `src/js/codemirror/dialog.js`
- Delete: `src/js/codemirror/searchcursor.js`
- Delete: `src/js/codemirror/search.js`
- Delete: `src/js/codemirror/match-highlighter.js`
- Delete: `src/js/codemirror/show-hint.js`
- Delete: `src/js/codemirror/anyword-hint.js`
- Delete: `src/js/codemirror/comment.js`
- Delete: `src/js/codemirror/stringstream.js`
- Move: `src/js/codemirror/rule-transform.js` → `src/js/rule-transform.js`
- Delete: `src/js/editor-cm5.js` (dormant CM5 driver after Task 15)
- Delete: `src/css/codemirror.css`
- Delete: `src/css/codemirror.css.bak`
- Delete: `src/css/dialog.css`
- Delete: `src/css/show-hint.css`
- Delete: `src/css/midnight.css` after its active declarations are present in `editor-theme.css`
- Delete: `src/css/xq-light.css` (not loaded by the current editor or release build)
- Modify: `src/editor.html`
- Modify: `compile.js`
- Modify: `src/css/concat`
- Modify: `src/tests/codemirror6/` references and candidate generator
- Modify: `docs/codemirror6-migration-ledger.md`

- [ ] **Step 1: Repeat the local-modification inventory before deletion**

Run:

`rg -n -i "puzzlescript" src/js/codemirror src/css/codemirror.css src/css/dialog.css src/css/show-hint.css src/css/midnight.css src/css/xq-light.css`

For every match, verify the ledger names a replacement test and that the test passed in Task 16. Stop on any unaccounted match.

- [ ] **Step 2: Prove no active references remain**

Run:

`rg -n "js/codemirror/|css/(codemirror|dialog|show-hint|xq-light)\.css|CodeMirror\.|\.CodeMirror\b" src compile.js --glob '!docs/**' --glob '!tests/codemirror6/baselines/**'`

Classify each match. Parser-test references to the old stream must already be gone. CM5 baseline documentation may remain; active HTML, JavaScript, and build-list references must be zero before deletion.

- [ ] **Step 3: Move the PuzzleScript-owned rule transform and update loads**

Use `git mv src/js/codemirror/rule-transform.js src/js/rule-transform.js`. Update `src/editor.html`, `compile.js`, tests, and autocomplete loads to `js/rule-transform.js`. Run autocomplete golden tests before deleting the rest of the directory.

- [ ] **Step 4: Delete only the ledger-approved CM5 files**

Before deletion, compare the complete active declarations in `midnight.css` with `editor-theme.css` through the token-class inventory and light/dark screenshots. Then remove every file listed in this task, including dormant `editor-cm5.js`, `midnight.css`, and unused `xq-light.css`. Preserve shared `editor.js`.

- [ ] **Step 5: Run the complete final verification from the post-deletion tree**

Run:

```bash
npm run check:codemirror
npm run test:codemirror
node src/tests/run_tests_node.js
node compile.js
npm run test:codemirror-browser
rg -n "js/codemirror/|CodeMirror\.fromTextArea|window\.CodeMirror" src/editor.html src/js src/css compile.js --glob '!puzzlescript-stream.js'
```

Expected: every test/build command exits 0; engine reports 750 passed, 0 failed, 0 errors; the final search prints no matches and exits 1, which is the expected no-match status.

For `node compile.js`, apply the same clean precheck and build-number restoration used in Tasks 14–16. A post-deletion change to `src/standalone_inlined.txt` is a failing integration signal, not generated churn to discard.

- [ ] **Step 6: Commit CM5 removal separately**

```bash
git add -A src/js/codemirror src/js/editor-cm5.js src/js/rule-transform.js src/css src/editor.html compile.js src/tests/codemirror6 docs/codemirror6-migration-ledger.md
git commit -m "refactor: remove dormant CodeMirror 5 editor"
```

## Task 18: Final audit and branch handoff

**Files:**

- Modify only documentation or tests required by the audit.

- [ ] **Step 1: Compare the final tree with the approved specification**

Walk every hard requirement and verification section in `docs/superpowers/specs/2026-08-14-codemirror-6-streamlanguage-migration-design.md`. Record its test, command, or file in the migration ledger. An assertion such as “covered by browser tests” is insufficient; name the test file and case.

- [ ] **Step 2: Scan for forbidden architecture**

Run:

```bash
rg -n -i "lezer grammar|LRLanguage|parser\.configure|legacy-modes|fromTextArea|window\.CodeMirror" src/js src/editor.html package.json compile.js --glob '!puzzlescript-stream.js'
rg -n "codeMirrorFn|\.token\(" src/js/codemirror6
```

Expected: the first search prints no Lezer grammar/facade/CM5 editor path and exits with the normal no-match status 1; parser calls in the second search exist only in the approved StreamLanguage wrapper and exact state replay.

- [ ] **Step 3: Verify exact dependency pins and generated output**

Run:

```bash
npm ls @codemirror/state @codemirror/view @codemirror/language @codemirror/commands @codemirror/search @codemirror/autocomplete @lezer/common @lezer/highlight esbuild
npm run check:codemirror
git status --short
```

Expected: versions match the plan, bundle check passes, worktree is clean.

- [ ] **Step 4: Run the final evidence suite once more**

Run:

```bash
npm run test:codemirror
node src/tests/run_tests_node.js
node compile.js
npm run test:codemirror-browser
```

Expected: all commands exit 0 with recorded test counts and browser-project results.

Apply the release-build hygiene again around `node compile.js`, then require `git status --short` to be empty before invoking the branch-finishing workflow.

- [ ] **Step 5: Use the finishing-development-branch workflow**

Invoke `superpowers:finishing-a-development-branch`. Present merge, PR, keep-branch, or cleanup options only after the fresh final evidence has been read and the working tree is clean.
