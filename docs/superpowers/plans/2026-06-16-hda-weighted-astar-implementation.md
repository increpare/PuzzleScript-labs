# Hash-Distributed Weighted A* Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an experimental hash-distributed weighted-A* mode that solves one native PuzzleScript level across multiple worker shards.

**Architecture:** Keep existing serial `weighted-astar` unchanged. Add `--strategy hda-weighted-astar --hda-jobs N|auto`; `--hda-jobs 1` delegates to today's serial weighted-A* path, while `--hda-jobs >1` runs a shard-owned frontier/visited/node-arena search with mutex-protected inboxes for cross-shard handoff. HDA* uses compact `PersistentLevelState` messages, deterministic `StateKeyHash` ownership, shared timeout/cancel flags, and cross-shard parent ids for reconstruction.

**Tech Stack:** C++17 native solver in `native/src/solver/main.cpp`, Node.js test runners under `src/tests`, Makefile native solver targets.

---

## Current Worktree Note

The current worktree may contain uncommitted portfolio-threading edits in `native/src/solver/main.cpp` and `src/tests/run_solver_search_modes_node.js`. Do not revert them. HDA* commits should stage only the HDA* files touched in each task.

## File Structure

- Modify `native/src/solver/main.cpp`: add HDA CLI option, strategy enum value, result counters, JSON output, HDA helper structs, HDA reconstruction, HDA worker loop, and `solveLevel` dispatch.
- Modify `src/tests/run_solver_search_modes_node.js`: add focused HDA one-level assertions.
- Create `src/tests/run_solver_hda_smoke_node.js`: compare serial weighted-A* and HDA* on `src/tests/solver_smoke_tests`, including an exhausted case to prove idle termination.
- Modify `Makefile`: wire the new smoke test into `solver_search_mode_tests`.

## Task 1: Add Failing HDA Tests

**Files:**
- Modify: `src/tests/run_solver_search_modes_node.js`
- Create: `src/tests/run_solver_hda_smoke_node.js`
- Modify: `Makefile`

- [ ] **Step 1: Extend the focused search-mode test**

In `src/tests/run_solver_search_modes_node.js`, before the final `console.log('run_solver_search_modes_node passed');`, add:

```javascript
const hdaSerial = runSolver('hda-weighted-astar', ['--hda-jobs', '1']);
assert.strictEqual(hdaSerial.status, 'solved');
assert.strictEqual(hdaSerial.strategy, 'hda-weighted-astar');
assert.strictEqual(hdaSerial.hda_jobs, 1);
assert.strictEqual(hdaSerial.hda_parallel, false);
assert.deepStrictEqual(hdaSerial.solution, ['right']);

const hdaParallel = runSolver('hda-weighted-astar', ['--hda-jobs', '2']);
assert.strictEqual(hdaParallel.status, 'solved');
assert.strictEqual(hdaParallel.strategy, 'hda-weighted-astar');
assert.strictEqual(hdaParallel.hda_jobs, 2);
assert.strictEqual(hdaParallel.hda_parallel, true);
assert.ok(hdaParallel.hda_inbox_drains >= 0);
assert.ok(hdaParallel.hda_remote_sends >= 0);
assert.ok(hdaParallel.hda_owner_shard_solves >= 0);
assert.deepStrictEqual(hdaParallel.solution, ['right']);
```

- [ ] **Step 2: Create the HDA smoke comparison test**

Create `src/tests/run_solver_hda_smoke_node.js`:

```javascript
#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

if (process.argv.length < 3) {
    console.error('Usage: node src/tests/run_solver_hda_smoke_node.js <puzzlescript_solver>');
    process.exit(1);
}

const solverPath = path.resolve(process.argv[2]);
const rootDir = path.resolve(__dirname, '..', '..');
const smokeDir = path.join(rootDir, 'src/tests/solver_smoke_tests');

function runSolver(args, label) {
    const result = spawnSync(solverPath, args, {
        cwd: rootDir,
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
    });
    assert.strictEqual(result.status, 0, `${label}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    return JSON.parse(result.stdout);
}

function keyOf(result) {
    return `${result.game}#${result.level}`;
}

const commonArgs = [
    smokeDir,
    '--timeout-ms', '1000',
    '--jobs', '1',
    '--no-solutions',
    '--quiet',
    '--json',
];

const serial = runSolver([
    ...commonArgs,
    '--strategy', 'weighted-astar',
], 'serial weighted-astar');

const hda = runSolver([
    ...commonArgs,
    '--strategy', 'hda-weighted-astar',
    '--hda-jobs', '4',
], 'hda weighted-astar');

assert.strictEqual(serial.totals.levels, 14);
assert.strictEqual(serial.totals.solved, 9);
assert.strictEqual(serial.totals.exhausted, 1);
assert.strictEqual(serial.totals.skipped_message, 4);
assert.strictEqual(serial.totals.timeout, 0);
assert.strictEqual(serial.totals.errors, 0);

assert.strictEqual(hda.totals.levels, serial.totals.levels);
assert.strictEqual(hda.totals.errors, 0);
assert.strictEqual(hda.totals.timeout, 0);
assert.strictEqual(hda.totals.exhausted, serial.totals.exhausted);
assert.strictEqual(hda.totals.skipped_message, serial.totals.skipped_message);
assert.ok(hda.totals.solved >= serial.totals.solved);
assert.ok(hda.totals.hda_remote_sends >= 0);
assert.ok(hda.totals.hda_inbox_drains >= 0);

const serialByKey = new Map(serial.results.map((result) => [keyOf(result), result]));
for (const result of hda.results) {
    const key = keyOf(result);
    const expected = serialByKey.get(key);
    assert.ok(expected, `unexpected HDA result ${key}`);
    assert.strictEqual(result.hda_jobs, 4, key);
    assert.strictEqual(result.hda_parallel, true, key);
    if (expected.status === 'skipped_message' || expected.status === 'exhausted') {
        assert.strictEqual(result.status, expected.status, key);
    }
    if (result.status === 'solved') {
        assert.ok(Array.isArray(result.solution), key);
        assert.ok(result.solution.length > 0, key);
    }
}

console.log('run_solver_hda_smoke_node passed');
```

- [ ] **Step 3: Wire the smoke test into the Makefile**

In `Makefile`, in the `solver_search_mode_tests` target, add the new runner after `run_solver_search_modes_node.js`:

```make
solver_search_mode_tests: $(SOLVER_TARGET_PREREQ)
	$(NODE) src/tests/run_solver_search_modes_node.js $(PUZZLESCRIPT_SOLVER)
	$(NODE) src/tests/run_solver_hda_smoke_node.js $(PUZZLESCRIPT_SOLVER)
	$(NODE) src/tests/run_native_solver_heuristic_selection_node.js $(PUZZLESCRIPT_SOLVER)
```

- [ ] **Step 4: Run the focused target and verify it fails**

Run:

```bash
make solver_search_mode_tests
```

Expected: FAIL because `hda-weighted-astar` or `--hda-jobs` is not supported yet.

- [ ] **Step 5: Commit the failing tests**

```bash
git add src/tests/run_solver_search_modes_node.js src/tests/run_solver_hda_smoke_node.js Makefile
git commit -m "test(solver): cover HDA weighted astar mode"
```

## Task 2: Add CLI, Strategy, Metadata, And One-Shard Fallback

**Files:**
- Modify: `native/src/solver/main.cpp`

- [ ] **Step 1: Add the strategy enum value**

In `enum class Strategy`, add:

```cpp
    HdaWeightedAStar,
```

so the enum contains:

```cpp
enum class Strategy {
    Portfolio,
    Bfs,
    WeightedAStar,
    WeightedAStarDeep,
    Greedy,
    HdaWeightedAStar,
};
```

- [ ] **Step 2: Add option and result fields**

In `struct Options`, add next to `jobs` and any current portfolio job option:

```cpp
    size_t hdaJobs = 1;
```

In `struct Result`, add near the other search-mode metadata fields:

```cpp
    uint32_t hdaJobs = 1;
    bool hdaParallel = false;
    uint64_t hdaRemoteSends = 0;
    uint64_t hdaInboxDrains = 0;
    uint64_t hdaOwnerShardSolves = 0;
```

- [ ] **Step 3: Parse the new strategy and option**

Update `strategyName`:

```cpp
        case Strategy::HdaWeightedAStar: return "hda-weighted-astar";
```

Update `parseStrategy`:

```cpp
    if (value == "hda-weighted-astar") {
        return Strategy::HdaWeightedAStar;
    }
```

Update the usage string in `parseArgs` to include both:

```text
[--hda-jobs auto|N|1]
```

and:

```text
hda-weighted-astar
```

Add argument parsing after `--jobs` parsing:

```cpp
        if (arg == "--hda-jobs" && index + 1 < argc) {
            const std::string value = argv[++index];
            options.hdaJobs = value == "auto" ? autoJobCount() : std::max<size_t>(1, std::stoull(value));
            continue;
        }
```

- [ ] **Step 4: Print HDA fields in per-result JSON**

In `printJsonResult`, after `astar_weight`, add:

```cpp
    out << ",\"hda_jobs\":" << result.hdaJobs;
    out << ",\"hda_parallel\":" << (result.hdaParallel ? "true" : "false");
    out << ",\"hda_remote_sends\":" << result.hdaRemoteSends;
    out << ",\"hda_inbox_drains\":" << result.hdaInboxDrains;
    out << ",\"hda_owner_shard_solves\":" << result.hdaOwnerShardSolves;
```

- [ ] **Step 5: Aggregate HDA fields in totals JSON**

In `printJson`, add local totals:

```cpp
    uint64_t hdaRemoteSends = 0;
    uint64_t hdaInboxDrains = 0;
    uint64_t hdaOwnerShardSolves = 0;
```

Inside the loop over results, add:

```cpp
        hdaRemoteSends += result.hdaRemoteSends;
        hdaInboxDrains += result.hdaInboxDrains;
        hdaOwnerShardSolves += result.hdaOwnerShardSolves;
```

When printing totals, add:

```cpp
    std::cout << ",\"hda_remote_sends\":" << hdaRemoteSends;
    std::cout << ",\"hda_inbox_drains\":" << hdaInboxDrains;
    std::cout << ",\"hda_owner_shard_solves\":" << hdaOwnerShardSolves;
```

- [ ] **Step 6: Add compact-storage selection and one-shard fallback in `solveLevel`**

Update the `solveLevel` signature to accept `size_t hdaJobs` after `portfolioJobs`:

```cpp
    const puzzlescript::solver::StaticAnalysisHints* staticAnalysisHints,
    size_t portfolioJobs,
    size_t hdaJobs
```

Update the local compact-storage decision so HDA always uses compact node state for cross-shard handoffs:

```cpp
    const bool effectiveCompactNodeStorage =
        compactNodeStorage
        || (strategy == Strategy::HdaWeightedAStar && hdaJobs > 1)
        || (strategy == Strategy::Portfolio && !fullNodeStorage);
```

Add this branch after the regular weighted-A* branch and before portfolio handling:

```cpp
    if (strategy == Strategy::HdaWeightedAStar && hdaJobs <= 1) {
        Result result = runSearch(
            loadedGame,
            gameName,
            levelIndex,
            timeoutMs,
            compileNs,
            SearchMode::WeightedAStar,
            deadline,
            workerId,
            exactStateKeys,
            effectiveCompactNodeStorage,
            compactTurnOracle,
            astarWeight,
            heuristicKind,
            staticAnalysisHints);
        result.strategy = "hda-weighted-astar";
        result.hdaJobs = 1;
        result.hdaParallel = false;
        return finish(std::move(result));
    }
```

- [ ] **Step 7: Pass `options.hdaJobs` from `runCorpus`**

Update the `solveLevel` call in `runCorpus` so the final arguments are:

```cpp
                    options.heuristicKind,
                    &compiled.staticAnalysisHints,
                    options.portfolioJobs,
                    options.hdaJobs
```

- [ ] **Step 8: Run the focused test**

Run:

```bash
make build_solver
node src/tests/run_solver_search_modes_node.js build/native/puzzlescript_solver
```

Expected: `hdaSerial` passes, `hdaParallel` still fails because the multi-shard engine is not implemented.

- [ ] **Step 9: Commit CLI and serial fallback**

```bash
git add native/src/solver/main.cpp
git commit -m "feat(solver): add HDA weighted astar CLI"
```

## Task 3: Make `FlatBestDepth` Work With HDA Nodes

**Files:**
- Modify: `native/src/solver/main.cpp`

- [ ] **Step 1: Template `FlatBestDepth::find`**

Change:

```cpp
    std::optional<uint32_t> find(
        const StateKey& key,
        const PersistentLevelState& state,
        const std::vector<Node>& nodes
    )
```

to:

```cpp
    template <typename Nodes>
    std::optional<uint32_t> find(
        const StateKey& key,
        const PersistentLevelState& state,
        const Nodes& nodes
    )
```

- [ ] **Step 2: Template `FlatBestDepth::insertOrAssignIfBetter`**

Change:

```cpp
    bool insertOrAssignIfBetter(
        const StateKey& key,
        const PersistentLevelState& state,
        uint32_t depth,
        uint32_t nodeIndex,
        const std::vector<Node>& nodes
    )
```

to:

```cpp
    template <typename Nodes>
    bool insertOrAssignIfBetter(
        const StateKey& key,
        const PersistentLevelState& state,
        uint32_t depth,
        uint32_t nodeIndex,
        const Nodes& nodes
    )
```

- [ ] **Step 3: Template `FlatBestDepth::findSlot`**

Change:

```cpp
    size_t findSlot(
        const StateKey& key,
        const PersistentLevelState& state,
        const std::vector<Node>& nodes,
        size_t& probes
    )
```

to:

```cpp
    template <typename Nodes>
    size_t findSlot(
        const StateKey& key,
        const PersistentLevelState& state,
        const Nodes& nodes,
        size_t& probes
    )
```

The existing body can stay the same because both `Node` and the new HDA node type will expose a `.state` member.

- [ ] **Step 4: Build and run existing search-mode tests**

Run:

```bash
make build_solver
node src/tests/run_solver_search_modes_node.js build/native/puzzlescript_solver
```

Expected: same state as Task 2. Existing serial and portfolio tests still pass; HDA parallel still fails.

- [ ] **Step 5: Commit the generic visited helper**

```bash
git add native/src/solver/main.cpp
git commit -m "refactor(solver): generalize flat best-depth nodes"
```

## Task 4: Add HDA Helper Types And Reconstruction

**Files:**
- Modify: `native/src/solver/main.cpp`

- [ ] **Step 1: Add `<deque>` include**

Near the other standard includes, add:

```cpp
#include <deque>
```

- [ ] **Step 2: Add HDA helper types after `QueueEntryGreater`**

Insert:

```cpp
constexpr uint32_t kInvalidHdaShard = std::numeric_limits<uint32_t>::max();
constexpr uint32_t kInvalidHdaNode = std::numeric_limits<uint32_t>::max();

struct GlobalNodeId {
    uint32_t shard = kInvalidHdaShard;
    uint32_t index = kInvalidHdaNode;

    bool valid() const {
        return shard != kInvalidHdaShard && index != kInvalidHdaNode;
    }
};

struct HdaNode {
    PersistentLevelState state;
    StateKey key;
    GlobalNodeId parent;
    ps_input input = PS_INPUT_UP;
    uint32_t depth = 0;
    int32_t heuristic = 0;
};

struct HdaMessage {
    PersistentLevelState state;
    StateKey key;
    uint32_t depth = 0;
    int32_t heuristic = 0;
    GlobalNodeId parent;
    ps_input input = PS_INPUT_UP;
};

struct HdaWinner {
    bool found = false;
    GlobalNodeId parent;
    ps_input finalInput = PS_INPUT_UP;
    uint32_t shard = 0;
};
```

- [ ] **Step 3: Add the HDA shard type after `FlatBestDepth`**

Insert:

```cpp
struct HdaShard {
    HdaShard(uint32_t shardId, bool exactStateKeys)
        : shardId(shardId), bestDepth(timing, exactStateKeys) {}

    uint32_t shardId = 0;
    Timing timing;
    FlatBestDepth bestDepth;
    std::vector<HdaNode> nodes;
    std::priority_queue<QueueEntry, std::vector<QueueEntry>, QueueEntryGreater> frontier;
    std::mutex inboxMutex;
    std::deque<HdaMessage> inbox;
    std::atomic<uint64_t> inboxCount{0};
    std::atomic<uint64_t> frontierCount{0};
    uint64_t nextTie = 0;
    uint64_t expanded = 0;
    uint64_t generated = 0;
    uint64_t duplicates = 0;
    uint64_t maxFrontier = 0;
    uint64_t compactTurnAttempts = 0;
    uint64_t compactTurnHits = 0;
    uint64_t compactTurnNativeAttempts = 0;
    uint64_t compactTurnNativeHits = 0;
    uint64_t compactTurnBridgeAttempts = 0;
    uint64_t compactTurnBridgeHits = 0;
    uint64_t compactTurnFallbacks = 0;
    uint64_t compactTurnUnsupported = 0;
    uint64_t compactTurnOracleChecks = 0;
    uint64_t compactTurnOracleFailures = 0;
    uint64_t remoteSends = 0;
    uint64_t inboxDrains = 0;
    uint64_t ownerShardSolves = 0;
};
```

- [ ] **Step 4: Add HDA owner and reconstruction helpers after the `HdaShard` definition**

Insert:

```cpp
size_t hdaOwnerFor(const StateKey& key, size_t shardCount) {
    return StateKeyHash{}(key) % shardCount;
}

std::vector<std::string> reconstructHdaSolution(
    const std::vector<std::unique_ptr<HdaShard>>& shards,
    GlobalNodeId parent,
    ps_input finalInput,
    Timing& timing
) {
    ScopedTimer timer(timing.reconstructNs);
    std::vector<std::string> reversed;
    reversed.push_back(inputName(finalInput));
    GlobalNodeId cursor = parent;
    while (cursor.valid()) {
        const HdaShard& shard = *shards.at(cursor.shard);
        const HdaNode& node = shard.nodes.at(cursor.index);
        if (node.parent.valid()) {
            reversed.push_back(inputName(node.input));
        }
        cursor = node.parent;
    }
    std::reverse(reversed.begin(), reversed.end());
    return reversed;
}
```

- [ ] **Step 5: Build**

Run:

```bash
make build_solver
```

Expected: build succeeds.

- [ ] **Step 6: Commit helper types**

```bash
git add native/src/solver/main.cpp
git commit -m "feat(solver): add HDA node ownership types"
```

## Task 5: Implement HDA Shard Search

**Files:**
- Modify: `native/src/solver/main.cpp`

- [ ] **Step 1: Extend search-work reset and add HDA aggregation**

In `resetSearchWork`, reset the HDA counters with the other search counters:

```cpp
    result.hdaRemoteSends = 0;
    result.hdaInboxDrains = 0;
    result.hdaOwnerShardSolves = 0;
```

Near `addSearchWork`, insert:

```cpp
void addHdaShardWork(Result& target, const HdaShard& shard) {
    target.expanded += shard.expanded;
    target.generated += shard.generated;
    target.uniqueStates += shard.bestDepth.size();
    target.duplicates += shard.duplicates;
    target.maxFrontier += shard.maxFrontier;
    target.compactTurnAttempts += shard.compactTurnAttempts;
    target.compactTurnHits += shard.compactTurnHits;
    target.compactTurnNativeAttempts += shard.compactTurnNativeAttempts;
    target.compactTurnNativeHits += shard.compactTurnNativeHits;
    target.compactTurnBridgeAttempts += shard.compactTurnBridgeAttempts;
    target.compactTurnBridgeHits += shard.compactTurnBridgeHits;
    target.compactTurnFallbacks += shard.compactTurnFallbacks;
    target.compactTurnUnsupported += shard.compactTurnUnsupported;
    target.compactTurnOracleChecks += shard.compactTurnOracleChecks;
    target.compactTurnOracleFailures += shard.compactTurnOracleFailures;
    target.hdaRemoteSends += shard.remoteSends;
    target.hdaInboxDrains += shard.inboxDrains;
    target.hdaOwnerShardSolves += shard.ownerShardSolves;
    addTiming(target.timing, shard.timing);
}
```

- [ ] **Step 2: Refactor `stepSolverEdge` to avoid copying parent nodes**

Change the `stepSolverEdge` signature from:

```cpp
SolverEdgeStep stepSolverEdge(
    const std::shared_ptr<const Game>& game,
    const Node& parentNode,
    const FullState& parentSession,
```

to:

```cpp
SolverEdgeStep stepSolverEdge(
    const std::shared_ptr<const Game>& game,
    const PersistentLevelState& parentState,
    uint32_t parentDepth,
    const FullState& parentSession,
```

Inside `stepSolverEdge`, replace:

```cpp
parentNode.state
```

with:

```cpp
parentState
```

and replace:

```cpp
std::to_string(parentNode.depth)
```

with:

```cpp
std::to_string(parentDepth)
```

Update both existing call sites to pass `parentNode.state` and `parentNode.depth` before `parentSession`:

```cpp
SolverEdgeStep edge = stepSolverEdge(
    game,
    parentNode.state,
    parentNode.depth,
    parentSession,
    input,
    compactNodeStorage,
    true,
    copyRestartSnapshot,
    searchWidth,
    searchHeight,
    *childScratch,
    result,
    compactTurnOracle);
```

- [ ] **Step 3: Add message enqueue and local insert helpers before `runHashDistributedWeightedAStarSearch`**

Insert:

```cpp
void enqueueHdaMessage(HdaShard& target, HdaMessage message) {
    {
        std::lock_guard<std::mutex> lock(target.inboxMutex);
        target.inbox.push_back(std::move(message));
        target.inboxCount.fetch_add(1, std::memory_order_release);
    }
}

bool insertHdaNode(
    HdaShard& shard,
    HdaMessage message,
    bool exactStateKeys,
    int32_t astarWeight
) {
    uint32_t nodeIndex = static_cast<uint32_t>(shard.nodes.size());
    bool shouldStore = false;
    {
        ScopedTimer timer(shard.timing.visitedInsertNs);
        shouldStore = shard.bestDepth.insertOrAssignIfBetter(
            message.key,
            message.state,
            message.depth,
            exactStateKeys ? nodeIndex : 0,
            shard.nodes);
    }
    if (!shouldStore) {
        ++shard.duplicates;
        return false;
    }

    {
        ScopedTimer timer(shard.timing.nodeStoreNs);
        shard.nodes.push_back(HdaNode{
            std::move(message.state),
            message.key,
            message.parent,
            message.input,
            message.depth,
            message.heuristic
        });
        recordPersistentLevelStateStorage(shard.timing, shard.nodes.back().state);
    }

    {
        ScopedTimer timer(shard.timing.frontierPushNs);
        shard.frontier.push(QueueEntry{
            priorityFor(SearchMode::WeightedAStar, message.depth, message.heuristic, astarWeight),
            secondaryPriorityFor(SearchMode::WeightedAStar, message.depth),
            shard.nextTie++,
            nodeIndex
        });
    }
    shard.frontierCount.fetch_add(1, std::memory_order_release);
    shard.maxFrontier = std::max<uint64_t>(shard.maxFrontier, shard.frontier.size());
    return true;
}
```

- [ ] **Step 4: Add the HDA search function**

Insert after `runParallelPortfolioSearch`:

```cpp
Result runHashDistributedWeightedAStarSearch(
    const puzzlescript::LoadedGame& loadedGame,
    const std::string& gameName,
    int32_t levelIndex,
    int64_t timeoutMs,
    int64_t compileNs,
    TimePoint deadline,
    uint32_t workerId,
    bool exactStateKeys,
    bool compactNodeStorage,
    bool compactTurnOracle,
    int32_t astarWeight,
    puzzlescript::solver::HeuristicKind heuristicKind,
    const puzzlescript::solver::StaticAnalysisHints* staticAnalysisHints,
    size_t hdaJobs
) {
    const std::shared_ptr<const Game>& game = loadedGame.information;
    Result result;
    result.game = gameName;
    result.level = levelIndex;
    result.status = "exhausted";
    result.strategy = "hda-weighted-astar";
    result.heuristic = heuristicName(SearchMode::WeightedAStar, heuristicKind);
    result.timeoutMs = timeoutMs;
    result.workerId = workerId;
    result.specializedRulegroupsAttached = game && game->specializedRulegroups != nullptr;
    result.specializedFullTurnAttached = game && game->specializedFullTurn != nullptr;
    result.specializedCompactTurnAttached = game && game->specializedCompactTurn != nullptr;
    result.compactNodeStorage = compactNodeStorage;
    result.astarWeight = astarWeight;
    result.hdaJobs = static_cast<uint32_t>(hdaJobs);
    result.hdaParallel = hdaJobs > 1;
    result.timing.compileNs = compileNs;

    if (!compactNodeStorage) {
        result.status = "level_error";
        result.error = "hda-weighted-astar requires compact node storage";
        return result;
    }

    std::unique_ptr<FullState> initial;
    {
        ScopedTimer timer(result.timing.loadNs);
        initial = createLoadedSession(loadedGame, gameName, levelIndex, result);
    }
    if (!initial) {
        return result;
    }
    if (initial->meta.textMode || initial->meta.level.isMessage) {
        result.status = "skipped_message";
        return result;
    }

    const int32_t searchWidth = currentLevelWidth(*initial);
    const int32_t searchHeight = currentLevelHeight(*initial);
    const bool copyRestartSnapshot = gameHasRuleCommand(*game, "restart");
    PersistentLevelState initialState = persistentLevelStateWithTiming(*initial, result.timing);
    const StateKey initialKey = persistentLevelStateKey(initialState, result.timing);

    puzzlescript::solver::HeuristicContext initialHeuristicContext(
        *game,
        searchWidth,
        searchHeight,
        heuristicKind,
        initialState.board.objects.data(),
        staticAnalysisHints);
    if (initialHeuristicContext.staticAnalysisHintsUsed()) {
        result.staticAnalysisHints = "js";
    }
    int32_t initialHeuristic = 0;
    {
        ScopedTimer timer(result.timing.heuristicNs);
        initialHeuristic = initialHeuristicContext.score(initialState.board.objects.data());
    }

    std::vector<std::unique_ptr<HdaShard>> shards;
    shards.reserve(hdaJobs);
    for (size_t index = 0; index < hdaJobs; ++index) {
        shards.push_back(std::make_unique<HdaShard>(static_cast<uint32_t>(index), exactStateKeys));
        shards.back()->nodes.reserve(8192 / hdaJobs + 1024);
        shards.back()->bestDepth.reserve(16384 / hdaJobs + 1024);
    }

    const size_t initialOwner = hdaOwnerFor(initialKey, hdaJobs);
    HdaMessage initialMessage{
        std::move(initialState),
        initialKey,
        0,
        initialHeuristic,
        GlobalNodeId{},
        PS_INPUT_UP
    };
    insertHdaNode(*shards[initialOwner], std::move(initialMessage), exactStateKeys, astarWeight);

    std::atomic_bool cancelRequested{false};
    std::atomic<uint32_t> activeExpansions{0};
    HdaWinner winner;
    std::mutex winnerMutex;

    auto anyPendingWork = [&]() {
        if (activeExpansions.load(std::memory_order_acquire) != 0) {
            return true;
        }
        for (const auto& shard : shards) {
            if (shard->frontierCount.load(std::memory_order_acquire) != 0
                || shard->inboxCount.load(std::memory_order_acquire) != 0) {
                return true;
            }
        }
        return false;
    };

    auto worker = [&](uint32_t shardId) {
        HdaShard& shard = *shards[shardId];
        puzzlescript::solver::HeuristicContext heuristicContext(
            *game,
            searchWidth,
            searchHeight,
            heuristicKind,
            initial->levelState.board.objects.data(),
            staticAnalysisHints);
        std::unique_ptr<FullState> compactSessionBase = std::make_unique<FullState>(*initial);
        std::unique_ptr<FullState> parentScratch = std::make_unique<FullState>(*initial);
        std::unique_ptr<FullState> childScratch = std::make_unique<FullState>(*initial);
        const auto inputs = solverInputsForGame(*game);

        while (!cancelRequested.load(std::memory_order_acquire)) {
            std::deque<HdaMessage> messages;
            {
                std::lock_guard<std::mutex> lock(shard.inboxMutex);
                messages.swap(shard.inbox);
            }
            if (!messages.empty()) {
                shard.inboxCount.fetch_sub(messages.size(), std::memory_order_acq_rel);
                ++shard.inboxDrains;
                for (HdaMessage& message : messages) {
                    insertHdaNode(shard, std::move(message), exactStateKeys, astarWeight);
                }
            }

            if (Clock::now() >= deadline) {
                cancelRequested.store(true, std::memory_order_release);
                break;
            }

            if (shard.frontier.empty()) {
                if (!anyPendingWork()) {
                    break;
                }
                std::this_thread::yield();
                continue;
            }

            QueueEntry entry;
            activeExpansions.fetch_add(1, std::memory_order_acq_rel);
            {
                ScopedTimer timer(shard.timing.frontierPopNs);
                entry = shard.frontier.top();
                shard.frontier.pop();
            }
            shard.frontierCount.fetch_sub(1, std::memory_order_acq_rel);

            const HdaNode& parentNode = shard.nodes[entry.nodeIndex];
            std::optional<uint32_t> best;
            {
                ScopedTimer timer(shard.timing.visitedLookupNs);
                best = shard.bestDepth.find(parentNode.key, parentNode.state, shard.nodes);
            }
            if (best && *best < parentNode.depth) {
                ++shard.duplicates;
                activeExpansions.fetch_sub(1, std::memory_order_acq_rel);
                continue;
            }

            {
                ScopedTimer timer(shard.timing.materializeNs);
                materializePersistentLevelStateIntoFullState(parentNode.state, *compactSessionBase, *parentScratch);
            }
            const FullState& parentSession = *parentScratch;
            ++shard.expanded;

            for (const ps_input input : inputs) {
                if (cancelRequested.load(std::memory_order_acquire) || Clock::now() >= deadline) {
                    cancelRequested.store(true, std::memory_order_release);
                    break;
                }

                Result shardResult;
                shardResult.timing = Timing{};
                SolverEdgeStep edge = stepSolverEdge(
                    game,
                    parentNode.state,
                    parentNode.depth,
                    parentSession,
                    input,
                    true,
                    true,
                    copyRestartSnapshot,
                    searchWidth,
                    searchHeight,
                    *childScratch,
                    shardResult,
                    compactTurnOracle);
                addTiming(shard.timing, shardResult.timing);
                shard.compactTurnAttempts += shardResult.compactTurnAttempts;
                shard.compactTurnHits += shardResult.compactTurnHits;
                shard.compactTurnNativeAttempts += shardResult.compactTurnNativeAttempts;
                shard.compactTurnNativeHits += shardResult.compactTurnNativeHits;
                shard.compactTurnBridgeAttempts += shardResult.compactTurnBridgeAttempts;
                shard.compactTurnBridgeHits += shardResult.compactTurnBridgeHits;
                shard.compactTurnFallbacks += shardResult.compactTurnFallbacks;
                shard.compactTurnUnsupported += shardResult.compactTurnUnsupported;
                shard.compactTurnOracleChecks += shardResult.compactTurnOracleChecks;
                shard.compactTurnOracleFailures += shardResult.compactTurnOracleFailures;

                if (edge.oracleMismatch) {
                    bool expected = false;
                    if (cancelRequested.compare_exchange_strong(expected, true, std::memory_order_acq_rel)) {
                        std::lock_guard<std::mutex> lock(winnerMutex);
                        result.status = "level_error";
                        result.error = edge.oracleError;
                    }
                    break;
                }

                const ps_step_result& stepResult = edge.stepResult;
                ++shard.generated;
                if (stepResult.restarted) {
                    continue;
                }

                const bool solved = edge.compactTurn.handled
                    ? stepResult.won
                    : solvedByStep(stepResult, *edge.child, levelIndex);
                if (solved) {
                    bool expected = false;
                    if (cancelRequested.compare_exchange_strong(expected, true, std::memory_order_acq_rel)) {
                        std::lock_guard<std::mutex> lock(winnerMutex);
                        winner.found = true;
                        winner.parent = GlobalNodeId{shardId, entry.nodeIndex};
                        winner.finalInput = input;
                        winner.shard = shardId;
                        ++shard.ownerShardSolves;
                    }
                    break;
                }
                if (!stepResult.changed) {
                    continue;
                }

                PersistentLevelState childState = edge.compactTurn.handled
                    ? std::move(edge.compactTurn.state)
                    : persistentLevelStateWithTiming(*edge.child, shard.timing);
                const StateKey childKey = persistentLevelStateKey(childState, shard.timing);
                int32_t childHeuristic = 0;
                {
                    ScopedTimer timer(shard.timing.heuristicNs);
                    childHeuristic = heuristicContext.score(childState.board.objects.data());
                }
                HdaMessage childMessage{
                    std::move(childState),
                    childKey,
                    parentNode.depth + 1,
                    childHeuristic,
                    GlobalNodeId{shardId, entry.nodeIndex},
                    input
                };
                const size_t owner = hdaOwnerFor(childKey, hdaJobs);
                if (owner == shardId) {
                    insertHdaNode(shard, std::move(childMessage), exactStateKeys, astarWeight);
                } else {
                    ++shard.remoteSends;
                    enqueueHdaMessage(*shards[owner], std::move(childMessage));
                }
            }

            activeExpansions.fetch_sub(1, std::memory_order_acq_rel);
        }
    };

    std::vector<std::thread> threads;
    threads.reserve(hdaJobs);
    for (size_t index = 0; index < hdaJobs; ++index) {
        threads.emplace_back(worker, static_cast<uint32_t>(index));
    }
    for (std::thread& thread : threads) {
        thread.join();
    }

    Timing setupTiming = result.timing;
    resetSearchWork(result, compileNs);
    addTiming(result.timing, setupTiming);
    result.strategy = "hda-weighted-astar";
    result.hdaJobs = static_cast<uint32_t>(hdaJobs);
    result.hdaParallel = hdaJobs > 1;
    for (const auto& shard : shards) {
        addHdaShardWork(result, *shard);
    }
    if (winner.found) {
        result.status = "solved";
        result.solution = reconstructHdaSolution(shards, winner.parent, winner.finalInput, result.timing);
    } else if (result.status != "level_error" && Clock::now() >= deadline) {
        result.status = "timeout";
    } else if (result.status != "level_error") {
        result.status = "exhausted";
    }
    return result;
}
```

- [ ] **Step 5: Build**

Run:

```bash
make build_solver
```

Expected: build succeeds.

- [ ] **Step 6: Commit the HDA engine**

```bash
git add native/src/solver/main.cpp
git commit -m "feat(solver): add hash-distributed weighted astar"
```

## Task 6: Dispatch HDA Strategy And Make Tests Green

**Files:**
- Modify: `native/src/solver/main.cpp`

- [ ] **Step 1: Add multi-shard dispatch in `solveLevel`**

After the one-shard fallback branch, add:

```cpp
    if (strategy == Strategy::HdaWeightedAStar) {
        return finish(runHashDistributedWeightedAStarSearch(
            loadedGame,
            gameName,
            levelIndex,
            timeoutMs,
            compileNs,
            deadline,
            workerId,
            exactStateKeys,
            effectiveCompactNodeStorage,
            compactTurnOracle,
            astarWeight,
            heuristicKind,
            staticAnalysisHints,
            hdaJobs));
    }
```

- [ ] **Step 2: Run focused HDA tests**

Run:

```bash
make build_solver
node src/tests/run_solver_search_modes_node.js build/native/puzzlescript_solver
node src/tests/run_solver_hda_smoke_node.js build/native/puzzlescript_solver
```

Expected:

```text
run_solver_search_modes_node passed
run_solver_hda_smoke_node passed
```

- [ ] **Step 3: Run the Makefile test target**

Run:

```bash
make solver_search_mode_tests
```

Expected: all three Node runners pass.

- [ ] **Step 4: Commit dispatch fixes**

```bash
git add native/src/solver/main.cpp
git commit -m "feat(solver): dispatch HDA weighted astar"
```

## Task 7: Verify Broader Solver Behavior

**Files:**
- No planned source edits

- [ ] **Step 1: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 2: Run native solver smoke**

Run:

```bash
make solver_smoke_tests
```

Expected:

```text
solver_smoke_assert passed cases=14
```

- [ ] **Step 3: Run portfolio regression**

Run:

```bash
make solver_portfolio_regression_tests
```

Expected: `solver_portfolio_regression passed ...`

- [ ] **Step 4: Run determinism**

Run:

```bash
make solver_determinism_tests
```

Expected: `solver_determinism passed runs=5 plus_jobs_auto=1`

- [ ] **Step 5: Run standalone native solver corpus**

Run:

```bash
make solver_tests_cpp
```

Expected: command exits 0. Timeout counts are acceptable; errors are not.

## Task 8: Measure HDA Against Serial Weighted-A*

**Files:**
- No planned source edits

- [ ] **Step 1: Run serial weighted-A* baseline**

Run:

```bash
/usr/bin/time -p build/native/puzzlescript_solver src/tests/solver_tests \
  --timeout-ms 250 --jobs 1 --strategy weighted-astar \
  --no-solutions --quiet --json > /tmp/ps_solver_weighted_astar_serial.json
```

Expected: command exits 0 and `/usr/bin/time` prints `real`, `user`, and `sys`.

- [ ] **Step 2: Run HDA weighted-A***

Run:

```bash
/usr/bin/time -p build/native/puzzlescript_solver src/tests/solver_tests \
  --timeout-ms 250 --jobs 1 --strategy hda-weighted-astar --hda-jobs 8 \
  --no-solutions --quiet --json > /tmp/ps_solver_hda_weighted_astar_8.json
```

Expected: command exits 0 and `/usr/bin/time` prints `real`, `user`, and `sys`.

- [ ] **Step 3: Parse both JSON outputs**

Run:

```bash
node - <<'NODE'
const fs = require('fs');
const serial = JSON.parse(fs.readFileSync('/tmp/ps_solver_weighted_astar_serial.json', 'utf8'));
const hda = JSON.parse(fs.readFileSync('/tmp/ps_solver_hda_weighted_astar_8.json', 'utf8'));
for (const [label, json] of [['serial', serial], ['hda8', hda]]) {
  const t = json.totals;
  console.log(label, JSON.stringify({
    levels: t.levels,
    solved: t.solved,
    timeout: t.timeout,
    exhausted: t.exhausted,
    skipped: t.skipped_message,
    errors: t.errors,
    expanded: t.expanded,
    generated: t.generated,
    hda_remote_sends: t.hda_remote_sends || 0,
    hda_inbox_drains: t.hda_inbox_drains || 0,
    hda_owner_shard_solves: t.hda_owner_shard_solves || 0,
  }));
}
NODE
```

Expected: both runs report `errors:0`. HDA reports nonzero `hda_remote_sends` on the corpus.

- [ ] **Step 4: Record the result in the final response**

Report:

- serial wall/user/sys
- HDA wall/user/sys
- wall speedup
- CPU ratio
- solved delta
- timeout delta
- HDA remote sends and inbox drains

Do not claim HDA is faster unless the measured wall time proves it.
