#!/usr/bin/env python3
"""Helpers for the checked-in eligible solution cache."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Iterable

VALID_TOKENS = frozenset({"up", "down", "left", "right", "action"})
DEFAULT_CACHE_ROOT = Path("src/tests/solution_cache/eligible")
MANIFEST_NAME = "manifest.json"
TAG_JS_VALID = "js_valid"
TAG_HOST_KNOWN_GOOD = "host_known_good"
# Cart/libmGBA diverges from host for these fixtures (SDCC specialized / crash).
# Thorough cart still replays them, but misses are reported rather than hard-fail.
TAG_CART_QUARANTINE = "cart_quarantine"


def repository_root_from(path: Path) -> Path:
    return path.resolve()


def cache_root(repository: Path, relative: Path | None = None) -> Path:
    return (repository / (relative or DEFAULT_CACHE_ROOT)).resolve()


def manifest_path(root: Path) -> Path:
    return root / MANIFEST_NAME


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def read_tokens(path: Path) -> list[str]:
    tokens = [
        line.strip().lower()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not tokens:
        raise ValueError(f"solution fixture is empty: {path}")
    for token in tokens:
        if token not in VALID_TOKENS:
            raise ValueError(f"unsupported token {token!r} in {path}")
    return tokens


def write_tokens(path: Path, tokens: Iterable[str]) -> None:
    normalized = [str(token).strip().lower() for token in tokens]
    if not normalized:
        raise ValueError("refusing to write empty solution")
    for token in normalized:
        if token not in VALID_TOKENS:
            raise ValueError(f"unsupported token {token!r}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(normalized) + "\n", encoding="utf-8")


def load_manifest(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"manifest root must be an object: {path}")
    entries = payload.get("entries")
    if not isinstance(entries, list):
        raise ValueError(f"manifest.entries must be a list: {path}")
    return payload


def save_manifest(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def filter_entries(
    entries: list[dict[str, Any]],
    *,
    tag: str | None = None,
    slug: str | None = None,
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("manifest entry must be an object")
        tags = entry.get("tags") or []
        if not isinstance(tags, list):
            raise ValueError(f"entry tags must be a list: {entry.get('slug')}")
        if tag is not None and tag not in tags:
            continue
        if slug is not None and entry.get("slug") != slug:
            continue
        selected.append(entry)
    return selected


def validate_entry_against_source(
    repository: Path,
    entry: dict[str, Any],
) -> list[str]:
    errors: list[str] = []
    source_rel = entry.get("source")
    solution_rel = entry.get("solution_path")
    expected_hash = entry.get("source_sha256")
    if not isinstance(source_rel, str):
        errors.append("missing source")
        return errors
    if not isinstance(solution_rel, str):
        errors.append("missing solution_path")
        return errors
    source = repository / source_rel
    solution = repository / solution_rel
    if not source.is_file():
        errors.append(f"source missing: {source_rel}")
    else:
        actual = sha256_file(source)
        if expected_hash != actual:
            errors.append(
                f"source_sha256 mismatch for {source_rel}: "
                f"manifest={expected_hash} actual={actual}"
            )
    if not solution.is_file():
        errors.append(f"solution missing: {solution_rel}")
    else:
        try:
            read_tokens(solution)
        except ValueError as exc:
            errors.append(str(exc))
    tags = entry.get("tags") or []
    if TAG_JS_VALID not in tags:
        errors.append(f"{entry.get('slug')} board {entry.get('board_index')}: missing js_valid tag")
    return errors


def solution_relpath(slug: str, board_index: int) -> str:
    return f"{DEFAULT_CACHE_ROOT.as_posix()}/solutions/{slug}/board-{board_index}.txt"
