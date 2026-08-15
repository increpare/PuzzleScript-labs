import assert from "node:assert/strict"
import {execFileSync} from "node:child_process"
import {readFile} from "node:fs/promises"
import path from "node:path"
import {test} from "node:test"
import {fileURLToPath} from "node:url"

import {pluginPaths, runtimePath} from "./cm6-surface-paths.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

const sourcePath = relative => path.join(root, "src", relative)

function localScripts(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi)]
    .map(match => match[1])
    .filter(source => !/^https?:/i.test(source))
}

function editorInputs(compile) {
  const body = compile.match(/const includesEditor = \[([\s\S]*?)\];\s*await generateFrom/)
  assert.ok(body, "compile.js must expose one literal includesEditor list")
  return [...body[1].matchAll(/["']\.\/src\/(js\/[^"']+)["']/g)].map(match => match[1])
}

function assertContiguous(haystack, needle, label) {
  const start = haystack.indexOf(needle[0])
  assert.notEqual(start, -1, `${label} is missing ${needle[0]}`)
  assert.deepEqual(haystack.slice(start, start + needle.length), needle, `${label} CM6 order`)
}

test("CodeMirror paths make editable, generated, and frozen ownership explicit", async () => {
  const generated = [
    runtimePath,
    runtimePath + ".map"
  ]
  for (const relative of [...generated, ...pluginPaths]) {
    assert.ok((await readFile(sourcePath(relative))).length > 0, relative)
  }

  for (const relative of pluginPaths) {
    const source = await readFile(sourcePath(relative), "utf8")
    assert.doesNotMatch(source, /^\s*(?:import|export)\b/m, relative)
  }

  const attributes = await readFile(path.join(root, ".gitattributes"), "utf8")
  for (const relative of generated) {
    assert.match(attributes, new RegExp(
      relative.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+linguist-generated=true"
    ))
  }

  const cm6Readme = await readFile(sourcePath("js/codemirror6/README.md"), "utf8")
  assert.match(cm6Readme, /plugins\/.*refresh/is)
  assert.match(cm6Readme, /runtime\/source\/.*npm run build:codemirror/is)
  assert.match(cm6Readme, /runtime\/dist\/.*do not edit/is)

  const cm5Readme = await readFile(sourcePath("js/codemirror/README.md"), "utf8")
  assert.match(cm5Readme, /frozen.*comparison oracle/is)
  assert.match(cm5Readme, /explicit review.*baseline/is)
})

test("development and release use one identical ordered CM6 surface", async () => {
  const expected = [runtimePath, ...pluginPaths]
  const html = await readFile(path.join(root, "src/editor.html"), "utf8")
  const compile = await readFile(path.join(root, "compile.js"), "utf8")
  const development = localScripts(html)
  const release = editorInputs(compile)

  assertContiguous(development, expected, "src/editor.html")
  assertContiguous(release, expected, "compile.js")
  assert.ok(development.indexOf(pluginPaths.at(-1)) < development.indexOf("js/editor-api.js"))
  assert.ok(development.indexOf("js/editor-api.js") < development.indexOf("js/editor-cm6.js"))
  assert.ok(release.indexOf(pluginPaths.at(-1)) < release.indexOf("js/editor-api.js"))
  assert.ok(release.indexOf("js/editor-api.js") < release.indexOf("js/editor-cm6.js"))

  const play = compile.match(/const includesPlay = \[([\s\S]*?)\];\s*await generateFrom/)
  assert.ok(play)
  for (const relative of expected) assert.equal(play[1].includes(relative), false, relative)
})

test("the checked dependency tree has one state, view, and language runtime", () => {
  const tree = JSON.parse(execFileSync("npm", ["ls", "--json", "--all"], {
    cwd: root,
    encoding: "utf8"
  }))
  for (const packageName of ["@codemirror/state", "@codemirror/view", "@codemirror/language"]) {
    const versions = new Set()
    const visit = node => {
      const dependency = node.dependencies && node.dependencies[packageName]
      if (dependency && dependency.version) versions.add(dependency.version)
      for (const child of Object.values(node.dependencies || {})) visit(child)
    }
    visit(tree)
    assert.equal(versions.size, 1, `${packageName}: ${[...versions].join(", ")}`)
  }
})
