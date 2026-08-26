"""Apply Blender-authored finishing modifiers and build a coloured assembly.

Blender entry point; run via the repository Make target, not regular Python:

    blender --background hardware/card/case/case_updated.blend \
      --python-exit-code 1 --python hardware/pocket_card/case/emboss_shells.py
"""

import argparse
import bmesh
import bpy
from dataclasses import dataclass
import math
import os
from pathlib import Path
import shutil
import sys
import tempfile
import uuid

from mathutils import Vector


ROOT = Path(__file__).resolve().parents[3]
ORDER = ROOT / "hardware/pocket_card/case/out/order"
TEMPLATE = ROOT / "hardware/card/case/case_updated.blend"
DISPLAY = ROOT / "hardware/card/case/es3c28p_3d.blend"
BOUND_TOL = 0.05

SHELL_INPUTS = (
    ("shell_front", "front_input", "shell_front_embossed.stl"),
    ("shell_back", "back_input", "shell_back_embossed.stl"),
)
BUTTON_STEMS = (
    "cap_up", "cap_down", "cap_left", "cap_right",
    "cap_undo", "cap_action", "cap_reset", "cap_menu",
    "tip_power", "tip_mute",
)
TEMPLATE_COMPONENTS = ("Battery", "speaker")
MATERIAL_SPECS = {
    "Case Purple": (0.435, 0.235, 0.765, 1.0),
    "Case White": (0.90, 0.90, 0.87, 1.0),
    "Button Yellow": (0.96, 0.67, 0.12, 1.0),
    "PCB Green": (0.12, 0.48, 0.20, 1.0),
}


class FinishError(RuntimeError):
    """A deterministic finishing-contract failure."""


@dataclass(frozen=True)
class Paths:
    repo: Path
    template: Path
    display: Path
    front_input: Path
    back_input: Path
    preview: Path
    output: Path


def script_args():
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1:]


def parse_args(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ORDER)
    parser.add_argument("--front", type=Path, default=ORDER / "shell_front.stl")
    parser.add_argument("--back", type=Path, default=ORDER / "shell_back.stl")
    parser.add_argument("--preview-dir", type=Path, default=ORDER / "preview")
    parser.add_argument("--display", type=Path, default=DISPLAY)
    args = parser.parse_args(argv)
    return Paths(
        ROOT,
        TEMPLATE.resolve(),
        args.display.resolve(),
        args.front.resolve(),
        args.back.resolve(),
        args.preview_dir.resolve(),
        args.output_dir.resolve(),
    )


def require_file(path, label):
    if not path.is_file() or path.stat().st_size == 0:
        raise FinishError(f"{label}: missing or empty file: {path}")


def identity_transform(obj):
    return (
        all(abs(value) < 1e-8 for value in obj.location)
        and all(abs(value) < 1e-8 for value in obj.rotation_euler)
        and all(abs(value - 1.0) < 1e-8 for value in obj.scale)
    )


def world_bounds(obj):
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return tuple(
        value
        for axis in range(3)
        for value in (
            min(point[axis] for point in points),
            max(point[axis] for point in points),
        )
    )


def local_bounds(obj):
    points = [Vector(corner) for corner in obj.bound_box]
    return tuple(
        value
        for axis in range(3)
        for value in (
            min(point[axis] for point in points),
            max(point[axis] for point in points),
        )
    )


def assert_bounds_close(actual, expected, label, axes=(0, 1, 2)):
    axis_names = "XYZ"
    for axis in axes:
        for endpoint, suffix in ((0, "min"), (1, "max")):
            index = axis * 2 + endpoint
            delta = abs(actual[index] - expected[index])
            if delta > BOUND_TOL:
                raise FinishError(
                    f"{label}: {axis_names[axis]}{suffix} differs by "
                    f"{delta:.4f} mm (allowed {BOUND_TOL:.2f})"
                )


def validate_mesh(mesh, label, require_manifold=True):
    if not mesh.vertices or not mesh.polygons:
        raise FinishError(f"{label}: mesh is empty")
    if any(not all(math.isfinite(value) for value in vertex.co)
           for vertex in mesh.vertices):
        raise FinishError(f"{label}: mesh has non-finite coordinates")

    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        nonmanifold = sum(1 for edge in bm.edges if not edge.is_manifold)
        if require_manifold and nonmanifold:
            raise FinishError(f"{label}: {nonmanifold} non-manifold edges")
    finally:
        bm.free()


def validate_object(
    obj, label, expected_bounds=None, axes=(0, 1, 2), require_manifold=True
):
    if obj.type != "MESH":
        raise FinishError(f"{label}: expected MESH, got {obj.type}")
    validate_mesh(obj.data, label, require_manifold=require_manifold)
    bounds = world_bounds(obj)
    if any(not math.isfinite(value) for value in bounds):
        raise FinishError(f"{label}: non-finite bounds")
    if any(bounds[axis * 2 + 1] <= bounds[axis * 2] for axis in range(3)):
        raise FinishError(f"{label}: zero-volume bounds {bounds}")
    if expected_bounds is not None:
        assert_bounds_close(bounds, expected_bounds, label, axes=axes)
    return bounds


def import_one_stl(
    path, label, require_manifold=True, use_mesh_validate=True
):
    before = set(bpy.data.objects)
    bpy.ops.object.select_all(action="DESELECT")
    result = bpy.ops.wm.stl_import(
        filepath=str(path),
        global_scale=1.0,
        use_scene_unit=False,
        use_mesh_validate=use_mesh_validate,
        forward_axis="Y",
        up_axis="Z",
    )
    if "FINISHED" not in result:
        raise FinishError(f"{label}: Blender STL import failed: {path}")
    created = [obj for obj in bpy.data.objects if obj not in before]
    if len(created) != 1 or created[0].type != "MESH":
        raise FinishError(
            f"{label}: expected one imported mesh, got "
            f"{[(obj.name, obj.type) for obj in created]}"
        )
    obj = created[0]
    if not identity_transform(obj):
        raise FinishError(f"{label}: imported STL has non-identity transform")
    validate_object(obj, label, require_manifold=require_manifold)
    return obj


def preflight(paths):
    require_file(paths.template, "template")
    require_file(paths.display, "display")
    require_file(paths.front_input, "front input")
    require_file(paths.back_input, "back input")
    for stem in BUTTON_STEMS:
        require_file(paths.preview / f"{stem}.stl", stem)
    require_file(paths.preview / "pcb.stl", "pcb")

    if Path(bpy.data.filepath).resolve() != paths.template:
        raise FinishError(
            f"wrong Blender template: opened {bpy.data.filepath}, "
            f"expected {paths.template}"
        )

    targets = {}
    original_bounds = {}
    for target_name, _, _ in SHELL_INPUTS:
        target = bpy.data.objects.get(target_name)
        if target is None or target.type != "MESH":
            raise FinishError(f"template object {target_name!r} is missing or not a mesh")
        if not identity_transform(target):
            raise FinishError(f"template object {target_name!r} transform is not identity")
        # The existing mesh data is replaced before evaluation. It only needs
        # to provide the finishing template's expected bounds; closure is
        # required on the generated and evaluated meshes instead.
        validate_object(
            target, f"template {target_name}", require_manifold=False
        )
        for modifier in target.modifiers:
            if not modifier.show_render:
                raise FinishError(
                    f"{target_name}.{modifier.name}: modifier is disabled for render"
                )
            if modifier.type == "BOOLEAN":
                if modifier.operand_type != "OBJECT":
                    raise FinishError(
                        f"{target_name}.{modifier.name}: only object operands are supported"
                    )
                if modifier.object is None or modifier.object.type != "MESH":
                    raise FinishError(
                        f"{target_name}.{modifier.name}: missing mesh Boolean operand"
                    )
        targets[target_name] = target
        original_bounds[target_name] = world_bounds(target)
    return targets, original_bounds


def replace_mesh_data(target, imported):
    identity = (target.name, tuple(mod.name for mod in target.modifiers))
    old_mesh = target.data
    target.data = imported.data
    bpy.data.objects.remove(imported, do_unlink=True)
    if old_mesh.users == 0:
        bpy.data.meshes.remove(old_mesh)
    target.data.name = f"{target.name}_generated"
    after = (target.name, tuple(mod.name for mod in target.modifiers))
    if after != identity:
        raise FinishError(f"{target.name}: object identity or modifier stack changed")


def evaluated_mesh(target):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    return bpy.data.meshes.new_from_object(
        target.evaluated_get(depsgraph), depsgraph=depsgraph
    )


def export_shell(target, staged_path, expected_bounds):
    evaluated = evaluated_mesh(target)
    try:
        validate_mesh(evaluated, f"evaluated {target.name}")
    finally:
        bpy.data.meshes.remove(evaluated)

    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    result = bpy.ops.wm.stl_export(
        filepath=str(staged_path),
        export_selected_objects=True,
        apply_modifiers=True,
        evaluation_mode="DAG_EVAL_RENDER",
        global_scale=1.0,
        use_scene_unit=False,
        forward_axis="Y",
        up_axis="Z",
    )
    if "FINISHED" not in result or not staged_path.is_file():
        raise FinishError(f"{target.name}: STL export failed: {staged_path}")

    # The template's Manifold Boolean solver can emit zero-area triangles that
    # Blender's STL importer drops. Closure is therefore checked on the fully
    # evaluated Blender mesh above; re-import verifies the written STL's object
    # count, coordinates, and bounds without reinterpreting that cleanup as a
    # Boolean failure.
    check = import_one_stl(
        staged_path,
        f"staged {target.name}",
        require_manifold=False,
        use_mesh_validate=False,
    )
    try:
        validate_object(
            check,
            f"staged {target.name}",
            expected_bounds=expected_bounds,
            axes=(0, 1),
            require_manifold=False,
        )
    finally:
        mesh = check.data
        bpy.data.objects.remove(check, do_unlink=True)
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    print(f"FINISH staged {target.name}: {staged_path}")


def move_to_collection(obj, collection):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


def make_material(name, colour):
    material = bpy.data.materials.new(name)
    material.diffuse_color = colour
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = colour
    principled.inputs["Roughness"].default_value = 0.45
    return material


def assign_material(obj, material):
    obj.data.materials.clear()
    obj.data.materials.append(material)
    obj.color = material.diffuse_color


def append_display(path, collection):
    with bpy.data.libraries.load(str(path), link=False) as (source, target):
        if "es3c28p_3d" not in source.objects:
            raise FinishError(f"display object es3c28p_3d missing from {path}")
        target.objects = ["es3c28p_3d"]
    display = target.objects[0]
    if display is None or display.type != "MESH":
        raise FinishError("appended display is missing or not a mesh")
    collection.objects.link(display)
    if len(display.material_slots) != 4:
        raise FinishError(
            f"display must retain four material slots, got {len(display.material_slots)}"
        )
    display_images = {
        node.image
        for slot in display.material_slots
        if slot.material and slot.material.node_tree
        for node in slot.material.node_tree.nodes
        if getattr(node, "image", None) is not None
    }
    if not display_images:
        raise FinishError("display materials do not reference an image")
    for image in display_images:
        if not image.has_data:
            image_path = Path(image.filepath_raw or image.filepath)
            if str(image_path).startswith("//"):
                image_path = path.parent / str(image_path)[2:]
            elif not image_path.is_absolute():
                image_path = path.parent / image_path
            image_path = image_path.resolve()
            require_file(image_path, f"display image {image.name}")
            image.filepath = str(image_path)
            image.reload()
        if any(dimension <= 0 for dimension in image.size):
            raise FinishError(f"display image {image.name!r} is not loaded")
        if image.packed_file is None:
            image.pack()
        if image.packed_file is None or not image.has_data:
            raise FinishError(f"display image {image.name!r} could not be packed")
    # The display is a visual assembly mesh with separate open component
    # surfaces, not a printable watertight solid.
    validate_object(display, "display", require_manifold=False)
    return display


def append_template_components(path, collection):
    with bpy.data.libraries.load(str(path), link=False) as (source, target):
        missing = [name for name in TEMPLATE_COMPONENTS if name not in source.objects]
        if missing:
            raise FinishError(
                f"template components missing from {path}: {', '.join(missing)}"
            )
        target.objects = list(TEMPLATE_COMPONENTS)

    components = {}
    for name, obj in zip(TEMPLATE_COMPONENTS, target.objects):
        if obj is None or obj.type != "MESH":
            raise FinishError(f"template component {name!r} is missing or not a mesh")
        if obj.name != name:
            raise FinishError(
                f"template component name changed: expected {name!r}, got {obj.name!r}"
            )
        collection.objects.link(obj)
        validate_object(obj, f"template component {name}", require_manifold=False)
        components[name] = obj
    return components


def import_assembly_part(
    path, name, collection, material, require_manifold=True
):
    obj = import_one_stl(
        path, name, require_manifold=require_manifold
    )
    obj.name = name
    obj.data.name = f"{name}_mesh"
    move_to_collection(obj, collection)
    assign_material(obj, material)
    return obj


def build_clean_assembly(paths, staged_front, staged_back, staged_blend):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "MILLIMETERS"
    bpy.context.preferences.filepaths.save_version = 0

    collections = {}
    for name in ("Case", "Buttons", "Electronics", "Display"):
        collection = bpy.data.collections.new(name)
        scene.collection.children.link(collection)
        collections[name] = collection

    materials = {
        name: make_material(name, colour)
        for name, colour in MATERIAL_SPECS.items()
    }

    import_assembly_part(
        staged_front, "shell_front_embossed", collections["Case"],
        materials["Case Purple"],
        require_manifold=False,
    )
    import_assembly_part(
        staged_back, "shell_back_embossed", collections["Case"],
        materials["Case White"],
        require_manifold=False,
    )
    for stem in BUTTON_STEMS:
        import_assembly_part(
            paths.preview / f"{stem}.stl", stem, collections["Buttons"],
            materials["Button Yellow"],
        )
    import_assembly_part(
        paths.preview / "pcb.stl", "pcb", collections["Electronics"],
        materials["PCB Green"],
    )
    append_template_components(paths.template, collections["Electronics"])
    append_display(paths.display, collections["Display"])

    expected = {
        "shell_front_embossed", "shell_back_embossed", "pcb", "es3c28p_3d",
        *BUTTON_STEMS, *TEMPLATE_COMPONENTS,
    }
    actual = {obj.name for obj in bpy.data.objects if obj.type == "MESH"}
    if actual != expected:
        raise FinishError(
            f"assembly object mismatch: missing={sorted(expected - actual)}, "
            f"extra={sorted(actual - expected)}"
        )
    if set(bpy.data.collections) != set(collections.values()):
        raise FinishError("assembly contains unexpected collections")

    result = bpy.ops.wm.save_as_mainfile(
        filepath=str(staged_blend), check_existing=False
    )
    if "FINISHED" not in result or not staged_blend.is_file():
        raise FinishError(f"failed to save assembly: {staged_blend}")
    print(f"FINISH staged assembly: {staged_blend} ({len(actual)} mesh objects)")


def preserved_object_state(excluded=()):
    excluded = set(excluded)
    return {
        obj.name: {
            "object": obj,
            "matrix_world": obj.matrix_world.copy(),
            "collections": tuple(sorted(
                collection.name for collection in obj.users_collection
            )),
            "data": obj.data if obj.type == "MESH" else None,
        }
        for obj in bpy.data.objects
        if obj.name not in excluded
    }


def assert_preserved_object_state(snapshot):
    for name, before in snapshot.items():
        obj = bpy.data.objects.get(name)
        if obj is not before["object"]:
            raise FinishError(
                f"assembly object changed during shell replacement: {name}"
            )
        if obj.matrix_world != before["matrix_world"]:
            raise FinishError(
                f"assembly transform changed during shell replacement: {name}"
            )
        collections = tuple(sorted(
            collection.name for collection in obj.users_collection
        ))
        if collections != before["collections"]:
            raise FinishError(
                "assembly collection membership changed during shell "
                f"replacement: {name}"
            )
        if before["data"] is not None and obj.data is not before["data"]:
            raise FinishError(
                f"non-shell mesh data changed during replacement: {name}"
            )


def replace_assembly_mesh_data(target, imported):
    identity = {
        "object": target,
        "name": target.name,
        "matrix_world": target.matrix_world.copy(),
        "parent": target.parent,
        "collections": tuple(sorted(
            collection.name for collection in target.users_collection
        )),
        "materials": tuple(target.data.materials),
    }
    old_mesh = target.data
    new_mesh = imported.data
    new_mesh.materials.clear()
    for material in identity["materials"]:
        new_mesh.materials.append(material)
    target.data = new_mesh
    bpy.data.objects.remove(imported, do_unlink=True)
    if old_mesh.users == 0:
        bpy.data.meshes.remove(old_mesh)
    target.data.name = f"{target.name}_generated"

    collections = tuple(sorted(
        collection.name for collection in target.users_collection
    ))
    if (
        target is not identity["object"]
        or target.name != identity["name"]
        or target.matrix_world != identity["matrix_world"]
        or target.parent is not identity["parent"]
        or collections != identity["collections"]
        or tuple(target.data.materials) != identity["materials"]
    ):
        raise FinishError(f"{target.name}: authored object state changed")


def update_existing_assembly(
    source, staged_front, staged_back, staged_blend
):
    result = bpy.ops.wm.open_mainfile(filepath=str(source))
    if "FINISHED" not in result:
        raise FinishError(f"failed to open existing assembly: {source}")
    opened_source = Path(bpy.data.filepath).resolve()
    if opened_source != source.resolve():
        raise FinishError(
            f"opened assembly source {opened_source}, expected {source.resolve()}"
        )
    print(f"FINISH opened staged assembly source: {opened_source}")

    targets = {}
    for name in ("shell_front_embossed", "shell_back_embossed"):
        target = bpy.data.objects.get(name)
        if target is None or target.type != "MESH":
            raise FinishError(f"existing assembly lacks mesh object {name!r}")
        validate_object(target, f"existing assembly {name}", require_manifold=False)
        targets[name] = target

    protected = preserved_object_state(excluded=targets)
    for name, staged_path in (
        ("shell_front_embossed", staged_front),
        ("shell_back_embossed", staged_back),
    ):
        imported = import_one_stl(
            staged_path, f"assembly replacement {name}", require_manifold=False
        )
        assert_bounds_close(
            local_bounds(imported), local_bounds(targets[name]),
            f"assembly replacement {name} local bounds", axes=(0, 1),
        )
        replace_assembly_mesh_data(targets[name], imported)

    assert_preserved_object_state(protected)
    bpy.context.preferences.filepaths.save_version = 0
    result = bpy.ops.wm.save_as_mainfile(
        filepath=str(staged_blend), check_existing=False
    )
    if "FINISHED" not in result or not staged_blend.is_file():
        raise FinishError(f"failed to save preserved assembly: {staged_blend}")
    print(
        f"FINISH staged preserved assembly: {staged_blend} "
        f"({len(bpy.data.objects)} objects)"
    )


def build_assembly(paths, staged_front, staged_back, staged_blend):
    existing = paths.output / "pocket_card_complete.blend"
    if existing.is_file():
        staged_source = staged_blend.with_name(
            "pocket_card_complete_source.blend"
        )
        shutil.copy2(existing, staged_source)
        require_file(staged_source, "staged existing assembly")
        update_existing_assembly(
            staged_source, staged_front, staged_back, staged_blend
        )
    else:
        build_clean_assembly(
            paths, staged_front, staged_back, staged_blend
        )


def publish(staged_to_final):
    token = uuid.uuid4().hex
    backups = {}
    installed = []
    try:
        for _, final in staged_to_final:
            if final.exists():
                backup = final.with_name(f".{final.name}.{token}.bak")
                os.replace(final, backup)
                backups[final] = backup
        for staged, final in staged_to_final:
            os.replace(staged, final)
            installed.append(final)
    except Exception:
        for final in reversed(installed):
            if final.exists():
                final.unlink()
        for final, backup in backups.items():
            if backup.exists():
                os.replace(backup, final)
        raise
    else:
        for backup in backups.values():
            backup.unlink(missing_ok=True)


def finish(paths):
    paths.output.mkdir(parents=True, exist_ok=True)
    targets, original_bounds = preflight(paths)
    staging = Path(tempfile.mkdtemp(prefix=".pocket-card-finish-", dir=paths.output))
    try:
        staged = {}
        for target_name, input_attr, output_name in SHELL_INPUTS:
            imported = import_one_stl(
                getattr(paths, input_attr), f"generated {target_name}",
                require_manifold=False,
            )
            assert_bounds_close(
                world_bounds(imported), original_bounds[target_name],
                f"generated {target_name}",
            )
            replace_mesh_data(targets[target_name], imported)
            staged_path = staging / output_name
            export_shell(
                targets[target_name], staged_path, original_bounds[target_name]
            )
            staged[output_name] = staged_path

        staged_blend = staging / "pocket_card_complete.blend"
        build_assembly(
            paths,
            staged["shell_front_embossed.stl"],
            staged["shell_back_embossed.stl"],
            staged_blend,
        )
        staged["pocket_card_complete.blend"] = staged_blend

        publication = [
            (staged[name], paths.output / name)
            for name in (
                "shell_front_embossed.stl",
                "shell_back_embossed.stl",
                "pocket_card_complete.blend",
            )
        ]
        publish(publication)
        for _, final in publication:
            print(f"FINISH wrote {final}")
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def main():
    paths = parse_args(script_args())
    try:
        finish(paths)
    except Exception as exc:
        print(f"FINISH ERROR: {exc}", file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
