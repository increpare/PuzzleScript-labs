# VS Code PuzzleScript Level Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the VS Code PuzzleScript Level Studio webview with level editing, solving/replay, long-running candidate generation, timeout promotion, and solved top-3 sidecar logging.

**Architecture:** The VS Code extension owns document edits, native processes, temp files, and sidecar writes. The webview owns UI state and talks to the extension through message handlers. The native generator gains an optional JSON-lines event stream so the extension can see solved and timeout candidates as they are evaluated.

**Tech Stack:** Node.js CommonJS extension code, VS Code webview APIs, existing PuzzleScript JS editor intelligence, existing native C++ solver/generator binaries, Node `assert` tests, CMake/Make native build targets.

---

## Scope Check

This is one integrated feature, not separate standalone products. The plan builds a VS Code-hosted Studio only. Standalone app packaging, object/layer editing, debugger replacement, and restored candidate history stay out of scope.

## File Structure

Create:

- `tools/vscode-puzzlescript/src/puzzlescriptLevelStudioCore.js`  
  Pure helpers for level extraction, glyph palette extraction, editable board rows, cell replacement, status formatting, and generated-log path naming.

- `tools/vscode-puzzlescript/src/puzzlescriptGeneratedLevelsLog.js`  
  Sidecar log formatter and append-once tracking by `level_hash`.

- `tools/vscode-puzzlescript/src/puzzlescriptCandidateScheduler.js`  
  Pure candidate batch model: effort score, grid-difference diversity, solved top-3 tracking, timeout promotion tiers, and bounded queues.

- `tools/vscode-puzzlescript/src/puzzlescriptSolverRunner.js`  
  Temp-file runner for `puzzlescript_solver` using current in-memory document text.

- `tools/vscode-puzzlescript/src/puzzlescriptLevelStudioPanel.js`  
  VS Code webview panel, HTML, message routing, document observation, level edits, solve requests, generator batch lifecycle, sidecar logging.

- `tools/vscode-puzzlescript/test/level-studio-core.test.js`
- `tools/vscode-puzzlescript/test/generated-levels-log.test.js`
- `tools/vscode-puzzlescript/test/candidate-scheduler.test.js`
- `tools/vscode-puzzlescript/test/solver-runner.test.js`
- `src/tests/run_generator_events_jsonl_node.js`

Modify:

- `native/src/generator/main.cpp`  
  Add `--events-jsonl PATH` and write one JSON line per evaluated deduped candidate.

- `native/CMakeLists.txt`  
  Add a focused CTest for generator event streaming.

- `tools/vscode-puzzlescript/src/puzzlescriptGeneratorRunner.js`  
  Support optional event stream file polling for generator progress.

- `tools/vscode-puzzlescript/src/puzzlescriptGeneratorCore.js`  
  Export helpers needed by Level Studio if already present but private.

- `tools/vscode-puzzlescript/src/extension.js`  
  Register `PuzzleScript: Open Level Studio`.

- `tools/vscode-puzzlescript/package.json`  
  Add command contribution, solver path setting, and new tests to `npm test`.

- `tools/vscode-puzzlescript/README.md`  
  Document the Studio workflow, `.txt` support, and sidecar log behavior.

## Task 1: Native Generator Candidate Event Stream

**Files:**
- Modify: `native/src/generator/main.cpp`
- Modify: `native/CMakeLists.txt`
- Create: `src/tests/run_generator_events_jsonl_node.js`

- [ ] **Step 1: Add a failing event-stream test**

Create `src/tests/run_generator_events_jsonl_node.js`:

```js
#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const generator = process.argv[2];
const repoRoot = process.argv[3] || path.resolve(__dirname, '..', '..');
assert(generator, 'usage: run_generator_events_jsonl_node.js <puzzlescript_generator> [repoRoot]');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-generator-events-'));
const gamePath = path.join(tmp, 'game.txt');
const specPath = path.join(tmp, 'recipe.gen');
const eventsPath = path.join(tmp, 'events.jsonl');
const resultPath = path.join(tmp, 'result.json');

fs.writeFileSync(gamePath, [
    'title Event Stream',
    '',
    'objects',
    'Background',
    'black',
    'Player',
    'blue',
    'Target',
    'green',
    '',
    'legend',
    '. = Background',
    'P = Player',
    'T = Target',
    '',
    'collisionlayers',
    'Background',
    'Player',
    'Target',
    '',
    'rules',
    '[ > Player | Target ] -> [ > Player | Target ]',
    '',
    'winconditions',
    'some Player on Target',
    '',
    'levels',
    'P.T',
].join('\n'), 'utf8');

fs.writeFileSync(specPath, [
    '(INIT LEVEL)',
    'P.T',
    '',
    '(GENERATION RULES)',
    'choose 1 [ player | no player no target ] -> [ | player ]',
].join('\n'), 'utf8');

const result = childProcess.spawnSync(generator, [
    gamePath,
    specPath,
    '--samples', '3',
    '--time-ms', '5000',
    '--jobs', '1',
    '--seed', '1',
    '--solver-timeout-ms', '100',
    '--top-k', '3',
    '--events-jsonl', eventsPath,
    '--json-out', resultPath,
    '--quiet',
], {
    cwd: repoRoot,
    encoding: 'utf8',
});

assert.strictEqual(result.status, 0, result.stderr || result.stdout);
assert(fs.existsSync(resultPath), 'result JSON should be written');
assert(fs.existsSync(eventsPath), 'events JSONL should be written');

const lines = fs.readFileSync(eventsPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
assert(lines.length > 0, 'expected at least one candidate event');
const event = JSON.parse(lines[0]);
assert.strictEqual(event.event, 'candidate_evaluated');
assert.strictEqual(typeof event.sample_id, 'number');
assert.strictEqual(typeof event.level_hash, 'number');
assert(['solved', 'timeout', 'exhausted', 'level_error'].includes(event.status), event.status);
assert.strictEqual(event.width, 3);
assert.strictEqual(event.height, 1);
assert(Array.isArray(event.cells), 'cells should be serialized for host scheduling');
assert.strictEqual(event.cells.length, 1);
assert.strictEqual(typeof event.unique_states, 'number');
assert.strictEqual(typeof event.expanded, 'number');
assert.strictEqual(typeof event.generated, 'number');
if (event.status === 'solved') {
    assert(Array.isArray(event.solution), 'solved event should include a solution array');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('generator events jsonl test passed');
```

- [ ] **Step 2: Run the event-stream test and verify it fails**

Run:

```bash
cmake --build build --target puzzlescript_generator
node src/tests/run_generator_events_jsonl_node.js build/native/puzzlescript_generator "$PWD"
```

Expected: FAIL because `puzzlescript_generator` does not recognize `--events-jsonl` or does not create the event file.

- [ ] **Step 3: Add event-stream option and JSON helpers**

In `native/src/generator/main.cpp`, extend `Options`:

```cpp
struct Options {
    std::filesystem::path gamePath;
    std::filesystem::path specPath;
    std::filesystem::path jsonOut;
    std::filesystem::path eventsJsonl;
    int64_t timeMs = 60000;
    std::optional<uint64_t> samples;
    size_t jobs = 0;
    uint64_t seed = 1;
    int64_t solverTimeoutMs = 250;
    std::optional<SearchMode> solverMode;
    size_t topK = 50;
    size_t dedupeMax = 1000000;
    bool quiet = false;
};
```

Update the usage string in `parseArgs` to include:

```text
[--events-jsonl PATH]
```

Add this branch in `parseArgs`:

```cpp
} else if (arg == "--events-jsonl" && index + 1 < argc) {
    options.eventsJsonl = argv[++index];
```

Add helpers near `objectNamesForCell`:

```cpp
std::string solveStatusName(SolveStatus status) {
    switch (status) {
        case SolveStatus::Exhausted: return "exhausted";
        case SolveStatus::Solved: return "solved";
        case SolveStatus::Timeout: return "timeout";
        case SolveStatus::LevelError: return "level_error";
    }
    return "unknown";
}

std::string candidateEventJson(
    const Options& options,
    const Game& game,
    const LevelTemplate& level,
    const SolveResult& solved,
    uint64_t sampleId,
    uint64_t sampleSeed,
    uint64_t levelHash
) {
    std::ostringstream out;
    out << "{";
    out << "\"event\":\"candidate_evaluated\"";
    out << ",\"sample_id\":" << sampleId;
    out << ",\"seed\":" << sampleSeed;
    out << ",\"level_hash\":" << levelHash;
    out << ",\"status\":" << jsonString(solveStatusName(solved.status));
    out << ",\"solver_budget_ms\":" << options.solverTimeoutMs;
    out << ",\"unique_states\":" << solved.uniqueStates;
    out << ",\"expanded\":" << solved.expanded;
    out << ",\"generated\":" << solved.generated;
    out << ",\"duplicates\":" << solved.duplicates;
    out << ",\"solution_length\":" << solved.solution.size();
    out << ",\"width\":" << level.width;
    out << ",\"height\":" << level.height;
    out << ",\"solution\":[";
    for (size_t index = 0; index < solved.solution.size(); ++index) {
        if (index > 0) out << ",";
        out << jsonString(solved.solution[index]);
    }
    out << "],\"cells\":[";
    for (int32_t y = 0; y < level.height; ++y) {
        if (y > 0) out << ",";
        out << "[";
        for (int32_t x = 0; x < level.width; ++x) {
            if (x > 0) out << ",";
            const int32_t tile = x * level.height + y;
            out << jsonString(objectNamesForCell(game, level, tile));
        }
        out << "]";
    }
    out << "]}";
    return out.str();
}
```

- [ ] **Step 4: Add thread-safe event appending**

Extend `SharedState`:

```cpp
struct SharedState {
    std::atomic<uint64_t> nextSample{0};
    std::atomic<bool> cancel{false};
    Counters counters;
    std::mutex topMutex;
    std::vector<Candidate> top;
    std::mutex eventsMutex;
    std::array<std::mutex, 64> dedupeMutexes;
    std::array<std::unordered_set<uint64_t>, 64> dedupe;
    std::array<std::deque<uint64_t>, 64> dedupeOrder;
};
```

Add an append helper:

```cpp
void appendCandidateEvent(
    const Options& options,
    const Game& game,
    SharedState& shared,
    const LevelTemplate& level,
    const SolveResult& solved,
    uint64_t sampleId,
    uint64_t sampleSeed,
    uint64_t levelHash
) {
    if (options.eventsJsonl.empty()) {
        return;
    }
    const std::string line = candidateEventJson(options, game, level, solved, sampleId, sampleSeed, levelHash);
    std::lock_guard<std::mutex> lock(shared.eventsMutex);
    if (!options.eventsJsonl.parent_path().empty()) {
        std::filesystem::create_directories(options.eventsJsonl.parent_path());
    }
    std::ofstream stream(options.eventsJsonl, std::ios::binary | std::ios::app);
    if (!stream) {
        shared.cancel.store(true, std::memory_order_relaxed);
        throw std::runtime_error("Failed to write generator events: " + options.eventsJsonl.string());
    }
    stream << line << "\n";
}
```

In `workerMain`, immediately after `SolveResult solved = solveGeneratedLevel(...)` and counter updates, call:

```cpp
appendCandidateEvent(options, *game, shared, candidateLevel, solved, sampleId, sampleSeed, levelHash);
```

Keep this before moving `candidateLevel` into `Candidate`.

- [ ] **Step 5: Wire the CTest**

In `native/CMakeLists.txt`, near the generator smoke tests, add:

```cmake
add_test(
  NAME puzzlescript_generator_events_jsonl
  COMMAND ${NODE_EXECUTABLE}
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/run_generator_events_jsonl_node.js
          $<TARGET_FILE:puzzlescript_generator>
          ${PUZZLESCRIPT_REPO_ROOT}
)
set_tests_properties(puzzlescript_generator_events_jsonl PROPERTIES TIMEOUT 30)
```

Use the same Node executable variable already used by nearby tests. If the file uses a different variable name, match the existing convention in that file exactly.

- [ ] **Step 6: Run native event-stream verification**

Run:

```bash
cmake --build build --target puzzlescript_generator
node src/tests/run_generator_events_jsonl_node.js build/native/puzzlescript_generator "$PWD"
ctest --test-dir build -R puzzlescript_generator_events_jsonl --output-on-failure
```

Expected: all commands pass and print `generator events jsonl test passed`.

- [ ] **Step 7: Commit native event stream**

```bash
git add native/src/generator/main.cpp native/CMakeLists.txt src/tests/run_generator_events_jsonl_node.js
git commit -m "feat: stream generator candidate events"
```

## Task 2: Level Studio Core Helpers

**Files:**
- Create: `tools/vscode-puzzlescript/src/puzzlescriptLevelStudioCore.js`
- Create: `tools/vscode-puzzlescript/test/level-studio-core.test.js`
- Modify: `tools/vscode-puzzlescript/package.json`

- [ ] **Step 1: Write failing core helper tests**

Create `tools/vscode-puzzlescript/test/level-studio-core.test.js`:

```js
#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    boardFromLevel,
    generatedLevelsLogPath,
    glyphPaletteForSource,
    isPuzzleScriptCandidateDocument,
    replaceGlyphAt,
    replaceLevelRowsInSource,
    statusLabel,
} = require('../src/puzzlescriptLevelStudioCore');
const { findPlayableLevels } = require('../src/puzzlescriptGeneratorCore');

const source = [
    'title Studio Test',
    '',
    'objects',
    'Background',
    'black',
    'Wall',
    'gray',
    'Player',
    'blue',
    'Crate',
    'orange',
    'Target',
    'green',
    '',
    'legend',
    '. = Background',
    '# = Wall',
    'P = Player',
    '* = Crate',
    'O = Target',
    '@ = Crate and Target',
    '',
    'collisionlayers',
    'Background',
    'Player, Wall, Crate',
    'Target',
    '',
    'rules',
    '[ > Player | Crate ] -> [ > Player | > Crate ]',
    '',
    'winconditions',
    'all Crate on Target',
    '',
    'levels',
    '#####',
    '#P*.#',
    '#..O#',
    '#####',
].join('\n');

assert.strictEqual(isPuzzleScriptCandidateDocument(source, 'game.txt'), true);
assert.strictEqual(isPuzzleScriptCandidateDocument('just notes', 'notes.txt'), false);
assert.strictEqual(isPuzzleScriptCandidateDocument('anything', 'game.ps'), true);
assert.strictEqual(generatedLevelsLogPath('/tmp/game.txt'), '/tmp/game.generatedlevels.txt');
assert.strictEqual(generatedLevelsLogPath('/tmp/game.ps'), '/tmp/game.generatedlevels.txt');

const palette = glyphPaletteForSource(source);
assert.deepStrictEqual(palette.map(entry => entry.glyph), ['.', '#', 'P', '*', 'O', '@']);
assert.deepStrictEqual(palette.find(entry => entry.glyph === '@').objects, ['crate', 'target']);

const level = findPlayableLevels(source)[0];
assert.deepStrictEqual(boardFromLevel(level), [
    ['#', '#', '#', '#', '#'],
    ['#', 'P', '*', '.', '#'],
    ['#', '.', '.', 'O', '#'],
    ['#', '#', '#', '#', '#'],
]);

assert.deepStrictEqual(replaceGlyphAt(boardFromLevel(level), 1, 1, '.'), [
    ['#', '#', '#', '#', '#'],
    ['#', '.', '*', '.', '#'],
    ['#', '.', '.', 'O', '#'],
    ['#', '#', '#', '#', '#'],
]);

const replaced = replaceLevelRowsInSource(source, level, [
    '#####',
    '#..*#',
    '#P.O#',
    '#####',
]);
assert(replaced.includes('#..*#'));
assert(!replaced.includes('#P*.#'));

assert.strictEqual(statusLabel({ status: 'solved', solution_length: 12 }), 'solved, 12 moves');
assert.strictEqual(statusLabel({ status: 'timeout', solver_budget_ms: 1000 }), 'timeout @ 1s');
assert.strictEqual(statusLabel({ status: 'exhausted' }), 'exhausted');

console.log('level studio core tests passed');
```

- [ ] **Step 2: Add the test to `npm test`**

In `tools/vscode-puzzlescript/package.json`, update the `scripts.test` value so it starts with the new test:

```json
"test": "node ./test/level-studio-core.test.js && node ./test/editor-intelligence.test.js && node ./test/syntax-highlighting.test.js && node ./test/debugger.test.js && node ./test/level-links.test.js && node ./test/generator-core.test.js && node ./test/generator-runner.test.js"
```

- [ ] **Step 3: Run the test and verify it fails**

Run:

```bash
cd tools/vscode-puzzlescript
npm test
```

Expected: FAIL with `Cannot find module '../src/puzzlescriptLevelStudioCore'`.

- [ ] **Step 4: Implement `puzzlescriptLevelStudioCore.js`**

Create `tools/vscode-puzzlescript/src/puzzlescriptLevelStudioCore.js`:

```js
'use strict';

const path = require('path');
const { replacementForLevel } = require('./puzzlescriptGeneratorCore');

const SECTION_NAMES = new Set([
    'objects',
    'legend',
    'sounds',
    'collisionlayers',
    'rules',
    'winconditions',
    'levels',
]);

function stripLineComment(line) {
    const index = String(line).indexOf('(');
    return index >= 0 ? String(line).slice(0, index) : String(line);
}

function sectionNameForLine(line) {
    const trimmed = stripLineComment(line).trim().toLowerCase();
    if (/^=+$/.test(trimmed)) {
        return null;
    }
    return SECTION_NAMES.has(trimmed) ? trimmed : null;
}

function isPuzzleScriptCandidateDocument(source, filename) {
    if (/\.(ps|puzzlescript)$/i.test(String(filename || ''))) {
        return true;
    }
    if (!/\.txt$/i.test(String(filename || ''))) {
        return false;
    }
    const lower = String(source || '').toLowerCase();
    return lower.includes('\nobjects')
        || lower.includes('\nlegend')
        || lower.includes('\nlevels')
        || /^\s*(objects|legend|levels)\s*$/im.test(lower);
}

function generatedLevelsLogPath(sourcePath) {
    const parsed = path.parse(sourcePath);
    return path.join(parsed.dir, `${parsed.name}.generatedlevels.txt`);
}

function glyphPaletteForSource(source) {
    const lines = String(source || '').split('\n');
    const entries = [];
    let section = '';
    for (const line of lines) {
        const nextSection = sectionNameForLine(line);
        if (nextSection) {
            section = nextSection;
            continue;
        }
        if (section !== 'legend') {
            continue;
        }
        const uncommented = stripLineComment(line).trim();
        const match = uncommented.match(/^(.+?)\s*=\s*(.+)$/);
        if (!match) {
            continue;
        }
        const glyph = match[1].trim();
        if ([...glyph].length !== 1) {
            continue;
        }
        if (/\s+or\s+/i.test(match[2])) {
            continue;
        }
        const objects = match[2]
            .split(/\s+and\s+/i)
            .map(part => part.trim().toLowerCase())
            .filter(Boolean);
        if (objects.length > 0) {
            entries.push({ glyph, objects, label: `${glyph} = ${objects.join(' and ')}` });
        }
    }
    return entries;
}

function boardFromLevel(level) {
    return (level && Array.isArray(level.rows) ? level.rows : [])
        .map(row => [...String(row)]);
}

function replaceGlyphAt(board, x, y, glyph) {
    return board.map((row, rowIndex) => row.map((cell, columnIndex) => {
        return rowIndex === y && columnIndex === x ? glyph : cell;
    }));
}

function rowsFromBoard(board) {
    return (board || []).map(row => (row || []).join(''));
}

function replaceLevelRowsInSource(source, level, rows) {
    const edit = replacementForLevel(source, level, { cells: [] });
    const lines = String(source || '').split('\n');
    lines.splice(edit.startLine, edit.endLine - edit.startLine, ...rows);
    return lines.join('\n');
}

function statusLabel(result) {
    if (!result || !result.status) {
        return 'not run';
    }
    if (result.status === 'solved') {
        const length = result.solution_length == null ? 0 : result.solution_length;
        return `solved, ${length} moves`;
    }
    if (result.status === 'timeout') {
        const budget = Number(result.solver_budget_ms || result.timeout_ms || 0);
        if (budget >= 1000 && budget % 1000 === 0) {
            return `timeout @ ${budget / 1000}s`;
        }
        return budget > 0 ? `timeout @ ${budget}ms` : 'timeout';
    }
    return String(result.status).replace(/_/g, ' ');
}

module.exports = {
    boardFromLevel,
    generatedLevelsLogPath,
    glyphPaletteForSource,
    isPuzzleScriptCandidateDocument,
    replaceGlyphAt,
    replaceLevelRowsInSource,
    rowsFromBoard,
    statusLabel,
};
```

- [ ] **Step 5: Run extension tests**

Run:

```bash
cd tools/vscode-puzzlescript
npm test
```

Expected: all tests pass, ending with existing test success messages plus `level studio core tests passed`.

- [ ] **Step 6: Commit core helpers**

```bash
git add tools/vscode-puzzlescript/package.json tools/vscode-puzzlescript/src/puzzlescriptLevelStudioCore.js tools/vscode-puzzlescript/test/level-studio-core.test.js
git commit -m "feat: add level studio core helpers"
```

## Task 3: Sidecar Generated-Level Log

**Files:**
- Create: `tools/vscode-puzzlescript/src/puzzlescriptGeneratedLevelsLog.js`
- Create: `tools/vscode-puzzlescript/test/generated-levels-log.test.js`
- Modify: `tools/vscode-puzzlescript/package.json`

- [ ] **Step 1: Write failing log tests**

Create `tools/vscode-puzzlescript/test/generated-levels-log.test.js`:

```js
#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    GeneratedLevelsLog,
    formatGeneratedLevelBlock,
} = require('../src/puzzlescriptGeneratedLevelsLog');

const entry = {
    timestamp: '2026-06-18T12:00:00.000Z',
    sourceFile: 'game.txt',
    batchId: 'batch-1',
    sourceLevel: 2,
    levelHash: 12345,
    rankWhenLogged: 1,
    effortScore: 77,
    solverStatus: 'solved',
    solverStrategy: 'portfolio',
    solverBudgetMs: 1000,
    solutionLength: 4,
    solution: ['up', 'right', 'down', 'left'],
    expanded: 55,
    generated: 99,
    uniqueStates: 77,
    recipeText: 'choose 1 [ player ] -> [ player ]',
    rows: ['#####', '#P.O#', '#####'],
};

const block = formatGeneratedLevelBlock(entry);
assert(block.includes('===== GENERATED LEVEL 2026-06-18T12:00:00.000Z ====='));
assert(block.includes('source_file: game.txt'));
assert(block.includes('level_hash: 12345'));
assert(block.includes('solution: up right down left'));
assert(block.includes('recipe:\n  choose 1 [ player ] -> [ player ]'));
assert(block.includes('level:\n#####\n#P.O#\n#####'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-generated-log-'));
const logPath = path.join(tmp, 'game.generatedlevels.txt');
const log = new GeneratedLevelsLog(logPath);
assert.strictEqual(log.appendIfNewTopSolved(entry), true);
assert.strictEqual(log.appendIfNewTopSolved(entry), false, 'same hash should not append twice');
assert.strictEqual(log.appendIfNewTopSolved({ ...entry, levelHash: 999, solverStatus: 'timeout' }), false);
const text = fs.readFileSync(logPath, 'utf8');
assert.strictEqual((text.match(/GENERATED LEVEL/g) || []).length, 1);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('generated levels log tests passed');
```

- [ ] **Step 2: Add the log test to `npm test`**

In `tools/vscode-puzzlescript/package.json`, update `scripts.test`:

```json
"test": "node ./test/level-studio-core.test.js && node ./test/generated-levels-log.test.js && node ./test/editor-intelligence.test.js && node ./test/syntax-highlighting.test.js && node ./test/debugger.test.js && node ./test/level-links.test.js && node ./test/generator-core.test.js && node ./test/generator-runner.test.js"
```

- [ ] **Step 3: Run the test and verify it fails**

Run:

```bash
cd tools/vscode-puzzlescript
npm test
```

Expected: FAIL with `Cannot find module '../src/puzzlescriptGeneratedLevelsLog'`.

- [ ] **Step 4: Implement generated log module**

Create `tools/vscode-puzzlescript/src/puzzlescriptGeneratedLevelsLog.js`:

```js
'use strict';

const fs = require('fs');
const path = require('path');

function indentRecipe(text) {
    return String(text || '')
        .split(/\r?\n/)
        .map(line => `  ${line}`)
        .join('\n');
}

function formatGeneratedLevelBlock(entry) {
    const timestamp = entry.timestamp || new Date().toISOString();
    const solution = (entry.solution || []).join(' ');
    const rows = (entry.rows || []).join('\n');
    return [
        `===== GENERATED LEVEL ${timestamp} =====`,
        `source_file: ${entry.sourceFile || ''}`,
        `batch_id: ${entry.batchId || ''}`,
        `source_level: ${entry.sourceLevel}`,
        `level_hash: ${entry.levelHash}`,
        `rank_when_logged: ${entry.rankWhenLogged}`,
        `effort_score: ${entry.effortScore}`,
        `solver_status: ${entry.solverStatus || 'solved'}`,
        `solver_strategy: ${entry.solverStrategy || ''}`,
        `solver_budget_ms: ${entry.solverBudgetMs}`,
        `solution_length: ${entry.solutionLength == null ? (entry.solution || []).length : entry.solutionLength}`,
        `solution: ${solution}`,
        `expanded: ${entry.expanded == null ? 0 : entry.expanded}`,
        `generated: ${entry.generated == null ? 0 : entry.generated}`,
        `unique_states: ${entry.uniqueStates == null ? entry.effortScore : entry.uniqueStates}`,
        'recipe:',
        indentRecipe(entry.recipeText || ''),
        'level:',
        rows,
        '',
        '',
    ].join('\n');
}

class GeneratedLevelsLog {
    constructor(logPath) {
        this.logPath = logPath;
        this.loggedHashes = new Set();
    }

    appendIfNewTopSolved(entry) {
        if (!entry || entry.solverStatus !== 'solved') {
            return false;
        }
        const key = String(entry.levelHash);
        if (!key || this.loggedHashes.has(key)) {
            return false;
        }
        this.loggedHashes.add(key);
        if (!path.dirname(this.logPath).match(/^\.?$/)) {
            fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
        }
        fs.appendFileSync(this.logPath, formatGeneratedLevelBlock(entry), 'utf8');
        return true;
    }
}

module.exports = {
    GeneratedLevelsLog,
    formatGeneratedLevelBlock,
};
```

- [ ] **Step 5: Run extension tests**

Run:

```bash
cd tools/vscode-puzzlescript
npm test
```

Expected: all tests pass and include `generated levels log tests passed`.

- [ ] **Step 6: Commit sidecar log**

```bash
git add tools/vscode-puzzlescript/package.json tools/vscode-puzzlescript/src/puzzlescriptGeneratedLevelsLog.js tools/vscode-puzzlescript/test/generated-levels-log.test.js
git commit -m "feat: add generated levels log"
```

## Task 4: Candidate Scheduler Model

**Files:**
- Create: `tools/vscode-puzzlescript/src/puzzlescriptCandidateScheduler.js`
- Create: `tools/vscode-puzzlescript/test/candidate-scheduler.test.js`
- Modify: `tools/vscode-puzzlescript/package.json`

- [ ] **Step 1: Write failing scheduler tests**

Create `tools/vscode-puzzlescript/test/candidate-scheduler.test.js`:

```js
#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    CandidateBatchState,
    effortScore,
    gridDifference,
} = require('../src/puzzlescriptCandidateScheduler');

assert.strictEqual(gridDifference(['P..', '.O.'], ['P..', '.O.']), 0);
assert.strictEqual(gridDifference(['P..', '.O.'], ['.P.', '.O.']), 2);
assert.strictEqual(gridDifference([['player', '', ''], ['', 'target', '']], [['', 'player', ''], ['', 'target', '']]), 2);

assert.strictEqual(effortScore({ unique_states: 10 }), 10);
assert.strictEqual(effortScore({ uniqueStates: 11 }), 11);
assert.strictEqual(effortScore({ expanded: 4, generated: 9 }), 9);

const batch = new CandidateBatchState({
    topCount: 3,
    promotionBudgetsMs: [1000, 5000, 30000],
    promotionQueueLimit: 2,
    batchId: 'batch-1',
});

assert.strictEqual(batch.recordEvaluation({
    level_hash: 1,
    status: 'solved',
    unique_states: 20,
    solution: ['right'],
    cells: [['player target']],
}).becameTopSolved, true);

assert.strictEqual(batch.recordEvaluation({
    level_hash: 2,
    status: 'solved',
    unique_states: 10,
    solution: ['left'],
    cells: [['player']],
}).becameTopSolved, true);

assert.strictEqual(batch.recordEvaluation({
    level_hash: 3,
    status: 'solved',
    unique_states: 30,
    solution: ['up'],
    cells: [['target']],
}).becameTopSolved, true);

assert.strictEqual(batch.recordEvaluation({
    level_hash: 4,
    status: 'solved',
    unique_states: 5,
    solution: ['down'],
    cells: [['background']],
}).becameTopSolved, false, 'low effort solved candidate should not enter top 3');

assert.deepStrictEqual(batch.solvedTop().map(candidate => candidate.level_hash), [3, 1, 2]);
assert.strictEqual(batch.shouldLogSolvedTop(3), true);
assert.strictEqual(batch.shouldLogSolvedTop(3), false, 'same top solved candidate logs once');

batch.recordEvaluation({
    level_hash: 5,
    status: 'timeout',
    unique_states: 100,
    solver_budget_ms: 1000,
    cells: [['player', 'crate']],
});
batch.recordEvaluation({
    level_hash: 6,
    status: 'timeout',
    unique_states: 80,
    solver_budget_ms: 1000,
    cells: [['wall', 'crate']],
});
batch.recordEvaluation({
    level_hash: 7,
    status: 'timeout',
    unique_states: 1,
    solver_budget_ms: 1000,
    cells: [['wall', 'crate']],
});

const next = batch.nextPromotion();
assert.strictEqual(next.level_hash, 5, 'highest effort timeout should promote first');
assert.strictEqual(next.next_budget_ms, 5000);
assert(batch.timeoutQueue().length <= 1, 'queue limit should evict low-priority timeout candidates');

console.log('candidate scheduler tests passed');
```

- [ ] **Step 2: Add the scheduler test to `npm test`**

In `tools/vscode-puzzlescript/package.json`, update `scripts.test`:

```json
"test": "node ./test/level-studio-core.test.js && node ./test/generated-levels-log.test.js && node ./test/candidate-scheduler.test.js && node ./test/editor-intelligence.test.js && node ./test/syntax-highlighting.test.js && node ./test/debugger.test.js && node ./test/level-links.test.js && node ./test/generator-core.test.js && node ./test/generator-runner.test.js"
```

- [ ] **Step 3: Run the test and verify it fails**

Run:

```bash
cd tools/vscode-puzzlescript
npm test
```

Expected: FAIL with `Cannot find module '../src/puzzlescriptCandidateScheduler'`.

- [ ] **Step 4: Implement candidate scheduler**

Create `tools/vscode-puzzlescript/src/puzzlescriptCandidateScheduler.js`:

```js
'use strict';

function normalizeRows(cells) {
    if (!Array.isArray(cells)) {
        return [];
    }
    return cells.map(row => Array.isArray(row) ? row.map(String) : [...String(row)]);
}

function gridDifference(a, b) {
    const left = normalizeRows(a);
    const right = normalizeRows(b);
    const height = Math.max(left.length, right.length);
    let diff = 0;
    for (let y = 0; y < height; y++) {
        const rowA = left[y] || [];
        const rowB = right[y] || [];
        const width = Math.max(rowA.length, rowB.length);
        for (let x = 0; x < width; x++) {
            if (String(rowA[x] || '') !== String(rowB[x] || '')) {
                diff += 1;
            }
        }
    }
    return diff;
}

function effortScore(candidate) {
    if (candidate.unique_states != null) {
        return Number(candidate.unique_states) || 0;
    }
    if (candidate.uniqueStates != null) {
        return Number(candidate.uniqueStates) || 0;
    }
    if (candidate.generated != null) {
        return Number(candidate.generated) || 0;
    }
    return Number(candidate.expanded) || 0;
}

function candidateHash(candidate) {
    return String(candidate.level_hash != null ? candidate.level_hash : candidate.levelHash);
}

class CandidateBatchState {
    constructor(options = {}) {
        this.batchId = options.batchId || `batch-${Date.now()}`;
        this.topCount = options.topCount || 3;
        this.promotionBudgetsMs = options.promotionBudgetsMs || [1000, 5000, 30000, 120000];
        this.promotionQueueLimit = options.promotionQueueLimit || 64;
        this.byHash = new Map();
        this.loggedTopHashes = new Set();
        this.solved = [];
        this.timeouts = [];
        this.promoted = [];
    }

    normalize(candidate) {
        const normalized = { ...candidate };
        normalized.level_hash = candidate.level_hash != null ? candidate.level_hash : candidate.levelHash;
        normalized.effort_score = effortScore(candidate);
        normalized.cells = normalizeRows(candidate.cells || candidate.rows);
        normalized.solver_budget_ms = Number(candidate.solver_budget_ms || candidate.solverBudgetMs || this.promotionBudgetsMs[0]);
        return normalized;
    }

    recordEvaluation(candidate) {
        const normalized = this.normalize(candidate);
        const key = candidateHash(normalized);
        if (!key) {
            return { becameTopSolved: false };
        }
        this.byHash.set(key, normalized);
        if (normalized.status === 'solved') {
            const before = this.solvedTop().map(candidateHash).join(',');
            this.solved = this.solved.filter(entry => candidateHash(entry) !== key);
            this.solved.push(normalized);
            this.solved.sort((a, b) => b.effort_score - a.effort_score || String(a.level_hash).localeCompare(String(b.level_hash)));
            const afterTop = this.solvedTop();
            const after = afterTop.map(candidateHash).join(',');
            return {
                becameTopSolved: before !== after && afterTop.some(entry => candidateHash(entry) === key),
            };
        }
        if (normalized.status === 'timeout') {
            this.timeouts = this.timeouts.filter(entry => candidateHash(entry) !== key);
            this.timeouts.push(normalized);
            this.sortAndTrimTimeouts();
        }
        return { becameTopSolved: false };
    }

    solvedTop() {
        return this.solved.slice(0, this.topCount);
    }

    diversityScore(candidate) {
        const anchors = this.promoted.length > 0 ? this.promoted : [...this.solvedTop(), ...this.timeouts.slice(0, 3)];
        const distances = anchors
            .filter(entry => candidateHash(entry) !== candidateHash(candidate))
            .map(entry => gridDifference(candidate.cells, entry.cells));
        return distances.length === 0 ? 0 : Math.min(...distances);
    }

    promotionScore(candidate) {
        return candidate.effort_score + this.diversityScore(candidate);
    }

    sortAndTrimTimeouts() {
        this.timeouts.sort((a, b) => this.promotionScore(b) - this.promotionScore(a));
        if (this.timeouts.length > this.promotionQueueLimit) {
            this.timeouts.length = this.promotionQueueLimit;
        }
    }

    nextPromotion() {
        this.sortAndTrimTimeouts();
        const candidate = this.timeouts.shift();
        if (!candidate) {
            return null;
        }
        const currentIndex = this.promotionBudgetsMs.findIndex(budget => budget > candidate.solver_budget_ms);
        const nextBudget = currentIndex >= 0
            ? this.promotionBudgetsMs[currentIndex]
            : this.promotionBudgetsMs[this.promotionBudgetsMs.length - 1];
        const promoted = { ...candidate, next_budget_ms: nextBudget };
        this.promoted.push(promoted);
        return promoted;
    }

    timeoutQueue() {
        this.sortAndTrimTimeouts();
        return this.timeouts.slice();
    }

    shouldLogSolvedTop(levelHash) {
        const key = String(levelHash);
        if (this.loggedTopHashes.has(key)) {
            return false;
        }
        if (!this.solvedTop().some(entry => candidateHash(entry) === key)) {
            return false;
        }
        this.loggedTopHashes.add(key);
        return true;
    }
}

module.exports = {
    CandidateBatchState,
    effortScore,
    gridDifference,
};
```

- [ ] **Step 5: Run extension tests**

Run:

```bash
cd tools/vscode-puzzlescript
npm test
```

Expected: all tests pass and include `candidate scheduler tests passed`.

- [ ] **Step 6: Commit candidate scheduler**

```bash
git add tools/vscode-puzzlescript/package.json tools/vscode-puzzlescript/src/puzzlescriptCandidateScheduler.js tools/vscode-puzzlescript/test/candidate-scheduler.test.js
git commit -m "feat: model level studio candidate scheduling"
```

## Task 5: Solver Runner

**Files:**
- Create: `tools/vscode-puzzlescript/src/puzzlescriptSolverRunner.js`
- Create: `tools/vscode-puzzlescript/test/solver-runner.test.js`
- Modify: `tools/vscode-puzzlescript/package.json`

- [ ] **Step 1: Write failing solver runner tests**

Create `tools/vscode-puzzlescript/test/solver-runner.test.js`:

```js
#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PuzzleScriptSolverRun, parseSolverJson, resolveSolverPath } = require('../src/puzzlescriptSolverRunner');

function writeExecutable(dir, name, body) {
    const script = path.join(dir, name);
    fs.writeFileSync(script, `#!/usr/bin/env node\n${body}`, 'utf8');
    fs.chmodSync(script, 0o755);
    return script;
}

async function runTests() {
    assert.deepStrictEqual(parseSolverJson('noise\n{"results":[{"status":"solved"}]}\n'), {
        results: [{ status: 'solved' }],
    });
    assert.throws(() => parseSolverJson('not json'), /did not contain JSON/);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-solver-runner-'));
    const fakeSolver = path.join(tmp, process.platform === 'win32' ? 'puzzlescript_solver.exe' : 'puzzlescript_solver');
    fs.writeFileSync(fakeSolver, '');
    assert.deepStrictEqual(resolveSolverPath(fakeSolver, '/missing'), {
        path: fakeSolver,
        exists: true,
        source: 'setting',
    });
    assert.strictEqual(resolveSolverPath('', tmp).exists, false);

    const success = writeExecutable(tmp, 'solver-success.js', `
const fs = require('fs');
const sourcePath = process.argv[2];
if (!fs.readFileSync(sourcePath, 'utf8').includes('levels')) process.exit(3);
console.log(JSON.stringify({ results: [{ game: 'game', level: 0, status: 'solved', solution: ['right'], solution_length: 1, unique_states: 2 }] }));
`);
    const run = new PuzzleScriptSolverRun({
        binaryPath: success,
        sourceText: 'title T\\nlevels\\nP',
        level: 0,
        timeoutMs: 1000,
        strategy: 'portfolio',
    });
    const output = await run.start();
    assert.strictEqual(output.cancelled, false);
    assert.strictEqual(output.result.results[0].status, 'solved');
    assert.strictEqual(fs.existsSync(output.tempDir), false);

    const failure = writeExecutable(tmp, 'solver-failure.js', `
console.error('compile failed');
process.exit(2);
`);
    await assert.rejects(() => new PuzzleScriptSolverRun({
        binaryPath: failure,
        sourceText: '',
        level: 0,
        timeoutMs: 10,
        strategy: 'portfolio',
    }).start(), /compile failed/);

    fs.rmSync(tmp, { recursive: true, force: true });
}

runTests().then(() => {
    console.log('solver runner tests passed');
}).catch(error => {
    console.error(error);
    process.exit(1);
});
```

- [ ] **Step 2: Add solver runner test to `npm test`**

In `tools/vscode-puzzlescript/package.json`, update `scripts.test`:

```json
"test": "node ./test/level-studio-core.test.js && node ./test/generated-levels-log.test.js && node ./test/candidate-scheduler.test.js && node ./test/solver-runner.test.js && node ./test/editor-intelligence.test.js && node ./test/syntax-highlighting.test.js && node ./test/debugger.test.js && node ./test/level-links.test.js && node ./test/generator-core.test.js && node ./test/generator-runner.test.js"
```

- [ ] **Step 3: Run the test and verify it fails**

Run:

```bash
cd tools/vscode-puzzlescript
npm test
```

Expected: FAIL with `Cannot find module '../src/puzzlescriptSolverRunner'`.

- [ ] **Step 4: Implement solver runner**

Create `tools/vscode-puzzlescript/src/puzzlescriptSolverRunner.js`:

```js
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'puzzlescript-solver-'));
}

function removeTempDir(tempDir) {
    if (tempDir) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

function parseSolverJson(stdout) {
    const text = String(stdout || '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < start) {
        throw new Error('Solver output did not contain JSON.');
    }
    return JSON.parse(text.slice(start, end + 1));
}

function resolveSolverPath(configuredPath, repoRoot) {
    const configured = String(configuredPath || '').trim();
    if (configured) {
        return {
            path: configured,
            exists: fs.existsSync(configured),
            source: 'setting',
        };
    }
    const candidate = path.join(repoRoot, 'build', 'native', process.platform === 'win32' ? 'puzzlescript_solver.exe' : 'puzzlescript_solver');
    return {
        path: candidate,
        exists: fs.existsSync(candidate),
        source: 'repo',
    };
}

class PuzzleScriptSolverRun {
    constructor(options) {
        this.options = options;
        this.child = null;
        this.cancelled = false;
    }

    start() {
        const tempDir = makeTempDir();
        const gamePath = path.join(tempDir, 'game.txt');
        fs.writeFileSync(gamePath, String(this.options.sourceText || ''), 'utf8');
        const args = [
            gamePath,
            '--timeout-ms', String(this.options.timeoutMs || 1000),
            '--jobs', '1',
            '--strategy', String(this.options.strategy || 'portfolio'),
            '--level', String(this.options.level || 0),
            '--no-solutions',
            '--quiet',
            '--json',
        ];
        return new Promise((resolve, reject) => {
            let stdout = '';
            let stderr = '';
            this.child = childProcess.spawn(this.options.binaryPath, args, {
                cwd: path.dirname(this.options.binaryPath),
                windowsHide: true,
            });
            this.child.stdout.on('data', chunk => {
                stdout += String(chunk);
            });
            this.child.stderr.on('data', chunk => {
                stderr += String(chunk);
            });
            this.child.on('error', error => {
                removeTempDir(tempDir);
                reject(error);
            });
            this.child.on('close', code => {
                this.child = null;
                if (this.cancelled) {
                    removeTempDir(tempDir);
                    resolve({ cancelled: true, tempDir });
                    return;
                }
                if (code !== 0) {
                    removeTempDir(tempDir);
                    reject(new Error((stderr || `Solver exited with code ${code}`).trim()));
                    return;
                }
                try {
                    const result = parseSolverJson(stdout);
                    removeTempDir(tempDir);
                    resolve({ cancelled: false, tempDir, result });
                } catch (error) {
                    removeTempDir(tempDir);
                    reject(error);
                }
            });
        });
    }

    cancel() {
        this.cancelled = true;
        if (this.child) {
            this.child.kill();
        }
    }
}

module.exports = {
    PuzzleScriptSolverRun,
    parseSolverJson,
    resolveSolverPath,
};
```

- [ ] **Step 5: Run extension tests**

Run:

```bash
cd tools/vscode-puzzlescript
npm test
```

Expected: all tests pass and include `solver runner tests passed`.

- [ ] **Step 6: Commit solver runner**

```bash
git add tools/vscode-puzzlescript/package.json tools/vscode-puzzlescript/src/puzzlescriptSolverRunner.js tools/vscode-puzzlescript/test/solver-runner.test.js
git commit -m "feat: add level studio solver runner"
```

## Task 6: Generator Runner Event Support

**Files:**
- Modify: `tools/vscode-puzzlescript/src/puzzlescriptGeneratorRunner.js`
- Modify: `tools/vscode-puzzlescript/test/generator-runner.test.js`

- [ ] **Step 1: Extend generator runner test for events**

In `tools/vscode-puzzlescript/test/generator-runner.test.js`, add this block after the existing successful `goodRun` assertions:

```js
    const eventing = writeExecutable(tmp, 'eventing.js', `
const fs = require('fs');
const jsonOut = process.argv[process.argv.indexOf('--json-out') + 1];
const eventsOut = process.argv[process.argv.indexOf('--events-jsonl') + 1];
fs.appendFileSync(eventsOut, JSON.stringify({ event: 'candidate_evaluated', level_hash: 1, status: 'timeout', unique_states: 9, cells: [['player']] }) + '\\n');
fs.writeFileSync(jsonOut, JSON.stringify({ totals: { samples_attempted: 1 }, top: [] }));
`);
    const seenEvents = [];
    const eventRun = new PuzzleScriptGeneratorRun({
        binaryPath: eventing,
        sourceText: 'title T\\nlevels\\nP',
        specText: '(INIT LEVEL)\\nP\\n\\n(GENERATION RULES)\\nchoose 1 [ player ] -> [ player ]',
        runOptions: {
            timeMs: 10,
            jobs: 1,
            seed: 1,
            solverTimeoutMs: 10,
            solverStrategy: 'portfolio',
            topK: 1,
            samples: '',
        },
        onCandidateEvent: event => seenEvents.push(event),
    });
    await eventRun.start();
    assert.strictEqual(seenEvents.length, 1);
    assert.strictEqual(seenEvents[0].status, 'timeout');
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
cd tools/vscode-puzzlescript
node ./test/generator-runner.test.js
```

Expected: FAIL because `PuzzleScriptGeneratorRun` does not pass `--events-jsonl` or call `onCandidateEvent`.

- [ ] **Step 3: Implement event file support**

In `tools/vscode-puzzlescript/src/puzzlescriptGeneratorRunner.js`, add:

```js
function parseEventLines(text) {
    return String(text || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => JSON.parse(line));
}
```

In `PuzzleScriptGeneratorRun.start()`, after `jsonPath`:

```js
        const eventsPath = path.join(tempDir, 'events.jsonl');
```

Add to `args` after `--json-out`, `jsonPath`:

```js
            '--events-jsonl', eventsPath,
```

In the child `close` handler before parsing the final JSON, add:

```js
                if (eventsPath && fs.existsSync(eventsPath) && this.options.onCandidateEvent) {
                    for (const event of parseEventLines(fs.readFileSync(eventsPath, 'utf8'))) {
                        this.options.onCandidateEvent(event);
                    }
                }
```

Export `parseEventLines`:

```js
module.exports = {
    PuzzleScriptGeneratorRun,
    parseEventLines,
    parseGeneratorJson,
    parseProgressLine,
    removeTempDir,
};
```

- [ ] **Step 4: Run generator runner tests**

Run:

```bash
cd tools/vscode-puzzlescript
node ./test/generator-runner.test.js
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit event-aware generator runner**

```bash
git add tools/vscode-puzzlescript/src/puzzlescriptGeneratorRunner.js tools/vscode-puzzlescript/test/generator-runner.test.js
git commit -m "feat: surface generator candidate events"
```

## Task 7: Level Studio Webview Panel

**Files:**
- Create: `tools/vscode-puzzlescript/src/puzzlescriptLevelStudioPanel.js`
- Modify: `tools/vscode-puzzlescript/src/extension.js`

- [ ] **Step 1: Create the panel skeleton**

Create `tools/vscode-puzzlescript/src/puzzlescriptLevelStudioPanel.js`:

```js
'use strict';

const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { CandidateBatchState } = require('./puzzlescriptCandidateScheduler');
const { GeneratedLevelsLog } = require('./puzzlescriptGeneratedLevelsLog');
const {
    boardFromLevel,
    generatedLevelsLogPath,
    glyphPaletteForSource,
    isPuzzleScriptCandidateDocument,
    replaceGlyphAt,
    replaceLevelRowsInSource,
    rowsFromBoard,
} = require('./puzzlescriptLevelStudioCore');
const {
    DEFAULT_GENERATOR_OPTIONS,
    findPlayableLevels,
    normalizeRunOptions,
    readSidecarOrDefault,
    resolveGeneratorPath,
} = require('./puzzlescriptGeneratorCore');
const { PuzzleScriptGeneratorRun } = require('./puzzlescriptGeneratorRunner');
const { PuzzleScriptSolverRun, resolveSolverPath } = require('./puzzlescriptSolverRunner');

function uniqueBatchId() {
    return `batch-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function candidateRows(candidate) {
    if (Array.isArray(candidate.rows)) {
        return candidate.rows;
    }
    return (candidate.cells || []).map(row => row.map(cell => {
        const names = String(cell || '').split(/\s+/).filter(Boolean);
        if (names.includes('player')) return 'P';
        if (names.includes('crate') && names.includes('target')) return '@';
        if (names.includes('crate')) return '*';
        if (names.includes('target')) return 'O';
        if (names.includes('wall')) return '#';
        return '.';
    }).join(''));
}

class PuzzleScriptLevelStudioPanel {
    constructor({ context, repoRoot, document, intelligence }) {
        this.context = context;
        this.repoRoot = repoRoot;
        this.document = document;
        this.intelligence = intelligence;
        this.currentRun = null;
        this.currentSolve = null;
        this.batch = null;
        this.batchId = uniqueBatchId();
        this.options = { ...DEFAULT_GENERATOR_OPTIONS, topK: 3 };
        this.sidecar = readSidecarOrDefault(document.uri.fsPath, this.selectedLevel());
        this.generatedLog = new GeneratedLevelsLog(generatedLevelsLogPath(document.uri.fsPath));
        this.panel = vscode.window.createWebviewPanel(
            'puzzlescriptLevelStudio',
            'PuzzleScript Level Studio',
            vscode.ViewColumn.Beside,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        this.panel.webview.html = this.html();
        this.panel.onDidDispose(() => this.dispose(), null, context.subscriptions);
        this.panel.webview.onDidReceiveMessage(message => this.handleMessage(message), null, context.subscriptions);
        this.documentSubscription = vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document === this.document) {
                this.stopGeneration();
                this.postState('documentChanged');
            }
        });
    }

    dispose() {
        this.stopGeneration();
        if (this.currentSolve) {
            this.currentSolve.cancel();
            this.currentSolve = null;
        }
        if (this.documentSubscription) {
            this.documentSubscription.dispose();
        }
    }

    post(message) {
        this.panel.webview.postMessage(message);
    }

    source() {
        return this.document.getText();
    }

    levels() {
        return findPlayableLevels(this.source());
    }

    selectedLevel(index = 0) {
        return this.levels()[Number(index) || 0] || null;
    }

    diagnostics() {
        return this.intelligence.diagnose(this.source());
    }

    postState(reason) {
        const levels = this.levels();
        this.post({
            type: 'state',
            reason,
            sourcePath: this.document.uri.fsPath,
            levels,
            palette: glyphPaletteForSource(this.source()),
            diagnostics: this.diagnostics(),
            generatorOptions: this.options,
            sidecarPath: this.sidecar.path,
            generatedLogPath: generatedLevelsLogPath(this.document.uri.fsPath),
        });
    }

    async handleMessage(message) {
        try {
            switch (message && message.type) {
                case 'ready':
                    this.postState('ready');
                    break;
                case 'paint':
                    await this.paint(message);
                    break;
                case 'solve':
                    await this.solve(message);
                    break;
                case 'runGeneration':
                    await this.runGeneration(message);
                    break;
                case 'stopGeneration':
                    this.stopGeneration();
                    this.post({ type: 'generationStopped' });
                    break;
                case 'adoptCandidate':
                    await this.adoptCandidate(message);
                    break;
                default:
                    break;
            }
        } catch (error) {
            this.post({ type: 'error', message: error.message || String(error) });
        }
    }
}

module.exports = {
    PuzzleScriptLevelStudioPanel,
    candidateRows,
    isPuzzleScriptCandidateDocument,
};
```

- [ ] **Step 2: Add document edit, solve, generation, and adoption methods**

Append these methods inside `PuzzleScriptLevelStudioPanel` before `handleMessage` or after it in the class:

```js
    async paint(message) {
        const level = this.selectedLevel(message.levelIndex);
        if (!level) {
            throw new Error('No playable level selected.');
        }
        const board = replaceGlyphAt(boardFromLevel(level), Number(message.x), Number(message.y), String(message.glyph || '.'));
        const nextSource = replaceLevelRowsInSource(this.source(), level, rowsFromBoard(board));
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(this.document.lineCount - 1, this.document.lineAt(this.document.lineCount - 1).text.length)
        );
        edit.replace(this.document.uri, fullRange, nextSource);
        await vscode.workspace.applyEdit(edit);
    }

    async solve(message) {
        const config = vscode.workspace.getConfiguration('puzzlescript');
        const resolved = resolveSolverPath(config.get('solverPath'), this.repoRoot);
        if (!resolved.exists) {
            this.post({ type: 'error', message: `Native solver not found at ${resolved.path}. Build it with: make build_solver` });
            return;
        }
        if (this.currentSolve) {
            this.currentSolve.cancel();
        }
        this.currentSolve = new PuzzleScriptSolverRun({
            binaryPath: resolved.path,
            sourceText: this.source(),
            level: Number(message.levelIndex) || 0,
            timeoutMs: Number(message.timeoutMs) || 1000,
            strategy: String(message.strategy || 'portfolio'),
        });
        this.post({ type: 'solving', levelIndex: Number(message.levelIndex) || 0 });
        const output = await this.currentSolve.start();
        this.currentSolve = null;
        if (!output.cancelled) {
            this.post({ type: 'solveResult', result: output.result });
        }
    }

    stopGeneration() {
        if (this.currentRun) {
            this.currentRun.cancel();
            this.currentRun = null;
        }
    }

    async runGeneration(message) {
        this.stopGeneration();
        const config = vscode.workspace.getConfiguration('puzzlescript');
        const resolved = resolveGeneratorPath(config.get('generatorPath'), this.repoRoot);
        if (!resolved.exists) {
            this.post({ type: 'error', message: `Native generator not found at ${resolved.path}. Build it with: make build_generator` });
            return;
        }
        const level = this.selectedLevel(message.levelIndex);
        if (!level) {
            throw new Error('No playable level selected.');
        }
        this.batchId = uniqueBatchId();
        this.batch = new CandidateBatchState({ batchId: this.batchId, topCount: 3 });
        this.options = normalizeRunOptions(message.options || this.options);
        const recipeText = String(message.recipeText || this.sidecar.text || '');
        this.currentRun = new PuzzleScriptGeneratorRun({
            binaryPath: resolved.path,
            sourceText: this.source(),
            specText: recipeText,
            runOptions: this.options,
            onProgress: progress => this.post({ type: 'generationProgress', progress }),
            onCandidateEvent: event => this.handleCandidateEvent(event, recipeText, level),
        });
        this.post({ type: 'generationStarted', batchId: this.batchId });
        const output = await this.currentRun.start();
        this.currentRun = null;
        if (output.cancelled) {
            this.post({ type: 'generationStopped' });
            return;
        }
        this.post({ type: 'generationFinished', result: output.result });
    }

    handleCandidateEvent(event, recipeText, sourceLevel) {
        if (!this.batch) {
            return;
        }
        const outcome = this.batch.recordEvaluation(event);
        const top = this.batch.solvedTop();
        this.post({
            type: 'candidateEvent',
            event,
            solvedTop: top,
            timeouts: this.batch.timeoutQueue(),
        });
        if (event.status === 'solved' && outcome.becameTopSolved && this.batch.shouldLogSolvedTop(event.level_hash)) {
            const rank = top.findIndex(candidate => String(candidate.level_hash) === String(event.level_hash)) + 1;
            this.generatedLog.appendIfNewTopSolved({
                timestamp: new Date().toISOString(),
                sourceFile: path.basename(this.document.uri.fsPath),
                batchId: this.batchId,
                sourceLevel: sourceLevel.level,
                levelHash: event.level_hash,
                rankWhenLogged: rank,
                effortScore: event.unique_states,
                solverStatus: 'solved',
                solverStrategy: this.options.solverStrategy,
                solverBudgetMs: event.solver_budget_ms || this.options.solverTimeoutMs,
                solutionLength: event.solution_length,
                solution: event.solution || [],
                expanded: event.expanded,
                generated: event.generated,
                uniqueStates: event.unique_states,
                recipeText,
                rows: candidateRows(event),
            });
        }
    }

    async adoptCandidate(message) {
        const candidate = message.candidate;
        const level = this.selectedLevel(message.levelIndex);
        if (!candidate || !level) {
            throw new Error('No candidate selected.');
        }
        const nextSource = replaceLevelRowsInSource(this.source(), level, candidateRows(candidate));
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(this.document.lineCount - 1, this.document.lineAt(this.document.lineCount - 1).text.length)
        );
        edit.replace(this.document.uri, fullRange, nextSource);
        await vscode.workspace.applyEdit(edit);
    }
```

- [ ] **Step 3: Add minimal HTML method**

Add this method inside the class:

```js
    html() {
        const nonce = String(Date.now());
        return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0}
main{display:grid;grid-template-rows:auto 1fr;height:100vh}
.tabs{display:flex;border-bottom:1px solid var(--vscode-panel-border)}
.tabs button{background:transparent;color:var(--vscode-foreground);border:0;border-right:1px solid var(--vscode-panel-border);padding:8px 12px;cursor:pointer}
.tabs button.active{background:var(--vscode-tab-activeBackground)}
.view{display:none;padding:10px;overflow:auto}.view.active{display:block}
.layout{display:grid;grid-template-columns:180px minmax(260px,1fr) 260px;gap:10px}
.panel{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:8px;background:var(--vscode-sideBar-background)}
.board{display:inline-grid;gap:2px;background:var(--vscode-panel-border);padding:4px}
.cell{width:24px;height:24px;border:0;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-family:var(--vscode-editor-font-family);cursor:pointer}
.candidate{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:6px;margin-bottom:6px}
textarea{width:100%;min-height:160px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border)}
button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:5px 8px;border-radius:3px;margin:2px;cursor:pointer}
button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
.status{white-space:pre-wrap;color:var(--vscode-descriptionForeground);font-size:12px}
</style>
</head>
<body>
<main>
<div class="tabs"><button id="levelsTab" class="active">Levels</button><button id="candidatesTab">Candidates</button></div>
<section id="levelsView" class="view active"><div class="layout"><div class="panel" id="levelList"></div><div class="panel"><div id="board"></div><div id="palette"></div></div><div class="panel"><button id="solve">Solve</button><div id="solveStatus" class="status"></div></div></div></section>
<section id="candidatesView" class="view"><div class="layout"><div class="panel"><textarea id="recipe"></textarea><button id="runGeneration">Run</button><button id="stopGeneration" class="secondary">Stop</button></div><div class="panel"><h3>Solved Top</h3><div id="candidates"></div><h3>Timeouts</h3><div id="timeouts"></div></div><div class="panel"><div id="generationStatus" class="status"></div></div></div></section>
</main>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let state = { levels: [], palette: [], levelIndex: 0, selectedGlyph: '.' };
let latestCandidates = [];
const $ = id => document.getElementById(id);
function show(tab){$('levelsView').classList.toggle('active',tab==='levels');$('candidatesView').classList.toggle('active',tab==='candidates');$('levelsTab').classList.toggle('active',tab==='levels');$('candidatesTab').classList.toggle('active',tab==='candidates');}
function renderLevels(){const root=$('levelList');root.innerHTML='';state.levels.forEach((level,i)=>{const b=document.createElement('button');b.className='secondary';b.textContent='Level '+level.level;b.onclick=()=>{state.levelIndex=i;renderBoard();};root.appendChild(b);});renderBoard();renderPalette();}
function renderBoard(){const level=state.levels[state.levelIndex];const root=$('board');root.innerHTML='';if(!level){root.textContent='No playable levels.';return;}const rows=level.rows||[];const board=document.createElement('div');board.className='board';board.style.gridTemplateColumns='repeat('+Math.max(...rows.map(r=>r.length))+',24px)';rows.forEach((row,y)=>[...row].forEach((glyph,x)=>{const c=document.createElement('button');c.className='cell';c.textContent=glyph;c.onclick=()=>vscode.postMessage({type:'paint',levelIndex:state.levelIndex,x,y,glyph:state.selectedGlyph});board.appendChild(c);}));root.appendChild(board);}
function renderPalette(){const root=$('palette');root.innerHTML='';state.palette.forEach(entry=>{const b=document.createElement('button');b.className='secondary';b.textContent=entry.glyph;b.title=entry.label;b.onclick=()=>{state.selectedGlyph=entry.glyph;};root.appendChild(b);});}
function renderCandidates(candidates){latestCandidates=candidates||[];const root=$('candidates');root.innerHTML='';latestCandidates.forEach(candidate=>{const div=document.createElement('div');div.className='candidate';div.textContent='hash '+candidate.level_hash+' effort '+candidate.effort_score+' solution '+(candidate.solution||[]).join(' ');const adopt=document.createElement('button');adopt.textContent='Adopt';adopt.onclick=()=>vscode.postMessage({type:'adoptCandidate',levelIndex:state.levelIndex,candidate});div.appendChild(adopt);root.appendChild(div);});}
function renderTimeouts(timeouts){const root=$('timeouts');root.innerHTML='';(timeouts||[]).forEach(candidate=>{const div=document.createElement('div');div.className='candidate';div.textContent='timeout hash '+candidate.level_hash+' effort '+candidate.effort_score;root.appendChild(div);});}
window.addEventListener('message', event=>{const msg=event.data;if(msg.type==='state'){state={...state,...msg};$('recipe').value=msg.specText||$('recipe').value;renderLevels();}if(msg.type==='solving'){$('solveStatus').textContent='Solving...';}if(msg.type==='solveResult'){$('solveStatus').textContent=JSON.stringify(msg.result,null,2);}if(msg.type==='generationStarted'){$('generationStatus').textContent='Running '+msg.batchId;}if(msg.type==='generationProgress'){$('generationStatus').textContent=JSON.stringify(msg.progress,null,2);}if(msg.type==='candidateEvent'){renderCandidates(msg.solvedTop);renderTimeouts(msg.timeouts);}if(msg.type==='generationFinished'){$('generationStatus').textContent='Finished\\n'+JSON.stringify(msg.result&&msg.result.totals,null,2);}if(msg.type==='generationStopped'){$('generationStatus').textContent='Stopped.';}if(msg.type==='error'){$('generationStatus').textContent='Error: '+msg.message;$('solveStatus').textContent='Error: '+msg.message;}});
$('levelsTab').onclick=()=>show('levels');$('candidatesTab').onclick=()=>show('candidates');$('solve').onclick=()=>vscode.postMessage({type:'solve',levelIndex:state.levelIndex,timeoutMs:1000,strategy:'portfolio'});$('runGeneration').onclick=()=>vscode.postMessage({type:'runGeneration',levelIndex:state.levelIndex,recipeText:$('recipe').value,options:{topK:3,solverTimeoutMs:1000,solverStrategy:'portfolio',jobs:'auto',timeMs:60000,seed:1}});$('stopGeneration').onclick=()=>vscode.postMessage({type:'stopGeneration'});
vscode.postMessage({type:'ready'});
</script>
</body>
</html>`;
    }
```

- [ ] **Step 4: Wire the command in `extension.js`**

In `tools/vscode-puzzlescript/src/extension.js`, add:

```js
const {
    PuzzleScriptLevelStudioPanel,
    isPuzzleScriptCandidateDocument,
} = require('./puzzlescriptLevelStudioPanel');
```

Inside `activate`, add:

```js
    const openLevelStudio = async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.scheme !== 'file') {
            vscode.window.showWarningMessage('Open a PuzzleScript .txt file before opening Level Studio.');
            return null;
        }
        if (!shouldHandleDocument(editor.document, intelligence)
            && !isPuzzleScriptCandidateDocument(editor.document.getText(), editor.document.fileName)) {
            vscode.window.showWarningMessage('Open a PuzzleScript-looking .txt file before opening Level Studio.');
            return null;
        }
        const document = editor.document.languageId === 'puzzlescript'
            ? editor.document
            : await vscode.languages.setTextDocumentLanguage(editor.document, 'puzzlescript');
        return new PuzzleScriptLevelStudioPanel({
            context,
            repoRoot: resolveRepoRoot(context),
            document,
            intelligence,
        });
    };
```

Add to `context.subscriptions.push(...)`:

```js
        vscode.commands.registerCommand('puzzlescript.openLevelStudio', openLevelStudio),
```

- [ ] **Step 5: Run extension tests**

Run:

```bash
cd tools/vscode-puzzlescript
npm test
```

Expected: all tests pass. This does not visually test the webview yet.

- [ ] **Step 6: Commit webview panel**

```bash
git add tools/vscode-puzzlescript/src/extension.js tools/vscode-puzzlescript/src/puzzlescriptLevelStudioPanel.js
git commit -m "feat: add PuzzleScript level studio panel"
```

## Task 8: Extension Contributions And Settings

**Files:**
- Modify: `tools/vscode-puzzlescript/package.json`
- Modify: `tools/vscode-puzzlescript/README.md`

- [ ] **Step 1: Add package contribution**

In `tools/vscode-puzzlescript/package.json`, add a solver setting under `contributes.configuration.properties`:

```json
"puzzlescript.solverPath": {
  "type": "string",
  "default": "",
  "description": "Path to the native puzzlescript_solver executable. Empty uses <puzzlescript.repoRoot>/build/native/puzzlescript_solver."
}
```

Add this command to `contributes.commands`:

```json
{
  "command": "puzzlescript.openLevelStudio",
  "title": "Open Level Studio",
  "category": "PuzzleScript"
}
```

Add this menu item to both `menus.editor/title` and `menus.editor/context`:

```json
{
  "command": "puzzlescript.openLevelStudio",
  "when": "resourceLangId == puzzlescript",
  "group": "navigation"
}
```

- [ ] **Step 2: Run package tests**

Run:

```bash
cd tools/vscode-puzzlescript
npm test
```

Expected: all tests pass and `package.json` parses.

- [ ] **Step 3: Update README**

Append this section to `tools/vscode-puzzlescript/README.md` after “Generating Levels”:

```markdown
## Level Studio

Open a PuzzleScript-looking `.txt`, `.ps`, or `.puzzlescript` file and run `PuzzleScript: Open Level Studio`.

The Level Studio opens beside the normal VS Code editor. The VS Code editor remains the source editor; Studio edits apply to the open document buffer and use normal VS Code save behavior.

The `Levels` tab provides a glyph-based level browser/editor, solver run controls, and solution replay.

The `Candidates` tab runs generation recipes from the current in-memory source and selected level. Candidate generation stops when the Studio closes. Solved candidates that enter the current batch's top 3 are appended once to `<game>.generatedlevels.txt` beside the source file. Timeout candidates remain visible in the Studio but are not written to the log unless a later promoted evaluation solves them and they enter the solved top 3.

Build native tools first:

```sh
make build_solver
make build_generator
```

If the extension cannot find the native binaries under `<puzzlescript.repoRoot>/build/native`, set `puzzlescript.solverPath` or `puzzlescript.generatorPath`.
```

- [ ] **Step 4: Commit contributions and docs**

```bash
git add tools/vscode-puzzlescript/package.json tools/vscode-puzzlescript/README.md
git commit -m "docs: document PuzzleScript level studio"
```

## Task 9: Verification Pass

**Files:**
- No new files unless fixing issues found by tests.

- [ ] **Step 1: Run extension tests**

Run:

```bash
cd tools/vscode-puzzlescript
npm test
```

Expected: all Node tests pass.

- [ ] **Step 2: Run native generator event test**

Run:

```bash
cmake --build build --target puzzlescript_generator
node src/tests/run_generator_events_jsonl_node.js build/native/puzzlescript_generator "$PWD"
```

Expected: `generator events jsonl test passed`.

- [ ] **Step 3: Run native smoke tests**

Run:

```bash
make solver_smoke_tests
make generator_smoke_tests
```

Expected: both pass.

- [ ] **Step 4: Inspect git state**

Run:

```bash
git status --short
```

Expected: no unstaged or uncommitted changes.

- [ ] **Step 5: Report manual VS Code smoke requirement**

Because VS Code Extension Development Host cannot be exercised from the headless test runner, report that manual smoke remains:

1. Open `tools/vscode-puzzlescript` in VS Code.
2. Launch `Run PuzzleScript Extension`.
3. Open a PuzzleScript-looking `game.txt`.
4. Run `PuzzleScript: Open Level Studio`.
5. Paint a glyph and confirm the document becomes dirty.
6. Solve a level.
7. Run generation and confirm `game.generatedlevels.txt` receives solved top-3 entries once.
