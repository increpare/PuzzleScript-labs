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

    def test_texture_uses_printable_depth_and_covers_the_rear_field(self):
        self.assertEqual(P.REAR_TEX_DEPTH, 0.30)
        bb = bounds(self.texture)
        self.assertLessEqual(bb.xmin, P.REAR_TEX_MARGIN + 0.05)
        self.assertGreaterEqual(bb.xmax, P.BODY_W - P.REAR_TEX_MARGIN - 0.05)
        self.assertLessEqual(bb.ymin, P.REAR_TEX_MARGIN + 0.05)
        self.assertGreaterEqual(bb.ymax, P.BODY_H - P.REAR_TEX_MARGIN - 0.05)
        self.assertGreater(bb.zlen, P.DECK_H + P.REAR_TEX_DEPTH - 0.1)

    def test_texture_exists_in_multiple_vertical_bands_not_one_stripe(self):
        z0 = -P.DECK_ZONE_T - 2.0
        for y in (15.0, 35.0, 55.0, 75.0):
            slab = (
                cq.Workplane("XY")
                .box(P.BODY_W + 2.0, 5.0, P.DECK_ZONE_T + 4.0,
                     centered=(False, True, False))
                .translate((-1.0, y, z0))
            )
            with self.subTest(y=y):
                self.assertGreater(volume(self.texture.intersect(slab)), 0.05)

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
