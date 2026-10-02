# PuzzleScript CodeMirror 6 plugins

These are directly loaded, PuzzleScript-owned classic scripts. Edit a plugin and
refresh `src/editor.html`; do not run esbuild merely to observe a plugin change.

The script order in `src/editor.html` and `compile.js` is part of the tested
contract. `bootstrap.js` validates the generated runtime and owns the single
internal module registry. Each later IIFE names its runtime exports and prior
plugin dependencies explicitly. `index.js` seals the registry and publishes the
existing frozen `PuzzleScriptCM6` application API.

If a plugin needs a CodeMirror API not already exposed by the runtime, add that
export to `../runtime/source/index.js`, run `npm run build:codemirror`, and commit
the updated runtime and source map.

When upgrading a pinned CodeMirror or Lezer dependency, update the exact version
contract in `bootstrap.js` as part of the same reviewed migration. In
particular, inspect upstream `StreamLanguage` before changing the language
packages because `stream-state.js` deliberately consumes its public checkpoint
state.
