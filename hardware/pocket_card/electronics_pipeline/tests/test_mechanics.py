import dataclasses
import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import hardware.pocket_card.electronics_pipeline.lock_mechanical_items as lock_module
from hardware.pocket_card.electronics_pipeline.inventory import parse_board
from hardware.pocket_card.electronics_pipeline.lock_mechanical_items import (
    LockMigrationRefused,
    lock_mechanical_items,
)
from hardware.pocket_card.electronics_pipeline.mechanics import (
    AllowedOverlap,
    BoardContract,
    ContractError,
    FeatureContract,
    KeepoutContract,
    MechanicalContract,
    MechanicalReviewRequired,
    OutlineContract,
    OutlinePrimitive,
    check_contract_against_case_params,
    check_mechanics,
    load_contract,
)
from hardware.pocket_card.electronics_pipeline.paths import (
    BOARD,
    MECHANICAL_CONTRACT,
    REPO_ROOT,
)


CONTRACTED_REFS = (
    "H1",
    "H2",
    "J_BAT_IN1",
    "J_BAT_OUT1",
    "J_EXP1",
    "J_I2C1",
    "SW_ACTION1",
    "SW_DOWN1",
    "SW_LEFT1",
    "SW_MENU1",
    "SW_MUTE1",
    "SW_PWR1",
    "SW_RESET1",
    "SW_RIGHT1",
    "SW_UNDO1",
    "SW_UP1",
)


def _replace_footprint(board, ref, **changes):
    footprints = dict(board.footprints)
    footprints[ref] = dataclasses.replace(footprints[ref], **changes)
    return dataclasses.replace(board, footprints=footprints)


def _unlocked_canonical_text():
    return BOARD.read_text(encoding="utf-8").replace("\n\t\t(locked yes)", "")


class MechanicalContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = load_contract(MECHANICAL_CONTRACT)
        cls.board = parse_board(BOARD.read_text(encoding="utf-8"))

    def test_checked_in_board_matches_contract_and_case_parameters(self):
        self.assertEqual(check_mechanics(self.contract, self.board), ())
        self.assertEqual(check_contract_against_case_params(self.contract), ())

    def test_contract_is_defensively_immutable(self):
        with self.assertRaises(dataclasses.FrozenInstanceError):
            self.contract.features[0].x_mm = 0
        with self.assertRaises(TypeError):
            self.contract.features_by_ref["H1"] = self.contract.features[0]
        self.assertIsInstance(self.contract.outline.primitives, tuple)

    def test_feature_position_rotation_side_and_lock_drift_are_deterministic(self):
        moved = _replace_footprint(self.board, "H1", x_mm=64.56)
        self.assertTrue(any("H1 moved" in item for item in check_mechanics(self.contract, moved)))

        rotated = _replace_footprint(self.board, "SW_UP1", rotation_deg=359.8)
        self.assertTrue(any("SW_UP1 rotated" in item for item in check_mechanics(self.contract, rotated)))
        wrapped = _replace_footprint(self.board, "SW_UP1", rotation_deg=360.05)
        self.assertFalse(any("rotated" in item for item in check_mechanics(self.contract, wrapped)))

        wrong_side = _replace_footprint(self.board, "J_I2C1", layer="F.Cu")
        self.assertTrue(any("J_I2C1 wrong side" in item for item in check_mechanics(self.contract, wrong_side)))

        unlocked = _replace_footprint(self.board, "SW_ACTION1", locked=False)
        self.assertIn("SW_ACTION1 is not locked", check_mechanics(self.contract, unlocked))

    def test_thickness_missing_reference_and_findings_are_sorted(self):
        footprints = dict(self.board.footprints)
        del footprints["H2"]
        changed = dataclasses.replace(self.board, thickness_mm=1.62, footprints=footprints)
        findings = check_mechanics(self.contract, changed)
        self.assertEqual(findings, tuple(sorted(findings)))
        self.assertTrue(any("board thickness" in item for item in findings), findings)
        self.assertIn("H2 is missing", findings)

    def test_keepout_intrusion_and_unavailable_courtyard_are_findings(self):
        keepout = self.contract.keepouts[0]
        self.assertEqual(tuple(keepout.allowed_overlaps), ("J_BAT_IN1", "J_I2C1"))
        intruding = _replace_footprint(
            self.board,
            "J_EXP1",
            courtyard_bbox_mm=(20.0, 60.0, 21.0, 61.0),
        )
        self.assertTrue(
            any("J_EXP1" in item and "battery keep-out" in item for item in check_mechanics(self.contract, intruding))
        )

        unavailable = _replace_footprint(self.board, "J_EXP1", courtyard_bbox_mm=None)
        self.assertTrue(
            any("J_EXP1" in item and "courtyard unavailable" in item for item in check_mechanics(self.contract, unavailable))
        )

    def test_keepout_allowed_overlap_growth_and_staleness_require_review(self):
        baseline = self.board.footprints["J_I2C1"].courtyard_bbox_mm
        changed_bboxes = {
            "growth": (baseline[0] - 0.001, baseline[1], baseline[2], baseline[3]),
            "shrink": (baseline[0], baseline[1], baseline[2] - 0.001, baseline[3]),
        }
        for label, courtyard_bbox in changed_bboxes.items():
            with self.subTest(label=label):
                changed = _replace_footprint(
                    self.board,
                    "J_I2C1",
                    courtyard_bbox_mm=courtyard_bbox,
                )
                self.assertTrue(
                    any(
                        "J_I2C1" in item and "allowed battery overlap" in item
                        for item in check_mechanics(self.contract, changed)
                    )
                )

        stale = _replace_footprint(
            self.board,
            "J_I2C1",
            courtyard_bbox_mm=(60.0, baseline[1], baseline[2], baseline[3]),
        )
        self.assertTrue(
            any("J_I2C1" in item and "stale" in item for item in check_mechanics(self.contract, stale))
        )

    def test_keepout_boundary_touch_semantics_are_explicit(self):
        keepout = self.contract.keepouts[0]
        self.assertIs(keepout.boundary_touch_is_intrusion, False)
        touching = _replace_footprint(
            self.board,
            "J_EXP1",
            courtyard_bbox_mm=(keepout.x_max_mm, 60.0, keepout.x_max_mm + 1.0, 61.0),
        )
        self.assertFalse(
            any("J_EXP1" in item and "battery keep-out" in item for item in check_mechanics(self.contract, touching))
        )
        entering = _replace_footprint(
            self.board,
            "J_EXP1",
            courtyard_bbox_mm=(keepout.x_max_mm - 0.001, 60.0, keepout.x_max_mm + 1.0, 61.0),
        )
        self.assertTrue(
            any("J_EXP1" in item and "battery keep-out" in item for item in check_mechanics(self.contract, entering))
        )

    def test_outline_endpoint_and_primitive_changes_name_edge_cuts(self):
        first = dict(self.board.edge_cuts[0])
        first["end"] = (first["end"][0] + 0.02, first["end"][1])
        endpoint_drift = dataclasses.replace(self.board, edge_cuts=(first, *self.board.edge_cuts[1:]))
        self.assertTrue(any("Edge.Cuts" in item for item in check_mechanics(self.contract, endpoint_drift)))

        changed_kind = dict(self.board.edge_cuts[0])
        changed_kind["type"] = "gr_line"
        changed_kind.pop("mid")
        primitive_drift = dataclasses.replace(self.board, edge_cuts=(changed_kind, *self.board.edge_cuts[1:]))
        self.assertTrue(any("Edge.Cuts" in item for item in check_mechanics(self.contract, primitive_drift)))

    def test_case_parameter_check_uses_contract_values(self):
        feature = self.contract.features_by_ref["SW_RIGHT1"]
        features = tuple(
            dataclasses.replace(item, x_mm=item.x_mm + 0.1) if item.ref == feature.ref else item
            for item in self.contract.features
        )
        changed = dataclasses.replace(self.contract, features=features)
        findings = check_contract_against_case_params(changed)
        self.assertTrue(any("SW_RIGHT1" in item and "case params" in item for item in findings), findings)

    def test_case_policy_requires_all_features_to_require_locking(self):
        features = tuple(
            dataclasses.replace(feature, locked_required=False)
            if feature.ref == "H1"
            else feature
            for feature in self.contract.features
        )
        contract = dataclasses.replace(self.contract, features=features)
        board = _replace_footprint(self.board, "H1", locked=False)
        mechanical = check_mechanics(contract, board)
        case_policy = check_contract_against_case_params(contract)
        self.assertFalse(mechanical == () and case_policy == ())
        self.assertTrue(any("H1" in item and "lock" in item for item in case_policy), case_policy)

    def test_case_policy_rejects_extra_feature(self):
        extra = dataclasses.replace(
            self.contract.features[0], ref="EXTRA1", rationale="Unapproved feature."
        )
        contract = dataclasses.replace(
            self.contract, features=(*self.contract.features, extra)
        )
        findings = check_contract_against_case_params(contract)
        self.assertTrue(any("feature ref set" in item and "EXTRA1" in item for item in findings), findings)

    def test_case_policy_requires_exact_feature_metadata(self):
        original = self.contract.features_by_ref["H1"]
        cases = {
            "rotation": {"rotation_deg": 1.0},
            "side": {"side": "B.Cu"},
            "xy tolerance": {"xy_tolerance_mm": 1.0},
            "rotation tolerance": {"rotation_tolerance_deg": 1.0},
            "rationale": {"rationale": "A different rationale."},
        }
        for expected_text, changes in cases.items():
            with self.subTest(expected_text=expected_text):
                changed_feature = dataclasses.replace(original, **changes)
                features = tuple(
                    changed_feature if feature.ref == "H1" else feature
                    for feature in self.contract.features
                )
                findings = check_contract_against_case_params(
                    dataclasses.replace(self.contract, features=features)
                )
                self.assertTrue(
                    any("H1" in item and expected_text in item for item in findings),
                    findings,
                )

    def test_case_policy_requires_exact_battery_overlap_ref_set(self):
        battery = self.contract.keepouts[0]
        missing = dict(battery.allowed_overlaps)
        del missing["J_I2C1"]
        third = dataclasses.replace(
            battery.allowed_overlaps["J_I2C1"], ref="J_EXP1"
        )
        cases = {
            "missing": missing,
            "extra": {**battery.allowed_overlaps, "J_EXP1": third},
        }
        for label, overlaps in cases.items():
            with self.subTest(label=label):
                changed_keepout = dataclasses.replace(
                    battery, allowed_overlaps=overlaps
                )
                contract = dataclasses.replace(
                    self.contract, keepouts=(changed_keepout,)
                )
                findings = check_contract_against_case_params(contract)
                self.assertTrue(
                    any("allowed overlap ref set" in item for item in findings),
                    findings,
                )

    def test_case_policy_requires_exact_allowed_overlap_envelopes(self):
        battery = self.contract.keepouts[0]
        baseline = battery.allowed_overlaps["J_I2C1"]
        cases = {
            "courtyard": {
                "courtyard_bbox_mm": (
                    baseline.courtyard_bbox_mm[0] + 0.001,
                    *baseline.courtyard_bbox_mm[1:],
                )
            },
            "intersection": {
                "intersection_bbox_mm": (
                    baseline.intersection_bbox_mm[0] + 0.001,
                    *baseline.intersection_bbox_mm[1:],
                )
            },
            "rationale": {"rationale": "Different review."},
        }
        for label, changes in cases.items():
            with self.subTest(label=label):
                overlap = dataclasses.replace(baseline, **changes)
                keepout = dataclasses.replace(
                    battery,
                    allowed_overlaps={**battery.allowed_overlaps, "J_I2C1": overlap},
                )
                findings = check_contract_against_case_params(
                    dataclasses.replace(self.contract, keepouts=(keepout,))
                )
                self.assertTrue(
                    any("J_I2C1" in item and "envelope or rationale" in item for item in findings),
                    findings,
                )

    def test_case_policy_requires_exactly_one_battery_keepout(self):
        auxiliary = dataclasses.replace(self.contract.keepouts[0], name="auxiliary")
        cases = {
            "missing": (),
            "extra": (*self.contract.keepouts, auxiliary),
        }
        for label, keepouts in cases.items():
            with self.subTest(label=label):
                contract = dataclasses.replace(self.contract, keepouts=keepouts)
                findings = check_contract_against_case_params(contract)
                self.assertTrue(
                    any("exactly one battery keep-out" in item for item in findings),
                    findings,
                )

    def test_case_policy_requires_exact_battery_schema_and_formula(self):
        battery = self.contract.keepouts[0]
        cases = {
            "rectangle": {"kind": "circle"},
            "B.Cu": {"side": "F.Cu"},
            "case params": {"x_min_mm": battery.x_min_mm + 0.001},
            "formula": {"derivation": {**battery.derivation, "xMin": "other"}},
            "boundary": {"boundary_touch_is_intrusion": True},
        }
        for expected_text, changes in cases.items():
            with self.subTest(expected_text=expected_text):
                changed = dataclasses.replace(battery, **changes)
                contract = dataclasses.replace(self.contract, keepouts=(changed,))
                findings = check_contract_against_case_params(contract)
                self.assertTrue(
                    any(expected_text in item for item in findings),
                    findings,
                )

    def test_mechanical_review_required_is_immutable_and_renders_one_per_line(self):
        error = MechanicalReviewRequired(("H1 moved", "Edge.Cuts changed"))
        self.assertEqual(error.findings, ("H1 moved", "Edge.Cuts changed"))
        self.assertEqual(
            str(error),
            "MECHANICAL REVIEW REQUIRED\nH1 moved\nEdge.Cuts changed",
        )
        with self.assertRaises(dataclasses.FrozenInstanceError):
            error.findings = ()


class ContractSchemaTest(unittest.TestCase):
    def setUp(self):
        self.payload = json.loads(MECHANICAL_CONTRACT.read_text(encoding="utf-8"))

    def _load_payload(self, payload):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "contract.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            return load_contract(path)

    def _assert_rejected(self, mutate):
        payload = json.loads(json.dumps(self.payload))
        mutate(payload)
        with self.assertRaises(ContractError):
            self._load_payload(payload)

    def test_rejects_wrong_schema_version_and_root_shape(self):
        for value in (None, 0, 1.0, 2, True, "1"):
            with self.subTest(value=value):
                self._assert_rejected(lambda payload, value=value: payload.__setitem__("schemaVersion", value))
        with self.assertRaises(ContractError):
            self._load_payload([])

    def test_rejects_missing_and_unknown_fields(self):
        self._assert_rejected(lambda payload: payload.pop("outline"))
        self._assert_rejected(lambda payload: payload.__setitem__("surprise", True))
        self._assert_rejected(lambda payload: payload["board"].__setitem__("surprise", True))
        self._assert_rejected(lambda payload: payload["features"][0].pop("rationale"))

    def test_rejects_negative_board_thickness(self):
        self._assert_rejected(
            lambda payload: payload["board"].__setitem__("thicknessMm", -0.001)
        )
        self._assert_rejected(
            lambda payload: payload["board"].__setitem__(
                "thicknessToleranceMm", -0.001
            )
        )

    def test_rejects_huge_numeric_values_as_contract_errors(self):
        payload = json.loads(json.dumps(self.payload))
        payload["features"][0]["xMm"] = 10**400
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "contract.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(ContractError, "finite"):
                load_contract(path)

    def test_rejects_padded_feature_and_overlap_identifiers(self):
        feature_payload = json.loads(json.dumps(self.payload))
        i2c = next(
            feature
            for feature in feature_payload["features"]
            if feature["ref"] == "J_I2C1"
        )
        i2c["ref"] = " J_I2C1 "
        with self.assertRaisesRegex(ContractError, "surrounding whitespace"):
            self._load_payload(feature_payload)

        overlap_payload = json.loads(json.dumps(self.payload))
        overlaps = overlap_payload["keepouts"][0]["allowedOverlaps"]
        overlaps[" J_I2C1 "] = overlaps.pop("J_I2C1")
        with self.assertRaisesRegex(ContractError, "surrounding whitespace"):
            self._load_payload(overlap_payload)

    def test_rejects_invalid_feature_fields(self):
        mutations = (
            lambda p: p["features"][0].__setitem__("ref", ""),
            lambda p: p["features"][1].__setitem__("ref", p["features"][0]["ref"]),
            lambda p: p["features"][0].__setitem__("side", "F.SilkS"),
            lambda p: p["features"][0].__setitem__("lockedRequired", 1),
            lambda p: p["features"][0].__setitem__("rationale", "  "),
            lambda p: p["features"][0].__setitem__("xyToleranceMm", -0.01),
            lambda p: p["features"][0].__setitem__("rotationToleranceDeg", -0.01),
            lambda p: p["features"][0].__setitem__("rotationToleranceDeg", float("nan")),
            lambda p: p["features"][0].__setitem__("xMm", float("inf")),
        )
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                self._assert_rejected(mutate)

    def test_rejects_invalid_outline_primitives(self):
        self._assert_rejected(lambda p: p["outline"]["primitives"][0].__setitem__("kind", "rect"))
        self._assert_rejected(lambda p: p["outline"]["primitives"][0]["points"].append([0, 0]))
        arc_index = next(i for i, item in enumerate(self.payload["outline"]["primitives"]) if item["kind"] == "arc")
        self._assert_rejected(lambda p: p["outline"]["primitives"][arc_index]["points"].pop())
        self._assert_rejected(lambda p: p["outline"].__setitem__("coordinateToleranceMm", -1))

    def test_rejects_invalid_keepout_shape_and_boundary_policy(self):
        self._assert_rejected(lambda p: p["keepouts"][0].__setitem__("side", "F.Fab"))
        self._assert_rejected(lambda p: p["keepouts"][0].__setitem__("kind", "circle"))
        self._assert_rejected(lambda p: p["keepouts"][0].__setitem__("boundaryTouchIsIntrusion", "no"))
        self._assert_rejected(lambda p: p["keepouts"][0]["derivation"].__setitem__("source", ""))
        self._assert_rejected(
            lambda p: p["keepouts"][0]["allowedOverlaps"]["J_I2C1"].__setitem__("rationale", "")
        )
        self._assert_rejected(
            lambda p: p["keepouts"][0]["allowedOverlaps"]["J_I2C1"]["courtyardBboxMm"].pop()
        )
        self._assert_rejected(
            lambda p: p["keepouts"][0]["allowedOverlaps"].__setitem__(
                "U1",
                {
                    "rationale": "not a contracted mechanical feature",
                    "courtyardBboxMm": [0, 0, 1, 1],
                    "intersectionBboxMm": [0, 0, 1, 1],
                },
            )
        )


class ContractConstructorImmutabilityTest(unittest.TestCase):
    def test_direct_constructors_defensively_freeze_nested_inputs(self):
        points = [[1.0, 2.0], [3.0, 4.0]]
        primitive = OutlinePrimitive("line", points)
        primitives = [primitive]
        outline = OutlineContract(0.01, primitives)

        courtyard = [5.0, 6.0, 9.0, 10.0]
        intersection = [5.0, 6.0, 7.0, 8.0]
        overlap = AllowedOverlap(
            "J_I2C1", "Reviewed overlap.", courtyard, intersection
        )
        derivation = {"source": "case params"}
        overlaps = {"J_I2C1": overlap}
        keepout = KeepoutContract(
            "battery",
            "rectangle",
            "B.Cu",
            0.0,
            0.0,
            7.0,
            8.0,
            False,
            derivation,
            overlaps,
        )
        feature = FeatureContract(
            "J_I2C1", 1.0, 2.0, 0.0, "B.Cu", 0.05, 0.1, True, "Fixed."
        )
        features = [feature]
        keepouts = [keepout]
        contract = MechanicalContract(
            1, BoardContract(1.6, 0.01), outline, features, keepouts
        )

        points[0][0] = 99.0
        points.append([11.0, 12.0])
        primitives.clear()
        courtyard[0] = 99.0
        intersection.append(99.0)
        derivation["source"] = "mutated"
        overlaps.clear()
        features.clear()
        keepouts.clear()

        self.assertEqual(primitive.points, ((1.0, 2.0), (3.0, 4.0)))
        self.assertEqual(outline.primitives, (primitive,))
        self.assertEqual(overlap.courtyard_bbox_mm, (5.0, 6.0, 9.0, 10.0))
        self.assertEqual(overlap.intersection_bbox_mm, (5.0, 6.0, 7.0, 8.0))
        self.assertEqual(dict(keepout.derivation), {"source": "case params"})
        self.assertEqual(tuple(keepout.allowed_overlaps), ("J_I2C1",))
        self.assertEqual(contract.features, (feature,))
        self.assertEqual(contract.keepouts, (keepout,))
        with self.assertRaises(TypeError):
            primitive.points[0][0] = 0.0
        with self.assertRaises(TypeError):
            keepout.allowed_overlaps["J_I2C1"] = overlap


class LockMechanicalItemsTest(unittest.TestCase):
    def _temporary_board(self, text=None):
        temporary = tempfile.TemporaryDirectory()
        path = Path(temporary.name) / BOARD.name
        path.write_text(text if text is not None else _unlocked_canonical_text(), encoding="utf-8")
        self.addCleanup(temporary.cleanup)
        return path

    def _temporary_board_bytes(self, payload):
        temporary = tempfile.TemporaryDirectory()
        path = Path(temporary.name) / BOARD.name
        path.write_bytes(payload)
        self.addCleanup(temporary.cleanup)
        return path

    def test_migration_is_exact_and_idempotent(self):
        path = self._temporary_board()
        original_text = path.read_text(encoding="utf-8")
        fsync_kinds = []
        real_fsync = os.fsync

        def tracking_fsync(file_descriptor):
            fsync_kinds.append(stat.S_ISDIR(os.fstat(file_descriptor).st_mode))
            return real_fsync(file_descriptor)

        with mock.patch.object(lock_module.os, "fsync", side_effect=tracking_fsync):
            first = lock_mechanical_items(path, MECHANICAL_CONTRACT)
        self.assertEqual(first, "locked 16 footprints and 10 Edge.Cuts items")
        self.assertIn(True, fsync_kinds, "migration must fsync its parent directory")
        locked_text = path.read_text(encoding="utf-8")
        self.assertEqual(locked_text.count("\n\t\t(locked yes)"), 26)
        self.assertEqual(locked_text.replace("\n\t\t(locked yes)", ""), original_text)
        self.assertTrue(all(parse_board(locked_text).footprints[ref].locked for ref in CONTRACTED_REFS))

        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        second = lock_mechanical_items(path, MECHANICAL_CONTRACT)
        self.assertEqual(second, "already locked")
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)

    def test_migration_preserves_crlf_and_non_ascii_prefix_bytes(self):
        text = _unlocked_canonical_text().replace(
            "(kicad_pcb\n",
            "(kicad_pcb\n\t# mécanique 🧩 before all edited blocks\n",
            1,
        )
        original = text.replace("\n", "\r\n").encode("utf-8")
        path = self._temporary_board_bytes(original)

        first = lock_mechanical_items(path, MECHANICAL_CONTRACT)
        self.assertEqual(first, "locked 16 footprints and 10 Edge.Cuts items")
        migrated = path.read_bytes()
        lock_line = b"\r\n\t\t(locked yes)"
        self.assertEqual(migrated.count(lock_line), 26)
        self.assertEqual(migrated.replace(lock_line, b""), original)
        self.assertNotIn(b"\n", migrated.replace(b"\r\n", b""))

        digest = hashlib.sha256(migrated).hexdigest()
        self.assertEqual(lock_mechanical_items(path, MECHANICAL_CONTRACT), "already locked")
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)

    def test_migration_refuses_mixed_newlines_without_writing(self):
        mixed = _unlocked_canonical_text().replace("\n", "\r\n", 1).encode("utf-8")
        path = self._temporary_board_bytes(mixed)
        before = path.read_bytes()
        with self.assertRaisesRegex(LockMigrationRefused, "newline convention"):
            lock_mechanical_items(path, MECHANICAL_CONTRACT)
        self.assertEqual(path.read_bytes(), before)

    def test_migration_rejects_board_symlink_without_following_or_writing(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        directory = Path(temporary.name)
        target = directory / "target.kicad_pcb"
        target.write_bytes(_unlocked_canonical_text().encode("utf-8"))
        link = directory / BOARD.name
        link.symlink_to(target.name)
        before = target.read_bytes()
        with self.assertRaisesRegex(LockMigrationRefused, "symlink"):
            lock_mechanical_items(link, MECHANICAL_CONTRACT)
        self.assertTrue(link.is_symlink())
        self.assertEqual(target.read_bytes(), before)

    def test_migration_refuses_pre_replace_identity_swap_and_cleans_temp(self):
        path = self._temporary_board()
        replacement = path.with_name("replacement.kicad_pcb")
        replacement_payload = b"external replacement"
        replacement.write_bytes(replacement_payload)

        def swap_destination(destination):
            os.replace(replacement, destination)

        caught = None
        try:
            lock_mechanical_items(
                path,
                MECHANICAL_CONTRACT,
                _before_replace=swap_destination,
            )
        except Exception as error:
            caught = error
        self.assertIsInstance(caught, LockMigrationRefused)
        self.assertIn("changed since it was read", str(caught))
        self.assertEqual(path.read_bytes(), replacement_payload)
        self.assertEqual(tuple(path.parent.glob(f".{path.name}.*.tmp")), ())

    def test_migration_refuses_same_inode_in_place_rewrite_and_preserves_it(self):
        path = self._temporary_board()
        original_inode = path.stat().st_ino
        concurrent_payload = b"concurrent same-inode board rewrite"

        def rewrite_destination_in_place(destination):
            destination.write_bytes(concurrent_payload)
            self.assertEqual(destination.stat().st_ino, original_inode)

        caught = None
        try:
            lock_mechanical_items(
                path,
                MECHANICAL_CONTRACT,
                _before_replace=rewrite_destination_in_place,
            )
        except Exception as error:
            caught = error
        self.assertIsInstance(caught, LockMigrationRefused)
        self.assertIn("changed since it was read", str(caught))
        self.assertEqual(path.read_bytes(), concurrent_payload)
        self.assertEqual(tuple(path.parent.glob(f".{path.name}.*.tmp")), ())

    def test_atomic_write_orders_permissions_and_durability_barriers(self):
        path = self._temporary_board()
        events = []
        real_fchmod = os.fchmod
        real_fsync = os.fsync
        real_replace = os.replace

        def tracking_fchmod(file_descriptor, mode):
            events.append("fchmod")
            return real_fchmod(file_descriptor, mode)

        def tracking_fsync(file_descriptor):
            kind = (
                "directory fsync"
                if stat.S_ISDIR(os.fstat(file_descriptor).st_mode)
                else "file fsync"
            )
            events.append(kind)
            return real_fsync(file_descriptor)

        def tracking_replace(source, destination):
            events.append("replace")
            return real_replace(source, destination)

        with (
            mock.patch.object(
                lock_module.os, "fchmod", side_effect=tracking_fchmod
            ),
            mock.patch.object(lock_module.os, "fsync", side_effect=tracking_fsync),
            mock.patch.object(
                lock_module.os, "replace", side_effect=tracking_replace
            ),
        ):
            lock_mechanical_items(path, MECHANICAL_CONTRACT)

        self.assertLess(events.index("fchmod"), events.index("file fsync"), events)
        self.assertLess(events.index("file fsync"), events.index("replace"), events)
        self.assertLess(events.index("replace"), events.index("directory fsync"), events)

    def test_directory_fsync_failure_reports_replaced_but_not_durable(self):
        path = self._temporary_board()
        real_fsync = os.fsync

        def fail_directory_fsync(file_descriptor):
            if stat.S_ISDIR(os.fstat(file_descriptor).st_mode):
                raise OSError("injected directory fsync failure")
            return real_fsync(file_descriptor)

        caught = None
        with mock.patch.object(
            lock_module.os, "fsync", side_effect=fail_directory_fsync
        ):
            try:
                lock_mechanical_items(path, MECHANICAL_CONTRACT)
            except Exception as error:
                caught = error
        self.assertIsInstance(caught, RuntimeError)
        self.assertIn("replaced", str(caught))
        self.assertIn("durability", str(caught))
        migrated = parse_board(path.read_text(encoding="utf-8"))
        self.assertTrue(all(migrated.footprints[ref].locked for ref in CONTRACTED_REFS))

    def test_unicode_diagnostic_reports_character_index_not_byte_offset(self):
        source = '🧩é(item (layer "F.Cu") (layer "B.Cu"))'
        with self.assertRaises(LockMigrationRefused) as raised:
            lock_module._child_atoms(source, 2, len(source), "layer", 3)
        message = str(raised.exception)
        self.assertIn("character index 2", message)
        self.assertNotIn("byte", message)

    def test_migration_refuses_non_lock_mechanical_drift_without_writing(self):
        text = _unlocked_canonical_text().replace("\n\t\t(at 64.5 56)", "\n\t\t(at 64.6 56)", 1)
        path = self._temporary_board(text)
        before = path.read_bytes()
        with self.assertRaisesRegex(LockMigrationRefused, "H1 moved"):
            lock_mechanical_items(path, MECHANICAL_CONTRACT)
        self.assertEqual(path.read_bytes(), before)

    def test_migration_refuses_invalid_or_conflicting_lock_state_without_writing(self):
        text = _unlocked_canonical_text().replace(
            '\n\t\t(layer "F.Cu")',
            '\n\t\t(layer "F.Cu")\n\t\t(locked maybe)',
            1,
        )
        path = self._temporary_board(text)
        before = path.read_bytes()
        with self.assertRaisesRegex(LockMigrationRefused, "invalid lock state"):
            lock_mechanical_items(path, MECHANICAL_CONTRACT)
        self.assertEqual(path.read_bytes(), before)

        standalone_conflict = _unlocked_canonical_text().replace(
            '(footprint "SW_SPST_SKQG_WithStem"',
            '(footprint "SW_SPST_SKQG_WithStem" locked no',
            1,
        )
        path = self._temporary_board(standalone_conflict)
        before = path.read_bytes()
        with self.assertRaisesRegex(LockMigrationRefused, "invalid lock state"):
            lock_mechanical_items(path, MECHANICAL_CONTRACT)
        self.assertEqual(path.read_bytes(), before)

    def test_cli_rejects_drift_nonzero_and_preserves_bytes(self):
        text = _unlocked_canonical_text()
        self.assertEqual(text.count("\n\t\t(at 64.5 84)"), 1)
        text = text.replace("\n\t\t(at 64.5 84)", "\n\t\t(at 64.7 84)", 1)
        path = self._temporary_board(text)
        before = path.read_bytes()
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "hardware.pocket_card.electronics_pipeline.lock_mechanical_items",
                str(path),
            ],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("H2 moved", result.stderr)
        self.assertEqual(path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
