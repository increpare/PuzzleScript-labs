import json
import sys
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from hardware.pocket_card.case import params as P
from hardware.pocket_card.electronics_pipeline.inventory import parse_board


BOARD_PATH = REPO_ROOT / "hardware/pocket_card/electronics/pocket_card_controller.kicad_pcb"
CONTRACT_PATH = REPO_ROOT / "hardware/pocket_card/electronics/mechanical_contract.json"


class ClosureLayoutContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.board = parse_board(BOARD_PATH.read_text(encoding="utf-8"))
        contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
        cls.contract_features = {
            feature["ref"]: feature for feature in contract["features"]
        }

    def test_reset_and_lower_mount_share_the_relocated_coordinate_contract(self):
        self.assertEqual((P.RESET_X, P.RESET_Y), (54.5, 80.0))
        self.assertEqual(P.PCB_MOUNTS, ((64.5, 56.0), (64.5, 84.0)))
        self.assertEqual(P.EXTRA_BOSSES, P.PCB_MOUNTS)

        h1 = self.board.footprints["H1"]
        h2 = self.board.footprints["H2"]
        self.assertEqual((h1.x_mm, h2.x_mm), (64.5, 64.5))
        self.assertEqual((h2.x_mm, h2.y_mm), (64.5, 84.0))
        self.assertTrue(h2.locked)

        reset = self.board.footprints["SW_RESET1"]
        self.assertEqual((reset.x_mm, reset.y_mm), (54.5, 80.0))
        self.assertTrue(reset.locked)
        self.assertEqual(
            tuple(pad.net for pad in reset.pads["1"]),
            ("SIG_RESET", "SIG_RESET"),
        )
        self.assertEqual(
            tuple(pad.net for pad in reset.pads["2"]),
            ("GND", "GND"),
        )

        u1 = self.board.footprints["U1"]
        self.assertEqual((u1.x_mm, u1.y_mm), (44.3, 72.0))
        self.assertEqual(
            tuple(pad.net for pad in u1.pads["22"]),
            ("SIG_RESET",),
        )

        for ref, expected in (
            ("H2", (64.5, 84.0)),
            ("SW_RESET1", (54.5, 80.0)),
        ):
            feature = self.contract_features[ref]
            self.assertEqual((feature["xMm"], feature["yMm"]), expected)

        h1_contract = self.contract_features["H1"]
        h2_contract = self.contract_features["H2"]
        self.assertEqual((h1_contract["xMm"], h2_contract["xMm"]), (64.5, 64.5))


if __name__ == "__main__":
    unittest.main()
