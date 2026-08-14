import {syntaxTree} from "@codemirror/language"
import {EditorView} from "@codemirror/view"

import {exactPrefix} from "./exact-prefix.js"
import {decodeStyleToken, isStyleToken} from "./style-token.js"

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

export function puzzleScriptTokenAtPosition(state, position) {
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

export function classifyPuzzleScriptToken(token, modifiers) {
  if (!token) return null
  const styles = new Set(token.style.split(/\s+/).filter(Boolean))
  if (styles.has("SOUND")) return {type: "sound", seed: Number(token.text)}
  if (styles.has("LEVEL") && (modifiers.ctrlKey || modifiers.metaKey)) {
    return {type: "level", line: token.line}
  }
  return null
}

export function dispatchPuzzleScriptInteraction(action, callbacks) {
  if (!action) return false
  if (action.type === "sound") callbacks.onSound(action.seed)
  else if (action.type === "level") callbacks.onLevel(action.line)
  else return false
  return true
}

export function notifyPuzzleScriptChange(update, onChange) {
  if (update.docChanged) onChange(update.state.doc.toString())
}

function reportError(prefix, error) {
  const message = prefix + (error && error.message ? error.message : String(error))
  if (typeof globalThis.consoleError === "function") globalThis.consoleError(message)
  else console.error(message)
}

export function puzzleScriptInteractions({callbacks}) {
  const onUpdate = EditorView.updateListener.of(update =>
    notifyPuzzleScriptChange(update, callbacks.onChange))

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

  return [onUpdate, handlers]
}
