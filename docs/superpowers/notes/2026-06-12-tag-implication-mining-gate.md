# Tag Implication Mining — Human Approval Gate (#11)

## Purpose

Tag implication mining may propose new cross-family consistency rules for
`static_analysis_consistency_audit.js`. Those rules must not land automatically.

## Process

1. Run a mining script (future) over corpus audit results or tagged reports.
2. The script produces `proposed-rules.json` with:
   - proposed rule description
   - support count (games where the pattern holds)
   - violation count (games where the pattern is broken)
   - example game labels
3. Stephen reviews and approves specific rules.
4. Approved rules are added to `static_analysis_consistency_audit.js`.
5. Optional: add a micro-fixture under `static_analysis_testdata/` for each approved rule.

## Out of scope (this plan)

- No automated mining script
- No automatic rule synthesis or CI enforcement of proposed rules

## Related work

- **#1** — consistency audit at scale (`make static_analysis_consistency_giant`)
- **#9** — original vs canonical static tag parity (`static_analysis_canonical_parity_node.js`)
