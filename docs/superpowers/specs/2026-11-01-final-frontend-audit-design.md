# Final frontend domain and transformation audit

Complete the remaining approved frontend clarity checklist. Retained behavior
must have a conceptual explanation and independent evidence. A native optimizer
origin is not justification by itself; remove optional machinery and keep only
the behavior it made observable. Do not alter unrelated runtime prepared-AGAIN
work or expand into UI/rendering.

## Final domain cleanup

The independent whole-frontend audit identified a remaining rule-command hole:
the source SoundEffect command has number index, parser Number conversion and
projection `as SoundIndex`. Share the existing finite SFX0..SFX10 lookup with
the rule parser, type the authored index as SoundIndex and remove the assertion.
Keep contextual name precedence, source evidence, diagnostics and invalid SFX11
handling unchanged. Do not invent a second index validator or generated regex.

Remove the unused Message command `legacyPayload` mirror. Authored payload and
actual native compiler text already have separate honest roles; the unused
authored-or-space field can disagree with actual text under Unicode cursor
recovery. Keep authored payload/span evidence and actual text, migrating only
obsolete mirror assertions.

Metadata compilation repeats scanner vocabulary and rejects keys/empty values
again after source.accepted. Remove that duplicate acceptance filter: source
visits own acceptance; compilation owns dimensions and session/domain settings.
Keep raw authored metadata and actual native diagnostic checkpoints. Add a tree
consumption check proving a retained definition cannot be silently reclassified
by another private vocabulary.

Viewport coordinate parsing currently uses NaN as a private failed-result state.
Use explicit number|null results, while preserving actual numeric parsing rules,
32-bit validation bounds without bitwise coercion, all coordinate diagnostics,
their ordering and aggregate failure messages. Parse both coordinates even if
the first fails unless the reporter itself interrupts the visit. Preserve the
different nonpositive-versus-invalid recovery branches.

## Transformation evidence

Inventory each retained frontend transformation and explain its observable
effect, including rule selection/ordering, RNG assignment, live overlap,
diagnostics and source-invalid recovery. In particular establish witnesses for:

- Up/Left row normalization: it orders RHS edits and random draws, even where
  matching anchors are geometrically equivalent.
- Non-directional selector collapse: first selector versus later duplicate
  retention can select different traversal orders and random matches.
- Local property predicates: splitting one predicate into ordered concrete rule
  families can change which overlapping occurrence is processed first. Reuse the
  odd-level `interaction-matching/local-property-overlap` fixture as evidence.
- Duplicate normalization: duplicate rule candidates can change seeded random
  selection among board positions. Keep-last/source-group behavior remains explicit.
- Contradiction trimming/removal, aggregate/name normalization, movement/property
  inference, spawned-stationary behavior and schedules: distinguish source
  semantics and diagnostic/recovery behavior from optional shortcuts.

Tests may construct counterfactual typed game graphs solely to demonstrate that
omitting a transformation changes behavior. Such graphs are clearly labeled
experiments, never candidate oracle input or replacement native expected data.
The actual source fixtures must independently pass the unmodified per-move native
oracle. Counterfactuals compare actual board/RNG/effect results, not merely rule
array shape. Preserve full source/identity validation in baseline comparisons.

If a transform is optional and has no required observable behavior, remove it
with suitable behavioral validation. If its effect is necessary, name that effect
and document the witness instead of defending it as a performance optimization.
Keep runtime data and helper control flow simple.

## Completion gate

Run domain red/green contracts, independent transform evidence, focused checks,
then the full strict suite and bounded per-move campaign. Re-review the independent
whole-frontend findings after fixes and perform a final readability review.
Update actual pipeline documentation, historical exceptions and the finite goal
checklist. Integrate verified code into local master. Mark the goal complete
only after all required work is done and no substantive audit issue remains.
