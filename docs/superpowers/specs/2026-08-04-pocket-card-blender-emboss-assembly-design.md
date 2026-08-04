# Pocket Card Automated Blender Emboss and Assembly

**Date:** 2026-08-04  
**Status:** Approved for implementation

## Objective

Replace the manual Blender finishing sequence with a deterministic build step.
After the CadQuery order-pack shells are generated, headless Blender will:

1. put the new front and back mesh data into the existing `shell_front` and
   `shell_back` objects from `case_updated.blend`;
2. preserve and evaluate the template objects' modifier stacks;
3. export final embossed front and back STLs; and
4. build a clean, coloured, selectable Blender assembly containing the case,
   buttons, side-switch tips, PCB, and the positioned display model.

The process must never save over or modify `case_updated.blend`.

## Confirmed Decisions

| Question | Decision |
|---|---|
| Shell inputs | `hardware/pocket_card/case/out/order/shell_front.stl` and `shell_back.stl` |
| Emboss outputs | `out/order/shell_front_embossed.stl` and `shell_back_embossed.stl` |
| Blender assembly output | `out/order/pocket_card_complete.blend` |
| Build integration | Run automatically after shell generation in both existing case Make targets |
| Template mutation | Never save `case_updated.blend`; perform all changes in memory |
| Modifier handling | Evaluate every modifier on each shell during STL export |
| Failure behaviour | Fail the build and preserve every previous final output |
| Front case colour | Purple |
| Back case colour | White |
| Button colour | Yellow, including eight face caps and two side-switch tips |
| PCB colour | Green |
| Display | Append from `es3c28p_3d.blend`, preserving its transform and materials |

## Source Assets and Verified Current State

The Blender template is:

`hardware/card/case/case_updated.blend`

The display source is:

`hardware/card/case/es3c28p_3d.blend`

The display file currently contains one mesh object named `es3c28p_3d`. It has
four material slots and a non-identity transform that places it correctly in
the shell coordinate system. It must be appended as Blender data rather than
converted to STL, so both its global transform and original materials survive.

The template currently contains:

- `shell_front`, a mesh object with six enabled Boolean Difference modifiers;
- `shell_back`, a mesh object with no modifiers; and
- identity transforms on both shell objects.

The template shell meshes and generated order-pack STLs currently have matching
coordinates and bounds: 90 × 93 mm in plan, front Z `[-7.3, 0]`, and back Z
`[-15.7, -5.3]`. The evaluated current meshes are closed: Blender reports zero
non-manifold edges for both.

The template emits warnings about a missing Helvetica Neue source file. This is
not a build dependency: the active Boolean operands, including `texts.001`, are
frozen mesh objects. The automation will validate modifier operands directly
and will not evaluate unused font objects.

The remaining assembly inputs already exist in shell model space under
`out/order/preview/`:

- `cap_up.stl`, `cap_down.stl`, `cap_left.stl`, `cap_right.stl`;
- `cap_undo.stl`, `cap_action.stl`, `cap_reset.stl`, `cap_menu.stl`;
- `tip_power.stl`, `tip_mute.stl`; and
- `pcb.stl`.

## Build Interface

Add a Blender-hosted Python entry point:

`hardware/pocket_card/case/emboss_shells.py`

Add a Make helper target for direct reruns:

`make pocket_card_case_embossed`

Both `make pocket_card_case` and `make pocket_card_case_shells` invoke that
helper after `build_variants.py` completes. The full build therefore refreshes
the PCB and placed preview assets first; the shells-only build reuses the
existing placed PCB, as it does today.

The Blender executable is resolved in this order:

1. an explicit `BLENDER=/absolute/path/to/blender` Make override;
2. `blender` found on `PATH`; and
3. `/Applications/Blender.app/Contents/MacOS/Blender` on macOS.

If no executable is available, Make fails with a concise message explaining
the `BLENDER` override. Blender runs with `--background` and
`--python-exit-code 1`, so an uncaught script error makes the Make target fail.

## Emboss Pipeline

### 1. Preflight

Before changing Blender data in memory, the script verifies:

- every required input exists and is non-empty;
- the open file is `case_updated.blend`;
- `shell_front` and `shell_back` exist exactly once and are mesh objects;
- both target transforms are identity;
- each enabled modifier has all required object references;
- every Boolean operand is a mesh object;
- each input STL imports as exactly one non-empty mesh object; and
- imported shell bounds match the corresponding template shell within 0.05 mm
  on every minimum and maximum axis.

The bounds check intentionally fails if an unrelated, incorrectly scaled, or
misaligned mesh is supplied. A legitimate enclosure-size change therefore
requires updating the Blender finishing template before embossing can resume.

### 2. Preserve Objects, Replace Mesh Data

For each shell, the script assigns the imported mesh datablock to the existing
template object and removes the temporary imported object. It does not replace
the template object itself. This preserves:

- object name and identity;
- collection membership and visibility;
- modifier order, settings, and operand references; and
- any future object-level metadata.

The operation is the programmatic equivalent of joining the new mesh into the
old object after deleting the old object's mesh contents.

### 3. Evaluate and Stage Embossed STLs

Each shell is exported separately with:

- selected-object export only;
- `apply_modifiers=True`;
- render dependency-graph evaluation;
- unit conversion disabled;
- global scale 1.0; and
- Blender's Y-forward, Z-up STL convention used by the existing manual export.

The script writes uniquely named staging STLs in the order output filesystem.
It does not initially touch either final embossed filename.

### 4. Validate Staged Shells

Before an output is publishable, the evaluated mesh must:

- contain vertices and polygons;
- have finite coordinates and non-zero volume bounds;
- have zero non-manifold edges; and
- retain the expected X/Y shell bounds within 0.05 mm.

The staged STL must then:

- contain vertices and polygons;
- have finite coordinates and non-zero volume bounds;
- retain the expected X/Y shell bounds within 0.05 mm; and
- re-import as exactly one mesh object at identity transform.

The closure check is deliberately made on Blender's evaluated Boolean result.
Blender's STL importer removes degenerate and duplicate boundary triangles from
the MANIFOLD Boolean export, which can make its reconstructed topology appear
open even though the evaluated source mesh is closed. Re-import therefore
checks the serialized STL's structure, scale, and bounds without substituting
the importer's cleanup behavior for the source-mesh closure test.

The validation is deliberately structural. It catches missing Boolean operands,
empty Boolean results, accidental multi-object export, scaling mistakes, and
open surfaces without trying to judge the artistic content of the emboss.

## Coloured Assembly Pipeline

After both staged embossed STLs pass validation, Blender resets to an empty
file in memory. This prevents cutter objects, unused fonts, lights, cameras,
and other template data from leaking into the final assembly.

The script creates four collections:

| Collection | Objects | Material treatment |
|---|---|---|
| `Case` | `shell_front_embossed`, `shell_back_embossed` | matte purple front, matte white back |
| `Buttons` | eight `cap_*` objects plus `tip_power` and `tip_mute` | matte yellow |
| `Electronics` | `pcb` | matte green |
| `Display` | appended `es3c28p_3d` | preserve all source materials |

The basic case materials use one Principled BSDF each, medium roughness, and
simple presentation colours. Their material diffuse colour and object viewport
colour are both set, so the distinction remains visible in material preview and
object-colour workbench views. Exact colour calibration is out of scope.

Every STL is imported separately and renamed deterministically. No components
are joined, so all 14 expected mesh objects remain independently selectable:

- two shells;
- eight face caps;
- two side-switch tips;
- one PCB; and
- one display.

The display is appended with `bpy.data.libraries.load(..., link=False)` and
linked into the `Display` collection. Its saved location, rotation, scale,
mesh material indices, and four material datablocks are retained. Images used
by those materials are resolved relative to the display source library and
packed into the completed `.blend`, keeping the assembly self-contained after
it is saved in the order output directory.

The assembly scene uses metric units and the same coordinate values as the STL
pipeline. The completed file is staged as a temporary `.blend` and is not
derived by saving the open `case_updated.blend` session.

## Transactional Publication and Errors

The two embossed STLs and complete Blender assembly form one output set. The
script fully creates and validates all three staged files before publishing any
of them.

Publication uses same-filesystem renames:

1. move any existing final outputs to run-specific backup names;
2. replace all three final paths with the staged files;
3. if any replacement fails, restore every backup; and
4. remove backups only after all replacements succeed.

On any preflight, Boolean, export, validation, append, save, or publication
failure, the script:

- prints the failed stage, object, and path;
- exits non-zero;
- removes run-specific staging files; and
- leaves the previous final output set intact.

The script never invokes `bpy.ops.wm.save_as_mainfile` while the finishing
template is the active source file. Saving occurs only after the in-memory reset
and clean assembly construction, to a staging path.

## Verification Strategy

Implementation includes a Blender integration test command that writes only to
a temporary directory. It verifies:

1. the real template accepts the current generated shell STLs;
2. both evaluated embossed meshes are non-empty, closed, and correctly bounded,
   and both staged STLs are structurally valid and re-importable;
3. the template file's hash and modification time do not change;
4. the saved assembly reopens in a second headless Blender process;
5. the reopened assembly has the four exact collection names and 14 exact mesh
   object names;
6. shell, button, tip, and PCB objects have the intended materials;
7. the display transform and material-slot assignments match its source file,
   and its source-resolution material images are packed into the assembly;
8. no cutter or template-only object is present; and
9. a forced missing-input failure leaves pre-existing sentinel outputs byte-for-
   byte unchanged.

The Make integration is checked with dry runs of both public case targets and
one real shells build. The real build must finish with all three final outputs
present and newer than their source shell STLs.

## Acceptance Criteria

The work is complete when:

- either existing case Make target automatically produces both embossed STLs
  and `pocket_card_complete.blend`;
- a direct `make pocket_card_case_embossed` rerun is available;
- opening the assembly shows an aligned purple front, white back, ten yellow
  controls, green PCB, and the original-material display;
- every component is independently selectable in its named collection;
- all modifiers are baked into the exported shell meshes;
- `case_updated.blend` remains byte-for-byte unchanged; and
- any failed run returns non-zero without replacing the previous good outputs.

## Non-Goals

- Redesigning or regenerating the relief cutters.
- Editing text, logo, or display materials.
- Applying artistic materials beyond the four requested basic component colours.
- Adding lighting, cameras, animation, or rendered beauty shots.
- Saving imported shell meshes back into the Blender finishing template.
