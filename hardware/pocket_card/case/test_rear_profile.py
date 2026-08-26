import os
import sys
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import params as P  # noqa: E402
import checks  # noqa: E402
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
        self.assertEqual(
            side_arc.rear_deck_extra_at(P.DECK_RISE_Y0),
            0.0,
        )

    def test_full_depth_contains_plug_and_wall_allowance(self):
        plug_y0 = P.DISPLAY_PLUG_Y - P.DISPLAY_PLUG_BODY_W / 2
        plug_y1 = P.DISPLAY_PLUG_Y + P.DISPLAY_PLUG_BODY_W / 2
        allowance = P.DISPLAY_PLUG_CLEAR + P.WALL
        self.assertLessEqual(P.DECK_PLATEAU_Y0, plug_y0 - allowance)
        self.assertGreaterEqual(P.DECK_PLATEAU_Y1, plug_y1 + allowance)
        self.assertEqual(
            side_arc.rear_deck_extra_at(P.DISPLAY_PLUG_Y),
            P.DECK_H,
        )

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
    def test_centreline_has_thin_top_full_plug_depth_and_lower_return(self):
        x = P.BODY_W / 2
        z_top = side_arc.outer_back_z_at(x, 24.0)
        z_plug = side_arc.outer_back_z_at(x, P.DISPLAY_PLUG_Y)
        z_lower = side_arc.outer_back_z_at(x, 70.0)
        self.assertAlmostEqual(z_top, -P.BODY_T, delta=0.03)
        self.assertAlmostEqual(z_plug, -P.DECK_ZONE_T, delta=0.03)
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
             -P.DECK_ZONE_T],
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


if __name__ == "__main__":
    unittest.main()
