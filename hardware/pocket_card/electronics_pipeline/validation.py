"""Read-only native KiCad validation for the Pocket Card controller project."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType

from .inventory import (
    KICAD_EXPORT_TIMEOUT_SECONDS,
    KICAD_VERSION_TIMEOUT_SECONDS,
    ProjectInventory,
    _kicad_cli_candidates,
    _version_tuple,
    compare_schematic_to_board,
    editable_project_files,
    parse_board,
    parse_netlist,
    project_digest,
)
from .mechanics import (
    check_contract_against_case_params,
    check_mechanics,
    load_contract,
)
from .paths import (
    ELECTRONICS_DIR,
    find_forbidden_machine_paths,
)


PASS = "PASS"
INVALID = "INVALID"
MECHANICAL_REVIEW_REQUIRED = "MECHANICAL REVIEW REQUIRED"

_EXIT_CODES = {PASS: 0, INVALID: 1, MECHANICAL_REVIEW_REQUIRED: 2}
_POLICY_SCOPES = ("ERC", "DRC", "parity")
_FINGERPRINT_SCOPES = {"ERC": "erc", "DRC": "drc", "parity": "parity"}
_APPROVED_WARNING_GROUPS = frozenset(
    {
        ("ERC", "endpoint_off_grid"),
        ("ERC", "lib_symbol_issues"),
        ("DRC", "via_dangling"),
        ("DRC", "silk_edge_clearance"),
        ("DRC", "silk_overlap"),
        ("DRC", "silk_over_copper"),
        ("DRC", "nonmirrored_text_on_back_layer"),
        ("parity", "footprint_symbol_mismatch"),
        ("parity", "net_conflict"),
        ("parity", "footprint_symbol_field_mismatch"),
    }
)
_WAIVER_ROOT_KEYS = frozenset({"schemaVersion", "groups"})
_WAIVER_GROUP_KEYS = frozenset(
    {"scope", "type", "count", "fingerprintDigest", "rationale"}
)
_TOOLCHAIN_ROOT_KEYS = frozenset({"schemaVersion", "project", "kicad"})
_TOOLCHAIN_KICAD_KEYS = frozenset({"major", "minimum"})
_PROJECT_STEM_PATTERN = re.compile(r"[A-Za-z0-9_-]+")
_DIGEST_PATTERN = re.compile(r"[0-9a-f]{64}")
_COMMAND_TIMEOUT_SECONDS = 180
_EXPECTED_MAJOR = 10
_EXPECTED_MINIMUM = "10.0.4"
_Runner = Callable[..., object]


class ValidationError(RuntimeError):
    """An expected validation, tool, or policy failure."""


def _freeze(value: object) -> object:
    if isinstance(value, Mapping):
        return MappingProxyType(
            {str(key): _freeze(nested) for key, nested in value.items()}
        )
    if isinstance(value, (list, tuple)):
        return tuple(_freeze(nested) for nested in value)
    if isinstance(value, (set, frozenset)):
        return frozenset(_freeze(nested) for nested in value)
    return value


def _json_ready(value: object) -> object:
    if isinstance(value, Mapping):
        return {
            str(key): _json_ready(value[key])
            for key in sorted(value, key=lambda item: str(item))
        }
    if isinstance(value, (tuple, list)):
        return [_json_ready(item) for item in value]
    if isinstance(value, (set, frozenset)):
        return [_json_ready(item) for item in sorted(value, key=repr)]
    return value


@dataclass(frozen=True)
class ValidationResult:
    status: str
    messages: tuple[str, ...]
    reports: Mapping[str, object]
    inventory: ProjectInventory | None

    def __post_init__(self) -> None:
        if self.status not in _EXIT_CODES:
            raise ValueError(f"unknown validation status {self.status!r}")
        object.__setattr__(self, "messages", tuple(str(item) for item in self.messages))
        frozen = _freeze(dict(self.reports))
        assert isinstance(frozen, Mapping)
        object.__setattr__(self, "reports", frozen)

    def render_text(self) -> str:
        return self.status + "".join(f"\n- {message}" for message in self.messages)


def _duplicate_rejecting_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key {key!r}")
        result[key] = value
    return result


def _reject_json_constant(value: str) -> object:
    raise ValueError(f"non-finite JSON number {value!r}")


def _load_json(path: Path, context: str) -> object:
    if path.is_symlink():
        raise ValidationError(f"{context} path is a symlink: {path}")
    try:
        return json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=_duplicate_rejecting_object,
            parse_constant=_reject_json_constant,
        )
    except ValueError:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValidationError(f"cannot load {context} {path}: {error}") from error


def load_waivers(path: str | Path) -> Mapping[str, object]:
    """Load waiver JSON without weakening the pure classifier's schema checks."""

    value = _load_json(Path(path), "validation waiver policy")
    if not isinstance(value, Mapping):
        raise ValueError("waiver policy must be an object")
    if value.get("schemaVersion") != 1 or type(value.get("schemaVersion")) is not int:
        raise ValueError("waiver policy schemaVersion must be integer 1")
    return value


def _violation_parts(violation: Mapping[str, object]) -> tuple[str, str, str, tuple[str, ...]]:
    scope = violation.get("scope")
    severity = violation.get("severity")
    kind = violation.get("type")
    items = violation.get("items")
    if scope not in _POLICY_SCOPES:
        raise ValueError(f"violation has unknown scope {scope!r}")
    if severity not in ("error", "warning"):
        raise ValueError(f"{scope} violation has unsupported severity {severity!r}")
    if not isinstance(kind, str) or not kind:
        raise ValueError(f"{scope} violation type must be a nonempty string")
    if not isinstance(items, (tuple, list)) or not items:
        raise ValueError(f"{scope}/{kind} violation items must be a nonempty array")
    uuids: list[str] = []
    for index, item in enumerate(items):
        if not isinstance(item, Mapping):
            raise ValueError(f"{scope}/{kind} item {index} must be an object")
        uuid = item.get("uuid")
        if not isinstance(uuid, str) or not uuid:
            raise ValueError(f"{scope}/{kind} item {index} UUID must be nonempty")
        uuids.append(uuid)
    return str(scope), str(severity), kind, tuple(sorted(uuids))


def violation_fingerprint(violation: Mapping[str, object]) -> str:
    """Return the exact stable fingerprint for one normalized violation.

    Public policy uses ``ERC``/``DRC`` scope names.  KiCad-native fingerprint
    scope tokens are lower-case (``erc``/``drc``), as captured by schema-v1
    policy.  The same ``|`` delimiter separates fields and sorted item UUIDs.
    """

    scope, severity, kind, uuids = _violation_parts(violation)
    return "|".join((_FINGERPRINT_SCOPES[scope], severity, kind, *uuids))


def warning_group_digest(violations: Iterable[Mapping[str, object]]) -> str:
    fingerprints = sorted(violation_fingerprint(item) for item in violations)
    return hashlib.sha256("\n".join(fingerprints).encode("utf-8")).hexdigest()


def _schema_difference(value: Mapping[str, object], expected: frozenset[str]) -> str | None:
    actual = frozenset(value)
    missing = sorted(expected - actual)
    unknown = sorted(actual - expected)
    parts: list[str] = []
    if missing:
        parts.append("missing " + ", ".join(missing))
    if unknown:
        parts.append("unknown " + ", ".join(unknown))
    return "; ".join(parts) or None


def _validated_waiver_groups(
    waivers: Mapping[str, object],
) -> tuple[dict[tuple[str, str], Mapping[str, object]], tuple[str, ...]]:
    errors: list[str] = []
    difference = _schema_difference(waivers, _WAIVER_ROOT_KEYS)
    if difference:
        errors.append(f"waiver policy root has {difference}")
    if type(waivers.get("schemaVersion")) is not int or waivers.get("schemaVersion") != 1:
        errors.append("waiver policy schemaVersion must be integer 1")
    raw_groups = waivers.get("groups")
    if not isinstance(raw_groups, (tuple, list)):
        return {}, tuple(sorted((*errors, "waiver policy groups must be an array")))
    groups: dict[tuple[str, str], Mapping[str, object]] = {}
    for index, raw in enumerate(raw_groups):
        context = f"waiver group {index}"
        if not isinstance(raw, Mapping):
            errors.append(f"{context} must be an object")
            continue
        difference = _schema_difference(raw, _WAIVER_GROUP_KEYS)
        if difference:
            errors.append(f"{context} has {difference}")
        scope = raw.get("scope")
        kind = raw.get("type")
        count = raw.get("count")
        digest = raw.get("fingerprintDigest")
        rationale = raw.get("rationale")
        group_valid = True
        if scope not in _POLICY_SCOPES:
            errors.append(f"{context} has unknown scope {scope!r}")
            group_valid = False
        if not isinstance(kind, str) or not kind:
            errors.append(f"{context} type must be a nonempty string")
            group_valid = False
        if type(count) is not int or count < 1:
            errors.append(f"{context} has bad count {count!r}; expected a positive integer")
            group_valid = False
        if not isinstance(digest, str) or _DIGEST_PATTERN.fullmatch(digest) is None:
            errors.append(f"{context} has bad digest {digest!r}")
            group_valid = False
        if not isinstance(rationale, str) or not rationale.strip():
            errors.append(f"{context} has empty rationale")
            group_valid = False
        if group_valid:
            key = str(scope), str(kind)
            if key not in _APPROVED_WARNING_GROUPS:
                errors.append(f"unknown waiver group {key[0]}/{key[1]}")
            elif key in groups:
                errors.append(f"duplicate waiver group {key[0]}/{key[1]}")
            else:
                groups[key] = raw
    return groups, tuple(sorted(set(errors)))


def _report_violations(reports: Mapping[str, object]) -> tuple[list[Mapping[str, object]], list[str]]:
    violations: list[Mapping[str, object]] = []
    errors: list[str] = []
    for scope in _POLICY_SCOPES:
        report = reports.get(scope)
        if not isinstance(report, Mapping):
            errors.append(f"normalized {scope} report is missing or malformed")
            continue
        raw_violations = report.get("violations")
        if not isinstance(raw_violations, (tuple, list)):
            errors.append(f"normalized {scope} violations must be an array")
            continue
        for index, item in enumerate(raw_violations):
            if not isinstance(item, Mapping):
                errors.append(f"normalized {scope} violation {index} must be an object")
                continue
            try:
                parsed_scope, _, _, _ = _violation_parts(item)
            except ValueError as error:
                errors.append(str(error))
                continue
            if parsed_scope != scope:
                errors.append(
                    f"normalized {scope} violation {index} claims scope {parsed_scope}"
                )
                continue
            violations.append(item)
    return violations, errors


def classify_reports(
    reports: Mapping[str, object],
    waivers: Mapping[str, object],
    inventory_errors: Iterable[str] = (),
    mechanical_findings: Iterable[str] = (),
) -> ValidationResult:
    """Purely classify normalized native reports against an exact waiver policy."""

    messages: list[str] = []
    invalid_messages: list[str] = []
    violations, report_errors = _report_violations(reports)
    invalid_messages.extend(report_errors)
    waiver_groups, policy_errors = _validated_waiver_groups(waivers)
    invalid_messages.extend(f"policy error: {error}" for error in policy_errors)

    warnings: dict[tuple[str, str], list[Mapping[str, object]]] = defaultdict(list)
    counts = {scope: {"error": 0, "warning": 0} for scope in _POLICY_SCOPES}
    for item in violations:
        try:
            scope, severity, kind, uuids = _violation_parts(item)
        except ValueError:
            continue
        counts[scope][severity] += 1
        if severity == "error":
            invalid_messages.append(
                f"{scope} error {kind}: item UUIDs {', '.join(uuids)}"
            )
        else:
            warnings[(scope, kind)].append(item)

    matched = 0
    for key in sorted(warnings):
        group = warnings[key]
        waiver = waiver_groups.get(key)
        actual_count = len(group)
        actual_digest = warning_group_digest(group)
        if waiver is None:
            invalid_messages.append(
                f"unwaived warning group {key[0]}/{key[1]} "
                f"({actual_count} violations; digest {actual_digest})"
            )
            continue
        if waiver["count"] != actual_count or waiver["fingerprintDigest"] != actual_digest:
            invalid_messages.append(
                f"waiver mismatch for {key[0]}/{key[1]}: expected count "
                f"{waiver['count']} digest {waiver['fingerprintDigest']}, found "
                f"count {actual_count} digest {actual_digest}"
            )
            continue
        matched += 1
    for key in sorted(set(waiver_groups) - set(warnings)):
        invalid_messages.append(
            f"stale waiver group {key[0]}/{key[1]} has no matching warning group"
        )

    unconnected = reports.get("unconnected")
    if not isinstance(unconnected, Mapping) or not isinstance(
        unconnected.get("items"), (tuple, list)
    ):
        invalid_messages.append("normalized unconnected report is missing or malformed")
        unconnected_items: Sequence[object] = ()
    else:
        unconnected_items = unconnected["items"]
        if unconnected_items:
            labels = []
            for item in unconnected_items:
                if isinstance(item, Mapping) and isinstance(item.get("uuid"), str):
                    labels.append(str(item["uuid"]))
                else:
                    labels.append("malformed item")
            invalid_messages.append(
                f"unconnected items ({len(unconnected_items)}): {', '.join(sorted(labels))}"
            )

    native_errors = tuple(sorted(str(item) for item in inventory_errors))
    invalid_messages.extend(f"native parity error: {item}" for item in native_errors)
    mechanical = tuple(sorted(str(item) for item in mechanical_findings))

    messages.extend(
        (
            f"{counts['ERC']['error']} ERC errors; {counts['ERC']['warning']} warnings",
            f"{counts['DRC']['error']} DRC errors; {counts['DRC']['warning']} warnings",
            f"{len(unconnected_items)} unconnected items",
            f"All {matched} warning groups matched",
            "Native parity passed" if not native_errors else "Native parity failed",
            "Mechanics passed" if not mechanical else f"Mechanics has {len(mechanical)} findings",
        )
    )
    messages.extend(sorted(set(invalid_messages)))
    if invalid_messages:
        status = INVALID
    elif mechanical:
        status = MECHANICAL_REVIEW_REQUIRED
        messages.extend(f"mechanical review: {item}" for item in mechanical)
    else:
        status = PASS
    return ValidationResult(status, tuple(messages), reports, None)


def _validate_toolchain(project_dir: Path) -> str:
    path = project_dir / "toolchain.json"
    raw = _load_json(path, "pinned KiCad toolchain policy")
    if not isinstance(raw, Mapping):
        raise ValidationError("pinned KiCad toolchain policy must be an object")
    difference = _schema_difference(raw, _TOOLCHAIN_ROOT_KEYS)
    if difference:
        raise ValidationError(f"toolchain policy root has {difference}")
    if type(raw.get("schemaVersion")) is not int or raw.get("schemaVersion") != 1:
        raise ValidationError("toolchain schemaVersion must be integer 1")
    project = raw.get("project")
    if not isinstance(project, str) or _PROJECT_STEM_PATTERN.fullmatch(project) is None:
        raise ValidationError(
            f"invalid toolchain project name {project!r}; expected [A-Za-z0-9_-]+"
        )
    kicad = raw.get("kicad")
    if not isinstance(kicad, Mapping):
        raise ValidationError("toolchain kicad policy must be an object")
    difference = _schema_difference(kicad, _TOOLCHAIN_KICAD_KEYS)
    if difference:
        raise ValidationError(f"toolchain kicad policy has {difference}")
    if type(kicad.get("major")) is not int or kicad.get("major") != _EXPECTED_MAJOR:
        raise ValidationError(f"toolchain KiCad major must be {_EXPECTED_MAJOR}")
    if kicad.get("minimum") != _EXPECTED_MINIMUM:
        raise ValidationError(f"toolchain KiCad minimum must be {_EXPECTED_MINIMUM}")
    return project


def _required_sources(project_dir: Path, project: str) -> tuple[Path, ...]:
    editable = editable_project_files(project_dir, project_name=project)
    by_relative = {path.relative_to(project_dir).as_posix(): path for path in editable}
    required = tuple(f"{project}{suffix}" for suffix in (".kicad_pro", ".kicad_sch", ".kicad_pcb"))
    for name in required:
        path = by_relative.get(name)
        if path is None or path.parent != project_dir:
            raise ValidationError(f"native KiCad project source is missing: {project_dir / name}")
    for policy_name in ("toolchain.json", "mechanical_contract.json", "validation_waivers.json"):
        policy_path = project_dir / policy_name
        if policy_path.is_symlink() or not policy_path.is_file():
            raise ValidationError(f"required validation source is missing or a symlink: {policy_path}")
    for path in editable:
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        forbidden = find_forbidden_machine_paths(text)
        if forbidden:
            raise ValidationError(
                f"editable source {path.relative_to(project_dir)} contains forbidden "
                f"machine path(s): {', '.join(forbidden)}"
            )
    return editable


def _runner_environment() -> dict[str, str]:
    environment = dict(os.environ)
    environment["LANG"] = "C"
    environment["LC_ALL"] = "C"
    return environment


def _run(
    runner: _Runner,
    command: Sequence[str],
    *,
    cwd: Path,
    timeout: int,
    label: str,
) -> object:
    try:
        result = runner(
            list(command),
            cwd=cwd,
            text=True,
            capture_output=True,
            check=False,
            timeout=timeout,
            env=_runner_environment(),
        )
    except subprocess.TimeoutExpired as error:
        raise ValidationError(f"{label} timed out after {timeout} seconds") from error
    except OSError as error:
        raise ValidationError(f"{label} could not start: {error}") from error
    returncode = getattr(result, "returncode", None)
    if returncode != 0:
        stderr = str(getattr(result, "stderr", "") or "").strip()
        stdout = str(getattr(result, "stdout", "") or "").strip()
        detail = stderr or stdout or "no command output"
        raise ValidationError(f"{label} command failure (status {returncode}): {detail}")
    return result


def _find_kicad_cli(runner: _Runner, project_dir: Path) -> str:
    checked: list[str] = []
    seen: set[str] = set()
    for candidate in _kicad_cli_candidates():
        candidate = str(Path(candidate).expanduser())
        if candidate in seen:
            continue
        seen.add(candidate)
        path = Path(candidate)
        if not path.is_file() or not os.access(path, os.X_OK):
            checked.append(f"{candidate} (missing)")
            continue
        try:
            result = _run(
                runner,
                (candidate, "--version"),
                cwd=project_dir,
                timeout=KICAD_VERSION_TIMEOUT_SECONDS,
                label=f"KiCad version probe using {candidate}",
            )
        except ValidationError as error:
            checked.append(str(error))
            continue
        version_text = str(getattr(result, "stdout", "") or getattr(result, "stderr", "")).strip()
        try:
            version = _version_tuple(version_text)
        except RuntimeError:
            checked.append(f"{candidate} (unparseable version {version_text!r})")
            continue
        if version[0] != _EXPECTED_MAJOR or version < _version_tuple(_EXPECTED_MINIMUM):
            checked.append(f"{candidate} ({version_text})")
            continue
        return candidate
    raise ValidationError(
        f"cannot locate KiCad {_EXPECTED_MAJOR} >= {_EXPECTED_MINIMUM} kicad-cli; "
        f"checked: {', '.join(checked) if checked else 'no candidates'}"
    )


def _list(value: object, context: str, *, nonempty: bool = False) -> list[object]:
    if not isinstance(value, list):
        raise ValidationError(f"{context} must be an array")
    if nonempty and not value:
        raise ValidationError(f"{context} must not be empty")
    return value


def _required_list(
    value: Mapping[str, object], key: str, context: str, *, nonempty: bool = False
) -> list[object]:
    if key not in value:
        raise ValidationError(f"{context} is missing {key}")
    return _list(value[key], f"{context}.{key}", nonempty=nonempty)


def _normalize_violation(raw: object, scope: str, context: str) -> dict[str, object]:
    if not isinstance(raw, Mapping):
        raise ValidationError(f"{context} must be an object")
    severity = raw.get("severity")
    kind = raw.get("type")
    if severity not in ("error", "warning"):
        raise ValidationError(f"{context}.severity is unsupported: {severity!r}")
    if not isinstance(kind, str) or not kind:
        raise ValidationError(f"{context}.type must be a nonempty string")
    raw_items = _list(raw.get("items"), f"{context}.items", nonempty=True)
    items: list[dict[str, str]] = []
    for index, raw_item in enumerate(raw_items):
        if not isinstance(raw_item, Mapping):
            raise ValidationError(f"{context}.items[{index}] must be an object")
        uuid = raw_item.get("uuid")
        if not isinstance(uuid, str) or not uuid:
            raise ValidationError(f"{context}.items[{index}].uuid must be nonempty")
        items.append({"uuid": uuid})
    items.sort(key=lambda item: item["uuid"])
    return {"scope": scope, "severity": severity, "type": kind, "items": items}


def _read_report_json(path: Path, context: str) -> Mapping[str, object]:
    raw = _load_json(path, context)
    if not isinstance(raw, Mapping):
        raise ValidationError(f"{context} must be a JSON object")
    return raw


def _validate_report_header(raw: Mapping[str, object], report_name: str) -> None:
    expected_schema = f"https://schemas.kicad.org/{report_name}.v1.json"
    if raw.get("$schema") != expected_schema:
        raise ValidationError(f"{report_name.upper()} report has unexpected or missing $schema")
    if not isinstance(raw.get("coordinate_units"), str):
        raise ValidationError(f"{report_name.upper()} report is missing coordinate_units")
    version_text = raw.get("kicad_version")
    if not isinstance(version_text, str):
        raise ValidationError(f"{report_name.upper()} report is missing kicad_version")
    try:
        version = _version_tuple(version_text)
    except RuntimeError as error:
        raise ValidationError(f"{report_name.upper()} report has invalid kicad_version") from error
    if version[0] != _EXPECTED_MAJOR or version < _version_tuple(_EXPECTED_MINIMUM):
        raise ValidationError(f"{report_name.upper()} report came from unsupported KiCad {version_text}")


def _parse_erc_report(path: Path) -> dict[str, object]:
    raw = _read_report_json(path, "ERC report")
    _validate_report_header(raw, "erc")
    sheets = _required_list(raw, "sheets", "ERC report", nonempty=True)
    violations: list[dict[str, object]] = []
    for sheet_index, sheet in enumerate(sheets):
        if not isinstance(sheet, Mapping):
            raise ValidationError(f"ERC report.sheets[{sheet_index}] must be an object")
        if not isinstance(sheet.get("path"), str) or not isinstance(sheet.get("uuid_path"), str):
            raise ValidationError(f"ERC report.sheets[{sheet_index}] is missing path/uuid_path")
        for index, item in enumerate(
            _required_list(sheet, "violations", f"ERC report.sheets[{sheet_index}]")
        ):
            violations.append(
                _normalize_violation(item, "ERC", f"ERC violation {sheet_index}.{index}")
            )
    violations.sort(key=violation_fingerprint)
    return {"violations": violations, "toolVersion": raw["kicad_version"]}


def _normalize_unconnected(raw: object, context: str) -> dict[str, str]:
    if not isinstance(raw, Mapping):
        raise ValidationError(f"{context} must be an object")
    uuid = raw.get("uuid")
    if not isinstance(uuid, str) or not uuid:
        raise ValidationError(f"{context}.uuid must be nonempty")
    return {"uuid": uuid}


def _parse_drc_report(path: Path) -> tuple[dict[str, object], dict[str, object], dict[str, object]]:
    raw = _read_report_json(path, "DRC report")
    _validate_report_header(raw, "drc")
    drc = [
        _normalize_violation(item, "DRC", f"DRC violation {index}")
        for index, item in enumerate(_required_list(raw, "violations", "DRC report"))
    ]
    parity = [
        _normalize_violation(item, "parity", f"parity violation {index}")
        for index, item in enumerate(
            _required_list(raw, "schematic_parity", "DRC report")
        )
    ]
    unconnected = [
        _normalize_unconnected(item, f"unconnected item {index}")
        for index, item in enumerate(
            _required_list(raw, "unconnected_items", "DRC report")
        )
    ]
    drc.sort(key=violation_fingerprint)
    parity.sort(key=violation_fingerprint)
    unconnected.sort(key=lambda item: item["uuid"])
    version = raw["kicad_version"]
    return (
        {"violations": drc, "toolVersion": version},
        {"violations": parity, "toolVersion": version},
        {"items": unconnected},
    )


def _validate_output_dir(output_dir: str | Path | None, project_dir: Path) -> Path | None:
    if output_dir is None:
        return None
    raw = Path(output_dir).expanduser()
    if raw.is_symlink():
        raise ValidationError(f"output directory is a symlink: {raw}")
    resolved = raw.resolve(strict=False)
    if resolved == project_dir or project_dir in resolved.parents:
        raise ValidationError(
            f"output directory must not be inside canonical project source: {resolved}"
        )
    return resolved


def _write_json(path: Path, value: object) -> None:
    path.write_text(
        json.dumps(_json_ready(value), indent=2, sort_keys=True, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )


def _publish_reports(output_dir: Path, reports: Mapping[str, object], result: ValidationResult) -> None:
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".pocket-card-validation-", dir=output_dir.parent) as raw_stage:
        stage = Path(raw_stage)
        _write_json(stage / "erc.json", reports["ERC"])
        _write_json(
            stage / "drc.json",
            {
                "DRC": reports["DRC"],
                "parity": reports["parity"],
                "unconnected": reports["unconnected"],
            },
        )
        _write_json(
            stage / "validation.json",
            {
                "status": result.status,
                "messages": result.messages,
                "reports": result.reports,
            },
        )
        output_dir.mkdir(parents=True, exist_ok=True)
        for name in ("erc.json", "drc.json", "validation.json"):
            os.replace(stage / name, output_dir / name)


def _copy_project_sources(sources: Iterable[Path], project_dir: Path, destination: Path) -> None:
    for source in sources:
        relative = source.relative_to(project_dir)
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    for name in ("toolchain.json", "mechanical_contract.json", "validation_waivers.json"):
        shutil.copy2(project_dir / name, destination / name)


def _invalid_result(message: str, reports: Mapping[str, object] | None = None) -> ValidationResult:
    return ValidationResult(INVALID, (message,), reports or {}, None)


def validate_project(
    project_dir: str | Path,
    output_dir: str | Path | None = None,
    runner: _Runner = subprocess.run,
) -> ValidationResult:
    """Validate a complete temporary copy without ever asking KiCad to save it."""

    raw_project_dir = Path(project_dir).expanduser()
    try:
        if raw_project_dir.is_symlink():
            raise ValidationError(f"editable project path is a symlink: {raw_project_dir}")
        canonical = raw_project_dir.resolve(strict=True)
        if not canonical.is_dir():
            raise ValidationError(f"editable project root is not a directory: {canonical}")
        before_digest = project_digest(canonical)
    except (OSError, RuntimeError, ValueError, ValidationError) as error:
        return _invalid_result(str(error))

    result: ValidationResult
    normalized_reports: dict[str, object] = {}
    publish_to: Path | None = None
    try:
        project = _validate_toolchain(canonical)
        sources = _required_sources(canonical, project)
        publish_to = _validate_output_dir(output_dir, canonical)
        executable = _find_kicad_cli(runner, canonical)
        with tempfile.TemporaryDirectory(prefix="pocket-card-validation-") as raw_temporary:
            temporary = Path(raw_temporary)
            _copy_project_sources(sources, canonical, temporary)
            schematic = temporary / f"{project}.kicad_sch"
            board = temporary / f"{project}.kicad_pcb"
            project_file = temporary / f"{project}.kicad_pro"
            if not project_file.is_file() or schematic.parent != project_file.parent or board.parent != project_file.parent:
                raise ValidationError("temporary KiCad copy is incomplete or not co-located")
            erc_path = temporary / "erc.json"
            drc_path = temporary / "drc.json"
            netlist_path = temporary / f"{project}.net"
            _run(
                runner,
                (
                    executable,
                    "sch",
                    "erc",
                    "--format",
                    "json",
                    "--severity-all",
                    "--output",
                    str(erc_path),
                    str(schematic),
                ),
                cwd=temporary,
                timeout=_COMMAND_TIMEOUT_SECONDS,
                label="KiCad ERC",
            )
            _run(
                runner,
                (
                    executable,
                    "pcb",
                    "drc",
                    "--schematic-parity",
                    "--format",
                    "json",
                    "--severity-all",
                    "--output",
                    str(drc_path),
                    str(board),
                ),
                cwd=temporary,
                timeout=_COMMAND_TIMEOUT_SECONDS,
                label="KiCad DRC",
            )
            _run(
                runner,
                (
                    executable,
                    "sch",
                    "export",
                    "netlist",
                    "--format",
                    "kicadsexpr",
                    "--output",
                    str(netlist_path),
                    str(schematic),
                ),
                cwd=temporary,
                timeout=KICAD_EXPORT_TIMEOUT_SECONDS,
                label="KiCad netlist export",
            )
            erc = _parse_erc_report(erc_path)
            drc, parity, unconnected = _parse_drc_report(drc_path)
            normalized_reports = {
                "ERC": erc,
                "DRC": drc,
                "parity": parity,
                "unconnected": unconnected,
            }
            schematic_inventory = parse_netlist(netlist_path.read_text(encoding="utf-8"))
            board_inventory = parse_board(board.read_text(encoding="utf-8"))
            inventory = ProjectInventory(schematic_inventory, board_inventory)
            inventory_errors = compare_schematic_to_board(
                schematic_inventory, board_inventory
            )
            contract = load_contract(temporary / "mechanical_contract.json")
            mechanical_findings = tuple(
                sorted(
                    (
                        *check_contract_against_case_params(contract),
                        *check_mechanics(contract, board_inventory),
                    )
                )
            )
            waivers = load_waivers(temporary / "validation_waivers.json")
            classified = classify_reports(
                normalized_reports,
                waivers,
                inventory_errors=inventory_errors,
                mechanical_findings=mechanical_findings,
            )
            result = ValidationResult(
                classified.status,
                classified.messages,
                classified.reports,
                inventory,
            )
    except (OSError, RuntimeError, UnicodeError, ValueError, ValidationError) as error:
        result = _invalid_result(str(error), normalized_reports)

    try:
        after_digest = project_digest(canonical)
    except (OSError, RuntimeError, ValueError) as error:
        return _invalid_result(f"cannot verify canonical source digest after validation: {error}")
    if after_digest != before_digest:
        return _invalid_result(
            f"canonical project mutation detected: digest changed from {before_digest} to {after_digest}",
            normalized_reports,
        )

    reports_with_source = dict(_json_ready(result.reports))
    reports_with_source["source"] = {
        "digestBefore": before_digest,
        "digestAfter": after_digest,
        "unchanged": True,
    }
    result = ValidationResult(
        result.status,
        result.messages,
        reports_with_source,
        result.inventory,
    )
    if publish_to is not None and normalized_reports:
        try:
            _publish_reports(publish_to, normalized_reports, result)
        except OSError as error:
            return _invalid_result(f"cannot publish validation reports to {publish_to}: {error}")
    return result


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--project-dir",
        type=Path,
        default=ELECTRONICS_DIR,
        help="native KiCad project directory (default: canonical Pocket Card project)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="optional derived-report output directory outside the project source",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        result = validate_project(args.project_dir, output_dir=args.output_dir)
    except (OSError, RuntimeError, ValueError, ValidationError) as error:
        result = _invalid_result(str(error))
    print(result.render_text())
    return _EXIT_CODES[result.status]


if __name__ == "__main__":
    raise SystemExit(main())
