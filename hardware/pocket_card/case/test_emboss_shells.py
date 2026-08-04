"""Integration tests for the headless Blender finishing pipeline."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]
CASE = ROOT / "hardware/pocket_card/case"
TEMPLATE = ROOT / "hardware/card/case/case_updated.blend"
DISPLAY = ROOT / "hardware/card/case/es3c28p_3d.blend"
SCRIPT = CASE / "emboss_shells.py"

EXPECTED_COLLECTIONS = {"Case", "Buttons", "Electronics", "Display"}
EXPECTED_BUTTONS = {
    "cap_up", "cap_down", "cap_left", "cap_right",
    "cap_undo", "cap_action", "cap_reset", "cap_menu",
    "tip_power", "tip_mute",
}
EXPECTED_OBJECTS = EXPECTED_BUTTONS | {
    "shell_front_embossed", "shell_back_embossed", "pcb", "es3c28p_3d",
}


def blender_bin():
    override = os.environ.get("BLENDER")
    candidates = [
        override,
        shutil.which("blender"),
        "/Applications/Blender.app/Contents/MacOS/Blender",
    ]
    for value in candidates:
        if value and Path(value).is_file():
            return str(Path(value))
    raise unittest.SkipTest("Blender not installed; set BLENDER=/path/to/blender")


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def run_pipeline(output_dir, *extra_args):
    command = [
        blender_bin(),
        "--background",
        str(TEMPLATE),
        "--python-exit-code",
        "1",
        "--python",
        str(SCRIPT),
        "--",
        "--output-dir",
        str(output_dir),
        *map(str, extra_args),
    ]
    return subprocess.run(
        command,
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )


def inspect_blend(path):
    expression = r'''
import bpy, json

def transform(obj):
    if obj is None:
        return None
    return {
        "location": list(obj.location),
        "rotation": list(obj.rotation_euler),
        "scale": list(obj.scale),
    }

display = bpy.data.objects.get("es3c28p_3d")
inventory = {
    "collections": sorted(c.name for c in bpy.data.collections),
    "objects": sorted(o.name for o in bpy.data.objects if o.type == "MESH"),
    "materials": {
        o.name: [slot.material.name if slot.material else None
                 for slot in o.material_slots]
        for o in bpy.data.objects if o.type == "MESH"
    },
    "display_transform": transform(display),
    "display_material_count": len(display.material_slots) if display else 0,
}
print("ASSEMBLY_INVENTORY=" + json.dumps(inventory, sort_keys=True))
'''
    result = subprocess.run(
        [blender_bin(), "--background", str(path), "--python-expr", expression],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )
    if result.returncode:
        raise AssertionError(result.stdout)
    marker = "ASSEMBLY_INVENTORY="
    lines = [line for line in result.stdout.splitlines() if line.startswith(marker)]
    if len(lines) != 1:
        raise AssertionError(f"missing inventory marker in:\n{result.stdout}")
    return json.loads(lines[0][len(marker):])


class BlenderFinishIntegrationTest(unittest.TestCase):
    maxDiff = None

    def test_real_pipeline_builds_closed_shells_and_complete_assembly(self):
        before = (sha256(TEMPLATE), TEMPLATE.stat().st_mtime_ns)
        source_display = inspect_blend(DISPLAY)

        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp)
            result = run_pipeline(output)
            self.assertEqual(result.returncode, 0, result.stdout)

            for name in (
                "shell_front_embossed.stl",
                "shell_back_embossed.stl",
                "pocket_card_complete.blend",
            ):
                self.assertGreater((output / name).stat().st_size, 0)

            inventory = inspect_blend(output / "pocket_card_complete.blend")
            self.assertEqual(set(inventory["objects"]), EXPECTED_OBJECTS)
            self.assertEqual(set(inventory["collections"]), EXPECTED_COLLECTIONS)
            self.assertEqual(
                inventory["materials"]["shell_front_embossed"],
                ["Case Purple"],
            )
            self.assertEqual(
                inventory["materials"]["shell_back_embossed"],
                ["Case White"],
            )
            for name in EXPECTED_BUTTONS:
                self.assertEqual(inventory["materials"][name], ["Button Yellow"])
            self.assertEqual(inventory["materials"]["pcb"], ["PCB Green"])
            self.assertEqual(inventory["display_material_count"], 4)
            self.assertEqual(
                inventory["display_transform"],
                source_display["display_transform"],
            )

        self.assertEqual((sha256(TEMPLATE), TEMPLATE.stat().st_mtime_ns), before)

    def test_missing_input_preserves_previous_outputs(self):
        sentinels = {
            "shell_front_embossed.stl": b"old-front",
            "shell_back_embossed.stl": b"old-back",
            "pocket_card_complete.blend": b"old-blend",
        }
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp)
            for name, contents in sentinels.items():
                (output / name).write_bytes(contents)

            result = run_pipeline(output, "--front", output / "missing-front.stl")
            self.assertNotEqual(result.returncode, 0, result.stdout)
            for name, contents in sentinels.items():
                self.assertEqual((output / name).read_bytes(), contents)


class MakeIntegrationTest(unittest.TestCase):
    def test_case_targets_schedule_blender_after_shell_generation(self):
        for target in ("pocket_card_case_shells", "pocket_card_case"):
            with self.subTest(target=target):
                result = subprocess.run(
                    ["make", "-n", target],
                    cwd=ROOT,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    check=False,
                )
                self.assertEqual(result.returncode, 0, result.stdout)
                self.assertIn("emboss_shells.py", result.stdout)
                shell_index = result.stdout.index("build_variants.py")
                blender_index = result.stdout.index("emboss_shells.py")
                self.assertLess(shell_index, blender_index)


if __name__ == "__main__":
    unittest.main()
