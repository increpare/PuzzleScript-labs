# Pocket Card electronics

This directory contains the authoritative native KiCad project for the Pocket
Card controller. Engineers edit `pocket_card_controller.kicad_pro` here.

## Editing rules

Annotate every new symbol before updating the PCB. PCB updates must use the
established symbol associations so existing footprints, placement, and routing
remain attached to their intended symbols.

Custom symbols, footprints, and 3D models must use `${KIPRJMOD}`-relative paths
in the project tree:

- `symbols/` — custom schematic symbols
- `footprints.pretty/` — custom footprints
- `3dmodels/` — STEP/WRL models referenced by footprints

Machine-local or absolute asset paths are not permitted. The project-local
`fp-lib-table` and optional `sym-lib-table` reference KiCad 10 standard libraries
via `${KICAD10_FOOTPRINT_DIR}` and project-relative custom entries.

KiCad **10.0.4** or newer is required (`toolchain.json` pins major version 10
and the minimum release).

KiCad local state is not source: do not commit `.kicad_prl` files, `.lck` files,
backups, or caches.

## Validation and exports

Normal Make targets validate or export this project. They never regenerate the
schematic, component placement, or routing.

```
make pocket_card_kicad           # read-only validation (ERC, DRC, parity, mechanics)
make pocket_card_kicad_check     # same validation entry point
make pocket_card_pcb_exports     # gerbers, BOM, drill, pos, STEP, STL → case/out/pcb/
```

`make pocket_card_kicad` runs `electronics_pipeline.validation` against the
checked-in project. It is not a generator.

## Mechanical contract and locks

`mechanical_contract.json` records placement, courtyard, overlap, and keepout
rules that tie the routed board to enclosure CAD in `case/`. Validation compares
the live board against this contract.

Footprint and Edge.Cuts locks on contracted items are accident prevention — they
discourage casual KiCad drags. The contract is the review gate: if an engineer
moves a contracted feature, update `mechanical_contract.json` deliberately (and
enclosure CAD / `case/params.py` when the shell must change) before validation
passes.

`validation_waivers.json` holds the canonical ERC/DRC/parity warning policy.
Returned copies in engineer handoff ZIPs cannot waive findings; check always
uses this repository file.

## Silkscreen

Board silk defaults to **readable mode**: functional UI legends (POWER / MUTE /
d-pad / connector pin names) plus visible KiCad `Reference` labels. Dense
decorative art (brick wallpaper, rule corpus, brand/logo) is off by default.

Restore decorative silk later by setting `DECORATIVE_SILK = True` in
`../case/params.py`, then:

```bash
cd hardware/pocket_card/case && .venv/bin/python -c \
  "import silk; print(silk.refresh_board_silk('../electronics/pocket_card_controller.kicad_pcb'))"
```

After toggling, regenerate silk DRC waiver digests in `validation_waivers.json`
(and the matching `_EXPECTED_WARNING_POLICY` entries) so `make pocket_card_kicad`
still passes.

## Engineer handoff

Repeated ZIP exchange with an external engineer:

```
make pocket_card_engineer_export                  # INCLUDE_BLEND=1 by default
make pocket_card_engineer_check ZIP=/absolute/path/returned.zip
make pocket_card_engineer_accept STAGED=/absolute/path/printed-stage
```


Full operator runbook: [`../README.md`](../README.md#engineer-exchange-workflow).

`pocket_card_engineer_check` stages the returned project, runs the same
validation as `pocket_card_kicad`, diffs inventories against the baseline
recorded in the handoff metadata, and writes `report.md`. Unknown or concurrent
stale baselines are not auto-merged.

After accept, run `make pocket_card_kicad` and `make pocket_card_case`, then
commit KiCad source separately from regenerated release artifacts in
`case/out/`.
