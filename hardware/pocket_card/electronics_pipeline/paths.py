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

_FORBIDDEN_MACHINE_PATH_PATTERNS = (
    re.compile(r"file://[^\s\"')]+", re.IGNORECASE),
    re.compile(r"(?<![A-Za-z0-9_])[A-Za-z]:[\\/]+[^\s\"')]+"),
    re.compile(
        r"(?<![:/\\])(?:\\{2,}|//)[^/\\\s\"')]+"
        r"(?:[\\/]+[^/\\\s\"')]+)+"
    ),
    re.compile(
        r"(?<![:/\\A-Za-z0-9_}])/(?:[^/\s\"'()]+/)+[^/\s\"'()]+"
    ),
)


def find_forbidden_machine_paths(text):
    matches = []
    for pattern in _FORBIDDEN_MACHINE_PATH_PATTERNS:
        matches.extend((match.start(), match.group(0)) for match in pattern.finditer(text))
    return tuple(value for _, value in sorted(matches))
