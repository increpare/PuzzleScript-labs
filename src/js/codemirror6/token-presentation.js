import {syntaxTree} from "@codemirror/language"
import {Decoration, ViewPlugin} from "@codemirror/view"

import {styleFromHexCode} from "./dynamic-colors.js"
import {exactPrefix} from "./exact-prefix.js"
import {decodeStyleToken, isStyleToken} from "./style-token.js"

export function classesForStyle(style) {
  return style.split(/\s+/).filter(Boolean).map(name => "cm-" + name)
}

export function dynamicHexForStyle(style) {
  const match = style.match(/(?:^MULTICOLOR|(?:^|\s)COLOR-)(#[0-9a-fA-F]{3,8})(?:\s|$)/)
  return match ? match[1] : null
}

export function presentationClasses(style) {
  return style.startsWith("MULTICOLOR#") ? ["cm-COLOR"] : classesForStyle(style)
}

export function buildTokenDecorations(view) {
  const visibleEnd = Math.max(...view.visibleRanges.map(range => range.to))
  if (view.state.field(exactPrefix) < visibleEnd) return Decoration.none

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

        const style = decodeStyleToken(node.name)
        const mark = {class: presentationClasses(style).join(" ")}
        const dynamicHex = dynamicHexForStyle(style)
        if (dynamicHex) mark.attributes = {style: styleFromHexCode(dynamicHex)}
        decorations.push(Decoration.mark(mark).range(node.from, node.to))
      }
    })
  }
  return Decoration.set(decorations, true)
}

export function updateTokenDecorations(update, previous) {
  const visibleEnd = Math.max(...update.view.visibleRanges.map(range => range.to))
  if (update.view.state.field(exactPrefix) >= visibleEnd) {
    return buildTokenDecorations(update.view)
  }
  return update.docChanged ? previous.map(update.changes) : previous
}

const tokenPresentationPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = buildTokenDecorations(view)
  }

  update(update) {
    this.decorations = updateTokenDecorations(update, this.decorations)
  }
}, {
  decorations: value => value.decorations
})

export function tokenPresentation() {
  return tokenPresentationPlugin
}
