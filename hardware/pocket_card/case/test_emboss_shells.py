"""Integration tests for the headless Blender finishing pipeline."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]
CASE = ROOT / "hardware/pocket_card/case"
TEMPLATE = ROOT / "hardware/card/case/case_updated.blend"
DISPLAY = ROOT / "hardware/card/case/es3c28p_3d.blend"
SCRIPT = CASE / "emboss_shells.py"
BLENDER_TIMEOUT = 180
SHELL_OBJECTS = {"shell_front_embossed", "shell_back_embossed"}

EXPECTED_COLLECTIONS = {"Case", "Buttons", "Electronics", "Display"}
EXPECTED_TEMPLATE_COMPONENTS = {"Battery", "speaker"}
EXPECTED_BUTTONS = {
    "cap_up", "cap_down", "cap_left", "cap_right",
    "cap_undo", "cap_action", "cap_reset", "cap_menu",
    "tip_power", "tip_mute",
}
EXPECTED_OBJECTS = EXPECTED_BUTTONS | {
    "shell_front_embossed", "shell_back_embossed", "pcb", "es3c28p_3d",
} | EXPECTED_TEMPLATE_COMPONENTS


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


def run_bounded(command, label):
    def captured_text(value):
        if value is None:
            return ""
        if isinstance(value, bytes):
            return value.decode(errors="replace")
        return value

    process = subprocess.Popen(
        command,
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        start_new_session=True,
    )
    try:
        output, _ = process.communicate(timeout=BLENDER_TIMEOUT)
    except subprocess.TimeoutExpired as exc:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            output, _ = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            output = ""
            if process.stdout is not None:
                process.stdout.close()
        captured = captured_text(exc.stdout) + captured_text(output)
        raise AssertionError(
            f"{label} exceeded {BLENDER_TIMEOUT}s; killed process group "
            f"{process.pid}:\n{captured}"
        ) from exc
    return subprocess.CompletedProcess(
        command, process.returncode, stdout=output, stderr=None
    )


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
    return run_bounded(command, "Blender finishing pipeline")


def run_blender_expression(path, expression):
    command = [
        blender_bin(), "--background", str(path),
        "--python-exit-code", "1", "--python-expr", expression,
    ]
    result = run_bounded(command, "Blender inspection")
    if result.returncode:
        raise AssertionError(result.stdout)
    return result.stdout


def inspect_blend(path):
    expression = r'''
import bpy, hashlib, json, struct

def custom_properties(item):
    result = {}
    for key in item.keys():
        if key == "_RNA_UI":
            continue
        value = item[key]
        if isinstance(value, (str, int, float, bool)) or value is None:
            result[key] = value
        else:
            try:
                result[key] = list(value)
            except TypeError:
                result[key] = repr(value)
    return result

def matrix(matrix_value):
    return [[value for value in row] for row in matrix_value]

def mesh_hash(obj):
    digest = hashlib.sha256()
    mesh = obj.data
    for vertex in mesh.vertices:
        digest.update(struct.pack("<3d", *vertex.co))
    for edge in mesh.edges:
        digest.update(struct.pack("<2I", *edge.vertices))
    for polygon in mesh.polygons:
        digest.update(struct.pack(
            "<4I", polygon.loop_start, polygon.loop_total,
            polygon.material_index, int(polygon.use_smooth),
        ))
    for loop in mesh.loops:
        digest.update(struct.pack("<2I", loop.vertex_index, loop.edge_index))
    return digest.hexdigest()

def transform(obj):
    if obj is None:
        return None
    return {
        "location": list(obj.location),
        "rotation": list(obj.rotation_euler),
        "scale": list(obj.scale),
    }

display = bpy.data.objects.get("es3c28p_3d")
display_images = {}
if display:
    for slot in display.material_slots:
        material = slot.material
        if not material or not material.node_tree:
            continue
        for node in material.node_tree.nodes:
            image = getattr(node, "image", None)
            if image:
                display_images[image.name] = {
                    "packed": image.packed_file is not None,
                    "size": list(image.size),
                }
inventory = {
    "collections": sorted(c.name for c in bpy.data.collections),
    "collection_children": {
        c.name: sorted(child.name for child in c.children)
        for c in bpy.data.collections
    },
    "objects": sorted((o.name, o.type) for o in bpy.data.objects),
    "materials": {
        o.name: [slot.material.name if slot.material else None
                 for slot in o.material_slots]
        for o in bpy.data.objects if o.type == "MESH"
    },
    "transforms": {
        o.name: transform(o)
        for o in bpy.data.objects if o.type == "MESH"
    },
    "modifiers": {
        o.name: [modifier.name for modifier in o.modifiers]
        for o in bpy.data.objects if o.type == "MESH"
    },
    "memberships": {
        o.name: sorted(collection.name for collection in o.users_collection)
        for o in bpy.data.objects
    },
    "world_matrices": {
        o.name: matrix(o.matrix_world)
        for o in bpy.data.objects
    },
    "parents": {
        o.name: o.parent.name if o.parent else None
        for o in bpy.data.objects
    },
    "custom_properties": {
        o.name: custom_properties(o)
        for o in bpy.data.objects
    },
    "mesh_hashes": {
        o.name: mesh_hash(o)
        for o in bpy.data.objects if o.type == "MESH"
    },
    "mesh_data_names": {
        o.name: o.data.name
        for o in bpy.data.objects if o.type == "MESH"
    },
    "display_transform": transform(display),
    "display_material_count": len(display.material_slots) if display else 0,
    "display_images": display_images,
    "scene": {
        "camera": bpy.context.scene.camera.name
                  if bpy.context.scene.camera else None,
        "custom_properties": custom_properties(bpy.context.scene),
        "render": {
            "engine": bpy.context.scene.render.engine,
            "film_transparent": bpy.context.scene.render.film_transparent,
            "resolution_x": bpy.context.scene.render.resolution_x,
            "resolution_y": bpy.context.scene.render.resolution_y,
            "resolution_percentage": bpy.context.scene.render.resolution_percentage,
        },
    },
    "world": None if bpy.context.scene.world is None else {
        "name": bpy.context.scene.world.name,
        "color": list(bpy.context.scene.world.color),
        "custom_properties": custom_properties(bpy.context.scene.world),
    },
    "cameras": {
        o.name: {
            "type": o.data.type,
            "lens": o.data.lens,
            "ortho_scale": o.data.ortho_scale,
            "custom_properties": custom_properties(o.data),
        }
        for o in bpy.data.objects if o.type == "CAMERA"
    },
    "lights": {
        o.name: {
            "type": o.data.type,
            "energy": o.data.energy,
            "color": list(o.data.color),
            "custom_properties": custom_properties(o.data),
        }
        for o in bpy.data.objects if o.type == "LIGHT"
    },
}
print("ASSEMBLY_INVENTORY=" + json.dumps(inventory, sort_keys=True))
'''
    output = run_blender_expression(path, expression)
    marker = "ASSEMBLY_INVENTORY="
    lines = [line for line in output.splitlines() if line.startswith(marker)]
    if len(lines) != 1:
        raise AssertionError(f"missing inventory marker in:\n{output}")
    return json.loads(lines[0][len(marker):])


def author_preservation_sentinels(path, mutate_buttons=True):
    button_names = sorted(EXPECTED_BUTTONS - {"tip_power", "tip_mute"})
    expression = f'''
import bpy

sentinels = bpy.data.collections.new("Lookdev Sentinels")
bpy.context.scene.collection.children.link(sentinels)

camera_data = bpy.data.cameras.new("Sentinel Camera Data")
camera_data.lens = 71.0
camera_data["lens_note"] = "preserve-camera-data"
camera = bpy.data.objects.new("Sentinel Camera", camera_data)
sentinels.objects.link(camera)
camera.location = (12.5, -44.0, 37.25)
camera.rotation_euler = (0.4, 0.1, -0.2)
bpy.context.scene.camera = camera

light_data = bpy.data.lights.new("Sentinel Area Data", type="AREA")
light_data.energy = 432.1
light_data.color = (0.17, 0.41, 0.89)
light_data["light_note"] = "preserve-light-data"
light = bpy.data.objects.new("Sentinel Area", light_data)
sentinels.objects.link(light)
light.location = (-31.0, 22.0, 48.0)
light.rotation_euler = (0.3, -0.6, 0.15)

shell = bpy.data.objects["shell_front_embossed"]
shell.location = (1.25, -2.5, 3.75)
shell.rotation_euler = (0.08, -0.12, 0.21)
shell.scale = (0.82, 1.07, 1.14)
shell["lookdev_note"] = "preserve-shell-object"
sentinels.objects.link(shell)

button = bpy.data.objects["cap_up"]
button.location = (-4.5, 6.25, 1.75)
button.rotation_euler = (-0.15, 0.22, 0.31)
button.scale = (1.13, 0.91, 1.04)
button["lookdev_note"] = "preserve-button-object"
sentinels.objects.link(button)

material = bpy.data.materials.new("Sentinel Accent")
material.diffuse_color = (0.07, 0.77, 0.42, 1.0)
material["material_note"] = "preserve-material"
shell.data.materials.append(material)
button.data.materials.append(material)

for name in {sorted(SHELL_OBJECTS)!r}:
    obj = bpy.data.objects[name]
    obj.data.vertices[0].co.z += 0.013

if {mutate_buttons!r}:
    for name in {button_names!r}:
        obj = bpy.data.objects[name]
        obj.data.vertices[0].co.z += 0.017

world = bpy.data.worlds.new("Sentinel World")
world.color = (0.13, 0.21, 0.34)
world["world_note"] = "preserve-world"
bpy.context.scene.world = world
bpy.context.scene["scene_note"] = "preserve-scene"
bpy.context.scene.render.resolution_x = 713
bpy.context.scene.render.resolution_y = 419
bpy.context.scene.render.resolution_percentage = 83
bpy.context.scene.render.film_transparent = True
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath={str(path.resolve())!r}, check_existing=False)
'''
    run_blender_expression(path, expression)


class BlenderFinishIntegrationTest(unittest.TestCase):
    maxDiff = None

    def test_real_pipeline_builds_closed_shells_and_complete_assembly(self):
        before = (sha256(TEMPLATE), TEMPLATE.stat().st_mtime_ns)
        source_display = inspect_blend(DISPLAY)
        source_template = inspect_blend(TEMPLATE)

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
            self.assertEqual(
                {name for name, object_type in inventory["objects"]
                 if object_type == "MESH"},
                EXPECTED_OBJECTS,
            )
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
            for name in EXPECTED_TEMPLATE_COMPONENTS:
                self.assertEqual(
                    inventory["transforms"][name],
                    source_template["transforms"][name],
                )
                self.assertEqual(
                    inventory["materials"][name],
                    source_template["materials"][name],
                )
                self.assertEqual(
                    inventory["modifiers"][name],
                    source_template["modifiers"][name],
                )
                self.assertEqual(inventory["memberships"][name], ["Electronics"])
            self.assertEqual(inventory["display_material_count"], 4)
            self.assertEqual(
                inventory["display_transform"],
                source_display["display_transform"],
            )
            self.assertTrue(source_display["display_images"])
            self.assertEqual(
                set(inventory["display_images"]),
                set(source_display["display_images"]),
            )
            for name, source_image in source_display["display_images"].items():
                self.assertGreater(source_image["size"][0], 0)
                self.assertGreater(source_image["size"][1], 0)
                self.assertEqual(
                    inventory["display_images"][name]["size"],
                    source_image["size"],
                )
                self.assertTrue(inventory["display_images"][name]["packed"])

        self.assertEqual((sha256(TEMPLATE), TEMPLATE.stat().st_mtime_ns), before)

    def test_second_run_replaces_only_shell_mesh_data_in_existing_assembly(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp)
            first = run_pipeline(output)
            self.assertEqual(first.returncode, 0, first.stdout)

            assembly = output / "pocket_card_complete.blend"
            author_preservation_sentinels(assembly)
            before = inspect_blend(assembly)

            second = run_pipeline(output)
            self.assertEqual(second.returncode, 0, second.stdout)
            after = inspect_blend(assembly)

            for key in (
                "collections", "collection_children", "objects", "materials",
                "transforms", "modifiers", "memberships", "world_matrices",
                "parents", "custom_properties", "display_transform",
                "display_material_count", "display_images", "scene", "world",
                "cameras", "lights",
            ):
                self.assertEqual(after[key], before[key], key)

            for name, mesh_hash in before["mesh_hashes"].items():
                if name in SHELL_OBJECTS:
                    self.assertNotEqual(after["mesh_hashes"][name], mesh_hash, name)
                else:
                    self.assertEqual(after["mesh_hashes"][name], mesh_hash, name)

            for name, data_name in before["mesh_data_names"].items():
                if name not in SHELL_OBJECTS:
                    self.assertEqual(after["mesh_data_names"][name], data_name, name)

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
                output = result.stdout
                if target == "pocket_card_case":
                    self.assertIn("electronics_pipeline.validation", output)
                    self.assertIn("electronics_pipeline.exports", output)
                    self.assertNotIn("exports --check-current", output)
                else:
                    self.assertIn("exports --check-current", output)
                build_index = output.index("build_variants.py")
                finish_index = output.index("emboss_shells.py")
                export_index = output.index("sculpted_buttons.py")
                replace_index = output.index("sculpted_buttons_blender.py")
                self.assertLess(build_index, finish_index)
                self.assertLess(finish_index, export_index)
                self.assertLess(export_index, replace_index)
                self.assertIn("out/order/pocket_card_complete.blend", output)
                self.assertNotIn("dpad_petals", output)
                self.assertNotIn("build_pcb.sh", output)

    def test_sculpted_target_reuses_standard_complete_assembly(self):
        result = subprocess.run(
            ["make", "-n", "pocket_card_case_sculpted"],
            cwd=ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout)
        output = result.stdout
        self.assertIn("sculpted_buttons.py", output)
        self.assertIn("sculpted_buttons_blender.py", output)
        self.assertIn("out/sculpted_buttons/placed", output)
        complete_blend = (
            '"hardware/pocket_card/case/out/order/'
            'pocket_card_complete.blend"'
        )
        self.assertIn(f"--background {complete_blend}", output)
        self.assertIn(f"--input {complete_blend}", output)
        self.assertIn(f"--output {complete_blend}", output)
        self.assertNotIn("dpad_petals", output)


if __name__ == "__main__":
    unittest.main()
