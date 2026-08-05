# PuzzleScript Pocket Card hardware

This is the ES3C28P/ESP32-S3 target defined by `docs/superpowers/specs/2026-07-12-puzzlescript-pocket-card-design.md`.

It does not inherit the ESP32-P4, DSI, power, or geometry contracts in `hardware/card/`.

> **Authoritative editable project:** Open and edit
> `hardware/pocket_card/electronics/pocket_card_controller.kicad_pro`. The
> connectivity JSON, generator, and `case/out/pcb` project are temporary legacy
> compatibility artifacts. Do not use them to overwrite `electronics/`.

The controller board's legacy compatibility electrical contract is
[`schematic/connectivity.json`](schematic/connectivity.json). The generated
KiCad schematic, its tests, the safe board-linking workflow, and the live-board
parity override are documented in [`schematic/README.md`](schematic/README.md).
Review [`ELECTRICAL_AUDIT.md`](ELECTRICAL_AUDIT.md) before treating the
generated schematic or routed board as manufacture-ready.

From the repository root:

```
make pocket_card_schematic_tests   # test canonical sources and legacy compatibility
make pocket_card_kicad             # regenerate legacy compatibility artifacts, then test
```

The legacy JSON contract is transcribed from the vendor specification and
schematic. Pin changes to that compatibility model require updating the test
and citing a new module revision.

Primary sources:

- https://www.lcdwiki.com/2.8inch_ESP32-S3_Display
- https://www.lcdwiki.com/res/ES3C28P/ES3C28P_ES2N28P_Specification_V1.0.pdf
- https://www.lcdwiki.com/res/ES3C28P/2.8inch_ESP32-S3_Display_Schematic.pdf
