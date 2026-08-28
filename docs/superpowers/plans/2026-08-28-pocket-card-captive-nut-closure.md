# Pocket Card Captive-Nut Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Pocket Card enclosure's six resin self-tapped joints with rear-inserted M2 machine screws and mechanically captured side-loading M2 nuts, including the approved Reset/H2 relocation and an unambiguous assembled 3D review.

**Architecture:** `params.py` remains the numeric source of truth. A new focused `nut_traps.py` module owns captive-nut site metadata, printable trap solids/voids, fit-envelope calculations, and preview hardware; `shell_front.py` consumes it, while `joints.py` continues to own the matching curved-back screw seats and length selection. The authoritative KiCad board and mechanical contract move H2 and `SW_RESET1` together, and the existing preview/Blender pipeline gains a separate Fasteners collection plus assembled, exploded, and H2-cutaway renders.

**Tech Stack:** Python 3.12, CadQuery/OCP, `unittest`, native KiCad 10 project and `kicad-cli`, Blender Python, existing Pocket Card Make targets.

---

## File map

- Create `hardware/pocket_card/case/nut_traps.py` — captive-nut dimensions, site descriptors, CAD material/voids, insertion sweeps, and simplified hardware preview solids.
- Create `hardware/pocket_card/case/test_closure_layout.py` — approved enclosure/PCB coordinate contract.
- Create `hardware/pocket_card/case/test_nut_traps.py` — analytic, solid, insertion-path, and assembled-clearance tests.
- Create `hardware/pocket_card/case/nut_trap_coupon.py` — one-piece 4.3/4.4/4.5 mm across-flats SLA fit coupon.
- Create `hardware/pocket_card/case/tools/render_captive_nut_review.py` — Blender review renderer for assembled, exploded, H2 cutaway, and trap close-up images.
- Modify `hardware/pocket_card/case/params.py` — approved coordinates and captive-nut constants.
- Modify `hardware/pocket_card/case/shell_front.py` — replace self-tapping pilots/controller pins with six side-loading traps and machine-screw clearances.
- Modify `hardware/pocket_card/case/joints.py` — variable rear seat depth and machine-screw selection against a captive nut.
- Modify `hardware/pocket_card/case/test_screw_selection.py` — machine-screw length, tip, seat-depth, and BOM expectations.
- Modify `hardware/pocket_card/case/checks.py` — built-solid and real-component clearance checks for all traps, especially H2.
- Modify `hardware/pocket_card/case/export_smt.py` — machine-screw and six-nut hardware BOM rows.
- Modify `hardware/pocket_card/case/build_variants.py` — export the nut-fit coupon and hardware preview meshes with the order pack.
- Modify `hardware/pocket_card/case/place_preview.py` — export/place six nuts and six screws and include them in the assembly STEP/STL.
- Modify `hardware/pocket_card/case/emboss_shells.py` — create/update the Fasteners collection in the complete Blender assembly.
- Modify `hardware/pocket_card/case/test_emboss_shells.py` — require the Fasteners collection, objects, and material.
- Modify `hardware/pocket_card/case/tools/verify_complete_rear_profile.py` — admit and verify the twelve fastener objects without weakening the existing authored-scene checks.
- Modify `hardware/pocket_card/electronics/pocket_card_controller.kicad_pcb` — move/re-route/re-lock H2 and `SW_RESET1` in the authoritative board.
- Modify `hardware/pocket_card/electronics/mechanical_contract.json` — record the approved H2 and Reset coordinates.
- Modify `hardware/pocket_card/case/README.md` — machine-screw assembly, coupon, and review-render instructions.
- Modify `Makefile` — add the deterministic captive-nut review-render target.
- Regenerate tracked files under `hardware/pocket_card/case/out/` only after all source and verification work passes.

### Task 0: Establish a clean mechanical/electrical baseline

**Files:**
- Verify only; no tracked changes.

- [ ] **Step 1: Prepare the case Python environment in this worktree**

Run from the worktree root:

```bash
python3 -m venv hardware/pocket_card/case/.venv
hardware/pocket_card/case/.venv/bin/pip install cadquery numpy matplotlib
```

Expected: `Successfully installed` or `Requirement already satisfied`, followed by a working CadQuery import.

- [ ] **Step 2: Verify the CAD interpreter**

Run:

```bash
hardware/pocket_card/case/.venv/bin/python -c "import cadquery, numpy; print(cadquery.__version__)"
```

Expected: one CadQuery version line and exit status 0.

- [ ] **Step 3: Run the focused baseline tests**

Run:

```bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest test_screw_selection.py test_pcb_connectivity.py -v
cd ../../../
python3 -m unittest discover -s hardware/pocket_card/electronics_pipeline/tests -p 'test_*.py' -v
```

Expected: all existing focused and electronics-pipeline tests pass.

- [ ] **Step 4: Validate the checked-in KiCad source without modifying it**

Run:

```bash
make pocket_card_kicad_check
```

Expected: validation status `PASS`; the canonical KiCad project digest remains unchanged.

### Task 1: Move Reset and controller H2 as one mechanical contract

**Files:**
- Create: `hardware/pocket_card/case/test_closure_layout.py`
- Modify: `hardware/pocket_card/case/params.py:216-265`
- Modify: `hardware/pocket_card/electronics/pocket_card_controller.kicad_pcb`
- Modify: `hardware/pocket_card/electronics/mechanical_contract.json:52-151`

- [ ] **Step 1: Write the failing coordinate-contract test**

Create `hardware/pocket_card/case/test_closure_layout.py`:

```python
import json
import os
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT))

import params as P  # noqa: E402
from hardware.pocket_card.electronics_pipeline.inventory import parse_board  # noqa: E402


class ClosureLayoutTest(unittest.TestCase):
    def test_approved_case_coordinates(self):
        self.assertEqual((P.RESET_X, P.RESET_Y), (54.5, 80.0))
        self.assertEqual(P.PCB_MOUNTS, ((64.5, 56.0), (64.5, 84.0)))
        self.assertEqual(P.EXTRA_BOSSES, P.PCB_MOUNTS)

    def test_board_and_contract_match_case_coordinates(self):
        electronics = ROOT / "hardware" / "pocket_card" / "electronics"
        board = parse_board(
            (electronics / "pocket_card_controller.kicad_pcb").read_text(
                encoding="utf-8"
            )
        )
        contract = json.loads(
            (electronics / "mechanical_contract.json").read_text(encoding="utf-8")
        )
        features = {item["ref"]: item for item in contract["features"]}
        expected = {
            "H2": (64.5, 84.0),
            "SW_RESET1": (54.5, 80.0),
        }
        for ref, xy in expected.items():
            with self.subTest(ref=ref):
                footprint = board.footprints[ref]
                self.assertEqual((footprint.x_mm, footprint.y_mm), xy)
                self.assertTrue(footprint.locked)
                self.assertEqual(
                    (features[ref]["xMm"], features[ref]["yMm"]), xy
                )


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test and confirm the old geometry fails**

Run:

```bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest test_closure_layout.py -v
```

Expected: failures report Reset at `(56.5, 80.0)` and H2 at `(66.0, 84.0)`.

- [ ] **Step 3: Update the enclosure source coordinates**

Change `params.py` to:

```python
RESET_X, RESET_Y = 54.50, 80.00

PCB_MOUNTS = ((64.5, 56.0), (64.5, 84.0))
EXTRA_BOSSES = PCB_MOUNTS
```

Keep the existing comments, but revise them to state that Reset moved left to free the H2 captive-nut envelope and H2 now aligns vertically with H1.

- [ ] **Step 4: Move and re-route the authoritative KiCad features**

Open `hardware/pocket_card/electronics/pocket_card_controller.kicad_pcb` in KiCad 10. Unlock only `H2` and `SW_RESET1`. Move H2 to `(64.5, 84.0)`. Drag `SW_RESET1` with KiCad's track-preserving drag operation to `(54.5, 80.0)`, then clean the four short pad-entry segments so both pad-1 lands remain on `SIG_RESET` and both pad-2 lands remain on `GND`. Re-lock both footprints, refill both copper zones, run PCB DRC, and save.

Expected: no unconnected Reset pad, no copper-to-H2 violation, and both footprints remain locked.

- [ ] **Step 5: Update the mechanical contract**

Change the two feature entries in `mechanical_contract.json` to:

```json
{
  "ref": "H2",
  "xMm": 64.5,
  "yMm": 84.0,
  "rotationDeg": 0.0,
  "side": "F.Cu",
  "xyToleranceMm": 0.05,
  "rotationToleranceDeg": 0.1,
  "lockedRequired": true,
  "rationale": "Rear enclosure machine-screw and captive-nut axis."
}
```

```json
{
  "ref": "SW_RESET1",
  "xMm": 54.5,
  "yMm": 80.0,
  "rotationDeg": 0.0,
  "side": "F.Cu",
  "xyToleranceMm": 0.05,
  "rotationToleranceDeg": 0.1,
  "lockedRequired": true,
  "rationale": "Reset button must remain concentric with its relocated enclosure guide."
}
```

- [ ] **Step 6: Run coordinate, connectivity, and native KiCad validation**

Run:

```bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest test_closure_layout.py test_pcb_connectivity.py -v
cd ../../../
make pocket_card_kicad_check
```

Expected: all tests pass and native KiCad validation reports `PASS`.

- [ ] **Step 7: Commit the synchronized move**

```bash
git add hardware/pocket_card/case/params.py \
  hardware/pocket_card/case/test_closure_layout.py \
  hardware/pocket_card/electronics/pocket_card_controller.kicad_pcb \
  hardware/pocket_card/electronics/mechanical_contract.json
git commit -m "feat: relocate Pocket Card Reset and lower mount"
```

### Task 2: Build the captive-nut geometry as an isolated CAD unit

**Files:**
- Create: `hardware/pocket_card/case/nut_traps.py`
- Create: `hardware/pocket_card/case/test_nut_traps.py`
- Modify: `hardware/pocket_card/case/params.py:587-600`

- [ ] **Step 1: Write failing tests for dimensions and site metadata**

Create `hardware/pocket_card/case/test_nut_traps.py` with this first test class:

```python
import math
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import params as P  # noqa: E402
import nut_traps  # noqa: E402


class NutTrapDefinitionTest(unittest.TestCase):
    def test_six_sites_have_approved_axes_and_loading_directions(self):
        sites = nut_traps.sites()
        self.assertEqual(len(sites), 6)
        self.assertEqual(
            [(s.x, s.y, s.kind, s.mouth) for s in sites],
            [
                (6.0, 6.5, "module", (1, 1)),
                (6.0, 48.5, "module", (1, -1)),
                (84.0, 6.5, "module", (-1, 1)),
                (84.0, 48.5, "module", (-1, -1)),
                (64.5, 56.0, "pcb", (0, 1)),
                (64.5, 84.0, "pcb", (0, -1)),
            ],
        )

    def test_maximum_coupon_cavity_fits_the_conservative_envelope(self):
        self.assertAlmostEqual(
            nut_traps.cage_radius(4.5), 4.5 / math.sqrt(3) + 1.0
        )
        self.assertLessEqual(nut_traps.cage_radius(4.5), 3.6)

    def test_controller_axial_stack_preserves_board_gap(self):
        used = P.NUT_CAVITY_T + P.NUT_ROOF_T
        available = P.PCB_FRONT_Z - P.FACE_T
        self.assertAlmostEqual(used, 2.8)
        self.assertAlmostEqual(available - used, 0.2)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests and confirm the module is absent**

Run:

```bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest test_nut_traps.py -v
```

Expected: import failure for `nut_traps`.

- [ ] **Step 3: Add the approved numeric parameters**

Add to `params.py` near the structural invariants:

```python
NUT_NOMINAL_AF = 4.0
NUT_AF = 4.4
NUT_AF_VARIANTS = (4.3, 4.4, 4.5)
NUT_MAX_T = 1.6
NUT_CAVITY_T = 1.8
NUT_ROOF_T = 1.0
NUT_THROAT_W = 4.6
NUT_WALL = 1.0
MACHINE_SCREW_CLEAR_D = 2.4
MACHINE_SCREW_TIP_RELIEF = 0.6
NUT_ENVELOPE_R = 3.6
```

- [ ] **Step 4: Implement site metadata and analytic geometry**

Create `nut_traps.py` with these public definitions:

```python
import math
from dataclasses import dataclass

import cadquery as cq

import params as P


@dataclass(frozen=True)
class NutTrapSite:
    x: float
    y: float
    kind: str
    mouth: tuple[int, int]

    @property
    def nut_front_z(self):
        return -P.FACE_T

    @property
    def cavity_back_z(self):
        return self.nut_front_z - P.NUT_CAVITY_T

    @property
    def roof_back_z(self):
        return self.cavity_back_z - P.NUT_ROOF_T


def cage_radius(across_flats=P.NUT_AF):
    return across_flats / math.sqrt(3.0) + P.NUT_WALL


def sites():
    mx = (P.MOD_X + P.MOUNT_INSET, P.MOD_X + P.MOD_W - P.MOUNT_INSET)
    my = (P.MOD_Y + P.MOUNT_INSET, P.MOD_Y + P.MOD_H - P.MOUNT_INSET)
    return (
        NutTrapSite(mx[0], my[0], "module", (1, 1)),
        NutTrapSite(mx[0], my[1], "module", (1, -1)),
        NutTrapSite(mx[1], my[0], "module", (-1, 1)),
        NutTrapSite(mx[1], my[1], "module", (-1, -1)),
        NutTrapSite(*P.PCB_MOUNTS[0], "pcb", (0, 1)),
        NutTrapSite(*P.PCB_MOUNTS[1], "pcb", (0, -1)),
    )


def hex_corner_diameter(across_flats):
    return 2.0 * across_flats / math.sqrt(3.0)


def _placed(shape, site):
    return shape.translate((site.x, site.y, 0))


def _mouth_angle(site):
    return math.degrees(math.atan2(site.mouth[1], site.mouth[0]))


def nut_solid(site, across_flats=P.NUT_NOMINAL_AF, thickness=P.NUT_MAX_T):
    return _placed(
        cq.Workplane("XY")
        .polygon(6, hex_corner_diameter(across_flats))
        .extrude(-thickness)
        .translate((0, 0, site.nut_front_z))
        .rotate((0, 0, 0), (0, 0, 1), _mouth_angle(site)),
        site,
    )


def _mouth_prism(site, width, z0, z1):
    length = P.NUT_ENVELOPE_R + 2.0
    local = (
        cq.Workplane("XY")
        .box(length, width, z1 - z0, centered=(True, True, False))
        .translate((length / 2.0, 0.0, z0))
        .rotate((0, 0, 0), (0, 0, 1), _mouth_angle(site))
    )
    return _placed(local, site)


def front_material(site):
    # Fuse 0.1 mm into the existing face; the back 1.0 mm remains as the roof.
    depth = (-P.FACE_T + 0.1) - site.roof_back_z
    return _placed(
        cq.Workplane("XY")
        .circle(P.NUT_ENVELOPE_R)
        .extrude(depth)
        .translate((0, 0, site.roof_back_z)),
        site,
    )


def front_voids(site, across_flats=P.NUT_AF):
    # Open the cavity 0.1 mm into the face so no coincident skin seals the slot.
    cavity_depth = site.nut_front_z + 0.1 - site.cavity_back_z
    cavity = _placed(
        cq.Workplane("XY")
        .polygon(6, hex_corner_diameter(across_flats))
        .extrude(cavity_depth)
        .translate((0, 0, site.cavity_back_z))
        .rotate((0, 0, 0), (0, 0, 1), _mouth_angle(site)),
        site,
    )
    throat = _mouth_prism(
        site, P.NUT_THROAT_W, site.cavity_back_z, site.nut_front_z + 0.1
    )
    bore = screw_path(site, site.roof_back_z - 0.1)
    return cavity.union(throat).union(bore)


def screw_path(site, z_back):
    z_front = site.nut_front_z + P.MACHINE_SCREW_TIP_RELIEF
    return _placed(
        cq.Workplane("XY")
        .circle(P.MACHINE_SCREW_CLEAR_D / 2.0)
        .extrude(z_front - z_back)
        .translate((0, 0, z_back)),
        site,
    )


def insertion_sweep(site, across_flats=P.NUT_NOMINAL_AF):
    # Sample at <=0.20 mm spacing; neighbouring nut solids overlap, producing
    # a conservative continuous collision volume from outside to the seat.
    distance = P.NUT_ENVELOPE_R + 2.0
    steps = math.ceil(distance / 0.20)
    dx, dy = site.mouth
    norm = math.hypot(dx, dy)
    sweep = None
    for step in range(steps + 1):
        offset = distance * step / steps
        placed = nut_solid(site, across_flats).translate(
            (dx * offset / norm, dy * offset / norm, 0)
        )
        sweep = placed if sweep is None else sweep.union(placed)
    return sweep
```

The production cage deliberately uses the conservative fixed 3.6 mm radius,
which covers the largest 4.5 mm coupon cavity; `cage_radius()` remains the
analytic proof. The cavity and throat share the same axial range, while the
coaxial bore crosses the 1.0 mm roof and ends 0.6 mm inside the 1.5 mm face,
leaving 0.9 mm of exterior skin.

- [ ] **Step 5: Add solid-level tests for the isolated trap**

Append to `test_nut_traps.py`:

```python
class NutTrapSolidTest(unittest.TestCase):
    def test_nut_does_not_intersect_finished_trap(self):
        for site in nut_traps.sites():
            trap = nut_traps.front_material(site).cut(nut_traps.front_voids(site))
            overlap = trap.intersect(nut_traps.nut_solid(site)).val().Volume()
            self.assertLess(overlap, 1e-5, site)

    def test_insertion_sweep_is_clear(self):
        for site in nut_traps.sites():
            trap = nut_traps.front_material(site).cut(nut_traps.front_voids(site))
            overlap = trap.intersect(nut_traps.insertion_sweep(site)).val().Volume()
            self.assertLess(overlap, 1e-5, site)

    def test_roof_and_face_floor_remain(self):
        for site in nut_traps.sites():
            trap = nut_traps.front_material(site).cut(nut_traps.front_voids(site))
            self.assertGreater(trap.val().Volume(), 1.0)
            self.assertLessEqual(site.roof_back_z, -4.3)
            self.assertGreaterEqual(
                P.FACE_T - P.MACHINE_SCREW_TIP_RELIEF, 0.8
            )
```

- [ ] **Step 6: Run the focused trap tests**

Run:

```bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest test_nut_traps.py -v
```

Expected: all definition and solid tests pass.

- [ ] **Step 7: Commit the isolated nut-trap unit**

```bash
git add hardware/pocket_card/case/params.py \
  hardware/pocket_card/case/nut_traps.py \
  hardware/pocket_card/case/test_nut_traps.py
git commit -m "feat: model Pocket Card captive nut traps"
```

### Task 3: Integrate the traps into the front shell and prove component clearance

**Files:**
- Modify: `hardware/pocket_card/case/shell_front.py:25-375`
- Modify: `hardware/pocket_card/case/checks.py:524-763`
- Modify: `hardware/pocket_card/case/test_nut_traps.py`

- [ ] **Step 1: Write the failing assembled-front tests**

Append to `test_nut_traps.py`:

```python
import shell_front  # noqa: E402


class FrontShellNutTrapIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.front = shell_front.build()

    def test_front_shell_remains_one_solid(self):
        self.assertEqual(len(self.front.val().Solids()), 1)

    def test_all_six_seated_nuts_and_insertion_sweeps_are_clear(self):
        for site in nut_traps.sites():
            with self.subTest(site=site):
                self.assertLess(
                    self.front.intersect(nut_traps.nut_solid(site)).val().Volume(),
                    1e-5,
                )
                self.assertLess(
                    self.front.intersect(
                        nut_traps.insertion_sweep(site)
                    ).val().Volume(),
                    1e-5,
                )

    def test_h2_complete_envelope_clears_real_neighbours(self):
        h2 = nut_traps.sites()[-1]
        r = P.NUT_ENVELOPE_R
        battery_gap = h2.x - P.BATT_X - P.CELL_W - r
        speaker_arc_x = P.GRILLE_X - math.sqrt(
            (P.DRIVER_W / 2) ** 2
            - (h2.y - (P.GRILLE_Y + (P.DRIVER_H - P.DRIVER_W) / 2)) ** 2
        )
        speaker_gap = speaker_arc_x - h2.x - r
        reset_r = (
            P.RESET_CAP_D / 2 + P.CAP_FLANGE_OS
            + P.COLLAR_CLEAR + shell_front.COLLAR_WALL
        )
        reset_gap = math.hypot(
            h2.x - P.RESET_X, h2.y - P.RESET_Y
        ) - r - reset_r
        self.assertGreaterEqual(battery_gap, 1.8)
        self.assertGreaterEqual(speaker_gap, 0.9)
        self.assertGreaterEqual(reset_gap, 0.6)
```

- [ ] **Step 2: Run the integration tests and confirm they fail on the old pilots**

Run:

```bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest test_nut_traps.FrontShellNutTrapIntegrationTest -v
```

Expected: the seated-nut/insertion tests fail because the old solid posts and pilots occupy the new trap volumes.

- [ ] **Step 3: Replace self-tapping front geometry with captive traps**

In `shell_front.py`:

```python
import nut_traps
```

Remove `POST_PILOT_D` and every self-tapper pilot cut. Keep the four Ø3.0 display-module locating sleeves, but cut the new 2.4 mm machine-screw bore through them. Remove the two Ø2.4 controller pins: the rear shoulders still establish controller Z, and the M2 shafts through H1/H2 provide the lateral axes without leaving an unprintable 0.2 mm sleeve.

Add this helper and call it after button collars/posts are unioned and before envelope clipping:

```python
def apply_nut_traps(shell):
    for site in nut_traps.sites():
        shell = shell.union(nut_traps.front_material(site))
    for site in nut_traps.sites():
        shell = shell.cut(nut_traps.front_voids(site))
    return shell
```

The finished `build()` ordering must be material first, voids second, then `side_arc.clip_to_envelope(shell)`.

- [ ] **Step 4: Add the exact H2 clearance audit to `checks.py`**

Add `check_captive_nut_traps()` that computes the same three conservative gaps as the integration test, checks all six `front_material` objects stay inside the envelope, checks insertion sweeps against the built front shell, and appends descriptive entries to `FAILURES` for any gap below 1.8 mm battery, 0.9 mm speaker, or 0.6 mm Reset.

Call it from `checks.py`'s existing main check sequence immediately after the collar and PCB-mount checks.

- [ ] **Step 5: Run shell integration and the full CAD checker**

Run:

```bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest test_nut_traps.py -v
.venv/bin/python shell_front.py
.venv/bin/python shell_back.py
.venv/bin/python checks.py
```

Expected: tests pass; both shells export; `checks.py` ends without accumulated failures and reports positive H2 gaps against the stadium speaker, battery, and Reset guide.

- [ ] **Step 6: Commit front-shell integration**

```bash
git add hardware/pocket_card/case/shell_front.py \
  hardware/pocket_card/case/checks.py \
  hardware/pocket_card/case/test_nut_traps.py
git commit -m "feat: integrate captive nuts into Pocket Card front shell"
```

### Task 4: Convert rear joints and BOM to M2 machine screws

**Files:**
- Modify: `hardware/pocket_card/case/joints.py:20-155`
- Modify: `hardware/pocket_card/case/test_screw_selection.py`
- Modify: `hardware/pocket_card/case/export_smt.py:195-229`
- Modify: `hardware/pocket_card/case/params.py:588-600`

- [ ] **Step 1: Replace self-tapper expectations with machine-screw tests**

Replace the pilot/engagement tests in `test_screw_selection.py` with:

```python
    def test_selects_shortest_stock_screw_and_shallowest_valid_seat(self):
        selected = joints.select_machine_screw(
            outer_back_z=-15.386,
            nut_front_z=-1.5,
            stocked_lengths=(8.0, 10.0, 12.0, 14.0),
        )
        self.assertEqual(selected.length, 12.0)
        self.assertAlmostEqual(selected.seat_depth, 2.086, places=3)
        self.assertAlmostEqual(selected.tip_protrusion, 0.2, places=6)

    def test_all_six_machine_screws_fully_cross_the_nut_without_skin_risk(self):
        selections = joints.selected_screws()
        self.assertEqual(len(selections), 6)
        for selection in selections:
            self.assertIn(selection.length, joints.STOCKED_SCREW_LENGTHS)
            self.assertGreaterEqual(selection.tip_protrusion, 0.2 - 1e-9)
            self.assertLessEqual(selection.tip_protrusion, 0.6 + 1e-9)
            self.assertGreaterEqual(selection.seat_depth, joints.MIN_HEAD_SEAT_DEPTH)
            self.assertLessEqual(selection.seat_depth, joints.MAX_HEAD_SEAT_DEPTH)
```

Update the BOM test to require machine-screw comments and one six-piece nut row:

```python
        nut_rows = [row for row in rows if row["Designator"] == "NUT_M2"]
        self.assertEqual(len(nut_rows), 1)
        self.assertEqual(int(nut_rows[0]["Qty"]), 6)
        self.assertTrue(all(
            "machine screw" in row["Comment"]
            for row in rows if row["Designator"].startswith("SCREW_")
        ))
```

- [ ] **Step 2: Run the screw tests and confirm self-tapper semantics fail**

Run:

```bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest test_screw_selection.py -v
```

Expected: failures mention missing `select_machine_screw`, `seat_depth`, `tip_protrusion`, and the nut BOM row.

- [ ] **Step 3: Implement variable seat-depth machine-screw selection**

In `joints.py`, replace the self-tapper engagement constants with:

```python
STOCKED_SCREW_LENGTHS = (8.0, 10.0, 12.0, 14.0)
MIN_HEAD_SEAT_DEPTH = 1.5
MAX_HEAD_SEAT_DEPTH = 2.1
MIN_TIP_PROTRUSION = 0.2
MAX_TIP_PROTRUSION = 0.6
NUT_FRONT_Z = -P.FACE_T
```

Use this selector:

```python
@dataclass(frozen=True)
class MachineScrewGeometry:
    length: float
    seat_depth: float
    tip_protrusion: float


def select_machine_screw(
    outer_back_z,
    nut_front_z=NUT_FRONT_Z,
    stocked_lengths=STOCKED_SCREW_LENGTHS,
):
    for length in sorted(float(value) for value in stocked_lengths):
        allowed_lo = (
            nut_front_z + MIN_TIP_PROTRUSION
            - outer_back_z - length
        )
        allowed_hi = (
            nut_front_z + MAX_TIP_PROTRUSION
            - outer_back_z - length
        )
        seat_depth = max(MIN_HEAD_SEAT_DEPTH, allowed_lo)
        if seat_depth <= min(MAX_HEAD_SEAT_DEPTH, allowed_hi) + 1e-9:
            protrusion = outer_back_z + seat_depth + length - nut_front_z
            return MachineScrewGeometry(length, seat_depth, protrusion)
    raise ValueError(
        "no stocked M2 machine screw satisfies seat depth and tip limits"
    )
```

Derive each `ScrewJoint.seat_z` from the shallowest sampled outer-back Z plus the selected `seat_depth`; cut the rear head pocket to that plane. Preserve the existing shaft bore and reinforced-land radius. Extend `ScrewSelection` with `seat_depth` and `tip_protrusion`, and remove pilot-entry/thread-engagement properties.

- [ ] **Step 4: Emit machine screws and captive nuts in the hardware BOM**

In `export_smt.write_hardware_bom()`, write screw rows as:

```python
[
    "M2x%g pan-head machine screw" % length,
    "SCREW_M2X%g" % length,
    len(selections),
    "%.1f" % length,
    "Rear machine screw into captive DIN 934 M2 nut",
    sites,
]
```

Append this row exactly once:

```python
[
    "M2 DIN 934 hex nut",
    "NUT_M2",
    6,
    "1.6",
    "4.0 mm AF nominal; verify against SLA fit coupon",
    ";".join("(%g,%g)" % (site.x, site.y) for site in nut_traps.sites()),
]
```

Import `nut_traps` lazily beside `joints` so the stdlib-only electronics export path remains unaffected until the case BOM is requested.

- [ ] **Step 5: Run screw, rear-shell, membrane, and BOM checks**

Run:

```bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest test_screw_selection.py test_nut_traps.py -v
.venv/bin/python shell_back.py
.venv/bin/python checks.py
.venv/bin/python -c "import export_smt; print(export_smt.write_hardware_bom())"
```

Expected: all tests pass; no rear membrane/land failure; `out/hardware_BOM.csv` contains six nuts and six machine screws grouped by selected length, with no `self-tap` text.

- [ ] **Step 6: Commit machine-screw conversion**

```bash
git add hardware/pocket_card/case/joints.py \
  hardware/pocket_card/case/test_screw_selection.py \
  hardware/pocket_card/case/export_smt.py \
  hardware/pocket_card/case/params.py
git commit -m "feat: select machine screws for captive nuts"
```

### Task 5: Add the SLA 8001 nut-fit coupon

**Files:**
- Create: `hardware/pocket_card/case/nut_trap_coupon.py`
- Modify: `hardware/pocket_card/case/test_nut_traps.py`
- Modify: `hardware/pocket_card/case/build_variants.py:88-151`
- Modify: `hardware/pocket_card/case/README.md:128-193`

- [ ] **Step 1: Write the failing coupon test**

Append to `test_nut_traps.py`:

```python
import nut_trap_coupon  # noqa: E402


class NutTrapCouponTest(unittest.TestCase):
    def test_coupon_contains_three_labelled_fit_variants_in_one_solid(self):
        coupon = nut_trap_coupon.build()
        self.assertEqual(len(coupon.val().Solids()), 1)
        self.assertEqual(nut_trap_coupon.VARIANTS, (4.3, 4.4, 4.5))
        box = coupon.val().BoundingBox()
        self.assertGreater(box.xlen, 30.0)
        self.assertGreater(box.ylen, 12.0)
        self.assertGreaterEqual(box.zlen, P.FACE_T + P.NUT_CAVITY_T + P.NUT_ROOF_T)
```

- [ ] **Step 2: Run the test and confirm the coupon module is absent**

Run:

```bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest test_nut_traps.NutTrapCouponTest -v
```

Expected: import failure for `nut_trap_coupon`.

- [ ] **Step 3: Implement and export the three-fit coupon**

Create `nut_trap_coupon.py` with:

```python
from pathlib import Path

import cadquery as cq

import nut_traps
import params as P

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
VARIANTS = P.NUT_AF_VARIANTS
PITCH = 13.0


def build():
    width = PITCH * len(VARIANTS) + 6.0
    depth = 16.0
    height = P.FACE_T + P.NUT_CAVITY_T + P.NUT_ROOF_T
    # Match the enclosure convention: split plane at z=0, material at -Z.
    plate = (
        cq.Workplane("XY")
        .box(width, depth, height, centered=(True, True, False))
        .translate((0, 0, -height))
    )
    x0 = -PITCH * (len(VARIANTS) - 1) / 2
    for index, across_flats in enumerate(VARIANTS):
        site = nut_traps.NutTrapSite(x0 + index * PITCH, 0.0, "coupon", (0, -1))
        plate = plate.cut(nut_traps.front_voids(site, across_flats=across_flats))
        label = (
            cq.Workplane("XY")
            .text(f"{across_flats:.1f}", 2.2, 0.35, combine=False)
            .translate((site.x, 5.5, -0.2))
        )
        plate = plate.cut(label)
    return plate


def export():
    OUT.mkdir(parents=True, exist_ok=True)
    shape = build()
    cq.exporters.export(shape, str(OUT / "nut_trap_coupon.stl"))
    cq.exporters.export(shape, str(OUT / "nut_trap_coupon.step"))


if __name__ == "__main__":
    export()
```

Allow `nut_traps.front_voids()` to accept an explicit `across_flats` value while keeping 4.4 mm as the production default.

- [ ] **Step 4: Add the coupon to the case build and documentation**

Import and call `nut_trap_coupon.export()` from `build_variants.main()` after the fixed shells are built. Add `nut_trap_coupon.stl` to the order manifest text without counting it as a cap variant.

In `case/README.md`, make the nut coupon the first closure-related print: use the smallest cavity that accepts the stocked M2 nut by hand, prevents rotation, and permits lateral insertion without cracking the 1.0 mm roof. Record that the selected fit updates `NUT_AF` before ordering the full front shell.

- [ ] **Step 5: Run and inspect the coupon build**

Run:

```bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest test_nut_traps.py -v
.venv/bin/python nut_trap_coupon.py
.venv/bin/python -c "import cadquery as cq; s=cq.importers.importStep('out/nut_trap_coupon.step'); print(len(s.val().Solids()), round(s.val().Volume(), 2))"
```

Expected: tests pass; both coupon files exist; imported STEP reports one solid and positive volume.

- [ ] **Step 6: Commit the coupon**

```bash
git add hardware/pocket_card/case/nut_trap_coupon.py \
  hardware/pocket_card/case/test_nut_traps.py \
  hardware/pocket_card/case/build_variants.py \
  hardware/pocket_card/case/README.md
git commit -m "feat: add Pocket Card captive nut fit coupon"
```

### Task 6: Put the real fasteners into the complete 3D assembly

**Files:**
- Modify: `hardware/pocket_card/case/nut_traps.py`
- Modify: `hardware/pocket_card/case/place_preview.py:109-216`
- Modify: `hardware/pocket_card/case/emboss_shells.py:30-620`
- Modify: `hardware/pocket_card/case/test_emboss_shells.py:20-470`
- Modify: `hardware/pocket_card/case/tools/verify_complete_rear_profile.py:27-170`

- [ ] **Step 1: Write failing preview and Blender inventory tests**

Add to `test_nut_traps.py`:

```python
class FastenerPreviewTest(unittest.TestCase):
    def test_each_site_has_one_nut_and_one_matching_screw(self):
        previews = nut_traps.preview_fasteners()
        self.assertEqual(len(previews), 12)
        self.assertEqual(
            {name for name, _shape in previews},
            {
                *(f"nut_{index}" for index in range(1, 7)),
                *(f"screw_{index}" for index in range(1, 7)),
            },
        )
        self.assertTrue(all(shape.val().Volume() > 0 for _name, shape in previews))
```

In `test_emboss_shells.py`, change the expected inventory to:

```python
EXPECTED_COLLECTIONS = {"Case", "Buttons", "Electronics", "Display", "Fasteners"}
EXPECTED_FASTENERS = {
    *(f"nut_{index}" for index in range(1, 7)),
    *(f"screw_{index}" for index in range(1, 7)),
}
EXPECTED_OBJECTS = EXPECTED_BUTTONS | EXPECTED_FASTENERS | {
    "shell_front_embossed", "shell_back_embossed", "pcb", "es3c28p_3d",
} | EXPECTED_TEMPLATE_COMPONENTS
```

Require every fastener to belong only to `Fasteners` and use material `Fastener Steel`.

- [ ] **Step 2: Run the focused tests and confirm fasteners are absent**

Run:

```bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest test_nut_traps.FastenerPreviewTest -v
```

Expected: failure because `preview_fasteners()` does not exist.

- [ ] **Step 3: Generate simplified but dimensionally correct nuts and screws**

Add to `nut_traps.py`:

```python
def screw_solid(site, selection):
    joint_z = selection.seat_z
    shaft = (
        cq.Workplane("XY")
        .circle(1.0)
        .extrude(selection.length)
        .translate((site.x, site.y, joint_z))
    )
    head = (
        cq.Workplane("XY")
        .circle(2.5)
        .extrude(-1.5)
        .translate((site.x, site.y, joint_z))
    )
    return shaft.union(head)


def preview_fasteners():
    import joints

    result = []
    selections = {
        (item.x, item.y): item for item in joints.selected_screws()
    }
    for index, site in enumerate(sites(), start=1):
        selection = selections[(site.x, site.y)]
        result.append((f"nut_{index}", nut_solid(site)))
        result.append((f"screw_{index}", screw_solid(site, selection)))
    return tuple(result)
```

Expose `seat_z` on `ScrewSelection`. These preview screws intentionally omit thread helices; their shaft, head, seat, length, and nut relationship are authoritative.

- [ ] **Step 4: Export and include the fasteners in the STEP/STL preview pack**

Add `place_fasteners()` to `place_preview.py`. Export each named fastener through `shell_front.to_model_space()` to `out/order/preview/<name>.stl` and `.step`, export `fasteners_placed.step`, and append all twelve solids to `assemble()` before writing `assembly.step` and `assembly.stl`.

Call `place_fasteners()` from `main()` before `assemble()`.

- [ ] **Step 5: Add a preserved Fasteners collection to Blender finishing**

In `emboss_shells.py`:

- add `FASTENER_STEMS = tuple(f"nut_{i}" for i in range(1, 7)) + tuple(f"screw_{i}" for i in range(1, 7))`;
- add `"Fastener Steel": (0.38, 0.40, 0.43, 1.0)` to `MATERIAL_SPECS`;
- preflight all twelve preview STLs;
- create `Fasteners` in clean assemblies and import the twelve objects with `Fastener Steel`; and
- in preserved assemblies, replace/create only the twelve generated fastener meshes while preserving every authored camera, light, shell, button, component, transform, and collection unrelated to `Fasteners`.

Update `verify_complete_rear_profile.py`'s exact inventory to include the collection and twelve objects. Keep all existing rear-profile and authored-lookdev assertions unchanged.

- [ ] **Step 6: Run preview and Blender integration tests**

Run:

```bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest test_nut_traps.py -v
.venv/bin/python place_preview.py
.venv/bin/python -m unittest test_emboss_shells.py -v
```

Expected: twelve preview STL/STEP pairs exist; `assembly.step` contains front, back, PCB, six nuts, and six screws; Blender tests pass with the new Fasteners collection while authored-scene preservation tests remain green.

- [ ] **Step 7: Commit assembly integration**

```bash
git add hardware/pocket_card/case/nut_traps.py \
  hardware/pocket_card/case/place_preview.py \
  hardware/pocket_card/case/emboss_shells.py \
  hardware/pocket_card/case/test_emboss_shells.py \
  hardware/pocket_card/case/tools/verify_complete_rear_profile.py
git commit -m "feat: show Pocket Card fasteners in 3D assembly"
```

### Task 7: Render the assembled, exploded, and H2 cutaway review

**Files:**
- Create: `hardware/pocket_card/case/tools/render_captive_nut_review.py`
- Modify: `Makefile:1012-1089`
- Modify: `hardware/pocket_card/case/README.md`

- [ ] **Step 1: Add a deterministic Blender review renderer**

Create `tools/render_captive_nut_review.py`. It must open the already-built `out/order/pocket_card_complete.blend`, require the exact six nut and six screw names, and write these four 1200x900 PNGs under `out/order/review/`:

```python
OUTPUTS = {
    "assembled": "captive_nuts_assembled.png",
    "exploded": "captive_nuts_exploded.png",
    "h2_cutaway": "captive_nuts_h2_cutaway.png",
    "trap_closeups": "captive_nuts_trap_closeups.png",
}
```

For `assembled`, render the normal complete enclosure from a rear three-quarter view. For `exploded`, translate only the back shell and six screws 18 mm rearward along model Z while leaving the front shell, electronics, and nuts fixed. For `h2_cutaway`, hide the back shell, apply a non-destructive viewport/render Boolean section to the front shell that exposes layout `(64.5, 84.0)`, and frame H2 together with the battery edge, moved Reset guide, and stadium speaker. For `trap_closeups`, frame one module trap and one controller trap side by side with their nuts partly withdrawn along the actual loading-mouth vectors. Restore all object transforms and visibility after every render so one view cannot contaminate the next.

- [ ] **Step 2: Add the Make target**

Add:

```make
.PHONY: pocket_card_captive_nut_review

pocket_card_captive_nut_review: pocket_card_case
	@test -n "$(BLENDER)" || (echo "Blender not found; set BLENDER=/path/to/blender" >&2; exit 1)
	"$(BLENDER)" --background "$(POCKET_CARD_COMPLETE_BLEND)" \
		--python-exit-code 1 --python \
		"$(POCKET_CARD_CASE_DIR)/tools/render_captive_nut_review.py"
```

Add the target to the help text.

- [ ] **Step 3: Build the complete assembly and render the review set**

Run:

```bash
make pocket_card_captive_nut_review
```

Expected: native KiCad validation and exports pass; shells/coupon/preview/Blender assembly regenerate; four non-empty PNGs appear under `hardware/pocket_card/case/out/order/review/`.

- [ ] **Step 4: Verify the render dimensions and content inventory**

Run:

```bash
python3 -c "from pathlib import Path; from PIL import Image; root=Path('hardware/pocket_card/case/out/order/review'); files=sorted(root.glob('captive_nuts_*.png')); assert len(files)==4; print([(p.name, Image.open(p).size) for p in files])"
```

Expected: four entries, each `(1200, 900)`.

Open all four images for visual inspection. Confirm the screw axes terminate in nuts, never in the speaker; the outer enclosure remains compound-rounded; the H2 cage is visibly between the battery, Reset guide, and stadium speaker; and the side-loading mouths are readable in the exploded/close-up views.

- [ ] **Step 5: Present the 3D checkpoint to the user**

Show the four rendered images and the complete `.blend` file. Ask specifically whether the user accepts the nut loading direction, rear screw presentation, and H2/Reset/speaker relationship before treating the digital enclosure as approved.

- [ ] **Step 6: Commit the review renderer**

```bash
git add Makefile \
  hardware/pocket_card/case/tools/render_captive_nut_review.py \
  hardware/pocket_card/case/README.md
git commit -m "feat: render Pocket Card captive nut review views"
```

### Task 8: Run final gates and publish regenerated artifacts

**Files:**
- Modify regenerated tracked outputs under `hardware/pocket_card/case/out/`
- Verify all source files from Tasks 1-7.

- [ ] **Step 1: Run all case unit tests**

Run:

```bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest \
  test_closure_layout.py \
  test_nut_traps.py \
  test_screw_selection.py \
  test_pcb_connectivity.py \
  test_rear_profile.py \
  test_emboss_shells.py -v
```

Expected: all tests pass; Blender-dependent tests either pass or explicitly skip only when Blender is unavailable.

- [ ] **Step 2: Run the electronics pipeline and native KiCad gates**

Run from the repository root:

```bash
make pocket_card_electronics_tests
make pocket_card_kicad_check
```

Expected: all electronics tests pass; ERC/DRC/parity/mechanics validation reports `PASS` with no canonical-source mutation warning.

- [ ] **Step 3: Regenerate PCB and case release artifacts**

Run:

```bash
make pocket_card_pcb_exports
make pocket_card_case
```

Expected: fresh Gerber/BOM/position/STEP/STL outputs, front and back shells, nut coupon, twelve fastener preview meshes, assembled STEP/STL, and `pocket_card_complete.blend`.

- [ ] **Step 4: Run built-solid and authored-Blender verification**

Run:

```bash
cd hardware/pocket_card/case
.venv/bin/python checks.py
cd ../../../
"${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}" \
  --background hardware/pocket_card/case/out/order/pocket_card_complete.blend \
  --python-exit-code 1 \
  --python hardware/pocket_card/case/tools/verify_complete_rear_profile.py
```

Expected: CAD checks report no failures; Blender verification reports the expected authored scene plus Fasteners and preserves the continuous rear profile.

- [ ] **Step 5: Audit the release diff**

Run:

```bash
git diff --check
git status --short
git diff --stat
rg -n "self-tap|Ø1\.7 pilot" hardware/pocket_card/case \
  --glob '!docs/superpowers/specs/*' \
  --glob '!docs/superpowers/plans/*'
```

Expected: no whitespace errors; only intended source/generated outputs are changed; the final search finds no live self-tapping assembly instruction or geometry constant.

- [ ] **Step 6: Commit regenerated release artifacts separately**

```bash
git add hardware/pocket_card/case/out \
  hardware/pocket_card/electronics/pocket_card_controller.kicad_pcb \
  hardware/pocket_card/electronics/mechanical_contract.json
git commit -m "build: regenerate Pocket Card captive nut enclosure"
```

- [ ] **Step 7: Record the physical validation handoff**

Report the exact selected coupon cavities, screw lengths, and 0.10 N·m initial torque limit from the generated BOM. The remaining physical gate is: print `nut_trap_coupon.stl` in SLA 8001, choose the smallest clean fit, print the front shell, and perform ten open-close cycles with no cracked roof, spinning nut, resin dust, or witness marks. Do not claim that physical gate has passed until the printed parts have actually been tested.
