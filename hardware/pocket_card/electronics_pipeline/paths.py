import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
POCKET_CARD_DIR = REPO_ROOT / "hardware" / "pocket_card"
ELECTRONICS_DIR = POCKET_CARD_DIR / "electronics"
PROJECT_NAME = "pocket_card_controller"
PROJECT = ELECTRONICS_DIR / f"{PROJECT_NAME}.kicad_pro"
SCHEMATIC = ELECTRONICS_DIR / f"{PROJECT_NAME}.kicad_sch"
BOARD = ELECTRONICS_DIR / f"{PROJECT_NAME}.kicad_pcb"
TOOLCHAIN = ELECTRONICS_DIR / "toolchain.json"
MECHANICAL_CONTRACT = ELECTRONICS_DIR / "mechanical_contract.json"
VALIDATION_WAIVERS = ELECTRONICS_DIR / "validation_waivers.json"
PCB_OUTPUT_DIR = POCKET_CARD_DIR / "case" / "out" / "pcb"
HANDOFF_BUILD_DIR = REPO_ROOT / "build" / "pocket_card" / "handoff"

EDITABLE_PROJECT_FILES = (
    f"{PROJECT_NAME}.kicad_pro",
    f"{PROJECT_NAME}.kicad_sch",
    f"{PROJECT_NAME}.kicad_pcb",
    "fp-lib-table",
    "sym-lib-table",
)
EDITABLE_PROJECT_DIRS = ("symbols", "footprints.pretty", "3dmodels")

_ALLOWED_KICAD_PATH_VARIABLE_TOKENS = frozenset(
    {
        "${KIPRJMOD}",
        "${KICAD10_FOOTPRINT_DIR}",
        "${KICAD10_3DMODEL_DIR}",
    }
)
# Non-path KiCad template tokens used by BOM/export project settings.
_ALLOWED_KICAD_TEMPLATE_VARIABLE_TOKENS = frozenset(
    {
        "${PROJECTNAME}",
        "${QUANTITY}",
        "${DNP}",
        "${EXCLUDE_FROM_BOM}",
        "${EXCLUDE_FROM_BOARD}",
    }
)
_UNBRACED_VARIABLE_PATTERN = re.compile(r"\$[A-Za-z_][A-Za-z0-9_]*")
# KiCad expands this built-in only as footprint fabrication text; it is not a
# library-path variable and is allowed solely in this exact field form.
_KICAD_REFERENCE_FIELD_PATTERN = re.compile(
    r'\(fp_text\s+user\s+"(?P<reference>\$\{REFERENCE\})"(?=\s|\))'
)
_FORBIDDEN_MACHINE_PATH_PATTERNS = (
    re.compile(r"file://[^\s\"')]+", re.IGNORECASE),
    re.compile(r"(?<![A-Za-z0-9_])[A-Za-z]:[\\/]+[^\s\"')]+"),
    re.compile(
        r"(?<![:/\\])(?:\\{2,}|//)[^/\\\s\"')]+"
        r"(?:[\\/]+[^/\\\s\"')]+)+"
    ),
    re.compile(
        r"(?<![:/\\A-Za-z0-9_}%])/(?:[^/\s\"'()]+/)+[^/\s\"'()]+"
    ),
)


def _scan_variable_references(text):
    """Yield complete, line-bounded substitution tokens and path-like fragments."""
    index = 0
    while index < len(text):
        if text.startswith("${", index):
            start = index
            cursor = index + 2
            depth = 1
            while cursor < len(text) and text[cursor] not in "\r\n":
                if text.startswith("${", cursor):
                    depth += 1
                    cursor += 2
                    continue
                if text[cursor] == "}":
                    depth -= 1
                    cursor += 1
                    if depth == 0:
                        yield start, cursor, text[start:cursor]
                        index = cursor
                        break
                    continue
                cursor += 1
            else:
                candidate = text[start:cursor]
                if "/" in candidate or "\\" in candidate:
                    yield start, cursor, candidate
                    index = cursor
                else:
                    index += 2
            continue

        if text[index] == "%":
            start = index
            cursor = index + 1
            while cursor < len(text) and text[cursor] not in "%\r\n":
                cursor += 1
            if cursor < len(text) and text[cursor] == "%":
                cursor += 1
                yield start, cursor, text[start:cursor]
                index = cursor
            else:
                candidate = text[start:cursor]
                if "/" in candidate or "\\" in candidate:
                    yield start, cursor, candidate
                    index = cursor
                else:
                    index += 1
            continue

        match = _UNBRACED_VARIABLE_PATTERN.match(text, index)
        if match is not None:
            yield match.start(), match.end(), match.group(0)
            index = match.end()
            continue
        index += 1


def find_forbidden_machine_paths(text):
    allowed_reference_spans = {
        (match.start("reference"), match.end("reference"))
        for match in _KICAD_REFERENCE_FIELD_PATTERN.finditer(text)
    }
    matches = set()

    for start, end, token in _scan_variable_references(text):
        if token in _ALLOWED_KICAD_PATH_VARIABLE_TOKENS:
            continue
        if token in _ALLOWED_KICAD_TEMPLATE_VARIABLE_TOKENS:
            continue
        if token == "${REFERENCE}" and (start, end) in allowed_reference_spans:
            continue
        matches.add((start, end, token))

    for pattern in _FORBIDDEN_MACHINE_PATH_PATTERNS:
        matches.update(
            (match.start(), match.end(), match.group(0)) for match in pattern.finditer(text)
        )
    return tuple(value for _, _, value in sorted(matches))
