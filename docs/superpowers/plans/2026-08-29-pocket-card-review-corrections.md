# Pocket Card Review Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the rear-bulge position, compound rear texture, U1 placement, and left PCB axial retention found during enclosure review.

**Architecture:** Keep the display-connector safety datum fixed while moving both visible rear shoulders south. Move rear texture generation from a finite flat Blender cutter into the CadQuery shell build, relocate and reroute U1 in the native KiCad source, and add one rigid front-shell stop opposite the existing rear battery-fence rail.

**Tech Stack:** Python 3.12, CadQuery/OCP, Blender 5.2 LTS, KiCad 10, unittest, GNU Make.

---

### Task 1: Correct the visible rear bulge

**Files:**
- Modify: `hardware/pocket_card/case/test_rear_profile.py`
- Modify: `hardware/pocket_card/case/params.py`

- [ ] Add a failing test requiring a 5.00 mm southward shift of the original upper-rise start and lower-plateau edge while preserving the plug-derived plateau start.
- [ ] Run `python -m unittest hardware.pocket_card.case.test_rear_profile -v` and confirm the new assertion fails against `46.8281 mm`.
- [ ] Derive the lower plateau edge from the required plug edge plus the 5.00 mm correction and recompute the lower tangent return.
- [ ] Rerun the rear-profile tests and commit the red-green change.

### Task 2: Make rear texture follow the actual shell

**Files:**
- Create: `hardware/pocket_card/case/test_rear_texture.py`
- Modify: `hardware/pocket_card/case/params.py`
- Modify: `hardware/pocket_card/case/shell_back.py`
- Modify: `hardware/pocket_card/case/emboss_shells.py`
- Modify: `hardware/pocket_card/case/test_emboss_shells.py`

- [ ] Add failing tests requiring texture-cutter volume in several rear Y bands and zero overlap with screw-seat keep-outs.
- [ ] Run the new test and confirm it fails because no compound-following texture API exists.
- [ ] Build a brick-mortar prism field, intersect it with the real outer 0.30 mm shell skin, cut it from `build_back()`, and disable the obsolete finite Blender back-texture Boolean.
- [ ] Run the texture, rear-profile, Blender finishing, and shell checks; commit the red-green change.

### Task 3: Add the left face-side PCB stop

**Files:**
- Modify: `hardware/pocket_card/case/params.py`
- Modify: `hardware/pocket_card/case/shell_front.py`
- Modify: `hardware/pocket_card/case/test_nut_traps.py`
- Modify: `hardware/pocket_card/case/checks.py`

- [ ] Add failing tests for the stop position, 0.20 mm PCB gap, PCB-outline coverage, and component clearance.
- [ ] Run the focused tests and confirm the feature is absent.
- [ ] Add the rigid stop and union it before final envelope clipping.
- [ ] Run the focused tests and full enclosure checks; commit the red-green change.

### Task 4: Move and reroute U1

**Files:**
- Modify: `hardware/pocket_card/case/test_closure_layout.py`
- Modify: `hardware/pocket_card/electronics/pocket_card_controller.kicad_pcb`
- Modify: generated PCB exports under `hardware/pocket_card/case/out/pcb/`

- [ ] Change the placement test to require U1 at `(41.3, 69.0)` and observe the expected failure.
- [ ] Move U1 in the native board, reroute affected nets, refill zones, and regenerate manufacturing and 3D exports.
- [ ] Run the focused placement test and full native KiCad validation; require zero errors and zero unconnected items.
- [ ] Commit the source move and regenerated PCB artifacts.

### Task 5: Rebuild and review the complete model

**Files:**
- Regenerate: `hardware/pocket_card/case/out/`

- [ ] Run the complete enclosure unit suite and `checks.py`.
- [ ] Run `make pocket_card_case` to regenerate PCB exports, shells, embossed meshes, buttons, and complete Blender assembly.
- [ ] Run the Blender complete-assembly verifier.
- [ ] Run `make pocket_card_captive_nut_review` and inspect all four PNGs, with particular attention to rear-bulge position, full rear texture, U1 centering, and the new left stop.
- [ ] Confirm `git diff --check`, review the scoped diff, and commit the regenerated release artifacts.
