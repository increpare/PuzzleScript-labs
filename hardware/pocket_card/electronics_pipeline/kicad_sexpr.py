"""Small streaming helpers for KiCad's S-expression file formats.

The helpers intentionally retain source slices rather than constructing a nested
syntax tree.  KiCad PCB files can contain very large filled-zone expressions,
while callers generally need only selected direct children.
"""

from dataclasses import dataclass
from typing import Iterator, Literal


class SexprError(ValueError):
    """Raised when a KiCad S-expression is malformed."""


@dataclass(frozen=True)
class Token:
    kind: Literal["open", "close", "atom"]
    value: str | None
    start: int
    end: int


@dataclass(frozen=True)
class ChildBlock:
    name: str
    text: str
    start: int
    end: int


_SIMPLE_ESCAPES = {
    '"': 0x22,
    "\\": 0x5C,
    "a": 0x07,
    "b": 0x08,
    "f": 0x0C,
    "n": 0x0A,
    "r": 0x0D,
    "t": 0x09,
    "v": 0x0B,
}


def _location(message: str, index: int) -> SexprError:
    return SexprError(f"{message} at index {index}")


def next_token(source: str, offset: int = 0) -> Token | None:
    """Return the next token at or after *offset*, skipping trivia.

    Quoted atoms use KiCad's byte-escape behavior: simple C escapes, one or two
    hexadecimal digits after ``\\x``, and up to three octal digits.  Escaped and
    literal bytes are decoded together so malformed UTF-8 is rejected.
    """

    if not isinstance(source, str):
        raise TypeError("source must be a string")
    if not isinstance(offset, int) or isinstance(offset, bool) or not 0 <= offset <= len(source):
        raise SexprError(f"token offset must be an integer in [0, {len(source)}], got {offset!r}")

    index = offset
    while index < len(source):
        while index < len(source) and source[index].isspace():
            index += 1
        if index >= len(source) or source[index] != "#":
            break
        while index < len(source) and source[index] not in "\r\n":
            index += 1

    if index >= len(source):
        return None
    if source[index] == "(":
        return Token("open", None, index, index + 1)
    if source[index] == ")":
        return Token("close", None, index, index + 1)
    if source[index] != '"':
        start = index
        while index < len(source) and not source[index].isspace() and source[index] not in "()#":
            index += 1
        return Token("atom", source[start:index], start, index)

    quote_start = index
    value = bytearray()
    index += 1
    while index < len(source):
        character = source[index]
        if character == '"':
            try:
                decoded = bytes(value).decode("utf-8", errors="strict")
            except UnicodeDecodeError as error:
                raise _location("invalid UTF-8 in quoted atom", quote_start) from error
            return Token("atom", decoded, quote_start, index + 1)

        if character != "\\":
            code_point_length = 2 if 0xD800 <= ord(character) <= 0xDBFF else 1
            literal = source[index : index + code_point_length]
            try:
                value.extend(literal.encode("utf-8", errors="strict"))
            except UnicodeEncodeError as error:
                raise _location("invalid UTF-8 in quoted atom", quote_start) from error
            index += code_point_length
            continue

        escape_start = index
        index += 1
        if index >= len(source):
            break
        escaped = source[index]
        if escaped in _SIMPLE_ESCAPES:
            value.append(_SIMPLE_ESCAPES[escaped])
            index += 1
            continue
        if escaped == "x":
            index += 1
            digits_start = index
            while index < len(source) and index - digits_start < 2 and source[index] in "0123456789abcdefABCDEF":
                index += 1
            if index == digits_start:
                value.append(ord("x"))
            else:
                value.append(int(source[digits_start:index], 16))
            continue
        if escaped in "01234567":
            digits_start = index
            while index < len(source) and index - digits_start < 3 and source[index] in "01234567":
                index += 1
            value.append(int(source[digits_start:index], 8) & 0xFF)
            continue

        # KiCad preserves an unknown escape as a literal backslash followed by
        # the character.  Reprocess the latter as ordinary text next iteration.
        value.append(ord("\\"))
        index = escape_start + 1

    raise _location("unterminated quoted atom", quote_start)


def _balanced_end(source: str, start: int) -> int:
    token = next_token(source, start)
    if token is None or token.start != start or token.kind != "open":
        raise _location("expected S-expression opening parenthesis", start)

    depth = 1
    index = token.end
    while True:
        token = next_token(source, index)
        if token is None:
            raise _location("unterminated S-expression", start)
        index = token.end
        if token.kind == "open":
            depth += 1
        elif token.kind == "close":
            depth -= 1
            if depth == 0:
                return token.end


def balanced_block(source: str, start: int) -> str:
    """Return the balanced expression beginning exactly at *start*."""

    if not isinstance(source, str):
        raise TypeError("source must be a string")
    if not isinstance(start, int) or isinstance(start, bool) or not 0 <= start < len(source):
        raise SexprError(f"S-expression start offset is outside source at index {start!r}")
    return source[start : _balanced_end(source, start)]


def expression_atoms(expression: str, limit: int) -> tuple[str, ...]:
    """Return up to *limit* leading atoms from an expression."""

    if not isinstance(limit, int) or isinstance(limit, bool) or limit < 0:
        raise ValueError("atom limit must be a non-negative integer")
    token = next_token(expression, 0)
    if token is None or token.start != 0 or token.kind != "open":
        return ()
    atoms: list[str] = []
    index = token.end
    while len(atoms) < limit:
        token = next_token(expression, index)
        if token is None or token.kind != "atom":
            break
        atoms.append(token.value if token.value is not None else "")
        index = token.end
    return tuple(atoms)


def _expression_name(source: str, start: int, end: int) -> str:
    opening = next_token(source, start)
    if opening is None or opening.kind != "open" or opening.start != start:
        return ""
    name = next_token(source, opening.end)
    if name is None or name.end > end or name.kind != "atom":
        return ""
    return name.value if name.value is not None else ""


def iter_direct_child_spans(source: str, start: int, end: int) -> Iterator[tuple[str, int, int]]:
    """Yield direct-child spans without copying their contents.

    This is intentionally public-but-low-level enough for sibling pipeline
    modules to avoid copying filled zones.  The stable convenience API is
    :func:`direct_children`.
    """

    opening = next_token(source, start)
    if opening is None or opening.start != start or opening.kind != "open":
        raise _location("expected S-expression opening parenthesis", start)
    index = opening.end
    depth = 1
    while index < end:
        token = next_token(source, index)
        if token is None or token.start >= end:
            break
        if token.kind == "open":
            if depth == 1:
                child_end = _balanced_end(source, token.start)
                if child_end > end:
                    raise _location("child expression extends past parent", token.start)
                name = _expression_name(source, token.start, child_end)
                if not name:
                    raise _location(
                        "child expression requires a nonempty atom name", token.start
                    )
                yield name, token.start, child_end
                index = child_end
                continue
            depth += 1
        elif token.kind == "close":
            depth -= 1
            if depth == 0:
                return
        index = token.end


def direct_children(expression: str) -> tuple[ChildBlock, ...]:
    """Return all direct child expressions, preserving duplicates and order."""

    end = _balanced_end(expression, 0)
    return tuple(
        ChildBlock(name, expression[start:child_end], start, child_end)
        for name, start, child_end in iter_direct_child_spans(expression, 0, end)
    )


def one_root(source: str, expected_name: str) -> ChildBlock:
    """Require exactly one root expression with *expected_name*."""

    first = next_token(source, 0)
    if first is None or first.kind != "open":
        location = first.start if first is not None else 0
        raise _location(f"expected exactly one {expected_name} root", location)
    end = _balanced_end(source, first.start)
    name = _expression_name(source, first.start, end)
    if name != expected_name:
        label = name or "unnamed expression"
        raise _location(f"expected exactly one {expected_name} root, found {label}", first.start)
    trailing = next_token(source, end)
    if trailing is not None:
        raise _location(f"unexpected trailing content after {expected_name} root", trailing.start)
    return ChildBlock(name, source[first.start:end], first.start, end)
