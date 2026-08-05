import ast
import copy
import json
import os
import sys
import tempfile
import types
import unittest
from unittest import mock


HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

try:
    import pcb_connectivity as C
except ModuleNotFoundError:
    C = None

import pcb
import pcb_route


def parse_sexpr(source):
    """Parse the small S-expression subset needed to inspect generated PCB."""
    tokens = []
    i = 0
    while i < len(source):
        ch = source[i]
        if ch.isspace():
            i += 1
        elif ch in "()":
            tokens.append(ch)
            i += 1
        elif ch == '"':
            start = i
            i += 1
            while i < len(source):
                if source[i] == "\\":
                    i += 2
                elif source[i] == '"':
                    i += 1
                    break
                else:
                    i += 1
            tokens.append(source[start + 1:i - 1])
        else:
            start = i
            while i < len(source) and not source[i].isspace() and source[i] not in "()":
                i += 1
            tokens.append(source[start:i])

    def parse_at(index):
        if tokens[index] != "(":
            return tokens[index], index + 1
        result = []
        index += 1
        while tokens[index] != ")":
            item, index = parse_at(index)
            result.append(item)
        return result, index + 1

    result, next_index = parse_at(0)
    if next_index != len(tokens):
        raise ValueError("trailing tokens in PCB S-expression")
    return result


class FakePad:
    def __init__(self, name):
        self.name = str(name)
        self.assigned_net = None

    def GetPadName(self):
        return self.name

    def SetNet(self, assigned_net):
        self.assigned_net = assigned_net


class FakeFootprint:
    def __init__(self, ref, pad_names):
        self.ref = ref
        self.pads = [FakePad(name) for name in pad_names]

    def GetReference(self):
        return self.ref

    def Pads(self):
        return list(self.pads)


class FakeNet:
    def __init__(self, _board, name):
        self.name = name


class FakeBoard:
    def __init__(self, footprints=None):
        self.nets = {}
        self.footprints = list(footprints or [])

    def FindNet(self, name):
        return self.nets.get(name)

    def Add(self, item):
        self.nets[item.name] = item

    def GetFootprints(self):
        return list(self.footprints)


def fake_footprints():
    pad_names = {}
    for ref, pad in C.pad_net_map():
        pad_names.setdefault(ref, []).append(pad)
    for rule in C.board_only_rules():
        pad_names.setdefault(rule["ref"], []).append(rule["pad"])

    # Physical libraries deliberately contain duplicated logical pad names.
    pad_names["SW_UP"].extend(["1", "2"])
    pad_names["J_I2C"].append("MP")
    pad_names["SW_MUTE"].append("")
    # These canonical no-connect/unmodeled pads must be left untouched.
    pad_names["U1"].append("2")
    pad_names["J_EXP"].append("2")
    pad_names["SW_PWR"].append("3")

    return {
        item["ref"]: FakeFootprint(item["ref"], pad_names.get(item["ref"], []))
        for item in C.model()["components"]
    }


class ConnectivityAdapterTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(C, "pcb_connectivity module is required")

    def test_expander_signal_assignments_are_canonical(self):
        pads = C.pad_net_map()
        self.assertEqual(pads[("U1", "1")], "SIG_UP")
        self.assertEqual(pads[("U1", "21")], "SIG_DOWN")
        self.assertEqual(pads[("U1", "28")], "SIG_ACTION")

    def test_switch_common_connector_power_and_mute_assignments(self):
        pads = C.pad_net_map()
        expected_switches = {
            "SW_UP": "SIG_UP", "SW_DOWN": "SIG_DOWN",
            "SW_LEFT": "SIG_LEFT", "SW_RIGHT": "SIG_RIGHT",
            "SW_UNDO": "SIG_UNDO", "SW_ACTION": "SIG_ACTION",
            "SW_RESET": "SIG_RESET", "SW_MENU": "SIG_MENU",
        }
        for ref, signal in expected_switches.items():
            self.assertEqual(pads[(ref, "1")], signal, ref)
            self.assertEqual(pads[(ref, "2")], "GND", ref)
        self.assertEqual(pads[("J_I2C", "MP")], "GND")
        self.assertEqual(pads[("J_EXP", "MP")], "GND")
        self.assertEqual(pads[("J_BAT_IN", "MP")], "GND")
        self.assertEqual(pads[("J_BAT_OUT", "MP")], "GND")
        self.assertEqual(pads[("SW_PWR", "1")], "BAT_SW")
        self.assertEqual(pads[("SW_PWR", "2")], "BAT_P")
        self.assertEqual(pads[("SW_MUTE", "1")], "SIG_MUTE")
        self.assertEqual(pads[("SW_MUTE", "2")], "GND")
        self.assertEqual(pads[("SW_MUTE", "3")], "GND")

    def test_component_uuid_matches_model(self):
        expected = next(item["uuid"] for item in C.model()["components"]
                        if item["ref"] == "U1")
        self.assertEqual(C.component_uuid("U1"), expected)

    def test_component_and_assignment_lookup_errors_name_the_bad_ref(self):
        with self.assertRaisesRegex(KeyError, "unknown component reference.*MISSING"):
            C.component("MISSING")
        with self.assertRaisesRegex(KeyError, "unknown component reference.*MISSING"):
            C.assignments_for("MISSING")

    def test_assignments_and_board_only_rules_are_filtered_from_model(self):
        self.assertEqual(C.assignments_for("SW_PWR"), {
            "1": "BAT_SW", "2": "BAT_P",
        })
        self.assertEqual(C.assignments_for("H1"), {})
        self.assertEqual(C.board_only_rules(), [{
            "ref": "SW_MUTE", "pad": "", "net": "GND",
            "reason": "existing mechanical-pad grounding",
        }])

    def test_returned_values_cannot_mutate_cached_canonical_data(self):
        model = C.model()
        model["components"][0]["uuid"] = "mutated"
        component = C.component("U1")
        component["uuid"] = "mutated"
        pads = C.pad_net_map()
        pads[("U1", "1")] = "mutated"
        rules = C.board_only_rules()
        rules[0]["net"] = "mutated"

        self.assertEqual(C.component_uuid("U1"),
                         "f2abe43b-79ce-4f91-a34f-27e849a4046d")
        self.assertEqual(C.pad_net_map()[("U1", "1")], "SIG_UP")
        self.assertEqual(C.board_only_rules()[0]["net"], "GND")

    def assert_model_invalid(self, candidate, pattern):
        self.assertTrue(hasattr(C, "_load_model"),
                        "pcb_connectivity needs a testable validated loader")
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "connectivity.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(candidate, handle)
            with self.assertRaisesRegex(ValueError, pattern) as caught:
                C._load_model(path)
            self.assertIn(path, str(caught.exception))

    def test_consumed_top_level_fields_are_required_with_exact_shapes(self):
        wrong_shapes = {
            "components": {},
            "connections": {},
            "noConnects": [],
            "boardOnlyPadRules": {},
        }
        for field, wrong_shape in wrong_shapes.items():
            with self.subTest(field=field, problem="missing"):
                candidate = C.model()
                del candidate[field]
                self.assert_model_invalid(candidate, field + ".*required")
            with self.subTest(field=field, problem="shape"):
                candidate = C.model()
                candidate[field] = wrong_shape
                self.assert_model_invalid(candidate, field + ".*must be")

    def test_component_identity_fields_are_required_nonempty_strings(self):
        fields = ("ref", "value", "footprint", "uuid", "symbol")
        for field in fields:
            with self.subTest(field=field, problem="missing"):
                candidate = C.model()
                del candidate["components"][0][field]
                self.assert_model_invalid(candidate,
                                          r"components\[0\]\.%s.*required" % field)
            for bad_value in (None, ""):
                with self.subTest(field=field, value=bad_value):
                    candidate = C.model()
                    candidate["components"][0][field] = bad_value
                    self.assert_model_invalid(
                        candidate, r"components\[0\]\.%s.*nonempty string" % field)

    def test_duplicate_component_refs_and_uuids_are_rejected(self):
        candidate = C.model()
        candidate["components"][1]["ref"] = candidate["components"][0]["ref"]
        self.assert_model_invalid(candidate, "duplicate component ref.*U1")

        candidate = C.model()
        candidate["components"][1]["uuid"] = candidate["components"][0]["uuid"]
        self.assert_model_invalid(candidate, "duplicate component UUID")

    def test_connection_records_and_nodes_reject_ambiguous_input(self):
        candidate = C.model()
        candidate["connections"][1]["net"] = candidate["connections"][0]["net"]
        self.assert_model_invalid(candidate, "duplicate connection net.*\\+3V3")

        candidate = C.model()
        candidate["connections"][0]["nodes"][0] = ["U1"]
        self.assert_model_invalid(candidate, r"connections\[0\]\.nodes\[0\].*pair")

        candidate = C.model()
        candidate["connections"][0]["nodes"][0] = ["U1", 9]
        self.assert_model_invalid(candidate,
                                  r"connections\[0\]\.nodes\[0\].*strings")

        candidate = C.model()
        candidate["connections"][0]["nodes"][0][0] = "MISSING"
        self.assert_model_invalid(candidate, "unknown component ref.*MISSING")

    def test_every_connection_has_at_least_two_nodes(self):
        for nodes in ([], [["U1", "9"]]):
            with self.subTest(nodes=nodes):
                candidate = C.model()
                candidate["connections"][0]["nodes"] = nodes
                self.assert_model_invalid(
                    candidate, r"connections\[0\]\.nodes.*at least two")

    def test_duplicate_endpoints_are_rejected_on_same_or_conflicting_nets(self):
        candidate = C.model()
        candidate["connections"][0]["nodes"].append(["U1", "9"])
        self.assert_model_invalid(candidate, "duplicate endpoint.*U1.*9.*\\+3V3")

        candidate = C.model()
        candidate["connections"][1]["nodes"].append(["U1", "9"])
        self.assert_model_invalid(
            candidate, "endpoint.*U1.*9.*both.*\\+3V3.*GND")

    def test_no_connects_are_shaped_and_cannot_collide_with_connections(self):
        candidate = C.model()
        candidate["noConnects"]["U1"] = "2"
        self.assert_model_invalid(candidate, "noConnects.U1.*must be a list")

        candidate = C.model()
        candidate["noConnects"]["U1"].append("2")
        self.assert_model_invalid(candidate, "duplicate no-connect.*U1.*2")

        candidate = C.model()
        candidate["noConnects"]["U1"].append("9")
        self.assert_model_invalid(candidate, "U1.*9.*connected.*no-connect")

    def test_board_only_rules_require_typed_fields_known_refs_and_unique_targets(self):
        fields = ("ref", "pad", "net", "reason")
        for field in fields:
            candidate = C.model()
            del candidate["boardOnlyPadRules"][0][field]
            self.assert_model_invalid(
                candidate, r"boardOnlyPadRules\[0\]\.%s.*required" % field)

        candidate = C.model()
        candidate["boardOnlyPadRules"][0]["net"] = None
        self.assert_model_invalid(
            candidate, r"boardOnlyPadRules\[0\]\.net.*string")

        candidate = C.model()
        candidate["boardOnlyPadRules"][0]["ref"] = "MISSING"
        self.assert_model_invalid(candidate, "board-only.*unknown component.*MISSING")

        candidate = C.model()
        candidate["boardOnlyPadRules"][0].update({
            "ref": "U1", "pad": "9", "net": "+3V3",
        })
        self.assert_model_invalid(candidate, "board-only.*U1.*9.*already connected")

        candidate = C.model()
        candidate["boardOnlyPadRules"].append(
            copy.deepcopy(candidate["boardOnlyPadRules"][0]))
        self.assert_model_invalid(candidate, "duplicate board-only.*SW_MUTE.*empty")

    def test_structurally_valid_board_only_rules_remain_data_driven(self):
        candidates = [C.model(), C.model()]
        candidates[0]["boardOnlyPadRules"] = []
        candidates[1]["boardOnlyPadRules"] = [{
            "ref": "H1", "pad": "MECH", "net": "CHASSIS",
            "reason": "alternate structurally valid board-only rule",
        }]

        for candidate in candidates:
            with tempfile.TemporaryDirectory() as directory:
                path = os.path.join(directory, "connectivity.json")
                with open(path, "w", encoding="utf-8") as handle:
                    json.dump(candidate, handle)
                self.assertEqual(
                    C._load_model(path)["boardOnlyPadRules"],
                    candidate["boardOnlyPadRules"],
                )

    def test_adapter_has_no_hand_coded_board_only_electrical_mapping(self):
        with open(C.__file__, encoding="utf-8") as handle:
            source = handle.read()
        self.assertNotIn('"SW_MUTE"', source)
        self.assertNotIn('"GND"', source)


class HeadlessFootprintUuidTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(C, "pcb_connectivity module is required")

    def test_build_sexpr_uses_all_17_canonical_top_level_footprint_uuids(self):
        fixture = """(footprint "Fixture"
\t(version 20260206)
\t(generator "pcbnew")
\t(generator_version "10.0")
\t(layer "F.Cu")
\t(uuid "00000000-0000-4000-8000-000000000000")
\t(property "Reference" "REF**"
\t\t(at 0 0 0)
\t\t(layer "F.SilkS")
\t\t(uuid "11111111-1111-4111-8111-111111111111")
\t)
\t(property "Value" "Fixture"
\t\t(at 0 1 0)
\t\t(layer "F.Fab")
\t\t(uuid "22222222-2222-4222-8222-222222222222")
\t)
\t(pad "1" smd rect
\t\t(at 0 0)
\t\t(size 1 1)
\t\t(layers "F.Cu" "F.Paste" "F.Mask")
\t\t(uuid "33333333-3333-4333-8333-333333333333")
\t)
)"""
        with tempfile.NamedTemporaryFile("w", suffix=".kicad_mod") as handle:
            handle.write(fixture)
            handle.flush()
            fake_silk = types.SimpleNamespace(silk_sexpr=lambda: "")
            generated = iter("generated-%04d" % i for i in range(10000))
            with mock.patch.object(pcb, "_mod_path", return_value=handle.name), \
                    mock.patch.object(pcb, "_uid", side_effect=lambda: next(generated)), \
                    mock.patch.dict(sys.modules, {"silk": fake_silk}):
                source, placed = pcb.build_sexpr()

        tree = parse_sexpr(source)
        footprints = [item for item in tree[1:]
                      if isinstance(item, list) and item and item[0] == "footprint"]
        self.assertEqual(len(footprints), 17)
        self.assertEqual(len(placed), 17)

        actual = {}
        for footprint in footprints:
            refs = [item[2] for item in footprint[2:]
                    if isinstance(item, list) and item[:2] == ["property", "Reference"]]
            direct_uuids = [item[1] for item in footprint[2:]
                            if isinstance(item, list) and item[0] == "uuid"]
            self.assertEqual(len(refs), 1)
            self.assertEqual(len(direct_uuids), 1, refs[0])
            actual[refs[0]] = direct_uuids[0]

            nested_uuids = []
            stack = [item for item in footprint[2:]
                     if not (isinstance(item, list) and item and item[0] == "uuid")]
            while stack:
                item = stack.pop()
                if isinstance(item, list):
                    if item and item[0] == "uuid":
                        nested_uuids.append(item[1])
                    else:
                        stack.extend(item[1:])
            self.assertGreaterEqual(len(nested_uuids), 3)
            self.assertNotIn(C.component_uuid(refs[0]), nested_uuids)

        expected = {item["ref"]: item["uuid"]
                    for item in C.model()["components"]}
        self.assertEqual(actual, expected)


class OptionalPcbnewUuidTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(C, "pcb_connectivity module is required")

    def test_supported_set_uuid_api_receives_a_kiid(self):
        class Footprint:
            value = None

            def SetUuid(self, value):
                self.value = value

        fake_pcbnew = types.SimpleNamespace(KIID=lambda text: ("KIID", text))
        footprint = Footprint()
        pcb.set_footprint_uuid(footprint, "U1", fake_pcbnew)
        self.assertEqual(footprint.value, ("KIID", C.component_uuid("U1")))

    def test_supported_set_uppercase_uuid_api_receives_a_kiid(self):
        class Footprint:
            value = None

            def SetUUID(self, value):
                self.value = value

        fake_pcbnew = types.SimpleNamespace(KIID=lambda text: ("KIID", text))
        footprint = Footprint()
        pcb.set_footprint_uuid(footprint, "SW_UP", fake_pcbnew)
        self.assertEqual(footprint.value, ("KIID", C.component_uuid("SW_UP")))

    def test_missing_uuid_setter_fails_before_a_board_can_be_returned(self):
        fake_pcbnew = types.SimpleNamespace(KIID=lambda text: ("KIID", text))
        with self.assertRaisesRegex(RuntimeError, "U1.*SetUuid.*SetUUID"):
            pcb.set_footprint_uuid(object(), "U1", fake_pcbnew)

    def test_missing_kiid_constructor_fails_before_a_board_can_be_returned(self):
        footprint = types.SimpleNamespace(SetUuid=lambda _value: None)
        with self.assertRaisesRegex(RuntimeError, "U1.*pcbnew.KIID.*unavailable"):
            pcb.set_footprint_uuid(footprint, "U1", types.SimpleNamespace())


class ApplyConnectivityTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(C, "pcb_connectivity module is required")
        self.fake_pcbnew = types.SimpleNamespace(NETINFO_ITEM=FakeNet)

    def apply(self, footprints):
        board = FakeBoard()
        with mock.patch.dict(sys.modules, {"pcbnew": self.fake_pcbnew}):
            nets = pcb_route.apply_connectivity(board, footprints)
        return board, nets

    def test_all_canonical_assignments_apply_to_every_duplicate_physical_pad(self):
        footprints = fake_footprints()
        board, nets = self.apply(footprints)

        self.assertEqual(set(nets), set(C.pad_net_map().values()) | {"GND"})
        self.assertEqual(set(board.nets), set(nets))
        for (ref, pad_name), net_name in C.pad_net_map().items():
            matches = [pad for pad in footprints[ref].pads if pad.name == pad_name]
            self.assertGreaterEqual(len(matches), 1)
            self.assertTrue(all(pad.assigned_net is nets[net_name] for pad in matches),
                            "%s.%s" % (ref, pad_name))

        self.assertEqual(len([pad for pad in footprints["SW_UP"].pads
                              if pad.name == "1"]), 2)
        self.assertEqual(len([pad for pad in footprints["J_I2C"].pads
                              if pad.name == "MP"]), 2)
        self.assertTrue(all(pad.assigned_net is nets["GND"]
                            for pad in footprints["SW_MUTE"].pads
                            if pad.name == ""))

    def test_u1_uses_exact_fixed_canonical_mapping(self):
        footprints = fake_footprints()
        _board, nets = self.apply(footprints)
        assigned = {pad.name: pad.assigned_net.name
                    for pad in footprints["U1"].pads if pad.assigned_net is not None}
        self.assertEqual(assigned, C.assignments_for("U1"))
        self.assertEqual(assigned["1"], "SIG_UP")
        self.assertEqual(assigned["21"], "SIG_DOWN")
        self.assertEqual(assigned["28"], "SIG_ACTION")
        self.assertIsNotNone(nets["SIG_UP"])

    def test_unmodeled_and_no_connect_pads_remain_exactly_untouched(self):
        footprints = fake_footprints()
        sentinel = FakeNet(None, "EXISTING_UNMODELED_NET")
        untouched = []
        for ref, pad_name in (("U1", "2"), ("J_EXP", "2"), ("SW_PWR", "3")):
            pad = next(pad for pad in footprints[ref].pads if pad.name == pad_name)
            pad.assigned_net = sentinel
            untouched.append((ref, pad_name, pad))
        self.apply(footprints)
        for ref, pad_name, pad in untouched:
            self.assertIs(pad.assigned_net, sentinel, "%s.%s" % (ref, pad_name))

    def test_missing_footprint_error_names_the_reference(self):
        footprints = fake_footprints()
        del footprints["SW_UP"]
        with self.assertRaisesRegex(KeyError, "missing footprint.*SW_UP"):
            self.apply(footprints)

    def test_missing_connected_pad_error_names_reference_and_pad(self):
        footprints = fake_footprints()
        footprints["U1"].pads = [pad for pad in footprints["U1"].pads
                                  if pad.name != "1"]
        with self.assertRaisesRegex(KeyError, "U1.*pad.*1"):
            self.apply(footprints)

    def test_missing_board_only_pad_error_names_reference_and_empty_pad(self):
        footprints = fake_footprints()
        footprints["SW_MUTE"].pads = [pad for pad in footprints["SW_MUTE"].pads
                                       if pad.name != ""]
        with self.assertRaisesRegex(KeyError, "SW_MUTE.*empty.*pad"):
            self.apply(footprints)

    def test_preflight_error_leaves_every_net_and_pad_unchanged(self):
        footprints = fake_footprints()
        footprints["SW_MUTE"].pads = [pad for pad in footprints["SW_MUTE"].pads
                                       if pad.name != ""]
        board = FakeBoard()
        before = [(pad, pad.assigned_net) for footprint in footprints.values()
                  for pad in footprint.pads]
        with mock.patch.dict(sys.modules, {"pcbnew": self.fake_pcbnew}):
            with self.assertRaisesRegex(KeyError, "SW_MUTE.*empty.*pad"):
                pcb_route.apply_connectivity(board, footprints)
        self.assertEqual(board.nets, {})
        for pad, assigned_net in before:
            self.assertIs(pad.assigned_net, assigned_net, pad.name)

    def test_preflight_requires_every_canonical_component_before_mutating(self):
        footprints = fake_footprints()
        del footprints["H1"]
        board = FakeBoard()
        before = [(pad, pad.assigned_net) for footprint in footprints.values()
                  for pad in footprint.pads]
        with mock.patch.dict(sys.modules, {"pcbnew": self.fake_pcbnew}):
            with self.assertRaisesRegex(KeyError, "missing footprint.*H1"):
                pcb_route.apply_connectivity(board, footprints)
        self.assertEqual(board.nets, {})
        for pad, assigned_net in before:
            self.assertIs(pad.assigned_net, assigned_net, pad.name)


class FootprintIndexTests(unittest.TestCase):
    def test_unique_references_are_indexed_without_loss(self):
        self.assertTrue(hasattr(pcb_route, "footprints_by_reference"),
                        "router needs a duplicate-safe footprint index helper")
        footprints = [FakeFootprint("U1", []), FakeFootprint("SW_UP", [])]
        indexed = pcb_route.footprints_by_reference(
            FakeBoard(footprints).GetFootprints())
        self.assertEqual(indexed, {"U1": footprints[0], "SW_UP": footprints[1]})

    def test_duplicate_reference_is_rejected_actionably(self):
        self.assertTrue(hasattr(pcb_route, "footprints_by_reference"),
                        "router needs a duplicate-safe footprint index helper")
        footprints = [FakeFootprint("U1", []), FakeFootprint("U1", [])]
        with self.assertRaisesRegex(ValueError, "duplicate footprint reference.*U1"):
            pcb_route.footprints_by_reference(FakeBoard(footprints).GetFootprints())

    def test_geometry_allocator_names_and_behavior_are_gone(self):
        with open(pcb_route.__file__, encoding="utf-8") as handle:
            source = handle.read()
        tree = ast.parse(source)
        assigned_names = {
            target.id
            for node in ast.walk(tree) if isinstance(node, ast.Assign)
            for target in node.targets if isinstance(target, ast.Name)
        }
        function_names = {node.name for node in ast.walk(tree)
                          if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
        self.assertNotIn("GPIO", assigned_names)
        self.assertNotIn("SWITCHES", assigned_names)
        self.assertNotIn("pad_of", function_names)
        self.assertNotIn("math.hypot", source)
        self.assertNotIn("chosen by geometry", source)


if __name__ == "__main__":
    unittest.main()
