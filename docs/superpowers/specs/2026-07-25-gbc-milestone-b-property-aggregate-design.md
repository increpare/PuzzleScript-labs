# GBC Milestone B: property / aggregate bindings (specialized emit)

Status: Approved (unsupervised batch, 2026-07-25).  
Parent: [`2026-07-25-gbc-specialized-any-layer-coupled-codegen-design.md`](./2026-07-25-gbc-specialized-any-layer-coupled-codegen-design.md), [`2026-07-25-gbc-followups-batch-design.md`](./2026-07-25-gbc-followups-batch-design.md).

## Goal

Allow GBC export + specialized turn codegen for:

1. Rule-level `propertyBindings` / `aggregateBindings` (match-time capture).
2. Replacement-side `inferredAggregateBindings`, `inferredPropertyBindings`, `inferredPropertySources`, and layer-coupled replacements that consume aggregate captures.

Still **reject**: multi-row, ellipsis, rigid, random groups, `object_count > 32`, and inferred-aggregate sinks that reference a property name (desktop: `inferred_aggregate_property_bindings`).

## Non-goals (this pass)

- **Aggregate player** (`game.playerMaskAggregate`): keep export reject + `gbcSpecializedResolveEligible` false until a dedicated slim-player scan exists (documented remainder).
- Full property-inferred aggregate resolution (aggregate capture via property alias) — reject at `gbcReplacementDynamicAllowed` when `InferredAggregateBinding::propertyName` is set.

## Approach

Mirror desktop compact-turn:

| Phase | Desktop | GBC specialized |
|-------|---------|-----------------|
| Match apply loop | `emitCompactAggregateCaptureCode` before row apply | `emitGbcSpecializedAggregateCapture` before fused match/apply, using `start` + `delta` cell walk |
| LCMR aggregate sink | `aggregateCaptureIndex` on layer-coupled term | Extend `GbcSpecializedLayerCoupledTermEmit::aggregateCaptureIndex` |
| Inferred aggregate RHS | `compact_turn_pattern_apply` inferred-aggregate loop | Extend `emitCompactInlineGbdCPatternApply` |
| Property capture | `capturePropertyBindingsForTuple` + inferred apply | Emit minimal property capture stack vars when rule has `propertyBindings`; apply inferred property on objects/movements in pattern apply |

Exporter:

- Remove `validateRule` property/aggregate reject.
- Widen `gbcReplacementDynamicAllowed` to match `compactRuleUnsupportedReason` (allow inferred property/aggregate except property-named inferred aggregate).
- Pack binding metadata into `GbcSpecializedRuleEmit` / `GbcSpecializedPatternEmit` when building specialized tables.
- If a game needs bindings and specialized emit is off → fail (same policy as Milestone A).

## Fixture

`native/tests/fixtures/gbc_aggregate_binding.txt` — trimmed from good_games aggregate mechanics (`[ moving Box | Box ]`, `[ moving box topmarker ]`), 3-cell level, ≤8 objects, single movement lane.

## Verification

- `puzzlescript_gbc_exporter_tests` structural: fixture exports, specialized C contains `aggregateCaptures` / inferred-aggregate apply.
- Cull audit: `property_aggregate` first-fail count (baseline 0 under cull — games with bindings fail earlier on board/object_count; fixture + any newly unblocked titles).
- Rebuild: `cmake --build build --target puzzlescript_cpp puzzlescript_gbc_exporter_tests -j8`

## Remaining after B

- Aggregate player masks in export + specialized resolve/player scan.
- Property-named inferred aggregate sinks.
- `rhsPropertyPreserveMask` if any good_games still hit `dynamic_replacement` only for that bit.
