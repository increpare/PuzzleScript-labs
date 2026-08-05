"""Read-only, transactional fabrication exports for the Pocket Card PCB."""

from __future__ import annotations

import argparse
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

try:
    import fcntl as _fcntl
except ImportError:  # Windows has no POSIX advisory-locking module.
    _fcntl = None

from .inventory import (
    KICAD_EXPORT_TIMEOUT_SECONDS,
    KICAD_VERSION_TIMEOUT_SECONDS,
    _version_tuple,
    editable_project_files,
    project_digest,
)
from .paths import ELECTRONICS_DIR, PCB_OUTPUT_DIR, PROJECT_NAME
from .validation import (
    PASS,
    ValidationError,
    _bounded_stream,
    _duplicate_rejecting_object,
    _find_kicad_cli,
    _reject_json_constant,
    _run,
    _sanitize_diagnostic,
    validate_project,
)


_Runner = Callable[..., object]
_Validator = Callable[..., object]
_DIGEST_PATTERN = re.compile(r"[0-9a-f]{64}")
_TRANSACTION_ID_PATTERN = re.compile(r"[0-9a-f]{32}")
_MANIFEST_NAME = "source_manifest.json"
_REQUIRED_CURRENT_ERROR = (
    "PCB export is missing or stale; run make pocket_card_pcb_exports"
)
_VALIDATION_FILENAMES = ("erc.json", "drc.json", "validation.json")
_PIPELINE_DIR = Path(__file__).resolve().parent
_CASE_DIR = _PIPELINE_DIR.parent / "case"
_EXPORT_RECIPE_INPUTS = (
    ("hardware/pocket_card/electronics_pipeline/exports.py", _PIPELINE_DIR / "exports.py"),
    ("hardware/pocket_card/electronics_pipeline/validation.py", _PIPELINE_DIR / "validation.py"),
    ("hardware/pocket_card/electronics_pipeline/inventory.py", _PIPELINE_DIR / "inventory.py"),
    ("hardware/pocket_card/electronics_pipeline/mechanics.py", _PIPELINE_DIR / "mechanics.py"),
    ("hardware/pocket_card/electronics_pipeline/kicad_sexpr.py", _PIPELINE_DIR / "kicad_sexpr.py"),
    ("hardware/pocket_card/electronics_pipeline/paths.py", _PIPELINE_DIR / "paths.py"),
    ("hardware/pocket_card/case/export_smt.py", _CASE_DIR / "export_smt.py"),
    ("hardware/pocket_card/case/params.py", _CASE_DIR / "params.py"),
)
_POLICY_FILENAMES = (
    "toolchain.json",
    "mechanical_contract.json",
    "validation_waivers.json",
)
_GERBER_SUFFIXES = frozenset(
    {
        ".gbr",
        ".gbrjob",
        ".gtl",
        ".gbl",
        ".gto",
        ".gbo",
        ".gts",
        ".gbs",
        ".gtp",
        ".gbp",
        ".gta",
        ".gba",
        ".gm1",
        ".gko",
    }
)
_REQUIRED_ARTIFACTS = frozenset(
    {
        "BOM.csv",
        "BOM_JLCPCB.csv",
        "CPL.csv",
        "drc.json",
        "erc.json",
        "exported.step",
        "exported.stl",
        f"{PROJECT_NAME}-all-pos.csv",
        f"{PROJECT_NAME}.pdf",
        f"{PROJECT_NAME}.step",
        f"{PROJECT_NAME}.stl",
        f"{PROJECT_NAME}_gerbers.zip",
        "validation.json",
    }
)


@dataclass(frozen=True)
class ExportResult:
    project_digest: str
    output_dir: Path
    step_path: Path
    stl_path: Path
    schematic_pdf_path: Path
    gerber_zip_path: Path
    manifest_path: Path


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _digest_labeled_inputs(
    inputs: Sequence[tuple[str, Path]], context: str
) -> str:
    digest = hashlib.sha256()
    for label, path in sorted(inputs, key=lambda item: item[0]):
        safe_label = _safe_relative_path(label)
        try:
            information = path.stat(follow_symlinks=False)
        except OSError as error:
            raise ValueError(f"{context} input is unavailable: {safe_label}") from error
        if not stat.S_ISREG(information.st_mode) or information.st_size == 0:
            raise ValueError(f"{context} input is empty or unsafe: {safe_label}")
        digest.update(safe_label.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _policy_digest(project_dir: Path) -> str:
    return _digest_labeled_inputs(
        tuple((name, project_dir / name) for name in _POLICY_FILENAMES),
        "policy",
    )


def _export_recipe_digest() -> str:
    return _digest_labeled_inputs(_EXPORT_RECIPE_INPUTS, "export recipe")


def _json_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
        + "\n"
    ).encode("utf-8")


def _write_new_bytes(path: Path, content: bytes) -> None:
    with path.open("xb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


def _write_json(path: Path, value: object) -> None:
    _write_new_bytes(path, _json_bytes(value))


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _fsync_tree(root: Path) -> None:
    directories = [root]
    for path in sorted(root.rglob("*")):
        information = path.stat(follow_symlinks=False)
        if stat.S_ISLNK(information.st_mode):
            raise OSError(f"export tree contains a symlink: {path.name}")
        if stat.S_ISDIR(information.st_mode):
            directories.append(path)
        elif stat.S_ISREG(information.st_mode):
            descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        else:
            raise OSError(f"export tree contains a non-regular entry: {path.name}")
    for directory in sorted(directories, key=lambda item: len(item.parts), reverse=True):
        _fsync_directory(directory)


def _safe_relative_path(value: object) -> str:
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ValueError("artifact path must be a nonempty POSIX relative path")
    path = PurePosixPath(value)
    if path.is_absolute() or value != path.as_posix() or any(
        part in ("", ".", "..") for part in path.parts
    ):
        raise ValueError("artifact path must be a safe normalized relative path")
    if value == _MANIFEST_NAME:
        raise ValueError("manifest cannot hash itself")
    return value


def _read_json(path: Path) -> object:
    if path.is_symlink() or not path.is_file():
        raise ValueError("manifest must be a no-follow regular file")
    return json.loads(
        path.read_text(encoding="utf-8"),
        object_pairs_hook=_duplicate_rejecting_object,
        parse_constant=_reject_json_constant,
    )


def _load_toolchain(project_dir: Path) -> tuple[str, int, str]:
    path = project_dir / "toolchain.json"
    raw = _read_json(path)
    if not isinstance(raw, Mapping) or set(raw) != {
        "schemaVersion",
        "project",
        "kicad",
    }:
        raise ValueError("toolchain policy has an invalid schema")
    kicad = raw.get("kicad")
    project = raw.get("project")
    if (
        type(raw.get("schemaVersion")) is not int
        or raw.get("schemaVersion") != 1
        or not isinstance(project, str)
        or project != PROJECT_NAME
        or not isinstance(kicad, Mapping)
        or set(kicad) != {"major", "minimum"}
        or type(kicad.get("major")) is not int
        or not isinstance(kicad.get("minimum"), str)
    ):
        raise ValueError("toolchain policy has invalid Pocket Card metadata")
    minimum = str(kicad["minimum"])
    _version_tuple(minimum)
    return project, int(kicad["major"]), minimum


def _manifest_artifacts(root: Path) -> dict[str, dict[str, object]]:
    artifacts: dict[str, dict[str, object]] = {}
    for path in sorted(root.rglob("*"), key=lambda item: item.relative_to(root).as_posix()):
        information = path.stat(follow_symlinks=False)
        relative = path.relative_to(root).as_posix()
        if stat.S_ISLNK(information.st_mode):
            raise ValueError(f"export artifact is a symlink: {relative}")
        if stat.S_ISDIR(information.st_mode):
            continue
        if not stat.S_ISREG(information.st_mode):
            raise ValueError(f"export artifact is not regular: {relative}")
        if relative == _MANIFEST_NAME:
            continue
        if information.st_size == 0:
            raise ValueError(f"export artifact is empty: {relative}")
        artifacts[relative] = {
            "sha256": _sha256(path),
            "size": information.st_size,
        }
    return artifacts


def _load_manifest(path: Path) -> dict[str, object]:
    raw = _read_json(path)
    expected_keys = {
        "schemaVersion",
        "projectName",
        "projectDigest",
        "policyDigest",
        "exportRecipeDigest",
        "kicadVersion",
        "artifacts",
    }
    if not isinstance(raw, Mapping) or set(raw) != expected_keys:
        raise ValueError("export manifest has an invalid schema")
    if type(raw.get("schemaVersion")) is not int or raw.get("schemaVersion") != 1:
        raise ValueError("export manifest schemaVersion must be integer 1")
    if raw.get("projectName") != PROJECT_NAME:
        raise ValueError("export manifest has the wrong project name")
    digest = raw.get("projectDigest")
    policy_digest = raw.get("policyDigest")
    recipe_digest = raw.get("exportRecipeDigest")
    version = raw.get("kicadVersion")
    artifacts = raw.get("artifacts")
    if not isinstance(digest, str) or _DIGEST_PATTERN.fullmatch(digest) is None:
        raise ValueError("export manifest has an invalid project digest")
    if (
        not isinstance(policy_digest, str)
        or _DIGEST_PATTERN.fullmatch(policy_digest) is None
    ):
        raise ValueError("export manifest has an invalid policy digest")
    if (
        not isinstance(recipe_digest, str)
        or _DIGEST_PATTERN.fullmatch(recipe_digest) is None
    ):
        raise ValueError("export manifest has an invalid recipe digest")
    if (
        not isinstance(version, str)
        or not version
        or version != version.strip()
        or any(ord(character) < 32 for character in version)
    ):
        raise ValueError("export manifest has an invalid KiCad version")
    if not isinstance(artifacts, Mapping) or not artifacts:
        raise ValueError("export manifest artifacts must be a nonempty object")
    validated: dict[str, dict[str, object]] = {}
    for raw_relative, raw_metadata in artifacts.items():
        relative = _safe_relative_path(raw_relative)
        if not isinstance(raw_metadata, Mapping) or set(raw_metadata) != {
            "sha256",
            "size",
        }:
            raise ValueError(f"artifact metadata is invalid: {relative}")
        artifact_digest = raw_metadata.get("sha256")
        size = raw_metadata.get("size")
        if (
            not isinstance(artifact_digest, str)
            or _DIGEST_PATTERN.fullmatch(artifact_digest) is None
            or type(size) is not int
            or size < 1
        ):
            raise ValueError(f"artifact metadata is invalid: {relative}")
        validated[relative] = {"sha256": artifact_digest, "size": size}
    return {
        "schemaVersion": 1,
        "projectName": PROJECT_NAME,
        "projectDigest": digest,
        "policyDigest": policy_digest,
        "exportRecipeDigest": recipe_digest,
        "kicadVersion": version,
        "artifacts": dict(sorted(validated.items())),
    }


def _tree_entries(root: Path) -> tuple[set[str], set[str]]:
    files: set[str] = set()
    directories: set[str] = set()
    for path in sorted(root.rglob("*")):
        information = path.stat(follow_symlinks=False)
        relative = path.relative_to(root).as_posix()
        if stat.S_ISLNK(information.st_mode):
            raise ValueError(f"export tree contains a symlink: {relative}")
        if stat.S_ISDIR(information.st_mode):
            directories.add(relative)
        elif stat.S_ISREG(information.st_mode):
            files.add(relative)
        else:
            raise ValueError(f"export tree contains a non-regular entry: {relative}")
    return files, directories


def _verify_export_tree(
    root: Path,
    *,
    project_digest_value: str | None = None,
    policy_digest_value: str | None = None,
    recipe_digest_value: str | None = None,
    require_required_artifacts: bool = True,
) -> dict[str, object]:
    if root.is_symlink() or not root.is_dir():
        raise ValueError("export output must be a no-follow directory")
    manifest = _load_manifest(root / _MANIFEST_NAME)
    if project_digest_value is not None and manifest["projectDigest"] != project_digest_value:
        raise ValueError("export manifest project digest is stale")
    if policy_digest_value is not None and manifest["policyDigest"] != policy_digest_value:
        raise ValueError("export manifest policy digest is stale")
    if recipe_digest_value is not None and manifest["exportRecipeDigest"] != recipe_digest_value:
        raise ValueError("export manifest recipe digest is stale")
    artifacts = manifest["artifacts"]
    assert isinstance(artifacts, Mapping)
    files, directories = _tree_entries(root)
    expected_files = set(artifacts) | {_MANIFEST_NAME}
    if files != expected_files:
        raise ValueError("export artifact set does not exactly match the manifest")
    expected_directories = {
        parent.as_posix()
        for relative in artifacts
        for parent in PurePosixPath(relative).parents
        if parent.as_posix() != "."
    }
    if directories != expected_directories:
        raise ValueError("export directory set does not exactly match the manifest")
    if require_required_artifacts:
        if not _REQUIRED_ARTIFACTS.issubset(artifacts):
            raise ValueError("export manifest is missing a required artifact")
        gerbers = [relative for relative in artifacts if relative.startswith("gerber/")]
        if not gerbers:
            raise ValueError("export manifest contains no Gerber or drill files")
    for relative, metadata in artifacts.items():
        path = root.joinpath(*PurePosixPath(relative).parts)
        information = path.stat(follow_symlinks=False)
        if not stat.S_ISREG(information.st_mode):
            raise ValueError(f"export artifact is not regular: {relative}")
        if information.st_size != metadata["size"] or _sha256(path) != metadata["sha256"]:
            raise ValueError(f"export artifact hash or size mismatch: {relative}")
    if require_required_artifacts:
        _verify_fabrication_package(root, artifacts)
    return manifest


def exports_are_current(
    project_dir: str | Path = ELECTRONICS_DIR,
    output_dir: str | Path = PCB_OUTPUT_DIR,
) -> bool:
    try:
        raw_project = Path(project_dir).expanduser()
        raw_output = Path(output_dir).expanduser()
        if raw_project.is_symlink() or raw_output.is_symlink():
            return False
        project = raw_project.resolve(strict=True)
        output = raw_output.resolve(strict=True)
        project_name, expected_major, minimum = _load_toolchain(project)
        if project_name != PROJECT_NAME:
            return False
        digest = project_digest(project)
        manifest = _verify_export_tree(
            output,
            project_digest_value=digest,
            policy_digest_value=_policy_digest(project),
            recipe_digest_value=_export_recipe_digest(),
        )
        version = _version_tuple(str(manifest["kicadVersion"]))
        if version[0] != expected_major or version < _version_tuple(minimum):
            return False
        return True
    except (OSError, RuntimeError, UnicodeError, ValueError, json.JSONDecodeError):
        return False


def require_current_exports(
    project_dir: str | Path = ELECTRONICS_DIR,
    output_dir: str | Path = PCB_OUTPUT_DIR,
) -> None:
    if not exports_are_current(project_dir, output_dir):
        raise RuntimeError(_REQUIRED_CURRENT_ERROR)


def _copy_project(project_dir: Path, destination: Path) -> None:
    for source in editable_project_files(project_dir):
        relative = source.relative_to(project_dir)
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    for name in ("toolchain.json", "mechanical_contract.json", "validation_waivers.json"):
        source = project_dir / name
        if source.is_symlink() or not source.is_file():
            raise ValueError(f"required project metadata is missing or unsafe: {name}")
        shutil.copy2(source, destination / name)


def _call_validator(
    validator: _Validator,
    project_dir: Path,
    output_dir: Path,
    runner: _Runner,
) -> object:
    try:
        signature = inspect.signature(validator)
    except (TypeError, ValueError):
        signature = None
    accepts_runner = signature is None or "runner" in signature.parameters or any(
        parameter.kind == inspect.Parameter.VAR_KEYWORD
        for parameter in signature.parameters.values()
    )
    if accepts_runner:
        return validator(project_dir, output_dir=output_dir, runner=runner)
    return validator(project_dir, output_dir=output_dir)


def _require_regular_output(path: Path, label: str) -> None:
    try:
        information = path.stat(follow_symlinks=False)
    except OSError as error:
        raise RuntimeError(f"{label} did not produce {path.name}") from error
    if not stat.S_ISREG(information.st_mode) or information.st_size == 0:
        raise RuntimeError(f"{label} did not produce a nonempty regular {path.name}")


def _kicad_version(executable: str, runner: _Runner, cwd: Path) -> str:
    result = _run(
        runner,
        (executable, "--version"),
        cwd=cwd,
        timeout=KICAD_VERSION_TIMEOUT_SECONDS,
        label="KiCad export version probe",
    )
    version_text = _bounded_stream(
        getattr(result, "stdout", "") or getattr(result, "stderr", "")
    ).strip()
    _version_tuple(version_text)
    return version_text


def _fabrication_kind(path: Path) -> str | None:
    suffix = path.suffix.lower()
    if suffix == ".drl":
        return "drill"
    if suffix == ".gbrjob":
        return "metadata"
    if suffix in _GERBER_SUFFIXES or re.fullmatch(r"\.g(?:\d+|p\d+)", suffix):
        return "gerber"
    return None


def _verify_fabrication_package(
    root: Path, artifacts: Mapping[str, object]
) -> None:
    fabrication = sorted(
        relative
        for relative in artifacts
        if PurePosixPath(relative).parts[0] == "gerber"
    )
    kinds = [_fabrication_kind(Path(relative)) for relative in fabrication]
    if any(kind is None for kind in kinds):
        raise ValueError("export manifest contains an unrecognized fabrication file")
    if "gerber" not in kinds:
        raise ValueError("export manifest contains no substantive Gerber file")
    if "drill" not in kinds:
        raise ValueError("export manifest contains no Excellon .drl file")

    archive_path = root / f"{PROJECT_NAME}_gerbers.zip"
    try:
        with zipfile.ZipFile(archive_path) as archive:
            members = archive.infolist()
            names = [member.filename for member in members]
            if names != sorted(names) or len(names) != len(set(names)):
                raise ValueError("Gerber ZIP member names are not unique and sorted")
            for name in names:
                if _safe_relative_path(name) != name:
                    raise ValueError("Gerber ZIP contains an unsafe member")
            if names != fabrication:
                raise ValueError(
                    "Gerber ZIP does not exactly contain the fabrication artifacts"
                )
            for member in members:
                if member.is_dir() or member.file_size < 1:
                    raise ValueError("Gerber ZIP contains an empty or non-file member")
                direct_path = root.joinpath(*PurePosixPath(member.filename).parts)
                with archive.open(member) as stream:
                    archived_digest = hashlib.sha256()
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        archived_digest.update(chunk)
                if archived_digest.hexdigest() != _sha256(direct_path):
                    raise ValueError(
                        "Gerber ZIP member differs from its fabrication artifact"
                    )
    except zipfile.BadZipFile as error:
        raise ValueError("Gerber ZIP is invalid") from error


def _fabrication_files(gerber_dir: Path) -> list[tuple[str, Path, str]]:
    members: list[tuple[str, Path, str]] = []
    seen: set[str] = set()
    for path in sorted(gerber_dir.rglob("*"), key=lambda item: item.relative_to(gerber_dir).as_posix()):
        information = path.stat(follow_symlinks=False)
        if stat.S_ISLNK(information.st_mode):
            raise RuntimeError("Gerber export contains a symlink")
        if stat.S_ISDIR(information.st_mode):
            continue
        if not stat.S_ISREG(information.st_mode):
            raise RuntimeError("Gerber export contains a non-regular entry")
        if information.st_size == 0:
            raise RuntimeError("Gerber or drill export contains an empty file")
        relative = path.relative_to(gerber_dir).as_posix()
        archive_name = _safe_relative_path(f"gerber/{relative}")
        if archive_name in seen:
            raise RuntimeError(f"duplicate Gerber archive member: {archive_name}")
        kind = _fabrication_kind(path)
        if kind is None:
            raise RuntimeError(
                f"Gerber output contains an unrecognized fabrication file: {relative}"
            )
        seen.add(archive_name)
        members.append((archive_name, path, kind))
    return members


def _require_fabrication_outputs(
    gerber_dir: Path, *, require_drill: bool
) -> list[tuple[str, Path, str]]:
    members = _fabrication_files(gerber_dir)
    if not any(kind == "gerber" for _, _, kind in members):
        raise RuntimeError("gerbers export produced no nonempty recognized Gerber files")
    if require_drill and not any(kind == "drill" for _, _, kind in members):
        raise RuntimeError("drill export produced no nonempty Excellon .drl files")
    return members


def _make_gerber_zip(gerber_dir: Path, destination: Path) -> None:
    members = _require_fabrication_outputs(gerber_dir, require_drill=True)
    with destination.open("xb") as raw_stream:
        with zipfile.ZipFile(
            raw_stream,
            mode="w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=9,
        ) as archive:
            for name, path, _ in members:
                information = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                information.create_system = 3
                information.external_attr = (stat.S_IFREG | 0o644) << 16
                information.compress_type = zipfile.ZIP_DEFLATED
                information.flag_bits = 0
                archive.writestr(information, path.read_bytes(), compresslevel=9)
        raw_stream.flush()
        os.fsync(raw_stream.fileno())


def _tree_digest_manifest(path: Path, context: str) -> dict[str, str]:
    if path.is_symlink() or not path.is_dir():
        raise OSError(f"{context} must be a real directory")
    result: dict[str, str] = {}
    for child in sorted(path.rglob("*"), key=lambda item: item.relative_to(path).as_posix()):
        information = child.stat(follow_symlinks=False)
        relative = child.relative_to(path).as_posix()
        if stat.S_ISLNK(information.st_mode):
            raise OSError(f"{context} contains a symlink")
        if stat.S_ISDIR(information.st_mode):
            result[f"directory/{relative}"] = hashlib.sha256(
                b"directory\0"
            ).hexdigest()
            continue
        if not stat.S_ISREG(information.st_mode):
            raise OSError(f"{context} contains a non-regular entry")
        result[f"file/{relative}"] = _sha256(child)
    return result


def _directory_identity(path: Path, context: str) -> tuple[int, int]:
    information = path.stat(follow_symlinks=False)
    if not stat.S_ISDIR(information.st_mode):
        raise OSError(f"{context} must be a real directory")
    return information.st_dev, information.st_ino


def _journal_identity(
    value: object, context: str, *, optional: bool = False
) -> tuple[int, int] | None:
    if value is None and optional:
        return None
    if (
        not isinstance(value, list)
        or len(value) != 2
        or any(type(item) is not int or item < 0 for item in value)
    ):
        raise OSError(f"export transaction journal has invalid {context}")
    return value[0], value[1]


def _journal_tree_manifest(value: object, context: str) -> dict[str, str]:
    if not isinstance(value, Mapping):
        raise OSError(f"export transaction journal has invalid {context}")
    result: dict[str, str] = {}
    for relative, digest in value.items():
        try:
            safe_relative = _safe_relative_path(relative)
        except ValueError as error:
            # Transaction manifests include the source manifest itself.
            if relative != _MANIFEST_NAME:
                raise OSError(f"export transaction journal has invalid {context}") from error
            safe_relative = _MANIFEST_NAME
        if not isinstance(digest, str) or _DIGEST_PATTERN.fullmatch(digest) is None:
            raise OSError(f"export transaction journal has invalid {context}")
        result[safe_relative] = digest
    return dict(sorted(result.items()))


def _transaction_names(output_dir: Path, transaction: str) -> tuple[Path, Path, Path]:
    parent = output_dir.parent
    return (
        parent / f".{output_dir.name}.exports-stage-{transaction}",
        parent / f".{output_dir.name}.exports-backup-{transaction}",
        parent / f".{output_dir.name}.exports.transaction.json",
    )


def _read_regular_file_token(
    path: Path, context: str
) -> tuple[bytes, tuple[int, int, str]]:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise OSError(f"{context} ownership mismatch") from error
    try:
        information = os.fstat(descriptor)
        if not stat.S_ISREG(information.st_mode) or information.st_nlink != 1:
            raise OSError(f"{context} ownership mismatch")
        chunks: list[bytes] = []
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
        content = b"".join(chunks)
    finally:
        os.close(descriptor)
    return content, (
        information.st_dev,
        information.st_ino,
        hashlib.sha256(content).hexdigest(),
    )


def _journal_token(path: Path) -> tuple[int, int, str]:
    _, token = _read_regular_file_token(path, "export transaction journal")
    return token


def _require_journal_token(path: Path, expected: tuple[int, int, str]) -> None:
    if _journal_token(path) != expected:
        raise OSError("export transaction journal ownership mismatch")


def _write_transaction_journal(
    path: Path,
    value: Mapping[str, object],
    expected: tuple[int, int, str] | None = None,
) -> tuple[int, int, str]:
    transaction = str(value["transaction"])
    temporary = path.with_name(f"{path.name}.{transaction}.tmp")
    if temporary.exists() or temporary.is_symlink():
        raise OSError("export transaction journal temporary already exists")
    temporary_token: tuple[int, int, str] | None = None
    try:
        _write_json(temporary, value)
        temporary_token = _journal_token(temporary)
        if expected is None:
            if path.exists() or path.is_symlink():
                raise OSError("export transaction journal ownership mismatch")
        else:
            _require_journal_token(path, expected)
        os.replace(temporary, path)
        _fsync_directory(path.parent)
        published_token = _journal_token(path)
        if published_token != temporary_token:
            raise OSError("export transaction journal ownership mismatch")
        return published_token
    except Exception:
        if temporary_token is not None:
            try:
                current = _journal_token(temporary)
            except OSError:
                current = None
            if current == temporary_token:
                temporary.unlink()
        raise


def _read_transaction_journal(
    path: Path, output_dir: Path
) -> tuple[dict[str, object], tuple[int, int, str]]:
    try:
        content, token = _read_regular_file_token(path, "export transaction journal")
        raw = json.loads(
            content,
            object_pairs_hook=_duplicate_rejecting_object,
            parse_constant=_reject_json_constant,
        )
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError) as error:
        raise OSError("export transaction journal is malformed") from error
    expected_keys = {
        "schemaVersion",
        "transaction",
        "output",
        "stage",
        "backup",
        "state",
        "hadOutput",
        "stageIdentity",
        "stageManifest",
        "backupIdentity",
        "backupManifest",
    }
    if not isinstance(raw, Mapping) or set(raw) != expected_keys:
        raise OSError("export transaction journal has an invalid schema")
    transaction = raw.get("transaction")
    if (
        type(raw.get("schemaVersion")) is not int
        or raw.get("schemaVersion") != 1
        or not isinstance(transaction, str)
        or _TRANSACTION_ID_PATTERN.fullmatch(transaction) is None
        or raw.get("output") != output_dir.name
        or raw.get("stage") != f".{output_dir.name}.exports-stage-{transaction}"
        or raw.get("backup") != f".{output_dir.name}.exports-backup-{transaction}"
        or raw.get("state") not in {"allocated", "prepared", "backed_up", "published"}
        or type(raw.get("hadOutput")) is not bool
    ):
        raise OSError("export transaction journal has invalid metadata")
    state = str(raw["state"])
    stage_identity = _journal_identity(
        raw.get("stageIdentity"), "stage identity", optional=state == "allocated"
    )
    backup_identity = _journal_identity(
        raw.get("backupIdentity"), "backup identity", optional=True
    )
    stage_manifest = _journal_tree_manifest(raw.get("stageManifest"), "stage manifest")
    backup_manifest = _journal_tree_manifest(raw.get("backupManifest"), "backup manifest")
    if state == "allocated":
        if stage_manifest:
            raise OSError("allocated export transaction claims staged contents")
    elif (
        stage_identity is None
        or f"file/{_MANIFEST_NAME}" not in stage_manifest
    ):
        raise OSError("export transaction stage manifest is incomplete")
    if bool(raw["hadOutput"]) != (backup_identity is not None):
        raise OSError("export transaction backup ownership is inconsistent")
    return ({
        **raw,
        "stageIdentity": stage_identity,
        "stageManifest": stage_manifest,
        "backupIdentity": backup_identity,
        "backupManifest": backup_manifest,
    }, token)


def _remove_owned_directory(
    path: Path,
    identity: tuple[int, int],
    context: str,
    remove_tree: Callable[[str | Path], object],
) -> None:
    if not path.exists() and not path.is_symlink():
        return
    if _directory_identity(path, context) != identity:
        raise OSError(f"{context} ownership mismatch")
    remove_tree(path)


def _remove_transaction_stage(
    path: Path,
    identity: tuple[int, int] | None,
    context: str,
    remove_tree: Callable[[str | Path], object],
) -> None:
    if identity is not None:
        _remove_owned_directory(path, identity, context, remove_tree)
    elif path.exists() or path.is_symlink():
        raise OSError(f"{context} ownership mismatch")


def _require_owned_tree(
    path: Path,
    identity: tuple[int, int],
    manifest: Mapping[str, str],
    context: str,
) -> None:
    if path.is_symlink() or not path.exists():
        raise OSError(f"{context} ownership mismatch")
    if _directory_identity(path, context) != identity:
        raise OSError(f"{context} ownership mismatch")
    if _tree_digest_manifest(path, context) != manifest:
        raise OSError(f"{context} content mismatch")


def _remove_journal(path: Path, expected: tuple[int, int, str]) -> None:
    if not path.exists() and not path.is_symlink():
        return
    _require_journal_token(path, expected)
    path.unlink()
    _fsync_directory(path.parent)


def _transaction_artifacts(output_dir: Path) -> tuple[Path, ...]:
    prefixes = (
        f".{output_dir.name}.exports-stage-",
        f".{output_dir.name}.exports-backup-",
        f".{output_dir.name}.exports.transaction.json.",
    )
    return tuple(
        child
        for child in output_dir.parent.iterdir()
        if any(child.name.startswith(prefix) for prefix in prefixes)
    )


@contextmanager
def _export_publication_lock(output_dir: Path):
    locking = _fcntl
    if locking is None or not hasattr(os, "O_NOFOLLOW"):
        raise OSError(
            "transactional PCB export publication requires POSIX no-follow fcntl locking"
        )
    lock_path = output_dir.parent / f".{output_dir.name}.exports.lock"
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_CLOEXEC", 0) | os.O_NOFOLLOW
    try:
        descriptor = os.open(lock_path, flags, 0o600)
    except OSError as error:
        raise OSError("PCB export writer lock is unsafe or unavailable") from error
    try:
        information = os.fstat(descriptor)
        if not stat.S_ISREG(information.st_mode) or information.st_nlink != 1:
            raise OSError("PCB export writer lock must be a regular file")
        try:
            locking.flock(descriptor, locking.LOCK_EX | locking.LOCK_NB)
        except BlockingIOError as error:
            raise OSError("PCB export writer is busy") from error
        yield
    finally:
        try:
            locking.flock(descriptor, locking.LOCK_UN)
        finally:
            os.close(descriptor)


def _recover_publication(
    output_dir: Path,
    journal_path: Path,
    *,
    rename: Callable[[str | Path, str | Path], object],
    remove_tree: Callable[[str | Path], object],
) -> None:
    if not journal_path.exists() and not journal_path.is_symlink():
        if _transaction_artifacts(output_dir):
            raise OSError("ambiguous PCB export recovery artifacts exist without a journal")
        return
    journal, journal_token = _read_transaction_journal(journal_path, output_dir)
    stage = output_dir.parent / str(journal["stage"])
    backup = output_dir.parent / str(journal["backup"])
    stage_identity = journal["stageIdentity"]
    backup_identity = journal["backupIdentity"]
    state = str(journal["state"])
    assert stage_identity is None or isinstance(stage_identity, tuple)
    assert backup_identity is None or isinstance(backup_identity, tuple)

    stage_manifest = journal["stageManifest"]
    backup_manifest = journal["backupManifest"]
    assert isinstance(stage_manifest, Mapping)
    assert isinstance(backup_manifest, Mapping)

    if output_dir.exists() or output_dir.is_symlink():
        output_identity = _directory_identity(
            output_dir, "candidate authoritative PCB export output"
        )
        if (
            stage_identity is not None
            and state != "allocated"
            and output_identity == stage_identity
        ):
            _require_owned_tree(
                output_dir,
                stage_identity,
                stage_manifest,
                "published PCB export output",
            )
            _verify_export_tree(
                output_dir, require_required_artifacts=False
            )
            _remove_transaction_stage(
                stage,
                stage_identity,
                "stale PCB export stage",
                remove_tree,
            )
            if backup_identity is not None:
                if backup.exists() or backup.is_symlink():
                    _require_owned_tree(
                        backup,
                        backup_identity,
                        backup_manifest,
                        "published PCB export backup",
                    )
                    _remove_owned_directory(
                        backup,
                        backup_identity,
                        "published PCB export backup",
                        remove_tree,
                    )
            elif backup.exists() or backup.is_symlink():
                raise OSError("published PCB export has an unowned backup")
            _remove_journal(journal_path, journal_token)
            return

        if backup_identity is not None and output_identity == backup_identity:
            if state == "published":
                raise OSError(
                    "published PCB export output was replaced by the old backup"
                )
            _require_owned_tree(
                output_dir,
                backup_identity,
                backup_manifest,
                "original PCB export output",
            )
            if backup.exists() or backup.is_symlink():
                raise OSError("original PCB export output has an ambiguous backup")
            _remove_transaction_stage(
                stage,
                stage_identity,
                "abandoned PCB export stage",
                remove_tree,
            )
            _remove_journal(journal_path, journal_token)
            return

        raise OSError(
            "candidate authoritative PCB export output ownership mismatch"
        )

    if state == "published":
        raise OSError(
            "published PCB export output is missing; recovery refuses to restore old data"
        )
    if backup_identity is not None:
        if not backup.exists() and not backup.is_symlink():
            raise OSError("PCB export recovery has no complete owned backup")
        if state == "allocated":
            raise OSError("allocated PCB export transaction has an unexpected backup")
        _require_owned_tree(
            backup,
            backup_identity,
            backup_manifest,
            "PCB export recovery backup",
        )
        rename(backup, output_dir)
        _fsync_directory(output_dir.parent)
    elif backup.exists() or backup.is_symlink():
        raise OSError("PCB export recovery found an unowned backup")

    _remove_transaction_stage(
        stage, stage_identity, "abandoned PCB export stage", remove_tree
    )
    _remove_journal(journal_path, journal_token)


def _rollback_precommit(
    output_dir: Path,
    stage: Path,
    backup: Path,
    journal_path: Path,
    journal: Mapping[str, object],
    journal_token: tuple[int, int, str],
    *,
    rename: Callable[[str | Path, str | Path], object],
    remove_tree: Callable[[str | Path], object],
) -> bool:
    stage_identity = journal["stageIdentity"]
    backup_identity = journal["backupIdentity"]
    state = str(journal["state"])
    assert stage_identity is None or isinstance(stage_identity, tuple)
    assert backup_identity is None or isinstance(backup_identity, tuple)
    stage_manifest = journal["stageManifest"]
    backup_manifest = journal["backupManifest"]
    assert isinstance(stage_manifest, Mapping)
    assert isinstance(backup_manifest, Mapping)
    if output_dir.exists() or output_dir.is_symlink():
        output_identity = _directory_identity(output_dir, "PCB export output")
        if stage_identity is not None and output_identity == stage_identity:
            if state == "allocated":
                raise OSError(
                    "allocated PCB export stage cannot be authoritative output"
                )
            _require_owned_tree(
                output_dir,
                stage_identity,
                stage_manifest,
                "published PCB export output",
            )
            _verify_export_tree(output_dir, require_required_artifacts=False)
            return True
        if (
            backup_identity is not None
            and output_identity == backup_identity
            and not backup.exists()
            and not backup.is_symlink()
        ):
            _require_owned_tree(
                output_dir,
                backup_identity,
                backup_manifest,
                "original PCB export output",
            )
            _remove_transaction_stage(
                stage,
                stage_identity,
                "failed PCB export stage",
                remove_tree,
            )
            _remove_journal(journal_path, journal_token)
            return False
        raise OSError("PCB export output ownership mismatch prevents rollback")
    if backup.is_symlink():
        raise OSError("PCB export backup ownership mismatch prevents rollback")
    if backup_identity is not None and backup.exists():
        _require_owned_tree(
            backup,
            backup_identity,
            backup_manifest,
            "PCB export backup",
        )
        rename(backup, output_dir)
        _fsync_directory(output_dir.parent)
    elif backup_identity is not None:
        raise OSError("PCB export backup ownership mismatch prevents rollback")
    elif backup.exists() or backup.is_symlink():
        raise OSError("unowned PCB export backup prevents rollback")
    _remove_transaction_stage(
        stage, stage_identity, "failed PCB export stage", remove_tree
    )
    _remove_journal(journal_path, journal_token)
    return False


def _noop() -> None:
    return None


def _publish_export_directory(
    output_dir: str | Path,
    source_stage: str | Path,
    *,
    rename: Callable[[str | Path, str | Path], object] = os.replace,
    after_stage: Callable[[], object] = _noop,
    after_backup: Callable[[], object] = _noop,
    after_publish: Callable[[], object] = _noop,
    after_recovery: Callable[[], object] = _noop,
    remove_tree: Callable[[str | Path], object] = shutil.rmtree,
) -> None:
    """Serialize and atomically publish one exact crash-recoverable export set."""

    if _fcntl is None or not hasattr(os, "O_NOFOLLOW"):
        raise OSError(
            "transactional PCB export publication requires POSIX no-follow fcntl locking"
        )
    raw_output = Path(output_dir).expanduser()
    raw_source = Path(source_stage).expanduser()
    if raw_output.is_symlink():
        raise OSError("PCB export output must not be a symlink")
    if raw_source.is_symlink():
        raise OSError("source export stage must not be a symlink")
    output = raw_output.absolute()
    source = raw_source.resolve(strict=True)
    _verify_export_tree(source, require_required_artifacts=False)
    output.parent.mkdir(parents=True, exist_ok=True)
    journal_path = output.parent / f".{output.name}.exports.transaction.json"
    with _export_publication_lock(output):
        _recover_publication(
            output, journal_path, rename=rename, remove_tree=remove_tree
        )
        after_recovery()
        if output.is_symlink() or (output.exists() and not output.is_dir()):
            raise OSError("PCB export output must be a non-symlink directory")
        if output.exists():
            _verify_export_tree(output, require_required_artifacts=False)
        transaction = uuid.uuid4().hex
        stage, backup, _ = _transaction_names(output, transaction)
        had_output = output.exists()
        backup_identity = (
            _directory_identity(output, "existing PCB export output")
            if had_output
            else None
        )
        backup_manifest = (
            _tree_digest_manifest(output, "existing PCB export output")
            if had_output
            else {}
        )
        journal: dict[str, object] = {
            "schemaVersion": 1,
            "transaction": transaction,
            "output": output.name,
            "stage": stage.name,
            "backup": backup.name,
            "state": "allocated",
            "hadOutput": had_output,
            "stageIdentity": None,
            "stageManifest": {},
            "backupIdentity": backup_identity,
            "backupManifest": backup_manifest,
        }
        journal_token = _write_transaction_journal(journal_path, journal)
        try:
            stage.mkdir(mode=0o700)
            stage_identity = _directory_identity(stage, "PCB export stage")
            journal["stageIdentity"] = stage_identity
            journal_token = _write_transaction_journal(
                journal_path, journal, journal_token
            )
            after_stage()
            _require_journal_token(journal_path, journal_token)
            _require_owned_tree(stage, stage_identity, {}, "PCB export stage")
            for source_path in sorted(source.rglob("*"), key=lambda item: item.relative_to(source).as_posix()):
                relative = source_path.relative_to(source)
                destination = stage / relative
                information = source_path.stat(follow_symlinks=False)
                if stat.S_ISLNK(information.st_mode):
                    raise OSError("source export stage contains a symlink")
                if stat.S_ISDIR(information.st_mode):
                    destination.mkdir()
                elif stat.S_ISREG(information.st_mode):
                    shutil.copyfile(source_path, destination, follow_symlinks=False)
                else:
                    raise OSError("source export stage contains a non-regular entry")
            _verify_export_tree(stage, require_required_artifacts=False)
            _fsync_tree(stage)
            if _directory_identity(stage, "PCB export stage") != stage_identity:
                raise OSError("PCB export stage ownership changed during preparation")
            stage_manifest = _tree_digest_manifest(stage, "PCB export stage")
            journal["state"] = "prepared"
            journal["stageManifest"] = stage_manifest
            journal_token = _write_transaction_journal(
                journal_path, journal, journal_token
            )
            if had_output:
                rename(output, backup)
                _fsync_directory(output.parent)
            journal["state"] = "backed_up"
            journal_token = _write_transaction_journal(
                journal_path, journal, journal_token
            )
            if had_output:
                after_backup()
                _require_journal_token(journal_path, journal_token)
                _require_owned_tree(
                    backup,
                    backup_identity,
                    backup_manifest,
                    "PCB export backup",
                )
            _require_owned_tree(
                stage,
                stage_identity,
                stage_manifest,
                "prepared PCB export stage",
            )
            rename(stage, output)
        except Exception as publish_error:
            try:
                committed = _rollback_precommit(
                    output,
                    stage,
                    backup,
                    journal_path,
                    journal,
                    journal_token,
                    rename=rename,
                    remove_tree=remove_tree,
                )
            except Exception as rollback_error:
                raise OSError(
                    f"PCB export publication failed ({publish_error}); {rollback_error}"
                ) from rollback_error
            if not committed:
                raise
            raise OSError(
                f"PCB export publication committed; cleanup pending: {publish_error}"
            ) from publish_error

        try:
            _fsync_directory(output.parent)
            journal["state"] = "published"
            journal_token = _write_transaction_journal(
                journal_path, journal, journal_token
            )
            after_publish()
            _require_journal_token(journal_path, journal_token)
            _require_owned_tree(
                output,
                stage_identity,
                stage_manifest,
                "published PCB export output",
            )
            _verify_export_tree(output, require_required_artifacts=False)
            if isinstance(backup_identity, tuple):
                _require_owned_tree(
                    backup,
                    backup_identity,
                    backup_manifest,
                    "published PCB export backup",
                )
                _remove_owned_directory(
                    backup,
                    backup_identity,
                    "published PCB export backup",
                    remove_tree,
                )
                _fsync_directory(output.parent)
            _remove_journal(journal_path, journal_token)
        except Exception as cleanup_error:
            raise OSError(
                f"PCB export publication committed; cleanup pending: {cleanup_error}"
            ) from cleanup_error


def _validate_output_location(project_dir: Path, output_dir: Path) -> Path:
    if output_dir.is_symlink():
        raise ValueError(f"PCB export output is a symlink: {output_dir}")
    resolved = output_dir.resolve(strict=False)
    if (
        resolved == project_dir
        or project_dir in resolved.parents
        or resolved in project_dir.parents
    ):
        raise ValueError("PCB export output must be separate from the canonical project")
    return resolved


def _export_outputs_once(
    project_dir: str | Path = ELECTRONICS_DIR,
    output_dir: str | Path = PCB_OUTPUT_DIR,
    runner: _Runner = subprocess.run,
    validator: _Validator = validate_project,
) -> ExportResult:
    """Validate, export from a complete copy, and atomically publish artifacts."""

    raw_project = Path(project_dir).expanduser()
    if raw_project.is_symlink():
        raise RuntimeError(f"editable project path is a symlink: {raw_project}")
    canonical = raw_project.resolve(strict=True)
    output = _validate_output_location(canonical, Path(output_dir).expanduser())
    source_digest_before = project_digest(canonical)
    policy_digest_before = _policy_digest(canonical)
    recipe_digest_before = _export_recipe_digest()
    project_name, expected_major, minimum = _load_toolchain(canonical)

    with tempfile.TemporaryDirectory(prefix="pocket-card-export-validation-") as raw_validation:
        validation_output = Path(raw_validation) / "reports"
        validation_result = _call_validator(
            validator, canonical, validation_output, runner
        )
        status = getattr(validation_result, "status", None)
        if status != PASS:
            messages = getattr(validation_result, "messages", ())
            detail = _bounded_stream(
                "; ".join(
                    _sanitize_diagnostic(message) for message in messages
                )
            )
            suffix = f": {detail}" if detail else ""
            raise RuntimeError(
                f"PCB validation must PASS before export; got {status!r}{suffix}"
            )
        for name in _VALIDATION_FILENAMES:
            _require_regular_output(validation_output / name, "validation")

        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(
            prefix="pocket-card-export-build-"
        ) as raw_build:
            build_root = Path(raw_build)
            working_project = build_root / "project"
            artifacts = build_root / "artifacts"
            working_project.mkdir()
            artifacts.mkdir()
            _copy_project(canonical, working_project)
            project_file = working_project / f"{project_name}.kicad_pro"
            schematic = working_project / f"{project_name}.kicad_sch"
            board = working_project / f"{project_name}.kicad_pcb"
            if not all(path.is_file() and path.parent == working_project for path in (project_file, schematic, board)):
                raise RuntimeError("temporary KiCad project copy is incomplete or not co-located")

            executable = _find_kicad_cli(runner, working_project)
            kicad_version = _kicad_version(executable, runner, working_project)
            parsed_version = _version_tuple(kicad_version)
            if parsed_version[0] != expected_major or parsed_version < _version_tuple(minimum):
                raise RuntimeError(
                    f"KiCad export tool {kicad_version!r} violates pinned policy"
                )

            pdf_path = artifacts / f"{project_name}.pdf"
            bom_path = artifacts / "BOM.csv"
            gerber_dir = artifacts / "gerber"
            pos_path = artifacts / f"{project_name}-all-pos.csv"
            step_path = artifacts / f"{project_name}.step"
            stl_path = artifacts / f"{project_name}.stl"
            gerber_zip_path = artifacts / f"{project_name}_gerbers.zip"
            gerber_dir.mkdir()

            commands = (
                (
                    "pdf",
                    (executable, "sch", "export", "pdf", "--output", str(pdf_path), str(schematic)),
                    pdf_path,
                ),
                (
                    "bom",
                    (
                        executable,
                        "sch",
                        "export",
                        "bom",
                        "--fields",
                        "Reference,Value,Footprint,QUANTITY,DNP",
                        "--output",
                        str(bom_path),
                        str(schematic),
                    ),
                    bom_path,
                ),
                (
                    "gerbers",
                    (
                        executable,
                        "pcb",
                        "export",
                        "gerbers",
                        "--board-plot-params",
                        "--check-zones",
                        "--output",
                        str(gerber_dir),
                        str(board),
                    ),
                    None,
                ),
                (
                    "drill",
                    (
                        executable,
                        "pcb",
                        "export",
                        "drill",
                        "--format",
                        "excellon",
                        "--output",
                        str(gerber_dir),
                        str(board),
                    ),
                    None,
                ),
                (
                    "pos",
                    (
                        executable,
                        "pcb",
                        "export",
                        "pos",
                        "--format",
                        "csv",
                        "--units",
                        "mm",
                        "--side",
                        "both",
                        "--bottom-negate-x",
                        "--output",
                        str(pos_path),
                        str(board),
                    ),
                    pos_path,
                ),
                (
                    "step",
                    (
                        executable,
                        "pcb",
                        "export",
                        "step",
                        "--force",
                        "--subst-models",
                        "--output",
                        str(step_path),
                        str(board),
                    ),
                    step_path,
                ),
                (
                    "stl",
                    (
                        executable,
                        "pcb",
                        "export",
                        "stl",
                        "--force",
                        "--subst-models",
                        "--output",
                        str(stl_path),
                        str(board),
                    ),
                    stl_path,
                ),
            )
            for label, command, required_output in commands:
                _run(
                    runner,
                    command,
                    cwd=working_project,
                    timeout=KICAD_EXPORT_TIMEOUT_SECONDS,
                    label=f"{label} export",
                )
                if required_output is not None:
                    _require_regular_output(required_output, f"{label} export")
                if label == "gerbers":
                    _require_fabrication_outputs(gerber_dir, require_drill=False)
                elif label == "drill":
                    _require_fabrication_outputs(gerber_dir, require_drill=True)

            from hardware.pocket_card.case.export_smt import write_bom, write_cpl

            jlc_bom = Path(write_bom(artifacts))
            cpl = Path(write_cpl(pos_path, artifacts))
            _require_regular_output(jlc_bom, "JLC BOM export")
            _require_regular_output(cpl, "JLC CPL export")
            shutil.copyfile(step_path, artifacts / "exported.step")
            shutil.copyfile(stl_path, artifacts / "exported.stl")
            for name in _VALIDATION_FILENAMES:
                shutil.copyfile(validation_output / name, artifacts / name)
            _make_gerber_zip(gerber_dir, gerber_zip_path)

            generated = _manifest_artifacts(artifacts)
            if not _REQUIRED_ARTIFACTS.issubset(generated):
                missing = sorted(_REQUIRED_ARTIFACTS - set(generated))
                raise RuntimeError("export stage is missing required artifacts: " + ", ".join(missing))
            if not any(name.startswith("gerber/") for name in generated):
                raise RuntimeError("export stage has no Gerber or drill artifacts")

            source_digest_after_commands = project_digest(canonical)
            if source_digest_after_commands != source_digest_before:
                raise RuntimeError(
                    "canonical project mutation detected before PCB export publication"
                )
            if _policy_digest(canonical) != policy_digest_before:
                raise RuntimeError(
                    "canonical validation policy mutation detected before PCB export publication"
                )
            if _export_recipe_digest() != recipe_digest_before:
                raise RuntimeError(
                    "PCB export recipe mutation detected before publication"
                )
            manifest = {
                "schemaVersion": 1,
                "projectName": project_name,
                "projectDigest": source_digest_before,
                "policyDigest": policy_digest_before,
                "exportRecipeDigest": recipe_digest_before,
                "kicadVersion": kicad_version,
                "artifacts": generated,
            }
            _write_json(artifacts / _MANIFEST_NAME, manifest)
            _verify_export_tree(
                artifacts,
                project_digest_value=source_digest_before,
                policy_digest_value=policy_digest_before,
                recipe_digest_value=recipe_digest_before,
            )
            _publish_export_directory(output, artifacts)

    source_digest_after_publish = project_digest(canonical)
    if source_digest_after_publish != source_digest_before:
        raise RuntimeError("canonical project mutation detected after PCB export publication")
    if _policy_digest(canonical) != policy_digest_before:
        raise RuntimeError(
            "canonical validation policy mutation detected after PCB export publication"
        )
    if _export_recipe_digest() != recipe_digest_before:
        raise RuntimeError("PCB export recipe mutation detected after publication")
    return ExportResult(
        project_digest=source_digest_before,
        output_dir=output,
        step_path=output / f"{project_name}.step",
        stl_path=output / f"{project_name}.stl",
        schematic_pdf_path=output / f"{project_name}.pdf",
        gerber_zip_path=output / f"{project_name}_gerbers.zip",
        manifest_path=output / _MANIFEST_NAME,
    )


def export_outputs(
    project_dir: str | Path = ELECTRONICS_DIR,
    output_dir: str | Path = PCB_OUTPUT_DIR,
    runner: _Runner = subprocess.run,
    validator: _Validator = validate_project,
) -> ExportResult:
    """Export with independent mutation evidence even when a stage fails."""

    raw_project = Path(project_dir).expanduser()
    canonical: Path | None = None
    source_digest_before: str | None = None
    policy_digest_before: str | None = None
    recipe_digest_before: str | None = None
    try:
        if not raw_project.is_symlink():
            canonical = raw_project.resolve(strict=True)
            source_digest_before = project_digest(canonical)
            policy_digest_before = _policy_digest(canonical)
            recipe_digest_before = _export_recipe_digest()
        return _export_outputs_once(
            project_dir,
            output_dir,
            runner=runner,
            validator=validator,
        )
    except Exception as error:
        if canonical is not None and source_digest_before is not None:
            try:
                source_digest_after = project_digest(canonical)
            except (OSError, RuntimeError, ValueError) as digest_error:
                raise RuntimeError(
                    "PCB export failed and canonical source digest recomputation failed: "
                    f"{_sanitize_diagnostic(digest_error)}"
                ) from error
            if source_digest_after != source_digest_before:
                raise RuntimeError(
                    "canonical project mutation detected during failed PCB export"
                ) from error
            if policy_digest_before is not None:
                try:
                    policy_digest_after = _policy_digest(canonical)
                except (OSError, RuntimeError, ValueError) as digest_error:
                    raise RuntimeError(
                        "PCB export failed and canonical policy digest "
                        "recomputation failed: "
                        f"{_sanitize_diagnostic(digest_error)}"
                    ) from error
                if policy_digest_after != policy_digest_before:
                    raise RuntimeError(
                        "canonical validation policy mutation detected during "
                        "failed PCB export"
                    ) from error
            if recipe_digest_before is not None:
                try:
                    recipe_digest_after = _export_recipe_digest()
                except (OSError, RuntimeError, ValueError) as digest_error:
                    raise RuntimeError(
                        "PCB export failed and recipe digest recomputation failed: "
                        f"{_sanitize_diagnostic(digest_error)}"
                    ) from error
                if recipe_digest_after != recipe_digest_before:
                    raise RuntimeError(
                        "PCB export recipe mutation detected during failed export"
                    ) from error
        raise


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-dir", type=Path, default=ELECTRONICS_DIR)
    parser.add_argument("--output-dir", type=Path, default=PCB_OUTPUT_DIR)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        result = export_outputs(args.project_dir, args.output_dir)
    except (OSError, RuntimeError, UnicodeError, ValueError, ValidationError) as error:
        print(f"ERROR: {_bounded_stream(_sanitize_diagnostic(error))}")
        return 1
    print(f"PASS\n- exported {result.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
