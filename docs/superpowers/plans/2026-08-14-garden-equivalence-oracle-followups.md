# Garden Equivalence Oracle — Deferred Follow-ups

Recorded when `2026-08-14-garden-equivalence-oracle.md` completed. None of these blocked
merge; each was verified as non-blocking by the final whole-branch review or its scoped
re-review. Kept because the reasoning behind "not blocking" is easy to lose.

## Correctness, latent

**`addLegendAlias`'s identifier regex has no flags** (`garden.js:1315`, the `routeThrough`
replace). This is the third sighting of the case-sensitivity hazard family: commit 24b9abf9
fixed it in `rename-object`, the final fix wave fixed it in `inline-legend-synonym`. This
instance fails *safe* — it is guarded by `re.test(body)`, so a casing mismatch refuses the
mutation rather than stranding a reference — so it costs applicability, not correctness.
Measured cost: 423 object-name/section pairs across the corpus are referenced only with
different casing and are therefore unreachable. A shared "PuzzleScript identifier regex"
helper would stop a fourth instance.

**`inlineLegendSynonym` lacks the `COLOR_NAMES` filter** that `renameObject` carries.
Games do name objects after colour keywords, and widening that mutator to `gi` mildly
increased the exposure. Measured: 0 colour-named legend aliases in 388 fixtures, and 0
edits inside any OBJECTS section across 780 applied trials. Latent only.

**The OBJECTS comment guard is blind to a comment opened before the section header.**
The depth counter clamps at 0, so a comment opened earlier and closed inside OBJECTS reads
as balanced, and reordering could move the closing `)`. Measured: 0 of 388 fixtures have a
comment open at the OBJECTS header.

**The oracle assumes preserving mutators never change `inputs`, `level` or `randomSeed`.**
`run.js` only re-aligns inputs when they are untouched. A future preserving mutator that
touches the tape would compare across different jobs and manufacture breaks. One assert
would close it.

## Oracle coverage

**`compareEquivalence` exempts any trial whose baseline is not `kind === 'ok'`.** Measured
at 20–28% of trials. This is not gratuitous — a `compiler-warning` result returns early from
`runOnce` without playing the level, so no board exists to compare — but it does hide real
cases. **Fix the case-sensitivity items above before narrowing this exemption**, or narrowing
it will surface false positives rather than remove them. One known example it currently
masks: fixture "gallery game: coin collector" has an object literally named `on`, and
renaming it corrupts `all X on Y` in WINCONDITIONS.

**`'board'` equivalence discards fields that are invariant under all five board-level
mutators.** `winning`, `curlevel`, `textMode`, `titleScreen` and `messageselected` are
invariant under `rename-object`, `reorder-objects`, `add-legend-alias`,
`add-unreachable-rule` and `scramble-case`, yet are dropped. 83% of checked trials are
board-only, so a mutant that wins where the baseline does not — on the last level, with an
identical board — is silently passed. Adding those five fields to the `'board'` comparison
is a strict improvement at near-zero risk. The two `full`→`board` demotions were each right
individually, but together they hollowed out the oracle more than was tracked at the time.

**A `null` board voids the comparison entirely** (`garden.js:1843`). `fingerprintAfter` sets
`board: null` on message/title/`textMode` levels. So a `'board'` mutant that lands on a
message screen when the baseline does not — a genuine divergence — produces no claim.
Deliberate and documented, incidence ~0–1 per 150 trials, but a hole by construction.

## Tooling and hygiene

- **Artifact names for equivalence-breaks are HTML garbage and defeat dedup.**
  `failureSignature` had never been called on a `compiler-error` result before, and it embeds
  raw `errorStrings`; the varying line number splits one root cause across many directories.
  A 25-trial run produced 8 artifacts under 6 distinct names. Under `--forever` this sprays.
- **`minimizedResult` is inaccurate for equivalence-breaks.** `run.js` sets `result: result`,
  the original run's object, never re-evaluated against the minimized pair — unlike
  `shrinkInteresting`, which returns a verified result. Given harness honesty is a stated
  project value, `report.json` should not describe an unverified source with the original
  run's result.
- **The equivalence branch in `run.js` has no automated coverage.** No test can produce a
  break, so the `shrinkEquivalencePair` dispatch, `baseline.txt`, and the `shrinkSkipped` /
  `equivalence` / `equivalenceDetail` fields are exercised only in production. A
  stub-mutator smoke test would close it.
- **`sweep.js` counts a mutator exception in `breaks`**, conflating "the mutator crashed"
  with "equivalence broke". It fails loud, which is right, but it muddies the headline number.
- **`sweep.js`'s `applied` test is source-equality**, not `mutationChangedJob`, and `jobFor`
  ignores mutator-supplied `inputs`/`level`/`randomSeed`. Correct today; would drift silently.
- **`sweep.js` has no `--help`**, and `--fixture` is substring-matched while `--mutator` is exact.
- **`tests.js` runtime grew ~4.5s (11%)** from a 60-seed loop in the `inline-legend-synonym`
  regression test that spawns a worker child per matching seed. Cutting to ~15 seeds, or
  compiling only the first two matching seeds, recovers it.

## Corpus

`reorder-winconditions` is eligible on 62/388 fixtures and `inline-legend-synonym` on
78/388, because the corpus rarely has two or more win conditions or a multi-character
`Alias = Target` legend line. This is corpus scarcity, not damage from any fix — the guards
added during this plan cost 3 and 9 fixtures respectively. Worth a dedicated fixture-authoring
task if these mutators are meant to carry weight.

## Spec drift

`comment-reflow` no longer does what the spec describes. The spec says it inserts a comment
*inside* the rule brackets to probe issue #1128; in fact PuzzleScript rejects in-bracket
comments deliberately (`compiler.js`: "You can't have comments inside rules, sorry"), that
rejection *is* #1128's fix, and the mutator now appends a trailing comment after the finished
rule. The deviation is correct; the spec text is stale, and **#1128 remains unprobed by
anything on this branch**.

*Resolved 2026-08-15:* the `comment-in-rule` mutator now probes #1128 as a malformity case,
asserting the deliberate rejection stays a clean error rather than becoming a crash.

## Finding: the 100-error threshold is unreachable while compiling

Recorded here because it invalidates a premise in
`2026-08-14-garden-issue-mined-mutators-design.md`, which claimed `multi-fault` would reach
the "Too many errors/warnings" path behind issues #1012, #1002 and #980.

`parser.js` defines `MAX_ERRORS_FOR_REAL = 100` and calls `TooManyErrors()` once
`errorStrings.length` passes it. But `compiler.js` defines `MAX_ERRORS = 5`, and `loadFile`
returns as soon as `errorCount > MAX_ERRORS`. Compilation therefore aborts on the sixth
error, and `errorStrings` can never approach 100.

Measured on the garden's `SAMPLE` fixture: stacking 3 mutators gives a median of 2 errors,
while stacks of 25, 60, 120 and 200 all give exactly 6. Three unrelated strategies — 200
rules referencing undefined objects, 160 objects with invalid colours, and 160 invalid win
conditions — each produced exactly 6 error strings with the "Too many errors" message absent.

So no source mutator can reach that path. Issue #1012 reports it "after 100 moves with
errors", which is runtime logging during play, where `logIssue` accumulates across moves
rather than during a single compile. Reaching it would need a runtime mutator driving a long
input tape against a game that logs an urgent error every move — a different design from
anything the garden currently has.

Two consequences worth deciding on separately:

- `TooManyErrors()` and the `MAX_ERRORS_FOR_REAL` guard are, for the compile path, dead code.
  Whether that is a bug depends on whether the 5-error abort is intended to be the real limit.
- `multi-fault`'s burst mode now aims at the `errorCount > MAX_ERRORS` abort branch instead,
  which ordinary two-to-three fault stacks usually miss.
