"""Geometry contract for the role-specific Pocket Card button crowns."""
import unittest

import cadquery as cq

import coupon
import params as P
import sculpted_buttons as sb


class SculptedButtonGeometryTest(unittest.TestCase):
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

    def test_station_manifest_covers_roles_and_directions_point_outward(self):
        self.assertEqual(tuple(st.role for st in sb.STATIONS), sb.ROLES)
        for station in sb.STATIONS:
            if station.role not in sb.DIRECTION_ROLES:
                continue
            dx = station.x - P.DIR_CX
            dy = station.y - P.DIR_CY
            ox, oy = sb.OUTWARD[station.role]
            self.assertGreater(dx * ox + dy * oy, 0.0)

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

    def test_direction_crowns_lean_toward_the_declared_outer_edge(self):
        sample_z = sb.DIRECTION_SHOULDER_H + 0.08
        for role in sb.DIRECTION_ROLES:
            with self.subTest(role=role):
                dx, dy = sb.OUTWARD[role]
                shape = sb.cap(role).val()
                outward = cq.Vector(dx * 1.9, dy * 1.9, sample_z)
                inward = cq.Vector(-dx * 1.9, -dy * 1.9, sample_z)
                self.assertTrue(shape.isInside(outward, 1e-5))
                self.assertFalse(shape.isInside(inward, 1e-5))

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


if __name__ == "__main__":
    unittest.main()
