# Lean type-hardening T1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Boundary-only typed edges — `RuleDir`, typed `InputToken`, public Board/View helpers on `TileIdx`/`LayerIdx` — with no private Runtime loop rewrite; `make lean_parity_smoke` green.

**Architecture:** Newtypes/wrappers at public API; private Runtime keeps `Nat` and unwraps `.bits` / `.val` at call sites. Behavior unchanged.

**Tech Stack:** Lean 4.31, existing `lean/` Lake package.

**Spec:** [docs/superpowers/specs/2026-07-21-lean-type-hardening-next-proposal.md](../specs/2026-07-21-lean-type-hardening-next-proposal.md) §5 T1, §10.

---

### Task 1: `RuleDir` + IR/Rules

**Files:**
- Modify: `lean/PuzzleScript/Rules.lean`
- Modify: `lean/PuzzleScript/IR.lean`
- Modify: `lean/PuzzleScript/Runtime.lean` (`.bits` / `.val` at existing `rule.direction` uses)

- [ ] Add `structure RuleDir where bits : UInt32 deriving DecidableEq, Repr`
- [ ] `Rule.direction : RuleDir`; IR: `RuleDir.mk (UInt32.ofNat n)` (or from Nat bits)
- [ ] `ruleDirectionDelta` / `findRowMatches` unwrap `rule.direction.bits` (keep private helpers on Nat)
- [ ] `lake build`
- [ ] Commit

### Task 2: Typed `InputToken`

**Files:**
- Modify: `lean/PuzzleScript/Runtime.lean`
- Modify: `lean/ParitySmoke.lean` if it constructs tokens

- [ ] `inductive InputToken | move (d : Dir4) | action | undo | restart | tick`
- [ ] Update `parseMovementInputToken` / replay input parsing
- [ ] Update `executeTurn` movement branch to use `d.toBits` / action=16
- [ ] `lake build` + smoke
- [ ] Commit

### Task 3: Public Board TileIdx/LayerIdx wrappers

**Files:**
- Modify: `lean/PuzzleScript/Board.lean`
- Modify: `lean/PuzzleScript/View.lean` (use wrappers; keep wellFormed internals on Nat OK)

- [ ] Add `Board.cellObjWordsAt` / `cellMovWordsAt` taking `TileIdx` (thin wrappers)
- [ ] Optionally `getMovAt` already typed — ensure public surface prefers wrappers
- [ ] README one-liner for T1
- [ ] Full `make lean_parity_smoke`
- [ ] Commit

---

**Verification:** `cd lean && lake build` && `make lean_parity_smoke`
