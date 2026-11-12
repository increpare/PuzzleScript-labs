# Porting status

The independent headless OCaml port and its acceptance review are complete for
the pinned reference below. [AUDIT.md](AUDIT.md) records the feature and public API
review, component scope and explicit compatibility exceptions.

All port changes are isolated under `ocaml/`. Preserve the checkout's unrelated
uncommitted engine, upstream-sync and TypeScript changes. No existing engine,
oracle or expected board was changed by this port.

## Implementation and design

The state-machine follow-up addresses all eight surveyed areas. Structural rule
parsing lives in `Rule_parser` with explicit prelude/pattern/literal modes, row
builders, linked-group state and independent malformed-bracket depth. Level
reading has separate grid and line states. Object phases own their cursor/sprite
payloads. Binding search distinguishes completion from dead branches; loop-marker
matching uses named expected states while retaining positional error recovery.
Execution has settled/retry results with explicit rollback carry-over.

Session work is ready/AGAIN/victory, message continuations carry deferred actions,
and restart/win policy travels as evaluation context. The unused startup flag is
gone. `Player_control` owns orthogonal title/message/action protocols; named frame
steps retain their shared clock. CLI startup and observations are typed. README
records the resulting library observation API changes.

Validated UTF-8 byte traversal removes temporary scalar/string-list scans. A new
full-scalar probe matches the JS host over all 1,112,064 valid scalars for casing,
whitespace, identifiers and UTF-16, plus contextual casing. Five paired native
benchmark rounds on eight historical sources show median wall times of 2.190 →
0.580 s for parsing and 5.738 → 3.867 s for compilation, with 88.3% and 52.5%
fewer allocated bytes. Inputs, executables and every sample are retained in
`test/results/frontend-states-tQqIog/comparison-c0vcIW/report.json`.

The frontend craftsmanship review replaces textual rule qualifiers and header
lists with closed types. Source syntax, oriented rules, privately constructed
bound rules and executable domain rules are distinct representations. Bound
rules have concrete movement qualifiers and paired detection/replacement cells;
unresolved choices and mismatched shapes cannot enter lowering through their
constructor. The retained textual spellings belong to source recovery and
diagnostic rendering.

Parser orchestration now passes one immutable state through named transitions,
using reverse accumulators and a persistent published-name set. Metadata uses
explicit key/flag/value-fragment phases. Compiler orchestration delegates to
expansion, lowering, scheduling, win and sound passes. Cell lowering threads its
edge-gap/overlap progress explicitly. A compiler-owned diagnostic sink preserves
global limits; deferred loop attachment preserves observable emission order.
OCamlformat's checked configuration provides consistent layout throughout the
component. Core contracts additionally reject unresolved bound movements and
mismatched pattern shapes.

Source parsing, declaration resolution, property/movement binding, rule lowering,
deterministic/random groups, loops, ellipses, live tuple rechecks, movement, rigid
rollback, commands, speculative AGAIN, checkpoint, history, restart and automatic
wins/level progression are implemented independently.

The core uses variants, persistent sets/maps, private state records and explicit
effects. The API ownership review replaced exposed compiled arrays with opaque
`Frozen_array` storage: imported/exported arrays are copied, while immutable
records, maps and lists are shared. Objects, layers, levels and rule groups now
remain safe to share between sessions. Simple sound events are a closed domain
variant. Parser/compiler signatures hide staging helpers; compiled results are
private. Raw textual syntax remains explicit where name/keyword precedence is
contextual. `Compiler.source` accepts source text; the lower-level document
compiler assumes a document produced by the parser. Compiled levels contain domain cells rather than source strings. The
board indexes each object's coordinates with persistent sets; a required object
before a row's first ellipsis can anchor matching without changing scan order.
Unchanged edits share their board. Match products are lazy sequences, with
mixed-radix selection for random tuples. Opaque persistent RC4 snapshots retain
the reference's UTF-16 seeding and seven-byte draws.

Unicode casing uses Uucp 17.0.0, including contextual final sigma, with separate
UTF-16 name sorting. The source parser distinguishes physical blank lines from
comment-only lines, retains captured rule/win prefixes, and handles literal
message parentheses even after a glued arrow. `Source_sections` emits typed
physical-line events, and persistent declaration readers consume them in source
order. Layer lookup captures currently registered names; rules see only names
published by a `sounds` heading. Repeated sections preserve earlier declarations
and their publication timing. Glyph registration is separate
from final namespace resolution. Duplicate collision memberships retain their
allocated identities while layer sets use final ownership.
`Source_line` carries raw input and typed reading results: declarations, ordered
diagnostics and final comment depth. The section router no longer builds a
cleaned copy of section bodies. All section readers return authoritative comment
depth; the router handles only leading boundaries and heading/separator suffix
gates. Rule and sound bodies no longer require a second router-side scan.

Diagnostics are values, with optional locations and logical severity. Their
normalizer preserves order and deduplicates by line/severity/text; the legacy
error-counter quirk for unlocated warnings is explicit. Metadata reading and
screen-dimension recovery have a separate module. Fatal compilation preserves
earlier diagnostics instead of returning only its last error.
The global sixth-error boundary stops between source-token visits; the 101st
distinct diagnostic aborts immediately, including inside a token or compiler
stage. Readers receive the preceding diagnostic count, and compiler emission
uses one bounded accumulator. Deliberate reference diagnostic-limit aborts are
reported separately from unexpected exceptions and still require exact output.

Object reading now uses explicit name/alias/color/pixel states over raw physical
token visits, with its own nested-comment state and diagnostic ordering. Alias
declarations retain their individual registration lines; primaries and aliases
have separate typed fields. Pixel errors
retain their actual parsed prefixes. Compiler-stage asset checks are separate,
and integer-named declarations retain the reference's dictionary enumeration
order. Source references explicitly carry an optional board identity, source name and
optional layer: recovered lookup, glyph construction and movement-layer
selection no longer conflate those three meanings. Layer clears use actual
layer membership, preserving overwritten identity slots that remain writable.
Missing special names and empty level lists have diagnosed compiler recovery.
An empty object-identity space can survive accepted recovery: background is an
optional reference, glyphs produce empty cells, and no phantom array index is
introduced. Metadata reading retains physical comment visits and original-case
UTF-16 cursor behavior independently from captured values.

Legend reading uses explicit name/equals/member/operator phases and a persistent
source registry whose alias, property and aggregate entries have distinct OCaml
types. It reads raw physical visits, so invalid-token consumption stops at the
next opening comment and a terminal stray closer skips registration. A later
whitespace/comment visit can still finalize the pending declaration. Forward
references remain diagnosed, cycle-closing aliases are dropped,
and recovered prefixes, repeated members, mixed operators and cross-kind source
expansion follow registration order. Collision lookup uses the first registered
entry of each kind. Undeclared alias targets carry no board identity, unlike
declared unlayered objects' recovered identity zero when identities exist; invalid derived rule terms
are diagnosed and omitted. Property matching membership is built once in source
order, separately from final alternatives. A forward alias can therefore become
an alternative without changing that earlier matching membership.
Collision-layer reading also owns raw visits. An immutable pending record keeps
the active layer, earlier layers, current-line names and background flag separate.
Unexpected astral scalars produce two UTF-16 token errors and can stop between
their surrogate units at the source cap; the source decoder remains strict UTF-8.

Final name compilation now has separate alias, property and aggregate tables.
`Compiled_names` is opaque and uses persistent ordered maps plus explicit shared
compound slots, preserving insertion/numeric enumeration, expansion order and
alias promotion without exposing mutable arrays. Alias-to-alias changes alone do
not request another pass, matching the reference's observable stopping behavior.
Each consumer has its own view: rule binding uses final alternatives; concrete
matching requires all source-membership occupants while replacement retains the
actual identity; player input unions actual and final named members; win checks
use source membership; movement sounds expand final targets while create/destroy
sounds use source membership. Movement-layer predicates remain explicit even
when the matching object membership is empty. Random aggregates expand in source
term order and their random terms share one combined choice.

Win and sound inputs now have typed syntax variants. `Source_wins` validates
tokens with quantifier/subject/separator/target/excess states while retaining the
captured condition's permissive meaning. Raw win visits preserve warning/error
order, prevent capture after a leading stray closer and skip suffixes after a
captured comment. Capture and phase are immutable recursive arguments.
`Source_sounds` distinguishes initial
events/names, verbs, direction groups, numeric seeds, incomplete entries and
failed-line recovery. It consumes original physical lines with their initial
comment depth, so skipped finalization after a closing comment remains observable
and trailing whitespace can permit a later finalization visit. Error recovery
consumes tokens without registering suffix declarations. Compiler-stage recovered
seeds, missing-event warnings and last-definition simple sound events are modeled
separately. These readers stop at the sixth counted source error.
Sound visits also consume midline heading words without changing sections or
losing the pending verb/direction/seed phase. Their typed result includes final
comment depth. Empty fallback text produces a structured diagnostic, including
the two heading/comment cases where the pinned compiler instead throws before
diagnosing anything. The diagnostic audit keeps those exceptions nonzero;
separate recovery contracts specify candidate behavior without inventing a
completed reference result.

`Source_rules` now separates source-stage token validation and capture from
compiler-stage structural recovery. Cell builders use typed terms and an
optional pending qualifier rather than the reference's string-pair arrays.
Named terms and ellipsis items are separate syntax variants; an ellipsis retains
its recovered name when a malformed pending qualifier shifts token pairing.
Unknown names, malformed headers, duplicate qualifiers, misplaced commands and
brackets retain diagnosed recovery. Each recovered rule carries its source group
identity, preserving joins across early/late phases without inheriting the
parent's flags. Loop markers retain their source lines independently.
Standalone stray closers emit warnings in live-token order without becoming
unknown names; parentheses consumed inside a rule word retain their spelling.
Raw reading now carries an immutable captured-rule/live-phase record through
prelude, pattern and literal-message visits. The first character observed during
a visit remains distinct from the suffix exposed by heading consumption, which
preserves empty-word and punctuation recovery. Arrow matching uses the live
suffix. Captured source retains heading words independently of those visits;
original-case payloads use a Unicode-aware byte-boundary map. The reader owns
its final comment depth, including literal message parentheses.

Duplicate rules are identified before lowering loses source provenance. A
compiler-local identity retains the source line, normalized direction, terms,
commands and flags; a persistent set keeps the last occurrence in a group.
Separate source lines therefore retain their random weight, while equivalent
direction expansions from one line collapse. The interpreter still receives
only domain predicates and transactions, without this temporary source syntax.
Impossible alternatives survive through deduplication, then their discard
diagnostics reflect the remaining alternatives and group-wide conflicts. Empty
groups disappear before source loop boundaries are attached to the surviving
groups. Malformed loop markers have explicit diagnosed recovery.

`Rule_checks` validates and simplifies authored exclusions before expansion,
using source membership separately from final property alternatives and actual
object identities. Shared right-hand exclusions are removed before overlapping
row writes can erase each other's results. Required layer sets and ordered
occupiers determine redundant left-hand exclusions. After deduplication, the
first contradictory concrete cell discards its entire variant. Single-layer
properties remain predicates, so excluding one alternative does not discard the
others. Variant preparation now preserves source order across early/late phases;
group flags and loop bounds use the surviving variants.

Rule expansion, deduplication and lowering are now separate compiler stages.
Relative movements become absolute before reversing up/left rows. Lowering
checks detection cells in order, drops mixed/edge gaps and forbidden random
matches, and stops at the first contradictory concrete cell. A detection gap
ignores its mismatched replacement; a replacement-only gap clears its detected
objects, and mixed replacement cells retain only terms preceding their first
gap. Ordered replacement checks distinguish random/concrete conflicts and
singleton random warnings. Overlap discards, gap-count warnings and rigid-group
limits run in their observable compiler order across early/late phases.

`Rule_bindings` now owns movement and property inference. Its persistent work
queues preserve branch order and its typed evidence maps distinguish source
cells, attached name/qualifier pairs and unique-qualifier fallback. Movements
bind before property expansion can change names; relative parallel/perpendicular
provenance stays distinct from ordinary axis qualifiers. Properties infer local
replacements immediately and detached replacements only from unique evidence.
Unresolved properties drop their source variant; unresolved movements stop
compilation after both binding phases have retained their diagnostics. Spawn
stationarity is explicit in the bound syntax and considers negative terms'
source layers, rather than approximating that decision during runtime lowering.

`Source_levels` now owns physical-line reading, comment state, row/message
capture, source glyph validation and sixth-error stopping. Source rows retain
their locations and UTF-16 glyph units. `Level_compiler` writes columns before
filling Background; an invalid glyph returns only the preceding writes, without
filling or visiting later cells. Cropped suffixes remain independently checked
by the source reader. Messages retain literal parentheses after leading comments
and use legacy UTF-16 offsets and terminal wrapping. `Code_unit` keeps the
source decoder strict UTF-8 while representing isolated legacy units explicitly;
their compatibility text uses WTF-8 internally and JSON escapes on output.
Palette declarations are checked before sprite validation, while final text and
background colors are validated after the other compiler stages.

`Session` now distinguishes replay and interactive execution. Interactive
messages retain deferred wins/restarts; checkpoints load through checked typed
progress and skip startup rules. `Player` is a persistent controller with explicit
screen transitions, selected-message state, supplied frame time and ordered
logical storage effects. Title/message transitions can overlap after Escape,
and disabled restart cannot reset a waiting AGAIN timer. A fresh rule-message
effect resets acknowledgement independently of its text or sound definition.
The controller preserves the reference's frame ordering rather than subdividing
large time steps. Direction throttling shares a clock across fresh and repeated
presses and screen transitions. Numeric intervals use complete floating-point
conversion for large hexadecimal/binary/octal values, without intermediate
machine-integer overflow. `Player.start` and `Player.resume` are separate entry
points so saved data and an explicit initial level cannot conflict.
`Player.observe_progress` accepts actual host storage after failed writes or
external replacement, validating it without changing the session or clocks.
Stored values remain separate from an already loaded title continuation target.
The latter can survive removal of the checkpoint key and pair with a message
level. Loading that message emits startlevel/showmessage and preserves the
underlying board/history; title continuation then checkpoints the current board.
Host input-device polling and button-repeat scheduling remain
outside the interpreter.
The new metadata matrix also fixes advancement's viewport/recording boundaries.
Flickscreen resets the live viewport after progress/checkpoint persistence,
without rewriting the saved target's viewport; zoomscreen has no such extra reset.
`Clear_recording level` explicitly resets input/sound recording at its ordered
position while preserving undo, RNG and audible requests. It occurs on new-game
title confirmation and after title/message loads, before same-frame realtime
sounds. Traces now compare the recording's starting level as well as its sounds.
An initially empty underlying board can become a saved checkpoint when opening
a title message, so zero-by-zero snapshots are valid progress rather than an
unconditional error. Viewports remain bounded by those dimensions.

Adjacent ellipses have an explicit component contract: matching collapses them
to a single gap while retaining the compiler warning. This also prevents their
multiple equivalent partitions from biasing random candidate selection. The
pinned reference accepts these sources but throws while matching them. The
separate gap-runtime verifier checks authored fixed edits and single-gap
equivalence, RNG consumption and undo, then reproduces the reference fault.
Those results are never counted as adjacent-gap runtime parity.

Tools: OCaml 5.5.2, Dune 3.24.2, Uucp 17.0.0, Node 25.8.1 (Unicode 17.0).
The task's isolated development switch is `puzzlescript-ocaml`, under opam root
`/private/tmp/puzzlescript-ocaml-opam`; use explicit `opam exec --root ...
--switch ... -- dune ...` here. README documents a normal local switch setup.
Run Dune commands sequentially because they share a build lock. Its optional
global-cache warning in this sandbox does not prevent builds/tests.

## Verified evidence

All runtime comparisons pin vanilla
`7417d78a75b5a07402071e21e0c171a76ef8871d` and verify source hashes.

- `dune build`, `dune runtest` and `dune build @install`, through the switch,
  pass. Core contracts cover persistence, movement/undo, indexed scan order,
  invalid-name rejection, comment layout, metadata recovery and independent RNG
  vectors including supplementary Unicode seeds.
- Interactive contracts additionally check persistent message/time branches,
  invalid saved levels/identities/viewports, empty-checkpoint round trips,
  finite nonnegative elapsed time, throttle boundary persistence, compiled-storage
  ownership and negative RNG preview rejection.
- Interactive comparisons: **82/82 scenarios, 733 observations**, using the
  reference's pinned input/update functions with only rendering/device/audio-host
  boundaries stubbed. They cover message-deferred wins/restarts, checkpoint and
  cancellation effects, startup messages/checkpoints, title/new/continue paths,
  strict frame boundaries, empty messages, overlapping transitions, selected
  messages, disabled controls, AGAIN and realtime order. New throttle cases
  include fresh/repeated directions, cross-screen clocks, huge radix values,
  malformed numeric spellings and zero/negative/nonfinite intervals.
  Host-storage cases cover failed writes, external replacement while running or
  at the title, erased checkpoint keys and message-level continuation targets.
  New cases check flickscreen persistence order, zoomscreen differences, empty
  saved-board recovery, recording resets and startup/realtime sound boundaries.
- Interactive construction: **4,096/4,096 scenarios, 135,182 observations**,
  seed `ocaml-player-2026-11-06`, across ten rule families and 3,017 distinct
  source programs. Each scenario contains
  a complete source, initial level/title/saved-checkpoint state and generated
  press/repeat/frame/storage sequence. The verifier records every case, full state,
  effects, failures and construction hash without saving generated goldens.
- Interactive metadata construction: **4,096/4,096 scenarios, 188,440 observations**,
  seed `ocaml-player-metadata-2026-11-07`, with 4,096 distinct sources. It exhausts
  every combination of require-player-movement, startup rules, no-action,
  no-undo, no-restart, no-repeat-action and throttle flags across eight rule
  families and four interval/viewport profiles. Initial title/message/board
  states, checkpoints (including targets paired with messages), external storage
  and fixed/generated frame/button sequences vary independently. Full state,
  RNG, effects, viewports, recording levels and sound histories agree.
- Authored suite: **317/317 cases, 866 observations**. These are 203 shared cases
  plus 114 component cases. Independently authored final boards/sounds
  are checked in addition to per-operation differential observations.
- Generated exploration: **4,096/4,096 games, 28,691 observations**, with 4,039
  distinct source programs, seed `ocaml-interactions-2026-11-06`, indices 0–4095.
  Construction reuses the engine-independent source generator; candidate source
  compilation and gameplay are OCaml. No generated output is saved as a golden.
- Frontend exploration: **4,096/4,096 games, 28,573 observations**, with 4,096
  distinct sources, seed `ocaml-frontend-2026-11-06`, indices 0–4095. This adds
  sprites, compact declarations, whitespace/comments, aliases, Unicode seeds,
  run-on-start and other metadata to the complete generated games.
- Rule exploration: **4,096/4,096 games, 28,594 observations**, with 4,096 distinct
  sources, seed `ocaml-rules-2026-11-06`, indices 0–4095. Its four new families
  construct weighted joined lines, symmetric directions, Cartesian multirow
  candidates and negative/random spawning. Variations include aliases, commands,
  early/late groups, Unicode seeds, run-on-start, undo and restart.
- Binding exploration: **4,096/4,096 games, 28,620 observations**, with 4,060
  distinct sources, seed `ocaml-bindings-2026-11-06`, indices 0–4095. Four source
  families cover property transport, relative movements, copies and command-only
  evidence. Marker-based setup rules prepare independent source movements;
  variations include property order, orientations, concrete alternatives,
  aliases, random groups, commands, sounds, startup rules and replay.
- Paired recovery exploration: **4,096/4,096 compiler outcomes** agree, including
  acceptance, error count and ordered diagnostics. The **3,564 accepted games**
  also match through **24,948 replay observations**; **532 matching rejections**
  retain both full compiler observations and are counted separately. Seed
  `ocaml-recovery-2026-11-07` produces 4,074 distinct sources across eight
  declaration/recovery families, with 512 cases per family. Source order,
  comments and multiline restarts, Unicode/numeric names, repeated declarations,
  name publication, four orientations, layers, sounds, startup rules and replay
  vary together. A separate compiler-only run checks the same 4,096 sources.
- Historical gameplay: the complete indexed-runtime run matched **528/528
  cases, 20,083 observations**, with no rejections, timeouts or runtime mismatches.
  Five saved historical outcomes disagree with the current pinned oracle:
  Drop Swap 1–3, Expand/avoid the flames, and Sokoban in 3D. They remain visible
  and keep the verifier nonzero. No baseline was changed.
- Metadata: **111/111** constructed compiler comparisons match, including
  invalid dimensions, nonpositive values, decimal/exponent spellings, named and
  numeric palettes, prototype-like invalid names, full named/hex colors,
  superseded color values and diagnostic ordering/deduplication.
- Asset recovery: **26/26** constructed compiler comparisons match, covering
  color prefixes, blanks, partial/long sprites, duplicate names and numeric
  declaration order across compiler phases.
- Name resolution: **32/32** constructed compiler comparisons match, including
  simultaneous name kinds, numeric diagnostic order, shared compounds, alias
  promotion/stopping, recursive members, Unicode and keyword warning distinctions.
- Sound/win parsing: **81/81** constructed compiler comparisons match, covering
  event/verb/direction/seed boundaries, Unicode, partial seeds, duplicate events,
  invalid suffix consumption, sixth-error stopping, nested/multiline comments,
  early returns at line endings and permissive win-condition capture.
- Rule parsing/grouping: **403/403** constructed compiler comparisons match,
  covering compact syntax, headers, joins, qualifiers, unknown names, bracket and
  command recovery, duplicate names, impossible alternatives, loop boundaries
  and the thirty-rigid-group limit. An exclusion matrix covers source objects,
  single/multiple-layer properties, aggregates and aliases on either side,
  repeated exclusions, mixed phases and contradictory opening rules. Gap
  construction covers both sides, mixed cells, shifted qualifiers, orientation,
  edge gaps, neighboring/excessive gaps and recovery before group assembly.
  Replacement comparisons cover singleton random choices, ordered concrete and
  random conflicts, and diagnostic ordering across compiler phases.
  Binding comparisons add unique/local and detached evidence, missing or
  ambiguous sources, source orientation, relative qualifier provenance and
  movement-before-property diagnostic ordering.
- Levels: **58/58** constructed compiler comparisons match, covering source
  glyph registration, invalid/property/astral glyphs, casing expansion, ragged
  rows, whitespace, comment restarts, source capture versus validation, literal
  message parentheses, UTF-16 offsets, terminal wrapping and sixth-error stopping.
  Core contracts also check lossless JSON for a sliced surrogate and that a
  literal message parenthesis cannot consume the following grid.
- Section transitions: **374/376** constructed compiler comparisons match,
  covering heading suffixes/boundaries, duplicate/missing/reordered sections,
  leading comments and closers, metadata comment/value capture, collision lookup
  timing, name publication and the global sixth-error stopping boundary.
  Token-comment construction distinguishes a rule's captured prefix from live
  words containing parentheses and preserves object-token error spelling,
  per-alias registration lines, stray-close warning order and consumed headings.
  Global warning/error cases cover token-atomic errors, immediate diagnostic
  cutoff, duplicate headers and compiler-stage message/sprite/palette checks.
  Raw legend/layer/win visits additionally cover comment restarts, consumed junk,
  skipped finalization, captured prefixes, midline headings and astral-character
  token boundaries. Rule/sound visits cover consumed headings, newly exposed
  punctuation/arrows, literal message state and Unicode capture offsets. All 32
  deliberate reference diagnostic-limit aborts match exactly. The other two
  cases throw a pinned-compiler null-access TypeError before any diagnostic;
  both retain candidate and partial-reference observations in the report, and
  the diagnostic command remains nonzero. There are no process failures or
  mismatches between completed diagnostic outcomes.
- Source-fault recovery contract: **2/2 cases**, two compile observations and four
  replay observations. `Player move rules(ignored) 12345` in the sound section
  diagnoses an empty fallback, discards that sound and preserves ordinary
  push/undo/replay. `sfx0 12345 rules(` diagnoses the malformed suffix and missing
  collision section after its unclosed comment, returning a rejected compilation.
  Both reference sources reproduce `Cannot read properties of null (reading '0')`.
  These are explicit candidate contracts, not completed reference comparisons.
- Adjacent-gap runtime contract: **32/32 cases**, with **128 native observations**
  and 128 observations from valid single-gap reference programs. Four orientations
  cover zero/long gaps, multiple candidate endpoints, fixed and random groups,
  complete RNG state and undo/replay. All 32 adjacent-gap reference executions
  reproduce `cellRow[2].matches is not a function`. These cases are separate
  contract evidence, not reference runtime parity.
- Full diagnostic corpus: **370/370 match exactly**, with no process failures or
  oracle exceptions. Source-order reading, metadata comment recovery and empty
  identity handling close the twelve previous discrepancies.
- New authored cases exercise empty identities, late name registration and
  continuation of a collision layer after a leading stray closer. The latter
  proves changed background filling and collision behavior even when compiler
  diagnostics alone agree. A
  win/undo/replay case also verifies that raw replay still evaluates the saved
  board while the title screen suppresses additional win checks.
  Nine raw-reader gameplay cases independently check alias registration after a
  closing parenthesis or later comment, recovered equals signs, uncaptured and
  prefix-captured win conditions, astral layer errors, undo and replay.
  Six additional cases check sound event/direction phases after consumed headings
  and message payloads whose parentheses must preserve later rules and levels.

Observations include complete RNG permutations, raw current boards, full saved
boards/history (BLAKE2b-512 fingerprints in large corpus traces), checkpoints,
viewport, commands/messages, sounds, persistence and ordered events. Runtime
iteration-limit diagnostics are compared, including speculative turns. This
does not compare every compiler diagnostic or every internal execution field.

All results above have been checked on candidate SHA-256
`e5e199d9c71121dd8e6799f4e768247b4eda775c3eaca4b66494357e2e2326c6`.
The complete gameplay report is `test/results/run-6UChGw/report.json`.
[validation/latest.json](validation/latest.json) records the summaries and
source/report hashes. Do not infer a live process from a progress file alone:
poll the exact tool session or inspect the recorded PID. A timeout is incomplete
evidence, not a pass.

## Acceptance review

The former required recovery work is covered by the section/global-cap audits,
raw-reader regressions and paired construction above. Every reader owns body
comment state. Recovery construction combines declaration/cycle lookup, repeated
names, publication timing, Unicode and multiple name consumers, checking rejected
and accepted outcomes separately. Authored level/progression cases and the
interactive metadata matrix cover recovered levels, screen transitions and
continuation. Discovered runtime/frontend differences have authored regressions;
the final paired campaign found no additional candidate differences.

The public API review confirms owned compiled storage, private state records,
typed predicates/events, persistent boards/RNG and explicit textual recovery.
Core boundary checks include malformed UTF-8, board shape/coordinate errors,
RNG arguments and invalid replay levels. Interactive contracts check saved-state
validation and elapsed time. [AUDIT.md](AUDIT.md) states their preconditions and
the low-level Domain boundary.

No required implementation or review item remains in the established headless
scope. Further construction/fuzzing is ongoing maintenance; finite passing runs
do not prove agreement for every possible source. Rendering, synthesized audio,
editor integration and newer authority revisions are separate follow-up work.

`test/results/` is ignored. Each replay run snapshots executable bytes and game
sources and writes its own `status.json` and `report.json`. Convenience report
names may be replaced by later runs; per-run reports are authoritative. Reports
include binary hashes, authority, environment, construction provenance, counts
and all failures. Keep existing expected values and oracle files unchanged.
Interactive failure summaries point to individual complete trace files with
SHA-256 hashes. This keeps all failing cases inspectable when a campaign would
otherwise exceed JavaScript's maximum JSON string size. Progress records count
every case; neither failing cases nor observations are sampled away.
