(function() {
  "use strict"

  const WARMUPS = 5
  const SAMPLES = 20
  // Quiet confirmation catches timer/idle/highlighter DOM work without adding its
  // fixed tail to reported durations. The timeout is a hard anti-hang boundary.
  const SETTLE_QUIET_MS = 100
  const SETTLE_CONFIRMATION_FRAMES = 2
  const SETTLE_TIMEOUT_MS = 10_000
  const scenarioNames = Object.freeze([
    "keyToNextPaint",
    "autocompleteVisible",
    "hundredApiEdits",
    "replaceDocumentSync",
    "replaceDocumentSettled",
    "loadDistantJumpExact",
    "cursorFocusSearchSettled"
  ])

  const replaceDocument = (editor, text) =>
    (editor.replaceDocument || editor.setValue).call(editor, text)
  const revealLine = (editor, line, column = 0) => editor.revealLine
    ? editor.revealLine(line, {cursor: column})
    : editor.setCursor(line, column)

  function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve))
  }

  function editorRoot() {
    const root = document.querySelector(".cm-editor") || document.querySelector(".CodeMirror")
    if (!root) throw new Error("PuzzleScript editor root is unavailable")
    return root
  }

  function sourceIsExact(editor, source) {
    return typeof editor.getValue === "function" && editor.getValue() === source
  }

  async function measureSettled(description, operation, readiness, timeout = SETTLE_TIMEOUT_MS) {
    const root = editorRoot()
    const startedAt = performance.now()
    let lastMutationAt = startedAt
    let lastMutation = "none observed"
    let semanticReadyAt = null
    let latestReadiness = false
    let finished = false
    let timeoutId
    const observer = new MutationObserver(records => {
      lastMutationAt = performance.now()
      const record = records[records.length - 1]
      lastMutation = record
        ? `${record.type}:${record.target && record.target.nodeName || "unknown"}`
        : "observer callback"
    })
    observer.observe(root, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true
    })

    const timeoutError = () => {
      const elapsed = performance.now() - startedAt
      return new Error(
        `Timed out waiting for ${description} to settle: readiness=${latestReadiness}; ` +
        `lastMutation=${lastMutation}@${Math.max(0, lastMutationAt - startedAt).toFixed(1)}ms; ` +
        `elapsed=${elapsed.toFixed(1)}ms`
      )
    }

    try {
      const hardTimeout = new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => {
          finished = true
          reject(timeoutError())
        }, timeout)
      })
      operation()
      const settle = (async () => {
        let quietFrames = 0
        while (!finished) {
          const now = performance.now()
          latestReadiness = Boolean(readiness())
          semanticReadyAt = latestReadiness ? (semanticReadyAt === null ? now : semanticReadyAt) : null
          quietFrames = latestReadiness && now - lastMutationAt >= SETTLE_QUIET_MS
            ? quietFrames + 1
            : 0
          if (quietFrames >= SETTLE_CONFIRMATION_FRAMES) {
            return Math.max(semanticReadyAt, lastMutationAt) - startedAt
          }
          if (now - startedAt >= timeout) throw timeoutError()
          await nextFrame()
        }
        throw timeoutError()
      })()
      return await Promise.race([settle, hardTimeout])
    } finally {
      finished = true
      clearTimeout(timeoutId)
      observer.disconnect()
    }
  }

  async function restore(editor, source, cursor, {fixedViewport = false} = {}) {
    const scroller = document.querySelector(".CodeMirror-scroll,.cm-scroller")
    await measureSettled(
      `restoring ${source.length}-character source`,
      () => {
        closeTransientUi(editor)
        document.body.style.colorScheme = "dark"
        document.body.classList.remove("light-theme")
        document.body.classList.add("dark-theme")
        replaceDocument(editor, source)
        editor.clearHistory()
        revealLine(editor, cursor.line, cursor.column)
        editor.focus()
        if (fixedViewport && scroller) {
          scroller.scrollLeft = 0
          scroller.scrollTop = 0
        }
        window.scrollTo(0, 0)
      },
      () => sourceIsExact(editor, source) && (!fixedViewport || !scroller ||
        (scroller.scrollLeft === 0 && scroller.scrollTop === 0))
    )
    if (!sourceIsExact(editor, source)) {
      throw new Error(`Restored source mismatch: expected ${source.length} characters`)
    }
  }

  /*
   * This remains a separate semantic poll for autocomplete, whose popup may be
   * rendered outside the editor root. Settled editor scenarios use measureSettled.
   */
  async function waitFor(predicate, description, timeout = 5_000) {
    const deadline = performance.now() + timeout
    while (!predicate()) {
      if (performance.now() >= deadline) throw new Error(`Timed out waiting for ${description}`)
      await nextFrame()
    }
  }

  function getEditor() {
    const textarea = document.querySelector("#code")
    const editor = textarea && textarea.editorreference
    if (!editor) throw new Error("PuzzleScript editor is not mounted")
    return editor
  }

  function editorInput(editor) {
    const input = editor.getInputElement && editor.getInputElement()
    if (!input) throw new Error("PuzzleScript editor input is unavailable")
    return input
  }

  function dispatchKey(target, type, key, code, keyCode, modifiers) {
    const event = new KeyboardEvent(type, {
      key,
      code,
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true,
      ...modifiers
    })
    target.dispatchEvent(event)
  }

  function closeTransientUi(editor) {
    const input = editorInput(editor)
    dispatchKey(input, "keydown", "Escape", "Escape", 27)
    dispatchKey(input, "keyup", "Escape", "Escape", 27)
  }

  function cursorAtEnd(source) {
    const lines = source.split("\n")
    return {line: lines.length - 1, column: lines[lines.length - 1].length}
  }

  function completionVisible() {
    return Array.from(document.querySelectorAll(".CodeMirror-hints,.cm-tooltip-autocomplete"))
      .some(element => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
      })
  }

  function intersectsViewport(element, rootRect) {
    const rect = element.getBoundingClientRect()
    return rect.bottom > rootRect.top && rect.top < rootRect.bottom &&
      rect.right > rootRect.left && rect.left < rootRect.right
  }

  function distantRenderingIsExact(targetLine) {
    const cm6 = document.querySelector(".cm-editor")
    const root = cm6 || document.querySelector(".CodeMirror")
    if (!root) return false
    const scroller = document.querySelector(".CodeMirror-scroll,.cm-scroller")
    if (!scroller) return false
    const viewportRect = scroller.getBoundingClientRect()
    const visible = selector => Array.from(root.querySelectorAll(selector))
      .filter(element => intersectsViewport(element, viewportRect))
    const requestedLineNumber = String(targetLine + 1)
    const requestedLine = visible(
      ".cm-lineNumbers .cm-gutterElement,.CodeMirror-linenumber"
    ).find(element => element.textContent.trim() === requestedLineNumber)
    if (!requestedLine) return false
    const lineRect = requestedLine.getBoundingClientRect()
    const cursorOnRequestedLine = visible(".cm-cursor,.CodeMirror-cursor").some(element => {
      const cursorRect = element.getBoundingClientRect()
      return cursorRect.bottom > lineRect.top && cursorRect.top < lineRect.bottom
    })
    if (!cursorOnRequestedLine) return false
    const levelOnRequestedLine = visible(".cm-LEVEL").some(element => {
      const levelRect = element.getBoundingClientRect()
      return levelRect.bottom > lineRect.top && levelRect.top < lineRect.bottom
    })
    if (!levelOnRequestedLine) return false
    return !cm6 || visible(".cm-METADATA,.cm-ERROR").length === 0
  }

  function validateInputs(inputs) {
    if (!inputs || typeof inputs.representativeSource !== "string" ||
        typeof inputs.largeSource !== "string" ||
        !inputs.completion || typeof inputs.completion.source !== "string" ||
        typeof inputs.completion.key !== "string") {
      throw new TypeError("Performance sources are required")
    }
    if (!Number.isInteger(inputs.distantLine) || inputs.distantLine < 0) {
      throw new TypeError("A non-negative distantLine is required")
    }
  }

  const scenarios = {
    async currentMountSettled(editor) {
      if (typeof editor.getValue !== "function") {
        throw new Error("PuzzleScript editor source is unavailable")
      }
      const mountedSource = editor.getValue()
      return measureSettled(
        "currentMountSettled",
        () => {},
        () => sourceIsExact(editor, mountedSource)
      )
    },

    async keyToNextPaint(editor, inputs) {
      await restore(editor, inputs.largeSource, {line: 0, column: 0}, {fixedViewport: true})
      const start = performance.now()
      editor.replaceSelection(" ")
      await nextFrame()
      return performance.now() - start
    },

    async autocompleteVisible(editor, inputs) {
      const completion = inputs.completion
      await restore(editor, completion.source, completion.cursor)
      const start = performance.now()
      editor.replaceSelection(completion.key)
      dispatchKey(editorInput(editor), "keyup", completion.key, `Key${completion.key.toUpperCase()}`,
        completion.key.toUpperCase().charCodeAt(0))
      await waitFor(completionVisible, "autocomplete popup")
      return performance.now() - start
    },

    async hundredApiEdits(editor, inputs) {
      await restore(editor, inputs.representativeSource, cursorAtEnd(inputs.representativeSource))
      const start = performance.now()
      for (let index = 0; index < 100; index += 1) editor.replaceSelection("x")
      return performance.now() - start
    },

    async replaceDocumentSync(editor, inputs) {
      await restore(editor, inputs.representativeSource, {line: 0, column: 0})
      const start = performance.now()
      replaceDocument(editor, inputs.largeSource)
      return performance.now() - start
    },

    async replaceDocumentSettled(editor, inputs) {
      await restore(editor, inputs.representativeSource, {line: 0, column: 0})
      return measureSettled(
        "replaceDocumentSettled",
        () => replaceDocument(editor, inputs.largeSource),
        () => sourceIsExact(editor, inputs.largeSource)
      )
    },

    async loadDistantJumpExact(editor, inputs) {
      await restore(editor, inputs.representativeSource, {line: 0, column: 0})
      return measureSettled(
        "exact distant LEVEL rendering",
        () => {
          replaceDocument(editor, inputs.largeSource)
          revealLine(editor, inputs.distantLine, inputs.distantColumn || 0)
        },
        () => distantRenderingIsExact(inputs.distantLine),
        10_000
      )
    },

    async cursorFocusSearchSettled(editor, inputs) {
      await restore(editor, inputs.representativeSource, {line: 0, column: 0})
      const input = editorInput(editor)
      const apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform)
      return measureSettled(
        "cursorFocusSearchSettled",
        () => {
          editor.blur()
          revealLine(editor, 2, 0)
          editor.focus()
          dispatchKey(input, "keydown", "f", "KeyF", 70, apple ? {metaKey: true} : {ctrlKey: true})
          dispatchKey(input, "keyup", "f", "KeyF", 70, apple ? {metaKey: true} : {ctrlKey: true})
        },
        () => Boolean(document.querySelector(".CodeMirror-search-panel,.cm-search"))
      )
    }
  }

  function summarize(values) {
    if (!Array.isArray(values) || values.length === 0 || values.some(value => !Number.isFinite(value))) {
      throw new TypeError("summarize requires finite samples")
    }
    const samples = values.slice().sort((left, right) => left - right)
    const midpoint = Math.floor(samples.length / 2)
    const median = samples.length % 2
      ? samples[midpoint]
      : (samples[midpoint - 1] + samples[midpoint]) / 2
    return {
      samples,
      median,
      p95: samples[Math.ceil(samples.length * 0.95) - 1],
      min: samples[0],
      max: samples[samples.length - 1]
    }
  }

  async function runScenario(name, inputs) {
    validateInputs(inputs)
    const scenario = scenarios[name]
    if (!scenario) throw new Error(`Unknown performance scenario: ${name}`)
    const duration = await scenario(getEditor(), inputs)
    if (!Number.isFinite(duration)) throw new Error(`${name} returned a non-finite duration`)
    return duration
  }

  async function runAll(inputs) {
    validateInputs(inputs)
    const summaries = {}
    for (const name of scenarioNames) {
      for (let index = 0; index < WARMUPS; index += 1) await runScenario(name, inputs)
      const samples = []
      for (let index = 0; index < SAMPLES; index += 1) samples.push(await runScenario(name, inputs))
      summaries[name] = summarize(samples)
    }
    return {
      warmups: WARMUPS,
      samples: SAMPLES,
      sourceLengths: {
        representative: inputs.representativeSource.length,
        completion: inputs.completion.source.length + inputs.completion.key.length,
        large: inputs.largeSource.length
      },
      summaries
    }
  }

  window.PuzzleScriptPerformance = Object.freeze({runAll, runScenario, summarize})
})()
