"""One-time, byte-preserving lock migration for Pocket Card mechanics."""

from __future__ import annotations

import argparse
import errno
import os
import stat
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from .inventory import parse_board
from .kicad_sexpr import (
    SexprError,
    expression_atoms,
    iter_direct_child_spans,
    next_token,
    one_root,
)
from .mechanics import (
    ContractError,
    MechanicalContract,
    MechanicalReviewRequired,
    check_mechanics,
    load_contract,
)
from .paths import BOARD, MECHANICAL_CONTRACT


class LockMigrationRefused(MechanicalReviewRequired):
    """Raised before writing when lock migration is not mechanically safe."""


class LockMigrationDurabilityError(RuntimeError):
    """Raised after replacement when directory durability cannot be confirmed."""


@dataclass(frozen=True)
class _Block:
    kind: str
    label: str
    start: int
    end: int
    layer_end: int
    lock_state: bool


@dataclass(frozen=True)
class _FileIdentity:
    device: int
    inode: int
    mode: int


def _direct_children(
    source: str, start: int, end: int, name: str | None = None
) -> tuple[tuple[str, int, int], ...]:
    return tuple(
        (child_name, child_start, child_end)
        for child_name, child_start, child_end in iter_direct_child_spans(
            source, start, end
        )
        if name is None or child_name == name
    )


def _child_atoms(
    source: str, start: int, end: int, name: str, limit: int
) -> tuple[tuple[str, ...], int, int] | None:
    matches = _direct_children(source, start, end, name)
    if len(matches) > 1:
        raise LockMigrationRefused(
            (f"duplicate {name} in top-level item at character index {start}",)
        )
    if not matches:
        return None
    _, child_start, child_end = matches[0]
    return expression_atoms(source[child_start:child_end], limit), child_start, child_end


def _required_child_value(
    source: str, start: int, end: int, name: str, label: str
) -> tuple[str, int]:
    result = _child_atoms(source, start, end, name, 3)
    if result is None or len(result[0]) != 2 or not result[0][1]:
        raise LockMigrationRefused(
            (f"{label} has invalid {name} at character index {start}",)
        )
    return result[0][1], result[2]


def _footprint_ref(source: str, start: int, end: int) -> str:
    refs = []
    for _, child_start, child_end in _direct_children(source, start, end, "property"):
        atoms = expression_atoms(source[child_start:child_end], 4)
        if len(atoms) >= 3 and atoms[1] == "Reference":
            refs.append(atoms[2])
    if len(refs) != 1 or not refs[0]:
        raise LockMigrationRefused(
            (f"footprint has invalid Reference at character index {start}",)
        )
    return refs[0]


def _direct_atoms(
    source: str, start: int, end: int
) -> tuple[tuple[str, int, int], ...]:
    children = {
        child_start: child_end
        for _, child_start, child_end in iter_direct_child_spans(source, start, end)
    }
    opening = next_token(source, start)
    if opening is None or opening.kind != "open" or opening.start != start:
        raise SexprError(f"expected expression at index {start}")
    atoms: list[tuple[str, int, int]] = []
    index = opening.end
    while index < end:
        token = next_token(source, index)
        if token is None or token.start >= end or token.kind == "close":
            break
        child_end = children.get(token.start)
        if token.kind == "open" and child_end is not None:
            index = child_end
            continue
        if token.kind == "atom":
            atoms.append((token.value or "", token.start, token.end))
        index = token.end
    return tuple(atoms)


def _lock_state(source: str, start: int, end: int, label: str) -> bool:
    direct_atoms = _direct_atoms(source, start, end)
    standalone = [item for item in direct_atoms if item[0] == "locked"]
    children = _direct_children(source, start, end, "locked")
    if len(standalone) > 1 or len(children) > 1 or (standalone and children):
        raise LockMigrationRefused((f"{label} has conflicting lock state",))
    if standalone:
        if any(atom_start > standalone[0][2] for _, atom_start, _ in direct_atoms):
            raise LockMigrationRefused((f"{label} has invalid lock state",))
        return True
    if not children:
        return False
    _, child_start, child_end = children[0]
    atoms = expression_atoms(source[child_start:child_end], 3)
    if atoms in {("locked",), ("locked", "yes"), ("locked", "true"), ("locked", "1")}:
        return True
    if atoms in {("locked", "no"), ("locked", "false"), ("locked", "0")}:
        raise LockMigrationRefused((f"{label} has conflicting lock state",))
    raise LockMigrationRefused((f"{label} has invalid lock state",))


def _mechanical_blocks(
    source: str, contract: MechanicalContract
) -> tuple[tuple[_Block, ...], tuple[_Block, ...]]:
    root = one_root(source, "kicad_pcb")
    contracted_refs = frozenset(contract.features_by_ref)
    footprint_blocks: list[_Block] = []
    edge_blocks: list[_Block] = []
    for kind, start, end in iter_direct_child_spans(
        source, root.start, root.end
    ):
        if kind == "footprint":
            ref = _footprint_ref(source, start, end)
            if ref not in contracted_refs:
                continue
            _, layer_end = _required_child_value(
                source, start, end, "layer", f"footprint {ref}"
            )
            footprint_blocks.append(
                _Block(
                    kind="footprint",
                    label=ref,
                    start=start,
                    end=end,
                    layer_end=layer_end,
                    lock_state=_lock_state(source, start, end, f"footprint {ref}"),
                )
            )
            continue
        if kind not in {"gr_line", "gr_arc"}:
            continue
        layer, layer_end = _required_child_value(
            source, start, end, "layer", f"{kind} at character index {start}"
        )
        if layer != "Edge.Cuts":
            continue
        edge_blocks.append(
            _Block(
                kind=kind,
                label=f"Edge.Cuts {kind} at character index {start}",
                start=start,
                end=end,
                layer_end=layer_end,
                lock_state=_lock_state(
                    source,
                    start,
                    end,
                    f"Edge.Cuts {kind} at character index {start}",
                ),
            )
        )
    footprint_blocks.sort(key=lambda block: block.label)
    edge_blocks.sort(key=lambda block: block.start)
    if len(footprint_blocks) != len(contract.features):
        raise LockMigrationRefused(
            (
                f"expected {len(contract.features)} contracted footprint blocks, found {len(footprint_blocks)}",
            )
        )
    if len(edge_blocks) != len(contract.outline.primitives):
        raise LockMigrationRefused(
            (
                f"expected {len(contract.outline.primitives)} Edge.Cuts items, found {len(edge_blocks)}",
            )
        )
    return tuple(footprint_blocks), tuple(edge_blocks)


def _indent_at(source: str, offset: int) -> str:
    line_start = max(source.rfind("\n", 0, offset), source.rfind("\r", 0, offset)) + 1
    line = source[line_start:offset]
    indent_length = len(line) - len(line.lstrip(" \t"))
    prefix = line[:indent_length]
    if not line[indent_length:].startswith("(layer"):
        raise LockMigrationRefused(
            (f"cannot determine indentation at character index {offset}",)
        )
    return prefix


def _newline_convention(source: str) -> str:
    without_crlf = source.replace("\r\n", "")
    has_crlf = "\r\n" in source
    has_lf = "\n" in without_crlf
    has_cr = "\r" in without_crlf
    if has_cr or (has_crlf and has_lf):
        raise LockMigrationRefused(
            ("board newline convention is mixed or unsupported",)
        )
    return "\r\n" if has_crlf else "\n"


def _with_locks(
    source: str, blocks: tuple[_Block, ...], newline: str
) -> str:
    replacements = []
    for block in blocks:
        if block.lock_state:
            continue
        indent = _indent_at(source, block.layer_end)
        replacements.append((block.layer_end, f"{newline}{indent}(locked yes)"))
    for offset, replacement in sorted(replacements, reverse=True):
        source = source[:offset] + replacement + source[offset:]
    return source


def _read_regular_file(path: Path) -> tuple[bytes, _FileIdentity]:
    before = os.lstat(path)
    if stat.S_ISLNK(before.st_mode):
        raise LockMigrationRefused((f"board path {path} is a symlink",))
    if not stat.S_ISREG(before.st_mode):
        raise LockMigrationRefused((f"board path {path} is not a regular file",))

    flags = os.O_RDONLY
    for flag_name in ("O_CLOEXEC", "O_NOFOLLOW", "O_BINARY"):
        flags |= getattr(os, flag_name, 0)
    descriptor: int | None = None
    try:
        try:
            descriptor = os.open(path, flags)
        except OSError as error:
            if error.errno == errno.ELOOP:
                raise LockMigrationRefused((f"board path {path} is a symlink",)) from error
            raise
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode):
            raise LockMigrationRefused((f"board path {path} is not a regular file",))
        if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise LockMigrationRefused((f"board path {path} changed while opening",))
        identity = _FileIdentity(
            device=opened.st_dev,
            inode=opened.st_ino,
            mode=stat.S_IMODE(opened.st_mode),
        )
        with os.fdopen(descriptor, "rb") as board_file:
            descriptor = None
            return board_file.read(), identity
    finally:
        if descriptor is not None:
            os.close(descriptor)


def _revalidate_destination(path: Path, identity: _FileIdentity) -> None:
    try:
        current = os.lstat(path)
    except OSError as error:
        raise LockMigrationRefused(
            (f"board path {path} changed since it was read: {error}",)
        ) from error
    if stat.S_ISLNK(current.st_mode):
        raise LockMigrationRefused(
            (f"board path {path} changed since it was read and is now a symlink",)
        )
    if not stat.S_ISREG(current.st_mode):
        raise LockMigrationRefused(
            (f"board path {path} changed since it was read and is not a regular file",)
        )
    if (current.st_dev, current.st_ino) != (identity.device, identity.inode):
        raise LockMigrationRefused((f"board path {path} changed since it was read",))


def _fsync_parent_directory(path: Path) -> None:
    flags = os.O_RDONLY
    for flag_name in ("O_CLOEXEC", "O_DIRECTORY"):
        flags |= getattr(os, flag_name, 0)
    descriptor = os.open(path.parent, flags)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _atomic_write(
    path: Path,
    payload: bytes,
    identity: _FileIdentity,
    before_replace: Callable[[Path], None] | None,
) -> None:
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_name = temporary.name
            temporary.write(payload)
            temporary.flush()
            os.fsync(temporary.fileno())
            os.fchmod(temporary.fileno(), identity.mode)
        if before_replace is not None:
            before_replace(path)
        _revalidate_destination(path, identity)
        os.replace(temporary_name, path)
        temporary_name = None
        try:
            _fsync_parent_directory(path)
        except OSError as error:
            raise LockMigrationDurabilityError(
                f"board file {path} was replaced but durability is unconfirmed "
                f"because parent-directory fsync failed: {error}"
            ) from error
    finally:
        if temporary_name is not None:
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass


def lock_mechanical_items(
    board_path: str | Path = BOARD,
    contract_path: str | Path = MECHANICAL_CONTRACT,
    *,
    _before_replace: Callable[[Path], None] | None = None,
) -> str:
    """Lock contracted footprints and Edge.Cuts, refusing all other drift."""

    path = Path(board_path)
    contract = load_contract(contract_path)
    payload, identity = _read_regular_file(path)
    source = payload.decode("utf-8")
    newline = _newline_convention(source)
    board = parse_board(source)
    non_lock_findings = tuple(
        finding
        for finding in check_mechanics(contract, board)
        if not finding.endswith(" is not locked")
    )
    if non_lock_findings:
        raise LockMigrationRefused(non_lock_findings)

    footprints, edges = _mechanical_blocks(source, contract)
    unlocked_footprints = tuple(block for block in footprints if not block.lock_state)
    unlocked_edges = tuple(block for block in edges if not block.lock_state)
    if not unlocked_footprints and not unlocked_edges:
        return "already locked"

    migrated = _with_locks(
        source, (*unlocked_footprints, *unlocked_edges), newline
    )
    migrated_board = parse_board(migrated)
    post_findings = check_mechanics(contract, migrated_board)
    if post_findings:
        raise LockMigrationRefused(post_findings)
    migrated_footprints, migrated_edges = _mechanical_blocks(migrated, contract)
    if any(not block.lock_state for block in (*migrated_footprints, *migrated_edges)):
        raise LockMigrationRefused(("migration did not lock every mechanical item",))
    _atomic_write(
        path,
        migrated.encode("utf-8"),
        identity,
        _before_replace,
    )
    return (
        f"locked {len(unlocked_footprints)} footprints and "
        f"{len(unlocked_edges)} Edge.Cuts items"
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Lock Pocket Card contract footprints and board outline"
    )
    parser.add_argument("board", nargs="?", type=Path, default=BOARD)
    parser.add_argument("--contract", type=Path, default=MECHANICAL_CONTRACT)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        result = lock_mechanical_items(args.board, args.contract)
    except (
        ContractError,
        LockMigrationRefused,
        LockMigrationDurabilityError,
        OSError,
        UnicodeError,
        SexprError,
    ) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
