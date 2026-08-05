import dataclasses
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from hardware.pocket_card.electronics_pipeline.inventory import parse_board
from hardware.pocket_card.electronics_pipeline.lock_mechanical_items import (
    LockMigrationRefused,
    lock_mechanical_items,
)
from hardware.pocket_card.electronics_pipeline.mechanics import (
    ContractError,
    MechanicalReviewRequired,
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
        grown = _replace_footprint(
            self.board,
            "J_I2C1",
            courtyard_bbox_mm=(baseline[0] - 0.06, baseline[1], baseline[2], baseline[3]),
        )
        self.assertTrue(
            any("J_I2C1" in item and "allowed battery overlap" in item for item in check_mechanics(self.contract, grown))
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

    def test_rejects_invalid_feature_fields(self):
        mutations = (
            lambda p: p["features"][0].__setitem__("ref", ""),
            lambda p: p["features"][1].__setitem__("ref", p["features"][0]["ref"]),
            lambda p: p["features"][0].__setitem__("side", "F.SilkS"),
            lambda p: p["features"][0].__setitem__("lockedRequired", 1),
            lambda p: p["features"][0].__setitem__("rationale", "  "),
            lambda p: p["features"][0].__setitem__("xyToleranceMm", -0.01),
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


class LockMechanicalItemsTest(unittest.TestCase):
    def _temporary_board(self, text=None):
        temporary = tempfile.TemporaryDirectory()
        path = Path(temporary.name) / BOARD.name
        path.write_text(text if text is not None else _unlocked_canonical_text(), encoding="utf-8")
        self.addCleanup(temporary.cleanup)
        return path

    def test_migration_is_exact_and_idempotent(self):
        path = self._temporary_board()
        original_text = path.read_text(encoding="utf-8")
        first = lock_mechanical_items(path, MECHANICAL_CONTRACT)
        self.assertEqual(first, "locked 16 footprints and 10 Edge.Cuts items")
        locked_text = path.read_text(encoding="utf-8")
        self.assertEqual(locked_text.count("\n\t\t(locked yes)"), 26)
        self.assertEqual(locked_text.replace("\n\t\t(locked yes)", ""), original_text)
        self.assertTrue(all(parse_board(locked_text).footprints[ref].locked for ref in CONTRACTED_REFS))

        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        second = lock_mechanical_items(path, MECHANICAL_CONTRACT)
        self.assertEqual(second, "already locked")
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)

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
        text = _unlocked_canonical_text().replace("\n\t\t(at 66 84)", "\n\t\t(at 66.2 84)", 1)
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
