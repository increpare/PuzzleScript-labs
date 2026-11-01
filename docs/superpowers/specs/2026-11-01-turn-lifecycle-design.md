# A calculated turn and its commitment

Status: revised proposed design for user review, following comparison of the
generic and concrete type alternatives. No production changes are part of this
document. The aim is conceptual clarity in the separate TypeScript reference,
with the existing pinned-vanilla behavior and prepared-AGAIN reuse preserved.

## What the code currently does

`typescript/src/turn-rules.ts:applyTurnRules` already performs the complete
rules-and-movement calculation: initialize turn bookkeeping, apply player intent,
run early rules, resolve movements, retry failed rigid groups, and run late rules.
Its `TurnRulesResult` contains the resulting execution state, commands, movement
and creation/destruction sound evidence, diagnostics and original player sites.
It does not execute session commands, update undo history, save checkpoints or
advance levels.

`typescript/src/session.ts:step` obtains that result, installs it, and handles
session consequences. An AGAIN check currently calls this same function with
`probe: true`, capturing the calculation before session handling. A private
WeakMap retains that calculation, its incoming execution snapshot and game
identity. A later null input can reuse it while running session handling fresh.

Current Labs JS has a related, clearer boundary in `simulateInput`,
`prepareAgainTurn`, `takeAgainTurn` and `processCommandQueue`. Its preparation
uses a private board and cloned RNG. The TypeScript port already supports
private preparation when `againProbeHasSideEffects` is off. Its default remains
the pinned vanilla behavior, in which probes can advance RNG, retain execution
events/history and emit cancel audio. This can make the saved calculation
incompatible with the next input, requiring recalculation. The architectural
idea is reusable without changing that semantic authority.

## Alternatives considered

### One dispatcher with a TurnMode or TurnPhase parameter

Replace `probe?: boolean` with an enum and extract small functions from `step`.
This is the smallest change and retains one source for session ordering. It
still lets the dispatcher intertwine calculation, speculative observation,
rollback and commitment. Renaming Normal/Probe to phases would also obscure
that one describes an invocation's purpose, not a position in a sequence.

This is a reasonable migration step, but an insufficient final design.

### A calculated-turn value with two consumers — recommended

Calculate all rules and movement once. Return ordinary typed data. An ordinary
turn commits that value immediately. AGAIN calculates a null-input turn, inspects
it, and retains it when appropriate. When the continuation is taken, validate
and commit the saved calculation, or calculate afresh if it is no longer valid.

The two consumers are actual session commitment and explicit probe semantics.
Vanilla probe behavior has a named home; private preparation uses those probe
rules on an isolated session workspace. Shared domain helpers preserve command
and restoration order without a general phase dispatcher.

This matches the existing cache's real boundary, makes that boundary teachable,
and permits concrete types to distinguish general calculations from no-input
preparations. It requires carefully extracting the current early exits rather
than merely moving the old boolean checks behind a new name.

### Calculate and cache an entire SessionResult, including its effects

Run the full session operation privately and later install its state and effects.
This offers an attractive single evaluator. However, it would capture history,
viewport, restart/checkpoint targets, Replay/Interactive behavior, win options
and potentially fresh level-seed requests. Those values must be consulted at
commitment. It would greatly expand invalidation and complicate vanilla's
partial probe restoration. We should retain the narrower existing boundary.

## Alternatives for expressing the calculated result

The calculate/handle boundary and the choice of TypeScript notation are separate
decisions. The earlier draft parameterized the result as TurnCalculation<Input>.
That is valid but is no longer the recommended surface form.

| Representation | Benefits | Costs |
| --- | --- | --- |
| Generic TurnCalculation<Input> | One shape preserves an exact input type through general helpers; inference can establish the no-input case automatically. | Readers must interpret a type parameter and null specialization. Most consumers do not vary by the precise input type, so there is little general behavior to justify parameterizing. |
| CalculatedTurn plus concrete NoInputTurn — recommended | The guarantee has a readable name and the same useful static distinction. A no-input calculation is still an ordinary calculated turn. No extra runtime tag is needed. | Adds a type name. A named no-input helper is needed to return the narrower type without overloads or assertions. |
| Explicit PlayerInput/NoInput variants | Enum tags support clear exhaustive cases and different payloads. Good if the two cases acquire substantially different data or behavior. | Currently duplicates the common result payload and replaces the already meaningful null distinction with another tag. NoInput still does not identify the reason for running the turn. |
| One common result plus a dedicated prepareAgain function | Fewest result types; the preparation API can accept only game/state and supply no input itself. | An arbitrary calculated result stored inside the owning module has no type-level input distinction. Constructor ownership and behavioral tests carry that guarantee. |

Use the concrete refinement together with the dedicated preparation API.
The type names explain the guarantee; the function explains why the work is
being done. This is slightly more definition text than the generic but requires
less interpretation at ordinary call sites. The generic remains appropriate if
future code actually needs a family of input-dependent operations; that need is
not present in the current turn pipeline.

NoInput means no player instruction is injected. Rules can still request and
resolve movements. AGAIN, timer ticks and level-start rules can all run without
player input; none of these type representations alone proves AGAIN provenance.
The preparation operation supplies that purpose and performs the actual work.

## Phase, purpose and pending state

The conceptual phases are **calculation** and **session handling**. Session
handling either commits a turn or performs probe observation. Normal/Probe are
purposes; Ready/Waiting describe a pending continuation. They are different axes.

Use separate functions and data types to express the phase boundary. Do not add
a `TurnPhase` property or switch loop to encode the current program counter.
No part of this change requires suspending halfway through calculation or
session handling. If traces later need phase names, a phase enum can describe
those events without governing execution.

Proposed calculation data, using existing domain types:

```typescript
interface CalculatedTurn {
    readonly input: Movement | null;
    readonly result: TurnRulesResult;
}

interface NoInputTurn extends CalculatedTurn {
    readonly input: null;
}

interface PreparedAgainTurn {
    readonly game: SessionGame;
    readonly before: RuleExecutionState;
    readonly calculation: NoInputTurn;
}

enum AgainDecision {
    Stop,
    Schedule,
}

enum WinHandling {
    Apply,
    ReportOnly,
}
```

`calculateTurn` wraps the established `applyTurnRules` calculation and records
its actual input. `calculateWithoutInput` takes game/state, supplies null and
returns NoInputTurn. Both invoke the same rules-and-movement implementation
exactly once; there are no separate simulation algorithms. Keep `applyTurnRules`
available for component oracles. `prepareAgain` accepts game/state, uses the
no-input helper and captures the private input/result evidence. It does not
accept an arbitrary calculated turn from its caller.

The concrete input refinement prevents a general player-input calculation from
being stored as prepared AGAIN work. It expresses a domain relationship without
generics, brands or runtime phase tags. Computation and snapshot validation still
need their behavioral tests; the input field's type is not proof of execution.
WinHandling.ReportOnly still reports a suppressed Win effect when reached; it
does not mean "skip checking whether the game was won."

Keep `StepSessionOptions` working at the public boundary, including direct
non-null probes and independently selectable win suppression. Decode these
options once. Internal automatic AGAIN inspection always uses null input and
reported-only wins; the public probe API has a broader existing contract.

## Main flow

```text
ordinary turn:
    obtain calculation (fresh, or a valid saved null-input calculation)
    install calculation and report its diagnostics
    handle session consequences in their established order
    if AGAIN applies, calculate and inspect the next null-input turn
    retain an eligible, reusable calculation for the waiting continuation

waiting continuation:
    validate saved calculation against current rule input and game
    commit a private copy of the saved calculation, or calculate afresh
    read current session context while handling its consequences
```

The committed-session sequence remains visible as named function calls with
ordinary early returns:

1. Clear pending AGAIN and reject non-board screens.
2. Snapshot the current board/viewport; obtain and install the calculation.
3. Publish rule/rigid-limit diagnostics.
4. Enforce require_player_movement, including its restore/message reset exit.
5. Handle cancel, then restart; preserve actual command/output/history order.
6. Determine object-board changes after restart handling and record input
   history at the established boundary.
7. Play ordinary sounds and output commands; these may affect message screens.
8. Check victory when the resulting screen permits it.
9. If permitted, apply checkpoint and inspect a requested AGAIN continuation.
10. Restore the outer command message after inspection, clear commands, and
    finalize the existing public return value.

This is a behavior map, not a proposal to execute every numbered operation on
every branch. Actual helpers must retain the current live reads: restart can
run level-start rules and replace commands, and victory can load another level.
Do not precompute a global command plan and replay it after those changes.

## Probe observation is explicit behavior

| Probe path | Continuation decision | Current observable behavior to retain |
| --- | --- | --- |
| require_player_movement rejects the input | Stop | Forced undo and message/screen reset; relevant to public non-null probes |
| cancel alone | Stop | Forced undo and Cancel sound |
| cancel plus another queued command | Schedule | Forced undo and Cancel sound; ordinary command output suppressed |
| changed objects, without cancel | Schedule | Modified-board rollback and early return before ordinary sounds, wins or checkpoint |
| queued restart | Schedule | Restart history entry retained; actual restart suppressed; changed-board rollback may also occur |
| quiet queued win | Schedule | Early return with queued commands; no committed win |
| quiet calculation without win/restart | Stop | Execution/RNG/events survive in vanilla; possible reported-only natural victory; no checkpoint write |

For simultaneous commands, the earlier path wins: cancel precedes restart;
restart history handling precedes the changed-board check. The outer operation
restores its message and clears commands at the existing positions. Current
restore compatibility governs pending movements; probe rollback is not a full
execution-state transaction.

The private policy runs this observation on its own workspace, retaining only
diagnostics in the outer operation. The vanilla policy runs it on the existing
workspace. Only the latter can change subsequent rule inputs and force a cache
miss. Preserve public quiet probes with unsuppressed natural wins as well;
automatic AGAIN inspection always requests reported-only wins.

Scheduling eligibility is distinct from reuse eligibility. A vanilla random
probe can schedule AGAIN but invalidate its own calculation by consuming RNG.
Likewise `SessionResult.modified` is a historical reported-change result: cancel
plus another command or a quiet probe with win/restart can return true without
different objects. Keep these meanings distinct from object-board comparison.

## Ownership and validation

Keep preparation private and associated with the returned SessionState. Its
absence after spread/serialization remains an ordinary fresh-calculation path.
Repeated calls from the same immutable session may reuse the same preparation
through independent copies; there is no global single-use token.

Retain every existing reuse check: exact game identity, board shape/objects and
Set iteration order, full RNG state, pending movements, rigid marks and owners,
and command message. State fields that calculation resets remain reset as now.
Do not replace these checks with an identity-only shortcut. Game/object/rule
identities retain their existing immutable contract.

Capture a fresh BoardSnapshot and read history, viewport, restart target,
run mode and win handling at commitment. Preparation owns no session history,
effects, saved checkpoint or future level seed. Clone cached result containers
and diagnostics before exposing them. Keep diagnostics observable at discovery
and, when applicable, again at actual commitment, as in the current API.

## Scope and acceptance

Refactor the TypeScript runtime only. Preserve existing JS, pinned vanilla files,
hashes, expected data, public session shape, default quirks and all cache guards.
Do not add a state-machine framework, mutable phase field, bit representations,
buffer pools or new performance shortcuts. Preserve the useful prepared-result
reuse as the direct consequence of retaining a calculated turn.

Success means the main flow reads as calculation followed by session handling;
AGAIN visibly retains that same complete calculation; probe exceptions have
named behavior; and a reader need not follow a recursively invoked general
`step` function to discover what speculation does. Finite type contracts and
per-operation oracle comparisons must protect that explanation.
