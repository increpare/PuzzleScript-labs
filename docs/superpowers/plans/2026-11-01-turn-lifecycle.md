# Turn calculation, inspection and commitment plan

> **Execution:** The user accepted this outline with “ok let’s keep going”.
> Work used an isolated worktree, existing behavior characterization, red/green
> input contracts and independent specification/quality reviews. Checkboxes
> distinguish completed work from outstanding verification.

**Goal:** Make the TypeScript turn structure explicit while preserving complete
prepared-AGAIN calculation reuse and current vanilla behavior.

**Architecture:** Ordinary inputs and AGAIN both use the same complete
rules-and-movement calculation. Session commitment and probe observation consume
that typed value separately. Private preparation and native probe side effects
remain named policies with the existing strict reuse checks.

**Tech Stack:** Strict TypeScript 6.0.2, Node test runner, frozen vanilla
57f9f6cb compiler/session oracle and existing source-game exploration.

**Design:** [A calculated turn and its commitment](../specs/2026-11-01-turn-lifecycle-design.md).

## File responsibilities

- Modify `typescript/src/model.ts`: numeric TurnInput enum including None,
  distinct from object Movement. Use explicit member conversions at boundaries.
- Modify `typescript/src/turn-rules.ts`: evolve the actual calculation into
  calculateTurn and the flat CalculatedTurn record, recording TurnInput alongside
  the existing result fields. Keep the old component API as a boundary adapter;
  do not add a new file containing a name-only wrapper or an input/result shell.
- Create `typescript/src/prepared-again.ts`: PreparedAgainTurn, private WeakMap,
  snapshot validation, lookup/retention and independent cached-result copies.
  Move the current sameRuleInput/sameRuleBoard/ordered-container checks intact.
- Modify `typescript/src/session.ts`: visible committed-turn sequence,
  named probe handling, explicit AgainDecision and WinHandling, and the
  public-options adapter. Ordinary helpers continue to own their existing
  history, restore, commands, checkpoint, screen and level semantics.
- Keep `typescript/src/session-model.ts` public state/options shape intact.
- Modify `typescript/test/session.test.mjs`: extend its existing fixtures and
  real-rule counters for context-at-commitment and probe-path coverage.
- Create `typescript/test/turn-calculation-types.test.mjs`: strict temporary
  TypeScript program using the existing negative-type-test harness pattern.
- Update `typescript/READABILITY.md`, `typescript/README.md` and
  `docs/typescript-cached-again.md` after actual verification.

## 1. Characterize the boundaries before moving them

- [x] Read the design's probe matrix against session.ts and its native oracle;
  preserve cancel-before-restart and the current position of every early exit.
- [x] Build and run the existing focused session/oracle subset:

  ```sh
  npm --prefix typescript run build
  node --test typescript/test/session.test.mjs typescript/test/session-oracle.test.mjs typescript/test/source-session-oracle.test.mjs typescript/test/turn-rules.test.mjs
  ```

- [x] Extend session.test.mjs with independent, hand-asserted context witnesses.
  Use countedAgainGame(noQuirks) and its existing rule builders, preserving real
  earlyRules reads as the simulation counter. Check these three cases:

  | Witness | Construction and required result |
  | --- | --- |
  | Fresh checkpoint context | Have autoWalk queue Checkpoint and Again; after the first turn, change only the exposed session viewport and history. Commit the pending null turn. Its checkpoint contains the new viewport, history retains the amended input boundary, and only the next lookahead calculates again. Compare with a spread-state uncached branch as a second check. |
  | Fresh restart target | Place Marker at x2, start Player at x0 on at least four cells, and queue Restart only when Player reaches Marker. First turn reaches x1 and prepares x2. Replace only restartTarget with a board whose Player is at x3. Commitment must restart to x3 with Restart audio and the correct history entry; it must not install a previously calculated session snapshot. No new rule calculation is needed when no further AGAIN survives restart. |
  | Fresh win context and seeds | Use a continuation which reaches a natural win without a queued win command. Compare cached and uncached branches with suppressWin on/off and Replay/Interactive context. Only actual unsuppressed Replay commitment requests a new level seed. Pending calculation must not retain the old context or request a future seed. |

- [x] Fill gaps in the public-probe matrix with focused assertions: non-null
  require_player_movement rejection, quiet unsuppressed natural wins, and
  simultaneous Cancel+Restart. Check board, full RNG, history, command message,
  checkpoint/persistence, ordered sound/effect arrays and reported return value.
  These tests characterize existing behavior and should pass before extraction.

## 2. Expose the calculated-turn type and exact reusable artifact

- [x] Add the strict negative contract before the new modules. Use the current
  temporary .mts + local tsc harness; first failure must be missing types, then
  unused @ts-expect-error if a boundary is weakened. The contract includes:

  ```typescript
  declare const game: SessionGame;
  declare const execution: RuleExecutionState;
  const automatic = calculateTurn(game, execution, TurnInput.None);
  const player = calculateTurn(game, execution, TurnInput.Right);
  const prepared: PreparedAgainTurn = {
      game, before: execution, turn: automatic,
  };
  // @ts-expect-error Turn inputs and per-layer movements are separate domains.
  const movement: Movement = TurnInput.None;
  // @ts-expect-error Core calculation uses explicit None instead of null.
  calculateTurn(game, execution, null);
  // @ts-expect-error Object Movement is not the input enum.
  calculateTurn(game, execution, Movement.Right);
  // @ts-expect-error A raw execution snapshot is not a calculated turn.
  const missingCalculation: CalculatedTurn = execution;
  void [prepared, player, movement, missingCalculation];
  ```

  The test must have no ignored diagnostics. Import all actual types explicitly
  in the .mts source.

- [x] Add TurnInput with None/Up/Down/Left/Right/Action. Preserve the existing
  public Movement|null and native corpus encodings through explicit boundary
  mappings. Check all six input cases; never cast enums or depend on matching
  numeric ordinals. None must skip player intent without skipping rules.
- [x] Implement the flat CalculatedTurn in the actual rules calculation. It is
  the existing result's fields plus input, with no nested result wrapper.
  Preserve the established algorithm and old component result shape through
  boundary adapters. copyCalculatedTurn must clone RuleExecutionState,
  playerPositions and diagnostic records while retaining canonical object/rule
  identities. Preserve attempts, rigidRetries and rigidLimitReached.
- [x] Move the existing PreparedTurn into PreparedAgainTurn with an ordinary
  CalculatedTurn. Its private prepareAgain creator supplies TurnInput.None
  itself; preparation does not accept a caller's arbitrary calculation.
  Move WeakMap storage and every ordered-input comparison
  into prepared-again.ts. Retention still checks the actual returned state;
  lookup still requires AGAIN, TurnInput.None and the same game/input snapshot.
  Validate that the retained turn records None at this boundary; this is a local
  invariant, not a new generic or subtype. Copy through copyCalculatedTurn.
- [x] Keep repeated immutable branches independent; lookup returns copied
  calculations without consuming a globally shared preparation. Public state
  copies still miss naturally. Do not broaden or narrow the validation set.
- [x] Run the negative type contract, all session tests, the real-simulation
  count tests and branch/mutation/invalidation tests before further extraction.
- [x] Commit the input/calculation boundary separately from session-policy extraction.
  The cache move belongs with the session extraction that consumes it.

## 3. Make commitment a readable sequence

- [x] Decode public probe and win flags at the session boundary. Use
  WinHandling.Apply/ReportOnly internally; keep all public combinations valid.
  ReportOnly must retain the existing suppressed Win event behavior.
- [x] Obtain a fresh or valid prepared CalculatedTurn before session handling.
  Capture the live BoardSnapshot here, then install the result and publish its
  diagnostics in the existing order. Do not copy session snapshots into the
  calculation or cache.
- [x] Keep player-movement rejection, cancellation, restart, object/history
  handling, ordinary outputs, victory/checkpoint and continuation preparation
  visibly ordered in one function. Keep ordinary sequencing and early returns;
  extract a helper where a real repeated operation or substantial independent
  domain task justifies it. Do not create a one-line helper for every step,
  phase-switch loop, phase field or opaque applyPolicy layer.
- [x] Preserve live command reads after restart and level transitions. Determine
  actual board change at its old point after restart handling; keep the public
  reported-change value separate from eligibility to schedule AGAIN.
- [x] Route level-load and restart start rules through the same commitment path
  with reported-only wins. Preserve levelStarting/restarting recursion guards,
  original restart snapshots, current message and seed behavior.
- [x] Run focused session/oracle checks after each extraction. Treat an order or
  effect mismatch as a regression; do not update expected results to accommodate
  a cleaner-looking ordering. Commit the verified committed-turn sequence.

## 4. Give AGAIN inspection its own explicit path

- [x] Replace internal recursive step(..., {probe:true}) with a named operation
  which calculates TurnInput.None once, captures a private input snapshot/result,
  installs the calculation on the chosen workspace, and applies probe semantics.
  observeProbe returns AgainDecision.Stop/Schedule; prepareAgain records the
  selected calculation explicitly on its working session.
- [x] Keep public probes supported through the same probe-semantic consumer,
  including arbitrary input and independent WinHandling. A public probe can
  reuse an already compatible pending calculation, as it does today.
- [x] Name the vanilla retained-state behavior and the private workspace policy.
  The former performs existing board rollback/history/cancel effects on the
  current machine. The latter performs them privately and publishes diagnostics
  only. Neither performs checkpoint persistence during a probe.
- [x] Preserve outer-message restoration and command clearing at their original
  positions. Keep scheduling distinct from whether a stored calculation is
  still reusable after vanilla's RNG/movement/history behavior.
- [x] Keep the existing decisive count and semantic assertions:
  - 100 deterministic visible turns: 101 calculations in both profiles.
  - 100 private random turns: 101 calculations, one committed draw per turn.
  - 100 vanilla random turns: 200 calculations and the existing two-draw stream.
  - Prepared rigid retries are reused with their final failure sounds.
  - Cancel, Restart, Win, Message, Sound and Checkpoint commands commit at the
    existing time and in the same order; diagnostic copies remain independent.
- [x] Re-run context witnesses and probe-matrix tests. Inspect the resulting
  main function and AGAIN helper for readability; reject renamed boolean soup
  or duplicated simulation. Commit the verified inspection path.

## 5. Validate behavior and document the reading path

- [x] Run the full strict suite, including original authored semantic fixtures:

  ```sh
  npm --prefix typescript test
  ```

- [x] Run a bounded reproducible per-operation source-game campaign:

  ```sh
  npm --prefix typescript run explore -- --seed turn-lifecycle-2026-11-01 --cases 256 --jobs 4 --out /private/tmp/ps-turn-lifecycle-findings --json /private/tmp/ps-turn-lifecycle-campaign.json
  ```

  Record compared cases, observations, exclusions and all failure categories.
  Preserve the original pinned oracle and producer guards. A clean campaign is
  evidence for its generated grammar, not exhaustive language coverage.

- [x] Replay the existing source-compiled AGAIN/session corpus with unchanged
  tapes and expectations. Start with selected commands, RNG and rigid cases;
  use the existing bounded cache-audit tooling for the larger AGAIN corpus and
  record timeouts as inconclusive. Any full-corpus claim requires the full run
  to finish; avoid repeating previously documented unbounded slow runs blindly.
- [x] Update READABILITY.md with calculation → inspection/commitment and one
  tiny AGAIN trace. Update the cache report to distinguish architectural reuse
  from private storage, and record actual verification in this plan. Keep the
  vanilla compatibility behavior and current Labs behavior clearly identified.
- [x] Review the final diff against the design and the public state/schema
  guards. Confirm that only TypeScript and its documentation/tests changed;
  no native expectations, JS engine, RNG default or gameplay behavior was altered.
- [x] Integrate only verified work into local master
  under the existing authorization; do not push unrelated local commits.

## Planning evidence

The current implementation and its existing tests were inspected at 4b827766.
The supplied main-branch optimization already separates full rule/movement
simulation from session command/effect handling. The TypeScript cache already
retains only the former; its default vanilla RNG fallback is intentional. This
plan changes how that behavior is expressed, not which behavior is authoritative.

The earlier representation comparison considered a generic proposal and a
concrete CalculatedTurn/NoInputTurn refinement with a dedicated preparation API.
A temporary strict TypeScript program using the project's actual Movement and
TurnRulesResult types confirmed that both generic and concrete representations
reject a player-input result in a no-input preparation. It also checked enum
variants and the no-input preparation function's argument boundary. These were
type-design experiments outside the repository, not new production tests.

The user's subsequent TurnInput.None proposal simplifies the selected outline
further: one input enum, one flat CalculatedTurn and one PreparedAgainTurn.
The old generic/subtype contracts above are historical experiments, not
requirements of the selected outline. Current planned type tests enforce input
versus movement domains; preparation behavior and reuse validation establish
the None invariant.

At planning time the existing TypeScript build and **12 focused session tests**
passed: deterministic reuse in both profiles, private random reuse, all six
deferred commands, vanilla random fallback, completed rigid-retry reuse and
speculative checkpoint suppression. These are baseline observations, not tests
of a new implementation. The exact command was:

```sh
npm --prefix typescript run build
node --test --test-name-pattern='AGAIN reuses deterministic preparation|clean random AGAIN probes keep|vanilla random probes fall back|prepared AGAIN reuses completed rigid retries|clean prepared AGAIN defers command|speculative checkpoints leave' typescript/test/session.test.mjs
```

## Execution evidence

- Worktree: `.worktrees/typescript-turn-lifecycle`; branch
  `codex/typescript-turn-lifecycle`, based on `c383c9d5`.
- Focused baseline: **162 passed**, before production changes;
  `/private/tmp/ps-turn-lifecycle-baseline.log`.
- Eleven added characterization cases passed on the original engine. The
  session file passes **72 tests**. These cover fresh viewport/history and
  checkpoint, restart target, four win-context cases, non-null movement
  rejection, two quiet natural-win probes and Cancel+Restart priority.
- Input/type red evidence: missing new exports/module before implementation.
  Green core type/calculation checks: **34 passed**. Independent specification
  and quality reviewers approved the core without actionable findings.
- Flat cache extraction and the final session split each passed **182 focused
  checks**. Logs: `/private/tmp/ps-turn-lifecycle-flat-cache.log` and
  `/private/tmp/ps-turn-lifecycle-session-split.log`.
- Independent full-session specification and code-quality review compared the
  original branch order, ownership, RNG/history/effects and current commitment
  context, finding no actionable issues. The spec reviewer independently ran
  all **72 session tests** successfully without rebuilding.
- Implementation code checkpoint: `6bcdbb9a`. The turn example prints
  `Before: PC.` and `After: .PC` using TurnInput.Right.
- Full strict suite: **2,134 passed, zero failures**, about 223 seconds.
  Build passed first; the exact complete test set was then run with four workers
  alongside bounded audits, without rebuilding their module graph:

  ```sh
  node --test --test-concurrency=4 typescript/test/*.test.mjs src/tests/semantic-fixtures/fixtures.test.cjs
  ```

  Log: `/private/tmp/ps-turn-lifecycle-full.log`. Original native hash checks,
  335 compilation fixtures, 492 simulation-source compilations and all 99,192
  executable-rule comparisons remain covered.
- Generated campaign: **256/256 passed**, **1,822 observations/operations**,
  **256 loads**, **254 distinct sources**, **34 rule sets**, **239 boards**.
  Zero exclusions, comparison failures, oracle exceptions, process failures or
  timeouts. Used seed `turn-lifecycle-2026-11-01`, two workers and a 15-second
  per-case limit. Report: `/private/tmp/ps-turn-lifecycle-campaign.json`.
- The bounded recorded-AGAIN audit completed all **151 selected fixtures**,
  each running the original source, seed and input tape against the pinned
  vanilla oracle. Raw result: **134 paired passes**, **6,565 observations per
  build**, **137 loads**, zero baseline/candidate comparison failures, and
  **16 timeouts on each side** under the 15-second limit. Fifteen fixtures timed
  out on both sides. `collapse simple` passed baseline but timed out candidate;
  `Tunnel Rat` did the reverse. The raw tool returned exit1 for the asymmetric
  candidate timeout; it is not relabeled as a successful complete replay.
- Follow-up of `collapse simple` used the **unchanged builds and expectations**,
  a 60-second bound and alternating baseline/candidate/candidate/baseline order.
  All four runs passed the full native oracle with **83 identical observations**
  and one load each, in **8.48–8.91 seconds wall time**. The original timeout
  did not reproduce. This supports treating that 15-second outcome as timing
  variability rather than a semantic discrepancy. Follow-up report:
  `/private/tmp/ps-turn-lifecycle-collapse-followup.json`.
- Combining the completed raw pairs and that follow-up gives **135 paired
  passes**, **6,648 observations per build** and **138 loads**. Sixteen other
  pairs remain time-limited on at least one side; fifteen candidate replays are
  inconclusive. Tunnel Rat's completed candidate independently passed vanilla,
  but its baseline timeout is not counted as a completed pair. This is bounded
  evidence, not a claim that all 492 recorded sessions were replayed.
- Exact raw audit command and report:

  ```sh
  node typescript/tools/audit-cached-again.cjs /private/tmp/ps-turn-lifecycle-baseline-build /Users/stephenlavelle/Documents/GitHub/PuzzleScript-labs/.worktrees/typescript-turn-lifecycle/typescript/build /private/tmp/ps-turn-lifecycle-again-audit.json 2 15
  ```

  Log: `/private/tmp/ps-turn-lifecycle-again-audit.log`. The baseline graph was
  copied before refactoring; the candidate graph stayed unchanged during both
  audits. Native-producer, immutable-game and schema guards stayed enabled.
- A final documentation review approved the lifecycle/ownership explanation,
  current-versus-historical evidence and explicitly inconclusive replay cases.
- Native sources, hashes, compiler producers and expected fixtures are unchanged.
  Production changes are confined to TypeScript; no JS/native/UI assets changed.
- Local master fast-forwarded to `b069056d`, built successfully, and passed all
  **182 focused integration checks**. The turn example again printed `PC.` →
  `.PC`. Log: `/private/tmp/ps-turn-lifecycle-master-smoke.log`. Both checkouts
  were clean; no push, preview server or unbounded replay was started.
