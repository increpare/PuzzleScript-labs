import hashlib
import importlib.util
import math
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageChops, ImageStat


HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
SCRIPT = HERE / "tools" / "render_captive_nut_review.py"
BLEND = HERE / "out" / "order" / "pocket_card_complete.blend"
BLENDER = Path("/Applications/Blender.app/Contents/MacOS/Blender")


def load_render_module():
    spec = importlib.util.spec_from_file_location("render_captive_nut_review", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


@unittest.skipUnless(BLENDER.is_file(), "Blender is required for review-render tests")
class CaptiveNutReviewContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.review = load_render_module()

    def blender(self, *args, check=True):
        command = [
            str(BLENDER),
            "--background",
            str(BLEND),
            "--python-exit-code",
            "1",
            *map(str, args),
        ]
        environment = dict(os.environ)
        environment["TMPDIR"] = "/tmp/pocket-card-captive-nut-review"
        Path(environment["TMPDIR"]).mkdir(parents=True, exist_ok=True)
        return subprocess.run(
            command,
            cwd=REPO_ROOT,
            env=environment,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=check,
        )

    def test_exact_output_contract_and_dimensions(self):
        self.assertEqual(
            self.review.OUTPUTS,
            {
                "assembled": "captive_nuts_assembled.png",
                "exploded": "captive_nuts_exploded.png",
                "h2_cutaway": "captive_nuts_h2_cutaway.png",
                "trap_closeups": "captive_nuts_trap_closeups.png",
            },
        )
        self.assertEqual(self.review.RENDER_SIZE, (1200, 900))

    def test_exploded_motion_is_exactly_back_and_screws_eighteen_mm_rearward(self):
        offsets = self.review.exploded_model_offsets()
        expected_names = {"shell_back_embossed"} | {
            f"screw_{index}" for index in range(1, 7)
        }
        self.assertEqual(set(offsets), expected_names)
        self.assertTrue(all(offset == (0.0, 0.0, -18.0) for offset in offsets.values()))
        self.assertFalse(any(name.startswith("nut_") for name in offsets))
        self.assertFalse(
            {"pcb", "Battery", "speaker", "cap_reset"}.intersection(offsets)
        )

    def test_h2_contract_uses_real_assembly_objects_and_positive_speaker_clearance(self):
        self.assertEqual(self.review.H2_LAYOUT_XY, (64.5, 84.0))
        self.assertEqual(self.review.RESET_LAYOUT_XY, (54.5, 80.0))
        self.assertEqual(
            self.review.H2_LAYOUT_CONTRACT,
            {"H2": (64.5, 84.0), "Reset": (54.5, 80.0), "speaker": (76.0, 80.0)},
        )
        self.assertEqual(
            self.review.H2_REQUIRED_OBJECTS,
            {"shell_front_embossed", "pcb", "Battery", "speaker", "cap_reset", "nut_6", "screw_6"},
        )
        self.assertTrue(
            self.review.is_stadium_speaker(vertex_count=68, dimensions_mm=(20.0, 14.0, 3.5))
        )
        self.assertFalse(
            self.review.is_stadium_speaker(vertex_count=8, dimensions_mm=(20.0, 14.0, 3.5))
        )
        clearance = self.review.axis_to_bounds_clearance_xy(
            (-0.459646, -1.813941),
            (-0.236179, 0.481167, -2.130414, -1.113544),
        )
        self.assertGreater(clearance, 0.09)

    def test_closeup_nut_offsets_follow_mirrored_authoritative_mouth_vectors(self):
        offsets = self.review.closeup_nut_model_offsets(6.0)
        self.assertEqual(set(offsets), {"nut_1", "nut_6"})
        diagonal = 6.0 / math.sqrt(2.0)
        self.assertAlmostEqual(offsets["nut_1"][0], diagonal)
        self.assertAlmostEqual(offsets["nut_1"][1], -diagonal)
        self.assertEqual(offsets["nut_1"][2], 0.0)
        self.assertEqual(offsets["nut_6"], (0.0, 6.0, 0.0))

    def test_preflight_fails_clearly_when_hardware_is_missing(self):
        result = self.blender(
            "--python-expr",
            "import bpy; bpy.data.objects.remove(bpy.data.objects['nut_4'], do_unlink=True)",
            "--python",
            SCRIPT,
            "--",
            "--preflight-only",
            check=False,
        )
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("missing required assembly objects", result.stdout)
        self.assertIn("nut_4", result.stdout)

    def test_snapshot_restores_matrices_visibility_materials_and_scene_after_failure(self):
        result = self.blender(
            "--python",
            SCRIPT,
            "--",
            "--self-test-state-restore",
        )
        self.assertIn("PASS injected render failure restored canonical state", result.stdout)

    def test_headless_render_writes_distinct_nonblank_images_without_touching_blend(self):
        before_hash = digest(BLEND)
        before_mtime = BLEND.stat().st_mtime_ns
        with tempfile.TemporaryDirectory(dir="/tmp") as temporary:
            result = self.blender(
                "--python",
                SCRIPT,
                "--",
                "--output-dir",
                temporary,
            )
            self.assertIn("PASS rendered 4 captive-nut review views", result.stdout)
            images = []
            for filename in self.review.OUTPUTS.values():
                path = Path(temporary, filename)
                self.assertTrue(path.is_file(), filename)
                image = Image.open(path).convert("RGB")
                self.assertEqual(image.size, self.review.RENDER_SIZE)
                extrema = image.getextrema()
                self.assertTrue(all(low < high for low, high in extrema), filename)
                self.assertGreater(sum(ImageStat.Stat(image).var), 100.0, filename)
                images.append(image)
            for first_index, first in enumerate(images):
                for second in images[first_index + 1 :]:
                    difference = ImageStat.Stat(ImageChops.difference(first, second))
                    self.assertGreater(sum(difference.mean), 3.0)
        self.assertEqual(digest(BLEND), before_hash)
        self.assertEqual(BLEND.stat().st_mtime_ns, before_mtime)


if __name__ == "__main__":
    unittest.main(verbosity=2)
