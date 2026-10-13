(function(host) {
"use strict"

const {
  history,
  EditorState,
  Text,
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers
} = host.requireRuntime([
  "history",
  "EditorState",
  "Text",
  "EditorView",
  "drawSelection",
  "dropCursor",
  "highlightActiveLine",
  "highlightActiveLineGutter",
  "keymap",
  "lineNumbers"
])
const {
  puzzleScriptAutocomplete,
  puzzleScriptCompletionKeymap
} = host.require("autocomplete")
const {
  puzzleScriptCommandExtensions,
  puzzleScriptCoreKeymap,
  puzzleScriptKeymap
} = host.require("commands")
const {
  createCleanDocumentTracker,
  createCM6EditorDriver
} = host.require("editor-adapter")
const {exactPrefixExtensions} = host.require("exact-prefix")
const {puzzleScriptInteractions} = host.require("interactions")
const {
  puzzleScriptSearch,
  puzzleScriptSearchKeymap
} = host.require("search")
const {createPuzzleScriptLanguage} = host.require("stream-language")
const {tokenPresentation} = host.require("token-presentation")

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

host.define("index", {createEditor})
host.seal()
globalThis.PuzzleScriptCM6 = Object.freeze({createEditor})
})(globalThis.PuzzleScriptCM6Plugins)
