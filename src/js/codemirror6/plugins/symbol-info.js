(function(host) {
"use strict"

const {StringStream} = host.requireRuntime(["StringStream"])
const canonical = name => String(name).trim().toLowerCase()
const unique = values => [...new Set(values)]
const hasStyle = (token, style) => token.style.split(/\s+/).includes(style)

function resolveColor(color, palette) {
  const name = canonical(color)
  if (name === "transparent") return "transparent"
  const resolved = Object.prototype.hasOwnProperty.call(palette, name) ? palette[name] : name
  return /^#(?:[a-f0-9]{3}|[a-f0-9]{6}|[a-f0-9]{8})$/i.test(resolved) ? resolved : "#ff00ff"
}

// Consume the existing tokenizer, retaining the original text before it lowercases
// streams. Nothing here compiles a game or edits parser/compiler global state.
function buildSymbolIndex(doc, parser, {palettes = {}, paletteAliases = {}} = {}) {
  const symbols = new Map()
  const rules = []
  const collisionLayers = []
  if (!parser || typeof parser.startState !== "function") return {symbols, rules, collisionLayers}
  const state = parser.startState(2)

  function declare(token, kind, line, members) {
    const name = canonical(token.text)
    if (!name || symbols.has(name)) return
    symbols.set(name, {
      name, label: token.text, kind,
      from: line.from + token.from, to: line.from + token.to,
      line: line.number, definition: line.text,
      members: unique(members), objects: [], layer: null
    })
  }

  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number)
    const stream = new StringStream(line.text, 4, 2)
    const tokens = []
    // The old parser doesn't advance its line counter for empty lines.
    state.lineNumber = number - 1
    if (!line.text.length) {
      parser.blankLine(state, 2)
      state.lineNumber = number
      continue
    }
    while (!stream.eol()) {
      stream.start = stream.pos
      let style
      try {
        for (let attempt = 0; attempt < 10 && stream.pos === stream.start; attempt++) {
          style = parser.token(stream, state)
        }
      } catch (_) {
        // Draft declarations can be unfinished. Keep the useful prefix.
        break
      }
      if (state.section === "levels") break
      if (stream.pos === stream.start) break
      const original = line.text.slice(stream.start, stream.pos)
      const text = original.trim()
      const from = stream.start + original.length - original.trimStart().length
      if (style && text) tokens.push({style, text, from, to: from + text.length})
    }
    if (state.section === "levels") break
    if (tokens.some(token => hasStyle(token, "HEADER"))) continue
    const names = tokens.filter(token => hasStyle(token, "NAME"))
    if (state.section === "objects" && names.length) {
      const primary = canonical(names[0].text)
      declare(names[0], "object", line, [])
      for (const alias of names.slice(1)) declare(alias, "alias", line, [primary])
    } else if (state.section === "legend" && names.length &&
               tokens.find(token => !hasStyle(token, "comment")) === names[0] &&
               tokens.some(token => hasStyle(token, "ASSIGNMENT"))) {
      const logic = tokens.find(token => hasStyle(token, "LOGICWORD"))
      const kind = logic ? (canonical(logic.text) === "and" ? "aggregate" : "property") : "alias"
      declare(names[0], kind, line, names.slice(1).map(token => canonical(token.text)))
    } else if (state.section === "rules" && names.length &&
               tokens.some(token => hasStyle(token, "ARROW"))) {
      rules.push({from: line.from, to: line.to, line: number, text: line.text,
        names: unique(names.map(token => canonical(token.text)))})
    } else if (state.section === "collisionlayers" && names.length) {
      collisionLayers[state.collisionLayers.length - 1] = {
        kind: "collision-layer", from: line.from, to: line.to, line: number, text: line.text,
        entities: names.map(token => ({name: canonical(token.text), label: token.text})),
        objects: []
      }
    }
  }

  function expand(name, visiting) {
    const symbol = symbols.get(name)
    if (!symbol || visiting.has(name)) return []
    if (symbol.kind === "object") return [name]
    const next = new Set(visiting).add(name)
    return unique(symbol.members.flatMap(member => expand(member, next)))
  }

  let paletteName = "arnecolors"
  for (let i = 0; i < state.metadata.length; i += 2) {
    if (state.metadata[i] === "color_palette") {
      const requested = canonical(state.metadata[i + 1])
      const resolved = Object.prototype.hasOwnProperty.call(paletteAliases, requested)
        ? paletteAliases[requested] : requested
      if (Object.prototype.hasOwnProperty.call(palettes, resolved)) paletteName = resolved
    }
  }
  const palette = palettes[paletteName] || {}
  const layers = new Map()
  state.collisionLayers.forEach((layer, i) => {
    for (const name of layer) if (!layers.has(name)) layers.set(name, i + 1)
    if (collisionLayers[i]) collisionLayers[i].objects = unique(layer)
  })
  for (const symbol of symbols.values()) {
    symbol.objects = expand(symbol.name, new Set())
    const objectLayers = symbol.objects.map(name => layers.get(name) || null)
    if (objectLayers.length && objectLayers[0] !== null && objectLayers.every(layer => layer === objectLayers[0])) {
      symbol.layer = objectLayers[0]
    }
    if (symbol.kind === "object") {
      const object = state.objects[symbol.name]
      symbol.sprite = {
        rows: object && object.spritematrix.length ? object.spritematrix.slice() : Array(5).fill("00000"),
        colors: object && object.colors.length
          ? object.colors.map(color => resolveColor(color, palette)) : ["#ff00ff"]
      }
    }
  }
  return {symbols, rules, collisionLayers}
}

function inspectSymbol(index, name) {
  name = canonical(name)
  const symbol = index.symbols.get(name)
  if (!symbol) return null
  const targets = new Set([name])
  // An inline/legend alias has the same membership as its referent.
  let referent = symbol
  while (referent.kind === "alias" && referent.members.length === 1) {
    const member = referent.members[0]
    if (targets.has(member)) break
    targets.add(member)
    referent = index.symbols.get(member)
    if (!referent) break
  }

  function membershipPath(container) {
    const queue = container.members.map(member => [member])
    const seen = new Set([container.name])
    for (let i = 0; i < queue.length; i++) {
      const path = queue[i]
      const member = path[path.length - 1]
      if (targets.has(member)) return path.slice(0, -1)
      if (seen.has(member)) continue
      seen.add(member)
      const entry = index.symbols.get(member)
      if (entry) for (const child of entry.members) queue.push(path.concat(child))
    }
    return null
  }

  const includedIn = []
  const indirectNames = new Set()
  for (const entry of index.symbols.values()) {
    if (entry.name === name) continue
    const via = membershipPath(entry)
    if (via === null) continue
    indirectNames.add(entry.name)
    if (entry.kind === "property" || entry.kind === "aggregate") includedIn.push({symbol: entry, via})
  }
  for (const target of targets) if (target !== name) indirectNames.add(target)
  const directRules = index.rules.filter(rule => rule.names.includes(name))
  const indirectRules = index.rules.filter(rule => !rule.names.includes(name) &&
    rule.names.some(mentioned => indirectNames.has(mentioned)))
  const resolve = names => names.map(member => index.symbols.get(member)).filter(Boolean)
  return {symbol, members: resolve(symbol.members), objects: resolve(symbol.objects),
    collisionLayer: index.collisionLayers?.[symbol.layer - 1] || null,
    includedIn, directRules, indirectRules}
}

host.define("symbol-info", {buildSymbolIndex, inspectSymbol})
})(globalThis.PuzzleScriptCM6Plugins)
