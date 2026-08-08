# Strict Thorough Solution-Cache Policy Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make host and cart thorough solution-cache gates hard-fail on every miss, and remove unused quarantine machinery.

**Architecture:** Flip runners/Makefile to strict fail; delete `cart_quarantine` tag + `--thorough-host-policy`; update the existing design spec and manifest counts. Force-interpreter bank-fit packing stays (build strategy, not a soft-fail tag).

**Tech Stack:** Python runners, Makefile, checked-in `manifest.json`, design/plan markdown.

---

### Task 1: Spec + runners

- [x] Update `docs/superpowers/specs/2026-08-06-cached-solution-replay-gates-design.md` for strict thorough policy
- [x] Remove `TAG_CART_QUARANTINE` from `scripts/solution_cache.py`
- [x] Hard-fail all cart misses in `scripts/run_gbc_cart_solution_cache_tests.py`
- [x] Remove `--thorough-host-policy` from `scripts/run_solution_cache_tests.py`
- [x] Stop preserving/counting `cart_quarantine` in `scripts/refresh_eligible_solution_cache.py`
- [x] Drop `cart_quarantine` from manifest counts; Makefile help + thorough target
- [x] Note retirement in `docs/superpowers/plans/2026-08-06-cached-solution-replay-gates.md`

### Task 2: Verify

- [x] `PYTHONPATH=scripts python3 scripts/solution_cache_test.py`
- [x] `make solution_cache_tests_thorough` → `hard_failures=0` (cart full rebuild not re-run; policy is code-only and prior cart gate was already green)
