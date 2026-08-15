# Garden forever mode

## Purpose

Leave the compiler monster garden running overnight. Watch a live tally, open
artifact directories while it runs, and stop it with Ctrl+C without losing the
summary.

This is the existing `run.js` campaign with `--count` removed from the stop
condition. It is not a second tool, not an HTTP server, and not part of the
normal test suite.

Parent design: `docs/superpowers/specs/2026-08-14-compiler-monster-garden-design.md`.

## Command line

```sh
node src/tests/monster_garden/run.js --forever --seed 12345
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--forever` | off | Loop until SIGINT/SIGTERM (or a second signal) |

`--forever` together with `--count` is an error (`--forever cannot be combined with --count`). `--list-mutators` still prints names and exits 0 before the loop. All other flags keep their current meaning, including `--timeout-ms` (default 2000, SIGKILL on the worker).

`--seed` is chosen once at process start. The overnight run is one deterministic RNG stream from that seed. Record the seed from `tally.json` to replay a prefix later with `--count`.

Every interesting mutant is still saved (no signature dedup). The operator prunes `.build/monster_garden/` if the disk fills.

## Loop

Batch mode is unchanged: `for (i = 0; i < options.count; i++)`.

Forever mode: `for (i = 0; !stopRequested; i++)`. Each iteration is the current trial: pick fixture, `prepareTrialInputs`, mutate (or skip), baseline, mutant, `attributeMonster`, maybe shrink, maybe `writeArtifacts`. `campaignIndex` in `report.json` is `i`.

`stopRequested` becomes true on the first SIGINT or SIGTERM. The current trial finishes, including shrink if that trial already decided to save. Then the parent writes `tally.json`, prints the JSON counts on stdout (same object as batch exit), writes a newline to stderr if a TTY status line was used, and exits 0.

A second SIGINT/SIGTERM while stopping kills the current worker with SIGKILL if one is running, writes `tally.json` if possible, and also exits 0. The parent must keep a handle to the live child so a second signal cannot orphan a worker. `runChild` therefore takes an optional `onSpawn(child)` callback that `run.js` uses to store `currentChild`.

## Tally file

After every trial (batch and `--forever`), including inapplicable-mutation skips, rewrite `<output>/tally.json`.

Write to a sibling temp file in the same directory, then `rename` over `tally.json`, so a concurrent `cat` never sees a torn write.

```json
{
  "seed": 12345,
  "forever": true,
  "trials": 1042,
  "saved": 3,
  "counts": {
    "ok": 900,
    "compiler-error": 100,
    "compiler-warning": 20,
    "crash": 2,
    "timeout": 1,
    "invariant": 0,
    "nondeterministic": 0,
    "replay-divergence": 0,
    "semantic-mismatch": 0,
    "baseline": 15,
    "skipped": 4
  },
  "lastTrial": {
    "index": 1042,
    "tally": "ok",
    "mutator": "legend-cycle",
    "fixtureName": "sokoban"
  },
  "lastSaved": {
    "dir": "crash-TypeError-…-s12345_0003",
    "signature": "crash:TypeError:…",
    "kind": "crash"
  },
  "updatedAt": "2026-08-14T12:00:00.000Z"
}
```

`trials` is the number of loop iterations started (including skipped inapplicable mutations). `saved` is how many artifact directories this process wrote. `lastSaved` is `null` until the first save. `counts` matches the stdout JSON summary. `updatedAt` is `new Date().toISOString()`. On a skip, `lastTrial` is `{ index, tally: "skipped", mutator: null, fixtureName }`.

Helpers live in `garden.js`: `writeTally(outputDir, payload)` (atomic) and a small `tallyPayload(...)` builder if that keeps `run.js` thin. `run.js` still owns when to call them.

## Stderr status

If `process.stderr.isTTY` is true, after each trial write one carriage-return status line and no newline, for example:

```
trials=1042 saved=3 crash=2 timeout=1 invariant=0 nondeterministic=0 replay-divergence=0
```

Interesting counters only (plus `trials` and `saved`). Do not emit this line when stderr is not a TTY.

Stdout is unchanged: `#N tally mutator fixtureName\n` per trial, JSON counts at cooperative exit.

## Errors

Worker timeout, crash, skip, baseline: unchanged. A hung child is still SIGKILL’d after `--timeout-ms`; the trial counts as `timeout` and the loop continues.

If the parent throws (bug, disk full on artifact rename), exit nonzero as today. `tally.json` from the last successful trial remains.

Completed artifact directories are safe to read while the garden runs (`writeArtifacts` already writes to a temp dir then renames). Ignore names that start with `.` in the output folder.

## Tests and docs

In `src/tests/monster_garden/tests.js`:

- `parseArguments(['--forever']).forever === true`; default is false.
- `parseArguments(['--forever', '--count', '3'])` throws `/forever/`.
- A `--count 1 --no-shrink --no-replay` run writes `<output>/tally.json` that `JSON.parse`s, with `trials === 1`, `forever === false`, and the chosen `seed`.
- A `--forever --seed 1 --no-shrink --no-replay --timeout-ms 20000` child: wait until stdout contains `#1 `, send SIGINT, wait for exit 0, `tally.json` exists, stdout ends with a JSON object that has the same `counts` keys as batch mode.

Update the garden section of `DEVELOPMENT.md`: `--forever`, `tally.json`, Ctrl+C, do not claim this is part of the normal test suite.

Do not modify `src/js/compiler.js` or fixture files.
