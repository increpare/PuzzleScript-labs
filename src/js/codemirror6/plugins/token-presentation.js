(function(host) {
"use strict"

const {Decoration, syntaxTree, syntaxTreeAvailable, ViewPlugin} = host.requireRuntime([
  "Decoration",
  "syntaxTree",
  "syntaxTreeAvailable",
  "ViewPlugin"
])
const {styleFromHexCode} = host.require("dynamic-colors")
const {exactPrefix} = host.require("exact-prefix")
const {decodeStyleToken, isStyleToken} = host.require("style-token")

function classesForStyle(style) {
  return style.split(/\s+/).filter(Boolean).map(name => "cm-" + name)
}

function dynamicHexForStyle(style) {
  const match = style.match(/(?:^MULTICOLOR|(?:^|\s)COLOR-)(#[0-9a-fA-F]{3,8})(?:\s|$)/)
  return match ? match[1] : null
}

function presentationClasses(style) {
  return style.startsWith("MULTICOLOR#") ? ["cm-COLOR"] : classesForStyle(style)
}

function visibleRanges(view) {
  return view.visibleRanges.map(range => ({from: range.from, to: range.to}))
}

function visibleEnd(view) {
  return view.visibleRanges.reduce((end, range) => Math.max(end, range.to), 0)
}

function exactTreeAvailable(view) {
  const end = visibleEnd(view)
  return view.state.field(exactPrefix) >= end && syntaxTreeAvailable(view.state, end)
}

function cachedPresentation(name, cache) {
  let presentation = cache.get(name)
  if (presentation) return presentation

  const style = decodeStyleToken(name)
  const classes = presentationClasses(style)
  const dynamicHex = dynamicHexForStyle(style)
  const mark = {class: classes.join(" ")}
  if (dynamicHex) mark.attributes = {style: styleFromHexCode(dynamicHex)}
  presentation = {
    style,
    classes,
    dynamicHex,
    decoration: Decoration.mark(mark)
  }
  cache.set(name, presentation)
  return presentation
}

function buildTokenDecorations(view, cache = new Map()) {
  const end = visibleEnd(view)
  if (view.state.field(exactPrefix) < end ||
      !syntaxTreeAvailable(view.state, end)) return Decoration.none

  const decorations = []
  const seen = new Set()
  const tree = syntaxTree(view.state)
  for (const visible of view.visibleRanges) {
    tree.iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        if (!isStyleToken(node.name)) return
        const key = `${node.from}:${node.to}:${node.name}`
        if (seen.has(key)) return
        seen.add(key)

        const presentation = cachedPresentation(node.name, cache)
        decorations.push(presentation.decoration.range(node.from, node.to))
      }
    })
  }
  return Decoration.set(decorations, true)
}

function mappedVisibleRanges(ranges, changes) {
  return ranges.map(range => {
    const from = changes.mapPos(range.from, 1)
    const to = changes.mapPos(range.to, -1)
    return from <= to ? {from, to} : {from: to, to}
  })
}

function rangesCover(coveredRanges, requestedRanges) {
  const covered = coveredRanges.slice().sort((left, right) =>
    left.from - right.from || left.to - right.to)
  return requestedRanges.every(requested => {
    if (requested.from === requested.to) return true
    let position = requested.from
    for (const range of covered) {
      if (range.to <= position) continue
      if (range.from > position) return false
      position = Math.max(position, range.to)
      if (position >= requested.to) return true
    }
    return false
  })
}

function updateReconfigured(update) {
  return Boolean(update.reconfigured) ||
    (update.transactions ?? []).some(transaction => transaction.reconfigured)
}

function defaultContext(update, previous) {
  return {
    cache: new Map(),
    coveredRanges: visibleRanges(update.view),
    exactPrefix: update.view.state.field(exactPrefix),
    hasExactSet: previous !== Decoration.none,
    needsRebuild: false,
    viewportNeedsRebuild: false
  }
}

function updateTokenDecorations(update, previous, suppliedContext) {
  const context = suppliedContext ?? defaultContext(update, previous)
  const prefix = update.view.state.field(exactPrefix)

  if (update.docChanged) {
    const mapped = previous.map(update.changes)
    if (suppliedContext) {
      context.coveredRanges = mappedVisibleRanges(context.coveredRanges, update.changes)
      if (update.viewportMoved) {
        context.viewportNeedsRebuild = !rangesCover(
          context.coveredRanges, visibleRanges(update.view))
      }
    }
    context.exactPrefix = prefix
    if (updateReconfigured(update)) context.needsRebuild = true
    return mapped
  }

  const requestedRanges = visibleRanges(update.view)
  const end = visibleEnd(update.view)
  const exactPrefixCovered = prefix > context.exactPrefix &&
    context.exactPrefix < end && prefix >= end
  const uncoveredText = Boolean(update.viewportMoved) &&
    !rangesCover(context.coveredRanges, requestedRanges)
  if (update.viewportMoved) context.viewportNeedsRebuild = uncoveredText
  context.needsRebuild ||= !context.hasExactSet || exactPrefixCovered ||
    updateReconfigured(update)
  context.exactPrefix = prefix

  if ((!context.needsRebuild && !context.viewportNeedsRebuild) ||
      !exactTreeAvailable(update.view)) return previous

  const decorations = buildTokenDecorations(update.view, context.cache)
  context.coveredRanges = requestedRanges
  context.hasExactSet = true
  context.needsRebuild = false
  context.viewportNeedsRebuild = false
  return decorations
}

class TokenPresentationPlugin {
  constructor(view) {
    this.view = view
    this.pendingFollowup = null
    this.destroyed = false
    this.presentation = {
      cache: new Map(),
      coveredRanges: [],
      exactPrefix: view.state.field(exactPrefix),
      hasExactSet: false,
      needsRebuild: false,
      viewportNeedsRebuild: false
    }
    if (exactTreeAvailable(view)) {
      this.decorations = buildTokenDecorations(view, this.presentation.cache)
      this.presentation.coveredRanges = visibleRanges(view)
      this.presentation.hasExactSet = true
    } else {
      this.decorations = Decoration.none
    }
  }

  update(update) {
    this.view = update.view
    this.decorations = updateTokenDecorations(
      update, this.decorations, this.presentation)

    if (updateReconfigured(update)) this.cancelFollowup()
    if (!this.presentation.needsRebuild &&
        !this.presentation.viewportNeedsRebuild) {
      this.cancelFollowup()
    } else if (update.docChanged && exactTreeAvailable(update.view)) {
      this.scheduleFollowup()
    }
  }

  scheduleFollowup() {
    if (this.destroyed || this.pendingFollowup !== null) return
    this.pendingFollowup = globalThis.setTimeout(() => {
      this.pendingFollowup = null
      if (this.destroyed ||
          (!this.presentation.needsRebuild &&
            !this.presentation.viewportNeedsRebuild) ||
          !exactTreeAvailable(this.view)) return
      this.view.dispatch({})
    }, 0)
  }

  cancelFollowup() {
    if (this.pendingFollowup === null) return
    globalThis.clearTimeout(this.pendingFollowup)
    this.pendingFollowup = null
  }

  destroy() {
    this.destroyed = true
    this.cancelFollowup()
  }
}

const tokenPresentationPlugin = ViewPlugin.fromClass(TokenPresentationPlugin, {
  decorations: value => value.decorations
})

function tokenPresentation() {
  return tokenPresentationPlugin
}

host.define("token-presentation", {
  buildTokenDecorations,
  classesForStyle,
  dynamicHexForStyle,
  presentationClasses,
  tokenPresentation,
  updateTokenDecorations
})
})(globalThis.PuzzleScriptCM6Plugins)
