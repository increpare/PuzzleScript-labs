# PuzzleScript in OCaml

An independent, headless source parser, compiler and interpreter for pinned
vanilla PuzzleScript, expressed idiomatically in OCaml. The implementation and
[acceptance review](AUDIT.md) are complete within this component's headless scope,
with explicit compatibility exceptions documented below. Its implementation
differences are useful for finding shared assumptions in the other engines.

The executable parses PuzzleScript itself. Node and the existing engines are
used only by development-time differential tests.

## Build and run

Tested with OCaml 5.5.2, Dune 3.24.2 and Uucp 17.0.0. Requires OCaml 5.2 or
later; Uucp provides maintained Unicode data. With opam initialized, a local
development switch can be prepared from the repository root:

```sh
opam switch create ./ocaml ocaml-system --deps-only
opam install ./ocaml --deps-only
```

Build and run from the repository root:

```sh
opam exec --switch ./ocaml -- dune build --root ocaml
ocaml/_build/default/cli/main.exe --seed example ocaml/examples/push.ps right undo right
opam exec --switch ./ocaml -- dune runtest --root ocaml
node ocaml/test/parity.cjs
```

Inputs are `up`, `left`, `down`, `right`, `action`, `tick`, `undo`, `restart`
and `advance`. Numeric inputs use vanilla's `0=up, 1=left, 2=down, 3=right,
4=action`. `--level N` chooses the initial level. Each operation and automatic
AGAIN continuation produces a JSON observation. Compilation emits a separate
record, including diagnostics for accepted recovery cases.
`--compact` omits the redundant named-cell rows; `--compile-only` reports
compilation without starting a session.
`--state-digests` fingerprints complete saved boards and history with BLAKE2b-512
for large replay traces. Ordinary traces show the saved boards directly.

The runner supplies subsequent level seeds explicitly as
`INITIAL_SEED:level:INDEX`. Library callers instead provide their own
`Session.environment`. An empty seed is rejected.

Interactive CLI traces use the same observations plus timing and pending-screen
state. `--title` begins at the menu, `wait:MS` advances one frame, `menu` returns
to the title and `repeat:action` supplies a held action event:

```sh
ocaml/_build/default/cli/main.exe --interactive --title ocaml/examples/push.ps action wait:301 right
ocaml/_build/default/cli/main.exe --resume --level 0 --resume-grid P.C# ocaml/examples/push.ps right restart
node ocaml/test/player-parity.cjs
node ocaml/test/player-parity.cjs --generated=4096 --campaign-seed=ocaml-player-2026-11-06
node ocaml/test/player-parity.cjs --metadata=4096 --campaign-seed=ocaml-player-metadata-2026-11-07
```

`--resume-grid` takes slash-separated glyph rows for a reproducible checkpoint;
`--resume` restores the supplied level without a checkpoint. Both select
interactive mode. Library callers pass typed `Session.progress` values to `Player.resume`;
`Player.start` starts an explicit level without competing progress arguments.
Interactive `storage:none`, `storage:LEVEL` and `storage:LEVEL:ROWS` inputs
report the host's actual saved values after failed writes or external changes.
They preserve the current board and clocks. `ROWS` uses slash-separated glyph
rows; the library equivalent is `Player.observe_progress`.

## Design

- Rule syntax uses closed `Qualifier.t` and `Rule_header.t` types. Raw words are
  interpreted at source reading; later compiler passes pattern-match on variants.
  `Rule_ir.Oriented` records orientation and normalized syntax. The private
  `Rule_ir.Bound` constructor rejects unresolved movements and mismatched shapes,
  pairing each detection cell with its optional replacement before lowering.
- `Parser` carries one persistent state through named section transitions.
  Declaration collections accumulate in reverse source order and are finalized
  at the document boundary; published names use a persistent set. Metadata's
  key, flag-suffix and value-fragment phases are descriptive variants.
- `Compiler` orchestrates named passes. `Rule_expansion`, `Rule_lowering` and
  `Rule_schedule` handle inference, transactions and grouping; `Win_compiler` and
  `Sound_compiler` own their distinct name-selection rules. An opaque
  `Compile_diagnostics` sink preserves ordered emission and immediate limits.
  Loop attachment has an explicit later phase to preserve diagnostic order.
- `Syntax` records authored declarations, rule syntax and locations. Text stays
  at the syntax boundary where keywords can also be declared names; resolved
  execution data uses closed variants, including simple sound events.
- `Frozen_array` owns immutable indexed storage for compiled objects, layers,
  levels and rule groups. Import/export arrays are copied, so callers cannot
  mutate a game shared by several persistent sessions.
- `Parser` consumes physical lines in source order. `Source_sections` routes
  headings through typed section events. `Source_line` supplies raw physical
  input and typed reader results with declarations, diagnostics and final comment
  depth. Every section reader owns its body comments; the router only handles
  boundaries and heading/separator suffix gates. Declaration readers retain state
  across repeated sections. `Source_metadata` keeps
  value capture and later lexical visits separate, including UTF-16 case offsets.
- `Source_objects` reads names, aliases, colors and pixels with explicit OCaml
  states over physical token visits. Active phases carry their object cursor and
  sprite progress; the awaiting-name phase retains an optional recovery owner.
  Each alias retains its own source line.
  `Source_assets` validates the retained data separately.
- `Source_legend` reads and recovers entries in order, using a persistent
  registry with typed alias/property/aggregate entries and explicit token phases.
  Raw visits preserve consumed junk, comment restarts and skipped end-of-line
  registration after a terminal stray closer.
- `Source_wins` separates token validation from captured win meaning, using
  typed quantifiers and targets. A leading stray closer prevents capture while
  later token errors remain visible. `Source_sounds` reads original physical lines
  with comment nesting and explicit event/verb/direction/seed states. Incomplete
  seeds and early returns at line endings remain explicit recovery data. Heading
  words consumed within a sound visit preserve the pending declaration phase.
- `Source_rules` separates live-token validation from structural recovery of
  captured rules, including ordered stray-comment warnings. `Rule_parser` owns
  structural prelude, detection/replacement and literal-message modes, with row
  and cell builders in their phase payloads. Bracket depth remains a separate
  recovery counter, including malformed nesting. Typed cell items distinguish named terms from ellipses, and
  cell builders retain pending qualifiers; recovered rules
  carry explicit source group identities. Impossible alternatives are discarded
  after deduplication, and loop bounds use the surviving groups.
  An immutable live state separates prelude, pattern and literal-message visits;
  raw capture retains original-case text through Unicode expansions. Heading
  consumption during a visit does not rewrite the captured rule.
- `Rule_checks` simplifies redundant exclusions before rule expansion and
  diagnoses contradictory concrete variants afterward. Property alternatives
  remain distinct from identities that must all be present. Expansion,
  deduplication and lowering are separate stages. Lowering recovers mismatched
  replacement ellipses, discards invalid detection gaps and checks ordered
  concrete/random replacement conflicts.
- `Rule_bindings` uses persistent work queues and maps of source-cell evidence.
  Search steps explicitly finish, expand or die; an empty property cannot be
  mistaken for a completed branch. Loop matching uses named expected-marker states.
  Movement inference precedes property expansion, keeping attached movements
  distinct from unique-qualifier fallback. Unresolved properties discard their
  source variants; unresolved movements retain all binding diagnostics before
  stopping compilation. Spawn stationarity uses source layer information,
  including exclusions.
- `Source_levels` captures rows and literal messages separately from live glyph
  validation. `Level_compiler` writes columns in order and retains a partial
  board when an invalid glyph stops compilation. Background filling occurs only
  after successful writes. `Code_unit` makes UTF-16 glyph widths and message
  offsets explicit; the JSON boundary preserves isolated surrogate diagnostics.
- `Compiled_names` normalizes each name kind in observable dictionary order.
  Shared compounds have explicit immutable storage slots; alias updates retain
  the reference's stopping behavior instead of computing a transitive closure.
- `Source_declarations` resolves source registration and final names separately.
  References retain source names, optional layers and optional board identities.
  A declared unlayered object can recover identity zero when board identities
  exist; an empty identity space remains explicit. An undeclared alias target
  has no identity. `Source_layers` resolves names when each layer is read, so
  later declarations cannot retroactively change it. Rule names are published
  on entering `sounds`, separately from final semantic name resolution. Property matching membership is also distinct from
  final alternatives, preserving source-order effects of forward references.
  Rule lowering, player input, wins and sound triggers use their own name views.
  Layer reading carries an immutable pending record across raw token visits;
  unexpected astral characters produce separate UTF-16 diagnostics without
  weakening UTF-8 source validation.
- `Compiler` resolves names, binds property and movement choices, and constructs
  explicit predicates and cell transactions. Explicit parser/compiler interfaces
  hide staging helpers and make compilation results private. `Compiler.source`
  is the entry point for untrusted game text; the lower-level document compiler
  expects a document produced by `Parser.parse`. Bare `Domain` records remain
  available as a low-level representation, without an invariant guarantee for
  caller-constructed games.
- `Domain` uses variants for names, directions, predicates, commands and edits.
  Movement-layer predicates are independent of object membership, including
  diagnosed concrete names whose matching membership is empty.
- `Board` is an abstract persistent map of coordinates to cells. Cells contain
  ordinary object sets and movement maps. There are no packed cell masks or
  generated match functions. Persistent object-position indexes narrow matching
  while preserving its original scan order.
- `Random_stream` exposes persistent, opaque RC4 snapshots. Its compatibility
  boundary reproduces vanilla's UTF-16 seed bytes and seven-byte uniform draws.
- `Execution` evaluates rules and resolves movement. Rigid retries retain their
  consumed random draws while restoring board state.
- `Session` returns a new state and a list of effects. Board history shares
  persistent snapshots; restoring a board does not restore the random stream.
  Public state records are private, so callers can inspect but cannot construct
  invalid execution/session records. Direct replay steps still evaluate an
  existing board on a title screen, while win checks require the playing screen;
  this preserves the raw replay behavior after final victory and undo.

`Session` defaults to immediate headless replay. Its `Interactive` mode defers
wins and retains the commands needed when a rule message is dismissed. `Player`
adds persistent interactive control: title selection, message acknowledgement,
strict 150/300/500 ms transitions, AGAIN/realtime frame order, action-repeat
barriers and saved progress. Time is supplied by the caller; no wall clock or
storage I/O is hidden in the library. Sound and persistence operations remain
ordered effects. The controller retains their logical stored values so returning
to the title can offer a newly saved checkpoint. `Player.observe_progress`
reports actual storage values without loading a board or emitting new effects.
The next title entry reads them; an already loaded continuation target remains
separate, including when storage removes its checkpoint key.

`Session.progress` contains a level index and an optional persistent board/viewport
snapshot. Loading validates the level, board dimensions, object identities and
viewport. It restores the supplied seed, skips startup rules for checkpoints and
preserves the previous state on error. Neither checkpoint nor undo snapshots
serialize RNG state. Saved progress can pair a message level with a board target.
Loading that message preserves the current underlying board/history; continuing
from the title saves the resulting board as the restart checkpoint. This can
produce a valid zero-by-zero `Board.empty` checkpoint, which may be restored
later. Viewport bounds and object identities are still checked.

`Clear_recording level` is an ordered effect for starting a new input/sound
recording at that level. It preserves undo history, RNG and audible requests.
Title confirmation can emit it immediately; title/message advancement emits it
after startup sounds, before later same-frame realtime sounds. Flickscreen
advancement resets the current viewport after saving progress; saved checkpoint
and restart-target viewports retain their earlier values. Zoomscreen checkpoints
keep their viewport through that boundary.

For example, after compiling a `game`:

```ocaml
let environment = Session.{ next_level_seed = fun level -> "game:" ^ string_of_int level }
let player, title_effects = Result.get_ok (Player.create game ~seed:"game")
let player, start_effects = Player.press game environment Player.Action player
let player, load_effects = Player.elapse game environment ~milliseconds:301. player
```

The host consumes each returned effect list. Button-repeat scheduling and device
input belong to the host. The controller applies movement throttling to repeated
and fresh direction presses, including its exact interval boundary and timing
across screens. Metadata intervals accept decimal and radix spellings without
imposing a machine-integer limit. Rendering, synthesized audio and editor UI are
outside this component.

Rule matching and writes remain ordered. Same-cell property references stay
as predicates where possible, preserving board-order live matches across their
alternatives. Cross-cell property transport uses explicit compiler bindings.
Vanilla's speculative AGAIN calculations have observable RNG/history effects;
these are modeled rather than replaced with Labs' cached-AGAIN behavior.
Unicode name handling uses full default lowercasing, including Greek final
sigma, without normalization or case folding. The verifier checks the Unicode
data version against its JavaScript host. Source glyph registration is separate
from final name lookup, preserving accepted alias-shadowing recovery.

## State protocols and library API

`Source_levels` separates grid construction from line scanning. A grid phase
owns its width and nonempty row builder; line phases distinguish starting a row,
validating its captured glyphs and ignoring an uncaptured suffix. Glyph lookup
uses a set built once per level block.

`Session.pending` distinguishes ready, pending AGAIN and pending victory. Restart
reentrancy and win suppression are explicit evaluation arguments; the unused
`level_starting` field is removed. Rule messages carry a typed continuation:
resume with a board/command win check, or restart after acknowledgement. The
execution message latch is opaque and independent of the displayed screen.

`Player_control` encapsulates title departure, message selection/closure and
the fresh-press barrier. Its message states include replacement while an old
close is pending. Named frame steps preserve the shared clock and title → AGAIN
→ message → victory → realtime order. Rigid execution returns settled/retry
outcomes; retry payloads specify the observations retained across board rollback.
The CLI resolves launch options into a typed request and uses typed observation
events.

Library callers should use these observations after the state-model changes:

| Previous access | Current API |
| --- | --- |
| `session.again`, `session.winning` | `Session.again session`, `Session.winning session` |
| `player.transition` | `Player.transition player` |
| `player.message_selected`, `player.ignore_held_action` | Corresponding `Player` observation functions |
| `execution.message` as text | `Execution.message_text execution`; `Execution.has_message execution` |
| `Rule_message text` | `Rule_message { text; continuation }` |

The CLI JSON observation schema retains its existing fields.

## Correctness evidence

The shared authored semantic suite has **203 cases**. Another 114 authored
OCaml cases bring the component verifier to **317 cases and 866
observations** against pinned vanilla revision
`7417d78a75b5a07402071e21e0c171a76ef8871d`: boards, complete random permutations,
sound history and audible requests, full history and checkpoint boards, viewport,
commands/messages, persistence, event order, level/screen and AGAIN state.
Authored final boards and sound expectations are checked independently
of OCaml/JavaScript agreement. The verifier also checks the authored recovery
diagnostics. The oracle host verifies its source hashes before execution.
The additional regressions cover independent layer sounds, left/up ellipsis
enumeration, literal and glued message parentheses, Unicode names/whitespace,
comment layout, captured source prefixes, aggregate Player input and recovered
references whose source layers differ from their board identities. One recovery
case explicitly checks two distinct identities displayed with the same name.
Seeded regressions also check that repeated source lines retain their random
weight, while equivalent direction expansions from one line collapse.
Legend regressions cover first-registration collision lookup, final alias lookup,
forward property membership and replay after recovering a rejected alias cycle.
Additional name regressions cover overwritten concrete membership, independent
movement-layer tests, contextual player/win/sound selection, alias pass stopping,
shared property expansion order and one combined draw for random aggregates.
Win/sound regressions check permissive captured targets and quantifiers, level
progression, last-definition event seeds, discarded lines, recovered nonnumeric
sound seeds and the observable effect of whitespace after a closing comment.
Rule regressions check unknown-name omission, invalid headers, qualifier and
command recovery, joins across early/late phases, empty message payloads and
loop bounds after impossible groups are discarded.
Exclusion regressions check overlapping row writes, partially excluded properties
and the group flags of surviving alternatives. Ellipsis recovery cases check
ignored replacements inside gaps, replacement-only gaps that remove detected
objects, retained prefixes of mixed replacement cells, discarded opening rules
and startup execution after discarding edge gaps. Binding regressions cover
transport before concrete-name expansion, discarded unresolved-property opening
rules, and action sounds after same-layer versus new-layer spawning. Level
regressions cover partial columns, skipped background filling, property and
astral glyph recovery, cropped rows and literal message comments. Runtime
iteration-limit diagnostics are compared as emitted effects, including on
speculative turns. Section regressions cover late name publication, collision
lookup before later aliases and accepted programs without board identities.
The latter retain empty cells and valid dimensions through undo/restart.
Raw-reader regressions additionally check discarded versus finalized aliases,
legend recovery after comments, suppressed win capture after a leading closer,
captured targets before comments and continued layer reading after astral errors.
Sound/rule visit regressions also check event and movement sounds after consumed
headings and literal messages that preserve following rules and levels.

This is evidence for those cases, not a claim of complete language coverage.
The broader historical simulation corpus can be exercised with:

```sh
node ocaml/test/parity.cjs --corpus

# Construct complete source games and compare without recording goldens.
node ocaml/test/parity.cjs --generated=4096 --campaign-seed=ocaml-interactions-2026-11-06
node ocaml/test/parity.cjs --generated-frontend=4096 --campaign-seed=ocaml-frontend-2026-11-06
node ocaml/test/parity.cjs --generated-rules=4096 --campaign-seed=ocaml-rules-2026-11-06
node ocaml/test/parity.cjs --generated-bindings=4096 --campaign-seed=ocaml-bindings-2026-11-06
node ocaml/test/parity.cjs --generated-recovery=4096 --campaign-seed=ocaml-recovery-2026-11-07

# Exact compiler outcome, error-counter and ordered diagnostic comparisons.
node ocaml/test/diagnostics.cjs
node ocaml/test/diagnostics.cjs --metadata
node ocaml/test/diagnostics.cjs --assets
node ocaml/test/diagnostics.cjs --names
node ocaml/test/diagnostics.cjs --events
node ocaml/test/diagnostics.cjs --rules
node ocaml/test/diagnostics.cjs --levels
node ocaml/test/diagnostics.cjs --sections
node ocaml/test/diagnostics.cjs --recovery=4096 --campaign-seed=ocaml-recovery-2026-11-07

# Separate runtime contract for accepted sources that crash the reference.
node ocaml/test/gap-runtime.cjs
node ocaml/test/source-faults.cjs
node ocaml/test/unicode.cjs
```

Parity and diagnostic commands accept an optional case-name substring. Results, rejected sources,
timeouts and mismatches are written to `test/results/`, which is ignored. Every
selected case is counted; each command exits nonzero on incomplete coverage
or a mismatch.
Diagnostic-limit tests record the reference's deliberate abort separately;
candidate acceptance, error count and complete ordered diagnostics must still
match. Unexpected reference exceptions remain failures.

An indexed-runtime run matches **528/528 historical cases** (20,083 observations),
and the original generated campaign matches **4,096/4,096 games** (28,691
observations). A separate frontend campaign matches **4,096/4,096 games** (28,573
observations), varying sprite data, compact declarations, whitespace, comments,
aliases, Unicode seeds and metadata while keeping complete source games.
A rule construction campaign matches **4,096/4,096 games** (28,594 observations).
It varies repeated joined rules, property/object aliases, symmetric directions,
multirow candidate products, negative matches, random spawning, commands and
early/late groups across four additional source families.
A binding campaign matches **4,096/4,096 games** (28,620 observations), covering
transport, relative movements, property copies and command-only evidence with
independently prepared source movements, aliases, random groups and replay.
Paired recovery construction checks **4,096/4,096 compiler outcomes** across
eight declaration families and 4,074 distinct sources. All **3,564 accepted
games** also match through **24,948 replay observations**. The **532 matching
rejections** retain both full compiler observations and are counted separately.
It combines comment/multiline restarts, Unicode/numeric names, repeated
declarations, cycles, publication timing, layers, sounds, startup rules and replay.
Five historical saved outcomes disagree with the pinned oracle and remain
failures even when OCaml matches that oracle. All **370/370 historical diagnostic
cases match exactly**; the constructed metadata,
asset and name-resolution audits pass **111/111**, **26/26** and **32/32**. Metadata
checks include screen dimensions, named/numeric palettes and final presentation
colors. The name
audit includes cross-kind declarations, numeric ordering, alias promotion, shared
compounds, Unicode and keyword warnings. A separate **81/81** sound/win audit
checks lexical boundaries, incomplete seeds, error caps, comment finalization and
captured-condition recovery. See [PORTING.md](PORTING.md) for the individual
results. A **403/403** rule audit checks token/structural recovery, grouping,
overlap discard diagnostics, loop boundaries, rigid-group limits and exclusions
across objects, properties, aggregates and aliases. It also covers malformed and
mismatched gaps, replacement conflicts and compiler-stage diagnostic ordering.
Binding comparisons cover unique/local evidence, ambiguous or missing sources,
relative provenance and movement-before-property error ordering.
A **58/58** level audit covers glyph registration, UTF-16 units, row recovery,
comments, literal messages, wrapping and source-error stopping. In the **376-case**
section audit, **374 compare exactly**. It covers heading boundaries, suffix gates, duplicates, missing and
reordered sections, name publication, comment transitions, metadata values and
global source-error stopping. Token-comment cases additionally distinguish live
rule words from captured prefixes and preserve object-token error spelling,
alias registration lines and stray-close warning order. The audit includes
32 exact diagnostic-limit aborts, covering source visits and compiler stages;
the warning cap stops inside a token while the error cap stops between visits.
Legend/layer/win cases preserve interleaved warnings and errors, comment nesting,
physical-line finalization, consumed heading words and UTF-16 stopping boundaries.
Rule/sound cases also cover heading suffixes consumed during a visit, literal
message mode and original-case capture. The remaining two sources crash the
pinned compiler with a null-access TypeError before producing diagnostics. They
remain visible in the audit, which exits nonzero. `source-faults.cjs` separately
checks **2/2 recovery contracts**, including continued play after a recoverable
sound error and structured rejection after an unclosed comment; these do not
count as completed reference comparisons.
These finite audits do not establish full frontend compatibility.
Interactive control additionally matches **82/82 constructed scenarios, 733
observations**, and **4,096/4,096 generated scenarios, 135,182 observations**.
The comparison executes the pinned reference's actual input/update functions
headlessly, including both pending transitions, selected-message state, precise
frame boundaries, complete RNG/history, effects and stored checkpoints. Cases
cover message-deferred wins/restarts, startup checkpoint recovery, title
continuations, overlapping dismissal, disabled actions and AGAIN/realtime
ordering. Throttle cases cover zero/negative/nonfinite intervals, huge radix
values, malformed spellings, fresh versus repeated presses and screen changes.
Storage cases cover failed writes, external replacement, saved versus loaded
targets, and continuation through message levels. Generated sequences also vary
storage observations while sessions are open.
An additional **4,096/4,096 metadata scenarios, 188,440 observations** exhaust
all 128 combinations of seven control flags across eight rule families and four
timing/viewport profiles. They include required player movement, startup rules,
disabled actions/undo/restart/repeat, throttling, flickscreen/zoomscreen,
message/checkpoint startup and storage replacement. Recording start levels and
sound-history boundaries are compared alongside complete game state.
OCaml contracts also check persistent branches, malformed saved state, invalid
elapsed time, immutable compiled storage and invalid RNG preview counts.
Generated scenarios do not become goldens.
Adjacent ellipses have a separately counted contract: they match as one gap,
including random candidate weights and undo, while compilation retains the
reference's warning. **32/32 contract cases, 128 native observations** match
independently checked single-gap behavior across four orientations, zero/long
gaps and deterministic/random groups. The same sources reproduce 32 runtime
faults in the pinned reference; these are recorded, not counted as parity passes.
Differential tests were run with Node 25.8.1; their Unicode data
must agree with Uucp's version.

Historical corpus traces use full saved-state fingerprints; authored fixtures
compare the saved boards directly. Historical expected-board disagreements
remain failures and are reported separately, while differential comparison
still runs against the current pinned reference.

Each run keeps an immutable executable/source snapshot and report; the printed
per-run report path identifies its exact candidate. Convenient latest-report
files may be overwritten. Progress records also identify the process and current
case, but process liveness must be checked independently.
Interactive failures keep complete traces in individual files, each hashed from
the summary report, so a large failing campaign cannot exceed one JSON string's
size limit. Status records count every completed case; no failures are sampled.

The completed [acceptance audit](AUDIT.md) maps the language/runtime features to
implementation and evidence. It also records API preconditions, storage ownership,
typed effects and the explicit reference exceptions above. Further source
exploration is maintenance; finite tests cannot prove agreement for every source.
Rendering, audio synthesis and editor UI are outside this headless implementation.

The Unicode probe independently compares lower/upper casing, ECMAScript
whitespace, identifier categories and UTF-16 encoding against Node across all
**1,112,064 valid scalar values**, plus contextual sigma/casing cases. Strict
malformed-input and invalid-suffix checks remain native core contracts.

## Frontend measurements

UTF-8 scanning now uses validated byte offsets and buffers, avoiding temporary
whole-suffix scalar/string lists. Full Unicode casing and strict validation,
including malformed suffixes after an accepted token prefix, are preserved.

Five paired rounds on this Mac compare immutable before/after native executables.
Each timed sample makes ten passes through the same eight historical sources
(199–91,573 bytes); file I/O and JSON output are outside the timer.

| Stage | Before median wall time | After | Speedup | Allocated bytes reduction |
| --- | ---: | ---: | ---: | ---: |
| Parsing | 2.190 s | 0.580 s | 3.77× | 88.3% |
| Source compilation | 5.738 s | 3.867 s | 1.48× | 52.5% |

These figures describe that source pack. The comparison records every sample,
source hash, executable hash and outcome signature in
`test/results/frontend-states-tQqIog/comparison-c0vcIW/report.json`.
The reusable driver is `test/frontend_bench.ml`; after building it, the saved
local comparison can be repeated with:

```sh
node ocaml/test/frontend-bench.cjs --baseline-record=ocaml/test/results/frontend-states-tQqIog/baseline.json --rounds=5 --iterations=10
```

Formatting uses OCamlformat 0.29.0 with the conventional profile and 90-column
margin. To install the development tool while retaining the recorded Unicode 17
baseline:

```sh
opam install --switch ./ocaml ocamlformat.0.29.0 uucp.17.0.0
opam exec --switch ./ocaml -- ocamlformat --check ocaml/lib/*.ml ocaml/lib/*.mli ocaml/cli/*.ml ocaml/test/*.ml
```

All existing engine and oracle files remain untouched by this port.
