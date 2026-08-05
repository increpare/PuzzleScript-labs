import hashlib
import json
import stat
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

import hardware.pocket_card.electronics_pipeline.handoff as handoff_module
from hardware.pocket_card.electronics_pipeline.exports import (
    _export_recipe_digest,
    _policy_digest,
)
from hardware.pocket_card.electronics_pipeline.handoff import (
    HandoffInvalid,
    check_returned_zip,
    export_handoff,
)
from hardware.pocket_card.electronics_pipeline.validation import (
    INVALID,
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
        project_dir = self.repo / "hardware" / "pocket_card" / "electronics"
        project_dir.mkdir(parents=True)
        self.project = project_dir.resolve(strict=True)
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
        self.base_digest = handoff_module._handoff_project_digest(self.project)
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

    def check(self, archive, *, moved=False, pullup=False, validator=None):
        baseline = _inventory()
        returned = _inventory(moved=moved, pullup=pullup)

        def default_validator(project, runner=None):
            board_text = (project / f"{PROJECT_NAME}.kicad_pcb").read_text(
                encoding="utf-8"
            )
            inventory = returned if "moved" in board_text else baseline
            if "pullup" in board_text:
                inventory = _inventory(pullup=True)
            status = MECHANICAL_REVIEW_REQUIRED if moved else PASS
            return ValidationResult(status, ("fake validation",), {}, inventory)

        with mock.patch.object(handoff_module, "ELECTRONICS_DIR", self.project), mock.patch.object(
            handoff_module, "HANDOFF_BUILD_DIR", self.stage_root
        ), mock.patch.object(
            handoff_module,
            "validate_project",
            side_effect=validator or default_validator,
        ):
            return check_returned_zip(archive, self.repo, runner=FakeKiCadRunner())

    def test_handoff_project_digest_matches_export_digest(self):
        export_digest = handoff_module._canonical_project_digest(self.project)[0]
        self.assertEqual(handoff_module._handoff_project_digest(self.project), export_digest)
        self.assertEqual(self.base_digest, export_digest)

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

    def test_rejects_unexpected_project_member(self):
        archive = self.returned_zip()
        with zipfile.ZipFile(archive, "a") as package:
            package.writestr("pocket-card-controller/project/evil.txt", "x")
        with self.assertRaises(HandoffInvalid):
            self.check(archive)

    def test_rejects_returned_policy_file_in_project_tree(self):
        archive = self.returned_zip()
        with zipfile.ZipFile(archive, "a") as package:
            package.writestr(
                "pocket-card-controller/project/toolchain.json",
                '{"schemaVersion":1,"project":"evil"}\n',
            )
        with self.assertRaises(HandoffInvalid):
            self.check(archive)

    def test_unknown_baseline_returns_invalid_do_not_auto_merge(self):
        result = self.check(self.returned_zip(base_digest="0" * 64))
        self.assertEqual(result.status, "INVALID")
        report = json.loads(result.report_json.read_text(encoding="utf-8"))
        self.assertIn("0" * 64, "\n".join(report["validationMessages"]))
        self.assertIn(self.base_digest, "\n".join(report["validationMessages"]))
        self.assertTrue(report["validationMessages"][-1].endswith("do not auto-merge"))
        self.assertFalse((result.stage_dir / "project").exists())

    def test_staged_project_uses_canonical_validation_policy(self):
        canonical_policy = (
            '{"schemaVersion":1,"groups":[{"scope":"ERC","type":"test"}]}\n'
        )
        (self.project / "validation_waivers.json").write_text(
            canonical_policy, encoding="utf-8"
        )
        self.base_digest = handoff_module._handoff_project_digest(self.project)
        archive = self.returned_zip()
        with zipfile.ZipFile(archive, "a") as package:
            package.writestr(
                "pocket-card-controller/reference/validation_waivers.json",
                '{"schemaVersion":1,"groups":[]}\n',
            )
        result = self.check(archive)
        staged_policy = (
            result.stage_dir / "project" / "validation_waivers.json"
        ).read_text(encoding="utf-8")
        self.assertEqual(staged_policy, canonical_policy)

    def test_validation_invalid_removes_staged_project(self):
        def invalid_validator(project, runner=None):
            return ValidationResult(INVALID, ("bad project",), {}, _inventory())

        result = self.check(self.returned_zip(), validator=invalid_validator)
        self.assertEqual(result.status, "INVALID")
        self.assertFalse((result.stage_dir / "project").exists())

    def test_electrical_pass_with_moved_locked_switch_requires_mechanical_review(self):
        result = self.check(self.returned_zip(move=True), moved=True)
        self.assertEqual(result.status, "MECHANICAL REVIEW REQUIRED")
        self.assertTrue(result.stage_dir.is_dir())

    def test_pullup_is_reported_as_added_not_rejected(self):
        result = self.check(self.returned_zip(pullup=True), pullup=True)
        self.assertEqual(result.status, "PASS")
        self.assertEqual(result.semantic_diff["components"]["added"], ["R99"])

    def test_export_check_unchanged_round_trip_passes_with_empty_semantic_diff(self):
        exports = self.root / "exports"
        output = self.root / "outgoing"
        exports.mkdir()
        output.mkdir()
        for name, content in {
            f"{PROJECT_NAME}.pdf": b"%PDF-fake\n",
            f"{PROJECT_NAME}.step": b"ISO-10303-21;\n",
            "erc.json": b'{"violations":[]}\n',
            "drc.json": b'{"violations":[]}\n',
        }.items():
            (exports / name).write_bytes(content)
        digest = handoff_module._handoff_project_digest(self.project)
        (exports / "source_manifest.json").write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "projectName": PROJECT_NAME,
                    "projectDigest": digest,
                    "policyDigest": _policy_digest(self.project),
                    "exportRecipeDigest": _export_recipe_digest(),
                    "kicadVersion": "10.0.4",
                    "artifacts": {
                        name: {
                            "sha256": hashlib.sha256((exports / name).read_bytes()).hexdigest(),
                            "size": (exports / name).stat().st_size,
                        }
                        for name in (
                            f"{PROJECT_NAME}.pdf",
                            f"{PROJECT_NAME}.step",
                            "erc.json",
                            "drc.json",
                        )
                    },
                },
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )

        inventory = _inventory()

        def validator(project, runner=None):
            return ValidationResult(PASS, ("ok",), {}, inventory)

        with mock.patch.object(handoff_module, "ELECTRONICS_DIR", self.project), mock.patch.object(
            handoff_module, "HANDOFF_BUILD_DIR", self.stage_root
        ), mock.patch.object(handoff_module, "validate_project", side_effect=validator):
            archive = export_handoff(
                self.project,
                output_dir=output,
                export_dir=exports,
                validator=validator,
                current_exports_checker=lambda project, export_dir: None,
                git_metadata_provider=lambda repo_root: ("a" * 40, 1785888000),
                source_date_epoch=1785888000,
            )
            result = check_returned_zip(archive, self.repo, runner=FakeKiCadRunner())

        with zipfile.ZipFile(archive) as package:
            metadata = json.loads(package.read("pocket-card-controller/handoff.json"))
        self.assertEqual(metadata["baseProjectDigest"], digest)
        self.assertEqual(result.status, "PASS")
        self.assertEqual(result.base_digest, digest)
        self.assertEqual(result.returned_digest, digest)
        self.assertEqual(result.semantic_diff["components"]["added"], [])
        self.assertEqual(result.semantic_diff["components"]["removed"], [])
        self.assertEqual(result.semantic_diff["components"]["changed"], {})
        self.assertTrue((result.stage_dir / "project").is_dir())


if __name__ == "__main__":
    unittest.main()
