# Pocket Card Default Sculpted Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the standard `make pocket_card_case` assembly contain the approved sculpted Undo, Action, Reset and Menu caps while retaining the original round direction caps and neutral fit gauges.

**Architecture:** Keep `build_variants.py`, `emboss_shells.py`, and every neutral manufacturing export unchanged. Add a final Make stage that invokes the existing `sculpted_buttons.py` exporter and `sculpted_buttons_blender.py` replacement pass, saving back to the standard `out/order/pocket_card_complete.blend`. Lock the command ordering with a Make dry-run regression and verify the saved Blender mesh identities headlessly.

**Tech Stack:** GNU Make, Python 3/CadQuery, Blender 5.x Python, `unittest`.

---

### Task 1: Integrate sculpted auxiliary caps into the standard build

**Files:**

- Modify: `hardware/pocket_card/case/test_emboss_shells.py`
- Modify: `Makefile`

- [ ] **Step 1: Write the failing Make-order test**

Extend `MakeIntegrationTest` so both `pocket_card_case` and
`pocket_card_case_shells` must schedule the existing commands in this order:

```python
output = result.stdout
build_index = output.index("build_variants.py")
finish_index = output.index("emboss_shells.py")
export_index = output.index("sculpted_buttons.py")
replace_index = output.index("sculpted_buttons_blender.py")
self.assertLess(build_index, finish_index)
self.assertLess(finish_index, export_index)
self.assertLess(export_index, replace_index)
self.assertIn("out/order/pocket_card_complete.blend", output)
self.assertNotIn("dpad_petals", output)
```

Also add a dry-run test for the reusable `pocket_card_case_sculpted` target,
requiring the exporter, replacement script, `out/sculpted_buttons/placed`, and
the standard complete-blend input/output path.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest test_emboss_shells.MakeIntegrationTest -v
```

Expected: failure because the current Make targets never mention
`sculpted_buttons.py` or `sculpted_buttons_blender.py`.

- [ ] **Step 3: Add the reusable final Make stage**

Add path variables for the existing exporter, Blender replacement script,
placed-cap directory, and standard completed assembly. Add
`pocket_card_case_sculpted` to `.PHONY`, with commands equivalent to:

```make
pocket_card_case_sculpted:
	@test -n "$(BLENDER)" || (echo "Blender not found; set BLENDER=/path/to/blender" >&2; exit 1)
	cd "$(POCKET_CARD_CASE_DIR)" && .venv/bin/python sculpted_buttons.py
	"$(BLENDER)" --background "$(POCKET_CARD_COMPLETE_BLEND)" \
		--python-exit-code 1 --python "$(POCKET_CARD_SCULPTED_BLEND_SCRIPT)" -- \
		--input "$(POCKET_CARD_COMPLETE_BLEND)" \
		--buttons-dir "$(POCKET_CARD_SCULPTED_PLACED_DIR)" \
		--output "$(POCKET_CARD_COMPLETE_BLEND)"
```

Invoke `$(MAKE) pocket_card_case_sculpted` only after `emboss_shells.py`
finishes inside `pocket_card_case_embossed`. Do not change
`build_variants.py`, `place_preview.py`, `coupon.py`, or any cap-set output.

- [ ] **Step 4: Run focused regression tests and verify GREEN**

Run:

```bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest test_emboss_shells.MakeIntegrationTest test_sculpted_buttons -v
```

Expected: all Make-order and sculpted-geometry tests pass.

- [ ] **Step 5: Commit the build integration**

```bash
git add Makefile hardware/pocket_card/case/test_emboss_shells.py
git commit -m "build sculpted buttons in standard Pocket Card model"
```

### Task 2: Document and verify the standard output

**Files:**

- Modify: `hardware/pocket_card/case/README.md`

- [ ] **Step 1: Update the build documentation**

State that `make pocket_card_case` and `make pocket_card_case_shells` now put
the approved sculpted auxiliary caps directly in
`out/order/pocket_card_complete.blend`. Document
`make pocket_card_case_sculpted` as the fast rerun when the neutral completed
assembly already exists. Keep the neutral clearance-coupon guidance intact.

- [ ] **Step 2: Run the real master-only finishing target**

Run from the repository root:

```bash
make pocket_card_case_embossed
```

Expected: the base finishing pass succeeds, the sculpted exporter writes eight
placed caps, and the replacement script reports the standard output path.

- [ ] **Step 3: Inspect the standard Blender output headlessly**

Run:

```bash
/Applications/Blender.app/Contents/MacOS/Blender \
  --background hardware/pocket_card/case/out/order/pocket_card_complete.blend \
  --python-expr "import bpy; assert bpy.data.objects['cap_action'].data.name == 'cap_action_sculpted_mesh'; assert bpy.data.objects['cap_up'].data.name == 'cap_up_sculpted_mesh'"
```

Expected: exit zero. The Action mesh comes from the convex sculpted exporter;
the direction replacement is the original neutral geometry already proven by
`test_direction_caps_keep_the_original_neutral_geometry`.

- [ ] **Step 4: Run final tests and repository-scope checks**

Run:

```bash
cd hardware/pocket_card/case
.venv/bin/python -m unittest test_sculpted_buttons test_emboss_shells -v
cd ../../../..
git diff --check
git status --short
```

Expected: all tests pass; only the intended source/docs files are staged or
committed. Existing user-generated changes under `hardware/pocket_card/case/out/`
remain unstaged and untouched by Git operations.

- [ ] **Step 5: Commit documentation**

```bash
git add hardware/pocket_card/case/README.md
git commit -m "document standard sculpted Pocket Card assembly"
```
