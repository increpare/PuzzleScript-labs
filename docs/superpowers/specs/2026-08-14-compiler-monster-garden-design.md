# Compiler Monster Garden Design

## Purpose

The Compiler Monster Garden is a local fuzzing tool for PuzzleScript's compiler and
runtime boundary. It grows deterministic mutations from the existing regression
fixtures, looks for outcomes that should never happen, and saves small, ordinary
PuzzleScript programs that can be promoted into regression tests.

The tool belongs beside the existing Node test runner. It deliberately uses the
same source files, browser shims, compiler entry point, and fixture arrays instead
of introducing a second compiler API or a new test framework.

## Command-line experience

The main command is:

```sh
node src/tests/monster_garden/run.js --seed 12345 --count 100
```

A fixed seed must reproduce the same chosen fixture, mutation, and generated source.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--seed N` | `Date.now()` | Integer seed in `0..4294967295` (fits `Random`’s uint32 state; empty string is rejected) |
| `--count N` | `100` | Mutants to attempt |
| `--forever` | off | Loop until SIGINT/SIGTERM; cannot be combined with `--count`. See `2026-08-14-garden-forever-mode-design.md` |
| `--timeout-ms N` | `2000` | Hard child deadline (at most 2147483647; larger values are rejected because Node would clamp them to 1 ms) |
| `--fixture SUBSTR` | any | Case-insensitive name filter |
| `--mutator A,B` | all | Restrict to named mutators; empty list is rejected |
| `--game-dir DIR` | none | Donor pool for `merge-game`; repeatable, pools concatenate in order |
| `--list-mutators` | off | Print mutator names and exit 0 |
| `--output DIR` | `.build/monster_garden` | Artifact root |
| `--no-shrink` | shrink on | Skip minimization |
| `--no-replay` | replay on | Skip restore-and-replay check |
| `--max-inputs N` | `8` | Recorded-input prefix length |
| `--extra-inputs N` | `0` | Extra generated inputs appended after the recorded prefix |
| `--shrink-budget N` | `200` | Max shrink candidate evaluations |
| `--max-attempts N` | `8` | Retries when a mutator does not apply |

Numeric flags except `--seed` must be integers `> 0`. `--seed` must be an integer
in `0..4294967295`. Unknown flags, missing values, empty `--mutator` lists, and
unknown mutator names exit nonzero.

Each mutant runs in a fresh, time-bounded Node child process. Before evaluating a
mutant, the parent preflights the unmutated fixture with the same job fields
except `source`. The parent reports a compact live tally for `ok`,
`compiler-error`, `compiler-warning`, `crash`, `timeout`, `invariant`,
`nondeterministic`, `replay-divergence`, `semantic-mismatch`, `equivalence-break`,
`baseline`, and `skipped`.

A completed garden run exits 0 even when monsters are found. Only malformed
options and unexpected parent failures exit nonzero.

## Components

`garden.js` contains deterministic machinery and uses only Node built-ins: corpus
loading, seeded random selection, source mutations, result classification, failure
signatures, line-oriented shrinking, command-line parsing, invariant checks, and
artifact naming.

`worker.js` is a deliberately small adaptation of `run_tests_node.js`. It loads the
real PuzzleScript sources in browser-like globals, reads one JSON job from stdin,
emits one JSON result on stdout, and never owns persistence, timeouts, or policy.

`run.js` owns orchestration. It spawns workers with a hard timeout, classifies
their results, invokes the shrinker for interesting cases, writes artifacts, and
prints the run summary.

`tests.js` exercises deterministic mutation, corpus extraction, classification,
shrinking, worker behavior, timeout handling, and a small end-to-end garden run.

## Mutation strategy

Mutators are small named functions, not a grammar framework. They target compiler
seams represented in real games:

- `delete-rule-punctuation` / `duplicate-rule-punctuation`
- `swap-legend-operator`
- `invalid-viewport`
- `duplicate-rule-command`
- `legend-cycle`
- `swap-sections`
- `odd-whitespace`
- `unterminated-comment`

Issue-mined mutators target regions where this project's own bug history
clusters. Each carries the issue numbers it came from in a comment beside its
definition:

- `no-x-with-x`, `relative-direction-cell`, `same-layer-cell`
- `property-in-concrete-slot`, `rigid-prefix`, `sprite-matrix-resize`
- `restart-again-message`, `multi-fault`, `comment-in-rule`

See `2026-08-14-garden-issue-mined-mutators-design.md`. A cluster of issues about
one construct is stronger evidence than any single report: the fixture for a
fixed bug records that one input is now handled, while four reports about the
same construct say the subsystem is structurally fragile.

`apply(source, rng)` returns `{ source, detail }` or `null` when the fixture has
no target. `mutateFixture` picks a mutator from the allowed list and retries up to
`--max-attempts` times. If every attempt returns `null`, it throws `/inapplicable/`.

Mutation metadata records the mutator name, detail, fixture identity, and attempt
index.

## Expansion (2026-08-14)

The garden is a crash hunter **and** a semantics fuzzer. It must not lie about
cause: unmutated fixtures are preflighted, artifacts reproduce the exact job,
shrink preserves the same failure, and the worker checks engine state rather than
board text alone.

Implementation is three sequential plans:

1. `docs/superpowers/plans/2026-08-14-garden-harness-honesty.md`
2. `docs/superpowers/plans/2026-08-14-garden-worker-oracles.md`
3. `docs/superpowers/plans/2026-08-14-garden-semantics-expansion.md`

## Contracts

### Corpus

`loadCorpus(resourceDir)` evaluates `testdata.js` and `errormessage_testdata.js`
with `vm.runInNewContext`. It does not `require()` those files and does not load
the compiler.

Simulation items are `[name, [source, inputs, expected, level?, randomSeed?]]`.
Compiler-message items are `[name, [source, expectedErrors, errorCount]]`.

Each corpus record is:

```js
{
  name, corpusIndex, fixtureIndex, kind, source, inputs, level, randomSeed,
  expectedOutput, expectedErrors, expectedErrorCount
}
```

`kind` is `simulation` or `compiler-message`. Simulation items come first, then
compiler-message items. `corpusIndex` is unique across the whole corpus (`0..n-1`).
`fixtureIndex` is the index inside that kind’s source array (may collide across
kinds; always pair it with `kind`). Compiler-message records have `inputs: []`,
`level: 0`, `randomSeed: null`, and `expectedOutput: null`. Simulation records
have `expectedErrors: null`. Missing simulation `level` defaults to `0`; missing
`randomSeed` defaults to `null`.

### Worker job (stdin JSON)

```json
{
  "source": "...",
  "inputs": [0, 3, "undo"],
  "level": 0,
  "randomSeed": null,
  "engineSeed": "garden-1",
  "replay": true,
  "maxInputs": 8,
  "expectedOutput": null,
  "expectedErrors": null,
  "expectedErrorCount": null
}
```

The worker never loads the fixture arrays. `level` must be an integer. After a
successful compile, if `level` is out of range for `state.levels`, the worker
emits `crash` with that fact rather than indexing blindly.

`engineSeed` is the string passed to `compile` / `RNG`. If the parent sends
`randomSeed`, that value is stringified and used. If both are null, the worker
invents one canonical string for the job, uses it for both `runOnce` calls, and
echoes it on the result as `engineSeed`.

The executed prefix is `inputs.slice(0, maxInputs)`. The input loop matches
`runTest`: `undo` / `restart` / `tick` / numeric `processInput`, then drain
`againing` with `processInput(-1)`. Invariants are checked after every input and
after every AGAIN drain step.

`expectedOutput` / `expectedErrors` / `expectedErrorCount` are oracles. The
parent sends them only for unmutated baseline preflight, never for mutants.

### Worker result (stdout JSON)

```json
{
  "kind": "ok",
  "error": null,
  "fingerprint": "{...}",
  "detail": "",
  "errorCount": 0,
  "engineSeed": "garden-1",
  "errorStrings": []
}
```

`error` is `{ "name": "...", "message": "..." }` for crashes, otherwise `null`.
The parent classifies timeout; the worker never emits `timeout`.

Known worker kinds: `ok`, `compiler-error`, `compiler-warning`, `crash`,
`invariant`, `nondeterministic`, `replay-divergence`, `semantic-mismatch`.

### Child protocol

`runChild` concatenates stdout/stderr as `Buffer`s and decodes UTF-8 once on
close (never by concatenating decoded strings). The last non-empty stdout line
must parse as a JSON object whose `kind` is a known worker kind. A parseable
`{}`, an unknown kind, or a non-object is a `crash`. Nonzero exit without a
`crash` kind is a `crash`. `timeout` is only assigned when the parent’s timer
fires.

### Outcome kinds

PuzzleScript usually records diagnostics in `errorStrings` / `errorCount` and
returns. Thrown exceptions are the unexpected case.

| Kind | When | Saved? |
| --- | --- | --- |
| `ok` | compile did not throw, `errorCount === 0`, no warning-only diagnostics when those are classified separately, execution finished, invariants hold, two compiles match, replay matches, oracles match | no |
| `compiler-error` | compile did not throw and `errorCount > 0` | no |
| `compiler-warning` | compile did not throw, `errorCount === 0`, and `errorStrings.length > 0` | no |
| `crash` | compile, input execution, or fingerprinting threw, or the child violated the protocol | yes |
| `timeout` | parent `SIGKILL` after `--timeout-ms` | yes |
| `invariant` | after a successful compile, level or compiled `state` is internally inconsistent | yes |
| `nondeterministic` | two identical compile+execute runs in one worker produced different fingerprints | yes |
| `replay-divergence` | restoring the post-compile snapshot and replaying the prefix disagreed with the forward fingerprint | yes |
| `semantic-mismatch` | an oracle (`expectedOutput` or expected compiler messages) did not match | yes |
| `baseline` | parent tally only: the unmutated fixture was already interesting | no (unless the mutant signature differs) |

If `errorCount > 0`, the worker emits `compiler-error` and does not execute
inputs, check invariants, replay, or recompile.

### Baseline preflight

For every mutant the parent first evaluates the unmutated fixture with the same
`inputs`, `level`, `randomSeed`/`engineSeed`, `replay`, `maxInputs`, and oracles.
If that baseline result is interesting:

- increment `baseline`
- if the mutant’s `failureSignature` equals the baseline signature, do not save
  an artifact (the mutation is not causal)
- if the signatures differ, save the mutant and record `baselineKind` /
  `baselineSignature` on the report

If the baseline is healthy (`ok`, `compiler-error`, `compiler-warning`) and the
mutant is interesting, save the mutant as today.

### Fingerprint

A canonical JSON object after the forward prefix (or after compile for
compiler-error / compiler-warning):

- `errorCount`, `errorStrings`
- `curlevel`, `textMode`, `titleScreen`, `winning`, `messageselected`, `messagetext`
- `board` (`convertLevelToString()` or `null` on message/title/`textMode`)
- `objects` / `movements` (`Array.from` of the typed arrays, or `null` on message/title)
- `rng` (`snapshotRng()`)

For `compiler-error` / `compiler-warning`, `fingerprint` is
`kind + ":" + errorCount + ":" + JSON.stringify(errorStrings)`.

### Level invariants

Checked after `errorCount === 0` and not on a message/title/`textMode` level.
Failure detail is the first broken rule:

- `STRIDE_OBJ` and `STRIDE_MOV` are integers `> 0`
- `level` is a non-null object
- `level.width` and `level.height` are integers `> 0`
- `level.n_tiles === level.width * level.height`
- `level.objects` is an `Int32Array` (or array-like in unit tests) whose length
  is `level.n_tiles * STRIDE_OBJ`
- `level.movements` is present and has length `level.n_tiles * STRIDE_MOV`
- `level.commandQueue` is empty after a completed turn
- row/col/map content caches have the expected lengths when present
- if `state.rigid`, rigid mask arrays have length `level.n_tiles`
- object bits above `Object.keys(state.idDict).length` are clear
- at most one object occupies each collision layer in a cell

Compiled `state` after a successful compile must have `levels` as a non-empty
array (unless the selected record is a message), and `job.level` must index it.
A selected message record is `levels[i]` with a `message` own property, which is
distinct from falling back to the title screen because the index was invalid.

### Restore/replay

Skipped when `replay` is false, the prefix is empty, or the result is already
`compiler-error` / `compiler-warning` / `crash` / `invariant`.

1. After compile + AGAIN drain, snapshot engine state: `curlevel`,
   `curlevelTarget`, `textMode`, `titleScreen`, `winning`, `messageselected`,
   `messagetext`, `hasUsedCheckpoint`, `backups`, RNG, level object/movement
   arrays, and worker `localStorage`.
2. Apply the input prefix and record fingerprint `F1`. Check invariants after
   the prefix.
3. Restore the snapshot (not undo-only) and apply the same prefix.
4. If the new fingerprint is not `F1`, emit `replay-divergence`.

Between the two full `runOnce` calls, the worker clears `_storage` and restores
bridged globals that compile does not reset (`backups`, `againing`,
`titleScreen`, `textMode`, `winning`, `messageselected`).

### Nondeterminism

After the replay check, compile and execute the same job a second time in the
same worker (same `engineSeed`). If that fingerprint is not `F1`, emit
`nondeterministic`.

### Failure signature

Used while shrinking so a timeout cannot collapse into an unrelated parser crash.

- `timeout`: the string `timeout` only; timeouts are never shrunk
- `crash`: `crash:` + `error.name` + `:` + first line of `error.message`
- `invariant` / `semantic-mismatch`: `kind` + `:` + `detail` + `:` + first 80
  characters of `fingerprint`
- any other interesting kind: `kind` + `:` + first 80 characters of
  `fingerprint` + `:` + first 80 of `detail`

### Shrinking

Timeouts are never shrunk (`minimized.txt` is the original source). Other
interesting kinds use line-oriented deletion. Keep a deletion when the worker
result has the same `failureSignature`. Restart the scan after a successful
deletion. Stop after `--shrink-budget` evaluations or a full pass with no
deletions. After shrinking, re-evaluate the candidate once. If the signature
changed, revert to the original source and original result.

`report.json` stores `originalResult` (pre-shrink) and `minimizedResult`
(post-shrink / post-verify), never a stale pre-shrink `result` as if it were
the minimized specimen.

### Artifacts

Interesting **causal** results write a directory under `--output`:

- `original.txt`
- `minimized.txt`
- `report.json`
- `regression.js`

Directory names are `sanitize(signature) + "-s" + seed + "_" + 4-digit index`.
Non-alphanumeric characters become `-`, and the signature part is truncated to 80
characters.

Write into `fs.mkdtempSync` under the output directory, then `rename` onto the
destination. Do not delete the destination before the new directory is complete.
Temp names include the pid so concurrent runs do not share one `.tmp`.

`report.json` includes: `seed`, `campaignIndex`, `gitRev`, `fixtureName`,
`corpusIndex`, `fixtureIndex`, `fixtureKind`, `mutator`, `detail`, `attempt`,
`job` (source omitted; it lives in the txt files), `inputs`, `level`,
`randomSeed`, `engineSeed`, `replay`, `maxInputs`, `timeoutMs`,
`originalResult`, `minimizedResult`, `signature`, `shrinkSteps`,
`baselineKind`, `baselineSignature`.

`regression.js` uses `JSON.stringify` for escaping and this shape for
simulation-like replay:

```js
[
    "monster garden <seed> <index>",
    [<minimized source>, <executed inputs>, "", <level>, <engineSeed>]
],
```

### Generated inputs

`--extra-inputs N` (default 0) appends N values chosen with the garden RNG from
`[0, 1, 2, 3, 4, "tick"]` after the fixture’s recorded inputs. The executed
sequence is `(recorded + extra).slice(0, recorded.length + extra.length)` and
is stored on the mutant and in the artifact job. `--max-inputs` still truncates
the recorded prefix only; extras are appended after that truncation.

### Structure-aware mutators

In addition to the seam mutators, the garden includes validity-preserving
mutators that still often compile:

- `duplicate-rule-line`
- `swap-object-colors`
- `nudge-level-cell`
- `flip-win-quantifier`

## Style and limits

This is an opt-in developer tool. It does not change the compiler, editor, browser
tests, fixture format, or production build. It uses built-in Node modules only and
keeps all new code within `src/tests/monster_garden/`, apart from a short addition
to the development guide and the output ignore rule.
