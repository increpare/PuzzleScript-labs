import json
import math
import sys
import unittest
from collections import defaultdict
from pathlib import Path


HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from hardware.pocket_card.case import params as P
from hardware.pocket_card.electronics_pipeline.inventory import parse_board
from hardware.pocket_card.electronics_pipeline.kicad_sexpr import (
    iter_direct_child_spans,
    next_token,
    one_root,
)


BOARD_PATH = REPO_ROOT / "hardware/pocket_card/electronics/pocket_card_controller.kicad_pcb"
CONTRACT_PATH = REPO_ROOT / "hardware/pocket_card/electronics/mechanical_contract.json"
COURTYARD_MARGIN_MM = 0.25
GEOMETRY_EPSILON_MM = 1e-8


def _expression_atoms(source, start, end):
    opening = next_token(source, start)
    if opening is None or opening.kind != "open":
        raise AssertionError(f"expected expression at {start}")
    atoms = []
    offset = opening.end
    while offset < end:
        token = next_token(source, offset)
        if token is None or token.start >= end or token.kind != "atom":
            break
        atoms.append(token.value)
        offset = token.end
    return tuple(atoms)


def _child_atoms(source, start, end, child_name):
    for name, child_start, child_end in iter_direct_child_spans(
        source, start, end
    ):
        if name == child_name:
            return _expression_atoms(source, child_start, child_end)
    return None


def _point_child(source, start, end, child_name):
    atoms = _child_atoms(source, start, end, child_name)
    if atoms is None or len(atoms) < 3:
        raise AssertionError(f"missing {child_name} point at {start}")
    return float(atoms[1]), float(atoms[2])


def _footprint_span(source, reference):
    root = one_root(source, "kicad_pcb")
    for name, start, end in iter_direct_child_spans(
        source, root.start, root.end
    ):
        if name != "footprint":
            continue
        for child_name, child_start, child_end in iter_direct_child_spans(
            source, start, end
        ):
            if child_name != "property":
                continue
            atoms = _expression_atoms(source, child_start, child_end)
            if atoms[:3] == ("property", "Reference", reference):
                return start, end
    raise AssertionError(f"missing footprint {reference}")


def _layer_segments(source, footprint_span, layer):
    segments = []
    start, end = footprint_span
    for name, child_start, child_end in iter_direct_child_spans(
        source, start, end
    ):
        if name not in {"fp_line", "fp_arc", "fp_circle", "fp_rect", "fp_poly"}:
            continue
        layer_atoms = _child_atoms(source, child_start, child_end, "layer")
        if layer_atoms != ("layer", layer):
            continue
        if name != "fp_line":
            raise AssertionError(f"{layer} contains unsupported {name} geometry")
        segments.append(
            (
                _point_child(source, child_start, child_end, "start"),
                _point_child(source, child_start, child_end, "end"),
            )
        )
    return tuple(segments)


def _closed_polygon(segments):
    if len(segments) < 3:
        raise AssertionError("courtyard requires at least three segments")
    neighbors = defaultdict(list)
    edges = set()
    for first, second in segments:
        if first == second:
            raise AssertionError("courtyard contains a zero-length segment")
        edge = tuple(sorted((first, second)))
        if edge in edges:
            raise AssertionError("courtyard contains a duplicate segment")
        edges.add(edge)
        neighbors[first].append(second)
        neighbors[second].append(first)
    if any(len(connected) != 2 for connected in neighbors.values()):
        raise AssertionError("courtyard segments do not form a closed chain")

    polygon = []
    used_edges = set()
    previous = None
    current = min(neighbors)
    origin = current
    while True:
        polygon.append(current)
        choices = [point for point in neighbors[current] if point != previous]
        following = choices[0]
        edge = tuple(sorted((current, following)))
        if edge in used_edges:
            raise AssertionError("courtyard chain closes before using every segment")
        used_edges.add(edge)
        previous, current = current, following
        if current == origin:
            break
    if used_edges != edges:
        raise AssertionError("courtyard contains disconnected segment cycles")
    if abs(_signed_area(polygon)) <= GEOMETRY_EPSILON_MM:
        raise AssertionError("courtyard polygon has zero area")
    polygon_edges = _polygon_edges(tuple(polygon))
    for first_index, first in enumerate(polygon_edges):
        for second_index in range(first_index + 1, len(polygon_edges)):
            adjacent = second_index == first_index + 1 or (
                first_index == 0 and second_index == len(polygon_edges) - 1
            )
            if not adjacent and _segments_intersect(
                first, polygon_edges[second_index]
            ):
                raise AssertionError("courtyard polygon self-intersects")
    return tuple(polygon)


def _signed_area(polygon):
    return 0.5 * sum(
        first[0] * second[1] - second[0] * first[1]
        for first, second in _polygon_edges(polygon)
    )


def _polygon_edges(polygon):
    return tuple(zip(polygon, polygon[1:] + polygon[:1]))


def _point_segment_distance(point, segment):
    first, second = segment
    dx = second[0] - first[0]
    dy = second[1] - first[1]
    length_squared = dx * dx + dy * dy
    if length_squared == 0:
        return math.dist(point, first)
    projection = (
        (point[0] - first[0]) * dx + (point[1] - first[1]) * dy
    ) / length_squared
    projection = max(0.0, min(1.0, projection))
    closest = first[0] + projection * dx, first[1] + projection * dy
    return math.dist(point, closest)


def _orientation(first, second, third):
    return (
        (second[0] - first[0]) * (third[1] - first[1])
        - (second[1] - first[1]) * (third[0] - first[0])
    )


def _segments_intersect(first, second):
    a, b = first
    c, d = second
    turns = (
        _orientation(a, b, c),
        _orientation(a, b, d),
        _orientation(c, d, a),
        _orientation(c, d, b),
    )
    return (
        turns[0] * turns[1] < 0 and turns[2] * turns[3] < 0
    ) or any(
        abs(turn) <= GEOMETRY_EPSILON_MM
        and _point_segment_distance(point, segment) <= GEOMETRY_EPSILON_MM
        for turn, point, segment in (
            (turns[0], c, first),
            (turns[1], d, first),
            (turns[2], a, second),
            (turns[3], b, second),
        )
    )


def _segment_distance(first, second):
    if _segments_intersect(first, second):
        return 0.0
    return min(
        _point_segment_distance(first[0], second),
        _point_segment_distance(first[1], second),
        _point_segment_distance(second[0], first),
        _point_segment_distance(second[1], first),
    )


def _point_in_polygon(point, polygon):
    if any(
        _point_segment_distance(point, edge) <= GEOMETRY_EPSILON_MM
        for edge in _polygon_edges(polygon)
    ):
        return True
    inside = False
    x, y = point
    for first, second in _polygon_edges(polygon):
        if (first[1] > y) == (second[1] > y):
            continue
        crossing_x = first[0] + (y - first[1]) * (
            second[0] - first[0]
        ) / (second[1] - first[1])
        if crossing_x > x:
            inside = not inside
    return inside


def _rotate(point, angle_degrees):
    angle = math.radians(angle_degrees)
    cosine = math.cos(angle)
    sine = math.sin(angle)
    return (
        point[0] * cosine - point[1] * sine,
        point[0] * sine + point[1] * cosine,
    )


def _pad_shapes(source, footprint_span):
    shapes = []
    start, end = footprint_span
    for name, child_start, child_end in iter_direct_child_spans(
        source, start, end
    ):
        if name != "pad":
            continue
        atoms = _expression_atoms(source, child_start, child_end)
        center_atoms = _child_atoms(source, child_start, child_end, "at")
        size_atoms = _child_atoms(source, child_start, child_end, "size")
        if center_atoms is None or size_atoms is None:
            raise AssertionError("pad is missing at or size geometry")
        center = float(center_atoms[1]), float(center_atoms[2])
        angle = float(center_atoms[3]) if len(center_atoms) > 3 else 0.0
        width, height = float(size_atoms[1]), float(size_atoms[2])
        shape = atoms[3]
        shapes.append((shape, center, angle, width, height))
    return tuple(shapes)


def _rectangle_edges(center, angle, width, height):
    corners = []
    for x, y in (
        (-width / 2, -height / 2),
        (width / 2, -height / 2),
        (width / 2, height / 2),
        (-width / 2, height / 2),
    ):
        rotated = _rotate((x, y), angle)
        corners.append((center[0] + rotated[0], center[1] + rotated[1]))
    return _polygon_edges(tuple(corners))


def _footprint_transform(source, footprint_span, point):
    atoms = _child_atoms(source, *footprint_span, "at")
    if atoms is None or len(atoms) < 3:
        raise AssertionError("footprint is missing at geometry")
    origin = float(atoms[1]), float(atoms[2])
    angle = float(atoms[3]) if len(atoms) > 3 else 0.0
    rotated = _rotate(point, angle)
    return origin[0] + rotated[0], origin[1] + rotated[1]


def _courtyard_circle(source, footprint_span):
    start, end = footprint_span
    circles = []
    for name, child_start, child_end in iter_direct_child_spans(
        source, start, end
    ):
        if name != "fp_circle":
            continue
        layer_atoms = _child_atoms(source, child_start, child_end, "layer")
        if layer_atoms != ("layer", "F.CrtYd"):
            continue
        center = _point_child(source, child_start, child_end, "center")
        edge = _point_child(source, child_start, child_end, "end")
        circles.append((center, math.dist(center, edge)))
    if len(circles) != 1:
        raise AssertionError("H2 must have exactly one F.CrtYd circle")
    return circles[0]


class ClosureLayoutContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.board_source = BOARD_PATH.read_text(encoding="utf-8")
        cls.board = parse_board(cls.board_source)
        contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
        cls.contract_features = {
            feature["ref"]: feature for feature in contract["features"]
        }

    def test_case_coordinates(self):
        self.assertEqual((P.RESET_X, P.RESET_Y), (54.5, 80.0))
        self.assertEqual(P.PCB_MOUNTS, ((64.5, 56.0), (64.5, 84.0)))
        self.assertEqual(P.EXTRA_BOSSES, P.PCB_MOUNTS)

    def test_board_and_contract_placement_locks_and_mount_alignment(self):
        h1 = self.board.footprints["H1"]
        h2 = self.board.footprints["H2"]
        self.assertEqual((h1.x_mm, h2.x_mm), (64.5, 64.5))
        self.assertEqual((h2.x_mm, h2.y_mm), (64.5, 84.0))
        self.assertTrue(h2.locked)

        reset = self.board.footprints["SW_RESET1"]
        self.assertEqual((reset.x_mm, reset.y_mm), (54.5, 80.0))
        self.assertTrue(reset.locked)

        u1 = self.board.footprints["U1"]
        self.assertEqual((u1.x_mm, u1.y_mm), (44.3, 72.0))

        for ref, expected in (
            ("H2", (64.5, 84.0)),
            ("SW_RESET1", (54.5, 80.0)),
        ):
            feature = self.contract_features[ref]
            self.assertEqual((feature["xMm"], feature["yMm"]), expected)

        h1_contract = self.contract_features["H1"]
        h2_contract = self.contract_features["H2"]
        self.assertEqual((h1_contract["xMm"], h2_contract["xMm"]), (64.5, 64.5))

    def test_reset_electrical_net_assignments(self):
        reset = self.board.footprints["SW_RESET1"]
        self.assertEqual(
            tuple(pad.net for pad in reset.pads["1"]),
            ("SIG_RESET", "SIG_RESET"),
        )
        self.assertEqual(
            tuple(pad.net for pad in reset.pads["2"]),
            ("GND", "GND"),
        )

        u1 = self.board.footprints["U1"]
        self.assertEqual(
            tuple(pad.net for pad in u1.pads["22"]),
            ("SIG_RESET",),
        )

    def test_mute_courtyard_is_truthful_and_clear_of_h2(self):
        mute_span = _footprint_span(self.board_source, "SW_MUTE1")
        polygon = _closed_polygon(
            _layer_segments(self.board_source, mute_span, "F.CrtYd")
        )
        courtyard_edges = _polygon_edges(polygon)

        turns = [
            _orientation(previous, current, following)
            for previous, current, following in zip(
                polygon[-1:] + polygon[:-1],
                polygon,
                polygon[1:] + polygon[:1],
            )
        ]
        self.assertTrue(any(turn > 0 for turn in turns))
        self.assertTrue(any(turn < 0 for turn in turns))

        fab_segments = _layer_segments(self.board_source, mute_span, "F.Fab")
        self.assertGreater(len(fab_segments), 0)
        for physical_segment in fab_segments:
            for point in physical_segment:
                self.assertTrue(_point_in_polygon(point, polygon))
            clearance = min(
                _segment_distance(physical_segment, courtyard_edge)
                for courtyard_edge in courtyard_edges
            )
            self.assertGreaterEqual(
                clearance + GEOMETRY_EPSILON_MM,
                COURTYARD_MARGIN_MM,
            )

        for shape, center, angle, width, height in _pad_shapes(
            self.board_source, mute_span
        ):
            if shape == "circle":
                self.assertAlmostEqual(width, height)
                self.assertTrue(_point_in_polygon(center, polygon))
                clearance = min(
                    _point_segment_distance(center, edge)
                    for edge in courtyard_edges
                ) - width / 2
            else:
                self.assertEqual(shape, "rect")
                pad_edges = _rectangle_edges(center, angle, width, height)
                self.assertTrue(
                    all(
                        _point_in_polygon(point, polygon)
                        for edge in pad_edges
                        for point in edge
                    )
                )
                clearance = min(
                    _segment_distance(pad_edge, courtyard_edge)
                    for pad_edge in pad_edges
                    for courtyard_edge in courtyard_edges
                )
            self.assertGreaterEqual(
                clearance + GEOMETRY_EPSILON_MM,
                COURTYARD_MARGIN_MM,
            )

        h2_span = _footprint_span(self.board_source, "H2")
        h2_center_local, h2_radius = _courtyard_circle(
            self.board_source, h2_span
        )
        h2_center = _footprint_transform(
            self.board_source, h2_span, h2_center_local
        )
        global_courtyard_edges = tuple(
            (
                _footprint_transform(self.board_source, mute_span, first),
                _footprint_transform(self.board_source, mute_span, second),
            )
            for first, second in courtyard_edges
        )
        separation = min(
            _point_segment_distance(h2_center, edge)
            for edge in global_courtyard_edges
        ) - h2_radius
        self.assertGreater(separation, 0.0)
        self.assertAlmostEqual(separation, 0.1058795788, places=6)


if __name__ == "__main__":
    unittest.main()
