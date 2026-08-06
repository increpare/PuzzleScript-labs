import unittest

from hardware.pocket_card.electronics_pipeline.paths import ELECTRONICS_DIR, POCKET_CARD_DIR


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


if __name__ == "__main__":
    unittest.main()
