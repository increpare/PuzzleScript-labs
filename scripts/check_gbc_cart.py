#!/usr/bin/env python3
"""Validate a linked PuzzleScript multi-game GBC cartridge."""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path


OBJECT_AREA = re.compile(r"^A\s+(\S+)\s+size\s+([0-9A-Fa-f]+)\b")
STATIC_AREAS = {"_DATA", "_BSS", "_INITIALIZED"}


def object_areas(path: Path) -> dict[str, int]:
    areas: dict[str, int] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = OBJECT_AREA.match(line)
        if match:
            areas[match.group(1)] = int(match.group(2), 16)
    return areas


def generated_static_areas(
    paths: Iterable[Path],
) -> dict[str, dict[str, int]]:
    offenders: dict[str, dict[str, int]] = {}
    for path in paths:
        areas = {
            name: size
            for name, size in object_areas(path).items()
            if name in STATIC_AREAS and size != 0
        }
        if areas:
            offenders[path.name] = areas
    return offenders

