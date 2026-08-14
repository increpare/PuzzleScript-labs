import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  completionStatus,
  currentCompletions,
  moveCompletionSelection,
  setSelectedCompletion,
  startCompletion
} from "@codemirror/autocomplete"
import {syntaxTreeAvailable} from "@codemirror/language"
import {EditorView, ViewPlugin} from "@codemirror/view"

import {ensureExactPrefix, exactPrefix} from "./exact-prefix.js"
import {getTokenAtPosition} from "./stream-state.js"

function stateWithExactPrefix(context) {
  let state = context.view ? context.view.state : context.state
  if ((state.field(exactPrefix, false) ?? -1) >= context.pos &&
      syntaxTreeAvailable(state, context.pos)) return state
  if (!context.view || !ensureExactPrefix(context.view, context.pos, 50)) return null
  state = context.view.state
  return (state.field(exactPrefix, false) ?? -1) >= context.pos &&
    syntaxTreeAvailable(state, context.pos) ? state : null
}

export function puzzleScriptCompletionSource({language, complete, allows = () => true}) {
  return async context => {
    if (!allows(context.state.doc)) return null
    const state = stateWithExactPrefix(context)
    if (!state) return null

    const line = state.doc.lineAt(context.pos)
    const token = getTokenAtPosition(state, language, context.pos)
    const result = complete({
      line: line.text,
      previousLine: line.number > 1 ? state.doc.line(line.number - 1).text : "",
      cursor: context.pos - line.from,
      token,
      state: token.state
    })
    if (!result || result.list.length === 0) return null

    return {
      from: line.from + result.from,
      to: line.from + result.to,
      filter: false,
      options: result.list.map(item => ({
        label: item.text,
        displayLabel: "",
        psExtra: item.extra || "",
        psTag: item.tag || null,
        type: item.tag || undefined,
        apply: item.text
      }))
    }
  }
}

function renderPuzzleScriptOption(completion) {
  let primaryText = completion.label
  let extraText = completion.psExtra || ""
  if (primaryText.length === 0) {
    primaryText = extraText
    extraText = completion.label
  }

  const fragment = document.createDocumentFragment()
  const wrapper = document.createElement("span")
  wrapper.className += " cm-s-midnight "
  const primary = document.createElement("span")
  primary.appendChild(document.createTextNode(primaryText))
  if (completion.psTag != null) primary.className += "cm-" + completion.psTag
  wrapper.appendChild(primary)
  fragment.appendChild(wrapper)
  if (extraText.length > 0) fragment.appendChild(document.createTextNode(" " + extraText))
  return fragment
}

const moveUp = moveCompletionSelection(false)
const moveDown = moveCompletionSelection(true)
const movePageUp = moveCompletionSelection(false, "page")
const movePageDown = moveCompletionSelection(true, "page")

function moveToBoundary(last) {
  return view => {
    if (completionStatus(view.state) !== "active") return false
    const options = currentCompletions(view.state)
    if (options.length === 0) return false
    view.dispatch({effects: setSelectedCompletion(last ? options.length - 1 : 0)})
    return true
  }
}

export const puzzleScriptCompletionKeymap = Object.freeze([
  {key: "ArrowUp", run: moveUp},
  {key: "ArrowDown", run: moveDown},
  {key: "PageUp", run: movePageUp},
  {key: "PageDown", run: movePageDown},
  {key: "Home", run: moveToBoundary(false)},
  {key: "End", run: moveToBoundary(true)},
  {key: "Enter", run: acceptCompletion},
  {key: "Tab", run: acceptCompletion},
  {key: "Escape", run: closeCompletion},
  {mac: "Ctrl-p", run: moveUp},
  {mac: "Ctrl-n", run: moveDown}
])

export function createPuzzleScriptAutocompleteActivationCleanup(
  activation,
  defer = callback => queueMicrotask(callback)
) {
  let generation = 0
  return Object.freeze({
    create() {
      const ownGeneration = ++generation
      return {
        destroy() {
          defer(() => {
            if (generation === ownGeneration) activation.destroy()
          })
        }
      }
    }
  })
}

export function createPuzzleScriptAutocompleteActivationController({
  excludedKeyCodes,
  start = startCompletion,
  schedule = callback => setTimeout(callback, 0),
  cancel = timer => clearTimeout(timer)
}) {
  let keydown = null
  let allowedDocument = null
  let fallbackPending = false
  let fallbackTimer = null
  let destroyed = false

  function cancelFallback() {
    fallbackPending = false
    if (fallbackTimer == null) return
    cancel(fallbackTimer)
    fallbackTimer = null
  }

  function scheduleFallback(view) {
    if (destroyed || fallbackTimer != null) return
    fallbackTimer = schedule(() => {
      fallbackTimer = null
      if (!destroyed) start(view)
    })
  }

  const controller = {
    keydown(event) {
      if (destroyed) return
      keydown = {code: String(event.keyCode || event.which)}
    },

    observeTransactions(transactions, document) {
      if (destroyed) return
      for (const transaction of transactions) {
        if (!transaction.docChanged) continue
        allowedDocument = null
        if (transaction.isUserEvent("input.type")) {
          cancelFallback()
          const code = keydown && keydown.code
          if (!Object.prototype.hasOwnProperty.call(excludedKeyCodes, code)) {
            allowedDocument = transaction.newDoc
          }
        } else if (transaction.isUserEvent("input.paste") ||
                   transaction.isUserEvent("delete.backward") ||
                   transaction.isUserEvent("delete.forward") ||
                   transaction.isUserEvent("delete.cut")) {
          allowedDocument = transaction.newDoc
          fallbackPending = true
        }
      }
      if (allowedDocument !== document) allowedDocument = null
    },

    keyup(event, view) {
      if (destroyed) return false
      if (fallbackPending) {
        fallbackPending = false
        scheduleFallback(view)
      }
      if (!event) return false

      const code = String(event.keyCode || event.which)
      if (keydown && keydown.code === code) keydown = null
      return false
    },

    allows(document) {
      return !destroyed && document === allowedDocument
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      keydown = null
      allowedDocument = null
      cancelFallback()
    }
  }
  return Object.freeze(controller)
}

export function puzzleScriptAutocomplete({language, complete, excludedKeyCodes}) {
  const activation = createPuzzleScriptAutocompleteActivationController({excludedKeyCodes})
  const cleanup = createPuzzleScriptAutocompleteActivationCleanup(activation)
  const source = puzzleScriptCompletionSource({language, complete, allows: activation.allows})
  const completion = autocompletion({
    activateOnTyping: true,
    activateOnTypingDelay: 0,
    defaultKeymap: false,
    interactionDelay: 0,
    maxRenderedOptions: Number.MAX_SAFE_INTEGER,
    icons: false,
    override: [source],
    addToOptions: [{render: renderPuzzleScriptOption, position: 40}]
  })
  const activationHandlers = EditorView.domEventHandlers({
    keydown(event) {
      activation.keydown(event)
      return false
    },
    keyup(event, view) {
      return activation.keyup(event, view)
    }
  })
  const observeActivation = EditorView.updateListener.of(update => {
    activation.observeTransactions(update.transactions, update.state.doc)
    activation.keyup(null, update.view)
  })
  const destroyActivation = ViewPlugin.define(() => cleanup.create())
  return [completion, activationHandlers, observeActivation, destroyActivation]
}
