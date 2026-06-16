# Static Analysis Soundness Notes

Durable record of the soundness scope and known limitations of the JS static
analyzer (`src/tests/ps_static_analysis.js`, front-ended by
`compileSemanticSource` in `src/canonicalize.js`). This is the canonical place
for these decisions — there is no repo-root `TODO.md` (an old, unrelated solver
`TODO.md` was deleted in commit `07d73fb3`; do not cite it).

The analyzer is designed to **never over-claim**: a `proved` fact / a positive
tag is meant to hold for every reachable runtime state. The runtime-contract
suite (`run_static_analysis_runtime_contracts_node.js`) is the dynamic oracle —
it runs the real engine over recorded traces and checks each claim at every turn
boundary. The notes below document the exact scope in which two classes of claim
are sound, and why two coverage exclusions are intentional rather than bugs.

## 1. Cosmetic claims are solver-scoped (unsound under undo)

**Tags:** object `cosmetic`, rule `cosmetic` (and the projection / rule-suppression
optimizations that consume them).

**The decision:** cosmetic projection (dropping a cosmetic object from the board)
and cosmetic-rule suppression (deleting a rule whose only effects are cosmetic)
are sound for **forward solver search only**. They are **not sound under `undo`**.

**Why undo breaks it:** the engine pushes an undo state whenever `level.objects`
changed during a turn. A turn whose *only* effect is a cosmetic change still
pushes an undo state. Suppressing that rule (or projecting that object) therefore
changes the **depth of the undo stack**. A later `undo` then restores a
*different* turn than it would have in the unoptimized game, and that divergence
can surface in non-cosmetic state. So any consumer that can issue `undo` — or
otherwise observe undo-stack depth / turn-history length — must not rely on these
tags. Solver search never issues undo, so the tags are sound for it.

**How this is enforced in the oracle:**
`run_static_analysis_runtime_contracts_node.js` gates all cosmetic/merge
projection replays on
`checkSolverProjectionReplays = !hasUndoInput && noRandomProved` (around line
1609). Undo-bearing traces skip cosmetic-object projection, cosmetic-rule
suppression, cosmetic-rule optimizer, and merge projection parity checks.
`static_analysis_adversarial_node.js` (the `cosmetic_undo_solver_scope` fixture)
asserts that an undo-bearing trace produces `cosmeticRuleProjectionChecks === 0`,
locking the scope in.

**Where the scope is disclosed to consumers:** the `cosmetic` object and rule
specs in `static_analysis_claim_descriptions.json` carry an explicit `SCOPE:`
clause and a structured `scope` field.

## 2. Random games are intentionally excluded from cosmetic/merge verification

The `noRandomProved` half of the gate above means a game that uses randomness
(`random` rules, `randomDir` RHS movement, `random` object writes) receives
**zero runtime verification** of its cosmetic-object, cosmetic-rule, and merge
projection claims.

This is **intentional and not closable**, even though a seed is recorded:

- A cosmetic/merge optimization is allowed to *change which random draws happen*
  (e.g. by removing a rule application that would have consumed the RNG). Once
  the draw sequence diverges, the end state diverges too. Replaying with a fixed
  seed and demanding end-state equality would therefore fail for a *correct*
  optimization — we would be testing seed-stability, not cosmetic-ness.
- The whole point of "cosmetic" is that the difference does not matter to the
  solver. On a random game we explicitly do **not** want to care whether an
  optimization changes the post-optimization random state.

So the analyzer still *emits* cosmetic tags for random games (they remain valid
solver hints), but the runtime suite does not attempt parity replays for them.
The tag specs disclose this exclusion.

## 3. The analyzer rejects games the real engine rejects

`compileSemanticSource` runs the semantic compile pipeline (`compileSemantic`),
which stops after `rulesToArray` and historically did **not** run `rulesToMask`.
`rulesToMask` is where the real engine performs several rule-level validations
(same-cell "can't overlap" check, RANDOM-on-LHS, ellipsis pairing/placement,
unlayered objects, etc.). Skipping it meant the analyzer would happily produce
`status: ok` facts for games the real engine rejects at compile time — vacuous
claims about a program that can never run.

**Resolution:** the static checker now runs a full-engine validation pass
(`validateCompileSource` in `src/canonicalize.js`, backed by the runtime's
`compileValidate`) on a throwaway state, and `analyzeSource` returns
`status: 'compile_error'` whenever it reports errors (`errorCount > 0`).
`compileValidate` runs every `loadFile` pass that can shape the
rule/object/win-condition model the analyzer reasons about — `rulesToMask`
(same-cell "can't overlap", RANDOM-on-LHS, ellipsis pairing/placement,
unlayered objects), `collapseRules` (the "can never overlap, rule can never
match" LHS check), `generateRigidGroupList`, `processWinConditions`, and
`checkObjectsAreLayered` — in `loadFile` order, on its own re-parsed state
(`rulesToMask` is destructive: it overwrites rule cells with `CellPattern`
objects, so it cannot run on the state used for analysis).

The gate deliberately **stops at `checkObjectsAreLayered`**. `loadFile`'s
remaining tail — `twiddleMetaData`, `generateLoopPoints`, `generateSoundData`,
`formatHomePage`, and `addSpecializedFunctions` — is **not** run. Those passes
only diagnose presentation, audio, and metadata (level dimensions, loop-bracket
pairing, sound declarations, homepage colors) or emit pure codegen; none of it
feeds the analyzer's model. Crucially, the real engine still **plays** a game
whose only errors come from them: such a game keeps `errorCount` within
`MAX_ERRORS` and `loadFile` returns a non-null state, so `compile()` reaches
`setGameState`. Rejecting on those diagnostics would therefore refuse games the
engine accepts and the analyzer can soundly analyze. So the gate's accept set is
scoped to the model-relevant passes — it is **not** "the engine emits zero
diagnostics" (the engine itself plays many games with non-fatal warnings/errors).

Verified across the bundled corpora (static_analysis_testdata + solver_tests +
demo, plus the runtime-contract corpus): no valid game is rejected (no false
positives) and no engine-invalid game was hiding in the corpus. The only test
games this gate newly rejected were two inline fixtures that had relied on the
missing validation (a same-cell overlap spawn in `ps_static_analysis_node.js`
and a same-layer `[ action Player Flag ]` match in
`static_analysis_adversarial_node.js`); both were corrected to engine-valid
sources.

This closes the gap described in the labs `rulesToMask` overlap audit (commit
`d0b19420`).
