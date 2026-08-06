import tempfile
import unittest
from pathlib import Path
from unittest import mock

import params as P
import silk
import silk_layout as L


class DecorativeSilkTest(unittest.TestCase):
    def test_flag_defaults_false(self):
        self.assertFalse(P.DECORATIVE_SILK)

    def test_layout_omits_rules_and_logo_when_decorative_off(self):
        with mock.patch.object(P, "DECORATIVE_SILK", False):
            front, back = L.build_both()
        for side in (front, back):
            self.assertEqual(side.rule_count, 0)
            self.assertEqual(len(side.layers), 1)
            self.assertGreater(len(side.layers[0].texts), 0)

    def test_readable_back_omits_connector_titles_keeps_pin_legends(self):
        with mock.patch.object(P, "DECORATIVE_SILK", False):
            _, back = L.build_both()
        texts = [item.s for item in back.texts]
        self.assertNotIn("J_BAT_IN1", texts)
        self.assertNotIn("J_I2C1", texts)
        self.assertNotIn("J_EXP1", texts)
        self.assertNotIn("J_BAT_OUT1", texts)
        self.assertTrue(any(text.startswith("1·") for text in texts))

    def test_layout_keeps_full_stack_when_decorative_on(self):
        with mock.patch.object(P, "DECORATIVE_SILK", True):
            front, back = L.build_both()
        self.assertEqual(len(front.layers), 3)
        self.assertGreater(front.rule_count, 0)
        titles = {item.s for item in back.texts}
        self.assertTrue({"J_BAT_IN1", "J_I2C1", "J_EXP1", "J_BAT_OUT1"} <= titles)

    def test_raster_skips_brick_when_decorative_off(self):
        with mock.patch.object(P, "DECORATIVE_SILK", False):
            front, _ = L.build_both()
            with mock.patch.object(
                L, "brick_rects_full", return_value=[(0, 0, 10, 10)]
            ) as brick:
                silk.rasterize_side(front, mirror_glyphs=False)
        brick.assert_not_called()

    def _write_temp_board(self, text: str) -> str:
        temporary = tempfile.NamedTemporaryFile(
            suffix=".kicad_pcb", delete=False, mode="w", encoding="utf-8"
        )
        temporary.write(text)
        temporary.close()
        self.addCleanup(lambda: Path(temporary.name).unlink(missing_ok=True))
        return temporary.name

    def test_refresh_unhides_references_when_decorative_off(self):
        board = (
            "(kicad_pcb\n"
            "\t(gr_rect\n"
            "\t\t(start 0 0)\n"
            "\t\t(end 1 1)\n"
            "\t\t(stroke (width 0) (type default))\n"
            "\t\t(fill yes)\n"
            '\t\t(layer "F.SilkS")\n'
            '\t\t(uuid "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")\n'
            "\t)\n"
            '\t(footprint "Lib:FP"\n'
            '\t\t(layer "F.Cu")\n'
            '\t\t(uuid "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")\n'
            '\t\t(property "Reference" "U1"\n'
            "\t\t\t(at 0 0 0)\n"
            '\t\t\t(layer "F.SilkS")\n'
            "\t\t\t(hide yes)\n"
            '\t\t\t(uuid "cccccccc-cccc-4ccc-8ccc-cccccccccccc")\n'
            "\t\t)\n"
            "\t)\n"
            "\t(embedded_fonts no)\n"
            ")\n"
        )
        path = self._write_temp_board(board)
        with mock.patch.object(P, "DECORATIVE_SILK", False):
            with mock.patch.object(silk, "silk_sexpr", return_value=""):
                silk.refresh_board_silk(path)
        text = Path(path).read_text(encoding="utf-8")
        self.assertNotIn("(gr_rect\n", text)
        ref_block = text.split('(property "Reference" "U1"', 1)[1].split(
            "(property", 1
        )[0]
        self.assertNotIn("(hide yes)", ref_block)

    def test_refresh_hides_references_when_decorative_on(self):
        board = (
            "(kicad_pcb\n"
            '\t(footprint "Lib:FP"\n'
            '\t\t(layer "F.Cu")\n'
            '\t\t(uuid "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")\n'
            '\t\t(property "Reference" "U1"\n'
            "\t\t\t(at 0 0 0)\n"
            '\t\t\t(layer "F.SilkS")\n'
            '\t\t\t(uuid "cccccccc-cccc-4ccc-8ccc-cccccccccccc")\n'
            "\t\t)\n"
            "\t)\n"
            "\t(embedded_fonts no)\n"
            ")\n"
        )
        path = self._write_temp_board(board)
        with mock.patch.object(P, "DECORATIVE_SILK", True):
            with mock.patch.object(silk, "silk_sexpr", return_value=""):
                silk.refresh_board_silk(path)
        text = Path(path).read_text(encoding="utf-8")
        ref_block = text.split('(property "Reference" "U1"', 1)[1].split(
            "(property", 1
        )[0]
        self.assertIn("(hide yes)", ref_block)


if __name__ == "__main__":
    unittest.main()
