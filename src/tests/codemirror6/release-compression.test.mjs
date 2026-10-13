import assert from "node:assert/strict"
import {createRequire} from "node:module"
import {mkdtemp, readFile, rm, symlink, writeFile} from "node:fs/promises"
import {EventEmitter} from "node:events"
import {createServer} from "node:http"
import {tmpdir} from "node:os"
import path from "node:path"
import test from "node:test"

const repositoryRoot = new URL("../../../", import.meta.url)
const require = createRequire(import.meta.url)

async function read(relativePath) {
  return readFile(new URL(relativePath, repositoryRoot), "utf8")
}

test("release compression is Brotli-only text quality 11 and retains originals", async () => {
  const compile = await read("compile.js")

  assert.match(compile, /const releaseCompressionOptions = Object\.freeze\(\{[\s\S]*?brotli:\s*true,/)
  assert.match(compile, /const releaseCompressionOptions = Object\.freeze\(\{[\s\S]*?gzip:\s*false,/)
  assert.match(compile, /const releaseCompressionOptions = Object\.freeze\(\{[\s\S]*?brotliParamMode:\s*["']text["'],/)
  assert.match(compile, /const releaseCompressionOptions = Object\.freeze\(\{[\s\S]*?brotliQuality:\s*11,/)
  assert.match(compile, /const releaseCompressionOptions = Object\.freeze\(\{[\s\S]*?removeLarger:\s*false[\s\S]*?\}\)/)
  assert.match(compile, /new Compress\(file, undefined, releaseCompressionOptions\)/)
  assert.match(compile, /glob\.sync\("\.\/bin\/\*\*\/\*\.js"\)/)
  assert.match(compile, /glob\.sync\("\.\/bin\/\*\*\/\*\.html"\)/)
  assert.match(compile, /glob\.sync\("\.\/bin\/\*\*\/\*\.css"\)/)
  assert.match(compile, /glob\.sync\("\.\/bin\/\*\*\/\*\.txt"\)/)
})

test("release build awaits every top-level HTML minification before compression", async () => {
  const compile = await read("compile.js")
  const enumerateHtml = compile.indexOf('const htmlFiles = glob.sync("./bin/*.html")')
  const minifyHtml = compile.indexOf("for (const filename of htmlFiles)", enumerateHtml)
  const awaitMinifyHtml = compile.indexOf("await htmlminify(lines)", minifyHtml)
  const compressFiles = compile.indexOf("new Compress(file, undefined, releaseCompressionOptions)", awaitMinifyHtml)

  assert.ok(enumerateHtml >= 0, "top-level HTML must be enumerated synchronously")
  assert.ok(minifyHtml > enumerateHtml, "every top-level HTML file must be visited")
  assert.ok(awaitMinifyHtml > minifyHtml, "top-level HTML minification must be awaited")
  assert.ok(compressFiles > awaitMinifyHtml, "compression must start after HTML minification")
  assert.doesNotMatch(compile, /glob\("\.\/bin\/\*\.html",\s*\{\},\s*async function/)
})

test("release build owns and rejects every asynchronous pipeline stage", async () => {
  const compile = await read("compile.js")

  assert.match(compile, /function copyDirectory\(source, destination\) \{[\s\S]*?return new Promise\([\s\S]*?reject\(error\)/)
  assert.match(compile, /function inlineResources\(options\) \{[\s\S]*?return new Promise\([\s\S]*?reject\(error\)/)
  assert.match(compile, /function compressPngImages\(\) \{[\s\S]*?return new Promise\([\s\S]*?reject\(error\)/)
  assert.match(compile, /async function main\(\)/)
  assert.match(compile, /await copyDirectory\("\.\/src", "\.\/bin\/"\)/)
  assert.match(compile, /await compressPngImages\(\)/)
  assert.match(compile, /await copyDirectory\("\.\/src\/js", "\.\/bin\/js\/source"\)/)
  assert.equal((compile.match(/await inlineResources\(/g) || []).length, 2)
  assert.match(compile, /await generateFrom\(/)
  assert.match(compile, /await htmlminify\(/)
  assert.match(compile, /await comp\.run\(\)/)
  assert.match(compile, /main\(\)\.catch\(error => \{[\s\S]*?process\.exitCode = 1/)
  assert.doesNotMatch(compile, /return console\.error\(/)

  const outerCopy = compile.indexOf('await copyDirectory("./src", "./bin/")')
  const innerCopy = compile.indexOf('await copyDirectory("./src/js", "./bin/js/source")')
  const sourceInline = compile.indexOf('await inlineResources({fileContent: standaloneRaw, relativeTo: "src/"})')
  const releaseInline = compile.indexOf('await inlineResources({fileContent: releaseStandaloneRaw, relativeTo: "bin/"})')
  const compression = compile.indexOf("await comp.run()")
  const success = compile.indexOf('console.log("Files compressed. All good!")')
  assert.ok(outerCopy >= 0 && innerCopy > outerCopy)
  assert.ok(sourceInline > innerCopy && releaseInline > sourceInline)
  assert.ok(compression > releaseInline && success > compression)
})

test("release build rejects a stale CM6 runtime before changing release state", async () => {
  const compile = await read("compile.js")
  const check = compile.indexOf('path.join(__dirname, "build-codemirror6.js")')
  const checkFlag = compile.indexOf('"--check"', check)
  const buildNumber = compile.indexOf('fs.readFileSync(".build/buildnumber.txt"')
  const removeBin = compile.indexOf('rimraf.sync("./bin")')

  assert.ok(check >= 0, "release must run the deterministic CM6 runtime check")
  assert.ok(checkFlag > check, "release runtime check must use --check")
  assert.ok(check < buildNumber, "runtime check must precede the build-number change")
  assert.ok(check < removeBin, "runtime check must precede deleting bin")
})

test("source Apache rules negotiate Brotli conservatively", async () => {
  const rules = await read("src/.htaccess")
  const acceptEncodingRule = "RewriteCond %{HTTP:Accept-Encoding} \"(^|,)[[:space:]]*br[[:space:]]*(?:;[[:space:]]*q[[:space:]]*=[[:space:]]*(?:1(?:\\.0{0,3})?|0\\.(?:[1-9][0-9]{0,2}|0[1-9][0-9]?|00[1-9]))[[:space:]]*)?(?:,|$)\" [NC]"

  assert.match(rules, /^Options -MultiViews$/m)
  assert.match(rules, /^RewriteEngine On$/m)
  assert.ok(rules.includes(acceptEncodingRule))
  assert.doesNotMatch(rules, /^RewriteCond %\{HTTP:Accept-Encoding\} br \[NC\]$/m)
  assert.match(rules, /^RewriteCond %\{REQUEST_FILENAME\}\.br -f$/m)
  assert.match(rules, /^RewriteRule \^\(\.\+\\\.\(\?:js\|css\|html\|txt\)\)\$ \$1\.br \[L\]$/m)
  assert.match(rules, /^AddEncoding br \.br$/m)
  assert.match(rules, /^Header merge Vary Accept-Encoding$/m)
  assert.match(rules, /^<FilesMatch "\\\.br\$">$/m)
  assert.match(rules, /^\s*Header set Content-Encoding br$/m)
  assert.doesNotMatch(rules, /gzip|\.gz/i)
})

test("release compression has byte and HTTP verification commands", async () => {
  const packageJson = JSON.parse(await read("package.json"))
  const verifier = await read("verify-release-compression.js").catch(() => "")
  const httpSmoke = await read("src/tests/codemirror6/release-compression-http.mjs").catch(() => "")

  assert.equal(packageJson.scripts["verify:release-compression"], "node verify-release-compression.js")
  assert.match(verifier, /brotliDecompressSync/)
  assert.match(verifier, /\.gz/)
  assert.match(verifier, /codemirror6[\\/]runtime[\\/]dist[\\/]codemirror6-runtime\.js\.br/)
  assert.match(verifier, /src[\\/]\.htaccess/)
  assert.match(verifier, /bin[\\/]\.htaccess/)
  assert.ok(verifier.includes('`RewriteCond %{HTTP:Accept-Encoding} "(^|,)[[:space:]]*br'))
  assert.doesNotMatch(verifier, /"RewriteCond %\{HTTP:Accept-Encoding\} br \[NC\]"/)
  assert.match(httpSmoke, /PS_RELEASE_URL/)
  assert.match(httpSmoke, /PS_RELEASE_MISSING_SIDECAR_PATH/)
  assert.match(httpSmoke, /Accept-Encoding/)
  assert.match(httpSmoke, /Content-Encoding/)
  assert.match(httpSmoke, /Vary/)
  assert.match(httpSmoke, /\.js/)
  assert.match(httpSmoke, /\.css/)
  assert.match(httpSmoke, /\.html/)
  assert.match(httpSmoke, /\.txt/)
  assert.doesNotMatch(httpSmoke, /\.ico/)
  assert.match(httpSmoke, /br;q=0\.5/)
  assert.match(httpSmoke, /br;q=0/)
  assert.match(httpSmoke, /x-br/)
  assert.match(httpSmoke, /zebra/)
})

test("release verifier can be imported without running the release gate", async () => {
  const verifier = await read("verify-release-compression.js")

  assert.match(verifier, /if \(require\.main === module\)/)
  assert.match(verifier, /module\.exports = \{filesUnder, verifyReleaseCompression\}/)
})

test("release verifier rejects symlinks before classifying release files", async () => {
  const {filesUnder} = require("../../../verify-release-compression.js")

  for (const linkName of ["alias.js", "alias.gz", "alias.br"]) {
    const directory = await mkdtemp(path.join(tmpdir(), "puzzlescript-release-verifier-"))
    try {
      await writeFile(path.join(directory, "original.js"), "original bytes")
      await symlink("original.js", path.join(directory, linkName))
      assert.throws(
        () => filesUnder(directory),
        error => error.message.includes("Release contains forbidden symlink") && error.message.includes(linkName)
      )
    } finally {
      await rm(directory, {recursive: true, force: true})
    }
  }
})

test("HTTP release smoke uses an importable request helper", async () => {
  const httpSmoke = await read("src/tests/codemirror6/release-compression-http.mjs")
  const httpClient = await read("src/tests/codemirror6/release-http-client.mjs").catch(() => "")

  assert.match(httpSmoke, /import \{request\} from "\.\/release-http-client\.mjs"/)
  assert.match(httpClient, /export function request\(/)
  assert.match(httpClient, /outgoingRequest\.setTimeout\(0\)/)
})

test("HTTP response collection is independently testable", async () => {
  const httpClient = await import("./release-http-client.mjs")

  assert.equal(typeof httpClient.readResponse, "function")
})

test("HTTP response collection rejects aborted, errored, and early-closed responses", async () => {
  const {readResponse} = await import("./release-http-client.mjs")
  const cases = [
    {event: "aborted", error: undefined, expected: /HTTP response was aborted/},
    {event: "error", error: new Error("response failed"), expected: /response failed/},
    {event: "close", error: undefined, expected: /HTTP response closed before end/}
  ]

  for (const testCase of cases) {
    const response = new EventEmitter()
    response.statusCode = 200
    response.headers = {}
    response.on("error", () => {})
    const collected = readResponse(response)
    response.emit(testCase.event, testCase.error)

    let watchdog
    try {
      await assert.rejects(
        Promise.race([
          collected,
          new Promise((resolve, reject) => {
            watchdog = setTimeout(() => reject(new Error("HTTP collection remained pending")), 50)
          })
        ]),
        testCase.expected
      )
    } finally {
      clearTimeout(watchdog)
    }
  }
})

test("HTTP request rejects when its deadline expires", async () => {
  const {request} = await import("./release-http-client.mjs")
  const server = createServer(() => {})
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })

  let watchdog
  try {
    const address = server.address()
    const pending = request(new URL(`http://127.0.0.1:${address.port}/pending`), "identity", {timeoutMs: 25})
    await assert.rejects(
      Promise.race([
        pending,
        new Promise((resolve, reject) => {
          watchdog = setTimeout(() => {
            server.closeAllConnections()
            reject(new Error("HTTP request remained pending"))
          }, 100)
        })
      ]),
      /HTTP request timed out after 25 ms/
    )
  } finally {
    clearTimeout(watchdog)
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
