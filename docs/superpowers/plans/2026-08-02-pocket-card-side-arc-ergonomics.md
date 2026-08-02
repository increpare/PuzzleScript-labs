# Pocket Card Side-Arc Ergonomics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carve GBA-like side arcs into the pocket-card brick shells (volume reduction only) with keepout-driven radii, deferred lower posts, and optional PCB bottom rounding.

**Architecture:** Shared CadQuery cutter helper builds left/right corner crescents (box minus cylinder) with cosine fade along Y; both `shell_front` and `shell_back` cut their outer solids with it before `to_model_space`. Params own radii/fade/min-wall; `EXTRA_BOSSES` emptied for this pass.

**Tech Stack:** Python 3 + CadQuery (`.venv`), existing shell export path.

**Spec:** `docs/superpowers/specs/2026-08-02-pocket-card-side-arc-ergonomics-design.md`

---

## File structure

| File | Responsibility |
|---|---|
| `hardware/pocket_card/case/params.py` | `SIDE_ARC_*`, `PCB_BOTTOM_R`; defer `EXTRA_BOSSES` / lower-left mount |
| `hardware/pocket_card/case/side_arc.py` | **Create** — layout-space cutter solid |
| `hardware/pocket_card/case/shell_front.py` | `.cut(side_arc.cutters())` before model-space |
| `hardware/pocket_card/case/shell_back.py` | Same cut; PCB outline bottom radii |
| Order STLs | Regen front/back |

---

### Task 1: Params

- [x] Add `SIDE_ARC_R_L`, `SIDE_ARC_R_R`, Y span, fade, slice step
- [x] `EXTRA_BOSSES = ()`; drop deferred lower-left from `PCB_MOUNTS`
- [x] `PCB_CORNER_R` / `PCB_BOTTOM_R`

### Task 2: `side_arc.py` cutters

- [x] Crescent = corner box − cylinder along Y; left + right; faded R(y)
- [x] Smoke-import from shells

### Task 3: Wire shells + PCB outline

- [x] Cut both shells; bottom PCB fillet; regen STLs
- [x] `checks.py` treats empty `EXTRA_BOSSES` as deferred INFO
- [ ] Commit

### Task 4: Follow-up (not this PR)

- Re-place lower screw posts; tune R on feel print
- Regen KiCad outline/PCB if bottom fillet is kept (`build_pcb.sh`)
