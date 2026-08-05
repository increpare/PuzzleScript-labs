"""End-to-end engineer handoff round trip with an added pull-up resistor."""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

import hardware.pocket_card.electronics_pipeline.handoff as handoff_module
from hardware.pocket_card.case.export_smt import PARTS
from hardware.pocket_card.electronics_pipeline.exports import export_outputs
from hardware.pocket_card.electronics_pipeline.handoff import (
    accept_stage,
    check_returned_zip,
    export_handoff,
)
from hardware.pocket_card.electronics_pipeline.inventory import parse_board
from hardware.pocket_card.electronics_pipeline.validation import (
    MECHANICAL_REVIEW_REQUIRED,
    PASS,
    ValidationResult,
)
from hardware.pocket_card.electronics_pipeline.tests.test_exports import (
    FakeRunner,
    FakeValidator,
)
from hardware.pocket_card.electronics_pipeline.tests.test_handoff_accept import (
    _init_git_repo,
)
from hardware.pocket_card.electronics_pipeline.tests.test_handoff_check import (
    FakeKiCadRunner,
)


def _component(ref: str, *, index: int) -> dict[str, object]:
    uuid = f"{index:08x}-2222-4333-8444-555555555555"
    return {
        "ref": ref,
        "value": ref,
        "footprint": "Fixture:Part",
        "uuid": uuid,
        "fields": {},
    }


def _footprint(ref: str, *, index: int) -> dict[str, object]:
    uuid = f"{index:08x}-2222-4333-8444-555555555555"
    return {
        "ref": ref,
        "value": ref,
        "library_id": "Fixture:Part",
        "uuid": uuid,
        "symbol_path": f"/{uuid}",
        "x_mm": float(index),
        "y_mm": float(index),
        "rotation_deg": 0.0,
        "layer": "F.Cu",
        "locked": False,
        "pads": {},
        "courtyard_bbox_mm": None,
    }


def _inventory(*, pullup: bool = False) -> dict[str, object]:
    refs = list(sorted(PARTS))
    if pullup:
        refs.append("R99")
    components = {
        ref: _component(ref, index=index) for index, ref in enumerate(refs, start=1)
    }
    footprints = {
        ref: _footprint(ref, index=index) for index, ref in enumerate(refs, start=1)
    }
    if pullup:
        components["R99"] = {
            "ref": "R99",
            "value": "10k",
            "footprint": "Resistor_SMD:R_0402_1005Metric",
            "uuid": "11111111-2222-4333-8444-555555555555",
            "fields": {},
        }
        footprints["R99"] = {
            "ref": "R99",
            "value": "10k",
            "library_id": "Resistor_SMD:R_0402_1005Metric",
            "uuid": "11111111-2222-4333-8444-555555555555",
            "symbol_path": "/11111111-2222-4333-8444-555555555555",
            "x_mm": 30.0,
            "y_mm": 30.0,
            "rotation_deg": 0.0,
            "layer": "F.Cu",
            "locked": False,
            "pads": {},
            "courtyard_bbox_mm": None,
        }
    return {
        "schematic": {"components": components, "nets": {}},
        "board": {
            "thickness_mm": 1.6,
            "footprints": footprints,
            "edge_cuts": [],
        },
    }


PROJECT_NAME = "pocket_card_controller"
ARCHIVE_ROOT = "pocket-card-controller"
FIXTURES = Path(__file__).with_name("fixtures")
PULLUP_BOARD_FRAGMENT = FIXTURES / "pullup_board_fragment.kicad_pcb"
_GIT_ENV = {
    **os.environ,
    "GIT_AUTHOR_NAME": "round-trip-test",
    "GIT_AUTHOR_EMAIL": "round-trip-test@example.com",
    "GIT_COMMITTER_NAME": "round-trip-test",
    "GIT_COMMITTER_EMAIL": "round-trip-test@example.com",
}


def _reference_property_pattern(ref: str) -> str:
    return f'(property "Reference" "{ref}")'


def _board_references(board_text: str) -> tuple[str, ...]:
    inventory = parse_board(board_text)
    return tuple(sorted(inventory.footprints))


class InventoryAwareFakeRunner(FakeRunner):
    """KiCad CLI fake that derives placement rows from the project board."""

    def __call__(self, command, **kwargs):
        command = tuple(str(item) for item in command)
        if "pos" in command:
            board_flag = next(
                index for index, item in enumerate(command) if item.endswith(".kicad_pcb")
            )
            board = Path(command[board_flag])
            refs = _board_references(board.read_text(encoding="utf-8"))
            output_flag = "--output" if "--output" in command else "-o"
            output = Path(command[command.index(output_flag) + 1])
            output.parent.mkdir(parents=True, exist_ok=True)
            rows = "".join(
                f'"{ref}","value","package","10","20","90","top"\n'
                for ref in refs
            ).encode("utf-8")
            output.write_bytes(
                b'"Ref","Val","Package","PosX","PosY","Rot","Side"\n' + rows
            )
            return subprocess.CompletedProcess(command, 0, "", "")
        if "bom" in command:
            schematic_flag = next(
                index
                for index, item in enumerate(command)
                if item.endswith(".kicad_sch")
            )
            schematic = Path(command[schematic_flag]).read_text(encoding="utf-8")
            refs = tuple(
                sorted(
                    {
                        token
                        for line in schematic.splitlines()
                        if '(property "Reference" "' in line
                        for token in [line.split('(property "Reference" "')[1].split('"')[0]]
                        if token
                    }
                )
            )
            output_flag = "--output" if "--output" in command else "-o"
            output = Path(command[command.index(output_flag) + 1])
            output.parent.mkdir(parents=True, exist_ok=True)
            rows = "".join(
                f'"{ref}","10k","Resistor_SMD:R_0402_1005Metric","1",""\n'
                for ref in refs
            ).encode("utf-8")
            output.write_bytes(
                b'"Refs","Value","Footprint","Qty","DNP"\n' + rows
            )
            return subprocess.CompletedProcess(command, 0, "", "")
        return super().__call__(command, **kwargs)


def _minimal_footprint(ref: str, index: int) -> str:
    uuid = f"{index:08x}-2222-4333-8444-555555555555"
    return (
        f'  (footprint "Fixture:Part" (layer "F.Cu")\n'
        f'    (uuid "{uuid}")\n'
        f'    (path "/{uuid}")\n'
        f'    (at {index} {index} 0)\n'
        f'    (property "Reference" "{ref}")\n'
        f'    (property "Value" "{ref}"))'
    )


def _minimal_schematic(refs: tuple[str, ...]) -> str:
    symbols = "".join(
        f'  (symbol (property "Reference" "{ref}") (property "Value" "{ref}"))\n'
        for ref in refs
    )
    return f"(kicad_sch)\n{symbols}"


def _minimal_board(refs: tuple[str, ...]) -> str:
    footprints = "".join(
        _minimal_footprint(ref, index) + "\n"
        for index, ref in enumerate(refs, start=1)
    )
    return f"(kicad_pcb (general (thickness 1.6))\n{footprints})"


def make_repo_fixture_from_canonical_inventory(root: Path) -> Path:
    """Create a miniature git-backed Pocket Card tree with baseline inventory."""

    repo = root / "repo"
    project = repo / "hardware" / "pocket_card" / "electronics"
    exports = repo / "hardware" / "pocket_card" / "case" / "out" / "pcb"
    handoff_root = repo / "build" / "pocket_card" / "handoff"
    project.mkdir(parents=True)
    exports.mkdir(parents=True)
    handoff_root.mkdir(parents=True)
    canonical_refs = tuple(sorted(PARTS))
    for name, content in {
        f"{PROJECT_NAME}.kicad_pro": "{}\n",
        f"{PROJECT_NAME}.kicad_sch": _minimal_schematic(canonical_refs),
        f"{PROJECT_NAME}.kicad_pcb": _minimal_board(canonical_refs),
        "fp-lib-table": "(fp_lib_table (version 7))\n",
        "sym-lib-table": "(sym_lib_table (version 7))\n",
        "toolchain.json": (
            '{"schemaVersion":1,"project":"pocket_card_controller",'
            '"kicad":{"major":10,"minimum":"10.0.4"}}\n'
        ),
        "mechanical_contract.json": '{"schemaVersion":1,"features":[]}\n',
        "validation_waivers.json": '{"schemaVersion":1,"groups":[]}\n',
    }.items():
        (project / name).write_text(content, encoding="utf-8")

    export_outputs(
        project,
        exports,
        runner=InventoryAwareFakeRunner(project),
        validator=FakeValidator(),
    )
    _init_git_repo(repo)
    subprocess.run(
        ("git", "checkout", "-b", "codex/round-trip"),
        cwd=repo,
        check=True,
        capture_output=True,
        env=_GIT_ENV,
    )
    return repo


def add_linked_pullup_to_handoff(
    archive: Path,
    *,
    ref: str = "R99",
    value: str = "10k",
    footprint: str = "Resistor_SMD:R_0402_1005Metric",
    nets: tuple[str, str] = ("+3V3", "SIG_ACTION"),
) -> Path:
    """Return a new engineer handoff ZIP with a linked pull-up added."""

    del value, footprint, nets  # Fixture content is canonical; args document intent.
    destination = archive.with_name(f"{archive.stem}-with-{ref.lower()}{archive.suffix}")
    pullup_board = PULLUP_BOARD_FRAGMENT.read_text(encoding="utf-8")
    with zipfile.ZipFile(archive) as source, zipfile.ZipFile(destination, "w") as target:
        for info in source.infolist():
            payload = source.read(info.filename)
            if info.filename.endswith(f"/project/{PROJECT_NAME}.kicad_pcb"):
                baseline = payload.decode("utf-8").rstrip()
                if not baseline.endswith(")"):
                    baseline += "\n)"
                payload = (
                    baseline[:-1]
                    + "\n"
                    + pullup_board[pullup_board.index("(footprint") :]
                ).encode("utf-8")
            elif info.filename.endswith(f"/project/{PROJECT_NAME}.kicad_sch"):
                baseline = payload.decode("utf-8").rstrip()
                payload = (
                    baseline
                    + "\n"
                    + '  (symbol (property "Reference" "R99")'
                    + ' (property "Value" "10k"))\n'
                ).encode("utf-8")
            target.writestr(info, payload)
    return destination


def _handoff_validator(project: Path, runner=None):
    board_text = (project / f"{PROJECT_NAME}.kicad_pcb").read_text(encoding="utf-8")
    pullup = _reference_property_pattern("R99") in board_text
    inventory = _inventory(pullup=pullup)
    moved = "moved" in board_text
    status = MECHANICAL_REVIEW_REQUIRED if moved else PASS
    return ValidationResult(status, ("fake validation",), {}, inventory)


class RoundTripTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.tempdir = Path(temporary.name)
        self.repo = make_repo_fixture_from_canonical_inventory(self.tempdir)
        self.project = self.repo / "hardware" / "pocket_card" / "electronics"
        self.exports = self.repo / "hardware" / "pocket_card" / "case" / "out" / "pcb"
        self.handoff_root = self.repo / "build" / "pocket_card" / "handoff"
        self.outgoing = self.tempdir / "outgoing"

    def _patch_handoff_paths(self):
        return mock.patch.multiple(
            handoff_module,
            ELECTRONICS_DIR=self.project,
            HANDOFF_BUILD_DIR=self.handoff_root,
        )

    def test_added_pullup_survives_check_accept_export_and_case_inputs(self):
        outgoing = self.outgoing
        outgoing.mkdir()
        with self._patch_handoff_paths():
            archive = export_handoff(
                self.project,
                output_dir=outgoing,
                export_dir=self.exports,
                validator=_handoff_validator,
                current_exports_checker=lambda project, export_dir: None,
                git_metadata_provider=lambda repo_root: ("a" * 40, 1785888000),
                source_date_epoch=1785888000,
                runner=FakeKiCadRunner(),
            )
            returned = add_linked_pullup_to_handoff(
                archive,
                ref="R99",
                value="10k",
                footprint="Resistor_SMD:R_0402_1005Metric",
                nets=("+3V3", "SIG_ACTION"),
            )
            checked = check_returned_zip(
                returned,
                self.repo,
                runner=FakeKiCadRunner(),
                validator=_handoff_validator,
            )
            self.assertEqual(checked.status, "PASS")
            self.assertIn("R99", checked.semantic_diff["components"]["added"])
            accept_stage(
                checked.stage_dir,
                self.repo,
                branch_name="codex/round-trip",
            )
            exports = export_outputs(
                self.project,
                self.exports,
                runner=InventoryAwareFakeRunner(self.project),
                validator=FakeValidator(),
            )
        self.assertEqual(exports.project_digest, checked.returned_digest)
        self.assertTrue(exports.step_path.is_file())
        bom = (self.exports / "BOM.csv").read_text(encoding="utf-8")
        pos = (self.exports / f"{PROJECT_NAME}-all-pos.csv").read_text(encoding="utf-8")
        self.assertIn("R99", bom)
        self.assertIn("R99", pos)


if __name__ == "__main__":
    unittest.main()
