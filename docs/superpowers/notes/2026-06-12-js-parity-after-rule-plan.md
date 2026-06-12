# JS trace replay after rule_plan parity

**Date:** 2026-06-12  
**Git commit:** `22d07b7cb7c0e0629f3a670d2109b4283884d842` (`fix(native-compiler): add rewrite/mixed coalescing for property rules`)  
**Prior baseline:** [2026-06-12-cpp-js-parity-baseline.md](./2026-06-12-cpp-js-parity-baseline.md) @ `c48a1ebd`

## Context

Native **rule_plan v1** parity reached **453/453** unique sources (`make rule_plan_parity_tests`, ~67 s). This note re-runs **`make js_parity_tests`** to see whether compile-time rule-plan fixes moved **JS↔C++ simulation trace replay**.

## Before / after (`simulation_tests_cpp_js_parity`)

| Metric | Phase 0 baseline | After rule_plan 453/453 |
|--------|------------------|---------------------------|
| Prepared session checks | 469/469 | 469/469 |
| Trace replay pass | **375/469** | **375/469** |
| Trace replay fail | 94 | 94 |
| Trace fast pass | 375 | 375 |
| Trace detailed runs | 94 | 94 |
| First detailed failure (index / name) | 33 — *unnecessary number of rules sokobond* | 33 — *unnecessary number of rules sokobond* |
| `make js_parity_tests` | **FAIL** (stops on trace replay) | **FAIL** (same) |
| Wall time (trace suite CLI) | ~77 s | ~15 s (aggregate printed; run exits non-zero on mismatches) |

## Related targets (same commit)

| Target | Phase 0 baseline | After rule_plan |
|--------|------------------|-----------------|
| `rule_plan_parity_tests` | FAIL (`ellipsisPropagationBug2`) | **PASS** 453/453 |
| `simulation_tests` | PASS 469/469 (JS + C++ corpus) | not re-run this session |

## Conclusion

**Trace replay did not materially improve.** Rule-plan JSON parity and runtime session snapshots diverge on a overlapping but not identical set of issues; fixing `movements_set_bits` / ellipsis propagation did not unlock the 94 replay mismatches (still led by sokobond rule-count semantics and orthogonal/perpendicular movement cases #682, #498, #496).

Next work likely targets **runtime lowering / rule application** (not rule_plan serialization alone).

## Commands

```bash
make build
make js_parity_tests    # trace_replay_passed=375 trace_replay_failed=94
make rule_plan_parity_tests   # 453/453 pass @ 22d07b7c
```
