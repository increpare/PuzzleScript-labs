# Static Analysis Regression Index

This file links duplicated family fixtures that belong to the same bug story.
It is not read by the test runner.

## Property Inferred Overwrite

`[ Thing ] -> [ Thing ObjA ]` must not treat `Thing` as preserved on the
`ObjA, ObjB` collision layer, because the explicit `ObjA` RHS term can overwrite
an initial `ObjB`.

- `object_tags/property-inferred-overwrite.*`
- `rule_tags/property-inferred-overwrite.*`
- `rule_tags/property-inferred-overwrite-win.*`
- `winflow/property-inferred-overwrite.*`
- `movement_action/property-inferred-overwrite-action.*`
- `runtime_contracts/property-inferred-overwrite.*`

## Overlapping Rule Rows

Cells in different rows of one rule can match the same board cell. The engine
matches every row first and then replaces row by row, so
`[ action Player ] [ Player ] [ no Player no Wall ] -> [ ] [ Player ] [ Player ]`
clears the player, puts it back and adds a second one. Count claims must not
net per-cell creates and destroys where an earlier coinciding cell really
changes an object that a later cell was counted from.

- `object_tags/quantity-overlapping-rows.*`
- `runtime_contracts/overlapping-rows.*`
