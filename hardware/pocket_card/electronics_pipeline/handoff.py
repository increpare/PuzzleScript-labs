"""Deterministic, validation-gated Pocket Card engineer handoffs."""

from __future__ import annotations

import argparse
import datetime as _datetime
import hashlib
import inspect
import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
import uuid
import zipfile
from collections.abc import Callable, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from .exports import (
    _EXPORT_RECIPE_INPUTS,
    _load_manifest,
    _load_toolchain,
    require_current_exports,
)
from .inventory import (
    BoardInventory,
    Footprint,
    Pad,
    ProjectInventory,
    SchematicComponent,
    SchematicInventory,
    _version_tuple,
    editable_project_files,
    inventory_json,
    semantic_diff,
)
from .paths import (
    EDITABLE_PROJECT_DIRS,
    EDITABLE_PROJECT_FILES,
    ELECTRONICS_DIR,
    HANDOFF_BUILD_DIR,
    PCB_OUTPUT_DIR,
    POCKET_CARD_DIR,
    PROJECT_NAME,
)
from .validation import (
    MECHANICAL_REVIEW_REQUIRED,
    INVALID,
    PASS,
    ValidationError,
    _bounded_stream,
    _sanitize_diagnostic,
    validate_project,
)

try:
    import fcntl as _fcntl
except ImportError:  # pragma: no cover - fail-safe behavior is exercised by injection.
    _fcntl = None


_ARCHIVE_ROOT = "pocket-card-controller"
_HANDOFF_SCHEMA_VERSION = 1
_HANDOFF_TOOL_VERSION = "1"
_CHECK_REPORT_SCHEMA_VERSION = 1
_PROJECT_ARCHIVE_PREFIX = f"{_ARCHIVE_ROOT}/project/"
_HANDOFF_METADATA_NAME = f"{_ARCHIVE_ROOT}/handoff.json"
_ALLOWED_NON_PROJECT_MEMBERS = frozenset(
    {
        _HANDOFF_METADATA_NAME,
        f"{_ARCHIVE_ROOT}/HANDOFF.md",
    }
)
_ALLOWED_NON_PROJECT_PREFIXES = (
    f"{_ARCHIVE_ROOT}/reference/",
)
_CHECK_EXIT_CODES = {PASS: 0, INVALID: 1, MECHANICAL_REVIEW_REQUIRED: 2}
_ACCEPTABLE_CHECK_STATUSES = frozenset({PASS, MECHANICAL_REVIEW_REQUIRED})
_PROTECTED_ACCEPT_BRANCHES = frozenset({"main", "master"})
_ELECTRONICS_REPO_PREFIX = "hardware/pocket_card/electronics"
_DIGEST_PATTERN = re.compile(r"[0-9a-f]{64}")
_COMMIT_PATTERN = re.compile(r"[0-9a-f]{40,64}")
_JOURNAL_GENERATION_PATTERN = re.compile(r"[0-9a-f]{32}")
_POLICY_NAMES = ("mechanical_contract.json", "validation_waivers.json")
_POLICY_DIGEST_NAMES = ("toolchain.json", *_POLICY_NAMES)
_EXPORT_REFERENCES = {
    "schematic.pdf": f"{PROJECT_NAME}.pdf",
    "board.step": f"{PROJECT_NAME}.step",
    "erc.json": "erc.json",
    "drc.json": "drc.json",
}
_REQUIRED_PROJECT_SOURCES = (
    f"{PROJECT_NAME}.kicad_pro",
    f"{PROJECT_NAME}.kicad_sch",
    f"{PROJECT_NAME}.kicad_pcb",
    "fp-lib-table",
)
_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
_NONBLOCK = getattr(os, "O_NONBLOCK", 0)
_UTC = _datetime.timezone.utc
_MAX_ARCHIVE_MEMBERS = 2_000
_MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024
_MAX_METADATA_BYTES = 16 * 1024 * 1024
_COPY_CHUNK_SIZE = 1024 * 1024
_LOCAL_EDITABLE_SUFFIXES = {
    "symbols": frozenset({".dcm", ".kicad_sym", ".lib"}),
    "footprints.pretty": frozenset({".kicad_mod", ".mod"}),
    "3dmodels": frozenset({".step", ".stp", ".wrl"}),
}

_Validator = Callable[..., object]
_CurrentExportsChecker = Callable[[Path, Path], object]
_GitMetadataProvider = Callable[[Path], tuple[str, int]]


class HandoffError(RuntimeError):
    """An expected outgoing-handoff safety or input failure."""


class HandoffInvalid(HandoffError):
    """A returned archive is malformed or unsafe to stage."""


@dataclass(frozen=True)
class HandoffCheckResult:
    status: str
    stage_dir: Path
    base_digest: str
    returned_digest: str
    semantic_diff: dict[str, object]
    report_json: Path
    report_markdown: Path


@dataclass(frozen=True)
class HandoffAcceptResult:
    changed: tuple[str, ...]
    retained: tuple[str, ...]
    returned_digest: str
    status: str

    def __iter__(self):
        return iter(self.changed)


@dataclass(frozen=True)
class _ArchiveEntry:
    name: str
    path: Path
    size: int
    sha256: str


def _duplicate_rejecting_object(
    pairs: list[tuple[str, object]],
) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise HandoffError(f"duplicate JSON key {key!r}")
        result[key] = value
    return result


def _reject_json_constant(value: str) -> object:
    raise HandoffError(f"non-finite JSON number {value!r}")


def _json_bytes(value: object) -> bytes:
    return (
        json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")


def _open_regular(path: Path, label: str, *, max_size: int) -> tuple[int, os.stat_result]:
    try:
        descriptor = os.open(path, os.O_RDONLY | _NOFOLLOW | _NONBLOCK)
    except OSError as error:
        raise HandoffError(f"{label} is missing or unsafe: {path.name}") from error
    information = os.fstat(descriptor)
    if not stat.S_ISREG(information.st_mode):
        os.close(descriptor)
        raise HandoffError(f"{label} must be a regular file: {path.name}")
    if information.st_size < 1:
        os.close(descriptor)
        raise HandoffError(f"{label} must be a nonempty regular file: {path.name}")
    if information.st_size > max_size:
        os.close(descriptor)
        raise HandoffError(
            f"{label} exceeds the maximum supported size of {max_size} bytes: {path.name}"
        )
    return descriptor, information


def _read_regular_bytes(
    path: Path, label: str, *, max_size: int = _MAX_METADATA_BYTES
) -> bytes:
    """Read one bounded no-follow regular file without blocking on special files."""

    descriptor, before = _open_regular(path, label, max_size=max_size)
    try:
        chunks: list[bytes] = []
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
        after = os.fstat(descriptor)
        if (
            before.st_dev,
            before.st_ino,
            before.st_size,
            before.st_mtime_ns,
        ) != (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
        ):
            raise HandoffError(f"{label} changed while it was being read: {path.name}")
        value = b"".join(chunks)
        if len(value) != before.st_size:
            raise HandoffError(f"{label} changed while it was being read: {path.name}")
        return value
    finally:
        os.close(descriptor)


def _regular_fingerprint(
    path: Path, label: str, *, max_size: int = _MAX_METADATA_BYTES
) -> tuple[int, str]:
    """Hash a bounded regular file while rejecting replacement during the read."""

    descriptor, before = _open_regular(path, label, max_size=max_size)
    digest = hashlib.sha256()
    size = 0
    try:
        while True:
            chunk = os.read(descriptor, _COPY_CHUNK_SIZE)
            if not chunk:
                break
            digest.update(chunk)
            size += len(chunk)
        after = os.fstat(descriptor)
        if (
            before.st_dev,
            before.st_ino,
            before.st_size,
            before.st_mtime_ns,
        ) != (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
        ) or size != before.st_size:
            raise HandoffError(f"{label} changed while it was being hashed: {path.name}")
        return size, digest.hexdigest()
    finally:
        os.close(descriptor)


def _write_all(descriptor: int, content: bytes) -> None:
    offset = 0
    while offset < len(content):
        written = os.write(descriptor, content[offset:])
        if written < 1:
            raise OSError("short write while creating handoff snapshot")
        offset += written


def _snapshot_regular(
    source: Path,
    destination: Path,
    label: str,
    *,
    max_size: int = _MAX_ARCHIVE_BYTES,
    required_prefix: bytes | None = None,
) -> tuple[int, str]:
    """Copy a stable regular-file view into a private system-temp snapshot."""

    source_descriptor, before = _open_regular(source, label, max_size=max_size)
    try:
        destination_descriptor = os.open(
            destination,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | _NOFOLLOW,
            0o600,
        )
    except Exception:
        os.close(source_descriptor)
        raise
    digest = hashlib.sha256()
    copied = 0
    prefix = bytearray()
    try:
        while True:
            chunk = os.read(source_descriptor, _COPY_CHUNK_SIZE)
            if not chunk:
                break
            if required_prefix is not None and len(prefix) < len(required_prefix):
                prefix.extend(chunk[: len(required_prefix) - len(prefix)])
            digest.update(chunk)
            copied += len(chunk)
            _write_all(destination_descriptor, chunk)
        after = os.fstat(source_descriptor)
        if (
            before.st_dev,
            before.st_ino,
            before.st_size,
            before.st_mtime_ns,
        ) != (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
        ) or copied != before.st_size:
            raise HandoffError(f"{label} changed while it was being snapshotted: {source.name}")
        if required_prefix is not None and bytes(prefix) != required_prefix:
            raise HandoffError(
                f"{label} has an invalid header; expected {required_prefix.decode('ascii')}"
            )
        os.fsync(destination_descriptor)
    except Exception:
        try:
            destination.unlink()
        except OSError:
            pass
        raise
    finally:
        os.close(destination_descriptor)
        os.close(source_descriptor)
    return copied, digest.hexdigest()


def _snapshot_bytes(destination: Path, content: bytes) -> tuple[int, str]:
    if not content:
        raise HandoffError("generated handoff entry must not be empty")
    descriptor = os.open(
        destination,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | _NOFOLLOW,
        0o600,
    )
    try:
        _write_all(descriptor, content)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    return len(content), hashlib.sha256(content).hexdigest()


def _resolved_directory(path: str | Path, label: str) -> Path:
    raw = Path(path).expanduser()
    if raw.is_symlink():
        raise HandoffError(f"{label} must not be a symlink")
    try:
        resolved = raw.resolve(strict=True)
    except OSError as error:
        raise HandoffError(f"{label} is unavailable: {raw}") from error
    if not resolved.is_dir():
        raise HandoffError(f"{label} must be a directory")
    return resolved


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _call_validator(validator: _Validator, project: Path, runner: Callable[..., object]) -> object:
    try:
        signature = inspect.signature(validator)
    except (TypeError, ValueError):
        signature = None
    accepts_runner = signature is None or "runner" in signature.parameters or any(
        parameter.kind == inspect.Parameter.VAR_KEYWORD
        for parameter in signature.parameters.values()
    )
    return validator(project, runner=runner) if accepts_runner else validator(project)


def _require_current_exports(
    checker: _CurrentExportsChecker, project: Path, exports: Path
) -> None:
    result = checker(project, exports)
    if result is False:
        raise HandoffError(
            "PCB export is missing or stale; run make pocket_card_pcb_exports"
        )


def _inventory_value(value: object) -> object:
    if isinstance(value, Mapping):
        return {str(key): _inventory_value(value[key]) for key in sorted(value)}
    if isinstance(value, (list, tuple)):
        return [_inventory_value(item) for item in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return inventory_json(value)  # type: ignore[arg-type]


def _load_export_metadata(
    manifest_snapshot: Path, expected_digest: str
) -> dict[str, object]:
    raw = _load_manifest(manifest_snapshot)
    if raw["projectDigest"] != expected_digest:
        raise HandoffError("verified export manifest metadata is invalid or stale")
    return raw


def _reject_nonregular_local_assets(project: Path) -> None:
    for directory_name in EDITABLE_PROJECT_DIRS:
        root = project / directory_name
        if not root.exists() and not root.is_symlink():
            continue
        pending = [root]
        suffixes = _LOCAL_EDITABLE_SUFFIXES[directory_name]
        while pending:
            path = pending.pop()
            information = path.stat(follow_symlinks=False)
            if stat.S_ISLNK(information.st_mode):
                raise HandoffError(f"editable project path is a symlink: {path}")
            if stat.S_ISDIR(information.st_mode):
                if path != root and (
                    path.name == ".history" or path.name.endswith("-backups")
                ):
                    continue
                pending.extend(sorted(path.iterdir(), key=lambda item: item.name))
            elif path.suffix.lower() in suffixes and not stat.S_ISREG(
                information.st_mode
            ):
                raise HandoffError(
                    f"editable project asset must be a regular file: {path.name}"
                )


def _editable_sources(project: Path) -> tuple[Path, ...]:
    _reject_nonregular_local_assets(project)
    sources = editable_project_files(project)
    required = {project / name for name in _REQUIRED_PROJECT_SOURCES}
    if not required.issubset(sources):
        missing = sorted(path.name for path in required - set(sources))
        raise HandoffError("required editable project source is missing: " + ", ".join(missing))
    return sources


def _stream_file_into_digest(path: Path, digest: object, label: str) -> None:
    descriptor, before = _open_regular(path, label, max_size=_MAX_ARCHIVE_BYTES)
    copied = 0
    try:
        while True:
            chunk = os.read(descriptor, _COPY_CHUNK_SIZE)
            if not chunk:
                break
            digest.update(chunk)  # type: ignore[attr-defined]
            copied += len(chunk)
        after = os.fstat(descriptor)
        if (
            before.st_dev,
            before.st_ino,
            before.st_size,
            before.st_mtime_ns,
        ) != (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
        ) or copied != before.st_size:
            raise HandoffError(f"{label} changed while computing its digest: {path.name}")
    finally:
        os.close(descriptor)


def _labeled_project_digest(items: Sequence[tuple[str, Path]]) -> str:
    digest = hashlib.sha256()
    for relative, path in sorted(items):
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        _stream_file_into_digest(path, digest, "editable project source")
        digest.update(b"\0")
    return digest.hexdigest()


def _canonical_project_digest(project: Path) -> tuple[str, tuple[Path, ...]]:
    sources = _editable_sources(project)
    return (
        _labeled_project_digest(
            tuple((path.relative_to(project).as_posix(), path) for path in sources)
        ),
        sources,
    )


def _canonical_policy_digest(project: Path) -> str:
    return _labeled_project_digest(
        tuple((name, project / name) for name in _POLICY_DIGEST_NAMES)
    )


def _canonical_export_recipe_digest() -> str:
    digest = hashlib.sha256()
    for label, path in sorted(_EXPORT_RECIPE_INPUTS, key=lambda item: item[0]):
        digest.update(label.encode("utf-8"))
        digest.update(b"\0")
        _stream_file_into_digest(path, digest, "PCB export recipe input")
        digest.update(b"\0")
    return digest.hexdigest()


def _repository_root(project: Path) -> Path:
    for candidate in (project, *project.parents):
        if (candidate / ".git").exists():
            return candidate
    raise HandoffError("cannot locate repository root for canonical project")


def _git_metadata(repo_root: Path) -> tuple[str, int]:
    def run(*arguments: str) -> str:
        try:
            result = subprocess.run(
                ("git", *arguments),
                cwd=repo_root,
                text=True,
                capture_output=True,
                check=False,
                timeout=30,
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise HandoffError("cannot read Git handoff provenance") from error
        if result.returncode != 0:
            raise HandoffError("cannot read Git handoff provenance")
        return result.stdout.strip()

    commit = run("rev-parse", "HEAD")
    timestamp_text = run("show", "-s", "--format=%ct", "HEAD")
    if _COMMIT_PATTERN.fullmatch(commit) is None or not timestamp_text.isdigit():
        raise HandoffError("Git handoff provenance is malformed")
    return commit, int(timestamp_text)


def _source_epoch(explicit: int | None, commit_epoch: int) -> int:
    raw: object = explicit
    if raw is None:
        environment = os.environ.get("SOURCE_DATE_EPOCH")
        raw = commit_epoch if environment is None else environment
    if isinstance(raw, bool):
        raise HandoffError("SOURCE_DATE_EPOCH must be an integer")
    if isinstance(raw, str):
        if re.fullmatch(r"-?[0-9]+", raw) is None:
            raise HandoffError("SOURCE_DATE_EPOCH must be an integer")
        value = int(raw)
    elif isinstance(raw, int):
        value = raw
    else:
        raise HandoffError("SOURCE_DATE_EPOCH must be an integer")
    try:
        _datetime.datetime.fromtimestamp(value, tz=_UTC)
    except (OverflowError, OSError, ValueError) as error:
        raise HandoffError("SOURCE_DATE_EPOCH is outside the supported UTC range") from error
    return value


def _created_at(epoch: int) -> str:
    return (
        _datetime.datetime.fromtimestamp(epoch, tz=_UTC)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _zip_timestamp(epoch: int) -> tuple[int, int, int, int, int, int]:
    moment = _datetime.datetime.fromtimestamp(epoch, tz=_UTC)
    minimum = _datetime.datetime(1980, 1, 1, tzinfo=_UTC)
    maximum = _datetime.datetime(2107, 12, 31, 23, 59, 58, tzinfo=_UTC)
    moment = max(minimum, min(maximum, moment)).replace(microsecond=0)
    return (
        moment.year,
        moment.month,
        moment.day,
        moment.hour,
        moment.minute,
        moment.second - moment.second % 2,
    )


def _handoff_instructions(include_blend: bool) -> bytes:
    blend = (
        "A Blender assembly is included only as supplementary visual context. "
        if include_blend
        else "A Blender assembly is not included in this package. "
    )
    text = f"""# Pocket Card controller engineer handoff

Open `project/{PROJECT_NAME}.kicad_pro` with KiCad 10. Edit anything needed for
the electrical design, including adding as many components as the design needs.

- Preserve existing reference designators. Annotate every new symbol before returning the project.
- Use KiCad's **Update PCB from Schematic** command to keep symbol-footprint associations intact.
- Existing mechanical items are locked. You may deliberately unlock them, but any moved or unlocked contracted feature will trigger enclosure review.
- Keep every custom symbol, footprint, and 3D model project-local and reference it through `${{KIPRJMOD}}`.
- Never edit `reference/mechanical_contract.json` or `reference/validation_waivers.json` to make a check pass.
- Return a ZIP with the same single top-level `pocket-card-controller/` directory.

`reference/board.step` and the dimensional mechanical contract are the
authoritative mechanical references. {blend}Blender is visual context only and
must not be treated as dimensional CAD authority.
"""
    return text.encode("utf-8")


def _semantic_summary(inventory: Mapping[str, object], contract: Mapping[str, object], digest: str) -> bytes:
    schematic = inventory.get("schematic", {})
    board = inventory.get("board", {})
    components = schematic.get("components", {}) if isinstance(schematic, Mapping) else {}
    nets = schematic.get("nets", {}) if isinstance(schematic, Mapping) else {}
    footprints = board.get("footprints", {}) if isinstance(board, Mapping) else {}
    features = contract.get("features", ())
    feature_count = len(features) if isinstance(features, (list, tuple)) else 0
    summary = (
        "# Pocket Card semantic baseline\n\n"
        f"- Base project digest: `{digest}`\n"
        f"- Schematic components: {len(components) if isinstance(components, Mapping) else 0}\n"
        f"- Named nets: {len(nets) if isinstance(nets, Mapping) else 0}\n"
        f"- Linked board footprints: {len(footprints) if isinstance(footprints, Mapping) else 0}\n"
        f"- Contracted mechanical features: {feature_count}\n"
        "- Dimensional authority: `mechanical_contract.json` and `board.step`\n"
    )
    if isinstance(features, (list, tuple)) and features:
        summary += "\n## Contracted mechanical features\n\n"
        for feature in features:
            if not isinstance(feature, Mapping):
                continue
            lock_state = "locked" if feature.get("lockedRequired") is True else "not lock-required"
            summary += (
                f"- `{feature.get('ref', '?')}`: {feature.get('xMm', '?')} mm, "
                f"{feature.get('yMm', '?')} mm; {feature.get('rotationDeg', '?')} deg; "
                f"{feature.get('side', '?')}; {lock_state}. "
                f"{feature.get('rationale', '')}\n"
            )
    return summary.encode("utf-8")


def _archive_info(name: str, timestamp: tuple[int, int, int, int, int, int]) -> zipfile.ZipInfo:
    normalized = PurePosixPath(name)
    if (
        not name
        or "\\" in name
        or "\0" in name
        or normalized.is_absolute()
        or normalized.as_posix() != name
        or any(part in ("", ".", "..") for part in normalized.parts)
    ):
        raise HandoffError(f"unsafe archive member name: {name!r}")
    info = zipfile.ZipInfo(name, timestamp)
    info.create_system = 3
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = (stat.S_IFREG | 0o644) << 16
    info.internal_attr = 0
    info.extra = b""
    info.comment = b""
    return info


def _check_archive_bounds(entries: Sequence[_ArchiveEntry]) -> int:
    if len(entries) > _MAX_ARCHIVE_MEMBERS:
        raise HandoffError(
            f"handoff archive exceeds {_MAX_ARCHIVE_MEMBERS} members"
        )
    total = 0
    names: set[str] = set()
    for entry in entries:
        _archive_info(entry.name, (1980, 1, 1, 0, 0, 0))
        if len(entry.name.encode("utf-8")) > 65_535:
            raise HandoffError(
                f"handoff archive member name exceeds the ZIP limit: {entry.name!r}"
            )
        if entry.name in names:
            raise HandoffError(f"duplicate handoff archive member: {entry.name}")
        names.add(entry.name)
        if _DIGEST_PATTERN.fullmatch(entry.sha256) is None:
            raise HandoffError(f"handoff entry has an invalid digest: {entry.name}")
        if (
            type(entry.size) is not int
            or entry.size < 1
            or entry.size > _MAX_ARCHIVE_BYTES
        ):
            raise HandoffError(f"handoff entry has an invalid size: {entry.name}")
        if entry.size > _MAX_ARCHIVE_BYTES - total:
            raise HandoffError(
                f"handoff archive exceeds {_MAX_ARCHIVE_BYTES} uncompressed bytes"
            )
        total += entry.size
    return total


def _raw_deflate_size_bound(size: int) -> int:
    if type(size) is not int or size < 0:
        raise HandoffError("raw DEFLATE input size must be a nonnegative integer")
    # Deliberately looser than zlib's compressBound: this allows 1/8 + 1/64
    # growth plus stream framing, comfortably covering incompressible raw DEFLATE.
    return size + (size + 7) // 8 + (size + 63) // 64 + 11


_ZIP_LOCAL_FIXED_BYTES = 30
_ZIP_CENTRAL_FIXED_BYTES = 46
_ZIP64_LOCAL_EXTRA_MAX_BYTES = 20
_ZIP64_CENTRAL_EXTRA_MAX_BYTES = 32
_ZIP_DATA_DESCRIPTOR_MAX_BYTES = 24
_ZIP_END_RECORD_MAX_BYTES = 22 + 56 + 20


def _physical_archive_size_bound(entries: Sequence[_ArchiveEntry]) -> int:
    _check_archive_bounds(entries)
    total = _ZIP_END_RECORD_MAX_BYTES
    for entry in entries:
        name_size = len(entry.name.encode("utf-8"))
        total += _raw_deflate_size_bound(entry.size)
        total += _ZIP_LOCAL_FIXED_BYTES + name_size + _ZIP64_LOCAL_EXTRA_MAX_BYTES
        total += _ZIP_CENTRAL_FIXED_BYTES + name_size + _ZIP64_CENTRAL_EXTRA_MAX_BYTES
        total += _ZIP_DATA_DESCRIPTOR_MAX_BYTES
    return total


_MAX_PHYSICAL_ARCHIVE_BYTES = (
    _raw_deflate_size_bound(_MAX_ARCHIVE_BYTES)
    + 16 * _MAX_ARCHIVE_MEMBERS
    + _MAX_ARCHIVE_MEMBERS
    * (
        _ZIP_LOCAL_FIXED_BYTES
        + _ZIP64_LOCAL_EXTRA_MAX_BYTES
        + _ZIP_CENTRAL_FIXED_BYTES
        + _ZIP64_CENTRAL_EXTRA_MAX_BYTES
        + _ZIP_DATA_DESCRIPTOR_MAX_BYTES
        + 2 * 65_535
    )
    + _ZIP_END_RECORD_MAX_BYTES
)


def _require_physical_archive_size(size: int, maximum: int) -> None:
    if (
        type(size) is not int
        or type(maximum) is not int
        or size < 1
        or maximum < 1
        or maximum > _MAX_PHYSICAL_ARCHIVE_BYTES
        or size > maximum
    ):
        raise HandoffError(
            f"physical ZIP size exceeds its deterministic bound of {maximum} bytes"
        )


def _write_archive(
    stream: object,
    entries: Sequence[_ArchiveEntry],
    timestamp: tuple[int, int, int, int, int, int],
) -> None:
    _check_archive_bounds(entries)
    with zipfile.ZipFile(
        stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
    ) as archive:
        archive.comment = b""
        for entry in sorted(entries, key=lambda item: item.name):
            info = _archive_info(entry.name, timestamp)
            info.file_size = entry.size
            descriptor, before = _open_regular(
                entry.path, "handoff snapshot", max_size=_MAX_ARCHIVE_BYTES
            )
            digest = hashlib.sha256()
            copied = 0
            try:
                with archive.open(info, "w", force_zip64=True) as destination:
                    while True:
                        chunk = os.read(descriptor, _COPY_CHUNK_SIZE)
                        if not chunk:
                            break
                        destination.write(chunk)
                        digest.update(chunk)
                        copied += len(chunk)
                after = os.fstat(descriptor)
            finally:
                os.close(descriptor)
            if (
                copied != entry.size
                or copied != before.st_size
                or digest.hexdigest() != entry.sha256
                or (
                    before.st_dev,
                    before.st_ino,
                    before.st_size,
                    before.st_mtime_ns,
                )
                != (
                    after.st_dev,
                    after.st_ino,
                    after.st_size,
                    after.st_mtime_ns,
                )
            ):
                raise HandoffError(
                    f"handoff snapshot changed while writing archive: {entry.name}"
                )


def _prepare_output_directory(raw_output: str | Path, project: Path, exports: Path) -> Path:
    raw = Path(raw_output).expanduser()
    if raw.is_symlink():
        raise HandoffError("handoff output directory must not be a symlink")
    prospective = raw.resolve(strict=False)
    if _is_within(prospective, project) or _is_within(prospective, exports):
        raise HandoffError("handoff output directory must be outside source and export trees")
    try:
        raw.mkdir(parents=True, exist_ok=True)
        output = raw.resolve(strict=True)
    except OSError as error:
        raise HandoffError(f"cannot create handoff output directory: {raw}") from error
    if not output.is_dir():
        raise HandoffError("handoff output path must be a directory")
    if _is_within(output, project) or _is_within(output, exports):
        raise HandoffError("handoff output directory must be outside source and export trees")
    return output


def _destination_is_safe_at(directory: int, name: str) -> None:
    try:
        information = os.stat(name, dir_fd=directory, follow_symlinks=False)
    except FileNotFoundError:
        return
    except OSError as error:
        raise HandoffError("cannot inspect handoff destination") from error
    if not stat.S_ISREG(information.st_mode):
        raise HandoffError("refusing to overwrite a non-regular handoff destination")


def _require_output_identity(path: Path, token: tuple[int, int]) -> None:
    try:
        information = path.stat(follow_symlinks=False)
    except OSError as error:
        raise HandoffError("handoff output directory changed during publication") from error
    if (
        not stat.S_ISDIR(information.st_mode)
        or (information.st_dev, information.st_ino) != token
    ):
        raise HandoffError("handoff output directory changed during publication")


def _require_owned_temp(directory: int, name: str, token: tuple[int, int]) -> None:
    try:
        information = os.stat(name, dir_fd=directory, follow_symlinks=False)
    except OSError as error:
        raise HandoffError("temporary handoff file changed before publication") from error
    if (
        not stat.S_ISREG(information.st_mode)
        or (information.st_dev, information.st_ino) != token
    ):
        raise HandoffError("temporary handoff file changed before publication")


def _named_regular_fingerprint(
    directory: int,
    name: str,
    token: tuple[int, int],
    context: str,
    *,
    max_size: int = _MAX_ARCHIVE_BYTES,
    allow_empty: bool = False,
) -> tuple[int, str]:
    """Hash one exact directory entry without following or buffering it."""

    try:
        descriptor = os.open(
            name,
            os.O_RDONLY | _NOFOLLOW | _NONBLOCK,
            dir_fd=directory,
        )
    except OSError as error:
        raise HandoffError(f"{context} ownership or content changed") from error
    digest = hashlib.sha256()
    size = 0
    try:
        before = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
            or (before.st_dev, before.st_ino) != token
            or (before.st_size < 1 and not allow_empty)
            or before.st_size > max_size
        ):
            raise HandoffError(f"{context} ownership or content changed")
        while True:
            chunk = os.read(descriptor, _COPY_CHUNK_SIZE)
            if not chunk:
                break
            digest.update(chunk)
            size += len(chunk)
        after = os.fstat(descriptor)
        if (
            before.st_dev,
            before.st_ino,
            before.st_size,
            before.st_mtime_ns,
        ) != (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
        ) or size != before.st_size:
            raise HandoffError(f"{context} ownership or content changed")
    finally:
        os.close(descriptor)
    _require_named_token(directory, name, token, context)
    return size, digest.hexdigest()


def _named_token(directory: int, name: str, context: str) -> tuple[int, int]:
    try:
        information = os.stat(name, dir_fd=directory, follow_symlinks=False)
    except OSError as error:
        raise HandoffError(f"{context} is missing or unsafe") from error
    if not stat.S_ISREG(information.st_mode):
        raise HandoffError(f"{context} is unsafe")
    return information.st_dev, information.st_ino


def _require_named_token(
    directory: int, name: str, token: tuple[int, int], context: str
) -> None:
    if _named_token(directory, name, context) != token:
        raise HandoffError(f"{context} ownership changed; possible substitution")


@contextmanager
def _handoff_publication_lock(directory: int, filename: str):
    if _fcntl is None:
        raise HandoffError("handoff publication requires POSIX advisory locking")
    name = f".{filename}.handoff.lock"
    for attempt in range(10):
        try:
            descriptor = os.open(
                name,
                os.O_RDWR | os.O_CREAT | _NOFOLLOW | _NONBLOCK,
                0o600,
                dir_fd=directory,
            )
            break
        except FileNotFoundError as error:
            if attempt == 9:
                raise HandoffError(
                    "handoff publication lock is missing or unsafe"
                ) from error
            continue
        except OSError as error:
            raise HandoffError("handoff publication lock is missing or unsafe") from error
    try:
        information = os.fstat(descriptor)
        if not stat.S_ISREG(information.st_mode):
            raise HandoffError("handoff publication lock is unsafe")
        token = information.st_dev, information.st_ino
        _fcntl.flock(descriptor, _fcntl.LOCK_EX)
        _require_named_token(directory, name, token, "handoff publication lock")
        yield name, token
    finally:
        try:
            _fcntl.flock(descriptor, _fcntl.LOCK_UN)
        finally:
            os.close(descriptor)


def _journal_name(filename: str) -> str:
    return f".{filename}.handoff-journal.json"


def _journal_sidecar_name(filename: str, generation: str) -> str:
    return f".{filename}.handoff-journal-sidecar-{generation}.tmp"


def _publication_journal_bytes(
    journal_generation: str,
    temp_name: str,
    temp_token: tuple[int, int],
    temp_content: tuple[int, str] | None,
    temp_max_size: int,
    directory_token: tuple[int, int],
    prior_destination: tuple[tuple[int, int], tuple[int, str]] | None,
) -> bytes:
    if prior_destination is None:
        prior_state = "absent"
        prior_token = (0, 0)
        prior_content = (0, "0" * 64)
    else:
        prior_state = "regular"
        prior_token, prior_content = prior_destination
    return _json_bytes(
        {
            "schemaVersion": 3,
            "journalGeneration": journal_generation,
            "tempName": temp_name,
            "tempDevice": temp_token[0],
            "tempInode": temp_token[1],
            "tempComplete": temp_content is not None,
            "tempSize": 0 if temp_content is None else temp_content[0],
            "tempSha256": "0" * 64 if temp_content is None else temp_content[1],
            "tempMaxSize": temp_max_size,
            "outputDevice": directory_token[0],
            "outputInode": directory_token[1],
            "priorDestinationState": prior_state,
            "priorDestinationDevice": prior_token[0],
            "priorDestinationInode": prior_token[1],
            "priorDestinationSize": prior_content[0],
            "priorDestinationSha256": prior_content[1],
        }
    )


def _publish_publication_journal_version(
    directory: int,
    filename: str,
    generation: str,
    content: bytes,
    expected_visible_token: tuple[int, int] | None,
) -> tuple[int, int]:
    name = _journal_name(filename)
    sidecar_name = _journal_sidecar_name(filename, generation)
    sidecar_token: tuple[int, int] | None = None
    expected_content = (len(content), hashlib.sha256(content).hexdigest())
    replaced = False
    try:
        descriptor = os.open(
            sidecar_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | _NOFOLLOW | _NONBLOCK,
            0o600,
            dir_fd=directory,
        )
    except OSError as error:
        raise HandoffError(
            "handoff publication journal sidecar is missing or unsafe"
        ) from error
    try:
        try:
            information = os.fstat(descriptor)
            if not stat.S_ISREG(information.st_mode) or information.st_nlink != 1:
                raise HandoffError("handoff publication journal sidecar is unsafe")
            sidecar_token = information.st_dev, information.st_ino
            _write_all(descriptor, content)
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        if _named_regular_fingerprint(
            directory,
            sidecar_name,
            sidecar_token,
            "handoff publication journal sidecar",
            max_size=_MAX_METADATA_BYTES,
        ) != expected_content:
            raise HandoffError(
                "handoff publication journal sidecar content changed"
            )
        if expected_visible_token is None:
            if _optional_entry_token(directory, name) is not None:
                raise HandoffError(
                    "handoff publication journal ownership changed"
                )
        else:
            _require_named_token(
                directory,
                name,
                expected_visible_token,
                "handoff publication journal",
            )
        _require_named_token(
            directory,
            sidecar_name,
            sidecar_token,
            "handoff publication journal sidecar",
        )
        os.replace(
            sidecar_name,
            name,
            src_dir_fd=directory,
            dst_dir_fd=directory,
        )
        replaced = True
        os.fsync(directory)
        _require_named_token(
            directory,
            name,
            sidecar_token,
            "handoff publication journal",
        )
        if _named_regular_fingerprint(
            directory,
            name,
            sidecar_token,
            "handoff publication journal",
            max_size=_MAX_METADATA_BYTES,
        ) != expected_content:
            raise HandoffError("handoff publication journal content changed")
        return sidecar_token
    except Exception:
        if not replaced and sidecar_token is not None:
            try:
                observed = _optional_entry_token(directory, sidecar_name)
            except HandoffError:
                observed = None
            if observed == sidecar_token:
                try:
                    observed_content = _named_regular_fingerprint(
                        directory,
                        sidecar_name,
                        sidecar_token,
                        "handoff publication journal sidecar",
                        max_size=_MAX_METADATA_BYTES,
                    )
                    if observed_content == expected_content:
                        os.unlink(sidecar_name, dir_fd=directory)
                        os.fsync(directory)
                except (HandoffError, OSError):
                    pass
        raise


def _write_publication_journal(
    directory: int,
    filename: str,
    temp_name: str,
    temp_token: tuple[int, int],
    directory_token: tuple[int, int],
    prior_destination: tuple[tuple[int, int], tuple[int, str]] | None,
    temp_max_size: int = _MAX_ARCHIVE_BYTES,
) -> tuple[int, int]:
    generation = uuid.uuid4().hex
    content = _publication_journal_bytes(
        generation,
        temp_name,
        temp_token,
        None,
        temp_max_size,
        directory_token,
        prior_destination,
    )
    return _publish_publication_journal_version(
        directory,
        filename,
        generation,
        content,
        None,
    )


def _complete_publication_journal(
    directory: int,
    filename: str,
    journal_token: tuple[int, int],
    temp_name: str,
    temp_token: tuple[int, int],
    temp_content: tuple[int, str],
    directory_token: tuple[int, int],
    prior_destination: tuple[tuple[int, int], tuple[int, str]] | None,
    temp_max_size: int = _MAX_ARCHIVE_BYTES,
) -> tuple[int, int]:
    loaded = _read_publication_journal(directory, filename, directory_token)
    if loaded is None or loaded[1] != journal_token:
        raise HandoffError("handoff publication journal ownership changed")
    generation = uuid.uuid4().hex
    content = _publication_journal_bytes(
        generation,
        temp_name,
        temp_token,
        temp_content,
        temp_max_size,
        directory_token,
        prior_destination,
    )
    return _publish_publication_journal_version(
        directory,
        filename,
        generation,
        content,
        journal_token,
    )


def _read_named_publication_journal(
    directory: int,
    name: str,
    filename: str,
    directory_token: tuple[int, int],
    *,
    require_sidecar_name: bool = False,
) -> tuple[dict[str, object], tuple[int, int]] | None:
    try:
        descriptor = os.open(
            name, os.O_RDONLY | _NOFOLLOW | _NONBLOCK, dir_fd=directory
        )
    except FileNotFoundError:
        return None
    except OSError as error:
        raise HandoffError("handoff publication journal is missing or unsafe") from error
    try:
        information = os.fstat(descriptor)
        if (
            not stat.S_ISREG(information.st_mode)
            or information.st_nlink != 1
            or information.st_size < 1
            or information.st_size > _MAX_METADATA_BYTES
        ):
            raise HandoffError("handoff publication journal is unsafe")
        chunks: list[bytes] = []
        remaining = information.st_size
        while remaining:
            chunk = os.read(descriptor, min(remaining, 65536))
            if not chunk:
                raise HandoffError("handoff publication journal is truncated")
            chunks.append(chunk)
            remaining -= len(chunk)
        after = os.fstat(descriptor)
        if (
            information.st_dev,
            information.st_ino,
            information.st_size,
            information.st_mtime_ns,
        ) != (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
        ):
            raise HandoffError(
                "handoff publication journal changed while being read"
            )
        token = information.st_dev, information.st_ino
    finally:
        os.close(descriptor)
    _require_named_token(directory, name, token, "handoff publication journal")
    raw = json.loads(
        b"".join(chunks).decode("utf-8"),
        object_pairs_hook=_duplicate_rejecting_object,
        parse_constant=_reject_json_constant,
    )
    expected_keys = {
        "schemaVersion",
        "journalGeneration",
        "tempName",
        "tempDevice",
        "tempInode",
        "tempComplete",
        "tempSize",
        "tempSha256",
        "tempMaxSize",
        "outputDevice",
        "outputInode",
        "priorDestinationState",
        "priorDestinationDevice",
        "priorDestinationInode",
        "priorDestinationSize",
        "priorDestinationSha256",
    }
    if not isinstance(raw, Mapping) or set(raw) != expected_keys:
        raise HandoffError("handoff publication journal has an invalid schema")
    temp_name = raw.get("tempName")
    journal_generation = raw.get("journalGeneration")
    ownership_values = tuple(
        raw.get(key)
        for key in ("tempDevice", "tempInode", "outputDevice", "outputInode")
    )
    temp_complete = raw.get("tempComplete")
    temp_size = raw.get("tempSize")
    temp_sha256 = raw.get("tempSha256")
    temp_max_size = raw.get("tempMaxSize")
    prior_state = raw.get("priorDestinationState")
    prior_device = raw.get("priorDestinationDevice")
    prior_inode = raw.get("priorDestinationInode")
    prior_size = raw.get("priorDestinationSize")
    prior_sha256 = raw.get("priorDestinationSha256")
    pattern = re.compile(
        re.escape(f".{filename}.") + r"[0-9a-f]{32}\.tmp"
    )
    if (
        type(raw.get("schemaVersion")) is not int
        or raw.get("schemaVersion") != 3
        or not isinstance(journal_generation, str)
        or _JOURNAL_GENERATION_PATTERN.fullmatch(journal_generation) is None
        or not isinstance(temp_name, str)
        or pattern.fullmatch(temp_name) is None
        or any(type(value) is not int or value < 1 for value in ownership_values)
        or tuple(ownership_values[2:]) != directory_token
        or type(temp_complete) is not bool
        or type(temp_size) is not int
        or not isinstance(temp_sha256, str)
        or _DIGEST_PATTERN.fullmatch(temp_sha256) is None
        or type(temp_max_size) is not int
        or temp_max_size < 1
        or temp_max_size > _MAX_PHYSICAL_ARCHIVE_BYTES
        or (temp_complete and temp_size > temp_max_size)
        or (
            temp_complete
            and (temp_size < 1 or temp_sha256 == "0" * 64)
        )
        or (
            not temp_complete
            and (temp_size != 0 or temp_sha256 != "0" * 64)
        )
        or prior_state not in ("absent", "regular")
        or type(prior_device) is not int
        or type(prior_inode) is not int
        or type(prior_size) is not int
        or not isinstance(prior_sha256, str)
        or _DIGEST_PATTERN.fullmatch(prior_sha256) is None
        or (
            prior_state == "absent"
            and (
                prior_device != 0
                or prior_inode != 0
                or prior_size != 0
                or prior_sha256 != "0" * 64
            )
        )
        or (
            prior_state == "regular"
            and (prior_device < 1 or prior_inode < 1 or prior_size < 0)
        )
    ):
        raise HandoffError("handoff publication journal has invalid ownership data")
    if require_sidecar_name and name != _journal_sidecar_name(
        filename,
        str(journal_generation),
    ):
        raise HandoffError(
            "handoff publication journal sidecar has invalid ownership data"
        )
    if b"".join(chunks) != _json_bytes(dict(raw)):
        raise HandoffError(
            "handoff publication journal is not canonical JSON"
        )
    return dict(raw), token


def _read_publication_journal(
    directory: int, filename: str, directory_token: tuple[int, int]
) -> tuple[dict[str, object], tuple[int, int]] | None:
    return _read_named_publication_journal(
        directory,
        _journal_name(filename),
        filename,
        directory_token,
    )


def _remove_publication_journal(
    directory: int,
    filename: str,
    token: tuple[int, int],
    expected_content: tuple[int, str],
) -> None:
    name = _journal_name(filename)
    _require_named_token(directory, name, token, "handoff publication journal")
    if _named_regular_fingerprint(
        directory,
        name,
        token,
        "handoff publication journal",
        max_size=_MAX_METADATA_BYTES,
    ) != expected_content:
        raise HandoffError("handoff publication journal content changed")
    os.unlink(name, dir_fd=directory)


def _optional_entry_token(directory: int, name: str) -> tuple[int, int] | None:
    try:
        information = os.stat(name, dir_fd=directory, follow_symlinks=False)
    except FileNotFoundError:
        return None
    except OSError as error:
        raise HandoffError("cannot inspect handoff transaction entry") from error
    if not stat.S_ISREG(information.st_mode):
        raise HandoffError("handoff transaction entry ownership mismatch; possible substitution")
    return information.st_dev, information.st_ino


def _destination_state(
    directory: int, filename: str
) -> tuple[tuple[int, int], tuple[int, str]] | None:
    token = _optional_entry_token(directory, filename)
    if token is None:
        return None
    content = _named_regular_fingerprint(
        directory,
        filename,
        token,
        "handoff destination",
        max_size=_MAX_PHYSICAL_ARCHIVE_BYTES,
        allow_empty=True,
    )
    return token, content


def _journal_prior_destination(
    journal: Mapping[str, object],
) -> tuple[tuple[int, int], tuple[int, str]] | None:
    if journal["priorDestinationState"] == "absent":
        return None
    return (
        (
            int(journal["priorDestinationDevice"]),
            int(journal["priorDestinationInode"]),
        ),
        (
            int(journal["priorDestinationSize"]),
            str(journal["priorDestinationSha256"]),
        ),
    )


def _destination_matches(
    directory: int,
    filename: str,
    expected: tuple[tuple[int, int], tuple[int, str]] | None,
) -> bool:
    try:
        return _destination_state(directory, filename) == expected
    except HandoffError:
        return False


def _require_destination_state(
    directory: int,
    filename: str,
    expected: tuple[tuple[int, int], tuple[int, str]] | None,
) -> None:
    if not _destination_matches(directory, filename, expected):
        raise HandoffError(
            "handoff destination changed; possible substitution"
        )


def _journal_transaction_identity(journal: Mapping[str, object]) -> tuple[object, ...]:
    return tuple(
        journal[key]
        for key in (
            "tempName",
            "tempDevice",
            "tempInode",
            "tempMaxSize",
            "outputDevice",
            "outputInode",
            "priorDestinationState",
            "priorDestinationDevice",
            "priorDestinationInode",
            "priorDestinationSize",
            "priorDestinationSha256",
        )
    )


def _valid_journal_sidecars(
    directory: int,
    filename: str,
    directory_token: tuple[int, int],
) -> tuple[tuple[str, dict[str, object], tuple[int, int]], ...]:
    prefix = f".{filename}.handoff-journal-sidecar-"
    suffix = ".tmp"
    candidates: list[tuple[str, dict[str, object], tuple[int, int]]] = []
    for name in sorted(os.listdir(directory)):
        if not name.startswith(prefix) or not name.endswith(suffix):
            continue
        generation = name[len(prefix) : -len(suffix)]
        if _JOURNAL_GENERATION_PATTERN.fullmatch(generation) is None:
            continue
        try:
            loaded = _read_named_publication_journal(
                directory,
                name,
                filename,
                directory_token,
                require_sidecar_name=True,
            )
        except (HandoffError, UnicodeError, ValueError, json.JSONDecodeError):
            # Malformed or substituted sidecars are unowned evidence. They are ignored,
            # never adopted or deleted, and cannot corrupt the visible journal.
            continue
        if loaded is not None:
            journal, token = loaded
            candidates.append((name, journal, token))
    return tuple(candidates)


def _load_recovery_journal(
    directory: int,
    filename: str,
    directory_token: tuple[int, int],
) -> tuple[dict[str, object], tuple[int, int]] | None:
    visible = _read_publication_journal(directory, filename, directory_token)
    sidecars = _valid_journal_sidecars(directory, filename, directory_token)
    if visible is not None:
        journal, _ = visible
        transaction = _journal_transaction_identity(journal)
        matching = [
            candidate
            for candidate in sidecars
            if _journal_transaction_identity(candidate[1]) == transaction
        ]
        if len(matching) != len(sidecars):
            raise HandoffError(
                "handoff recovery found an unrelated valid journal sidecar"
            )
        for name, expected_journal, token in matching:
            loaded = _read_named_publication_journal(
                directory,
                name,
                filename,
                directory_token,
                require_sidecar_name=True,
            )
            if (
                loaded is None
                or loaded[0] != expected_journal
                or loaded[1] != token
            ):
                raise HandoffError(
                    "handoff publication journal sidecar ownership changed"
                )
            expected_content = _json_bytes(expected_journal)
            if _named_regular_fingerprint(
                directory,
                name,
                token,
                "handoff publication journal sidecar",
                max_size=_MAX_METADATA_BYTES,
            ) != (
                len(expected_content),
                hashlib.sha256(expected_content).hexdigest(),
            ):
                raise HandoffError(
                    "handoff publication journal sidecar content changed"
                )
            os.unlink(name, dir_fd=directory)
        if matching:
            os.fsync(directory)
        return visible
    if not sidecars:
        return None
    if len(sidecars) != 1:
        raise HandoffError("handoff recovery has ambiguous valid journal sidecars")
    sidecar_name, expected_journal, sidecar_token = sidecars[0]
    if _optional_entry_token(directory, _journal_name(filename)) is not None:
        raise HandoffError("handoff publication journal ownership changed")
    loaded = _read_named_publication_journal(
        directory,
        sidecar_name,
        filename,
        directory_token,
        require_sidecar_name=True,
    )
    if (
        loaded is None
        or loaded[0] != expected_journal
        or loaded[1] != sidecar_token
    ):
        raise HandoffError("handoff publication journal sidecar ownership changed")
    expected_content = _json_bytes(expected_journal)
    if _named_regular_fingerprint(
        directory,
        sidecar_name,
        sidecar_token,
        "handoff publication journal sidecar",
        max_size=_MAX_METADATA_BYTES,
    ) != (
        len(expected_content),
        hashlib.sha256(expected_content).hexdigest(),
    ):
        raise HandoffError("handoff publication journal sidecar content changed")
    os.replace(
        sidecar_name,
        _journal_name(filename),
        src_dir_fd=directory,
        dst_dir_fd=directory,
    )
    os.fsync(directory)
    adopted = _read_publication_journal(directory, filename, directory_token)
    if adopted is None or adopted[1] != sidecar_token:
        raise HandoffError("handoff publication journal adoption failed")
    return adopted


def _recover_publication(
    directory: int,
    filename: str,
    directory_token: tuple[int, int],
) -> None:
    loaded = _load_recovery_journal(directory, filename, directory_token)
    if loaded is None:
        return
    journal, journal_token = loaded
    temp_name = str(journal["tempName"])
    expected = int(journal["tempDevice"]), int(journal["tempInode"])
    temp_token = _optional_entry_token(directory, temp_name)
    destination_token = _optional_entry_token(directory, filename)
    prior_destination = _journal_prior_destination(journal)
    if temp_token is not None and temp_token != expected:
        raise HandoffError(
            "handoff temporary snapshot ownership mismatch; possible substitution"
        )
    if destination_token == expected and temp_token == expected:
        raise HandoffError("handoff publication ownership is ambiguous")
    completed = bool(journal["tempComplete"])
    expected_content = int(journal["tempSize"]), str(journal["tempSha256"])
    temp_max_size = int(journal["tempMaxSize"])
    if temp_token == expected:
        _require_destination_state(
            directory,
            filename,
            prior_destination,
        )
        if completed and _named_regular_fingerprint(
            directory,
            temp_name,
            expected,
            "handoff temporary snapshot",
            max_size=temp_max_size,
        ) != expected_content:
            raise HandoffError(
                "handoff temporary snapshot content mismatch; possible substitution"
            )
        os.unlink(temp_name, dir_fd=directory)
    elif destination_token == expected:
        if not completed or _named_regular_fingerprint(
            directory,
            filename,
            expected,
            "published handoff archive",
            max_size=temp_max_size,
        ) != expected_content:
            raise HandoffError(
                "published handoff archive content mismatch; possible substitution"
            )
    elif not _destination_matches(directory, filename, prior_destination):
        raise HandoffError(
            "handoff recovery found an unknown destination; retaining transaction evidence"
        )
    journal_content = _json_bytes(journal)
    _remove_publication_journal(
        directory,
        filename,
        journal_token,
        (len(journal_content), hashlib.sha256(journal_content).hexdigest()),
    )
    os.fsync(directory)


def _cleanup_precommit(
    directory: int,
    filename: str,
    temp_name: str | None,
    temp_token: tuple[int, int] | None,
    temp_content: tuple[int, str] | None,
    temp_max_size: int,
    journal_token: tuple[int, int] | None,
    journal_content: tuple[int, str] | None,
) -> None:
    if temp_name is not None and temp_token is not None:
        try:
            observed = _optional_entry_token(directory, temp_name)
        except HandoffError:
            return
        if observed == temp_token:
            if temp_content is not None:
                try:
                    observed_content = _named_regular_fingerprint(
                        directory,
                        temp_name,
                        temp_token,
                        "temporary handoff file",
                        max_size=temp_max_size,
                    )
                except HandoffError:
                    return
                if observed_content != temp_content:
                    return
            os.unlink(temp_name, dir_fd=directory)
        elif observed is not None:
            return
    if journal_token is not None and journal_content is not None:
        try:
            _remove_publication_journal(
                directory,
                filename,
                journal_token,
                journal_content,
            )
            os.fsync(directory)
        except HandoffError:
            return


def _publish_archive(
    output: Path,
    filename: str,
    entries: Sequence[_ArchiveEntry],
    timestamp: tuple[int, int, int, int, int, int],
    *,
    before_publish: Callable[[], object] | None,
    prepublish_check: Callable[[], object],
    directory_fsync: Callable[[int], object],
) -> Path:
    physical_archive_bound = _physical_archive_size_bound(entries)
    destination = output / filename
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | _NOFOLLOW
    try:
        directory = os.open(output, flags)
    except OSError as error:
        raise HandoffError("cannot safely open handoff output directory") from error
    information = os.fstat(directory)
    directory_token = information.st_dev, information.st_ino
    committed = False
    try:
        with _handoff_publication_lock(directory, filename) as (lock_name, lock_token):
            _require_output_identity(output, directory_token)
            _recover_publication(directory, filename, directory_token)
            _destination_is_safe_at(directory, filename)
            prior_destination = _destination_state(directory, filename)
            temp_name: str | None = None
            temp_token: tuple[int, int] | None = None
            temp_content: tuple[int, str] | None = None
            journal_token: tuple[int, int] | None = None
            journal_content: tuple[int, str] | None = None
            temporary_descriptor: int | None = None
            try:
                for _ in range(10):
                    candidate = f".{filename}.{uuid.uuid4().hex}.tmp"
                    try:
                        temporary_descriptor = os.open(
                            candidate,
                            os.O_RDWR | os.O_CREAT | os.O_EXCL | _NOFOLLOW,
                            0o600,
                            dir_fd=directory,
                        )
                    except FileExistsError:
                        continue
                    temp_name = candidate
                    temp_information = os.fstat(temporary_descriptor)
                    temp_token = temp_information.st_dev, temp_information.st_ino
                    break
                else:
                    raise HandoffError("cannot allocate a unique temporary handoff file")
                journal_token = _write_publication_journal(
                    directory,
                    filename,
                    temp_name,
                    temp_token,
                    directory_token,
                    prior_destination,
                    physical_archive_bound,
                )
                journal_content = _named_regular_fingerprint(
                    directory,
                    _journal_name(filename),
                    journal_token,
                    "handoff publication journal",
                    max_size=_MAX_METADATA_BYTES,
                )
                try:
                    assert temporary_descriptor is not None
                    temporary_stream = os.fdopen(temporary_descriptor, "w+b")
                except Exception:
                    if temporary_descriptor is not None:
                        os.close(temporary_descriptor)
                        temporary_descriptor = None
                    raise
                temporary_descriptor = None
                with temporary_stream as temporary:
                    _write_archive(temporary, entries, timestamp)
                    temporary.flush()
                    os.fsync(temporary.fileno())
                    os.fchmod(temporary.fileno(), 0o644)
                temp_content = _named_regular_fingerprint(
                    directory,
                    temp_name,
                    temp_token,
                    "temporary handoff file",
                    max_size=physical_archive_bound,
                )
                _require_physical_archive_size(
                    temp_content[0],
                    physical_archive_bound,
                )
                journal_token = _complete_publication_journal(
                    directory,
                    filename,
                    journal_token,
                    temp_name,
                    temp_token,
                    temp_content,
                    directory_token,
                    prior_destination,
                    physical_archive_bound,
                )
                journal_content = _named_regular_fingerprint(
                    directory,
                    _journal_name(filename),
                    journal_token,
                    "handoff publication journal",
                    max_size=_MAX_METADATA_BYTES,
                )

                if before_publish is not None:
                    before_publish()
                prepublish_check()
                _require_output_identity(output, directory_token)
                _require_named_token(
                    directory, lock_name, lock_token, "handoff publication lock"
                )
                _require_named_token(
                    directory,
                    _journal_name(filename),
                    journal_token,
                    "handoff publication journal",
                )
                if _named_regular_fingerprint(
                    directory,
                    _journal_name(filename),
                    journal_token,
                    "handoff publication journal",
                    max_size=_MAX_METADATA_BYTES,
                ) != journal_content:
                    raise HandoffError(
                        "handoff publication journal content changed"
                    )
                _require_owned_temp(directory, temp_name, temp_token)
                if _named_regular_fingerprint(
                    directory,
                    temp_name,
                    temp_token,
                    "temporary handoff file",
                    max_size=physical_archive_bound,
                ) != temp_content:
                    raise HandoffError(
                        "temporary handoff file content mismatch; possible substitution"
                    )
                _require_destination_state(
                    directory,
                    filename,
                    prior_destination,
                )
                os.replace(
                    temp_name,
                    filename,
                    src_dir_fd=directory,
                    dst_dir_fd=directory,
                )
                temp_name = None
                committed = True
                try:
                    directory_fsync(directory)
                except Exception as error:
                    raise HandoffError(
                        "handoff publication committed; durability unknown"
                    ) from error
                try:
                    _remove_publication_journal(
                        directory,
                        filename,
                        journal_token,
                        journal_content,
                    )
                except Exception as error:
                    raise HandoffError(
                        "handoff publication committed; cleanup pending"
                    ) from error
                journal_token = None
                try:
                    directory_fsync(directory)
                except Exception as error:
                    raise HandoffError(
                        "handoff publication committed; cleanup durability unknown"
                    ) from error
            except Exception:
                if temporary_descriptor is not None:
                    os.close(temporary_descriptor)
                if not committed:
                    _cleanup_precommit(
                        directory,
                        filename,
                        temp_name,
                        temp_token,
                        temp_content,
                        physical_archive_bound,
                        journal_token,
                        journal_content,
                    )
                raise
    except Exception as error:
        if committed:
            if isinstance(error, HandoffError) and str(error).startswith(
                "handoff publication committed;"
            ):
                raise
            raise HandoffError(
                "handoff publication committed; post-commit finalization failed"
            ) from error
        raise
    finally:
        try:
            os.close(directory)
        except Exception as error:
            if committed:
                raise HandoffError(
                    "handoff publication committed; post-commit finalization failed"
                ) from error
            raise
    return destination


def export_handoff(
    project_dir: str | Path = ELECTRONICS_DIR,
    *,
    include_blend: bool = False,
    output_dir: str | Path = HANDOFF_BUILD_DIR / "outgoing",
    export_dir: str | Path = PCB_OUTPUT_DIR,
    blend_path: str | Path = POCKET_CARD_DIR / "case" / "out" / "order" / "pocket_card_complete.blend",
    source_date_epoch: int | None = None,
    runner: Callable[..., object] = subprocess.run,
    validator: _Validator = validate_project,
    current_exports_checker: _CurrentExportsChecker = require_current_exports,
    git_metadata_provider: _GitMetadataProvider = _git_metadata,
    before_publish: Callable[[], object] | None = None,
    directory_fsync: Callable[[int], object] = os.fsync,
) -> Path:
    """Validate and atomically publish one reproducible outgoing handoff ZIP."""

    project = _resolved_directory(project_dir, "canonical project")
    exports = _resolved_directory(export_dir, "verified PCB export tree")
    source_digest_before, _ = _canonical_project_digest(project)
    export_recipe_digest_before = _canonical_export_recipe_digest()
    validation_result = _call_validator(validator, project, runner)
    status = getattr(validation_result, "status", None)
    if status != PASS:
        messages = "; ".join(str(item) for item in getattr(validation_result, "messages", ()))
        suffix = f": {messages[:4096]}" if messages else ""
        if status == MECHANICAL_REVIEW_REQUIRED:
            raise HandoffError(f"outgoing handoff requires baseline PASS; got {status}{suffix}")
        raise HandoffError(f"outgoing handoff validation failed with {status!r}{suffix}")
    if _canonical_project_digest(project)[0] != source_digest_before:
        raise HandoffError("canonical project changed during handoff validation")

    manifest_path = exports / "source_manifest.json"
    manifest_fingerprint_before = _regular_fingerprint(
        manifest_path,
        "verified export manifest",
    )
    _require_current_exports(current_exports_checker, project, exports)
    repo_root = _repository_root(project) if git_metadata_provider is _git_metadata else project
    git_commit, commit_epoch = git_metadata_provider(repo_root)
    if _COMMIT_PATTERN.fullmatch(git_commit) is None or isinstance(commit_epoch, bool) or not isinstance(commit_epoch, int):
        raise HandoffError("Git handoff provenance is malformed")
    epoch = _source_epoch(source_date_epoch, commit_epoch)
    archive_timestamp = _zip_timestamp(epoch)

    with tempfile.TemporaryDirectory(prefix="pocket-card-handoff-snapshot-") as raw_snapshot:
        snapshot_root = Path(raw_snapshot)
        entries: list[_ArchiveEntry] = []
        counter = 0

        def snapshot_file(
            archive_name: str,
            source: Path,
            label: str,
            *,
            required_prefix: bytes | None = None,
            max_size: int = _MAX_ARCHIVE_BYTES,
        ) -> _ArchiveEntry:
            nonlocal counter
            _archive_info(archive_name, archive_timestamp)
            if len(entries) >= _MAX_ARCHIVE_MEMBERS:
                raise HandoffError(
                    f"handoff archive exceeds {_MAX_ARCHIVE_MEMBERS} members"
                )
            remaining = _MAX_ARCHIVE_BYTES - sum(item.size for item in entries)
            if remaining < 1:
                raise HandoffError(
                    f"handoff archive exceeds {_MAX_ARCHIVE_BYTES} uncompressed bytes"
                )
            destination = snapshot_root / f"entry-{counter:04d}"
            counter += 1
            size, digest = _snapshot_regular(
                source,
                destination,
                label,
                max_size=min(max_size, remaining),
                required_prefix=required_prefix,
            )
            entry = _ArchiveEntry(archive_name, destination, size, digest)
            entries.append(entry)
            _check_archive_bounds(entries)
            return entry

        def snapshot_generated(archive_name: str, content: bytes) -> _ArchiveEntry:
            nonlocal counter
            _archive_info(archive_name, archive_timestamp)
            if len(entries) >= _MAX_ARCHIVE_MEMBERS:
                raise HandoffError(
                    f"handoff archive exceeds {_MAX_ARCHIVE_MEMBERS} members"
                )
            remaining = _MAX_ARCHIVE_BYTES - sum(item.size for item in entries)
            if len(content) > remaining:
                raise HandoffError(f"generated handoff entry is too large: {archive_name}")
            destination = snapshot_root / f"entry-{counter:04d}"
            counter += 1
            size, digest = _snapshot_bytes(destination, content)
            entry = _ArchiveEntry(archive_name, destination, size, digest)
            entries.append(entry)
            _check_archive_bounds(entries)
            return entry

        manifest_snapshot = snapshot_root / "export-manifest.json"
        manifest_fingerprint_snapshot = _snapshot_regular(
            manifest_path,
            manifest_snapshot,
            "verified export manifest",
            max_size=_MAX_METADATA_BYTES,
        )
        if manifest_fingerprint_snapshot != manifest_fingerprint_before:
            raise HandoffError(
                "verified export manifest changed after currentness check; "
                "handoff provenance is ambiguous"
            )
        manifest = _load_export_metadata(manifest_snapshot, source_digest_before)
        artifacts = manifest["artifacts"]
        assert isinstance(artifacts, Mapping)

        project_snapshot_items: list[tuple[str, Path]] = []
        for source in _editable_sources(project):
            relative = source.relative_to(project).as_posix()
            entry = snapshot_file(
                f"{_ARCHIVE_ROOT}/project/{relative}",
                source,
                "editable project source",
            )
            project_snapshot_items.append((relative, entry.path))
        if _labeled_project_digest(project_snapshot_items) != source_digest_before:
            raise HandoffError(
                "archived project snapshot digest does not match canonical baseline"
            )

        policy_snapshot_root = snapshot_root / "policy"
        policy_snapshot_root.mkdir()
        policy_snapshots: dict[str, tuple[Path, int, str]] = {}
        for name in _POLICY_DIGEST_NAMES:
            destination = policy_snapshot_root / name
            size, digest = _snapshot_regular(
                project / name,
                destination,
                "canonical validation policy",
                max_size=_MAX_METADATA_BYTES,
            )
            policy_snapshots[name] = (destination, size, digest)
        policy_digest = _labeled_project_digest(
            tuple((name, value[0]) for name, value in policy_snapshots.items())
        )
        if policy_digest != manifest["policyDigest"]:
            raise HandoffError(
                "archived validation policy snapshot does not match export manifest"
            )
        if manifest["exportRecipeDigest"] != export_recipe_digest_before:
            raise HandoffError("verified export manifest recipe digest is stale")
        _, expected_kicad_major, minimum_kicad_version = _load_toolchain(
            policy_snapshot_root
        )
        manifest_kicad_version = _version_tuple(str(manifest["kicadVersion"]))
        if (
            manifest_kicad_version[0] != expected_kicad_major
            or manifest_kicad_version < _version_tuple(minimum_kicad_version)
        ):
            raise HandoffError(
                "verified export manifest KiCad version is stale for the toolchain policy"
            )
        for name in _POLICY_NAMES:
            path, size, digest = policy_snapshots[name]
            archive_name = f"{_ARCHIVE_ROOT}/reference/{name}"
            entries.append(_ArchiveEntry(archive_name, path, size, digest))
            _archive_info(archive_name, archive_timestamp)
            _check_archive_bounds(entries)

        for target, source_name in _EXPORT_REFERENCES.items():
            metadata = artifacts.get(source_name)
            if not isinstance(metadata, Mapping):
                raise HandoffError(
                    f"verified export manifest is missing reference: {source_name}"
                )
            entry = snapshot_file(
                f"{_ARCHIVE_ROOT}/reference/{target}",
                exports / source_name,
                "verified export reference",
            )
            if (
                metadata.get("size") != entry.size
                or metadata.get("sha256") != entry.sha256
            ):
                raise HandoffError(
                    f"verified export reference hash does not match manifest: {source_name}"
                )

        contract_raw = json.loads(
            _read_regular_bytes(
                policy_snapshots["mechanical_contract.json"][0],
                "mechanical contract snapshot",
            ).decode("utf-8"),
            object_pairs_hook=_duplicate_rejecting_object,
            parse_constant=_reject_json_constant,
        )
        if not isinstance(contract_raw, Mapping):
            raise HandoffError("mechanical contract must be a JSON object")
        raw_inventory = getattr(validation_result, "inventory", None)
        if raw_inventory is None:
            raise HandoffError("passing validation did not provide a semantic inventory")
        inventory = _inventory_value(raw_inventory)
        if not isinstance(inventory, Mapping):
            raise HandoffError("validation inventory is invalid")
        snapshot_generated(
            f"{_ARCHIVE_ROOT}/reference/inventory.json", _json_bytes(inventory)
        )
        snapshot_generated(
            f"{_ARCHIVE_ROOT}/reference/semantic-summary.md",
            _semantic_summary(inventory, contract_raw, source_digest_before),
        )

        blend_source: Path | None = None
        blend_entry: _ArchiveEntry | None = None
        if include_blend:
            blend_source = Path(blend_path).expanduser()
            blend_entry = snapshot_file(
                f"{_ARCHIVE_ROOT}/reference/pocket_card_complete.blend",
                blend_source,
                "Blender visual reference",
                required_prefix=b"BLENDER",
            )

        metadata = {
            "schemaVersion": _HANDOFF_SCHEMA_VERSION,
            "projectName": PROJECT_NAME,
            "baseProjectDigest": source_digest_before,
            "gitCommit": git_commit,
            "createdAt": _created_at(epoch),
            "kicadVersion": manifest["kicadVersion"],
            "toolVersions": {"handoffPipeline": _HANDOFF_TOOL_VERSION},
        }
        snapshot_generated(
            f"{_ARCHIVE_ROOT}/HANDOFF.md", _handoff_instructions(include_blend)
        )
        snapshot_generated(
            f"{_ARCHIVE_ROOT}/handoff.json", _json_bytes(metadata)
        )
        _check_archive_bounds(entries)

        _require_current_exports(current_exports_checker, project, exports)
        if _canonical_project_digest(project)[0] != source_digest_before:
            raise HandoffError("canonical project changed while assembling handoff")
        if _canonical_policy_digest(project) != manifest["policyDigest"]:
            raise HandoffError(
                "canonical validation policy changed while assembling handoff"
            )
        if _canonical_export_recipe_digest() != export_recipe_digest_before:
            raise HandoffError("PCB export recipe changed while assembling handoff")
        if include_blend and blend_source is not None and blend_entry is not None:
            current_blend = snapshot_root / "blend-current"
            size, digest = _snapshot_regular(
                blend_source,
                current_blend,
                "Blender visual reference",
                required_prefix=b"BLENDER",
            )
            if size != blend_entry.size or digest != blend_entry.sha256:
                raise HandoffError(
                    "Blender visual reference changed while assembling handoff"
                )

        output = _prepare_output_directory(output_dir, project, exports)
        filename = (
            "pocket-card-controller-with-blender.zip"
            if include_blend
            else "pocket-card-controller.zip"
        )

        def prepublish_check() -> None:
            _require_current_exports(current_exports_checker, project, exports)
            if _canonical_project_digest(project)[0] != source_digest_before:
                raise HandoffError("canonical project changed before handoff publication")
            if _canonical_policy_digest(project) != manifest["policyDigest"]:
                raise HandoffError(
                    "canonical validation policy changed before handoff publication"
                )
            if _canonical_export_recipe_digest() != export_recipe_digest_before:
                raise HandoffError("PCB export recipe changed before handoff publication")
            if include_blend and blend_source is not None and blend_entry is not None:
                current_blend = snapshot_root / "blend-final"
                size, digest = _snapshot_regular(
                    blend_source,
                    current_blend,
                    "Blender visual reference",
                    required_prefix=b"BLENDER",
                )
                if size != blend_entry.size or digest != blend_entry.sha256:
                    raise HandoffError(
                        "Blender visual reference changed before handoff publication"
                    )
            final_commit, _ = git_metadata_provider(repo_root)
            if final_commit != git_commit:
                raise HandoffError("Git HEAD changed before handoff publication")

        return _publish_archive(
            output,
            filename,
            entries,
            archive_timestamp,
            before_publish=before_publish,
            prepublish_check=prepublish_check,
            directory_fsync=directory_fsync,
        )


def _normalize_returned_member_name(name: str) -> PurePosixPath:
    if "\\" in name or "\0" in name:
        raise HandoffInvalid(f"unsafe archive member name: {name!r}")
    normalized = PurePosixPath(name)
    posix = normalized.as_posix()
    if (
        not name
        or normalized.is_absolute()
        or posix != name.rstrip("/")
        or any(part in ("", ".", "..") for part in normalized.parts)
    ):
        raise HandoffInvalid(f"unsafe archive member name: {name!r}")
    return normalized


def _zip_entry_is_symlink(info: zipfile.ZipInfo) -> bool:
    return stat.S_ISLNK((info.external_attr >> 16) & 0xFFFF)


def _validate_returned_project_relative(relative: PurePosixPath) -> None:
    if not relative.parts:
        raise HandoffInvalid("project archive member must have a relative path")
    top = relative.parts[0]
    if top in EDITABLE_PROJECT_FILES:
        if len(relative.parts) != 1:
            raise HandoffInvalid(f"unexpected project path: {relative.as_posix()}")
        return
    if top in EDITABLE_PROJECT_DIRS:
        if len(relative.parts) < 2:
            return
        suffix = relative.suffix.lower()
        if suffix not in _LOCAL_EDITABLE_SUFFIXES[top]:
            raise HandoffInvalid(f"unexpected project asset: {relative.as_posix()}")
        return
    raise HandoffInvalid(f"unexpected canonical project filename: {relative.as_posix()}")


def _inspect_returned_archive(archive_path: Path) -> tuple[list[zipfile.ZipInfo], dict[str, bytes]]:
    if not archive_path.is_file():
        raise HandoffInvalid(f"returned handoff archive is missing: {archive_path}")
    try:
        archive = zipfile.ZipFile(archive_path)
    except zipfile.BadZipFile as error:
        raise HandoffInvalid(f"returned handoff archive is not a ZIP file: {archive_path}") from error
    with archive:
        members = archive.infolist()
        if len(members) > _MAX_ARCHIVE_MEMBERS:
            raise HandoffInvalid(
                f"returned handoff archive exceeds {_MAX_ARCHIVE_MEMBERS} members"
            )
        total_bytes = 0
        names: set[str] = set()
        roots: set[str] = set()
        project_members: dict[str, bytes] = {}
        has_project_dir = False
        has_handoff_metadata = False
        required_project_names = set(_REQUIRED_PROJECT_SOURCES)

        for info in members:
            _normalize_returned_member_name(info.filename)
            if _zip_entry_is_symlink(info):
                raise HandoffInvalid(
                    f"returned handoff archive member is a symlink: {info.filename}"
                )
            if info.filename in names:
                raise HandoffInvalid(
                    f"duplicate returned handoff archive member: {info.filename}"
                )
            names.add(info.filename)
            if info.file_size < 0 or info.file_size > _MAX_ARCHIVE_BYTES:
                raise HandoffInvalid(
                    f"returned handoff archive member has an invalid size: {info.filename}"
                )
            if info.file_size > _MAX_ARCHIVE_BYTES - total_bytes:
                raise HandoffInvalid(
                    f"returned handoff archive exceeds {_MAX_ARCHIVE_BYTES} uncompressed bytes"
                )
            total_bytes += info.file_size
            parts = PurePosixPath(info.filename).parts
            if not parts:
                continue
            roots.add(parts[0])
            if parts[0] != _ARCHIVE_ROOT:
                raise HandoffInvalid(
                    f"returned handoff archive has an unexpected root: {parts[0]!r}"
                )
            if info.filename in _ALLOWED_NON_PROJECT_MEMBERS:
                if info.filename == _HANDOFF_METADATA_NAME:
                    has_handoff_metadata = True
                continue
            if any(
                info.filename.startswith(prefix)
                for prefix in _ALLOWED_NON_PROJECT_PREFIXES
            ):
                continue
            if info.filename == f"{_ARCHIVE_ROOT}/project" or info.filename.startswith(
                _PROJECT_ARCHIVE_PREFIX
            ):
                has_project_dir = True
                if info.filename == f"{_ARCHIVE_ROOT}/project":
                    continue
                relative = PurePosixPath(info.filename[len(_PROJECT_ARCHIVE_PREFIX) :])
                _validate_returned_project_relative(relative)
                if info.file_size > 0 and not info.is_dir():
                    project_members[relative.as_posix()] = archive.read(info)
                continue
            raise HandoffInvalid(
                f"returned handoff archive has an unexpected member: {info.filename}"
            )

        if len(roots) != 1:
            raise HandoffInvalid(
                "returned handoff archive must contain exactly one top-level directory"
            )
        if not has_project_dir:
            raise HandoffInvalid("returned handoff archive is missing project/")
        if not has_handoff_metadata:
            raise HandoffInvalid("returned handoff archive is missing handoff.json")
        missing = sorted(
            name for name in required_project_names if name not in project_members
        )
        if missing:
            raise HandoffInvalid(
                "returned handoff archive is missing required project sources: "
                + ", ".join(missing)
            )
        return members, project_members


def _labeled_bytes_digest(items: Sequence[tuple[str, bytes]]) -> str:
    """Hash labeled archive bytes with the same algorithm as `_labeled_project_digest`."""

    digest = hashlib.sha256()
    for relative, content in sorted(items, key=lambda item: item[0]):
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(content)
        digest.update(b"\0")
    return digest.hexdigest()


def _handoff_project_digest(project: Path) -> str:
    """Return the export-compatible editable-project digest for one project tree."""

    digest, _ = _canonical_project_digest(project)
    return digest


def _load_returned_handoff_metadata(archive_path: Path) -> dict[str, object]:
    try:
        with zipfile.ZipFile(archive_path) as archive:
            raw = archive.read(_HANDOFF_METADATA_NAME)
    except (KeyError, OSError, zipfile.BadZipFile) as error:
        raise HandoffInvalid("returned handoff archive is missing handoff.json") from error
    if len(raw) < 1 or len(raw) > _MAX_METADATA_BYTES:
        raise HandoffInvalid("returned handoff metadata is missing or too large")
    try:
        loaded = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_duplicate_rejecting_object,
            parse_constant=_reject_json_constant,
        )
    except (UnicodeError, json.JSONDecodeError) as error:
        raise HandoffInvalid("returned handoff metadata is not valid JSON") from error
    if not isinstance(loaded, Mapping):
        raise HandoffInvalid("returned handoff metadata must be a JSON object")
    return dict(loaded)


def _returned_base_digest(metadata: Mapping[str, object]) -> str:
    digest = metadata.get("baseProjectDigest")
    if not isinstance(digest, str) or _DIGEST_PATTERN.fullmatch(digest) is None:
        raise HandoffInvalid("returned handoff metadata has an invalid baseProjectDigest")
    return digest


def _pad_from_mapping(raw: Mapping[str, object]) -> Pad:
    net = raw.get("net")
    uuid = raw.get("uuid")
    return Pad(
        number=str(raw.get("number", "")),
        net=None if net is None else str(net),
        uuid=None if uuid is None else str(uuid),
    )


def _footprint_from_mapping(raw: Mapping[str, object]) -> Footprint:
    pads: dict[str, tuple[Pad, ...]] = {}
    pads_raw = raw.get("pads")
    if isinstance(pads_raw, Mapping):
        for number, group in pads_raw.items():
            if isinstance(group, list):
                pads[str(number)] = tuple(
                    _pad_from_mapping(item)
                    for item in group
                    if isinstance(item, Mapping)
                )
    courtyard = raw.get("courtyard_bbox_mm")
    return Footprint(
        ref=str(raw.get("ref", "")),
        value=str(raw.get("value", "")),
        library_id=str(raw.get("library_id", "")),
        uuid=str(raw.get("uuid", "")),
        symbol_path=str(raw.get("symbol_path", "")),
        x_mm=float(raw.get("x_mm", 0.0)),
        y_mm=float(raw.get("y_mm", 0.0)),
        rotation_deg=float(raw.get("rotation_deg", 0.0)),
        layer=str(raw.get("layer", "")),
        locked=bool(raw.get("locked", False)),
        pads=pads,
        courtyard_bbox_mm=(
            tuple(courtyard)  # type: ignore[arg-type]
            if isinstance(courtyard, (list, tuple)) and len(courtyard) == 4
            else None
        ),
    )


def _schematic_inventory_from_mapping(raw: Mapping[str, object]) -> SchematicInventory:
    components: dict[str, SchematicComponent] = {}
    components_raw = raw.get("components")
    if isinstance(components_raw, Mapping):
        for ref, payload in components_raw.items():
            if isinstance(payload, Mapping):
                fields_raw = payload.get("fields")
                fields = (
                    {str(key): str(value) for key, value in fields_raw.items()}
                    if isinstance(fields_raw, Mapping)
                    else {}
                )
                components[str(ref)] = SchematicComponent(
                    ref=str(payload.get("ref", ref)),
                    value=str(payload.get("value", "")),
                    footprint=str(payload.get("footprint", "")),
                    uuid=str(payload.get("uuid", "")),
                    fields=fields,
                )
    nets: dict[str, tuple[str, ...]] = {}
    nets_raw = raw.get("nets")
    if isinstance(nets_raw, Mapping):
        for name, endpoints in nets_raw.items():
            if isinstance(endpoints, (list, tuple)):
                nets[str(name)] = tuple(str(item) for item in endpoints)
    return SchematicInventory(components=components, nets=nets)


def _board_inventory_from_mapping(raw: Mapping[str, object]) -> BoardInventory:
    footprints: dict[str, Footprint] = {}
    footprints_raw = raw.get("footprints")
    if isinstance(footprints_raw, Mapping):
        for ref, payload in footprints_raw.items():
            if isinstance(payload, Mapping):
                footprints[str(ref)] = _footprint_from_mapping(payload)
    edge_cuts_raw = raw.get("edge_cuts")
    edge_cuts = tuple(
        dict(item)
        for item in edge_cuts_raw
        if isinstance(item, Mapping)
    ) if isinstance(edge_cuts_raw, (list, tuple)) else ()
    return BoardInventory(
        thickness_mm=float(raw.get("thickness_mm", 0.0)),
        footprints=footprints,
        edge_cuts=edge_cuts,
    )


def _coerce_project_inventory(value: object) -> ProjectInventory:
    if isinstance(value, ProjectInventory):
        return value
    if not isinstance(value, Mapping):
        raise HandoffError("validation inventory is invalid")
    schematic_raw = value.get("schematic")
    board_raw = value.get("board")
    if not isinstance(schematic_raw, Mapping) or not isinstance(board_raw, Mapping):
        raise HandoffError("validation inventory is invalid")
    return ProjectInventory(
        schematic=_schematic_inventory_from_mapping(schematic_raw),
        board=_board_inventory_from_mapping(board_raw),
    )


def _empty_project_inventory() -> ProjectInventory:
    return ProjectInventory(
        schematic=SchematicInventory(components={}, nets={}),
        board=BoardInventory(thickness_mm=0.0, footprints={}, edge_cuts=()),
    )


def _semantic_diff_report(before: object, after: object) -> dict[str, object]:
    before_inventory = (
        _empty_project_inventory()
        if before is None
        else _coerce_project_inventory(before)
    )
    after_inventory = (
        _empty_project_inventory()
        if after is None
        else _coerce_project_inventory(after)
    )
    return _inventory_value(semantic_diff(before_inventory, after_inventory))


def _report_scope_counts(reports: Mapping[str, object]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for scope in ("ERC", "DRC", "parity"):
        payload = reports.get(scope)
        if not isinstance(payload, Mapping):
            counts[scope] = 0
            continue
        violations = payload.get("violations")
        if isinstance(violations, Sequence):
            counts[scope] = len(violations)
        else:
            counts[scope] = 0
    return counts


def _render_check_report_markdown(
    *,
    status: str,
    base_digest: str,
    returned_digest: str,
    returned_base_digest: str,
    validation_messages: Sequence[str],
    semantic_diff_report: Mapping[str, object],
    validation_reports: Mapping[str, object],
) -> str:
    lines = [
        "# Pocket Card returned handoff report",
        "",
        f"- Status: `{status}`",
        f"- Current canonical digest: `{base_digest}`",
        f"- Returned baseline digest: `{returned_base_digest}`",
        f"- Returned project digest: `{returned_digest}`",
        "",
    ]
    if validation_messages:
        lines.append("## Validation messages")
        lines.append("")
        for message in validation_messages:
            lines.append(f"- {message}")
        lines.append("")

    counts = _report_scope_counts(validation_reports)
    lines.extend(
        [
            "## ERC/DRC counts",
            "",
            f"- ERC violations: {counts.get('ERC', 0)}",
            f"- DRC violations: {counts.get('DRC', 0)}",
            f"- Parity violations: {counts.get('parity', 0)}",
            "",
        ]
    )

    mechanical = validation_reports.get("mechanical")
    lines.append("## Mechanical findings")
    lines.append("")
    if isinstance(mechanical, Sequence) and mechanical:
        for finding in mechanical:
            lines.append(f"- {finding}")
    else:
        lines.append("- none")
    lines.append("")

    for section, title in (
        ("components", "Components"),
        ("nets", "Nets and pins"),
        ("footprints", "Footprints"),
        ("placements", "Placements"),
    ):
        payload = semantic_diff_report.get(section)
        if not isinstance(payload, Mapping):
            continue
        lines.append(f"## {title}")
        lines.append("")
        for label in ("added", "removed"):
            values = payload.get(label)
            if isinstance(values, Sequence) and values:
                lines.append(f"- {label}: {', '.join(str(item) for item in values)}")
        changed = payload.get("changed")
        if isinstance(changed, Mapping) and changed:
            lines.append("- changed:")
            for key in sorted(changed):
                lines.append(f"  - `{key}`")
        if lines[-1] != "":
            lines.append("")

    outline = semantic_diff_report.get("outline")
    lines.append("## Board outline")
    lines.append("")
    if isinstance(outline, Mapping) and outline.get("changed") is True:
        lines.append("- changed")
    else:
        lines.append("- unchanged")
    lines.append("")
    return "\n".join(lines)


def _write_check_reports(
    stage_dir: Path,
    *,
    status: str,
    base_digest: str,
    returned_digest: str,
    returned_base_digest: str,
    validation_messages: Sequence[str],
    semantic_diff_report: Mapping[str, object],
    source_hashes: Mapping[str, str],
    validation_reports: Mapping[str, object],
) -> tuple[Path, Path]:
    stage_dir.mkdir(parents=True, exist_ok=True)
    report_json = stage_dir / "report.json"
    report_markdown = stage_dir / "report.md"
    payload = {
        "schemaVersion": _CHECK_REPORT_SCHEMA_VERSION,
        "status": status,
        "baseProjectDigest": base_digest,
        "currentProjectDigest": base_digest,
        "returnedBaseProjectDigest": returned_base_digest,
        "returnedProjectDigest": returned_digest,
        "validationMessages": list(validation_messages),
        "sourceFileHashes": dict(source_hashes),
        "semanticDiff": _inventory_value(dict(semantic_diff_report)),
        "validationReports": _inventory_value(dict(validation_reports)),
    }
    report_json.write_bytes(_json_bytes(payload))
    report_markdown.write_text(
        _render_check_report_markdown(
            status=status,
            base_digest=base_digest,
            returned_digest=returned_digest,
            returned_base_digest=returned_base_digest,
            validation_messages=validation_messages,
            semantic_diff_report=semantic_diff_report,
            validation_reports=validation_reports,
        ),
        encoding="utf-8",
    )
    return report_json, report_markdown


def _extract_returned_project(
    archive_path: Path,
    project_members: Mapping[str, bytes],
    destination: Path,
) -> None:
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    with zipfile.ZipFile(archive_path) as archive:
        for info in archive.infolist():
            if not info.filename.startswith(_PROJECT_ARCHIVE_PREFIX):
                continue
            relative = PurePosixPath(info.filename[len(_PROJECT_ARCHIVE_PREFIX) :])
            if info.is_dir() or info.file_size < 1:
                continue
            _validate_returned_project_relative(relative)
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                raise HandoffInvalid(
                    f"returned project extraction path already exists: {relative.as_posix()}"
                )
            with archive.open(info, "r") as source, target.open("wb") as sink:
                shutil.copyfileobj(source, sink, length=_COPY_CHUNK_SIZE)


def _install_canonical_validation_policy(project: Path) -> None:
    for name in _POLICY_DIGEST_NAMES:
        shutil.copy2(ELECTRONICS_DIR / name, project / name)


def _source_file_hashes(project: Path) -> dict[str, str]:
    hashes: dict[str, str] = {}
    for path in _editable_sources(project):
        relative = path.relative_to(project).as_posix()
        _, digest = _regular_fingerprint(path, "returned project source")
        hashes[relative] = digest
    return hashes


def check_returned_zip(
    archive_path: str | Path,
    repo_root: str | Path,
    *,
    runner: Callable[..., object] = subprocess.run,
    validator: _Validator | None = None,
) -> HandoffCheckResult:
    """Safely stage and semantically review one returned engineer handoff ZIP."""

    if validator is None:
        validator = validate_project

    archive = Path(archive_path).expanduser()
    _resolved_directory(repo_root, "repository root")
    canonical_project = _resolved_directory(ELECTRONICS_DIR, "canonical project")
    _, project_members = _inspect_returned_archive(archive)
    metadata = _load_returned_handoff_metadata(archive)
    returned_base_digest = _returned_base_digest(metadata)
    returned_digest = _labeled_bytes_digest(tuple(project_members.items()))
    current_digest = _handoff_project_digest(canonical_project)
    stage_dir = (HANDOFF_BUILD_DIR / "staged" / returned_digest).resolve()
    validation_messages: list[str] = []
    semantic_diff_report: dict[str, object] = {}
    validation_reports: dict[str, object] = {}
    source_hashes: dict[str, str] = {}
    status = PASS

    if returned_base_digest != current_digest:
        validation_messages.append(
            "returned handoff baseline "
            f"{returned_base_digest} does not match current project digest "
            f"{current_digest}; do not auto-merge"
        )
        status = INVALID
        report_json, report_markdown = _write_check_reports(
            stage_dir,
            status=status,
            base_digest=current_digest,
            returned_digest=returned_digest,
            returned_base_digest=returned_base_digest,
            validation_messages=validation_messages,
            semantic_diff_report=semantic_diff_report,
            source_hashes=source_hashes,
            validation_reports=validation_reports,
        )
        return HandoffCheckResult(
            status=status,
            stage_dir=stage_dir,
            base_digest=current_digest,
            returned_digest=returned_digest,
            semantic_diff=semantic_diff_report,
            report_json=report_json,
            report_markdown=report_markdown,
        )

    project_dir = stage_dir / "project"
    _extract_returned_project(archive, project_members, project_dir)
    staged_project = _resolved_directory(project_dir, "staged returned project")
    staged_digest = _handoff_project_digest(staged_project)
    if staged_digest != returned_digest:
        validation_messages.append(
            "staged returned project digest "
            f"{staged_digest} does not match archive digest {returned_digest}"
        )
        status = INVALID
        shutil.rmtree(project_dir, ignore_errors=True)
        report_json, report_markdown = _write_check_reports(
            stage_dir,
            status=status,
            base_digest=current_digest,
            returned_digest=returned_digest,
            returned_base_digest=returned_base_digest,
            validation_messages=validation_messages,
            semantic_diff_report=semantic_diff_report,
            source_hashes=source_hashes,
            validation_reports=validation_reports,
        )
        return HandoffCheckResult(
            status=status,
            stage_dir=stage_dir,
            base_digest=current_digest,
            returned_digest=returned_digest,
            semantic_diff=semantic_diff_report,
            report_json=report_json,
            report_markdown=report_markdown,
        )

    _install_canonical_validation_policy(staged_project)
    source_hashes = _source_file_hashes(staged_project)

    baseline_validation = _call_validator(validator, canonical_project, runner)
    returned_validation = _call_validator(validator, staged_project, runner)
    validation_reports = dict(getattr(returned_validation, "reports", {}) or {})
    validation_messages.extend(
        str(item) for item in getattr(returned_validation, "messages", ())
    )
    semantic_diff_report = _semantic_diff_report(
        getattr(baseline_validation, "inventory", None),
        getattr(returned_validation, "inventory", None),
    )
    status = str(getattr(returned_validation, "status", INVALID))
    if status not in _CHECK_EXIT_CODES:
        status = INVALID

    if status == INVALID:
        shutil.rmtree(staged_project, ignore_errors=True)

    report_json, report_markdown = _write_check_reports(
        stage_dir,
        status=status,
        base_digest=current_digest,
        returned_digest=returned_digest,
        returned_base_digest=returned_base_digest,
        validation_messages=validation_messages,
        semantic_diff_report=semantic_diff_report,
        source_hashes=source_hashes,
        validation_reports=validation_reports,
    )
    return HandoffCheckResult(
        status=status,
        stage_dir=stage_dir,
        base_digest=current_digest,
        returned_digest=returned_digest,
        semantic_diff=semantic_diff_report,
        report_json=report_json,
        report_markdown=report_markdown,
    )


def _editable_repo_pathspecs() -> tuple[str, ...]:
    specs = [
        f"{_ELECTRONICS_REPO_PREFIX}/{name}" for name in EDITABLE_PROJECT_FILES
    ]
    specs.extend(
        f"{_ELECTRONICS_REPO_PREFIX}/{directory_name}/"
        for directory_name in EDITABLE_PROJECT_DIRS
    )
    return tuple(specs)


def _git_run(repo_root: Path, *arguments: str) -> str:
    try:
        result = subprocess.run(
            ("git", *arguments),
            cwd=repo_root,
            text=True,
            capture_output=True,
            check=False,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise HandoffInvalid("cannot read Git repository state") from error
    if result.returncode != 0:
        raise HandoffInvalid("cannot read Git repository state")
    return result.stdout.strip()


def _git_current_branch(repo_root: Path) -> str:
    branch = _git_run(repo_root, "branch", "--show-current")
    if not branch:
        raise HandoffInvalid("handoff acceptance requires a named Git branch")
    return branch


def _require_accept_branch(branch_name: str) -> None:
    normalized = branch_name.strip()
    if normalized in _PROTECTED_ACCEPT_BRANCHES:
        raise HandoffInvalid(
            f"handoff acceptance is not allowed on protected branch {normalized!r}"
        )


def _git_has_editable_changes(repo_root: Path) -> bool:
    output = _git_run(
        repo_root,
        "status",
        "--porcelain",
        "--",
        *_editable_repo_pathspecs(),
    )
    return bool(output)


def _load_check_report(stage_dir: Path) -> dict[str, object]:
    report_path = stage_dir / "report.json"
    if not report_path.is_file():
        raise HandoffInvalid("staged handoff report is missing")
    try:
        payload = json.loads(report_path.read_bytes())
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise HandoffInvalid("staged handoff report is invalid JSON") from error
    if not isinstance(payload, Mapping):
        raise HandoffInvalid("staged handoff report must be a JSON object")
    return dict(payload)


def _report_digest(report: Mapping[str, object], field: str) -> str:
    value = report.get(field)
    if not isinstance(value, str) or _DIGEST_PATTERN.fullmatch(value) is None:
        raise HandoffInvalid(f"staged handoff report has an invalid {field}")
    return value


def _report_status(report: Mapping[str, object]) -> str:
    value = report.get("status")
    if not isinstance(value, str) or not value:
        raise HandoffInvalid("staged handoff report is missing status")
    return value


def _report_source_hashes(report: Mapping[str, object]) -> dict[str, str]:
    raw = report.get("sourceFileHashes")
    if not isinstance(raw, Mapping):
        raise HandoffInvalid("staged handoff report is missing sourceFileHashes")
    hashes: dict[str, str] = {}
    for relative, digest in raw.items():
        if not isinstance(relative, str) or not relative:
            raise HandoffInvalid("staged handoff report has an invalid source path")
        if not isinstance(digest, str) or _DIGEST_PATTERN.fullmatch(digest) is None:
            raise HandoffInvalid(
                f"staged handoff report has an invalid source hash for {relative}"
            )
        hashes[relative] = digest
    return hashes


def _require_staged_source_hashes(project: Path, expected: Mapping[str, str]) -> None:
    for relative, digest in sorted(expected.items()):
        path = project / relative
        if not path.is_file():
            raise HandoffInvalid(
                f"staged returned project is missing checked source file: {relative}"
            )
        _, actual = _regular_fingerprint(path, "staged returned project source")
        if actual != digest:
            raise HandoffInvalid(
                f"staged returned project source changed since check: {relative}"
            )


def _promotion_plan(
    staged_project: Path,
    canonical_project: Path,
) -> tuple[list[str], list[str]]:
    staged_sources = {
        path.relative_to(staged_project).as_posix(): path
        for path in editable_project_files(staged_project)
    }
    canonical_sources = {
        path.relative_to(canonical_project).as_posix(): path
        for path in editable_project_files(canonical_project)
    }
    retained = sorted(
        relative for relative in canonical_sources if relative not in staged_sources
    )
    changed: list[str] = []
    for relative, staged_path in sorted(staged_sources.items()):
        canonical_path = canonical_project / relative
        _, staged_hash = _regular_fingerprint(staged_path, "staged returned project source")
        if canonical_path.is_file():
            _, canonical_hash = _regular_fingerprint(
                canonical_path, "canonical project source"
            )
            if staged_hash == canonical_hash:
                continue
        changed.append(relative)
    return changed, retained


def _replace_promoted_file(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(
        f".handoff-accept-{uuid.uuid4().hex}.tmp"
    )
    if temporary.exists():
        raise HandoffInvalid("handoff acceptance temporary file already exists")
    try:
        _snapshot_regular(source, temporary, f"accepted project source {source.name}")
        os.replace(temporary, destination)
        parent_descriptor = os.open(destination.parent, os.O_RDONLY)
        try:
            os.fsync(parent_descriptor)
        finally:
            os.close(parent_descriptor)
    finally:
        if temporary.exists():
            try:
                temporary.unlink()
            except OSError:
                pass


def accept_stage(
    stage_dir: str | Path,
    repo_root: str | Path,
    *,
    branch_name: str | None = None,
) -> HandoffAcceptResult:
    """Promote a previously checked staged handoff into the canonical project."""

    stage = _resolved_directory(stage_dir, "staged handoff directory")
    repository = _resolved_directory(repo_root, "repository root")
    canonical_project = _resolved_directory(ELECTRONICS_DIR, "canonical project")
    staged_project = stage / "project"
    if not staged_project.is_dir():
        raise HandoffInvalid("staged returned project is missing")

    branch = branch_name if branch_name is not None else _git_current_branch(repository)
    _require_accept_branch(branch)

    report = _load_check_report(stage)
    status = _report_status(report)
    if status not in _ACCEPTABLE_CHECK_STATUSES:
        raise HandoffInvalid(
            f"staged handoff status {status!r} is not acceptable for promotion"
        )

    base_digest = _report_digest(report, "baseProjectDigest")
    returned_digest = _report_digest(report, "returnedProjectDigest")
    current_digest = _handoff_project_digest(canonical_project)
    if current_digest != base_digest:
        raise HandoffInvalid(
            "canonical project digest changed since the staged handoff was checked"
        )

    staged_digest = _handoff_project_digest(staged_project)
    if staged_digest != returned_digest:
        raise HandoffInvalid(
            "staged returned project digest does not match the checked report"
        )

    if _git_has_editable_changes(repository):
        raise HandoffInvalid(
            "canonical editable project paths have uncommitted Git changes"
        )

    expected_hashes = _report_source_hashes(report)
    _require_staged_source_hashes(staged_project, expected_hashes)
    _editable_sources(staged_project)

    changed, retained = _promotion_plan(staged_project, canonical_project)
    pending: list[tuple[Path, Path]] = []
    for relative in changed:
        source = staged_project / relative
        destination = canonical_project / relative
        pending.append((source, destination))

    for source, destination in pending:
        _, staged_hash = _regular_fingerprint(source, "staged returned project source")
        expected = expected_hashes.get(source.relative_to(staged_project).as_posix())
        if expected is not None and staged_hash != expected:
            raise HandoffInvalid(
                f"staged returned project source changed before promotion: {source.name}"
            )

    for source, destination in pending:
        _replace_promoted_file(source, destination)

    final_digest = _handoff_project_digest(canonical_project)
    if final_digest != returned_digest:
        raise HandoffInvalid(
            "canonical project digest does not match the accepted returned digest"
        )

    if status == MECHANICAL_REVIEW_REQUIRED:
        print(
            "NOTE: case and release targets remain blocked until mechanical review "
            "is reconciled."
        )

    return HandoffAcceptResult(
        changed=tuple(changed),
        retained=tuple(retained),
        returned_digest=returned_digest,
        status=status,
    )


def _print_accept_summary(
    result_paths: Sequence[str],
    *,
    retained: Sequence[str],
    returned_digest: str,
    status: str,
) -> None:
    if result_paths:
        print("Accepted canonical project changes:")
        for relative in sorted(result_paths):
            print(f"  changed: {relative}")
    else:
        print("Accepted canonical project with no editable source changes.")
    if retained:
        print("Retained canonical project files absent from the returned handoff:")
        for relative in sorted(retained):
            print(f"  retained: {relative}")
    print(f"Canonical project digest: {returned_digest}")
    print(f"Checked status: {status}")
    print("")
    print("Next:")
    print("  git diff -- hardware/pocket_card/electronics/")
    print("  git add hardware/pocket_card/electronics/")
    print("  git commit -m \"Promote checked Pocket Card engineer handoff\"")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    export_parser = subparsers.add_parser("export", help="create an outgoing engineer ZIP")
    export_parser.add_argument("--include-blend", action="store_true")
    export_parser.add_argument(
        "--output-dir", type=Path, default=HANDOFF_BUILD_DIR / "outgoing"
    )
    check_parser = subparsers.add_parser(
        "check", help="stage and review a returned engineer ZIP"
    )
    check_parser.add_argument("--zip", type=Path, required=True)
    accept_parser = subparsers.add_parser(
        "accept", help="promote a previously checked staged handoff"
    )
    accept_parser.add_argument("--staged", type=Path, required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "export":
            archive = export_handoff(
                include_blend=args.include_blend,
                output_dir=args.output_dir,
            )
            print(str(archive.resolve(strict=True)))
            return 0
        if args.command == "check":
            result = check_returned_zip(
                args.zip,
                _repository_root(ELECTRONICS_DIR),
            )
            print(str(result.stage_dir.resolve(strict=True)))
            return _CHECK_EXIT_CODES[result.status]
        if args.command == "accept":
            repository = _repository_root(ELECTRONICS_DIR)
            result = accept_stage(args.staged, repository)
            _print_accept_summary(
                result.changed,
                retained=result.retained,
                returned_digest=result.returned_digest,
                status=result.status,
            )
            return 0
        raise HandoffError(f"unsupported command {args.command!r}")
    except HandoffInvalid as error:
        diagnostic = _bounded_stream(_sanitize_diagnostic(error))[:8192]
        print(f"ERROR: {diagnostic}")
        return 1
    except (HandoffError, OSError, RuntimeError, UnicodeError, ValueError, ValidationError) as error:
        diagnostic = _bounded_stream(_sanitize_diagnostic(error))[:8192]
        print(f"ERROR: {diagnostic}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
