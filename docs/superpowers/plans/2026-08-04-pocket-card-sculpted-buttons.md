# Pocket Card Sculpted Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and preview a printable role-specific set of Pocket Card button caps while preserving the existing switch and shell interfaces.

**Architecture:** Add one focused CadQuery module that builds the unchanged mechanical base and selects a crown by semantic role. Keep the neutral clearance coupon intact; the new module exports prototype parts and placed preview compounds. Geometry tests assert the tactile distinctions and compatibility boundaries before outputs are generated.

**Tech Stack:** Python 3, CadQuery/OpenCascade, unittest, existing Pocket Card CAD parameters and shell transforms.

---

### Task 1: Specify the crown geometry contract

**Files:**
- Create: `hardware/pocket_card/case/test_sculpted_buttons.py`
- Create: `hardware/pocket_card/case/sculpted_buttons.py`

- [x] **Step 1: Write failing geometry tests**

Define tests that import `sculpted_buttons`, build all eight semantic roles and
assert: every cap is one solid; all caps retain the expected flange/boss depth;
the direction crown centre of mass leans toward its declared outward vector;
Undo is concave; Action is convex and tallest; Reset is lowest; Menu has less
volume than an otherwise identical ungrooved pill.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `cd hardware/pocket_card/case && .venv/bin/python -m unittest -v test_sculpted_buttons.py`

Expected: import failure because `sculpted_buttons.py` does not exist.

- [x] **Step 3: Implement the minimum role-specific cap builder**

Create `cap(role, clear_cap=P.FIT_CLEAR, outward=None)` with roles `up`, `down`,
`left`, `right`, `undo`, `action`, `reset`, and `menu`. Reuse the current
diameters and mechanical constants; build the keyed flange and switch boss
identically for every round cap. Build the direction crown as an offset loft,
Undo and Reset by subtracting spherical dishes, Action as a spherical dome,
and Menu as a low pill with three shallow transverse cuts.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run: `cd hardware/pocket_card/case && .venv/bin/python -m unittest -v test_sculpted_buttons.py`

Expected: all sculpted-button tests pass.

### Task 2: Export printable and placed prototypes

**Files:**
- Modify: `hardware/pocket_card/case/sculpted_buttons.py`
- Modify: `hardware/pocket_card/case/test_sculpted_buttons.py`

- [x] **Step 1: Add a failing export-manifest test**

Assert that the module exposes all eight role/station mappings and that the
four direction outward vectors point away from the existing cluster centre.

- [x] **Step 2: Run the focused tests and verify RED**

Run the focused unittest command and confirm the missing manifest causes the
failure.

- [x] **Step 3: Add exporters**

Write individual STL/STEP files, a flange-sprued printable set, a placed
multi-body STEP, and a front-shell-plus-caps preview compound under
`hardware/pocket_card/case/out/sculpted_buttons/`. Use
`shell_front.to_model_space()` for all placed geometry.

- [x] **Step 4: Run the focused tests and generator**

Run the focused unittest command, then:

`cd hardware/pocket_card/case && .venv/bin/python sculpted_buttons.py`

Expected: eight individual cap pairs plus sprued and placed preview artefacts.

### Task 3: Render and verify the prototype

**Files:**
- Modify: `hardware/pocket_card/case/README.md`

- [x] **Step 1: Document the prototype outputs and command**

Add the generator command and the paths for individual printable caps, the
sprued set, placed STEP and rendered preview.

- [x] **Step 2: Run regression checks**

Run:

`cd hardware/pocket_card/case && .venv/bin/python -m unittest -v test_sculpted_buttons.py test_emboss_shells.py`

`cd hardware/pocket_card/case && .venv/bin/python checks.py`

Expected: all unit tests and all mechanical checks pass.

- [x] **Step 3: Render and inspect**

Render the front-shell preview from an oblique front view. Inspect that the four
direction crowns rise away from the cluster centre, Undo reads concave, Action
convex, Reset protected, Menu grooved, and no cap intersects the face.

- [x] **Step 4: Review repository scope**

Run `git diff --check`, `git status --short`, and confirm the unrelated
`hardware/pocket_card/case/out/pcb/temp.stl` remains untouched and untracked.

### Task 4: Assemble the sculpted Blender model

**Files:**
- Create: `hardware/pocket_card/case/sculpted_buttons_blender.py`
- Modify: `hardware/pocket_card/case/sculpted_buttons.py`
- Modify: `hardware/pocket_card/case/test_sculpted_buttons.py`

- [x] **Step 1: Export each cap in complete-assembly model space**

Write individual STL/STEP pairs under `out/sculpted_buttons/placed/` and test
that the full eight-role manifest is present and non-empty.

- [x] **Step 2: Replace only the complete assembly's face-cap meshes**

Open `out/order/pocket_card_complete.blend`, import the placed meshes with
identity transforms, preserve the `Buttons` collection and `Button Yellow`
material, and save `out/sculpted_buttons/pocket_card_complete_sculpted.blend`.

- [x] **Step 3: Verify the saved Blender inventory**

Reopen the result headlessly and assert the complete mesh-object inventory,
including display, PCB, Battery, speaker, edge tips and eight cap meshes whose
data names end in `_sculpted_mesh`.
