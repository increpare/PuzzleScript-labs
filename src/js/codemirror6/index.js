import {history} from "@codemirror/commands"
import {EditorState, Text} from "@codemirror/state"
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers
} from "@codemirror/view"

import {
  puzzleScriptAutocomplete,
  puzzleScriptCompletionKeymap
} from "./autocomplete.js"
import {
  puzzleScriptCommandExtensions,
  puzzleScriptCoreKeymap,
  puzzleScriptKeymap
} from "./commands.js"
import {
  createCleanDocumentTracker,
  createCM6EditorDriver
} from "./editor-adapter.js"
import {exactPrefixExtensions} from "./exact-prefix.js"
import {puzzleScriptInteractions} from "./interactions.js"
import {
  puzzleScriptSearch,
  puzzleScriptSearchKeymap
} from "./search.js"
import {createPuzzleScriptLanguage} from "./stream-language.js"
import {tokenPresentation} from "./token-presentation.js"

function createEditor(options) {
  const language = createPuzzleScriptLanguage(options.parser)
  const initialDocument = Text.of(options.textarea.value.split(/\r\n?|\n/))
  const cleanDocumentTracker = createCleanDocumentTracker(
    initialDocument,
    (left, right) => left.eq(right),
    options.callbacks.onDirtyChange
  )
  const isWebKit = /AppleWebKit\//.test(navigator.userAgent) &&
    !/(?:Chrome|Chromium|Edg)\//.test(navigator.userAgent)
  const extensions = [
    lineNumbers(),
    highlightActiveLineGutter(),
    history({minDepth: 200, newGroupDelay: 1250}),
    drawSelection(),
    dropCursor(),
    highlightActiveLine(),
    EditorView.editorAttributes.of({
      class: "puzzlescript-editor" + (isWebKit ? " puzzlescript-editor-webkit" : "")
    }),
    EditorState.tabSize.of(4),
    EditorState.allowMultipleSelections.of(false),
    EditorView.lineWrapping,
    language.extension,
    ...exactPrefixExtensions,
    tokenPresentation({language}),
    puzzleScriptAutocomplete({
      language,
      complete: options.autocomplete.complete,
      excludedKeyCodes: options.autocomplete.excludedKeyCodes
    }),
    puzzleScriptSearch(),
    puzzleScriptInteractions({
      language,
      callbacks: options.callbacks,
      onDocumentChange: cleanDocumentTracker.documentChanged
    }),
    puzzleScriptCommandExtensions,
    keymap.of([
      ...puzzleScriptCompletionKeymap,
      ...puzzleScriptKeymap,
      ...puzzleScriptSearchKeymap,
      ...puzzleScriptCoreKeymap
    ])
  ]
  const state = EditorState.create({doc: initialDocument, extensions})
  const view = new EditorView({state, parent: options.parent})
  const driver = createCM6EditorDriver(view, extensions, cleanDocumentTracker)
  const editor = globalThis.PuzzleScriptEditorAPI.createPuzzleScriptEditor(driver)
  globalThis.installImagePasteHandler(
    view.dom,
    editor,
    options.imagePaste.imageBlobToObjectText
  )
  return editor
}

window.PuzzleScriptCM6 = Object.freeze({createEditor})
