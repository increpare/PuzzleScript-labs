# Authoritative sound and win syntax

This continues the approved frontend clarity goal. The scanner now has explicit
states, but sound/win meaning is still reconstructed from authored word arrays
in the reader and compiler. Remove both reconstructed grammars. Source visits
must produce one typed recovered interpretation, bound once to authored evidence
and consumed directly by compilation.

## Evidence and behavior authority

Four constructed examples have zero errors or warnings in the pinned native
parser yet disagree with TypeScript game-data compilation:

- `sfx0 sounds 123`: native consumes the midline heading word, retaining SFX0.
- `Player move rules 123`: native similarly retains the movement sound.
- `all Player (c) on Crate`: native captures only `all Player` for compilation.
- `(c)all Player on Crate`: native's unanchored capture starts inside the comment,
  so its captured quantifier defaults to Some rather than All.

Full sources, raw native registrations and differences are recorded in
`/private/tmp/ps-sound-win-baseline-probes.json`. These are TypeScript port
differences, not new upstream bugs. Native source/parser/compiler producers and
comparison strictness stay unchanged.

## Data model and ownership

Raw sound/win source entries retain their authored words and span. They own a
required recovered-definition field, with null explicitly meaning that native
source registration did not retain a definition. Remove the reader's independent
`readSound`/`readWinCondition` grammar, nullable pseudo-semantic field bags and
obsolete duplicate event-definition mirrors. Tests of authored-invalid input
must keep checking its source words without assuming it was accepted.

Use small numeric-discriminated definitions. Sound definitions distinguish
complete event, complete object/verb sound, bare event and bare target. Events
distinguish a simple event from an SFX index. Verbs and direction families use
numeric enums. Every accepted keyword/name/seed retains its exact lexical token,
including effective lowercase values and authored word identity. A seed is
either an actual numeric seed or an explicitly recovered last term: incomplete
verb/direction rows are retained by native and diagnosed during compilation.
Their last token becomes the effective seed; a last direction is consequently
excluded from the effective direction list.

Sound scanner states should carry the partial definition they have recognized,
not a second token history or an optional universal payload bag. Event and target
recognition, verb precedence, directional eligibility, seed acceptance and
rejection are settled during the existing native visits. Native end-of-line
paths alone retain definitions, including bare heads; failed or terminal-close
paths cannot be reaccepted by compiler guesses. The set of defined sound events
for rule parsing is derived from these same retained definitions.

Win definitions distinguish missing subject from a recovered clause. A clause
has a typed quantifier, its captured quantifier token, a required subject token
and an explicit Everywhere/Named target union. Exactly four captured words select
the fourth word as target, regardless of the third word; every other length
uses Everywhere. Unknown quantifiers recover as Some. Keep these recovery rules
in one small source-syntax helper. The scanner captures native's first unanchored
non-opening-parenthesis fragment of the complete normalized physical line only
when the actual win body receives logical SOL. It does not join text around
comments or invent registration after a skipped body start.

The reader binds accepted tokens to authored identities once. Compilation
switches over recovered definitions and performs domain name resolution and
diagnostics only; it never reads sound/win raw words, retokenizes source, searches
keyword strings or rechecks parser acceptance. Keep source diagnostics at their
existing visits and compiler diagnostics at their existing checkpoints.

Prefer a small sound-syntax/model module and a small win-syntax/model module
where they improve comprehension. Direct scanner branches remain direct; no
general parser framework or old numeric-mode adapter is introduced. Do not
preserve redundant public field shapes merely to avoid migrating local tests.

## Validation

The four new independent compiler comparisons must fail before implementation.
Add negative type contracts for missing event/target/seed payloads and mixed verb
or target variants. Add tests blocking raw-word/physical-source access during
compilation and modifying the recovered tree to prove it is authoritative.
Preserve malformed recovery, source-time namespace visibility, ASCII event
boundaries, seed spelling, duplicate ordering, Unicode source values and event
registration timing. Run focused tests, two-stage review, the full strict suite
and a bounded per-move differential sample. This completes the sound/win grammar
boundary only; property-layer analysis, rule-pass contracts and the final
transformation audit remain part of the active broad goal.
