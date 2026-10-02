import assert from "node:assert/strict"
import {test} from "node:test"

import buildHtml from "../../../build-html.js"

test("release HTML removes local scripts whose filenames contain dots", () => {
  const html = [
    '<script src="js/editor.js"></script>',
    '<script src="js/codemirror6/runtime/dist/codemirror6-runtime.js"></script>',
    '<script src="https://example.com/external.js"></script>'
  ].join("\n")

  assert.equal(buildHtml.removeLocalScriptTags(html),
    '\n\n<script src="https://example.com/external.js"></script>')
})
