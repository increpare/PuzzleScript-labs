import os
from pathlib import Path
import sys
import unittest

import cadquery as cq

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import params as P  # noqa: E402
import place_preview  # noqa: E402
import checks  # noqa: E402
import shell_back  # noqa: E402
import shell_front  # noqa: E402


def volume(shape):
    return sum(solid.Volume() for solid in shape.solids().vals())


class PcbFrontStopContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stop = shell_front.pcb_front_stop()
        cls.model_stop = shell_front.to_model_space(cls.stop)

    def test_stop_is_rigid_and_leaves_the_board_install_gap(self):
        self.assertEqual(
            (P.PCB_FRONT_STOP_X, P.PCB_FRONT_STOP_Y),
            (8.0, 82.0),
        )
        self.assertEqual(P.PCB_FRONT_STOP_D, 3.2)
        self.assertEqual(P.PCB_FRONT_STOP_GAP, 0.20)

        bb = self.stop.val().BoundingBox()
        self.assertAlmostEqual(bb.xlen, P.PCB_FRONT_STOP_D, delta=1e-6)
        self.assertAlmostEqual(bb.ylen, P.PCB_FRONT_STOP_D, delta=1e-6)
        self.assertAlmostEqual(
            bb.zmin,
            -P.PCB_FRONT_Z + P.PCB_FRONT_STOP_GAP,
            delta=1e-6,
        )
        self.assertAlmostEqual(
            bb.zmin - (-P.PCB_FRONT_Z),
            P.PCB_FRONT_STOP_GAP,
            delta=1e-6,
        )

    def test_stop_lands_on_real_pcb_material_and_opposes_battery_fence(self):
        model_x = P.PCB_FRONT_STOP_X
        model_y = P.BODY_H - P.PCB_FRONT_STOP_Y
        probe = (
            cq.Workplane("XY")
            .circle(P.PCB_FRONT_STOP_D / 2.0)
            .extrude(0.2)
            .translate((model_x, model_y, 0.7))
        )
        self.assertGreater(
            volume(shell_back.pcb_outline_wire().intersect(probe)),
            0.1,
        )

        fence_outer_x0 = P.BATT_X - P.BATT_CLEAR - shell_back.FENCE_T
        fence_outer_x1 = P.BATT_X - P.BATT_CLEAR
        self.assertGreaterEqual(P.PCB_FRONT_STOP_X, fence_outer_x0)
        self.assertLessEqual(P.PCB_FRONT_STOP_X, fence_outer_x1)
        self.assertGreaterEqual(P.PCB_FRONT_STOP_Y, P.BATT_Y - P.BATT_CLEAR)
        self.assertLessEqual(
            P.PCB_FRONT_STOP_Y,
            P.BATT_Y + P.CELL_H + P.BATT_CLEAR,
        )

    def test_stop_clears_the_actual_controller_components(self):
        raw = cq.importers.importStep(
            str(Path(HERE) / "out/pcb/pocket_card_controller.step")
        )
        controller = place_preview.kicad_pcb_to_model_space(raw)
        controller_shape = (
            controller.val() if hasattr(controller, "val") else controller
        )
        board = max(controller_shape.Solids(), key=lambda solid: solid.Volume())
        components = controller_shape.cut(board)
        self.assertLess(volume(self.model_stop.intersect(components)), 1e-5)

    def test_finished_front_contains_the_complete_stop(self):
        finished = shell_front.build()
        missing = self.model_stop.cut(finished)
        self.assertLess(volume(missing), 1e-5)

    def test_checks_report_the_axial_gap_and_opposed_support(self):
        metrics = checks.pcb_front_stop_metrics()
        self.assertAlmostEqual(metrics["axial_gap"], 0.20, delta=1e-9)
        self.assertTrue(metrics["on_board"])
        self.assertTrue(metrics["opposes_fence"])


if __name__ == "__main__":
    unittest.main()
