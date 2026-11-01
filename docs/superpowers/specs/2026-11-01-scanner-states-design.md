# Explicit source scanner states

This continues the approved frontend clarity goal. Replace the shared numeric
`tokenIndex` with the grammar concept it currently represents. Preserve the
pinned vanilla parser's visits, diagnostics, registration timing and stopping
cursor. This is a refactor, not a stricter grammar.

Use a small `source-scan-state.ts` module containing numeric phase enums and a
section-discriminated scanner state. The scanner retains its direct token
readers; there is no generic transition framework. Each section owns its phase:

| Section | Phases |
| --- | --- |
| Prelude | Key, FlagArguments, Value, ValueTail |
| Objects | Names, Aliases, Colors, Sprite |
| Legend | Name, Equals, FirstMember, FirstOperator, LaterMember, LaterOperator |
| Sounds | Head, EventSeed, Verb, DirectionOrSeed, Seed, End, Failed |
| Rules | Prelude, AfterPatternSeparator, MessageTail |
| Wins | Quantifier, Subject, On, Target, Excess |
| Levels | Start, Grid, MessageTail |

Sound states carry only the payload needed by their meaning: event token for
EventSeed, previous token for directional/seed/end diagnostics, and retained
event for event End. Remove the sound token-history array and its dead counter
increments. Failed recovery retains native's extra consumption in a seed visit.
An incomplete event can still register at a native end-of-line visit.

Keep durable object ownership, sprite rows and level-grid grouping separate from
line phases. Several physical lines can belong to one object or level. State
types must reject assigning an object phase to a rule section or reading an
event payload before a sound event has been recognized.

Physical line initialization, a logical start after a comment, and a native
end-of-line visit are different events. Name them and preserve their ordering.
Only physical starts clear legend/sound line work. Rules, wins and prelude reset
their phase when their logical body starts; object bodies advance colors/sprite
there. A comment does not universally reset a grammar. A terminal unmatched
close does not cause an invented end-of-line registration. Message tails disable
opening comments but still diagnose an unmatched close encountered first.

Describe headings with explicit name, kind and required predecessor. Both the
reader and scanner use that section vocabulary; do not derive meaning from enum
ordinals or array positions. Preserve consumption of a heading word before its
logical-start check, duplicate-heading diagnostics, ever-visited predecessor
semantics and LEVELS being terminal for heading recognition.

Reject two alternatives: renaming magic numeric constants would still allow
unrelated grammar modes to mix, while a general parser-state framework would
make this small language harder to follow. Use ordinary typed objects and direct
switches instead.

Validate with independent native comment/recovery cases, cap-adjacent visits,
negative TypeScript contracts, all existing source comparisons and a bounded
generated gameplay sample. Keep native producers and comparisons unchanged.
