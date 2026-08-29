import os
import sys
import unittest

import cadquery as cq

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import joints  # noqa: E402
import params as P  # noqa: E402
import shell_back  # noqa: E402


def volume(shape):
    return sum(solid.Volume() for solid in shape.solids().vals())


def bounds(shape):
    solids = shape.solids().vals()
    return cq.Compound.makeCompound(solids).BoundingBox()


class RearTextureContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.texture = shell_back.rear_texture_cutters()

    def test_texture_uses_printable_depth_and_matches_legacy_partial_band(self):
        self.assertEqual(P.REAR_TEX_DEPTH, 0.30)
        bb = bounds(self.texture)
        # The measured flat cutter crossed the nominal silhouette; projecting
        # it through the real spherical side roll clips the first/last 0.60 mm.
        self.assertLessEqual(bb.xmin, 0.65)
        self.assertGreaterEqual(bb.xmax, P.BODY_W - 0.65)
        self.assertAlmostEqual(bb.ymin, P.REAR_TEX_Y0, delta=0.15)
        self.assertAlmostEqual(bb.ymax, P.REAR_TEX_Y1, delta=0.15)
        self.assertGreater(bb.zlen, P.DECK_H + P.REAR_TEX_DEPTH - 0.1)

    def test_texture_exists_only_in_the_legacy_vertical_band(self):
        z0 = -P.DECK_ZONE_T - 2.0
        for y in (50.0, 65.0, 78.0):
            slab = (
                cq.Workplane("XY")
                .box(P.BODY_W + 2.0, 5.0, P.DECK_ZONE_T + 4.0,
                     centered=(False, True, False))
                .translate((-1.0, y, z0))
            )
            with self.subTest(y=y):
                self.assertGreater(volume(self.texture.intersect(slab)), 0.05)

        for y in (15.0, 35.0, 90.0):
            slab = (
                cq.Workplane("XY")
                .box(P.BODY_W + 2.0, 5.0, P.DECK_ZONE_T + 4.0,
                     centered=(False, True, False))
                .translate((-1.0, y, z0))
            )
            with self.subTest(y=y):
                self.assertLess(volume(self.texture.intersect(slab)), 1e-5)

    def test_medallion_preserves_clear_ring_and_logo_negative(self):
        pattern = shell_back.rear_texture_pattern_prism()
        z0 = -P.DECK_ZONE_T - 1.0
        z_span = P.DECK_ZONE_T - P.BODY_T + 2.0

        outer = (
            cq.Workplane("XY")
            .workplane(offset=z0)
            .center(P.REAR_TEX_MEDALLION_X, P.REAR_TEX_MEDALLION_Y)
            .circle(P.REAR_TEX_MEDALLION_CLEAR_D / 2.0 - 0.15)
            .extrude(z_span)
        )
        inner = (
            cq.Workplane("XY")
            .workplane(offset=z0)
            .center(P.REAR_TEX_MEDALLION_X, P.REAR_TEX_MEDALLION_Y)
            .circle(P.REAR_TEX_MEDALLION_D / 2.0 + 0.15)
            .extrude(z_span)
        )
        annulus = outer.cut(inner)
        self.assertLess(volume(pattern.intersect(annulus)), 1e-5)

        medallion_witness = (
            cq.Workplane("XY")
            .workplane(offset=z0)
            .center(
                P.REAR_TEX_MEDALLION_X + 6.0,
                P.REAR_TEX_MEDALLION_Y,
            )
            .circle(0.35)
            .extrude(z_span)
        )
        self.assertGreater(volume(pattern.intersect(medallion_witness)), 0.05)
        self.assertLess(
            volume(pattern.intersect(shell_back.rear_texture_logo_prism())),
            1e-5,
        )

    def test_screw_head_seats_keep_a_smooth_texture_free_disc(self):
        z0 = -P.DECK_ZONE_T - 2.0
        keepout_r = joints.HEAD_D / 2.0 + P.REAR_TEX_SCREW_CLEAR
        for joint in joints.back_joints():
            keepout = (
                cq.Workplane("XY")
                .circle(keepout_r)
                .extrude(P.DECK_ZONE_T + 4.0)
                .translate((joint.x, joint.y, z0))
            )
            with self.subTest(site=(joint.x, joint.y)):
                self.assertLess(volume(self.texture.intersect(keepout)), 1e-5)

    def test_finished_back_is_valid_and_texture_removes_only_outer_skin(self):
        plain = shell_back.build_back(apply_rear_texture=False)
        textured = shell_back.build_back(apply_rear_texture=True)
        removed = plain.cut(textured)

        self.assertEqual(len(textured.solids().vals()), 1)
        self.assertLess(volume(textured), volume(plain))
        self.assertGreater(volume(removed), 5.0)
        self.assertLess(volume(removed), 500.0)


if __name__ == "__main__":
    unittest.main()
