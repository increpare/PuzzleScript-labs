# CodeMirror 6 Performance Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PuzzleScript's CodeMirror 6 editor clearly faster than the frozen CodeMirror 5 editor in normal editing, autocomplete, large-document navigation, and document replacement while preserving parser correctness and pixel-level layout.

**Architecture:** Keep `codeMirrorFn` as the sole PuzzleScript parser behind the existing CM6 `StreamLanguage` compatibility layer. Remove integration-created whole-document work, let CM6 own parser checkpoints, retain only the pathological-long-line rollback, use native completion activation, preserve the safe exact parser prefix, and reuse mapped token decorations until exact replacements are ready. Keep CM6 behind a semantic application adapter and ship the deterministic checked-in IIFE with Brotli sidecars and raw-file fallback.

**Tech Stack:** Existing browser-global JavaScript, CodeMirror 6 (`@codemirror/state` 6.7.1, `view` 6.43.8, `language` 6.12.4, `commands` 6.10.4, `search` 6.7.1, `autocomplete` 6.20.3), Lezer support libraries (`@lezer/common` 1.5.2, `@lezer/highlight` 1.2.3), esbuild 0.28.2, gzipper 7.2.x, Node's test runner, Playwright 1.62.1, installed Chrome, and installed Safari through SafariDriver.

> **Final outcome — 2026-08-15:** The branch achieved the autocomplete,
> distant-navigation, decoration-reuse, heap, delivery, and frozen-fidelity
> improvements, but it did not satisfy every original runtime gate. Installed
> Safari key-to-paint p95 remains a failure at 19 ms, and whole-document
> synchronous replacement remains a failure at approximately 22 ms rather than
> becoming 2× faster. The diagnostic Chrome 4× CPU capture also misses one-frame
> autocomplete headroom at 17.699999809265137 ms p95. Branch completion accepts
> these as documented residual limits, not as passes and without weakening any
> threshold, because the user's explicit hard constraints require public CM6
> APIs, the unchanged `codeMirrorFn`/`StreamLanguage` parser architecture, and
> frozen editor fidelity. See the [final evidence report](../../codemirror6-performance-report.md).

---

## Governing specification and safety rails

Implement against `docs/superpowers/specs/2026-08-14-codemirror-6-performance-design.md`. If this plan and the specification differ, stop and resolve the documents before changing runtime code.

The implementation stays in `.worktrees/codemirror6-streamlanguage-design` on `codex/codemirror6-streamlanguage-design`. Before every commit, run `git status --short` and leave the existing user-owned edit in `src/tests/codemirror6/candidate-page.test.mjs` unstaged and unchanged.

Hard invariants:

- `codeMirrorFn` remains the sole PuzzleScript tokenizer/parser. No handwritten or generated Lezer grammar is permitted; do not add a regex highlighter, worker parser, or second parser-state index.
- Do not patch CM6 checkpoint frequency or any other CM6 private scheduling behavior. `src/js/codemirror6/stream-state.js` remains the only pinned read of `StreamLanguage` internals.
- Preserve autocomplete results and order, dynamic colours, nested/per-line comments, case-insensitive search, image paste, source drop, `SOUND`/`LEVEL` actions, shortcuts, history, error reporting, and compile/export behavior.
- Preserve layout, fonts, line geometry, gutters, wrapping, panels, and page geometry. Selection pixels retain the previously approved tolerance.
- Use public CM6 APIs for every new optimization.
- Run Edge neither as a behavior nor a performance gate. Keep the routine Chromium, Firefox, and WebKit projects; use installed Chrome and installed Safari for the final real-browser gate.
- An optimization is retained only when its isolated benchmark improves the intended path and correctness/visual tests stay green.
- Measure both synchronous work and visible settling. Do not improve a number by moving work into a later visible pause.

## Performance contract

The final comparison report must enforce these gates against freshly captured frozen-CM5 and pre-optimization-CM6 measurements:

- Large-file typing: p95 key-to-next-paint below 16.7 ms, with no per-key document stringification or token-decoration rebuild.
- Ordinary autocomplete: visible or updated below 16.7 ms, with no fixed 50 ms delay on `input.type`.
- Distant large-file jump: exact highlighting, materially faster than CM5, and no approximate parser-dependent action.
- Whole-document replacement: synchronous replacement at least 2× faster than pre-optimization CM6 for the 129,721-character fixture; visible settling must also improve and may not hide deferred work.
- Cursor movement, focus, search-panel activity, and completion selection: reuse the existing `DecorationSet` when no new text enters the viewport.
- Large-document heap: below pre-optimization CM6 and no more than approximately 1.5× frozen CM5.
- Checked-in CM6 IIFE: below 100 KiB at Brotli text mode, quality 11.

The approved reference medians are CM5/CM6: 4.5/4.2 ms key-to-paint, 1.1/52.9 ms autocomplete, 18.0/32.7 ms for 100 API edits, 2.8/22.2 ms whole-document replacement, 130.1/78.6 ms load+distant-jump+exact-style, 2.44/3.32 MiB initial heap, and 5.59/8.86 MiB large-document heap. Fresh captures must be stored alongside, not silently substituted into this historical record.

## Task 1: Add a reproducible comparison and performance harness

**Files:**

- Create: `src/tests/codemirror6/build-performance-pages.mjs`
- Create: `src/tests/codemirror6/performance-harness.test.mjs`
- Create: `src/tests/codemirror6/performance/harness.js`
- Create: `src/tests/codemirror6/performance/run-installed-browser.mjs`
- Create: `src/tests/codemirror6/performance/reference-medians.json`
- Create: `src/tests/codemirror6/performance/README.md`
- Create: `src/tests/codemirror6/performance/baselines/cm5-chrome.json`
- Create: `src/tests/codemirror6/performance/baselines/pre-cm6-chrome.json`
- Create: `src/tests/codemirror6/performance/baselines/cm5-safari.json`
- Create: `src/tests/codemirror6/performance/baselines/pre-cm6-safari.json`
- Modify: `src/tests/codemirror6/browser-global-setup.mjs`
- Modify: `package.json`
- Do not modify: `src/tests/codemirror6/candidate-page.test.mjs`

- [ ] **Step 1: Write a failing generator contract without touching the dirty test**

Create `performance-harness.test.mjs`. Import `transformCM5ComparisonHtml` from the new builder and assert that it transforms the active CM6 product HTML into a test-only CM5 page with exactly one `.CodeMirror` script stack, `editor-cm5.js`, `editor-api.js`, `editor.js`, `css/codemirror.css`, and no CM6 bundle, CM6 driver, or CM6 mechanics stylesheet. Assert idempotence.

The important contract is:

```js
assert.equal(count(output, 'src="js/codemirror/codemirror.js"'), 1)
assert.equal(count(output, 'src="js/editor-cm5.js"'), 1)
assert.equal(count(output, 'src="js/codemirror6.bundle.js"'), 0)
assert.equal(count(output, 'src="js/editor-cm6.js"'), 0)
assert.equal(count(output, 'href="css/editor-cm6.css"'), 0)
assert.equal(transformCM5ComparisonHtml(output), output)
```

Run: `node --test src/tests/codemirror6/performance-harness.test.mjs`

Expected: FAIL because `build-performance-pages.mjs` does not exist.

- [ ] **Step 2: Generate an isolated frozen-CM5 comparison page**

Implement `transformCM5ComparisonHtml(input)` as an explicit whitelist transformation, parallel to `build-candidate-page.mjs` but in a separate file. It must add `<base href="../../../">`, remove CM6-only CSS/scripts, inject the existing CM5 plugin list in its captured order, and write `src/tests/codemirror6/generated/cm5-editor.html`.

Extend `browser-global-setup.mjs`:

```js
import {buildCandidatePage} from "./build-candidate-page.mjs"
import {buildPerformancePages} from "./build-performance-pages.mjs"

export default async function globalSetup() {
  await buildCandidatePage()
  await buildPerformancePages()
}
```

Run: `node --test src/tests/codemirror6/performance-harness.test.mjs`

Expected: PASS, with the generated page remaining ignored and uncommitted.

- [ ] **Step 3: Define browser-global measurements once**

Create `performance/harness.js` as a browser-global IIFE exposing only:

```js
window.PuzzleScriptPerformance = Object.freeze({
  runAll,
  runScenario,
  summarize
})
```

Use 5 warmups and 20 recorded iterations. `summarize(samples)` must sort a copy and return `{samples, median, p95, min, max}` with p95 at `Math.ceil(length * 0.95) - 1`. Every scenario restores the same source, cursor, focus, history state, theme, viewport, and scroll position before timing.

Implement these named scenarios for both editor implementations:

```js
const scenarioNames = [
  "keyToNextPaint",
  "autocompleteVisible",
  "hundredApiEdits",
  "replaceDocumentSync",
  "replaceDocumentSettled",
  "loadDistantJumpExact",
  "cursorFocusSearchSettled"
]
```

Resolve operations through semantic-first compatibility helpers so the same harness runs before and after adapter migration:

```js
const replaceDocument = (editor, text) =>
  (editor.replaceDocument || editor.setValue).call(editor, text)
const revealLine = (editor, line, column = 0) => editor.revealLine
  ? editor.revealLine(line, {cursor: column})
  : editor.setCursor(line, column)
```

Use `performance.now()` and `requestAnimationFrame` for visible settling. Detect completion with `.CodeMirror-hints` or `.cm-tooltip-autocomplete`; detect exact distant CM6 rendering by the expected `.cm-LEVEL` span and reject any `.cm-METADATA`/`.cm-ERROR` in that viewport. Record both operation time and subsequent paint/DOM stability so deferred work remains visible in the result.

For Chromium heap measurements, the runner must open a fresh page per sample, request garbage collection through a DevTools session, then use `Runtime.getHeapUsage` after initial mount and after loading `largeSource`. Store `usedSize` in MiB. Do not claim automated Safari heap parity; Safari is a runtime/visual gate and Chromium owns the repeatable heap gate.

- [ ] **Step 4: Add installed-browser execution without a production hook**

Create `run-installed-browser.mjs` with this CLI:

```text
node src/tests/codemirror6/performance/run-installed-browser.mjs \
  --browser chrome|safari \
  --surface cm5|cm6 \
  --base-url http://127.0.0.1:4173 \
  --output /tmp/puzzlescript-cm-performance.json
```

For Chrome, use Playwright's `chromium.launch({channel: "chrome"})`. For Safari, start or connect to `safaridriver`, use the W3C WebDriver endpoints, inject `performance/harness.js` with async-script execution, and always delete the session and stop only the driver process started by this script. Never run `safaridriver --enable`; the user has already enabled it. The runner must write browser/version, surface, source lengths, warmup count, sample count, scenario summaries, and heap results where supported.

The CM5 URL is `/tests/codemirror6/generated/cm5-editor.html`; the CM6 URL is `/editor.html`. Fail if the expected editor root is absent or if a scenario returns a non-finite measurement.

- [ ] **Step 5: Pin the historical reference and add opt-in scripts**

Write `reference-medians.json` with the approved historical medians from the performance contract. Add scripts without changing the existing default test set:

```json
{
  "perf:codemirror:chrome": "node src/tests/codemirror6/performance/run-installed-browser.mjs --browser chrome",
  "perf:codemirror:safari": "node src/tests/codemirror6/performance/run-installed-browser.mjs --browser safari"
}
```

Document the required `--surface`, `--base-url`, and `--output` arguments in `performance/README.md`. Explain that performance runs are opt-in because browser scheduling makes them unsuitable for the routine unit suite.

- [ ] **Step 6: Capture the immutable pre-change baselines**

Start the existing local server with the approved project helper. Then run the installed-browser runner four times to create:

```text
src/tests/codemirror6/performance/baselines/cm5-chrome.json
src/tests/codemirror6/performance/baselines/pre-cm6-chrome.json
src/tests/codemirror6/performance/baselines/cm5-safari.json
src/tests/codemirror6/performance/baselines/pre-cm6-safari.json
```

Run each command twice and keep the run whose environment reports no page errors, backgrounded tab, or interrupted sample. Confirm that the order of magnitude agrees with `reference-medians.json`; investigate, rather than overwrite, a large disagreement.

- [ ] **Step 7: Commit the harness and fresh baselines**

Run:

1. `node --test src/tests/codemirror6/performance-harness.test.mjs`
2. `node --test src/tests/codemirror6/bundle.test.mjs src/tests/codemirror6/editor-api.test.mjs src/tests/codemirror6/stream-language.test.mjs src/tests/codemirror6/cm6-autocomplete.test.mjs`
3. `git status --short`

Expected: tests pass; only the new harness/baseline files, `browser-global-setup.mjs`, and `package.json` are intended changes, plus the untouched user-owned candidate-page test edit.

Commit:

```bash
git add package.json src/tests/codemirror6/browser-global-setup.mjs \
  src/tests/codemirror6/build-performance-pages.mjs \
  src/tests/codemirror6/performance-harness.test.mjs \
  src/tests/codemirror6/performance
git commit -m "test: add CodeMirror performance harness"
```

## Task 2: Replace per-keystroke strings with structural dirty tracking

**Files:**

- Modify: `src/js/codemirror6/editor-adapter.js`
- Modify: `src/js/codemirror6/interactions.js`
- Modify: `src/js/codemirror6/index.js`
- Modify: `src/js/editor-api.js`
- Modify: `src/js/editor-cm5.js`
- Modify: `src/js/editor.js`
- Modify: `src/tests/codemirror6/editor-api.test.mjs`
- Modify: `src/tests/codemirror6/interactions.test.mjs`
- Modify: `src/tests/codemirror6/browser/cm6-interactions.spec.mjs`

- [ ] **Step 1: Write failing clean-state transition tests**

Add adapter tests for initial clean state, first edit (`false → true`), further edits without duplicate callback, `markClean()` (`true → false`), undo exactly to the clean document, redo away from it, and same-length edits. Assert that `getValue()` is the only operation that calls `Text.toString()`.

Change the interaction unit test so the exact CM6 `Text` object, not a string, reaches the document-change callback:

```js
const doc = {toString() { throw new Error("must not stringify") }}
notifyPuzzleScriptChange({docChanged: true, state: {doc}}, value => calls.push(value))
assert.deepEqual(calls, [doc])
```

Run: `node --test src/tests/codemirror6/editor-api.test.mjs src/tests/codemirror6/interactions.test.mjs`

Expected: FAIL because the current listener calls `doc.toString()` and the adapter has no clean-state operations.

- [ ] **Step 2: Implement a document-type-agnostic transition tracker**

Export this shape from `editor-adapter.js`; keep the comparator injected so CM5 can use strings without importing CM6:

```js
export function createCleanDocumentTracker(initialDocument, equals, onDirtyChange) {
  let cleanDocument = initialDocument
  let dirty = false
  return Object.freeze({
    documentChanged(document) {
      const next = !equals(document, cleanDocument)
      if (next !== dirty) {
        dirty = next
        onDirtyChange(next)
      }
    },
    markClean(document) {
      cleanDocument = document
      if (dirty) {
        dirty = false
        onDirtyChange(false)
      }
    },
    isDirty: () => dirty
  })
}
```

CM6 must call it with `(left, right) => left.eq(right)`, which is the public `Text.eq` operation. Keep the clean snapshot as an immutable CM6 `Text`; do not store a second source string.

- [ ] **Step 3: Pass documents through the update listener**

Change `notifyPuzzleScriptChange` to call `onDocumentChange(update.state.doc)` only for `docChanged`. Rename the callback at the CM6 boundary from `onChange` to `onDocumentChange` so no caller assumes a string.

In `index.js`, construct the initial document as CM6 `Text`, create the tracker before the editor state, pass `tracker.documentChanged` into `puzzleScriptInteractions`, and pass the tracker into `createCM6EditorDriver`. No CM6 `Text`, state, effect, or transaction may cross `PuzzleScriptEditorAPI`.

- [ ] **Step 4: Make the editor own clean-state semantics**

Add `markClean()` and `isDirty()` to the frozen public adapter. `markClean()` supplies the current document to the tracker. Add the same semantic behavior to the CM5 comparison driver using strings and `===`; its existing `change` listener should call `driver.documentChanged()` rather than serializing into the shared application callback.

In `editor.js`:

- Remove `_editorCleanState` and every call that compares `editor.getValue()` during editing.
- Replace `checkEditorDirty` with `setEditorDirty(dirty)`, which changes `SAVE`/`SAVE*` only when its boolean input changes.
- Pass `onDirtyChange: setEditorDirty` when constructing the editor.
- Call `editor.markClean()` after initial construction and from `setEditorClean()`.
- Leave `getValue()` calls in compile, save, export, sharing, and image-name generation paths.

- [ ] **Step 5: Verify undo/redo and browser UI behavior**

Extend `cm6-interactions.spec.mjs` to edit, mark clean, edit again, undo to clean, and redo to dirty while asserting both `editor.isDirty()` and `#saveClickLink`. Spy on `getValue()` and assert normal typing does not call it.

Run:

1. `node --test src/tests/codemirror6/editor-api.test.mjs src/tests/codemirror6/interactions.test.mjs`
2. `npx playwright test src/tests/codemirror6/browser/cm6-interactions.spec.mjs --config src/tests/codemirror6/playwright.config.mjs --project=chromium --project=webkit`
3. `npm run build:codemirror`
4. `npm run check:codemirror`

Expected: all pass; typing changes dirty state without source serialization; exact undo restores `SAVE`.

- [ ] **Step 6: Benchmark and commit the isolated change**

Capture optimized intermediate Chrome results. Require `hundredApiEdits` to improve and large-file key-to-paint not to regress beyond run-to-run noise; if it does, inspect the tracker comparator before continuing.

Commit only the listed runtime/tests plus the regenerated bundle/map:

```bash
git add src/js/codemirror6 src/js/codemirror6.bundle.js src/js/codemirror6.bundle.js.map \
  src/js/editor-api.js src/js/editor-cm5.js src/js/editor.js \
  src/tests/codemirror6/editor-api.test.mjs \
  src/tests/codemirror6/interactions.test.mjs \
  src/tests/codemirror6/browser/cm6-interactions.spec.mjs
git commit -m "perf: track editor dirtiness structurally"
```

## Task 3: Remove ordinary-line rollback copies and retain the safe exact prefix

**Files:**

- Modify: `src/js/codemirror6/stream-language.js`
- Modify: `src/js/codemirror6/exact-prefix.js`
- Modify: `src/tests/codemirror6/stream-language.test.mjs`
- Modify: `src/tests/codemirror6/exact-prefix.test.mjs`
- Modify: `src/tests/codemirror6/browser/cm6-large-file.spec.mjs`

- [ ] **Step 1: Write failing copy-count and cutoff tests**

Wrap a minimal fake stream parser whose `copyState` increments a counter. Drive the wrapper directly with `StringStream` and assert:

```js
assert.equal(copiesForLine("x".repeat(9_999)), 0)
assert.equal(copiesForLine("x".repeat(10_000)), 0)
assert.equal(copiesForLine("x".repeat(10_001)), 1)
```

Keep the existing real-parser trace comparison and add edits/undo around a 10,001-character line followed by `OBJECTS`, proving the following section state matches a fresh full parse. The one special rollback copy may itself be copied when CM6 stores its own checkpoint; do not count CM6-owned `copyState` calls in the direct wrapper test.

- [ ] **Step 2: Write safe-prefix invalidation tests**

Starting from an exact document, test insertions, deletions, replacements, a deleted newline, an inserted newline, multiple change ranges, edits before the viewport, and edits after the viewport. For every change, the retained exact prefix must be:

```js
Math.min(previousExactPrefix, transaction.startState.doc.lineAt(earliestFromA).from)
```

An edit at a newline may conservatively retain only the preceding line's start. Add a test that a request already covered by `exactPrefix` returns true and dispatches zero effects.

Run: `node --test src/tests/codemirror6/stream-language.test.mjs src/tests/codemirror6/exact-prefix.test.mjs`

Expected: FAIL because every line currently takes a rollback snapshot, every edit resets exactness to zero, and covered requests still dispatch.

- [ ] **Step 3: Allocate rollback state only for pathological lines**

Change only the `stream.sol()` branch:

```js
if (stream.sol()) {
  state.lineStart = stream.string.length > CM5_MAX_HIGHLIGHT_LENGTH
    ? parser.copyState(state.inner)
    : null
  state.discardRestOfLine = false
}
```

Keep the existing `stream.pos > CM5_MAX_HIGHLIGHT_LENGTH` rollback and `discardRestOfLine` behavior. Assert `state.lineStart` is present before restoring it. Do not create a replacement checkpoint scheme and do not edit `stream-state.js`'s pinned checkpoint walk.

- [ ] **Step 4: Preserve only the line-safe exact boundary**

Add a helper that reads the earliest old-document change coordinate through `transaction.changes.iterChanges`. On `docChanged`, clamp the field to the start of that logical line. Then apply `setExactPrefix` effects and clamp their value to the new document length.

In `ensureExactPrefix`, return immediately when the current field already covers `target`; after parsing, dispatch only when the new target exceeds the current field.

- [ ] **Step 5: Prove distant exactness after intervening edits**

Extend `cm6-large-file.spec.mjs` with edits both before and after the visible distant viewport, undo, redo, and a pathological long line. For each state, wait for exact `LEVEL` styling and exercise autocomplete; reject approximate `METADATA`/`ERROR` styling.

Run:

1. `node --test src/tests/codemirror6/stream-language.test.mjs src/tests/codemirror6/exact-prefix.test.mjs src/tests/codemirror6/stream-state.test.mjs`
2. `npx playwright test src/tests/codemirror6/browser/cm6-large-file.spec.mjs --config src/tests/codemirror6/playwright.config.mjs --project=chromium --project=webkit`
3. `node src/tests/run_tests_node.js`

Expected: parser-equivalence tests and all 750 engine tests pass; the distant viewport is exact after every edit/undo path.

- [ ] **Step 6: Benchmark and commit**

Capture `loadDistantJumpExact`, `keyToNextPaint`, and heap. Require distant jumping to stay faster than CM5, ordinary-line heap/copy work to fall, and exactness to remain correct.

```bash
git add src/js/codemirror6/stream-language.js src/js/codemirror6/exact-prefix.js \
  src/tests/codemirror6/stream-language.test.mjs \
  src/tests/codemirror6/exact-prefix.test.mjs \
  src/tests/codemirror6/browser/cm6-large-file.spec.mjs
git commit -m "perf: retain safe StreamLanguage parser state"
```

## Task 4: Use native zero-delay typing activation for autocomplete

**Files:**

- Modify: `src/js/codemirror6/autocomplete.js`
- Modify: `src/tests/codemirror6/cm6-autocomplete.test.mjs`
- Modify: `src/tests/codemirror6/browser/product-editor.spec.mjs`
- Modify: `src/tests/codemirror6/browser/cm6-large-file.spec.mjs`

- [ ] **Step 1: Write activation-policy tests before changing configuration**

Export a small activation controller for unit testing. Cover:

- An eligible conventional key followed by `input.type` allows native completion and suppresses keyup fallback.
- Excluded key codes block the native query for that resulting document.
- No conventional key code, composition, and IME input are eligible.
- Backspace, Delete, keyboard paste/cut, and direct paste/cut get at most one explicit fallback start when no native typing transaction occurred.
- Rapid eligible typing supersedes an earlier blocked document and never returns results for an obsolete state.
- Every existing popup/navigation binding remains unchanged.

Use only `Transaction.isUserEvent("input.type")`, `input.paste`, `delete.backward`, `delete.forward`, and `delete.cut`; do not import autocomplete state fields or effects that CM6 does not export.

Run: `node --test src/tests/codemirror6/cm6-autocomplete.test.mjs`

Expected: FAIL against `activateOnTyping: false` and the unconditional eligible-key `keyup` call.

- [ ] **Step 2: Add a public-API activation controller**

The controller may retain DOM-event metadata and exact document identity, but never parser state. Its public shape is:

```js
{
  keydown(event),
  observeTransactions(transactions, document),
  keyup(event, view),
  allows(document),
  destroy()
}
```

Record `String(event.keyCode || event.which)` on keydown. When `input.type` occurs, mark that document allowed unless the recorded code is an own property of `excludedKeyCodes`, and mark the corresponding keyup as already handled. A missing key code is allowed. The completion source must return `null` when `allows(context.state.doc)` is false.

For non-typing paste/cut/delete user events, schedule one explicit `startCompletion(view)` fallback and cancel/coalesce it if a later native typing transaction or destroy occurs. Calling public `startCompletion` intentionally retains CM6's internal 50 ms delay only on this fallback path.

- [ ] **Step 3: Enable immediate native activation**

Configure:

```js
autocompletion({
  activateOnTyping: true,
  activateOnTypingDelay: 0,
  defaultKeymap: false,
  interactionDelay: 0,
  maxRenderedOptions: Number.MAX_SAFE_INTEGER,
  icons: false,
  override: [source],
  addToOptions: [{render: renderPuzzleScriptOption, position: 40}]
})
```

Attach keydown/keyup DOM handlers and an update listener from the same controller instance. Keep the existing completion calculation, exact-state bridge, result order, case handling, ranges, tags, option DOM, and keymap unchanged.

- [ ] **Step 4: Exercise real input modes**

Extend browser tests to cover normal typing, rapid `title`, excluded semicolon/slash behavior, Backspace, Delete, keyboard paste, synthetic composition events, German-layout-sensitive `>`/quote behavior, popup navigation, accept, escape, and distant large-file completion.

Run:

1. `node --test src/tests/codemirror6/autocomplete-golden.test.mjs src/tests/codemirror6/cm6-autocomplete.test.mjs`
2. `npx playwright test src/tests/codemirror6/browser/product-editor.spec.mjs src/tests/codemirror6/browser/cm6-large-file.spec.mjs --config src/tests/codemirror6/playwright.config.mjs --project=chromium --project=firefox --project=webkit`
3. `npm run build:codemirror`
4. `npm run check:codemirror`

Expected: all completion corpus/results and browser behaviors pass.

- [ ] **Step 5: Enforce the autocomplete performance gate and commit**

Run the installed Chrome and Safari autocomplete scenarios. Require ordinary typing completion median and p95 below 16.7 ms and confirm the normal path contains no 50 ms explicit-start delay. If Safari timing is slower because the exact parser prefix is not ready, fix prefix readiness rather than bypassing exact state.

```bash
git add src/js/codemirror6/autocomplete.js src/js/codemirror6.bundle.js \
  src/js/codemirror6.bundle.js.map \
  src/tests/codemirror6/cm6-autocomplete.test.mjs \
  src/tests/codemirror6/browser/product-editor.spec.mjs \
  src/tests/codemirror6/browser/cm6-large-file.spec.mjs
git commit -m "perf: activate autocomplete on native typing"
```

## Task 5: Reuse and cache token presentation

**Files:**

- Modify: `src/js/codemirror6/token-presentation.js`
- Modify: `src/tests/codemirror6/token-presentation.test.mjs`
- Modify: `src/tests/codemirror6/browser/cm6-no-style-flash.spec.mjs`
- Modify: `src/tests/codemirror6/browser/cm6-search.spec.mjs`

- [ ] **Step 1: Write failing identity and cache tests**

Add tests that start with an exact decorated viewport and assert strict `DecorationSet` identity for selection-only transactions, focus/blur, completion-selection effects, search-panel effects, and viewport shrinkage that introduces no new text. Assert rebuild for a genuinely new viewport, reconfiguration, initial exactness, and an exact-prefix transition that newly covers the visible range.

For document edits, assert the immediate result is `previous.map(update.changes)`, never `Decoration.none`. Search Replace and Replace All must use this same document-change path.

Add a cache test proving two ranges with the same encoded style reuse the same decoded presentation/`Decoration.mark` value while duplicate ranges still appear only once.

Run: `node --test src/tests/codemirror6/token-presentation.test.mjs`

Expected: FAIL because the current code rebuilds whenever the visible end is exact and creates a new decoration for every syntax node.

- [ ] **Step 2: Add a per-editor style cache**

Create one cache inside each `tokenPresentation()` plugin instance. Key it by encoded syntax-node name and store:

```js
{
  style,
  classes,
  dynamicHex,
  decoration
}
```

Build `decoration` once with the existing `presentationClasses`, `dynamicHexForStyle`, and `styleFromHexCode` behavior. Reuse that `Decoration` value's `.range(from, to)` for every matching token. Preserve the current class spelling, inline contrast style, dynamic colour behavior, and duplicate-range guard.

- [ ] **Step 3: Track which visible text the set covers**

Store copied `{from, to}` visible ranges beside the decoration set. On document changes, map both decorations and covered range endpoints through `update.changes`. Rebuild only when syntax is exact through the current visible end and one of these is true:

- No exact set has been built yet.
- The new visible ranges contain text not covered by the mapped cached ranges.
- `exactPrefix` advanced from below the visible end to cover it.
- `update.reconfigured` is true.

Reuse unchanged sets when a search panel merely shrinks the viewport, the cursor/selection moves within covered text, focus changes, or completion/search UI state changes. Use `viewportMoved` plus range containment, not raw `viewportChanged`, so geometry-only changes do not force work.

- [ ] **Step 4: Prove there is no unstyled edit frame**

Keep the existing delayed-idle test and extend it to type several characters, run Search Replace and Replace All, undo, and redo. Install a `MutationObserver` over styled token spans and assert that an edit never deliberately removes all token classes while exact reparsing is pending.

Run:

1. `node --test src/tests/codemirror6/token-presentation.test.mjs`
2. `npx playwright test src/tests/codemirror6/browser/cm6-no-style-flash.spec.mjs src/tests/codemirror6/browser/cm6-search.spec.mjs --config src/tests/codemirror6/playwright.config.mjs --project=chromium --project=webkit`
3. `npm run build:codemirror`
4. `npm run check:codemirror`

Expected: strict identity tests pass and no-style-flash stays green.

- [ ] **Step 5: Benchmark selection/search activity and commit**

Run `cursorFocusSearchSettled`, `hundredApiEdits`, key-to-paint, and heap. Require zero decoration rebuilds for the identity scenarios, improved API-edit time, no typing regression, and lower large-document heap than pre-CM6.

```bash
git add src/js/codemirror6/token-presentation.js src/js/codemirror6.bundle.js \
  src/js/codemirror6.bundle.js.map \
  src/tests/codemirror6/token-presentation.test.mjs \
  src/tests/codemirror6/browser/cm6-no-style-flash.spec.mjs \
  src/tests/codemirror6/browser/cm6-search.spec.mjs
git commit -m "perf: reuse CodeMirror token decorations"
```

## Task 6: Align document replacement and navigation with CM6 semantics

**Files:**

- Modify: `src/js/codemirror6/editor-adapter.js`
- Modify: `src/js/editor-api.js`
- Modify: `src/js/editor.js`
- Modify: `src/js/toolbar.js`
- Modify: `src/js/console.js`
- Modify: `src/tests/codemirror6/editor-api.test.mjs`
- Modify: `src/tests/codemirror6/browser/cm5-adapter.spec.mjs`
- Modify: `src/tests/codemirror6/browser/cm6-candidate.spec.mjs`
- Modify: `src/tests/codemirror6/browser/cm6-interactions.spec.mjs`
- Modify: `src/tests/codemirror6/browser/cm6-large-file.spec.mjs`
- Modify: `src/tests/codemirror6/browser/cm6-no-style-flash.spec.mjs`
- Modify: `src/tests/codemirror6/browser/cm6-search.spec.mjs`
- Modify: `src/tests/codemirror6/browser/cm6-visual.spec.mjs`
- Modify: `src/tests/codemirror6/browser/geometry.spec.mjs`
- Modify: `src/tests/codemirror6/browser/product-editor.spec.mjs`

- [ ] **Step 1: Write the semantic adapter tests first**

Add tests for:

- `replaceDocument(text)`: one normal undoable dispatch, cursor at 0, scroll request to 0, one document-change/dirty transition, undo restores the prior document.
- `revealLine(line, {cursor, y})`: clips line and cursor column, combines optional selection and `EditorView.scrollIntoView(position, {y})` in one dispatch, and defaults to `{cursor: false, y: "nearest"}`.
- `setValue(text)`: temporary compatibility alias that delegates to `replaceDocument`.
- No CM5/CM6 state, document, view, effect, or transaction is exposed.

Represent `cursor` as either `false` or a zero-based column number; thus `{cursor: 0, y: "center"}` means place the cursor at column zero and center the line.

Run: `node --test src/tests/codemirror6/editor-api.test.mjs`

Expected: FAIL because the adapter still exposes mechanical `setCursor`, `scrollToLine`, `getLastLine`, and `clearHistory` operations.

- [ ] **Step 2: Add semantic methods while keeping migration aliases temporarily**

Implement `replaceDocument` with the current normal CM6 transaction. Implement `revealLine` with one dispatch:

```js
const spec = {
  effects: EditorView.scrollIntoView(position, {y})
}
if (cursor !== false) spec.selection = EditorSelection.cursor(position)
view.dispatch(spec)
```

Keep `setValue` as a documented compatibility alias. Keep old mechanical methods only until every repository caller and the reset gate below have migrated; do not expose new CM6 types.

- [ ] **Step 3: Migrate application navigation and ordinary replacement**

Change `jumpToLine(i)` in `console.js` to:

```js
editor.revealLine(i - 1, {cursor: 0, y: "center"})
```

Remove the last-line calculation and the low/high/mid scroll sequence. Migrate application source replacement in `editor.js` and `toolbar.js` to `replaceDocument`. Migrate browser helpers from `setCursor(line, column)` to `revealLine(line, {cursor: column})`. Image paste and search replacement continue to use normal selection/document transactions.

Update CM5 and CM6 adapter tests to assert one semantic navigation call/dispatch and the same final cursor/scroll result.

- [ ] **Step 4: Enforce the normal replacement gate**

Run `replaceDocumentSync` and `replaceDocumentSettled` in installed Chrome and Safari. Synchronous replacement must be at least 2× faster than the pre-optimization CM6 baseline, settled time must also improve, and cursor, undo, dirty callback, styled viewport, and no-flash behavior must remain identical. If the synchronous number improves but settled time does not, treat the gate as failed and profile deferred parsing/presentation work.

**Final outcome — 2026-08-15:** This gate remains **FAILED**. Final installed
Chrome and Safari synchronous replacement are both approximately 22 ms and do
not provide the required 2× improvement over pre-optimization CM6. Settled time
improved modestly, but it does not substitute for the failed synchronous gate.
The exact medians and p95 values remain in the
[final evidence report](../../codemirror6-performance-report.md).

- [ ] **Step 5: Test the optional one-state reset path**

Write failing tests for `resetDocument(text)` that require: one new `EditorState`, unchanged extensions, cursor 0, scroll top, empty undo/redo history, one document/dirty notification, and no intermediate unstyled editor. Implement it as one `view.setState(EditorState.create(...))`, one scroll request if `setState` does not itself scroll to zero, and one explicit tracker notification because `setState` does not emit an update-listener transaction.

Benchmark it against the current `setValue(newSource)` plus `clearHistory()` sequence after Tasks 2–5. Retain and migrate the gist-load and dropped-source call sites only when all of these hold:

- Reset median is at least 20% faster than the two-operation sequence in installed Chrome and Safari.
- Settled time is no worse.
- The no-style-flash test sees no empty styled frame.
- Callback, cursor, scroll, clean/dirty, and empty-history tests pass.

If any reset condition fails, remove the uncommitted reset-only implementation/tests with `apply_patch`, retain the existing history-clearing compatibility path, and record the failed measurements in the final report. Do not weaken a gate to keep the method.

**Final reset decision — 2026-08-15:** The one-state reset experiment was much
faster in isolated Chrome measurements, but parser token decorations disappeared
in both Chromium and WebKit. It was therefore removed and the established
replacement-plus-history-clearing path retained. Private `LanguageState`,
`setState`, or checkpoint manipulation was also rejected: it would violate the
public-API and unchanged-stream-parser constraints. No measured threshold was
weakened to keep either approach.

- [ ] **Step 6: Remove superseded mechanical methods where the measured path permits**

After caller migration, remove `getLastLine`, `setCursor`, and `scrollToLine` from both public drivers. If reset passed, remove public `clearHistory` and use `resetDocument` at the two empty-history callers. Retain `setValue` only as the agreed temporary external compatibility alias for `replaceDocument`.

Run:

1. `node --test src/tests/codemirror6/editor-api.test.mjs`
2. `npx playwright test src/tests/codemirror6/browser/cm5-adapter.spec.mjs src/tests/codemirror6/browser/cm6-candidate.spec.mjs src/tests/codemirror6/browser/product-editor.spec.mjs --config src/tests/codemirror6/playwright.config.mjs --project=chromium --project=firefox --project=webkit`
3. `npm run build:codemirror`
4. `npm run check:codemirror`

Expected: semantic contract, history, navigation, layout, and product smoke tests pass.

- [ ] **Step 7: Commit the measured adapter alignment**

Stage only files belonging to this task and the regenerated bundle artifacts:

```bash
git add src/js/codemirror6/editor-adapter.js src/js/editor-api.js src/js/editor.js \
  src/js/toolbar.js src/js/console.js src/js/codemirror6.bundle.js \
  src/js/codemirror6.bundle.js.map src/tests/codemirror6/editor-api.test.mjs \
  src/tests/codemirror6/browser
git commit -m "perf: align editor operations with CodeMirror 6"
```

Before committing, inspect `git diff --cached -- src/tests/codemirror6/candidate-page.test.mjs`; expected output is empty.

## Task 7: Minify the checked bundle and add Brotli delivery

**Files:**

- Modify: `build-codemirror6.js`
- Modify: `src/tests/codemirror6/bundle.test.mjs`
- Modify: `src/js/codemirror6.bundle.js`
- Modify: `src/js/codemirror6.bundle.js.map`
- Modify: `compile.js`
- Modify: `src/.htaccess`
- Verify generated: `bin/.htaccess` through the normal release build/copy path
- Create: `verify-release-compression.js`
- Create: `src/tests/codemirror6/release-compression.test.mjs`
- Create: `src/tests/codemirror6/release-compression-http.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing deterministic-size and release-option tests**

Extend `bundle.test.mjs` to Brotli-compress the checked bundle with Node `zlib` text mode and quality 11, then assert:

```js
assert.ok(brotli.length < 100 * 1024, `${brotli.length} bytes is not below 100 KiB`)
```

In `release-compression.test.mjs`, statically verify that release compression selects Brotli, disables gzip, uses text mode/quality 11, retains originals, and that both `.htaccess` files negotiate `.br`, set `Content-Encoding: br`, and merge `Vary: Accept-Encoding`.

Run: `node --test src/tests/codemirror6/bundle.test.mjs src/tests/codemirror6/release-compression.test.mjs`

Expected: FAIL because the checked IIFE is not minified, is roughly 146 KiB Brotli, and the release still produces gzip.

- [ ] **Step 2: Make esbuild emit the final checked IIFE**

Add `minify: true` to the existing esbuild options. Keep `bundle: true`, `format: "iife"`, external source maps with sources content, exact package pins, byte-for-byte `--check`, and browser targets. Do not add runtime modules, a CDN, or a server-side JS build.

Run:

1. `npm run build:codemirror`
2. `npm run check:codemirror`
3. `node --test src/tests/codemirror6/bundle.test.mjs`

Expected: deterministic check passes and the Brotli size is below 100 KiB.

- [ ] **Step 3: Generate Brotli-only release sidecars**

Replace the default gzipper construction in `compile.js` with:

```js
const releaseCompressionOptions = Object.freeze({
  brotli: true,
  gzip: false,
  brotliParamMode: "text",
  brotliQuality: 11,
  removeLarger: false
})

const comp = new Compress(file, undefined, releaseCompressionOptions)
await comp.run()
```

Continue processing release `.js`, `.html`, `.css`, and `.txt`. Original raw files must remain. Do not generate `.gz` files.

- [ ] **Step 4: Configure conservative Apache negotiation**

Use the same rules in `src/.htaccess` and the copied `bin/.htaccess`:

```apache
Options -MultiViews
RewriteEngine On
RewriteCond %{HTTP:Accept-Encoding} br [NC]
RewriteCond %{REQUEST_FILENAME}.br -f
RewriteRule ^(.+\.(?:js|css|html|txt))$ $1.br [L]

AddEncoding br .br
Header merge Vary Accept-Encoding
<FilesMatch "\.br$">
  Header set Content-Encoding br
</FilesMatch>
```

The server must enable `mod_rewrite`, `mod_mime`, and `mod_headers`; fail configuration rather than serving encoded bytes without their header. The original extension remains in `file.js.br`, allowing Apache MIME mapping to preserve JavaScript/CSS/HTML/text content types. Requests without `br`, or resources without a sidecar, fall through to the raw original.

- [ ] **Step 5: Verify every generated byte and HTTP behavior**

Create `verify-release-compression.js`. Recursively find `.br` under `bin`, require a corresponding original, decompress with `zlib.brotliDecompressSync`, and compare bytes. Fail if any `.gz` exists. Fail if the checked CM6 bundle's Brotli sidecar is 100 KiB or larger.

Create `release-compression-http.mjs` accepting `PS_RELEASE_URL`. For representative JS, CSS, HTML, and TXT resources, request once with `Accept-Encoding: br` and once with `Accept-Encoding: identity`. Assert encoded/raw bodies decode to identical bytes, Brotli has `Content-Encoding: br`, both responses include `Accept-Encoding` in `Vary`, MIME types match the original extension, and a deliberately missing sidecar falls back raw.

Add:

```json
{
  "verify:release-compression": "node verify-release-compression.js"
}
```

Run the release build while preserving the user-owned build number: record `.build/buildnumber.txt`, run `node compile.js`, restore only that number with `apply_patch`, then run `npm run verify:release-compression`. Run the HTTP smoke test against a local/staging Apache document root that honors these `.htaccess` files; the Python test server is not valid for this gate.

- [ ] **Step 6: Run release and product regression tests**

Run:

1. `node --test src/tests/codemirror6/bundle.test.mjs src/tests/codemirror6/release-compression.test.mjs src/tests/codemirror6/release-html.test.mjs`
2. `npm run check:codemirror`
3. `npm run verify:release-compression`
4. `PS_RELEASE_URL=http://127.0.0.1:4174 node src/tests/codemirror6/release-compression-http.mjs` with the test Apache listening on port 4174
5. `npx playwright test src/tests/codemirror6/browser/product-editor.spec.mjs --config src/tests/codemirror6/playwright.config.mjs --project=chromium --project=webkit`

Expected: deterministic bundle, decompression, headers, raw fallback, MIME types, and product editor all pass.

- [ ] **Step 7: Commit delivery changes**

Review generated `bin` status and stage only tracked release artifacts required by the repository. Then commit:

```bash
git add build-codemirror6.js compile.js package.json src/.htaccess \
  verify-release-compression.js src/js/codemirror6.bundle.js \
  src/js/codemirror6.bundle.js.map src/tests/codemirror6/bundle.test.mjs \
  src/tests/codemirror6/release-compression.test.mjs \
  src/tests/codemirror6/release-compression-http.mjs
git commit -m "build: serve the CodeMirror bundle with Brotli"
```

## Task 8: Remove only proven-obsolete CM5 CSS and run final gates

**Files:**

- Modify conditionally: `src/editor.html`
- Modify conditionally: `compile.js`
- Modify: `src/tests/codemirror6/build-performance-pages.mjs`
- Modify: `src/tests/codemirror6/browser/cm6-visual.spec.mjs`
- Modify: `src/tests/codemirror6/browser/geometry.spec.mjs`
- Modify: `docs/codemirror6-migration-ledger.md`
- Create: `docs/codemirror6-performance-report.md`
- Create: `src/tests/codemirror6/performance/baselines/optimized-cm6-chrome.json`
- Create: `src/tests/codemirror6/performance/baselines/optimized-cm6-safari.json`

- [ ] **Step 1: Prove stylesheet independence before removing links**

Add a visual-test mode that disables the production links for `css/codemirror.css`, `css/midnight.css`, `css/dialog.css`, and `css/show-hint.css` one at a time and then together on CM6. Compare light/dark full page, syntax, active gutter, wrapped lines, autocomplete, search/replace, dynamic colours, and geometry against the immutable CM5 baselines.

Require zero pixel difference in the existing Chromium surfaces, exact numeric geometry in Chromium/Firefox/WebKit, and the approved selection-only tolerance. Inspect actual Chrome and Safari for font, line height, wrapping, gutter, search, completion, and scrollbar geometry.

- [ ] **Step 2: Remove only rules proven irrelevant to production CM6**

For every stylesheet whose absence passes all gates, remove its link from `src/editor.html` and its entry from the release `combined.css` list. Keep the files in the repository because the frozen CM5 comparison page needs them; make `build-performance-pages.mjs` explicitly inject those CM5 stylesheet links.

If disabling a stylesheet changes an approved surface, retain it for this performance branch and record the contributing selectors in the report. Do not copy broad CM5 rules into CM6 CSS merely to claim asset removal.

- [ ] **Step 3: Capture final installed-browser measurements**

Run the full harness in installed Chrome and installed Safari and write the optimized baseline JSON files. Also run Chrome at four-times CPU throttling for key-to-paint and autocomplete headroom. Compare CM5, pre-CM6, and optimized CM6 for all scenarios, heap where supported, raw bundle size, comparison-only gzip size, and production Brotli size.

Reject or remove any isolated optimization that misses its performance gate, changes correctness, or shifts work into `replaceDocumentSettled`/the next interaction.

**Final measurement outcome — 2026-08-15:** Installed Safari key-to-paint p95
is 19 ms and remains **FAILED** against 16.7 ms. Whole-document synchronous
replacement remains approximately 22 ms in both installed browsers and remains
**FAILED** against the 2× target. The Chrome 4× diagnostic measured
17.699999809265137 ms autocomplete p95, so it does not demonstrate one-frame
headroom. These misses remain explicit in the committed baselines and
[final evidence report](../../codemirror6-performance-report.md); none is
re-labelled as a pass or hidden by a relaxed threshold.

- [ ] **Step 4: Write the evidence report**

Create `docs/codemirror6-performance-report.md` containing:

- Browser/OS versions and exact dependency pins.
- Source fixture sizes, warmups, repetitions, median/p95 method, and CPU-throttling setting.
- Side-by-side CM5, pre-CM6, optimized-CM6 values.
- Pass/fail for every performance contract item.
- Reset-path keep/remove decision with both sync and settled evidence.
- CSS keep/remove decisions.
- Brotli/raw fallback and HTTP header results.
- Confirmation that `codeMirrorFn` is still the only parser and CM6 checkpoint internals were not patched.

Use measured values from committed JSON; do not hand-copy rounded values when the JSON contains greater precision.

- [ ] **Step 5: Run the complete correctness and visual suite**

Run separately:

1. `npm run build:codemirror`
2. `npm run check:codemirror`
3. `npm run test:codemirror`
4. `node src/tests/run_tests_node.js`
5. `npm run test:codemirror-browser`
6. `node compile.js` with the build-number preservation procedure
7. `npm run verify:release-compression`
8. The Apache HTTP smoke command from Task 7
9. Installed Chrome performance/visual run
10. Installed Safari performance/visual run through SafariDriver

Expected originally: all Node/editor/engine/browser/release tests pass; Edge is not run; Chrome and Safari meet the performance contract; Chromium screenshots and cross-engine geometry remain within their approved baselines; release compression round-trips byte-for-byte.

**Final deviation accepted on 2026-08-15:** Correctness, visual, geometry,
parser, build, compression, and HTTP-delivery gates passed, but Safari's 19 ms
key p95 and the approximately 22 ms whole-document synchronous result remain
failed runtime gates; the Chrome 4× autocomplete headroom probe also remains a
17.699999809265137 ms miss. Branch completion accepts those documented residual
limits because pursuing them through private CM6 state/checkpoint hooks or the
decoration-breaking reset would violate the user's parser and frozen-fidelity
requirements. This acceptance does not convert the failures into passes.

- [ ] **Step 6: Audit scope and commit final evidence**

Run:

```bash
git status --short
git diff --check
git diff --cached -- src/tests/codemirror6/candidate-page.test.mjs
```

Expected: no whitespace errors and no staged diff for the user-owned candidate-page test.

Commit the verified CSS decisions, comparison-page adjustment, final baselines, ledger, report, and any regenerated bundle bytes caused by those scoped changes:

```bash
git add src/editor.html compile.js src/tests/codemirror6/build-performance-pages.mjs \
  src/tests/codemirror6/browser/cm6-visual.spec.mjs \
  src/tests/codemirror6/browser/geometry.spec.mjs \
  src/tests/codemirror6/performance/baselines/optimized-cm6-chrome.json \
  src/tests/codemirror6/performance/baselines/optimized-cm6-safari.json \
  docs/codemirror6-migration-ledger.md docs/codemirror6-performance-report.md
git commit -m "docs: verify CodeMirror 6 performance gains"
```

## Final review checklist

- [ ] `rg -n -i "Lezer grammar|checkpoint interval|worker parser|second parser" src/js/codemirror6 docs/codemirror6-performance-report.md` shows no prohibited implementation; explanatory report text is acceptable.
- [ ] `rg -n "toString\(\)" src/js/codemirror6/interactions.js src/js/editor.js` shows no edit-listener document serialization.
- [ ] `rg -n "activateOnTyping|activateOnTypingDelay" src/js/codemirror6/autocomplete.js` shows `true` and `0`.
- [ ] Selection, focus, search UI, and completion-selection unit tests assert `DecorationSet` identity.
- [ ] Lines at 9,999, 10,000, and 10,001 characters preserve the specified rollback behavior.
- [ ] Exact-prefix tests cover multiple edits and newline insertion/deletion.
- [ ] `getValue()` is used only where a source string is genuinely consumed.
- [ ] `setValue` is only the agreed compatibility alias; repository application callers use semantic operations.
- [ ] No `.gz` is generated; every `.br` round-trips to its original; raw files remain.
- [ ] CM6 IIFE is deterministic and below 100 KiB Brotli.
- [ ] Chrome and Safari meet the runtime gates; Edge was not run. **Final 2026-08-15 status: not fully satisfied.** Safari key-to-paint p95 is 19 ms and whole-document synchronous replacement remains approximately 22 ms; both thresholds remain failed and unchanged. The branch accepts them only as documented residual limits under the public-API, unchanged-stream-parser, and frozen-fidelity constraints; see the [final evidence report](../../codemirror6-performance-report.md).
- [ ] Layout/font/wrapping/gutters/panels match the frozen baseline.
- [ ] The unrelated `candidate-page.test.mjs` edit remains untouched and unstaged.
