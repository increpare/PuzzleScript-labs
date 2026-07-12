# PuzzleScript Pocket Card hardware

This is the ES3C28P/ESP32-S3 target defined by `docs/superpowers/specs/2026-07-12-puzzlescript-pocket-card-design.md`.

It does not inherit the ESP32-P4, DSI, power, or geometry contracts in `hardware/card/`.

The JSON contract is transcribed from the vendor specification and schematic. Pin changes require updating the test and citing a new module revision.

Primary sources:

- https://www.lcdwiki.com/2.8inch_ESP32-S3_Display
- https://www.lcdwiki.com/res/ES3C28P/ES3C28P_ES2N28P_Specification_V1.0.pdf
- https://www.lcdwiki.com/res/ES3C28P/2.8inch_ESP32-S3_Display_Schematic.pdf
