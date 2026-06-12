# JS trace replay after layer-coupled movement runtime (Phase 5c-3)

**Date:** 2026-06-12  
**Git commit:** `7f741f6b5d23af7371dd552cd7adca5212799634` (`Implement native layer-coupled movement replacements (Phase 5c-3).`)  
**Prior notes:** [rule_plan only](./2026-06-12-js-parity-after-rule-plan.md) @ `22d07b7c`; [Phase 0 baseline](./2026-06-12-cpp-js-parity-baseline.md) @ `c48a1ebd`

## Context

After **rule_plan v1** reached 453/453 with **no** change in JS↔C++ trace replay (375/469), Phase **5c-3** landed native **layer-coupled movement** replacements in the runtime. This re-runs **`make js_parity_tests`** for authoritative trace replay counts.

## Before / after (`simulation_tests_cpp_js_parity` / `check-js-parity-data`)

| Metric | Phase 0 baseline | After rule_plan only | After 7f741f6b (5c-3) |
|--------|------------------|----------------------|------------------------|
| Prepared session checks | 469/469 | 469/469 | 469/469 |
| Trace replay pass | **375/469** | **375/469** | **392/469** |
| Trace replay fail | 94 | 94 | 77 |
| Trace fast pass | 375 | 375 | 392 |
| Trace detailed runs | 94 | 94 | 77 |
| First detailed failure (index / name) | 33 — *unnecessary number of rules sokobond* | 33 — *unnecessary number of rules sokobond* | **37 — *ortho test 1*** |
| `make js_parity_tests` | FAIL | FAIL | **FAIL** (exits on trace replay; `compilation_tests_cpp_32` not reached) |
| Delta vs Phase 0 trace pass | — | 0 | **+17** |

## Related targets (same commit)

| Target | Result |
|--------|--------|
| `make build` | PASS |
| `make simulation_tests_cpp` (64-bit direct sim, not trace replay) | **FAIL** — `passed=376 failed=93 total=469` (`turn_executor=interpreter`) |
| `make js-parity-data` | Not required for this improvement (no regression vs 375) |

## Conclusion

**Trace replay improved by 17 cases** (375 → 392), including *unnecessary number of rules sokobond* (index 33), which now passes fast replay. Remaining failures (77) are led by orthogonal movement (*ortho test 1*, index 37) and other detailed-diff cases. Direct C++ simulation corpus (`simulation_tests_cpp`) remains at 376/469 and is a separate axis from saved JS trace replay.

## Commands

```bash
make build
make js_parity_tests    # trace_replay_passed=392 trace_replay_failed=77 @ 7f741f6b
make simulation_tests_cpp   # passed=376 failed=93 @ 7f741f6b
```
