# Symbol inspector implementation plan

**Goal:** Show current PuzzleScript symbol information in compact hovers and a pinnable inspector in the ordinary and MIS editors.

**Design:** Use the existing PuzzleScript parser to index declarations and authored rules, stopping before level data. Keep unflattened legend relationships, sprites, collision layers and physical source locations. Cache the index by immutable source document. Render a small hover card with Pin and rule-count controls, and a persistent closable inspector with direct and expandable indirect rule references. A pinned symbol stays selected while editing and scrolling, and refreshes from current source. MIS transform hovers inspect the game source and navigate into its Source tab.

**Files:** `symbol-info.js` owns the parser-backed data model; `symbol-inspector.js` owns the hover and inspector UI; existing editor entry points install the extension. Load both classic plugins consistently in development, release and test pages. Add styles scoped to the inspector, including MIS95 colors and controls.

- [x] Add data-model regression tests, observe failures, implement declaration/member/rule indexing and inspectSymbol queries.
- [x] Add browser regression tests, observe missing hover behavior, implement sprite cards, clickable definitions and membership, pin/close, and authored rule lists.
- [x] Install in main and MIS editors, including transform-to-source navigation and current-source refresh.
- [x] Run editor unit checks and Chromium/Firefox/WebKit interaction checks; visually inspect representative cards and pinned layout.
- [x] Review the final diff, preserve unrelated local work, and report the verified result.

**Validation:** Case-insensitive names; inline and legend aliases; OR versus AND; transitive inclusion paths; duplicate mentions counted once per authored line; comments excluded; latest uncompiled source; removed/renamed pinned symbols; source locations after blank lines; no source edits or dirty-state changes caused by inspection; Ctrl/Cmd-click preserved; pointer access to hover buttons; keyboard dismissal and panel controls.

**Results:** 215 editor unit checks and 66 Chromium/Firefox/WebKit browser checks pass. Desktop file tests pass. The wider MIS suite reaches a dominant-colour assertion failure in the concurrently added `mis_tools_node.js`, which does not load the inspector plugins. Independent review found and verified fixes for aliases of OR properties; WebKit hover placement was also verified visually. Native hover infrastructure and the new index/UI require a 110 KiB combined runtime/plugin Brotli budget (previously 100 KiB).
