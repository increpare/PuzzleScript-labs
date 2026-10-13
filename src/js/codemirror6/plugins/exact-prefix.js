(function(host) {
"use strict"

const {
  ensureSyntaxTree,
  StateEffect,
  StateField,
  syntaxTree,
  syntaxTreeAvailable,
  ViewPlugin
} = host.requireRuntime([
  "ensureSyntaxTree",
  "StateEffect",
  "StateField",
  "syntaxTree",
  "syntaxTreeAvailable",
  "ViewPlugin"
])

const setExactPrefix = StateEffect.define()

function earliestChangedPosition(transaction) {
  let earliest = transaction.startState.doc.length
  transaction.changes.iterChanges(fromA => { earliest = Math.min(earliest, fromA) })
  return earliest
}

const exactPrefix = StateField.define({
  create: () => 0,
  update(value, transaction) {
    if (transaction.docChanged) {
      const changedLine = transaction.startState.doc.lineAt(earliestChangedPosition(transaction))
      value = Math.min(value, changedLine.from)
    }
    for (const effect of transaction.effects) {
      if (effect.is(setExactPrefix)) {
        value = Math.max(value, Math.min(effect.value, transaction.newDoc.length))
      }
    }
    return value
  }
})

function ensureExactPrefix(view, upto, timeout = 50) {
  const target = Math.min(Math.max(0, upto), view.state.doc.length)
  const current = view.state.field(exactPrefix, false) ?? -1
  if (current >= target && syntaxTreeAvailable(view.state, target)) return true
  const publishedTree = syntaxTree(view.state)
  const tree = ensureSyntaxTree(view.state, target, timeout)
  if (!tree || !syntaxTreeAvailable(view.state, target)) return false
  if (target > (view.state.field(exactPrefix, false) ?? -1)) {
    view.dispatch({effects: setExactPrefix.of(target)})
  } else if (tree !== publishedTree) {
    view.dispatch({})
  }
  return true
}

function requestIdle(callback) {
  if (typeof globalThis.requestIdleCallback === "function") {
    return {kind: "idle", handle: globalThis.requestIdleCallback(callback)}
  }
  return {kind: "timeout", handle: globalThis.setTimeout(callback, 0)}
}

function cancelIdle(pending) {
  if (!pending) return
  if (pending.kind === "idle" && typeof globalThis.cancelIdleCallback === "function") {
    globalThis.cancelIdleCallback(pending.handle)
  } else {
    globalThis.clearTimeout(pending.handle)
  }
}

class ExactPrefixScheduler {
  constructor(view) {
    this.view = view
    this.pending = null
    this.destroyed = false
    this.schedule()
  }

  schedule() {
    if (this.destroyed || this.pending) return
    this.pending = requestIdle(() => {
      this.pending = null
      if (this.destroyed) return
      if (!ensureExactPrefix(this.view, this.view.viewport.to, 25)) this.schedule()
    })
  }

  update(update) {
    this.view = update.view
    if (update.docChanged || update.viewportChanged) this.schedule()
  }

  destroy() {
    this.destroyed = true
    cancelIdle(this.pending)
    this.pending = null
  }
}

const exactPrefixScheduler = ViewPlugin.fromClass(ExactPrefixScheduler)
const exactPrefixExtensions = [exactPrefix, exactPrefixScheduler]

host.define("exact-prefix", {
  ensureExactPrefix,
  exactPrefix,
  ExactPrefixScheduler,
  exactPrefixExtensions,
  exactPrefixScheduler,
  setExactPrefix
})
})(globalThis.PuzzleScriptCM6Plugins)
