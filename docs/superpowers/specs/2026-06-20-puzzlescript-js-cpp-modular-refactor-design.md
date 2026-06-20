# PuzzleScript JS/C++ Modular Refactor Design

## Summary

Refactor the JavaScript and C++ PuzzleScript implementations toward one shared staged architecture, while preserving the current JavaScript implementation as the behavioral oracle until the new contracts are proven.

Target pipeline:

```text
Source
  -> Editor Parser / ParserState
  -> Semantic Builder / SemanticProgram
  -> Static Analysis / AnalysisFacts
  -> optional Canonicalizer / CanonicalProgram
  -> Lowerer / RuntimeGame + RuleIR
  -> Executor: Interpreter or Generated
  -> Runner API
```

The refactor should produce a standalone native core usable by PuzzleScript+MIS, tests, solver/generator, CLI, and player runtimes. Public execution modes are only `interpreter` and `generated`. Generated mode must fail loudly if the generated artifact is missing, stale, unsupported, or mismatched.

## Goals

- Make the JS and C++ implementations converge around the same conceptual stages and data contracts.
- Preserve the existing JS engine as the behavioral oracle during the migration.
- Keep the parser editor-friendly instead of forcing a pure syntax parser that would weaken editor support.
- Make canonicalization optional but compiler-accessible.
- Make static-analysis facts explicit, revision-scoped, and reusable by canonicalization, solver, generator, and codegen work.
- Replace public partial-compilation modes with a simpler executor model: interpreter or generated.
- Make the native C++ implementation easier to embed as a standalone core library.

## Non-Goals

- Do not split a new subrepository in the first implementation slice.
- Do not make canonicalization mandatory for normal play.
- Do not expose generated-with-interpreter-fallback as a public execution mode.
- Do not preserve compiled rulegroups as a public execution mode.
- Do not rewrite the current JS engine out from under the oracle tests before the new contracts prove parity.

## Architecture

### Legacy JS Oracle

The current JavaScript parser/compiler/runtime remains the ground truth for behavior during the refactor. It may be wrapped by new exporters, but it should not be silently rewritten in a way that removes the ability to compare behavior against the historical engine.

### Contracts

Each stage owns a versioned, serializable contract:

- `ParserState`: editor/parser output, source-oriented and line-aware.
- `SemanticProgram`: resolved game model used by compiler-oriented stages.
- `AnalysisFacts`: non-mutating facts tied to one exact program revision.
- `CanonicalProgram`: deterministic normalized representation plus maps, hashes, and provenance.
- `RuntimeGame` and `RuleIR`: executable runtime/codegen-ready representation.
- `ExecutionTrace`: parity/debug trace emitted by runners and executors.

Transforms create new program revisions. Facts never silently survive across revisions. Mappings may survive transforms, but facts must be recomputed or explicitly remapped and validated.

### Editor Parser

The parser remains tolerant and editor-friendly. It may collect name tables, section state, source locations, early diagnostics, and partial semantic hints because the browser editor, VS Code extension, and related tooling need that information while the user types.

The parser output is not the final compiled game. It is the input to the semantic builder.

### Semantic Builder

The semantic builder consumes `ParserState` and produces `SemanticProgram`. It resolves objects, collision layers, legends, properties, aggregates, rules, commands, levels, win conditions, and metadata effects into a complete game model.

This is the clean input for static analysis, canonicalization, lowerer parity, and JS/C++ comparison.

### Static Analysis

Static analysis consumes one `SemanticProgram` revision and emits `AnalysisFacts`. It does not mutate the program.

Facts may include rule/input relevance, object roles, solver hints, merge/cosmetic facts for canonicalization, feature inventory, and backend/codegen support facts. If a transform changes the program, these facts become stale.

### Canonicalizer

Canonicalization is optional and first-class. It consumes a `SemanticProgram` plus optional `AnalysisFacts` and emits a `CanonicalProgram`, maps, hashes, and provenance.

Dedup/data modes may be intentionally lossy. Compiler-facing canonical modes must preserve behavior. If canonicalized output is compiled, static analysis must be rerun on the canonical program before downstream solver/codegen/lowering stages use facts.

Normal compiler optimization is separate from canonicalization. It may precompute, simplify, or specialize only when user-visible behavior and object/rule identity are preserved. Dedup, cosmetic stripping, object merging, and family grouping belong to canonicalization profiles.

### Lowerer And Runtime Core

The lowerer turns `SemanticProgram` or an approved compiler-facing canonical program into `RuntimeGame` and `RuleIR`.

The runtime core owns immutable game metadata plus mutable state: stepping, messages, RNG, undo/restart, hashes, snapshots, and board inspection. Runtime-only embedding should not pull parser/compiler symbols.

### Executors

Public execution modes are:

- `interpreter`: always available and used for baseline, oracle, debugging, and normal embedding.
- `generated`: requires a generated artifact that matches the source/runtime/schema/backend profile.

Generated execution must fail loudly on missing artifacts, stale hashes, unsupported programs, schema mismatch, or backend/profile mismatch. It must not silently fall back to the interpreter.

Oracle/debug mode may run interpreter and generated execution independently and compare results. That is a test mode, not fallback.

Partial rulegroup compilation is no longer a public execution mode. Generated rule helpers may remain as code generator internals, but external consumers must request only `interpreter` or `generated`.

### Runner API

The runner facade is the stable integration surface for CLI, player, tests, solver/generator, and PuzzleScript+MIS. It should expose compile/load, execution-mode selection, state creation, stepping, undo, restart, serialization, inspection, and trace/oracle hooks without leaking parser/runtime internals to each consumer.

## Profiles

Normal play:

```text
parse -> semantic -> lower -> interpreter
```

Generated play:

```text
parse -> semantic -> analyze if needed -> lower -> generated validation -> generated executor
```

Canonical data:

```text
parse -> semantic -> analyze -> canonicalize -> hash/export
```

Canonical compile:

```text
parse -> semantic -> analyze -> canonicalize -> re-analyze -> lower -> interpreter or generated
```

Solver/generator:

```text
parse -> semantic -> analyze -> lower -> solver/generator
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

`ps_compile_source` should move out of the runtime-only boundary. A consumer that embeds only runtime state loading/stepping should not need parser/compiler symbols.

The first implementation should modularize inside `PuzzleScript-labs`. A later extraction to a subrepository should wait until module boundaries, contracts, and build targets are stable.

## Testing

Add parity tests at each contract boundary:

- legacy JS parser snapshot vs refactored JS `ParserState` vs C++ `ParserState`
- refactored JS `SemanticProgram` vs C++ `SemanticProgram`
- JS canonical output vs C++ canonical output
- JS/C++ `RuntimeGame` and `RuleIR`
- interpreter/generated execution traces

Keep existing JS oracle simulation and diagnostics corpora as behavioral gates.

Add invalidation tests proving stale `AnalysisFacts` cannot be reused after canonicalization or other transforms.

Add generated executor tests:

- generated mode succeeds only with a matching artifact
- generated mode fails on missing, stale, unsupported, or mismatched artifacts
- oracle comparison fails on interpreter/generated trace mismatch

Convert public partial-rulegroup tests into generated-executor internal coverage tests, or remove them if they no longer guard useful behavior.

Verify consumers through focused smoke tests:

- PuzzleScript+MIS bridge
- CLI
- native player/runtime
- solver/generator
- existing C++ CTest suite

## Migration Sequence

1. Document and stabilize the stage contracts from current JS/C++ exports.
2. Introduce `SemanticProgram` as the clean post-parser contract.
3. Refactor JS exporters and C++ emitters to compare `ParserState` and `SemanticProgram`.
4. Make static-analysis facts revision-scoped and explicit.
5. Promote canonicalization to a compiler-accessible optional stage with provenance and maps.
6. Split native build targets along module boundaries and remove parser/compiler coupling from runtime-only APIs.
7. Collapse public executor modes to `interpreter` and `generated`.
8. Delete or internalize partial rulegroup compilation paths.
9. Add generated artifact validation and oracle comparison gates.
10. Once the modular boundaries are stable, reassess whether the native core should move to a subrepository.

## Assumptions

- Canonicalization remains optional but compiler-accessible.
- Static-analysis facts are immutable facts about a specific program revision.
- Dedup/cosmetic/merge transforms are canonicalization/data-profile behavior, not default play compilation behavior.
- Generated execution exists as a full executor path and should replace partial rulegroup execution as a public mode.
- The initial goal is modularization inside `PuzzleScript-labs`; extracting a separate subrepository can happen after the module boundaries and contracts stabilize.
