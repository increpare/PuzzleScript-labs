# SemanticProgram Rules Representation Design

## Summary

Add resolved rules to the `SemanticProgram` contract as the **authored, pre-expansion** form — one entry per source rule line, structured into LHS/RHS rows of cells of `{dir, name}` terms, with directions/modifiers/commands, but with directions, properties, and aggregates **not** expanded. This is the highest-value, lowest-parity-risk altitude for rules, and it slots in alongside the existing slices (objects, collision layers, legends, levels, win conditions, metadata, sounds).

## Background: why rules are different from every prior slice

Every prior slice was a **projection over the already-lowered `Game`** — that data survives lowering. Rules do not:

- The C++ `Rule` (`native/src/runtime/core.hpp`) is fully compiled into masks, offsets, and runtime-matching metadata. The structured authored form exists only **transiently** inside `lowerToRuntimeGame`, as `ParsedRow`/`ParsedCell`/`ParsedItem` (`{dir, name}` terms), and is discarded after mask generation.
- On the JS side, `rule.lhs`/`rule.rhs` are already `CellMask[]` by the time they land on `state.rules`; the `[dir, name]` term structure is likewise consumed during parsing.

So **neither engine retains the structured rule form**. Both build it from the rule string and throw it away. A semantic rule representation therefore cannot be projected from the lowered output — it must be **captured at parse/lower time** on both sides.

Separately, the lowered rule form is **already JS↔C++ parity-tested** (`run_rule_plan_parity.js` / the `puzzlescript_rule_plan_parity` CTest), so the mask-level rule behavior is not unguarded today. This contract adds a *higher-altitude, human-comparable* rule form, not a replacement for that gate.

## Goals

- Represent rules at the **authored, pre-expansion** altitude: one entry per source rule line.
- Capture the structured rule form **off the runtime hot path** — the runtime `Game` stays byte-for-byte identical, so the solver/runtime carry zero extra cost.
- Reference objects/legends **by name** (no duplicated id-sets — resolution already lives in the objects/legends slices).
- Validate JS↔C++ parity via the existing corpus gate, the same as every prior slice.

## Non-Goals

- No expanded/post-expansion rule variants (direction/property/aggregate expansion). That count/order matching is the highest-risk parity surface and is already covered at the lowered level by `rule_plan_parity`.
- No re-implementation of rule matching or any change to the runtime `Game` / stepping / solver.
- No id-set duplication per term (the legends slice owns name→id resolution).
- No rules in `GameInformation` — the captured form is a separate lowering output.

## Contract shape

```text
SemanticRule {
  line_number: int,
  direction: string,         // as-written: "" (none) | up|down|left|right | horizontal|vertical | orthogonal
  rigid: bool,
  random: bool,
  late: bool,
  group_number: int,         // rule-group membership (the "+" grouping / early-vs-late split)
  lhs: [ Row, ... ],
  rhs: [ Row, ... ],
  commands: [ { name: string, arg?: string }, ... ]
}

Row  = [ Cell, ... ]                       // one bracket [ ... ] = a row of cells
Cell = { ellipsis: bool, terms: [ Term ] } // "..." cells carry no terms
Term = { dir: string, name: string }       // dir = modifier (">", "moving", "no", "stationary", "up", ...); name = object/legend name, lowercased
```

Rules are emitted in **source-declaration order** within the early-rule list, then the late-rule list (matching how both engines order them). Terms reference objects/legends by their lowercased name — the same names the objects/legends slices already validate.

## Source & capture mechanism (off the hot path)

The shared source of truth is the **rule string** (already in `ParserState`, parity-validated). Both engines structure it into `{dir, name}` cells; the contract captures that structure.

- **C++:** `lowerToRuntimeGame` already builds the `ParsedRow` structure per rule before expansion. It is changed to *optionally* emit the captured authored rules as a **separate output** (e.g. a `SemanticRuleSet` out-parameter, default null/skipped) rather than storing them on `GameInformation`. The runtime path passes nothing → no capture, no cost. `buildSemanticProgram`'s caller (the `--emit-semantic-program` / parity path) requests capture and threads the result into the contract.
- **JS:** the snapshot emitter produces the same structured form. Preferred source is the engine's own rule tokenization captured at the structuring point; if that is impractical, a dedicated rule tokenizer in the snapshot lib re-derives `{dir, name}` cells from the rule string. Either way it must match the C++ `ParsedRow` tokenization exactly.

This keeps the runtime `Game` unchanged (consistent with the modular-refactor design's "resolved model separate from RuntimeGame" intent).

## Parity approach and the real risk

The structure is easy; the risk is getting JS and C++ to **tokenize the rule string into identical cells/terms**:

- direction/movement modifiers per term (`>`, `<`, `^`, `v`, `moving`, `stationary`, `no`, `randomdir`, `action`, etc.),
- ellipsis (`...`) cells,
- the RHS "is this token a command (`sfx1`, `cancel`, `checkpoint`, …) or an object?" classification — the C++ lowerer has explicit `isJsBracketPostfixCommand` / `cellNameRefersToLegendOrObject` logic for exactly this, which the JS side must mirror.

The corpus parity gate (`semantic_program_parity_corpus_node.js`, 161 conforming games) stresses all of this automatically once both emitters produce `rules`.

## Phasing

The full target above is implemented in two slices, each its own plan + corpus-gate pass:

- **Slice 7a — rule skeleton:** `line_number`, `direction`, `rigid`/`random`/`late`, `group_number`, `commands`, and LHS/RHS **cell + term counts** (not term contents). Builds the off-hot-path capture mechanism, validates rule inventory + grouping + command parity, with no term-tokenization risk.
- **Slice 7b — term contents:** the `{dir, name}` cells themselves (ellipsis, modifiers, command-vs-object classification) — the tokenization-matching work, layered onto 7a's capture.

Object/movement-keyed sfx masks (the deferred half of sounds) remain a separate small slice and are unaffected by this.

## Testing

- Per-slice unit-test fixture in `compiler_semantic_program.cpp` (asserts live under the `#undef NDEBUG` guard) using sokoban's rules — e.g. the `[ > Player | Crate ] -> [ > Player | > Crate ]` rule's direction, group, cell/term counts (7a) and term contents (7b).
- The corpus gate auto-covers `rules` across the 161 conforming games once both emitters emit it.
- The existing `rule_plan_parity` lowered-rule gate is untouched and continues to guard mask-level rule behavior.
