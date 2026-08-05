# Pocket Card Engineer Handoff Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the native Pocket Card KiCad project authoritative and support safe, repeatable ZIP exchanges with an electrical engineer without allowing generators or stale enclosure assumptions to overwrite accepted work.

**Architecture:** Canonical KiCad sources live under `hardware/pocket_card/electronics/`. A small Python-standard-library package parses KiCad S-expressions, builds semantic inventories, checks electrical and mechanical policy, exports derived artifacts, and stages/accepts handoff ZIPs. Normal Make targets are read-only with respect to the KiCad sources; the old JSON/schematic/placement/routing generator remains available only through a guarded legacy target whose output is noncanonical.

**Tech Stack:** KiCad 10 CLI, Python 3 standard library (`argparse`, `dataclasses`, `hashlib`, `json`, `pathlib`, `subprocess`, `tempfile`, `zipfile`, `unittest`), GNU Make, existing CadQuery/Blender enclosure scripts.

---

## Baseline facts to preserve

- The accepted project has 17 linked footprints, 16 named nets, a 1.6 mm board, and zero unconnected PCB items.
- The PCB saved on live `master` after **Update PCB from Schematic** is byte-identical to commit `202a0578`; the `.kicad_pro` and `.kicad_sch` are Git-equivalent. The isolated feature worktree therefore contains the intended migration snapshot.
- KiCad CLI 10.0.4 reports 90 existing ERC warnings, 389 existing PCB DRC warnings, 125 existing schematic-parity warnings, and one PCB DRC error.
- The one DRC error is UUID `3bb44a83-ff96-4855-abff-4ba62d083478`, a B.Cu GND segment cutting too close to the driver-notch arc. Replacing it with the verified two-segment route through `(67.5, 68.0)` produces zero DRC errors and keeps zero unconnected items.
- Existing warnings are accepted only through exact count-and-UUID digests. New warnings, changed warnings, errors, and unconnected items fail.

## File structure

### Canonical project and policy

- Create: `hardware/pocket_card/electronics/pocket_card_controller.kicad_pro`
- Create: `hardware/pocket_card/electronics/pocket_card_controller.kicad_sch`
- Create: `hardware/pocket_card/electronics/pocket_card_controller.kicad_pcb`
- Create: `hardware/pocket_card/electronics/fp-lib-table`
- Create: `hardware/pocket_card/electronics/toolchain.json`
- Create: `hardware/pocket_card/electronics/mechanical_contract.json`
- Create: `hardware/pocket_card/electronics/validation_waivers.json`
- Create: `hardware/pocket_card/electronics/README.md`
- Create only when needed by returned work: `hardware/pocket_card/electronics/sym-lib-table`, `symbols/`, `footprints.pretty/`, `3dmodels/`

### Focused pipeline package

- Create: `hardware/pocket_card/electronics_pipeline/__init__.py`
- Create: `hardware/pocket_card/electronics_pipeline/paths.py` — repository paths and editable-project allowlist
- Create: `hardware/pocket_card/electronics_pipeline/kicad_sexpr.py` — quote/comment-safe streaming S-expression blocks
- Create: `hardware/pocket_card/electronics_pipeline/inventory.py` — native schematic/PCB inventories, digests, and semantic diffs
- Create: `hardware/pocket_card/electronics_pipeline/mechanics.py` — contract parsing and mechanical checks
- Create: `hardware/pocket_card/electronics_pipeline/validation.py` — KiCad CLI execution, report normalization, waiver enforcement, and result classification
- Create: `hardware/pocket_card/electronics_pipeline/exports.py` — transactional board/fabrication/reference exports
- Create: `hardware/pocket_card/electronics_pipeline/handoff.py` — deterministic outgoing ZIP, safe staging/check, and explicit acceptance
- Create: `hardware/pocket_card/electronics_pipeline/lock_mechanical_items.py` — idempotent one-time lock migration using minimal text splices
- Create: `hardware/pocket_card/electronics_pipeline/tests/` — unit and integration tests plus small textual fixtures

### Existing integration points

- Modify: `Makefile:18,551-568,950-1008`
- Modify: `hardware/pocket_card/case/export_smt.py:18-55`
- Modify: `hardware/pocket_card/case/place_preview.py:70-95,140-152`
- Modify: `hardware/pocket_card/case/build_pcb.sh:1-48`
- Modify: `hardware/pocket_card/case/test_emboss_shells.py:219-260`
- Modify: `hardware/pocket_card/README.md`
- Modify: `hardware/pocket_card/case/README.md`
- Modify: `hardware/pocket_card/schematic/README.md`
- Remove at cutover: the three duplicate KiCad source files and `fp-lib-table` from `hardware/pocket_card/case/out/pcb/`

## Task 1: Establish the canonical native KiCad snapshot

**Files:**
- Create: `hardware/pocket_card/electronics_pipeline/__init__.py`
- Create: `hardware/pocket_card/electronics_pipeline/paths.py`
- Create: `hardware/pocket_card/electronics_pipeline/tests/__init__.py`
- Create: `hardware/pocket_card/electronics_pipeline/tests/test_source_layout.py`
- Create: `hardware/pocket_card/electronics/toolchain.json`
- Create: `hardware/pocket_card/electronics/README.md`
- Copy initially: the four reviewed KiCad project files from `hardware/pocket_card/case/out/pcb/` into `hardware/pocket_card/electronics/`
- Modify: `hardware/pocket_card/electronics/pocket_card_controller.kicad_sch` title-block comments only

- [ ] **Step 1: Write the failing source-layout test**

```python
# hardware/pocket_card/electronics_pipeline/tests/test_source_layout.py
import json
import unittest
from pathlib import Path

from hardware.pocket_card.electronics_pipeline.paths import (
    BOARD,
    ELECTRONICS_DIR,
    PROJECT,
    SCHEMATIC,
    TOOLCHAIN,
)


class SourceLayoutTest(unittest.TestCase):
    def test_native_project_is_complete_and_pinned_to_kicad_10(self):
        for path in (PROJECT, SCHEMATIC, BOARD, ELECTRONICS_DIR / "fp-lib-table"):
            self.assertTrue(path.is_file(), str(path))
            self.assertGreater(path.stat().st_size, 0)
        policy = json.loads(TOOLCHAIN.read_text(encoding="utf-8"))
        self.assertEqual(policy["schemaVersion"], 1)
        self.assertEqual(policy["project"], "pocket_card_controller")
        self.assertEqual(policy["kicad"]["major"], 10)
        self.assertEqual(policy["kicad"]["minimum"], "10.0.4")

    def test_project_has_no_machine_local_library_paths(self):
        forbidden = ("/Users/", "C:\\\\Users\\", "file://")
        for path in ELECTRONICS_DIR.rglob("*"):
            if path.is_file() and path.suffix in {".kicad_pro", ".kicad_sch", ".kicad_pcb"}:
                text = path.read_text(encoding="utf-8")
                self.assertFalse(any(token in text for token in forbidden), str(path))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test and verify it fails because the canonical directory and path module do not exist**

Run:

```bash
python3 -m unittest hardware.pocket_card.electronics_pipeline.tests.test_source_layout -v
```

Expected: import failure for `hardware.pocket_card.electronics_pipeline.paths` or missing canonical files.

- [ ] **Step 3: Add the path module and exact toolchain policy**

```python
# hardware/pocket_card/electronics_pipeline/paths.py
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
POCKET_CARD_DIR = REPO_ROOT / "hardware" / "pocket_card"
ELECTRONICS_DIR = POCKET_CARD_DIR / "electronics"
PROJECT_NAME = "pocket_card_controller"
PROJECT = ELECTRONICS_DIR / f"{PROJECT_NAME}.kicad_pro"
SCHEMATIC = ELECTRONICS_DIR / f"{PROJECT_NAME}.kicad_sch"
BOARD = ELECTRONICS_DIR / f"{PROJECT_NAME}.kicad_pcb"
TOOLCHAIN = ELECTRONICS_DIR / "toolchain.json"
MECHANICAL_CONTRACT = ELECTRONICS_DIR / "mechanical_contract.json"
VALIDATION_WAIVERS = ELECTRONICS_DIR / "validation_waivers.json"
PCB_OUTPUT_DIR = POCKET_CARD_DIR / "case" / "out" / "pcb"
HANDOFF_BUILD_DIR = REPO_ROOT / "build" / "pocket_card" / "handoff"

EDITABLE_PROJECT_FILES = (
    f"{PROJECT_NAME}.kicad_pro",
    f"{PROJECT_NAME}.kicad_sch",
    f"{PROJECT_NAME}.kicad_pcb",
    "fp-lib-table",
    "sym-lib-table",
)
EDITABLE_PROJECT_DIRS = ("symbols", "footprints.pretty", "3dmodels")
```

```json
{
  "schemaVersion": 1,
  "project": "pocket_card_controller",
  "kicad": {
    "major": 10,
    "minimum": "10.0.4"
  }
}
```

- [ ] **Step 4: Copy the reviewed project without regenerating it**

Run:

```bash
mkdir -p hardware/pocket_card/electronics
cp -p hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pro hardware/pocket_card/electronics/
cp -p hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_sch hardware/pocket_card/electronics/
cp -p hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb hardware/pocket_card/electronics/
cp -p hardware/pocket_card/case/out/pcb/fp-lib-table hardware/pocket_card/electronics/
```

Keep the old copies only until Task 9 rewires every consumer. Record SHA-256 hashes before and after the copy and require equality.

- [ ] **Step 5: Remove generator ownership claims from the copied schematic's title block**

Change only these three copied-title-block values:

```scheme
(comment 1 "Native KiCad project; repository scripts validate and export only")
(comment 2 "Existing local labels preserve the reviewed as-routed net names")
(comment 3 "Migration baseline: as-routed-2026-08-05")
```

Do not run `generate_kicad.js` after this edit.

- [ ] **Step 6: Write the canonical README**

Document that engineers edit the `.kicad_pro` project here; new symbols must be annotated; PCB updates use the established symbol associations; `${KIPRJMOD}` is mandatory for custom assets; `.kicad_prl`, `.lck`, backups, and caches are not source; and normal Make targets never regenerate schematic, placement, or routing.

- [ ] **Step 7: Run the new and existing baseline tests**

Run:

```bash
python3 -m unittest hardware.pocket_card.electronics_pipeline.tests.test_source_layout -v
make pocket_card_schematic_tests
```

Expected: source-layout tests pass; existing legacy suite still reports `68 tests passed`, `17 linked footprints`, and `35` Python tests passing.

- [ ] **Step 8: Commit the canonical snapshot**

```bash
git add hardware/pocket_card/electronics hardware/pocket_card/electronics_pipeline
git commit -m "feat: establish canonical Pocket Card KiCad project"
```

## Task 2: Parse native KiCad sources into a stable semantic inventory

**Files:**
- Create: `hardware/pocket_card/electronics_pipeline/kicad_sexpr.py`
- Create: `hardware/pocket_card/electronics_pipeline/inventory.py`
- Create: `hardware/pocket_card/electronics_pipeline/tests/test_kicad_sexpr.py`
- Create: `hardware/pocket_card/electronics_pipeline/tests/test_inventory.py`
- Create: `hardware/pocket_card/electronics_pipeline/tests/fixtures/pullup_board_fragment.kicad_pcb`
- Create: `hardware/pocket_card/electronics_pipeline/tests/fixtures/pullup_netlist.net`

- [ ] **Step 1: Write tokenizer tests for the KiCad edge cases already present in the repository**

```python
class KiCadSexprTest(unittest.TestCase):
    def test_comments_quotes_escapes_and_duplicate_children_are_preserved(self):
        source = '(root # hidden (bad)\n (item "a\\\"(b)") (item 2) (empty ""))'
        root = one_root(source, "root")
        children = direct_children(root.text)
        self.assertEqual([child.name for child in children], ["item", "item", "empty"])
        self.assertEqual(expression_atoms(children[0].text, 2), ("item", 'a"(b)'))

    def test_second_root_and_unterminated_quote_are_rejected(self):
        with self.assertRaisesRegex(SexprError, "trailing content"):
            one_root("(root)(root)", "root")
        with self.assertRaisesRegex(SexprError, "unterminated quoted atom"):
            one_root('(root "bad)', "root")
```

- [ ] **Step 2: Run the tokenizer test and verify it fails**

Run:

```bash
python3 -m unittest hardware.pocket_card.electronics_pipeline.tests.test_kicad_sexpr -v
```

Expected: import failure for `kicad_sexpr`.

- [ ] **Step 3: Implement the streaming block API**

Use this complete streaming implementation as the starting point:

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class Token:
    kind: str          # open | close | atom
    value: str
    start: int
    end: int

@dataclass(frozen=True)
class ChildBlock:
    name: str
    text: str
    start: int
    end: int

class SexprError(ValueError):
    pass


def next_token(source: str, offset: int = 0) -> Token | None:
    cursor = offset
    while cursor < len(source):
        if source[cursor].isspace():
            cursor += 1
            continue
        if source[cursor] == "#":
            newline = source.find("\n", cursor)
            cursor = len(source) if newline < 0 else newline + 1
            continue
        break
    if cursor >= len(source):
        return None
    if source[cursor] == "(":
        return Token("open", "(", cursor, cursor + 1)
    if source[cursor] == ")":
        return Token("close", ")", cursor, cursor + 1)
    start = cursor
    if source[cursor] == '"':
        cursor += 1
        decoded = bytearray()
        while cursor < len(source):
            character = source[cursor]
            cursor += 1
            if character == '"':
                try:
                    value = decoded.decode("utf-8")
                except UnicodeDecodeError as error:
                    raise SexprError(f"invalid UTF-8 escape at index {start}") from error
                return Token("atom", value, start, cursor)
            if character != "\\":
                decoded.extend(character.encode("utf-8"))
                continue
            if cursor >= len(source):
                raise SexprError(f"quoted atom cannot end with escape at index {start}")
            if source[cursor] == "x" and cursor + 2 < len(source):
                digits = source[cursor + 1:cursor + 3]
                if all(digit in "0123456789abcdefABCDEF" for digit in digits):
                    decoded.append(int(digits, 16))
                    cursor += 3
                    continue
            if source[cursor] in "01234567":
                end = cursor
                while end < len(source) and end < cursor + 3 and source[end] in "01234567":
                    end += 1
                decoded.append(int(source[cursor:end], 8))
                cursor = end
                continue
            decoded.extend(source[cursor].encode("utf-8"))
            cursor += 1
        raise SexprError(f"unterminated quoted atom at index {start}")
    while cursor < len(source) and not source[cursor].isspace() and source[cursor] not in "()":
        cursor += 1
    return Token("atom", source[start:cursor], start, cursor)


def balanced_block(source: str, start: int) -> str:
    opening = next_token(source, start)
    if opening is None or opening.kind != "open" or opening.start != start:
        raise SexprError(f"expected opening parenthesis at index {start}")
    depth = 1
    cursor = opening.end
    while True:
        token = next_token(source, cursor)
        if token is None:
            raise SexprError(f"unterminated S-expression at index {start}")
        cursor = token.end
        if token.kind == "open":
            depth += 1
        elif token.kind == "close":
            depth -= 1
            if depth == 0:
                return source[start:token.end]


def expression_atoms(expression: str, limit: int) -> tuple[str, ...]:
    opening = next_token(expression)
    if opening is None or opening.kind != "open":
        return ()
    atoms = []
    cursor = opening.end
    while len(atoms) < limit:
        token = next_token(expression, cursor)
        if token is None or token.kind != "atom":
            break
        atoms.append(token.value)
        cursor = token.end
    return tuple(atoms)


def direct_children(expression: str) -> tuple[ChildBlock, ...]:
    opening = next_token(expression)
    if opening is None or opening.kind != "open":
        return ()
    children = []
    depth = 1
    cursor = opening.end
    while depth:
        token = next_token(expression, cursor)
        if token is None:
            raise SexprError("unterminated parent expression")
        if token.kind == "open" and depth == 1:
            text = balanced_block(expression, token.start)
            atoms = expression_atoms(text, 1)
            if not atoms:
                raise SexprError(f"unnamed child expression at index {token.start}")
            end = token.start + len(text)
            children.append(ChildBlock(atoms[0], text, token.start, end))
            cursor = end
            continue
        if token.kind == "open":
            depth += 1
        elif token.kind == "close":
            depth -= 1
        cursor = token.end
    return tuple(children)


def one_root(source: str, expected_name: str) -> ChildBlock:
    opening = next_token(source)
    if opening is None or opening.kind != "open":
        raise SexprError("expected one root S-expression")
    text = balanced_block(source, opening.start)
    atoms = expression_atoms(text, 1)
    if atoms != (expected_name,):
        actual = atoms[0] if atoms else "unnamed"
        raise SexprError(f"expected {expected_name} root, found {actual}")
    trailing = next_token(source, opening.start + len(text))
    if trailing is not None:
        raise SexprError(f"trailing content at index {trailing.start}")
    return ChildBlock(expected_name, text, opening.start, opening.start + len(text))
```

Port the quote, octal/hex byte escape, UTF-8, comment, balanced-root, and trailing-token behavior from `hardware/pocket_card/schematic/validate_connectivity.js`. Do not build a whole-board nested AST; the routed board is large because it contains filled zones.

- [ ] **Step 4: Write inventory tests, including an unknown pull-up resistor**

```python
class InventoryTest(unittest.TestCase):
    def test_native_project_inventory_has_no_fixed_component_allowlist(self):
        board = parse_board((FIXTURES / "pullup_board_fragment.kicad_pcb").read_text())
        schematic = parse_netlist((FIXTURES / "pullup_netlist.net").read_text())
        errors = compare_schematic_to_board(schematic, board)
        self.assertEqual(errors, ())
        self.assertEqual(board.footprints["R99"].pads["1"][0].net, "+3V3")
        self.assertEqual(board.footprints["R99"].pads["2"][0].net, "SIG_ACTION")

    def test_checked_in_project_has_17_links_and_16_nets(self):
        inventory = inventory_project(ELECTRONICS_DIR)
        self.assertEqual(len(inventory.board.footprints), 17)
        self.assertEqual(len(inventory.schematic.components), 17)
        self.assertEqual(len(inventory.schematic.nets), 16)
        self.assertEqual(compare_schematic_to_board(
            inventory.schematic, inventory.board), ())
```

The fixture uses `R99`, UUID `11111111-2222-4333-8444-555555555555`, footprint `Resistor_SMD:R_0402_1005Metric`, value `10k`, and nets `+3V3`/`SIG_ACTION`. It proves new references are accepted because they are linked and internally consistent, not because they appear in a fixed list.

- [ ] **Step 5: Run the inventory test and verify it fails**

Run:

```bash
python3 -m unittest hardware.pocket_card.electronics_pipeline.tests.test_inventory -v
```

Expected: import failure for `inventory`.

- [ ] **Step 6: Implement the semantic inventory types and comparison**

```python
@dataclass(frozen=True)
class Pad:
    number: str
    net: str | None
    uuid: str | None

@dataclass(frozen=True)
class Footprint:
    ref: str
    value: str
    library_id: str
    uuid: str
    symbol_path: str | None
    x_mm: float
    y_mm: float
    rotation_deg: float
    layer: str
    locked: bool
    pads: dict[str, tuple[Pad, ...]]
    courtyard_bbox_mm: tuple[float, float, float, float] | None

@dataclass(frozen=True)
class SchematicComponent:
    ref: str
    value: str
    footprint: str
    uuid: str
    fields: dict[str, str]

@dataclass(frozen=True)
class BoardInventory:
    thickness_mm: float
    footprints: dict[str, Footprint]
    edge_cuts: tuple[dict[str, object], ...]

@dataclass(frozen=True)
class SchematicInventory:
    components: dict[str, SchematicComponent]
    nets: dict[str, tuple[str, ...]]

@dataclass(frozen=True)
class ProjectInventory:
    schematic: SchematicInventory
    board: BoardInventory
```

`inventory_project()` exports a temporary `kicadsexpr` netlist with KiCad CLI, parses it, parses the board directly, and returns a deterministic inventory. Normalize a single leading `/` from top-level netlist names before comparing them with board pad nets. Require each board symbol path to equal a slash concatenated with its component UUID. Permit unnumbered pads only on `H1`/`H2`; permit duplicate physical pads when every duplicate has the same expected net. Compare the footprint library basename so `MountingHole_2.7mm_M2.5` matches `MountingHole:MountingHole_2.7mm_M2.5`.

Compute each courtyard bounding box from the footprint's `F.CrtYd` or `B.CrtYd` primitives after applying footprint translation and rotation. Return `None` only when the footprint genuinely has no courtyard; a contracted keep-out encountering such a footprint is a mechanical finding rather than an implicit pass.

- [ ] **Step 7: Add deterministic digest and semantic-diff functions**

```python
def project_digest(project_dir: Path) -> str:
    """SHA-256 of sorted editable relative paths, NUL separators, and bytes."""

def inventory_json(inventory: ProjectInventory) -> dict[str, object]:
    """Stable JSON-ready data with sorted refs, pads, nets, and edge primitives."""

def semantic_diff(before: ProjectInventory, after: ProjectInventory) -> dict[str, object]:
    """Added/removed/changed components, nets, footprints, placements, and outline."""
```

Exclude policy files, editor state, backups, and derived outputs from `project_digest`; include all present allowlisted KiCad files and project-local library/model files.

- [ ] **Step 8: Run parser/inventory tests and the real-project smoke test**

Run:

```bash
python3 -m unittest \
  hardware.pocket_card.electronics_pipeline.tests.test_kicad_sexpr \
  hardware.pocket_card.electronics_pipeline.tests.test_inventory -v
```

Expected: all tests pass; checked-in inventory reports 17 components and 16 nets.

- [ ] **Step 9: Commit the inventory layer**

```bash
git add hardware/pocket_card/electronics_pipeline
git commit -m "feat: inventory native Pocket Card KiCad sources"
```

## Task 3: Lock and validate the mechanical interface

**Files:**
- Create: `hardware/pocket_card/electronics/mechanical_contract.json`
- Create: `hardware/pocket_card/electronics_pipeline/mechanics.py`
- Create: `hardware/pocket_card/electronics_pipeline/lock_mechanical_items.py`
- Create: `hardware/pocket_card/electronics_pipeline/tests/test_mechanics.py`
- Modify: `hardware/pocket_card/electronics/pocket_card_controller.kicad_pcb`

- [ ] **Step 1: Write failing contract tests**

```python
class MechanicalContractTest(unittest.TestCase):
    def test_checked_in_board_matches_contract_and_params(self):
        contract = load_contract(MECHANICAL_CONTRACT)
        board = parse_board(BOARD.read_text(encoding="utf-8"))
        self.assertEqual(check_mechanics(contract, board), ())
        self.assertEqual(check_contract_against_case_params(contract), ())

    def test_move_side_rotation_unlock_and_outline_changes_require_review(self):
        contract = fixture_contract()
        board = fixture_board()
        self.assertIn("SW_UP1 moved", "\n".join(check_mechanics(
            contract, replace_footprint(board, "SW_UP1", x_mm=20.0))))
        self.assertIn("SW_UP1 is not locked", "\n".join(check_mechanics(
            contract, replace_footprint(board, "SW_UP1", locked=False))))
        self.assertIn("Edge.Cuts", "\n".join(check_mechanics(
            contract, replace_outline_endpoint(board, x_mm=83.2))))
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
python3 -m unittest hardware.pocket_card.electronics_pipeline.tests.test_mechanics -v
```

Expected: missing `mechanics` module/contract.

- [ ] **Step 3: Add the exact mechanical contract**

Use schema version 1, board thickness `1.6 ± 0.01 mm`, outline coordinate tolerance `0.01 mm`, and these locked feature entries with `xyToleranceMm: 0.05` and `rotationToleranceDeg: 0.1`:

```json
{
  "H1":          {"xMm": 64.5, "yMm": 56.0,  "rotationDeg": 0.0, "side": "F.Cu"},
  "H2":          {"xMm": 66.0, "yMm": 84.0,  "rotationDeg": 0.0, "side": "F.Cu"},
  "SW_UP1":      {"xMm": 19.7, "yMm": 59.8,  "rotationDeg": 0.0, "side": "F.Cu"},
  "SW_DOWN1":    {"xMm": 19.7, "yMm": 77.8,  "rotationDeg": 0.0, "side": "F.Cu"},
  "SW_LEFT1":    {"xMm": 10.7, "yMm": 68.8,  "rotationDeg": 0.0, "side": "F.Cu"},
  "SW_RIGHT1":   {"xMm": 28.7, "yMm": 68.8,  "rotationDeg": 0.0, "side": "F.Cu"},
  "SW_UNDO1":    {"xMm": 60.4, "yMm": 65.8,  "rotationDeg": 0.0, "side": "F.Cu"},
  "SW_ACTION1":  {"xMm": 77.1, "yMm": 61.1,  "rotationDeg": 0.0, "side": "F.Cu"},
  "SW_RESET1":   {"xMm": 56.5, "yMm": 80.0,  "rotationDeg": 0.0, "side": "F.Cu"},
  "SW_MENU1":    {"xMm": 39.6, "yMm": 85.4,  "rotationDeg": 0.0, "side": "F.Cu"},
  "SW_PWR1":     {"xMm": 20.0, "yMm": 87.65, "rotationDeg": 0.0, "side": "F.Cu"},
  "SW_MUTE1":    {"xMm": 58.0, "yMm": 87.65, "rotationDeg": 0.0, "side": "F.Cu"},
  "J_I2C1":      {"xMm": 63.0, "yMm": 63.0,  "rotationDeg": 0.0, "side": "B.Cu"},
  "J_EXP1":      {"xMm": 78.0, "yMm": 65.6,  "rotationDeg": 0.0, "side": "B.Cu"},
  "J_BAT_IN1":   {"xMm": 63.0, "yMm": 76.0,  "rotationDeg": 0.0, "side": "B.Cu"},
  "J_BAT_OUT1":  {"xMm": 72.3, "yMm": 58.5,  "rotationDeg": 0.0, "side": "B.Cu"}
}
```

Give every entry `lockedRequired: true` and a nonempty rationale. Record the ten normalized Edge.Cuts primitives already in the board: the three top/right/left outer lines, three bottom/notch lines, and four arcs with their exact start/mid/end coordinates. Add a B.Cu battery keep-out rectangle derived from `BATT_X`, `BATT_Y`, `CELL_W`, `CELL_H`, and `BATT_CLEAR`; validate that no B.Cu component courtyard enters it.

- [ ] **Step 4: Implement mechanical validation and params parity**

Implement `load_contract(path)` to require schema version 1, numeric tolerances, unique feature refs, nonempty rationales, and correct line/arc point arity. Implement `check_mechanics(contract, board)` to return a sorted immutable sequence containing exact `missing`, `moved`, `rotated`, `wrong side`, `not locked`, thickness, keep-out, or `Edge.Cuts` findings. Implement `check_contract_against_case_params(contract)` with an explicit ref-to-constant map for `PCB_MOUNTS`, `DIR_CX/DIR_CY/DIR_RADIUS`, `UNDO_X/UNDO_Y`, `ACT_X/ACT_Y`, `RESET_X/RESET_Y`, `MENU_X/MENU_Y`, `POWER_SW_X/POWER_SW_Y`, `MUTE_SW_X/MUTE_SW_Y`, and the four `CONN_*` tuples. Compare angles modulo 360, compare sorted normalized line/arc tuples, and keep electrical errors separate from mechanical findings. `MechanicalReviewRequired` stores the immutable findings and renders the `MECHANICAL REVIEW REQUIRED` heading followed by one finding per line.

- [ ] **Step 5: Implement and test the idempotent lock migration**

`lock_mechanical_items.py` must parse top-level blocks, add `(locked yes)` only to the 16 contracted footprints and every `gr_line`/`gr_arc` on `Edge.Cuts`, apply text replacements from highest byte offset to lowest, and refuse any board whose current mechanical values do not already match the contract. A second run must produce identical bytes.

Run it on a temporary board in the unit test, then run it once on the canonical board:

```bash
python3 -m hardware.pocket_card.electronics_pipeline.lock_mechanical_items \
  hardware/pocket_card/electronics/pocket_card_controller.kicad_pcb
```

Expected: `locked 16 footprints and 10 Edge.Cuts items`; a second run reports `already locked` and leaves the SHA-256 unchanged.

- [ ] **Step 6: Run mechanical and source-layout tests**

Run:

```bash
python3 -m unittest \
  hardware.pocket_card.electronics_pipeline.tests.test_mechanics \
  hardware.pocket_card.electronics_pipeline.tests.test_source_layout -v
```

Expected: all pass and no contract/`params.py` drift.

- [ ] **Step 7: Commit the mechanical contract and locks**

```bash
git add hardware/pocket_card/electronics hardware/pocket_card/electronics_pipeline
git commit -m "feat: guard Pocket Card mechanical interfaces"
```

## Task 4: Add read-only KiCad validation and establish a clean baseline

**Files:**
- Create: `hardware/pocket_card/electronics/validation_waivers.json`
- Create: `hardware/pocket_card/electronics_pipeline/validation.py`
- Create: `hardware/pocket_card/electronics_pipeline/tests/test_validation.py`
- Modify: `hardware/pocket_card/electronics/pocket_card_controller.kicad_pcb`

- [ ] **Step 1: Write failing validation-policy tests with an injected command runner**

```python
class ValidationTest(unittest.TestCase):
    def test_errors_unconnected_and_unwaived_warnings_are_invalid(self):
        reports = fake_reports(
            erc=[violation("warning", "endpoint_off_grid", "erc-1")],
            drc=[violation("error", "clearance", "drc-1")],
            unconnected=[violation("error", "unconnected", "pad-1")],
        )
        result = classify_reports(reports, waivers={"groups": []})
        self.assertEqual(result.status, "INVALID")
        self.assertIn("drc error clearance", result.messages)
        self.assertIn("1 unconnected item", result.messages)

    def test_warning_group_requires_exact_count_and_uuid_digest(self):
        warning = violation("warning", "endpoint_off_grid", "erc-1")
        waiver = waiver_for("erc", "endpoint_off_grid", [warning], "legacy grid")
        self.assertEqual(classify_reports(
            fake_reports(erc=[warning]), {"groups": [waiver]}).status, "PASS")
        self.assertEqual(classify_reports(
            fake_reports(erc=[warning, violation("warning", "endpoint_off_grid", "erc-2")]),
            {"groups": [waiver]}).status, "INVALID")

    def test_validation_never_changes_source_bytes(self):
        before = project_digest(ELECTRONICS_DIR)
        validate_project(ELECTRONICS_DIR)
        self.assertEqual(project_digest(ELECTRONICS_DIR), before)
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
python3 -m unittest hardware.pocket_card.electronics_pipeline.tests.test_validation -v
```

Expected: missing `validation` module.

- [ ] **Step 3: Replace the one failing GND edge segment with the verified route**

Apply this exact native-board change:

```scheme
;; remove UUID 3bb44a83-ff96-4855-abff-4ba62d083478
(segment
  (start 63.625 74.15)
  (end 67.5 68)
  (width 0.2)
  (layer "B.Cu")
  (net "GND")
  (uuid "2c3c35a9-2e18-43dc-a6c3-35eff62b28fa"))
(segment
  (start 67.5 68)
  (end 70.825 66.95)
  (width 0.2)
  (layer "B.Cu")
  (net "GND")
  (uuid "4b0a6a18-6675-4662-9c3b-13c98f73e4d1"))
```

Run DRC with the `.kicad_pro` beside the board. Expected: 0 errors, 389 warnings, and 0 unconnected items.

- [ ] **Step 4: Implement the read-only validator**

Use this public result shape:

```python
@dataclass(frozen=True)
class ValidationResult:
    status: str
    messages: tuple[str, ...]
    reports: dict[str, object]
    inventory: ProjectInventory | None

    def render_text(self) -> str:
        return self.status + ("" if not self.messages else "\n- " + "\n- ".join(self.messages))
```

`validate_project(project_dir, output_dir=None)` must:

1. verify all required files and parse `kicad-cli --version` against `toolchain.json`;
2. copy the complete project into a temporary directory;
3. run `kicad-cli sch erc --format json --severity-all` on the copy;
4. run `kicad-cli pcb drc --schematic-parity --format json --severity-all` on the copy;
5. export a temporary `kicadsexpr` netlist and run the normalized native inventory comparison;
6. reject missing/duplicate/unannotated refs, invalid symbol paths, unresolved custom assets, absolute paths, all errors, all unconnected items, and unmatched warning groups;
7. run the mechanical contract checker and classify its findings separately;
8. return `ValidationResult(status, messages, reports, inventory)` where status is `PASS`, `MECHANICAL REVIEW REQUIRED`, or `INVALID`.

Set `LANG=C` and `LC_ALL=C` for subprocesses. Do not pass `--save-board`; no command may modify the canonical files.

- [ ] **Step 5: Add exact warning-group waivers**

Use fingerprint `scope|severity|type|sorted-item-UUIDs`, sort the fingerprints in each group, then SHA-256 the newline-joined group. Add these exact versioned groups and nonempty rationales:

| Scope | Type | Count | SHA-256 |
|---|---|---:|---|
| ERC | `endpoint_off_grid` | 71 | `9cb699ba1827fa447483e85c111b392f22e217ca02e4866e408ed0872bb57384` |
| ERC | `lib_symbol_issues` | 19 | `078197b8ae3f4753b71a8329cec228bc7b895e147329d8cbde9b347336490eb9` |
| DRC | `via_dangling` | 2 | `27b20d9750762cbf26cbf4343b6f0bc3542faea666c8c26b8b3f107ddc67ff95` |
| DRC | `silk_edge_clearance` | 163 | `2ab9120f0ff908b419033b6765ce4be49f0634795c1d20c4b61a36592c196d39` |
| DRC | `silk_overlap` | 199 | `bb8c204cb57e95e9230625dde888cc15f56afeaffbd4a15894e77b240c431e9d` |
| DRC | `silk_over_copper` | 21 | `1ef1749815a28e02b61e4e3650689beae9ee9101c66bec3acd61d6f30521de32` |
| DRC | `nonmirrored_text_on_back_layer` | 4 | `d54988b0fd8a967b1c1526fbae6d064316605bca07fe8ccfbc072ef2938421b3` |
| parity | `footprint_symbol_mismatch` | 32 | `9c0f14314f30187bc131e9a9d693cb40e81b98f2d19ff38b9164f49a08187e23` |
| parity | `net_conflict` | 90 | `f0cd0a9a2d6da3052181b7f0e848d6be7a3a1a02d775cf27413a65effdfdc527` |
| parity | `footprint_symbol_field_mismatch` | 3 | `2f617d41d767197016f3ea21e1afe06954dab08d4ff677feec0ca23a9d2483b6` |

The ERC rationale names the historical generated symbol/grid layout. The silk rationale names the intentionally dense decorative silk. The parity rationale names the historical library-prefix, board-value, and leading-slash mismatch and states that the normalized UUID/pad/net comparison passes. The two dangling vias remain visible for engineer disposition.

- [ ] **Step 6: Add the CLI and actionable exit codes**

```python
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-dir", type=Path, default=ELECTRONICS_DIR)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args(argv)
    result = validate_project(args.project_dir, args.output_dir)
    print(result.render_text())
    return {"PASS": 0, "INVALID": 1, "MECHANICAL REVIEW REQUIRED": 2}[result.status]
```

- [ ] **Step 7: Run the unit and real KiCad integration tests**

Run:

```bash
python3 -m unittest hardware.pocket_card.electronics_pipeline.tests.test_validation -v
python3 -m hardware.pocket_card.electronics_pipeline.validation
```

Expected: tests pass; real command reports 0 ERC/DRC errors, 0 unconnected items, all known warning groups matched, native parity passed, mechanical contract passed, final status `PASS`.

- [ ] **Step 8: Commit validation and the DRC correction**

```bash
git add hardware/pocket_card/electronics hardware/pocket_card/electronics_pipeline
git commit -m "feat: validate native Pocket Card KiCad project"
```

## Task 5: Export fabrication and enclosure inputs without modifying sources

**Files:**
- Create: `hardware/pocket_card/electronics_pipeline/exports.py`
- Create: `hardware/pocket_card/electronics_pipeline/tests/test_exports.py`
- Modify: `hardware/pocket_card/case/export_smt.py`
- Modify: `hardware/pocket_card/case/place_preview.py`

- [ ] **Step 1: Write failing transactional-export tests with a fake command runner**

```python
class ExportTest(unittest.TestCase):
    def test_failed_export_publishes_nothing(self):
        output = self.tempdir / "out"
        with self.assertRaises(CommandFailed):
            export_outputs(self.project, output, runner=FailOn("pcb export step"))
        self.assertFalse((output / "source_manifest.json").exists())

    def test_success_records_the_exact_source_digest(self):
        output = self.tempdir / "out"
        export_outputs(self.project, output, runner=FakeKiCadRunner())
        manifest = json.loads((output / "source_manifest.json").read_text())
        self.assertEqual(manifest["projectDigest"], project_digest(self.project))
        self.assertTrue(exports_are_current(self.project, output))
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
python3 -m unittest hardware.pocket_card.electronics_pipeline.tests.test_exports -v
```

Expected: missing `exports` module.

- [ ] **Step 3: Implement staged, atomic exports**

Return this immutable result from `export_outputs()`:

```python
@dataclass(frozen=True)
class ExportResult:
    project_digest: str
    output_dir: Path
    step_path: Path
    stl_path: Path
    schematic_pdf_path: Path
    gerber_zip_path: Path
    manifest_path: Path
```

After `validate_project()` returns `PASS`, export into a temporary sibling directory and publish only after every command succeeds:

```text
kicad-cli sch export pdf -> pocket_card_controller.pdf
kicad-cli sch export bom --fields Reference,Value,Footprint,QUANTITY,DNP -> BOM.csv
kicad-cli pcb export gerbers --board-plot-params --check-zones -> gerber/
kicad-cli pcb export drill --format excellon -> gerber/
kicad-cli pcb export pos --format csv --units mm --side both -> pocket_card_controller-all-pos.csv
kicad-cli pcb export step --force --subst-models -> pocket_card_controller.step
kicad-cli pcb export stl --force --subst-models -> pocket_card_controller.stl
```

Zip the sorted Gerber/drill files as `pocket_card_controller_gerbers.zip`. Write `source_manifest.json` with schema version, project digest, KiCad version, and SHA-256 for every published file. Preserve the legacy `exported.step`/`.stl` aliases for existing case consumers.

- [ ] **Step 4: Point existing placement/BOM helpers at canonical input**

Change `export_smt.py` so its raw position input is exported from `hardware/pocket_card/electronics/pocket_card_controller.kicad_pcb`. Keep its current JLC-specific mapping for the present board, but also publish the generic KiCad BOM so engineer-added parts are never silently absent from the general fabrication package. Change `place_preview.py` only as needed to consume the exported STEP and require a matching `source_manifest.json`.

- [ ] **Step 5: Add stale-export checks**

```python
def exports_are_current(project_dir: Path, output_dir: Path) -> bool:
    manifest = json.loads((output_dir / "source_manifest.json").read_text())
    return manifest["projectDigest"] == project_digest(project_dir)

def require_current_exports(project_dir: Path, output_dir: Path) -> None:
    if not exports_are_current(project_dir, output_dir):
        raise RuntimeError("PCB export is missing or stale; run make pocket_card_pcb_exports")
```

- [ ] **Step 6: Run unit tests and one real export**

Run:

```bash
python3 -m unittest hardware.pocket_card.electronics_pipeline.tests.test_exports -v
python3 -m hardware.pocket_card.electronics_pipeline.exports
```

Expected: tests pass; STEP, STL, schematic PDF, BOM, placement CSV, Gerbers/drills, archive, and manifest exist under `hardware/pocket_card/case/out/pcb/`; canonical project digest is unchanged.

- [ ] **Step 7: Commit the export layer**

```bash
git add hardware/pocket_card/electronics_pipeline hardware/pocket_card/case/export_smt.py hardware/pocket_card/case/place_preview.py
git commit -m "feat: export Pocket Card artifacts from native KiCad"
```

## Task 6: Create deterministic outgoing engineer ZIPs

**Files:**
- Create: `hardware/pocket_card/electronics_pipeline/handoff.py`
- Create: `hardware/pocket_card/electronics_pipeline/tests/test_handoff_export.py`

- [ ] **Step 1: Write failing outgoing-package tests**

```python
class HandoffExportTest(unittest.TestCase):
    def test_export_contains_sources_metadata_and_references_only(self):
        archive = export_handoff(self.repo, include_blend=False, output_dir=self.output)
        names = zip_names(archive)
        self.assertIn("pocket-card-controller/project/pocket_card_controller.kicad_sch", names)
        self.assertIn("pocket-card-controller/HANDOFF.md", names)
        self.assertIn("pocket-card-controller/handoff.json", names)
        self.assertIn("pocket-card-controller/reference/board.step", names)
        self.assertNotIn("pocket-card-controller/reference/pocket_card_complete.blend", names)
        self.assertFalse(any(name.endswith((".kicad_prl", ".lck", "~")) for name in names))

    def test_same_source_date_epoch_produces_identical_zip_bytes(self):
        first = export_handoff(self.repo, source_date_epoch=1785888000, output_dir=self.a)
        second = export_handoff(self.repo, source_date_epoch=1785888000, output_dir=self.b)
        self.assertEqual(first.read_bytes(), second.read_bytes())
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
python3 -m unittest hardware.pocket_card.electronics_pipeline.tests.test_handoff_export -v
```

Expected: missing `handoff` module.

- [ ] **Step 3: Implement the archive layout and metadata**

The ZIP root is exactly:

```text
pocket-card-controller/
  project/                  # editable KiCad files and local libraries/models
  reference/
    mechanical_contract.json
    validation_waivers.json
    schematic.pdf
    board.step
    erc.json
    drc.json
    inventory.json
    semantic-summary.md
    pocket_card_complete.blend   # only with INCLUDE_BLEND=1
  HANDOFF.md
  handoff.json
```

`handoff.json` contains schema version, project name, base project digest, `git rev-parse HEAD`, KiCad version, and deterministic creation time from `SOURCE_DATE_EPOCH` or the source commit time. Add ZIP entries in sorted order with that fixed timestamp and mode `0644`. Use `ZIP_DEFLATED` and no workstation paths.

- [ ] **Step 4: Generate clear engineer instructions**

`HANDOFF.md` states: use KiCad 10; edit anything required; preserve existing refs; annotate all new symbols; update PCB through KiCad; locked items may be deliberately unlocked but will trigger enclosure review; use `${KIPRJMOD}` for custom assets; do not edit reference policy to make checks pass; return the same top-level directory as ZIP; STEP is dimensional authority and Blender is visual context.

- [ ] **Step 5: Add the export CLI**

```python
subparsers.add_parser("export")
export_parser.add_argument("--include-blend", action="store_true")
export_parser.add_argument("--output-dir", type=Path, default=HANDOFF_BUILD_DIR / "outgoing")
```

The command validates first, ensures PCB exports are current, and prints the absolute archive path. It refuses `INVALID` and `MECHANICAL REVIEW REQUIRED` baselines.

- [ ] **Step 6: Run tests and create both package variants**

Run:

```bash
python3 -m unittest hardware.pocket_card.electronics_pipeline.tests.test_handoff_export -v
python3 -m hardware.pocket_card.electronics_pipeline.handoff export
python3 -m hardware.pocket_card.electronics_pipeline.handoff export --include-blend
```

Expected: tests pass; both ZIPs validate with `unzip -t`; only the second contains the Blender assembly.

- [ ] **Step 7: Commit outgoing handoff support**

```bash
git add hardware/pocket_card/electronics_pipeline
git commit -m "feat: package Pocket Card engineer handoffs"
```

## Task 7: Safely stage and semantically review returned ZIPs

**Files:**
- Create: `hardware/pocket_card/electronics_pipeline/tests/test_handoff_check.py`
- Modify: `hardware/pocket_card/electronics_pipeline/handoff.py`

- [ ] **Step 1: Write malicious/archive/baseline/classification tests**

```python
class HandoffCheckTest(unittest.TestCase):
    def test_rejects_traversal_symlink_multiple_roots_and_unknown_baseline(self):
        for archive in (
            zip_with("../escape"),
            zip_with_symlink("pocket-card-controller/project/link"),
            zip_with_roots("one", "two"),
            returned_zip(base_digest="0" * 64),
        ):
            with self.assertRaises(HandoffInvalid):
                check_returned_zip(archive, self.repo)

    def test_electrical_pass_with_moved_locked_switch_requires_mechanical_review(self):
        archive = returned_zip(move={"SW_UP1": (0.2, 0.0)})
        result = check_returned_zip(archive, self.repo, runner=FakeKiCadRunner())
        self.assertEqual(result.status, "MECHANICAL REVIEW REQUIRED")
        self.assertTrue(result.stage_dir.is_dir())

    def test_pullup_is_reported_as_added_not_rejected(self):
        archive = returned_zip(add_fixture="R99-pullup")
        result = check_returned_zip(archive, self.repo, runner=FakeKiCadRunner())
        self.assertEqual(result.status, "PASS")
        self.assertEqual(result.semantic_diff["components"]["added"], ["R99"])
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
python3 -m unittest hardware.pocket_card.electronics_pipeline.tests.test_handoff_check -v
```

Expected: check/import APIs missing.

- [ ] **Step 3: Implement safe extraction**

For every `ZipInfo`, normalize with `PurePosixPath`; reject absolute paths, `..`, backslashes, NUL, symlink mode, more than 2,000 members, or more than 2 GiB total uncompressed bytes. Require one `pocket-card-controller/` root, one `project/` directory, the three required KiCad files, `fp-lib-table`, `handoff.json`, and no unexpected canonical filename. Extract member-by-member only after the entire archive passes inspection.

- [ ] **Step 4: Verify baseline and repository policy**

Compare `handoff.json.baseProjectDigest` with `project_digest(ELECTRONICS_DIR)`. Use the repository's current `toolchain.json`, `mechanical_contract.json`, and `validation_waivers.json`; never use returned reference copies as validation policy. A mismatch returns `INVALID` with a message containing both the returned baseline digest and current project digest and ending `do not auto-merge`.

- [ ] **Step 5: Validate and produce semantic reports**

Return this immutable check result:

```python
@dataclass(frozen=True)
class HandoffCheckResult:
    status: str
    stage_dir: Path
    base_digest: str
    returned_digest: str
    semantic_diff: dict[str, object]
    report_json: Path
    report_markdown: Path
```

Stage into a child of `build/pocket_card/handoff/staged/` whose directory name is the returned project's 64-character SHA-256 digest. Write:

- `report.json` with schema, base/current/returned digests, status, validation messages, source-file hashes, and semantic diff;
- `report.md` listing added/removed/changed refs, values, footprints, nets/pins, placements, outline, ERC/DRC counts, and mechanical findings;
- `project/` containing exactly the checked editable tree.

Return exit code 0 for `PASS`, 2 for `MECHANICAL REVIEW REQUIRED`, and 1 for `INVALID`. Invalid ZIPs may emit a report but must not leave extracted project files.

- [ ] **Step 6: Run returned-ZIP tests and a round-trip check**

Run:

```bash
python3 -m unittest hardware.pocket_card.electronics_pipeline.tests.test_handoff_check -v
python3 -m hardware.pocket_card.electronics_pipeline.handoff export
python3 -m hardware.pocket_card.electronics_pipeline.handoff check \
  --zip build/pocket_card/handoff/outgoing/pocket-card-controller.zip
```

Expected: tests pass; unchanged round trip returns `PASS`, empty semantic diff, and a staged absolute path.

- [ ] **Step 7: Commit returned-ZIP checking**

```bash
git add hardware/pocket_card/electronics_pipeline
git commit -m "feat: validate returned Pocket Card handoffs"
```

## Task 8: Add explicit, transactional acceptance

**Files:**
- Create: `hardware/pocket_card/electronics_pipeline/tests/test_handoff_accept.py`
- Modify: `hardware/pocket_card/electronics_pipeline/handoff.py`

- [ ] **Step 1: Write acceptance safety tests**

```python
class HandoffAcceptTest(unittest.TestCase):
    def test_refuses_master_failed_check_and_tampered_stage(self):
        for branch, status, tamper in (
            ("master", "PASS", False),
            ("codex/review", "INVALID", False),
            ("codex/review", "PASS", True),
        ):
            stage = checked_stage(status=status)
            if tamper:
                (stage / "project" / "pocket_card_controller.kicad_sch").write_text("tampered")
            with self.assertRaises(HandoffInvalid):
                accept_stage(stage, self.repo, branch_name=branch)

    def test_accepts_only_editable_inputs_and_never_policy_or_git(self):
        stage = checked_stage(status="PASS", add_pullup=True, altered_policy=True)
        accepted = accept_stage(stage, self.repo, branch_name="codex/review")
        self.assertIn("pocket_card_controller.kicad_sch", accepted)
        self.assertEqual(read_policy(self.repo), self.original_policy)
        self.assertEqual(git_head(self.repo), self.original_head)
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
python3 -m unittest hardware.pocket_card.electronics_pipeline.tests.test_handoff_accept -v
```

Expected: acceptance API missing.

- [ ] **Step 3: Implement acceptance preconditions**

Require a non-`main`/non-`master` branch, a `PASS` or `MECHANICAL REVIEW REQUIRED` checked report, unchanged current base digest, unchanged staged digest, no pre-existing Git changes beneath the canonical editable paths, and required source files present. Ignore unrelated dirty paths elsewhere in the worktree. Mechanical-review acceptance is allowed on the review branch but print that case/release targets remain blocked.

- [ ] **Step 4: Implement transactional promotion**

Copy every accepted file to a temporary sibling, fsync and `os.replace` files only after every source/hash check succeeds. Copy only `EDITABLE_PROJECT_FILES` and members beneath `EDITABLE_PROJECT_DIRS`. Never copy `toolchain.json`, `mechanical_contract.json`, `validation_waivers.json`, reports, handoff metadata, editor state, or derived references. Do not delete an existing project-local file because it is absent from the return; report it as retained.

- [ ] **Step 5: Add the accept CLI and postcondition**

```bash
python3 -m hardware.pocket_card.electronics_pipeline.handoff accept \
  --staged "$STAGED_DIR"
```

Set `STAGED_DIR` to the absolute path printed by the successful check command.

After replacement, recompute the canonical digest and require it to equal the staged returned digest. Print changed canonical paths and the next commands; do not run Git or generate outputs.

- [ ] **Step 6: Run acceptance and full handoff unit tests**

Run:

```bash
python3 -m unittest discover \
  -s hardware/pocket_card/electronics_pipeline/tests \
  -p 'test_handoff_*.py' -v
```

Expected: malicious/tamper/branch/policy tests pass; no test writes outside its temporary repository.

- [ ] **Step 7: Commit acceptance support**

```bash
git add hardware/pocket_card/electronics_pipeline
git commit -m "feat: accept checked Pocket Card handoffs"
```

## Task 9: Rewire normal builds and isolate every legacy generator

**Files:**
- Modify: `Makefile`
- Modify: `hardware/pocket_card/case/build_pcb.sh`
- Modify: `hardware/pocket_card/case/test_emboss_shells.py`
- Create: `hardware/pocket_card/electronics_pipeline/tests/test_make_targets.py`
- Remove: `hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pro`
- Remove: `hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_sch`
- Remove: `hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb`
- Remove: `hardware/pocket_card/case/out/pcb/fp-lib-table`

- [ ] **Step 1: Write a failing target-reachability test**

```python
class MakeTargetTest(unittest.TestCase):
    def test_normal_targets_cannot_reach_legacy_generators(self):
        forbidden = ("build_pcb.sh", "pcb.py", "pcb_route.py", "pcb_reroute.py", "generate_kicad.js")
        for target in (
            "pocket_card_kicad",
            "pocket_card_kicad_check",
            "pocket_card_pcb_exports",
            "pocket_card_case",
            "pocket_card_case_shells",
            "pocket_card_engineer_export",
            "pocket_card_engineer_check",
        ):
            output = subprocess.check_output(["make", "-n", target], text=True)
            self.assertFalse(any(name in output for name in forbidden), (target, output))

    def test_legacy_target_is_named_and_guarded(self):
        output = subprocess.run(
            ["make", "pocket_card_legacy_pcb_rebuild"], text=True, capture_output=True)
        self.assertNotEqual(output.returncode, 0)
        self.assertIn("POCKET_CARD_ALLOW_LEGACY_REBUILD=1", output.stderr + output.stdout)
```

- [ ] **Step 2: Run the target test and verify it fails**

Run:

```bash
python3 -m unittest hardware.pocket_card.electronics_pipeline.tests.test_make_targets -v
```

Expected: missing/new targets or forbidden generator reachable from `pocket_card_case`.

- [ ] **Step 3: Define the production Make targets**

Add `PYTHON ?= python3` beside the existing `NODE ?= node`, then wire these recipes:

```make
pocket_card_kicad: pocket_card_kicad_check

pocket_card_kicad_check:
	$(PYTHON) -m hardware.pocket_card.electronics_pipeline.validation

pocket_card_pcb_exports: pocket_card_kicad_check
	$(PYTHON) -m hardware.pocket_card.electronics_pipeline.exports

pocket_card_case: pocket_card_pcb_exports
	cd $(POCKET_CARD_CASE_DIR) && .venv/bin/python build_variants.py
	$(MAKE) pocket_card_case_embossed

pocket_card_case_shells:
	$(PYTHON) -m hardware.pocket_card.electronics_pipeline.exports --check-current
	cd $(POCKET_CARD_CASE_DIR) && .venv/bin/python build_variants.py
	$(MAKE) pocket_card_case_embossed

pocket_card_engineer_export: pocket_card_pcb_exports
	$(PYTHON) -m hardware.pocket_card.electronics_pipeline.handoff export $(if $(INCLUDE_BLEND),--include-blend,)

pocket_card_engineer_check:
	@test -n "$(ZIP)" || (echo "set ZIP=/absolute/path/revision.zip" >&2; exit 1)
	$(PYTHON) -m hardware.pocket_card.electronics_pipeline.handoff check --zip "$(ZIP)"

pocket_card_engineer_accept:
	@test -n "$(STAGED)" || (echo "set STAGED=/absolute/path/staged" >&2; exit 1)
	$(PYTHON) -m hardware.pocket_card.electronics_pipeline.handoff accept --staged "$(STAGED)"
```

Add every target to `.PHONY` and `make help`.

- [ ] **Step 4: Guard and isolate the old rebuild**

At the start of `build_pcb.sh`, before it writes anything:

```bash
if [[ "${POCKET_CARD_ALLOW_LEGACY_REBUILD:-}" != "1" ]]; then
  echo "legacy generator disabled; set POCKET_CARD_ALLOW_LEGACY_REBUILD=1 explicitly" >&2
  exit 2
fi
```

Expose it only as `pocket_card_legacy_pcb_rebuild`. Its current `case/out/pcb/` destination is now noncanonical. Rename old test target to `pocket_card_legacy_schematic_tests`; no production or handoff dependency may invoke it.

- [ ] **Step 5: Remove the temporary duplicate KiCad sources from `case/out/pcb/`**

Delete only the four files copied to `electronics/` in Task 1. Keep derived STEP/STL/Gerber/BOM/position/report artifacts in `case/out/pcb/`. Verify `rg` finds no production reference to the deleted source paths.

- [ ] **Step 6: Update existing enclosure target tests**

Change `test_emboss_shells.py` expectations so `pocket_card_case` reaches `pocket_card_pcb_exports`, while `pocket_card_case_shells` reaches `exports --check-current`; both still reach embossed/sculpted finishing.

- [ ] **Step 7: Run target and dry-run tests**

Run:

```bash
python3 -m unittest hardware.pocket_card.electronics_pipeline.tests.test_make_targets -v
python3 -m unittest hardware.pocket_card/case/test_emboss_shells.py -v
make -n pocket_card_case
make -n pocket_card_case_shells
```

Expected: normal-target reachability tests pass; dry runs contain no legacy generator; legacy target refuses without opt-in.

- [ ] **Step 8: Commit build ownership cutover**

```bash
git add Makefile hardware/pocket_card/case hardware/pocket_card/electronics_pipeline
git add -u hardware/pocket_card/case/out/pcb
git commit -m "refactor: make native KiCad authoritative"
```

## Task 10: Document the repeated exchange workflow

**Files:**
- Modify: `hardware/pocket_card/README.md`
- Modify: `hardware/pocket_card/case/README.md`
- Modify: `hardware/pocket_card/schematic/README.md`
- Modify: `hardware/pocket_card/electronics/README.md`
- Create: `hardware/pocket_card/electronics_pipeline/tests/test_documentation.py`

- [ ] **Step 1: Write a failing documentation assertion**

```python
class DocumentationTest(unittest.TestCase):
    def test_no_normal_workflow_tells_users_to_regenerate_kicad_sources(self):
        root = (POCKET_CARD_DIR / "README.md").read_text()
        electronics = (ELECTRONICS_DIR / "README.md").read_text()
        case = (POCKET_CARD_DIR / "case" / "README.md").read_text()
        schematic = (POCKET_CARD_DIR / "schematic" / "README.md").read_text()
        self.assertIn("make pocket_card_engineer_export", root)
        self.assertIn("make pocket_card_engineer_check ZIP=", root)
        self.assertIn("native KiCad", electronics)
        self.assertIn("legacy", schematic.lower())
        self.assertNotIn("make pocket_card_kicad             # validate, regenerate", root + case)
```

- [ ] **Step 2: Run the test and verify it fails against current instructions**

Run:

```bash
python3 -m unittest hardware.pocket_card.electronics_pipeline.tests.test_documentation -v
```

Expected: old regenerate instructions cause failure.

- [ ] **Step 3: Rewrite source-of-truth and build documentation**

Document:

- `electronics/` is the sole editable electrical source;
- `make pocket_card_kicad` is read-only;
- project-local library/model requirements and pinned KiCad 10;
- locks are accident prevention, while the contract is the review gate;
- `pocket_card_case` exports the edited native board before rebuilding the case;
- `pocket_card_case_shells` refuses stale board exports;
- the old JSON/generator directory is historical/legacy and cannot accept production electrical edits.

- [ ] **Step 4: Add the exact repeated-ZIP operator runbook**

```text
1. make pocket_card_engineer_export INCLUDE_BLEND=1
2. Send the printed ZIP; keep its Git commit/digest in the archive.
3. Receive the returned ZIP.
4. git switch -c engineer/pocket-card-rN
5. make pocket_card_engineer_check ZIP=/absolute/path/returned.zip
6. Review report.md and the raw Git/KiCad diff.
7. make pocket_card_engineer_accept STAGED=/absolute/path/printed-stage
8. If mechanical review is required, update enclosure CAD and mechanical_contract.json deliberately.
9. make pocket_card_kicad
10. make pocket_card_case
11. Commit KiCad source separately from regenerated release artifacts.
```

State that returned policy copies cannot waive findings and that concurrent/stale baselines are not auto-merged.

- [ ] **Step 5: Run documentation tests and search for stale instructions**

Run:

```bash
python3 -m unittest hardware.pocket_card.electronics_pipeline.tests.test_documentation -v
rg -n "canonical electrical|regenerate.*schematic|build_pcb\.sh|case/out/pcb/pocket_card_controller\.kicad" \
  hardware/pocket_card Makefile
```

Expected: only explicitly labelled legacy descriptions mention generation; no normal workflow points to deleted source paths.

- [ ] **Step 6: Commit documentation**

```bash
git add hardware/pocket_card/README.md hardware/pocket_card/case/README.md \
  hardware/pocket_card/schematic/README.md hardware/pocket_card/electronics/README.md \
  hardware/pocket_card/electronics_pipeline/tests/test_documentation.py
git commit -m "docs: explain Pocket Card engineer exchange workflow"
```

## Task 11: Prove engineer-added parts survive the complete orchestration

**Files:**
- Create: `hardware/pocket_card/electronics_pipeline/tests/test_round_trip.py`
- Modify only if a failure exposes a fixed-reference assumption: the smallest responsible pipeline module

- [ ] **Step 1: Add a complete fake-runner round-trip with `R99`**

```python
class RoundTripTest(unittest.TestCase):
    def test_added_pullup_survives_check_accept_export_and_case_inputs(self):
        repo = make_repo_fixture_from_canonical_inventory(self.tempdir)
        outgoing = export_handoff(repo, runner=FakeKiCadRunner())
        returned = add_linked_pullup_to_handoff(
            outgoing,
            ref="R99",
            value="10k",
            footprint="Resistor_SMD:R_0402_1005Metric",
            nets=("+3V3", "SIG_ACTION"),
        )
        checked = check_returned_zip(returned, repo, runner=FakeKiCadRunner())
        self.assertEqual(checked.status, "PASS")
        accept_stage(checked.stage_dir, repo, branch_name="codex/round-trip")
        exports = export_outputs(repo / "hardware/pocket_card/electronics",
                                 repo / "hardware/pocket_card/case/out/pcb",
                                 runner=FakeKiCadRunner())
        self.assertIn("R99", checked.semantic_diff["components"]["added"])
        self.assertEqual(exports.project_digest, checked.returned_digest)
        self.assertTrue(exports.step_path.is_file())
```

The fixture uses small valid KiCad/netlist fragments and a fake KiCad/export runner so it tests orchestration without duplicating the 280k-line routed board. Real KiCad validation remains covered separately against the canonical project.

- [ ] **Step 2: Run the test and verify it fails if any legacy fixed allowlist remains**

Run:

```bash
python3 -m unittest hardware.pocket_card.electronics_pipeline.tests.test_round_trip -v
```

Expected before final fixes: a focused failure naming the module that still assumes the original 17 refs; never weaken UUID/net/association checks to make it pass.

- [ ] **Step 3: Remove only demonstrated fixed-reference assumptions**

Use the schematic/netlist and board as the component inventory. Retain explicit allowlists only for board-only mechanical pads and contract-critical mechanical refs. Ensure BOM and placement exports enumerate `R99` automatically.

- [ ] **Step 4: Run the round-trip and full pipeline unit suite**

Run:

```bash
python3 -m unittest discover \
  -s hardware/pocket_card/electronics_pipeline/tests \
  -p 'test_*.py' -v
```

Expected: all pipeline tests pass, including safe ZIP and R99 round trip.

- [ ] **Step 5: Commit the end-to-end regression**

```bash
git add hardware/pocket_card/electronics_pipeline
git commit -m "test: preserve engineer-added Pocket Card components"
```

## Task 12: Final verification and handoff rehearsal

**Files:**
- Modify only files required by failures found in this task

- [ ] **Step 1: Run all focused Python and legacy regression tests**

Run:

```bash
python3 -m unittest discover \
  -s hardware/pocket_card/electronics_pipeline/tests \
  -p 'test_*.py' -v
python3 -m unittest hardware/pocket_card/case/test_pcb_connectivity.py -v
python3 -m unittest hardware/pocket_card/case/test_emboss_shells.py -v
```

Expected: all pass. The old connectivity test is permitted only as a legacy generator regression and must not be called by normal Make targets.

- [ ] **Step 2: Run the authoritative KiCad gate twice and verify source immutability**

Run:

```bash
shasum -a 256 hardware/pocket_card/electronics/pocket_card_controller.kicad_* > /tmp/pocket-card-before.sha256
make pocket_card_kicad
make pocket_card_kicad
shasum -a 256 hardware/pocket_card/electronics/pocket_card_controller.kicad_* > /tmp/pocket-card-after.sha256
diff -u /tmp/pocket-card-before.sha256 /tmp/pocket-card-after.sha256
```

Expected: both validations pass and the digest diff is empty.

- [ ] **Step 3: Run real exports and the shell staleness gate**

Run:

```bash
make pocket_card_pcb_exports
make pocket_card_case_shells
```

Expected: validation/export succeed, source manifest matches, and shell generation uses the exported native-board STEP. If Blender is unavailable, the command must fail with the existing actionable `set BLENDER=` message after the PCB staleness check has passed.

- [ ] **Step 4: Rehearse outgoing/check/accept without touching canonical source**

Run export and check on the current feature branch, then copy the staged fixture into a disposable temporary Git worktree for the accept rehearsal. Verify unchanged round trip, optional Blender inclusion, policy exclusion, report contents, and no automatic Git commit.

- [ ] **Step 5: Confirm legacy isolation and repository cleanliness**

Run:

```bash
python3 -m unittest hardware.pocket_card.electronics_pipeline.tests.test_make_targets -v
git status --short
git diff --check
```

Expected: the legacy target is unreachable without its opt-in; only intentionally regenerated release artifacts may remain modified, and those are reviewed separately from source.

- [ ] **Step 6: Commit any verification-only fixes**

```bash
git add Makefile hardware/pocket_card/electronics \
  hardware/pocket_card/electronics_pipeline \
  hardware/pocket_card/case/README.md hardware/pocket_card/case/export_smt.py \
  hardware/pocket_card/case/place_preview.py hardware/pocket_card/case/build_pcb.sh \
  hardware/pocket_card/case/test_emboss_shells.py hardware/pocket_card/README.md \
  hardware/pocket_card/schematic/README.md
git commit -m "fix: complete Pocket Card handoff verification"
```

Skip this commit when no files required a fix. Never stage `hardware/pocket_card/case/out/` in this verification-fix commit.
