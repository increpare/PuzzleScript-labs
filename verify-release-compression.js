#!/usr/bin/env node
"use strict"

const fs = require("fs")
const path = require("path")
const {brotliDecompressSync} = require("zlib")

const binDir = path.join(__dirname, "bin")
const bundleSidecar = path.join(binDir, "js/source/codemirror6.bundle.js.br")
const sourceApacheRules = path.join(__dirname, "src/.htaccess")
const generatedApacheRules = path.join(__dirname, "bin/.htaccess")
const requiredApacheRules = [
  String.raw`RewriteCond %{HTTP:Accept-Encoding} "(^|,)[[:space:]]*br[[:space:]]*(?:;[[:space:]]*q[[:space:]]*=[[:space:]]*(?:1(?:\.0{0,3})?|0\.(?:[1-9][0-9]{0,2}|0[1-9][0-9]?|00[1-9]))[[:space:]]*)?(?:,|$)" [NC]`,
  "RewriteCond %{REQUEST_FILENAME}.br -f",
  "AddEncoding br .br",
  "Header merge Vary Accept-Encoding",
  "Header set Content-Encoding br"
]

function filesUnder(directory) {
  const files = []
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error(`Release contains forbidden symlink: ${entryPath}`)
    } else if (entry.isDirectory()) {
      files.push(...filesUnder(entryPath))
    } else if (entry.isFile()) {
      files.push(entryPath)
    }
  }
  return files
}

function verifyReleaseCompression() {
  if (!fs.existsSync(binDir)) {
    throw new Error(`Release directory is missing: ${binDir}`)
  }

  if (!fs.existsSync(generatedApacheRules)) {
    throw new Error(`Generated Apache rules are missing: ${generatedApacheRules}`)
  }
  const sourceApacheBytes = fs.readFileSync(sourceApacheRules)
  const generatedApacheBytes = fs.readFileSync(generatedApacheRules)
  if (!sourceApacheBytes.equals(generatedApacheBytes)) {
    throw new Error("Generated bin/.htaccess does not byte-match src/.htaccess")
  }
  const apacheRules = generatedApacheBytes.toString("utf8")
  for (const rule of requiredApacheRules) {
    if (!apacheRules.includes(rule)) {
      throw new Error(`Generated bin/.htaccess is missing rule: ${rule}`)
    }
  }

  const files = filesUnder(binDir)
  const gzipFiles = files.filter(file => file.endsWith(".gz"))
  if (gzipFiles.length > 0) {
    throw new Error(`Release contains forbidden gzip sidecars: ${gzipFiles.join(", ")}`)
  }

  const brotliFiles = files.filter(file => file.endsWith(".br"))
  if (brotliFiles.length === 0) {
    throw new Error("Release contains no Brotli sidecars")
  }

  for (const sidecar of brotliFiles) {
    const original = sidecar.slice(0, -3)
    if (!fs.existsSync(original) || !fs.statSync(original).isFile()) {
      throw new Error(`Brotli sidecar has no original: ${sidecar}`)
    }

    const originalBytes = fs.readFileSync(original)
    const decompressedBytes = brotliDecompressSync(fs.readFileSync(sidecar))
    if (!originalBytes.equals(decompressedBytes)) {
      throw new Error(`Brotli sidecar does not match its original: ${sidecar}`)
    }
  }

  if (!brotliFiles.includes(bundleSidecar)) {
    throw new Error(`Checked CodeMirror bundle sidecar is missing: ${bundleSidecar}`)
  }
  const bundleSize = fs.statSync(bundleSidecar).size
  if (bundleSize >= 100 * 1024) {
    throw new Error(`${bundleSize} bytes is not below 100 KiB: ${bundleSidecar}`)
  }

  return {brotliFiles: brotliFiles.length, bundleSize}
}

if (require.main === module) {
  try {
    const result = verifyReleaseCompression()
    console.log(`Verified ${result.brotliFiles} Brotli sidecars; CodeMirror bundle is ${result.bundleSize} bytes.`)
  } catch (error) {
    console.error(error.message || error)
    process.exitCode = 1
  }
}

module.exports = {filesUnder, verifyReleaseCompression}
