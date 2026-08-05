"""Deterministic, validation-gated Pocket Card engineer handoffs."""

from __future__ import annotations

import argparse
import datetime as _datetime
import hashlib
import inspect
import json
import os
import re
import stat
import subprocess
import tempfile
import uuid
import zipfile
from collections.abc import Callable, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from .exports import _load_manifest, require_current_exports
from .inventory import editable_project_files, inventory_json
from .paths import (
    EDITABLE_PROJECT_DIRS,
    ELECTRONICS_DIR,
    HANDOFF_BUILD_DIR,
    PCB_OUTPUT_DIR,
    POCKET_CARD_DIR,
    PROJECT_NAME,
)
from .validation import (
    MECHANICAL_REVIEW_REQUIRED,
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
_DIGEST_PATTERN = re.compile(r"[0-9a-f]{64}")
_COMMIT_PATTERN = re.compile(r"[0-9a-f]{40,64}")
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


def _write_publication_journal(
    directory: int,
    filename: str,
    temp_name: str,
    temp_token: tuple[int, int],
    directory_token: tuple[int, int],
) -> tuple[int, int]:
    name = _journal_name(filename)
    content = _json_bytes(
        {
            "schemaVersion": 1,
            "tempName": temp_name,
            "tempDevice": temp_token[0],
            "tempInode": temp_token[1],
            "outputDevice": directory_token[0],
            "outputInode": directory_token[1],
        }
    )
    try:
        descriptor = os.open(
            name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | _NOFOLLOW | _NONBLOCK,
            0o600,
            dir_fd=directory,
        )
    except OSError as error:
        raise HandoffError("handoff publication journal is missing or unsafe") from error
    try:
        information = os.fstat(descriptor)
        token = information.st_dev, information.st_ino
        _write_all(descriptor, content)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.fsync(directory)
    return token


def _read_publication_journal(
    directory: int, filename: str, directory_token: tuple[int, int]
) -> tuple[dict[str, object], tuple[int, int]] | None:
    name = _journal_name(filename)
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
        "tempName",
        "tempDevice",
        "tempInode",
        "outputDevice",
        "outputInode",
    }
    if not isinstance(raw, Mapping) or set(raw) != expected_keys:
        raise HandoffError("handoff publication journal has an invalid schema")
    temp_name = raw.get("tempName")
    integer_values = tuple(
        raw.get(key)
        for key in ("tempDevice", "tempInode", "outputDevice", "outputInode")
    )
    pattern = re.compile(
        re.escape(f".{filename}.") + r"[0-9a-f]{32}\.tmp"
    )
    if (
        raw.get("schemaVersion") != 1
        or not isinstance(temp_name, str)
        or pattern.fullmatch(temp_name) is None
        or any(type(value) is not int or value < 1 for value in integer_values)
        or tuple(integer_values[2:]) != directory_token
    ):
        raise HandoffError("handoff publication journal has invalid ownership data")
    return dict(raw), token


def _remove_publication_journal(
    directory: int, filename: str, token: tuple[int, int]
) -> None:
    name = _journal_name(filename)
    _require_named_token(directory, name, token, "handoff publication journal")
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


def _recover_publication(
    directory: int,
    filename: str,
    directory_token: tuple[int, int],
) -> None:
    loaded = _read_publication_journal(directory, filename, directory_token)
    if loaded is None:
        return
    journal, journal_token = loaded
    temp_name = str(journal["tempName"])
    expected = int(journal["tempDevice"]), int(journal["tempInode"])
    temp_token = _optional_entry_token(directory, temp_name)
    destination_token = _optional_entry_token(directory, filename)
    if temp_token is not None and temp_token != expected:
        raise HandoffError(
            "handoff temporary snapshot ownership mismatch; possible substitution"
        )
    if destination_token == expected and temp_token == expected:
        raise HandoffError("handoff publication ownership is ambiguous")
    if temp_token == expected:
        os.unlink(temp_name, dir_fd=directory)
    _remove_publication_journal(directory, filename, journal_token)
    os.fsync(directory)


def _cleanup_precommit(
    directory: int,
    filename: str,
    temp_name: str | None,
    temp_token: tuple[int, int] | None,
    journal_token: tuple[int, int] | None,
) -> None:
    if temp_name is not None and temp_token is not None:
        try:
            observed = _optional_entry_token(directory, temp_name)
        except HandoffError:
            return
        if observed == temp_token:
            os.unlink(temp_name, dir_fd=directory)
        elif observed is not None:
            return
    if journal_token is not None:
        try:
            _remove_publication_journal(directory, filename, journal_token)
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
    destination = output / filename
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | _NOFOLLOW
    try:
        directory = os.open(output, flags)
    except OSError as error:
        raise HandoffError("cannot safely open handoff output directory") from error
    information = os.fstat(directory)
    directory_token = information.st_dev, information.st_ino
    try:
        with _handoff_publication_lock(directory, filename) as (lock_name, lock_token):
            _require_output_identity(output, directory_token)
            _recover_publication(directory, filename, directory_token)
            _destination_is_safe_at(directory, filename)
            temp_name: str | None = None
            temp_token: tuple[int, int] | None = None
            journal_token: tuple[int, int] | None = None
            temporary_descriptor: int | None = None
            committed = False
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
                _require_owned_temp(directory, temp_name, temp_token)
                _destination_is_safe_at(directory, filename)
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
                except OSError as error:
                    raise HandoffError(
                        "handoff publication committed; durability unknown"
                    ) from error
                _remove_publication_journal(directory, filename, journal_token)
                journal_token = None
                try:
                    os.fsync(directory)
                except OSError as error:
                    raise HandoffError(
                        "handoff publication committed; durability unknown"
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
                        journal_token,
                    )
                raise
    finally:
        os.close(directory)
    return destination.resolve(strict=True)


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

        policy_snapshots: dict[str, tuple[Path, int, str]] = {}
        for name in _POLICY_DIGEST_NAMES:
            destination = snapshot_root / f"policy-{name}"
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


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    export_parser = subparsers.add_parser("export", help="create an outgoing engineer ZIP")
    export_parser.add_argument("--include-blend", action="store_true")
    export_parser.add_argument(
        "--output-dir", type=Path, default=HANDOFF_BUILD_DIR / "outgoing"
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command != "export":
            raise HandoffError(f"unsupported command {args.command!r}")
        archive = export_handoff(
            include_blend=args.include_blend,
            output_dir=args.output_dir,
        )
    except (HandoffError, OSError, RuntimeError, UnicodeError, ValueError, ValidationError) as error:
        diagnostic = _bounded_stream(_sanitize_diagnostic(error))[:8192]
        print(f"ERROR: {diagnostic}")
        return 1
    print(str(archive.resolve(strict=True)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
