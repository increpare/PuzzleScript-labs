# Headless port acceptance audit

Reviewed 2026-11-07 against vanilla revision
`7417d78a75b5a07402071e21e0c171a76ef8871d`. The deliverable is an independent
OCaml source parser, compiler, interpreter and persistent interactive controller.
Rendering, synthesized audio, editor UI and device input remain host concerns.
The implementation emits sound requests and ordered persistence effects.

The headless implementation and acceptance review are complete. This is a
bounded engineering assessment with the exceptions below, not a proof that
every possible source program agrees with JavaScript. The executable has no
JavaScript dependency. Node is used by development-time comparisons only.

## Feature review

| Area | Implementation reviewed | Evidence |
| --- | --- | --- |
| Source structure | All seven sections, metadata, repeated headings, separators, physical blank lines, nested comments, original-case capture and ordered recovery | Historical diagnostics; section, metadata and asset audits; raw-reader authored regressions |
| Names and declarations | Objects, sprites, aliases, properties, aggregates, declaration order, cycles, numeric/Unicode names, publication timing and distinct per-consumer name views | Name audit; authored recovery cases; paired recovery construction |
| Rule compilation | Absolute/relative and movement qualifiers, negative terms, property/movement inference, multirow rules, ellipses, replacements, joined groups, early/late, random, rigid and loop boundaries | Rule diagnostic audit; authored cases; rule and binding construction |
| Execution | Ordered live matching and writes, overlapping transactions, group/loop repetition, movement, rigid rollback, random selection, all commands and speculative AGAIN | 317 authored cases; 528 historical replays; four campaigns of 4,096 generated games |
| Levels and text | Glyph registrations, background filling, recovered/ragged levels, UTF-16 compatibility text, level messages, wins and progression | Level audit; authored partial-level and progression cases; interactive construction |
| Sessions and controls | Undo, restart, checkpoints, menu/new/continue, messages, deferred victory, viewport, recording boundaries, repeat/throttle flags, frame timing and host-storage feedback | 82 focused scenarios; 4,096 interactive scenarios; 4,096 metadata scenarios covering all 128 combinations of seven flags |
| Sound requests | Simple events, movement/failure/create/destroy selection, directions, seeds, recording history and ordered audible requests | Event diagnostic audit; authored sound expectations; replay and interactive observations |

Paired recovery construction uses eight families: forward aliases, forward
properties, repeated aliases, repeated properties, cross-kind names, rejected
cycles, late publication and Player redefinition. Each family has 512 cases.
Comments, multiline restarts, whitespace, Unicode/numeric names, source order,
four orientations, layer/rule/sound consumers, startup rules, undo and restart
vary together. There are 4,074 distinct sources after removing their titles.
All **4,096 compiler outcomes** agree on acceptance, error count and ordered
diagnostics. All **3,564 accepted games** agree through **24,948 replay
observations**. The **532 matching rejections** are recorded separately with
both complete compiler observations; they are not counted as gameplay passes.

## OCaml design and public boundaries

The frontend craftsmanship pass has four concrete outcomes:

| Requirement | Current representation | Verification |
| --- | --- | --- |
| Typed qualifiers, headers and compiler stages | `Qualifier.t`, `Rule_header.t`, `Rule_ir.Oriented`, private `Rule_ir.Bound`, then domain transactions | Exhaustive compiler matches; core rejection contracts for unresolved movements and mismatched shapes; full parity rerun |
| Descriptive metadata states | `Key`, `Flag_suffix`, `Value_suffix`, `After_value`, `Extra_value` with an explicit fragment transition | Metadata and section diagnostics, including comment restarts and warning boundaries |
| Coherent parser orchestration | One persistent `Parser.state`, named readers/transitions, reverse declaration accumulators and a published-name set | Authored recovery, historical diagnostics, section construction and paired recovery campaigns |
| Readable compiler passes | Separate expansion, lowering, scheduling, win and sound modules; explicit lowering progress and compiler-owned diagnostics | Public pass signatures, unchanged diagnostic ordering, runtime traces and all campaign counts below |

`compiler.ml` now expresses phase order rather than implementing each task inside
one function. `Rule_compiler.prepare` and `finish` make the later loop-diagnostic
boundary explicit. `Rule_lowering` consumes paired bound cells, so it needs no
cross-pattern list indexing or shared mutable edge/overlap flags. OCamlformat
0.29.0 checks the component's conventional layout at a 90-column margin.

The subsequent state-machine survey is addressed across the frontend and runtime:

| Survey area | Explicit protocol now used | Evidence |
| --- | --- | --- |
| Structural rule parsing | `Rule_parser` modes carry side, row position and builders; join state carries the parent rule; malformed bracket depth is separate | 403 ordered rule-diagnostic cases; authored and generated rule/binding campaigns |
| Level reading | Between-level/grid builder states plus starting/checking/ignoring line phases; one glyph set per block | 58 level diagnostics, section recovery and authored partial-level cases |
| Session/controller | Ready/AGAIN/victory work, typed message continuations, evaluation context, opaque message latch, encapsulated title/message/action protocols and named frame steps | Both 4,096-case interactive matrices, 82 focused scenarios, replacement/overlap and deferred restart/win unit contracts |
| Object reading | Active phases own cursor/sprite data; awaiting-name state retains explicit recovery history | Asset/section diagnostics and source-recovery gameplay |
| Binding search | Finished/expand/dead-end outcomes preserve breadth-first order without a later empty-property filter | Binding diagnostics, authored cases and 4,096 binding games |
| Loop matching | Start-expected/end-expected states retain malformed-marker positional recovery | Rule diagnostics, including malformed/nested loop cases |
| Rigid retry | Settled/retry result with explicit carry-over and failed-attempt payload | Rigid authored cases, full RNG/effect/history replay comparisons |
| CLI | Typed launch requests and observation events | Compiler-only, replay, title/resume and interactive verifier entry points |

The obsolete `level_starting` field is removed. Public textual observations and
state queries use the functions listed in README's library API table. Ordinary
algorithmic counters, configuration flags and independent accumulated facts
remain ordinary data.

The efficiency review replaces allocating UTF-8 scalar-list scans with validated
byte traversal and buffered casing/spacing. Full-scalar validation compares all
1,112,064 Unicode scalar values against the oracle host's casing, whitespace,
identifier categories and UTF-16 encoding, plus contextual casing cases. Native
contracts ensure a malformed suffix is rejected even when prefix scanning stops
earlier. Five paired native benchmark rounds retain exact input/signature and
binary hashes: parsing uses 26.5% of baseline wall time and 11.7% of allocated
bytes; source compilation uses 67.4% of wall time and 47.5% of allocated bytes on
the eight-source pack documented in README.

The runtime uses domain variants, persistent maps/sets, immutable records and
explicit effects rather than packed JavaScript masks or generated functions.
Binding evidence and textual recovery belong to compiler modules. Resolved
predicates and transactions belong to the interpreter. Local mutation is
confined to builders and opaque owned storage; it cannot alter a previous
compiled game, board, session or RNG snapshot.

`Frozen_array` copies imported/exported arrays; its immutable elements can be
shared. Board and RNG representations are abstract. Execution, session, player
and compilation records are private. `Domain` deliberately remains a low-level
representation: callers constructing games directly must satisfy its invariants.

The public-input review confirms these contracts:

- `Compiler.source` and `Parser.parse` consume strict UTF-8. Invalid byte
  encodings raise `Invalid_argument`; valid source has structured diagnostics,
  including accepted recovery. `Compiler.compile` expects a parser-produced
  document. Compatibility text can retain isolated UTF-16 units, escaped at JSON
  output, without admitting malformed source encodings.
- Regular boards require positive dimensions and rectangular rows. Coordinate
  reads/writes check bounds. `Board.empty` is the explicit valid zero-by-zero
  saved snapshot. Low-level cell object IDs must belong to the game when using
  named output; saved progress validates them before loading.
- RNG seeds are nonempty, choice sizes positive and preview lengths nonnegative.
  A draw copies private permutation storage. Undo restores boards without
  rewinding the RNG.
- Explicit replay levels must exist. Progress restoration and storage feedback
  return typed errors for bad levels, object IDs and viewports, preserving the
  previous state. Message levels may carry a saved board target.
- Frame durations must be finite and nonnegative. Hosts supply time, direction
  repeat scheduling, storage results and subsequent level seeds explicitly.

Core tests exercise storage ownership, persistent branching, Unicode/text
boundaries, invalid UTF-8, bounds, dimensions, RNG arguments and invalid levels.
Interactive contracts exercise invalid progress, viewport/object validation,
empty snapshots, elapsed time and failed/external storage observations.

## Compatibility exceptions and evidence

Five historical saved outcomes disagree with the pinned JavaScript engine:
Drop Swap 1–3, Expand/avoid the flames and Sokoban in 3D. OCaml agrees with the
engine on all 528 replays. The historical verifier still exits nonzero for these
five golden disagreements; no expected values were changed.

Two malformed sound/heading sources crash the pinned compiler before producing
diagnostics. The section audit retains both partial reference observations and
exits nonzero: 374 completed comparisons agree, two reference exceptions remain.
Separate candidate contracts verify structured recovery/rejection for both.
The 32 deliberate diagnostic-limit aborts are distinct and match exactly.

Adjacent ellipses can compile in the reference and then crash during matching.
The OCaml runtime treats adjacent gaps as one gap. A separate 32-case contract
checks that choice, including random weights, RNG and undo, against valid
single-gap programs. These are explicit component contracts, not runtime parity
with the crashing sources.

[PORTING.md](PORTING.md) gives individual campaign counts and commands are in
[README.md](README.md). [validation/latest.json](validation/latest.json) pins the
executable, immutable reports, source hashes and unchanged shared fixtures.
Further fuzzing, performance work, additional hosts and newer reference revisions
are follow-up work; no implementation item from this headless review is deferred.
