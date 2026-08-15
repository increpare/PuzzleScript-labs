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

test("checked-in CM6 bundle links its discoverable matching source map", async () => {
  const bundleURL = new URL("../../js/codemirror6.bundle.js", import.meta.url)
  const code = await readFile(bundleURL, "utf8")
  const sourceMap = code.match(/\/\/# sourceMappingURL=([^\s]+)\s*$/)
  assert.ok(sourceMap, "bundle must end with a sourceMappingURL")
  assert.equal(sourceMap[1], "codemirror6.bundle.js.map")

  const map = JSON.parse(await readFile(new URL(sourceMap[1], bundleURL), "utf8"))
  assert.equal(map.version, 3)
  assert.ok(map.sources.includes("codemirror6/index.js"))
  assert.equal(map.sourcesContent.length, map.sources.length)
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
