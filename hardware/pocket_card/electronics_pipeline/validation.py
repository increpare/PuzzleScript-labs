"""Read-only native KiCad validation for the Pocket Card controller project."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
import uuid
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType

try:
    import fcntl as _fcntl
except ImportError:  # Windows has no POSIX advisory-locking module.
    _fcntl = None

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
from .kicad_sexpr import SexprError, direct_children, expression_atoms, next_token, one_root
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
_EXPECTED_WARNING_POLICY = MappingProxyType(
    {
        ("ERC", "endpoint_off_grid"): (
            71,
            "9cb699ba1827fa447483e85c111b392f22e217ca02e4866e408ed0872bb57384",
        ),
        ("ERC", "lib_symbol_issues"): (
            19,
            "078197b8ae3f4753b71a8329cec228bc7b895e147329d8cbde9b347336490eb9",
        ),
        ("DRC", "via_dangling"): (
            2,
            "27b20d9750762cbf26cbf4343b6f0bc3542faea666c8c26b8b3f107ddc67ff95",
        ),
        ("DRC", "silk_edge_clearance"): (
            163,
            "2ab9120f0ff908b419033b6765ce4be49f0634795c1d20c4b61a36592c196d39",
        ),
        ("DRC", "silk_overlap"): (
            199,
            "bb8c204cb57e95e9230625dde888cc15f56afeaffbd4a15894e77b240c431e9d",
        ),
        ("DRC", "silk_over_copper"): (
            21,
            "1ef1749815a28e02b61e4e3650689beae9ee9101c66bec3acd61d6f30521de32",
        ),
        ("DRC", "nonmirrored_text_on_back_layer"): (
            4,
            "d54988b0fd8a967b1c1526fbae6d064316605bca07fe8ccfbc072ef2938421b3",
        ),
        ("parity", "footprint_symbol_mismatch"): (
            32,
            "9c0f14314f30187bc131e9a9d693cb40e81b98f2d19ff38b9164f49a08187e23",
        ),
        ("parity", "net_conflict"): (
            90,
            "f0cd0a9a2d6da3052181b7f0e848d6be7a3a1a02d775cf27413a65effdfdc527",
        ),
        ("parity", "footprint_symbol_field_mismatch"): (
            3,
            "2f617d41d767197016f3ea21e1afe06954dab08d4ff677feec0ca23a9d2483b6",
        ),
    }
)
_EXPECTED_WARNING_RATIONALES = MappingProxyType(
    {
        ("ERC", "endpoint_off_grid"): "Historical generated symbol/grid layout.",
        ("ERC", "lib_symbol_issues"): "Historical generated symbol/grid layout.",
        ("DRC", "via_dangling"): "Dangling vias remain visible for engineer disposition.",
        ("DRC", "silk_edge_clearance"): "Intentionally dense decorative silk.",
        ("DRC", "silk_overlap"): "Intentionally dense decorative silk.",
        ("DRC", "silk_over_copper"): "Intentionally dense decorative silk.",
        ("DRC", "nonmirrored_text_on_back_layer"): "Intentionally dense decorative silk.",
        ("parity", "footprint_symbol_mismatch"): "Historical library-prefix, board-value, and leading-slash mismatch; normalized UUID/pad/net comparison passes.",
        ("parity", "net_conflict"): "Historical library-prefix, board-value, and leading-slash mismatch; normalized UUID/pad/net comparison passes.",
        ("parity", "footprint_symbol_field_mismatch"): "Historical library-prefix, board-value, and leading-slash mismatch; normalized UUID/pad/net comparison passes.",
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
    _, errors = _validated_waiver_groups(value)
    if errors:
        raise ValueError("invalid validation waiver policy: " + "; ".join(errors))
    frozen = _freeze(value)
    assert isinstance(frozen, Mapping)
    return frozen


def _require_safe_token(
    value: object,
    context: str,
    error_type: type[Exception] = ValueError,
) -> str:
    if (
        not isinstance(value, str)
        or not value
        or value != value.strip()
        or "|" in value
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        raise error_type(
            f"{context} must be a nonempty safe token without padding, delimiters, or controls"
        )
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
    kind = _require_safe_token(kind, f"{scope} violation type")
    if not isinstance(items, (tuple, list)) or not items:
        raise ValueError(f"{scope}/{kind} violation items must be a nonempty array")
    uuids: list[str] = []
    for index, item in enumerate(items):
        if not isinstance(item, Mapping):
            raise ValueError(f"{scope}/{kind} item {index} must be an object")
        uuid = _require_safe_token(
            item.get("uuid"), f"{scope}/{kind} item {index} UUID"
        )
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
        try:
            kind = _require_safe_token(kind, f"{context} type")
        except ValueError as error:
            errors.append(str(error))
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
            if key not in _EXPECTED_WARNING_POLICY:
                errors.append(f"unknown waiver group {key[0]}/{key[1]}")
            elif key in groups:
                errors.append(f"duplicate waiver group {key[0]}/{key[1]}")
            else:
                groups[key] = raw
                expected_count, expected_digest = _EXPECTED_WARNING_POLICY[key]
                if count != expected_count:
                    errors.append(
                        f"waiver group {key[0]}/{key[1]} count must be exact approved value "
                        f"{expected_count}, found {count}"
                    )
                if digest != expected_digest:
                    errors.append(
                        f"waiver group {key[0]}/{key[1]} digest must be exact approved value "
                        f"{expected_digest}, found {digest}"
                    )
                expected_rationale = _EXPECTED_WARNING_RATIONALES[key]
                if rationale != expected_rationale:
                    errors.append(
                        f"waiver group {key[0]}/{key[1]} rationale must be exact approved category text"
                    )
    actual_keys = frozenset(groups)
    expected_keys = frozenset(_EXPECTED_WARNING_POLICY)
    missing_groups = sorted(expected_keys - actual_keys)
    extra_groups = sorted(actual_keys - expected_keys)
    if missing_groups or extra_groups:
        details: list[str] = []
        if missing_groups:
            details.append(
                "missing " + ", ".join(f"{scope}/{kind}" for scope, kind in missing_groups)
            )
        if extra_groups:
            details.append(
                "unexpected " + ", ".join(f"{scope}/{kind}" for scope, kind in extra_groups)
            )
        errors.append("waiver policy group set mismatch: " + "; ".join(details))
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
    for policy_name in (
        "toolchain.json",
        "mechanical_contract.json",
        "validation_waivers.json",
        "fp-lib-table",
    ):
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


def _parse_fp_lib_table(path: Path) -> Mapping[str, str]:
    try:
        source = path.read_text(encoding="utf-8")
        root = one_root(source, "fp_lib_table")
        children = direct_children(root.text)
    except (OSError, UnicodeError, SexprError) as error:
        raise ValidationError(f"malformed fp-lib-table root: {error}") from error
    if _direct_atoms_after_name(root.text):
        raise ValidationError("fp-lib-table root has unexpected direct atom values")
    version_blocks = [child for child in children if child.name == "version"]
    unknown = sorted({child.name for child in children if child.name not in {"version", "lib"}})
    if unknown:
        raise ValidationError(f"fp-lib-table has unknown direct entries: {', '.join(unknown)}")
    if len(version_blocks) != 1 or expression_atoms(version_blocks[0].text, 3) != ("version", "7"):
        raise ValidationError("fp-lib-table requires exactly one (version 7) entry")
    libraries: dict[str, str] = {}
    allowed_fields = {"name", "type", "uri", "options", "descr"}
    for index, block in enumerate(child for child in children if child.name == "lib"):
        fields: dict[str, str] = {}
        try:
            properties = direct_children(block.text)
        except SexprError as error:
            raise ValidationError(f"fp-lib-table lib {index} is malformed: {error}") from error
        if _direct_atoms_after_name(block.text):
            raise ValidationError(f"fp-lib-table lib {index} has unexpected direct atom values")
        for property_block in properties:
            key = property_block.name
            atoms = expression_atoms(property_block.text, 3)
            if key not in allowed_fields:
                raise ValidationError(f"fp-lib-table lib {index} has unknown field {key!r}")
            if key in fields:
                raise ValidationError(f"fp-lib-table lib {index} has duplicate field {key!r}")
            if (
                len(atoms) != 2
                or atoms[0] != key
                or direct_children(property_block.text)
            ):
                raise ValidationError(f"fp-lib-table lib {index} field {key!r} must have one value")
            fields[key] = atoms[1]
        for key in ("name", "type", "uri"):
            value = fields.get(key)
            if not isinstance(value, str) or not value.strip() or value != value.strip():
                raise ValidationError(f"fp-lib-table lib {index} has empty or padded {key}")
        if fields["type"] != "KiCad":
            raise ValidationError(
                f"fp-lib-table lib {index} type must be exactly 'KiCad'"
            )
        nickname = fields["name"]
        if nickname in libraries:
            raise ValidationError(f"fp-lib-table has duplicate nickname {nickname!r}")
        uri = fields["uri"]
        if not uri.startswith(("${KIPRJMOD}/", "${KICAD10_FOOTPRINT_DIR}/")):
            raise ValidationError(
                f"fp-lib-table nickname {nickname!r} URI is not a portable project or KiCad 10 path"
            )
        libraries[nickname] = uri
    return MappingProxyType(dict(sorted(libraries.items())))


def _direct_atoms_after_name(expression: str) -> tuple[str, ...]:
    children = direct_children(expression)
    child_ends = {child.start: child.end for child in children}
    opening = next_token(expression, 0)
    if opening is None:
        return ()
    name = next_token(expression, opening.end)
    if name is None:
        return ()
    index = name.end
    atoms: list[str] = []
    while True:
        token = next_token(expression, index)
        if token is None or token.kind == "close":
            break
        if token.kind == "open":
            child_end = child_ends.get(token.start)
            if child_end is None:
                raise SexprError(f"unexpected nested expression at index {token.start}")
            index = child_end
            continue
        atoms.append(token.value or "")
        index = token.end
    return tuple(atoms)


_LOCAL_FILE_SUFFIXES = frozenset(
    {".kicad_mod", ".kicad_sym", ".lib", ".dcm", ".step", ".stp", ".wrl"}
)


def _require_safe_path_component(value: str, context: str) -> str:
    if (
        not value
        or value in (".", "..")
        or value != value.strip()
        or any(character in value for character in ("/", "\\", ":"))
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        raise ValidationError(
            f"{context} must be a safe POSIX path component without traversal, separators, or controls"
        )
    return value


def _safe_relative_parts(relative_text: str, context: str) -> tuple[str, ...]:
    if "\\" in relative_text:
        raise ValidationError(f"{context} contains a backslash instead of POSIX separators")
    parts = tuple(relative_text.split("/"))
    for part in parts:
        _require_safe_path_component(part, context)
    return parts


def _resolve_kiprjmod_reference(project_dir: Path, reference: str, context: str) -> Path:
    prefix = "${KIPRJMOD}/"
    if not reference.startswith(prefix):
        raise ValidationError(f"{context} has malformed ${{KIPRJMOD}} reference {reference!r}")
    relative_text = reference[len(prefix) :]
    parts = _safe_relative_parts(relative_text, context)
    candidate = project_dir.joinpath(*parts)
    cursor = project_dir
    for part in parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise ValidationError(f"{context} resolves through symlink {cursor}")
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as error:
        expected_kind = "directory" if candidate.suffix.lower() == ".pretty" else "file"
        raise ValidationError(
            f"{context} references missing local {expected_kind} {relative_text!r}"
        ) from error
    try:
        resolved.relative_to(project_dir)
    except ValueError as error:
        raise ValidationError(f"{context} reference escapes copied project: {reference!r}") from error
    suffix = resolved.suffix.lower()
    if suffix == ".pretty":
        if not resolved.is_dir():
            raise ValidationError(f"{context} expected local footprint directory: {relative_text!r}")
    elif suffix in _LOCAL_FILE_SUFFIXES:
        if not resolved.is_file():
            raise ValidationError(f"{context} expected local asset file: {relative_text!r}")
    else:
        raise ValidationError(f"{context} has unsupported local asset type: {relative_text!r}")
    return resolved


def _resolve_kicad_footprint_root(kicad_cli: str) -> Path:
    configured = os.environ.get("KICAD10_FOOTPRINT_DIR")
    if configured is not None:
        if not configured or configured != configured.strip():
            raise ValidationError("KICAD10_FOOTPRINT_DIR must name one existing directory")
        candidates = (Path(configured),)
    else:
        executable = Path(kicad_cli).resolve(strict=True)
        candidates = (
            executable.parent.parent / "SharedSupport" / "footprints",
            executable.parent.parent / "share" / "kicad" / "footprints",
            Path("/usr/share/kicad/footprints"),
            Path("/usr/local/share/kicad/footprints"),
        )
    for candidate in candidates:
        if candidate.is_symlink() or not candidate.is_dir():
            continue
        try:
            return candidate.resolve(strict=True)
        except OSError:
            continue
    raise ValidationError("KiCad 10 footprint library root is unavailable")


def _resolve_footprint_library(
    project_dir: Path,
    uri: str,
    nickname: str,
    kicad_cli: str,
) -> Path:
    context = f"fp-lib-table nickname {nickname!r}"
    project_prefix = "${KIPRJMOD}/"
    builtin_prefix = "${KICAD10_FOOTPRINT_DIR}/"
    if uri.startswith(project_prefix):
        relative_text = uri[len(project_prefix) :]
        parts = _safe_relative_parts(relative_text, context)
        if not parts[-1].endswith(".pretty"):
            raise ValidationError(f"{context} local URI must end in .pretty")
        resolved = _resolve_kiprjmod_reference(project_dir, uri, context)
        if resolved.suffix.lower() != ".pretty" or not resolved.is_dir():
            raise ValidationError(f"{context} must reference a .pretty directory")
        return resolved
    if uri.startswith(builtin_prefix):
        library_name = uri[len(builtin_prefix) :]
        if "\\" in library_name:
            raise ValidationError(f"{context} built-in URI contains a backslash")
        _require_safe_path_component(library_name, f"{context} built-in URI")
        if not library_name.endswith(".pretty"):
            raise ValidationError(f"{context} built-in URI must end in .pretty")
        root = _resolve_kicad_footprint_root(kicad_cli)
        candidate = root / library_name
        if candidate.is_symlink() or not candidate.is_dir():
            raise ValidationError(
                f"{context} references unavailable built-in library {library_name!r}"
            )
        resolved = candidate.resolve(strict=True)
        try:
            resolved.relative_to(root)
        except ValueError as error:
            raise ValidationError(f"{context} built-in library escapes its root") from error
        return resolved
    raise ValidationError(
        f"{context} URI must use KIPRJMOD or KICAD10_FOOTPRINT_DIR exactly"
    )


def _kiprjmod_references(source: str) -> tuple[str, ...]:
    references: set[str] = set()
    index = 0
    while True:
        token = next_token(source, index)
        if token is None:
            break
        index = token.end
        if token.kind != "atom" or token.value is None or "${KIPRJMOD}" not in token.value:
            continue
        if not token.value.startswith("${KIPRJMOD}"):
            raise ValidationError(
                f"${{KIPRJMOD}} must begin its path atom, found {token.value!r}"
            )
        references.add(token.value)
    return tuple(sorted(references))


def _validate_local_assets(
    project_dir: Path, project: str, kicad_cli: str
) -> Mapping[str, Path]:
    project_dir = project_dir.resolve(strict=True)
    table = _parse_fp_lib_table(project_dir / "fp-lib-table")
    libraries = {
        nickname: _resolve_footprint_library(project_dir, uri, nickname, kicad_cli)
        for nickname, uri in table.items()
    }
    for source_path in editable_project_files(project_dir, project_name=project):
        try:
            source = source_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for reference in _kiprjmod_references(source):
            _resolve_kiprjmod_reference(
                project_dir,
                reference,
                f"editable source {source_path.relative_to(project_dir)}",
            )
    return MappingProxyType(dict(sorted(libraries.items())))


def _footprint_nickname_errors(
    inventory: ProjectInventory | object, libraries: Mapping[str, Path]
) -> tuple[str, ...]:
    schematic = getattr(inventory, "schematic", inventory)
    components = getattr(schematic, "components", {})
    errors: list[str] = []
    for ref, component in sorted(components.items()):
        footprint = component.footprint
        if ":" not in footprint:
            errors.append(f"{ref} footprint {footprint!r} has no library nickname")
            continue
        nickname = footprint.split(":", 1)[0]
        if not nickname or nickname not in libraries:
            errors.append(
                f"{ref} footprint {footprint!r} uses missing project-local library nickname {nickname!r}"
            )
            continue
        module = footprint.split(":", 1)[1]
        try:
            _require_safe_path_component(module, f"{ref} footprint module")
        except ValidationError as error:
            errors.append(str(error))
            continue
        library = libraries[nickname]
        module_path = library / f"{module}.kicad_mod"
        if module_path.is_symlink() or not module_path.is_file():
            errors.append(
                f"{ref} footprint {footprint!r} exact module {module!r} is unavailable"
            )
            continue
        try:
            module_path.resolve(strict=True).relative_to(library)
        except (OSError, ValueError):
            errors.append(
                f"{ref} footprint {footprint!r} exact module {module!r} is unsafe"
            )
    return tuple(errors)


def _runner_environment() -> dict[str, str]:
    environment = dict(os.environ)
    environment["LANG"] = "C"
    environment["LC_ALL"] = "C"
    return environment


_DIAGNOSTIC_STREAM_LIMIT = 8192


def _bounded_stream(value: object) -> str:
    text = str(value or "").strip()
    if len(text) <= _DIAGNOSTIC_STREAM_LIMIT:
        return text
    omitted = len(text) - _DIAGNOSTIC_STREAM_LIMIT
    return (
        text[:_DIAGNOSTIC_STREAM_LIMIT]
        + f"\n[truncated {omitted} characters]"
    )


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
        stderr = _bounded_stream(getattr(result, "stderr", ""))
        stdout = _bounded_stream(getattr(result, "stdout", ""))
        streams = []
        if stderr:
            streams.append(f"stderr: {stderr}")
        if stdout:
            streams.append(f"stdout: {stdout}")
        detail = "; ".join(streams) or "no command output"
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
        version_text = _bounded_stream(
            getattr(result, "stdout", "") or getattr(result, "stderr", "")
        )
        try:
            version = _version_tuple(version_text)
        except RuntimeError:
            checked.append(f"{candidate} (unparseable version {version_text!r})")
            continue
        if version[0] != _EXPECTED_MAJOR or version < _version_tuple(_EXPECTED_MINIMUM):
            checked.append(f"{candidate} ({version_text})")
            continue
        return candidate
    checked_text = _bounded_stream(", ".join(checked)) if checked else "no candidates"
    raise ValidationError(
        f"cannot locate KiCad {_EXPECTED_MAJOR} >= {_EXPECTED_MINIMUM} kicad-cli; "
        f"checked: {checked_text}"
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
    kind = _require_safe_token(kind, f"{context}.type", ValidationError)
    raw_items = _list(raw.get("items"), f"{context}.items", nonempty=True)
    items: list[dict[str, str]] = []
    for index, raw_item in enumerate(raw_items):
        if not isinstance(raw_item, Mapping):
            raise ValidationError(f"{context}.items[{index}] must be an object")
        uuid = _require_safe_token(
            raw_item.get("uuid"),
            f"{context}.items[{index}].uuid",
            ValidationError,
        )
        items.append({"uuid": uuid})
    items.sort(key=lambda item: item["uuid"])
    return {"scope": scope, "severity": severity, "type": kind, "items": items}


def _read_report_json(path: Path, context: str) -> Mapping[str, object]:
    if path.is_symlink() or not path.is_file():
        raise ValidationError(f"{context} was not created")
    raw = _load_json(path, context)
    if not isinstance(raw, Mapping):
        raise ValidationError(f"{context} must be a JSON object")
    return raw


def _validate_report_header(raw: Mapping[str, object], report_name: str) -> None:
    expected_schema = f"https://schemas.kicad.org/{report_name}.v1.json"
    if raw.get("$schema") != expected_schema:
        raise ValidationError(f"{report_name.upper()} report has unexpected or missing $schema")
    coordinate_units = raw.get("coordinate_units")
    if (
        not isinstance(coordinate_units, str)
        or not coordinate_units.strip()
        or coordinate_units != coordinate_units.strip()
    ):
        raise ValidationError(
            f"{report_name.upper()} report coordinate_units must be a nonempty string"
        )
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
        for field in ("path", "uuid_path"):
            value = sheet.get(field)
            if (
                not isinstance(value, str)
                or not value.strip()
                or value != value.strip()
            ):
                raise ValidationError(
                    f"ERC report.sheets[{sheet_index}].{field} must be a nonempty string"
                )
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
    uuid = _require_safe_token(raw.get("uuid"), f"{context}.uuid", ValidationError)
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
    if (
        resolved == project_dir
        or project_dir in resolved.parents
        or resolved in project_dir.parents
    ):
        raise ValidationError(
            f"output directory must not be the canonical project, its ancestor, or inside it: {resolved}"
        )
    return resolved


def _write_json(path: Path, value: object) -> None:
    content = json.dumps(
        _json_ready(value), indent=2, sort_keys=True, ensure_ascii=True
    ) + "\n"
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _noop() -> None:
    return None


_REPORT_FILENAMES = frozenset({"erc.json", "drc.json", "validation.json"})
_TRANSACTION_ID_PATTERN = re.compile(r"[0-9a-f]{32}")


def _directory_identity(path: Path, context: str) -> tuple[int, int]:
    try:
        information = path.stat(follow_symlinks=False)
    except OSError as error:
        raise OSError(f"{context} is unavailable") from error
    if not stat.S_ISDIR(information.st_mode):
        raise OSError(f"{context} must be a real directory")
    return information.st_dev, information.st_ino


def _directory_manifest(path: Path, context: str) -> dict[str, str]:
    manifest: dict[str, str] = {}
    for child in sorted(path.iterdir(), key=lambda item: item.name):
        if child.is_symlink() or not child.is_file():
            raise OSError(f"{context} contains a non-regular entry")
        try:
            content = child.read_bytes()
        except OSError as error:
            raise OSError(f"{context} contains an unreadable entry") from error
        manifest[child.name] = hashlib.sha256(content).hexdigest()
    return manifest


def _journal_identity(value: object, context: str, *, optional: bool = False) -> tuple[int, int] | None:
    if value is None and optional:
        return None
    if (
        not isinstance(value, list)
        or len(value) != 2
        or any(type(item) is not int or item < 0 for item in value)
    ):
        raise OSError(f"transaction journal has invalid {context}")
    return value[0], value[1]


def _journal_manifest(value: object, context: str) -> dict[str, str]:
    if not isinstance(value, Mapping):
        raise OSError(f"transaction journal has invalid {context}")
    result: dict[str, str] = {}
    for name, digest in value.items():
        if (
            not isinstance(name, str)
            or not name
            or "/" in name
            or "\\" in name
            or not isinstance(digest, str)
            or _DIGEST_PATTERN.fullmatch(digest) is None
        ):
            raise OSError(f"transaction journal has invalid {context}")
        result[name] = digest
    return dict(sorted(result.items()))


def _write_transaction_journal(path: Path, value: Mapping[str, object]) -> None:
    transaction = str(value["transaction"])
    temporary = path.with_name(f"{path.name}.{transaction}.tmp")
    try:
        if temporary.exists() or temporary.is_symlink():
            raise OSError("transaction journal temporary file already exists")
        _write_json(temporary, value)
        os.replace(temporary, path)
        _fsync_directory(path.parent)
    except Exception:
        if temporary.is_file() and not temporary.is_symlink():
            temporary.unlink()
        raise


def _read_transaction_journal(path: Path, output_dir: Path) -> dict[str, object]:
    if path.is_symlink() or not path.is_file():
        raise OSError("transaction journal must be a no-follow regular file")
    try:
        raw = json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=_duplicate_rejecting_object,
            parse_constant=_reject_json_constant,
        )
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError) as error:
        raise OSError("transaction journal is malformed") from error
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
        raise OSError("transaction journal has an invalid schema")
    transaction = raw.get("transaction")
    if (
        raw.get("schemaVersion") != 1
        or not isinstance(transaction, str)
        or _TRANSACTION_ID_PATTERN.fullmatch(transaction) is None
        or raw.get("output") != output_dir.name
        or raw.get("stage") != f".{output_dir.name}.stage-{transaction}"
        or raw.get("backup") != f".{output_dir.name}.backup-{transaction}"
        or raw.get("state") not in {"allocated", "prepared", "backed_up", "published"}
        or type(raw.get("hadOutput")) is not bool
    ):
        raise OSError("transaction journal has invalid transaction metadata")
    state = str(raw["state"])
    stage_identity = _journal_identity(
        raw.get("stageIdentity"), "stage identity", optional=state == "allocated"
    )
    backup_identity = _journal_identity(
        raw.get("backupIdentity"), "backup identity", optional=True
    )
    stage_manifest = _journal_manifest(raw.get("stageManifest"), "stage manifest")
    backup_manifest = _journal_manifest(raw.get("backupManifest"), "backup manifest")
    if state == "allocated":
        if stage_identity is not None or stage_manifest:
            raise OSError("allocated transaction journal claims a completed stage")
    elif stage_identity is None or set(stage_manifest) != _REPORT_FILENAMES:
        raise OSError("transaction journal stage manifest is incomplete")
    if bool(raw["hadOutput"]) != (backup_identity is not None):
        raise OSError("transaction journal backup ownership is inconsistent")
    return {
        **raw,
        "stageIdentity": stage_identity,
        "stageManifest": stage_manifest,
        "backupIdentity": backup_identity,
        "backupManifest": backup_manifest,
    }


def _remove_owned_directory(
    path: Path,
    expected_identity: tuple[int, int],
    context: str,
    remove_tree: Callable[[str | Path], object],
) -> None:
    if not path.exists() and not path.is_symlink():
        return
    if _directory_identity(path, context) != expected_identity:
        raise OSError(f"{context} ownership mismatch")
    remove_tree(path)


def _remove_transaction_stage(
    path: Path,
    expected_identity: tuple[int, int] | None,
    state: str,
    context: str,
    remove_tree: Callable[[str | Path], object],
) -> None:
    if expected_identity is not None:
        _remove_owned_directory(path, expected_identity, context, remove_tree)
        return
    if not path.exists() and not path.is_symlink():
        return
    if state != "allocated":
        raise OSError(f"{context} ownership mismatch")
    _directory_identity(path, context)
    remove_tree(path)


def _remove_journal(path: Path) -> None:
    if not path.exists() and not path.is_symlink():
        return
    if path.is_symlink() or not path.is_file():
        raise OSError("transaction journal ownership mismatch")
    path.unlink()
    _fsync_directory(path.parent)


def _transaction_artifacts(output_dir: Path) -> tuple[Path, ...]:
    prefixes = (
        f".{output_dir.name}.stage-",
        f".{output_dir.name}.backup-",
        f".{output_dir.name}.transaction.json.",
    )
    return tuple(
        child
        for child in output_dir.parent.iterdir()
        if any(child.name.startswith(prefix) for prefix in prefixes)
    )


@contextmanager
def _publication_lock(output_dir: Path):
    locking = _fcntl
    if locking is None:
        raise OSError(
            "transactional report publication requires POSIX fcntl locking"
        )
    lock_path = output_dir.parent / f".{output_dir.name}.lock"
    flags = os.O_RDWR | os.O_CREAT
    flags |= getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(lock_path, flags, 0o600)
    except OSError as error:
        raise OSError("validation report writer lock is unsafe or unavailable") from error
    try:
        information = os.fstat(descriptor)
        if not stat.S_ISREG(information.st_mode) or information.st_nlink != 1:
            raise OSError("validation report writer lock must be a regular file")
        try:
            locking.flock(descriptor, locking.LOCK_EX | locking.LOCK_NB)
        except BlockingIOError as error:
            raise OSError("validation report writer is busy") from error
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
            raise OSError("ambiguous report recovery artifacts exist without a journal")
        return
    journal = _read_transaction_journal(journal_path, output_dir)
    stage = output_dir.parent / str(journal["stage"])
    backup = output_dir.parent / str(journal["backup"])
    stage_identity = journal["stageIdentity"]
    backup_identity = journal["backupIdentity"]
    state = str(journal["state"])
    assert stage_identity is None or isinstance(stage_identity, tuple)
    assert backup_identity is None or isinstance(backup_identity, tuple)

    if output_dir.exists() or output_dir.is_symlink():
        _directory_identity(output_dir, "authoritative report output")
        _remove_transaction_stage(
            stage, stage_identity, state, "stale report stage", remove_tree
        )
        if backup_identity is not None:
            _remove_owned_directory(
                backup, backup_identity, "stale report backup", remove_tree
            )
        elif backup.exists() or backup.is_symlink():
            raise OSError("stale report backup ownership mismatch")
        _remove_journal(journal_path)
        return

    if backup_identity is not None:
        if backup.is_symlink():
            raise OSError("report recovery backup ownership mismatch")
        if not backup.exists() and state != "allocated":
            raise OSError("report recovery has no complete owned backup")
        if backup.exists():
            if _directory_identity(backup, "report recovery backup") != backup_identity:
                raise OSError("report recovery backup ownership mismatch")
            if _directory_manifest(backup, "report recovery backup") != journal["backupManifest"]:
                raise OSError("report recovery backup is incomplete")
            rename(backup, output_dir)
            _fsync_directory(output_dir.parent)
    elif backup.exists() or backup.is_symlink():
        raise OSError("report recovery found an unowned backup")

    _remove_transaction_stage(
        stage, stage_identity, state, "stale report stage", remove_tree
    )
    _remove_journal(journal_path)


def _rollback_precommit(
    output_dir: Path,
    stage: Path,
    backup: Path,
    journal_path: Path,
    journal: Mapping[str, object],
    *,
    rename: Callable[[str | Path, str | Path], object],
    remove_tree: Callable[[str | Path], object],
) -> bool:
    stage_identity = journal["stageIdentity"]
    backup_identity = journal["backupIdentity"]
    state = str(journal["state"])
    assert stage_identity is None or isinstance(stage_identity, tuple)
    assert backup_identity is None or isinstance(backup_identity, tuple)
    if output_dir.exists() or output_dir.is_symlink():
        output_identity = _directory_identity(output_dir, "report output")
        if stage_identity is not None and output_identity == stage_identity:
            return True
        if backup_identity is not None and output_identity == backup_identity and not backup.exists():
            _remove_transaction_stage(
                stage,
                stage_identity,
                state,
                "failed report stage",
                remove_tree,
            )
            _remove_journal(journal_path)
            return False
        raise OSError("report output ownership mismatch prevents rollback")
    if backup.is_symlink():
        raise OSError("report backup ownership mismatch prevents rollback")
    if backup_identity is not None and backup.exists():
        if _directory_identity(backup, "report backup") != backup_identity:
            raise OSError("report backup ownership mismatch prevents rollback")
        if _directory_manifest(backup, "report backup") != journal["backupManifest"]:
            raise OSError("report backup is incomplete; rollback refused")
        rename(backup, output_dir)
        _fsync_directory(output_dir.parent)
    elif backup_identity is not None and state != "allocated":
        raise OSError("report backup ownership mismatch prevents rollback")
    _remove_transaction_stage(
        stage, stage_identity, state, "failed report stage", remove_tree
    )
    _remove_journal(journal_path)
    return False


def _publish_reports(
    output_dir: Path,
    reports: Mapping[str, object],
    result: ValidationResult,
    *,
    rename: Callable[[str | Path, str | Path], object] = os.replace,
    after_stage: Callable[[], object] = _noop,
    after_backup: Callable[[], object] = _noop,
    after_publish: Callable[[], object] = _noop,
    after_recovery: Callable[[], object] = _noop,
    remove_tree: Callable[[str | Path], object] = shutil.rmtree,
) -> None:
    """Serialize and atomically publish one crash-recoverable report set."""

    output_dir.parent.mkdir(parents=True, exist_ok=True)
    journal_path = output_dir.parent / f".{output_dir.name}.transaction.json"
    with _publication_lock(output_dir):
        _recover_publication(
            output_dir,
            journal_path,
            rename=rename,
            remove_tree=remove_tree,
        )
        after_recovery()
        if output_dir.is_symlink() or (output_dir.exists() and not output_dir.is_dir()):
            raise OSError("validation output must be a non-symlink directory")

        transaction = uuid.uuid4().hex
        stage = output_dir.parent / f".{output_dir.name}.stage-{transaction}"
        backup = output_dir.parent / f".{output_dir.name}.backup-{transaction}"
        had_output = output_dir.exists()
        backup_identity = (
            _directory_identity(output_dir, "existing report output")
            if had_output
            else None
        )
        backup_manifest = (
            _directory_manifest(output_dir, "existing report output")
            if had_output
            else {}
        )
        journal: dict[str, object] = {
            "schemaVersion": 1,
            "transaction": transaction,
            "output": output_dir.name,
            "stage": stage.name,
            "backup": backup.name,
            "state": "allocated",
            "hadOutput": had_output,
            "stageIdentity": None,
            "stageManifest": {},
            "backupIdentity": backup_identity,
            "backupManifest": backup_manifest,
        }
        _write_transaction_journal(journal_path, journal)
        try:
            stage.mkdir(mode=0o700)
            after_stage()
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
            _fsync_directory(stage)
            stage_identity = _directory_identity(stage, "report stage")
            stage_manifest = _directory_manifest(stage, "report stage")
            if set(stage_manifest) != _REPORT_FILENAMES:
                raise OSError("report stage is incomplete")
            journal["state"] = "prepared"
            journal["stageIdentity"] = stage_identity
            journal["stageManifest"] = stage_manifest
            _write_transaction_journal(journal_path, journal)
            if had_output:
                rename(output_dir, backup)
                _fsync_directory(output_dir.parent)
            journal["state"] = "backed_up"
            _write_transaction_journal(journal_path, journal)
            if had_output:
                after_backup()
            rename(stage, output_dir)
        except Exception as publish_error:
            try:
                committed = _rollback_precommit(
                    output_dir,
                    stage,
                    backup,
                    journal_path,
                    journal,
                    rename=rename,
                    remove_tree=remove_tree,
                )
            except Exception as rollback_error:
                raise OSError(
                    f"report publication failed ({publish_error}); {rollback_error}"
                ) from rollback_error
            if not committed:
                raise
            raise OSError(
                f"report publication committed; cleanup pending: {publish_error}"
            ) from publish_error

        try:
            _fsync_directory(output_dir.parent)
            journal["state"] = "published"
            _write_transaction_journal(journal_path, journal)
            after_publish()
            backup_identity = journal["backupIdentity"]
            if isinstance(backup_identity, tuple):
                _remove_owned_directory(
                    backup,
                    backup_identity,
                    "published report backup",
                    remove_tree,
                )
                _fsync_directory(output_dir.parent)
            _remove_journal(journal_path)
        except Exception as cleanup_error:
            raise OSError(
                f"report publication committed; cleanup pending: {cleanup_error}"
            ) from cleanup_error


def _copy_project_sources(sources: Iterable[Path], project_dir: Path, destination: Path) -> None:
    for source in sources:
        relative = source.relative_to(project_dir)
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    for name in ("toolchain.json", "mechanical_contract.json", "validation_waivers.json"):
        shutil.copy2(project_dir / name, destination / name)


def _sanitize_diagnostic(value: object) -> str:
    message = str(value)
    replacements = {
        str(Path.home()): "<home>",
        tempfile.gettempdir(): "<tmp>",
        str(Path(tempfile.gettempdir()).resolve(strict=False)): "<tmp>",
    }
    for source in sorted(replacements, key=len, reverse=True):
        if source and source != "/":
            message = message.replace(source, replacements[source])
    message = re.sub(
        r"pocket-card-validation-[A-Za-z0-9_-]+",
        "<validation-copy>",
        message,
    )
    return message


def _invalid_result(
    message: str,
    reports: Mapping[str, object] | None = None,
    inventory: ProjectInventory | None = None,
) -> ValidationResult:
    return ValidationResult(
        INVALID,
        (_sanitize_diagnostic(message),),
        reports or {},
        inventory,
    )


def _result_with_error(result: ValidationResult, message: str) -> ValidationResult:
    return ValidationResult(
        INVALID,
        (*result.messages, _sanitize_diagnostic(message)),
        result.reports,
        result.inventory,
    )


def _finalize_result(
    result: ValidationResult,
    canonical: Path | None,
    before_digest: str | None,
) -> ValidationResult:
    after_digest: str | None = None
    digest_error: str | None = None
    if canonical is not None:
        try:
            after_digest = project_digest(canonical)
        except (OSError, RuntimeError, ValueError) as error:
            digest_error = _sanitize_diagnostic(
                f"source digest recomputation failed: {error}"
            )
    if before_digest is not None and after_digest is not None:
        unchanged: bool | None = before_digest == after_digest
    else:
        unchanged = None
        if digest_error is None:
            digest_error = "source digest evidence is incomplete"

    messages = [_sanitize_diagnostic(message) for message in result.messages]
    status = result.status
    if digest_error is not None:
        status = INVALID
        messages.append(digest_error)
    if unchanged is False:
        status = INVALID
        messages.append(
            "canonical project mutation detected: digest changed from "
            f"{before_digest} to {after_digest}"
        )
    finalized_reports = dict(_json_ready(result.reports))
    finalized_reports.update(
        {
            "sourceDigestBefore": before_digest,
            "sourceDigestAfter": after_digest,
            "sourceUnchanged": unchanged,
            "sourceDigestError": digest_error,
        }
    )
    return ValidationResult(
        status,
        tuple(messages),
        finalized_reports,
        result.inventory,
    )


def validate_project(
    project_dir: str | Path,
    output_dir: str | Path | None = None,
    runner: _Runner = subprocess.run,
) -> ValidationResult:
    """Validate a complete temporary copy without ever asking KiCad to save it."""

    raw_project_dir = Path(project_dir).expanduser()
    canonical: Path | None = None
    before_digest: str | None = None
    try:
        if raw_project_dir.is_symlink():
            raise ValidationError(f"editable project path is a symlink: {raw_project_dir}")
        canonical = raw_project_dir.resolve(strict=True)
        if not canonical.is_dir():
            raise ValidationError(f"editable project root is not a directory: {canonical}")
        before_digest = project_digest(canonical)
    except (OSError, RuntimeError, ValueError, ValidationError) as error:
        return _finalize_result(_invalid_result(str(error)), canonical, before_digest)

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
            footprint_libraries = _validate_local_assets(
                temporary, project, executable
            )
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
            nickname_errors = _footprint_nickname_errors(
                schematic_inventory, footprint_libraries
            )
            if nickname_errors:
                raise ValidationError("; ".join(nickname_errors))
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

    result = _finalize_result(result, canonical, before_digest)
    if (
        publish_to is not None
        and normalized_reports
        and result.reports.get("sourceUnchanged") is True
    ):
        try:
            _publish_reports(publish_to, normalized_reports, result)
        except OSError as error:
            result = _result_with_error(
                result, f"cannot publish validation reports: {error}"
            )
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
