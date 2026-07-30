#!/usr/bin/env python3
"""Inventory normalized duplicate objects in a GBC compilation cart."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence


OBJECT_NAME = re.compile(r"^g\d{2}_(.+)\.o$")
GAME_NAMESPACE = re.compile(r"g\d{2}_")
SYMBOL_RECORD = re.compile(
    r"^S\s+(\S+)\s+(Def|Ref)([0-9A-Fa-f]{8})(.*)$"
)
AREA_RECORD = re.compile(
    r"^A\s+(\S+)\s+size\s+([0-9A-Fa-f]+)\b"
)
CODE_AREA = re.compile(r"^_CODE_(\d+)$")
TEXT_RECORD = re.compile(r"^T(?:\s+[0-9A-Fa-f]{2})+$")
RELOCATION_RECORD = re.compile(r"^R(?:\s+[0-9A-Fa-f]{2})+$")
ROADMAP_KINDS = {
    "generated_core",
    "generated_facade_rules",
    "generated_compact_facade",
}
DESCRIPTOR_BASE_BYTES_PER_MEMBER = 8
FAR_POINTER_BYTES = 3
BANKED_BRIDGE_BYTES_PER_EXPORTED_ALIAS = 16
HOT_CROSS_BANK_BYTES_PER_SYMBOL_EDGE = 32
DESIGN_GATE_BYTES = 64 * 1024


@dataclass(frozen=True)
class Symbol:
    name: str
    normalized_name: str
    binding: str
    address: int
    per_game: bool


@dataclass(frozen=True)
class ObjectInfo:
    path: Path
    kind: str
    code_size: int
    normalized_digest: str
    symbols: tuple[Symbol, ...]
    text_records: tuple[tuple[int, ...], ...]
    relocations: tuple[tuple[int, ...], ...]

    @property
    def per_game_references(self) -> tuple[str, ...]:
        return tuple(
            sorted(
                {
                    display_symbol(symbol.normalized_name)
                    for symbol in self.symbols
                    if symbol.binding == "Ref" and symbol.per_game
                }
            )
        )

    @property
    def per_game_definitions(self) -> tuple[str, ...]:
        return tuple(
            sorted(
                {
                    display_symbol(symbol.normalized_name)
                    for symbol in self.symbols
                    if symbol.binding == "Def"
                    and symbol.per_game
                    and not symbol.normalized_name.startswith("b_")
                }
            )
        )


def display_symbol(name: str) -> str:
    if name.startswith("b_"):
        name = name[2:]
    return name.removeprefix("_")


def object_kind(path: Path) -> str:
    match = OBJECT_NAME.match(path.name)
    return match.group(1) if match is not None else path.stem


def _normalized_lines(text: str) -> list[str]:
    normalized: list[str] = []
    for line in text.splitlines():
        symbol = SYMBOL_RECORD.match(line)
        if symbol is not None:
            name = GAME_NAMESPACE.sub("", symbol.group(1))
            normalized.append(
                f"S {name} {symbol.group(2)}00000000{symbol.group(4)}"
            )
            continue
        area = AREA_RECORD.match(line)
        if area is not None and CODE_AREA.match(area.group(1)) is not None:
            line = line.replace(area.group(1), "_CODE_N", 1)
        normalized.append(GAME_NAMESPACE.sub("", line))
    return normalized


def parse_object(path: Path) -> ObjectInfo:
    text = path.read_text(encoding="utf-8", errors="replace")
    symbols: list[Symbol] = []
    text_records: list[tuple[int, ...]] = []
    relocations: list[tuple[int, ...]] = []
    nonempty_code_areas: list[int] = []
    for line in text.splitlines():
        symbol = SYMBOL_RECORD.match(line)
        if symbol is not None:
            name = symbol.group(1)
            symbols.append(
                Symbol(
                    name=name,
                    normalized_name=GAME_NAMESPACE.sub("", name),
                    binding=symbol.group(2),
                    address=int(symbol.group(3), 16),
                    per_game=GAME_NAMESPACE.search(name) is not None,
                )
            )
            continue
        area = AREA_RECORD.match(line)
        if area is not None and CODE_AREA.match(area.group(1)) is not None:
            size = int(area.group(2), 16)
            if size:
                nonempty_code_areas.append(size)
            continue
        if TEXT_RECORD.match(line) is not None:
            text_records.append(
                tuple(int(value, 16) for value in line.split()[1:])
            )
            continue
        if RELOCATION_RECORD.match(line) is not None:
            relocations.append(
                tuple(int(value, 16) for value in line.split()[1:])
            )
    if len(nonempty_code_areas) != 1:
        raise ValueError(
            f"{path}: expected one non-empty _CODE_N area, "
            f"found {len(nonempty_code_areas)}"
        )
    normalized = "\n".join(_normalized_lines(text)) + "\n"
    return ObjectInfo(
        path=path,
        kind=object_kind(path),
        code_size=nonempty_code_areas[0],
        normalized_digest=hashlib.sha256(
            normalized.encode("utf-8")
        ).hexdigest(),
        symbols=tuple(symbols),
        text_records=tuple(text_records),
        relocations=tuple(relocations),
    )


def analyze_objects(
    paths: Iterable[Path],
    *,
    object_banks: dict[str, int] | None = None,
) -> dict[str, object]:
    banks = object_banks or {}
    objects = [parse_object(path) for path in sorted(paths)]
    grouped: dict[tuple[str, str], list[ObjectInfo]] = {}
    for entry in objects:
        grouped.setdefault(
            (entry.kind, entry.normalized_digest), []
        ).append(entry)

    clusters: list[dict[str, object]] = []
    for (kind, _digest), members in sorted(grouped.items()):
        if len(members) < 2:
            continue
        implementation_bytes = members[0].code_size
        if any(
            member.code_size != implementation_bytes for member in members
        ):
            raise ValueError(
                f"{kind}: normalized-identical objects have unequal sizes"
            )
        source_banks = sorted(
            {
                banks[member.path.name]
                for member in members
                if member.path.name in banks
            }
        )
        per_game_references = sorted(
            {
                reference
                for member in members
                for reference in member.per_game_references
            }
        )
        per_game_definitions = sorted(
            {
                definition
                for member in members
                for definition in member.per_game_definitions
            }
        )
        clusters.append(
            {
                "kind": kind,
                "members": sorted(member.path.name for member in members),
                "implementation_bytes": implementation_bytes,
                "gross_duplicate_bytes": (
                    sum(member.code_size for member in members)
                    - implementation_bytes
                ),
                "per_game_symbol_references": per_game_references,
                "per_game_symbol_definitions": per_game_definitions,
                "source_banks": source_banks,
                "directly_shareable": (
                    not per_game_references
                    and not per_game_definitions
                    and len(source_banks) <= 1
                ),
            }
        )

    kinds: dict[str, dict[str, int]] = {}
    for kind in sorted({entry.kind for entry in objects}):
        kind_objects = [entry for entry in objects if entry.kind == kind]
        kind_clusters = [
            cluster for cluster in clusters if cluster["kind"] == kind
        ]
        kinds[kind] = {
            "object_count": len(kind_objects),
            "distinct_normalized_contents": len(
                {entry.normalized_digest for entry in kind_objects}
            ),
            "code_bytes": sum(entry.code_size for entry in kind_objects),
            "duplicate_cluster_count": len(kind_clusters),
            "gross_duplicate_bytes": sum(
                int(cluster["gross_duplicate_bytes"])
                for cluster in kind_clusters
            ),
            "directly_shareable_bytes": sum(
                int(cluster["gross_duplicate_bytes"])
                for cluster in kind_clusters
                if cluster["directly_shareable"]
            ),
        }

    definitions: dict[str, list[ObjectInfo]] = {}
    for entry in objects:
        for symbol in entry.symbols:
            if symbol.binding == "Def":
                definitions.setdefault(symbol.name, []).append(entry)
    reference_occurrences = 0
    resolved_occurrences = 0
    same_bank_occurrences = 0
    cross_bank_occurrences = 0
    unresolved_occurrences = 0
    cross_bank_edges: list[dict[str, object]] = []
    for source in objects:
        for symbol in source.symbols:
            if symbol.binding != "Ref" or not symbol.per_game:
                continue
            reference_occurrences += 1
            targets = definitions.get(symbol.name, [])
            if len(targets) != 1:
                unresolved_occurrences += 1
                continue
            resolved_occurrences += 1
            target = targets[0]
            source_bank = banks.get(source.path.name)
            target_bank = banks.get(target.path.name)
            if source_bank is None or target_bank is None:
                continue
            if source_bank == target_bank:
                same_bank_occurrences += 1
                continue
            cross_bank_occurrences += 1
            cross_bank_edges.append(
                {
                    "source_object": source.path.name,
                    "source_bank": source_bank,
                    "target_object": target.path.name,
                    "target_bank": target_bank,
                    "symbol": display_symbol(symbol.normalized_name),
                }
            )

    return {
        "format": "puzzlescript-gbc-sharing-analysis-v1",
        "normalization": {
            "normalized": [
                "gNN_ namespace prefixes",
                "_CODE_N area numbers",
                (
                    "S-record symbol addresses and generated "
                    "bank-symbol values"
                ),
            ],
            "preserved": [
                "T-record instruction bytes and constants",
                "call-target names after namespace removal",
                "R-record relocation bytes and kinds",
            ],
        },
        "object_count": len(objects),
        "kinds": kinds,
        "clusters": clusters,
        "reference_inventory": {
            "per_game_reference_occurrences": reference_occurrences,
            "resolved_per_game_reference_occurrences":
                resolved_occurrences,
            "same_bank_per_game_reference_occurrences":
                same_bank_occurrences,
            "cross_bank_per_game_reference_occurrences":
                cross_bank_occurrences,
            "unresolved_per_game_reference_occurrences":
                unresolved_occurrences,
            "cross_bank_edges": sorted(
                cross_bank_edges,
                key=lambda row: (
                    row["source_object"],
                    row["symbol"],
                    row["target_object"],
                ),
            ),
        },
        "totals": {
            "gross_duplicate_bytes": sum(
                int(cluster["gross_duplicate_bytes"])
                for cluster in clusters
            ),
            "directly_shareable_bytes": sum(
                int(cluster["gross_duplicate_bytes"])
                for cluster in clusters
                if cluster["directly_shareable"]
            ),
        },
    }


def estimate_opportunity(
    report: dict[str, object],
    *,
    kinds: set[str],
) -> dict[str, object]:
    selected = [
        cluster
        for cluster in report["clusters"]
        if cluster["kind"] in kinds
    ]
    configuration_clusters = len(selected)
    clustered_members = sum(
        len(cluster["members"]) for cluster in selected
    )
    eliminated_copies = sum(
        len(cluster["members"]) - 1 for cluster in selected
    )
    shared_implementation_bytes = sum(
        int(cluster["implementation_bytes"]) for cluster in selected
    )
    gross_duplicate_bytes = sum(
        int(cluster["gross_duplicate_bytes"]) for cluster in selected
    )
    descriptor_context_bytes = sum(
        len(cluster["members"]) * (
            DESCRIPTOR_BASE_BYTES_PER_MEMBER
            + FAR_POINTER_BYTES
            * len(cluster["per_game_symbol_references"])
        )
        for cluster in selected
    )
    home_banked_bridge_bytes = sum(
        (len(cluster["members"]) - 1)
        * len(cluster["per_game_symbol_definitions"])
        * BANKED_BRIDGE_BYTES_PER_EXPORTED_ALIAS
        for cluster in selected
    )
    hot_cross_bank_symbol_edges = sum(
        len(cluster["per_game_symbol_references"])
        for cluster in selected
    )
    hot_cross_bank_call_bytes = (
        hot_cross_bank_symbol_edges
        * HOT_CROSS_BANK_BYTES_PER_SYMBOL_EDGE
    )
    genericity_reserve_bytes = (
        shared_implementation_bytes + 3
    ) // 4
    conservative_net_bytes = max(
        0,
        gross_duplicate_bytes
        - descriptor_context_bytes
        - home_banked_bridge_bytes
        - hot_cross_bank_call_bytes
        - genericity_reserve_bytes,
    )
    return {
        "configuration_clusters": configuration_clusters,
        "clustered_members": clustered_members,
        "eliminated_copies": eliminated_copies,
        "shared_implementation_bytes": shared_implementation_bytes,
        "gross_duplicate_bytes": gross_duplicate_bytes,
        "descriptor_context_bytes": descriptor_context_bytes,
        "home_banked_bridge_bytes": home_banked_bridge_bytes,
        "hot_cross_bank_symbol_edges": hot_cross_bank_symbol_edges,
        "hot_cross_bank_call_bytes": hot_cross_bank_call_bytes,
        "genericity_reserve_bytes": genericity_reserve_bytes,
        "conservative_net_bytes": conservative_net_bytes,
        "design_gate_bytes": DESIGN_GATE_BYTES,
        "passes_64k_design_gate": (
            conservative_net_bytes >= DESIGN_GATE_BYTES
        ),
        "estimate_assumptions": {
            "descriptor_base_bytes_per_cluster_member":
                DESCRIPTOR_BASE_BYTES_PER_MEMBER,
            "far_pointer_bytes_per_per_game_reference":
                FAR_POINTER_BYTES,
            "banked_bridge_bytes_per_eliminated_exported_alias":
                BANKED_BRIDGE_BYTES_PER_EXPORTED_ALIAS,
            "hot_cross_bank_bytes_per_symbol_edge":
                HOT_CROSS_BANK_BYTES_PER_SYMBOL_EDGE,
            "genericity_reserve_percent": 25,
        },
    }


def _parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--objects", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    report = analyze_objects(
        args.objects.glob("g??_*.o"),
        object_banks={
            str(name): int(bank)
            for name, bank in manifest["object_banks"].items()
        },
    )
    report["objects"] = str(args.objects)
    report["manifest"] = str(args.manifest)
    report["roadmap_scope"] = {
        kind: report["kinds"].get(
            kind,
            {
                "object_count": 0,
                "distinct_normalized_contents": 0,
                "code_bytes": 0,
                "duplicate_cluster_count": 0,
                "gross_duplicate_bytes": 0,
                "directly_shareable_bytes": 0,
            },
        )
        for kind in sorted(ROADMAP_KINDS)
    }
    report["roadmap_gross_duplicate_bytes"] = sum(
        int(row["gross_duplicate_bytes"])
        for row in report["roadmap_scope"].values()
    )
    report["opportunity_estimate"] = estimate_opportunity(
        report,
        kinds=ROADMAP_KINDS,
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "objects": report["object_count"],
                "gross_duplicate_bytes": report["totals"][
                    "gross_duplicate_bytes"
                ],
                "roadmap_gross_duplicate_bytes": report[
                    "roadmap_gross_duplicate_bytes"
                ],
                "directly_shareable_bytes": report["totals"][
                    "directly_shareable_bytes"
                ],
                "out": str(args.out),
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
