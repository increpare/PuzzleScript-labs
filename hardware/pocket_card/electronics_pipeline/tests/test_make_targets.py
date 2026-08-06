"""Make target reachability tests for the Pocket Card build cutover."""

import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]


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
            with self.subTest(target=target):
                output = subprocess.check_output(
                    ["make", "-n", target],
                    cwd=ROOT,
                    text=True,
                )
                self.assertFalse(
                    any(name in output for name in forbidden),
                    (target, output),
                )

    def test_legacy_target_is_named_and_guarded(self):
        output = subprocess.run(
            ["make", "pocket_card_legacy_pcb_rebuild"],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )
        self.assertNotEqual(output.returncode, 0)
        self.assertIn("POCKET_CARD_ALLOW_LEGACY_REBUILD=1", output.stderr + output.stdout)

    def test_engineer_export_includes_blend_by_default(self):
        default = subprocess.check_output(
            ["make", "-n", "pocket_card_engineer_export"],
            cwd=ROOT,
            text=True,
        )
        self.assertIn("--include-blend", default)
        omitted = subprocess.check_output(
            ["make", "-n", "pocket_card_engineer_export", "INCLUDE_BLEND=0"],
            cwd=ROOT,
            text=True,
        )
        self.assertNotIn("--include-blend", omitted)


if __name__ == "__main__":
    unittest.main()
