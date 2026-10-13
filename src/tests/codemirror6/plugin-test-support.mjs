await import("../../js/codemirror6/runtime/dist/codemirror6-runtime.js")
await import("../../js/codemirror6/plugins/bootstrap.js")
await import("../../js/codemirror6/plugins/style-token.js")
await import("../../js/codemirror6/plugins/dynamic-colors.js")
await import("../../js/codemirror6/plugins/exact-prefix.js")
await import("../../js/codemirror6/plugins/stream-language.js")
await import("../../js/codemirror6/plugins/stream-state.js")
await import("../../js/codemirror6/plugins/token-presentation.js")
await import("../../js/codemirror6/plugins/autocomplete.js")
await import("../../js/codemirror6/plugins/commands.js")
await import("../../js/codemirror6/plugins/interactions.js")
await import("../../js/codemirror6/plugins/search.js")
await import("../../js/codemirror6/plugins/editor-adapter.js")
await import("../../js/codemirror6/plugins/index.js")

const host = globalThis.PuzzleScriptCM6Plugins
const runtime = globalThis.PuzzleScriptCM6Runtime
const styleToken = host.require("style-token")
const dynamicColors = host.require("dynamic-colors")
const exact = host.require("exact-prefix")
const streamLanguage = host.require("stream-language")
const streamState = host.require("stream-state")
const presentation = host.require("token-presentation")
const autocomplete = host.require("autocomplete")
const commands = host.require("commands")
const interactions = host.require("interactions")
const search = host.require("search")
const adapter = host.require("editor-adapter")
const index = host.require("index")

export const {
  Decoration,
  EditorSelection,
  EditorState,
  EditorView,
  ensureSyntaxTree,
  getSearchQuery,
  history,
  isolateHistory,
  redo,
  SearchQuery,
  setSearchQuery,
  setSelectedCompletion,
  StringStream,
  syntaxTree,
  syntaxTreeAvailable,
  Text,
  Transaction,
  undo,
  undoSelection
} = runtime

export const {
  decodeStyleToken,
  encodeStyleToken,
  isStyleToken
} = styleToken
export const {styleFromHexCode} = dynamicColors
export const {
  ensureExactPrefix,
  exactPrefix,
  ExactPrefixScheduler,
  exactPrefixExtensions,
  exactPrefixScheduler,
  setExactPrefix
} = exact
export const {
  CM5_MAX_HIGHLIGHT_LENGTH,
  createPuzzleScriptLanguage,
  wrapPuzzleScriptParser
} = streamLanguage
export const {
  assertPinnedStreamLanguage,
  getTokenAtPosition
} = streamState
export const {
  buildTokenDecorations,
  classesForStyle,
  dynamicHexForStyle,
  presentationClasses,
  tokenPresentation,
  updateTokenDecorations
} = presentation
export const {
  createPuzzleScriptAutocompleteActivationCleanup,
  createPuzzleScriptAutocompleteActivationController,
  puzzleScriptAutocomplete,
  puzzleScriptCompletionKeymap,
  puzzleScriptCompletionSource
} = autocomplete
export const {
  deletePuzzleScriptLine,
  indentPuzzleScriptAuto,
  macShiftControlPageUp,
  movePuzzleScriptLineDown,
  movePuzzleScriptLineUp,
  overwriteMode,
  puzzleScriptCommandExtensions,
  puzzleScriptCoreKeymap,
  puzzleScriptKeymap,
  setOverwriteMode,
  togglePuzzleScriptComment,
  togglePuzzleScriptOverwrite
} = commands
export const {
  classifyPuzzleScriptToken,
  dispatchPuzzleScriptInteraction,
  notifyPuzzleScriptChange,
  puzzleScriptInteractions,
  puzzleScriptTokenAtPosition
} = interactions
export const {
  forceCaseInsensitive,
  puzzleScriptSearch,
  puzzleScriptSearchKeymap
} = search
export const {
  clipPosition,
  createCleanDocumentTracker,
  createCM6EditorDriver
} = adapter
export const {createEditor} = index
