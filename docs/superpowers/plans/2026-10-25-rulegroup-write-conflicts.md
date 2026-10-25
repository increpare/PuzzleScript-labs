# Rule-group write-conflict analysis repair

The opposing-push reproduction churns for 200 passes even though the current
rulegroup_flow report has an empty interaction graph and claims single-pass
safety. Predicate enabling is insufficient: rules also interfere through reads
they invalidate and replacement results they overwrite.

- [x] Add regressions for opposing pushes, overlapping match tuples, implicit
  movement clears, sibling writes on the same layer, RHS randomness and independent
  deterministic groups. Observe the incorrect certificate before the repair.
- [x] Build a separate conservative group interaction graph using object effects
  and whole movement-layer effects. Keep winflow/program-flow wake graphs intact.
- [x] Separate split independence from first-pass convergence; keep multi-cell,
  dynamic and random effects conservative. Include output resources in group-skip
  invalidation, since an unchanged predicate can still need its output rewritten.
- [x] Check the related singleton rescan proof and reject conflicting fixed
  replacements at overlapping tuples without disabling compatible replacements.
- [x] Replace the old pusher fixture's incorrect claims; document all changed
  certificate meanings and retain human_verified metadata unchanged.
- [x] Run analysis fixtures, runtime regressions, canonical parity and existing
  MIS/solver consumers. Rebuild shared browser bundles and request a final review.

The canonicalizer continues preserving source groups. This repair changes
certificates and the related singleton optimization's eligibility, without adding
any new group splitting or broad runtime optimization.

Verification: focused 11-case regression under default and unconditional group
execution; make static_analysis_tests (including 473 runtime-contract cases);
794 engine simulation/error tests plus random replay, stale frontier and sparse
path checks; make mis_tests; static-analysis performance checks; MIS web build;
final code review. The native backend has no separate rulegroup_flow derivation
to port; native hints and MIS browser/worker bundles use the shared JS analysis.
