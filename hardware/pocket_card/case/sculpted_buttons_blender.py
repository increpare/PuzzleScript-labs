"""Replace the neutral caps in a complete Pocket Card .blend assembly.

Blender opens the source file before running this script.  The sculpted caps
are imported from individual STLs already exported in model space.  Each
imported mesh is transferred onto its existing target object so object
identity and authored transforms are preserved, including nonidentity
transforms used by the lookdev assembly.

Run through Blender, for example::

    blender --background out/order/pocket_card_complete.blend \
      --python sculpted_buttons_blender.py -- \
      --input out/order/pocket_card_complete.blend \
      --buttons-dir out/sculpted_buttons/placed \
      --output out/sculpted_buttons/pocket_card_complete_sculpted.blend
"""
import argparse
import sys
from pathlib import Path


BUTTON_NAMES = (
    "cap_up", "cap_down", "cap_left", "cap_right",
    "cap_undo", "cap_action", "cap_reset", "cap_menu",
)
TIP_NAMES = ("tip_power", "tip_mute")


def parse_args(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--buttons-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(argv)


def blender_args():
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1:]


def identity_transform(obj):
    return (
        tuple(round(value, 8) for value in obj.location) == (0.0, 0.0, 0.0)
        and tuple(round(value, 8) for value in obj.rotation_euler)
        == (0.0, 0.0, 0.0)
        and tuple(round(value, 8) for value in obj.scale) == (1.0, 1.0, 1.0)
    )


def main(argv=None):
    args = parse_args(blender_args() if argv is None else argv)
    import bpy

    source = args.input.resolve()
    current = Path(bpy.data.filepath).resolve()
    if current != source:
        raise RuntimeError(f"opened {current}, expected input assembly {source}")
    if not source.is_file():
        raise RuntimeError(f"missing input assembly: {source}")

    button_collection = bpy.data.collections.get("Buttons")
    if (
        button_collection is None
        or bpy.data.materials.get("Button Yellow") is None
    ):
        raise RuntimeError("input assembly lacks Buttons collection/material")

    protected = {
        obj.name: (
            obj,
            obj.matrix_world.copy(),
            obj.data if obj.type == "MESH" else None,
        )
        for obj in bpy.data.objects
        if obj.name not in BUTTON_NAMES
    }

    for name in BUTTON_NAMES:
        path = (args.buttons_dir / f"{name}.stl").resolve()
        if not path.is_file():
            raise RuntimeError(f"missing sculpted button mesh: {path}")
        old = bpy.data.objects.get(name)
        if old is None or old.type != "MESH":
            raise RuntimeError(f"input assembly lacks mesh object {name!r}")

        identity = {
            "object": old,
            "matrix_world": old.matrix_world.copy(),
            "parent": old.parent,
            "collections": tuple(sorted(
                collection.name for collection in old.users_collection
            )),
            "materials": tuple(old.data.materials),
        }

        before = set(bpy.data.objects)
        result = bpy.ops.wm.stl_import(
            filepath=str(path),
            global_scale=1.0,
            use_scene_unit=False,
            use_mesh_validate=True,
            forward_axis="Y",
            up_axis="Z",
        )
        created = [obj for obj in bpy.data.objects if obj not in before]
        if "FINISHED" not in result or len(created) != 1:
            raise RuntimeError(f"failed to import {path}: {result}, {created}")
        imported = created[0]
        if not identity_transform(imported):
            raise RuntimeError(f"{name}: imported mesh has non-identity transform")
        old_mesh = old.data
        new_mesh = imported.data
        new_mesh.materials.clear()
        for assigned_material in identity["materials"]:
            new_mesh.materials.append(assigned_material)
        old.data = new_mesh
        bpy.data.objects.remove(imported, do_unlink=True)
        if old_mesh.users == 0:
            bpy.data.meshes.remove(old_mesh)
        old.data.name = f"{name}_sculpted_mesh"

        collections = tuple(sorted(
            collection.name for collection in old.users_collection
        ))
        if (
            old is not identity["object"]
            or old.matrix_world != identity["matrix_world"]
            or old.parent is not identity["parent"]
            or collections != identity["collections"]
            or tuple(old.data.materials) != identity["materials"]
        ):
            raise RuntimeError(f"{name}: authored object state changed")

    for name, (expected, matrix, mesh) in protected.items():
        obj = bpy.data.objects.get(name)
        if (
            obj is not expected
            or obj.matrix_world != matrix
            or (mesh is not None and obj.data is not mesh)
        ):
            raise RuntimeError(f"non-button object changed during replacement: {name}")

    actual = {
        obj.name for obj in button_collection.objects if obj.type == "MESH"
    }
    expected_buttons_collection = {*BUTTON_NAMES, *TIP_NAMES}
    if actual != expected_buttons_collection:
        raise RuntimeError(
            "Buttons collection mismatch: expected "
            f"{sorted(expected_buttons_collection)}, got {sorted(actual)}"
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    result = bpy.ops.wm.save_as_mainfile(
        filepath=str(args.output.resolve()),
        check_existing=False,
        relative_remap=False,
    )
    if "FINISHED" not in result or not args.output.is_file():
        raise RuntimeError(f"failed to save assembled blend: {args.output}")
    print(f"SCULPTED_BLEND={args.output.resolve()}")


if __name__ == "__main__":
    main()
