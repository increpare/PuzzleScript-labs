import {readFile} from "node:fs/promises"

import {expect, test} from "@playwright/test"

import {distantPosition, largeSource} from "../fixtures/large-source.js"

const harnessSource = await readFile(new URL("../performance/harness.js", import.meta.url), "utf8")

function cursorAtEnd(source) {
  const lines = source.split("\n")
  return {line: lines.length - 1, column: lines.at(-1).length}
}

function inputs() {
  const representativeSource = "title Representative\nOBJECTS\nPlayer\nred\n.....\n.....\n.....\n.....\n.....\n"
  const completionSource = "RULES\n[r"
  return {
    representativeSource,
    largeSource,
    distantLine: largeSource.slice(0, distantPosition).split("\n").length - 1,
    distantColumn: 39,
    completion: {source: completionSource, cursor: cursorAtEnd(completionSource), key: "i", expectedLabels: ["right", "rigid"]}
  }
}

async function mountFakeEditor(page, mode) {
  await page.setContent(`
    <textarea id="code"></textarea>
    <div class="cm-editor">
      <div class="cm-scroller" style="height: 200px; overflow: auto">
        <div id="editor-content" style="height: 1000px"></div>
      </div>
    </div>
  `)
  await page.evaluate(({mode, expectedLargeLength}) => {
    const textarea = document.querySelector("#code")
    const content = document.querySelector("#editor-content")
    const scroller = document.querySelector(".cm-scroller")
    const state = {source: "", cursor: {line: 0, column: 0}}
    const editorMutations = {setValue: 0, clearHistory: 0, setCursor: 0, focus: 0, blur: 0, replaceSelection: 0}
    window.__performanceFixture = {mode, expectedLargeLength, state, editorMutations}

    const mutateLater = () => {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => {
        content.dataset.delayed = String(Number(content.dataset.delayed || 0) + 1)
        window.__performanceFixture.delayedMutationAt = performance.now()
      }, 30)))
    }
    const mutateForever = () => {
      window.__performanceFixture.interval = setInterval(() => {
        content.dataset.perpetual = String(Number(content.dataset.perpetual || 0) + 1)
        window.__performanceFixture.lastMutationAt = performance.now()
      }, 25)
    }

    textarea.editorreference = {
      getValue() { return state.source },
      setValue(value) {
        editorMutations.setValue += 1
        state.source = value
        content.textContent = value.slice(0, 16)
        if (mode === "async-scroll") {
          requestAnimationFrame(() => requestAnimationFrame(() => { scroller.scrollTop = 50 }))
        }
        if (value.length === expectedLargeLength) {
          window.__performanceFixture.largeSetAt = performance.now()
          if (mode === "delayed") mutateLater()
          if (mode === "perpetual") mutateForever()
        }
      },
      clearHistory() { editorMutations.clearHistory += 1 },
      setCursor(line, column) { editorMutations.setCursor += 1; state.cursor = {line, column} },
      focus() { editorMutations.focus += 1; textarea.focus() },
      blur() { editorMutations.blur += 1; textarea.blur() },
      replaceSelection(value) {
        editorMutations.replaceSelection += 1
        window.__performanceFixture.typingSnapshot = {
          beforeLength: state.source.length,
          cursor: {...state.cursor},
          scrollLeft: scroller.scrollLeft,
          scrollTop: scroller.scrollTop
        }
        state.source = value + state.source
        content.textContent = state.source.slice(0, 16)
      },
      getInputElement() { return textarea }
    }
  }, {mode, expectedLargeLength: largeSource.length})
  await page.addScriptTag({content: harnessSource})
}

test("large-file typing restores the actual large source at a stable visible cursor and viewport", async ({page}) => {
  await mountFakeEditor(page, "plain")
  const result = await page.evaluate(async benchmarkInputs => {
    await window.PuzzleScriptPerformance.runScenario("keyToNextPaint", benchmarkInputs)
    return window.__performanceFixture.typingSnapshot
  }, inputs())

  expect(result).toEqual({beforeLength: 129_721, cursor: {line: 0, column: 0}, scrollLeft: 0, scrollTop: 0})
})

test("settled timing includes a mutation scheduled after two frames but excludes quiet confirmation", async ({page}) => {
  await mountFakeEditor(page, "delayed")
  const result = await page.evaluate(async benchmarkInputs => {
    const wallStart = performance.now()
    const duration = await window.PuzzleScriptPerformance.runScenario("replaceDocumentSettled", benchmarkInputs)
    const wallDuration = performance.now() - wallStart
    const fixture = window.__performanceFixture
    return {
      duration,
      wallDuration,
      delayedMutationDelta: fixture.delayedMutationAt - fixture.largeSetAt
    }
  }, inputs())

  expect(result.duration).toBeGreaterThanOrEqual(result.delayedMutationDelta)
  expect(result.wallDuration - result.duration).toBeGreaterThanOrEqual(80)
})

test("settled timing rejects perpetual relevant mutation with bounded diagnostics", async ({page}) => {
  test.setTimeout(15_000)
  await mountFakeEditor(page, "perpetual")
  const result = await page.evaluate(async benchmarkInputs => {
    const startedAt = performance.now()
    try {
      await window.PuzzleScriptPerformance.runScenario("replaceDocumentSettled", benchmarkInputs)
      return {error: null, elapsed: performance.now() - startedAt}
    } catch (error) {
      return {error: String(error), elapsed: performance.now() - startedAt}
    } finally {
      clearInterval(window.__performanceFixture.interval)
    }
  }, inputs())

  expect(result.elapsed).toBeGreaterThanOrEqual(9_900)
  expect(result.elapsed).toBeLessThan(12_000)
  expect(result.error).toMatch(/replaceDocumentSettled.*readiness=.*lastMutation=.*elapsed=/)
})

test("restore allows the editor to reveal a requested cursor asynchronously", async ({page}) => {
  test.setTimeout(15_000)
  await mountFakeEditor(page, "async-scroll")
  const result = await page.evaluate(async benchmarkInputs => {
    const duration = await window.PuzzleScriptPerformance.runScenario("hundredApiEdits", benchmarkInputs)
    return {duration, scrollTop: document.querySelector(".cm-scroller").scrollTop}
  }, inputs())

  expect(result.duration).toBeGreaterThanOrEqual(0)
  expect(result.scrollTop).toBe(50)
})

test("current-mount settling observes bounded readiness without mutating editor state", async ({page}) => {
  await mountFakeEditor(page, "plain")
  const result = await page.evaluate(async benchmarkInputs => {
    const fixture = window.__performanceFixture
    fixture.state.source = "already mounted"
    document.querySelector("#editor-content").textContent = fixture.state.source
    const wallStart = performance.now()
    const duration = await window.PuzzleScriptPerformance.runScenario("currentMountSettled", benchmarkInputs)
    return {
      duration,
      wallDuration: performance.now() - wallStart,
      source: fixture.state.source,
      editorMutations: fixture.editorMutations
    }
  }, inputs())

  expect(result.duration).toBeGreaterThanOrEqual(0)
  expect(result.wallDuration).toBeGreaterThanOrEqual(100)
  expect(result.source).toBe("already mounted")
  expect(result.editorMutations).toEqual({
    setValue: 0,
    clearHistory: 0,
    setCursor: 0,
    focus: 0,
    blur: 0,
    replaceSelection: 0
  })
})
