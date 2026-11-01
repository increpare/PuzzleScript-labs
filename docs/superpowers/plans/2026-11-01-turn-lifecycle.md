# Turn calculation, inspection and commitment plan

> **For agentic workers:** Use superpowers:executing-plans for implementation
> after the proposed design is accepted. This document authorizes no production
> change by itself. Steps use checkboxes to distinguish plans from completed work.

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

- Create `typescript/src/turn-calculation.ts`: CalculatedTurn, concrete
  NoInputTurn, calculateTurn, calculateWithoutInput and copyTurnResult.
  Delegate computation to existing
  applyTurnRules; this module has no session environment or effect handling.
- Create `typescript/src/prepared-again.ts`: PreparedAgainTurn, private WeakMap,
  snapshot validation, lookup/retention and independent cached-result copies.
  Move the current sameRuleInput/sameRuleBoard/ordered-container checks intact.
- Modify `typescript/src/session.ts`: visible committed-turn sequence,
  named probe handling, explicit AgainDecision and WinHandling, and the
  public-options adapter. Ordinary helpers continue to own their existing
  history, restore, commands, checkpoint, screen and level semantics.
- Keep `typescript/src/turn-rules.ts` computation and its component API intact.
  Keep `typescript/src/session-model.ts` public state/options shape intact.
- Modify `typescript/test/session.test.mjs`: extend its existing fixtures and
  real-rule counters for context-at-commitment and probe-path coverage.
- Create `typescript/test/turn-calculation-types.test.mjs`: strict temporary
  TypeScript program using the existing negative-type-test harness pattern.
- Update `typescript/READABILITY.md`, `typescript/README.md` and
  `docs/typescript-cached-again.md` after actual verification.

## 1. Characterize the boundaries before moving them

- [ ] Read the design's probe matrix against session.ts and its native oracle;
  preserve cancel-before-restart and the current position of every early exit.
- [ ] Build and run the existing focused session/oracle subset:

  ```sh
  npm --prefix typescript run build
  node --test typescript/test/session.test.mjs typescript/test/session-oracle.test.mjs typescript/test/source-session-oracle.test.mjs typescript/test/turn-rules.test.mjs
  ```

- [ ] Extend session.test.mjs with independent, hand-asserted context witnesses.
  Use countedAgainGame(noQuirks) and its existing rule builders, preserving real
  earlyRules reads as the simulation counter. Check these three cases:

  | Witness | Construction and required result |
  | --- | --- |
  | Fresh checkpoint context | Have autoWalk queue Checkpoint and Again; after the first turn, change only the exposed session viewport and history. Commit the pending null turn. Its checkpoint contains the new viewport, history retains the amended input boundary, and only the next lookahead calculates again. Compare with a spread-state uncached branch as a second check. |
  | Fresh restart target | Place Marker at x2, start Player at x0 on at least four cells, and queue Restart only when Player reaches Marker. First turn reaches x1 and prepares x2. Replace only restartTarget with a board whose Player is at x3. Commitment must restart to x3 with Restart audio and the correct history entry; it must not install a previously calculated session snapshot. No new rule calculation is needed when no further AGAIN survives restart. |
  | Fresh win context and seeds | Use a continuation which reaches a natural win without a queued win command. Compare cached and uncached branches with suppressWin on/off and Replay/Interactive context. Only actual unsuppressed Replay commitment requests a new level seed. Pending calculation must not retain the old context or request a future seed. |

- [ ] Fill gaps in the public-probe matrix with focused assertions: non-null
  require_player_movement rejection, quiet unsuppressed natural wins, and
  simultaneous Cancel+Restart. Check board, full RNG, history, command message,
  checkpoint/persistence, ordered sound/effect arrays and reported return value.
  These tests characterize existing behavior and should pass before extraction.

## 2. Expose the calculated-turn type and exact reusable artifact

- [ ] Add the strict negative contract before the new modules. Use the current
  temporary .mts + local tsc harness; first failure must be missing types, then
  unused @ts-expect-error if a boundary is weakened. The contract includes:

  ```typescript
  declare const game: SessionGame;
  declare const execution: RuleExecutionState;
  const automatic: NoInputTurn = calculateWithoutInput(game, execution);
  const player = calculateTurn(game, execution, Movement.Right);
  const prepared: PreparedAgainTurn = {
      game, before: execution, calculation: automatic,
  };
  const wrong: PreparedAgainTurn = {
      game, before: execution,
      // @ts-expect-error A player-input calculation cannot be prepared as AGAIN.
      calculation: player,
  };
  // @ts-expect-error A raw execution snapshot is not a calculated turn.
  const missingCalculation: CalculatedTurn = execution;
  void [prepared, wrong, missingCalculation];
  ```

  The test must have no ignored diagnostics. Import all actual types explicitly
  in the .mts source.

- [ ] Implement CalculatedTurn and concrete NoInputTurn as in the revised
  design. calculateTurn returns the general record; calculateWithoutInput
  supplies null and returns the narrower record. Both call the same
  applyTurnRules implementation once. Use no overloads or type assertions.
  copyTurnResult must clone RuleExecutionState,
  playerPositions and diagnostic records while retaining canonical object/rule
  identities. Preserve attempts, rigidRetries and rigidLimitReached.
- [ ] Move the existing PreparedTurn into PreparedAgainTurn with a
  NoInputTurn. Its private prepareAgain creator takes game/state and supplies
  no player input itself; it does not accept an arbitrary calculation.
  Move WeakMap storage and every ordered-input comparison
  into prepared-again.ts. Retention still checks the actual returned state;
  lookup still requires AGAIN, null input and the same game/input snapshot.
  Copy a prepared calculation by explicitly constructing its no-input record
  around copyTurnResult; do not introduce a generic copy helper for this case.
- [ ] Keep repeated immutable branches independent; lookup returns copied
  calculations without consuming a globally shared preparation. Public state
  copies still miss naturally. Do not broaden or narrow the validation set.
- [ ] Run the negative type contract, all session tests, the real-simulation
  count tests and branch/mutation/invalidation tests before further extraction.
- [ ] Commit this verified boundary separately from session-policy extraction.

## 3. Make commitment a readable sequence

- [ ] Decode public probe and win flags at the session boundary. Use
  WinHandling.Apply/ReportOnly internally; keep all public combinations valid.
  ReportOnly must retain the existing suppressed Win event behavior.
- [ ] Obtain a fresh or valid prepared CalculatedTurn before session handling.
  Capture the live BoardSnapshot here, then install the result and publish its
  diagnostics in the existing order. Do not copy session snapshots into the
  calculation or cache.
- [ ] Extract named operations for player-movement rejection, cancellation,
  restart, object/history handling, ordinary outputs, victory/checkpoint and
  continuation preparation. Keep ordinary sequencing and early returns; add no
  phase-switch loop or phase field. Each extraction must expose its meaningful
  input and decision rather than use an opaque applyPolicy helper.
- [ ] Preserve live command reads after restart and level transitions. Determine
  actual board change at its old point after restart handling; keep the public
  reported-change value separate from eligibility to schedule AGAIN.
- [ ] Route level-load and restart start rules through the same commitment path
  with reported-only wins. Preserve levelStarting/restarting recursion guards,
  original restart snapshots, current message and seed behavior.
- [ ] Run focused session/oracle checks after each extraction. Treat an order or
  effect mismatch as a regression; do not update expected results to accommodate
  a cleaner-looking ordering. Commit the verified committed-turn sequence.

## 4. Give AGAIN inspection its own explicit path

- [ ] Replace internal recursive step(..., {probe:true}) with a named operation
  which calculates null input once, captures a private input snapshot/result,
  installs the calculation on the chosen workspace, and applies probe semantics.
  It returns AgainDecision.Stop/Schedule and, when reusable, the preparation.
- [ ] Keep public probes supported through the same probe-semantic consumer,
  including arbitrary input and independent WinHandling. A public probe can
  reuse an already compatible pending calculation, as it does today.
- [ ] Name the vanilla retained-state behavior and the private workspace policy.
  The former performs existing board rollback/history/cancel effects on the
  current machine. The latter performs them privately and publishes diagnostics
  only. Neither performs checkpoint persistence during a probe.
- [ ] Preserve outer-message restoration and command clearing at their original
  positions. Keep scheduling distinct from whether a stored calculation is
  still reusable after vanilla's RNG/movement/history behavior.
- [ ] Keep the existing decisive count and semantic assertions:
  - 100 deterministic visible turns: 101 calculations in both profiles.
  - 100 private random turns: 101 calculations, one committed draw per turn.
  - 100 vanilla random turns: 200 calculations and the existing two-draw stream.
  - Prepared rigid retries are reused with their final failure sounds.
  - Cancel, Restart, Win, Message, Sound and Checkpoint commands commit at the
    existing time and in the same order; diagnostic copies remain independent.
- [ ] Re-run context witnesses and probe-matrix tests. Inspect the resulting
  main function and AGAIN helper for readability; reject renamed boolean soup
  or duplicated simulation. Commit the verified inspection path.

## 5. Validate behavior and document the reading path

- [ ] Run the full strict suite, including original authored semantic fixtures:

  ```sh
  npm --prefix typescript test
  ```

- [ ] Run a bounded reproducible per-operation source-game campaign:

  ```sh
  npm --prefix typescript run explore -- --seed turn-lifecycle-2026-11-01 --cases 256 --jobs 4 --out /private/tmp/ps-turn-lifecycle-findings --json /private/tmp/ps-turn-lifecycle-campaign.json
  ```

  Record compared cases, observations, exclusions and all failure categories.
  Preserve the original pinned oracle and producer guards. A clean campaign is
  evidence for its generated grammar, not exhaustive language coverage.

- [ ] Replay the existing source-compiled AGAIN/session corpus with unchanged
  tapes and expectations. Start with selected commands, RNG and rigid cases;
  use the existing bounded cache-audit tooling for the larger AGAIN corpus and
  record timeouts as inconclusive. Any full-corpus claim requires the full run
  to finish; avoid repeating previously documented unbounded slow runs blindly.
- [ ] Update READABILITY.md with calculation → inspection/commitment and one
  tiny AGAIN trace. Update the cache report to distinguish architectural reuse
  from private storage, and record actual verification in this plan. Keep the
  vanilla compatibility behavior and current Labs behavior clearly identified.
- [ ] Review the final diff against the design and the public state/schema
  guards. Confirm that only TypeScript and its documentation/tests changed;
  no native expectations, JS engine, RNG default or gameplay behavior was altered.
- [ ] If implementing later, integrate only verified work into local master
  under the existing authorization; do not push unrelated local commits.

## Planning evidence

The current implementation and its existing tests were inspected at 4b827766.
The supplied main-branch optimization already separates full rule/movement
simulation from session command/effect handling. The TypeScript cache already
retains only the former; its default vanilla RNG fallback is intentional. This
plan changes how that behavior is expressed, not which behavior is authoritative.

The representation comparison revised the original generic proposal to a
concrete CalculatedTurn/NoInputTurn refinement and a dedicated preparation API.
A temporary strict TypeScript program using the project's actual Movement and
TurnRulesResult types confirmed that both generic and concrete representations
reject a player-input result in a no-input preparation. It also checked enum
variants and the no-input preparation function's argument boundary. These were
type-design experiments outside the repository, not new production tests.

At planning time the existing TypeScript build and **12 focused session tests**
passed: deterministic reuse in both profiles, private random reuse, all six
deferred commands, vanilla random fallback, completed rigid-retry reuse and
speculative checkpoint suppression. These are baseline observations, not tests
of a new implementation. The exact command was:

```sh
npm --prefix typescript run build
node --test --test-name-pattern='AGAIN reuses deterministic preparation|clean random AGAIN probes keep|vanilla random probes fall back|prepared AGAIN reuses completed rigid retries|clean prepared AGAIN defers command|speculative checkpoints leave' typescript/test/session.test.mjs
```

No implementation or implementation verification is claimed by this plan.
