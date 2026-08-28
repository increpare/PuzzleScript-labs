"""Verify the authored Pocket Card assembly and its native rear-deck mesh.

Run with Blender so the check inspects the mesh stored in the canonical
``pocket_card_complete.blend`` rather than a separately imported diagnostic
STL::

    blender --background out/order/pocket_card_complete.blend \
      --python-exit-code 1 --python tools/verify_complete_rear_profile.py
"""
from __future__ import annotations

import math
from pathlib import Path
import statistics
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


CASE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CASE_DIR))
import params as P  # noqa: E402


EXPECTED_COLLECTIONS = {
    "Buttons": {
        "cap_action", "cap_down", "cap_left", "cap_menu", "cap_reset",
        "cap_right", "cap_undo", "cap_up", "tip_mute", "tip_power",
    },
    "Case": {"shell_back_embossed", "shell_front_embossed"},
    "Display": {"es3c28p_3d"},
    "Electronics": {"Battery", "pcb", "speaker"},
    "Fasteners": {
        name
        for index in range(1, 7)
        for name in (f"nut_{index}", f"screw_{index}")
    },
    "QLE": {
        "Area_Back", "Area_Fill", "Area_Left", "Area_Right", "Backdrop",
        "Camera", "Lights_Target",
    },
}
EXPECTED_OBJECT_TYPES = {
    "Area_Back": "LIGHT",
    "Area_Fill": "LIGHT",
    "Area_Left": "LIGHT",
    "Area_Right": "LIGHT",
    "Backdrop": "MESH",
    "Battery": "MESH",
    "Camera": "CAMERA",
    "Lights_Target": "EMPTY",
    "cap_action": "MESH",
    "cap_down": "MESH",
    "cap_left": "MESH",
    "cap_menu": "MESH",
    "cap_reset": "MESH",
    "cap_right": "MESH",
    "cap_undo": "MESH",
    "cap_up": "MESH",
    "es3c28p_3d": "MESH",
    "pcb": "MESH",
    "shell_back_embossed": "MESH",
    "shell_front_embossed": "MESH",
    "speaker": "MESH",
    "tip_mute": "MESH",
    "tip_power": "MESH",
    **{
        name: "MESH"
        for index in range(1, 7)
        for name in (f"nut_{index}", f"screw_{index}")
    },
}
EXPECTED_MATERIALS = {
    "Backdrop", "Button Yellow", "Case Purple", "Case White",
    "Material.002", "Material.007", "Material.008", "Material.011",
    "Material.012", "Material.013", "PCB Green", "Fastener Steel",
}
EXPECTED_SHELL_TRANSLATION = Vector((-3.6846468, -2.2743397, 0.6752583))


class VerificationFailure(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise VerificationFailure(message)


def require_close(actual: float, expected: float, tolerance: float, label: str) -> None:
    if abs(actual - expected) > tolerance:
        raise VerificationFailure(
            f"{label}: got {actual:.5f}, expected {expected:.5f} "
            f"(+/- {tolerance:.5f})"
        )


def axis_bounds(points) -> tuple[float, ...]:
    points = tuple(points)
    return tuple(
        value
        for axis in range(3)
        for value in (
            min(point[axis] for point in points),
            max(point[axis] for point in points),
        )
    )


def local_bounds(obj) -> tuple[float, ...]:
    return axis_bounds(Vector(corner) for corner in obj.bound_box)


def world_bounds(obj) -> tuple[float, ...]:
    return axis_bounds(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)


def verify_inventory() -> None:
    actual_objects = {obj.name: obj.type for obj in bpy.data.objects}
    wrong_types = sorted(
        name
        for name, expected_type in EXPECTED_OBJECT_TYPES.items()
        if name in actual_objects and actual_objects[name] != expected_type
    )
    require(
        actual_objects == EXPECTED_OBJECT_TYPES,
        "authored object inventory changed: "
        f"missing={sorted(set(EXPECTED_OBJECT_TYPES) - set(actual_objects))}, "
        f"extra={sorted(set(actual_objects) - set(EXPECTED_OBJECT_TYPES))}, "
        f"wrong_types={wrong_types}",
    )

    actual_collections = {
        collection.name: {obj.name for obj in collection.objects}
        for collection in bpy.data.collections
    }
    require(
        actual_collections == EXPECTED_COLLECTIONS,
        "authored collection inventory changed: "
        f"got {actual_collections!r}",
    )
    for collection in bpy.data.collections:
        require(not collection.children, f"unexpected child collection in {collection.name}")

    root_children = {child.name for child in bpy.context.scene.collection.children}
    require(root_children == set(EXPECTED_COLLECTIONS), "scene root collection links changed")
    require(
        {material.name for material in bpy.data.materials} == EXPECTED_MATERIALS,
        "authored material inventory changed",
    )
    require(bpy.context.scene.camera is bpy.data.objects["Camera"], "scene camera changed")
    require(
        bpy.context.scene.world is not None
        and bpy.context.scene.world.name == "QLE World",
        "authored QLE world is missing",
    )
    require(bpy.context.scene.render.engine == "CYCLES", "authored render engine changed")

    expected_slots = {
        "shell_front_embossed": ("Case Purple",),
        "shell_back_embossed": ("Case White",),
        "pcb": ("PCB Green",),
        "Backdrop": ("Backdrop",),
        **{name: ("Fastener Steel",) for name in EXPECTED_COLLECTIONS["Fasteners"]},
    }
    for name, expected in expected_slots.items():
        actual = tuple(
            slot.material.name if slot.material else None
            for slot in bpy.data.objects[name].material_slots
        )
        require(actual == expected, f"{name}: material slots changed: {actual!r}")

    qle = bpy.data.collections["QLE"]
    require(
        {obj.name for obj in qle.all_objects} == EXPECTED_COLLECTIONS["QLE"],
        "QLE contents changed",
    )
    print(
        "PASS inventory: authored 35-object/6-collection lookdev scene, "
        "QLE camera/backdrop/four area lights, and material assignments present"
    )


def verify_bounds() -> None:
    front = bpy.data.objects["shell_front_embossed"]
    back = bpy.data.objects["shell_back_embossed"]
    require(front.matrix_world == back.matrix_world, "shell authored transforms differ")
    translation, rotation, scale = back.matrix_world.decompose()
    require(
        (translation - EXPECTED_SHELL_TRANSLATION).length <= 0.002,
        f"shell authored translation changed: {tuple(translation)!r}",
    )
    for axis, value in enumerate(scale):
        require_close(value, 0.05, 0.00002, f"shell world scale axis {axis}")
    require(
        abs(rotation.angle) > math.radians(1.0),
        "shell transform unexpectedly became the clean fallback identity rotation",
    )

    front_local = local_bounds(front)
    back_local = local_bounds(back)
    for actual, expected, label in (
        (front_local[0], 0.0, "front local xmin"),
        (front_local[1], P.BODY_W, "front local xmax"),
        (front_local[2], 0.0, "front local ymin"),
        (front_local[3], P.BODY_H, "front local ymax"),
        (back_local[0], 0.0, "back local xmin"),
        (back_local[1], P.BODY_W, "back local xmax"),
        (back_local[2], 0.0, "back local ymin"),
        (back_local[3], P.BODY_H, "back local ymax"),
        (back_local[4], -P.DECK_ZONE_T, "back local zmin"),
    ):
        require_close(actual, expected, 0.06, label)

    front_world = world_bounds(front)
    back_world = world_bounds(back)
    require_close(front_world[1] - front_world[0], 4.5, 0.01, "front world width")
    require_close(back_world[1] - back_world[0], 4.5, 0.01, "back world width")
    require(4.5 < back_world[3] - back_world[2] < 4.8, "back world height is not sane")
    require(0.5 < back_world[5] - back_world[4] < 0.8, "back world depth is not sane")
    print(
        "PASS bounds: native 90x93 mm shells retain the authored 0.05-scale, "
        "rotated world transform and sane transformed bounds"
    )


def intersection_volume(first, second) -> float:
    """Return exact evaluated mesh overlap without changing the saved scene."""
    duplicate = first.copy()
    duplicate.data = first.data.copy()
    bpy.context.scene.collection.objects.link(duplicate)
    try:
        modifier = duplicate.modifiers.new("verification intersection", "BOOLEAN")
        modifier.operation = "INTERSECT"
        modifier.solver = "EXACT"
        modifier.object = second
        bpy.ops.object.select_all(action="DESELECT")
        duplicate.select_set(True)
        bpy.context.view_layer.objects.active = duplicate
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        mesh = bmesh.new()
        try:
            mesh.from_mesh(duplicate.data)
            return abs(mesh.calc_volume(signed=True)) if mesh.faces else 0.0
        finally:
            mesh.free()
    finally:
        data = duplicate.data
        bpy.data.objects.remove(duplicate, do_unlink=True)
        if data.users == 0:
            bpy.data.meshes.remove(data)


def verify_fastener_clearance() -> None:
    pcb = bpy.data.objects["pcb"]
    for name in ("screw_5", "screw_6"):
        overlap = intersection_volume(bpy.data.objects[name], pcb)
        require_close(overlap, 0.0, 1e-5, f"{name} actual PCB overlap")
    print("PASS fasteners: H1/H2 screw meshes clear the current PCB mesh")


def native_profile_sampler(obj):
    require(not obj.modifiers, "shell_back_embossed unexpectedly has live modifiers")
    vertices = [vertex.co.copy() for vertex in obj.data.vertices]
    polygons = [tuple(polygon.vertices) for polygon in obj.data.polygons]
    require(vertices and polygons, "shell_back_embossed native mesh is empty")
    tree = BVHTree.FromPolygons(vertices, polygons, all_triangles=True)
    z_start = local_bounds(obj)[4] - 10.0

    def sample(layout_y: float) -> float:
        model_y = P.BODY_H - layout_y
        hits = []
        # The median rejects local engraving/feature openings while every ray
        # still interrogates the native shell mesh in the flat centre field.
        for x in (30.0, 35.0, 40.0, 45.0, 50.0, 55.0, 60.0):
            hit, _normal, _index, _distance = tree.ray_cast(
                Vector((x, model_y, z_start)), Vector((0.0, 0.0, 1.0)), 100.0
            )
            require(hit is not None, f"rear surface ray missed at x={x}, layout y={layout_y}")
            hits.append(hit.z)
        return statistics.median(hits)

    return sample


def verify_profile() -> None:
    back = bpy.data.objects["shell_back_embossed"]
    sample = native_profile_sampler(back)
    depths = {
        "upper_y10": -(sample(10.0) + P.BODY_T),
        "top_y24": -(sample(24.0) + P.BODY_T),
        "upper_y30": -(sample(30.0) + P.BODY_T),
        "rise_start": -(sample(P.DECK_RISE_Y0) + P.BODY_T),
        "rise_mid": -(sample((P.DECK_RISE_Y0 + P.DECK_PLATEAU_Y0) / 2) + P.BODY_T),
        "plateau_start": -(sample(P.DECK_PLATEAU_Y0 + 0.2) + P.BODY_T),
        "plug": -(sample(P.DISPLAY_PLUG_Y) + P.BODY_T),
        "plateau_end": -(sample(P.DECK_PLATEAU_Y1 - 0.2) + P.BODY_T),
        "lower_y70": -(sample(70.0) + P.BODY_T),
        "bottom_y90": -(sample(90.0) + P.BODY_T),
    }

    require_close(depths["upper_y10"], 0.0, 0.08, "upper y=10 added depth")
    require_close(depths["top_y24"], 0.0, 0.08, "top y=24 added depth")
    require_close(depths["upper_y30"], 0.0, 0.08, "upper y=30 added depth")
    require_close(depths["rise_start"], 0.0, 0.10, "rise start added depth")
    require_close(depths["rise_mid"], P.DECK_H / 2, 0.14, "rise midpoint added depth")
    for label in ("plateau_start", "plug", "plateau_end"):
        require_close(depths[label], P.DECK_H, 0.10, f"{label} added depth")
    require(
        0.6 < depths["lower_y70"] < P.DECK_H - 0.4,
        f"lower y=70 is not an intermediate taper depth: {depths['lower_y70']:.4f}",
    )
    require_close(depths["bottom_y90"], 0.0, 0.12, "bottom y=90 added depth")

    rise_y = [
        P.DECK_RISE_Y0 + (P.DECK_PLATEAU_Y0 - P.DECK_RISE_Y0) * index / 12
        for index in range(13)
    ]
    rise_depth = [-(sample(y) + P.BODY_T) for y in rise_y]
    require(
        all(a <= b + 0.08 for a, b in zip(rise_depth, rise_depth[1:])),
        f"rear shoulder is not monotonic: {rise_depth!r}",
    )
    # Avoid the existing full-width recessed grille/detail near layout
    # y=76.5: a back-surface ray there intentionally reaches the detail's
    # floor, not the deck skin. These clean fields still cover the complete
    # lower return, including the requested y=70 witness point.
    taper_y = [P.DECK_PLATEAU_Y1, 55.0, 65.0, 70.0, 80.0, 90.0]
    taper_depth = [-(sample(y) + P.BODY_T) for y in taper_y]
    require(
        all(a + 0.08 >= b for a, b in zip(taper_depth, taper_depth[1:])),
        f"lower return is not monotonic: {taper_depth!r}",
    )
    require(
        depths["upper_y10"] < depths["rise_mid"] < depths["plug"]
        and depths["bottom_y90"] < depths["lower_y70"] < depths["plug"],
        f"rear profile ordering is wrong: {depths!r}",
    )
    print(
        "PASS profile: native shell mesh is thin at upper y=10/y=24/y=30, rises "
        f"to {depths['plug']:.3f} mm at plug y={P.DISPLAY_PLUG_Y:.4f}, "
        f"tapers through {depths['lower_y70']:.3f} mm at y=70, and returns "
        "to normal near the bottom"
    )


def main() -> None:
    checks = (
        ("inventory", verify_inventory),
        ("bounds", verify_bounds),
        ("fasteners", verify_fastener_clearance),
        ("profile", verify_profile),
    )
    failures = []
    for label, check in checks:
        try:
            check()
        except Exception as exc:
            failures.append((label, str(exc)))
            print(f"FAIL {label}: {exc}", file=sys.stderr)
    if failures:
        print(f"FAIL complete rear profile: {len(failures)} check(s) failed", file=sys.stderr)
        raise SystemExit(1)
    print("PASS complete rear profile: inventory, bounds, and tapered deck verified")


if __name__ == "__main__":
    main()
