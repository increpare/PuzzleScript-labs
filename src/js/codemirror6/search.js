import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  search,
  setSearchQuery
} from "@codemirror/search"
import {EditorState} from "@codemirror/state"
import {ViewPlugin} from "@codemirror/view"

const puzzleScriptSearchPhrases = EditorState.phrases.of({
  regexp: "regex",
  "by word": "whole word"
})

export function forceCaseInsensitive(query) {
  if (!query.caseSensitive) return query
  return new SearchQuery({
    search: query.search,
    caseSensitive: false,
    literal: query.literal,
    regexp: query.regexp,
    replace: query.replace,
    wholeWord: query.wholeWord,
    test: query.test
  })
}

function hideCaseControl(view) {
  const control = view.dom.querySelector(".cm-search [name=case]")
  if (!control) return
  control.disabled = true
  control.tabIndex = -1
  control.setAttribute("aria-hidden", "true")
  const label = control.closest("label")
  if (label) label.hidden = true
}

const caseInsensitiveSearchGuard = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view
    this.pending = false
    this.destroyed = false
    this.sync()
  }

  update(update) {
    this.view = update.view
    this.sync()
  }

  sync() {
    hideCaseControl(this.view)
    if (this.pending) return
    this.pending = true
    queueMicrotask(() => {
      this.pending = false
      if (this.destroyed) return
      hideCaseControl(this.view)
      const query = getSearchQuery(this.view.state)
      if (query.caseSensitive) {
        this.view.dispatch({effects: setSearchQuery.of(forceCaseInsensitive(query))})
      }
    })
  }

  destroy() {
    this.destroyed = true
  }
})

function closeSearch(view) {
  closeSearchPanel(view)
  return true
}

export const puzzleScriptSearchKeymap = Object.freeze([
  {key: "Escape", run: closeSearch, scope: "editor search-panel"},
  {win: "Ctrl-f", linux: "Ctrl-f", mac: "Meta-f", run: openSearchPanel, scope: "editor search-panel"},
  {win: "Ctrl-g", linux: "Ctrl-g", mac: "Meta-g", run: findNext, scope: "editor search-panel"},
  {win: "Shift-Ctrl-g", linux: "Shift-Ctrl-g", mac: "Shift-Meta-g", run: findPrevious, scope: "editor search-panel"},
  {win: "Shift-Ctrl-r", linux: "Shift-Ctrl-r", mac: "Shift-Meta-Alt-f", run: replaceAll, scope: "editor search-panel"}
])

export function puzzleScriptSearch() {
  return [
    puzzleScriptSearchPhrases,
    search({top: true, caseSensitive: false, regexp: false, wholeWord: false}),
    caseInsensitiveSearchGuard
  ]
}
