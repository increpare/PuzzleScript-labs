"""Pocket Card mechanical-interface contract loading and validation."""

from __future__ import annotations

import json
import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType

from .inventory import BoardInventory


class ContractError(ValueError):
    """Raised when a mechanical contract is malformed or ambiguous."""


@dataclass(frozen=True)
class BoardContract:
    thickness_mm: float
    thickness_tolerance_mm: float


Point = tuple[float, float]
Bbox = tuple[float, float, float, float]


@dataclass(frozen=True)
class OutlinePrimitive:
    kind: str
    points: tuple[Point, ...]

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "points",
            tuple(tuple(point) for point in self.points),
        )


@dataclass(frozen=True)
class OutlineContract:
    coordinate_tolerance_mm: float
    primitives: tuple[OutlinePrimitive, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "primitives", tuple(self.primitives))


@dataclass(frozen=True)
class FeatureContract:
    ref: str
    x_mm: float
    y_mm: float
    rotation_deg: float
    side: str
    xy_tolerance_mm: float
    rotation_tolerance_deg: float
    locked_required: bool
    rationale: str


@dataclass(frozen=True)
class AllowedOverlap:
    ref: str
    rationale: str
    courtyard_bbox_mm: Bbox
    intersection_bbox_mm: Bbox

    def __post_init__(self) -> None:
        object.__setattr__(self, "courtyard_bbox_mm", tuple(self.courtyard_bbox_mm))
        object.__setattr__(
            self, "intersection_bbox_mm", tuple(self.intersection_bbox_mm)
        )


@dataclass(frozen=True)
class KeepoutContract:
    name: str
    kind: str
    side: str
    x_min_mm: float
    y_min_mm: float
    x_max_mm: float
    y_max_mm: float
    boundary_touch_is_intrusion: bool
    derivation: Mapping[str, str]
    allowed_overlaps: Mapping[str, AllowedOverlap]

    def __post_init__(self) -> None:
        object.__setattr__(self, "derivation", MappingProxyType(dict(self.derivation)))
        object.__setattr__(
            self,
            "allowed_overlaps",
            MappingProxyType(dict(sorted(self.allowed_overlaps.items()))),
        )

    @property
    def bbox_mm(self) -> Bbox:
        return self.x_min_mm, self.y_min_mm, self.x_max_mm, self.y_max_mm


@dataclass(frozen=True)
class MechanicalContract:
    schema_version: int
    board: BoardContract
    outline: OutlineContract
    features: tuple[FeatureContract, ...]
    keepouts: tuple[KeepoutContract, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "features", tuple(self.features))
        object.__setattr__(self, "keepouts", tuple(self.keepouts))

    @property
    def features_by_ref(self) -> Mapping[str, FeatureContract]:
        return MappingProxyType({feature.ref: feature for feature in self.features})


@dataclass(frozen=True)
class MechanicalReviewRequired(Exception):
    findings: tuple[str, ...]

    def __init__(self, findings: Iterable[str]):
        immutable = tuple(findings)
        object.__setattr__(self, "findings", immutable)
        Exception.__init__(self, immutable)

    def __str__(self) -> str:
        return "\n".join(("MECHANICAL REVIEW REQUIRED", *self.findings))


_ROOT_KEYS = frozenset({"schemaVersion", "board", "outline", "features", "keepouts"})
_BOARD_KEYS = frozenset({"thicknessMm", "thicknessToleranceMm"})
_OUTLINE_KEYS = frozenset({"coordinateToleranceMm", "primitives"})
_PRIMITIVE_KEYS = frozenset({"kind", "points"})
_FEATURE_KEYS = frozenset(
    {
        "ref",
        "xMm",
        "yMm",
        "rotationDeg",
        "side",
        "xyToleranceMm",
        "rotationToleranceDeg",
        "lockedRequired",
        "rationale",
    }
)
_KEEPOUT_KEYS = frozenset(
    {
        "name",
        "kind",
        "side",
        "xMinMm",
        "yMinMm",
        "xMaxMm",
        "yMaxMm",
        "boundaryTouchIsIntrusion",
        "derivation",
        "allowedOverlaps",
    }
)
_DERIVATION_KEYS = frozenset({"source", "xMin", "yMin", "xMax", "yMax"})
_ALLOWED_OVERLAP_KEYS = frozenset(
    {"rationale", "courtyardBboxMm", "intersectionBboxMm"}
)
_EXPECTED_DERIVATION = {
    "source": "hardware/pocket_card/case/params.py",
    "xMin": "BATT_X - BATT_CLEAR",
    "yMin": "BATT_Y - BATT_CLEAR",
    "xMax": "BATT_X + CELL_W + BATT_CLEAR",
    "yMax": "BATT_Y + CELL_H + BATT_CLEAR",
}
_APPROVED_FEATURE_POLICY = {
    "H1": (
        0.05,
        0.1,
        "Rear enclosure mounting pin and shoulder interface.",
    ),
    "H2": (
        0.05,
        0.1,
        "Rear enclosure mounting pin and shoulder interface.",
    ),
    "SW_UP1": (
        0.05,
        0.1,
        "Up button must remain concentric with its enclosure guide.",
    ),
    "SW_DOWN1": (
        0.05,
        0.1,
        "Down button must remain concentric with its enclosure guide.",
    ),
    "SW_LEFT1": (
        0.05,
        0.1,
        "Left button must remain concentric with its enclosure guide.",
    ),
    "SW_RIGHT1": (
        0.05,
        0.1,
        "Right button must remain concentric with its enclosure guide.",
    ),
    "SW_UNDO1": (
        0.05,
        0.1,
        "Undo button must remain concentric with its enclosure guide.",
    ),
    "SW_ACTION1": (
        0.05,
        0.1,
        "Action button must remain concentric with its enclosure guide.",
    ),
    "SW_RESET1": (
        0.05,
        0.1,
        "Reset button must remain concentric with its enclosure guide.",
    ),
    "SW_MENU1": (
        0.05,
        0.1,
        "Menu button must remain aligned with its pill-shaped enclosure guide.",
    ),
    "SW_PWR1": (
        0.05,
        0.1,
        "Power switch actuator must remain aligned with the enclosure slide tip.",
    ),
    "SW_MUTE1": (
        0.05,
        0.1,
        "Mute switch actuator must remain aligned with the enclosure slide tip.",
    ),
    "J_I2C1": (
        0.05,
        0.1,
        "I2C connector must remain in the rear wiring pocket.",
    ),
    "J_EXP1": (
        0.05,
        0.1,
        "Expansion connector must remain in the rear wiring pocket and clear the PCB notch.",
    ),
    "J_BAT_IN1": (
        0.05,
        0.1,
        "Battery input connector must remain beside the cell pocket.",
    ),
    "J_BAT_OUT1": (
        0.05,
        0.1,
        "Module battery output connector must remain in the north rear wiring band.",
    ),
}
_APPROVED_ALLOWED_OVERLAPS = {
    "J_BAT_IN1": (
        "Reviewed baseline: the connector courtyard enters the cell fence envelope by 0.08 mm while the established mechanical stack remains acceptable.",
        (59.52, 72.8, 66.48, 79.2),
        (59.52, 72.8, 59.6, 79.2),
    ),
    "J_I2C1": (
        "Reviewed baseline: the connector courtyard enters the cell fence envelope by 1.33 mm; any increase requires renewed mechanical review.",
        (58.27, 59.8, 67.73, 66.2),
        (58.27, 59.8, 59.6, 66.2),
    ),
}


def _object_without_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ContractError(f"duplicate JSON key {key!r}")
        result[key] = value
    return result


def _reject_nonstandard_number(value: str) -> object:
    raise ContractError(f"non-finite JSON number {value!r}")


def _mapping(value: object, context: str, keys: frozenset[str]) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ContractError(f"{context} must be an object")
    actual = frozenset(value)
    missing = sorted(keys - actual)
    unknown = sorted(actual - keys)
    if missing or unknown:
        parts = []
        if missing:
            parts.append(f"missing {', '.join(missing)}")
        if unknown:
            parts.append(f"unknown {', '.join(unknown)}")
        raise ContractError(f"{context} has {'; '.join(parts)}")
    return value


def _array(value: object, context: str, *, nonempty: bool = False) -> list[object]:
    if not isinstance(value, list):
        raise ContractError(f"{context} must be an array")
    if nonempty and not value:
        raise ContractError(f"{context} must not be empty")
    return value


def _number(value: object, context: str, *, nonnegative: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ContractError(f"{context} must be a number")
    try:
        result = float(value)
    except (OverflowError, ValueError) as error:
        raise ContractError(f"{context} must be finite") from error
    if not math.isfinite(result):
        raise ContractError(f"{context} must be finite")
    if nonnegative and result < 0:
        raise ContractError(f"{context} must be nonnegative")
    return result


def _string(value: object, context: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{context} must be a nonempty string")
    if value != value.strip():
        raise ContractError(f"{context} must not contain surrounding whitespace")
    return value


def _boolean(value: object, context: str) -> bool:
    if not isinstance(value, bool):
        raise ContractError(f"{context} must be a boolean")
    return value


def _point(value: object, context: str) -> Point:
    coordinates = _array(value, context)
    if len(coordinates) != 2:
        raise ContractError(f"{context} must contain exactly two coordinates")
    return _number(coordinates[0], f"{context}[0]"), _number(
        coordinates[1], f"{context}[1]"
    )


def _bbox(value: object, context: str) -> Bbox:
    coordinates = _array(value, context)
    if len(coordinates) != 4:
        raise ContractError(f"{context} must contain exactly four coordinates")
    bbox = tuple(
        _number(coordinate, f"{context}[{index}]")
        for index, coordinate in enumerate(coordinates)
    )
    assert len(bbox) == 4
    if bbox[0] >= bbox[2] or bbox[1] >= bbox[3]:
        raise ContractError(f"{context} must have positive width and height")
    return bbox


def _intersection(
    first: Bbox, second: Bbox, boundary_touch_is_intrusion: bool
) -> Bbox | None:
    x_min = max(first[0], second[0])
    y_min = max(first[1], second[1])
    x_max = min(first[2], second[2])
    y_max = min(first[3], second[3])
    if boundary_touch_is_intrusion:
        intersects = x_min <= x_max and y_min <= y_max
    else:
        intersects = x_min < x_max and y_min < y_max
    return (x_min, y_min, x_max, y_max) if intersects else None


def _parse_outline(value: object) -> OutlineContract:
    raw = _mapping(value, "outline", _OUTLINE_KEYS)
    tolerance = _number(
        raw["coordinateToleranceMm"],
        "outline.coordinateToleranceMm",
        nonnegative=True,
    )
    primitives = []
    for index, value in enumerate(
        _array(raw["primitives"], "outline.primitives", nonempty=True)
    ):
        context = f"outline.primitives[{index}]"
        primitive = _mapping(value, context, _PRIMITIVE_KEYS)
        kind = _string(primitive["kind"], f"{context}.kind")
        if kind not in {"line", "arc"}:
            raise ContractError(f"{context}.kind must be line or arc")
        expected_points = 2 if kind == "line" else 3
        point_values = _array(primitive["points"], f"{context}.points")
        if len(point_values) != expected_points:
            raise ContractError(
                f"{context}.points must contain exactly {expected_points} points for {kind}"
            )
        primitives.append(
            OutlinePrimitive(
                kind=kind,
                points=tuple(
                    _point(point_value, f"{context}.points[{point_index}]")
                    for point_index, point_value in enumerate(point_values)
                ),
            )
        )
    return OutlineContract(tolerance, tuple(primitives))


def _parse_feature(value: object, index: int) -> FeatureContract:
    context = f"features[{index}]"
    raw = _mapping(value, context, _FEATURE_KEYS)
    side = _string(raw["side"], f"{context}.side")
    if side not in {"F.Cu", "B.Cu"}:
        raise ContractError(f"{context}.side must be F.Cu or B.Cu")
    return FeatureContract(
        ref=_string(raw["ref"], f"{context}.ref"),
        x_mm=_number(raw["xMm"], f"{context}.xMm"),
        y_mm=_number(raw["yMm"], f"{context}.yMm"),
        rotation_deg=_number(raw["rotationDeg"], f"{context}.rotationDeg"),
        side=side,
        xy_tolerance_mm=_number(
            raw["xyToleranceMm"], f"{context}.xyToleranceMm", nonnegative=True
        ),
        rotation_tolerance_deg=_number(
            raw["rotationToleranceDeg"],
            f"{context}.rotationToleranceDeg",
            nonnegative=True,
        ),
        locked_required=_boolean(raw["lockedRequired"], f"{context}.lockedRequired"),
        rationale=_string(raw["rationale"], f"{context}.rationale"),
    )


def _parse_keepout(
    value: object,
    index: int,
    features_by_ref: Mapping[str, FeatureContract],
) -> KeepoutContract:
    context = f"keepouts[{index}]"
    raw = _mapping(value, context, _KEEPOUT_KEYS)
    kind = _string(raw["kind"], f"{context}.kind")
    if kind != "rectangle":
        raise ContractError(f"{context}.kind must be rectangle")
    side = _string(raw["side"], f"{context}.side")
    if side not in {"F.Cu", "B.Cu"}:
        raise ContractError(f"{context}.side must be F.Cu or B.Cu")
    x_min = _number(raw["xMinMm"], f"{context}.xMinMm")
    y_min = _number(raw["yMinMm"], f"{context}.yMinMm")
    x_max = _number(raw["xMaxMm"], f"{context}.xMaxMm")
    y_max = _number(raw["yMaxMm"], f"{context}.yMaxMm")
    if x_min >= x_max or y_min >= y_max:
        raise ContractError(f"{context} rectangle must have positive width and height")
    boundary_policy = _boolean(
        raw["boundaryTouchIsIntrusion"], f"{context}.boundaryTouchIsIntrusion"
    )
    derivation_raw = _mapping(raw["derivation"], f"{context}.derivation", _DERIVATION_KEYS)
    derivation = {
        key: _string(derivation_raw[key], f"{context}.derivation.{key}")
        for key in sorted(_DERIVATION_KEYS)
    }
    allowed_raw = raw["allowedOverlaps"]
    if not isinstance(allowed_raw, Mapping):
        raise ContractError(f"{context}.allowedOverlaps must be an object")
    allowed_overlaps: dict[str, AllowedOverlap] = {}
    keepout_bbox = (x_min, y_min, x_max, y_max)
    for ref, value in sorted(allowed_raw.items()):
        ref = _string(ref, f"{context}.allowedOverlaps reference")
        feature = features_by_ref.get(ref)
        if feature is None:
            raise ContractError(f"{context}.allowedOverlaps ref {ref} is not contracted")
        if feature.side != side or not feature.locked_required:
            raise ContractError(
                f"{context}.allowedOverlaps ref {ref} must be a locked feature on {side}"
            )
        overlap_context = f"{context}.allowedOverlaps.{ref}"
        overlap_raw = _mapping(value, overlap_context, _ALLOWED_OVERLAP_KEYS)
        courtyard = _bbox(
            overlap_raw["courtyardBboxMm"], f"{overlap_context}.courtyardBboxMm"
        )
        intersection = _bbox(
            overlap_raw["intersectionBboxMm"],
            f"{overlap_context}.intersectionBboxMm",
        )
        calculated = _intersection(courtyard, keepout_bbox, boundary_policy)
        if calculated is None or any(
            abs(actual - expected) > 1e-9
            for actual, expected in zip(calculated, intersection)
        ):
            raise ContractError(
                f"{overlap_context}.intersectionBboxMm must equal the courtyard/keep-out intersection"
            )
        allowed_overlaps[ref] = AllowedOverlap(
            ref=ref,
            rationale=_string(overlap_raw["rationale"], f"{overlap_context}.rationale"),
            courtyard_bbox_mm=courtyard,
            intersection_bbox_mm=intersection,
        )
    return KeepoutContract(
        name=_string(raw["name"], f"{context}.name"),
        kind=kind,
        side=side,
        x_min_mm=x_min,
        y_min_mm=y_min,
        x_max_mm=x_max,
        y_max_mm=y_max,
        boundary_touch_is_intrusion=boundary_policy,
        derivation=derivation,
        allowed_overlaps=allowed_overlaps,
    )


def load_contract(path: str | Path) -> MechanicalContract:
    """Load and strictly validate a schema-version-1 contract."""

    contract_path = Path(path)
    try:
        value = json.loads(
            contract_path.read_text(encoding="utf-8"),
            object_pairs_hook=_object_without_duplicate_keys,
            parse_constant=_reject_nonstandard_number,
        )
    except ContractError:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ContractError(f"cannot load mechanical contract {contract_path}: {error}") from error
    root = _mapping(value, "contract", _ROOT_KEYS)
    schema_version = root["schemaVersion"]
    if type(schema_version) is not int or schema_version != 1:
        raise ContractError("contract.schemaVersion must be integer 1")

    board_raw = _mapping(root["board"], "board", _BOARD_KEYS)
    board = BoardContract(
        thickness_mm=_number(
            board_raw["thicknessMm"], "board.thicknessMm", nonnegative=True
        ),
        thickness_tolerance_mm=_number(
            board_raw["thicknessToleranceMm"],
            "board.thicknessToleranceMm",
            nonnegative=True,
        ),
    )
    outline = _parse_outline(root["outline"])
    features = tuple(
        _parse_feature(value, index)
        for index, value in enumerate(
            _array(root["features"], "features", nonempty=True)
        )
    )
    refs = [feature.ref for feature in features]
    duplicate_refs = sorted({ref for ref in refs if refs.count(ref) > 1})
    if duplicate_refs:
        raise ContractError(f"duplicate feature refs: {', '.join(duplicate_refs)}")
    features_by_ref = {feature.ref: feature for feature in features}
    keepouts = tuple(
        _parse_keepout(value, index, features_by_ref)
        for index, value in enumerate(
            _array(root["keepouts"], "keepouts", nonempty=True)
        )
    )
    keepout_names = [keepout.name for keepout in keepouts]
    duplicate_names = sorted(
        {name for name in keepout_names if keepout_names.count(name) > 1}
    )
    if duplicate_names:
        raise ContractError(f"duplicate keep-out names: {', '.join(duplicate_names)}")
    return MechanicalContract(1, board, outline, features, keepouts)


def _angular_distance(first: float, second: float) -> float:
    return abs((first - second + 180.0) % 360.0 - 180.0)


def _canonical_primitive(
    kind: str, points: tuple[Point, ...]
) -> tuple[str, tuple[Point, ...]]:
    reversed_points = tuple(reversed(points))
    return kind, min(points, reversed_points)


def _board_outline(board: BoardInventory) -> tuple[tuple[str, tuple[Point, ...]], ...] | None:
    primitives: list[tuple[str, tuple[Point, ...]]] = []
    for primitive in board.edge_cuts:
        kind_value = primitive.get("type")
        if kind_value == "gr_line":
            names = ("start", "end")
            kind = "line"
        elif kind_value == "gr_arc":
            names = ("start", "mid", "end")
            kind = "arc"
        else:
            return None
        points: list[Point] = []
        for name in names:
            value = primitive.get(name)
            if (
                not isinstance(value, (tuple, list))
                or len(value) != 2
                or any(isinstance(item, bool) or not isinstance(item, (int, float)) for item in value)
            ):
                return None
            point = float(value[0]), float(value[1])
            if not all(math.isfinite(item) for item in point):
                return None
            points.append(point)
        primitives.append(_canonical_primitive(kind, tuple(points)))
    return tuple(sorted(primitives))


def _outline_matches(contract: OutlineContract, board: BoardInventory) -> bool:
    expected = tuple(
        sorted(
            _canonical_primitive(primitive.kind, primitive.points)
            for primitive in contract.primitives
        )
    )
    actual = _board_outline(board)
    if actual is None or len(actual) != len(expected):
        return False
    tolerance = contract.coordinate_tolerance_mm
    for (actual_kind, actual_points), (expected_kind, expected_points) in zip(actual, expected):
        if actual_kind != expected_kind or len(actual_points) != len(expected_points):
            return False
        if any(
            abs(actual_coordinate - expected_coordinate) > tolerance
            for actual_point, expected_point in zip(actual_points, expected_points)
            for actual_coordinate, expected_coordinate in zip(actual_point, expected_point)
        ):
            return False
    return True


def _bbox_changed(actual: Bbox, expected: Bbox, tolerance: float) -> bool:
    return any(abs(actual_value - expected_value) > tolerance for actual_value, expected_value in zip(actual, expected))


def _format_bbox(bbox: Bbox) -> str:
    return "(" + ", ".join(f"{value:g}" for value in bbox) + ")"


def check_mechanics(
    contract: MechanicalContract, board: BoardInventory
) -> tuple[str, ...]:
    """Return sorted mechanical-only findings for *board*."""

    findings: set[str] = set()
    if abs(board.thickness_mm - contract.board.thickness_mm) > contract.board.thickness_tolerance_mm:
        findings.add(
            f"board thickness expected {contract.board.thickness_mm:g} mm, found {board.thickness_mm:g} mm"
        )

    for feature in contract.features:
        footprint = board.footprints.get(feature.ref)
        if footprint is None:
            findings.add(f"{feature.ref} is missing")
            continue
        distance = math.hypot(footprint.x_mm - feature.x_mm, footprint.y_mm - feature.y_mm)
        if distance > feature.xy_tolerance_mm:
            findings.add(
                f"{feature.ref} moved: expected ({feature.x_mm:g}, {feature.y_mm:g}), "
                f"found ({footprint.x_mm:g}, {footprint.y_mm:g})"
            )
        if _angular_distance(footprint.rotation_deg, feature.rotation_deg) > feature.rotation_tolerance_deg:
            findings.add(
                f"{feature.ref} rotated: expected {feature.rotation_deg:g} deg, "
                f"found {footprint.rotation_deg:g} deg"
            )
        if footprint.layer != feature.side:
            findings.add(
                f"{feature.ref} wrong side: expected {feature.side}, found {footprint.layer}"
            )
        if feature.locked_required and not footprint.locked:
            findings.add(f"{feature.ref} is not locked")

    for keepout in contract.keepouts:
        seen_allowed: set[str] = set()
        for ref, footprint in board.footprints.items():
            if footprint.layer != keepout.side:
                continue
            allowed = keepout.allowed_overlaps.get(ref)
            if allowed is not None:
                seen_allowed.add(ref)
            courtyard = footprint.courtyard_bbox_mm
            if courtyard is None:
                findings.add(
                    f"{ref} courtyard unavailable for {keepout.name} keep-out check"
                )
                continue
            intersection = _intersection(
                courtyard, keepout.bbox_mm, keepout.boundary_touch_is_intrusion
            )
            if allowed is None:
                if intersection is not None:
                    findings.add(
                        f"{ref} courtyard intrudes {keepout.name} keep-out at {_format_bbox(intersection)}"
                    )
                continue
            if intersection is None:
                findings.add(
                    f"{ref} allowed {keepout.name} overlap is stale: courtyard no longer intersects"
                )
                continue
            if (
                courtyard != allowed.courtyard_bbox_mm
                or intersection != allowed.intersection_bbox_mm
            ):
                findings.add(
                    f"{ref} allowed {keepout.name} overlap changed: expected courtyard "
                    f"{_format_bbox(allowed.courtyard_bbox_mm)}, found {_format_bbox(courtyard)}"
                )
        for ref in keepout.allowed_overlaps:
            if ref not in seen_allowed:
                findings.add(
                    f"{ref} allowed {keepout.name} overlap is stale: feature missing or on wrong side"
                )

    if not _outline_matches(contract.outline, board):
        findings.add("Edge.Cuts geometry does not match mechanical contract")
    return tuple(sorted(findings))


def check_contract_against_case_params(
    contract: MechanicalContract,
) -> tuple[str, ...]:
    """Enforce the exact approved contract policy against enclosure parameters."""

    from hardware.pocket_card.case import params as case_params

    findings: set[str] = set()
    expected = {
        "H1": (*case_params.PCB_MOUNTS[0], 0.0, "F.Cu"),
        "H2": (*case_params.PCB_MOUNTS[1], 0.0, "F.Cu"),
        "SW_UP1": (case_params.DIR_CX, case_params.DIR_CY - case_params.DIR_RADIUS, 0.0, "F.Cu"),
        "SW_DOWN1": (case_params.DIR_CX, case_params.DIR_CY + case_params.DIR_RADIUS, 0.0, "F.Cu"),
        "SW_LEFT1": (case_params.DIR_CX - case_params.DIR_RADIUS, case_params.DIR_CY, 0.0, "F.Cu"),
        "SW_RIGHT1": (case_params.DIR_CX + case_params.DIR_RADIUS, case_params.DIR_CY, 0.0, "F.Cu"),
        "SW_UNDO1": (case_params.UNDO_X, case_params.UNDO_Y, 0.0, "F.Cu"),
        "SW_ACTION1": (case_params.ACT_X, case_params.ACT_Y, 0.0, "F.Cu"),
        "SW_RESET1": (case_params.RESET_X, case_params.RESET_Y, 0.0, "F.Cu"),
        "SW_MENU1": (case_params.MENU_X, case_params.MENU_Y, 0.0, "F.Cu"),
        "SW_PWR1": (case_params.POWER_SW_X, case_params.POWER_SW_Y, 0.0, "F.Cu"),
        "SW_MUTE1": (case_params.MUTE_SW_X, case_params.MUTE_SW_Y, 0.0, "F.Cu"),
        "J_I2C1": (*case_params.CONN_I2C, case_params.CONN_ROT, case_params.CONN_SIDE),
        "J_EXP1": (*case_params.CONN_EXP, case_params.CONN_ROT, case_params.CONN_SIDE),
        "J_BAT_IN1": (*case_params.CONN_BAT_IN, case_params.CONN_ROT, case_params.CONN_SIDE),
        "J_BAT_OUT1": (*case_params.CONN_BAT_OUT, case_params.CONN_ROT, case_params.CONN_SIDE),
    }
    features_by_ref = contract.features_by_ref
    if contract.schema_version != 1:
        findings.add("contract schema version must be 1")
    expected_refs = frozenset(_APPROVED_FEATURE_POLICY)
    actual_refs = frozenset(feature.ref for feature in contract.features)
    if actual_refs != expected_refs or len(contract.features) != len(expected_refs):
        missing = ", ".join(sorted(expected_refs - actual_refs)) or "none"
        extra = ", ".join(sorted(actual_refs - expected_refs)) or "none"
        findings.add(
            "contract feature ref set must be exactly the approved 16 refs: "
            f"missing {missing}; extra {extra}; count {len(contract.features)}"
        )
    for ref, (x_mm, y_mm, rotation_deg, side) in expected.items():
        feature = features_by_ref.get(ref)
        if feature is None:
            findings.add(f"{ref} is missing from contract case params map")
            continue
        xy_tolerance_mm, rotation_tolerance_deg, rationale = (
            _APPROVED_FEATURE_POLICY[ref]
        )
        if math.hypot(feature.x_mm - x_mm, feature.y_mm - y_mm) > 1e-9:
            findings.add(
                f"{ref} contract location does not match case params: expected ({x_mm:g}, {y_mm:g})"
            )
        if _angular_distance(feature.rotation_deg, rotation_deg) > 1e-9:
            findings.add(f"{ref} contract rotation does not match case params")
        if feature.side != side:
            findings.add(f"{ref} contract side does not match case params")
        if feature.xy_tolerance_mm != xy_tolerance_mm:
            findings.add(
                f"{ref} contract xy tolerance must be {xy_tolerance_mm:g} mm"
            )
        if feature.rotation_tolerance_deg != rotation_tolerance_deg:
            findings.add(
                f"{ref} contract rotation tolerance must be {rotation_tolerance_deg:g} deg"
            )
        if not feature.locked_required:
            findings.add(f"{ref} contract must require locking")
        if feature.rationale != rationale:
            findings.add(f"{ref} contract rationale does not match approved policy")

    if abs(contract.board.thickness_mm - case_params.PCB_T) > 1e-9:
        findings.add("contract board thickness does not match case params PCB_T")
    if contract.board.thickness_tolerance_mm != 0.01:
        findings.add("contract board thickness tolerance must be 0.01 mm")
    if contract.outline.coordinate_tolerance_mm != 0.01:
        findings.add("contract outline coordinate tolerance must be 0.01 mm")

    if len(contract.keepouts) != 1:
        findings.add(
            "contract must contain exactly one battery keep-out, "
            f"found {len(contract.keepouts)} keep-outs"
        )
    batteries = tuple(
        keepout for keepout in contract.keepouts if keepout.name == "battery"
    )
    battery = batteries[0] if len(batteries) == 1 else None
    if battery is None:
        findings.add("battery keep-out is missing from contract")
    else:
        expected_bbox = (
            case_params.BATT_X - case_params.BATT_CLEAR,
            case_params.BATT_Y - case_params.BATT_CLEAR,
            case_params.BATT_X + case_params.CELL_W + case_params.BATT_CLEAR,
            case_params.BATT_Y + case_params.CELL_H + case_params.BATT_CLEAR,
        )
        if _bbox_changed(
            battery.bbox_mm,
            expected_bbox,
            1e-9,
        ):
            findings.add(
                "battery keep-out does not match BATT_X/BATT_Y/CELL_W/CELL_H/BATT_CLEAR case params"
            )
        if dict(battery.derivation) != _EXPECTED_DERIVATION:
            findings.add("battery keep-out derivation metadata does not match case params formula")
        if battery.side != "B.Cu" or battery.kind != "rectangle":
            findings.add("battery keep-out must be a B.Cu rectangle")
        if battery.boundary_touch_is_intrusion:
            findings.add("battery keep-out boundary policy must allow exact boundary touch")
        expected_overlap_refs = frozenset(_APPROVED_ALLOWED_OVERLAPS)
        actual_overlap_refs = frozenset(battery.allowed_overlaps)
        if actual_overlap_refs != expected_overlap_refs:
            missing = ", ".join(sorted(expected_overlap_refs - actual_overlap_refs)) or "none"
            extra = ", ".join(sorted(actual_overlap_refs - expected_overlap_refs)) or "none"
            findings.add(
                "battery allowed overlap ref set must be exactly J_BAT_IN1 and J_I2C1: "
                f"missing {missing}; extra {extra}"
            )
        for ref in sorted(expected_overlap_refs & actual_overlap_refs):
            allowed = battery.allowed_overlaps[ref]
            feature = features_by_ref.get(ref)
            if (
                allowed.ref != ref
                or feature is None
                or feature.side != battery.side
                or not feature.locked_required
            ):
                findings.add(f"{ref} battery allowed overlap contract is invalid")
            rationale, courtyard, intersection = _APPROVED_ALLOWED_OVERLAPS[ref]
            if (
                allowed.rationale != rationale
                or allowed.courtyard_bbox_mm != courtyard
                or allowed.intersection_bbox_mm != intersection
            ):
                findings.add(
                    f"{ref} battery allowed overlap envelope or rationale does not match approved policy"
                )
    return tuple(sorted(findings))
