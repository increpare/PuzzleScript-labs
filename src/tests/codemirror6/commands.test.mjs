import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {test} from "node:test"

import {history, undo} from "@codemirror/commands"
import {EditorSelection, EditorState} from "@codemirror/state"

import {
  movePuzzleScriptLineDown,
  movePuzzleScriptLineUp,
  overwriteMode,
  puzzleScriptCommandExtensions,
  puzzleScriptCoreKeymap,
  puzzleScriptKeymap,
  togglePuzzleScriptComment,
  togglePuzzleScriptOverwrite
} from "../../js/codemirror6/commands.js"
import {puzzleScriptCompletionKeymap} from "../../js/codemirror6/autocomplete.js"
import {puzzleScriptSearchKeymap} from "../../js/codemirror6/search.js"

const shortcuts = JSON.parse(await readFile(
  new URL("./baselines/cm5/shortcuts.json", import.meta.url),
  "utf8"
))

function offset(doc, line, ch) {
  const value = doc.line(Math.max(1, Math.min(doc.lines, line + 1)))
  return value.from + Math.max(0, Math.min(value.length, ch))
}

function createView(doc, ranges) {
  const base = EditorState.create({doc})
  const selection = EditorSelection.create(ranges.map(({anchor, head}) =>
    EditorSelection.range(offset(base.doc, anchor.line, anchor.ch), offset(base.doc, head.line, head.ch))))
  const view = {
    state: EditorState.create({
      doc,
      selection,
      extensions: [history(), EditorState.allowMultipleSelections.of(true)]
    }),
    dispatch: null,
    lineWrapping: false,
    moveVertically(range, forward) {
      const line = this.state.doc.lineAt(range.head)
      const targetNumber = Math.max(1, Math.min(
        this.state.doc.lines,
        line.number + (forward ? 1 : -1)
      ))
      const target = this.state.doc.line(targetNumber)
      return EditorSelection.cursor(target.from + Math.min(target.length, range.head - line.from))
    }
  }
  view.dispatch = transaction => {
    view.state = transaction && transaction.state
      ? transaction.state
      : view.state.update(transaction).state
  }
  return view
}

function point(doc, position) {
  const line = doc.lineAt(position)
  return {line: line.number - 1, ch: position - line.from}
}

function snapshot(view) {
  return {
    value: view.state.doc.toString(),
    selections: view.state.selection.ranges.map(range => ({
      anchor: point(view.state.doc, range.anchor),
      head: point(view.state.doc, range.head)
    }))
  }
}

function run(command, doc, ranges) {
  const view = createView(doc, ranges)
  const handled = command(view)
  const after = snapshot(view)
  const undone = undo(view)
  return {handled, after, undone, undo: snapshot(view)}
}

const cursor = (line, ch) => ({anchor: {line, ch}, head: {line, ch}})
const selection = (anchorLine, anchorCh, headLine, headCh) => ({
  anchor: {line: anchorLine, ch: anchorCh},
  head: {line: headLine, ch: headCh}
})

function coreCommand(key, platform = "pc") {
  const property = platform === "mac" ? "mac" : "win"
  const binding = puzzleScriptCoreKeymap.find(candidate =>
    (candidate[property] || candidate.key) === key)
  assert.ok(binding, `missing ${platform} ${key} binding`)
  return binding.run
}

function editingSnapshot(outcome) {
  return {
    value: outcome.value,
    selections: outcome.selections
  }
}

test("Shift-Tab preserves the frozen CM5 indentAuto behavior", () => {
  const fixtures = [
    {
      name: "cursor on first line",
      doc: "  alpha\nbeta",
      ranges: [cursor(0, 1)]
    },
    {
      name: "cursor copies previous indentation",
      doc: "  alpha\nbeta",
      ranges: [cursor(1, 2)]
    },
    {
      name: "cursor on blank line copies previous indentation",
      doc: "  alpha\n\nbeta",
      ranges: [cursor(1, 0)]
    },
    {
      name: "multiline selection leaves blank lines empty",
      doc: "  alpha\nbeta\n\n    gamma\nomega",
      ranges: [selection(1, 0, 4, 0)]
    }
  ]

  for (const fixture of fixtures) {
    const expected = editingSnapshot(
      shortcuts.pc.compatibilityOutcomes.indentAuto[fixture.name]
    )
    const actual = run(coreCommand("Shift-Tab"), fixture.doc, fixture.ranges)
    assert.equal(actual.handled, true, fixture.name)
    assert.deepEqual(actual.after, expected, fixture.name)
  }
})

test("Ctrl/Cmd-D preserves CM5 whole-line deletion and selection collapse", () => {
  const fixtures = [
    {
      name: "cursor on first line",
      doc: "first\nmiddle\nlast",
      ranges: [cursor(0, 2)]
    },
    {
      name: "cursor on middle line",
      doc: "first\nmiddle\nlast",
      ranges: [cursor(1, 3)]
    },
    {
      name: "cursor on last line",
      doc: "first\nmiddle\nlast",
      ranges: [cursor(2, 2)]
    },
    {
      name: "selection ending at next line column zero includes that line",
      doc: "first\nmiddle\nlast",
      ranges: [selection(0, 2, 1, 0)]
    },
    {
      name: "backward multiline selection",
      doc: "first\nmiddle\nlast\nafter",
      ranges: [selection(2, 2, 1, 3)]
    }
  ]

  for (const platform of ["pc", "mac"]) {
    const key = platform === "mac" ? "Meta-d" : "Ctrl-d"
    for (const fixture of fixtures) {
      const expected = editingSnapshot(
        shortcuts[platform].compatibilityOutcomes.deleteLine[fixture.name]
      )
      const actual = run(coreCommand(key, platform), fixture.doc, fixture.ranges)
      assert.equal(actual.handled, true, `${platform}: ${fixture.name}`)
      assert.deepEqual(actual.after, expected, `${platform}: ${fixture.name}`)
    }
  }
})

test("per-line comments preserve the captured CM5 text and selection geometry", () => {
  const cases = [
    {
      name: "cursor",
      doc: "alpha\nbeta",
      ranges: [cursor(0, 2)],
      value: "( alpha )\nbeta",
      rangesAfter: [cursor(0, 4)]
    },
    {
      name: "partial selection",
      doc: "alpha\nbeta",
      ranges: [selection(0, 2, 1, 2)],
      value: "( alpha )\n( beta )",
      rangesAfter: [selection(0, 4, 1, 4)]
    },
    {
      name: "whole lines ending at column zero",
      doc: "alpha\nbeta\ngamma",
      ranges: [selection(0, 0, 2, 0)],
      value: "( alpha )\n( beta )\ngamma",
      rangesAfter: [selection(0, 2, 2, 0)]
    },
    {
      name: "blank cursor line",
      doc: "alpha\n\nbeta",
      ranges: [cursor(1, 0)],
      value: "alpha\n(  )\nbeta",
      rangesAfter: [cursor(1, 4)]
    },
    {
      name: "blank line in a larger selection",
      doc: "alpha\n\nbeta",
      ranges: [selection(0, 0, 2, 4)],
      value: "( alpha )\n\n( beta )",
      rangesAfter: [selection(0, 2, 2, 8)]
    },
    {
      name: "backward uncomment selection",
      doc: "( alpha )\n( beta )",
      ranges: [selection(1, 8, 0, 0)],
      value: "alpha\nbeta",
      rangesAfter: [selection(1, 4, 0, 0)]
    },
    {
      name: "programmatic multiple cursors",
      doc: "alpha\nbeta\ngamma",
      ranges: [cursor(0, 1), cursor(2, 2)],
      value: "( alpha )\nbeta\n( gamma )",
      rangesAfter: [cursor(0, 3), cursor(2, 4)]
    }
  ]

  for (const fixture of cases) {
    const actual = run(togglePuzzleScriptComment, fixture.doc, fixture.ranges)
    assert.equal(actual.handled, true, fixture.name)
    assert.deepEqual(actual.after, {value: fixture.value, selections: fixture.rangesAfter}, fixture.name)
    assert.equal(actual.undone, true, fixture.name)
    assert.deepEqual(actual.undo, {value: fixture.doc, selections: fixture.ranges}, fixture.name)
  }
})

test("line movement preserves CM5's inclusive end-at-column-zero behavior and one-step undo", () => {
  const cases = [
    {
      name: "cursor up",
      command: movePuzzleScriptLineUp,
      doc: "alpha\nbeta\ngamma",
      ranges: [cursor(1, 2)],
      value: "beta\nalpha\ngamma",
      rangesAfter: [cursor(0, 2)]
    },
    {
      name: "partial selection down",
      command: movePuzzleScriptLineDown,
      doc: "alpha\nbeta\ngamma\ndelta",
      ranges: [selection(1, 2, 2, 3)],
      value: "alpha\ndelta\nbeta\ngamma",
      rangesAfter: [selection(2, 2, 3, 3)]
    },
    {
      name: "whole selection ending at zero moves the final line too",
      command: movePuzzleScriptLineUp,
      doc: "alpha\nbeta\ngamma\ndelta",
      ranges: [selection(1, 0, 3, 0)],
      value: "beta\ngamma\ndelta\nalpha",
      rangesAfter: [selection(0, 0, 2, 0)]
    },
    {
      name: "backward selection down",
      command: movePuzzleScriptLineDown,
      doc: "alpha\nbeta\ngamma\ndelta",
      ranges: [selection(2, 3, 1, 2)],
      value: "alpha\ndelta\nbeta\ngamma",
      rangesAfter: [selection(3, 3, 2, 2)]
    }
  ]

  for (const fixture of cases) {
    const actual = run(fixture.command, fixture.doc, fixture.ranges)
    assert.equal(actual.handled, true, fixture.name)
    assert.deepEqual(actual.after, {value: fixture.value, selections: fixture.rangesAfter}, fixture.name)
    assert.equal(actual.undone, true, fixture.name)
    assert.deepEqual(actual.undo, {value: fixture.doc, selections: fixture.ranges}, fixture.name)
  }

  for (const fixture of [
    {command: movePuzzleScriptLineUp, ranges: [cursor(0, 2)]},
    {command: movePuzzleScriptLineDown, ranges: [cursor(1, 2)]}
  ]) {
    const actual = run(fixture.command, "alpha\nbeta", fixture.ranges)
    assert.equal(actual.handled, false)
    assert.equal(actual.undone, false)
    assert.deepEqual(actual.after, actual.undo)
  }
})

test("Insert toggles an explicit overwrite state without changing the document", () => {
  const view = createView("alpha", [cursor(0, 2)])
  view.state = EditorState.create({
    doc: view.state.doc,
    selection: view.state.selection,
    extensions: [history(), ...puzzleScriptCommandExtensions]
  })
  assert.equal(view.state.field(overwriteMode), false)
  assert.equal(togglePuzzleScriptOverwrite(view), true)
  assert.equal(view.state.field(overwriteMode), true)
  assert.equal(view.state.doc.toString(), "alpha")
  assert.equal(togglePuzzleScriptOverwrite(view), true)
  assert.equal(view.state.field(overwriteMode), false)
})

function normalizeKey(key, platform) {
  return key
    .replace(/Mod-/g, platform === "mac" ? "Cmd-" : "Ctrl-")
    .replace(/Meta-/g, "Cmd-")
    .replace(/Arrow/g, "")
    .replace(/^Escape$/, "Esc")
    .replace(/-([a-z])$/g, (_, letter) => "-" + letter.toUpperCase())
}

function effectiveBindingNames(bindings, platform) {
  const property = platform === "mac" ? "mac" : platform === "pc" ? "win" : "linux"
  const seen = new Set()
  const names = []
  for (const binding of bindings) {
    const key = binding[property] || binding.key
    if (!key) continue
    const name = normalizeKey(key, platform)
    if (!seen.has(name)) {
      seen.add(name)
      names.push(name)
    }
  }
  return names
}

test("the assembled keymaps contain exactly the frozen CM5 binding names", () => {
  const assembled = [
    ...puzzleScriptKeymap,
    ...puzzleScriptSearchKeymap,
    ...puzzleScriptCoreKeymap
  ]
  for (const platform of ["pc", "mac"]) {
    assert.deepEqual(
      effectiveBindingNames(assembled, platform).sort(),
      [...shortcuts[platform].effectiveBindingNames].sort()
    )
    assert.deepEqual(
      effectiveBindingNames(puzzleScriptCompletionKeymap, platform).sort(),
      [...shortcuts[platform].popupBindingNames].sort()
    )
  }
  const serialized = JSON.stringify(assembled.map(({key, mac, win, linux}) => ({key, mac, win, linux})))
  for (const forbidden of ["Mod-s", "Mod-Enter", "Shift-Mod-Enter", "Mod-j", "Mod-k", "Ctrl-Space", "F3", "Mod-d"]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must remain unbound`)
  }
})
