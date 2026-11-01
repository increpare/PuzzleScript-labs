# One accepted declaration path

Source registration is now typed, but its accepted records and expanded layer
memberships are discarded. `prepareDeclarations` independently reconstructs them
from authored words. Replace that second interpretation with a direct translation
of accepted records into canonical objects and final compiler inputs.

## Data flow

Record effective name tokens, recovered operand tokens and exact ownership when
registration occurs. An object alias belongs to the accepted primary object;
its physical token may occur on a sprite row or beside a rejected duplicate
header. Do not infer ownership from line numbers, normalized names or a scan of
every authored object's alias list.

Return accepted registrations and layer memberships from the source walk. Bind
their evidence once to the reader's existing SourceWord and SourceObject/Legend
identities, producing the document's authoritative accepted declaration model.
The reader does not reinterpret acceptance or expand compounds.

Compiler preparation constructs each canonical GameObject once and translates
stored memberships. Delete its second declaration lookup, registration, legend
recovery and recursive source-time expansion. Preserve empty layer positions and
member multiplicity. Native inherited lookup names never become canonical objects.

Carry numeric discriminated declarations through the compiler: aliases have one
target; properties alternatives; aggregates constituents. Remove the common
`values[]` representation and alias index-zero assertions. Final compiler name
normalization is a separate named operation because it intentionally has different
precedence, replacement and ordering rules. Mutable normalization receives copies.

Each accepted object also owns its own color tokens and sprite rows. Several
accepted primaries can belong to one malformed authored grouping; that grouping
cannot own a single shared asset definition. The compiler consumes assets from
AcceptedSourceObjectDeclaration, and obsolete raw definitionColors and
definitionSpriteRows mirrors are removed. A bound object alias's owner type
retains its bound source and accepted assets.

## Diagnostics and source evidence

Native source diagnostics remain synchronous at the current cursor visits, so
caps interrupt before the same mutations as before. A token recorded during a
failed visit is not evidence of successful registration. Compiler checkpoint
diagnostics retain their present order and counts.

Existing declaration-helper advice is separate from native compilation reporting.
Capture structured semantic facts with token evidence during the source visits
where needed to retain those helper codes. Do not replay native source errors
again during completion or rebuild the namespace merely to generate advice.

Preserve effective token values separately from authored normalized spellings,
including Unicode expansion/context. Binding must preserve existing authored
word and declaration identities, not fabricate lookalike source nodes.

## Behaviour fixes from making acceptance authoritative

Independent probes found these current compiler reconstruction discrepancies on
constructed malformed sources; these are TypeScript-port differences, not new
vanilla engine bug reports:

- `X = Player )` reconstructs an alias absent from the native registration stream.
- `X ? (c) Player` and `X ? (c) Player or Crate` omit registrations native accepted
  after parser recovery inserted its internal ERROR placeholder.
- A duplicate object header with a new alias can register that alias twice in
  reconstruction because authored ownership differs from accepted ownership.

Add direct native oracle coverage, preserving existing original corpus comparisons.
