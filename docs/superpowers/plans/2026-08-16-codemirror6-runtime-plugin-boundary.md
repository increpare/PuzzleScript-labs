# CodeMirror 6 Runtime and Plugin Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quarantine generated CodeMirror 6 dependency code, make PuzzleScript-owned CM6 plugins directly editable with refresh-only development, and preserve the single-script release editor.

**Architecture:** esbuild will bundle only exact pinned CodeMirror/Lezer packages and a small export shim into `src/js/codemirror6/runtime/dist/`. PuzzleScript integration modules will become ordered classic IIFEs under `src/js/codemirror6/plugins/`, sharing one guarded plugin host and publishing the unchanged `PuzzleScriptCM6` public API. Development loads the runtime and plugins separately; `compile.js` checks the runtime and then gives Terser the same ordered files to produce one release payload.

**Tech Stack:** JavaScript, Node.js test runner, esbuild, Terser, CodeMirror 6 `StreamLanguage`, Playwright, Brotli.

---

## File map

- `build-codemirror6.js`: build/check only the generated third-party runtime and linked map.
- `src/js/codemirror6/runtime/source/index.js`: the only hand-edited esbuild entry; exports a frozen curated CM6 namespace.
- `src/js/codemirror6/runtime/dist/*`: generated browser runtime and source map; never hand-edit.
- `src/js/codemirror6/plugins/bootstrap.js`: validates runtime versions/exports and owns the one internal plugin-module registry.
- `src/js/codemirror6/plugins/*.js`: directly loaded PuzzleScript-owned integration modules.
- `src/js/codemirror6/plugins/index.js`: constructs the editor and publishes the existing frozen `PuzzleScriptCM6` API.
- `src/tests/codemirror6/plugin-test-support.mjs`: loads the real generated runtime plus ordered classic plugins for Node unit tests.
- `src/tests/codemirror6/runtime-plugin-boundary.test.mjs`: static ownership, ordering, dependency, build, and release-size contracts.
- `src/editor.html`, `compile.js`, candidate/performance builders: development and release script ordering.
- README files and `.gitattributes`: visible generated/frozen ownership markings.

### Task 1: Pin the ownership and ordering contract in failing tests

**Files:**
- Create: `src/tests/codemirror6/runtime-plugin-boundary.test.mjs`
- Modify: `src/tests/codemirror6/bundle.test.mjs`
- Test: `src/tests/codemirror6/runtime-plugin-boundary.test.mjs`

- [ ] **Step 1: Add the expected path and ownership assertions**

Define these exact ordered paths in the test:

```js
const runtimePath = "js/codemirror6/runtime/dist/codemirror6-runtime.js"
const pluginPaths = [
  "js/codemirror6/plugins/bootstrap.js",
  "js/codemirror6/plugins/style-token.js",
  "js/codemirror6/plugins/dynamic-colors.js",
  "js/codemirror6/plugins/exact-prefix.js",
  "js/codemirror6/plugins/stream-language.js",
  "js/codemirror6/plugins/stream-state.js",
  "js/codemirror6/plugins/token-presentation.js",
  "js/codemirror6/plugins/autocomplete.js",
  "js/codemirror6/plugins/commands.js",
  "js/codemirror6/plugins/interactions.js",
  "js/codemirror6/plugins/search.js",
  "js/codemirror6/plugins/editor-adapter.js",
  "js/codemirror6/plugins/index.js"
]
```

Assert that all paths exist, plugin files contain neither static `import` nor `export`, the runtime begins with the generated banner, the map is linked and contains `runtime/source/index.js`, and README/.gitattributes markings contain the exact edit/build guidance.

- [ ] **Step 2: Assert development and release order**

Extract local script `src` values from `src/editor.html`. Extract the quoted `./src/js/...` entries from `includesEditor` in `compile.js`. Assert that both contain `[runtimePath, ...pluginPaths]` as one identical contiguous sequence before `editor-api.js` and `editor-cm6.js`.

- [ ] **Step 3: Replace the old all-in-one size assertion**

Read the runtime plus plugin sources in order, minify the named inputs with the same Terser settings used by `compile.js`, Brotli-compress at text quality 11, and require the combined CM6 surface—not the smaller runtime alone—to remain below 100 KiB.

- [ ] **Step 4: Run RED**

Run:

```bash
node --test src/tests/codemirror6/runtime-plugin-boundary.test.mjs src/tests/codemirror6/bundle.test.mjs
```

Expected: FAIL because the new directories, runtime banner, direct plugin scripts, and combined-surface contract do not exist.

- [ ] **Step 5: Commit the RED contract**

```bash
git add src/tests/codemirror6/runtime-plugin-boundary.test.mjs src/tests/codemirror6/bundle.test.mjs
git commit -m "test: define CodeMirror runtime boundary"
```

### Task 2: Extract the generated third-party runtime

**Files:**
- Create: `src/js/codemirror6/runtime/source/index.js`
- Create: `src/js/codemirror6/runtime/README.md`
- Create: `src/js/codemirror6/runtime/dist/README.md`
- Create: `src/js/codemirror6/runtime/dist/codemirror6-runtime.js`
- Create: `src/js/codemirror6/runtime/dist/codemirror6-runtime.js.map`
- Modify: `build-codemirror6.js`
- Delete: `src/js/codemirror6.bundle.js`
- Delete: `src/js/codemirror6.bundle.js.map`

- [ ] **Step 1: Create the curated runtime source**

Import every currently used symbol from the exact pinned `@codemirror/*` and `@lezer/*` packages. Publish only those symbols plus generated `versions` metadata:

```js
const runtime = Object.freeze({
  versions: Object.freeze(__PUZZLESCRIPT_CM6_VERSIONS__),
  acceptCompletion, autocompletion, closeCompletion, completionStatus,
  currentCompletions, moveCompletionSelection, setSelectedCompletion,
  startCompletion,
  // all currently imported command, language, search, state, view and Lezer symbols
})

if (globalThis.PuzzleScriptCM6Runtime) {
  throw new Error("PuzzleScriptCM6Runtime is already installed")
}
globalThis.PuzzleScriptCM6Runtime = runtime
```

The source must contain no PuzzleScript parser, command, autocomplete, presentation, or editor-construction behavior.

- [ ] **Step 2: Retarget the deterministic builder**

Change the entry/output to:

```js
entryPoints: ["src/js/codemirror6/runtime/source/index.js"]
outfile: "src/js/codemirror6/runtime/dist/codemirror6-runtime.js"
banner: {js: "/*! GENERATED by npm run build:codemirror — DO NOT EDIT. */"}
define: {__PUZZLESCRIPT_CM6_VERSIONS__: JSON.stringify(packageVersions)}
```

Keep IIFE/browser/minification/linked-source-map/deterministic normalization. In `--check`, compare both new artifacts byte-for-byte and retain the existing stale-runtime error.

- [ ] **Step 3: Generate the runtime**

Run:

```bash
npm run build:codemirror
npm run check:codemirror
```

Expected: both commands exit 0; the runtime starts with the generated banner and ends with `//# sourceMappingURL=codemirror6-runtime.js.map`.

- [ ] **Step 4: Run the focused bundle tests**

Run the Task 1 command. Expected: runtime/path assertions advance to failures about missing plugins and old load order; deterministic map assertions pass.

- [ ] **Step 5: Commit the runtime extraction**

Stage only the builder, runtime source/dist/readmes, old bundle deletions, and tests. Commit:

```bash
git commit -m "build: isolate the CodeMirror runtime"
```

### Task 3: Convert PuzzleScript modules to direct classic plugins

**Files:**
- Create: `src/js/codemirror6/plugins/bootstrap.js`
- Move/modify: all current `src/js/codemirror6/{style-token,dynamic-colors,exact-prefix,stream-language,stream-state,token-presentation,autocomplete,commands,interactions,search,editor-adapter,index}.js`
- Create: `src/tests/codemirror6/plugin-test-support.mjs`
- Modify: all Node tests that directly import the old CM6 module paths

- [ ] **Step 1: Implement the guarded plugin host**

`bootstrap.js` must fail early when the runtime is absent, version metadata is absent/mismatched, a requested export is missing, a dependency module is missing, or a module is defined twice. It publishes one frozen host:

```js
globalThis.PuzzleScriptCM6Plugins = Object.freeze({
  requireRuntime(names) { /* return a named frozen object or throw with build guidance */ },
  require(name) { /* return a prior frozen module or throw with script-order guidance */ },
  define(name, exports) { /* add one frozen module before sealing */ },
  seal() { /* prevent later definitions */ }
})
```

The exact expected package versions match `package.json`; the private StreamLanguage contract remains explicitly pinned to `@codemirror/language` 6.12.4.

- [ ] **Step 2: Mechanically wrap every plugin**

For each plugin, remove ESM imports/exports without changing its function bodies. Use this exact pattern:

```js
(function(host) {
  "use strict"
  const {EditorView} = host.requireRuntime(["EditorView"])
  const {exactPrefix} = host.require("exact-prefix")

  // Existing implementation, unchanged except removal of `export`.

  host.define("module-name", {
    publicFunction,
    publicConstant
  })
})(globalThis.PuzzleScriptCM6Plugins)
```

Use this dependency order: bootstrap; style-token; dynamic-colors; exact-prefix; stream-language; stream-state; token-presentation; autocomplete; commands; interactions; search; editor-adapter; index. `index.js` consumes the prior modules, seals the host, and publishes `globalThis.PuzzleScriptCM6 = Object.freeze({createEditor})`.

- [ ] **Step 3: Add a real-runtime Node loader**

`plugin-test-support.mjs` imports the generated runtime for side effects, then imports every plugin in browser order. It reads modules through `PuzzleScriptCM6Plugins.require` and re-exports the same named functions/constants currently imported by unit tests. This keeps tests focused on the exact direct-load files rather than a second ESM implementation.

- [ ] **Step 4: Update unit imports and run GREEN**

Replace imports from `../../js/codemirror6/*.js` with named imports from `./plugin-test-support.mjs`. Retain direct package imports used to construct CM6 test states. Run all non-protected CM6 unit tests:

```bash
node --test $(find src/tests/codemirror6 -maxdepth 1 -name '*.test.mjs' ! -name 'candidate-page.test.mjs' -print)
```

Expected: all tests pass and the protected malformed candidate test is not read or changed.

- [ ] **Step 5: Commit direct-load plugins**

Stage only plugin moves, loader, and updated unit imports. Commit:

```bash
git commit -m "refactor: make CodeMirror plugins refreshable"
```

### Task 4: Wire development, candidate, performance, and release loading

**Files:**
- Modify: `src/editor.html`
- Modify: `compile.js`
- Modify: `src/tests/codemirror6/build-candidate-page.mjs`
- Modify: `src/tests/codemirror6/build-performance-pages.mjs`
- Modify: `src/tests/codemirror6/performance-harness.test.mjs`
- Modify: `src/tests/codemirror6/release-html.test.mjs`
- Modify: `verify-release-compression.js`
- Modify: `src/tests/codemirror6/release-compression.test.mjs`

- [ ] **Step 1: Load runtime and plugins directly in development**

Replace the single `js/codemirror6.bundle.js` tag in `src/editor.html` with the exact runtime-plus-plugin sequence from Task 1. Keep `editor-api.js`, `editor-cm6.js`, and application scripts after the plugins.

- [ ] **Step 2: Preserve the one-file release**

At the beginning of `compile.js` `main()`, before incrementing the build number or deleting `bin`, run:

```js
execFileSync(process.execPath, [path.join(__dirname, "build-codemirror6.js"), "--check"], {
  stdio: "inherit"
})
```

Replace the old bundle entry in `includesEditor` with the same exact runtime-plus-plugin sequence. Do not add any CM6 path to `includesPlay`.

- [ ] **Step 3: Update generated-page transforms**

Candidate generation removes any prior runtime/plugin/old-bundle tags, then inserts one exact current sequence before `editor-api.js`/`editor-cm6.js`. Performance CM6 pages inherit that sequence. CM5 transforms remove all of it and continue to inject only the frozen CM5 whitelist.

- [ ] **Step 4: Update release verification paths**

Point the copied-source sidecar check at:

```text
bin/js/source/codemirror6/runtime/dist/codemirror6-runtime.js.br
```

Verify it exists and round-trips, but keep the below-100-KiB product contract on the runtime-plus-plugin surface test rather than claiming the runtime alone represents editor size.

- [ ] **Step 5: Run focused GREEN gates**

Run:

```bash
node --test src/tests/codemirror6/runtime-plugin-boundary.test.mjs \
  src/tests/codemirror6/bundle.test.mjs \
  src/tests/codemirror6/performance-harness.test.mjs \
  src/tests/codemirror6/release-compression.test.mjs \
  src/tests/codemirror6/release-html.test.mjs
npm run check:codemirror
```

Expected: all pass; static order comparison proves development and release agree; player list has no runtime/plugin path.

- [ ] **Step 6: Commit load/build integration**

```bash
git commit -m "build: load CodeMirror plugins directly"
```

### Task 5: Mark generated, editable, and frozen ownership visibly

**Files:**
- Create: `.gitattributes`
- Create: `src/js/codemirror6/README.md`
- Create: `src/js/codemirror6/plugins/README.md`
- Create: `src/js/codemirror/README.md`
- Modify: `DEVELOPMENT.md`
- Modify: `docs/codemirror6-migration-ledger.md`
- Modify: `docs/codemirror6-performance-report.md`

- [ ] **Step 1: Add exact repository markings**

Mark both runtime artifacts as generated:

```gitattributes
src/js/codemirror6/runtime/dist/codemirror6-runtime.js linguist-generated=true
src/js/codemirror6/runtime/dist/codemirror6-runtime.js.map linguist-generated=true
```

The CM6 README states: edit `plugins/` and refresh; edit `runtime/source/` or dependency pins and run `npm run build:codemirror`; never edit `runtime/dist/`. The CM5 README states that its files are a frozen comparison oracle requiring explicit review and baseline recapture.

- [ ] **Step 2: Document ordinary and exceptional loops**

Add these commands and meanings to `DEVELOPMENT.md`:

```text
Plugin edit: refresh src/editor.html; no Node build.
Runtime/dependency edit: npm run build:codemirror, then refresh.
Verification only: npm run check:codemirror.
Release: node compile.js; it refuses stale runtime output and still emits one scripts_compiled.js.
```

- [ ] **Step 3: Update migration records without changing performance claims**

Record the ownership split and replace obsolete all-in-one bundle paths/sizes with runtime-plus-plugin combined accounting. Do not relabel the documented Safari key or whole-document replacement misses.

- [ ] **Step 4: Run ownership tests and commit**

Run the Task 1 focused command and `git diff --check`. Expected: pass. Commit:

```bash
git commit -m "docs: explain CodeMirror source ownership"
```

### Task 6: Prove refresh-only plugin development and unchanged product behavior

**Files:**
- Modify/Create tests only if a failing acceptance path needs a regression fixture.

- [ ] **Step 1: Prove direct development loading**

Build generated pages, serve `src`, and run a Chromium test that reads the loaded script URLs, requires exactly one runtime and every plugin, and requires no old bundle, npm, CDN, or module request. Temporarily alter an observable plugin-owned test seam in the served worktree without rebuilding the runtime, refresh, and assert the new value is observed; revert the temporary edit with `apply_patch` immediately afterward.

- [ ] **Step 2: Run the complete non-protected Node and engine gates**

```bash
node --test $(find src/tests/codemirror6 -maxdepth 1 -name '*.test.mjs' ! -name 'candidate-page.test.mjs' -print)
node src/tests/run_tests_node.js
```

Expected: all non-protected CM6 tests pass and engine reports 750/750.

- [ ] **Step 3: Run browsers without Edge**

```bash
npm run test:codemirror-browser
```

Expected: Chromium, Firefox, and WebKit pass with only the recorded intentional skips. Do not run Edge.

- [ ] **Step 4: Run a release build safely**

Use the established apply-patch-only build-number predecrement so `compile.js` finishes at exact build 1838. Run `node compile.js`, restore/check exact four-byte build number, verify standalone hash is unchanged, run `npm run verify:release-compression`, and run the existing isolated real-Apache HTTP negotiation smoke. Assert release `editor.html` loads only `scripts_compiled.js`; player/standalone contain no runtime or plugin namespace.

- [ ] **Step 5: Measure installed browsers**

Capture the established Chrome and Safari optimized surfaces from the generated early-error page without overwriting historical pre-CM6 baselines. Compare key-to-paint, autocomplete, API edits, replacement, distant exact parsing, settled UI, and heap against the immediately preceding CM6 captures. Treat noise-scale movement as neutral; investigate any material regression before proceeding.

### Task 7: Final audit, review, and local branch commit

**Files:** all scoped implementation, generated artifacts, tests, and documentation; never the protected candidate edit.

- [ ] **Step 1: Audit forbidden changes**

Confirm no Lezer grammar, parser replacement, private checkpoint-frequency control, CDN/import map, Edge gate, player payload, or standalone payload was added. Confirm `codeMirrorFn` remains the sole parser and `stream-state.js` retains the pinned explicit failure.

- [ ] **Step 2: Audit generated and protected state**

Run `npm run check:codemirror`, `git diff --check`, and source-map validation. Confirm `candidate-page.test.mjs` remains the exact sole unstaged `+loo    assert...` user edit and is absent from the index.

- [ ] **Step 3: Request independent review**

Use `superpowers:requesting-code-review` against the approved design and this implementation plan. Resolve verified findings test-first; rerun affected gates.

- [ ] **Step 4: Stage exact scope and commit locally**

Stage explicit approved paths only, inspect `git diff --cached --stat` and `git diff --cached --check`, then commit on `codex/codemirror6-streamlanguage-design`. Do not merge, rebase, push, or touch master.

- [ ] **Step 5: Report**

Report the new edit/build rules, exact generated and direct-load locations, release single-file proof, combined Brotli size, behavior/performance results, dependency-upgrade procedure, commit hash, and any honestly remaining limitations.
