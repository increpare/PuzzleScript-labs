(function(root) {
  "use strict"

  if (root.PuzzleScriptCM6Plugins) {
    throw new Error("PuzzleScriptCM6Plugins is already installed")
  }
  const runtime = root.PuzzleScriptCM6Runtime
  if (!runtime) {
    throw new Error(
      "Missing PuzzleScriptCM6Runtime; load " +
      "js/codemirror6/runtime/dist/codemirror6-runtime.js before the plugins " +
      "(run npm run build:codemirror if it is missing)"
    )
  }

  const expectedVersions = Object.freeze({
    "@codemirror/autocomplete": "6.20.3",
    "@codemirror/commands": "6.10.4",
    "@codemirror/language": "6.12.4",
    "@codemirror/search": "6.7.1",
    "@codemirror/state": "6.7.1",
    "@codemirror/view": "6.43.8",
    "@lezer/common": "1.5.2",
    "@lezer/highlight": "1.2.3"
  })
  if (!runtime.versions) {
    throw new Error("PuzzleScriptCM6Runtime has no package-version metadata; rebuild it")
  }
  for (const [name, expected] of Object.entries(expectedVersions)) {
    if (runtime.versions[name] !== expected) {
      throw new Error(
        `Unsupported ${name} runtime ${runtime.versions[name] || "missing"}; ` +
        `expected ${expected}. Review the CM6 upgrade and rebuild the runtime.`
      )
    }
  }

  const modules = Object.create(null)
  let sealed = false

  function requireRuntime(names) {
    const selected = Object.create(null)
    for (const name of names) {
      if (!(name in runtime)) {
        throw new Error(
          `PuzzleScriptCM6Runtime is missing export ${name}; add it to ` +
          "runtime/source/index.js and run npm run build:codemirror"
        )
      }
      selected[name] = runtime[name]
    }
    return Object.freeze(selected)
  }

  function requireModule(name) {
    if (!Object.prototype.hasOwnProperty.call(modules, name)) {
      throw new Error(
        `PuzzleScript CM6 plugin dependency ${name} is missing; check the ` +
        "script order in src/editor.html and compile.js"
      )
    }
    return modules[name]
  }

  function define(name, exports) {
    if (sealed) throw new Error(`PuzzleScript CM6 plugin host is sealed; cannot define ${name}`)
    if (Object.prototype.hasOwnProperty.call(modules, name)) {
      throw new Error(`PuzzleScript CM6 plugin ${name} is already defined`)
    }
    modules[name] = Object.freeze(exports)
  }

  function seal() {
    sealed = true
    Object.freeze(modules)
  }

  root.PuzzleScriptCM6Plugins = Object.freeze({
    define,
    require: requireModule,
    requireRuntime,
    seal
  })
})(globalThis)
