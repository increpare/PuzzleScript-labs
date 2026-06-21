# PuzzleScript JS/C++ Modular Refactor Design

## Summary

Move the native (C++) PuzzleScript implementation toward one staged architecture with explicit, versioned contracts and a stable runner facade, while keeping the JavaScript implementation as the behavioral oracle and changing it as little as possible.

This is fundamentally a native architecture. The four native consumers — solver/generator, CLI, SDL player, and the PuzzleScript+MIS bridge — all sit on the same runtime and runner facade, so they converge naturally onto the staged pipeline. The JavaScript engine is the one pure-JS, canonical consumer: it stays a tolerant editor parser plus single-pass interpreter, and it participates in convergence only by emitting *contract shapes* for differential testing, not by being re-plumbed into the native stages.

Target native pipeline:

```text
Source
  -> Editor Parser / ParserState
  -> Semantic Builder / SemanticProgram
  -> Static Analysis / AnalysisFacts
  -> optional Canonicalizer / CanonicalProgram
  -> Lowerer / RuntimeGame + RuleIR
  -> Executor: interpreter | generated | fastest
  -> Runner API
```

Public execution modes are `interpreter`, `generated`, and `fastest`:

- `interpreter` is always available and is the baseline, the oracle, and the workhorse for normal embedding and human play.
- `generated` is the strict, full-kernel path. It fails loudly if the generated artifact is missing, stale, unsupported, or mismatched, and never silently falls back. It is the verification gate that keeps the code generator honest.
- `fastest` is the production accelerated path. Per game — and where applicable per rule group — it runs the fastest backend that has been validated equivalent against the interpreter oracle, and uses the interpreter where no validated kernel exists. Selection is precomputed, recorded, and observable.

The distinction that makes `fastest` sound rather than dangerous: selection is *verified and reported*, never a silent mid-turn degradation. Falling back to the interpreter for a statically unsupported construct is fine — it is a compile-time decision against the oracle. Falling back because a kernel *detected a runtime mismatch* is forbidden; that is either incompleteness to surface or a bug not to mask.

## Goals

- Make the native implementation a sequence of explicit, versioned, serializable stages with one stable runner facade for all native consumers.
- Keep the JavaScript engine the behavioral oracle, and keep changes to it deliberately light so it does not fork from the canonical handcrafted site engine.
- Converge JS and C++ at the level of *contract shapes* (so each boundary can be diffed), not by forcing the JS engine to adopt the native canonicalizer, lowerer, or generated machinery.
- Keep both parsers tolerant and editor-friendly, because the browser editor, the VS Code extension, and the MIS editor all need rich while-you-type information.
- Make canonicalization optional but compiler-accessible.
- Make static-analysis facts explicit, revision-scoped, and reusable by canonicalization, solver, generator, and codegen work.
- Replace the sprawling set of partial-compilation execution modes with three clear public modes: `interpreter`, `generated`, and `fastest`.
- Make the native core easy to embed standalone, so a consumer that only loads and steps runtime state does not pull parser/compiler symbols.

## Non-Goals

- Do not re-plumb the JavaScript engine into the native staging. JS materializes `ParserState` and a `SemanticProgram` *shape* for parity diffing as views over its existing compile; it does not run a canonicalizer, lowerer, RuleIR, or generated executor.
- Do not split a new subrepository in the first implementation slice.
- Do not make canonicalization mandatory for normal play.
- Do not expose *silent, on-mismatch, unmeasured* fallback as behavior in any public mode. A selected, oracle-verified, reported acceleration mode (`fastest`) is explicitly allowed and is the production default — that is not the prohibited behavior.
- Do not preserve compiled rulegroup, compiled tick, or specialized full-turn paths as separate public execution modes. Keep them as internal building blocks that `fastest` dispatches across and that the code generator emits; internalize them, do not delete them.
- Do not rewrite the current JS engine out from under the oracle tests before the new contracts prove parity.
- Do not solve the PuzzleScript+MIS transformation-language convergence in this slice.

## Architecture

### JavaScript Engine And Oracle

The current JavaScript parser/compiler/runtime remains the ground truth for behavior throughout the refactor, and it stays the canonical handcrafted interpreter that the public website ships. It is interpreter-only by construction — there is no codegen or generated executor in the browser — so the entire generated/`fastest` half of the native architecture simply does not apply to it.

The JS engine is kept light on purpose. Per the repository split, labs work graduates back to the canonical project only as small, manually reviewed, handcrafted patches. A staged rewrite of `compiler.js` would never graduate that way, which would fork labs-JS from the engine actually shipped — and that engine is the oracle. So the JS side converges by *emitting contract shapes*, not by adopting native staging:

- It exposes `ParserState` as it already does.
- It exposes a `SemanticProgram` *shape* derived as a view over its existing single-pass compile output, used only at the boundaries that are oracle-diffed.
- It does not gain a canonicalizer, a lowerer, a `RuleIR`, or a generated executor.

This keeps the JS engine a tolerant editor parser plus single-pass interpreter, recompilable on keystroke, while still letting every native stage be diffed against an equivalent JS shape.

### Contracts

Each native stage owns a versioned, serializable contract:

- `ParserState`: editor/parser output, source-oriented and line-aware. Shared shape; JS already produces it.
- `SemanticProgram`: resolved game model used by compiler-oriented stages. Native owns it as a live structure; JS emits an equivalent shape for diffing.
- `AnalysisFacts`: non-mutating facts tied to one exact program revision. Native-owned; JS may expose a subset where it already computes analogous facts.
- `CanonicalProgram`: deterministic normalized representation plus maps, hashes, and provenance. Native-only.
- `RuntimeGame` and `RuleIR`: executable runtime/codegen-ready representation. Native-only.
- `ExecutionTrace`: parity/debug trace emitted by runners and executors.

Transforms create new program revisions. Facts never silently survive across revisions. Mappings may survive transforms, but facts must be recomputed or explicitly remapped and validated.

### Editor Parser

Both the JS and native parsers stay tolerant and editor-friendly. They may collect name tables, section state, source locations, early diagnostics, and partial semantic hints because the browser editor, the VS Code extension, and the MIS editor need that information while the user types.

Parser output is not the final compiled game. It is the input to the semantic builder (native) or to the single-pass compile (JS).

### Semantic Builder

The native semantic builder consumes `ParserState` and produces `SemanticProgram`. It resolves objects, collision layers, legends, properties, aggregates, rules, commands, levels, win conditions, and metadata effects into a complete game model. This is the clean input for static analysis, canonicalization, lowering, and JS/C++ comparison.

The JS engine does not add a separate semantic-builder pass. It exposes a `SemanticProgram` shape over its existing compile so the native `SemanticProgram` can be diffed against an equivalent JS view.

### Static Analysis

Static analysis consumes one `SemanticProgram` revision and emits `AnalysisFacts`. It does not mutate the program. Facts may include rule/input relevance, object roles, solver hints, merge/cosmetic facts for canonicalization, feature inventory, and backend/codegen support facts.

Revision scoping is not bookkeeping for its own sake — it closes a real, recurring class of bug in this codebase, where facts computed against one program shape were reused after a transform (coalescing, canonicalization, cosmetic stripping) silently changed that shape underneath them. Making "a transform produces a new revision; facts must be recomputed or explicitly remapped and validated" a structural, test-enforced invariant turns those soundness bugs into something the type/contract layer prevents.

### Canonicalizer

Canonicalization is optional and first-class, and it is native-only. It consumes a `SemanticProgram` plus optional `AnalysisFacts` and emits a `CanonicalProgram`, maps, hashes, and provenance.

Dedup/data modes may be intentionally lossy. Compiler-facing canonical modes must preserve behavior. If canonicalized output is compiled, static analysis must be rerun on the canonical program before downstream solver/codegen/lowering stages use facts.

Normal compiler optimization is separate from canonicalization. It may precompute, simplify, or specialize only when user-visible behavior and object/rule identity are preserved. Dedup, cosmetic stripping, object merging, and family grouping belong to canonicalization profiles.

### Lowerer And Runtime Core

The lowerer turns `SemanticProgram` or an approved compiler-facing canonical program into `RuntimeGame` and `RuleIR`.

The runtime core owns immutable game metadata plus mutable state: stepping, messages, RNG, undo/restart, hashes, snapshots, and board inspection. Runtime-only embedding must not pull parser/compiler symbols. Concretely, `ps_compile_source` and its parser/lowerer dependencies move out of the runtime-only boundary, so a consumer that loads precompiled IR or a state snapshot and steps it — a shipped standalone game, a solver worker handed a cloned game — can link the runtime core without the compiler.

### Executors

Public execution modes are `interpreter`, `generated`, and `fastest`.

`interpreter` is always available. It is the baseline, the oracle, the debugging path, the normal embedding path, and the only path the JS website runs.

`generated` is the strict, full-kernel path. It requires a generated artifact that matches the source/runtime/schema/backend profile, and it fails loudly on a missing artifact, stale hashes, an unsupported program, a schema mismatch, or a backend/profile mismatch. It must not fall back. This strictness is the point: it is the verification gate, and it is the pressure that forces generated coverage to completion. Generated-kernel coverage (for example, native-kernel versus interpreter-bridge counts across the corpus) stays visible so incompleteness cannot hide.

`fastest` is the production accelerated path and the default for the solver, the generator, and the native player. Per game, and where applicable per rule group, it selects the fastest backend that has been validated equivalent against the interpreter oracle, and it uses the interpreter where no validated kernel exists. The selection is precomputed and recorded, and the interpreted fraction is observable.

The line between sound and unsound fallback is explicit:

- Selecting the interpreter for a statically unsupported construct is allowed. It is a compile-time decision, and the interpreter is the oracle, so it is known-equivalent.
- Degrading to the interpreter because a kernel detected a runtime mismatch or declined a state mid-turn is forbidden in `fastest`. That signals incompleteness to surface or a bug not to mask. Detected divergence is a failure, not a fallback.

The specialized rulegroup, compiled tick, and specialized full-turn backends are no longer public modes. They become internal building blocks that `fastest` dispatches across and that the code generator emits; they are internalized, not deleted, so the native speed advantage is preserved.

Oracle/debug mode may run the interpreter and a generated backend independently and compare results. That is a test mode, not fallback.

### Runner API

The runner facade is the stable integration surface for the CLI, the native player, tests, the solver/generator, and the PuzzleScript+MIS bridge. It exposes compile/load, execution-mode selection (`interpreter` | `generated` | `fastest`), backend-coverage reporting for `fastest`, state creation, stepping, undo, restart, serialization, board/metadata/sprite/color/audio inspection for front-ends, and trace/oracle hooks — without leaking parser/runtime internals to each consumer.

The JS website does not go through this native runner; it runs its own JS interpreter path. The runner facade is the native consumers' surface.

## Consumers

The architecture is judged by how well it serves each consumer.

- Solver and generator — best fit. `AnalysisFacts` as an explicit, revision-scoped contract is exactly the solver's world (dead-cell caches, region isolation, rule/input relevance). Canonicalization-as-explicit-stage serves generator scoring/dedup and canonical-solution replay. `fastest` formalizes the portfolio-with-per-backend-selection that the native solver already runs. This consumer is the strongest argument for the refactor.
- Native CLI and SDL player — good fit. The runtime/compiler decoupling lets snapshot/IR-loading embedders drop the compiler. Rendering and audio stay outside the pipeline, layered on the runner's board/metadata/audio outputs, keeping the engine renderer-agnostic. The CLI's compile/diff/trace/solve workflows are served by the runner's oracle/trace hooks.
- PuzzleScript+MIS bridge — good for compile/play. The runner facade is the adapter the bridge is otherwise hand-rolling, so the bridge can stop reinventing compile/diagnostics/snapshot/metadata plumbing. The transformation-language and generator convergence is deferred and not assumed solved by this slice.
- PuzzleScript website (JS) — kept light. Interpreter-only, recompiled on keystroke, re-plumbed into nothing. It participates only by emitting `ParserState` and a `SemanticProgram` shape for parity diffing, which protects it from forking off the canonical handcrafted engine that is also the oracle.

## Profiles

JS website play:

```text
parse -> JS single-pass compile -> JS interpreter
```

Normal native play:

```text
parse -> semantic -> lower -> interpreter   (or fastest where validated)
```

Generated validation (strict):

```text
parse -> semantic -> analyze if needed -> lower -> generated validation -> generated executor
```

Solver/generator:

```text
parse -> semantic -> analyze -> lower -> fastest (selected, verified, reported)
```

Canonical data:

```text
parse -> semantic -> analyze -> canonicalize -> hash/export
```

Canonical compile:

```text
parse -> semantic -> analyze -> canonicalize -> re-analyze -> lower -> interpreter | generated | fastest
```

Solver/generator profiles may opt into canonicalization, but that should be explicit.

## Native Library Shape

The native tree should move toward separately understandable modules:

- language/editor parser
- semantic builder
- static analysis
- canonicalizer
- lowerer/runtime core
- interpreter executor
- generated executor/codegen
- runner facade
- CLI/player/MIS/test consumers

`ps_compile_source` moves out of the runtime-only boundary. A consumer that embeds only runtime state loading/stepping should not need parser/compiler symbols.

The first implementation should modularize inside `PuzzleScript-labs`. A later extraction to a subrepository should wait until module boundaries, contracts, and build targets are stable.

## Testing

Add parity tests at each contract boundary:

- legacy JS parser snapshot vs JS `ParserState` vs C++ `ParserState`
- JS `SemanticProgram` shape vs C++ `SemanticProgram`
- JS/C++ `RuntimeGame` and `RuleIR`
- JS canonical output is out of scope (canonicalization is native-only); diff C++ canonical output against its own provenance/maps and re-analysis
- interpreter/generated/fastest execution traces

Keep existing JS oracle simulation and diagnostics corpora as behavioral gates.

Add invalidation tests proving stale `AnalysisFacts` cannot be reused after canonicalization or other transforms.

Add executor tests:

- `generated` (strict) succeeds only with a matching artifact
- `generated` fails on missing, stale, unsupported, or mismatched artifacts, and never falls back
- `fastest` selection is verified equivalent to the interpreter for every backend it chooses
- `fastest` reports the per-game generated/interpreted coverage split, so an unfinished kernel cannot hide behind the interpreter
- oracle comparison fails on any backend-vs-interpreter trace mismatch

Convert public partial-rulegroup tests into internal `fastest`-building-block coverage tests, or remove them if they no longer guard useful behavior.

Verify consumers through focused smoke tests:

- PuzzleScript+MIS bridge
- CLI
- native player/runtime
- solver/generator
- existing C++ CTest suite

## Migration Sequence

1. Document and stabilize the stage contracts from current JS/C++ exports.
2. Introduce `SemanticProgram` as the native post-parser contract, and add a JS `SemanticProgram`-shape emitter derived as a view over the existing JS compile (not a JS rewrite).
3. Refactor native emitters and JS exporters to compare `ParserState` and `SemanticProgram` shapes.
4. Make static-analysis facts revision-scoped and explicit, and add the stale-fact invalidation tests.
5. Promote canonicalization to a native compiler-accessible optional stage with provenance and maps, and re-analyze after canonicalization.
6. Split native build targets along module boundaries and move `ps_compile_source` out of the runtime-only API.
7. Introduce the three public executor modes. Make `fastest` the production default for solver/generator/native player; keep `interpreter` the default for normal embedding and the JS website.
8. Internalize the partial rulegroup, compiled tick, and specialized full-turn backends as `fastest` building blocks and codegen internals; remove them as public modes without deleting the code.
9. Add generated artifact validation, `fastest` selection verification, coverage observability, and oracle comparison gates.
10. Once the modular boundaries are stable, reassess whether the native core should move to a subrepository.

## Assumptions

- The JS engine stays light: it shares contract shapes for parity and does not adopt the native staging. Canonicalization, lowering, `RuleIR`, and generated execution are native-only.
- Static-analysis facts are immutable facts about a specific program revision.
- Dedup/cosmetic/merge transforms are canonicalization/data-profile behavior, not default play compilation behavior.
- `generated` (strict) is the codegen-completion gate; `fastest` is the production accelerated path; both rest on per-game, oracle-verified backend selection.
- Fallback is forbidden only in its silent, on-mismatch, unmeasured form. Selected, verified, and reported acceleration is allowed and is the production default.
- The specialized backends are internalized, not deleted, so the native speed advantage is preserved.
- The initial goal is modularization inside `PuzzleScript-labs`; extracting a separate subrepository can happen after the module boundaries and contracts stabilize.
