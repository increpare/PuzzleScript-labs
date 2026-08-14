import {EditorSelection, EditorState} from "@codemirror/state"
import {EditorView} from "@codemirror/view"

export function clipPosition(state, line, column) {
  const lineNumber = Math.max(1, Math.min(state.doc.lines, Number(line) + 1 || 1))
  const documentLine = state.doc.line(lineNumber)
  const clippedColumn = Math.max(0, Math.min(documentLine.length, Number(column) || 0))
  return documentLine.from + clippedColumn
}

export function createCM6EditorDriver(view, extensions) {
  return Object.freeze({
    getValue: () => view.state.doc.toString(),

    setValue(text) {
      view.dispatch({
        changes: {from: 0, to: view.state.doc.length, insert: String(text)},
        selection: EditorSelection.cursor(0),
        effects: EditorView.scrollIntoView(0)
      })
    },

    clearHistory() {
      view.setState(EditorState.create({
        doc: view.state.doc,
        selection: view.state.selection,
        extensions
      }))
    },

    focus: () => view.focus(),
    blur: () => view.contentDOM.blur(),

    replaceSelection(text) {
      view.dispatch(view.state.replaceSelection(String(text)))
    },

    setCursor(line, column) {
      const position = clipPosition(view.state, line, column)
      view.dispatch({
        selection: EditorSelection.cursor(position),
        effects: EditorView.scrollIntoView(position)
      })
    },

    scrollToLine(line) {
      const position = clipPosition(view.state, line, 0)
      view.dispatch({effects: EditorView.scrollIntoView(position)})
    },

    getLastLine: () => view.state.doc.lines - 1,
    getInputElement: () => view.contentDOM
  })
}
