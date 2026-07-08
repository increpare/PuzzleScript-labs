# PuzzleScript Card — tscircuit workflow

Code-first PCB design for the Card. No KiCad GUI required.

## Prerequisites

1. [Bun](https://bun.sh/) — `npm install -g bun` (tscircuit CLI expects bun on Windows)
2. From this directory: `bun install`

## Build (headless)

```bash
cd hardware/card/tscircuit
bun install
bun run build
```

Outputs under `dist/`:

| File | Contents |
|------|----------|
| `dist/index/circuit.json` | Full circuit model |
| `dist/card-pcb.svg` | Footprint/routing preview (tscircuit; fixed 800×600 canvas) |
| `dist/card-pcb-layout.svg` | **Mechanical fit** — 116×106 PCB + 120×110 body, keep-outs, anchors |
| `dist/card-schematic.svg` | Schematic preview |
| `dist/card.netlist` | Human-readable netlist |

## Live preview (browser)

```bash
bun run dev
```

Open http://localhost:3020 — PCB, schematic, and 3D update as you edit `index.circuit.tsx`.

## Export fabrication / EasyEDA bridge

```bash
bun run export
```

Or individually:

```bash
bun ./node_modules/tscircuit/cli.mjs export index.circuit.tsx -f kicad_zip -o dist/card-kicad.zip
bun ./node_modules/tscircuit/cli.mjs export index.circuit.tsx -f gerbers -o dist/card-gerbers.zip
```

Import `card-kicad.zip` into **EasyEDA Pro** (Format Converter → KiCad) if you want JLC’s browser editor.

## Import JLC parts from EasyEDA

```bash
bun ./node_modules/tscircuit/cli.mjs import C91145 --jlcpcb
```

Writes `imports/<part>.tsx` (microSD socket J4 uses `imports/TF_01A.tsx`).

## Source of truth

- Netlist / connectivity: `../schematic/connectivity.json`
- Board size / keep-outs: `../mechanical/layout.json`
- Circuit entrypoint: `index.circuit.tsx` — all 9 connectivity sheets represented (Power, Compute, Display, Storage, Controls, Audio, Haptic, Case RGB, Debug)

### Current slice status

| Sheet | Status |
|-------|--------|
| Power | USB-C, JST battery, BQ24075 (C15464), MAX17048 (C2682616), TPS62135 (C167238), L1, bulk caps |
| Compute | ESP32-P4-Module-32MB custom footprint (`imports/ESP32_P4_Module_32MB.tsx`) |
| Display | J3 KH 15-pin FFC 1.0 mm (C2925383), C3, DSI diff pairs → U1 |
| Storage | J4 microSD (JLC C91145 import) |
| Controls | SW1–SW10 at `layout.json` anchors |
| Audio | Q1 NPN + JP1 piezo pads |
| Haptic | U5 DRV2605L + B1 LRA |
| Case RGB | D1–D3 on GPIO42–44 |
| Debug | TP1–TP4 UART / boot / EN |

**Still placeholder:** buck FB divider resistors, LRA footprint, autoroute density on 116 mm board.

**JLC imports in `imports/`:** BQ24075RGTR, MAX17048G_T10, TPS62135RGXR, KH_FG1_0_H2_0_15PIN, DRV2605LDGSR, TYPE_C_16P_CB1_6_073 (BOM ref for J1), ESP32_P4_Module_32MB (Waveshare, not JLC).

**Firmware:** `firmware/esp32p4` — enable `CONFIG_PS_BOARD_CARD` in menuconfig; GPIO map in `board_card_pins.hpp`.

**Known quirks:**
- `card-pcb.svg` — tscircuit headless export uses a fixed 800×600 canvas; board outline may not fill the view. Use **`card-pcb-layout.svg`** for mechanical fit (116×106 PCB + 120×110 body, keep-outs, anchors), or `bun run dev` for interactive PCB view.
- Readable netlist may show `J1` USB pins as `NOT_CONNECTED` (USB-C subcircuit); verify in `circuit.json`.

## Tests

From repo root:

```bash
node hardware/card/tscircuit/build_test.js
```

Or `make handheld_card_tscircuit` if make is available.
