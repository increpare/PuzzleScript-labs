#!/usr/bin/env node
"use strict"

const fs = require("fs")
const path = require("path")
const esbuild = require("esbuild")

const root = __dirname
const bundlePath = path.join(root, "src/js/codemirror6.bundle.js")
const mapPath = bundlePath + ".map"
const check = process.argv.includes("--check")

function normalizeJavaScript(contents) {
  return Buffer.from(Buffer.from(contents).toString("utf8").replace(/[ \t]+$/gm, ""))
}

async function build() {
  const result = await esbuild.build({
    absWorkingDir: root,
    entryPoints: ["src/js/codemirror6/index.js"],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome110", "firefox110", "safari16", "edge110"],
    minify: true,
    sourcemap: "linked",
    sourcesContent: true,
    outfile: "src/js/codemirror6.bundle.js",
    write: false,
    legalComments: "eof"
  })
  const js = normalizeJavaScript(result.outputFiles.find(file => file.path === bundlePath).contents)
  const map = result.outputFiles.find(file => file.path === mapPath).contents
  if (check) {
    if (!fs.existsSync(bundlePath) || !fs.existsSync(mapPath) ||
        !fs.readFileSync(bundlePath).equals(js) || !fs.readFileSync(mapPath).equals(map)) {
      throw new Error("CodeMirror bundle is stale; run npm run build:codemirror")
    }
  } else {
    fs.writeFileSync(bundlePath, js)
    fs.writeFileSync(mapPath, map)
  }
}

build().catch(error => {
  console.error(error.message || error)
  process.exitCode = 1
})
