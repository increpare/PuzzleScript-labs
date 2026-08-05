import json
import subprocess
import unittest

from hardware.pocket_card.electronics_pipeline import paths as pipeline_paths
from hardware.pocket_card.electronics_pipeline.paths import (
    BOARD,
    EDITABLE_PROJECT_DIRS,
    ELECTRONICS_DIR,
    PROJECT,
    PROJECT_NAME,
    REPO_ROOT,
    SCHEMATIC,
    TOOLCHAIN,
)

CUSTOM_LIBRARY_TEXT_SUFFIXES = {".dcm", ".kicad_mod", ".kicad_sym", ".lib", ".mod"}


def canonical_text_project_files():
    paths = {
        PROJECT,
        SCHEMATIC,
        BOARD,
        ELECTRONICS_DIR / "fp-lib-table",
    }
    optional_symbol_table = ELECTRONICS_DIR / "sym-lib-table"
    if optional_symbol_table.is_file():
        paths.add(optional_symbol_table)
    for directory_name in EDITABLE_PROJECT_DIRS:
        directory = ELECTRONICS_DIR / directory_name
        if directory.is_dir():
            paths.update(
                path
                for path in directory.rglob("*")
                if path.is_file() and path.suffix.lower() in CUSTOM_LIBRARY_TEXT_SUFFIXES
            )
    return sorted(paths)


class SourceLayoutTest(unittest.TestCase):
    def test_kicad_local_state_is_ignored_repo_wide(self):
        local_state_paths = (
            ELECTRONICS_DIR / "pocket_card_controller.kicad_prl",
            ELECTRONICS_DIR / "~pocket_card_controller.lck",
            ELECTRONICS_DIR / "pocket_card_controller-backups" / "backup.kicad_sch",
            ELECTRONICS_DIR / "fp-info-cache",
        )
        for path in local_state_paths:
            result = subprocess.run(
                ["git", "check-ignore", "-q", str(path)],
                cwd=REPO_ROOT,
                check=False,
            )
            self.assertEqual(result.returncode, 0, str(path))

    def test_unrelated_lock_files_are_not_ignored(self):
        path = ELECTRONICS_DIR / "review-notes.lck"
        result = subprocess.run(
            ["git", "check-ignore", "-q", str(path)],
            cwd=REPO_ROOT,
            check=False,
        )
        self.assertEqual(result.returncode, 1, str(path))

    def test_native_project_is_complete_and_pinned_to_kicad_10(self):
        for path in (PROJECT, SCHEMATIC, BOARD, ELECTRONICS_DIR / "fp-lib-table"):
            self.assertTrue(path.is_file(), str(path))
            self.assertGreater(path.stat().st_size, 0)
        policy = json.loads(TOOLCHAIN.read_text(encoding="utf-8"))
        self.assertEqual(policy["schemaVersion"], 1)
        self.assertEqual(policy["project"], "pocket_card_controller")
        self.assertEqual(policy["kicad"]["major"], 10)
        self.assertEqual(policy["kicad"]["minimum"], "10.0.4")

    def test_native_project_formats_and_basenames_are_consistent(self):
        self.assertEqual(PROJECT.stem, PROJECT_NAME)
        self.assertEqual(SCHEMATIC.stem, PROJECT_NAME)
        self.assertEqual(BOARD.stem, PROJECT_NAME)

        project = json.loads(PROJECT.read_text(encoding="utf-8"))
        self.assertIsInstance(project["board"], dict)
        self.assertIsInstance(project["schematic"], dict)
        self.assertEqual(project["meta"]["filename"], PROJECT.name)
        top_level_sheets = project["schematic"]["top_level_sheets"]
        self.assertEqual(len(top_level_sheets), 1)
        self.assertEqual(top_level_sheets[0]["filename"], SCHEMATIC.name)
        self.assertEqual(top_level_sheets[0]["name"], PROJECT_NAME)
        self.assertTrue(
            SCHEMATIC.read_text(encoding="utf-8").lstrip().startswith("(kicad_sch")
        )
        self.assertTrue(
            BOARD.read_text(encoding="utf-8").lstrip().startswith("(kicad_pcb")
        )
        self.assertTrue(
            (ELECTRONICS_DIR / "fp-lib-table")
            .read_text(encoding="utf-8")
            .lstrip()
            .startswith("(fp_lib_table")
        )

    def test_machine_local_path_detector_rejects_absolute_workstation_paths(self):
        detector = getattr(pipeline_paths, "find_forbidden_machine_paths", None)
        self.assertIsNotNone(detector)
        forbidden_examples = (
            '(uri "/Users/alice/KiCad/custom.pretty")',
            '(uri "/home/alice/kicad/custom.pretty")',
            '(uri "/opt/local/share/kicad/custom.pretty")',
            '(uri "D:/KiCad/custom.pretty")',
            r'(uri "\\server\engineering\custom.pretty")',
            '(uri "file:///Users/alice/KiCad/custom.pretty")',
        )
        for text in forbidden_examples:
            self.assertTrue(detector(text), text)

    def test_machine_local_path_detector_allows_kicad_variables(self):
        detector = getattr(pipeline_paths, "find_forbidden_machine_paths", None)
        self.assertIsNotNone(detector)
        allowed_examples = (
            '${KIPRJMOD}/footprints.pretty/Custom.kicad_mod',
            '${KICAD10_FOOTPRINT_DIR}/Button_Switch_SMD.pretty',
            '${KICAD10_3DMODEL_DIR}/Package_SO.3dshapes/SOIC.step',
        )
        for text in allowed_examples:
            self.assertEqual(detector(text), (), text)

    def test_machine_local_path_detector_allows_reference_field_interpolation(self):
        detector = getattr(pipeline_paths, "find_forbidden_machine_paths", None)
        self.assertIsNotNone(detector)
        text = '(fp_text user "${REFERENCE}" (at 0 0) (layer "F.Fab"))'
        self.assertEqual(detector(text), ())

    def test_machine_local_path_detector_rejects_unapproved_variables(self):
        detector = getattr(pipeline_paths, "find_forbidden_machine_paths", None)
        self.assertIsNotNone(detector)
        forbidden_references = (
            "${HOME}",
            "${USERPROFILE}",
            "${KICAD9_FOOTPRINT_DIR}",
            "${ARBITRARY_NETWORK_SHARE}",
            "${REFERENCE}",
            "${kiprjmod}",
            "$HOME",
            "$USERPROFILE",
            "$KIPRJMOD",
            "%HOME%",
            "%USERPROFILE%",
            "%KIPRJMOD%",
        )
        for reference in forbidden_references:
            text = f'(uri "{reference}")'
            self.assertEqual(detector(text), (reference,), text)

        self.assertEqual(detector("${REFERENCE}"), ("${REFERENCE}",))
        text = '(uri "${REFERENCE}/private.pretty")'
        self.assertEqual(detector(text), ("${REFERENCE}",), text)
        text = '(uri "%USERPROFILE%/KiCad/private.pretty")'
        self.assertEqual(detector(text), ("%USERPROFILE%",), text)

    def test_project_has_no_machine_local_library_paths(self):
        detector = getattr(pipeline_paths, "find_forbidden_machine_paths", None)
        self.assertIsNotNone(detector)
        for path in canonical_text_project_files():
            text = path.read_text(encoding="utf-8")
            self.assertEqual(detector(text), (), str(path))


if __name__ == "__main__":
    unittest.main()
