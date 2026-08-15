import {EditorSelection, EditorState} from "@codemirror/state"
import {EditorView} from "@codemirror/view"

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

export function clipPosition(state, line, column) {
  const lineNumber = Math.max(1, Math.min(state.doc.lines, Number(line) + 1 || 1))
  const documentLine = state.doc.line(lineNumber)
  const clippedColumn = Math.max(0, Math.min(documentLine.length, Number(column) || 0))
  return documentLine.from + clippedColumn
}

export function createCM6EditorDriver(view, extensions, cleanDocumentTracker) {
  function replaceDocument(text) {
    view.dispatch({
      changes: {from: 0, to: view.state.doc.length, insert: String(text)},
      selection: EditorSelection.cursor(0),
      effects: EditorView.scrollIntoView(0)
    })
  }

  return Object.freeze({
    getValue: () => view.state.doc.toString(),

    markClean: () => cleanDocumentTracker.markClean(view.state.doc),
    isDirty: () => cleanDocumentTracker.isDirty(),

    replaceDocument,
    // Temporary compatibility alias for external callers during migration.
    setValue: replaceDocument,

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

    revealLine(line, {cursor = false, y = "nearest"} = {}) {
      const position = clipPosition(view.state, line, cursor === false ? 0 : cursor)
      const spec = {
        effects: EditorView.scrollIntoView(position, {y})
      }
      if (cursor !== false) spec.selection = EditorSelection.cursor(position)
      view.dispatch(spec)
    },

    getInputElement: () => view.contentDOM
  })
}
