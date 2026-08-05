"""Deterministic, validation-gated Pocket Card engineer handoffs."""

from __future__ import annotations

import argparse
import datetime as _datetime
import inspect
import json
import os
import re
import stat
import subprocess
import uuid
import zipfile
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path, PurePosixPath

from .exports import require_current_exports
from .inventory import editable_project_files, inventory_json, project_digest
from .paths import (
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
    validate_project,
)


_ARCHIVE_ROOT = "pocket-card-controller"
_HANDOFF_SCHEMA_VERSION = 1
_HANDOFF_TOOL_VERSION = "1"
_DIGEST_PATTERN = re.compile(r"[0-9a-f]{64}")
_COMMIT_PATTERN = re.compile(r"[0-9a-f]{40,64}")
_POLICY_NAMES = ("mechanical_contract.json", "validation_waivers.json")
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
_UTC = _datetime.timezone.utc

_Validator = Callable[..., object]
_CurrentExportsChecker = Callable[[Path, Path], object]
_GitMetadataProvider = Callable[[Path], tuple[str, int]]


class HandoffError(RuntimeError):
    """An expected outgoing-handoff safety or input failure."""


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


def _read_regular_bytes(path: Path, label: str) -> bytes:
    """Read one no-follow regular file and reject replacement while it is open."""

    try:
        descriptor = os.open(path, os.O_RDONLY | _NOFOLLOW)
    except OSError as error:
        raise HandoffError(f"{label} is missing or unsafe: {path.name}") from error
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_size < 1:
            raise HandoffError(f"{label} must be a nonempty regular file: {path.name}")
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


def _load_export_metadata(export_dir: Path, expected_digest: str) -> dict[str, str]:
    raw = json.loads(
        _read_regular_bytes(
            export_dir / "source_manifest.json", "verified export manifest"
        ).decode("utf-8"),
        object_pairs_hook=_duplicate_rejecting_object,
        parse_constant=_reject_json_constant,
    )
    if not isinstance(raw, Mapping):
        raise HandoffError("verified export manifest must be a JSON object")
    digest = raw.get("projectDigest")
    kicad_version = raw.get("kicadVersion")
    if (
        raw.get("schemaVersion") != 1
        or raw.get("projectName") != PROJECT_NAME
        or not isinstance(digest, str)
        or _DIGEST_PATTERN.fullmatch(digest) is None
        or digest != expected_digest
        or not isinstance(kicad_version, str)
        or not kicad_version.strip()
        or kicad_version != kicad_version.strip()
        or any(ord(character) < 32 for character in kicad_version)
    ):
        raise HandoffError("verified export manifest metadata is invalid or stale")
    return {"projectDigest": digest, "kicadVersion": kicad_version}


def _require_project_sources(project: Path) -> None:
    for name in _REQUIRED_PROJECT_SOURCES:
        _read_regular_bytes(project / name, "required editable project source")


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


def _write_archive(
    stream: object,
    entries: Mapping[str, bytes],
    timestamp: tuple[int, int, int, int, int, int],
) -> None:
    with zipfile.ZipFile(
        stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
    ) as archive:
        archive.comment = b""
        for name in sorted(entries):
            archive.writestr(_archive_info(name, timestamp), entries[name])


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


def _unlink_owned_temp_at(directory: int, name: str, token: tuple[int, int]) -> None:
    try:
        information = os.stat(name, dir_fd=directory, follow_symlinks=False)
    except OSError:
        return
    if stat.S_ISREG(information.st_mode) and (
        information.st_dev,
        information.st_ino,
    ) == token:
        try:
            os.unlink(name, dir_fd=directory)
        except OSError:
            pass


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
) -> Path:
    """Validate and atomically publish one reproducible outgoing handoff ZIP."""

    project = _resolved_directory(project_dir, "canonical project")
    exports = _resolved_directory(export_dir, "verified PCB export tree")
    source_digest_before = project_digest(project)
    validation_result = _call_validator(validator, project, runner)
    status = getattr(validation_result, "status", None)
    if status != PASS:
        messages = "; ".join(str(item) for item in getattr(validation_result, "messages", ()))
        suffix = f": {messages[:4096]}" if messages else ""
        if status == MECHANICAL_REVIEW_REQUIRED:
            raise HandoffError(f"outgoing handoff requires baseline PASS; got {status}{suffix}")
        raise HandoffError(f"outgoing handoff validation failed with {status!r}{suffix}")
    if project_digest(project) != source_digest_before:
        raise HandoffError("canonical project changed during handoff validation")

    _require_project_sources(project)
    _require_current_exports(current_exports_checker, project, exports)
    manifest = _load_export_metadata(exports, source_digest_before)

    source_entries: dict[str, bytes] = {}
    for source in editable_project_files(project):
        relative = source.relative_to(project).as_posix()
        source_entries[f"{_ARCHIVE_ROOT}/project/{relative}"] = _read_regular_bytes(
            source, "editable project source"
        )

    policy_bytes = {
        name: _read_regular_bytes(project / name, "canonical validation policy")
        for name in _POLICY_NAMES
    }
    reference_entries = {
        f"{_ARCHIVE_ROOT}/reference/{target}": _read_regular_bytes(
            exports / source, "verified export reference"
        )
        for target, source in _EXPORT_REFERENCES.items()
    }
    contract_raw = json.loads(
        policy_bytes["mechanical_contract.json"].decode("utf-8"),
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
    reference_entries[f"{_ARCHIVE_ROOT}/reference/mechanical_contract.json"] = policy_bytes[
        "mechanical_contract.json"
    ]
    reference_entries[f"{_ARCHIVE_ROOT}/reference/validation_waivers.json"] = policy_bytes[
        "validation_waivers.json"
    ]
    reference_entries[f"{_ARCHIVE_ROOT}/reference/inventory.json"] = _json_bytes(inventory)
    reference_entries[f"{_ARCHIVE_ROOT}/reference/semantic-summary.md"] = _semantic_summary(
        inventory, contract_raw, source_digest_before
    )

    blend_snapshot: bytes | None = None
    blend_source: Path | None = None
    if include_blend:
        blend_source = Path(blend_path).expanduser()
        blend_snapshot = _read_regular_bytes(blend_source, "Blender visual reference")
        reference_entries[
            f"{_ARCHIVE_ROOT}/reference/pocket_card_complete.blend"
        ] = blend_snapshot

    repo_root = _repository_root(project) if git_metadata_provider is _git_metadata else project
    git_commit, commit_epoch = git_metadata_provider(repo_root)
    if _COMMIT_PATTERN.fullmatch(git_commit) is None or isinstance(commit_epoch, bool) or not isinstance(commit_epoch, int):
        raise HandoffError("Git handoff provenance is malformed")
    epoch = _source_epoch(source_date_epoch, commit_epoch)
    metadata = {
        "schemaVersion": _HANDOFF_SCHEMA_VERSION,
        "projectName": PROJECT_NAME,
        "baseProjectDigest": source_digest_before,
        "gitCommit": git_commit,
        "createdAt": _created_at(epoch),
        "kicadVersion": manifest["kicadVersion"],
        "toolVersions": {"handoffPipeline": _HANDOFF_TOOL_VERSION},
    }
    entries = {
        **source_entries,
        **reference_entries,
        f"{_ARCHIVE_ROOT}/HANDOFF.md": _handoff_instructions(include_blend),
        f"{_ARCHIVE_ROOT}/handoff.json": _json_bytes(metadata),
    }
    if not entries or any(not name.startswith(f"{_ARCHIVE_ROOT}/") for name in entries):
        raise HandoffError("handoff archive layout is invalid")
    archive_timestamp = _zip_timestamp(epoch)
    for name in entries:
        _archive_info(name, archive_timestamp)

    _require_current_exports(current_exports_checker, project, exports)
    if project_digest(project) != source_digest_before:
        raise HandoffError("canonical project changed while assembling handoff")
    for name, original in policy_bytes.items():
        if _read_regular_bytes(project / name, "canonical validation policy") != original:
            raise HandoffError("canonical validation policy changed while assembling handoff")

    output = _prepare_output_directory(output_dir, project, exports)
    filename = (
        "pocket-card-controller-with-blender.zip"
        if include_blend
        else "pocket-card-controller.zip"
    )
    destination = output / filename
    directory_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | _NOFOLLOW
    try:
        directory_descriptor = os.open(output, directory_flags)
    except OSError as error:
        raise HandoffError("cannot safely open handoff output directory") from error
    directory_information = os.fstat(directory_descriptor)
    directory_token = (
        directory_information.st_dev,
        directory_information.st_ino,
    )
    temp_name: str | None = None
    temp_token: tuple[int, int] | None = None
    try:
        _require_output_identity(output, directory_token)
        _destination_is_safe_at(directory_descriptor, filename)
        for _ in range(10):
            candidate = f".{filename}.{uuid.uuid4().hex}.tmp"
            try:
                temporary_descriptor = os.open(
                    candidate,
                    os.O_RDWR | os.O_CREAT | os.O_EXCL | _NOFOLLOW,
                    0o600,
                    dir_fd=directory_descriptor,
                )
            except FileExistsError:
                continue
            temp_name = candidate
            information = os.fstat(temporary_descriptor)
            temp_token = (information.st_dev, information.st_ino)
            break
        else:
            raise HandoffError("cannot allocate a unique temporary handoff file")
        try:
            temporary_stream = os.fdopen(temporary_descriptor, "w+b")
        except Exception:
            os.close(temporary_descriptor)
            raise
        with temporary_stream as temporary:
            _write_archive(temporary, entries, archive_timestamp)
            temporary.flush()
            os.fsync(temporary.fileno())
            os.fchmod(temporary.fileno(), 0o644)

        if before_publish is not None:
            before_publish()
        _require_output_identity(output, directory_token)
        _require_current_exports(current_exports_checker, project, exports)
        if project_digest(project) != source_digest_before:
            raise HandoffError("canonical project changed before handoff publication")
        for name, original in policy_bytes.items():
            if _read_regular_bytes(project / name, "canonical validation policy") != original:
                raise HandoffError("canonical validation policy changed before handoff publication")
        if blend_source is not None and _read_regular_bytes(
            blend_source, "Blender visual reference"
        ) != blend_snapshot:
            raise HandoffError("Blender visual reference changed before handoff publication")
        final_commit, _ = git_metadata_provider(repo_root)
        if final_commit != git_commit:
            raise HandoffError("Git HEAD changed before handoff publication")
        assert temp_name is not None and temp_token is not None
        _require_owned_temp(directory_descriptor, temp_name, temp_token)
        _destination_is_safe_at(directory_descriptor, filename)
        os.replace(
            temp_name,
            filename,
            src_dir_fd=directory_descriptor,
            dst_dir_fd=directory_descriptor,
        )
        temp_name = None
        os.fsync(directory_descriptor)
    except Exception:
        if temp_name is not None and temp_token is not None:
            _unlink_owned_temp_at(directory_descriptor, temp_name, temp_token)
        raise
    finally:
        os.close(directory_descriptor)
    return destination.resolve(strict=True)


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
        print(f"ERROR: {str(error)[:8192]}")
        return 1
    print(str(archive.resolve(strict=True)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
