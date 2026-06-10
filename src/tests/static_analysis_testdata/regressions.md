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
