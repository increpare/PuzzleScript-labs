import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import test from "node:test"
import {brotliCompressSync, constants} from "node:zlib"
import {minify} from "terser"

import {pluginPaths, runtimePath} from "./cm6-surface-paths.mjs"

const sourceURL = relative => new URL(`../../${relative}`, import.meta.url)

test("checked-in CM6 runtime exposes only the curated runtime namespace", async () => {
  const code = await readFile(sourceURL(runtimePath), "utf8")
  assert.match(code, /PuzzleScriptCM6Runtime/)
  assert.doesNotMatch(code, /PuzzleScriptCM6\s*=/)
  assert.doesNotMatch(code, /window\.CodeMirror\s*=/)
  assert.doesNotMatch(code, /[ \t]+$/m)
})

test("checked-in CM6 runtime links its discoverable matching source map", async () => {
  const bundleURL = sourceURL(runtimePath)
  const code = await readFile(bundleURL, "utf8")
  const sourceMap = code.match(/\/\/# sourceMappingURL=([^\s]+)\s*$/)
  assert.ok(sourceMap, "bundle must end with a sourceMappingURL")
  assert.equal(sourceMap[1], "codemirror6-runtime.js.map")

  const map = JSON.parse(await readFile(new URL(sourceMap[1], bundleURL), "utf8"))
  assert.equal(map.version, 3)
  assert.ok(map.sources.some(source => source.endsWith("/source/index.js")))
  assert.ok(
    map.sources.every(source => !source.includes("/plugins/")),
    "directly editable plugins must stay outside the generated runtime graph"
  )
  assert.equal(map.sourcesContent.length, map.sources.length)
})

test("release-equivalent runtime plus plugins is below 100 KiB at Brotli text quality 11", async () => {
  const files = Object.create(null)
  for (const relative of [runtimePath, ...pluginPaths]) {
    files[`source/${relative}`] = await readFile(sourceURL(relative), "utf8")
  }
  const result = await minify(files)
  assert.equal(typeof result.code, "string")
  const brotli = brotliCompressSync(Buffer.from(result.code), {
    params: {
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      [constants.BROTLI_PARAM_QUALITY]: 11
    }
  })

  assert.ok(brotli.length < 100 * 1024, `${brotli.length} bytes is not below 100 KiB`)
})
