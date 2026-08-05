import dataclasses
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from hardware.pocket_card.electronics_pipeline.inventory import (
    BoardInventory,
    ProjectInventory,
    SchematicInventory,
    compare_schematic_to_board,
    inventory_json,
    inventory_project,
    parse_board,
    parse_netlist,
    project_digest,
    semantic_diff,
)
from hardware.pocket_card.electronics_pipeline.paths import ELECTRONICS_DIR


FIXTURES = Path(__file__).with_name("fixtures")
BOARD_FIXTURE = FIXTURES / "pullup_board_fragment.kicad_pcb"
NETLIST_FIXTURE = FIXTURES / "pullup_netlist.net"


class InventoryParsingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.board = parse_board(BOARD_FIXTURE.read_text(encoding="utf-8"))
        cls.schematic = parse_netlist(NETLIST_FIXTURE.read_text(encoding="utf-8"))

    def test_board_extracts_linked_pullup_without_allowlist(self):
        self.assertEqual(self.board.thickness_mm, 1.6)
        self.assertEqual(tuple(self.board.footprints), ("R99",))
        footprint = self.board.footprints["R99"]
        self.assertEqual(footprint.value, "10k")
        self.assertEqual(footprint.library_id, "Resistor_SMD:R_0402_1005Metric")
        self.assertEqual(footprint.uuid, "11111111-2222-4333-8444-555555555555")
        self.assertEqual(footprint.symbol_path, "/11111111-2222-4333-8444-555555555555")
        self.assertEqual((footprint.x_mm, footprint.y_mm, footprint.rotation_deg), (10.0, 20.0, 90.0))
        self.assertEqual((footprint.layer, footprint.locked), ("F.Cu", True))
        self.assertEqual(footprint.pads["1"][0].net, "+3V3")
        self.assertEqual(footprint.pads["2"][0].net, "SIG_ACTION")

    def test_rotated_courtyard_and_edge_cuts_are_semantic(self):
        self.assertEqual(self.board.footprints["R99"].courtyard_bbox_mm, (8.0, 19.0, 12.0, 21.0))
        self.assertEqual([primitive["type"] for primitive in self.board.edge_cuts], ["gr_line", "gr_arc"])
        self.assertEqual(self.board.edge_cuts[1]["mid"], (21.0, 1.0))

    def test_rotated_circle_courtyard_uses_the_true_world_extents(self):
        board = parse_board(
            '(kicad_pcb (general (thickness 1.6)) '
            '(footprint "MountingHole_2.7mm_M2.5" (layer "F.Cu") '
            '(uuid "cccccccc-2222-4333-8444-555555555555") '
            '(path "/cccccccc-2222-4333-8444-555555555555") (at 10 20 45) '
            '(property "Reference" "H2") (property "Value" "MountingHole_2.7mm_M2.5") '
            '(fp_circle (center 0 0) (end 1 0) (layer "F.CrtYd"))))'
        )
        self.assertEqual(board.footprints["H2"].courtyard_bbox_mm, (9.0, 19.0, 11.0, 21.0))

    def test_standalone_locked_atom_after_other_children_is_detected(self):
        board = parse_board(
            '(kicad_pcb (general (thickness 1.6)) '
            '(footprint "MountingHole_2.7mm_M2.5" (layer "F.Cu") locked '
            '(uuid "dddddddd-2222-4333-8444-555555555555") '
            '(path "/dddddddd-2222-4333-8444-555555555555") (at 1 2) '
            '(property "Reference" "H1") (property "Value" "MountingHole_2.7mm_M2.5")))'
        )
        self.assertTrue(board.footprints["H1"].locked)

    def test_netlist_extracts_components_fields_and_normalized_nets(self):
        component = self.schematic.components["R99"]
        self.assertEqual(component.value, "10k")
        self.assertEqual(component.footprint, "Resistor_SMD:R_0402_1005Metric")
        self.assertEqual(component.uuid, "11111111-2222-4333-8444-555555555555")
        self.assertEqual(component.fields["Tolerance"], "1%")
        self.assertEqual(self.schematic.nets["+3V3"], ("R99.1",))
        self.assertEqual(self.schematic.nets["SIG_ACTION"], ("R99.2",))

    def test_board_and_schematic_compare_without_fixed_reference_allowlist(self):
        self.assertEqual(compare_schematic_to_board(self.schematic, self.board), ())

    def test_comparison_rejects_linkage_pad_and_library_mismatches(self):
        footprint = self.board.footprints["R99"]
        bad_footprint = dataclasses.replace(
            footprint,
            symbol_path="/wrong",
            library_id="Other:R_0603",
            pads={"1": footprint.pads["2"], "2": footprint.pads["1"]},
        )
        bad_board = dataclasses.replace(self.board, footprints={"R99": bad_footprint})
        errors = compare_schematic_to_board(self.schematic, bad_board)
        self.assertTrue(any("symbol path" in error for error in errors), errors)
        self.assertTrue(any("footprint" in error for error in errors), errors)
        self.assertTrue(any("pad 1" in error for error in errors), errors)

    def test_duplicate_physical_pads_require_one_expected_net(self):
        footprint = self.board.footprints["R99"]
        pad = footprint.pads["1"][0]
        accepted = dataclasses.replace(
            footprint,
            pads={**footprint.pads, "1": (pad, dataclasses.replace(pad, uuid="another"))},
        )
        self.assertEqual(
            compare_schematic_to_board(self.schematic, dataclasses.replace(self.board, footprints={"R99": accepted})),
            (),
        )
        rejected = dataclasses.replace(
            accepted,
            pads={**accepted.pads, "1": (pad, dataclasses.replace(pad, net="SIG_ACTION"))},
        )
        errors = compare_schematic_to_board(
            self.schematic, dataclasses.replace(self.board, footprints={"R99": rejected})
        )
        self.assertTrue(any("duplicate" in error and "pad 1" in error for error in errors), errors)

    def test_consistent_slide_switch_shell_pads_are_board_only_but_mixed_nets_fail(self):
        board = parse_board(
            '(kicad_pcb (general (thickness 1.6)) '
            '(footprint "Button_Switch_SMD:SW_SPDT_PCM12" (layer "F.Cu") '
            '(uuid "aaaaaaaa-2222-4333-8444-555555555555") '
            '(path "/aaaaaaaa-2222-4333-8444-555555555555") (at 1 2) '
            '(property "Reference" "SW_AUX1") (property "Value" "PCM12SMTR") '
            '(pad "" smd rect (net "GND") (uuid "empty-a")) '
            '(pad "" smd rect (net "GND") (uuid "empty-b")) '
            '(pad "1" smd rect (net "SIG_ACTION") (uuid "pin-1")) '
            '(pad "2" smd rect (net "GND") (uuid "pin-2"))))'
        )
        schematic = parse_netlist(
            '(export (components (comp (ref "SW_AUX1") (value "PCM12SMTR") '
            '(footprint "Button_Switch_SMD:SW_SPDT_PCM12") '
            '(tstamps "aaaaaaaa-2222-4333-8444-555555555555"))) '
            '(nets (net (name "/SIG_ACTION") (node (ref "SW_AUX1") (pin "1"))) '
            '(net (name "/GND") (node (ref "SW_AUX1") (pin "2")))))'
        )
        self.assertEqual(compare_schematic_to_board(schematic, board), ())
        footprint = board.footprints["SW_AUX1"]
        mixed = dataclasses.replace(
            footprint,
            pads={
                **footprint.pads,
                "": (
                    footprint.pads[""][0],
                    dataclasses.replace(footprint.pads[""][1], net=None),
                ),
            },
        )
        errors = compare_schematic_to_board(
            schematic, dataclasses.replace(board, footprints={"SW_AUX1": mixed})
        )
        self.assertTrue(any("unnumbered" in error and "mixed nets" in error for error in errors), errors)

    def test_mounting_hole_unnumbered_pad_needs_no_reference_allowlist(self):
        board = parse_board(
            '(kicad_pcb (general (thickness 1.6)) '
            '(footprint "MountingHole:MountingHole_2.7mm_M2.5" (layer "F.Cu") '
            '(uuid "bbbbbbbb-2222-4333-8444-555555555555") '
            '(path "/bbbbbbbb-2222-4333-8444-555555555555") (at 1 2) '
            '(property "Reference" "H1") (property "Value" "MountingHole_2.7mm_M2.5") '
            '(pad "" np_thru_hole circle (uuid "hole"))))'
        )
        schematic = parse_netlist(
            '(export (components (comp (ref "H1") (value "MountingHole_2.7mm_M2.5") '
            '(footprint "MountingHole:MountingHole_2.7mm_M2.5") '
            '(tstamps "bbbbbbbb-2222-4333-8444-555555555555"))) (nets))'
        )
        self.assertEqual(compare_schematic_to_board(schematic, board), ())

    def test_only_one_leading_net_slash_is_removed(self):
        schematic = dataclasses.replace(self.schematic, nets={"/+3V3": ("R99.1",), "SIG_ACTION": ("R99.2",)})
        footprint = self.board.footprints["R99"]
        pad = dataclasses.replace(footprint.pads["1"][0], net="/+3V3")
        board = dataclasses.replace(
            self.board,
            footprints={"R99": dataclasses.replace(footprint, pads={**footprint.pads, "1": (pad,)})},
        )
        self.assertEqual(compare_schematic_to_board(schematic, board), ())

    def test_comparison_rejects_net_endpoints_for_unknown_components(self):
        schematic = dataclasses.replace(
            self.schematic,
            nets={**self.schematic.nets, "GHOST": ("GHOST1.1",)},
        )
        errors = compare_schematic_to_board(schematic, self.board)
        self.assertTrue(any("unknown schematic component GHOST1" in error for error in errors), errors)


class ProjectInventoryTest(unittest.TestCase):
    def test_checked_in_project_inventory_is_linked_and_has_canonical_counts(self):
        before = tuple(sorted(path.relative_to(ELECTRONICS_DIR) for path in ELECTRONICS_DIR.rglob("*")))
        inventory = inventory_project(ELECTRONICS_DIR)
        after = tuple(sorted(path.relative_to(ELECTRONICS_DIR) for path in ELECTRONICS_DIR.rglob("*")))
        self.assertEqual(len(inventory.board.footprints), 17)
        self.assertEqual(len(inventory.schematic.components), 17)
        self.assertEqual(len(inventory.schematic.nets), 16)
        self.assertEqual(compare_schematic_to_board(inventory.schematic, inventory.board), ())
        self.assertEqual(after, before, "inventory export must not leave project-local artifacts")

    def test_project_digest_uses_sorted_editable_paths_and_nul_separators(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            (root / "pocket_card_controller.kicad_pro").write_bytes(b"project")
            (root / "pocket_card_controller.kicad_sch").write_bytes(b"schematic")
            (root / "review-copy.kicad_sch").write_bytes(b"derived copy must not count")
            (root / "toolchain.json").write_bytes(b"policy must not count")
            (root / "demo.kicad_prl").write_bytes(b"editor state must not count")
            (root / "symbols").mkdir()
            (root / "symbols" / "local.kicad_sym").write_bytes(b"symbol")
            (root / "symbols" / "notes.txt").write_bytes(b"not an editable KiCad source")

            expected = hashlib.sha256()
            for relative, payload in (
                ("pocket_card_controller.kicad_pro", b"project"),
                ("pocket_card_controller.kicad_sch", b"schematic"),
                ("symbols/local.kicad_sym", b"symbol"),
            ):
                expected.update(relative.encode("utf-8"))
                expected.update(b"\0")
                expected.update(payload)
                expected.update(b"\0")
            self.assertEqual(project_digest(root), expected.hexdigest())

            (root / "toolchain.json").write_bytes(b"changed policy")
            self.assertEqual(project_digest(root), expected.hexdigest())

    def test_inventory_json_is_deterministic_json_ready_and_detached(self):
        project = ProjectInventory(
            schematic=parse_netlist(NETLIST_FIXTURE.read_text(encoding="utf-8")),
            board=parse_board(BOARD_FIXTURE.read_text(encoding="utf-8")),
        )
        first = inventory_json(project)
        encoded = json.dumps(first, sort_keys=True, separators=(",", ":"))
        self.assertEqual(encoded, json.dumps(inventory_json(project), sort_keys=True, separators=(",", ":")))
        self.assertEqual(list(first["board"]["footprints"]), ["R99"])
        self.assertEqual(list(first["schematic"]["nets"]), ["+3V3", "SIG_ACTION"])
        first["board"]["footprints"]["R99"]["pads"]["1"][0]["net"] = "MUTATED"
        self.assertEqual(inventory_json(project)["board"]["footprints"]["R99"]["pads"]["1"][0]["net"], "+3V3")

    def test_semantic_diff_reports_additions_and_meaningful_changes_stably(self):
        after = ProjectInventory(
            schematic=parse_netlist(NETLIST_FIXTURE.read_text(encoding="utf-8")),
            board=parse_board(BOARD_FIXTURE.read_text(encoding="utf-8")),
        )
        empty = ProjectInventory(
            schematic=SchematicInventory(components={}, nets={}),
            board=BoardInventory(thickness_mm=1.6, footprints={}, edge_cuts=()),
        )
        added = semantic_diff(empty, after)
        self.assertEqual(added["components"]["added"], ["R99"])
        self.assertEqual(added["footprints"]["added"], ["R99"])
        self.assertEqual(added["nets"]["added"], ["+3V3", "SIG_ACTION"])

        component = after.schematic.components["R99"]
        footprint = after.board.footprints["R99"]
        changed = ProjectInventory(
            schematic=dataclasses.replace(
                after.schematic,
                components={"R99": dataclasses.replace(component, value="12k")},
            ),
            board=dataclasses.replace(
                after.board,
                footprints={"R99": dataclasses.replace(footprint, x_mm=11.0)},
                edge_cuts=after.board.edge_cuts[:-1],
            ),
        )
        difference = semantic_diff(after, changed)
        self.assertEqual(list(difference["components"]["changed"]), ["R99"])
        self.assertEqual(list(difference["placements"]["changed"]), ["R99"])
        self.assertTrue(difference["outline"]["changed"])
        self.assertEqual(difference, semantic_diff(after, changed))


if __name__ == "__main__":
    unittest.main()
