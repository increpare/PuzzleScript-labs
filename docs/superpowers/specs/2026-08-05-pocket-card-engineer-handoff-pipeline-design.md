# Pocket Card — Repeated Electrical-Engineer Handoff Pipeline

Date: 2026-08-05
Status: approved in design session.

## Purpose

Pocket Card will be revised repeatedly by an electrical engineer through ZIP
exchanges. The engineer must be free to add, remove, replace, place, and route
components in KiCad without a repository generator overwriting that work.
Mechanically sensitive changes remain possible, but must be detected before a
stale enclosure or manufacturing package is released.

The central decision is that the native KiCad project becomes the sole
electrical source of truth. Repository code validates and exports it; repository
code does not normally regenerate its schematic, placement, or routing.

## Current problem

The current ownership model is suitable for bootstrapping, not collaboration:

- `hardware/pocket_card/schematic/connectivity.json` owns connectivity and
  regenerates the schematic.
- `hardware/pocket_card/case/build_pcb.sh` regenerates board placement,
  routing, and zones.
- The editable KiCad files live under `hardware/pocket_card/case/out/pcb/`, a
  path that otherwise contains generated artifacts.
- `make pocket_card_case` invokes the destructive board rebuild.

An engineer can edit the KiCad project correctly and still lose the edits the
next time either generator runs. Maintaining KiCad and `connectivity.json` as
two editable electrical models would also require a fragile bidirectional
synchronizer once the design gains more components.

## Source ownership and directory layout

The canonical project moves to:

```text
hardware/pocket_card/electronics/
  pocket_card_controller.kicad_pro
  pocket_card_controller.kicad_sch
  pocket_card_controller.kicad_pcb
  fp-lib-table
  sym-lib-table                    # when project-local symbols are needed
  footprints.pretty/              # when custom footprints are needed
  symbols/                         # when custom symbols are needed
  3dmodels/                        # custom models referenced via ${KIPRJMOD}
  toolchain.json                   # repository-pinned KiCad major version
  mechanical_contract.json
  validation_waivers.json
  README.md
```

The `.kicad_pro`, `.kicad_sch`, and `.kicad_pcb` files together are the
authoritative electrical design. Existing references must remain stable; new
symbols must be annotated before the PCB is updated. Existing and new
footprints must retain KiCad's symbol association rather than relying on
reference-based relinking.

Standard KiCad libraries may use the pinned major-version environment paths.
Custom symbols, footprints, and models must travel with the project and use
`${KIPRJMOD}`-relative paths. User-global libraries and absolute workstation
paths are not accepted dependencies.

Derived fabrication and visualization files continue to live outside the
canonical directory, initially under `hardware/pocket_card/case/out/pcb/` so
the enclosure pipeline can keep consuming its existing names. Source commits
and regenerated-output commits should remain separate even where release
artifacts are tracked.

`toolchain.json`, `mechanical_contract.json`, and `validation_waivers.json`
are repository-owned review policy. They are included in a handoff for context,
but a returned ZIP cannot change the policy used to judge itself. The acceptance
command promotes KiCad project and project-library inputs only; policy changes
are separate, deliberate repository edits.

## Legacy generators

The current JSON-to-schematic, placement, and routing generators are retained
for provenance and experiments, but removed from every normal check, export,
case, and handoff dependency chain. They move behind an explicitly named
`pocket_card_legacy_pcb_rebuild` entry point with a destructive-operation
guard. Its output is not copied over the canonical KiCad project.

`connectivity.json` becomes a historical bootstrap artifact, not an editable
production contract. Tests that are still useful are adapted to inspect the
native project; tests that only prove deterministic regeneration move with the
legacy generator.

## Mechanically sensitive features

The engineer has full design authority, including the ability to change the
board outline or move enclosure-facing parts. Safety comes from detection and
review rather than silently preventing intentional work.

Two guardrails are used:

1. Critical KiCad items are marked locked: the Edge.Cuts geometry, mounting
   holes, face switches, edge switches, and enclosure-facing connectors or
   headers. A lock prevents accidental dragging but can be deliberately
   removed by the engineer.
2. `mechanical_contract.json` independently records the expected mechanical
   interface. The validator checks each critical reference's existence,
   position, rotation, board side, lock state, and allowed tolerances. It also
   checks normalized Edge.Cuts geometry, board thickness, and declared
   component-height or keep-out envelopes.

The contract uses explicit millimetre and degree tolerances rather than exact
text-file equality. Each entry includes a short rationale so a future reviewer
knows why it matters to the enclosure.

A mismatch is reported as `MECHANICAL REVIEW REQUIRED`. It does not mean the
engineer's change is wrong. It prevents case/release targets from using stale
mechanical assumptions until the enclosure is adjusted or the change is
reverted, and then the contract is deliberately updated.

## Validation layers

Validation is read-only with respect to the canonical KiCad files and produces
reports in a temporary or derived-output directory.

### Project integrity

- The expected project, schematic, and board are present and loadable.
- The KiCad major version matches the version declared by the repository.
- Schematic references are fully annotated and unique.
- Every PCB footprint that represents a schematic component has a valid symbol
  association; allowed board-only mechanical footprints are explicit.
- Project libraries and custom 3D models resolve without global or absolute
  paths.

### Electrical checks

- KiCad CLI ERC and DRC complete successfully.
- Unconnected items, duplicate references, missing footprints, missing symbols,
  and association failures are reported.
- ERC/DRC errors fail validation. A nonzero warning is accepted only when it
  matches a versioned entry in `validation_waivers.json` containing a rationale.
- A semantic inventory captures symbols, values, footprints, pin-to-net
  assignments, board-side placement, and routing/unconnected counts.

### Mechanical checks

- Every contract feature is compared with its allowed translation and rotation
  tolerance.
- Board outline, thickness, side, height-envelope, and keep-out changes are
  reported separately from electrical failures.
- A mechanical mismatch blocks enclosure and release generation until reviewed.

No validator invokes "Update PCB from Schematic" or modifies the board to make
the result pass.

## Outgoing handoff

`make pocket_card_engineer_export` creates a reproducible, untracked ZIP with a
single top-level directory. The archive contains:

- the complete canonical KiCad project and all project-local libraries/models;
- `HANDOFF.md` with the expected KiCad major version, editable scope, update
  procedure, locked-feature explanation, and return instructions;
- `handoff.json` with the source Git commit, project digest, export time, and
  tool/KiCad versions;
- the mechanical contract in both machine-readable form and a short human
  summary;
- schematic PDF, board STEP, ERC/DRC reports, and a semantic inventory;
- the completed Blender assembly only when `INCLUDE_BLEND=1` is requested.

STEP and the dimensional contract are the authoritative mechanical references.
The Blender assembly is supplementary visual context and must not be measured
as if it were CAD truth.

Before packaging, the command runs the same electrical and mechanical checks
used for a returned project. It refuses to export an invalid or mechanically
stale baseline. Editor state, backups, caches, manufacturing outputs, and
machine-local configuration are excluded.

## Returned-ZIP workflow

Returned files never overwrite the canonical project on extraction.

1. `make pocket_card_engineer_check ZIP=/absolute/path/revision.zip` safely
   extracts the archive into an untracked staging directory.
2. The checker verifies the expected project identity, handoff metadata, file
   layout, KiCad version, and project-local dependencies.
3. It compares the returned `handoff.json` base digest with the repository's
   current canonical project digest. A mismatch is a clear
   stale/concurrent-edit error, not an automatic merge.
4. It runs project-integrity, ERC/DRC, association, and mechanical checks.
5. It writes a semantic change report showing added/removed components,
   reference/value/footprint changes, pin/net changes, critical-part movement,
   board-outline changes, and routing/unconnected-count changes.
6. The raw KiCad textual diff remains available, but the semantic report is the
   primary review surface.

The check has three distinct outcomes:

- `PASS`: electrically valid and mechanically compatible;
- `MECHANICAL REVIEW REQUIRED`: electrically reviewable, but the enclosure
  contract no longer matches;
- `INVALID`: malformed/incomplete project, missing dependencies, failed
  electrical checks, or an unknown baseline.

`make pocket_card_engineer_accept STAGED=/absolute/path/staged-project` is an
explicit second action. It verifies that the staged files are exactly those
that produced the report, then copies only KiCad project files and
project-local libraries/models into the working tree. Returned copies of
`toolchain.json`, `mechanical_contract.json`, and `validation_waivers.json`
are never promoted. The command does not commit, merge, rewrite repository
policy, or generate outputs. Acceptance is done on a dedicated Git branch so
the native KiCad change can be reviewed independently.

An electrically valid return with mechanical changes may be accepted on that
branch, but it cannot pass the case/release gate or merge to the production
branch until the enclosure and `mechanical_contract.json` are reconciled.

## Normal build targets

The production-facing targets become:

| Target | Responsibility |
|---|---|
| `pocket_card_kicad` | Check the canonical native KiCad project; never generate or modify it |
| `pocket_card_kicad_check` | Explicit alias for the same read-only validation |
| `pocket_card_pcb_exports` | Export Gerbers, drills, BOM, placement, PDF, STEP, and STL from the canonical PCB |
| `pocket_card_case` | Validate, export the authoritative PCB model, then rebuild enclosure/order outputs |
| `pocket_card_case_shells` | Rebuild enclosure/order outputs from a PCB export whose recorded source digest still matches the canonical board |
| `pocket_card_engineer_export` | Validate and create the outgoing handoff ZIP |
| `pocket_card_engineer_check` | Stage and report on a returned ZIP without changing source |
| `pocket_card_engineer_accept` | Explicitly promote a previously checked staged project into the working tree |
| `pocket_card_legacy_pcb_rebuild` | Run the guarded historical generator into a noncanonical location |

`pocket_card_case` must no longer call `build_pcb.sh`, `pcb.py`,
`pcb_route.py`, `pcb_reroute.py`, or `generate_kicad.js`. It consumes the board
edited in KiCad and regenerates downstream models from that board.

## Git and review discipline

Each exchange records its baseline commit and digest. Returned revisions are
accepted on a new branch, not copied directly onto the production branch. The
recommended commit sequence is:

1. canonical KiCad source and any accompanying project-local library changes;
2. deliberate contract/enclosure adjustments when mechanical interfaces moved;
3. regenerated fabrication and visualization artifacts, when those artifacts
   are intentionally tracked.

This sequence keeps the engineer's design diff readable and makes generated
noise removable without discarding source work. The import tools never create
Git commits automatically.

## Error handling and safety

- ZIP extraction rejects path traversal, symlinks, multiple project roots, and
  unexpected canonical filenames.
- Staging and report generation are transactional; a failed check leaves the
  canonical directory untouched.
- Acceptance checks the staged digest again to prevent reviewing one tree and
  copying another.
- Existing canonical files are never deleted merely because a returned archive
  omits them; omission makes the return invalid.
- Missing KiCad CLI or an incompatible major version produces an actionable
  setup error rather than silently skipping validation.
- Any command that could invoke a legacy generator identifies itself as
  destructive and requires an explicit opt-in.

## Testing

Automated tests cover:

- project inventory and symbol-footprint association parsing;
- annotated and duplicate reference detection;
- mechanical position, rotation, side, lock, outline, and tolerance checks;
- warning-waiver matching and rejection of new violations;
- deterministic semantic inventories and change reports;
- outgoing ZIP contents and exclusion rules;
- safe extraction, stale-baseline detection, missing dependencies, tampered
  staging, and transactional acceptance;
- Make target wiring proving normal targets cannot reach legacy generators;
- a fixture containing an added pull-up resistor to prove that ordinary
  engineer-added symbols, footprints, nets, placement, and routing survive the
  complete validation/export/case pipeline.

Tests use temporary project copies. KiCad CLI integration tests are skipped
only with an explicit diagnostic when the executable is unavailable; parser,
packaging, contract, and target-wiring tests remain mandatory.

## Migration sequence

1. Copy the currently reviewed, linked KiCad project into the canonical
   `electronics/` directory without regenerating it.
2. Add integrity, electrical, and mechanical validators around that snapshot.
3. Add read-only board/fabrication/3D export commands and switch the case
   pipeline to them.
4. Add outgoing packaging and returned-ZIP staging/reporting.
5. Add explicit acceptance and Git workflow documentation.
6. Move the old connectivity and board generators behind the isolated legacy
   target only after the native pipeline passes parity checks.

At the migration boundary, the canonical native project must describe the same
symbols, footprint associations, pad nets, board outline, placement, and routed
board as the reviewed pre-migration files. No electrical or mechanical redesign
is part of this migration.

## Out of scope

- Automatically merging concurrent KiCad edits.
- Reconstructing `connectivity.json` from an engineer's schematic.
- Automatically approving a changed enclosure interface.
- Treating Blender meshes as dimensional authority.
- Requiring the engineer to use Git or repository build tools.
- Qualifying the circuit for manufacture; the existing electrical audit and
  professional engineering review remain necessary.
