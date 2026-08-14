import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import test from "node:test"

test("checked-in CM6 bundle exposes only the PuzzleScript factory", async () => {
  const code = await readFile(new URL("../../js/codemirror6.bundle.js", import.meta.url), "utf8")
  assert.match(code, /PuzzleScriptCM6/)
  assert.doesNotMatch(code, /window\.CodeMirror\s*=/)
})
