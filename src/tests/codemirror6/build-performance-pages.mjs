import {mkdir, readFile, writeFile} from "node:fs/promises"
import path from "node:path"
import {fileURLToPath, pathToFileURL} from "node:url"

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(testDirectory, "../../..")
const inputPath = path.join(root, "src/editor.html")
const outputDirectory = path.join(root, "src/tests/codemirror6/generated")
const outputPath = path.join(outputDirectory, "cm5-editor.html")

const cm5Scripts = [
  "js/codemirror/codemirror.js",
  "js/codemirror/panel.js",
  "js/codemirror/active-line.js",
  "js/codemirror/dialog.js",
  "js/codemirror/searchcursor.js",
  "js/codemirror/search.js",
  "js/codemirror/match-highlighter.js",
  "js/codemirror/show-hint.js",
  "js/codemirror/anyword-hint.js",
  "js/codemirror/comment.js"
]

const removedScripts = [
  ...cm5Scripts,
  "js/puzzlescript-stream.js",
  "js/codemirror6.bundle.js",
  "js/editor-cm5.js",
  "js/editor-cm6.js"
]

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function removeScript(source, script) {
  return source.replace(new RegExp(
    `\\s*<script\\s+src=["']${escapeRegExp(script)}["']\\s*><\\/script>`,
    "gi"
  ), "")
}

export function transformCM5ComparisonHtml(input) {
  let output = input
    .replace(/\s*<base\s+href=["'][^"']*["']\s*\/?>/gi, "")
    .replace(/\s*<link\s+rel=["']stylesheet["']\s+href=["']css\/editor-cm6\.css["']\s*\/?>/gi, "")

  for (const script of removedScripts) output = removeScript(output, script)

  output = output.replace(/<head>/i, '<head>\n<base href="../../../">')

  const ruleTransform = '<script src="js/codemirror/rule-transform.js"></script>'
  if (!output.includes(ruleTransform)) {
    throw new Error("CM5 comparison source is missing js/codemirror/rule-transform.js")
  }
  const sharedAutocomplete = '<script src="js/puzzlescript-autocomplete.js"></script>'
  if (!output.includes(sharedAutocomplete)) {
    throw new Error("CM5 comparison source is missing js/puzzlescript-autocomplete.js")
  }
  const beforeAutocomplete = cm5Scripts.slice(0, 8)
    .map(script => `<script src="${script}"></script>`)
    .join("\n")
  const afterAutocomplete = cm5Scripts.slice(8)
    .map(script => `<script src="${script}"></script>`)
    .join("\n")
  output = output.replace(ruleTransform, [beforeAutocomplete, ruleTransform].join("\n"))
  output = output.replace(sharedAutocomplete, [
    sharedAutocomplete,
    afterAutocomplete
  ].join("\n"))

  const sharedEditor = '<script src="js/editor.js"></script>'
  if (!output.includes(sharedEditor)) throw new Error("CM5 comparison source is missing js/editor.js")
  output = output.replace(sharedEditor, [
    '<script src="js/editor-cm5.js"></script>',
    sharedEditor
  ].join("\n"))

  return output
}

export async function buildPerformancePages() {
  const input = await readFile(inputPath, "utf8")
  const output = transformCM5ComparisonHtml(input)
  await mkdir(outputDirectory, {recursive: true})
  await writeFile(outputPath, output)
  return outputPath
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildPerformancePages().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
