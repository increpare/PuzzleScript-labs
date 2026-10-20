(function(host) {
"use strict"

// Inline "ghost text" suggestions from the autocomplete model. A provider is asked for
// a completion 250 ms after the user stops typing; the answer is drawn after the cursor
// as a dimmed widget. Tab accepts it, Escape dismisses it, any other edit or cursor move
// clears it (typing the suggestion's own next characters keeps the rest).
//
//   puzzleScriptGhostText({language, provider})
//     provider.enabled()                -> boolean, read before every request
//     provider.request({doc, pos, token, state, generation, isCancelled})
//                                       -> Promise<string|null>; token/state come from
//                                          the streaming parser at the cursor
//   puzzleScriptGhostTextKeymap          Tab / Escape bindings; put it before the
//                                        completion keymap, it yields when the popup is open

const {
  completionStatus,
  Decoration,
  EditorView,
  StateEffect,
  StateField,
  ViewPlugin,
  WidgetType
} = host.requireRuntime([
  "completionStatus",
  "Decoration",
  "EditorView",
  "StateEffect",
  "StateField",
  "ViewPlugin",
  "WidgetType"
])
const {stateWithExactPrefix} = host.require("autocomplete")
const {getTokenAtPosition} = host.require("stream-state")

const DEBOUNCE_MS = 250

const setGhost = StateEffect.define()

class GhostWidget extends WidgetType {
  constructor(text) {
    super()
    this.text = text
  }
  eq(other) { return other.text === this.text }
  toDOM() {
    const span = document.createElement("span")
    span.className = "cm-ghost-text"
    span.textContent = this.text
    return span
  }
  ignoreEvent() { return false }
}

const ghostField = StateField.define({
  create() { return null },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setGhost)) return effect.value
    }
    if (!value) return null
    if (transaction.docChanged) {
      // Keep the suggestion when the user types its own next characters.
      let kept = null
      let single = true
      transaction.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
        if (!single) return
        const typed = inserted.toString()
        if (fromA === value.pos && toA === value.pos && typed.length > 0 &&
            value.text.startsWith(typed) && value.text.length > typed.length) {
          kept = {pos: fromB + typed.length, text: value.text.slice(typed.length)}
        } else {
          kept = null
          single = false
        }
      })
      return kept
    }
    if (transaction.selection) {
      const head = transaction.newSelection.main.head
      if (head !== value.pos || !transaction.newSelection.main.empty) return null
    }
    return value
  },
  provide: field => EditorView.decorations.from(field, value =>
    value ? Decoration.set([Decoration.widget({widget: new GhostWidget(value.text), side: 1}).range(value.pos)])
          : Decoration.none)
})

function currentGhost(state) {
  return state.field(ghostField, false) || null
}

function acceptGhostText(view) {
  const ghost = currentGhost(view.state)
  if (!ghost) return false
  if (completionStatus(view.state) === "active") return false
  view.dispatch({
    changes: {from: ghost.pos, insert: ghost.text},
    selection: {anchor: ghost.pos + ghost.text.length},
    effects: setGhost.of(null),
    userEvent: "input.complete"
  })
  return true
}

function dismissGhostText(view) {
  if (!currentGhost(view.state)) return false
  if (completionStatus(view.state) === "active") return false
  view.dispatch({effects: setGhost.of(null)})
  return true
}

const puzzleScriptGhostTextKeymap = Object.freeze([
  {key: "Tab", run: acceptGhostText},
  {key: "Escape", run: dismissGhostText}
])

function ghostTextRequester({language, provider}) {
  return ViewPlugin.define(view => {
    let timer = null
    let generation = 0

    function cancel() {
      generation++
      if (timer != null) { clearTimeout(timer); timer = null }
    }

    async function ask() {
      timer = null
      if (!provider.enabled()) return
      const requestGeneration = ++generation
      const requestedDoc = view.state.doc
      const pos = view.state.selection.main.head
      if (!view.state.selection.main.empty) return
      let token = null
      try {
        const state = stateWithExactPrefix({view, state: view.state, pos})
        if (!state) return
        token = getTokenAtPosition(state, language, pos)
      } catch (error) {
        return
      }
      const isCancelled = () => requestGeneration !== generation || view.state.doc !== requestedDoc
      let text = null
      try {
        text = await provider.request({
          doc: requestedDoc.toString(),
          pos,
          token,
          state: token.state,
          generation: requestGeneration,
          isCancelled
        })
      } catch (error) {
        console.warn("ghost text request failed", error)
        return
      }
      if (isCancelled() || !text) return
      if (view.state.selection.main.head !== pos) return
      view.dispatch({effects: setGhost.of({pos, text})})
    }

    return {
      update(update) {
        if (!update.docChanged && !update.selectionSet) return
        cancel()
        const userTyped = update.transactions.some(t =>
          t.isUserEvent("input.type") || t.isUserEvent("delete") || t.isUserEvent("input.paste"))
        if (!userTyped) return
        timer = setTimeout(ask, DEBOUNCE_MS)
      },
      destroy() { cancel() }
    }
  })
}

const ghostTheme = EditorView.baseTheme({
  ".cm-ghost-text": {
    opacity: "0.45",
    whiteSpace: "pre-wrap",
    pointerEvents: "none"
  }
})

function puzzleScriptGhostText({language, provider}) {
  return [ghostField, ghostTextRequester({language, provider}), ghostTheme]
}

host.define("ghost-text", {
  acceptGhostText,
  dismissGhostText,
  puzzleScriptGhostText,
  puzzleScriptGhostTextKeymap,
  setGhost
})
})(globalThis.PuzzleScriptCM6Plugins)
