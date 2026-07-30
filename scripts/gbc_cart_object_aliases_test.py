#!/usr/bin/env python3
"""Focused tests for append-only ASxxxx definition aliases."""

from __future__ import annotations

import re

from gbc_cart_object_aliases import merge_namespaced_definitions


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


def records(text: str, marker: str) -> tuple[str, ...]:
    return tuple(line for line in text.splitlines() if line.startswith(marker))


def assert_rejected(
    owner_text: str,
    member_text: str,
    invariant: str,
) -> None:
    try:
        merge_namespaced_definitions(
            owner_text,
            member_text,
            owner_prefix="g21",
            member_prefix="g31",
        )
    except ValueError as error:
        assert invariant in str(error), error
    else:
        raise AssertionError(f"{invariant} violation was accepted")


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

    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
