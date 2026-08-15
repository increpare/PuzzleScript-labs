import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import test from "node:test"
import {brotliCompressSync, constants} from "node:zlib"

test("checked-in CM6 bundle exposes only the PuzzleScript factory", async () => {
  const code = await readFile(new URL("../../js/codemirror6.bundle.js", import.meta.url), "utf8")
  assert.match(code, /PuzzleScriptCM6/)
  assert.doesNotMatch(code, /window\.CodeMirror\s*=/)
  assert.doesNotMatch(code, /[ \t]+$/m)
})

test("checked-in CM6 bundle is below 100 KiB at Brotli text quality 11", async () => {
  const code = await readFile(new URL("../../js/codemirror6.bundle.js", import.meta.url))
  const brotli = brotliCompressSync(code, {
    params: {
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      [constants.BROTLI_PARAM_QUALITY]: 11
    }
  })

  assert.ok(brotli.length < 100 * 1024, `${brotli.length} bytes is not below 100 KiB`)
})
