# PuzzleScript Pocket Card hardware

This is the ES3C28P/ESP32-S3 target defined by
`docs/superpowers/specs/2026-07-12-puzzlescript-pocket-card-design.md`.

It does not inherit the ESP32-P4, DSI, power, or geometry contracts in
`hardware/card/`.

## Electrical source of truth

`hardware/pocket_card/electronics/` is the sole editable electrical source.
Open and edit `electronics/pocket_card_controller.kicad_pro` in native KiCad.

- Custom symbols, footprints, and 3D models must live under `${KIPRJMOD}`-relative
  paths in the project tree (`symbols/`, `footprints.pretty/`, `3dmodels/`).
  Machine-local or absolute asset paths are not permitted.
- KiCad **10.0.4** or newer is required (`electronics/toolchain.json` pins the
  major version and minimum release).
- KiCad local state is not source: do not commit `.kicad_prl` files, `.lck`
  files, backups, or caches.

`make pocket_card_kicad` is read-only: it validates the native project (ERC,
DRC, schematic/board parity, mechanical contract) and never regenerates the
schematic, placement, or routing.

Footprint locks on contracted mechanical items are accident prevention — they
stop casual KiCad edits from drifting placement. The mechanical contract in
`electronics/mechanical_contract.json` is the review gate: deliberate enclosure
or placement changes require updating that contract (and enclosure CAD when
needed) before validation passes.

The JSON connectivity model, schematic generator, and `case/out/pcb/` KiCad
project under `schematic/` are historical legacy compatibility artifacts. They
cannot accept production electrical edits and must not overwrite `electronics/`.
See [`schematic/README.md`](schematic/README.md) for the legacy workflow.

Review [`ELECTRICAL_AUDIT.md`](ELECTRICAL_AUDIT.md) before treating any board as
manufacture-ready.

## Normal Make targets

From the repository root:

```
make pocket_card_electronics_tests   # pipeline unit tests
make pocket_card_kicad               # validate native KiCad sources (read-only)
make pocket_card_kicad_check         # same validation, no alias overhead
make pocket_card_pcb_exports         # export fabrication artifacts from native sources
make pocket_card_case                # export native board, then rebuild shells + order pack
make pocket_card_case_shells         # rebuild shells from current PCB exports only
```

`make pocket_card_case` runs `pocket_card_pcb_exports` first so enclosure CAD
always consumes exports from the edited native board. `make pocket_card_case_shells`
refuses stale board exports (`exports --check-current`) and rebuilds shells
without regenerating PCB meshes.

Destructive legacy regeneration is isolated:

```
make pocket_card_legacy_pcb_rebuild  # requires POCKET_CARD_ALLOW_LEGACY_REBUILD=1
make pocket_card_legacy_schematic_tests
```

## Engineer exchange workflow

Repeated ZIP handoffs with an external engineer use the validation-gated
pipeline in `electronics_pipeline/`. Details: [`electronics/README.md`](electronics/README.md).

Operator runbook (each round):

```
1. make pocket_card_engineer_export INCLUDE_BLEND=1
2. Send the printed ZIP; keep its Git commit/digest in the archive.
3. Receive the returned ZIP.
4. git switch -c engineer/pocket-card-rN
5. make pocket_card_engineer_check ZIP=/absolute/path/returned.zip
6. Review report.md and the raw Git/KiCad diff.
7. make pocket_card_engineer_accept STAGED=/absolute/path/printed-stage
8. If mechanical review is required, update enclosure CAD and mechanical_contract.json deliberately.
9. make pocket_card_kicad
10. make pocket_card_case
11. Commit KiCad source separately from regenerated release artifacts.
```

Export a handoff revision:

```
make pocket_card_engineer_export
make pocket_card_engineer_export INCLUDE_BLEND=1   # include completed Blender assembly
```

Validate a returned ZIP (does not modify the working tree):

```
make pocket_card_engineer_check ZIP=/absolute/path/returned.zip
```

Accept a staged project after review:

```
make pocket_card_engineer_accept STAGED=/absolute/path/printed-stage
```

Returned policy copies inside the ZIP cannot waive findings — validation always
uses the canonical policy in the repository. Unknown or concurrent stale
baselines are not auto-merged; resolve the baseline mismatch before accept.

## Primary sources

- https://www.lcdwiki.com/2.8inch_ESP32-S3_Display
- https://www.lcdwiki.com/res/ES3C28P/ES3C28P_ES2N28P_Specification_V1.0.pdf
- https://www.lcdwiki.com/res/ES3C28P/2.8inch_ESP32-S3_Display_Schematic.pdf
