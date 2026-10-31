# Historical crash: late randomdir on Player followed by Action

Historical report: upstream [#1207](https://github.com/increpare/PuzzleScript/pull/1207)
fixes the source-acceptance bug by rejecting `randomdir` in late rules. Current
Labs follows that restriction and drops the invalid qualifier during error
recovery. The current pinned-native and TypeScript runner verifies this diagnostic and
safe recovery at `57f9f6cb`. The crash evidence below belongs to the old revision.

This is a newly constructed headless reproducer from the semantic-fixture work,
not a failure discovered in an existing game. At the historical revisions below, the source compiled with **zero
errors and zero warnings**. The issue reproduces in unmodified vanilla at
`5a94bde1a5127a3a45306ea28598eba2874d446d` and the Labs engine at base
`3367a2d41964ff90c5ab9a5e8eae2132e5f225f2`. The TypeScript compatibility port also
fails, with an explicit unsupported-movement error. This is a shared accepted-source
crash, not a discovered JS/TypeScript gameplay mismatch.

## Source and steps

Open [late-player-randomdir.ps](late-player-randomdir.ps), compile and press Action
(X) twice. The entire level is one Player cell. For a deterministic headless run,
use seed `late-restore` and inputs `[4, 4]`.

The relevant rule is:

```text
late [ Player ] -> [ randomdir Player ]
```

The historical compiler explicitly allowed `randomdir` in late rules, despite rejecting
ordinary movement directions there. The game should either be rejected with a
diagnostic explaining that restriction, or handle these inputs without an
internal exception. This report does not prescribe the intended late-rule semantics.

## Historical verified behavior

1. Compilation reports no diagnostics.
2. First Action succeeds in place. The late group then chooses movement
   repeatedly until unchanged. With this seed its draws choose Down, Up, Right,
   Down, Right, Right, leaving **Right** pending on Player.
3. Second Action adds **Action** to that pending Right request.
4. Vanilla throws `TypeError: Cannot read properties of undefined (reading '0')`.
   Labs throws the same error. TypeScript throws
   `Unsupported movement combination: Right, Action`.

There is no collision or board-boundary decision involved in the failure: the
lookup fails before it can evaluate a target cell. The one-cell level is enough.

## Cause

Late movements are left pending after movement resolution. The next player input
adds its intent to the existing request. In native storage, Right and Action
combine to direction value 24. `dirMasksDelta` has no entry for 24, and
`repositionEntitiesOnLayer` immediately reads `delta[0]` from the missing entry.

Relevant pinned sources:

- [Late qualifier acceptance](https://github.com/increpare/PuzzleScript/blob/5a94bde1a5127a3a45306ea28598eba2874d446d/src/js/compiler.js#L710).
- [Supported direction lookup](https://github.com/increpare/PuzzleScript/blob/5a94bde1a5127a3a45306ea28598eba2874d446d/src/js/engine.js#L1327).
- [Unchecked lookup use](https://github.com/increpare/PuzzleScript/blob/5a94bde1a5127a3a45306ea28598eba2874d446d/src/js/engine.js#L1351).

Changing the rule to early `[ Player ] -> [ randomdir Player ]` is a verified
control: two Action inputs succeed because replacement chooses the request
before movement resolution rather than leaving it across the turn boundary.

## Reproduce locally

From the repository root, after building TypeScript:

```sh
npm --prefix typescript run build
node src/tests/semantic-fixtures/repros/late-player-randomdir.cjs
```

The current runner requires the late-movement diagnostic, verifies two Actions
succeed with no pending movement, and verifies the early-rule control remains
valid. It prints the authority and observed diagnostic. Browser rendering was not
tested; keyboard instructions above describe the equivalent inputs.

The historical crashing source remains separate from portable gameplay fixtures.
The reference revision test also checks the fixed acceptance boundary and safe
recovery. Native implementation files are copied unchanged from the new authority.
