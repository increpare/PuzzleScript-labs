"""Render deterministic captive-nut closure review views from the loaded assembly.

Run only from Blender with ``pocket_card_complete.blend`` already loaded.  The
script changes render state in memory, restores it after every view, removes
all temporary objects, and deliberately never saves the blend file.
"""
from __future__ import annotations

import argparse
from contextlib import AbstractContextManager
import math
import os
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
from review_png import normalize_png, validate_review_set

try:  # Keep the small geometry-contract helpers importable by normal Python.
    import bpy
    from mathutils import Matrix, Vector
except ImportError:  # pragma: no cover - exercised outside Blender by unit tests.
    bpy = None
    Matrix = None
    Vector = None


CASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = CASE_DIR / "out" / "order" / "review"
RENDER_SIZE = (1200, 900)
OUTPUTS = {
    "assembled": "captive_nuts_assembled.png",
    "exploded": "captive_nuts_exploded.png",
    "h2_cutaway": "captive_nuts_h2_cutaway.png",
    "trap_closeups": "captive_nuts_trap_closeups.png",
}
FASTENER_NAMES = {
    name
    for index in range(1, 7)
    for name in (f"nut_{index}", f"screw_{index}")
}
REQUIRED_OBJECTS = {
    "shell_front_embossed",
    "shell_back_embossed",
    "pcb",
    "Battery",
    "speaker",
    "cap_reset",
    *FASTENER_NAMES,
}
H2_LAYOUT_XY = (64.5, 84.0)
RESET_LAYOUT_XY = (54.5, 80.0)
SPEAKER_LAYOUT_XY = (76.0, 80.0)
H2_LAYOUT_CONTRACT = {
    "H2": H2_LAYOUT_XY,
    "Reset": RESET_LAYOUT_XY,
    "speaker": SPEAKER_LAYOUT_XY,
}
H2_REQUIRED_OBJECTS = {
    "shell_front_embossed",
    "pcb",
    "Battery",
    "speaker",
    "cap_reset",
    "nut_6",
    "screw_6",
}
H2_MIN_PROJECTED_SEPARATION_PX = 120.0
TEMP_PREFIX = "__captive_nut_review_"
EXPECTED_AUTHORED_COMPONENTS = {
    "Battery": {
        "matrix": (
            (0.0500000119, 0.0, 0.0, -2.2230117321),
            (0.0, 0.0499773920, -0.0015038048, -1.1167685986),
            (0.0, 0.0015038048, 0.0499773920, 1.1205059290),
            (0.0, 0.0, 0.0, 1.0),
        ),
        "bounds": (
            -19.7395878, 29.7395897, -19.8229218,
            13.8229208, -19.7738266, -15.2261782,
        ),
    },
    "speaker": {
        "matrix": (
            (0.0008726179, -0.0499923974, 0.0, 0.1224939823),
            (0.0499697812, 0.0008722231, -0.0015038045, -1.6219793558),
            (0.0015035755, 0.0000262450, 0.0499773920, 0.5579864979),
            (0.0, 0.0, 0.0, 1.0),
        ),
        "bounds": (-10.0, 10.0, -7.0, 7.0, -1.75, 1.75),
    },
}


class ReviewFailure(RuntimeError):
    pass


def exploded_model_offsets():
    """Return the exact source-model motion used by the exploded view."""
    names = {"shell_back_embossed"} | {
        f"screw_{index}" for index in range(1, 7)
    }
    return {name: (0.0, 0.0, -18.0) for name in names}


def layout_mouth_to_model_offset(mouth, distance_mm):
    """Convert a layout mouth vector to the once-mirrored shell model frame."""
    x, layout_y = mouth
    length = math.hypot(x, layout_y)
    if not math.isfinite(length) or length == 0.0:
        raise ValueError("mouth vector must be finite and nonzero")
    return (
        distance_mm * x / length,
        -distance_mm * layout_y / length,
        0.0,
    )


def closeup_nut_model_offsets(sites, distance_mm=6.0):
    """Derive closeup offsets from the live authoritative trap-site objects."""
    sites = tuple(sites)
    expected_sites = {
        0: (6.0, 6.5, "module", "nut_1"),
        5: (H2_LAYOUT_XY[0], H2_LAYOUT_XY[1], "pcb", "nut_6"),
    }
    if len(sites) != 6:
        raise ReviewFailure("authoritative trap site count changed")
    offsets = {}
    for index, (x, y, kind, nut_name) in expected_sites.items():
        site = sites[index]
        if (site.x, site.y, site.kind) != (x, y, kind):
            raise ReviewFailure(
                f"authoritative trap site {index + 1} identity/order changed"
            )
        offsets[nut_name] = layout_mouth_to_model_offset(
            site.mouth, distance_mm
        )
    return offsets


def is_stadium_speaker(vertex_count, dimensions_mm):
    """Recognise the authored 20 x 14 x 3.5 mm, 68-vertex pill speaker."""
    expected = (20.0, 14.0, 3.5)
    return vertex_count == 68 and all(
        abs(actual - target) <= 0.02
        for actual, target in zip(dimensions_mm, expected)
    )


def axis_to_bounds_clearance_xy(axis_xy, bounds_xy):
    """Shortest positive XY distance from a screw axis to a rectangular bound."""
    x, y = axis_xy
    xmin, xmax, ymin, ymax = bounds_xy
    dx = max(xmin - x, 0.0, x - xmax)
    dy = max(ymin - y, 0.0, y - ymax)
    return math.hypot(dx, dy)


def validate_required_objects(objects):
    names = set(objects)
    missing = sorted(REQUIRED_OBJECTS - names)
    if missing:
        raise ReviewFailure(f"missing required assembly objects: {', '.join(missing)}")


def _world_bounds(obj):
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return tuple(
        value
        for axis in range(3)
        for value in (
            min(point[axis] for point in points),
            max(point[axis] for point in points),
        )
    )


def _local_dimensions(obj):
    coordinates = list(zip(*obj.bound_box))
    return tuple(max(axis) - min(axis) for axis in coordinates)


def _local_bounds(obj):
    return tuple(
        value
        for axis in range(3)
        for value in (
            min(corner[axis] for corner in obj.bound_box),
            max(corner[axis] for corner in obj.bound_box),
        )
    )


def _require_bounds_close(actual, expected, label, tolerance=0.0002):
    if len(actual) != len(expected) or any(
        abs(first - second) > tolerance
        for first, second in zip(actual, expected)
    ):
        raise ReviewFailure(f"{label} placement changed: {tuple(actual)!r}")


def _require_matrix_close(actual, expected, label, tolerance=0.000002):
    if any(
        abs(actual[row][column] - expected[row][column]) > tolerance
        for row in range(4)
        for column in range(4)
    ):
        raise ReviewFailure(f"{label} placement changed")


def _verify_h2_placements(verifier, params, nut_trap_sites):
    expected_layout = {
        "H2": tuple(params.PCB_MOUNTS[1]),
        "Reset": (params.RESET_X, params.RESET_Y),
        "speaker": (params.GRILLE_X, params.GRILLE_Y),
    }
    if H2_LAYOUT_CONTRACT != expected_layout:
        raise ReviewFailure(
            f"H2 layout contract drifted from parameters: {expected_layout!r}"
        )

    assembly = bpy.data.objects["shell_front_embossed"].matrix_world
    for name in ("pcb", "cap_reset", "nut_6", "screw_6"):
        _require_matrix_close(
            bpy.data.objects[name].matrix_world,
            assembly,
            name,
        )
    pcb_source = verifier.binary_stl_bounds(
        CASE_DIR / "out" / "order" / "preview" / "pcb.stl"
    )
    _require_bounds_close(_local_bounds(bpy.data.objects["pcb"]), pcb_source, "pcb")
    reset_model_xy = (params.RESET_X, params.BODY_H - params.RESET_Y)
    flange_radius = params.RESET_CAP_D / 2.0 + params.CAP_FLANGE_OS
    flat_half_width = flange_radius - params.SCULPTED_ROUND_CAP_FLAT_DEPTH
    reset_source = (
        reset_model_xy[0] - flange_radius,
        reset_model_xy[0] + flange_radius,
        reset_model_xy[1] - flat_half_width,
        reset_model_xy[1] + flat_half_width,
        -(params.FACE_T + params.CAP_FLANGE_T + params.CAP_BOSS_GAP),
        params.SCULPTED_RESET_RIM_H,
    )
    _require_bounds_close(
        _local_bounds(bpy.data.objects["cap_reset"]),
        reset_source,
        "cap_reset",
    )

    h2_model_xy = (H2_LAYOUT_XY[0], params.BODY_H - H2_LAYOUT_XY[1])
    for name in ("nut_6", "screw_6"):
        bounds = _local_bounds(bpy.data.objects[name])
        center = (
            (bounds[0] + bounds[1]) / 2.0,
            (bounds[2] + bounds[3]) / 2.0,
        )
        if any(abs(value - expected) > 0.0002 for value, expected in zip(center, h2_model_xy)):
            raise ReviewFailure(f"{name} H2 centre placement changed: {center!r}")

    for name, expected in EXPECTED_AUTHORED_COMPONENTS.items():
        obj = bpy.data.objects[name]
        _require_matrix_close(obj.matrix_world, expected["matrix"], name)
        _require_bounds_close(_local_bounds(obj), expected["bounds"], name)

    closeup_nut_model_offsets(nut_trap_sites.sites())


def _preflight():
    if bpy is None:
        raise ReviewFailure("this script must run inside Blender")
    bpy.context.view_layer.update()
    validate_required_objects(bpy.data.objects.keys())
    for name in REQUIRED_OBJECTS:
        if bpy.data.objects[name].type != "MESH":
            raise ReviewFailure(f"required object {name} is not a mesh")

    speaker = bpy.data.objects["speaker"]
    if not is_stadium_speaker(len(speaker.data.vertices), _local_dimensions(speaker)):
        raise ReviewFailure(
            "speaker is not the authored 20 x 14 x 3.5 mm stadium mesh"
        )

    screw_bounds = _world_bounds(bpy.data.objects["screw_6"])
    speaker_bounds = _world_bounds(speaker)
    screw_axis = (
        (screw_bounds[0] + screw_bounds[1]) / 2.0,
        (screw_bounds[2] + screw_bounds[3]) / 2.0,
    )
    clearance = axis_to_bounds_clearance_xy(
        screw_axis,
        (speaker_bounds[0], speaker_bounds[1], speaker_bounds[2], speaker_bounds[3]),
    )
    if clearance <= 0.0:
        raise ReviewFailure("screw_6 axis overlaps the actual stadium speaker")

    # Reuse canonical source metadata rather than maintaining a second
    # generated-parts placement authority here.
    sys.path.insert(0, str(CASE_DIR))
    sys.path.insert(0, str(CASE_DIR / "tools"))
    import params
    import nut_trap_sites
    import verify_complete_rear_profile as verifier

    _verify_h2_placements(verifier, params, nut_trap_sites)

    for check in (
        verifier.verify_inventory,
        verifier.verify_bounds,
        verifier.verify_fasteners,
        verifier.verify_profile,
    ):
        check()


def _matrix_signature(matrix):
    # Assigning matrix_world makes Blender decompose/recompose transforms in
    # float32; six decimal places is tighter than the assembly verifier's
    # 0.000002 matrix tolerance while ignoring that harmless round trip.
    return tuple(tuple(round(float(value), 6) for value in row) for row in matrix)


def _material_signature(obj):
    return tuple(
        slot.material.name if slot.material is not None else None
        for slot in obj.material_slots
    )


def _layer_collections():
    def descend(view_layer_name, node, path):
        key = (view_layer_name, path + (node.collection.name,))
        yield key, node
        for child in node.children:
            yield from descend(view_layer_name, child, key[1])
    for view_layer in bpy.context.scene.view_layers:
        yield from descend(view_layer.name, view_layer.layer_collection, ())


def _scene_signature():
    scene = bpy.context.scene
    world = scene.world
    background = None
    if world and world.use_nodes:
        node = world.node_tree.nodes.get("Background")
        if node is not None:
            background = (
                tuple(node.inputs["Color"].default_value),
                float(node.inputs["Strength"].default_value),
            )
    return {
        "objects": {
            obj.name: (
                _matrix_signature(obj.matrix_world),
                bool(obj.hide_render),
                bool(obj.hide_viewport),
                _material_signature(obj),
            )
            for obj in bpy.data.objects
            if not obj.name.startswith(TEMP_PREFIX)
        },
        "collections": {
            collection.name: (bool(collection.hide_render), bool(collection.hide_viewport))
            for collection in bpy.data.collections
        },
        "layer_collections": {
            key: (bool(node.exclude), bool(node.hide_viewport))
            for key, node in _layer_collections()
        },
        "lights": {
            obj.name: (float(obj.data.energy), tuple(obj.data.color))
            for obj in bpy.data.objects
            if obj.type == "LIGHT" and not obj.name.startswith(TEMP_PREFIX)
        },
        "camera": scene.camera.name if scene.camera else None,
        "active": (
            bpy.context.view_layer.objects.active.name
            if bpy.context.view_layer.objects.active
            else None
        ),
        "selected": tuple(sorted(obj.name for obj in bpy.context.selected_objects)),
        "render": (
            scene.render.engine,
            scene.render.filepath,
            scene.render.resolution_x,
            scene.render.resolution_y,
            scene.render.resolution_percentage,
            scene.render.pixel_aspect_x,
            scene.render.pixel_aspect_y,
            bool(scene.render.use_border),
            bool(scene.render.use_crop_to_border),
            scene.render.border_min_x,
            scene.render.border_max_x,
            scene.render.border_min_y,
            scene.render.border_max_y,
            bool(scene.render.film_transparent),
            bool(scene.render.use_file_extension),
            bool(scene.render.use_overwrite),
            bool(scene.render.use_compositing),
            bool(scene.render.use_sequencer),
            scene.render.image_settings.file_format,
            scene.render.image_settings.color_mode,
            scene.render.image_settings.color_depth,
            scene.render.image_settings.compression,
            scene.render.image_settings.color_management,
        ),
        "view": (
            scene.view_settings.view_transform,
            scene.view_settings.look,
            float(scene.view_settings.exposure),
            float(scene.view_settings.gamma),
        ),
        "world": (
            world.name if world else None,
            bool(world.use_nodes) if world else None,
            background,
        ),
    }


class SceneStateGuard(AbstractContextManager):
    """Snapshot every canonical mutable touched by a review view."""

    def __enter__(self):
        scene = bpy.context.scene
        self.scene = scene
        self.objects = {
            obj.name: {
                "matrix": obj.matrix_world.copy(),
                "hide_render": obj.hide_render,
                "hide_viewport": obj.hide_viewport,
                "materials": tuple(slot.material for slot in obj.material_slots),
            }
            for obj in bpy.data.objects
        }
        self.collections = {
            collection: (collection.hide_render, collection.hide_viewport)
            for collection in bpy.data.collections
        }
        self.layer_collections = {
            node: (node.exclude, node.hide_viewport)
            for _key, node in _layer_collections()
        }
        self.lights = {
            obj.data: (obj.data.energy, tuple(obj.data.color))
            for obj in bpy.data.objects if obj.type == "LIGHT"
        }
        self.camera = scene.camera
        self.active_object = bpy.context.view_layer.objects.active
        self.selected_objects = tuple(bpy.context.selected_objects)
        self.render = {
            "engine": scene.render.engine,
            "filepath": scene.render.filepath,
            "resolution_x": scene.render.resolution_x,
            "resolution_y": scene.render.resolution_y,
            "resolution_percentage": scene.render.resolution_percentage,
            "pixel_aspect_x": scene.render.pixel_aspect_x,
            "pixel_aspect_y": scene.render.pixel_aspect_y,
            "use_border": scene.render.use_border,
            "use_crop_to_border": scene.render.use_crop_to_border,
            "border_min_x": scene.render.border_min_x,
            "border_max_x": scene.render.border_max_x,
            "border_min_y": scene.render.border_min_y,
            "border_max_y": scene.render.border_max_y,
            "film_transparent": scene.render.film_transparent,
            "use_file_extension": scene.render.use_file_extension,
            "use_overwrite": scene.render.use_overwrite,
            "use_compositing": scene.render.use_compositing,
            "use_sequencer": scene.render.use_sequencer,
            "file_format": scene.render.image_settings.file_format,
            "color_mode": scene.render.image_settings.color_mode,
            "color_depth": scene.render.image_settings.color_depth,
            "compression": scene.render.image_settings.compression,
            "color_management": scene.render.image_settings.color_management,
        }
        self.view = {
            "view_transform": scene.view_settings.view_transform,
            "look": scene.view_settings.look,
            "exposure": scene.view_settings.exposure,
            "gamma": scene.view_settings.gamma,
        }
        self.world = scene.world
        self.world_use_nodes = self.world.use_nodes if self.world else None
        self.world_state = None
        if self.world and self.world.use_nodes:
            background = self.world.node_tree.nodes.get("Background")
            if background is not None:
                self.world_state = (
                    tuple(background.inputs["Color"].default_value),
                    background.inputs["Strength"].default_value,
                )
        return self

    def __exit__(self, exception_type, exception, traceback):
        for obj in list(bpy.data.objects):
            if obj.name.startswith(TEMP_PREFIX):
                data = obj.data
                bpy.data.objects.remove(obj, do_unlink=True)
                if data is not None and getattr(data, "users", 1) == 0:
                    if isinstance(data, bpy.types.Mesh):
                        bpy.data.meshes.remove(data)
                    elif isinstance(data, bpy.types.Camera):
                        bpy.data.cameras.remove(data)
                    elif isinstance(data, bpy.types.Light):
                        bpy.data.lights.remove(data)
        for collection, state in self.collections.items():
            collection.hide_render, collection.hide_viewport = state
        for node, state in self.layer_collections.items():
            node.exclude, node.hide_viewport = state
        for light, state in self.lights.items():
            light.energy = state[0]
            light.color = state[1]
        for name, state in self.objects.items():
            obj = bpy.data.objects.get(name)
            if obj is None:
                continue
            if obj.matrix_world != state["matrix"]:
                obj.matrix_world = state["matrix"]
            obj.hide_render = state["hide_render"]
            obj.hide_viewport = state["hide_viewport"]
            for slot, material in zip(obj.material_slots, state["materials"]):
                if slot.material != material:
                    slot.material = material
        bpy.ops.object.select_all(action="DESELECT")
        for obj in self.selected_objects:
            if bpy.data.objects.get(obj.name) is obj:
                obj.select_set(True)
        if (
            self.active_object is not None
            and bpy.data.objects.get(self.active_object.name) is self.active_object
        ):
            bpy.context.view_layer.objects.active = self.active_object
        else:
            bpy.context.view_layer.objects.active = None
        scene = self.scene
        scene.camera = self.camera
        scene.render.engine = self.render["engine"]
        scene.render.filepath = self.render["filepath"]
        scene.render.resolution_x = self.render["resolution_x"]
        scene.render.resolution_y = self.render["resolution_y"]
        scene.render.resolution_percentage = self.render["resolution_percentage"]
        scene.render.pixel_aspect_x = self.render["pixel_aspect_x"]
        scene.render.pixel_aspect_y = self.render["pixel_aspect_y"]
        scene.render.use_border = self.render["use_border"]
        scene.render.use_crop_to_border = self.render["use_crop_to_border"]
        scene.render.border_min_x = self.render["border_min_x"]
        scene.render.border_max_x = self.render["border_max_x"]
        scene.render.border_min_y = self.render["border_min_y"]
        scene.render.border_max_y = self.render["border_max_y"]
        scene.render.film_transparent = self.render["film_transparent"]
        scene.render.use_file_extension = self.render["use_file_extension"]
        scene.render.use_overwrite = self.render["use_overwrite"]
        scene.render.use_compositing = self.render["use_compositing"]
        scene.render.use_sequencer = self.render["use_sequencer"]
        scene.render.image_settings.file_format = self.render["file_format"]
        scene.render.image_settings.color_mode = self.render["color_mode"]
        scene.render.image_settings.color_depth = self.render["color_depth"]
        scene.render.image_settings.compression = self.render["compression"]
        scene.render.image_settings.color_management = self.render["color_management"]
        scene.view_settings.view_transform = self.view["view_transform"]
        scene.view_settings.look = self.view["look"]
        scene.view_settings.exposure = self.view["exposure"]
        scene.view_settings.gamma = self.view["gamma"]
        temporary_world = scene.world if scene.world is not self.world else None
        scene.world = self.world
        if self.world:
            self.world.use_nodes = self.world_use_nodes
        if self.world and self.world_state is not None:
            background = self.world.node_tree.nodes.get("Background")
            if background is not None:
                background.inputs["Color"].default_value = self.world_state[0]
                background.inputs["Strength"].default_value = self.world_state[1]
        if (
            temporary_world is not None
            and temporary_world.name.startswith(TEMP_PREFIX)
            and temporary_world.users == 0
        ):
            bpy.data.worlds.remove(temporary_world)
        bpy.context.view_layer.update()
        return False


def _set_visible(names):
    names = set(names)
    for obj in bpy.data.objects:
        if obj.type == "LIGHT" and not obj.name.startswith(TEMP_PREFIX):
            obj.hide_render = True
            obj.hide_viewport = True
            # Blender 5.2 can retain a hidden authored light in the Eevee
            # dependency graph for the current frame.  Zeroing its energy as
            # well makes the review rig independent of authored light state;
            # SceneStateGuard restores the exact value after the render.
            obj.data.energy = 0.0
        if obj.type in {"MESH", "CURVE", "FONT"} and not obj.name.startswith(TEMP_PREFIX):
            visible = obj.name in names
            obj.hide_render = not visible
            obj.hide_viewport = not visible
            if visible:
                for collection in obj.users_collection:
                    collection.hide_render = False
                    collection.hide_viewport = False
                    for _view_layer in bpy.context.scene.view_layers:
                        def enable_path(node):
                            found = node.collection == collection
                            for child in node.children:
                                found = enable_path(child) or found
                            if found:
                                node.exclude = False
                                node.hide_viewport = False
                            return found
                        enable_path(_view_layer.layer_collection)


def _model_point(matrix, point):
    return matrix @ Vector(point)


def _model_vector(matrix, vector):
    return matrix.to_3x3() @ Vector(vector)


def _look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def _link_temp(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _new_camera(name, location, target, ortho_scale):
    data = bpy.data.cameras.new(TEMP_PREFIX + name + "_data")
    data.type = "ORTHO"
    data.ortho_scale = ortho_scale
    data.lens = 55.0
    camera = _link_temp(bpy.data.objects.new(TEMP_PREFIX + name, data))
    camera.location = location
    _look_at(camera, target)
    bpy.context.scene.camera = camera
    return camera


def _new_area(name, location, target, energy, size, color):
    data = bpy.data.lights.new(TEMP_PREFIX + name + "_data", "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    light = _link_temp(bpy.data.objects.new(TEMP_PREFIX + name, data))
    light.location = location
    _look_at(light, target)
    return light


def _configure_scene(camera_location, target, ortho_scale):
    scene = bpy.context.scene
    engine_items = {
        item.identifier
        for item in scene.render.bl_rna.properties["engine"].enum_items
    }
    scene.render.engine = (
        "BLENDER_EEVEE_NEXT"
        if "BLENDER_EEVEE_NEXT" in engine_items
        else "BLENDER_EEVEE"
    )
    scene.render.resolution_x, scene.render.resolution_y = RENDER_SIZE
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = 1.0
    scene.render.pixel_aspect_y = 1.0
    scene.render.use_border = False
    scene.render.use_crop_to_border = False
    scene.render.border_min_x = 0.0
    scene.render.border_max_x = 1.0
    scene.render.border_min_y = 0.0
    scene.render.border_max_y = 1.0
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 40
    scene.render.use_file_extension = True
    scene.render.use_overwrite = True
    scene.render.use_compositing = False
    scene.render.use_sequencer = False
    scene.render.image_settings.color_management = "FOLLOW_SCENE"
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    scene.view_settings.exposure = 0.5
    scene.view_settings.gamma = 1.0
    if scene.world is None:
        scene.world = bpy.data.worlds.new(TEMP_PREFIX + "world")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.035, 0.045, 0.06, 1.0)
    background.inputs["Strength"].default_value = 0.32

    camera = _new_camera("camera", camera_location, target, ortho_scale)
    direction = Vector(camera_location) - Vector(target)
    right = direction.cross(Vector((0.0, 0.0, 1.0))).normalized()
    up = right.cross(direction).normalized()
    _new_area(
        "key",
        Vector(target) + right * -4.5 + up * 4.0 - direction.normalized() * 2.0,
        target,
        1050.0,
        4.0,
        (1.0, 0.88, 0.72),
    )
    _new_area(
        "fill",
        Vector(target) + right * 4.5 + up * 1.0 - direction.normalized() * 1.0,
        target,
        720.0,
        5.0,
        (0.65, 0.78, 1.0),
    )
    _new_area(
        "rim",
        Vector(target) - direction.normalized() * -5.0 + up * 3.0,
        target,
        900.0,
        3.0,
        (0.82, 0.9, 1.0),
    )
    scene.camera = camera


def _duplicate(source, suffix):
    duplicate = source.copy()
    duplicate.data = source.data.copy()
    duplicate.name = TEMP_PREFIX + suffix
    _link_temp(duplicate)
    duplicate.hide_render = False
    duplicate.hide_viewport = False
    return duplicate


def _box_mesh(name, bounds, matrix):
    xmin, xmax, ymin, ymax, zmin, zmax = bounds
    vertices = [
        (x, y, z)
        for z in (zmin, zmax)
        for y in (ymin, ymax)
        for x in (xmin, xmax)
    ]
    faces = (
        (0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1),
        (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3),
    )
    mesh = bpy.data.meshes.new(TEMP_PREFIX + name + "_mesh")
    mesh.from_pydata(vertices, (), faces)
    mesh.update()
    obj = _link_temp(bpy.data.objects.new(TEMP_PREFIX + name, mesh))
    obj.matrix_world = matrix.copy()
    obj.hide_render = True
    obj.hide_viewport = True
    return obj


def _section_duplicate(source, suffix, bounds):
    duplicate = _duplicate(source, suffix)
    cutter = _box_mesh(suffix + "_cutter", bounds, source.matrix_world)
    modifier = duplicate.modifiers.new(TEMP_PREFIX + "section", "BOOLEAN")
    modifier.operation = "INTERSECT"
    modifier.solver = "EXACT"
    modifier.object = cutter
    bpy.context.view_layer.objects.active = duplicate
    duplicate.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    duplicate.select_set(False)
    return duplicate


def _move_model(obj, model_offset, assembly_matrix=None):
    authority = assembly_matrix or bpy.data.objects["shell_front_embossed"].matrix_world
    matrix = obj.matrix_world.copy()
    matrix.translation += _model_vector(authority, model_offset)
    obj.matrix_world = matrix


def _render_assembled():
    visible = {
        obj.name
        for obj in bpy.data.objects
        if obj.type == "MESH" and obj.name != "Backdrop"
    }
    _set_visible(visible)
    assembly = bpy.data.objects["shell_front_embossed"].matrix_world
    target = _model_point(assembly, (45.0, 46.5, -2.0))
    camera = target + _model_vector(assembly, (-88.0, -104.0, -125.0))
    _configure_scene(camera, target, 7.2)


def _render_exploded():
    visible = {
        obj.name
        for obj in bpy.data.objects
        if obj.type == "MESH" and obj.name != "Backdrop"
    }
    _set_visible(visible)
    assembly = bpy.data.objects["shell_front_embossed"].matrix_world.copy()
    for name, offset in exploded_model_offsets().items():
        _move_model(bpy.data.objects[name], offset, assembly)
    target = _model_point(assembly, (45.0, 46.5, -10.0))
    camera = target + _model_vector(assembly, (108.0, -124.0, -128.0))
    _configure_scene(camera, target, 7.8)


def _render_h2_cutaway():
    _set_visible(H2_REQUIRED_OBJECTS - {"shell_front_embossed"})
    assembly = bpy.data.objects["shell_front_embossed"].matrix_world.copy()
    # Actual front-shell mesh, clipped to the lower-right H2/Reset/speaker
    # neighbourhood.  The cut object is temporary and the canonical shell is
    # never modified.
    _section_duplicate(
        bpy.data.objects["shell_front_embossed"],
        "h2_front_section",
        (45.0, 89.0, 3.0, 22.0, -6.5, 2.0),
    )
    # Pull the screw rearward on its true axis just enough that the seated
    # hex nut and cage mouth remain separately legible in the oblique view.
    _move_model(bpy.data.objects["screw_6"], (0.0, 0.0, -6.0), assembly)
    target = _model_point(assembly, (67.0, 12.0, -2.0))
    camera = target + _model_vector(assembly, (35.0, 80.0, -88.0))
    _configure_scene(camera, target, 3.65)


def _stage_closeup(site_index, site_xy, bounds, destination, nut_offset):
    assembly = bpy.data.objects["shell_front_embossed"].matrix_world.copy()
    source_center = _model_point(assembly, (site_xy[0], site_xy[1], -2.0))
    destination_world = _model_point(assembly, destination)
    stage_delta = destination_world - source_center

    section = _section_duplicate(
        bpy.data.objects["shell_front_embossed"],
        f"trap_{site_index}_section",
        bounds,
    )
    section.matrix_world.translation += stage_delta
    for kind in ("nut", "screw"):
        duplicate = _duplicate(
            bpy.data.objects[f"{kind}_{site_index}"],
            f"trap_{site_index}_{kind}",
        )
        duplicate.matrix_world.translation += stage_delta
        if kind == "nut":
            _move_model(duplicate, nut_offset, assembly)


def _render_trap_closeups():
    _set_visible(set())
    assembly = bpy.data.objects["shell_front_embossed"].matrix_world.copy()
    sys.path.insert(0, str(CASE_DIR))
    import nut_trap_sites

    offsets = closeup_nut_model_offsets(nut_trap_sites.sites())
    # Model y is already the once-mirrored layout y: site 1 -> 86.5, H2 -> 9.
    _stage_closeup(
        1,
        (6.0, 86.5),
        (0.0, 13.5, 79.5, 93.0, -6.5, 1.5),
        (27.0, 46.5, -2.0),
        offsets["nut_1"],
    )
    _stage_closeup(
        6,
        (64.5, 9.0),
        (57.0, 72.0, 1.5, 16.5, -6.5, 1.5),
        (63.0, 46.5, -2.0),
        offsets["nut_6"],
    )
    target = _model_point(assembly, (45.0, 46.5, -2.0))
    camera = target + _model_vector(assembly, (8.0, 92.0, -110.0))
    _configure_scene(camera, target, 2.65)


VIEW_SETUP = {
    "assembled": _render_assembled,
    "exploded": _render_exploded,
    "h2_cutaway": _render_h2_cutaway,
    "trap_closeups": _render_trap_closeups,
}


def render_view(view, output_path, inject_failure=False):
    before = _scene_signature()
    try:
        with SceneStateGuard():
            VIEW_SETUP[view]()
            if view == "h2_cutaway":
                clearance, framed, *_points = _h2_projected_clearance()
                if not framed or clearance < H2_MIN_PROJECTED_SEPARATION_PX:
                    raise ReviewFailure(
                        f"ordinary H2 render failed projection gate: "
                        f"{clearance:.1f} px, framed={framed}"
                    )
            bpy.context.scene.render.filepath = str(output_path)
            if inject_failure:
                raise RuntimeError("injected render failure")
            bpy.ops.render.render(write_still=True)
    finally:
        after = _scene_signature()
        if after != before:
            raise ReviewFailure(f"{view} contaminated canonical Blender state")
    normalize_png(output_path)


def _publish_transactionally(staging_dir, output_dir, filenames):
    output_dir.mkdir(parents=True, exist_ok=True)
    backup_dir = staging_dir.parent / "backup"
    backup_dir.mkdir()
    published = []
    backed_up = []
    try:
        for filename in filenames:
            destination = output_dir / filename
            if destination.exists():
                os.replace(destination, backup_dir / filename)
                backed_up.append(filename)
            os.replace(staging_dir / filename, destination)
            published.append(filename)
    except Exception:
        for filename in published:
            destination = output_dir / filename
            if destination.exists():
                destination.unlink()
        for filename in backed_up:
            os.replace(backup_dir / filename, output_dir / filename)
        raise


def _self_test_state_restore():
    bpy.ops.object.select_all(action="DESELECT")
    bpy.data.objects["cap_reset"].select_set(True)
    bpy.data.objects["speaker"].select_set(True)
    bpy.context.view_layer.objects.active = bpy.data.objects["cap_reset"]
    before = _scene_signature()
    caught = False
    try:
        render_view(
            "h2_cutaway",
            Path("/tmp/injected-render-failure.png"),
            inject_failure=True,
        )
    except RuntimeError as error:
        caught = str(error) == "injected render failure"
    after = _scene_signature()
    if not caught or after != before:
        changed = sorted(key for key in before if before[key] != after[key])
        if before["objects"] != after["objects"]:
            object_changes = sorted(
                name
                for name in set(before["objects"]) | set(after["objects"])
                if before["objects"].get(name) != after["objects"].get(name)
            )
            changed.append("object names=" + ",".join(object_changes))
        raise ReviewFailure(
            "injected render failure did not restore canonical state: "
            + ", ".join(changed)
        )
    print(
        "PASS real H2 setup failure restored selection, active object, "
        "and canonical state"
    )


def _h2_projected_clearance():
    from bpy_extras.object_utils import world_to_camera_view

    bpy.context.view_layer.update()
    scene = bpy.context.scene
    camera = scene.camera
    cap = bpy.data.objects["cap_reset"]
    screw = bpy.data.objects["screw_6"]
    cap_bounds = _local_bounds(cap)
    screw_bounds = _local_bounds(screw)
    cap_world = cap.matrix_world @ Vector((
        (cap_bounds[0] + cap_bounds[1]) / 2.0,
        (cap_bounds[2] + cap_bounds[3]) / 2.0,
        (cap_bounds[4] + cap_bounds[5]) / 2.0,
    ))
    screw_x = (screw_bounds[0] + screw_bounds[1]) / 2.0
    screw_y = (screw_bounds[2] + screw_bounds[3]) / 2.0
    axis_world = (
        screw.matrix_world @ Vector((screw_x, screw_y, screw_bounds[4])),
        screw.matrix_world @ Vector((screw_x, screw_y, screw_bounds[5])),
    )

    def project(point):
        ndc = world_to_camera_view(scene, camera, point)
        return Vector((ndc.x * RENDER_SIZE[0], (1.0 - ndc.y) * RENDER_SIZE[1])), ndc.z

    cap_pixel, cap_depth = project(cap_world)
    axis_pixels = [project(point) for point in axis_world]
    start, end = axis_pixels[0][0], axis_pixels[1][0]
    segment = end - start
    denominator = segment.length_squared
    parameter = 0.0 if denominator == 0.0 else max(
        0.0, min(1.0, (cap_pixel - start).dot(segment) / denominator)
    )
    clearance = (cap_pixel - (start + parameter * segment)).length
    points = [(cap_pixel, cap_depth), *axis_pixels]
    framed = all(
        0.0 <= pixel.x <= RENDER_SIZE[0]
        and 0.0 <= pixel.y <= RENDER_SIZE[1]
        and depth > 0.0
        for pixel, depth in points
    )
    return clearance, framed, tuple(cap_pixel), tuple(start), tuple(end)


def _self_test_h2_projection():
    before = _scene_signature()
    with SceneStateGuard():
        _render_h2_cutaway()
        clearance, framed, cap_pixel, axis_start, axis_end = _h2_projected_clearance()
        if not framed:
            raise ReviewFailure(
                f"H2 Reset/screw projection is cropped: cap={cap_pixel!r}, "
                f"axis={axis_start!r}->{axis_end!r}"
            )
        if clearance < H2_MIN_PROJECTED_SEPARATION_PX:
            raise ReviewFailure(
                f"H2 Reset-to-screw-axis projection is only {clearance:.1f} px; "
                f"requires {H2_MIN_PROJECTED_SEPARATION_PX:.1f} px"
            )
    if _scene_signature() != before:
        raise ReviewFailure("H2 projection self-test contaminated canonical state")
    print(
        f"PASS H2 projection: cap_reset center to screw_6 axis {clearance:.1f} px, "
        f"both framed; cap_reset={cap_pixel!r}, "
        f"screw_6 axis={axis_start!r}->{axis_end!r}"
    )


def _arguments(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--view", choices=tuple(OUTPUTS))
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--self-test-state-restore", action="store_true")
    parser.add_argument("--self-test-h2-projection", action="store_true")
    parser.add_argument("--inject-failure-view", choices=tuple(OUTPUTS), help=argparse.SUPPRESS)
    return parser.parse_args(argv)


def main(argv=None):
    args = _arguments(argv)
    _preflight()
    if args.preflight_only:
        print("PASS captive-nut review preflight")
        return
    if args.self_test_state_restore:
        _self_test_state_restore()
        return
    if args.self_test_h2_projection:
        _self_test_h2_projection()
        return
    views = (args.view,) if args.view else tuple(OUTPUTS)
    args.output_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=".captive-nut-review-", dir=args.output_dir.parent
    ) as transaction:
        staging_dir = Path(transaction) / "staging"
        staging_dir.mkdir()
        for view in views:
            output = staging_dir / OUTPUTS[view]
            render_view(view, output, inject_failure=view == args.inject_failure_view)
        filenames = {OUTPUTS[view] for view in views}
        validate_review_set(staging_dir, filenames, RENDER_SIZE)
        _publish_transactionally(staging_dir, args.output_dir, sorted(filenames))
    for view in views:
        print(f"PASS rendered {view}: {args.output_dir / OUTPUTS[view]}")
    print(f"PASS rendered {len(views)} captive-nut review views")


if __name__ == "__main__":
    arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    main(arguments)
