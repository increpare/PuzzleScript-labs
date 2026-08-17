# Garden TooManyErrors Abort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify the parser's intentional diagnostic-limit abort as a compiler diagnostic instead of a monster-garden crash.

**Architecture:** Give the existing `TooManyErrors` exception a stable name at its source. Catch only that named exception at the garden worker's compile boundary, then let the worker's existing `compilerDiagnosticKind()` path classify the accumulated warnings or errors. All other exceptions continue to the crash classifier unchanged.

**Tech Stack:** PuzzleScript browser-global JavaScript, Node.js worker harness, built-in `assert` test runner.

---

### Task 1: Capture the warning-limit regression

**Files:**
- Modify: `src/tests/monster_garden/tests.js`

- [x] **Step 1: Add a failing worker regression**

Add this test beside the existing `TooManyErrors` garden regression:

```js
test('more than 100 parser warnings are a compiler diagnostic, not a crash', function() {
    const duplicateMetadata = [];
    for (let i = 0; i < 102; i++) {
        duplicateMetadata.push('title warning ' + i);
    }
    const result = workerResult({
        source: duplicateMetadata.join('\n') + '\n' + SAMPLE,
        inputs: [],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    });
    assert.strictEqual(result.kind, 'compiler-warning', JSON.stringify(result));
    assert.strictEqual(result.error, null, JSON.stringify(result));
    assert(result.errorStrings.length > 100, JSON.stringify(result));
});
```

- [x] **Step 2: Run the test suite and verify the new regression fails for the reported reason**

Run:

```sh
node src/tests/monster_garden/tests.js
```

Expected: the new test fails because the worker returns `kind: "crash"` with `error.message: "Too many errors/warnings; aborting compilation."` and the first stack frame is `TooManyErrors`.

### Task 2: Name and handle the expected abort

**Files:**
- Modify: `src/js/parser.js:71-75`
- Modify: `src/tests/monster_garden/worker.js:434-447`

- [x] **Step 1: Give the parser abort a stable exception name**

Change `TooManyErrors` to construct the same message while naming the exception:

```js
function TooManyErrors() {
    const message = compiling ? "Too many errors/warnings; aborting compilation." : "Too many errors/warnings; noping out.";
    consolePrint(message, true);
    const error = new Error(message);
    error.name = 'TooManyErrors';
    throw error;
}
```

- [x] **Step 2: Catch only that abort at the worker compile boundary**

Wrap the existing compile call in `runOnce`:

```js
    const compileCommand = job.fixtureKind === 'compiler-message' ? ['restart'] : ['loadLevel', job.level];
    try {
        global.compile(compileCommand, job.source, job.engineSeed);
    } catch (error) {
        if (!error || error.name !== 'TooManyErrors') {
            throw error;
        }
    }
```

Do not catch by message text and do not catch any other exception merely because diagnostics exist.

- [x] **Step 3: Run the garden tests and verify green**

Run:

```sh
node src/tests/monster_garden/tests.js
```

Expected: all garden tests pass, including the new warning-limit regression.

### Task 3: Compatibility and artifact verification

**Files:**
- Verify: `.build/monster_garden/crash-Error-Too-many-errors-warnings-aborting-compilation.-TooManyErrors-s1786832940544_0002/original.txt`
- Verify: `.build/monster_garden/crash-Error-Too-many-errors-warnings-aborting-compilation.-TooManyErrors-s1786832940544_0002/minimized.txt`

- [x] **Step 1: Run the complete engine/compiler suite**

Run:

```sh
node src/tests/run_tests_node.js
```

Expected: 759/759 tests pass.

- [x] **Step 2: Replay both saved specimens through `worker.js`**

For each specimen, use the job fields in `report.json` and replace only `source` with the corresponding text file. Expected: neither result is `crash`; the original is `compiler-warning` and the minimized specimen is `compiler-error` if its four accumulated errors remain.

- [x] **Step 3: Check the final diff**

Run:

```sh
git diff --check HEAD
git status --short
```

Expected: no whitespace errors; the user-owned `.build/monster_garden/` remains untracked and unchanged. Do not create a commit unless the user asks for one.
