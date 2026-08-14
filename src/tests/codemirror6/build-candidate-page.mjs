import {mkdir, readFile, writeFile} from "node:fs/promises"
import path from "node:path"
import {fileURLToPath, pathToFileURL} from "node:url"

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(testDirectory, "../../..")
const inputPath = path.join(root, "src/editor.html")
const outputDirectory = path.join(root, "src/tests/codemirror6/generated")
const outputPath = path.join(outputDirectory, "editor.html")

const candidateStyles = [
  "css/editor-cm6.css",
  "css/editor-theme.css"
]

const removedScripts = [
  "js/codemirror/codemirror.js",
  "js/codemirror/panel.js",
  "js/codemirror/active-line.js",
  "js/codemirror/dialog.js",
  "js/codemirror/searchcursor.js",
  "js/codemirror/search.js",
  "js/codemirror/match-highlighter.js",
  "js/codemirror/show-hint.js",
  "js/codemirror/anyword-hint.js",
  "js/codemirror/comment.js",
  "js/codemirror6.bundle.js",
  "js/editor-cm5.js",
  "js/editor-cm6.js"
]

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function transformCandidateHtml(input) {
  let output = input.replace(/\s*<base\s+href=["'][^"']*["']\s*\/?>/gi, "")
  for (const stylesheet of candidateStyles) {
    const pattern = new RegExp(
      `\\s*<link\\s+rel=["']stylesheet["']\\s+href=["']${escapeRegExp(stylesheet)}["']\\s*\\/?>`,
      "gi"
    )
    output = output.replace(pattern, "")
  }
  for (const script of removedScripts) {
    const pattern = new RegExp(
      `\\s*<script\\s+src=["']${escapeRegExp(script)}["']\\s*><\\/script>`,
      "gi"
    )
    output = output.replace(pattern, "")
  }

  output = output.replace(/<head>/i, [
    "<head>",
    '<base href="../../../">',
    ...candidateStyles.map(stylesheet => `<link rel="stylesheet" href="${stylesheet}">`)
  ].join("\n"))
  const sharedEditor = '<script src="js/editor.js"></script>'
  const candidateScripts = [
    '<script src="js/codemirror6.bundle.js"></script>',
    '<script src="js/editor-cm6.js"></script>',
    sharedEditor
  ].join("\n")
  if (!output.includes(sharedEditor)) throw new Error("Candidate source is missing js/editor.js")
  return output.replace(sharedEditor, candidateScripts)
}

export async function buildCandidatePage() {
  const input = await readFile(inputPath, "utf8")
  const output = transformCandidateHtml(input)
  await mkdir(outputDirectory, {recursive: true})
  await writeFile(outputPath, output)
  return outputPath
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildCandidatePage().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
