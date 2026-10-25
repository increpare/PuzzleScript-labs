(function(host) {
"use strict"

const {EditorView, syntaxTree, ViewPlugin} = host.requireRuntime(["EditorView", "syntaxTree", "ViewPlugin"])
const {ensureExactPrefix, exactPrefix} = host.require("exact-prefix")
const {getTokenAtPosition} = host.require("stream-state")
const {CM5_MAX_HIGHLIGHT_LENGTH} = host.require("stream-language")
const {decodeStyleToken, isStyleToken} = host.require("style-token")

function styleNodeAt(state, position) {
  const clipped = Math.max(0, Math.min(state.doc.length, position))
  const tree = syntaxTree(state)
  for (const bias of [1, -1]) {
    let node = tree.resolveInner(clipped, bias)
    while (node) {
      if (isStyleToken(node.name) && node.from <= clipped && node.to > clipped) return node
      node = node.parent
    }
  }
  return null
}

function puzzleScriptTokenAtPosition(state, position) {
  const node = styleNodeAt(state, position)
  if (!node || state.field(exactPrefix, false) < node.to) return null
  return {
    from: node.from,
    to: node.to,
    text: state.sliceDoc(node.from, node.to),
    style: decodeStyleToken(node.name),
    line: state.doc.lineAt(node.from).number - 1
  }
}

function declarationAtPosition(state, language, position) {
  const token = puzzleScriptTokenAtPosition(state, position)
  if (!token || !token.style.split(/\s+/).includes("NAME")) return null
  const line = state.doc.lineAt(token.from)
  if (state.field(exactPrefix, false) < line.to) return null
  const name = token.text.trim().toLowerCase()
  const parsed = getTokenAtPosition(state, language, line.to).state
  // Use the parser's declarations rather than original_line_numbers, which
  // omits punctuation-only aliases such as "!".
  const declaration = Object.hasOwn(parsed.objects, name) ? parsed.objects[name] :
    [...parsed.legend_synonyms, ...parsed.legend_properties, ...parsed.legend_aggregates]
      .find(entry => entry[0] === name)
  return declaration ? {name, line: declaration.lineNumber} : null
}

function definitionLine(state, declaration) {
  if (!declaration || declaration.line < 1) return null
  // StreamLanguage calls blankLine instead of token on empty lines. The
  // legacy parser increments lineNumber only in token, so its declaration
  // numbers count nonempty lines rather than physical document lines. The
  // stream wrapper also rolls back state for lines beyond its length limit.
  let parsedLine = 0, number = 0
  for (const text of state.doc.iterLines()) {
    number++
    if (text.length && text.length <= CM5_MAX_HIGHLIGHT_LENGTH &&
        ++parsedLine === declaration.line) return state.doc.line(number)
  }
  return null
}

function definitionRange(state, declaration) {
  const line = definitionLine(state, declaration)
  if (!line) return null
  if (state.field(exactPrefix, false) < line.to) return null
  let result = null
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter(node) {
      if (!isStyleToken(node.name) || !decodeStyleToken(node.name).split(/\s+/).includes("NAME")) return
      const text = state.sliceDoc(node.from, node.to)
      if (text.trim().toLowerCase() !== declaration.name) return
      const from = node.from + text.length - text.trimStart().length
      result = {from, to: from + text.trim().length}
      return false
    }
  })
  return result
}

function puzzleScriptDefinitionAtPosition(state, language, position, targetState = state) {
  return definitionRange(targetState, declarationAtPosition(state, language, position))
}

function puzzleScriptDefinitionLinks({language, getDefinitionTarget} = {}) {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view
      this.window = view.dom.ownerDocument.defaultView
      this.mac = /^Mac/.test(this.window.navigator.platform)
      this.onModifiers = event => this.setActive(this.modified(event))
      this.onBlur = () => this.setActive(false)
      this.window.addEventListener("keydown", this.onModifiers)
      this.window.addEventListener("keyup", this.onModifiers)
      this.window.addEventListener("blur", this.onBlur)
    }

    modified(event) {
      return this.mac ? event.metaKey : event.ctrlKey
    }

    setActive(active) {
      this.view.dom.classList.toggle("puzzlescript-definition-links", Boolean(active))
    }

    destroy() {
      this.window.removeEventListener("keydown", this.onModifiers)
      this.window.removeEventListener("keyup", this.onModifiers)
      this.window.removeEventListener("blur", this.onBlur)
      this.setActive(false)
    }
  }, {
    eventHandlers: {
      mousemove(event) { this.onModifiers(event) },
      mousedown(event, view) {
        this.onModifiers(event)
        if (event.button !== 0 || !this.modified(event)) return false
        const name = event.target.closest && event.target.closest(".cm-NAME")
        if (!name || !view.contentDOM.contains(name)) return false
        // Coordinate hit testing rounds to a caret position, which can fall
        // beyond the token when clicking the right half of its final glyph.
        const position = view.posAtDOM(name)
        if (!ensureExactPrefix(view, view.state.doc.lineAt(position).to)) return false
        const declaration = declarationAtPosition(view.state, language, position)
        if (!declaration) return false
        const target = getDefinitionTarget ? getDefinitionTarget() : {view}
        if (!target) return false
        const line = definitionLine(target.view.state, declaration)
        if (!line || !ensureExactPrefix(target.view, line.to)) return false
        const range = definitionRange(target.view.state, declaration)
        if (!range) return false
        event.preventDefault()
        event.stopPropagation()
        if (target.reveal) target.reveal()
        target.view.dispatch({
          selection: {anchor: range.from, head: range.to},
          effects: EditorView.scrollIntoView(range.from, {y: "center"})
        })
        target.view.focus()
        return true
      }
    }
  })
}

function classifyPuzzleScriptToken(token, modifiers) {
  if (!token) return null
  const styles = new Set(token.style.split(/\s+/).filter(Boolean))
  if (styles.has("SOUND")) return {type: "sound", seed: Number(token.text)}
  if (styles.has("LEVEL") && (modifiers.ctrlKey || modifiers.metaKey)) {
    return {type: "level", line: token.line}
  }
  return null
}

function dispatchPuzzleScriptInteraction(action, callbacks) {
  if (!action) return false
  if (action.type === "sound") callbacks.onSound(action.seed)
  else if (action.type === "level") callbacks.onLevel(action.line)
  else return false
  return true
}

function notifyPuzzleScriptChange(update, onDocumentChange) {
  if (update.docChanged) onDocumentChange(update.state.doc)
}

function reportError(prefix, error) {
  const message = prefix + (error && error.message ? error.message : String(error))
  if (typeof globalThis.consoleError === "function") globalThis.consoleError(message)
  else console.error(message)
}

function puzzleScriptInteractions({language, callbacks, onDocumentChange}) {
  const onUpdate = EditorView.updateListener.of(update =>
    notifyPuzzleScriptChange(update, onDocumentChange))

  const handlers = EditorView.domEventHandlers({
    mousedown(event, view) {
      const position = view.posAtCoords({x: event.clientX, y: event.clientY})
      if (position == null) return false
      const action = classifyPuzzleScriptToken(
        puzzleScriptTokenAtPosition(view.state, position),
        event
      )
      if (!action) return false
      if (action.type === "level") {
        view.contentDOM.blur()
        event.preventDefault()
        event.stopPropagation()
        dispatchPuzzleScriptInteraction(action, callbacks)
        return true
      }
      dispatchPuzzleScriptInteraction(action, callbacks)
      return false
    },

    drop(event) {
      const file = event.dataTransfer && event.dataTransfer.files[0]
      if (!file) return false
      event.preventDefault()
      event.stopPropagation()
      const reader = new FileReader()
      reader.onload = () => callbacks.onSourceDrop(file, reader.result)
      reader.onerror = () => reportError("Load file failed: ", reader.error)
      reader.readAsText(file)
      return true
    }
  })

  return [puzzleScriptDefinitionLinks({language}), onUpdate, handlers]
}

host.define("interactions", {
  classifyPuzzleScriptToken,
  dispatchPuzzleScriptInteraction,
  notifyPuzzleScriptChange,
  puzzleScriptDefinitionAtPosition,
  puzzleScriptDefinitionLinks,
  puzzleScriptInteractions,
  puzzleScriptTokenAtPosition
})
})(globalThis.PuzzleScriptCM6Plugins)
