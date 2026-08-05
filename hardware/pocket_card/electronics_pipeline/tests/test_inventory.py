import dataclasses
import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from hardware.pocket_card.electronics_pipeline import inventory as inventory_module
from hardware.pocket_card.electronics_pipeline.inventory import (
    BoardInventory,
    ProjectInventory,
    SchematicInventory,
    compare_schematic_to_board,
    editable_project_files,
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

    def test_comparison_rejects_board_value_drift(self):
        footprint = self.board.footprints["R99"]
        board = dataclasses.replace(
            self.board,
            footprints={"R99": dataclasses.replace(footprint, value="1k")},
        )
        errors = compare_schematic_to_board(self.schematic, board)
        self.assertTrue(any("R99 value expected 10k, found 1k" == error for error in errors), errors)

    def test_comparison_allows_library_basename_as_legacy_board_value_placeholder(self):
        footprint = self.board.footprints["R99"]
        board = dataclasses.replace(
            self.board,
            footprints={
                "R99": dataclasses.replace(footprint, value="R_0402_1005Metric")
            },
        )
        self.assertEqual(compare_schematic_to_board(self.schematic, board), ())

    def test_board_parser_rejects_duplicate_nonempty_uuids_naming_both_refs(self):
        board_text = (
            '(kicad_pcb (general (thickness 1.6)) '
            '(footprint "Resistor_SMD:R_0402_1005Metric" (layer "F.Cu") '
            '(uuid "shared-uuid") (path "/first") (at 0 0) '
            '(property "Reference" "R1") (property "Value" "1k")) '
            '(footprint "Resistor_SMD:R_0402_1005Metric" (layer "F.Cu") '
            '(uuid "shared-uuid") (path "/second") (at 1 0) '
            '(property "Reference" "R2") (property "Value" "2k")))'
        )
        with self.assertRaisesRegex(
            ValueError,
            r"duplicate board footprint UUID shared-uuid used by R1 and R2",
        ):
            parse_board(board_text)

    def test_netlist_parser_rejects_duplicate_nonempty_uuids_naming_both_refs(self):
        netlist_text = (
            '(export (components '
            '(comp (ref "R1") (value "1k") '
            '(footprint "Resistor_SMD:R_0402_1005Metric") (tstamps "shared-uuid")) '
            '(comp (ref "R2") (value "2k") '
            '(footprint "Resistor_SMD:R_0402_1005Metric") (tstamps "shared-uuid"))) '
            '(nets))'
        )
        with self.assertRaisesRegex(
            ValueError,
            r"duplicate schematic component UUID shared-uuid used by R1 and R2",
        ):
            parse_netlist(netlist_text)

    def test_parsers_reject_duplicate_references_instead_of_overwriting(self):
        board_text = BOARD_FIXTURE.read_text(encoding="utf-8").replace(
            "</unused>", ""
        )
        duplicate_footprint = (
            '(footprint "Resistor_SMD:R_0402_1005Metric" (layer "F.Cu") '
            '(uuid "another-uuid") (path "/another-uuid") (at 0 0) '
            '(property "Reference" "R99") (property "Value" "10k"))'
        )
        board_text = board_text.rstrip()[:-1] + duplicate_footprint + ")"
        with self.assertRaisesRegex(ValueError, "duplicate board footprint reference R99"):
            parse_board(board_text)

        netlist_text = (
            '(export (components '
            '(comp (ref "R99") (value "10k") '
            '(footprint "Resistor_SMD:R_0402_1005Metric") (tstamps "first-uuid")) '
            '(comp (ref "R99") (value "10k") '
            '(footprint "Resistor_SMD:R_0402_1005Metric") (tstamps "another-uuid"))) '
            '(nets))'
        )
        with self.assertRaisesRegex(ValueError, "duplicate schematic component reference R99"):
            parse_netlist(netlist_text)

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
            (root / "symbols" / "BackupPower.kicad_sym").write_bytes(b"backup power")
            (root / "symbols" / "power_backup.kicad_sym").write_bytes(b"power backup")
            (root / "symbols" / "notes.txt").write_bytes(b"not an editable KiCad source")
            (root / "symbols" / "demo-backups").mkdir()
            (root / "symbols" / "demo-backups" / "old.kicad_sym").write_bytes(
                b"actual backup must not count"
            )

            expected = hashlib.sha256()
            editable_payloads = {
                "pocket_card_controller.kicad_pro": b"project",
                "pocket_card_controller.kicad_sch": b"schematic",
                "symbols/BackupPower.kicad_sym": b"backup power",
                "symbols/local.kicad_sym": b"symbol",
                "symbols/power_backup.kicad_sym": b"power backup",
            }
            for relative, payload in sorted(editable_payloads.items()):
                expected.update(relative.encode("utf-8"))
                expected.update(b"\0")
                expected.update(payload)
                expected.update(b"\0")
            self.assertEqual(project_digest(root), expected.hexdigest())

            (root / "toolchain.json").write_bytes(b"changed policy")
            self.assertEqual(project_digest(root), expected.hexdigest())

    def test_editable_project_files_exclude_exact_editor_history_directories(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            symbols = root / "symbols"
            symbols.mkdir()
            (symbols / "local.kicad_sym").write_bytes(b"symbol")
            history = symbols / ".history"
            history.mkdir()
            old_symbol = history / "old.kicad_sym"
            old_symbol.write_bytes(b"old editor history")
            similarly_named = symbols / ".history-copy"
            similarly_named.mkdir()
            (similarly_named / "kept.kicad_sym").write_bytes(b"editable symbol")

            relative_paths = {
                path.relative_to(root.resolve()).as_posix()
                for path in editable_project_files(root)
            }
            self.assertEqual(
                relative_paths,
                {
                    "symbols/.history-copy/kept.kicad_sym",
                    "symbols/local.kicad_sym",
                },
            )

            digest_before = project_digest(root)
            old_symbol.write_bytes(b"changed editor history")
            self.assertEqual(project_digest(root), digest_before)

    def test_editable_primary_file_symlinks_are_rejected_with_their_path(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            target = root / "real-project.json"
            target.write_text("{}", encoding="utf-8")
            link = root / "pocket_card_controller.kicad_pro"
            try:
                link.symlink_to(target.name)
            except (NotImplementedError, OSError) as error:
                self.skipTest(f"platform cannot create file symlinks: {error}")
            with self.assertRaisesRegex(
                ValueError,
                r"editable project path is a symlink: .*pocket_card_controller\.kicad_pro",
            ):
                project_digest(root)

    def test_editable_directory_symlinks_are_rejected_with_their_path(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            target = root / "real-symbols"
            target.mkdir()
            (target / "local.kicad_sym").write_text("symbol", encoding="utf-8")
            link = root / "symbols"
            try:
                link.symlink_to(target.name, target_is_directory=True)
            except (NotImplementedError, OSError) as error:
                self.skipTest(f"platform cannot create directory symlinks: {error}")
            with self.assertRaisesRegex(
                ValueError,
                r"editable project path is a symlink: .*symbols",
            ):
                project_digest(root)

    def test_toolchain_project_name_must_be_a_plain_nonempty_filename_stem(self):
        invalid_names = (
            123,
            "",
            ".",
            "..",
            "name.withdot",
            "../escape",
            "nested/name",
            r"nested\name",
            "/absolute",
            r"C:\absolute",
            "C:outside",
            "two words",
            "nul\0name",
            "tab\tname",
            "line\nbreak",
            "control\x1fcharacter",
            "punctuation!",
        )
        for invalid_name in invalid_names:
            with self.subTest(project=invalid_name), tempfile.TemporaryDirectory() as temporary_directory:
                root = Path(temporary_directory)
                (root / "toolchain.json").write_text(
                    json.dumps(
                        {
                            "project": invalid_name,
                            "kicad": {"major": 10, "minimum": "10.0.4"},
                        }
                    ),
                    encoding="utf-8",
                )
                with self.assertRaisesRegex(
                    RuntimeError,
                    "invalid toolchain project name",
                ):
                    inventory_project(root)

    def test_toolchain_project_name_accepts_portable_ascii_stems(self):
        for valid_name in (
            "PocketCard",
            "pocket_card-controller",
            "A1",
            "_private",
            "dash-",
        ):
            with self.subTest(project=valid_name):
                self.assertEqual(
                    inventory_module._validated_project_name(valid_name),
                    valid_name,
                )

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


class DeepImmutabilityTest(unittest.TestCase):
    def setUp(self):
        self.project = ProjectInventory(
            schematic=parse_netlist(NETLIST_FIXTURE.read_text(encoding="utf-8")),
            board=parse_board(BOARD_FIXTURE.read_text(encoding="utf-8")),
        )

    def test_all_public_nested_mappings_and_sequences_reject_mutation(self):
        footprint = self.project.board.footprints["R99"]
        component = self.project.schematic.components["R99"]
        mutation_attempts = (
            lambda: self.project.board.footprints.__setitem__("X1", footprint),
            lambda: footprint.pads.__setitem__("9", ()),
            lambda: component.fields.__setitem__("Tolerance", "5%"),
            lambda: self.project.schematic.components.__setitem__("X1", component),
            lambda: self.project.schematic.nets.__setitem__("OTHER", ("R99.1",)),
            lambda: self.project.board.edge_cuts[0].__setitem__("type", "mutated"),
        )
        for mutate in mutation_attempts:
            with self.subTest(mutate=mutate), self.assertRaises((AttributeError, TypeError)):
                mutate()
        with self.assertRaises(TypeError):
            self.project.board.edge_cuts[0]["start"][0] = 99.0

    def test_constructors_defensively_copy_and_recursively_freeze_inputs(self):
        original_footprint = self.project.board.footprints["R99"]
        original_component = self.project.schematic.components["R99"]
        pads_input = {"1": list(original_footprint.pads["1"])}
        fields_input = {"Tolerance": "1%"}
        footprint = dataclasses.replace(original_footprint, pads=pads_input)
        component = dataclasses.replace(original_component, fields=fields_input)
        footprints_input = {"R99": footprint}
        components_input = {"R99": component}
        nets_input = {"+3V3": ["R99.1"]}
        edge_input = {
            "type": "gr_poly",
            "nested": {"points": [{"x": 1.0, "y": 2.0}]},
        }
        project = ProjectInventory(
            schematic=SchematicInventory(
                components=components_input,
                nets=nets_input,
            ),
            board=BoardInventory(
                thickness_mm=1.6,
                footprints=footprints_input,
                edge_cuts=(edge_input,),
            ),
        )

        pads_input["1"].clear()
        fields_input["Tolerance"] = "5%"
        footprints_input.clear()
        components_input.clear()
        nets_input["+3V3"].append("R99.2")
        edge_input["nested"]["points"][0]["x"] = 99.0

        self.assertEqual(len(project.board.footprints["R99"].pads["1"]), 1)
        self.assertEqual(project.schematic.components["R99"].fields["Tolerance"], "1%")
        self.assertEqual(tuple(project.schematic.components), ("R99",))
        self.assertEqual(project.schematic.nets["+3V3"], ("R99.1",))
        self.assertEqual(project.board.edge_cuts[0]["nested"]["points"][0]["x"], 1.0)
        with self.assertRaises(TypeError):
            project.board.edge_cuts[0]["nested"]["points"][0]["x"] = 3.0

        detached = inventory_json(project)
        json.dumps(detached, sort_keys=True)
        detached["board"]["edge_cuts"][0]["nested"]["points"][0]["x"] = 7.0
        self.assertEqual(inventory_json(project)["board"]["edge_cuts"][0]["nested"]["points"][0]["x"], 1.0)


class CliTrustBoundaryTest(unittest.TestCase):
    def _fake_executable(self, root: Path, relative: str = "bin/fake-kicad") -> Path:
        executable = root / relative
        executable.parent.mkdir(parents=True, exist_ok=True)
        executable.write_text("#!/bin/sh\n", encoding="utf-8")
        executable.chmod(0o755)
        return executable

    def _version_result(self):
        return mock.Mock(returncode=0, stdout="10.0.4\n", stderr="")

    def _minimal_project(self, root: Path) -> None:
        (root / "toolchain.json").write_text(
            json.dumps(
                {
                    "project": "pocket_card_controller",
                    "kicad": {"major": 10, "minimum": "10.0.4"},
                }
            ),
            encoding="utf-8",
        )
        for suffix in ("pro", "sch", "pcb"):
            (root / f"pocket_card_controller.kicad_{suffix}").write_text(
                "placeholder",
                encoding="utf-8",
            )

    def test_configured_relative_executable_is_resolved_once_before_export_cwd_changes(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            executable = self._fake_executable(root)
            with (
                mock.patch.dict(os.environ, {"KICAD_CLI": "bin/fake-kicad"}),
                mock.patch.object(inventory_module.Path, "cwd", return_value=root),
                mock.patch.object(
                    inventory_module.subprocess,
                    "run",
                    return_value=self._version_result(),
                ),
            ):
                resolved = inventory_module._find_kicad_cli(10, "10.0.4")
            self.assertEqual(resolved, str(executable.resolve()))
            self.assertTrue(Path(resolved).is_absolute())

    def test_configured_command_name_uses_path_lookup_and_missing_command_is_clear(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            executable = self._fake_executable(root, "custom-kicad")

            def successful_lookup(command):
                return str(executable) if command == "custom-kicad" else None

            with (
                mock.patch.dict(os.environ, {"KICAD_CLI": "custom-kicad"}),
                mock.patch.object(inventory_module.shutil, "which", side_effect=successful_lookup),
                mock.patch.object(
                    inventory_module.subprocess,
                    "run",
                    return_value=self._version_result(),
                ),
            ):
                self.assertEqual(
                    inventory_module._find_kicad_cli(10, "10.0.4"),
                    str(executable.resolve()),
                )

            with (
                mock.patch.dict(os.environ, {"KICAD_CLI": "missing-kicad"}),
                mock.patch.object(inventory_module.shutil, "which", return_value=None),
            ):
                with self.assertRaisesRegex(
                    RuntimeError,
                    r"configured KICAD_CLI command 'missing-kicad' was not found on PATH",
                ):
                    inventory_module._find_kicad_cli(10, "10.0.4")

    def test_version_probe_aggregates_oserror_and_timeout_diagnostics(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            executable = self._fake_executable(root, "broken-kicad")
            for failure, expected in (
                (OSError("exec format error"), "exec format error"),
                (
                    subprocess.TimeoutExpired([str(executable), "--version"], 10),
                    "version probe timed out",
                ),
            ):
                with (
                    self.subTest(failure=failure),
                    mock.patch.dict(os.environ, {"KICAD_CLI": str(executable)}),
                    mock.patch.object(
                        inventory_module.subprocess,
                        "run",
                        side_effect=failure,
                    ),
                ):
                    with self.assertRaisesRegex(RuntimeError, expected) as raised:
                        inventory_module._find_kicad_cli(10, "10.0.4")
                    self.assertIn(str(executable.resolve()), str(raised.exception))

    def test_export_wraps_oserror_and_timeout_with_bounded_diagnostics(self):
        failures = (
            (OSError("permission denied"), "KiCad netlist export could not start.*permission denied"),
            (
                subprocess.TimeoutExpired(["fake-kicad", "sch"], 120),
                "KiCad netlist export timed out after 120 seconds",
            ),
        )
        for failure, expected in failures:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temporary_directory:
                root = Path(temporary_directory)
                self._minimal_project(root)
                with (
                    mock.patch.object(
                        inventory_module,
                        "_find_kicad_cli",
                        return_value="/absolute/fake-kicad",
                    ),
                    mock.patch.object(
                        inventory_module.subprocess,
                        "run",
                        side_effect=failure,
                    ),
                ):
                    with self.assertRaisesRegex(RuntimeError, expected):
                        inventory_project(root)


if __name__ == "__main__":
    unittest.main()
