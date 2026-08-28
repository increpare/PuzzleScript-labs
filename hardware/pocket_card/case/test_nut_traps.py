import math
import os
import sys
import unittest

import cadquery as cq


HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import params as P  # noqa: E402
import nut_traps  # noqa: E402


class NutTrapDefinitionTest(unittest.TestCase):
    def test_six_sites_have_approved_axes_and_loading_directions(self):
        self.assertEqual(
            [(s.x, s.y, s.kind, s.mouth) for s in nut_traps.sites()],
            [
                (6.0, 6.5, "module", (1, 1)),
                (6.0, 48.5, "module", (1, -1)),
                (84.0, 6.5, "module", (-1, 1)),
                (84.0, 48.5, "module", (-1, -1)),
                (64.5, 56.0, "pcb", (0, 1)),
                (64.5, 84.0, "pcb", (0, -1)),
            ],
        )

    def test_sites_are_derived_from_case_parameters(self):
        expected_module = (
            (P.MOD_X + P.MOUNT_INSET, P.MOD_Y + P.MOUNT_INSET),
            (P.MOD_X + P.MOUNT_INSET, P.MOD_Y + P.MOD_H - P.MOUNT_INSET),
            (P.MOD_X + P.MOD_W - P.MOUNT_INSET, P.MOD_Y + P.MOUNT_INSET),
            (
                P.MOD_X + P.MOD_W - P.MOUNT_INSET,
                P.MOD_Y + P.MOD_H - P.MOUNT_INSET,
            ),
        )
        sites = nut_traps.sites()
        self.assertEqual(tuple((s.x, s.y) for s in sites[:4]), expected_module)
        self.assertEqual(tuple((s.x, s.y) for s in sites[4:]), P.PCB_MOUNTS)

    def test_maximum_coupon_cavity_fits_the_conservative_envelope(self):
        self.assertAlmostEqual(
            nut_traps.cage_radius(4.5), 4.5 / math.sqrt(3.0) + 1.0
        )
        self.assertLessEqual(nut_traps.cage_radius(4.5), 3.6)

    def test_hex_corner_diameter_matches_across_flats(self):
        self.assertAlmostEqual(
            nut_traps.hex_corner_diameter(4.4), 2.0 * 4.4 / math.sqrt(3.0)
        )

    def test_controller_axial_stack_preserves_board_gap(self):
        used = P.NUT_CAVITY_T + P.NUT_ROOF_T
        available = P.PCB_FRONT_Z - P.FACE_T
        self.assertAlmostEqual(used, 2.8)
        self.assertAlmostEqual(available - used, 0.2)

    def test_site_planes_follow_the_front_face_and_axial_stack(self):
        for site in nut_traps.sites():
            with self.subTest(site=site):
                self.assertAlmostEqual(site.nut_front_z, -P.FACE_T)
                self.assertAlmostEqual(
                    site.cavity_back_z, -P.FACE_T - P.NUT_CAVITY_T
                )
                self.assertAlmostEqual(
                    site.roof_back_z,
                    -P.FACE_T - P.NUT_CAVITY_T - P.NUT_ROOF_T,
                )

    def test_invalid_site_and_dimensions_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "mouth"):
            nut_traps.NutTrapSite(0.0, 0.0, "module", (0, 0))
        with self.assertRaisesRegex(ValueError, "mouth"):
            nut_traps.NutTrapSite(0.0, 0.0, "module", (math.nan, 1))
        with self.assertRaisesRegex(ValueError, "mouth"):
            nut_traps.NutTrapSite(0.0, 0.0, "module", ("east", "north"))
        for function in (nut_traps.cage_radius, nut_traps.hex_corner_diameter):
            with self.subTest(function=function.__name__):
                with self.assertRaisesRegex(ValueError, "across_flats"):
                    function(0.0)
                with self.assertRaisesRegex(ValueError, "across_flats"):
                    function("wide")


def shape_volume(shape):
    return shape.val().Volume()


def thin_slab(z0, z1):
    return (
        cq.Workplane("XY")
        .box(300.0, 300.0, z1 - z0, centered=(True, True, False))
        .translate((45.0, 46.5, z0))
    )


class NutTrapSolidTest(unittest.TestCase):
    def test_all_public_geometry_outputs_are_valid(self):
        for site in nut_traps.sites():
            outputs = {
                "nut": nut_traps.nut_solid(site),
                "material": nut_traps.front_material(site),
                "voids": nut_traps.front_voids(site),
                "screw": nut_traps.screw_path(site, site.roof_back_z - 0.1),
                "sweep": nut_traps.insertion_sweep(site),
            }
            for name, output in outputs.items():
                with self.subTest(site=site, output=name):
                    self.assertTrue(output.val().isValid())
                    self.assertGreater(shape_volume(output), 0.0)

    def test_front_material_is_one_valid_positive_solid(self):
        for site in nut_traps.sites():
            material = nut_traps.front_material(site)
            with self.subTest(site=site):
                self.assertTrue(material.val().isValid())
                self.assertEqual(len(material.solids().vals()), 1)
                self.assertGreater(shape_volume(material), 1.0)
                bounds = material.val().BoundingBox()
                self.assertAlmostEqual(bounds.xlen, 2.0 * P.NUT_ENVELOPE_R)
                self.assertAlmostEqual(bounds.ylen, 2.0 * P.NUT_ENVELOPE_R)
                self.assertAlmostEqual(bounds.zmin, site.roof_back_z)
                self.assertAlmostEqual(bounds.zmax, site.nut_front_z + 0.1)

    def test_finished_isolated_trap_is_valid_and_nonempty(self):
        for site in nut_traps.sites():
            trap = nut_traps.front_material(site).cut(
                nut_traps.front_voids(site)
            )
            with self.subTest(site=site):
                self.assertTrue(trap.val().isValid())
                self.assertEqual(len(trap.solids().vals()), 1)
                self.assertGreater(shape_volume(trap), 1.0)

    def test_nominal_seated_nut_does_not_intersect_finished_trap(self):
        for site in nut_traps.sites():
            trap = nut_traps.front_material(site).cut(
                nut_traps.front_voids(site)
            )
            overlap = shape_volume(trap.intersect(nut_traps.nut_solid(site)))
            with self.subTest(site=site):
                self.assertLess(overlap, 1e-5)

    def test_real_side_insertion_sweep_is_clear(self):
        for site in nut_traps.sites():
            trap = nut_traps.front_material(site).cut(
                nut_traps.front_voids(site)
            )
            overlap = shape_volume(
                trap.intersect(nut_traps.insertion_sweep(site))
            )
            with self.subTest(site=site):
                self.assertLess(overlap, 1e-5)

    def test_insertion_sweep_begins_with_the_whole_nut_outside_the_cage(self):
        for site in nut_traps.sites():
            mouth_x, mouth_y = nut_traps._normalized_mouth(site)
            nut = nut_traps.nut_solid(site)
            sweep = nut_traps.insertion_sweep(site)

            def projections(shape):
                return [
                    (vertex.X - site.x) * mouth_x
                    + (vertex.Y - site.y) * mouth_y
                    for vertex in shape.vertices().vals()
                ]

            nut_projections = projections(nut)
            sweep_projections = projections(sweep)
            travel = max(sweep_projections) - max(nut_projections)
            starting_nut_nearest_point = travel + min(nut_projections)
            with self.subTest(site=site):
                self.assertGreater(
                    starting_nut_nearest_point,
                    P.NUT_ENVELOPE_R,
                )

    def test_blocking_the_throat_makes_the_insertion_sweep_collide(self):
        site = nut_traps.sites()[4]
        mouth_x, mouth_y = nut_traps._normalized_mouth(site)
        blocker_center = (
            site.x + 1.5 * mouth_x,
            site.y + 1.5 * mouth_y,
            site.cavity_back_z,
        )
        blocker = (
            cq.Workplane("XY")
            .box(
                P.NUT_THROAT_W,
                P.NUT_THROAT_W,
                P.NUT_CAVITY_T,
                centered=(True, True, False),
            )
            .translate(blocker_center)
        )
        blocked_path_overlap = shape_volume(
            blocker.intersect(nut_traps.insertion_sweep(site))
        )
        self.assertGreater(blocked_path_overlap, 1.0)

    def test_roof_and_outer_face_skin_have_nominal_thickness(self):
        for site in nut_traps.sites():
            with self.subTest(site=site):
                self.assertAlmostEqual(
                    site.cavity_back_z - site.roof_back_z, P.NUT_ROOF_T
                )
                self.assertAlmostEqual(
                    P.FACE_T - P.MACHINE_SCREW_TIP_RELIEF, 0.9
                )

    def test_voids_reach_the_intended_planes_without_opening_outer_face(self):
        for site in nut_traps.sites():
            voids = nut_traps.front_voids(site)
            bounds = voids.val().BoundingBox()
            with self.subTest(site=site):
                self.assertAlmostEqual(bounds.zmin, site.roof_back_z - 0.1)
                self.assertAlmostEqual(
                    bounds.zmax,
                    site.nut_front_z + P.MACHINE_SCREW_TIP_RELIEF,
                )
                self.assertLess(bounds.zmax, 0.0)
                cavity_back_slice = voids.intersect(
                    thin_slab(site.cavity_back_z, site.cavity_back_z + 0.05)
                )
                inside_face_slice = voids.intersect(
                    thin_slab(site.nut_front_z, site.nut_front_z + 0.05)
                )
                outer_face_slice = voids.intersect(thin_slab(-0.5, -0.45))
                self.assertGreater(shape_volume(cavity_back_slice), 0.1)
                self.assertGreater(shape_volume(inside_face_slice), 0.1)
                self.assertLess(shape_volume(outer_face_slice), 1e-8)

    def test_invalid_public_geometry_inputs_are_rejected(self):
        site = nut_traps.sites()[0]
        for function in (
            nut_traps.nut_solid,
            nut_traps.front_voids,
            nut_traps.insertion_sweep,
        ):
            with self.subTest(function=function.__name__):
                with self.assertRaisesRegex(ValueError, "across_flats"):
                    function(site, across_flats=-1.0)
        with self.assertRaisesRegex(ValueError, "thickness"):
            nut_traps.nut_solid(site, thickness=0.0)
        with self.assertRaisesRegex(ValueError, "z_back"):
            nut_traps.screw_path(
                site,
                site.nut_front_z + P.MACHINE_SCREW_TIP_RELIEF,
            )
        with self.assertRaisesRegex(ValueError, "z_back"):
            nut_traps.screw_path(site, "behind")


if __name__ == "__main__":
    unittest.main()
