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

_ALLOWED_KICAD_PATH_VARIABLES = frozenset(
    {"KIPRJMOD", "KICAD10_FOOTPRINT_DIR", "KICAD10_3DMODEL_DIR"}
)
_VARIABLE_REFERENCE_PATTERN = re.compile(
    r"(?P<braced>\$\{(?P<braced_name>[A-Za-z_][A-Za-z0-9_]*)\})"
    r"|(?P<unbraced>\$(?P<unbraced_name>[A-Za-z_][A-Za-z0-9_]*))"
    r"|(?P<percent>%(?P<percent_name>[A-Za-z_][A-Za-z0-9_]*)%)"
)
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


def find_forbidden_machine_paths(text):
    allowed_reference_spans = {
        (match.start("reference"), match.end("reference"))
        for match in _KICAD_REFERENCE_FIELD_PATTERN.finditer(text)
    }
    matches = set()

    for match in _VARIABLE_REFERENCE_PATTERN.finditer(text):
        braced_name = match.group("braced_name")
        if braced_name in _ALLOWED_KICAD_PATH_VARIABLES:
            continue
        if braced_name == "REFERENCE" and match.span() in allowed_reference_spans:
            continue
        matches.add((match.start(), match.end(), match.group(0)))

    for pattern in _FORBIDDEN_MACHINE_PATH_PATTERNS:
        matches.update(
            (match.start(), match.end(), match.group(0)) for match in pattern.finditer(text)
        )
    return tuple(value for _, _, value in sorted(matches))
