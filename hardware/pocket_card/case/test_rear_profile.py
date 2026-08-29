import math
import os
import struct
import sys
import tempfile
import unittest
from unittest import mock

import cadquery as cq
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import params as P  # noqa: E402
import build_variants  # noqa: E402
import checks  # noqa: E402
import shell_back  # noqa: E402
import side_arc  # noqa: E402


class DisplayPlugPlacementTest(unittest.TestCase):
    def test_plug_matches_complete_blend_assembly_coordinates(self):
        bounds = (
            P.DISPLAY_PLUG_X - P.DISPLAY_PLUG_BODY_L / 2,
            P.DISPLAY_PLUG_X + P.DISPLAY_PLUG_BODY_L / 2,
            P.DISPLAY_PLUG_Y - P.DISPLAY_PLUG_BODY_W / 2,
            P.DISPLAY_PLUG_Y + P.DISPLAY_PLUG_BODY_W / 2,
        )
        measured = (34.5476, 42.1976, 41.2781, 44.8781)
        for got, want in zip(bounds, measured):
            self.assertAlmostEqual(got, want, delta=0.06)

    def test_plug_is_at_display_lower_edge(self):
        self.assertGreaterEqual(
            P.DISPLAY_PLUG_Y,
            P.MOD_Y + 0.75 * P.MOD_H,
        )


class RearDeckProfileTest(unittest.TestCase):
    def sample(self, y0, y1, count=101):
        return [
            side_arc.rear_deck_extra_at(y0 + (y1 - y0) * i / (count - 1))
            for i in range(count)
        ]

    def test_top_is_normal_depth(self):
        self.assertEqual(side_arc.rear_deck_extra_at(0.0), 0.0)
        self.assertEqual(side_arc.rear_deck_extra_at(11.0), 0.0)
        self.assertEqual(side_arc.rear_deck_extra_at(30.0), 0.0)
        self.assertEqual(
            side_arc.rear_deck_extra_at(P.DECK_RISE_Y0),
            0.0,
        )

    def test_broad_bump_translates_five_mm_south(self):
        reference_phi = math.radians(P.DECK_RISE_REFERENCE_PHI)
        reference_radius = P.DECK_H / (
            2 * (1 - math.cos(reference_phi))
        )
        reference_run = 2 * reference_radius * math.sin(reference_phi)
        required_plug_y0 = (
            P.DISPLAY_PLUG_Y - P.DISPLAY_PLUG_BODY_W / 2
            - P.DISPLAY_PLUG_CLEAR - P.WALL
        )
        required_plug_y1 = (
            P.DISPLAY_PLUG_Y + P.DISPLAY_PLUG_BODY_W / 2
            + P.DISPLAY_PLUG_CLEAR + P.WALL
        )
        previous_rise_y0 = required_plug_y0 - reference_run

        self.assertAlmostEqual(P.DECK_BUMP_SHIFT_Y, 5.0, places=6)
        self.assertAlmostEqual(
            P.DECK_RISE_Y0,
            previous_rise_y0 + P.DECK_BUMP_SHIFT_Y,
            places=9,
        )
        self.assertAlmostEqual(
            P.DECK_PLATEAU_Y1,
            required_plug_y1 + P.DECK_BUMP_SHIFT_Y,
            places=9,
        )
        self.assertAlmostEqual(P.DECK_RISE_Y0, 31.9811703617, places=9)
        self.assertAlmostEqual(P.DECK_RISE_RUN, reference_run, places=9)
        self.assertAlmostEqual(P.DECK_RISE_RUN, 12.3469296383, places=9)
        self.assertAlmostEqual(P.DECK_RISE_PHI, 22.0, places=6)
        self.assertAlmostEqual(
            P.DECK_PLATEAU_Y0,
            required_plug_y0 + P.DECK_BUMP_SHIFT_Y,
            places=9,
        )
        self.assertAlmostEqual(P.DECK_PLATEAU_Y0, 44.3281, places=4)
        self.assertAlmostEqual(P.DECK_PLATEAU_Y1, 51.8281, places=4)
        self.assertEqual(P.DECK_TAPER_Y0, P.DECK_PLATEAU_Y1)
        self.assertEqual(P.DECK_TAPER_Y1, P.BODY_H)

    def test_display_plug_does_not_anchor_the_broad_crest(self):
        depth = side_arc.rear_deck_extra_at(P.DISPLAY_PLUG_Y)
        self.assertLess(depth, P.DECK_H)
        self.assertAlmostEqual(depth, 2.3525252734, places=9)

    def test_rise_and_taper_are_monotonic(self):
        rise = self.sample(P.DECK_RISE_Y0, P.DECK_PLATEAU_Y0)
        taper = self.sample(P.DECK_PLATEAU_Y1, P.BODY_H)
        self.assertTrue(all(a <= b + 1e-9 for a, b in zip(rise, rise[1:])))
        self.assertTrue(all(a + 1e-9 >= b for a, b in zip(taper, taper[1:])))

    def test_bottom_is_normal_depth(self):
        self.assertEqual(side_arc.rear_deck_extra_at(P.BODY_H), 0.0)
        self.assertEqual(side_arc.rear_deck_extra_at(P.BODY_H + 1.0), 0.0)

    def test_existing_maximum_depth_is_not_exceeded(self):
        values = self.sample(0.0, P.BODY_H, count=501)
        self.assertGreater(max(values), 0.0)
        self.assertLessEqual(max(values), P.DECK_H + 1e-9)


class RearDeckEnvelopeTest(unittest.TestCase):
    def test_centreline_has_thin_top_translated_plug_depth_and_lower_return(self):
        x = P.BODY_W / 2
        z_top = side_arc.outer_back_z_at(x, 24.0)
        z_broad_at_plug_y = side_arc.outer_back_z_at(x, P.DISPLAY_PLUG_Y)
        z_plug = side_arc.outer_back_z_at(
            P.DISPLAY_PLUG_X,
            P.DISPLAY_PLUG_Y,
        )
        z_lower = side_arc.outer_back_z_at(x, 70.0)
        self.assertAlmostEqual(z_top, -P.BODY_T, delta=0.03)
        expected_plug_z = -(
            P.BODY_T + side_arc.rear_deck_extra_at(P.DISPLAY_PLUG_Y)
        )
        self.assertAlmostEqual(z_plug, expected_plug_z, delta=0.01)
        self.assertAlmostEqual(z_broad_at_plug_y, z_plug, delta=0.01)
        self.assertGreater(z_lower, z_plug)
        self.assertLess(z_lower, z_top)


class RearDeckCheckContractTest(unittest.TestCase):
    def test_back_shell_check_reads_the_canonical_order_stl(self):
        self.assertEqual(
            checks.back_shell_stl_path(),
            os.path.join(HERE, "out", "order", "shell_back.stl"),
        )

    def test_vertex_allowance_is_evaluated_at_each_layout_y(self):
        # Both vertices are shallower than the deck's global maximum.  The
        # first is nevertheless illegal because it sits in the normal-depth
        # upper screen region; a global z-min check cannot catch that.
        vertices = np.array([
            [P.BODY_W / 2, P.BODY_H - 24.0, -P.BODY_T - 0.05],
            [P.BODY_W / 2, P.BODY_H - P.DISPLAY_PLUG_Y,
             -P.BODY_T - side_arc.rear_deck_extra_at(P.DISPLAY_PLUG_Y)],
        ])
        bad = checks.back_shell_vertex_violations(vertices)
        self.assertEqual(len(bad), 1)
        self.assertAlmostEqual(bad[0][0], 24.0)

    def test_transition_sampler_covers_rise_and_taper_at_point_one_mm(self):
        rise = checks.rear_deck_transition_metrics(
            P.DECK_RISE_Y0, P.DECK_PLATEAU_Y0, increasing=True)
        taper = checks.rear_deck_transition_metrics(
            P.DECK_PLATEAU_Y1, P.DECK_TAPER_Y1, increasing=False)

        self.assertAlmostEqual(rise["step"], 0.1)
        self.assertAlmostEqual(taper["step"], 0.1)
        self.assertTrue(rise["monotonic"])
        self.assertTrue(taper["monotonic"])
        self.assertLessEqual(rise["max_slope_deg"], P.DECK_RISE_PHI + 0.5)
        self.assertLessEqual(taper["max_slope_deg"], P.DECK_TAPER_PHI + 0.5)
        self.assertAlmostEqual(rise["start_depth"], 0.0, places=7)
        self.assertAlmostEqual(rise["end_depth"], P.DECK_H, places=7)
        self.assertAlmostEqual(taper["start_depth"], P.DECK_H, places=7)
        self.assertAlmostEqual(taper["end_depth"], 0.0, places=7)

    def test_full_width_surface_scan_includes_rolled_sides_on_rise(self):
        metrics = checks.rear_deck_surface_transition_metrics(
            P.DECK_RISE_Y0,
            P.DECK_PLATEAU_Y0,
            increasing=True,
            slope_limit_deg=P.DECK_RISE_PHI + 0.5,
        )
        self.assertLess(metrics["min_sampled_x"], P.BACK_ROLL_SIDE)
        self.assertGreater(
            metrics["max_sampled_x"],
            P.BODY_W - P.BACK_ROLL_SIDE,
        )
        self.assertTrue(metrics["monotonic"])
        self.assertTrue(metrics["continuous"])
        self.assertLessEqual(
            metrics["max_slope_deg"], P.DECK_RISE_PHI + 0.5)

    def test_full_width_surface_scan_covers_taper_before_bottom_corners(self):
        y1 = P.BODY_H - P.CASE_BOTTOM_R
        metrics = checks.rear_deck_surface_transition_metrics(
            P.DECK_PLATEAU_Y1,
            y1,
            increasing=False,
            slope_limit_deg=P.DECK_TAPER_PHI + 0.5,
        )
        self.assertEqual(metrics["end_y"], y1)
        self.assertLess(metrics["min_sampled_x"], P.BACK_ROLL_SIDE)
        self.assertGreater(
            metrics["max_sampled_x"],
            P.BODY_W - P.BACK_ROLL_SIDE,
        )
        self.assertTrue(metrics["monotonic"])
        self.assertTrue(metrics["continuous"])
        self.assertLessEqual(
            metrics["max_slope_deg"], P.DECK_TAPER_PHI + 0.5)


class PublishedRearShellArtifactsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fresh = shell_back.build_back().val()
        cls.fresh_volume = cls.fresh.Volume()
        bb = cls.fresh.BoundingBox()
        cls.fresh_bounds = (bb.xlen, bb.ylen, bb.zlen)

    def assert_bounds_match_generator(self, bounds, label):
        for actual, expected, axis in zip(bounds, self.fresh_bounds, "XYZ"):
            self.assertAlmostEqual(
                actual, expected, delta=0.02,
                msg=f"{label}: {axis} bound differs from current generator",
            )

    def assert_stl_matches_generator(self, path):
        with open(path, "rb") as handle:
            data = handle.read()
        triangle_count = struct.unpack("<I", data[80:84])[0]
        triangles = np.array([
            struct.unpack_from("<12f", data, 84 + index * 50)[3:12]
            for index in range(triangle_count)
        ]).reshape(triangle_count, 3, 3)
        self.assertGreater(len(triangles), 0, f"{path}: empty STL")
        vertices = triangles.reshape(-1, 3)
        self.assert_bounds_match_generator(
            tuple(vertices.max(axis=0) - vertices.min(axis=0)), path)

        # A published shell must be one closed triangle manifold. Quantising
        # only joins the duplicate per-facet coordinates emitted by binary STL.
        _, inverse = np.unique(
            np.round(vertices, decimals=5), axis=0, return_inverse=True)
        faces = inverse.reshape(-1, 3)
        edges = np.sort(np.concatenate((
            faces[:, (0, 1)], faces[:, (1, 2)], faces[:, (2, 0)],
        )), axis=1)
        _, edge_counts = np.unique(edges, axis=0, return_counts=True)
        self.assertTrue(
            np.all(edge_counts == 2),
            f"{path}: STL is not one closed two-manifold shell",
        )

        volume = abs(np.einsum(
            "ij,ij->i", triangles[:, 0],
            np.cross(triangles[:, 1], triangles[:, 2]),
        ).sum() / 6.0)
        # Faceted STL integration differs slightly from OCC's analytic volume,
        # but the former top blister differs by over 100 mm^3. Thirty mm^3
        # admits normal tessellation error while still rejecting stale geometry.
        self.assertAlmostEqual(
            volume, self.fresh_volume, delta=30.0,
            msg=f"{path}: STL volume differs from current shell_back.build_back()",
        )
        violations = checks.back_shell_vertex_violations(vertices)
        self.assertEqual(
            len(violations), 0,
            f"{path}: {len(violations)} vertices violate the lower-deck profile",
        )

    def assert_step_matches_generator(self, path):
        imported = cq.importers.importStep(path)
        solids = imported.solids().vals()
        self.assertEqual(len(solids), 1, f"{path}: expected one STEP solid")
        bb = solids[0].BoundingBox()
        self.assert_bounds_match_generator((bb.xlen, bb.ylen, bb.zlen), path)
        self.assertAlmostEqual(
            solids[0].Volume(), self.fresh_volume, delta=0.2,
            msg=f"{path}: STEP volume differs from current shell_back.build_back()",
        )
        vertices, _ = solids[0].tessellate(0.1)
        vertex_array = np.array([[v.x, v.y, v.z] for v in vertices])
        violations = checks.back_shell_vertex_violations(vertex_array)
        self.assertEqual(
            len(violations), 0,
            f"{path}: {len(violations)} vertices violate the lower-deck profile",
        )

    def test_all_four_published_rear_shells_match_current_generator(self):
        paths = (
            os.path.join(HERE, "out", "shell_back.stl"),
            os.path.join(HERE, "out", "shell_back.step"),
            os.path.join(HERE, "out", "order", "shell_back.stl"),
            os.path.join(HERE, "out", "order", "shell_back.step"),
        )
        for path in paths:
            with self.subTest(path=path):
                self.assertTrue(os.path.isfile(path), f"missing published shell: {path}")
                if path.endswith(".stl"):
                    self.assert_stl_matches_generator(path)
                else:
                    self.assert_step_matches_generator(path)

    def test_shared_export_contract_enumerates_all_four_published_aliases(self):
        paths_helper = getattr(shell_back, "published_rear_shell_paths", None)
        self.assertTrue(
            callable(paths_helper),
            "shell_back must expose one shared published-artifact path contract",
        )
        self.assertEqual(paths_helper(), (
            os.path.join(HERE, "out", "shell_back.stl"),
            os.path.join(HERE, "out", "shell_back.step"),
            os.path.join(HERE, "out", "order", "shell_back.stl"),
            os.path.join(HERE, "out", "order", "shell_back.step"),
        ))

        back = object()
        with tempfile.TemporaryDirectory() as tmp:
            expected = (
                os.path.join(tmp, "shell_back.stl"),
                os.path.join(tmp, "shell_back.step"),
                os.path.join(tmp, "order", "shell_back.stl"),
                os.path.join(tmp, "order", "shell_back.step"),
            )
            with mock.patch.object(shell_back.cq.exporters, "export") as export:
                actual = shell_back.export_published_rear_shell(back, tmp)
        self.assertEqual(actual, expected)
        self.assertEqual(
            export.call_args_list,
            [mock.call(back, path) for path in expected],
        )

    def test_supported_variant_build_delegates_to_shared_rear_export(self):
        build_shells = getattr(build_variants, "build_shells", None)
        self.assertTrue(
            callable(build_shells),
            "build_variants must expose its supported shell-build step",
        )
        front = object()
        back = object()
        with (
            mock.patch.object(
                build_variants.shell_front, "build", return_value=front),
            mock.patch.object(
                build_variants.shell_back, "build_back", return_value=back),
            mock.patch.object(build_variants.cq.exporters, "export") as export,
            mock.patch.object(
                build_variants.shell_back,
                "export_published_rear_shell",
            ) as export_rear,
        ):
            actual_front, actual_back = build_shells()

        self.assertIs(actual_front, front)
        self.assertIs(actual_back, back)
        export.assert_called_once_with(
            front, os.path.join(build_variants.OUT, "shell_front.stl"))
        export_rear.assert_called_once_with(back)


if __name__ == "__main__":
    unittest.main()
