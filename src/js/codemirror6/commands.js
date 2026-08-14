import {
  cursorCharLeft,
  cursorCharRight,
  cursorDocEnd,
  cursorDocStart,
  cursorGroupLeft,
  cursorGroupRight,
  cursorLineBoundaryBackward,
  cursorLineBoundaryForward,
  cursorLineBoundaryLeft,
  cursorLineBoundaryRight,
  cursorLineDown,
  cursorLineEnd,
  cursorLineStart,
  cursorLineUp,
  cursorPageDown,
  cursorPageUp,
  deleteCharBackward,
  deleteCharForward,
  deleteGroupBackward,
  deleteGroupForward,
  deleteLine,
  deleteLineBoundaryBackward,
  deleteLineBoundaryForward,
  deleteToLineEnd,
  indentLess,
  indentMore,
  indentSelection,
  insertNewlineAndIndent,
  insertTab,
  redo,
  redoSelection,
  selectAll,
  selectCharLeft,
  selectCharRight,
  selectDocEnd,
  selectDocStart,
  selectGroupLeft,
  selectGroupRight,
  selectLineBoundaryBackward,
  selectLineBoundaryForward,
  selectLineBoundaryLeft,
  selectLineBoundaryRight,
  selectLineDown,
  selectLineEnd,
  selectLineStart,
  selectLineUp,
  selectPageDown,
  selectPageUp,
  splitLine,
  transposeChars,
  undo,
  undoSelection
} from "@codemirror/commands"
import {EditorSelection, StateEffect, StateField} from "@codemirror/state"
import {EditorView} from "@codemirror/view"

function selectedLines(state) {
  const numbers = new Set()
  const commentBlankLines = new Set()
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from)
    let endLine = state.doc.lineAt(range.to)
    if (!range.empty && range.to === endLine.from) endLine = state.doc.lineAt(range.to - 1)
    for (let number = startLine.number; number <= endLine.number; number++) numbers.add(number)
    if (startLine.number === endLine.number) commentBlankLines.add(startLine.number)
  }
  return {numbers: [...numbers].sort((a, b) => a - b), commentBlankLines}
}

function isCommentedLine(text) {
  return text.startsWith("( ") && text.endsWith(" )")
}

export function togglePuzzleScriptComment(view) {
  if (view.state.readOnly) return false
  const state = view.state
  const {numbers, commentBlankLines} = selectedLines(state)
  const nonblank = numbers.filter(number => /\S/.test(state.doc.line(number).text))
  const uncomment = nonblank.length > 0 &&
    nonblank.every(number => isCommentedLine(state.doc.line(number).text))
  const changes = []

  for (const number of numbers) {
    const line = state.doc.line(number)
    if (uncomment) {
      if (!isCommentedLine(line.text)) continue
      changes.push(
        {from: line.from, to: line.from + 2},
        {from: line.to - 2, to: line.to}
      )
    } else if (/\S/.test(line.text)) {
      changes.push({from: line.from, insert: "( "}, {from: line.to, insert: " )"})
    } else if (commentBlankLines.has(number)) {
      changes.push({from: line.from, insert: "(  )"})
    }
  }

  if (changes.length === 0) return false
  const changeSet = state.changes(changes)
  const selection = EditorSelection.create(state.selection.ranges.map(range =>
    EditorSelection.range(
      changeSet.mapPos(range.anchor, 1),
      changeSet.mapPos(range.head, 1)
    )), state.selection.mainIndex)
  view.dispatch(state.update({
    changes: changeSet,
    selection,
    scrollIntoView: true,
    userEvent: "input.comment"
  }))
  return true
}

function inclusiveSelectedLineBlocks(state) {
  const blocks = []
  let upto = -1
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from)
    const endLine = state.doc.lineAt(range.to)
    if (upto >= startLine.number) {
      const previous = blocks[blocks.length - 1]
      previous.to = Math.max(previous.to, endLine.to)
      previous.endLine = Math.max(previous.endLine, endLine.number)
      previous.ranges.push(range)
    } else {
      blocks.push({
        from: startLine.from,
        to: endLine.to,
        startLine: startLine.number,
        endLine: endLine.number,
        ranges: [range]
      })
    }
    upto = endLine.number + 1
  }
  return blocks
}

function movePuzzleScriptLines(view, forward) {
  const state = view.state
  if (state.readOnly) return false
  const changes = []
  const deltas = new Map()

  for (const block of inclusiveSelectedLineBlocks(state)) {
    if (forward ? block.to === state.doc.length : block.from === 0) continue
    const adjacent = state.doc.lineAt(forward ? block.to + 1 : block.from - 1)
    const delta = adjacent.length + 1
    if (forward) {
      changes.push(
        {from: block.to, to: adjacent.to},
        {from: block.from, insert: adjacent.text + state.lineBreak}
      )
    } else {
      changes.push(
        {from: adjacent.from, to: block.from},
        {from: block.to, insert: state.lineBreak + adjacent.text}
      )
    }
    for (const range of block.ranges) deltas.set(range, forward ? delta : -delta)
  }

  if (changes.length === 0) return false
  const changeSet = state.changes(changes)
  const ranges = state.selection.ranges.map(range => {
    const delta = deltas.get(range)
    if (delta === undefined) return range.map(changeSet)
    return EditorSelection.range(
      Math.max(0, Math.min(state.doc.length, range.anchor + delta)),
      Math.max(0, Math.min(state.doc.length, range.head + delta))
    )
  })
  view.dispatch(state.update({
    changes: changeSet,
    selection: EditorSelection.create(ranges, state.selection.mainIndex),
    scrollIntoView: true,
    userEvent: "move.line"
  }))
  return true
}

export const movePuzzleScriptLineUp = view => movePuzzleScriptLines(view, false)
export const movePuzzleScriptLineDown = view => movePuzzleScriptLines(view, true)

function defaultTab(view) {
  return view.state.selection.ranges.some(range => !range.empty) ? indentMore(view) : insertTab(view)
}

export const setOverwriteMode = StateEffect.define()
export const overwriteMode = StateField.define({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setOverwriteMode)) value = effect.value
    }
    return value
  }
})

export function togglePuzzleScriptOverwrite(view) {
  view.dispatch({effects: setOverwriteMode.of(!view.state.field(overwriteMode))})
  return true
}

const overwriteInput = EditorView.inputHandler.of((view, _from, _to, text) => {
  if (!view.state.field(overwriteMode) || /[\r\n]/.test(text) ||
      view.state.selection.ranges.some(range => !range.empty)) return false
  const changes = view.state.changeByRange(range => {
    const line = view.state.doc.lineAt(range.from)
    const to = Math.min(line.to, range.from + text.length)
    return {
      changes: {from: range.from, to, insert: text},
      range: EditorSelection.cursor(range.from + text.length)
    }
  })
  view.dispatch(view.state.update(changes, {scrollIntoView: true, userEvent: "input.type"}))
  return true
})

export const puzzleScriptCommandExtensions = [overwriteMode, overwriteInput]

export const puzzleScriptKeymap = Object.freeze([
  {key: "Ctrl-/", run: togglePuzzleScriptComment},
  {key: "Meta-/", run: togglePuzzleScriptComment},
  {key: "Shift-Ctrl-ArrowUp", run: movePuzzleScriptLineUp},
  {key: "Shift-Ctrl-ArrowDown", run: movePuzzleScriptLineDown}
])

export const puzzleScriptCoreKeymap = Object.freeze([
  {win: "Ctrl-a", linux: "Ctrl-a", mac: "Meta-a", run: selectAll},
  {win: "Ctrl-d", linux: "Ctrl-d", mac: "Meta-d", run: deleteLine},
  {win: "Ctrl-z", linux: "Ctrl-z", mac: "Meta-z", run: undo},
  {win: "Shift-Ctrl-z", linux: "Shift-Ctrl-z", mac: "Shift-Meta-z", run: redo},
  {win: "Ctrl-y", linux: "Ctrl-y", mac: "Meta-y", run: redo},
  {win: "Ctrl-Home", linux: "Ctrl-Home", mac: "Meta-Home", run: cursorDocStart, shift: selectDocStart},
  {mac: "Meta-ArrowUp", run: cursorDocStart, shift: selectDocStart},
  {win: "Ctrl-End", linux: "Ctrl-End", mac: "Meta-End", run: cursorDocEnd, shift: selectDocEnd},
  {mac: "Meta-ArrowDown", run: cursorDocEnd, shift: selectDocEnd},
  {win: "Ctrl-ArrowUp", linux: "Ctrl-ArrowUp", run: cursorLineUp, shift: selectLineUp},
  {mac: "Ctrl-ArrowUp", run: cursorDocStart, shift: selectDocStart},
  {win: "Ctrl-ArrowDown", linux: "Ctrl-ArrowDown", run: cursorLineDown, shift: selectLineDown},
  {mac: "Ctrl-ArrowDown", run: cursorDocEnd, shift: selectDocEnd},
  {win: "Ctrl-ArrowLeft", linux: "Ctrl-ArrowLeft", mac: "Alt-ArrowLeft", run: cursorGroupLeft, shift: selectGroupLeft},
  {win: "Ctrl-ArrowRight", linux: "Ctrl-ArrowRight", mac: "Alt-ArrowRight", run: cursorGroupRight, shift: selectGroupRight},
  {win: "Alt-ArrowLeft", linux: "Alt-ArrowLeft", mac: "Meta-ArrowLeft", run: cursorLineBoundaryLeft, shift: selectLineBoundaryLeft},
  {win: "Alt-ArrowRight", linux: "Alt-ArrowRight", mac: "Meta-ArrowRight", run: cursorLineBoundaryRight, shift: selectLineBoundaryRight},
  {win: "Ctrl-Backspace", linux: "Ctrl-Backspace", mac: "Alt-Backspace", run: deleteGroupBackward},
  {mac: "Ctrl-Alt-Backspace", run: deleteGroupForward},
  {win: "Ctrl-Delete", linux: "Ctrl-Delete", mac: "Alt-Delete", run: deleteGroupForward},
  {win: "Ctrl-[", linux: "Ctrl-[", mac: "Meta-[", run: indentLess},
  {win: "Ctrl-]", linux: "Ctrl-]", mac: "Meta-]", run: indentMore},
  {win: "Ctrl-u", linux: "Ctrl-u", mac: "Meta-u", run: undoSelection, preventDefault: true},
  {win: "Shift-Ctrl-u", linux: "Shift-Ctrl-u", mac: "Shift-Meta-u", run: redoSelection, preventDefault: true},
  {win: "Alt-u", linux: "Alt-u", run: redoSelection, preventDefault: true},
  {key: "ArrowLeft", run: cursorCharLeft, shift: selectCharLeft, preventDefault: true},
  {key: "ArrowRight", run: cursorCharRight, shift: selectCharRight, preventDefault: true},
  {key: "ArrowUp", run: cursorLineUp, shift: selectLineUp, preventDefault: true},
  {key: "ArrowDown", run: cursorLineDown, shift: selectLineDown, preventDefault: true},
  {key: "End", run: cursorLineBoundaryForward, shift: selectLineBoundaryForward, preventDefault: true},
  {key: "Home", run: cursorLineBoundaryBackward, shift: selectLineBoundaryBackward, preventDefault: true},
  {key: "PageUp", run: cursorPageUp, shift: selectPageUp},
  {key: "PageDown", run: cursorPageDown, shift: selectPageDown},
  {key: "Delete", run: deleteCharForward, preventDefault: true},
  {key: "Backspace", run: deleteCharBackward, preventDefault: true},
  {key: "Shift-Backspace", run: deleteCharBackward, preventDefault: true},
  {key: "Tab", run: defaultTab},
  {key: "Shift-Tab", run: indentSelection},
  {key: "Enter", run: insertNewlineAndIndent},
  {key: "Insert", run: togglePuzzleScriptOverwrite},
  {mac: "Ctrl-f", run: cursorCharRight, shift: selectCharRight},
  {mac: "Ctrl-b", run: cursorCharLeft, shift: selectCharLeft},
  {mac: "Ctrl-p", run: cursorLineUp, shift: selectLineUp},
  {mac: "Ctrl-n", run: cursorLineDown, shift: selectLineDown},
  {mac: "Ctrl-a", run: cursorLineStart, shift: selectLineStart},
  {mac: "Ctrl-e", run: cursorLineEnd, shift: selectLineEnd},
  {mac: "Ctrl-v", run: cursorPageDown, shift: cursorPageUp},
  {mac: "Shift-Ctrl-v", run: cursorPageUp},
  {mac: "Ctrl-d", run: deleteCharForward},
  {mac: "Ctrl-h", run: deleteCharBackward},
  {mac: "Ctrl-k", run: deleteToLineEnd},
  {mac: "Ctrl-t", run: transposeChars},
  {mac: "Ctrl-o", run: splitLine},
  {mac: "Meta-Backspace", run: deleteLineBoundaryBackward},
  {mac: "Meta-Delete", run: deleteLineBoundaryForward}
])
