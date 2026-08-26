"""Geometry contract for the role-specific Pocket Card button crowns."""
import shutil
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import cadquery as cq

import coupon
import params as P
import sculpted_buttons as sb
import sculpted_buttons_blender as sbb
from test_emboss_shells import (
    ROOT,
    author_preservation_sentinels,
    blender_bin,
    inspect_blend,
    run_bounded,
    sha256,
)


CASE = ROOT / "hardware/pocket_card/case"
COMPLETE = CASE / "out/order/pocket_card_complete.blend"
PREVIEW = CASE / "out/order/preview"
BLENDER_SCRIPT = CASE / "sculpted_buttons_blender.py"


def run_sculpted_replacement(source, buttons_dir, output):
    command = [
        blender_bin(), "--background", str(source),
        "--python-exit-code", "1", "--python", str(BLENDER_SCRIPT), "--",
        "--input", str(source), "--buttons-dir", str(buttons_dir),
        "--output", str(output),
    ]
    return run_bounded(command, "sculpted Blender replacement")


class SculptedButtonGeometryTest(unittest.TestCase):
    def test_blender_replacement_manifest_matches_every_role(self):
        self.assertEqual(sbb.BUTTON_NAMES, tuple(f"cap_{role}" for role in sb.ROLES))

    def test_export_writes_individual_model_space_parts_for_blender(self):
        with TemporaryDirectory() as tmp:
            written = {Path(path) for path in sb.export_prototype(tmp)}
            for role in sb.ROLES:
                for extension in ("stl", "step"):
                    expected = Path(tmp, "placed", f"cap_{role}.{extension}")
                    self.assertIn(expected, written)
                    self.assertGreater(expected.stat().st_size, 0)

    def test_every_role_matches_the_neutral_cap_below_the_outer_face(self):
        clip = (
            cq.Workplane("XY").workplane(offset=-10.0)
            .box(50, 50, 19.9998, centered=(True, True, True))
        )
        for role in sb.ROLES:
            with self.subTest(role=role):
                pill = role == "menu"
                diameter = None if pill else (
                    P.AB_CAP_D if role in ("undo", "action") else P.DIR_CAP_D
                )
                sculpted = sb.cap(role).intersect(clip).val().Volume()
                neutral = coupon.cap(
                    diameter, P.FIT_CLEAR, pill=pill
                ).intersect(clip).val().Volume()
                self.assertAlmostEqual(sculpted, neutral, places=4)

    def test_station_manifest_covers_every_role(self):
        self.assertEqual(tuple(st.role for st in sb.STATIONS), sb.ROLES)

    def test_every_role_is_one_valid_solid_with_the_shared_mechanical_depth(self):
        for role in sb.ROLES:
            with self.subTest(role=role):
                shape = sb.cap(role)
                self.assertEqual(len(shape.solids().vals()), 1)
                self.assertTrue(shape.val().isValid())
                expected_zmin = -(P.FACE_T + P.CAP_FLANGE_T)
                if role != "menu":
                    expected_zmin -= P.CAP_BOSS_GAP
                self.assertAlmostEqual(
                    shape.val().BoundingBox().zmin, expected_zmin, places=5
                )

    def test_direction_caps_keep_the_original_neutral_geometry(self):
        neutral = coupon.cap(P.DIR_CAP_D, P.FIT_CLEAR)
        for role in sb.DIRECTION_ROLES:
            with self.subTest(role=role):
                direction = sb.cap(role)
                self.assertAlmostEqual(
                    direction.cut(neutral).val().Volume(), 0.0, places=5
                )
                self.assertAlmostEqual(
                    neutral.cut(direction).val().Volume(), 0.0, places=5
                )

    def test_undo_is_a_deep_dish(self):
        shape = sb.cap("undo").val()
        z = sb.UNDO_RIM_H - sb.UNDO_DISH_DEPTH * 0.65
        self.assertFalse(shape.isInside(cq.Vector(0, 0, z), 1e-5))
        self.assertTrue(shape.isInside(
            cq.Vector(P.AB_CAP_D * 0.36, 0, z), 1e-5
        ))

    def test_action_is_convex_and_taller_than_undo(self):
        action = sb.cap("action").val()
        undo = sb.cap("undo").val()
        self.assertGreater(action.BoundingBox().zmax, undo.BoundingBox().zmax)
        self.assertLessEqual(sb.ACTION_APEX_H - sb.ACTION_EDGE_H, 0.55)
        self.assertTrue(action.isInside(
            cq.Vector(0, 0, sb.ACTION_APEX_H - 0.08), 1e-5
        ))
        self.assertFalse(action.isInside(
            cq.Vector(P.AB_CAP_D * 0.42, 0, sb.ACTION_APEX_H - 0.08),
            1e-5,
        ))

    def test_reset_is_the_lowest_round_cap(self):
        reset_h = sb.cap("reset").val().BoundingBox().zmax
        for role in (*sb.DIRECTION_ROLES, "undo", "action"):
            with self.subTest(role=role):
                self.assertLess(reset_h, sb.cap(role).val().BoundingBox().zmax)

    def test_menu_grooves_remove_material_from_the_crown(self):
        grooved = sb.cap("menu").val().Volume()
        plain = sb.cap("menu", menu_grooves=False).val().Volume()
        self.assertLess(grooved, plain)


class SculptedButtonBlenderIntegrationTest(unittest.TestCase):
    maxDiff = None

    def test_replacement_preserves_authored_button_objects_and_scene(self):
        with TemporaryDirectory() as tmp:
            temporary = Path(tmp)
            source = temporary / "authored_complete.blend"
            output = temporary / "sculpted_complete.blend"
            buttons_dir = temporary / "placed"
            buttons_dir.mkdir()
            shutil.copy2(COMPLETE, source)
            for name in sbb.BUTTON_NAMES:
                shutil.copy2(PREVIEW / f"{name}.stl", buttons_dir / f"{name}.stl")

            author_preservation_sentinels(source)
            source_hash = sha256(source)
            before = inspect_blend(source)

            result = run_sculpted_replacement(source, buttons_dir, output)
            self.assertEqual(result.returncode, 0, result.stdout)
            self.assertEqual(sha256(source), source_hash)
            after = inspect_blend(output)

            for key in (
                "collections", "collection_children", "objects", "materials",
                "transforms", "modifiers", "memberships", "world_matrices",
                "parents", "custom_properties", "display_transform",
                "display_material_count", "display_images", "scene", "world",
                "cameras", "lights", "relative_resources",
            ):
                self.assertEqual(after[key], before[key], key)

            for name, mesh_hash in before["mesh_hashes"].items():
                if name in sbb.BUTTON_NAMES:
                    self.assertNotEqual(after["mesh_hashes"][name], mesh_hash, name)
                    self.assertEqual(
                        after["mesh_data_names"][name], f"{name}_sculpted_mesh"
                    )
                else:
                    self.assertEqual(after["mesh_hashes"][name], mesh_hash, name)
                    self.assertEqual(
                        after["mesh_data_names"][name],
                        before["mesh_data_names"][name],
                        name,
                    )


if __name__ == "__main__":
    unittest.main()
