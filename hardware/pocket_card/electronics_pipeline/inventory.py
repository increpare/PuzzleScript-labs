"""Deterministic semantic inventory for native Pocket Card KiCad sources."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator

from .kicad_sexpr import SexprError, iter_direct_child_spans, next_token, one_root
from .paths import EDITABLE_PROJECT_DIRS, EDITABLE_PROJECT_FILES


@dataclass(frozen=True)
class Pad:
    number: str
    net: str | None
    uuid: str | None


@dataclass(frozen=True)
class Footprint:
    ref: str
    value: str
    library_id: str
    uuid: str
    symbol_path: str
    x_mm: float
    y_mm: float
    rotation_deg: float
    layer: str
    locked: bool
    pads: dict[str, tuple[Pad, ...]]
    courtyard_bbox_mm: tuple[float, float, float, float] | None


@dataclass(frozen=True)
class SchematicComponent:
    ref: str
    value: str
    footprint: str
    uuid: str
    fields: dict[str, str]


@dataclass(frozen=True)
class BoardInventory:
    thickness_mm: float
    footprints: dict[str, Footprint]
    edge_cuts: tuple[dict[str, object], ...]


@dataclass(frozen=True)
class SchematicInventory:
    components: dict[str, SchematicComponent]
    nets: dict[str, tuple[str, ...]]


@dataclass(frozen=True)
class ProjectInventory:
    schematic: SchematicInventory
    board: BoardInventory


def _children(
    source: str, start: int, end: int, names: set[str] | None = None
) -> Iterator[tuple[str, int, int]]:
    for name, child_start, child_end in iter_direct_child_spans(source, start, end):
        if names is None or name in names:
            yield name, child_start, child_end


def _atoms(source: str, start: int, end: int, limit: int | None = None) -> tuple[str, ...]:
    opening = next_token(source, start)
    if opening is None or opening.kind != "open" or opening.start != start:
        raise SexprError(f"expected expression at index {start}")
    values: list[str] = []
    index = opening.end
    while limit is None or len(values) < limit:
        token = next_token(source, index)
        if token is None or token.start >= end or token.kind != "atom":
            break
        values.append(token.value if token.value is not None else "")
        index = token.end
    return tuple(values)


def _direct_atoms(source: str, start: int, end: int) -> tuple[str, ...]:
    """Return atoms at expression depth one, including atoms after children."""

    opening = next_token(source, start)
    if opening is None or opening.kind != "open" or opening.start != start:
        raise SexprError(f"expected expression at index {start}")
    values: list[str] = []
    index = opening.end
    while index < end:
        token = next_token(source, index)
        if token is None or token.start >= end:
            break
        if token.kind == "open":
            child_end = _find_child_end(source, token.start)
            if child_end > end:
                raise SexprError(f"child expression extends past parent at index {token.start}")
            index = child_end
            continue
        if token.kind == "close":
            break
        values.append(token.value if token.value is not None else "")
        index = token.end
    return tuple(values)


def _find_child_end(source: str, start: int) -> int:
    depth = 0
    index = start
    while True:
        token = next_token(source, index)
        if token is None:
            raise SexprError(f"unterminated S-expression at index {start}")
        if token.kind == "open":
            depth += 1
        elif token.kind == "close":
            depth -= 1
            if depth == 0:
                return token.end
        index = token.end


def _first_child(
    source: str, start: int, end: int, name: str
) -> tuple[int, int] | None:
    for _, child_start, child_end in _children(source, start, end, {name}):
        return child_start, child_end
    return None


def _child_value(
    source: str, start: int, end: int, name: str, default: str | None = None
) -> str | None:
    child = _first_child(source, start, end, name)
    if child is None:
        return default
    atoms = _atoms(source, child[0], child[1], 2)
    return atoms[1] if len(atoms) > 1 else default


def _required_child_value(source: str, start: int, end: int, name: str, context: str) -> str:
    value = _child_value(source, start, end, name)
    if value is None or value == "":
        raise SexprError(f"{context} is missing {name} at index {start}")
    return value


def _number(value: str | None, context: str) -> float:
    try:
        number = float(value) if value is not None else math.nan
    except ValueError as error:
        raise SexprError(f"{context} must be numeric, got {value!r}") from error
    if not math.isfinite(number):
        raise SexprError(f"{context} must be finite, got {value!r}")
    return number


def _point(
    source: str, start: int, end: int, name: str
) -> tuple[float, float] | None:
    child = _first_child(source, start, end, name)
    if child is None:
        return None
    atoms = _atoms(source, child[0], child[1], 3)
    if len(atoms) < 3:
        raise SexprError(f"{name} requires two coordinates at index {child[0]}")
    return _number(atoms[1], f"{name} x"), _number(atoms[2], f"{name} y")


def _property_values(source: str, start: int, end: int) -> dict[str, str]:
    values: dict[str, str] = {}
    for _, child_start, child_end in _children(source, start, end, {"property"}):
        atoms = _atoms(source, child_start, child_end, 3)
        if len(atoms) < 2:
            continue
        name = atoms[1]
        value = atoms[2] if len(atoms) > 2 else ""
        if name in values:
            raise SexprError(f"duplicate property {name!r} at index {child_start}")
        values[name] = value
    return values


def _transform_point(
    point: tuple[float, float],
    x_mm: float,
    y_mm: float,
    rotation_deg: float,
    back: bool,
) -> tuple[float, float]:
    local_x, local_y = point
    if back:
        local_x = -local_x
    radians = math.radians(rotation_deg)
    cosine = math.cos(radians)
    sine = math.sin(radians)
    x = x_mm + local_x * cosine - local_y * sine
    y = y_mm + local_x * sine + local_y * cosine
    return _clean_float(x), _clean_float(y)


def _clean_float(value: float) -> float:
    nearest_integer = round(value)
    if abs(value - nearest_integer) < 1e-9:
        return float(nearest_integer)
    rounded = round(value, 12)
    return 0.0 if rounded == 0 else rounded


def _circle_through(
    first: tuple[float, float],
    second: tuple[float, float],
    third: tuple[float, float],
) -> tuple[tuple[float, float], float] | None:
    ax, ay = first
    bx, by = second
    cx, cy = third
    determinant = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(determinant) < 1e-12:
        return None
    a2 = ax * ax + ay * ay
    b2 = bx * bx + by * by
    c2 = cx * cx + cy * cy
    center_x = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / determinant
    center_y = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / determinant
    radius = math.hypot(ax - center_x, ay - center_y)
    return (center_x, center_y), radius


def _positive_angle(value: float) -> float:
    return value % (2 * math.pi)


def _angle_on_sweep(start: float, middle: float, end: float, candidate: float) -> bool:
    counterclockwise_end = _positive_angle(end - start)
    counterclockwise_middle = _positive_angle(middle - start)
    if counterclockwise_middle <= counterclockwise_end + 1e-12:
        return _positive_angle(candidate - start) <= counterclockwise_end + 1e-12
    clockwise_end = _positive_angle(start - end)
    return _positive_angle(start - candidate) <= clockwise_end + 1e-12


def _arc_extrema(
    start: tuple[float, float], mid: tuple[float, float], end: tuple[float, float]
) -> list[tuple[float, float]]:
    circle = _circle_through(start, mid, end)
    if circle is None:
        return [start, mid, end]
    center, radius = circle
    start_angle = math.atan2(start[1] - center[1], start[0] - center[0])
    mid_angle = math.atan2(mid[1] - center[1], mid[0] - center[0])
    end_angle = math.atan2(end[1] - center[1], end[0] - center[0])
    points = [start, mid, end]
    for angle in (0.0, math.pi / 2, math.pi, 3 * math.pi / 2):
        if _angle_on_sweep(start_angle, mid_angle, end_angle, angle):
            points.append(
                (center[0] + radius * math.cos(angle), center[1] + radius * math.sin(angle))
            )
    return points


def _poly_points(source: str, start: int, end: int) -> tuple[tuple[float, float], ...]:
    points_block = _first_child(source, start, end, "pts")
    if points_block is None:
        return ()
    points: list[tuple[float, float]] = []
    for _, child_start, child_end in _children(
        source, points_block[0], points_block[1], {"xy"}
    ):
        atoms = _atoms(source, child_start, child_end, 3)
        if len(atoms) < 3:
            raise SexprError(f"xy requires two coordinates at index {child_start}")
        points.append((_number(atoms[1], "xy x"), _number(atoms[2], "xy y")))
    return tuple(points)


def _primitive_points(
    source: str, start: int, end: int, kind: str
) -> tuple[tuple[float, float], ...]:
    if kind.endswith("line"):
        first = _point(source, start, end, "start")
        second = _point(source, start, end, "end")
        points = (first, second)
    elif kind.endswith("rect"):
        first = _point(source, start, end, "start")
        second = _point(source, start, end, "end")
        if first is None or second is None:
            points = (first, second)
        else:
            points = (
                first,
                (first[0], second[1]),
                second,
                (second[0], first[1]),
            )
    elif kind.endswith("circle"):
        center = _point(source, start, end, "center")
        edge = _point(source, start, end, "end")
        if center is None or edge is None:
            points = (center, edge)
        else:
            radius = math.hypot(edge[0] - center[0], edge[1] - center[1])
            points = (
                (center[0] - radius, center[1]),
                (center[0] + radius, center[1]),
                (center[0], center[1] - radius),
                (center[0], center[1] + radius),
            )
    elif kind.endswith("arc"):
        first = _point(source, start, end, "start")
        middle = _point(source, start, end, "mid")
        last = _point(source, start, end, "end")
        if first is None or middle is None or last is None:
            points = (first, middle, last)
        else:
            return tuple(_arc_extrema(first, middle, last))
    elif kind.endswith("poly"):
        return _poly_points(source, start, end)
    else:
        raise SexprError(f"unsupported courtyard primitive {kind!r} at index {start}")
    if any(point is None for point in points):
        raise SexprError(f"{kind} is missing required coordinates at index {start}")
    return tuple(point for point in points if point is not None)


def _courtyard_bbox(
    source: str,
    start: int,
    end: int,
    x_mm: float,
    y_mm: float,
    rotation_deg: float,
    layer: str,
) -> tuple[float, float, float, float] | None:
    world_points: list[tuple[float, float]] = []
    courtyard_found = False
    for kind, child_start, child_end in _children(source, start, end):
        if not kind.startswith("fp_"):
            continue
        primitive_layer = _child_value(source, child_start, child_end, "layer")
        if primitive_layer not in {"F.CrtYd", "B.CrtYd"}:
            continue
        courtyard_found = True
        back = layer.startswith("B.")
        if kind.endswith("circle"):
            center = _point(source, child_start, child_end, "center")
            edge = _point(source, child_start, child_end, "end")
            if center is None or edge is None:
                raise SexprError(f"{kind} is missing required coordinates at index {child_start}")
            world_center = _transform_point(center, x_mm, y_mm, rotation_deg, back)
            world_edge = _transform_point(edge, x_mm, y_mm, rotation_deg, back)
            radius = math.hypot(
                world_edge[0] - world_center[0], world_edge[1] - world_center[1]
            )
            world_points.extend(
                (
                    (world_center[0] - radius, world_center[1]),
                    (world_center[0] + radius, world_center[1]),
                    (world_center[0], world_center[1] - radius),
                    (world_center[0], world_center[1] + radius),
                )
            )
        elif kind.endswith("arc"):
            defining_points = (
                _point(source, child_start, child_end, "start"),
                _point(source, child_start, child_end, "mid"),
                _point(source, child_start, child_end, "end"),
            )
            if any(point is None for point in defining_points):
                raise SexprError(f"{kind} is missing required coordinates at index {child_start}")
            transformed = tuple(
                _transform_point(point, x_mm, y_mm, rotation_deg, back)
                for point in defining_points
                if point is not None
            )
            world_points.extend(_arc_extrema(transformed[0], transformed[1], transformed[2]))
        else:
            local_points = _primitive_points(source, child_start, child_end, kind)
            world_points.extend(
                _transform_point(point, x_mm, y_mm, rotation_deg, back)
                for point in local_points
            )
    if not courtyard_found:
        return None
    if not world_points:
        raise SexprError(f"courtyard has no geometry at index {start}")
    xs = [point[0] for point in world_points]
    ys = [point[1] for point in world_points]
    return (
        _clean_float(min(xs)),
        _clean_float(min(ys)),
        _clean_float(max(xs)),
        _clean_float(max(ys)),
    )


def _parse_pad(source: str, start: int, end: int, ref: str) -> Pad:
    atoms = _atoms(source, start, end, 2)
    if len(atoms) < 2:
        raise SexprError(f"board footprint {ref} has a pad without a number at index {start}")
    number = atoms[1]
    net_child = _first_child(source, start, end, "net")
    net: str | None = None
    if net_child is not None:
        net_atoms = _atoms(source, net_child[0], net_child[1])
        if len(net_atoms) > 1:
            candidate = net_atoms[-1]
            net = candidate if candidate else None
    uuid = _child_value(source, start, end, "uuid")
    if uuid is None:
        uuid = _child_value(source, start, end, "tstamp")
    return Pad(number=number, net=net, uuid=uuid)


def _parse_footprint(source: str, start: int, end: int) -> Footprint:
    header = _atoms(source, start, end)
    if len(header) < 2 or not header[1]:
        raise SexprError(f"board footprint is missing a library ID at index {start}")
    library_id = header[1]
    properties = _property_values(source, start, end)
    ref = properties.get("Reference", "")
    if not ref:
        raise SexprError(f"board footprint is missing a Reference property at index {start}")
    value = properties.get("Value", "")
    uuid = _child_value(source, start, end, "uuid")
    if uuid is None:
        uuid = _child_value(source, start, end, "tstamp")
    if not uuid:
        raise SexprError(f"board footprint {ref} is missing uuid at index {start}")
    symbol_path = _child_value(source, start, end, "path", "") or ""
    layer = _required_child_value(source, start, end, "layer", f"board footprint {ref}")

    at_child = _first_child(source, start, end, "at")
    if at_child is None:
        raise SexprError(f"board footprint {ref} is missing at at index {start}")
    at_atoms = _atoms(source, at_child[0], at_child[1], 4)
    if len(at_atoms) < 3:
        raise SexprError(f"board footprint {ref} has malformed placement at index {at_child[0]}")
    x_mm = _number(at_atoms[1], f"{ref} x")
    y_mm = _number(at_atoms[2], f"{ref} y")
    rotation_deg = _number(at_atoms[3], f"{ref} rotation") if len(at_atoms) > 3 else 0.0

    locked = "locked" in _direct_atoms(source, start, end)[2:]
    locked_child = _first_child(source, start, end, "locked")
    if locked_child is not None:
        locked_atoms = _atoms(source, locked_child[0], locked_child[1], 2)
        locked = len(locked_atoms) == 1 or locked_atoms[1].lower() not in {"no", "false", "0"}

    grouped_pads: dict[str, list[Pad]] = {}
    for _, pad_start, pad_end in _children(source, start, end, {"pad"}):
        pad = _parse_pad(source, pad_start, pad_end, ref)
        grouped_pads.setdefault(pad.number, []).append(pad)
    pads = {
        number: tuple(sorted(group, key=lambda pad: (pad.net or "", pad.uuid or "")))
        for number, group in sorted(grouped_pads.items())
    }
    courtyard = _courtyard_bbox(source, start, end, x_mm, y_mm, rotation_deg, layer)
    return Footprint(
        ref=ref,
        value=value,
        library_id=library_id,
        uuid=uuid,
        symbol_path=symbol_path,
        x_mm=x_mm,
        y_mm=y_mm,
        rotation_deg=rotation_deg,
        layer=layer,
        locked=locked,
        pads=pads,
        courtyard_bbox_mm=courtyard,
    )


def _stroke_width(source: str, start: int, end: int) -> float | None:
    stroke = _first_child(source, start, end, "stroke")
    if stroke is None:
        return None
    width = _child_value(source, stroke[0], stroke[1], "width")
    return _number(width, "stroke width") if width is not None else None


def _parse_graphic(source: str, start: int, end: int, kind: str) -> dict[str, object]:
    primitive: dict[str, object] = {"type": kind}
    for coordinate in ("start", "mid", "end", "center"):
        point = _point(source, start, end, coordinate)
        if point is not None:
            primitive[coordinate] = point
    points = _poly_points(source, start, end)
    if points:
        primitive["points"] = points
    layer = _child_value(source, start, end, "layer")
    if layer is not None:
        primitive["layer"] = layer
    width = _stroke_width(source, start, end)
    if width is not None:
        primitive["width"] = width
    uuid = _child_value(source, start, end, "uuid")
    if uuid is None:
        uuid = _child_value(source, start, end, "tstamp")
    if uuid is not None:
        primitive["uuid"] = uuid
    return primitive


def parse_board(text: str) -> BoardInventory:
    """Parse board semantics directly from native ``.kicad_pcb`` text."""

    root = one_root(text, "kicad_pcb")
    thickness: float | None = None
    footprints: dict[str, Footprint] = {}
    edge_cuts: list[dict[str, object]] = []
    for kind, start, end in _children(text, root.start, root.end):
        if kind == "general":
            value = _child_value(text, start, end, "thickness")
            if value is not None:
                thickness = _number(value, "board thickness")
        elif kind == "footprint":
            footprint = _parse_footprint(text, start, end)
            if footprint.ref in footprints:
                raise SexprError(f"duplicate board footprint reference {footprint.ref} at index {start}")
            footprints[footprint.ref] = footprint
        elif kind.startswith("gr_") and _child_value(text, start, end, "layer") == "Edge.Cuts":
            edge_cuts.append(_parse_graphic(text, start, end, kind))
    if thickness is None:
        raise SexprError("kicad_pcb root is missing general/thickness at index 0")
    return BoardInventory(
        thickness_mm=thickness,
        footprints={ref: footprints[ref] for ref in sorted(footprints)},
        edge_cuts=tuple(edge_cuts),
    )


def _parse_fields(source: str, start: int, end: int) -> dict[str, str]:
    fields_block = _first_child(source, start, end, "fields")
    if fields_block is None:
        return {}
    fields: dict[str, str] = {}
    for _, field_start, field_end in _children(
        source, fields_block[0], fields_block[1], {"field"}
    ):
        name_block = _first_child(source, field_start, field_end, "name")
        if name_block is None:
            raise SexprError(f"component field is missing name at index {field_start}")
        name_atoms = _atoms(source, name_block[0], name_block[1], 2)
        if len(name_atoms) < 2 or not name_atoms[1]:
            raise SexprError(f"component field has an empty name at index {field_start}")
        value_block = _first_child(source, field_start, field_end, "value")
        if value_block is not None:
            value_atoms = _atoms(source, value_block[0], value_block[1], 2)
            value = value_atoms[1] if len(value_atoms) > 1 else ""
        else:
            direct_atoms = _direct_atoms(source, field_start, field_end)
            value = direct_atoms[1] if len(direct_atoms) > 1 else ""
        if name_atoms[1] in fields:
            raise SexprError(f"duplicate component field {name_atoms[1]!r} at index {field_start}")
        fields[name_atoms[1]] = value
    return {name: fields[name] for name in sorted(fields)}


def _parse_component(source: str, start: int, end: int) -> SchematicComponent:
    ref = _required_child_value(source, start, end, "ref", "schematic component")
    value = _required_child_value(source, start, end, "value", f"schematic component {ref}")
    footprint = _required_child_value(
        source, start, end, "footprint", f"schematic component {ref}"
    )
    uuid = _child_value(source, start, end, "tstamps")
    if uuid is None:
        uuid = _child_value(source, start, end, "uuid")
    if uuid is None:
        raise SexprError(f"schematic component {ref} is missing UUID at index {start}")
    if uuid.startswith("/"):
        uuid = uuid[1:]
    return SchematicComponent(
        ref=ref,
        value=value,
        footprint=footprint,
        uuid=uuid,
        fields=_parse_fields(source, start, end),
    )


def _normalize_top_level_net(name: str) -> str:
    return name[1:] if name.startswith("/") else name


def parse_netlist(text: str) -> SchematicInventory:
    """Parse a KiCad ``kicadsexpr`` export into schematic semantics."""

    root = one_root(text, "export")
    components: dict[str, SchematicComponent] = {}
    components_block = _first_child(text, root.start, root.end, "components")
    if components_block is not None:
        for _, start, end in _children(text, components_block[0], components_block[1], {"comp"}):
            component = _parse_component(text, start, end)
            if component.ref in components:
                raise SexprError(f"duplicate schematic component reference {component.ref} at index {start}")
            components[component.ref] = component

    nets: dict[str, tuple[str, ...]] = {}
    nets_block = _first_child(text, root.start, root.end, "nets")
    if nets_block is not None:
        for _, start, end in _children(text, nets_block[0], nets_block[1], {"net"}):
            raw_name = _required_child_value(text, start, end, "name", "schematic net")
            if raw_name.startswith("unconnected-("):
                continue
            name = _normalize_top_level_net(raw_name)
            endpoints: list[str] = []
            for _, node_start, node_end in _children(text, start, end, {"node"}):
                ref = _required_child_value(text, node_start, node_end, "ref", f"net {name} node")
                pin = _required_child_value(text, node_start, node_end, "pin", f"net {name} node")
                endpoints.append(f"{ref}.{pin}")
            endpoint_tuple = tuple(sorted(endpoints))
            if len(set(endpoint_tuple)) != len(endpoint_tuple):
                raise SexprError(f"net {name} has duplicate endpoints at index {start}")
            if name in nets:
                raise SexprError(f"duplicate normalized schematic net {name!r} at index {start}")
            nets[name] = endpoint_tuple
    return SchematicInventory(
        components={ref: components[ref] for ref in sorted(components)},
        nets={name: nets[name] for name in sorted(nets)},
    )


def _library_basename(library_id: str) -> str:
    return library_id.rsplit(":", 1)[-1]


def compare_schematic_to_board(
    schematic: SchematicInventory, board: BoardInventory
) -> tuple[str, ...]:
    """Return deterministic linkage/connectivity discrepancies."""

    errors: list[str] = []
    schematic_refs = set(schematic.components)
    board_refs = set(board.footprints)
    for ref in sorted(schematic_refs - board_refs):
        errors.append(f"missing board footprint {ref}")
    for ref in sorted(board_refs - schematic_refs):
        errors.append(f"unexpected board footprint {ref}")

    expected_pins: dict[str, dict[str, str]] = {}
    unknown_endpoint_refs: set[str] = set()
    for name, endpoints in sorted(schematic.nets.items()):
        for endpoint in endpoints:
            if "." not in endpoint:
                errors.append(f"net {name} has malformed endpoint {endpoint!r}")
                continue
            ref, number = endpoint.rsplit(".", 1)
            if ref not in schematic_refs:
                if ref not in unknown_endpoint_refs:
                    errors.append(f"net {name} references unknown schematic component {ref}")
                    unknown_endpoint_refs.add(ref)
                continue
            by_number = expected_pins.setdefault(ref, {})
            previous = by_number.get(number)
            if previous is not None and previous != name:
                errors.append(f"schematic pin {ref}.{number} is on multiple nets ({previous} and {name})")
            else:
                by_number[number] = name

    for ref in sorted(schematic_refs & board_refs):
        component = schematic.components[ref]
        footprint = board.footprints[ref]
        if footprint.uuid != component.uuid:
            errors.append(f"{ref} UUID expected {component.uuid}, found {footprint.uuid or 'missing'}")
        expected_path = f"/{component.uuid}"
        if footprint.symbol_path != expected_path:
            errors.append(
                f"{ref} symbol path expected {expected_path}, found {footprint.symbol_path or 'missing'}"
            )
        expected_library = _library_basename(component.footprint)
        actual_library = _library_basename(footprint.library_id)
        if actual_library != expected_library:
            errors.append(
                f"{ref} footprint expected {expected_library}, found {actual_library or 'missing'}"
            )

        expected_for_ref = expected_pins.get(ref, {})
        for number, pads in sorted(footprint.pads.items()):
            actual_nets = {pad.net for pad in pads}
            if number == "":
                # Empty-number pads are physical shell/mechanical pads and have
                # no schematic pin counterpart.  Their own assignment must be
                # internally consistent; this covers holes and switch shells
                # without a reference or footprint allowlist.
                if len(actual_nets) > 1:
                    labels = ", ".join("unconnected" if net is None else net for net in sorted(actual_nets, key=lambda item: item or ""))
                    errors.append(f"{ref} unnumbered duplicate pads have mixed nets ({labels})")
                continue
            expected_net = expected_for_ref.get(number)
            if len(pads) > 1 and actual_nets != {expected_net}:
                labels = ", ".join("unconnected" if net is None else net for net in sorted(actual_nets, key=lambda item: item or ""))
                errors.append(
                    f"{ref} duplicate physical pad {number} does not consistently match "
                    f"{expected_net or 'unconnected'} ({labels})"
                )
            for pad in pads:
                if pad.net != expected_net:
                    errors.append(
                        f"{ref} pad {number} expected {expected_net or 'unconnected'}, "
                        f"found {pad.net or 'unconnected'}"
                    )
        for number in sorted(set(expected_for_ref) - set(footprint.pads)):
            errors.append(f"{ref} is missing board pad {number} for net {expected_for_ref[number]}")
    return tuple(errors)


_VERSION_PATTERN = re.compile(r"^(\d+)\.(\d+)(?:\.(\d+))?")


def _version_tuple(value: str) -> tuple[int, int, int]:
    match = _VERSION_PATTERN.match(value.strip())
    if match is None:
        raise RuntimeError(f"cannot parse KiCad version {value!r}")
    return tuple(int(part or 0) for part in match.groups())


def _kicad_cli_candidates() -> Iterable[str]:
    configured = os.environ.get("KICAD_CLI")
    if configured:
        yield configured
    on_path = shutil.which("kicad-cli")
    if on_path:
        yield on_path
    if os.name == "nt":
        for root_name in ("ProgramFiles", "ProgramFiles(x86)"):
            root = os.environ.get(root_name)
            if root:
                yield str(Path(root) / "KiCad" / "10.0" / "bin" / "kicad-cli.exe")
    else:
        yield "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli"
        yield "/usr/bin/kicad-cli"
        yield "/usr/local/bin/kicad-cli"
        yield "/opt/homebrew/bin/kicad-cli"


def _find_kicad_cli(expected_major: int, minimum: str) -> str:
    checked: list[str] = []
    seen: set[str] = set()
    minimum_version = _version_tuple(minimum)
    for raw_candidate in _kicad_cli_candidates():
        candidate = str(Path(raw_candidate).expanduser())
        if candidate in seen:
            continue
        seen.add(candidate)
        path = Path(candidate)
        if not path.is_file() or not os.access(path, os.X_OK):
            checked.append(f"{candidate} (missing)")
            continue
        result = subprocess.run(
            [candidate, "--version"], text=True, capture_output=True, check=False
        )
        version_text = result.stdout.strip() or result.stderr.strip()
        if result.returncode != 0:
            checked.append(f"{candidate} (version command failed)")
            continue
        try:
            version = _version_tuple(version_text)
        except RuntimeError:
            checked.append(f"{candidate} ({version_text!r})")
            continue
        if version[0] != expected_major or version < minimum_version:
            checked.append(f"{candidate} ({version_text})")
            continue
        return candidate
    detail = ", ".join(checked) if checked else "no candidates"
    raise RuntimeError(
        f"cannot locate KiCad {expected_major} >= {minimum} kicad-cli; checked: {detail}"
    )


def inventory_project(project_dir: Path) -> ProjectInventory:
    """Export a temporary netlist and inventory a native KiCad project."""

    directory = Path(project_dir)
    toolchain_path = directory / "toolchain.json"
    try:
        policy = json.loads(toolchain_path.read_text(encoding="utf-8"))
        project_name = policy["project"]
        expected_major = int(policy["kicad"]["major"])
        minimum = str(policy["kicad"]["minimum"])
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise RuntimeError(f"invalid pinned KiCad toolchain policy {toolchain_path}: {error}") from error
    schematic_path = directory / f"{project_name}.kicad_sch"
    board_path = directory / f"{project_name}.kicad_pcb"
    executable = _find_kicad_cli(expected_major, minimum)
    with tempfile.TemporaryDirectory(prefix="pocket-card-netlist-") as temporary_directory:
        temporary_project = Path(temporary_directory)
        for filename in EDITABLE_PROJECT_FILES:
            source_path = directory / filename
            if source_path.is_file():
                shutil.copy2(source_path, temporary_project / filename)
        temporary_schematic = temporary_project / schematic_path.name
        if not temporary_schematic.is_file():
            raise RuntimeError(f"native KiCad schematic is missing: {schematic_path}")
        netlist_path = temporary_project / f"{project_name}.net"
        result = subprocess.run(
            [
                executable,
                "sch",
                "export",
                "netlist",
                "--format",
                "kicadsexpr",
                "--output",
                str(netlist_path),
                str(temporary_schematic),
            ],
            cwd=temporary_project,
            text=True,
            capture_output=True,
            check=False,
        )
        if result.returncode != 0:
            detail = (result.stderr or result.stdout).strip()
            raise RuntimeError(f"KiCad netlist export failed with status {result.returncode}: {detail}")
        try:
            netlist_text = netlist_path.read_text(encoding="utf-8")
        except OSError as error:
            raise RuntimeError(f"KiCad did not create netlist {netlist_path}: {error}") from error
    return ProjectInventory(
        schematic=parse_netlist(netlist_text),
        board=parse_board(board_path.read_text(encoding="utf-8")),
    )


_LOCAL_EDITABLE_SUFFIXES = {
    "symbols": frozenset({".dcm", ".kicad_sym", ".lib"}),
    "footprints.pretty": frozenset({".kicad_mod", ".mod"}),
    "3dmodels": frozenset({".step", ".stp", ".wrl"}),
}


def _editable_project_paths(project_dir: Path) -> tuple[Path, ...]:
    paths: list[Path] = []
    for filename in EDITABLE_PROJECT_FILES:
        candidate = project_dir / filename
        if candidate.is_file() and not candidate.is_symlink():
            paths.append(candidate)
    for directory_name in EDITABLE_PROJECT_DIRS:
        suffixes = _LOCAL_EDITABLE_SUFFIXES[directory_name]
        directory = project_dir / directory_name
        if not directory.is_dir() or directory.is_symlink():
            continue
        for candidate in directory.rglob("*"):
            if candidate.is_file() and not candidate.is_symlink() and candidate.suffix.lower() in suffixes:
                if not any(part.startswith((".", "~")) or "backup" in part.lower() for part in candidate.relative_to(project_dir).parts):
                    paths.append(candidate)
    return tuple(sorted(paths, key=lambda path: path.relative_to(project_dir).as_posix()))


def project_digest(project_dir: Path) -> str:
    """Hash editable native project sources independently of local artifacts."""

    directory = Path(project_dir)
    digest = hashlib.sha256()
    for path in _editable_project_paths(directory):
        relative = path.relative_to(directory).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _json_value(value: object) -> object:
    if isinstance(value, dict):
        return {str(key): _json_value(value[key]) for key in sorted(value)}
    if isinstance(value, tuple):
        return [_json_value(item) for item in value]
    if isinstance(value, list):
        return [_json_value(item) for item in value]
    return value


def _component_json(component: SchematicComponent) -> dict[str, object]:
    return {
        "ref": component.ref,
        "value": component.value,
        "footprint": component.footprint,
        "uuid": component.uuid,
        "fields": {name: component.fields[name] for name in sorted(component.fields)},
    }


def _footprint_json(footprint: Footprint) -> dict[str, object]:
    return {
        "ref": footprint.ref,
        "value": footprint.value,
        "library_id": footprint.library_id,
        "uuid": footprint.uuid,
        "symbol_path": footprint.symbol_path,
        "x_mm": footprint.x_mm,
        "y_mm": footprint.y_mm,
        "rotation_deg": footprint.rotation_deg,
        "layer": footprint.layer,
        "locked": footprint.locked,
        "pads": {
            number: [
                {"number": pad.number, "net": pad.net, "uuid": pad.uuid}
                for pad in footprint.pads[number]
            ]
            for number in sorted(footprint.pads)
        },
        "courtyard_bbox_mm": (
            list(footprint.courtyard_bbox_mm)
            if footprint.courtyard_bbox_mm is not None
            else None
        ),
    }


def inventory_json(inventory: ProjectInventory) -> dict[str, object]:
    """Return a detached, stable, JSON-ready project representation."""

    edge_cuts = [_json_value(primitive) for primitive in inventory.board.edge_cuts]
    edge_cuts.sort(key=lambda value: json.dumps(value, sort_keys=True, separators=(",", ":")))
    return {
        "schematic": {
            "components": {
                ref: _component_json(inventory.schematic.components[ref])
                for ref in sorted(inventory.schematic.components)
            },
            "nets": {
                name: list(sorted(inventory.schematic.nets[name]))
                for name in sorted(inventory.schematic.nets)
            },
        },
        "board": {
            "thickness_mm": inventory.board.thickness_mm,
            "footprints": {
                ref: _footprint_json(inventory.board.footprints[ref])
                for ref in sorted(inventory.board.footprints)
            },
            "edge_cuts": edge_cuts,
        },
    }


def _mapping_diff(before: dict[str, object], after: dict[str, object]) -> dict[str, object]:
    before_keys = set(before)
    after_keys = set(after)
    changed = {
        key: {"before": before[key], "after": after[key]}
        for key in sorted(before_keys & after_keys)
        if before[key] != after[key]
    }
    return {
        "added": sorted(after_keys - before_keys),
        "removed": sorted(before_keys - after_keys),
        "changed": changed,
    }


def semantic_diff(before: ProjectInventory, after: ProjectInventory) -> dict[str, object]:
    """Return deterministic, review-oriented changes between inventories."""

    before_json = inventory_json(before)
    after_json = inventory_json(after)
    before_schematic = before_json["schematic"]
    after_schematic = after_json["schematic"]
    before_board = before_json["board"]
    after_board = after_json["board"]
    assert isinstance(before_schematic, dict) and isinstance(after_schematic, dict)
    assert isinstance(before_board, dict) and isinstance(after_board, dict)

    before_footprints = before_board["footprints"]
    after_footprints = after_board["footprints"]
    assert isinstance(before_footprints, dict) and isinstance(after_footprints, dict)
    placement_keys = ("x_mm", "y_mm", "rotation_deg", "layer", "locked", "courtyard_bbox_mm")
    before_placements = {
        ref: {key: footprint[key] for key in placement_keys}
        for ref, footprint in before_footprints.items()
    }
    after_placements = {
        ref: {key: footprint[key] for key in placement_keys}
        for ref, footprint in after_footprints.items()
    }
    before_footprint_semantics = {
        ref: {key: value for key, value in footprint.items() if key not in placement_keys}
        for ref, footprint in before_footprints.items()
    }
    after_footprint_semantics = {
        ref: {key: value for key, value in footprint.items() if key not in placement_keys}
        for ref, footprint in after_footprints.items()
    }
    before_outline = {
        "thickness_mm": before_board["thickness_mm"],
        "edge_cuts": before_board["edge_cuts"],
    }
    after_outline = {
        "thickness_mm": after_board["thickness_mm"],
        "edge_cuts": after_board["edge_cuts"],
    }
    return {
        "components": _mapping_diff(
            before_schematic["components"], after_schematic["components"]
        ),
        "nets": _mapping_diff(before_schematic["nets"], after_schematic["nets"]),
        "footprints": _mapping_diff(before_footprint_semantics, after_footprint_semantics),
        "placements": _mapping_diff(before_placements, after_placements),
        "outline": {
            "changed": before_outline != after_outline,
            "before": before_outline,
            "after": after_outline,
        },
    }
