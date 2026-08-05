import hashlib
import json
import stat
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

import hardware.pocket_card.electronics_pipeline.handoff as handoff_module
from hardware.pocket_card.electronics_pipeline.handoff import (
    HandoffInvalid,
    check_returned_zip,
)
from hardware.pocket_card.electronics_pipeline.inventory import project_digest
from hardware.pocket_card.electronics_pipeline.validation import (
    MECHANICAL_REVIEW_REQUIRED,
    PASS,
    ValidationResult,
)


PROJECT_NAME = "pocket_card_controller"


class FakeKiCadRunner:
    """Marker runner: validation is injected with deterministic inventories."""


def _inventory(*, moved=False, pullup=False):
    components = {
        "SW_UP1": {
            "ref": "SW_UP1",
            "value": "SW",
            "footprint": "Switch:SW",
            "uuid": "switch-up",
            "fields": {},
        }
    }
    footprints = {
        "SW_UP1": {
            "ref": "SW_UP1",
            "value": "SW",
            "library_id": "Switch:SW",
            "uuid": "switch-up",
            "symbol_path": "/switch-up",
            "x_mm": 10.2 if moved else 10.0,
            "y_mm": 20.0,
            "rotation_deg": 0.0,
            "layer": "F.Cu",
            "locked": True,
            "pads": {},
            "courtyard_bbox_mm": None,
        }
    }
    if pullup:
        components["R99"] = {
            "ref": "R99",
            "value": "10k",
            "footprint": "Resistor:R_0402",
            "uuid": "r99",
            "fields": {},
        }
        footprints["R99"] = {
            "ref": "R99",
            "value": "10k",
            "library_id": "Resistor:R_0402",
            "uuid": "r99",
            "symbol_path": "/r99",
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


class HandoffCheckTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.repo = self.root / "repo"
        self.project = self.repo / "hardware" / "pocket_card" / "electronics"
        self.project.mkdir(parents=True)
        for name, content in {
            f"{PROJECT_NAME}.kicad_pro": "{}\n",
            f"{PROJECT_NAME}.kicad_sch": "(kicad_sch)\n",
            f"{PROJECT_NAME}.kicad_pcb": "(kicad_pcb)\n",
            "fp-lib-table": "(fp_lib_table (version 7))\n",
            "toolchain.json": '{"schemaVersion":1,"project":"pocket_card_controller","kicad":{"major":10,"minimum":"10.0.4"}}\n',
            "mechanical_contract.json": '{"schemaVersion":1,"features":[]}\n',
            "validation_waivers.json": '{"schemaVersion":1,"groups":[]}\n',
        }.items():
            (self.project / name).write_text(content, encoding="utf-8")
        self.base_digest = project_digest(self.project)
        self.stage_root = self.repo / "build" / "pocket_card" / "handoff"

    def returned_zip(self, *, base_digest=None, move=False, pullup=False):
        path = self.root / f"returned-{move}-{pullup}.zip"
        board_marker = ("moved" if move else "") + (" pullup" if pullup else "")
        with zipfile.ZipFile(path, "w") as archive:
            root = "pocket-card-controller"
            for name, content in {
                f"{root}/project/{PROJECT_NAME}.kicad_pro": "{}\n",
                f"{root}/project/{PROJECT_NAME}.kicad_sch": "(kicad_sch)\n",
                f"{root}/project/{PROJECT_NAME}.kicad_pcb": f"(kicad_pcb) {board_marker}\n",
                f"{root}/project/fp-lib-table": "(fp_lib_table (version 7))\n",
                f"{root}/handoff.json": json.dumps(
                    {
                        "schemaVersion": 1,
                        "projectName": PROJECT_NAME,
                        "baseProjectDigest": base_digest or self.base_digest,
                    }
                ),
            }.items():
                archive.writestr(name, content)
        return path

    def check(self, archive, *, moved=False, pullup=False):
        baseline = _inventory()
        returned = _inventory(moved=moved, pullup=pullup)

        def validator(project, runner=None):
            inventory = returned if "moved" in (project / f"{PROJECT_NAME}.kicad_pcb").read_text(encoding="utf-8") else baseline
            if "pullup" in (project / f"{PROJECT_NAME}.kicad_pcb").read_text(encoding="utf-8"):
                inventory = _inventory(pullup=True)
            status = MECHANICAL_REVIEW_REQUIRED if moved else PASS
            return ValidationResult(status, ("fake validation",), {}, inventory)

        with mock.patch.object(handoff_module, "ELECTRONICS_DIR", self.project), mock.patch.object(
            handoff_module, "HANDOFF_BUILD_DIR", self.stage_root
        ), mock.patch.object(handoff_module, "validate_project", side_effect=validator):
            return check_returned_zip(archive, self.repo, runner=FakeKiCadRunner())

    def test_rejects_traversal_symlink_and_multiple_roots(self):
        traversal = self.root / "traversal.zip"
        symlink = self.root / "symlink.zip"
        roots = self.root / "roots.zip"
        with zipfile.ZipFile(traversal, "w") as archive:
            archive.writestr("../escape", "x")
        with zipfile.ZipFile(symlink, "w") as archive:
            info = zipfile.ZipInfo("pocket-card-controller/project/link")
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(info, "target")
        with zipfile.ZipFile(roots, "w") as archive:
            archive.writestr("one/project/a", "x")
            archive.writestr("two/project/a", "x")
        for archive in (traversal, symlink, roots):
            with self.subTest(archive=archive.name), self.assertRaises(HandoffInvalid):
                self.check(archive)

    def test_unknown_baseline_returns_invalid_do_not_auto_merge(self):
        result = self.check(self.returned_zip(base_digest="0" * 64))
        self.assertEqual(result.status, "INVALID")
        report = json.loads(result.report_json.read_text(encoding="utf-8"))
        self.assertIn("0" * 64, "\n".join(report["validationMessages"]))
        self.assertIn(self.base_digest, "\n".join(report["validationMessages"]))
        self.assertTrue(report["validationMessages"][-1].endswith("do not auto-merge"))
        self.assertFalse((result.stage_dir / "project").exists())

    def test_electrical_pass_with_moved_locked_switch_requires_mechanical_review(self):
        result = self.check(self.returned_zip(move=True), moved=True)
        self.assertEqual(result.status, "MECHANICAL REVIEW REQUIRED")
        self.assertTrue(result.stage_dir.is_dir())

    def test_pullup_is_reported_as_added_not_rejected(self):
        result = self.check(self.returned_zip(pullup=True), pullup=True)
        self.assertEqual(result.status, "PASS")
        self.assertEqual(result.semantic_diff["components"]["added"], ["R99"])


if __name__ == "__main__":
    unittest.main()
