# CodeMirror 6 runtime

`source/index.js` is the small, hand-edited export boundary around PuzzleScript's
exact pinned CodeMirror and Lezer npm dependencies. Changing it or those package
versions requires:

```text
npm run build:codemirror
```

The resulting browser runtime is committed under `dist/`. PuzzleScript parser,
autocomplete, command, presentation, and editor behavior belongs in `../plugins/`,
not in this runtime.
