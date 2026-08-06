# Pocket Card Decorative Silk Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Default the native Pocket Card board to readable silk (UI legends + KiCad refs) with a `DECORATIVE_SILK` flag to restore brick/rules/logo later.

**Architecture:** `params.DECORATIVE_SILK` gates layout construction and brick paint in `silk_layout.py` / `silk.py`. Board refresh strips decorative `gr_rect`s and syncs Reference visibility. Silk DRC waiver digests in `validation.py` + `validation_waivers.json` are regenerated from a real DRC run after the board refresh.

**Tech Stack:** Python 3, Pillow (existing silk rasterizer), KiCad 10 CLI, unittest.

**Spec:** `docs/superpowers/specs/2026-08-06-pocket-card-decorative-silk-toggle-design.md`

---

## File structure

- Modify: `hardware/pocket_card/case/params.py` — add `DECORATIVE_SILK = False`
- Modify: `hardware/pocket_card/case/silk_layout.py` — omit rules/logo layers when flag false
- Modify: `hardware/pocket_card/case/silk.py` — skip brick paint; sync Reference hide/show in `refresh_board_silk`
- Create: `hardware/pocket_card/case/test_decorative_silk.py` — unit tests for flag behavior
- Modify: `hardware/pocket_card/electronics/pocket_card_controller.kicad_pcb` — refresh silk + refs
- Modify: `hardware/pocket_card/electronics/validation_waivers.json` — silk group counts/digests
- Modify: `hardware/pocket_card/electronics_pipeline/validation.py` — `_EXPECTED_WARNING_POLICY` / rationales for new silk baseline
- Modify: `hardware/pocket_card/electronics_pipeline/tests/test_validation.py` — only if it hardcodes old silk counts
- Modify: `hardware/pocket_card/case/README.md` and/or `electronics/README.md` — one-line operator note

---

## Task 1: Flag + generator unit tests

**Files:**
- Create: `hardware/pocket_card/case/test_decorative_silk.py`
- Modify: `hardware/pocket_card/case/params.py`
- Modify: `hardware/pocket_card/case/silk_layout.py`
- Modify: `hardware/pocket_card/case/silk.py`

- [ ] **Step 1: Write failing tests**

```python
# hardware/pocket_card/case/test_decorative_silk.py
import unittest
from unittest import mock

import params as P
import silk
import silk_layout as L


class DecorativeSilkTest(unittest.TestCase):
    def test_flag_defaults_false(self):
        self.assertFalse(P.DECORATIVE_SILK)

    def test_layout_omits_rules_and_logo_when_decorative_off(self):
        with mock.patch.object(P, "DECORATIVE_SILK", False):
            front, back = L.build_both()
        for side in (front, back):
            self.assertEqual(side.rule_count, 0)
            self.assertEqual(len(side.layers), 1)
            self.assertGreater(len(side.layers[0].texts), 0)

    def test_layout_keeps_full_stack_when_decorative_on(self):
        with mock.patch.object(P, "DECORATIVE_SILK", True):
            front, _ = L.build_both()
        self.assertEqual(len(front.layers), 3)
        self.assertGreater(front.rule_count, 0)

    def test_raster_skips_brick_when_decorative_off(self):
        with mock.patch.object(P, "DECORATIVE_SILK", False):
            front, _ = L.build_both()
            with mock.patch.object(L, "brick_rects_full", return_value=[(0, 0, 10, 10)]) as brick:
                silk.rasterize_side(front, mirror_glyphs=False)
        brick.assert_not_called()


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests and verify they fail**

```bash
cd hardware/pocket_card/case && python3 -m unittest test_decorative_silk -v
```

Expected: `DECORATIVE_SILK` missing / full stack still built.

- [ ] **Step 3: Implement flag and generator gating**

In `params.py` near other board flags:

```python
DECORATIVE_SILK = False  # True restores brick + rules + logo on F/B.SilkS
```

In `silk_layout.build_front` / `build_back`: when `not getattr(P, "DECORATIVE_SILK", True)`, build only the labels `Layer` and set `rule_count=0`; otherwise keep current `layers=[rules, logo, labels]`.

In `silk.rasterize_side`: wrap the L0 brick loop in `if getattr(P, "DECORATIVE_SILK", True):`.

- [ ] **Step 4: Re-run tests**

```bash
cd hardware/pocket_card/case && python3 -m unittest test_decorative_silk -v
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add hardware/pocket_card/case/params.py hardware/pocket_card/case/silk_layout.py \
  hardware/pocket_card/case/silk.py hardware/pocket_card/case/test_decorative_silk.py
git commit -m "feat: gate Pocket Card decorative silkscreen behind a flag"
```

---

## Task 2: Board refresh syncs silk rects and Reference visibility

**Files:**
- Modify: `hardware/pocket_card/case/silk.py` (`refresh_board_silk`)
- Modify: `hardware/pocket_card/case/test_decorative_silk.py`

- [ ] **Step 1: Extend tests for Reference sync**

Add to `test_decorative_silk.py`:

```python
    def test_refresh_unhides_references_when_decorative_off(self):
        board = (
            '(kicad_pcb\n'
            '\t(gr_rect\n'
            '\t\t(start 0 0)\n'
            '\t\t(end 1 1)\n'
            '\t\t(stroke (width 0) (type default))\n'
            '\t\t(fill yes)\n'
            '\t\t(layer "F.SilkS")\n'
            '\t\t(uuid "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")\n'
            '\t)\n'
            '\t(footprint "Lib:FP"\n'
            '\t\t(layer "F.Cu")\n'
            '\t\t(uuid "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")\n'
            '\t\t(property "Reference" "U1"\n'
            '\t\t\t(at 0 0 0)\n'
            '\t\t\t(layer "F.SilkS")\n'
            '\t\t\t(hide yes)\n'
            '\t\t\t(uuid "cccccccc-cccc-4ccc-8ccc-cccccccccccc")\n'
            '\t\t)\n'
            '\t)\n'
            '\t(embedded_fonts no)\n'
            ')\n'
        )
        path = self._write_temp_board(board)
        with mock.patch.object(P, "DECORATIVE_SILK", False):
            with mock.patch.object(silk, "silk_sexpr", return_value=""):
                silk.refresh_board_silk(path)
        text = open(path, encoding="utf-8").read()
        self.assertNotIn('(layer "F.SilkS")\n', text.split('property "Reference"', 1)[0][-200:] if False else text)
        ref_block = text.split('(property "Reference" "U1"', 1)[1].split("(property", 1)[0]
        self.assertNotIn("(hide yes)", ref_block)
        self.assertNotIn('(gr_rect\n', text)
```

Implement a small `_write_temp_board` helper with `tempfile`. Also add the inverse test: with `DECORATIVE_SILK=True`, refresh inserts `(hide yes)` on Reference if missing.

- [ ] **Step 2: Implement Reference sync in `refresh_board_silk`**

After replacing silk `gr_rect`s:

- If decorative off: remove `\t\t(hide yes)\n` lines that immediately follow a Reference property's silk layer line (or any `(hide yes)` directly under `property "Reference"` blocks). Prefer a conservative regex scoped to `property "Reference"` … next property/close.
- If decorative on: ensure Reference blocks on silk layers include `(hide yes)` (same pattern `pcb.py` already uses).

Keep `Value` hidden either way.

Default `board_path` for docs/examples should mention electronics path; keep current default if callers rely on it, but Task 3 will pass the electronics path explicitly.

- [ ] **Step 3: Run unit tests**

```bash
cd hardware/pocket_card/case && python3 -m unittest test_decorative_silk -v
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add hardware/pocket_card/case/silk.py hardware/pocket_card/case/test_decorative_silk.py
git commit -m "feat: sync KiCad refs when refreshing Pocket Card silk"
```

---

## Task 3: Refresh native board and update silk DRC waivers

**Files:**
- Modify: `hardware/pocket_card/electronics/pocket_card_controller.kicad_pcb`
- Modify: `hardware/pocket_card/electronics/validation_waivers.json`
- Modify: `hardware/pocket_card/electronics_pipeline/validation.py`
- Modify tests only if they embed old silk counts/digests

- [ ] **Step 1: Refresh the canonical board**

```bash
cd hardware/pocket_card/case && python3 -c \
  "import silk; print(silk.refresh_board_silk('../electronics/pocket_card_controller.kicad_pcb'))"
```

Expected: many silk `gr_rect`s removed; refs unhidden.

Sanity checks:

```bash
rg -c '^\t\(gr_rect$' hardware/pocket_card/electronics/pocket_card_controller.kicad_pcb
rg -n 'property "Reference"' -A6 hardware/pocket_card/electronics/pocket_card_controller.kicad_pcb | rg 'hide yes' | wc -l
```

Expected: silk rect count drops from ~25k to a small labels-only set; Reference `hide yes` count is 0 (or only non-silk if any).

- [ ] **Step 2: Run validation once to capture new silk warning groups**

```bash
python3 -m hardware.pocket_card.electronics_pipeline.validation --output-dir /tmp/pocket-card-silk-validate
```

If it fails only on silk waiver mismatches, read `/tmp/pocket-card-silk-validate/drc.json` (or the printed messages) and compute new counts/digests for remaining silk types using the same fingerprint function as `validation.group_fingerprint` / `violation_fingerprint`.

If a silk warning type drops to **zero**, remove that group from both `validation_waivers.json` and `_EXPECTED_WARNING_POLICY` / `_EXPECTED_WARNING_RATIONALES`.

Update remaining silk rationales to:
`Optional decorative silk off by default (params.DECORATIVE_SILK); residual label silk.`

Keep non-silk groups unchanged.

- [ ] **Step 3: Update hardcoded policy + JSON together**

Edit `_EXPECTED_WARNING_POLICY` and `_EXPECTED_WARNING_RATIONALES` in `validation.py` to match the measured silk baseline. Mirror the same groups into `validation_waivers.json`.

Update any unit tests that assert the old silk counts (163/199/21/4) or digests.

- [ ] **Step 4: Validate green**

```bash
python3 -m unittest hardware.pocket_card.electronics_pipeline.tests.test_validation -v
python3 -m hardware.pocket_card.electronics_pipeline.validation
cd hardware/pocket_card/case && python3 -m unittest test_decorative_silk -v
```

Expected: PASS / validation status `PASS`.

- [ ] **Step 5: Commit**

```bash
git add hardware/pocket_card/electronics/pocket_card_controller.kicad_pcb \
  hardware/pocket_card/electronics/validation_waivers.json \
  hardware/pocket_card/electronics_pipeline/validation.py \
  hardware/pocket_card/electronics_pipeline/tests/test_validation.py
git commit -m "feat: ship readable Pocket Card silk by default"
```

---

## Task 4: Docs + final check

**Files:**
- Modify: `hardware/pocket_card/electronics/README.md`
- Modify: `hardware/pocket_card/case/README.md` (brief silk note)

- [ ] **Step 1: Document the flag**

In `electronics/README.md`, add that board silk defaults to labels+refs; decorative brick/rules/logo are restored by setting `case/params.py` `DECORATIVE_SILK = True` and re-running `silk.refresh_board_silk` on the electronics board, then regenerating silk DRC waivers.

- [ ] **Step 2: Final verification**

```bash
python3 -m unittest discover -s hardware/pocket_card/case -p 'test_decorative_silk.py' -v
python3 -m hardware.pocket_card.electronics_pipeline.validation
```

- [ ] **Step 3: Commit docs**

```bash
git add hardware/pocket_card/electronics/README.md hardware/pocket_card/case/README.md
git commit -m "docs: explain Pocket Card decorative silk toggle"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| `DECORATIVE_SILK` flag default False | Task 1 |
| Labels-only layout when false | Task 1 |
| Skip brick when false | Task 1 |
| Full stack when true | Task 1 |
| Unhide refs when false / hide when true | Task 2 |
| Refresh electronics board | Task 3 |
| Update silk DRC waivers | Task 3 |
| `make pocket_card_kicad` / validation PASS | Task 3 |
| Operator docs | Task 4 |
| Copper/locks/mechanics unchanged | Task 3 (no edits to those) |
