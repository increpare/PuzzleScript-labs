# PuzzleScript Card Blockout Tool

Parametric blockout viewer for the PuzzleScript Card handheld
(`docs/superpowers/specs/2026-07-07-handheld-compact-card-design.md`). Open
`index.html` in a browser (no server or build step). Tweak millimeter
coordinates, watch geometry warnings, and export a printable 1:1 SVG sheet
(A4 landscape, 100 mm calibration bar).

The spec's known conflicts (Menu clearance, battery/Undo overlap, speaker
band overrun) appear as warnings on purpose — they are open risks the
physical mockup must resolve.

Regenerate the committed validation sheets (1:1 face sheet + legibility
sheet with real sprites and the real PuzzleScript font) with:

    node tools/handheld_blockout/generate_sheets.js

Run the logic tests with:

    node tools/handheld_blockout/blockout_test.js
    node tools/handheld_blockout/legibility_test.js
    node tools/handheld_blockout/export_pcb_layout_test.js

Export PCB mechanical layers (outline, keep-outs, switch/connector anchors) for KiCad:

    make handheld_pcb_export
    # or: node tools/handheld_blockout/export_pcb_layout.js

Output: `hardware/card/mechanical/layout.json` and `layout.svg`. See
`hardware/card/README.md`.
