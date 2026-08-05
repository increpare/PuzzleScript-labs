import json
import unittest

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
            if path.is_file() and path.suffix in {
                ".kicad_pro",
                ".kicad_sch",
                ".kicad_pcb",
            }:
                text = path.read_text(encoding="utf-8")
                self.assertFalse(any(token in text for token in forbidden), str(path))


if __name__ == "__main__":
    unittest.main()
