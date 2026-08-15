import assert from "node:assert/strict"
import {test} from "node:test"

import {
  Decoration,
  EditorState,
  ensureSyntaxTree,
  SearchQuery,
  setSearchQuery,
  setSelectedCompletion,
  syntaxTree,
  syntaxTreeAvailable
} from "./plugin-test-support.mjs"

import {styleFromHexCode} from "./plugin-test-support.mjs"
import {ensureExactPrefix, exactPrefix, setExactPrefix} from "./plugin-test-support.mjs"
import {createPuzzleScriptLanguage} from "./plugin-test-support.mjs"
import {
  buildTokenDecorations,
  classesForStyle,
  dynamicHexForStyle,
  presentationClasses,
  tokenPresentation,
  updateTokenDecorations
} from "./plugin-test-support.mjs"
import {distantPosition, largeSource} from "./fixtures/large-source.js"
import {createParserHarness} from "./parser-support.mjs"

function collectMarks(decorations) {
  const marks = []
  decorations.between(0, 1_000_000, (from, to, value) => {
    marks.push({from, to, class: value.spec.class, attributes: value.spec.attributes})
  })
  return marks
}

function collectMarkValues(decorations) {
  const values = []
  decorations.between(0, 1_000_000, (from, to, value) => {
    values.push({from, to, value})
  })
  return values
}

function presentationContext(view, hasExactSet = true) {
  return {
    cache: new Map(),
    coveredRanges: view.visibleRanges.map(range => ({from: range.from, to: range.to})),
    exactPrefix: view.state.field(exactPrefix),
    hasExactSet,
    needsRebuild: false,
    viewportNeedsRebuild: false
  }
}

function presentationUpdate(view, overrides = {}) {
  return {
    view,
    docChanged: false,
    viewportMoved: false,
    transactions: [],
    ...overrides
  }
}

async function exactPresentation(source, visibleRanges) {
  const harness = await createParserHarness()
  const language = createPuzzleScriptLanguage(harness.parser)
  let state = EditorState.create({doc: source, extensions: [language, exactPrefix]})
  assert.ok(ensureSyntaxTree(state, state.doc.length, 1_000))
  state = state.update({effects: setExactPrefix.of(state.doc.length)}).state
  const view = {
    state,
    visibleRanges: visibleRanges ?? [{from: 0, to: state.doc.length}]
  }
  const context = presentationContext(view)
  return {
    state,
    view,
    context,
    decorations: buildTokenDecorations(view, context.cache)
  }
}

function createPluginDriver(setup) {
  let plugin
  let dispatches = 0
  setup.view.dispatch = spec => {
    dispatches++
    const transaction = setup.view.state.update(spec)
    setup.view.state = transaction.state
    plugin.update(presentationUpdate(setup.view, {transactions: [transaction]}))
  }
  plugin = tokenPresentation().create(setup.view)
  return {plugin, dispatches: () => dispatches}
}

test("PuzzleScript style strings map to exact legacy classes and dynamic colours", () => {
  assert.deepEqual(classesForStyle("COLOR BOLDCOLOR COLOR-RED"),
    ["cm-COLOR", "cm-BOLDCOLOR", "cm-COLOR-RED"])
  assert.equal(dynamicHexForStyle("MULTICOLOR#Ff00aA"), "#Ff00aA")
  assert.equal(dynamicHexForStyle("COLOR COLOR-#123"), "#123")
  assert.deepEqual(presentationClasses("MULTICOLOR#Ff00aA"), ["cm-COLOR"])
  assert.deepEqual(presentationClasses("COLOR COLOR-#123"), ["cm-COLOR", "cm-COLOR-#123"])
  assert.equal(dynamicHexForStyle("NAME"), null)
  assert.equal(styleFromHexCode("#000"), "color: hsl(0,0%,34%)")
  assert.equal(styleFromHexCode("#123"), "color: hsl(210,50%,34%)")
  assert.equal(styleFromHexCode("#Ff00aA"), "color:#Ff00aA")
})

test("token decorations refuse an approximate viewport", async () => {
  const harness = await createParserHarness()
  const language = createPuzzleScriptLanguage(harness.parser)
  const state = EditorState.create({
    doc: "OBJECTS\nPlayer\n#Ff00aA\n00000\n",
    extensions: [language, exactPrefix]
  })
  const view = {state, visibleRanges: [{from: 0, to: state.doc.length}]}
  assert.strictEqual(buildTokenDecorations(view), Decoration.none)
})

test("token decorations come from decoded tree nodes and preserve dynamic-colour forms", async () => {
  const harness = await createParserHarness()
  const language = createPuzzleScriptLanguage(harness.parser)
  let state = EditorState.create({
    doc: "OBJECTS\nPlayer\n#Ff00aA\n00000\n",
    extensions: [language, exactPrefix]
  })
  assert.ok(ensureSyntaxTree(state, state.doc.length, 1_000))
  state = state.update({effects: setExactPrefix.of(state.doc.length)}).state

  const marks = collectMarks(buildTokenDecorations({
    state,
    visibleRanges: [{from: 0, to: state.doc.length}]
  }))
  const multilineColour = marks.find(mark => mark.class === "cm-COLOR")
  const spriteColour = marks.find(mark => mark.class.includes("cm-BOLDCOLOR"))

  assert.ok(multilineColour)
  assert.match(multilineColour.attributes.style, /^color:/)
  assert.ok(spriteColour)
  assert.match(spriteColour.class, /cm-COLOR-#FF00AA/)
  assert.match(spriteColour.attributes.style, /^color:/)
})

test("equal encoded styles reuse one decoded presentation and mark value without duplicate ranges", async () => {
  const {view, context} = await exactPresentation(
    "OBJECTS\nPlayer\nred\n00000\nCrate\nred\n00000\n"
  )
  view.visibleRanges = [
    {from: 0, to: view.state.doc.length},
    {from: 0, to: view.state.doc.length}
  ]

  const values = collectMarkValues(buildTokenDecorations(view, context.cache))
  const spriteValues = values.filter(({value}) =>
    value.spec.class === "cm-COLOR cm-BOLDCOLOR cm-COLOR-RED")
  const uniqueRanges = new Set(values.map(({from, to, value}) =>
    `${from}:${to}:${value.spec.class}`))
  const cachedSprite = [...context.cache.values()].find(presentation =>
    presentation.classes.join(" ") === "cm-COLOR cm-BOLDCOLOR cm-COLOR-RED")
  const otherEditorValues = collectMarkValues(buildTokenDecorations(view, new Map()))
  const otherEditorSprite = otherEditorValues.find(({value}) =>
    value.spec.class === "cm-COLOR cm-BOLDCOLOR cm-COLOR-RED")

  assert.ok(spriteValues.length > 1)
  assert.ok(spriteValues.every(({value}) => value === spriteValues[0].value))
  assert.deepEqual(Object.keys(cachedSprite).sort(),
    ["classes", "decoration", "dynamicHex", "style"])
  assert.strictEqual(cachedSprite.decoration, spriteValues[0].value)
  assert.notStrictEqual(otherEditorSprite.value, spriteValues[0].value)
  assert.equal(values.length, uniqueRanges.size)
})

test("selection, focus, completion, and search UI updates retain decoration identity", async () => {
  const setup = await exactPresentation("OBJECTS\nPlayer\nred\n00000\n")
  const original = setup.decorations

  const selection = setup.state.update({selection: {anchor: 1}})
  setup.view.state = selection.state
  setup.decorations = updateTokenDecorations(
    presentationUpdate(setup.view, {transactions: [selection]}),
    setup.decorations,
    setup.context
  )
  assert.strictEqual(setup.decorations, original)

  setup.decorations = updateTokenDecorations(
    presentationUpdate(setup.view, {focusChanged: true}),
    setup.decorations,
    setup.context
  )
  assert.strictEqual(setup.decorations, original)
  setup.decorations = updateTokenDecorations(
    presentationUpdate(setup.view, {focusChanged: true}),
    setup.decorations,
    setup.context
  )
  assert.strictEqual(setup.decorations, original)

  const completion = setup.view.state.update({effects: setSelectedCompletion(0)})
  setup.view.state = completion.state
  setup.decorations = updateTokenDecorations(
    presentationUpdate(setup.view, {transactions: [completion]}),
    setup.decorations,
    setup.context
  )
  assert.strictEqual(setup.decorations, original)

  const search = setup.view.state.update({
    effects: setSearchQuery.of(new SearchQuery({search: "player"}))
  })
  setup.view.state = search.state
  setup.decorations = updateTokenDecorations(
    presentationUpdate(setup.view, {transactions: [search]}),
    setup.decorations,
    setup.context
  )
  assert.strictEqual(setup.decorations, original)
})

test("viewport shrinkage retains identity while genuinely new visible text rebuilds", async () => {
  const source = "OBJECTS\nPlayer\nred\n00000\nCrate\nblue\n00000\n"
  const setup = await exactPresentation(source, [{from: 0, to: 26}])
  const original = setup.decorations

  setup.view.visibleRanges = [{from: 0, to: 14}]
  setup.decorations = updateTokenDecorations(
    presentationUpdate(setup.view, {viewportMoved: true}),
    setup.decorations,
    setup.context
  )
  assert.strictEqual(setup.decorations, original)

  setup.view.visibleRanges = [{from: 0, to: setup.state.doc.length}]
  setup.decorations = updateTokenDecorations(
    presentationUpdate(setup.view, {viewportMoved: true}),
    setup.decorations,
    setup.context
  )
  assert.notStrictEqual(setup.decorations, original)
})

test("returning from unavailable uncovered text cancels its pending viewport rebuild", async () => {
  const source = "OBJECTS\nPlayer\nred\n00000\nCrate\nblue\n00000\n"
  const harness = await createParserHarness()
  const language = createPuzzleScriptLanguage(harness.parser)
  let state = EditorState.create({doc: source, extensions: [language, exactPrefix]})
  assert.ok(ensureSyntaxTree(state, state.doc.length, 1_000))
  state = state.update({effects: setExactPrefix.of(14)}).state
  const view = {state, visibleRanges: [{from: 0, to: 14}]}
  const context = presentationContext(view)
  let decorations = buildTokenDecorations(view, context.cache)
  const original = decorations

  view.visibleRanges = [{from: 14, to: state.doc.length}]
  decorations = updateTokenDecorations(
    presentationUpdate(view, {viewportMoved: true}), decorations, context)
  assert.strictEqual(decorations, original)

  view.visibleRanges = [{from: 0, to: 14}]
  decorations = updateTokenDecorations(
    presentationUpdate(view, {viewportMoved: true}), decorations, context)
  assert.strictEqual(decorations, original)
})

test("mapping an empty covered range across an insertion keeps valid endpoints", async () => {
  const setup = await exactPresentation(
    "OBJECTS\nPlayer\nred\n00000\n", [{from: 0, to: 0}])
  const transaction = setup.state.update({changes: {from: 0, insert: "x"}})
  setup.view.state = transaction.state

  updateTokenDecorations(presentationUpdate(setup.view, {
    docChanged: true,
    changes: transaction.changes,
    transactions: [transaction]
  }), setup.decorations, setup.context)

  assert.deepEqual(setup.context.coveredRanges, [{from: 0, to: 0}])
})

test("initial exactness and reconfiguration rebuild decorations", async () => {
  const source = "OBJECTS\nPlayer\nred\n00000\n"
  const setup = await exactPresentation(source)
  const {view} = setup
  const context = presentationContext(view, false)
  let decorations = Decoration.none

  decorations = updateTokenDecorations(
    presentationUpdate(view), decorations, context)
  assert.notStrictEqual(decorations, Decoration.none)

  const beforeReconfigure = decorations
  decorations = updateTokenDecorations(
    presentationUpdate(view, {transactions: [{reconfigured: true}]}),
    decorations,
    context
  )
  assert.notStrictEqual(decorations, beforeReconfigure)
})

test("exact-prefix advancement from below the visible end rebuilds decorations", async () => {
  const source = "OBJECTS\nPlayer\nred\n00000\nCrate\nblue\n00000\n"
  const harness = await createParserHarness()
  const language = createPuzzleScriptLanguage(harness.parser)
  let state = EditorState.create({doc: source, extensions: [language, exactPrefix]})
  assert.ok(ensureSyntaxTree(state, state.doc.length, 1_000))
  state = state.update({effects: setExactPrefix.of(14)}).state
  const view = {state, visibleRanges: [{from: 0, to: 14}]}
  const context = presentationContext(view)
  let decorations = buildTokenDecorations(view, context.cache)
  const partial = decorations

  view.visibleRanges = [{from: 0, to: state.doc.length}]
  decorations = updateTokenDecorations(
    presentationUpdate(view), decorations, context)
  assert.strictEqual(decorations, partial)

  const exact = state.update({effects: setExactPrefix.of(state.doc.length)})
  view.state = exact.state
  decorations = updateTokenDecorations(
    presentationUpdate(view, {transactions: [exact]}), decorations, context)
  assert.notStrictEqual(decorations, partial)
})

test("every document edit immediately returns the mapped previous decoration set", async () => {
  const setup = await exactPresentation(
    "OBJECTS\nPlayer\nred\n00000\nCrate\nblue\n00000\n",
    [{from: 0, to: 26}]
  )
  const previous = setup.decorations
  const transaction = setup.state.update({
    changes: {from: setup.state.doc.length, insert: "\n"}
  })
  const mapped = previous.map(transaction.changes)
  let mapCalls = 0
  previous.map = changes => {
    mapCalls++
    assert.strictEqual(changes, transaction.changes)
    return mapped
  }
  setup.view.state = transaction.state

  const retained = updateTokenDecorations(presentationUpdate(setup.view, {
    docChanged: true,
    changes: transaction.changes,
    transactions: [transaction]
  }), previous, setup.context)

  assert.equal(mapCalls, 1)
  assert.strictEqual(retained, mapped)
  assert.notStrictEqual(retained, Decoration.none)
})

test("a document edit that moves to uncovered exact text maps first and rebuilds on follow-up", async () => {
  const setup = await exactPresentation(
    "OBJECTS\nPlayer\nred\n00000\nCrate\nblue\n00000\n",
    [{from: 0, to: 14}]
  )
  const previous = setup.decorations
  const transaction = setup.state.update({
    changes: {from: setup.state.doc.length, insert: "\n"}
  })
  const mapped = previous.map(transaction.changes)
  previous.map = changes => {
    assert.strictEqual(changes, transaction.changes)
    return mapped
  }
  setup.view.state = transaction.state
  setup.view.visibleRanges = [{from: 26, to: 40}]
  assert.ok(transaction.state.field(exactPrefix) >= 40)
  assert.equal(syntaxTreeAvailable(transaction.state, 40), true)

  const immediate = updateTokenDecorations(presentationUpdate(setup.view, {
    docChanged: true,
    viewportMoved: true,
    changes: transaction.changes,
    transactions: [transaction]
  }), previous, setup.context)

  assert.strictEqual(immediate, mapped)
  assert.equal(setup.context.viewportNeedsRebuild, true)

  const rebuilt = updateTokenDecorations(
    presentationUpdate(setup.view), immediate, setup.context)
  const marks = collectMarks(rebuilt)
  assert.notStrictEqual(rebuilt, immediate)
  assert.ok(marks.length > 0)
  assert.ok(marks.every(mark => mark.from >= 26 && mark.from <= 40))
})

test("the presentation plugin schedules one bounded exact follow-up after an edit moves the viewport", async () => {
  const setup = await exactPresentation(
    "OBJECTS\nPlayer\nred\n00000\nCrate\nblue\n00000\n",
    [{from: 0, to: 14}]
  )
  const driver = createPluginDriver(setup)
  const {plugin} = driver
  const previous = plugin.decorations
  const transaction = setup.state.update({
    changes: {from: setup.state.doc.length, insert: "\n"}
  })
  const mapped = previous.map(transaction.changes)
  previous.map = () => mapped
  setup.view.state = transaction.state
  setup.view.visibleRanges = [{from: 26, to: 40}]

  plugin.update(presentationUpdate(setup.view, {
    docChanged: true,
    viewportMoved: true,
    changes: transaction.changes,
    transactions: [transaction]
  }))

  assert.strictEqual(plugin.decorations, mapped)
  assert.equal(driver.dispatches(), 0)
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(driver.dispatches(), 1)
  assert.notStrictEqual(plugin.decorations, mapped)
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(driver.dispatches(), 1)
  plugin.destroy()
})

test("rapid exact edit/viewport updates coalesce one presentation follow-up", async () => {
  const setup = await exactPresentation(
    "OBJECTS\nPlayer\nred\n00000\nCrate\nblue\n00000\n",
    [{from: 0, to: 14}]
  )
  const driver = createPluginDriver(setup)
  const first = setup.state.update({changes: {from: setup.state.doc.length, insert: "\n"}})
  setup.view.state = first.state
  setup.view.visibleRanges = [{from: 26, to: 40}]
  driver.plugin.update(presentationUpdate(setup.view, {
    docChanged: true,
    viewportMoved: true,
    changes: first.changes,
    transactions: [first]
  }))

  const second = setup.view.state.update({
    changes: {from: setup.view.state.doc.length, insert: "\n"}
  })
  setup.view.state = second.state
  driver.plugin.update(presentationUpdate(setup.view, {
    docChanged: true,
    viewportMoved: true,
    changes: second.changes,
    transactions: [second]
  }))

  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(driver.dispatches(), 1)
  driver.plugin.destroy()
})

test("destroy and reconfiguration cancel a pending presentation follow-up", async () => {
  for (const cancel of [
    driver => driver.plugin.destroy(),
    driver => driver.plugin.update(presentationUpdate(driver.plugin.view, {
      transactions: [{reconfigured: true}]
    }))
  ]) {
    const setup = await exactPresentation(
      "OBJECTS\nPlayer\nred\n00000\nCrate\nblue\n00000\n",
      [{from: 0, to: 14}]
    )
    const driver = createPluginDriver(setup)
    const transaction = setup.state.update({
      changes: {from: setup.state.doc.length, insert: "\n"}
    })
    setup.view.state = transaction.state
    setup.view.visibleRanges = [{from: 26, to: 40}]
    driver.plugin.update(presentationUpdate(setup.view, {
      docChanged: true,
      viewportMoved: true,
      changes: transaction.changes,
      transactions: [transaction]
    }))
    cancel(driver)
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(driver.dispatches(), 0)
    driver.plugin.destroy()
  }
})

test("a combined edit and reconfiguration maps first then rebuilds once", async () => {
  const setup = await exactPresentation(
    "OBJECTS\nPlayer\nred\n00000\nCrate\nblue\n00000\n",
    [{from: 0, to: 14}]
  )
  const driver = createPluginDriver(setup)
  const previous = driver.plugin.decorations
  const transaction = setup.state.update({
    changes: {from: setup.state.doc.length, insert: "\n"}
  })
  const mapped = previous.map(transaction.changes)
  previous.map = () => mapped
  setup.view.state = transaction.state
  assert.equal(syntaxTreeAvailable(transaction.state, 14), true)

  driver.plugin.update(presentationUpdate(setup.view, {
    docChanged: true,
    changes: transaction.changes,
    transactions: [transaction, {reconfigured: true}]
  }))

  assert.strictEqual(driver.plugin.decorations, mapped)
  assert.equal(driver.dispatches(), 0)
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(driver.dispatches(), 1)
  assert.notStrictEqual(driver.plugin.decorations, mapped)
  driver.plugin.destroy()
})

test("an unavailable combined edit/viewport waits for exact publication without a follow-up", async () => {
  const source = "OBJECTS\nPlayer\nred\n00000\nCrate\nblue\n00000\n"
  const harness = await createParserHarness()
  const language = createPuzzleScriptLanguage(harness.parser)
  let state = EditorState.create({doc: source, extensions: [language, exactPrefix]})
  assert.ok(ensureSyntaxTree(state, state.doc.length, 1_000))
  state = state.update({effects: setExactPrefix.of(14)}).state
  const view = {state, visibleRanges: [{from: 0, to: 14}]}
  const setup = {state, view}
  const driver = createPluginDriver(setup)
  const previous = driver.plugin.decorations
  const transaction = state.update({changes: {from: state.doc.length, insert: "\n"}})
  const mapped = previous.map(transaction.changes)
  previous.map = () => mapped
  view.state = transaction.state
  view.visibleRanges = [{from: 26, to: 40}]

  driver.plugin.update(presentationUpdate(view, {
    docChanged: true,
    viewportMoved: true,
    changes: transaction.changes,
    transactions: [transaction]
  }))
  assert.strictEqual(driver.plugin.decorations, mapped)
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(driver.dispatches(), 0)

  const exact = view.state.update({effects: setExactPrefix.of(view.state.doc.length)})
  view.state = exact.state
  driver.plugin.update(presentationUpdate(view, {transactions: [exact]}))
  const rebuilt = driver.plugin.decorations
  const marks = collectMarks(rebuilt)
  assert.notStrictEqual(rebuilt, mapped)
  assert.ok(marks.length > 0)
  assert.ok(marks.every(mark => mark.from >= 26 && mark.from <= 40))
  assert.ok(marks.some(mark =>
    mark.from === 36 && mark.to === 37 &&
      mark.class === "cm-COLOR cm-BOLDCOLOR cm-COLOR-RED"))
  assert.deepEqual(driver.plugin.presentation.coveredRanges, [{from: 26, to: 40}])
  assert.equal(driver.plugin.presentation.needsRebuild, false)
  assert.equal(driver.plugin.presentation.viewportNeedsRebuild, false)

  driver.plugin.update(presentationUpdate(view))
  assert.strictEqual(driver.plugin.decorations, rebuilt)
  driver.plugin.destroy()
})

test("document edits retain mapped exact decorations until the replacement tree is exact", async () => {
  const harness = await createParserHarness()
  const language = createPuzzleScriptLanguage(harness.parser)
  let state = EditorState.create({
    doc: "OBJECTS\nPlayer\n#Ff00aA\n00000\n",
    extensions: [language, exactPrefix]
  })
  assert.ok(ensureSyntaxTree(state, state.doc.length, 1_000))
  state = state.update({effects: setExactPrefix.of(state.doc.length)}).state

  const visibleRanges = [{from: 0, to: state.doc.length}]
  const previous = buildTokenDecorations({state, visibleRanges})
  const transaction = state.update({changes: {from: 15, insert: "x"}})
  assert.equal(
    transaction.state.field(exactPrefix),
    transaction.startState.doc.lineAt(15).from
  )

  const retained = updateTokenDecorations({
    view: {
      state: transaction.state,
      visibleRanges: [{from: 0, to: transaction.state.doc.length}]
    },
    docChanged: true,
    changes: transaction.changes
  }, previous)

  assert.notStrictEqual(retained, Decoration.none)
  assert.ok(collectMarks(retained).length > 0)
})

test("a retained prefix cannot rebuild decorations from an unavailable mapped tree", async () => {
  const harness = await createParserHarness()
  const language = createPuzzleScriptLanguage(harness.parser)
  let state = EditorState.create({
    doc: largeSource,
    extensions: [language, exactPrefix]
  })
  assert.ok(ensureSyntaxTree(state, state.doc.length, 2_000))
  state = state.update({effects: setExactPrefix.of(state.doc.length)}).state

  const line = state.doc.lineAt(distantPosition)
  const visibleRanges = [{from: line.from, to: line.to}]
  const view = {state, visibleRanges}
  const context = presentationContext(view)
  const previous = buildTokenDecorations(view, context.cache)
  assert.ok(collectMarks(previous).length > 0)

  const transaction = state.update({changes: {from: state.doc.length, insert: "("}})
  assert.ok(transaction.state.field(exactPrefix) >= line.to)
  assert.equal(syntaxTreeAvailable(transaction.state, line.to), false)
  view.state = transaction.state
  assert.strictEqual(buildTokenDecorations(view), Decoration.none)

  const mapped = previous.map(transaction.changes)
  const retained = updateTokenDecorations(presentationUpdate(view, {
    docChanged: true,
    changes: transaction.changes,
    transactions: [transaction]
  }), previous, context)
  assert.deepEqual(collectMarks(retained), collectMarks(mapped))
  assert.equal(collectMarks(retained).length, 80)

  view.dispatches = 0
  view.dispatch = spec => {
    view.dispatches++
    view.state = view.state.update(spec).state
  }
  assert.equal(ensureExactPrefix(view, line.to, 2_000), true)
  assert.equal(view.dispatches, 1)
  assert.ok(syntaxTree(view.state).length >= line.to)

  const published = updateTokenDecorations(
    presentationUpdate(view), retained, context)
  const marks = collectMarks(published)
  assert.strictEqual(published, retained)
  assert.equal(marks.length, 80)
  assert.ok(marks.every(mark =>
    mark.from >= line.from && mark.to <= line.to && mark.class === "cm-LEVEL"))
  assert.deepEqual(context.coveredRanges, visibleRanges)
  assert.equal(context.needsRebuild, false)
  assert.equal(context.viewportNeedsRebuild, false)

  const noOp = updateTokenDecorations(
    presentationUpdate(view), published, context)
  assert.strictEqual(noOp, published)
})
