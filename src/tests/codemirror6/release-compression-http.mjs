#!/usr/bin/env node

import assert from "node:assert/strict"
import {brotliDecompressSync} from "node:zlib"
import {request} from "./release-http-client.mjs"

const releaseUrl = process.env.PS_RELEASE_URL
if (!releaseUrl) {
  throw new Error("PS_RELEASE_URL is required")
}
const missingSidecarPath = process.env.PS_RELEASE_MISSING_SIDECAR_PATH
if (!missingSidecarPath || !/\.(?:js|css|html|txt)$/.test(missingSidecarPath)) {
  throw new Error("PS_RELEASE_MISSING_SIDECAR_PATH must name an existing lowercase js/css/html/txt resource whose .br sidecar is absent")
}
const baseUrl = new URL(releaseUrl.endsWith("/") ? releaseUrl : `${releaseUrl}/`)

const resources = [
  {path: "js/scripts_compiled.js", mime: /^(?:application|text)\/javascript$/},
  {path: "css/combined.css", mime: /^text\/css$/},
  {path: "editor.html", mime: /^text\/html$/},
  {path: "standalone_inlined.txt", mime: /^text\/plain$/}
]

function requestRelease(relativePath, acceptEncoding) {
  return request(new URL(relativePath, baseUrl), acceptEncoding)
}

function header(response, name) {
  const value = response.headers[name.toLowerCase()]
  return Array.isArray(value) ? value.join(", ") : value
}

function assertVary(response, description) {
  const vary = header(response, "Vary") || ""
  const fields = vary.split(",").map(field => field.trim().toLowerCase())
  assert.ok(fields.includes("accept-encoding"), `${description} must vary on Accept-Encoding`)
}

for (const resource of resources) {
  const [brotli, identity] = await Promise.all([
    requestRelease(resource.path, "br"),
    requestRelease(resource.path, "identity")
  ])

  assert.equal(brotli.statusCode, 200, `${resource.path} Brotli status`)
  assert.equal(identity.statusCode, 200, `${resource.path} identity status`)
  assert.equal(header(brotli, "Content-Encoding"), "br", `${resource.path} Brotli encoding`)
  assert.equal(header(identity, "Content-Encoding"), undefined, `${resource.path} identity encoding`)
  assertVary(brotli, `${resource.path} Brotli response`)
  assertVary(identity, `${resource.path} identity response`)

  const brotliType = (header(brotli, "Content-Type") || "").split(";", 1)[0].trim().toLowerCase()
  const identityType = (header(identity, "Content-Type") || "").split(";", 1)[0].trim().toLowerCase()
  assert.equal(brotliType, identityType, `${resource.path} MIME preservation`)
  assert.match(identityType, resource.mime, `${resource.path} MIME type`)
  assert.deepEqual(brotliDecompressSync(brotli.body), identity.body, `${resource.path} response bytes`)
}

const negotiationPath = resources[0].path
const negotiationIdentity = await requestRelease(negotiationPath, "identity")
const positiveQuality = await requestRelease(negotiationPath, "gzip, br;q=0.5")
assert.equal(header(positiveQuality, "Content-Encoding"), "br", "positive Brotli quality encoding")
assert.deepEqual(brotliDecompressSync(positiveQuality.body), negotiationIdentity.body, "positive Brotli quality bytes")
assertVary(positiveQuality, "positive Brotli quality response")

for (const acceptEncoding of ["br;q=0", "x-br", "zebra"]) {
  const raw = await requestRelease(negotiationPath, acceptEncoding)
  assert.equal(raw.statusCode, 200, `${acceptEncoding} status`)
  assert.equal(header(raw, "Content-Encoding"), undefined, `${acceptEncoding} must stay raw`)
  assert.deepEqual(raw.body, negotiationIdentity.body, `${acceptEncoding} raw bytes`)
  assertVary(raw, `${acceptEncoding} response`)
}

const [missingBrotli, missingIdentity] = await Promise.all([
  requestRelease(missingSidecarPath, "br"),
  requestRelease(missingSidecarPath, "identity")
])
assert.equal(missingBrotli.statusCode, 200, "missing-sidecar Brotli status")
assert.equal(missingIdentity.statusCode, 200, "missing-sidecar identity status")
assert.equal(header(missingBrotli, "Content-Encoding"), undefined, "missing sidecar must fall back raw")
assert.deepEqual(missingBrotli.body, missingIdentity.body, "missing-sidecar raw bytes")
assertVary(missingBrotli, "missing-sidecar Brotli response")
assertVary(missingIdentity, "missing-sidecar identity response")

console.log("Release Brotli HTTP negotiation, MIME preservation, Vary, and raw fallback verified.")
