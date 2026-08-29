import hashlib
import importlib.util
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
SCRIPT = HERE / "tools" / "render_captive_nut_review.py"
BLEND = HERE / "out" / "order" / "pocket_card_complete.blend"
sys.path.insert(0, str(SCRIPT.parent))

def discover_blender():
    requested = os.environ.get("BLENDER")
    if requested:
        resolved = shutil.which(requested) or requested
        if Path(resolved).is_file():
            return str(resolved)
    resolved = shutil.which("blender")
    if resolved:
        return resolved
    fallback = Path("/Applications/Blender.app/Contents/MacOS/Blender")
    return str(fallback) if fallback.is_file() else None

BLENDER = discover_blender()

def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

class CaptiveNutReviewPureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.review = load_module("render_captive_nut_review", SCRIPT)
        cls.png = load_module("review_png", SCRIPT.parent / "review_png.py")

    def test_exact_output_contract_and_dimensions(self):
        self.assertEqual(self.review.OUTPUTS, {"assembled": "captive_nuts_assembled.png", "exploded": "captive_nuts_exploded.png", "h2_cutaway": "captive_nuts_h2_cutaway.png", "trap_closeups": "captive_nuts_trap_closeups.png"})
        self.assertEqual(self.review.RENDER_SIZE, (1200, 900))

    def test_exploded_motion_is_exactly_back_and_screws_eighteen_mm_rearward(self):
        offsets = self.review.exploded_model_offsets()
        self.assertEqual(set(offsets), {"shell_back_embossed"} | {f"screw_{i}" for i in range(1, 7)})
        self.assertTrue(all(offset == (0.0, 0.0, -18.0) for offset in offsets.values()))
        self.assertFalse({"pcb", "Battery", "speaker", "cap_reset"}.intersection(offsets))

    def test_h2_contract_uses_real_assembly_objects(self):
        self.assertEqual(self.review.H2_LAYOUT_CONTRACT, {"H2": (64.5, 84.0), "Reset": (54.5, 80.0), "speaker": (76.0, 80.0)})
        self.assertEqual(self.review.H2_REQUIRED_OBJECTS, {"shell_front_embossed", "pcb", "Battery", "speaker", "cap_reset", "nut_6", "screw_6"})
        self.assertTrue(self.review.is_stadium_speaker(68, (20.0, 14.0, 3.5)))
        self.assertGreater(self.review.axis_to_bounds_clearance_xy((-0.459646, -1.813941), (-0.236179, 0.481167, -2.130414, -1.113544)), 0.09)

    def test_closeup_offsets_follow_authoritative_mouth_vectors_and_reject_drift(self):
        @dataclass(frozen=True)
        class Site:
            x: float
            y: float
            kind: str
            mouth: tuple
        sites = (Site(6, 6.5, "module", (1, 1)), Site(6, 48.5, "module", (1, -1)), Site(84, 6.5, "module", (-1, 1)), Site(84, 48.5, "module", (-1, -1)), Site(64.5, 56, "pcb", (0, 1)), Site(64.5, 84, "pcb", (0, -1)))
        offsets = self.review.closeup_nut_model_offsets(sites, 6.0)
        diagonal = 6 / math.sqrt(2)
        self.assertAlmostEqual(offsets["nut_1"][0], diagonal)
        self.assertAlmostEqual(offsets["nut_1"][1], -diagonal)
        self.assertEqual(offsets["nut_6"], (0.0, 6.0, 0.0))
        drifted = list(sites)
        drifted[0] = Site(7, 6.5, "module", (1, 1))
        with self.assertRaisesRegex(self.review.ReviewFailure, "authoritative trap site"):
            self.review.closeup_nut_model_offsets(tuple(drifted), 6.0)

    def test_png_metadata_is_removed_byte_deterministically_without_pillow(self):
        source = HERE / "out" / "order" / "review" / self.review.OUTPUTS["assembled"]
        raw = source.read_bytes()
        iend = raw.rfind(b"IEND") - 4
        def text_chunk(payload):
            kind = b"tEXt"
            return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xffffffff)
        with tempfile.TemporaryDirectory(dir="/tmp") as temporary:
            first, second = Path(temporary, "a.png"), Path(temporary, "b.png")
            first.write_bytes(raw[:iend] + text_chunk(b"File\x00/one/path.blend") + raw[iend:])
            second.write_bytes(raw[:iend] + text_chunk(b"Date\x002099-01-01") + raw[iend:])
            self.png.normalize_png(first)
            self.png.normalize_png(second)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            info = self.png.inspect_png(first)
            self.assertEqual((info.width, info.height), self.review.RENDER_SIZE)
            self.assertGreater(info.variance, 100.0)

    def test_spatially_uniform_solid_color_png_is_rejected_as_blank(self):
        width, height = self.review.RENDER_SIZE
        def chunk(kind, payload):
            return (struct.pack(">I", len(payload)) + kind + payload
                    + struct.pack(">I", zlib.crc32(kind + payload) & 0xffffffff))
        header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
        row = b"\x00" + bytes((220, 40, 90)) * width
        png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
               + chunk(b"IDAT", zlib.compress(row * height))
               + chunk(b"IEND", b""))
        with tempfile.TemporaryDirectory(dir="/tmp") as temporary:
            path = Path(temporary, "solid.png")
            path.write_bytes(png)
            with self.assertRaisesRegex(self.png.PngError, "blank"):
                self.png.validate_review_set(
                    Path(temporary), {path.name}, self.review.RENDER_SIZE)

    def test_make_and_readme_describe_existing_blend_and_transactional_output(self):
        makefile = (REPO_ROOT / "Makefile").read_text()
        self.assertIn("\npocket_card_captive_nut_review:\n", makefile)
        self.assertNotIn("pocket_card_captive_nut_review: pocket_card_case", makefile)
        readme = (HERE / "README.md").read_text()
        self.assertIn("renders the checked existing complete assembly", readme)
        self.assertIn("staging", readme.lower())

@unittest.skipUnless(BLENDER, "Blender is required for integration review-render tests")
class CaptiveNutReviewBlenderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.review = load_module("render_captive_nut_review_blender", SCRIPT)
        cls.png = load_module("review_png_blender", SCRIPT.parent / "review_png.py")

    def blender(self, *args, check=True):
        environment = dict(os.environ)
        environment["TMPDIR"] = "/tmp/pocket-card-captive-nut-review"
        Path(environment["TMPDIR"]).mkdir(parents=True, exist_ok=True)
        return subprocess.run([BLENDER, "--background", str(BLEND), "--python-exit-code", "1", *map(str, args)], cwd=REPO_ROOT, env=environment, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=check)

    def test_preflight_fails_for_missing_hardware_and_displaced_reset(self):
        missing = self.blender("--python-expr", "import bpy; bpy.data.objects.remove(bpy.data.objects['nut_4'], do_unlink=True)", "--python", SCRIPT, "--", "--preflight-only", check=False)
        self.assertNotEqual(missing.returncode, 0, missing.stdout)
        self.assertIn("missing required assembly objects", missing.stdout)
        displaced = self.blender("--python-expr", "import bpy; bpy.data.objects['cap_reset'].location.x += 100.0", "--python", SCRIPT, "--", "--preflight-only", check=False)
        self.assertNotEqual(displaced.returncode, 0, displaced.stdout)
        self.assertIn("cap_reset placement changed", displaced.stdout)

    def test_real_setup_failure_restores_objects_lights_collections_and_selection(self):
        result = self.blender("--python", SCRIPT, "--", "--self-test-state-restore")
        self.assertIn("PASS real H2 setup failure restored selection, active object, and canonical state", result.stdout)

    def test_authored_light_and_hidden_fasteners_do_not_change_output_or_state(self):
        with tempfile.TemporaryDirectory(dir="/tmp") as temporary:
            baseline, adversarial = Path(temporary, "baseline"), Path(temporary, "adversarial")
            self.blender("--python", SCRIPT, "--", "--view", "assembled", "--output-dir", baseline)
            mutate = "import bpy; l=bpy.data.objects['Area_Fill']; l.data.energy=12345; l.data.color=(1,0,0); c=bpy.data.collections['Fasteners']; c.hide_render=True; c.hide_viewport=True; lc=bpy.context.view_layer.layer_collection.children['Fasteners']; lc.exclude=True; lc.hide_viewport=True"
            result = self.blender("--python-expr", mutate, "--python", SCRIPT, "--", "--view", "assembled", "--output-dir", adversarial)
            name = self.review.OUTPUTS["assembled"]
            self.assertEqual(Path(baseline, name).read_bytes(), Path(adversarial, name).read_bytes())
            self.assertIn("PASS rendered 1 captive-nut review view", result.stdout)

    def test_late_failure_leaves_previously_published_four_view_set_unchanged(self):
        published = HERE / "out" / "order" / "review"
        with tempfile.TemporaryDirectory(dir="/tmp") as temporary:
            output = Path(temporary, "review")
            output.mkdir()
            for name in self.review.OUTPUTS.values():
                shutil.copyfile(published / name, output / name)
            before = {name: digest(output / name) for name in self.review.OUTPUTS.values()}
            result = self.blender("--python", SCRIPT, "--", "--output-dir", output, "--inject-failure-view", "h2_cutaway", check=False)
            self.assertNotEqual(result.returncode, 0, result.stdout)
            self.assertEqual(before, {name: digest(output / name) for name in self.review.OUTPUTS.values()})
            self.assertEqual(set(before), {path.name for path in output.iterdir()})

    def test_full_render_is_valid_distinct_and_preserves_blend(self):
        before = (digest(BLEND), BLEND.stat().st_mtime_ns)
        with tempfile.TemporaryDirectory(dir="/tmp") as temporary:
            result = self.blender("--python", SCRIPT, "--", "--output-dir", temporary)
            self.assertIn("PASS rendered 4 captive-nut review views", result.stdout)
            infos = self.png.validate_review_set(Path(temporary), set(self.review.OUTPUTS.values()), self.review.RENDER_SIZE)
            self.assertEqual(set(infos), set(self.review.OUTPUTS.values()))
        self.assertEqual(before, (digest(BLEND), BLEND.stat().st_mtime_ns))

if __name__ == "__main__":
    unittest.main(verbosity=2)
