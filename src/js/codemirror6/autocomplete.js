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
import {Prec} from "@codemirror/state"
import {EditorView, keymap} from "@codemirror/view"

import {ensureExactPrefix, exactPrefix} from "./exact-prefix.js"
import {getTokenAtPosition} from "./stream-state.js"

function stateWithExactPrefix(context) {
  let state = context.view ? context.view.state : context.state
  if ((state.field(exactPrefix, false) ?? -1) >= context.pos) return state
  if (!context.view || !ensureExactPrefix(context.view, context.pos, 50)) return null
  state = context.view.state
  return (state.field(exactPrefix, false) ?? -1) >= context.pos ? state : null
}

export function puzzleScriptCompletionSource({language, complete}) {
  return async context => {
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

export function puzzleScriptAutocomplete({language, complete, excludedKeyCodes}) {
  const source = puzzleScriptCompletionSource({language, complete})
  const completion = autocompletion({
    activateOnTyping: false,
    defaultKeymap: false,
    interactionDelay: 0,
    maxRenderedOptions: Number.MAX_SAFE_INTEGER,
    icons: false,
    override: [source],
    addToOptions: [{render: renderPuzzleScriptOption, position: 40}]
  })
  const activateOnKeyRelease = EditorView.domEventHandlers({
    keyup(event, view) {
      if (!Object.prototype.hasOwnProperty.call(excludedKeyCodes, event.keyCode)) startCompletion(view)
      return false
    }
  })
  return [completion, Prec.highest(keymap.of(puzzleScriptCompletionKeymap)), activateOnKeyRelease]
}
