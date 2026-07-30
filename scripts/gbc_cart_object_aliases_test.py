#!/usr/bin/env python3
"""Focused tests for append-only ASxxxx definition aliases."""

from __future__ import annotations

import re

from gbc_cart_object_aliases import merge_namespaced_definitions


NORMALIZED_FIXTURE_SHA256 = (
    "1d6141f8f9f6bf78b00e82330ca19e3"
    "ae516d0f891b50f3c3f78609641e499a9"
)


def object_text(
    *,
    prefix: str,
    bank: int,
    code_size: int = 3,
    definitions: tuple[tuple[str, int], ...] = (
        ("get", 1),
        ("set", 2),
    ),
    references: tuple[str, ...] = (),
    code: str = "3E 02 C9",
    relocation: str = "00 00 08 00",
) -> str:
    symbols = [
        *(f"S {name} Ref00000000" for name in references),
        *(
            f"S _{prefix}_{suffix} Def{address:08X}"
            for suffix, address in definitions
        ),
    ]
    symbols_text = "\n".join(symbols)
    return (
        "XL4\n"
        f"H B areas {len(symbols):X} global symbols\n"
        "M generated_compact_facade\n"
        f"A _CODE_{bank} size {code_size:X} flags 0 addr 0\n"
        f"{symbols_text}\n"
        f"T 00 00 00 00 {code}\n"
        f"R {relocation}\n"
    )


def real_gbdk_layout_text(*, prefix: str, bank: int) -> str:
    definitions = (
        ("get_movements", 0xA3),
        ("set_movements", 0xAE),
        ("get_objects", 0x81),
        ("cell_has_all", 0x126),
        ("set_objects", 0x8C),
        ("cell_has_any", 0xF2),
        ("cell_count", 0x59),
        ("mark_dirty", 0xC5),
    )
    symbols = "\n".join(
        f"S _{prefix}_{name} Def{address:08X}"
        for name, address in definitions
    )
    return (
        "XL4\n"
        "H B areas A global symbols\n"
        "M generated_compact_facade\n"
        "S __mulint Ref00000000\n"
        "S .__.ABS. Def00000000\n"
        "A _CODE size 0 flags 0 addr 0\n"
        "A _HRAM size 0 flags 0 addr 0\n"
        "A _DATA size 0 flags 0 addr 0\n"
        "A _INITIALIZED size 0 flags 0 addr 0\n"
        "A _DABS size 0 flags 8 addr 0\n"
        "A _HOME size 0 flags 0 addr 0\n"
        "A _GSINIT size 0 flags 0 addr 0\n"
        "A _GSFINAL size 0 flags 0 addr 0\n"
        f"A _CODE_{bank} size 15D flags 0 addr 0\n"
        f"{symbols}\n"
        "A _INITIALIZER size 0 flags 0 addr 0\n"
        "A _CABS size 0 flags 8 addr 0\n"
        "T 00 00 00 00\n"
        "R 00 00 08 00\n"
        "T 00 00 00 00 3E 02 C9\n"
        "R 00 00 08 00\n"
    )


def records(text: str, marker: str) -> tuple[str, ...]:
    return tuple(line for line in text.splitlines() if line.startswith(marker))


def rejection_problem(
    label: str,
    owner_text: str,
    member_text: str,
    invariant: str,
) -> str | None:
    try:
        merge_namespaced_definitions(
            owner_text,
            member_text,
            owner_prefix="g21",
            member_prefix="g31",
        )
    except ValueError as error:
        if invariant not in str(error):
            return f"{label}: wrong error: {error}"
        return None
    return f"{label}: {invariant} violation was accepted"


def assert_rejected(
    owner_text: str,
    member_text: str,
    invariant: str,
) -> None:
    problem = rejection_problem(
        invariant,
        owner_text,
        member_text,
        invariant,
    )
    assert problem is None, problem


def main() -> int:
    owner = object_text(prefix="g21", bank=25)
    member = object_text(prefix="g31", bank=35)
    merged = merge_namespaced_definitions(
        owner,
        member,
        owner_prefix="g21",
        member_prefix="g31",
    )

    assert "H B areas 4 global symbols" in merged.text
    assert "S _g31_get Def00000001" in merged.text
    assert "S _g31_set Def00000002" in merged.text
    assert merged.aliases == (
        ("_g31_get", 1),
        ("_g31_set", 2),
    )
    assert merged.implementation_bytes == 3
    assert re.fullmatch(r"[0-9a-f]{64}", merged.normalized_sha256)
    assert merged.normalized_sha256 == NORMALIZED_FIXTURE_SHA256
    reverse_merged = merge_namespaced_definitions(
        member,
        owner,
        owner_prefix="g31",
        member_prefix="g21",
    )
    assert reverse_merged.normalized_sha256 == NORMALIZED_FIXTURE_SHA256
    assert records(merged.text, "T ") == records(owner, "T ")
    assert records(merged.text, "R ") == records(owner, "R ")

    merged_lines = merged.text.splitlines()
    aliases = {
        "S _g31_get Def00000001",
        "S _g31_set Def00000002",
    }
    merged_owner_lines = [
        line for line in merged_lines if line not in aliases
    ]
    expected_owner_lines = owner.replace(
        "H B areas 2 global symbols",
        "H B areas 4 global symbols",
    ).splitlines()
    assert merged_owner_lines == expected_owner_lines

    owner_symbol_indexes = [
        merged_lines.index(line)
        for line in owner.splitlines()
        if line.startswith("S ")
    ]
    alias_indexes = [
        merged_lines.index("S _g31_get Def00000001"),
        merged_lines.index("S _g31_set Def00000002"),
    ]
    assert max(owner_symbol_indexes) < min(alias_indexes)

    bank_owner = object_text(
        prefix="g21",
        bank=25,
        definitions=(("entry", 1),),
    ).replace(
        "S _g21_entry Def00000001",
        "S b_g21_entry Def00000019",
    )
    bank_member = object_text(
        prefix="g31",
        bank=35,
        definitions=(("entry", 1),),
    ).replace(
        "S _g31_entry Def00000001",
        "S b_g31_entry Def00000019",
    )
    bank_merged = merge_namespaced_definitions(
        bank_owner,
        bank_member,
        owner_prefix="g21",
        member_prefix="g31",
    )
    assert bank_merged.aliases == (("b_g31_entry", 0x19),)
    assert "S b_g31_entry Def00000019" in bank_merged.text

    assert_rejected(
        owner,
        object_text(prefix="g31", bank=35, code_size=4),
        "code-area size invariant",
    )
    assert_rejected(
        owner,
        member.replace("3E 02 C9", "3E 03 C9"),
        "text-record invariant",
    )

    owner_with_call = object_text(
        prefix="g21",
        bank=25,
        references=("_g21_runtime_alpha",),
    )
    assert_rejected(
        owner_with_call,
        object_text(
            prefix="g31",
            bank=35,
            references=("_g31_runtime_beta",),
        ),
        "symbol-record invariant",
    )
    assert_rejected(
        owner,
        member.replace("R 00 00 08 00", "R 00 00 09 00"),
        "relocation-record invariant",
    )
    assert_rejected(
        owner,
        member.replace("R 00 00 08 00", "R 00 00 08 01"),
        "relocation-record invariant",
    )
    assert_rejected(
        owner,
        member.replace("S _g31_get Def00000001", "S _g31_get Def00000002"),
        "definition-address invariant",
    )

    owner_with_alias = owner.replace(
        "S _g21_set Def00000002",
        "S _g21_set Def00000002\nS _g31_get Def00000001",
    ).replace(
        "H B areas 2 global symbols",
        "H B areas 3 global symbols",
    )
    assert_rejected(
        owner_with_alias,
        member,
        "alias-uniqueness invariant",
    )

    assert_rejected(
        owner.replace(
            "H B areas 2 global symbols",
            "H B areas nope global symbols",
        ),
        member,
        "global-symbol count invariant",
    )
    assert_rejected(
        owner.replace(
            "H B areas 2 global symbols",
            "H B areas FFFFFFFF global symbols",
        ),
        member,
        "global-symbol count overflow invariant",
    )
    assert_rejected(
        owner.replace(
            "H B areas 2 global symbols",
            "H B areas 3 global symbols",
        ),
        member,
        "global-symbol count invariant",
    )

    assert_rejected(
        owner + "A _CODE_26 size 1 flags 0 addr 0\n",
        member,
        "single nonempty code-area invariant",
    )

    interior_owner = object_text(
        prefix="g21",
        bank=25,
        references=("_g21_helper_g21_target",),
    )
    interior_member = object_text(
        prefix="g31",
        bank=35,
        references=("_g31_helper_g31_target",),
    )
    assert_rejected(
        interior_owner,
        interior_member,
        "symbol-record invariant",
    )

    duplicate_member = member.replace(
        "S _g31_set Def00000002",
        "S _g31_set Def00000002\nS _g31_get Def00000001",
    ).replace(
        "H B areas 2 global symbols",
        "H B areas 3 global symbols",
    )
    duplicate_owner = owner.replace(
        "S _g21_set Def00000002",
        "S _g21_set Def00000002\nS _g21_get Def00000001",
    ).replace(
        "H B areas 2 global symbols",
        "H B areas 3 global symbols",
    )
    duplicate_problems = [
        problem
        for problem in (
            rejection_problem(
                "member duplicate",
                owner,
                duplicate_member,
                "duplicate-definition invariant",
            ),
            rejection_problem(
                "owner duplicate",
                duplicate_owner,
                member,
                "duplicate-definition invariant",
            ),
        )
        if problem is not None
    ]
    assert not duplicate_problems, duplicate_problems

    layout_problems = [
        problem
        for problem in (
            rejection_problem(
                "S-record whitespace",
                owner,
                member.replace(
                    "S _g31_get Def00000001",
                    "S  _g31_get  Def00000001",
                ),
                "normalized-object invariant",
            ),
            rejection_problem(
                "line endings",
                owner,
                member.replace("\n", "\r\n"),
                "normalized-object invariant",
            ),
            rejection_problem(
                "final newline",
                owner,
                member.removesuffix("\n"),
                "normalized-object invariant",
            ),
        )
        if problem is not None
    ]
    assert not layout_problems, layout_problems

    real_owner = real_gbdk_layout_text(prefix="g21", bank=25)
    real_member = real_gbdk_layout_text(prefix="g31", bank=35)
    real_merged = merge_namespaced_definitions(
        real_owner,
        real_member,
        owner_prefix="g21",
        member_prefix="g31",
    )
    assert "H B areas 12 global symbols" in real_merged.text
    assert len(real_merged.aliases) == 8
    assert real_merged.implementation_bytes == 0x15D
    assert real_merged.aliases[0] == ("_g31_get_movements", 0xA3)
    assert real_merged.aliases[-1] == ("_g31_mark_dirty", 0xC5)
    assert records(real_merged.text, "T ") == records(real_owner, "T ")
    assert records(real_merged.text, "R ") == records(real_owner, "R ")
    real_lines = real_merged.text.splitlines()
    assert real_lines.index("S __mulint Ref00000000") < real_lines.index(
        "A _CODE size 0 flags 0 addr 0"
    )
    assert real_lines.index(
        "S _g21_mark_dirty Def000000C5"
    ) < real_lines.index(
        "S _g31_get_movements Def000000A3"
    )
    assert real_lines.index(
        "S _g31_mark_dirty Def000000C5"
    ) < real_lines.index(
        "A _INITIALIZER size 0 flags 0 addr 0"
    )
    real_alias_lines = {
        f"S {name} Def{address:08X}"
        for name, address in real_merged.aliases
    }
    real_owner_lines = [
        line for line in real_lines if line not in real_alias_lines
    ]
    expected_real_owner_lines = real_owner.replace(
        "H B areas A global symbols",
        "H B areas 12 global symbols",
    ).splitlines()
    assert real_owner_lines == expected_real_owner_lines

    format_problems = [
        problem
        for problem in (
            rejection_problem(
                "unsupported owner format",
                owner.replace("XL4\n", "XL3\n", 1),
                member,
                "object-format invariant",
            ),
            rejection_problem(
                "missing member format",
                owner,
                member.removeprefix("XL4\n"),
                "object-format invariant",
            ),
        )
        if problem is not None
    ]
    assert not format_problems, format_problems

    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
