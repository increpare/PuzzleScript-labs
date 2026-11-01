# Explicit rule property layer analysis

This continues the approved frontend clarity goal. Replace the encoded meaning
of `RuleVocabulary.singleLayerProperties`: present number, present undefined and
missing entry currently mean different domain cases. The property alternatives
live in a separate map, making consumers connect both representations.

## Model

`RuleVocabulary.properties` becomes `ReadonlyMap<string, RuleProperty>`, where
each property has required ordered `alternatives` and `layer` analysis. Remove
`singleLayerProperties`; do not retain a legacy getter or derived duplicate map.

Use a numeric `PropertyLayerKind` enum and discriminated `PropertyLayerAnalysis`:

- SingleLayer requires a numeric `layer`.
- Unlayered means all alternatives are known concrete objects without layers.
- MultipleLayers means known alternatives disagree, including a mixture of
  assigned and unassigned objects.
- Unresolved requires ordered `references` naming the alternatives not found as
  concrete objects. Do not confuse a final alias/property name with a raw concrete
  object merely because it eventually resolves to one.
- Empty means the normalized property has no alternatives.

Only SingleLayer carries a numeric layer. Unknown property lookup is ordinary
map absence; no present value is undefined. Empty and unresolved properties are
explicit rather than hidden in absence. Keep alternative order and duplicates,
integer-key dictionary ordering, colliding namespaces and alias normalization.
Construct this analysis once from final normalized names and canonical objects,
using a small named function rather than repeating tests in each consumer.

## Consumer behavior

Make each consumer state the cases it needs; there is no universal layer-zero
fallback hidden in a helper. Property inference keeps SingleLayer and Unlayered
properties local unless transported; other properties expand their alternatives
in the existing order. Empty expansion still removes an eligible choice branch
and erases negative terms. Unknown references remain explicit names for native
error recovery.

Early negative checking preserves native namespace priority. A SingleLayer
property claims its actual layer and supplies its warning label; an Unlayered
property contributes recovery layer zero without a numeric warning label. Both
collect the same raw concrete requirements as before. Other property cases fall
through to the existing concrete-name logic where namespaces collide.

Lowering gets a numeric property layer only from SingleLayer. Unlayered properties
remain missing-layer cases there; do not accidentally turn them into valid layer
zero predicates. Raw concrete unlayered recovery stays as it is. Random spawning
and implicit stationary analysis read the property's alternatives directly.

## Oracle boundary

Keep native producers and native expected projections unchanged. Adapt only
candidate projections to the new property record, validating its complete field
shape and numeric status discriminant. Reconstruct the native comparison view
at this test-only boundary: SingleLayer contributes its number, Unlayered an
explicit undefined value, other cases no native single-layer entry. Preserve all
old vocabulary, ordering, member and present-unlayered negative controls. Add
checks against independently inspected canonical concrete membership/layers for
MultipleLayers, Unresolved and Empty; corruption must not hide in the old absence.
Property-stage provenance checks still count expanded alternatives exactly.

## Validation and scope

Write negative type contracts first: reject missing analysis, a SingleLayer with
no number, numeric layer on Unlayered, missing Unresolved references and the old
singleLayerProperties field. Preserve semantic tests for duplicate alternatives,
all-unlayered, mixed assignment, unknown members, empty normalization, transported
and local properties, raw namespace collisions and native diagnostic timing.
Run focused checks, spec then quality review, full strict suite and a bounded
per-move sample. Preserve unrelated prepared-AGAIN runtime work. Rule-pass
contracts and the transformation audit remain later requirements of the active
goal; this change introduces no inference optimization.
