# Pocket Card Tapered Rear Clearance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the misplaced 2.40 mm north-edge bulge in the current pocket_card_complete.blend rear shell with a rounded, full-width deck at the real display-plug position and a shallow monotonic taper back to normal depth at the bottom.

**Architecture:** Keep dimensions and placement in params.py; express the outer back as one analytic YZ depth profile in side_arc.py before applying the existing perimeter roll; make shell_back.py, the solid checks, fastener selection, diagnostics, and Blender finishing pipeline consume that same profile. Regenerate the tracked mechanical artifacts while preserving the current complete Blender scene's non-shell objects, collections, materials, camera, lights, and authored transforms.

**Tech Stack:** Python 3.12, CadQuery/OCP, NumPy, matplotlib, unittest, GNU Make, Blender 5.2 LTS.

---

## Baseline prerequisite

The planning commit 02e0a351 was created from Pocket Card commit 16e0b311, while the canonical parametric bulge and tracked hardware/pocket_card/case/out/order/pocket_card_complete.blend are on current master. Do not rebase the planning checkout: its untracked hardware/pocket_card/electronics/ overlaps files tracked by current master. Use superpowers:using-git-worktrees to create an isolated implementation worktree from current master, then carry the approved specification into it:

~~~bash
git worktree add .worktrees/pocket-card-rear-deck \
  -b codex/pocket-card-rear-deck master
git -C .worktrees/pocket-card-rear-deck cherry-pick 02e0a351
git -C .worktrees/pocket-card-rear-deck \
  merge-base --is-ancestor master HEAD
~~~

Expected: the worktree is created without touching the planning checkout, the approved specification cherry-picks without conflicts, and the ancestry check exits 0. Execute every later command from the new worktree root unless a task explicitly changes directory.

Do not stage or modify these unrelated untracked paths:

- .build/monster_garden/
- hardware/pocket_card/case/out/.pcb.exports.lock
- hardware/pocket_card/case/out/sculpted_buttons/
- hardware/pocket_card/electronics/

### Task 1: Lock the corrected plug position and profile contract in tests

**Files:**

- Create: hardware/pocket_card/case/test_rear_profile.py
- Read: hardware/pocket_card/case/params.py
- Read: hardware/pocket_card/case/side_arc.py

- [ ] Create test_rear_profile.py with this initial contract:

~~~python
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import params as P  # noqa: E402
import side_arc  # noqa: E402


class DisplayPlugPlacementTest(unittest.TestCase):
    def test_plug_matches_complete_blend_assembly_coordinates(self):
        bounds = (
            P.DISPLAY_PLUG_X - P.DISPLAY_PLUG_BODY_L / 2,
            P.DISPLAY_PLUG_X + P.DISPLAY_PLUG_BODY_L / 2,
            P.DISPLAY_PLUG_Y - P.DISPLAY_PLUG_BODY_W / 2,
            P.DISPLAY_PLUG_Y + P.DISPLAY_PLUG_BODY_W / 2,
        )
        measured = (34.5476, 42.1976, 41.2781, 44.8781)
        for got, want in zip(bounds, measured):
            self.assertAlmostEqual(got, want, delta=0.06)

    def test_plug_is_at_display_lower_edge(self):
        self.assertGreaterEqual(
            P.DISPLAY_PLUG_Y,
            P.MOD_Y + 0.75 * P.MOD_H,
        )


class RearDeckProfileTest(unittest.TestCase):
    def sample(self, y0, y1, count=101):
        return [
            side_arc.rear_deck_extra_at(y0 + (y1 - y0) * i / (count - 1))
            for i in range(count)
        ]

    def test_top_is_normal_depth(self):
        self.assertEqual(side_arc.rear_deck_extra_at(0.0), 0.0)
        self.assertEqual(side_arc.rear_deck_extra_at(11.0), 0.0)
        self.assertEqual(
            side_arc.rear_deck_extra_at(P.DECK_RISE_Y0),
            0.0,
        )

    def test_full_depth_contains_plug_and_wall_allowance(self):
        plug_y0 = P.DISPLAY_PLUG_Y - P.DISPLAY_PLUG_BODY_W / 2
        plug_y1 = P.DISPLAY_PLUG_Y + P.DISPLAY_PLUG_BODY_W / 2
        allowance = P.DISPLAY_PLUG_CLEAR + P.WALL
        self.assertLessEqual(P.DECK_PLATEAU_Y0, plug_y0 - allowance)
        self.assertGreaterEqual(P.DECK_PLATEAU_Y1, plug_y1 + allowance)
        self.assertEqual(
            side_arc.rear_deck_extra_at(P.DISPLAY_PLUG_Y),
            P.DECK_H,
        )

    def test_rise_and_taper_are_monotonic(self):
        rise = self.sample(P.DECK_RISE_Y0, P.DECK_PLATEAU_Y0)
        taper = self.sample(P.DECK_PLATEAU_Y1, P.BODY_H)
        self.assertTrue(all(a <= b + 1e-9 for a, b in zip(rise, rise[1:])))
        self.assertTrue(all(a + 1e-9 >= b for a, b in zip(taper, taper[1:])))

    def test_bottom_is_normal_depth(self):
        self.assertEqual(side_arc.rear_deck_extra_at(P.BODY_H), 0.0)
        self.assertEqual(side_arc.rear_deck_extra_at(P.BODY_H + 1.0), 0.0)

    def test_existing_maximum_depth_is_not_exceeded(self):
        values = self.sample(0.0, P.BODY_H, count=501)
        self.assertGreater(max(values), 0.0)
        self.assertLessEqual(max(values), P.DECK_H + 1e-9)


if __name__ == "__main__":
    unittest.main()
~~~

- [ ] Run the new test:

~~~bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest test_rear_profile.py -v
~~~

Expected: FAIL because DISPLAY_PLUG_*, DECK_*, and rear_deck_extra_at() do not exist.

- [ ] Commit the red contract:

~~~bash
git add hardware/pocket_card/case/test_rear_profile.py
git commit -m "test: specify Pocket Card lower rear deck"
~~~

### Task 2: Correct the connector transform and derive deck breakpoints

**Files:**

- Modify: hardware/pocket_card/case/params.py:407-470
- Test: hardware/pocket_card/case/test_rear_profile.py

- [ ] Replace the mistaken BAT_*/RIB_* placement block with neutral display-plug and rear-deck constants. Keep the existing height and cable allowances exactly:

~~~python
# Authored display transform in pocket_card_complete.blend places this component
# at x 34.5476..42.1976, y 41.2781..44.8781, z -12.2148..-7.5148.
DISPLAY_PLUG_BODY_L = 7.65
DISPLAY_PLUG_BODY_W = 3.70
DISPLAY_PLUG_X = 38.3726
DISPLAY_PLUG_Y = 43.0781
DISPLAY_PLUG_CLEAR = 0.40
DISPLAY_PLUG_MATED_H = 5.70
DISPLAY_PLUG_CABLE = 0.80
DISPLAY_PLUG_ROLL_ALLOWANCE = 0.20

DECK_ZONE_T = (
    MODULE_Z + MOD_FRONT_STACK + DISPLAY_PLUG_MATED_H
    + DISPLAY_PLUG_CABLE + DISPLAY_PLUG_ROLL_ALLOWANCE + WALL
)
DECK_H = round(DECK_ZONE_T - BODY_T, 3)  # unchanged: 2.40 mm
DECK_FLOOR_Z = -DECK_ZONE_T + WALL

DECK_PLATEAU_Y0 = (
    DISPLAY_PLUG_Y - DISPLAY_PLUG_BODY_W / 2
    - DISPLAY_PLUG_CLEAR - WALL
)
DECK_PLATEAU_Y1 = (
    DISPLAY_PLUG_Y + DISPLAY_PLUG_BODY_W / 2
    + DISPLAY_PLUG_CLEAR + WALL
)

# Preserve the established rounded-shoulder slope.
DECK_RISE_PHI = 22.0
_deck_rise_p = _math.radians(DECK_RISE_PHI)
DECK_RISE_R = DECK_H / (2 * (1 - _math.cos(_deck_rise_p)))
DECK_RISE_RUN = 2 * DECK_RISE_R * _math.sin(_deck_rise_p)
DECK_RISE_Y0 = DECK_PLATEAU_Y0 - DECK_RISE_RUN

# Use all remaining length for a tangent lower return.
DECK_TAPER_Y0 = DECK_PLATEAU_Y1
DECK_TAPER_Y1 = BODY_H
DECK_TAPER_RUN = DECK_TAPER_Y1 - DECK_TAPER_Y0
DECK_TAPER_PHI = _math.degrees(2 * _math.atan(DECK_H / DECK_TAPER_RUN))
_deck_taper_p = _math.radians(DECK_TAPER_PHI)
DECK_TAPER_R = DECK_H / (2 * (1 - _math.cos(_deck_taper_p)))
~~~

- [ ] Add temporary BAT_*/RIB_* compatibility aliases for consumers migrated in Tasks 3 and 4. Mark them for removal in Task 4. Do not rename unrelated BATT_* pouch-cell constants or CONN_BAT_* controller headers.

- [ ] Run the placement tests:

~~~bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest test_rear_profile.DisplayPlugPlacementTest -v
~~~

Expected: PASS.

- [ ] Commit:

~~~bash
git add hardware/pocket_card/case/params.py
git commit -m "fix: place Pocket Card rear clearance at display plug"
~~~

### Task 3: Implement the analytic rise, plateau, and bottom taper

**Files:**

- Modify: hardware/pocket_card/case/side_arc.py:124-205
- Modify: hardware/pocket_card/case/test_rear_profile.py

- [ ] Add the scalar two-tangent-arc evaluator and public profile. This is the test oracle and must share the geometric breakpoints with the CadQuery wire:

~~~python
def _s_curve_depth(x: float, run: float, height: float, *, rising: bool) -> float:
    x = min(max(float(x), 0.0), run)
    phi = 2 * math.atan(height / run)
    radius = height / (2 * (1 - math.cos(phi)))
    half = run / 2
    if x <= half:
        theta = math.asin(min(x / radius, 1.0))
        taper_depth = height - radius * (1 - math.cos(theta))
    else:
        remaining = run - x
        theta = math.asin(min(remaining / radius, 1.0))
        taper_depth = radius * (1 - math.cos(theta))
    return height - taper_depth if rising else taper_depth


def rear_deck_extra_at(y: float) -> float:
    if y <= P.DECK_RISE_Y0 or y >= P.BODY_H:
        return 0.0
    if y < P.DECK_PLATEAU_Y0:
        return _s_curve_depth(
            y - P.DECK_RISE_Y0,
            P.DECK_RISE_RUN,
            P.DECK_H,
            rising=True,
        )
    if y <= P.DECK_PLATEAU_Y1:
        return P.DECK_H
    return _s_curve_depth(
        y - P.DECK_PLATEAU_Y1,
        P.DECK_TAPER_RUN,
        P.DECK_H,
        rising=False,
    )
~~~

- [ ] Replace _rib_region(inset) with _deck_region(inset). Construct one closed YZ wire in this sequence: normal top plane; two tangent rise arcs; maximum-depth plateau; two tangent return arcs ending on the normal plane at BODY_H; close toward the front; extrude across X.

- [ ] Preserve wall thickness using the current inset convention: subtract inset from Y breakpoints, use zn = -(BODY_T - inset), use zd = -(BODY_T + DECK_H - inset), and construct the profile before _roll_back().

- [ ] Rename _stepped_plan() to _profiled_plan() and replace the north-rib comments and RIB_* bounds guard with DECK_* language.

- [ ] Add an actual-envelope test:

~~~python
class RearDeckEnvelopeTest(unittest.TestCase):
    def test_centreline_has_thin_top_full_plug_depth_and_lower_return(self):
        x = P.BODY_W / 2
        z_top = side_arc.outer_back_z_at(x, 24.0)
        z_plug = side_arc.outer_back_z_at(x, P.DISPLAY_PLUG_Y)
        z_lower = side_arc.outer_back_z_at(x, 70.0)
        self.assertAlmostEqual(z_top, -P.BODY_T, delta=0.03)
        self.assertAlmostEqual(z_plug, -P.DECK_ZONE_T, delta=0.03)
        self.assertGreater(z_lower, z_plug)
        self.assertLess(z_lower, z_top)
~~~

- [ ] Run all new tests:

~~~bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest test_rear_profile.py -v
~~~

Expected: PASS.

- [ ] Commit:

~~~bash
git add hardware/pocket_card/case/side_arc.py \
  hardware/pocket_card/case/test_rear_profile.py
git commit -m "feat: taper Pocket Card rear deck below display plug"
~~~

### Task 4: Update the shell interior, solid checks, fasteners, and diagnostics

**Files:**

- Modify: hardware/pocket_card/case/shell_back.py:20-90,226-238
- Modify: hardware/pocket_card/case/checks.py:654-685,764-845,899-964,1222-1275
- Modify: hardware/pocket_card/case/joints.py:1-105
- Modify: hardware/pocket_card/case/params.py:590-605
- Modify: hardware/pocket_card/case/export_smt.py:195-220
- Rename: hardware/pocket_card/case/tools/bat_blister.py to hardware/pocket_card/case/tools/rear_deck.py
- Modify: hardware/pocket_card/case/tools/render_shell.py:15-40
- Modify: hardware/pocket_card/case/README.md:1-90,165-185
- Test: hardware/pocket_card/case/test_rear_profile.py
- Generate: hardware/pocket_card/case/out/hardware_BOM.csv
- Generate: hardware/pocket_card/case/out/rear_deck.png
- Generate: hardware/pocket_card/case/out/render_shell.png

- [ ] In shell_back.py, rename RIB_Z0 to DECK_Z0, consume DECK_ZONE_T and DECK_FLOOR_Z, and update lid()/interior_crop() comments. Preserve the split lap and wall construction.

- [ ] After shell_back.py, checks.py, side_arc.py, and the diagnostic have moved to DECK_*/DISPLAY_PLUG_*, delete the temporary BAT_*/RIB_* compatibility aliases from params.py and confirm git grep finds no legacy connector-profile reference outside historical documentation.

- [ ] Rewrite check_back_shell() so every STL vertex is bounded by the scalar profile. Convert model Y with y_layout = BODY_H - y_model, then reject any vertex deeper than:

~~~python
allowed_z = -(P.BODY_T + side_arc.rear_deck_extra_at(y_layout)) - 0.02
~~~

- [ ] Rename check_bat_header() to check_display_plug(). Keep its real solid-intersection test and unchanged 5.70 + 0.80 mm budget. Check both plateau ends with:

~~~python
north = (
    P.DISPLAY_PLUG_Y - P.DISPLAY_PLUG_BODY_W / 2
    - P.DISPLAY_PLUG_CLEAR - P.WALL
)
south = (
    P.DISPLAY_PLUG_Y + P.DISPLAY_PLUG_BODY_W / 2
    + P.DISPLAY_PLUG_CLEAR + P.WALL
)
ok = P.DECK_PLATEAU_Y0 <= north and south <= P.DECK_PLATEAU_Y1
~~~

- [ ] Update check_back_roll() to sample both transitions at 0.1 mm in Y across the width. Enforce continuity, the required monotonic directions, and maximum slopes no greater than DECK_RISE_PHI + 0.5 degrees and DECK_TAPER_PHI + 0.5 degrees.

- [ ] Add a pure screw-selection helper in joints.py. The shank must bridge from the rear seat to the applicable front pilot and retain at least 2.5 mm of thread engagement. Select the shortest stocked length from (8.0, 10.0, 12.0). Add a test asserting that all six joints are represented exactly once and satisfy the engagement rule.

- [ ] Replace the location-based SCREW_NORTH/SCREW_SOUTH BOM groups with groups derived from selected length. Regenerate hardware_BOM.csv and the README fastener table. Do not assume the old north pair remains the long pair.

- [ ] Rename and rewrite tools/rear_deck.py to plot the corrected plug, rise start, plateau bounds, maximum 2.40 mm depth, lower taper, and zero offset at the bottom. Update render_shell.py captions to remove north-rib language.

- [ ] Generate and verify the mechanical outputs without invoking Blender finishing:

~~~bash
cd hardware/pocket_card/case
.venv/bin/python build_variants.py
.venv/bin/python checks.py
.venv/bin/python tools/rear_deck.py
.venv/bin/python tools/render_shell.py out/order/shell_back.stl
~~~

Expected: checks.py ends with "all checks passed"; the diagnostic reports 2.40 mm maximum extra depth at the display plug and zero at BODY_H.

- [ ] Inspect out/rear_deck.png and out/render_shell.png. Fix any middle wart, full-width cliff, side-wall step, non-tangent highlight, or residual bottom thickness before continuing.

- [ ] Commit source, tests, BOM, and diagnostics:

~~~bash
git add hardware/pocket_card/case/params.py \
  hardware/pocket_card/case/side_arc.py \
  hardware/pocket_card/case/shell_back.py \
  hardware/pocket_card/case/checks.py \
  hardware/pocket_card/case/joints.py \
  hardware/pocket_card/case/export_smt.py \
  hardware/pocket_card/case/test_rear_profile.py \
  hardware/pocket_card/case/tools/rear_deck.py \
  hardware/pocket_card/case/tools/render_shell.py \
  hardware/pocket_card/case/README.md \
  hardware/pocket_card/case/out/hardware_BOM.csv \
  hardware/pocket_card/case/out/rear_deck.png \
  hardware/pocket_card/case/out/render_shell.png
git commit -m "fix: move Pocket Card clearance deck to display plug"
~~~

### Task 5: Preserve the current complete Blender scene during regeneration

**Files:**

- Modify: hardware/pocket_card/case/emboss_shells.py:30-70,150-260,330-560
- Modify: hardware/pocket_card/case/sculpted_buttons_blender.py:45-115
- Modify: hardware/pocket_card/case/test_emboss_shells.py:1-210
- Modify: hardware/pocket_card/case/test_sculpted_buttons.py:1-35
- Modify: hardware/pocket_card/case/README.md:45-90

- [ ] Add a failing Blender integration test that runs the finisher twice in a temporary output directory. Between runs, add a sentinel collection, camera, light, non-identity transforms, and a custom property. Assert the second run preserves all sentinels, transforms, materials, memberships, and non-shell mesh hashes while updating shell mesh hashes.

- [ ] In emboss_shells.py, treat an existing output-dir/pocket_card_complete.blend as the assembly source. After evaluating the template's shell modifiers, open the source and replace only the mesh data of shell_front_embossed and shell_back_embossed. Preserve object identity, transforms, materials, collection membership, custom properties, camera, lights, world, render settings, and unrelated collections. Save to the existing staging path before publish() swaps it into place.

- [ ] If there is no existing complete blend, retain the current clean four-collection assembly path.

- [ ] Replace mesh data rather than deleting transformed objects:

~~~python
old_mesh = target.data
target.data = imported.data
bpy.data.objects.remove(imported, do_unlink=True)
if old_mesh.users == 0:
    bpy.data.meshes.remove(old_mesh)
~~~

Validate local X/Y bounds within 0.05 mm and snapshot all non-shell world matrices and collection memberships before saving.

- [ ] Change sculpted_buttons_blender.py to replace each existing button object's mesh data the same way. This keeps the current lookdev transforms; delete-and-reimport resets them to identity.

- [ ] Run focused tests:

~~~bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest \
  test_emboss_shells.BlenderFinishIntegrationTest \
  test_sculpted_buttons.SculptedButtonGeometryTest -v
~~~

Expected: PASS, including preservation of the sentinel lookdev scene.

- [ ] Commit:

~~~bash
git add hardware/pocket_card/case/emboss_shells.py \
  hardware/pocket_card/case/sculpted_buttons_blender.py \
  hardware/pocket_card/case/test_emboss_shells.py \
  hardware/pocket_card/case/test_sculpted_buttons.py \
  hardware/pocket_card/case/README.md
git commit -m "fix: preserve Pocket Card Blender lookdev during rebuild"
~~~

### Task 6: Regenerate and verify the exact complete assembly

**Files:**

- Create: hardware/pocket_card/case/tools/verify_complete_rear_profile.py
- Generate: hardware/pocket_card/case/out/shell_back.stl
- Generate: hardware/pocket_card/case/out/shell_back.step
- Generate: hardware/pocket_card/case/out/order/shell_back.stl
- Generate: hardware/pocket_card/case/out/order/shell_back.step
- Generate: hardware/pocket_card/case/out/order/shell_back_embossed.stl
- Generate: hardware/pocket_card/case/out/order/assembly.stl
- Generate: hardware/pocket_card/case/out/order/assembly.step
- Generate: hardware/pocket_card/case/out/order/preview/shell_back.stl
- Generate: hardware/pocket_card/case/out/order/preview/assembly.stl
- Generate: hardware/pocket_card/case/out/order/preview/assembly.step
- Generate: hardware/pocket_card/case/out/order/pocket_card_complete.blend

- [ ] Record the pre-build complete-scene inventory: object names; collection names and membership; materials; modifiers; world transforms; camera/light names; and QLE contents.

- [ ] Run the supported shell-only build:

~~~bash
make pocket_card_case_shells
~~~

Expected: PCB exports validate, CadQuery artifacts regenerate, Blender updates only shell mesh data, the sculpted pass preserves transforms, and the command exits 0.

- [ ] Compare the post-build inventory with the pre-build dump. Only shell mesh data/bounds and generated mechanical hashes may differ. Backdrop, Camera, Lights_Target, the four area lights, QLE collection, materials, and every non-shell transform must be unchanged.

- [ ] Add verify_complete_rear_profile.py. It must validate the complete scene inventory, transformed shell bounds, normal top depth, maximum depth at the plug line, and return toward normal depth below it. Run:

~~~bash
/Applications/Blender.app/Contents/MacOS/Blender \
  --background hardware/pocket_card/case/out/order/pocket_card_complete.blend \
  --python-exit-code 1 \
  --python hardware/pocket_card/case/tools/verify_complete_rear_profile.py
~~~

Expected: exit 0 with explicit PASS lines for inventory and profile.

- [ ] Render rear, side, and three-quarter views from the preserved scene. Confirm the production 2.40 mm difference reads as a thin screen section, a soft shoulder at the plug line, and a gentler lower return—not the exaggerated concept sketch.

- [ ] Run final verification:

~~~bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest test_rear_profile.py -v
.venv/bin/python -m unittest test_emboss_shells.py test_sculpted_buttons.py -v
.venv/bin/python checks.py
cd ../../..
git diff --check
git status --short
~~~

Expected: all tests pass, checks.py says "all checks passed", diff check is silent, and only planned Pocket Card files plus the pre-existing unrelated untracked paths appear.

- [ ] Commit the verifier and generated artifacts:

~~~bash
git add hardware/pocket_card/case/tools/verify_complete_rear_profile.py \
  hardware/pocket_card/case/out/shell_back.stl \
  hardware/pocket_card/case/out/shell_back.step \
  hardware/pocket_card/case/out/order/shell_back.stl \
  hardware/pocket_card/case/out/order/shell_back.step \
  hardware/pocket_card/case/out/order/shell_back_embossed.stl \
  hardware/pocket_card/case/out/order/assembly.stl \
  hardware/pocket_card/case/out/order/assembly.step \
  hardware/pocket_card/case/out/order/preview/shell_back.stl \
  hardware/pocket_card/case/out/order/preview/assembly.stl \
  hardware/pocket_card/case/out/order/preview/assembly.step \
  hardware/pocket_card/case/out/order/pocket_card_complete.blend
git commit -m "build: regenerate Pocket Card tapered rear deck"
~~~

### Task 7: Physical acceptance

**Files:**

- Reference: docs/superpowers/specs/2026-08-26-handheld-speaker-clearance-rear-profile-design.md
- Print: hardware/pocket_card/case/out/order/shell_back_embossed.stl

- [ ] Print the revised rear shell without changing orientation or scale.

- [ ] Assemble it with the real display PCB, connected plug, and speaker leads. Confirm the seam seats fully without extra closing force, wire deflection, pinching, or connector loading.

- [ ] Re-open it and inspect the plug and wires for witness marks.

- [ ] Place the device rear-down and confirm the taper does not create unacceptable rocking.

- [ ] If it fails, record the exact interference or rocking location before changing any clearance value; do not silently enlarge the full deck.
