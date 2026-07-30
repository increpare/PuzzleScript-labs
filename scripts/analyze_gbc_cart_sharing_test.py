#!/usr/bin/env python3
"""Focused tests for GBC compilation-cart object sharing analysis."""

from __future__ import annotations

import tempfile
from pathlib import Path

import analyze_gbc_cart_sharing


def object_text(
    *,
    module: str,
    bank: int,
    code_size: int,
    definitions: tuple[str, ...],
    references: tuple[str, ...] = (),
    code: str = "3E 01 C9",
    relocation: str = "00 00 08 00",
) -> str:
    symbols = "\n".join(
        [
            *(f"S {name} Ref00000000" for name in references),
            *(
                f"S {name} Def{address:08X}"
                for address, name in enumerate(definitions, start=1)
            ),
        ]
    )
    return (
        "XL4\n"
        f"H 1 areas {len(definitions) + len(references)} global symbols\n"
        f"M {module}\n"
        f"{symbols}\n"
        f"A _CODE_{bank} size {code_size:X} flags 0 addr 0\n"
        f"T 00 00 00 00 {code}\n"
        f"R {relocation}\n"
    )


def write_object(root: Path, name: str, text: str) -> Path:
    path = root / name
    path.write_text(text, encoding="utf-8")
    return path


def cluster_for(
    report: dict[str, object],
    kind: str,
) -> dict[str, object]:
    clusters = report["clusters"]
    assert isinstance(clusters, list)
    matches = [row for row in clusters if row["kind"] == kind]
    assert len(matches) == 1
    return matches[0]


def main() -> int:
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)

        shareable = [
            write_object(
                root,
                "g00_shared_helper.o",
                object_text(
                    module="shared_helper",
                    bank=7,
                    code_size=0x10,
                    definitions=("_shared_helper",),
                ),
            ),
            write_object(
                root,
                "g01_shared_helper.o",
                object_text(
                    module="shared_helper",
                    bank=8,
                    code_size=0x10,
                    definitions=("_shared_helper",),
                ),
            ),
        ]
        same_bank_report = analyze_gbc_cart_sharing.analyze_objects(
            shareable,
            object_banks={
                "g00_shared_helper.o": 20,
                "g01_shared_helper.o": 20,
            },
        )
        shareable_cluster = cluster_for(same_bank_report, "shared_helper")
        assert shareable_cluster["gross_duplicate_bytes"] == 0x10
        assert shareable_cluster["per_game_symbol_references"] == []
        assert shareable_cluster["directly_shareable"] is True
        assert same_bank_report["normalization"] == {
            "normalized": [
                "gNN_ namespace prefixes",
                "_CODE_N area numbers",
                "S-record symbol addresses and generated bank-symbol values",
            ],
            "preserved": [
                "T-record instruction bytes and constants",
                "call-target names after namespace removal",
                "R-record relocation bytes and kinds",
            ],
        }

        cross_bank_report = analyze_gbc_cart_sharing.analyze_objects(
            shareable,
            object_banks={
                "g00_shared_helper.o": 20,
                "g01_shared_helper.o": 21,
            },
        )
        assert (
            cluster_for(cross_bank_report, "shared_helper")[
                "directly_shareable"
            ]
            is False
        )

        generated = [
            write_object(
                root,
                "g00_generated_core.o",
                object_text(
                    module="generated_core",
                    bank=3,
                    code_size=0x2000,
                    definitions=(
                        "b_g00_ps_gbc_step",
                        "_g00_ps_gbc_step",
                    ),
                    references=("_g00_ps_gbc_generated_game",),
                ),
            ),
            write_object(
                root,
                "g01_generated_core.o",
                object_text(
                    module="generated_core",
                    bank=4,
                    code_size=0x2000,
                    definitions=(
                        "b_g01_ps_gbc_step",
                        "_g01_ps_gbc_step",
                    ),
                    references=("_g01_ps_gbc_generated_game",),
                ),
            ),
        ]
        generated_targets = [
            write_object(
                root,
                "g00_generated_game.o",
                object_text(
                    module="generated_game",
                    bank=3,
                    code_size=3,
                    definitions=("_g00_ps_gbc_generated_game",),
                    code="3E 10 C9",
                ),
            ),
            write_object(
                root,
                "g01_generated_game.o",
                object_text(
                    module="generated_game",
                    bank=5,
                    code_size=3,
                    definitions=("_g01_ps_gbc_generated_game",),
                    code="3E 11 C9",
                ),
            ),
        ]
        generated_report = analyze_gbc_cart_sharing.analyze_objects(
            generated + generated_targets,
            object_banks={
                "g00_generated_core.o": 3,
                "g01_generated_core.o": 4,
                "g00_generated_game.o": 3,
                "g01_generated_game.o": 5,
            },
        )
        generated_cluster = cluster_for(
            generated_report, "generated_core"
        )
        assert generated_cluster == {
            "kind": "generated_core",
            "members": [
                "g00_generated_core.o",
                "g01_generated_core.o",
            ],
            "implementation_bytes": 8192,
            "gross_duplicate_bytes": 8192,
            "per_game_symbol_references": ["ps_gbc_generated_game"],
            "per_game_symbol_definitions": ["ps_gbc_step"],
            "source_banks": [3, 4],
            "directly_shareable": False,
        }
        assert generated_report["reference_inventory"] == {
            "per_game_reference_occurrences": 2,
            "resolved_per_game_reference_occurrences": 2,
            "same_bank_per_game_reference_occurrences": 1,
            "cross_bank_per_game_reference_occurrences": 1,
            "unresolved_per_game_reference_occurrences": 0,
            "cross_bank_edges": [
                {
                    "source_object": "g01_generated_core.o",
                    "source_bank": 4,
                    "target_object": "g01_generated_game.o",
                    "target_bank": 5,
                    "symbol": "ps_gbc_generated_game",
                }
            ],
        }
        estimate = analyze_gbc_cart_sharing.estimate_opportunity(
            generated_report,
            kinds={"generated_core"},
        )
        assert estimate["configuration_clusters"] == 1
        assert estimate["shared_implementation_bytes"] == 8192
        assert estimate["gross_duplicate_bytes"] == 8192
        assert estimate["descriptor_context_bytes"] == 22
        assert estimate["home_banked_bridge_bytes"] == 16
        assert estimate["hot_cross_bank_symbol_edges"] == 1
        assert estimate["hot_cross_bank_call_bytes"] == 32
        assert estimate["genericity_reserve_bytes"] == 2048
        assert estimate["conservative_net_bytes"] == 6074
        assert estimate["passes_64k_design_gate"] is False

        different_bytes = [
            write_object(
                root,
                "g00_different_bytes.o",
                object_text(
                    module="different_bytes",
                    bank=9,
                    code_size=3,
                    definitions=("_g00_body",),
                    code="3E 01 C9",
                ),
            ),
            write_object(
                root,
                "g01_different_bytes.o",
                object_text(
                    module="different_bytes",
                    bank=10,
                    code_size=3,
                    definitions=("_g01_body",),
                    code="3E 02 C9",
                ),
            ),
        ]
        different_report = analyze_gbc_cart_sharing.analyze_objects(
            different_bytes
        )
        assert different_report["clusters"] == []
        assert different_report["kinds"]["different_bytes"][
            "distinct_normalized_contents"
        ] == 2

        call_targets = [
            write_object(
                root,
                "g00_call_target.o",
                object_text(
                    module="call_target",
                    bank=11,
                    code_size=3,
                    definitions=("_g00_caller",),
                    references=("_g00_target_a",),
                ),
            ),
            write_object(
                root,
                "g01_call_target.o",
                object_text(
                    module="call_target",
                    bank=12,
                    code_size=3,
                    definitions=("_g01_caller",),
                    references=("_g01_target_b",),
                ),
            ),
        ]
        assert analyze_gbc_cart_sharing.analyze_objects(call_targets)[
            "clusters"
        ] == []

        relocation_kinds = [
            write_object(
                root,
                "g00_relocation_kind.o",
                object_text(
                    module="relocation_kind",
                    bank=13,
                    code_size=3,
                    definitions=("_g00_body",),
                    relocation="00 00 08 00 02 04 06 00",
                ),
            ),
            write_object(
                root,
                "g01_relocation_kind.o",
                object_text(
                    module="relocation_kind",
                    bank=14,
                    code_size=3,
                    definitions=("_g01_body",),
                    relocation="00 00 08 00 00 04 06 00",
                ),
            ),
        ]
        assert analyze_gbc_cart_sharing.analyze_objects(relocation_kinds)[
            "clusters"
        ] == []

    print("analyze_gbc_cart_sharing_test: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
