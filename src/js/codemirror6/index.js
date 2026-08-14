import {
  puzzleScriptAutocomplete,
  puzzleScriptCompletionKeymap,
  puzzleScriptCompletionSource
} from "./autocomplete.js"
import {
  movePuzzleScriptLineDown,
  movePuzzleScriptLineUp,
  puzzleScriptCommandExtensions,
  puzzleScriptCoreKeymap,
  puzzleScriptKeymap,
  togglePuzzleScriptComment,
  togglePuzzleScriptOverwrite
} from "./commands.js"
import {createCM6EditorDriver} from "./editor-adapter.js"
import {createPuzzleScriptLanguage} from "./stream-language.js"
import {
  forceCaseInsensitive,
  puzzleScriptSearch,
  puzzleScriptSearchKeymap
} from "./search.js"
import {buildTokenDecorations} from "./token-presentation.js"

function createEditor() {
  throw new Error("PuzzleScript CM6 editor has not been assembled yet")
}

window.PuzzleScriptCM6 = Object.freeze({
  createEditor,
  createCM6EditorDriver,
  puzzleScriptAutocomplete,
  puzzleScriptCompletionKeymap,
  puzzleScriptCompletionSource,
  puzzleScriptCommandExtensions,
  puzzleScriptCoreKeymap,
  puzzleScriptKeymap,
  puzzleScriptSearch,
  puzzleScriptSearchKeymap,
  createPuzzleScriptLanguage,
  buildTokenDecorations,
  forceCaseInsensitive,
  movePuzzleScriptLineDown,
  movePuzzleScriptLineUp,
  togglePuzzleScriptComment,
  togglePuzzleScriptOverwrite
})
