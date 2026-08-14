import {ensureSyntaxTree, syntaxTreeAvailable} from "@codemirror/language"
import {StateEffect, StateField} from "@codemirror/state"
import {ViewPlugin} from "@codemirror/view"

export const setExactPrefix = StateEffect.define()

export const exactPrefix = StateField.define({
  create: () => 0,
  update(value, transaction) {
    if (transaction.docChanged) value = 0
    for (const effect of transaction.effects) {
      if (effect.is(setExactPrefix)) value = Math.max(value, effect.value)
    }
    return value
  }
})

export function ensureExactPrefix(view, upto, timeout = 50) {
  const target = Math.min(Math.max(0, upto), view.state.doc.length)
  const tree = ensureSyntaxTree(view.state, target, timeout)
  if (!tree || !syntaxTreeAvailable(view.state, target)) return false
  view.dispatch({effects: setExactPrefix.of(target)})
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

export class ExactPrefixScheduler {
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

export const exactPrefixScheduler = ViewPlugin.fromClass(ExactPrefixScheduler)
export const exactPrefixExtensions = [exactPrefix, exactPrefixScheduler]
