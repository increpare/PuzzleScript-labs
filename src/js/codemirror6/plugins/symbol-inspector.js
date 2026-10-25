(function(host) {
"use strict"

const {
  closeHoverTooltips, EditorView, hoverTooltip, keymap, showPanel, StateEffect, StateField, tooltips
} = host.requireRuntime([
  "closeHoverTooltips", "EditorView", "hoverTooltip", "keymap", "showPanel", "StateEffect", "StateField", "tooltips"
])
const {ensureExactPrefix} = host.require("exact-prefix")
const {puzzleScriptTokenAtPosition} = host.require("interactions")
const {buildSymbolIndex, inspectSymbol} = host.require("symbol-info")

const setInspectedSymbol = StateEffect.define()
const indexes = new WeakMap()

function indexFor(view) {
  const doc = view.state.doc
  let index = indexes.get(doc)
  if (!index) {
    index = buildSymbolIndex(doc, codeMirrorFn(), {
      palettes: typeof colorPalettes === "undefined" ? {} : colorPalettes,
      paletteAliases: typeof colorPalettesAliases === "undefined" ? {} : colorPalettesAliases
    })
    indexes.set(doc, index)
  }
  return index
}

function element(document, tag, className, text) {
  const dom = document.createElement(tag)
  if (className) dom.className = className
  if (text !== undefined) dom.textContent = text
  return dom
}

function button(document, text, action, className = "", label = text) {
  const dom = element(document, "button", className, text)
  dom.type = "button"
  dom.setAttribute("aria-label", label)
  dom.addEventListener("click", action)
  return dom
}

function effectiveKind(index, symbol) {
  const seen = new Set()
  while (symbol.kind === "alias" && symbol.members.length === 1 && !seen.has(symbol.name)) {
    seen.add(symbol.name)
    const referent = index.symbols.get(symbol.members[0])
    if (!referent) break
    symbol = referent
  }
  return symbol.kind
}

function spritePreview(document, index, symbol, size = 48) {
  const kind = effectiveKind(index, symbol)
  if (kind === "property") return null
  const objects = symbol.objects.map(name => index.symbols.get(name)).filter(object => object?.sprite)
    .sort((a, b) => (a.layer || 0) - (b.layer || 0))
  if (!objects.length) return null
  const canvas = element(document, "canvas", "ps-symbol-sprite")
  canvas.width = canvas.height = 5
  canvas.style.width = canvas.style.height = size + "px"
  canvas.setAttribute("role", "img")
  canvas.setAttribute("aria-label", symbol.label + (kind === "aggregate" ? " combined sprite" : " sprite"))
  const context = canvas.getContext("2d")
  for (const object of objects) {
    object.sprite.rows.slice(0, 5).forEach((row, y) => {
      for (let x = 0; x < Math.min(5, row.length); x++) {
        if (!/\d/.test(row[x])) continue
        const color = object.sprite.colors[Number(row[x])]
        if (!color || color === "transparent") continue
        context.fillStyle = color
        context.fillRect(x, y, 1, 1)
      }
    })
  }
  return canvas
}

function appendRuleList(document, parent, rules, navigate) {
  const list = element(document, "div", "ps-symbol-rules")
  parent.appendChild(list)
  let shown = 0
  const more = button(document, "", appendPage, "ps-symbol-more")
  function appendPage() {
    for (const rule of rules.slice(shown, shown + 30)) {
      list.appendChild(button(document, `${rule.line}: ${rule.text.trim()}`, () => navigate(rule),
        "ps-symbol-rule", `Go to rule on line ${rule.line}`))
    }
    shown = Math.min(rules.length, shown + 30)
    more.textContent = `Show ${Math.min(30, rules.length - shown)} more (${rules.length - shown} remaining)`
    if (shown < rules.length) parent.appendChild(more)
    else more.remove()
  }
  appendPage()
}

function renderCard(document, index, name, {pinned, pin, navigate, close}) {
  const root = element(document, "div", "ps-symbol-card")
  const info = inspectSymbol(index, name)
  if (!info) {
    const bar = element(document, "div", "ps-symbol-heading")
    bar.append(element(document, "h3", "", name),
      button(document, "×", close, "ps-symbol-close", "Close symbol inspector"))
    root.append(bar, element(document, "p", "", "This name is no longer declared in the current source."))
    return root
  }
  const symbol = info.symbol
  const heading = element(document, "div", "ps-symbol-heading")
  const preview = spritePreview(document, index, symbol)
  if (preview) heading.appendChild(preview)
  const title = element(document, "div", "ps-symbol-title")
  title.append(element(document, "span", "ps-symbol-kind", symbol.kind[0].toUpperCase() + symbol.kind.slice(1)),
    element(document, "h3", "", symbol.label))
  heading.append(title, pinned
    ? button(document, "×", close, "ps-symbol-close", "Close symbol inspector")
    : button(document, "Pin", () => pin(symbol.name), "ps-symbol-pin", "Pin inspector"))
  root.appendChild(heading)
  root.appendChild(button(document, `Declaration · line ${symbol.line}`, () => navigate(symbol), "ps-symbol-declaration"))
  if (info.collisionLayer) {
    const layer = info.collisionLayer
    const labels = layer.entities.map(entity => entity.label).join(", ")
    const link = button(document, "Layer: ", () => navigate(layer), "ps-symbol-layer",
      "Go to collision layer: " + labels)
    link.title = labels
    const containers = new Set(info.includedIn.map(entry => entry.symbol.name))
    function includesIndirectly(name) {
      const seen = new Set()
      while (!seen.has(name)) {
        if (containers.has(name)) return true
        seen.add(name)
        const entry = index.symbols.get(name)
        if (entry?.kind !== "alias" || entry.members.length !== 1) break
        name = entry.members[0]
      }
      return false
    }
    layer.entities.forEach((entity, i) => {
      if (i) link.appendChild(document.createTextNode(", "))
      const indirect = entity.name !== symbol.name && includesIndirectly(entity.name)
      const label = element(document, "span", indirect ? "ps-symbol-layer-indirect" : "", entity.label)
      if (indirect) label.title = "Includes " + symbol.label + " indirectly"
      link.appendChild(label)
    })
    root.appendChild(link)
  }
  if (symbol.kind !== "object") root.appendChild(element(document, "code", "ps-symbol-definition", symbol.definition.trim()))

  function nameLink(member) {
    return button(document, member.label, () => { pin(member.name, false); navigate(member) },
      "ps-symbol-name", "Inspect " + member.label)
  }

  if (info.members.length) {
    const members = element(document, "div", "ps-symbol-members")
    const shown = pinned ? info.members : info.members.slice(0, 8)
    for (const member of shown) {
      const item = element(document, "span", "ps-symbol-member")
      if (effectiveKind(index, member) === "property") {
        const alternatives = element(document, "span", "ps-symbol-alternatives")
        for (const name of member.objects.slice(0, 4)) {
          const object = index.symbols.get(name)
          const sprite = object && spritePreview(document, index, object, 28)
          if (sprite) alternatives.appendChild(sprite)
        }
        if (member.objects.length > 4) alternatives.appendChild(element(document, "span", "", `+${member.objects.length - 4}`))
        item.appendChild(alternatives)
      } else {
        const sprite = spritePreview(document, index, member, 28)
        if (sprite) item.appendChild(sprite)
      }
      item.appendChild(nameLink(member))
      members.appendChild(item)
    }
    root.appendChild(members)
    if (shown.length < info.members.length) root.appendChild(button(document,
      `All ${info.members.length} members…`, () => pin(symbol.name), "ps-symbol-more"))
  }
  if (info.includedIn.length) {
    root.appendChild(element(document, "h4", "", "Included in"))
    const memberships = element(document, "div", "ps-symbol-memberships")
    const shown = pinned ? info.includedIn : info.includedIn.slice(0, 6)
    for (const membership of shown) {
      const row = element(document, "div", "ps-symbol-membership")
      row.appendChild(nameLink(membership.symbol))
      if (membership.via.length) row.appendChild(element(document, "span", "ps-symbol-via",
        " via " + membership.via.map(name => index.symbols.get(name)?.label || name).join(" → ")))
      memberships.appendChild(row)
    }
    root.appendChild(memberships)
    if (shown.length < info.includedIn.length) root.appendChild(button(document,
      `All ${info.includedIn.length} memberships…`, () => pin(symbol.name), "ps-symbol-more"))
  }
  if (!pinned) {
    const count = info.directRules.length + info.indirectRules.length
    root.appendChild(button(document, `${count} ${count === 1 ? "rule" : "rules"} · ${info.directRules.length} direct`,
      () => pin(symbol.name), "ps-symbol-rule-count"))
  } else {
    root.appendChild(element(document, "h4", "", `Direct mentions (${info.directRules.length})`))
    appendRuleList(document, root, info.directRules, navigate)
    if (!info.directRules.length) root.appendChild(element(document, "p", "ps-symbol-empty", "No rules mention this name directly."))
    const details = element(document, "details", "ps-symbol-indirect")
    details.appendChild(element(document, "summary", "", `Through properties and aliases (${info.indirectRules.length})`))
    let populated = false
    details.addEventListener("toggle", () => {
      if (!details.open || populated) return
      populated = true
      appendRuleList(document, details, info.indirectRules, navigate)
    })
    root.appendChild(details)
  }
  return root
}

function puzzleScriptSymbolInspector({getDefinitionTarget} = {}) {
  const sourceFor = view => getDefinitionTarget ? getDefinitionTarget() : {view}

  function navigate(view, entry) {
    const target = sourceFor(view)
    if (!target) return
    // A pinned panel refreshes after a short typing pause. Resolve against
    // the latest document even if a link is clicked before that refresh.
    const index = indexFor(target.view)
    const entries = entry.kind === "collision-layer" ? index.collisionLayers.filter(Boolean) : index.rules
    const current = entry.name ? index.symbols.get(entry.name) :
      entries.find(item => item.line === entry.line && item.text === entry.text) ||
      entries.find(item => item.text === entry.text)
    if (!current) return
    if (target.reveal) target.reveal()
    target.view.dispatch({
      selection: {anchor: current.from, head: current.to},
      effects: [EditorView.scrollIntoView(current.from, {y: "center"}), closeHoverTooltips]
    })
    if (target.view !== view) view.dispatch({effects: closeHoverTooltips})
    target.view.focus()
  }

  function pin(view, name, focus = true) {
    const target = sourceFor(view)
    if (!target) return
    if (target.reveal) target.reveal()
    view.dispatch({effects: closeHoverTooltips})
    target.view.dispatch({effects: setInspectedSymbol.of(name)})
    if (focus) target.view.dom.querySelector(".ps-symbol-close")?.focus({preventScroll: true})
  }

  function close(view) {
    view.dispatch({effects: [setInspectedSymbol.of(null), closeHoverTooltips]})
    view.focus()
  }

  function cardFor(view, name, pinned) {
    const source = sourceFor(view)
    if (!source) return null
    return renderCard(view.dom.ownerDocument, indexFor(source.view), name, {
      pinned, pin: (name, focus) => pin(view, name, focus),
      navigate: entry => navigate(view, entry), close: () => close(view)
    })
  }

  function createPanel(view) {
    const dom = element(view.dom.ownerDocument, "section", "ps-symbol-inspector")
    dom.setAttribute("aria-label", "Symbol inspector")
    let timer = null
    function render() {
      timer = null
      const card = cardFor(view, view.state.field(inspected), true)
      if (card) dom.replaceChildren(card)
    }
    render()
    dom.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(view) }
    })
    return {
      dom,
      update(update) {
        if (update.startState.field(inspected) !== update.state.field(inspected)) {
          if (timer !== null) clearTimeout(timer)
          render()
        } else if (update.docChanged) {
          if (timer !== null) clearTimeout(timer)
          timer = setTimeout(render, 150)
        }
      },
      destroy() { if (timer !== null) clearTimeout(timer) }
    }
  }

  const inspected = StateField.define({
    create: () => null,
    update(value, transaction) {
      for (const effect of transaction.effects) if (effect.is(setInspectedSymbol)) value = effect.value
      return value
    },
    provide: field => showPanel.from(field, name => name ? createPanel : null)
  })
  const hover = hoverTooltip((view, position, side) => {
    const at = side < 0 && position > 0 ? position - 1 : position
    if (!ensureExactPrefix(view, view.state.doc.lineAt(at).to)) return null
    const token = puzzleScriptTokenAtPosition(view.state, at)
    if (!token || !token.style.split(/\s+/).some(style => style === "NAME" || style === "LEVEL")) return null
    const target = sourceFor(view)
    if (!target || !indexFor(target.view).symbols.has(token.text.trim().toLowerCase())) return null
    const name = token.text.trim().toLowerCase()
    return {
      pos: token.from, end: token.to, above: true,
      create() {
        const dom = cardFor(view, name, false)
        dom.classList.add("ps-symbol-hover")
        dom.setAttribute("role", "dialog")
        dom.setAttribute("aria-label", "Symbol information")
        dom.addEventListener("keydown", event => {
          if (event.key === "Escape") {
            event.preventDefault(); event.stopPropagation()
            view.dispatch({effects: closeHoverTooltips}); view.focus()
          }
        })
        return {dom}
      }
    }
  }, {hoverTime: 350, hideOnChange: true})
  return [inspected, hover, tooltips({
    // Native app menus can sit above tooltips in the page's stacking order.
    // Keep editor tooltips below its own chrome instead of behind those menus.
    tooltipSpace(view) {
      const rect = view.dom.getBoundingClientRect()
      const window = view.dom.ownerDocument.defaultView
      return {
        top: Math.max(0, rect.top), bottom: Math.min(window.innerHeight, rect.bottom),
        left: 0, right: window.innerWidth
      }
    }
  }), keymap.of([{
    key: "Escape",
    run(view) {
      if (view.state.field(hover.active).length) {
        view.dispatch({effects: closeHoverTooltips})
        return true
      }
      if (!view.state.field(inspected)) return false
      close(view)
      return true
    }
  }])]
}

host.define("symbol-inspector", {puzzleScriptSymbolInspector, setInspectedSymbol})
})(globalThis.PuzzleScriptCM6Plugins)
