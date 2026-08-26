import csv
import os
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import export_smt  # noqa: E402
import joints  # noqa: E402


class ScrewLengthSelectionTest(unittest.TestCase):
    def test_module_pilot_entry_matches_module_post_construction(self):
        joint = next(j for j in joints.back_joints() if j.kind == "module")
        self.assertAlmostEqual(
            joint.pilot_entry_z,
            -(joints.P.BODY_T - joints.P.LID_T),
        )

    def test_pcb_pilot_entry_matches_pcb_post_construction(self):
        joint = next(j for j in joints.back_joints() if j.kind == "pcb")
        self.assertAlmostEqual(
            joint.pilot_entry_z,
            -(joints.P.PCB_FRONT_Z + joints.P.PCB_T + joints.P.PCB_PIN_TIP),
        )

    def test_pcb_pilot_datum_tracks_its_stack_independently_of_module_split(self):
        module = next(j for j in joints.back_joints() if j.kind == "module")
        pcb = next(j for j in joints.back_joints() if j.kind == "pcb")
        module_entry = module.pilot_entry_z
        changed_tip = joints.P.PCB_PIN_TIP + 0.4
        with mock.patch.object(joints.P, "PCB_PIN_TIP", changed_tip):
            self.assertEqual(module.pilot_entry_z, module_entry)
            self.assertAlmostEqual(
                pcb.pilot_entry_z,
                -(joints.P.PCB_FRONT_Z + joints.P.PCB_T + changed_tip),
            )

    def test_selects_shortest_stocked_length_with_required_engagement(self):
        self.assertEqual(joints.select_screw_length(5.5), 8.0)
        self.assertEqual(joints.select_screw_length(5.51), 10.0)
        self.assertEqual(joints.select_screw_length(7.5), 10.0)
        self.assertEqual(joints.select_screw_length(7.51), 12.0)

    def test_fails_clearly_when_no_stocked_length_can_reach(self):
        with self.assertRaisesRegex(ValueError, "no stocked screw"):
            joints.select_screw_length(10.0)

    def test_all_six_joints_are_selected_once_and_pass_engagement(self):
        selections = joints.selected_screws()
        expected = {(j.x, j.y, j.kind) for j in joints.back_joints()}
        actual = {(s.x, s.y, s.kind) for s in selections}

        self.assertEqual(len(selections), 6)
        self.assertEqual(len(actual), 6)
        self.assertEqual(actual, expected)
        for selection in selections:
            self.assertIn(selection.length, joints.STOCKED_SCREW_LENGTHS)
            self.assertGreaterEqual(
                selection.engagement,
                joints.MIN_THREAD_ENGAGEMENT - 1e-9,
            )
            shorter = [
                length for length in joints.STOCKED_SCREW_LENGTHS
                if length < selection.length
            ]
            self.assertTrue(all(
                length - selection.shank_span < joints.MIN_THREAD_ENGAGEMENT
                for length in shorter
            ))

        groups = joints.screw_length_groups()
        grouped = [s for group in groups.values() for s in group]
        self.assertEqual(len(grouped), 6)
        self.assertEqual(
            {(s.x, s.y, s.kind) for s in grouped},
            expected,
        )

    def test_hardware_bom_is_derived_from_length_groups(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = export_smt.write_hardware_bom(tmp)
            with open(path, newline="", encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))

        by_length = {float(row["Length_mm"]): row for row in rows}
        groups = joints.screw_length_groups()
        self.assertEqual(set(by_length), set(groups))
        for length, selections in groups.items():
            row = by_length[length]
            self.assertEqual(int(row["Qty"]), len(selections))
            self.assertEqual(row["Designator"], f"SCREW_M2X{length:g}")
            self.assertEqual(
                row["Sites_xy"],
                ";".join(f"({s.x:g},{s.y:g})" for s in selections),
            )


if __name__ == "__main__":
    unittest.main()
