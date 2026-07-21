# Puzzle Processing Unit Track 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the PPU exterior contract, capacity budgets, JS-oracle golden tick harness, a host-side reference PPU, and a minimal FPGA shell on a concrete bring-up board — so hardware can be ordered immediately and software work is not blocked on shipping.

**Architecture:** Track 0 implements the approved PPU design (`docs/superpowers/specs/2026-07-21-puzzle-processing-unit-design.md`) as contracts + measurement + host model + FPGA “hollow core.” The first host PPU may delegate tick semantics to the existing native C++ runtime behind a fixed PPU API; the FPGA proves on-die state SRAM, tick handshake, and host load/readback. A later plan replaces the hollow core with a real rule/movement datapath and a silicon-shaped IR.

**Tech Stack:** Node.js (JS oracle traces), C++20 / CMake / CTest (host PPU + capacity tooling), Verilog + Yosys/nextpnr/Project Trellis (ECP5 FPGA), `openFPGALoader`, Python or Node host UART client for board bring-up.

---

## Scope boundary

**In this plan**

- Concrete hardware shopping list and board pin/protocol notes
- Corpus-driven on-die capacity draft numbers
- Golden tick trace format + generator from JS oracle
- Host PPU C API + reference implementation (native-runtime-backed is OK)
- Oracle parity tests on a tiny fixture game (including an `again` chain)
- FPGA project: BRAM state, UART command protocol, identity/load/readback + cycle counter
- README that tells a human what to buy and in what order to bring it up

**Out of this plan (follow-on)**

- Full PuzzleScript rule engine in Verilog/RTL
- Final PPU IR encoding beyond a minimal cartridge header used by Track 0
- Handheld product wrap (render, audio PCM, battery, case)
- ASIC tapeout estimates beyond a one-page area worksheet stub
- On-device `.txt` compile

Software Tasks 1–7 do **not** require the FPGA board. Order the board in parallel; Tasks 8–10 need it.

---

## What to order (do this first)

### Primary bring-up kit (recommended)

| Item | Why | Where / notes |
|------|-----|----------------|
| **ULX3S with ECP5 85F** (LFE5U-85F) | Open toolchain (Yosys/nextpnr/Trellis), enough LUT/BRAM for a real on-die state experiment, USB, buttons, HDMI later if wanted | [Mouser CS-ULX3S-03](https://www.mouser.com/ProductDetail/Radiona/CS-ULX3S-03) (~$235, often in stock); [Crowd Supply ULX3S 85F](https://www.crowdsupply.com/radiona/ulx3s); [EEZ / Radiona EU](https://www.envox.eu/product/ulx3s/) |
| USB-C cable (data-capable) | Power + programming + UART | Any quality cable; avoid charge-only |
| microSD card (any small) | Optional bitstream browser on ULX3S; not required for Track 0 UART flow | Commodity |

Order **one 85F** to start. A second board is nice later for “known-good bitstream” swaps; not required for Track 0.

### Do **not** order for Track 0

- Custom PCBs, DSI panels, battery packs, ESP32 modules (those are handheld tracks)
- Tiny iCE40 sticks (too little BRAM for honest on-die state work)
- Expensive Versa / enterprise ECP5 kits (ULX3S is enough)

### Fallback if ULX3S 85F is unavailable

| Fallback | Trade-off |
|----------|-----------|
| ULX3S **45F** | Same board/ecosystem; tighter LUT/BRAM — OK for shell, may force smaller capacity drafts |
| Digilent **Arty A7-100T** | More vendor tooling (Vivado); still fine for BRAM experiments; rewrite Task 8 pinouts/toolchain |

### Host software to install while waiting for shipping

```bash
# macOS example — adjust for Linux
brew install yosys nextpnr-ecp5 openfpgaloader verilator cmake python3
```

Also keep the repo’s normal Node + C++ toolchain (`npm install`, `make build`).

---

## File structure

- Create `docs/superpowers/notes/2026-07-21-ppu-track0-usage.md`
  - Buy list, toolchain install, host commands, FPGA flash/UART flow
- Create `ppu/README.md`
  - Track 0 scope; points at spec + this plan
- Create `ppu/include/ppu/ppu.h`
  - Stable C API for the exterior contract
- Create `ppu/src/host/ppu_host.cpp`
  - Reference PPU (native-runtime-backed in Track 0)
- Create `ppu/src/capacity/ppu_capacity_report.cpp`
  - Corpus → draft SRAM budgets JSON
- Create `ppu/tests/ppu_api_smoke.cpp`
  - Load sokoban fixture, tick, compare export view
- Create `scripts/ppu_golden_trace.js`
  - Drive JS oracle; emit NDJSON golden ticks
- Create `scripts/test_ppu_golden_trace.js`
  - Unit tests for trace schema
- Create `ppu/fixtures/sokoban_basic.trace.ndjson`
  - Checked-in tiny golden trace (generated, then frozen)
- Create `ppu/fpga/ulx3s/README.md`
  - Board-specific build/flash
- Create `ppu/fpga/ulx3s/rtl/ppu_shell.v`
  - Hollow PPU: BRAM state + UART protocol + cycle count
- Create `ppu/fpga/ulx3s/rtl/uart_rx.v`, `uart_tx.v`, `ppu_cmd.v`
  - Minimal serial framing
- Create `ppu/fpga/ulx3s/ulx3s.lpf`
  - Pin constraints (UART, LEDs)
- Create `ppu/fpga/ulx3s/Makefile`
  - Yosys → nextpnr-ecp5 → ecppack → openFPGALoader
- Create `scripts/ppu_fpga_host.py`
  - PC-side load/tick/readback client
- Modify `Makefile` (repo root)
  - `ppu_capacity_report`, `ppu_tests`, `ppu_golden_trace` helpers
- Modify `CMakeLists.txt` / add `ppu/CMakeLists.txt`
  - Build host PPU + tests

---

### Task 1: Shopping + usage note (human gate)

**Files:**
- Create: `docs/superpowers/notes/2026-07-21-ppu-track0-usage.md`
- Create: `ppu/README.md`

- [ ] **Step 1: Write the usage note with the buy list**

Create `docs/superpowers/notes/2026-07-21-ppu-track0-usage.md` containing the shopping table from this plan’s “What to order” section, plus:

```markdown
# PPU Track 0 usage

## Order
1. ULX3S ECP5 85F (primary)
2. USB-C data cable

## Host setup (no board required)
npm install
make build
make ppu_tests
make ppu_capacity_report

## Board bring-up (when hardware arrives)
cd ppu/fpga/ulx3s && make prog
python3 scripts/ppu_fpga_host.py --port /dev/cu.usbserial-* smoke
```

- [ ] **Step 2: Write `ppu/README.md`**

```markdown
# Puzzle Processing Unit (Track 0)

Spec: `docs/superpowers/specs/2026-07-21-puzzle-processing-unit-design.md`
Plan: `docs/superpowers/plans/2026-07-21-puzzle-processing-unit-track0.md`
Usage: `docs/superpowers/notes/2026-07-21-ppu-track0-usage.md`

Track 0 = exterior contract + host reference PPU + capacity report + FPGA shell.
Not yet a full RTL rule engine.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/notes/2026-07-21-ppu-track0-usage.md ppu/README.md
git commit -m "docs(ppu): Track 0 usage note and shopping list"
```

- [ ] **Step 4: Place the hardware order**

Human action: buy ULX3S 85F from Mouser/Crowd Supply/EEZ. Software continues without waiting.

---

### Task 2: Stable PPU C API header

**Files:**
- Create: `ppu/include/ppu/ppu.h`

- [ ] **Step 1: Write the header**

```c
#ifndef PUZZLESCRIPT_PPU_H
#define PUZZLESCRIPT_PPU_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum ppu_status {
  PPU_OK = 0,
  PPU_BUSY = 1,
  PPU_NEED_AGAIN = 2,
  PPU_FAULT_CAPACITY = 3,
  PPU_FAULT_PROTOCOL = 4,
  PPU_FAULT_INTERNAL = 5
} ppu_status;

typedef enum ppu_tick_reason {
  PPU_TICK_INPUT_UP = 1,
  PPU_TICK_INPUT_DOWN = 2,
  PPU_TICK_INPUT_LEFT = 3,
  PPU_TICK_INPUT_RIGHT = 4,
  PPU_TICK_INPUT_ACTION = 5,
  PPU_TICK_UNDO = 6,
  PPU_TICK_RESTART = 7,
  PPU_TICK_AGAIN = 8,
  PPU_TICK_REALTIME = 9
} ppu_tick_reason;

typedef enum ppu_command_type {
  PPU_CMD_SFX = 1,
  PPU_CMD_MESSAGE = 2,
  PPU_CMD_WIN = 3
} ppu_command_type;

typedef struct ppu_command {
  uint32_t type;
  uint32_t a;
  uint32_t b;
} ppu_command;

typedef struct ppu_capacity {
  uint32_t max_width;
  uint32_t max_height;
  uint32_t max_state_bytes;
  uint32_t max_ir_bytes;
  uint32_t max_undo_depth;
  uint32_t max_commands_per_tick;
} ppu_capacity;

typedef struct ppu_export_cell {
  /* Oracle-visible object bits for one cell; layout documented in ppu/README.md */
  uint64_t words[4];
} ppu_export_cell;

typedef struct ppu ppu;

ppu *ppu_create(const ppu_capacity *cap);
void ppu_destroy(ppu *p);

ppu_status ppu_load_cartridge(ppu *p, const uint8_t *bytes, size_t len);
ppu_status ppu_load_level(ppu *p, uint32_t level_index);
ppu_status ppu_tick(ppu *p, ppu_tick_reason reason);

uint64_t ppu_tick_gen(const ppu *p);
ppu_status ppu_status_get(const ppu *p);

uint32_t ppu_width(const ppu *p);
uint32_t ppu_height(const ppu *p);
ppu_status ppu_export_state(const ppu *p, ppu_export_cell *out, size_t out_count);

size_t ppu_command_count(const ppu *p);
ppu_status ppu_command_at(const ppu *p, size_t i, ppu_command *out);

#ifdef __cplusplus
}
#endif
#endif
```

- [ ] **Step 2: Commit**

```bash
git add ppu/include/ppu/ppu.h
git commit -m "feat(ppu): add Track 0 exterior C API header"
```

---

### Task 3: Golden tick trace format + JS generator

**Files:**
- Create: `scripts/ppu_golden_trace.js`
- Create: `scripts/test_ppu_golden_trace.js`
- Create: `ppu/fixtures/sokoban_basic.inputs.json`

- [ ] **Step 1: Write failing unit test for schema**

```js
// scripts/test_ppu_golden_trace.js
const assert = require('assert');
const { validateTraceLine, encodeTickReason } = require('./ppu_golden_trace');

assert.strictEqual(encodeTickReason('right'), 4);
assert.throws(() => validateTraceLine({ type: 'nope' }));
console.log('ok');
```

- [ ] **Step 2: Run test — expect FAIL (module missing exports)**

```bash
node scripts/test_ppu_golden_trace.js
```

Expected: `Cannot find module` or `encodeTickReason is not a function`

- [ ] **Step 3: Implement generator module**

`scripts/ppu_golden_trace.js` must:

1. Accept `--source src/demo/sokoban_basic.txt --inputs ppu/fixtures/sokoban_basic.inputs.json --out ppu/fixtures/sokoban_basic.trace.ndjson`
2. Boot the existing JS engine the same way `src/tests/run_tests_node.js` loads sources (reuse that load order / `compile` + level start pattern already used by sim tests)
3. For each input, perform **one** engine tick, then if the engine sets `again`, emit separate trace lines with `"reason":"again"` until clear (do not collapse)
4. Each NDJSON line shape:

```json
{
  "type": "tick",
  "tick_gen": 1,
  "reason": "right",
  "width": 5,
  "height": 5,
  "cells": [".....", "..P..", ".@*..", ".....", "....."],
  "commands": [{"type": "sfx", "id": 0}],
  "need_again": false
}
```

Cell encoding for Track 0 fixtures may use ASCII level glyphs for human diffing **plus** a parallel `cell_words` array once the export view is wired; start with glyphs matching JS level print if available, otherwise dump object masks as hex words.

5. Export `encodeTickReason` / `validateTraceLine` for the unit test.

- [ ] **Step 4: Re-run unit test — expect PASS**

```bash
node scripts/test_ppu_golden_trace.js
```

- [ ] **Step 5: Add input fixture and generate frozen trace**

`ppu/fixtures/sokoban_basic.inputs.json`:

```json
{ "inputs": ["right", "right", "up", "again"] }
```

Only include `"again"` as an explicit entry if the previous tick set `need_again`; the generator should auto-expand `again` chains even when inputs omit them. Prefer auto-expand; keep the fixture as player inputs only:

```json
{ "inputs": ["right", "up", "left", "down", "action"] }
```

Generate:

```bash
node scripts/ppu_golden_trace.js \
  --source src/demo/sokoban_basic.txt \
  --inputs ppu/fixtures/sokoban_basic.inputs.json \
  --out ppu/fixtures/sokoban_basic.trace.ndjson
```

- [ ] **Step 6: Commit**

```bash
git add scripts/ppu_golden_trace.js scripts/test_ppu_golden_trace.js \
  ppu/fixtures/sokoban_basic.inputs.json ppu/fixtures/sokoban_basic.trace.ndjson
git commit -m "feat(ppu): JS oracle golden tick traces for Track 0"
```

---

### Task 4: Capacity report from corpus

**Files:**
- Create: `ppu/src/capacity/ppu_capacity_report.cpp`
- Create: `ppu/CMakeLists.txt`
- Modify: root `CMakeLists.txt` / `Makefile`

- [ ] **Step 1: Implement report tool**

Build `puzzlescript_ppu_capacity_report` that:

1. Loads the same testdata corpus path used by `puzzlescript_handheld_report` (reuse bundle NDJSON if present; otherwise document `make handheld_report` as a prerequisite to produce `build/handheld_testdata.bundle.ndjson`)
2. For each compiling game/level, records `width`, `height`, object count, rough state bytes estimate:

```text
state_bytes ≈ width * height * ceil(object_bitwidth/8) * k_layers_factor
```

Use native compiler metadata where available; if only level ASCII is available, estimate object bitwidth from compiled object count.

3. Writes JSON to stdout / `build/ppu_capacity_draft.json`:

```json
{
  "generated_at": "...",
  "levels_scanned": 0,
  "p50": {"w": 0, "h": 0, "state_bytes": 0},
  "p90": {"w": 0, "h": 0, "state_bytes": 0},
  "p99": {"w": 0, "h": 0, "state_bytes": 0},
  "max": {"w": 0, "h": 0, "state_bytes": 0},
  "draft_budget": {
    "max_width": 0,
    "max_height": 0,
    "max_state_bytes": 0,
    "max_ir_bytes": 1048576,
    "max_undo_depth": 64,
    "max_commands_per_tick": 32,
    "notes": "draft; p99*1.25 headroom for state"
  }
}
```

Set `draft_budget.max_width/height/state_bytes` from p99 × 1.25 (ceil), capped only if absurd (>256 on a side → still report, but flag `"requires_hybrid_memory": true` without implementing hybrid).

- [ ] **Step 2: Wire Make target**

```makefile
.PHONY: ppu_capacity_report
ppu_capacity_report: ## Draft PPU on-die capacity budgets from corpus
	cmake --build $(BUILD_DIR) --target puzzlescript_ppu_capacity_report
	$(BUILD_DIR)/native/puzzlescript_ppu_capacity_report \
	  --corpus-ndjson build/handheld_testdata.bundle.ndjson \
	  > build/ppu_capacity_draft.json
```

(Adjust binary output path to match `ppu/CMakeLists.txt`.)

- [ ] **Step 3: Run report**

```bash
make handheld_report
make ppu_capacity_report
head -n 40 build/ppu_capacity_draft.json
```

Expected: JSON with nonzero percentiles and a `draft_budget` object.

- [ ] **Step 4: Commit**

```bash
git add ppu/CMakeLists.txt ppu/src/capacity/ppu_capacity_report.cpp Makefile CMakeLists.txt
git commit -m "feat(ppu): corpus capacity draft report for on-die SRAM budgets"
```

---

### Task 5: Host reference PPU (native-backed)

**Files:**
- Create: `ppu/src/host/ppu_host.cpp`
- Create: `ppu/tests/ppu_api_smoke.cpp`
- Modify: `ppu/CMakeLists.txt`

- [ ] **Step 1: Write failing smoke test**

```cpp
#include "ppu/ppu.h"
#include <cassert>
#include <fstream>
#include <vector>

static std::vector<uint8_t> read_file(const char *path);

int main() {
  ppu_capacity cap{};
  cap.max_width = 64;
  cap.max_height = 64;
  cap.max_state_bytes = 1 << 20;
  cap.max_ir_bytes = 1 << 20;
  cap.max_undo_depth = 64;
  cap.max_commands_per_tick = 32;

  ppu *p = ppu_create(&cap);
  assert(p);

  auto cart = read_file("src/demo/sokoban_basic.txt");
  assert(ppu_load_cartridge(p, cart.data(), cart.size()) == PPU_OK);
  assert(ppu_load_level(p, 0) == PPU_OK);

  ppu_status st = ppu_tick(p, PPU_TICK_INPUT_RIGHT);
  assert(st == PPU_OK || st == PPU_NEED_AGAIN);
  assert(ppu_tick_gen(p) >= 1);

  ppu_destroy(p);
  return 0;
}
```

Track 0 may accept `.txt` cartridges by compiling through the native compiler inside `ppu_load_cartridge` (host-only convenience). Document that FPGA cartridges will be binary IR later.

- [ ] **Step 2: Run test — expect link failure**

```bash
cmake --build build --target ppu_api_smoke
```

Expected: missing `ppu_create` / unresolved symbols

- [ ] **Step 3: Implement `ppu_host.cpp`**

Minimum behavior:

- `ppu_load_cartridge`: compile source with native API; reject if level dims exceed `ppu_capacity`
- `ppu_load_level`: select level, snapshot undo base
- `ppu_tick`: map `ppu_tick_reason` to native input; execute **one** turn; if native `again`, return `PPU_NEED_AGAIN` without auto-continuing
- `ppu_export_state`: fill `ppu_export_cell` words from native cell masks (document word packing in `ppu/README.md`)
- Harvest SFX/message/win into command list for the tick

- [ ] **Step 4: Run smoke — expect PASS**

```bash
cmake --build build --target ppu_api_smoke && ./build/ppu/ppu_api_smoke
```

- [ ] **Step 5: Commit**

```bash
git add ppu/src/host/ppu_host.cpp ppu/tests/ppu_api_smoke.cpp ppu/CMakeLists.txt ppu/README.md
git commit -m "feat(ppu): host reference PPU backed by native runtime"
```

---

### Task 6: Oracle parity — host PPU vs golden trace

**Files:**
- Create: `ppu/tests/ppu_oracle_trace.cpp`
- Modify: `ppu/CMakeLists.txt`, `Makefile`

- [ ] **Step 1: Write oracle replay test**

Read `ppu/fixtures/sokoban_basic.trace.ndjson`. For each `tick` line:

1. If reason is player input, call `ppu_tick` with mapped reason
2. If reason is `again`, call `ppu_tick(p, PPU_TICK_AGAIN)`
3. Compare `tick_gen`, `need_again`, command stream, and export view / glyph dump against the line
4. Fail with the first differing tick index

- [ ] **Step 2: Run — expect FAIL until export view matches generator**

```bash
cmake --build build --target ppu_oracle_trace && ./build/ppu/ppu_oracle_trace
```

- [ ] **Step 3: Align export encoding**

Update either `scripts/ppu_golden_trace.js` or `ppu_export_state` so both use the **same** documented cell word packing. Re-freeze the NDJSON fixture. Re-run until PASS.

- [ ] **Step 4: Add `make ppu_tests`**

```makefile
.PHONY: ppu_tests
ppu_tests: ## Host PPU smoke + oracle trace tests
	cmake --build $(BUILD_DIR) --target ppu_api_smoke ppu_oracle_trace
	$(BUILD_DIR)/ppu/ppu_api_smoke
	$(BUILD_DIR)/ppu/ppu_oracle_trace
	node scripts/test_ppu_golden_trace.js
```

- [ ] **Step 5: Commit**

```bash
git add ppu/tests/ppu_oracle_trace.cpp ppu/fixtures/sokoban_basic.trace.ndjson \
  scripts/ppu_golden_trace.js Makefile ppu/CMakeLists.txt
git commit -m "test(ppu): oracle replay of golden ticks on host PPU"
```

---

### Task 7: Area / energy worksheet stub (host-side)

**Files:**
- Create: `ppu/docs/area_energy_worksheet.md`
- Create: `scripts/ppu_area_estimate.js`

- [ ] **Step 1: Write worksheet**

Populate from `build/ppu_capacity_draft.json`:

- SRAM bits = `max_state_bytes * 8 * (1 + max_undo_depth)` + IR bits + scratch estimate (scratch = `2 * max_state_bytes`)
- Note ECP5 85F BRAM capacity (~3.7 Mbit class — look up exact and paste number in the doc when writing) and whether draft budget fits with margin
- Energy section: define Track 0 proxy = FPGA cycle count per tick (filled in Task 10), not joules yet

- [ ] **Step 2: Script that prints fit/fail**

```bash
node scripts/ppu_area_estimate.js --budget build/ppu_capacity_draft.json --fpga ecp5-85f
```

Exit nonzero if draft state+undo exceeds 50% of listed BRAM (leave headroom for softcore later).

- [ ] **Step 3: Commit**

```bash
git add ppu/docs/area_energy_worksheet.md scripts/ppu_area_estimate.js
git commit -m "docs(ppu): area/energy worksheet stub from capacity draft"
```

---

### Task 8: FPGA hollow shell RTL (ULX3S)

**Files:**
- Create: `ppu/fpga/ulx3s/rtl/ppu_shell.v`
- Create: `ppu/fpga/ulx3s/rtl/uart_rx.v`
- Create: `ppu/fpga/ulx3s/rtl/uart_tx.v`
- Create: `ppu/fpga/ulx3s/rtl/ppu_cmd.v`
- Create: `ppu/fpga/ulx3s/ulx3s.lpf`
- Create: `ppu/fpga/ulx3s/Makefile`
- Create: `ppu/fpga/ulx3s/README.md`

- [ ] **Step 1: Define UART byte protocol (document in README)**

```text
Host -> FPGA packets:
  0x01 'L' <u16 n> <n bytes>     load state bytes into BRAM (n <= CAP)
  0x02 'T' <u8 reason>           start tick
  0x03 'R' <u16 off> <u16 n>     read n state bytes from offset
  0x04 'G'                       read tick_gen + status + last_cycles (fixed 16-byte reply)

FPGA -> Host:
  0x80 ACK
  0x81 NACK <u8 code>
  0x82 DATA <u16 n> <payload>
```

Tick behavior in Track 0 hollow core:

- Copy reason to a register
- Increment `tick_gen`
- Burn a configurable number of cycles (or a trivial NOP state touch: XOR byte 0 with reason) so cycle counter is nonzero
- Set status `NEED_AGAIN` if reason == AGAIN else OK
- **Do not** implement PuzzleScript rules yet

- [ ] **Step 2: Implement RTL + constraints**

Use 25 MHz / board clock per ULX3S examples; UART 115200 8N1 on the USB-serial pins documented for ULX3S (`ftdi` channel used by `openFPGALoader` / `ujprog` — follow `ppu/fpga/ulx3s/README.md` with the exact pin names from the ULX3S `ulx3s.lpf` community file).

Drive one LED while `BUSY`.

- [ ] **Step 3: Build bitstream (no board required)**

```bash
cd ppu/fpga/ulx3s && make bit
```

Expected: `ppu_shell.bit` produced; nextpnr prints BRAM usage.

- [ ] **Step 4: Commit**

```bash
git add ppu/fpga/ulx3s
git commit -m "feat(ppu): ULX3S hollow PPU shell RTL and build"
```

---

### Task 9: FPGA host client + smoke (needs board)

**Files:**
- Create: `scripts/ppu_fpga_host.py`
- Modify: `docs/superpowers/notes/2026-07-21-ppu-track0-usage.md`

- [ ] **Step 1: Implement client**

```python
# scripts/ppu_fpga_host.py — argparse:
#   smoke --port PORT
#   load-tick-read --port PORT --bytes 256
```

`smoke` must: open serial, load 256 zero bytes, tick RIGHT, readback, print `tick_gen` and `last_cycles`, exit 0 on ACK path.

- [ ] **Step 2: Program board**

```bash
cd ppu/fpga/ulx3s && make prog
python3 scripts/ppu_fpga_host.py smoke --port /dev/cu.usbserial-XXXX
```

Expected: ACK, `tick_gen >= 1`, `last_cycles > 0`.

- [ ] **Step 3: Commit**

```bash
git add scripts/ppu_fpga_host.py docs/superpowers/notes/2026-07-21-ppu-track0-usage.md
git commit -m "feat(ppu): UART host client for ULX3S PPU shell smoke"
```

---

### Task 10: Track 0 acceptance gate

**Files:**
- Modify: `docs/superpowers/notes/2026-07-21-ppu-track0-usage.md`
- Modify: `ppu/docs/area_energy_worksheet.md` (fill cycle-count proxy from board)

- [ ] **Step 1: Run full host gate**

```bash
make ppu_tests
make ppu_capacity_report
node scripts/ppu_area_estimate.js --budget build/ppu_capacity_draft.json --fpga ecp5-85f
```

All must pass / fit.

- [ ] **Step 2: Run board gate**

```bash
cd ppu/fpga/ulx3s && make prog
python3 scripts/ppu_fpga_host.py smoke --port "$PPU_PORT"
```

- [ ] **Step 3: Write “Track 0 done / Track 1 next” checklist into the usage note**

Track 1 preview (do not implement here):

1. PPU IR v0 lowering from native `--emit-ir-json`
2. RTL rule match/apply for a subset sufficient for `sokoban_basic`
3. Same golden trace must pass on FPGA (not only host model)
4. Revisit capacity numbers vs measured BRAM

- [ ] **Step 4: Final commit**

```bash
git add docs/superpowers/notes/2026-07-21-ppu-track0-usage.md ppu/docs/area_energy_worksheet.md
git commit -m "docs(ppu): Track 0 acceptance notes and Track 1 preview"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| PPU exterior contract | Task 2, 5 |
| JS oracle equivalence | Task 3, 6 |
| Discrete `again` / realtime ticks | Task 3, 5, 6 (`NEED_AGAIN`, no collapse) |
| On-die working state (model B) | Task 4, 7, 8 (BRAM) |
| Host compile first | Task 5 (host `.txt`); FPGA binary IR deferred to Track 1 |
| Capacity honesty | Task 4, 7 |
| Perf/energy proxies | Task 7, 8–10 (cycle counter) |
| Area as first-class | Task 7 |
| FPGA then ASIC path open | Task 8–10; ASIC only as worksheet |
| Not a handheld product | Scope boundary |

## Placeholder / consistency self-review

- No TBD steps; open encoding details are explicitly Track 1.
- API names (`ppu_tick`, `PPU_NEED_AGAIN`, `tick_gen`) are consistent across tasks.
- Hardware recommendation is concrete (ULX3S 85F + buy links + fallback).
