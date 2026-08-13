# Port Upstream PuzzleScript Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge every commit currently on `increpare/PuzzleScript` `master` through `b6219e93` into PuzzleScript-labs while retaining labs-only canonicalization, CLI, solver, native-runtime, firmware, and hardware functionality.

**Architecture:** Preserve upstream history with one merge commit instead of copying individual patches. Accept conflict-free upstream changes as merged by Git, keep labs-only files for upstream modify/delete conflicts, integrate upstream fixes into the three shared parser/runtime files, and regenerate the standalone bundle from the resolved sources.

**Tech Stack:** Git, Node.js, PuzzleScript's QUnit/Node test harness, the existing `compile.js` build pipeline.

---

### Task 1: Establish the integration baseline

**Files:**
- Inspect: `.gitignore`
- Inspect: `package.json`
- Inspect: `src/tests/run_tests_node.js`

- [ ] **Step 1: Confirm the isolated branch is clean**

Run: `git status --short --branch`

Expected: branch `codex/port-upstream-2026-08-14` with no tracked or untracked changes except this plan.

- [ ] **Step 2: Record the exact upstream range**

Run: `git log --oneline --reverse master..upstream/master`

Expected: 40 upstream-only commits, beginning at `fda0543b` and ending at `b6219e93`.

- [ ] **Step 3: Verify the pre-merge test baseline**

Run: `node src/tests/run_tests_node.js`

Expected: 753 passed, 0 failed, 0 errors, plus `solver_random_replay_node passed`.

### Task 2: Merge the complete upstream branch

**Files:**
- Modify: all paths changed by `master..upstream/master`
- Resolve: `.build/buildnumber.txt`
- Resolve: `.gitignore`
- Resolve: `CLAUDE.md`
- Resolve: `src/canonicalize.js`
- Resolve: `src/canonicalize_cli.js`
- Resolve: `src/compile_cli.js`
- Resolve: `src/decanonicalize.js`
- Resolve: `src/js/compiler.js`
- Resolve: `src/js/engine.js`
- Resolve: `src/js/parser.js`
- Resolve: `src/standalone_inlined.txt`
- Resolve: `src/tests/canonicalizer_node.js`
- Resolve: `src/tests/decanonicalize_node.js`
- Resolve: `src/tests/resources/errormessage_testdata.js`

- [ ] **Step 1: Start a history-preserving merge without committing**

Run: `git merge --no-ff --no-commit upstream/master`

Expected: Git stages all conflict-free changes and reports conflicts only in the paths listed above.

- [ ] **Step 2: Preserve labs-only files deleted upstream**

Keep the `HEAD` versions of:

```text
CLAUDE.md
src/canonicalize.js
src/canonicalize_cli.js
src/compile_cli.js
src/decanonicalize.js
src/tests/canonicalizer_node.js
src/tests/decanonicalize_node.js
```

These files implement fork-specific workflows and have no upstream replacement.

- [ ] **Step 3: Resolve repository metadata**

Keep the labs `.gitignore`, which already ignores `/.worktrees/`, `/.superpowers`, and `/build` while also covering labs-specific build products. Resolve `.build/buildnumber.txt` to upstream build `1838`; `compile.js` will advance it once when regenerating derived output.

- [ ] **Step 4: Confirm conflict scope before editing shared code**

Run: `git diff --name-only --diff-filter=U`

Expected: only `src/js/compiler.js`, `src/js/engine.js`, `src/js/parser.js`, `src/standalone_inlined.txt`, and `src/tests/resources/errormessage_testdata.js` remain unresolved.

### Task 3: Integrate shared parser, compiler, and engine behavior

**Files:**
- Modify: `src/js/parser.js`
- Modify: `src/js/compiler.js`
- Modify: `src/js/engine.js`
- Test: `src/tests/resources/errormessage_testdata.js`
- Test: `src/tests/resources/testdata.js`

- [ ] **Step 1: Resolve `src/js/parser.js`**

Retain labs parser extensions and adopt upstream's parser simplification plus the vertical-tab termination fix from `9f7b42e2`. The resulting parser must reject or advance past unsupported control characters rather than repeatedly tokenizing the same input position.

- [ ] **Step 2: Resolve `src/js/compiler.js`**

Retain labs compiler optimizations and native/solver hooks, while incorporating upstream fixes from `cef90d4e`, `247c097d`, `1448450a`, `e792f8f3`, `ce625bc8`, `3a8f0a0e`, and `b6219e93`: corrected replacement-cache keys and limits, restored compiler validation, updated/capitalized diagnostics, binary numeral support, and `includes`-based membership checks.

- [ ] **Step 3: Resolve `src/js/engine.js`**

Retain labs solver and specialization paths, while incorporating upstream's literal direction masks, typed-array copy changes in the rigid loop, cache-limit changes, color/helper integration, and `includes`-based membership checks from `c4bb7e82`, `b134abf5`, `cef90d4e`, `759b6456`, and `b6219e93`.

- [ ] **Step 4: Resolve error-message fixtures by retaining both histories**

Start from the upstream `src/tests/resources/errormessage_testdata.js`, then restore any labs-only fixture entries absent upstream. Do not weaken or remove upstream expectations for issues `#1128`, `#1136`, `#1163`, `#1164`, and `#1169`.

- [ ] **Step 5: Verify all source conflicts are gone**

Run: `rg -n '^(<<<<<<<|=======|>>>>>>>)' src/js src/tests/resources/errormessage_testdata.js`

Expected: no output.

### Task 4: Regenerate derived assets and prove compatibility

**Files:**
- Regenerate: `.build/buildnumber.txt`
- Regenerate: `src/standalone_inlined.txt`
- Generate (ignored): `bin/`
- Test: `src/tests/run_tests_node.js`
- Test: `src/tests/canonicalizer_node.js`
- Test: `src/tests/decanonicalize_node.js`
- Test: `src/tests/canonicalize_roundtrip_node.js`

- [ ] **Step 1: Regenerate the standalone bundle from resolved sources**

Run: `node compile.js`

Expected: exit status 0, `.build/buildnumber.txt` advances from `1838` to `1839`, and `src/standalone_inlined.txt` contains no merge markers.

- [ ] **Step 2: Run the complete core test suite**

Run: `node src/tests/run_tests_node.js`

Expected: all simulation and compiler-error tests pass, with 0 failures and 0 errors.

- [ ] **Step 3: Run labs-only canonicalization tests**

Run: `node src/tests/canonicalizer_node.js && node src/tests/decanonicalize_node.js && node src/tests/canonicalize_roundtrip_node.js`

Expected: all three commands exit 0.

- [ ] **Step 4: Inspect the final merge diff**

Run: `git diff --cached --stat && git status --short`

Expected: every upstream change is staged, all seven labs-only modify/delete files are retained, generated `bin/` remains ignored, and no unmerged paths remain.

### Task 5: Record the completed upstream port

**Files:**
- Commit: the resolved merge and this plan

- [ ] **Step 1: Create the merge commit**

Run: `git commit -m "Merge upstream PuzzleScript changes through b6219e93"`

Expected: one merge commit with parents `bb0ba0b9` and `b6219e93`.

- [ ] **Step 2: Verify ancestry and cleanliness**

Run: `git merge-base --is-ancestor upstream/master HEAD && git status --short --branch`

Expected: the ancestry check exits 0 and the branch is clean.
