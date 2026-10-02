import {mkdir, readFile, writeFile} from "node:fs/promises"
import path from "node:path"
import {fileURLToPath, pathToFileURL} from "node:url"

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(testDirectory, "../../..")
const inputPath = path.join(root, "src/editor.html")
const outputDirectory = path.join(root, "src/tests/codemirror6/generated")
const outputPath = path.join(outputDirectory, "cm5-editor.html")
const cm6OutputPath = path.join(outputDirectory, "cm6-performance-editor.html")
const legacyProofOutputPath = path.join(outputDirectory, "cm6-legacy-css-proof.html")

const performanceErrorCaptureScript = `<script data-puzzlescript-performance-error-capture>
(function () {
  "use strict";
  const errors = [];

  function serialize(value) {
    if (value && typeof value === "object") {
      let name = "";
      let message = "";
      try {
        if (typeof value.name === "string") name = value.name;
      } catch (_) {}
      try {
        if (typeof value.message === "string") message = value.message;
      } catch (_) {}
      if (name || message) return name && message ? name + ": " + message : name || message;
      try {
        const json = JSON.stringify(value);
        if (json !== undefined) return json;
      } catch (_) {}
    }
    try {
      return String(value);
    } catch (_) {
      return "[unserializable error]";
    }
  }

  function record(type, value) {
    const error = type + ": " + serialize(value);
    if (errors.indexOf(error) === -1) errors.push(error);
  }

  Object.defineProperty(window, "__puzzleScriptPerformanceErrors", {
    configurable: false,
    enumerable: false,
    value: errors,
    writable: false
  });
  window.addEventListener("error", function (event) {
    record("error", event.error || event.message);
  });
  window.addEventListener("unhandledrejection", function (event) {
    record("unhandledrejection", event.reason);
  });
})();
</script>`

const performanceErrorCapturePattern =
  /\s*<script\s+data-puzzlescript-performance-error-capture>[\s\S]*?<\/script>/gi

const cm5LegacyStylesheets = Object.freeze([
  "codemirror.css",
  "midnight.css",
  "dialog.css",
  "show-hint.css"
])

const cm5ScriptWhitelist = [
  "js/Blob.js",
  "js/FileSaver.js",
  "js/jsgif/LZWEncoder.js",
  "js/jsgif/NeuQuant.js",
  "js/jsgif/GIFEncoder.js",
  "js/storagewrapper.js",
  "js/debug.js",
  "js/bitvec.js",
  "js/level.js",
  "js/languageConstants.js",
  "js/globalVariables.js",
  "js/font.js",
  "js/rng.js",
  "js/riffwave.js",
  "js/sfxr.js",
  "js/colorhelpers.js",
  "js/codemirror/codemirror.js",
  "js/codemirror/panel.js",
  "js/codemirror/active-line.js",
  "js/codemirror/dialog.js",
  "js/codemirror/searchcursor.js",
  "js/codemirror/search.js",
  "js/codemirror/match-highlighter.js",
  "js/codemirror/show-hint.js",
  "js/codemirror/rule-transform.js",
  "js/puzzlescript-autocomplete.js",
  "js/codemirror/anyword-hint.js",
  "js/codemirror/comment.js",
  "js/colors.js",
  "js/graphics.js",
  "js/mobile.js",
  "js/inputoutput.js",
  "js/console.js",
  "js/buildStandalone.js",
  "js/engine.js",
  "js/parser.js",
  "js/github.js",
  "js/imagepaste.js",
  "js/editor-api.js",
  "js/editor-cm5.js",
  "js/editor.js",
  "js/compiler.js",
  "js/soundbar.js",
  "js/toolbar.js",
  "js/layout.js",
  "js/addlisteners.js",
  "js/addlisteners_editor.js",
  "js/makegif.js"
]

function injectCM5LegacyStylesheets(input) {
  let output = input
  for (const stylesheet of cm5LegacyStylesheets) {
    const pattern = new RegExp(
      `\\s*<link\\b(?=[^>]*\\bhref\\s*=\\s*["']css/${stylesheet.replace(".", "\\.")}["'])[^>]*\\/?>`,
      "gi"
    )
    output = output.replace(pattern, "")
  }

  output = output.replace(
    /(<link\b(?=[^>]*\bhref\s*=\s*["']css\/docs\.css["'])[^>]*\/?>)/i,
    '$1\n<link rel="stylesheet" href="css/codemirror.css">\n' +
      '<link rel="stylesheet" href="css/midnight.css">\n' +
      '<link rel="stylesheet" href="css/dialog.css">'
  )
  return output.replace(
    /(<link\b(?=[^>]*\bhref\s*=\s*["']css\/toolbar\.css["'])[^>]*\/?>)/i,
    '$1\n<link rel="stylesheet" href="css/show-hint.css">'
  )
}

export function transformCM6LegacyCssProofHtml(input) {
  const output = injectCM5LegacyStylesheets(input)
    .replace(/\s*<base\s+href=["'][^"']*["']\s*\/?>/gi, "")
  return output.replace(/<head>/i, '<head>\n<base href="../../../">')
}

function injectPerformanceErrorCapture(input) {
  const output = input
    .replace(performanceErrorCapturePattern, "")
    .replace(/\s*<base\s+href=["'][^"']*["']\s*\/?>/gi, "")
  return output.replace(
    /<head>/i,
    `<head>\n<base href="../../../">\n${performanceErrorCaptureScript}`
  )
}

export function transformCM6PerformanceHtml(input) {
  return injectPerformanceErrorCapture(input)
}

export function transformCM5ComparisonHtml(input) {
  let output = injectCM5LegacyStylesheets(input)
    .replace(performanceErrorCapturePattern, "")
    .replace(/\s*<base\s+href=["'][^"']*["']\s*\/?>/gi, "")
    .replace(/\s*<link\b(?=[^>]*\bhref\s*=\s*["']css\/editor-cm6\.css["'])[^>]*\/?>/gi, "")

  output = output.replace(/\s*<script\b(?=[^>]*\ssrc\s*=)[^>]*>[\s\S]*?<\/script\s*>/gi, "")

  output = output.replace(
    /<head>/i,
    `<head>\n<base href="../../../">\n${performanceErrorCaptureScript}`
  )

  const scriptMarker = "<!--___SCRIPTINSERT___-->"
  if (!output.includes(scriptMarker)) throw new Error("CM5 comparison source is missing script marker")
  const scripts = cm5ScriptWhitelist
    .map(script => `<script src="${script}"></script>`)
    .join("\n")
  output = output.replace(scriptMarker, `${scriptMarker}\n${scripts}`)

  return output
}

export async function buildPerformancePages() {
  const input = await readFile(inputPath, "utf8")
  const output = transformCM5ComparisonHtml(input)
  const cm6Output = transformCM6PerformanceHtml(input)
  const legacyProof = transformCM6LegacyCssProofHtml(input)
  await mkdir(outputDirectory, {recursive: true})
  await writeFile(outputPath, output)
  await writeFile(cm6OutputPath, cm6Output)
  await writeFile(legacyProofOutputPath, legacyProof)
  return outputPath
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildPerformancePages().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
