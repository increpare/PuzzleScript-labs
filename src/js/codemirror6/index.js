import {
  puzzleScriptAutocomplete,
  puzzleScriptCompletionKeymap,
  puzzleScriptCompletionSource
} from "./autocomplete.js"
import {createPuzzleScriptLanguage} from "./stream-language.js"
import {buildTokenDecorations} from "./token-presentation.js"

function createEditor() {
  throw new Error("PuzzleScript CM6 editor has not been assembled yet")
}

window.PuzzleScriptCM6 = Object.freeze({
  createEditor,
  puzzleScriptAutocomplete,
  puzzleScriptCompletionKeymap,
  puzzleScriptCompletionSource,
  createPuzzleScriptLanguage,
  buildTokenDecorations
})
