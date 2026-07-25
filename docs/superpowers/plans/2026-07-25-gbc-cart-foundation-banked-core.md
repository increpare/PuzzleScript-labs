# GBC Cart Foundation — Per-Game Banked Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the single-game GBC ROM so `core.c`, the generated data and the specialized packs all live in switchable banks behind a per-game descriptor with namespaced symbols, dropping HOME from ~16 KiB to ~4 KiB with no behavioural change.

**Architecture:** Each game gets a private copy of `core.c` compiled with its own width macros into its own banks, reached through a `ps_gbc_game_descriptor` holding a bank number and function pointers. `main.c` stays in HOME and calls through the descriptor after switching banks. Per-game translation units are compiled through a generated namespace header so that a later multi-game link has no symbol collisions. This plan changes nothing about game behaviour — every existing test must still pass, and HOME usage is the measured deliverable.

**Tech Stack:** C (SDCC via GBDK-2020 4.5+), C++17 host exporter (`native/src/gbc/exporter.cpp`), CMake + CTest for host tests, Python 3 for build and ROM-gate scripts, mGBA for cartridge smoke tests.

**Spec:** `docs/superpowers/specs/2026-07-25-gbc-multi-game-cart-design.md`

## Global Constraints

- This plan is Plan A of four. Plans B (two-game cart), C (decorated launcher) and D (scale to 32) depend on the interfaces produced here. Do not implement multi-game linking, the launcher, or SRAM slot changes in this plan.
- Cart target stays MBC5, cart type `0x1B`, CGB-only. ROM bank ceiling is **255 banks (4 MB)** — `SWITCH_ROM_MBC5_8M` is incompatible with banked SDCC calls and must not be used.
- HOME (bank 0) hard cap: **16,384 bytes**. Every switchable bank hard cap: **16,384 bytes**. Both are already enforced by `scripts/check_gbc_rom.py` (`MAX_FIXED_ROM_BYTES`, `MAX_GAME_BANK_BYTES`).
- Static WRAM cap: **6,144 bytes** (`MAX_STATIC_WRAM_BYTES`). Session arena cap: **4,096 bytes** (`MAX_SESSION_BYTES`).
- Every game must retain its specialized turn. There is no interpreter fallback — as of 2026-07-25 firmware `build-rom` fails hard rather than relinking interpreter-only.
- No `cd` in commands. Use `make -C`, `git -C`, `ctest --test-dir` and absolute or repo-relative paths.
- GBDK and `build/native` are git-ignored, so a fresh worktree has neither. Export `GBDK_HOME=/Users/stephenlavelle/Documents/GitHub/PuzzleScript-labs/.codex_tmp/toolchains/gbdk` (the main checkout's copy — a toolchain, safe to share) and build the worktree's own `build/native` with `cmake -S native -B build/native -DCMAKE_BUILD_TYPE=Release && cmake --build build/native -j 8`, because this plan modifies the exporter.
- **Never pass a game path containing spaces to `make gbc` / `make gbc_smoke`.** The root Makefile wraps `GBC_GAME` in `$(abspath …)`, which splits on whitespace and produces a bogus target. Use `src/demo/sokoban_basic.txt` for all single-game verification in this plan. Every strict-export corpus game happens to have spaces in its filename.
- `ELIGIBLE_GAMES` in `scripts/build_gbc_eligible_roms.py` holds **46** games as of this branch's base commit, not the 32 quoted in the design spec.
- Repo has no linter or formatter. Match surrounding style: 4-space indent in C, `ps_gbc_` prefix on runtime symbols, `snake_case` throughout.

**Reference commands** (all from the repository root):

```bash
# Build the host compiler/exporter
cmake --build build/native --target puzzlescript_cpp

# Host GBC tests
ctest --test-dir build/native -R puzzlescript_gbc --output-on-failure

# Build one cartridge
make gbc GBC_GAME=src/demo/sokoban_basic.txt GBDK_HOME="$GBDK_HOME"

# Boot-test a cartridge in mGBA
make gbc_smoke GBC_GAME=src/demo/sokoban_basic.txt GBDK_HOME="$GBDK_HOME"

# Rebuild the eligible corpus (46 ROMs)
make gbc_eligible GBDK_HOME="$GBDK_HOME"
```

**Baseline to beat.** The single-game verification target for Tasks 2-6 is `src/demo/sokoban_basic.txt`, measured in this worktree on 2026-07-25 at branch base `1c37e5cd`:

| Area | Bytes |
| --- | ---: |
| HOME | 11,961 |
| `_CODE_1` | 5,868 |
| `_CODE_2` | 2,922 |
| `_CODE_3` | 6,022 |

Task 7's corpus evidence is measured against these, recorded 2026-07-25 on `build/gbc/eligible/*/`:

| Game | HOME bytes | Largest bank |
| --- | ---: | ---: |
| push-pull | 15,840 | 10,281 |
| xorro-the-chaos-warden | 16,008 | 10,157 |
| slot-machine | 15,620 | — |

`core.o` contributes 12,277 of those HOME bytes (`_CODE` 11,076 + `_HOME` 1,201); `main.o` contributes 2,305.

---

### Task 1: Layout reporting script

Every later task is judged on HOME and bank numbers, so build the measuring tool first.

**Files:**
- Create: `scripts/report_gbc_layout.py`
- Create: `scripts/report_gbc_layout_test.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `report_gbc_layout.layout(map_path: Path) -> dict` returning
  `{"home_bytes": int, "banks": {"_CODE_1": int, ...}, "static_wram_bytes": int, "module_home": {"core.o": int, ...}}`.
  Later tasks call `python3 scripts/report_gbc_layout.py <map> [--build-dir DIR]` and read the printed table.

- [ ] **Step 1: Write the failing test**

Create `scripts/report_gbc_layout_test.py`:

```python
#!/usr/bin/env python3
"""Unit test for report_gbc_layout. Run: python3 scripts/report_gbc_layout_test.py"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import report_gbc_layout


MAP_SAMPLE = """
Area                       Addr        Size        Decimal Bytes (Attributes)
--------------------       ----        ----        ------- ----- ------------
_CODE                  00000200    0000364E =       13902. bytes (REL,CON)

_HEADER0               00000000    00000001 =           1. bytes (ABS,CON)

_CODE_1                00014000    00001C89 =        7305. bytes (REL,CON)

_CODE_2                00024000    00000C7F =        3199. bytes (REL,CON)

_DATA                  0000C0A0    00000716 =        1814. bytes (REL,CON)
"""


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        map_path = Path(tmp) / "sample.map"
        map_path.write_text(MAP_SAMPLE, encoding="utf-8")
        result = report_gbc_layout.layout(map_path)

    assert result["home_bytes"] == 0x200 + 13902, result["home_bytes"]
    assert result["banks"] == {"_CODE_1": 7305, "_CODE_2": 3199}, result["banks"]
    assert result["static_wram_bytes"] == (0xC0A0 - 0xC000) + 1814, result["static_wram_bytes"]
    print("report_gbc_layout_test: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
python3 scripts/report_gbc_layout_test.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'report_gbc_layout'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/report_gbc_layout.py`:

```python
#!/usr/bin/env python3
"""Report HOME, per-bank and static WRAM usage for a linked GBC cartridge.

Usage:
    python3 scripts/report_gbc_layout.py firmware/gbc/puzzlescript_gbc.map
    python3 scripts/report_gbc_layout.py <map> --build-dir firmware/gbc/build
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

MAP_AREA = re.compile(
    r"^([._A-Za-z][._A-Za-z0-9]*)\s+([0-9A-Fa-f]{8})\s+([0-9A-Fa-f]{8})\s+="
)
BANK_AREA = re.compile(r"_CODE_\d+")

HOME_LIMIT = 16 * 1024
BANK_LIMIT = 16 * 1024
STATIC_WRAM_LIMIT = 6 * 1024


def layout(map_path: Path) -> dict[str, Any]:
    home_high = 0
    wram_high = 0xC000
    banks: dict[str, int] = {}
    for line in map_path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = MAP_AREA.match(line)
        if not match:
            continue
        name = match.group(1)
        address = int(match.group(2), 16)
        size = int(match.group(3), 16)
        if BANK_AREA.fullmatch(name):
            banks[name] = size
        if name.startswith("_HEADER") or 0 < address < 0x4000:
            home_high = max(home_high, address + size)
        if 0xC000 <= address < 0xE000:
            wram_high = max(wram_high, address + size)
    return {
        "home_bytes": home_high,
        "banks": banks,
        "static_wram_bytes": wram_high - 0xC000,
        "module_home": {},
    }


def module_home(build_dir: Path) -> dict[str, int]:
    """Per-object HOME contribution, read from SDCC .o area records."""
    totals: dict[str, int] = {}
    for obj in sorted(build_dir.glob("*.o")):
        total = 0
        for line in obj.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line.startswith("A "):
                continue
            parts = line.split()
            if len(parts) < 4:
                continue
            if parts[1] in ("_CODE", "_HOME"):
                total += int(parts[3], 16)
        if total:
            totals[obj.name] = total
    return totals


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("map", type=Path)
    parser.add_argument("--build-dir", type=Path)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    result = layout(args.map)
    if args.build_dir is not None and args.build_dir.is_dir():
        result["module_home"] = module_home(args.build_dir)

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0

    largest = max(result["banks"].values(), default=0)
    print(f"HOME         {result['home_bytes']:6} / {HOME_LIMIT}")
    print(f"largest bank {largest:6} / {BANK_LIMIT}")
    print(f"static WRAM  {result['static_wram_bytes']:6} / {STATIC_WRAM_LIMIT}")
    for name in sorted(result["banks"], key=lambda k: int(k.rsplit("_", 1)[1])):
        print(f"  {name:12} {result['banks'][name]:6}")
    for name, size in sorted(result["module_home"].items()):
        print(f"  HOME {name:28} {size:6}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
python3 scripts/report_gbc_layout_test.py
```

Expected: `report_gbc_layout_test: ok`

- [ ] **Step 5: Record the real baseline**

```bash
python3 scripts/report_gbc_layout.py firmware/gbc/puzzlescript_gbc.map \
  --build-dir firmware/gbc/build
```

Expected: HOME around 16,008 with `core.o` near 12,277 and `main.o` near 2,305. Paste this output into the task's commit message — it is the before-figure for Task 7.

- [ ] **Step 6: Commit**

```bash
git add scripts/report_gbc_layout.py scripts/report_gbc_layout_test.py
git commit -m "Add GBC cartridge layout reporting script."
```

---

### Task 2: Export a per-game symbol namespace header

Thirty-two copies of `ps_gbc_step` collide at link time. Give every per-game translation unit a prefix now, while there is exactly one game to verify against.

**Files:**
- Modify: `native/src/gbc/exporter.cpp` (options struct, and beside the `generated_game.h` emitter near line 2553)
- Modify: `native/src/gbc/exporter.hpp` (add the option field)
- Modify: `native/src/cli/main.cpp` (parse `--symbol-prefix`)
- Test: `native/tests/gbc_exporter.cpp`

**Interfaces:**
- Consumes: `report_gbc_layout.layout` from Task 1 for verification only.
- Produces: a new export artifact `generated_namespace.h` in the output directory. It is emitted **always**; when the prefix is empty it contains only the include guard and no `#define`s, so existing single-game builds are byte-identical. Exporter option field is `std::string symbolPrefix;` on the existing options struct, CLI flag `--symbol-prefix <id>`, and the manifest gains `"symbol_prefix": "<id>"`.

The namespaced names are exactly the 14 public entry points in `native/include/puzzlescript/gbc.h:292-312`, plus `ps_gbc_resolve_movements` (`native/src/gbc/specialized_turn.h:39`) and the generated data symbol `ps_gbc_generated_game`:

```
ps_gbc_session_required_bytes  ps_gbc_session_init      ps_gbc_load_level
ps_gbc_step                    ps_gbc_defer_wins        ps_gbc_advance_level
ps_gbc_undo                    ps_gbc_restart           ps_gbc_status_get
ps_gbc_cell_objects            ps_gbc_dirty_cells       ps_gbc_has_dirty_cells
ps_gbc_clear_dirty_cells       ps_gbc_first_player_position
ps_gbc_board                   ps_gbc_game
ps_gbc_resolve_movements       ps_gbc_generated_game
```

- [ ] **Step 1: Write the failing test**

Add to `native/tests/gbc_exporter.cpp`, following the file's existing test-registration pattern:

```cpp
static void test_namespace_header_empty_prefix_has_no_defines() {
    const auto out = exportFixture("sokoban_basic", /*symbolPrefix=*/"");
    const std::string header = readFile(out / "generated_namespace.h");
    assertTrue(header.find("#define") == std::string::npos,
               "empty prefix must emit no defines");
    assertTrue(header.find("PS_GBC_GENERATED_NAMESPACE_H") != std::string::npos,
               "header needs an include guard");
}

static void test_namespace_header_prefixes_every_entry_point() {
    const auto out = exportFixture("sokoban_basic", /*symbolPrefix=*/"g07");
    const std::string header = readFile(out / "generated_namespace.h");
    for (const char* name : {
             "ps_gbc_session_required_bytes", "ps_gbc_session_init",
             "ps_gbc_load_level", "ps_gbc_step", "ps_gbc_defer_wins",
             "ps_gbc_advance_level", "ps_gbc_undo", "ps_gbc_restart",
             "ps_gbc_status_get", "ps_gbc_cell_objects", "ps_gbc_dirty_cells",
             "ps_gbc_has_dirty_cells", "ps_gbc_clear_dirty_cells",
             "ps_gbc_first_player_position", "ps_gbc_board", "ps_gbc_game",
             "ps_gbc_resolve_movements", "ps_gbc_generated_game"}) {
        const std::string expected =
            std::string("#define ") + name + " g07_" + name;
        assertTrue(header.find(expected) != std::string::npos,
                   std::string("missing define for ") + name);
    }
}
```

If `exportFixture` in that file does not yet take a prefix argument, add the parameter with a default of `""` so existing call sites are untouched.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cmake --build build/native --target puzzlescript_gbc_exporter_tests
ctest --test-dir build/native -R puzzlescript_gbc_exporter --output-on-failure
```

Expected: FAIL — `generated_namespace.h` does not exist.

- [ ] **Step 3: Implement the emitter**

In `native/src/gbc/exporter.hpp`, add to the export options struct:

```cpp
    // Prefix applied to every per-game entry point so several games can be
    // linked into one cartridge without symbol collisions. Empty means the
    // export is standalone and no renaming happens.
    std::string symbolPrefix;
```

In `native/src/gbc/exporter.cpp`, beside where `generated_game.h` is written (near line 2553), add:

```cpp
static const char* const kNamespacedSymbols[] = {
    "ps_gbc_session_required_bytes",
    "ps_gbc_session_init",
    "ps_gbc_load_level",
    "ps_gbc_step",
    "ps_gbc_defer_wins",
    "ps_gbc_advance_level",
    "ps_gbc_undo",
    "ps_gbc_restart",
    "ps_gbc_status_get",
    "ps_gbc_cell_objects",
    "ps_gbc_dirty_cells",
    "ps_gbc_has_dirty_cells",
    "ps_gbc_clear_dirty_cells",
    "ps_gbc_first_player_position",
    "ps_gbc_board",
    "ps_gbc_game",
    "ps_gbc_resolve_movements",
    "ps_gbc_generated_game",
};

static void writeNamespaceHeader(
    const std::filesystem::path& path,
    const std::string& prefix
) {
    std::ostringstream out;
    out << "#ifndef PS_GBC_GENERATED_NAMESPACE_H\n"
        << "#define PS_GBC_GENERATED_NAMESPACE_H\n\n";
    if (prefix.empty()) {
        out << "/* Standalone export: no symbol renaming. */\n\n";
    } else {
        out << "/* Cartridge export: rename per-game entry points. */\n";
        for (const char* name : kNamespacedSymbols) {
            out << "#define " << name << " " << prefix << "_" << name << "\n";
        }
        out << "\n";
    }
    out << "#endif /* PS_GBC_GENERATED_NAMESPACE_H */\n";
    writeTextFile(path, out.str());
}
```

Call it from the same place `generated_game.h` is produced:

```cpp
    writeNamespaceHeader(
        options.outputDirectory / "generated_namespace.h", options.symbolPrefix);
```

Make `generated_game.h` include it first, so anything that includes the generated header is namespaced automatically. At the top of the `generated_game.h` emitter:

```cpp
        << "#include \"generated_namespace.h\"\n"
```

Add the manifest field beside the other manifest writes near line 2787:

```cpp
    manifest << "  \"symbol_prefix\": \"" << options.symbolPrefix << "\",\n";
```

In `native/src/cli/main.cpp`, parse the flag alongside the other `export-gbc` options:

```cpp
        } else if (argument == "--symbol-prefix") {
            if (index + 1 >= argc) {
                std::cerr << "--symbol-prefix needs a value\n";
                return 2;
            }
            options.symbolPrefix = argv[++index];
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cmake --build build/native --target puzzlescript_cpp puzzlescript_gbc_exporter_tests
ctest --test-dir build/native -R puzzlescript_gbc --output-on-failure
```

Expected: PASS, all GBC host tests green.

- [ ] **Step 5: Verify the default export is unchanged**

```bash
make gbc GBC_GAME=src/demo/sokoban_basic.txt GBDK_HOME="$GBDK_HOME"
python3 scripts/report_gbc_layout.py firmware/gbc/puzzlescript_gbc.map
```

Expected: HOME ≈ 15,840, unchanged from baseline. An empty prefix must cost nothing.

- [ ] **Step 6: Commit**

```bash
git add native/src/gbc/exporter.cpp native/src/gbc/exporter.hpp \
        native/src/cli/main.cpp native/tests/gbc_exporter.cpp
git commit -m "Emit a per-game symbol namespace header from export-gbc."
```

---

### Task 3: Namespace the game's core.c copy

`core.c` is shared source compiled per game, so it must pick up the same prefix without the file itself knowing about it.

**Files:**
- Modify: `native/src/gbc/core.c:1-20` (include the namespace header)
- Modify: `native/src/gbc/session_internal.h:1-12` (include it ahead of `generated_game.h`)
- Test: `native/tests/gbc_core.c`

**Interfaces:**
- Consumes: `generated_namespace.h` from Task 2.
- Produces: `core.c` compiles to prefixed symbols whenever the generated header directory supplies a non-empty namespace header. Host builds of `puzzlescript_gbc_core` (which define no `PS_GBC_GENERATED_BUILD`) must be unaffected.

- [ ] **Step 1: Write the failing check**

The guarantee to protect is that the *host* core library keeps unprefixed
symbol names — the cartridge is what gets namespaced. A pointer-non-NULL test
would assert nothing, so make it a real symbol-table assertion.

Create `scripts/check_host_core_symbols.py`:

```python
#!/usr/bin/env python3
"""Assert the host GBC core library exports unprefixed entry points.

Cartridge builds rename these through generated_namespace.h; the host library
must not, because one host test binary exercises all board widths.

Usage: python3 scripts/check_host_core_symbols.py build/native/libpuzzlescript_gbc_core.a
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REQUIRED = (
    "ps_gbc_step",
    "ps_gbc_session_init",
    "ps_gbc_load_level",
    "ps_gbc_resolve_movements",
)


def defined_symbols(archive: Path) -> set[str]:
    out = subprocess.run(
        ["nm", "-g", "--defined-only", str(archive)],
        capture_output=True, text=True, check=True,
    ).stdout
    names: set[str] = set()
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 3:
            names.add(parts[2].lstrip("_"))
    return names


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check_host_core_symbols.py <archive>", file=sys.stderr)
        return 2
    archive = Path(sys.argv[1])
    if not archive.is_file():
        print(f"missing archive: {archive}", file=sys.stderr)
        return 2

    names = defined_symbols(archive)
    missing = [name for name in REQUIRED if name not in names]
    stray = sorted(n for n in names if n.endswith("_ps_gbc_step"))

    if missing:
        print(f"FAIL host core is missing unprefixed symbols: {missing}", file=sys.stderr)
        return 1
    if stray:
        print(f"FAIL host core exports namespaced symbols: {stray}", file=sys.stderr)
        return 1
    print(f"ok host core exports {len(REQUIRED)} unprefixed entry points")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run the check to verify current state**

```bash
cmake --build build/native --target puzzlescript_gbc_core -j 8
python3 scripts/check_host_core_symbols.py build/native/libpuzzlescript_gbc_core.a
```

Expected: `ok host core exports 4 unprefixed entry points`. This is a guard — it passes now and must keep passing after Step 3, because Step 3 must namespace only cartridge builds.

- [ ] **Step 3: Add the conditional include**

In `native/src/gbc/session_internal.h`, inside the existing `PS_GBC_GENERATED_BUILD` block at lines 5-11, put the namespace header **before** `generated_game.h`:

```c
#if defined(PS_GBC_GENERATED_BUILD)
#include "generated_namespace.h"
#include "generated_game.h"
```

`core.c` already includes `session_internal.h`, so no change is needed there. Confirm that ordering by reading `native/src/gbc/core.c:1-20`; if `core.c` includes `puzzlescript/gbc.h` before `session_internal.h`, move the namespace include into `core.c` ahead of both instead, because the `#define`s must precede every declaration of the renamed functions.

- [ ] **Step 4: Run both host and cartridge checks**

```bash
ctest --test-dir build/native -R puzzlescript_gbc --output-on-failure
make gbc GBC_GAME=src/demo/sokoban_basic.txt GBDK_HOME="$GBDK_HOME"
```

Expected: host tests PASS (unprefixed, `PS_GBC_GENERATED_BUILD` undefined) and the cartridge links (prefix empty, so still unprefixed).

- [ ] **Step 5: Verify prefixing actually reaches core.c**

```bash
build/native/puzzlescript_cpp export-gbc src/demo/sokoban_basic.txt \
  --out /tmp/ns-check --symbol-prefix g07
make -C firmware/gbc SKIP_EXPORT=1 GENERATED=/tmp/ns-check \
  GBDK_HOME="$GBDK_HOME"
grep -c "g07_ps_gbc_step" firmware/gbc/puzzlescript_gbc.map
```

Expected: a non-zero count. If it is zero, the include ordering in Step 3 is wrong.

- [ ] **Step 6: Commit**

```bash
git add native/src/gbc/session_internal.h native/src/gbc/core.c \
        scripts/check_host_core_symbols.py
git commit -m "Route core.c through the generated symbol namespace header."
```

---

### Task 4: Move core.c into a switchable bank

This is the task that reclaims HOME. Do it on one game and prove nothing regressed before touching the corpus.

**Files:**
- Modify: `native/src/gbc/specialized_turn.h:9-16` (drop the `NONBANKED` attribute)
- Modify: `firmware/gbc/Makefile:103-107` (compile `core.c` with a bank pragma)
- Create: `firmware/gbc/source/core_banked.c` (one-line bank wrapper around `core.c`)

**Interfaces:**
- Consumes: namespaced `core.c` from Task 3.
- Produces: all `ps_gbc_*` core entry points become `BANKED` and live in `_CODE_11` for a single-game build. `PS_GBC_CORE_RUNTIME_NONBANKED` expands to nothing on cartridge builds; callers must not assume the core is permanently mapped.

Bank 11 is chosen because a single-game specialized build currently uses `_CODE_1` through `_CODE_10` at most (`xorro-the-chaos-warden`). Plan B replaces this fixed number with a computed bank base.

- [ ] **Step 1: Write the failing test**

Create the wrapper `firmware/gbc/source/core_banked.c`:

```c
/*
 * The cartridge compiles core.c into a switchable bank so HOME holds only the
 * frontend and the bank dispatch. Including the translation unit here keeps
 * core.c free of firmware-specific pragmas, so the host library and the GBA
 * target continue to compile it unchanged.
 */
#if defined(__SDCC)
#pragma bank 11
#endif

#include "../../../native/src/gbc/core.c"
```

Then add the assertion to the ROM gate. In `scripts/check_gbc_rom.py`, extend the `checks` list in `main()`:

```python
        (
            "core is banked, not in HOME",
            fixed_rom <= 8 * 1024,
            f"HOME {fixed_rom} bytes",
        ),
```

- [ ] **Step 2: Run the gate to verify it fails**

```bash
make gbc GBC_GAME=src/demo/sokoban_basic.txt GBDK_HOME="$GBDK_HOME"
```

Expected: FAIL on `core is banked, not in HOME` reporting 11,961 bytes for `sokoban_basic`, because `core.c` is still compiled straight into HOME.

- [ ] **Step 3: Switch the build to the banked wrapper**

In `native/src/gbc/specialized_turn.h`, the macro at lines 9-16 currently expands to `NONBANKED` on cartridge builds. Change it so the core is banked like everything else:

```c
/*
 * core.c lives in a switchable bank on cartridge builds, so its entry points
 * are ordinary BANKED functions. Callers in HOME switch banks through the game
 * descriptor; callers in the game's own specialized packs use a normal BANKED
 * call, which saves and restores the bank.
 */
#define PS_GBC_CORE_RUNTIME_NONBANKED BANKED
```

Keep the non-SDCC branch expanding to nothing so host builds are unaffected.

In `firmware/gbc/Makefile`, change the `core.o` rule (lines 103-107) to compile the wrapper instead of `core.c` directly:

```make
$(BUILD)/core.o: source/core_banked.c ../../native/src/gbc/core.c \
	../../native/src/gbc/session_internal.h \
	../../native/include/puzzlescript/gbc.h \
	$(EXPORT_STAMP) | $(BUILD)
	"$(LCC)" $(CFLAGS) $$(test -f $(SPECIALIZED_SRC) && echo -DPS_GBC_HAS_SPECIALIZED_TURN=1) -c -o $@ $<
```

- [ ] **Step 4: Run the gate to verify it passes**

```bash
make gbc GBC_GAME=src/demo/sokoban_basic.txt GBDK_HOME="$GBDK_HOME"
python3 scripts/report_gbc_layout.py firmware/gbc/puzzlescript_gbc.map \
  --build-dir firmware/gbc/build
```

Expected: PASS, HOME around 4,000 bytes with `core.o` no longer listed under HOME, and a new `_CODE_11` around 12,000 bytes.

If the link fails with a bank-overflow on `_CODE_11`, `core.o` exceeds 16 KiB for this game — report it rather than working around it, because it means the per-game core needs splitting after all and the spec's fallback option applies.

- [ ] **Step 5: Prove behaviour is unchanged**

```bash
make gbc_smoke GBC_GAME=src/demo/sokoban_basic.txt GBDK_HOME="$GBDK_HOME"
ctest --test-dir build/native -R puzzlescript_gbc --output-on-failure
```

Expected: the mGBA smoke run reports success, and all host GBC tests pass. A hang here is the known failure mode from the 2026-07-24 bank-2 experiment: something in a bank is calling a core helper without its bank mapped. Do not paper over it with `NONBANKED` — find the call site.

- [ ] **Step 6: Commit**

```bash
git add native/src/gbc/specialized_turn.h firmware/gbc/Makefile \
        firmware/gbc/source/core_banked.c scripts/check_gbc_rom.py
git commit -m "Compile core.c into a switchable bank on GBC cartridges."
```

---

### Task 5: Per-game descriptor and HOME dispatch

`main.c` currently calls core entry points directly. With the core banked, every call must switch banks first, and Plan B needs those calls to route through a table.

**Files:**
- Create: `native/include/puzzlescript/gbc_descriptor.h`
- Create: `firmware/gbc/source/game_dispatch.c`
- Create: `firmware/gbc/source/game_dispatch.h`
- Modify: `firmware/gbc/source/main.c` (replace direct `ps_gbc_*` calls)
- Modify: `firmware/gbc/Makefile` (add `game_dispatch.o` to `OBJECTS`)
- Verified by: `make gbc_smoke` under mGBA (no host test — `game_dispatch.c` needs GBDK headers)

**Interfaces:**
- Consumes: banked core from Task 4.
- Produces:

```c
typedef struct ps_gbc_game_descriptor {
    uint8_t bank;                     /* bank holding this game's core.c */
    uint16_t session_bytes;           /* ps_gbc_session_required_bytes result */
    const ps_gbc_game_view* game;     /* this game's generated view */
    ps_gbc_session* (*session_init)(void* arena, size_t bytes,
                                    const ps_gbc_game_view* game);
    bool (*load_level)(ps_gbc_session* session, uint16_t level_index);
    ps_step_result (*step)(ps_gbc_session* session, ps_input input);
    bool (*undo)(ps_gbc_session* session);
    bool (*restart)(ps_gbc_session* session);
    bool (*advance_level)(ps_gbc_session* session);
    void (*defer_wins)(ps_gbc_session* session, bool defer);
    void (*status_get)(const ps_gbc_session* session, ps_gbc_status* status);
    const void* (*board)(const ps_gbc_session* session);
    const uint8_t* (*dirty_cells)(const ps_gbc_session* session);
    bool (*has_dirty_cells)(const ps_gbc_session* session);
    void (*clear_dirty_cells)(ps_gbc_session* session);
    uint32_t (*cell_objects)(const ps_gbc_session* session, int16_t x, int16_t y);
    bool (*first_player_position)(const ps_gbc_session* session,
                                  int16_t* x, int16_t* y);
} ps_gbc_game_descriptor;
```

  and HOME-side wrappers in `game_dispatch.h` named `psd_step`, `psd_load_level`, `psd_undo`, `psd_restart`, `psd_advance_level`, `psd_defer_wins`, `psd_status_get`, `psd_board`, `psd_dirty_cells`, `psd_has_dirty_cells`, `psd_clear_dirty_cells`, `psd_cell_objects`, `psd_first_player_position`, `psd_session_init`. Plan B swaps the active descriptor; nothing else changes.

- [ ] **Step 1: Establish the behavioural check**

`game_dispatch.c` includes `<gb/gb.h>` and cannot compile on the host, so this
task is verified on hardware rather than by a host unit test. The dispatch
layer's only real failure mode is the wrong bank being mapped when a core entry
point runs, and that shows up immediately in the emulator as a hang or a
corrupt render — which is exactly what `gbc_smoke` asserts.

Record the pre-change smoke result so the post-change run is a comparison, not
an assertion in a vacuum:

```bash
make gbc_smoke GBC_GAME=src/demo/sokoban_basic.txt GBDK_HOME="$GBDK_HOME"
```

Expected: the mGBA autotest run reports success. Save its output; Step 5 must
reproduce it exactly after every call site has moved to a `psd_` wrapper.

- [ ] **Step 2: Confirm the descriptor is reachable before rewiring**

Read `firmware/gbc/source/main.c:722` and confirm `ps_gbc_session_init` is
called exactly once, at the site where `gActiveGame` must be set. If the init
call has moved, find its current line before proceeding — Step 4 depends on it.

- [ ] **Step 3: Write the descriptor and dispatch**

Create `native/include/puzzlescript/gbc_descriptor.h` with the struct from the Interfaces block above, guarded by `#pragma once` and including `puzzlescript/gbc.h`.

Create `firmware/gbc/source/game_dispatch.c`:

```c
#include "game_dispatch.h"

#include <gb/gb.h>

const ps_gbc_game_descriptor* gActiveGame;

/*
 * Every wrapper saves the caller's bank, maps the game's bank, calls through
 * the descriptor and restores. Saving matters because HOME code may itself be
 * running with some other bank mapped, and callers should not have to care.
 */
#define PSD_ENTER()                       \
    const uint8_t previous = CURRENT_BANK; \
    SWITCH_ROM(gActiveGame->bank)

#define PSD_LEAVE() SWITCH_ROM(previous)

ps_step_result psd_step(ps_gbc_session* session, ps_input input) {
    ps_step_result result;
    PSD_ENTER();
    result = gActiveGame->step(session, input);
    PSD_LEAVE();
    return result;
}

bool psd_load_level(ps_gbc_session* session, uint16_t level_index) {
    bool result;
    PSD_ENTER();
    result = gActiveGame->load_level(session, level_index);
    PSD_LEAVE();
    return result;
}

bool psd_undo(ps_gbc_session* session) {
    bool result;
    PSD_ENTER();
    result = gActiveGame->undo(session);
    PSD_LEAVE();
    return result;
}

bool psd_restart(ps_gbc_session* session) {
    bool result;
    PSD_ENTER();
    result = gActiveGame->restart(session);
    PSD_LEAVE();
    return result;
}

bool psd_advance_level(ps_gbc_session* session) {
    bool result;
    PSD_ENTER();
    result = gActiveGame->advance_level(session);
    PSD_LEAVE();
    return result;
}

void psd_defer_wins(ps_gbc_session* session, bool defer) {
    PSD_ENTER();
    gActiveGame->defer_wins(session, defer);
    PSD_LEAVE();
}

void psd_status_get(const ps_gbc_session* session, ps_gbc_status* status) {
    PSD_ENTER();
    gActiveGame->status_get(session, status);
    PSD_LEAVE();
}

const void* psd_board(const ps_gbc_session* session) {
    const void* result;
    PSD_ENTER();
    result = gActiveGame->board(session);
    PSD_LEAVE();
    return result;
}

const uint8_t* psd_dirty_cells(const ps_gbc_session* session) {
    const uint8_t* result;
    PSD_ENTER();
    result = gActiveGame->dirty_cells(session);
    PSD_LEAVE();
    return result;
}

bool psd_has_dirty_cells(const ps_gbc_session* session) {
    bool result;
    PSD_ENTER();
    result = gActiveGame->has_dirty_cells(session);
    PSD_LEAVE();
    return result;
}

void psd_clear_dirty_cells(ps_gbc_session* session) {
    PSD_ENTER();
    gActiveGame->clear_dirty_cells(session);
    PSD_LEAVE();
}

uint32_t psd_cell_objects(const ps_gbc_session* session, int16_t x, int16_t y) {
    uint32_t result;
    PSD_ENTER();
    result = gActiveGame->cell_objects(session, x, y);
    PSD_LEAVE();
    return result;
}

bool psd_first_player_position(
    const ps_gbc_session* session, int16_t* x, int16_t* y
) {
    bool result;
    PSD_ENTER();
    result = gActiveGame->first_player_position(session, x, y);
    PSD_LEAVE();
    return result;
}

ps_gbc_session* psd_session_init(void* arena, size_t bytes) {
    ps_gbc_session* result;
    PSD_ENTER();
    result = gActiveGame->session_init(arena, bytes, gActiveGame->game);
    PSD_LEAVE();
    return result;
}
```

Create `firmware/gbc/source/game_dispatch.h` declaring `extern const ps_gbc_game_descriptor* gActiveGame;` and each `psd_*` prototype, including `puzzlescript/gbc_descriptor.h`.

Have the exporter's `generated_game.c` emit the descriptor instance. In `native/src/gbc/exporter.cpp`, beside the `#pragma bank 1` emission at line 1853, add a descriptor definition naming the game's core bank and pointing at the namespaced entry points. For this plan the bank literal is `11`; Plan B parameterises it.

- [ ] **Step 4: Repoint main.c**

In `firmware/gbc/source/main.c`, replace every direct core call with its `psd_` wrapper — the call sites are at lines 243, 249, 252, 253, 277, 285, 298, 307, 475, 485, 490, 558, 562, 563, 564, 595, 599, 640, 647, 649, 650, 657, 722. Set `gActiveGame` once, before `psd_session_init`, at the existing init site near line 722:

```c
    gActiveGame = &ps_gbc_generated_descriptor;
    gSession = psd_session_init(gSessionArena, sizeof(gSessionArena));
```

Add `$(BUILD)/game_dispatch.o` to `OBJECTS` in `firmware/gbc/Makefile:49-52` and give it a build rule matching the `frontend_flow.o` rule at lines 144-145.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
ctest --test-dir build/native -R puzzlescript_gbc --output-on-failure
make gbc_smoke GBC_GAME=src/demo/sokoban_basic.txt GBDK_HOME="$GBDK_HOME"
python3 scripts/report_gbc_layout.py firmware/gbc/puzzlescript_gbc.map --build-dir firmware/gbc/build
```

Expected: host tests PASS, smoke run reports success, HOME stays under 8 KiB.

- [ ] **Step 6: Commit**

```bash
git add native/include/puzzlescript/gbc_descriptor.h \
        firmware/gbc/source/game_dispatch.c firmware/gbc/source/game_dispatch.h \
        firmware/gbc/source/main.c firmware/gbc/Makefile \
        native/src/gbc/exporter.cpp
git commit -m "Route GBC frontend calls through a per-game descriptor."
```

---

### Task 6: Zero statics from generated translation units

Per-game statics would sum across 32 games instead of sharing one arena. Close that door now, while there is one game to fix.

**Files:**
- Modify: `native/src/gbc/exporter.cpp` (specialized turn emitter — the WRAM globals it declares)
- Modify: `scripts/check_gbc_rom.py` (new gate)
- Test: `scripts/check_gbc_rom_test.py` (create)

**Interfaces:**
- Consumes: the build layout from Task 4.
- Produces: `check_gbc_rom.generated_static_bytes(build_dir: Path) -> dict[str, int]` mapping object filename to its `_DATA` + `_BSS` byte total, and a gate that fails when any object whose name starts with `generated_` reports a non-zero total.

`firmware/gbc/build/generated_specialized_turn.o` currently reports `_DATA: 12`. Those 12 bytes are the specialized turn's WRAM globals; move them into the session struct in `native/src/gbc/session_internal.h` so `ps_gbc_session_init` places them in the arena, and have the specialized emitter reference them through the session pointer instead of file-scope variables.

- [ ] **Step 1: Write the failing test**

Create `scripts/check_gbc_rom_test.py`:

```python
#!/usr/bin/env python3
"""Unit test for the generated-statics gate. Run: python3 scripts/check_gbc_rom_test.py"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import check_gbc_rom


OBJECT_WITH_DATA = "A _DATA size C flags 0\n"
OBJECT_CLEAN = "A _CODE_3 size 1CA1 flags 0\n"


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        build = Path(tmp)
        (build / "generated_specialized_turn.o").write_text(OBJECT_WITH_DATA)
        (build / "generated_game.o").write_text(OBJECT_CLEAN)
        (build / "main.o").write_text(OBJECT_WITH_DATA)

        totals = check_gbc_rom.generated_static_bytes(build)

    assert totals == {"generated_specialized_turn.o": 12}, totals
    print("check_gbc_rom_test: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

Note the assertion excludes `main.o` — only `generated_*` objects are gated, because HOME firmware is allowed its own statics.

- [ ] **Step 2: Run the test to verify it fails**

```bash
python3 scripts/check_gbc_rom_test.py
```

Expected: FAIL with `AttributeError: module 'check_gbc_rom' has no attribute 'generated_static_bytes'`.

- [ ] **Step 3: Implement the gate**

Add to `scripts/check_gbc_rom.py`:

```python
def generated_static_bytes(build_dir: Path) -> dict[str, int]:
    """WRAM bytes each generated object contributes outside the session arena."""
    totals: dict[str, int] = {}
    for obj in sorted(build_dir.glob("generated_*.o")):
        total = 0
        for line in obj.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line.startswith("A "):
                continue
            parts = line.split()
            if len(parts) >= 4 and parts[1] in ("_DATA", "_BSS"):
                total += int(parts[3], 16)
        if total:
            totals[obj.name] = total
    return totals
```

Wire it into `main()` as a check, taking the build directory from a new optional fourth argument defaulting to `rom_path.parent / "build"`:

```python
    strays = generated_static_bytes(build_dir) if build_dir.is_dir() else {}
    checks.append((
        "generated objects declare no static WRAM",
        not strays,
        ", ".join(f"{name}={size}" for name, size in strays.items()) or "none",
    ))
```

- [ ] **Step 4: Run the unit test to verify it passes**

```bash
python3 scripts/check_gbc_rom_test.py
```

Expected: `check_gbc_rom_test: ok`

- [ ] **Step 5: Move the specialized turn's globals into the session**

Build the cartridge and read the failure:

```bash
make gbc GBC_GAME=src/demo/sokoban_basic.txt GBDK_HOME="$GBDK_HOME"
```

Expected: FAIL reporting `generated_specialized_turn.o=12`. Find the file-scope variables in the emitted `firmware/gbc/generated/generated_specialized_turn.c`, add equivalent fields to `struct ps_gbc_session` in `native/src/gbc/session_internal.h:41-77` behind `#if defined(PS_GBC_HAS_SPECIALIZED_TURN)`, and change the emitter in `native/src/gbc/exporter.cpp` to read and write them through the session pointer. Rebuild until the gate reports `none`.

- [ ] **Step 6: Verify behaviour and commit**

```bash
ctest --test-dir build/native -R puzzlescript_gbc --output-on-failure
make gbc_smoke GBC_GAME=src/demo/sokoban_basic.txt GBDK_HOME="$GBDK_HOME"
git add scripts/check_gbc_rom.py scripts/check_gbc_rom_test.py \
        native/src/gbc/exporter.cpp native/src/gbc/session_internal.h
git commit -m "Gate generated GBC objects against declaring static WRAM."
```

---

### Task 7: Corpus rebuild and HOME budget evidence

One game proving out is not evidence. Rebuild all 46 and record the result in the ledger.

**Files:**
- Modify: `docs/performance/gbc-optimization-ledger.md` (append a dated section)

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: a ledger section recording per-game HOME before and after, and the largest bank per game — the input Plan B needs to compute bank bases.

- [ ] **Step 1: Rebuild the corpus**

```bash
make gbc_eligible GBDK_HOME="$GBDK_HOME"
```

Expected: 46/46 ROMs build. Any game that now fails is a real regression — do not drop it from `ELIGIBLE_GAMES` to make the build pass.

- [ ] **Step 2: Collect the layout table**

```bash
for m in build/gbc/eligible/*/*.map; do
  echo "== $m"
  python3 scripts/report_gbc_layout.py "$m"
done
```

Expected: HOME under 8 KiB for every game, versus 15,312–16,262 at baseline.

- [ ] **Step 3: Confirm no gameplay regression**

```bash
python3 scripts/bench_gbc_eligible_solutions.py --skip-rom --max-levels 2
```

Expected: every game that solved before still solves, with no new specialized-win failures. Compare against `build/gbc/eligible/solution-bench.json`.

- [ ] **Step 4: Write the ledger section**

Append to `docs/performance/gbc-optimization-ledger.md` a section titled `### GBC per-game banked core (2026-07-25)` recording: the HOME before/after per game, the largest bank per game, the total bank count per game, and the confirmation that generated objects declare no static WRAM. Follow the formatting of the existing dated sections.

- [ ] **Step 5: Commit**

```bash
git add docs/performance/gbc-optimization-ledger.md
git commit -m "Document GBC per-game banked core corpus results."
```

---

## Self-Review

**Spec coverage.** This plan covers the spec's "Per-game core" section (Tasks 3-5), its symbol namespacing requirement (Task 2), and the WRAM arena hygiene gate (Task 6). The spec's cart shape, SRAM layout, launcher, build flow and cart testing sections are deliberately out of scope and belong to Plans B, C and D — see the Global Constraints. The spec's arena max-over-cart sizing is Plan B, because it has no meaning with one game; Task 5 exposes `session_bytes` on the descriptor so Plan B can compute that maximum.

**Known risk.** Task 4 Step 5 is where the 2026-07-24 bank-2 hang would resurface if any banked caller reaches a core helper without its bank mapped. The plan calls this out and forbids the `NONBANKED` workaround, because reinstating it would put `core.c` back in HOME and defeat the entire plan.

**Open assumption.** Task 4 assumes `core.o` fits in one 16 KiB bank for every game. It measures 12,277 bytes for the current export and `core.c` has no per-game code generation in it, so this should hold across the corpus — but Task 4 Step 4 checks it explicitly, and Task 7 Step 1 confirms it for all 46.
