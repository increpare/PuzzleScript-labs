# Pocket Card Rear Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Translate the visible rear bump 5 mm south and restore the measured legacy partial brick band with its PuzzleScript-logo medallion.

**Architecture:** `params.py` records the translated broad-profile stations and measured legacy artwork dimensions. `side_arc.py` builds one broad translated deck whose real rise clears the fixed connector without another feature, while `shell_back.py` projects the legacy Boolean composition through the compound rear skin. Existing Blender finishing continues to retire the obsolete flat cutter.

**Tech Stack:** Python 3, CadQuery/OCP, unittest, Blender 5.2 LTS, GNU Make.

---

### Task 1: Lock true bump translation and real connector clearance

**Files:**
- Modify: `hardware/pocket_card/case/test_rear_profile.py`
- Modify: `hardware/pocket_card/case/params.py`
- Modify: `hardware/pocket_card/case/side_arc.py`
- Modify: `hardware/pocket_card/case/checks.py`

- [x] **Step 1: Write the failing profile contract**

Require `DECK_PLATEAU_Y0` to equal its plug-derived reference plus
`DECK_BUMP_SHIFT_Y`, require `DECK_RISE_RUN` and `DECK_RISE_PHI` to retain the
original `12.3469296383 mm` / `22 degree` values, and require the connector
coordinate to remain on that broad transition rather than a local full-depth
feature.

- [x] **Step 2: Verify RED**

Run:

```bash
python -m unittest test_rear_profile.RearDeckProfileTest -v
```

Expected: the plateau-start and rise-shape assertions fail against the anchored
`39.3281 mm` / compressed `7.3469 mm` implementation.

- [x] **Step 3: Implement the translated broad profile**

Derive `_DECK_REQUIRED_PLUG_Y0` and `_DECK_REQUIRED_PLUG_Y1`, set both plateau
edges to the corresponding reference plus `DECK_BUMP_SHIFT_Y`, and derive the
rise start from the translated plateau start minus the original reference run.

- [x] **Step 4: Prove the translated rise clears the connector**

Use the existing assembled mated-plug and cable collision volumes at every
`+/-0.3 mm` X/Y placement extreme. Require zero intersection without adding a
local tongue, blister, or anchored plateau.

- [x] **Step 5: Replace the obsolete global-plateau assertion**

Keep the real plug/cable collision volumes in `checks.check_display_plug()` and
replace its obsolete analytic “whole footprint inside global plateau” check
with a direct assertion that the broad crest moved to `44.3281 mm` and the
connector remains on the translated rise.

- [x] **Step 6: Verify GREEN and commit**

Run the focused profile tests and `checks.py`, then commit the source and tests.

### Task 2: Restore the legacy partial brick/logo composition

**Files:**
- Modify: `hardware/pocket_card/case/test_rear_texture.py`
- Modify: `hardware/pocket_card/case/params.py`
- Modify: `hardware/pocket_card/case/shell_back.py`

- [x] **Step 1: Write the failing artwork contract**

Require cutter volume at layout Y 50/65/78 mm, no cutter at Y 15/35/90 mm,
zero cutter in the annulus between the 18.70 and 15.59 mm circles, positive
medallion cutter away from the logo, and zero cutter throughout the five-row
logo prism.

- [x] **Step 2: Verify RED**

Run:

```bash
python -m unittest test_rear_texture.RearTextureContractTest -v
```

Expected: the current full-rear field fails the out-of-band assertions and has
no medallion/logo-negative contract.

- [x] **Step 3: Implement the measured Boolean composition**

Constrain the running-bond grid to `REAR_TEX_Y0..REAR_TEX_Y1`, cut the outer
circle, union the inner medallion, cut a 2 mm-cell `GRILLE_BITMAP` prism, then
apply the existing screw-seat keep-outs. Preserve the compound-skin
intersection in `rear_texture_cutters()`.

- [x] **Step 4: Verify GREEN and commit**

Run the texture and profile tests plus `checks.py`, then commit the source and
tests.

### Task 3: Regenerate and visually verify the enclosure

**Files:**
- Regenerate: `hardware/pocket_card/case/out/`

- [x] **Step 1: Run the complete focused unit suite and shell checks**
- [x] **Step 2: Regenerate the case and complete Blender assembly**
- [x] **Step 3: Render a square-on rear view plus the four captive-nut review views**
- [x] **Step 4: Inspect that the broad crest moved with no local patch and the rear reads as the recovered partial band with logo medallion**
- [x] **Step 5: Run Blender integration verification, `git diff --check`, and commit regenerated artifacts**
