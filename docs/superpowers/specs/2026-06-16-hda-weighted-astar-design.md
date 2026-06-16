# Hash-Distributed Weighted A* Design

## Goal

Add an experimental hash-distributed weighted-A* mode for solving a single PuzzleScript level across multiple native solver threads. The goal is to test whether sharding one search by state hash gives better single-level scaling than the current portfolio-in-parallel experiment, which solved more levels but used roughly four times the CPU for only a small whole-suite wall-clock gain.

This design deliberately targets weighted-A* first. It does not replace the existing `portfolio`, `weighted-astar`, `bfs`, or `greedy` strategies.

## CLI And Scope

Add a new strategy and per-level worker count:

```bash
--strategy hda-weighted-astar --hda-jobs N|auto
```

Existing `--jobs` keeps its current meaning: corpus-level parallelism across independent levels. `--hda-jobs` controls worker shards inside one level solve.

Rules:

- `--strategy weighted-astar` remains today's serial `runSearch` path.
- `--strategy hda-weighted-astar --hda-jobs 1` delegates to today's serial weighted-A* `runSearch`, so the one-shard baseline has no HDA* overhead.
- `--strategy hda-weighted-astar --hda-jobs >1` runs hash-distributed weighted-A* for each level.
- HDA* uses the existing timeout, exact/hash-state-key mode, compact-node-storage mode, compact-turn oracle mode, A* weight, heuristic selection, and static-analysis hints.

JSON output should report at least:

- `hda_jobs`
- `hda_parallel`
- `hda_remote_sends`
- `hda_inbox_drains`
- `hda_owner_shard_solves`
- optional per-shard totals if they stay compact enough for benchmark output

## Architecture

Add `runHashDistributedWeightedAStarSearch` beside `runSearch`, rather than refactoring `runSearch` immediately. The HDA* path can copy the current weighted-A* expansion structure at first, because this isolates risk and makes performance comparison easier.

Each shard owns its hot data structures:

- a local `std::priority_queue<QueueEntry, ...>` frontier
- a local `FlatBestDepth` visited table
- a local `std::vector<Node>` node arena
- local full-state materialization and child scratch buffers
- a local `HeuristicContext`

The hot structures are not shared and do not need locks.

State ownership is deterministic:

```cpp
owner = StateKeyHash{}(stateKey) % hdaJobs
```

A shard expands only nodes whose keys map to that shard. The initial state is inserted into its owner shard.

## Node Identity And Reconstruction

HDA* needs cross-shard parent links. Introduce a small global node reference for this path:

```cpp
struct GlobalNodeId {
    uint32_t shard = kInvalidShard;
    uint32_t index = kInvalidNode;
};
```

HDA nodes store:

- full or compact state, as the existing `Node` does
- `StateKey`
- `GlobalNodeId parent`
- input that produced this node
- depth
- heuristic

When a shard finds a solution, it records `{parentGlobalId, finalInput}`. After all workers stop, the main thread reconstructs by walking `allShards[id.shard].nodes[id.index]` until the invalid parent marker, then appending the final input. This avoids copying parent chains through messages.

## Cross-Shard Messages

When expansion creates a child owned by another shard, the producer enqueues a message to the owner shard. The message must be self-contained:

- `PersistentLevelState state`
- `StateKey key`
- `uint32_t depth`
- `int32_t heuristic`
- `GlobalNodeId parent`
- `ps_input input`

The receiving shard performs the visited insert, stores the node if useful, and pushes into its own frontier.

Start with one `std::mutex + std::deque<Message>` inbox per shard. This keeps the first implementation simple while still removing locks from frontier and visited. If benchmark counters show inbox contention, the inbox implementation can be swapped for a bounded MPSC queue later without changing search semantics.

## Worker Loop

Each worker repeatedly:

1. Drains its inbox into local visited/frontier.
2. Checks cancellation and timeout.
3. Pops from the local frontier if available.
4. Skips stale nodes whose visited depth is now better.
5. Materializes the parent state if compact node storage is active.
6. Steps each solver input.
7. Checks for solved status.
8. Captures child state, key, depth, and heuristic.
9. Routes the child to either local insert or the owner shard inbox.

The stepping, solved check, compact-turn oracle handling, heuristic scoring, and exact-state collision behavior should match the current weighted-A* `runSearch`.

## Termination

Use shared atomics plus a small winner mutex:

- `std::atomic_bool cancelRequested`
- shared deadline
- winner record protected by `std::mutex`

The first worker that finds a solution writes the winner record and sets cancellation. Other workers check cancellation at timeout/inbox-drain points and inside the input loop.

For exhaustion, use conservative idle detection:

- A shard is idle when its inbox is empty and its frontier is empty.
- If all shards are idle, all inboxes are empty, and no winner exists, the search is exhausted.
- A worker with no local work may yield or sleep briefly before rechecking global idle state.

The first version should favor correctness and no hangs over perfectly tuned idle waiting.

## Correctness Model

This solver does not require optimal solutions. Existing weighted-A* is used as a bounded-time search strategy, not an optimality proof engine.

HDA* will not preserve a single global priority-pop order unless a stronger global bound protocol is added. The first implementation accepts this priority skew. The correctness requirement is that any reported solution is valid and replayable, and that timeout/exhaustion statuses terminate reliably.

## Testing

Add tests before implementation:

- Focused smoke: `one_move.txt`, `--strategy hda-weighted-astar --hda-jobs 2`, assert solved, solution `["right"]`, `hda_parallel=true`, and `hda_jobs=2`.
- One-shard fallback: `--strategy hda-weighted-astar --hda-jobs 1`, assert it reports serial-compatible metadata and solves the smoke case.
- Smoke parity: compare serial weighted-A* and HDA* statuses on `src/tests/solver_smoke_tests`; solutions must be replayable, but expanded/generated counts do not need to match.
- Exhaustion/idle: include a known unsolved or exhausted smoke case to ensure worker idle detection terminates.

Wire the focused test into `solver_search_mode_tests` or a new native HDA* test target.

## Measurement

Compare:

```bash
build/native/puzzlescript_solver src/tests/solver_tests \
  --timeout-ms 250 --jobs 1 --strategy weighted-astar \
  --no-solutions --quiet --json

build/native/puzzlescript_solver src/tests/solver_tests \
  --timeout-ms 250 --jobs 1 --strategy hda-weighted-astar --hda-jobs 8 \
  --no-solutions --quiet --json
```

Report:

- wall time
- user CPU
- solved count
- timeout count
- expanded/generated totals
- `hda_remote_sends`
- `hda_inbox_drains`
- shard work distribution

Success means HDA* provides a materially better tradeoff than portfolio-in-parallel: either noticeably lower wall time at the same solved count, or noticeably more solved levels without consuming CPU in proportion to the thread count.

## Non-Goals

- Do not replace the existing serial weighted-A* path.
- Do not generalize HDA* to portfolio, BFS, or greedy in the first implementation.
- Do not build a lock-free inbox before measurements show the mutex inbox is the bottleneck.
- Do not attempt optimal weighted-A* termination proofs in the first version.
