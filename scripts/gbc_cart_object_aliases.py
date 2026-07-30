#!/usr/bin/env python3
"""Validate equivalent ASxxxx objects and append definition aliases."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass


HEADER_RECORD = re.compile(
    r"^(H\s+[0-9A-Fa-f]+\s+areas\s+)"
    r"(\S+)"
    r"(\s+global symbols)$"
)
AREA_RECORD = re.compile(
    r"^A\s+(\S+)\s+size\s+([0-9A-Fa-f]+)\b.*$"
)
CODE_AREA = re.compile(r"^_CODE_(\d+)$")
SYMBOL_RECORD = re.compile(
    r"^S\s+(\S+)\s+(Def|Ref)([0-9A-Fa-f]{8})(.*)$"
)
TEXT_RECORD = re.compile(r"^T(?:\s+[0-9A-Fa-f]{2})+$")
RELOCATION_RECORD = re.compile(r"^R(?:\s+[0-9A-Fa-f]{2})+$")
MAX_ASXXXX_COUNT = 0xFFFFFFFF


@dataclass(frozen=True)
class AliasMerge:
    text: str
    aliases: tuple[tuple[str, int], ...]
    implementation_bytes: int
    normalized_sha256: str


@dataclass(frozen=True)
class _Symbol:
    line_index: int
    name: str
    binding: str
    address: int
    tail: str


@dataclass(frozen=True)
class _Object:
    lines: tuple[str, ...]
    header_index: int
    global_count: int
    code_size: int
    symbols: tuple[_Symbol, ...]
    text_records: tuple[tuple[int, ...], ...]
    relocation_records: tuple[tuple[int, ...], ...]


def _line_body(line: str) -> str:
    return line.rstrip("\r\n")


def _parse_object(text: str, role: str) -> _Object:
    lines = tuple(text.splitlines(keepends=True))
    headers: list[tuple[int, re.Match[str]]] = []
    symbols: list[_Symbol] = []
    text_records: list[tuple[int, ...]] = []
    relocation_records: list[tuple[int, ...]] = []
    nonempty_code_sizes: list[int] = []

    for line_index, line in enumerate(lines):
        body = _line_body(line)
        if body.startswith("H "):
            header = HEADER_RECORD.fullmatch(body)
            if header is None:
                raise ValueError(
                    f"{role} global-symbol count invariant: "
                    "malformed H record"
                )
            headers.append((line_index, header))
            continue

        if body.startswith("S "):
            symbol = SYMBOL_RECORD.fullmatch(body)
            if symbol is None:
                raise ValueError(
                    f"{role} symbol-record invariant: malformed S record"
                )
            symbols.append(
                _Symbol(
                    line_index=line_index,
                    name=symbol.group(1),
                    binding=symbol.group(2),
                    address=int(symbol.group(3), 16),
                    tail=symbol.group(4),
                )
            )
            continue

        area = AREA_RECORD.fullmatch(body)
        if area is not None:
            if (
                CODE_AREA.fullmatch(area.group(1)) is not None
                and int(area.group(2), 16) != 0
            ):
                nonempty_code_sizes.append(int(area.group(2), 16))
            continue

        if body.startswith("T"):
            if TEXT_RECORD.fullmatch(body) is None:
                raise ValueError(
                    f"{role} text-record invariant: malformed T record"
                )
            text_records.append(
                tuple(int(value, 16) for value in body.split()[1:])
            )
            continue

        if body.startswith("R"):
            if RELOCATION_RECORD.fullmatch(body) is None:
                raise ValueError(
                    f"{role} relocation-record invariant: malformed R record"
                )
            relocation_records.append(
                tuple(int(value, 16) for value in body.split()[1:])
            )

    if len(headers) != 1:
        raise ValueError(
            f"{role} global-symbol count invariant: "
            f"expected one H record, found {len(headers)}"
        )
    header_index, header = headers[0]
    try:
        global_count = int(header.group(2), 16)
    except ValueError as error:
        raise ValueError(
            f"{role} global-symbol count invariant: "
            "count is not hexadecimal"
        ) from error
    if global_count > MAX_ASXXXX_COUNT:
        raise ValueError(
            f"{role} global-symbol count overflow invariant: "
            f"{header.group(2)} exceeds 32 bits"
        )
    if len(nonempty_code_sizes) != 1:
        raise ValueError(
            f"{role} single nonempty code-area invariant: "
            f"found {len(nonempty_code_sizes)} _CODE_N areas"
        )

    return _Object(
        lines=lines,
        header_index=header_index,
        global_count=global_count,
        code_size=nonempty_code_sizes[0],
        symbols=tuple(symbols),
        text_records=tuple(text_records),
        relocation_records=tuple(relocation_records),
    )


def _normalize_symbol(name: str, prefix: str) -> str:
    for marker in ("_", "b_"):
        namespace = f"{marker}{prefix}_"
        if name.startswith(namespace):
            return marker + name[len(namespace):]
    return name


def _is_namespaced(name: str, prefix: str) -> bool:
    return any(
        name.startswith(f"{marker}{prefix}_")
        for marker in ("_", "b_")
    )


def _normalized_text(parsed: _Object, prefix: str) -> str:
    normalized: list[str] = []
    for line in parsed.lines:
        body = _line_body(line)
        symbol = SYMBOL_RECORD.fullmatch(body)
        if symbol is not None:
            normalized.append(
                "S "
                f"{_normalize_symbol(symbol.group(1), prefix)} "
                f"{symbol.group(2)}00000000{symbol.group(4)}"
            )
            continue
        area = AREA_RECORD.fullmatch(body)
        if (
            area is not None
            and CODE_AREA.fullmatch(area.group(1)) is not None
        ):
            start, end = area.span(1)
            body = body[:start] + "_CODE_N" + body[end:]
        normalized.append(body)
    return "\n".join(normalized) + "\n"


def _namespaced_definitions(
    parsed: _Object,
    prefix: str,
) -> tuple[tuple[_Symbol, str], ...]:
    return tuple(
        (symbol, _normalize_symbol(symbol.name, prefix))
        for symbol in parsed.symbols
        if symbol.binding == "Def"
        and _is_namespaced(symbol.name, prefix)
    )


def _replace_header_count(
    line: str,
    count: int,
) -> str:
    body = _line_body(line)
    header = HEADER_RECORD.fullmatch(body)
    if header is None:
        raise AssertionError("validated H record no longer matches")
    start, end = header.span(2)
    ending = line[len(body):]
    return body[:start] + f"{count:X}" + body[end:] + ending


def merge_namespaced_definitions(
    owner_text: str,
    member_text: str,
    *,
    owner_prefix: str,
    member_prefix: str,
) -> AliasMerge:
    """Append member definition names at matching owner addresses."""

    owner = _parse_object(owner_text, "owner")
    member = _parse_object(member_text, "member")
    owner_definitions = _namespaced_definitions(owner, owner_prefix)
    member_definitions = _namespaced_definitions(member, member_prefix)
    if not owner_definitions or not member_definitions:
        raise ValueError(
            "namespaced-definition invariant: "
            "both objects must define namespaced symbols"
        )

    owner_symbol_names = {symbol.name for symbol in owner.symbols}
    conflicting_aliases = [
        symbol.name
        for symbol, _normalized_name in member_definitions
        if symbol.name in owner_symbol_names
    ]
    if conflicting_aliases:
        raise ValueError(
            "alias-uniqueness invariant: owner already contains "
            + ", ".join(conflicting_aliases)
        )

    alias_count = len(member_definitions)
    if owner.global_count > MAX_ASXXXX_COUNT - alias_count:
        raise ValueError(
            "owner global-symbol count overflow invariant: "
            f"{owner.global_count:X} + {alias_count:X} exceeds 32 bits"
        )
    for role, parsed in (("owner", owner), ("member", member)):
        if parsed.global_count != len(parsed.symbols):
            raise ValueError(
                f"{role} global-symbol count invariant: "
                f"H declares {parsed.global_count:X}, "
                f"found {len(parsed.symbols):X} S records"
            )

    if owner.code_size != member.code_size:
        raise ValueError(
            "code-area size invariant: "
            f"owner={owner.code_size:X}, member={member.code_size:X}"
        )
    if owner.text_records != member.text_records:
        raise ValueError("text-record invariant: T records differ")
    if owner.relocation_records != member.relocation_records:
        raise ValueError(
            "relocation-record invariant: R records differ"
        )

    owner_symbols = tuple(
        (
            _normalize_symbol(symbol.name, owner_prefix),
            symbol.binding,
            symbol.tail,
        )
        for symbol in owner.symbols
    )
    member_symbols = tuple(
        (
            _normalize_symbol(symbol.name, member_prefix),
            symbol.binding,
            symbol.tail,
        )
        for symbol in member.symbols
    )
    if owner_symbols != member_symbols:
        raise ValueError(
            "symbol-record invariant: normalized S names, bindings, "
            "or order differ"
        )

    owner_addresses = tuple(
        (normalized_name, symbol.address)
        for symbol, normalized_name in owner_definitions
    )
    member_addresses = tuple(
        (normalized_name, symbol.address)
        for symbol, normalized_name in member_definitions
    )
    if owner_addresses != member_addresses:
        raise ValueError(
            "definition-address invariant: normalized definitions differ"
        )

    owner_normalized = _normalized_text(owner, owner_prefix)
    member_normalized = _normalized_text(member, member_prefix)
    if owner_normalized != member_normalized:
        raise ValueError(
            "normalized-object invariant: non-namespaced object records differ"
        )
    normalized_sha256 = hashlib.sha256(
        owner_normalized.encode("utf-8")
    ).hexdigest()

    aliases = tuple(
        (member_symbol.name, owner_symbol.address)
        for (
            (owner_symbol, _owner_name),
            (member_symbol, _member_name),
        ) in zip(owner_definitions, member_definitions, strict=True)
    )

    output_lines = list(owner.lines)
    output_lines[owner.header_index] = _replace_header_count(
        output_lines[owner.header_index],
        owner.global_count + alias_count,
    )
    insertion_index = max(
        symbol.line_index for symbol in owner.symbols
    ) + 1
    line_ending = (
        "\r\n"
        if owner.lines[insertion_index - 1].endswith("\r\n")
        else "\n"
    )
    if not output_lines[insertion_index - 1].endswith(("\r", "\n")):
        output_lines[insertion_index - 1] += line_ending
    output_lines[insertion_index:insertion_index] = [
        f"S {name} Def{address:08X}{line_ending}"
        for name, address in aliases
    ]

    return AliasMerge(
        text="".join(output_lines),
        aliases=aliases,
        implementation_bytes=owner.code_size,
        normalized_sha256=normalized_sha256,
    )
