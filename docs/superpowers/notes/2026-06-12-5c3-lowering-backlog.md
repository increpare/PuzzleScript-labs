# 5c-3 lowering backlog (native compiler)

## Landed in `ellipsisPropagationBug2` milestone

- **`computeAggregateCoalescingPlan`** (concrete-object inference path): mirrors JS Phase 7B-2b safe-set + cross-cell sinks for direction aggregates (`horizontal`, `vertical`, …).
- **`expandConcretizeMovingRows` safe-set gate**: skips Cartesian split when an aggregate is coalesced (preservation or single-LHS inference).
- **`rulesToMask` parity slice**: LHS omits `movementsPresent` for safe aggregates; RHS skips direct `movementsSet` for preserved / inferred sinks; inferred sinks keep `movementsLayerMask` (suppress implicit object-write layer-mask clearing).

## Still deferred (full 5c-3 / trace-replay parity)

- **`anyMovementsPresent` on `Pattern`**: runtime match path still uses `movementsPresent` only; rule-plan export is empty for safe aggregates but engine matching needs the JS `anyMovementsPresent` OR-mask path.
- **`inferredAggregateBindings` on `Replacement`**: rule-plan JS oracle counts `touches_movements` from bindings; native CLI does not serialize bindings yet. Runtime replace must OR captured aggregate bits at sink layers.
- **`aggregateBindingsArr` / `aggregateCaptures`**: match-time capture window between match and replace (engine.js Phase 7B-2b).
- **Phase 5c-1 / 5c-3 property inference**: `inferredPropertyBindings`, `inferredPropertySources`, `layerCoupledMovementMasks`, `layerCoupledMovementReplacements`, `propertySinks`, `propertyBindingsArr`.
- **Phase 5c-4**: aggregate + layer-coupled property composition (`safePropertyAttachments`).
- **`classifyForceAlwaysRun` / slots [14–18]**: post-A.1 rule-group pruning (`readMovements` / `writeMovements`).

## Unmasked pre-existing rule-plan gaps

- **`late beginloop/endloop test` (testdata index 20)**: native emits duplicate identical `replacements` entries (cell 0 + cell 1) where JS emits one; was hidden while parity stopped at `ellipsisPropagationBug2`. Not introduced by the aggregate-coalescing slice.
