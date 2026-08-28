import csv
import math
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import export_smt  # noqa: E402
import joints  # noqa: E402
import nut_traps  # noqa: E402
import shell_back  # noqa: E402


class MachineScrewGeometrySelectionTest(unittest.TestCase):
    def test_known_profile_selects_twelve_mm_at_shallowest_valid_seat(self):
        geometry = joints.select_machine_screw(
            outer_back_z=-15.386,
            nut_front_z=-1.5,
        )

        self.assertEqual(geometry.length, 12.0)
        self.assertAlmostEqual(geometry.seat_depth, 2.086)
        self.assertAlmostEqual(geometry.tip_protrusion, 0.2)

    def test_shortest_stock_and_seat_boundaries_are_inclusive(self):
        minimum = joints.select_machine_screw(-10.8, -1.5)
        maximum = joints.select_machine_screw(-11.4, -1.5)

        self.assertEqual(minimum.length, 8.0)
        self.assertAlmostEqual(minimum.seat_depth, 1.5)
        self.assertAlmostEqual(minimum.tip_protrusion, 0.2)
        self.assertEqual(maximum.length, 8.0)
        self.assertAlmostEqual(maximum.seat_depth, 2.1)
        self.assertAlmostEqual(maximum.tip_protrusion, 0.2)

    def test_stock_order_does_not_change_shortest_valid_choice(self):
        geometry = joints.select_machine_screw(
            -10.8,
            -1.5,
            stocked_lengths=(14.0, 10.0, 8.0, 12.0),
        )

        self.assertEqual(geometry.length, 8.0)
        self.assertAlmostEqual(geometry.seat_depth, 1.5)

    def test_invalid_ranges_and_stock_fail_clearly(self):
        invalid_calls = (
            ({"outer_back_z": math.nan}, "outer_back_z must be finite"),
            ({"outer_back_z": -10.8, "stocked_lengths": ()},
             "no stocked machine screw"),
            ({"outer_back_z": -10.8, "stocked_lengths": (8.0, math.inf)},
             "stocked screw lengths must be positive finite"),
            ({"outer_back_z": -10.8, "min_seat_depth": 2.2,
              "max_seat_depth": 2.1}, "seat depth range"),
            ({"outer_back_z": -10.8, "min_tip_protrusion": 0.7,
              "max_tip_protrusion": 0.6}, "tip protrusion range"),
        )
        for kwargs, message in invalid_calls:
            with self.subTest(kwargs=kwargs):
                with self.assertRaisesRegex(ValueError, message):
                    joints.select_machine_screw(**kwargs)

    def test_unsatisfiable_stock_fails_clearly(self):
        with self.assertRaisesRegex(ValueError, "no stocked machine screw"):
            joints.select_machine_screw(-11.8, -1.5)


class RearJointMachineScrewTest(unittest.TestCase):
    def test_all_six_sites_match_captive_nut_axes_and_kinds_once(self):
        selections = joints.selected_screws()
        expected = [(site.x, site.y, site.kind) for site in nut_traps.sites()]
        actual = [(s.x, s.y, s.kind) for s in selections]

        self.assertEqual(len(selections), 6)
        self.assertEqual(len(set(actual)), 6)
        self.assertEqual(actual, expected)

        grouped = [s for group in joints.screw_length_groups().values()
                   for s in group]
        self.assertEqual(len(grouped), 6)
        self.assertEqual(
            {(s.x, s.y, s.kind) for s in grouped},
            set(expected),
        )

    def test_each_selection_obeys_stock_profile_and_tip_contract(self):
        joints_by_site = {
            (joint.x, joint.y, joint.kind): joint
            for joint in joints.back_joints()
        }
        nut_front_z = -joints.P.FACE_T

        for selection in joints.selected_screws():
            joint = joints_by_site[(selection.x, selection.y, selection.kind)]
            with self.subTest(site=(selection.x, selection.y, selection.kind)):
                self.assertIn(
                    selection.length,
                    joints.STOCKED_MACHINE_SCREW_LENGTHS,
                )
                self.assertGreaterEqual(
                    selection.seat_depth,
                    joints.MIN_HEAD_SEAT_DEPTH - 1e-9,
                )
                self.assertLessEqual(
                    selection.seat_depth,
                    joints.MAX_HEAD_SEAT_DEPTH + 1e-9,
                )
                self.assertAlmostEqual(
                    selection.outer_back_z,
                    joint.skin_range()[1],
                )
                self.assertAlmostEqual(
                    selection.seat_z,
                    selection.outer_back_z + selection.seat_depth,
                )
                self.assertAlmostEqual(selection.seat_z, joint.seat_z)
                self.assertAlmostEqual(
                    selection.tip_protrusion,
                    (selection.seat_z + selection.length) - nut_front_z,
                )
                self.assertGreaterEqual(
                    selection.tip_protrusion,
                    joints.MIN_TIP_PROTRUSION - 1e-9,
                )
                self.assertLessEqual(
                    selection.tip_protrusion,
                    joints.MAX_TIP_PROTRUSION + 1e-9,
                )

    def test_regression_profile_requires_ten_and_twelve_mm_lengths(self):
        self.assertEqual(
            [selection.length for selection in joints.selected_screws()],
            [10.0, 12.0, 10.0, 12.0, 12.0, 10.0],
        )

    def test_every_screw_crosses_full_nut_and_stays_in_blind_relief(self):
        nut_front_z = -joints.P.FACE_T
        nut_back_z = nut_front_z - joints.P.NUT_MAX_T
        remaining_front_skin = (
            joints.P.FACE_T - joints.P.MACHINE_SCREW_TIP_RELIEF
        )

        self.assertGreaterEqual(remaining_front_skin, 0.9 - 1e-9)
        for selection in joints.selected_screws():
            tip_z = selection.seat_z + selection.length
            with self.subTest(site=(selection.x, selection.y)):
                self.assertLessEqual(selection.seat_z, nut_back_z)
                self.assertGreaterEqual(
                    tip_z,
                    nut_front_z + joints.MIN_TIP_PROTRUSION - 1e-9,
                )
                self.assertLessEqual(
                    tip_z,
                    nut_front_z + joints.P.MACHINE_SCREW_TIP_RELIEF + 1e-9,
                )


class BuiltRearScrewGeometryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from OCP.BRepClass3d import BRepClass3d_SolidClassifier
        from OCP.TopAbs import TopAbs_IN, TopAbs_ON
        from OCP.gp import gp_Pnt

        shape = shell_back.build_back().val()

        def solid(x, y_layout, z):
            y_model = joints.P.BODY_H - y_layout
            classifier = BRepClass3d_SolidClassifier(
                shape.wrapped,
                gp_Pnt(x, y_model, z),
                1e-6,
            )
            return classifier.State() in (TopAbs_IN, TopAbs_ON)

        cls.solid = staticmethod(solid)

    def test_selected_pockets_reach_seat_and_retain_membrane_land_and_bore(self):
        selections = {
            (s.x, s.y, s.kind): s for s in joints.selected_screws()
        }
        for joint in joints.back_joints():
            selection = selections[(joint.x, joint.y, joint.kind)]
            seat = selection.seat_z
            with self.subTest(site=(joint.x, joint.y, joint.kind)):
                ring_r = (joint.bore_r + joint.head_r) / 2.0
                for dx, dy in ((ring_r, 0.0), (-ring_r, 0.0),
                               (0.0, ring_r), (0.0, -ring_r)):
                    self.assertFalse(
                        self.solid(joint.x + dx, joint.y + dy, seat - 0.05),
                        "head pocket stops behind the selected seat",
                    )
                    self.assertTrue(
                        self.solid(joint.x + dx, joint.y + dy, seat + 0.05),
                        "selected seat ring is missing",
                    )
                    self.assertTrue(
                        self.solid(
                            joint.x + dx,
                            joint.y + dy,
                            seat + joints.P.MIN_MEMBRANE - 0.05,
                        ),
                        "required seat membrane is missing",
                    )

                bore_mid_z = (seat + joint.top_z) / 2.0
                self.assertFalse(
                    self.solid(joint.x, joint.y, bore_mid_z),
                    "M2 shaft bore is blocked",
                )
                toward = -1.0 if joint.x > joints.P.BODY_W / 2.0 else 1.0
                self.assertTrue(
                    self.solid(
                        joint.x + toward * (joint.land_r - 0.25),
                        joint.y,
                        bore_mid_z,
                    ),
                    "reinforced rear land is missing",
                )


class HardwareBomTest(unittest.TestCase):
    def test_hardware_bom_groups_machine_screws_and_adds_six_nuts(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = export_smt.write_hardware_bom(tmp)
            with open(path, newline="", encoding="utf-8") as handle:
                reader = csv.DictReader(handle)
                rows = list(reader)
                self.assertEqual(
                    reader.fieldnames,
                    ["Comment", "Designator", "Qty", "Length_mm",
                     "Notes", "Sites_xy"],
                )

        screw_rows = [row for row in rows
                      if row["Designator"].startswith("SCREW_M2X")]
        nut_rows = [row for row in rows if row["Designator"] == "NUT_M2"]
        groups = joints.screw_length_groups()

        self.assertEqual(len(screw_rows), len(groups))
        self.assertEqual(sum(int(row["Qty"]) for row in screw_rows), 6)
        self.assertEqual(len(nut_rows), 1)
        self.assertEqual(nut_rows[0], {
            "Comment": "M2 DIN 934 hex nut",
            "Designator": "NUT_M2",
            "Qty": "6",
            "Length_mm": "1.6",
            "Notes": "4.0 mm AF nominal; verify against SLA fit coupon",
            "Sites_xy": ";".join(
                f"({site.x:g},{site.y:g})" for site in nut_traps.sites()
            ),
        })

        by_length = {float(row["Length_mm"]): row for row in screw_rows}
        self.assertEqual(set(by_length), set(groups))
        for length, selections in groups.items():
            row = by_length[length]
            self.assertEqual(row["Comment"],
                             f"M2x{length:g} pan-head machine screw")
            self.assertEqual(row["Designator"], f"SCREW_M2X{length:g}")
            self.assertEqual(int(row["Qty"]), len(selections))
            self.assertEqual(
                row["Notes"],
                "Rear machine screw into captive DIN 934 M2 nut",
            )
            self.assertEqual(
                row["Sites_xy"],
                ";".join(f"({s.x:g},{s.y:g})" for s in selections),
            )

        rendered = "\n".join(",".join(row.values()) for row in rows).lower()
        self.assertNotIn("self" + "-tap", rendered)
        self.assertNotIn("pi" + "lot", rendered)


if __name__ == "__main__":
    unittest.main()
