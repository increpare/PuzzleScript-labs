# PuzzleScript interaction fixtures and generated exploration

The user approved a second fixture campaign, tiny generated error-free games,
and automatic reduction of discrepancies. Work starts at local master
`24333ef1`; the current authority stays vanilla `57f9f6cb`. Preserve the existing
Labs/TypeScript prepared-AGAIN work and all native producer guards.

## Authored examples

Add at least twelve complete games and thirty-six explicit input-prefix cases.
Half cover property inference, overlapping live replacements, multirow tuples
and ellipses. Half cover rigid retries with RNG and AGAIN with checkpoint,
cancel, restart and undo. Authors reason about the expected boards and relevant
draws before executing; an engine must never generate accepted expected values.
Every new game compiles without errors in both authorities. Labs-specific RNG
differences use the existing explicit override fields. Export portable cases to
the existing generated testdata section, preserving its original prefix.

## Generated exploration

Use a small test-owned source model: named objects/colors, unnamed layers,
properties, ordinary rule text, cells containing object names, a fixed seed and
a short input tape. Render complete readable source with explicit legend glyphs.
Generate 1–4 by 1–3 boards, a few objects and several rule families. Case index
and campaign seed determine every choice independently of worker order.

Compare complete compilation first using the existing independent compiler
oracle. Agreed errorful/declined programs are counted as excluded; a compiler
disagreement remains a failure. Then use the unchanged source-compiled session
oracle for every input/AGAIN observation, RNG, history, effects and persistence.
No generated case has an engine-recorded expected board.

Run each case in an isolated Node child with a fixed timeout and bounded output.
A timeout or unexpected oracle exception is reported separately from an actual
comparison assertion. Save readable source and a versioned JSON case/failure
bundle; include the authority, construction seed/index, input tape and failure
phase. Never call an observed native exception a JS/TS mismatch without evidence.
The CLI supports deterministic replay and bounded shrinking of saved cases.

## Reduction

Try removing input chunks, rules, board rows/columns, cell occupants and optional
objects/properties. Keep Background/Player declarations and retain only candidates
that reproduce the original failure category. Session failures require both
compilers to agree the game is error-free. Compiler disagreements retain native
error-free compilation, observed before candidate execution. Use a strictly
decreasing explicit complexity measure. A bounded run
reports attempts and whether it reached a local fixed point; it never promises a
globally smallest program. Preserve source, seed and tape in the reduced bundle.

## Evidence and finish

Test determinism, renderer validity, oracle independence, compiler disagreement
detection, process timeouts and a reducer exercised against an intentionally
incorrect candidate. Clearly label all injected faults as harness tests. Run a
4,096-case campaign with actual compared/excluded/failed totals and real unique
source counts that exclude titles/seeds. Review and minimize real discoveries,
author regressions and local Markdown reports when warranted. Run the complete
strict suite and Labs suite, then independently review the work. Finish with a
readability walkthrough of the new examples through inference and session code;
do not mix an unrelated engine rewrite into this testing change.
