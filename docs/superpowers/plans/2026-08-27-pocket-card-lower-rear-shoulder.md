# Pocket Card Lower Rear Shoulder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Pocket Card rear deck's upper shoulder exactly 5.00 mm toward the plug while retaining the proven 2.40 mm plug clearance, the fixed plug plateau, and the existing lower taper to normal case depth.

**Architecture:** Keep the plug-derived plateau and maximum depth unchanged in `params.py`. Preserve the existing two-tangent-arc profile implementation in `side_arc.py`, but derive a shorter upper run from an explicit 5.00 mm start shift and recompute the arc angle/radius from that run. Regenerate every published rear-shell alias and the authored complete Blender assembly, replacing only shell mesh data in the final `.blend` so all non-shell lookdev data remains exactly equivalent at the semantic inventory level.

**Tech Stack:** Python 3.12, CadQuery/OCP, NumPy, matplotlib, unittest, GNU Make, Blender 5.2 LTS.

---

## Working context and invariants

Execute every command from the existing isolated worktree unless a step explicitly changes directory:

~~~text
/Users/stephenlavelle/Documents/GitHub/PuzzleScript-labs/.worktrees/pocket-card-rear-deck
~~~

The approved design specification is:

~~~text
docs/superpowers/specs/2026-08-26-handheld-speaker-clearance-rear-profile-design.md
~~~

Do not change these established values:

- `DECK_H = 2.40` mm.
- `DECK_PLATEAU_Y0 = 39.3281` mm.
- `DECK_PLATEAU_Y1 = 46.8281` mm.
- Display-plug, cable, wall, and perimeter-roll clearance allowances.
- `DECK_TAPER_Y0`, `DECK_TAPER_Y1`, `DECK_TAPER_PHI`, and `DECK_TAPER_R` derivation.
- Any front-shell, PCB, button, camera, light, backdrop, material, collection, or QLE data.

The old upper rise begins at `26.9811703617` mm. The approved revision begins at `31.9811703617` mm, ends at the same plateau, and therefore has a `7.3469296383` mm run with a recomputed tangent angle of `36.1810208032` degrees.

### Task 1: Lock the 5 mm shift and unchanged plateau in a failing unit test

**Files:**

- Modify: `hardware/pocket_card/case/test_rear_profile.py:1-90`
- Test: `hardware/pocket_card/case/test_rear_profile.py`

- [ ] Add `import math` before the existing standard-library imports.

- [ ] Add this method to `RearDeckProfileTest` after `test_top_is_normal_depth`:

~~~python
    def test_rise_starts_five_mm_later_without_moving_plug_plateau(self):
        reference_phi = math.radians(P.DECK_RISE_REFERENCE_PHI)
        reference_radius = P.DECK_H / (
            2 * (1 - math.cos(reference_phi))
        )
        reference_run = 2 * reference_radius * math.sin(reference_phi)
        previous_rise_y0 = P.DECK_PLATEAU_Y0 - reference_run

        self.assertAlmostEqual(P.DECK_RISE_START_SHIFT, 5.0, places=6)
        self.assertAlmostEqual(
            P.DECK_RISE_Y0,
            previous_rise_y0 + P.DECK_RISE_START_SHIFT,
            places=9,
        )
        self.assertAlmostEqual(P.DECK_RISE_Y0, 31.9811703617, places=9)
        self.assertAlmostEqual(P.DECK_RISE_RUN, 7.3469296383, places=9)
        self.assertAlmostEqual(P.DECK_RISE_PHI, 36.1810208032, places=6)
        self.assertAlmostEqual(P.DECK_PLATEAU_Y0, 39.3281, places=4)
        self.assertAlmostEqual(P.DECK_PLATEAU_Y1, 46.8281, places=4)
        self.assertEqual(P.DECK_TAPER_Y0, P.DECK_PLATEAU_Y1)
        self.assertEqual(P.DECK_TAPER_Y1, P.BODY_H)
~~~

- [ ] Strengthen `test_top_is_normal_depth` with the concrete witness point that motivated the revision:

~~~python
        self.assertEqual(side_arc.rear_deck_extra_at(30.0), 0.0)
~~~

- [ ] Run the focused test:

~~~bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest \
  test_rear_profile.RearDeckProfileTest.test_rise_starts_five_mm_later_without_moving_plug_plateau \
  -v
~~~

Expected: FAIL with `AttributeError` because `DECK_RISE_REFERENCE_PHI` and `DECK_RISE_START_SHIFT` do not exist yet. Do not weaken the numeric assertions.

- [ ] Commit the red contract:

~~~bash
cd ../../..
git add hardware/pocket_card/case/test_rear_profile.py
git commit -m "test: specify lower Pocket Card rear shoulder"
~~~

### Task 2: Derive the shorter tangent rise from the approved shift

**Files:**

- Modify: `hardware/pocket_card/case/params.py:437-454`
- Test: `hardware/pocket_card/case/test_rear_profile.py`
- Read: `hardware/pocket_card/case/side_arc.py`

- [ ] Replace only the current upper-rise derivation in `params.py`:

~~~python
# Move the upper shoulder 5 mm toward the plug while retaining the original
# 22-degree profile as an explicit reference for the previous start point.
DECK_RISE_REFERENCE_PHI = 22.0
DECK_RISE_START_SHIFT = 5.0
_deck_rise_reference_p = _math.radians(DECK_RISE_REFERENCE_PHI)
_deck_rise_reference_r = DECK_H / (
    2 * (1 - _math.cos(_deck_rise_reference_p))
)
_deck_rise_reference_run = (
    2 * _deck_rise_reference_r * _math.sin(_deck_rise_reference_p)
)
DECK_RISE_Y0 = (
    DECK_PLATEAU_Y0 - _deck_rise_reference_run + DECK_RISE_START_SHIFT
)
DECK_RISE_RUN = DECK_PLATEAU_Y0 - DECK_RISE_Y0
DECK_RISE_PHI = _math.degrees(2 * _math.atan(DECK_H / DECK_RISE_RUN))
_deck_rise_p = _math.radians(DECK_RISE_PHI)
DECK_RISE_R = DECK_H / (2 * (1 - _math.cos(_deck_rise_p)))
~~~

Do not edit `_s_curve_depth()`, `rear_deck_extra_at()`, or `_deck_region()`: they already consume `DECK_RISE_Y0`, `DECK_RISE_RUN`, `DECK_RISE_PHI`, and `DECK_RISE_R`, so the revised parameters preserve the approved two-arc construction.

- [ ] Run the focused profile tests:

~~~bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest test_rear_profile.RearDeckProfileTest -v
~~~

Expected: all six profile tests pass, including zero added depth at layout `y=30.0`, full 2.40 mm depth across the unchanged plug plateau, and a zero-depth bottom.

- [ ] Run the complete mechanical contract:

~~~bash
.venv/bin/python -m unittest test_rear_profile.py test_screw_selection.py -v
.venv/bin/python checks.py
~~~

Expected: 24 tests pass; `checks.py` reports zero plug/cable intersections, one valid solid, monotonic upper and lower transitions, upper maximum slope no greater than `36.6811` degrees, and ends with `all checks passed`.

- [ ] Review the parameter diff. Confirm `DECK_PLATEAU_Y0`, `DECK_PLATEAU_Y1`, `DECK_H`, and the full lower-taper block are unchanged.

- [ ] Commit the geometry source:

~~~bash
cd ../../..
git add hardware/pocket_card/case/params.py
git commit -m "fix: lower Pocket Card rear shoulder start"
~~~

### Task 3: Add a failing native-mesh witness at y=30 mm

**Files:**

- Modify: `hardware/pocket_card/case/tools/verify_complete_rear_profile.py:244-301`
- Test: `hardware/pocket_card/case/out/order/pocket_card_complete.blend`

- [ ] Add the new native-mesh sample between `top_y24` and `rise_start`:

~~~python
        "upper_y30": -(sample(30.0) + P.BODY_T),
~~~

- [ ] Add the corresponding assertion after the existing `top_y24` assertion:

~~~python
    require_close(depths["upper_y30"], 0.0, 0.08, "upper y=30 added depth")
~~~

- [ ] Update the PASS message to say the native shell is thin at `y=10/y=24/y=30`.

- [ ] Run the verifier against the still-unregenerated canonical assembly:

~~~bash
/Applications/Blender.app/Contents/MacOS/Blender \
  --background hardware/pocket_card/case/out/order/pocket_card_complete.blend \
  --python-exit-code 1 \
  --python hardware/pocket_card/case/tools/verify_complete_rear_profile.py
~~~

Expected: FAIL at `upper y=30 added depth`. The existing mesh still contains roughly 0.28 mm of the old shoulder there; this proves the integration check distinguishes the requested revision from the previous product.

- [ ] Commit the red assembly contract:

~~~bash
git add hardware/pocket_card/case/tools/verify_complete_rear_profile.py
git commit -m "test: verify lower Pocket Card shoulder in assembly"
~~~

### Task 4: Regenerate all rear-shell products without disturbing authored lookdev

**Files:**

- Generate: `hardware/pocket_card/case/out/shell_back.stl`
- Generate: `hardware/pocket_card/case/out/shell_back.step`
- Generate: `hardware/pocket_card/case/out/order/shell_back.stl`
- Generate: `hardware/pocket_card/case/out/order/shell_back.step`
- Generate: `hardware/pocket_card/case/out/order/shell_back_embossed.stl`
- Generate: `hardware/pocket_card/case/out/order/assembly.stl`
- Generate: `hardware/pocket_card/case/out/order/assembly.step`
- Generate: `hardware/pocket_card/case/out/order/preview/shell_back.stl`
- Generate: `hardware/pocket_card/case/out/order/preview/assembly.stl`
- Generate: `hardware/pocket_card/case/out/order/preview/assembly.step`
- Generate: `hardware/pocket_card/case/out/order/pocket_card_complete.blend`
- Generate: `hardware/pocket_card/case/out/rear_deck.png`
- Generate: `hardware/pocket_card/case/out/render_shell.png`

- [ ] Confirm the worktree is clean, then create an explicit same-directory safety copy. Keeping it beside the canonical file ensures Blender-relative assets resolve identically during the semantic comparison:

~~~bash
git status --short
test ! -e hardware/pocket_card/case/out/order/.pocket_card_complete.shoulder-backup.blend
cp hardware/pocket_card/case/out/order/pocket_card_complete.blend \
  hardware/pocket_card/case/out/order/.pocket_card_complete.shoulder-backup.blend
~~~

Expected: `git status --short` is empty before the copy; the hidden backup is untracked and non-empty afterward.

- [ ] Run the supported product build:

~~~bash
make pocket_card_case_shells
~~~

Expected: the PCB currentness check passes without regenerating electronics; all CadQuery and order-pack products regenerate; Blender finishing and sculpted-button passes exit 0.

- [ ] The supported target currently rewrites eight button mesh datablocks even when their geometry is unrelated. Restore the exact pre-build authored assembly, then rerun only the shell finisher so the final `.blend` receives the new shell meshes but retains the original buttons and all other lookdev data:

~~~bash
cp hardware/pocket_card/case/out/order/.pocket_card_complete.shoulder-backup.blend \
  hardware/pocket_card/case/out/order/pocket_card_complete.blend
/Applications/Blender.app/Contents/MacOS/Blender \
  --background hardware/card/case/case_updated.blend \
  --python-exit-code 1 \
  --python hardware/pocket_card/case/emboss_shells.py
~~~

Expected: the finisher publishes `shell_front_embossed.stl`, `shell_back_embossed.stl`, and `pocket_card_complete.blend`; it does not invoke the sculpted-button replacement pass.

- [ ] Compare the backup and final canonical assembly with the established semantic inventory helper:

~~~bash
cd hardware/pocket_card/case
.venv/bin/python -c '
from pathlib import Path
from test_emboss_shells import inspect_blend, SHELL_OBJECTS

before = inspect_blend(Path("out/order/.pocket_card_complete.shoulder-backup.blend"))
after = inspect_blend(Path("out/order/pocket_card_complete.blend"))
preserved = (
    "collections", "collection_children", "objects", "materials",
    "transforms", "modifiers", "memberships", "world_matrices",
    "parents", "custom_properties", "display_transform",
    "display_material_count", "display_images", "scene", "world",
    "cameras", "lights", "relative_resources",
)
for key in preserved:
    assert after[key] == before[key], key
for name, old_hash in before["mesh_hashes"].items():
    if name not in SHELL_OBJECTS:
        assert after["mesh_hashes"][name] == old_hash, name
        assert after["mesh_data_names"][name] == before["mesh_data_names"][name], name
assert after["mesh_hashes"]["shell_back_embossed"] != before["mesh_hashes"]["shell_back_embossed"]
print("PASS exact non-shell assembly preservation; rear shell mesh changed")
'
~~~

Expected: the command prints the PASS line. It checks every non-shell mesh hash, object transform, collection membership, material assignment, camera/light setting, world setting, QLE relationship, custom property, and relative resource.

- [ ] After the comparison passes, remove only the explicit safety copy:

~~~bash
cd ../../..
rm -f hardware/pocket_card/case/out/order/.pocket_card_complete.shoulder-backup.blend
~~~

- [ ] Refresh the two tracked engineering diagnostics:

~~~bash
cd hardware/pocket_card/case
.venv/bin/python tools/rear_deck.py
.venv/bin/python tools/render_shell.py out/order/shell_back.stl
~~~

Expected: `rear_deck.py` reports a 2.40 mm maximum, an upper shoulder beginning near `y=31.98`, and zero added depth at the bottom; both PNGs show that `y=30` remains on the normal rear plane and that the same long lower return is intact.

- [ ] Run the updated canonical-assembly verifier:

~~~bash
cd ../../..
/Applications/Blender.app/Contents/MacOS/Blender \
  --background hardware/pocket_card/case/out/order/pocket_card_complete.blend \
  --python-exit-code 1 \
  --python hardware/pocket_card/case/tools/verify_complete_rear_profile.py
~~~

Expected: PASS lines for the 23-object/5-collection authored inventory, transformed shell bounds, and the native profile including zero added depth at `y=30`.

- [ ] Render the three unsaved review views from the canonical assembly. The helper changes materials, camera, and lighting only in memory and does not save the `.blend`:

~~~bash
/Applications/Blender.app/Contents/MacOS/Blender \
  --background hardware/pocket_card/case/out/order/pocket_card_complete.blend \
  --python-exit-code 1 \
  --python /tmp/render_pocket_card_final.py
~~~

Expected outputs:

~~~text
/Users/stephenlavelle/.codex/visualizations/2026/08/26/01a03eec-39e9-78c1-bc46-df94f15cdf45/pocket_card_final_rear.png
/Users/stephenlavelle/.codex/visualizations/2026/08/26/01a03eec-39e9-78c1-bc46-df94f15cdf45/pocket_card_final_side.png
/Users/stephenlavelle/.codex/visualizations/2026/08/26/01a03eec-39e9-78c1-bc46-df94f15cdf45/pocket_card_final_three_quarter.png
~~~

- [ ] Inspect `out/rear_deck.png`, `out/render_shell.png`, and all three review renders. Confirm the screen region stays at normal thickness through `y=30`, the shorter rounded step blends into the lower case, the plug plateau remains full-depth, and the lower deck still tapers to normal depth by the bottom. Reject any discontinuity, centre wart, side-wall ledge, or reduction of the plug plateau.

- [ ] Run the final regression suite:

~~~bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest test_rear_profile.py test_screw_selection.py -v
.venv/bin/python -m unittest test_emboss_shells.py test_sculpted_buttons.py -v
.venv/bin/python checks.py
cd ../../..
node src/tests/run_tests_node.js
git diff --check
git status --short
~~~

Expected: 24 mechanical tests pass; 19 Blender-preservation tests pass; `checks.py` ends with `all checks passed`; 759 PuzzleScript tests pass; `git diff --check` is silent; status contains only the planned source, diagnostic, rear-shell, assembly, and canonical `.blend` changes.

- [ ] Confirm all four unembossed published rear-shell aliases match the current generator through `PublishedRearShellArtifactsTest`, already included in `test_rear_profile.py`. Confirm no front-shell, PCB, or button artifact appears in `git status`.

- [ ] Commit the regenerated product:

~~~bash
git add hardware/pocket_card/case/out/shell_back.stl \
  hardware/pocket_card/case/out/shell_back.step \
  hardware/pocket_card/case/out/order/shell_back.stl \
  hardware/pocket_card/case/out/order/shell_back.step \
  hardware/pocket_card/case/out/order/shell_back_embossed.stl \
  hardware/pocket_card/case/out/order/assembly.stl \
  hardware/pocket_card/case/out/order/assembly.step \
  hardware/pocket_card/case/out/order/preview/shell_back.stl \
  hardware/pocket_card/case/out/order/preview/assembly.stl \
  hardware/pocket_card/case/out/order/preview/assembly.step \
  hardware/pocket_card/case/out/order/pocket_card_complete.blend \
  hardware/pocket_card/case/out/rear_deck.png \
  hardware/pocket_card/case/out/render_shell.png
git commit -m "build: regenerate Pocket Card lowered rear shoulder"
~~~

- [ ] Run `git status --short` once more. Expected: empty. Do not claim physical connector clearance is proven until the revised rear shell is printed and assembled with the real mated plug and speaker leads.
