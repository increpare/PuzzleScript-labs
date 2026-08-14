import {history} from "@codemirror/commands"
import {EditorState} from "@codemirror/state"
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
import {createCM6EditorDriver} from "./editor-adapter.js"
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
  const extensions = [
    lineNumbers(),
    highlightActiveLineGutter(),
    history({minDepth: 200, newGroupDelay: 1250}),
    drawSelection(),
    dropCursor(),
    highlightActiveLine(),
    EditorView.editorAttributes.of({class: "puzzlescript-editor"}),
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
    puzzleScriptInteractions({language, callbacks: options.callbacks}),
    puzzleScriptCommandExtensions,
    keymap.of([
      ...puzzleScriptCompletionKeymap,
      ...puzzleScriptKeymap,
      ...puzzleScriptSearchKeymap,
      ...puzzleScriptCoreKeymap
    ])
  ]
  const state = EditorState.create({doc: options.textarea.value, extensions})
  const view = new EditorView({state, parent: options.parent})
  const driver = createCM6EditorDriver(view, extensions)
  const editor = globalThis.PuzzleScriptEditorAPI.createPuzzleScriptEditor(driver)
  globalThis.installImagePasteHandler(
    view.dom,
    editor,
    options.imagePaste.imageBlobToObjectText
  )
  return editor
}

window.PuzzleScriptCM6 = Object.freeze({createEditor})
