import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {test} from "node:test"

import {transformCandidateHtml} from "./build-candidate-page.mjs"

const editorHtml = await readFile(new URL("../../editor.html", import.meta.url), "utf8")

function count(source, needle) {
  return source.split(needle).length - 1
}

function cm6ShapedProductHtml(source) {
  return source
    .replace('<script src="js/editor-cm5.js"></script>', [
      '<script src="js/codemirror6.bundle.js"></script>',
      '<script src="js/editor-cm6.js"></script>'
    ].join("\n"))
}

test("candidate generation is exact and idempotent for pre- and post-cutover markup", () => {
  for (const input of [editorHtml, cm6ShapedProductHtml(editorHtml)]) {
    const output = transformCandidateHtml(input)
    assert.equal(count(output, '<base href="../../../">'), 1)
    assert.equal(count(output, 'src="js/codemirror6.bundle.js"'), 1)
    assert.equal(count(output, 'src="js/editor-cm6.js"'), 1)
    assert.equal(count(output, 'href="css/editor-cm6.css"'), 1)
    assert.equal(count(output, 'href="css/editor-theme.css"'), 1)
    assert.equal(count(output, 'src="js/editor.js"'), 1)
    assert.equal(count(output, 'src="js/editor-cm5.js"'), 0)
    assert.match(output, /js\/codemirror\/rule-transform\.js/)
    assert.match(output, /js\/puzzlescript-autocomplete\.js/)
    assert.ok(output.indexOf("js/editor-cm6.js") < output.indexOf("js/editor.js"))
    assert.equal(transformCandidateHtml(output), output)
  }
})

test("candidate generation removes only the enumerated CM5 editor scripts", () => {
  const output = transformCandidateHtml(editorHtml)
  for (const script of [
    "codemirror.js", "panel.js", "active-line.js", "dialog.js", "searchcursor.js",
    "search.js", "match-highlighter.js", "show-hint.js", "anyword-hint.js", "comment.js"
  ]) {
    assert.equal(output.includes(`js/codemirror/${script}`), false, script)
  }
  assert.match(output, /js\/parser\.js/)
  assert.match(output, /js\/editor-api\.js/)
  assert.match(output, /js\/imagepaste\.js/)
})
