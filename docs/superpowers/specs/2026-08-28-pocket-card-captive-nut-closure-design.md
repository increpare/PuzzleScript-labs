# Pocket Card Captive-Nut Closure Design

**Status:** Approved in design discussion on 2026-08-28; awaiting written-spec
review
**Target:** Pocket Card front shell, rear shell, controller PCB, case fastener
BOM, and assembled 3D model under `hardware/pocket_card/`

## Problem

The six current M2 pan-head self-tapping screws do not reliably form threads
in the JLC3DP SLA 8001 front-shell posts. M2, M2.3, and M3 self-tappers have
all resisted insertion in the physical enclosure. Forcing them risks splitting
or crazing the printed posts, while repeated opening would further wear any
threads that do form.

The enclosure should close firmly and permit occasional service. Visible screw
heads on the rear are acceptable. Wi-Fi and Bluetooth are not used, so this
fastener change has no antenna constraint.

## Chosen Closure

Replace all six self-tappers with rear-inserted M2 machine screws engaging
standard M2 hex nuts mechanically captured in the front shell. Preserve the
existing rear counterbored screw presentation and the compound-rounded outer
envelope.

Each nut uses a side-loading trap:

- the nut slides laterally into a close-fitting hexagonal cavity before the
  display module and controller PCB are installed;
- a printed roof on the electronics side of the cavity carries the screw's
  axial clamping load;
- the front-side floor and the hexagonal walls locate the nut and prevent
  rotation;
- the installed display module or controller PCB obstructs the loading mouth;
  and
- a small drop of two-part epoxy may be used to suppress rattling, but the
  closure must remain mechanically captive and load-bearing without adhesive.

The trap must not flex or snap over the nut during assembly. Heat-set insertion
is not used.

## Fastener Layout

The four display-module axes and the upper controller axis remain unchanged.
The lower controller axis and Reset assembly move to make a printable cage fit
between the battery, Reset guide, and speaker.

| Site | Existing centre (mm) | New centre (mm) | Change |
|---|---:|---:|---|
| Module top-left | `(6.0, 6.5)` | `(6.0, 6.5)` | none |
| Module top-right | `(84.0, 6.5)` | `(84.0, 6.5)` | none |
| Module bottom-left | `(6.0, 48.5)` | `(6.0, 48.5)` | none |
| Module bottom-right | `(84.0, 48.5)` | `(84.0, 48.5)` | none |
| Controller H1 | `(64.5, 56.0)` | `(64.5, 56.0)` | none |
| Controller H2 | `(66.0, 84.0)` | `(64.5, 84.0)` | 1.5 mm left |
| Reset cap, guide, and `SW_RESET1` | `(56.5, 80.0)` | `(54.5, 80.0)` | 2.0 mm left |

Moving H2 to `x = 64.5` aligns the two controller fasteners vertically. At the
new H2 position, a conservative 3.6 mm-radius complete cage envelope leaves
approximately:

- 1.9 mm to the battery's `x = 59.0` edge;
- 1.0 mm to the actual 14 x 20 mm stadium-shaped speaker envelope centred at
  `(76.0, 80.0)`; and
- 0.7 mm to the Reset guide's nominal 6.5 mm-radius envelope.

These are design-model clearances, not permission to replace the speaker with
a rectangular approximation. The final CAD check uses the actual component
and shell solids.

The controller PCB must move mounting hole H2 and the complete `SW_RESET1`
footprint to the new coordinates. All affected Reset-net copper, silkscreen,
and local courtyards must be rerouted or regenerated from those placements.

## Nut-Trap Geometry

The starting hardware is a standard DIN 934-style M2 steel hex nut with 4.0 mm
nominal width across flats, no more than 4.32 mm across corners, and no more
than 1.6 mm thickness. The production part must be checked against the fit
coupon before shell release.

The initial nominal trap dimensions are:

| Feature | Dimension |
|---|---:|
| Hex cavity across flats | 4.4 mm |
| Axial nut cavity | 1.8 mm |
| Loading throat width | 4.6 mm |
| Loading throat height | 1.8 mm |
| Printed retaining roof | 1.0 mm |
| Screw guide/clearance bore through roof | 2.4 mm |
| Minimum resin around cavity | 1.0 mm |
| Maximum complete radial envelope | 3.6 mm |

The 1.8 mm nut cavity and 1.0 mm roof consume 2.8 mm of the 3.0 mm axial space
between the inside of the front face and the controller PCB front. They leave
a nominal 0.2 mm no-contact gap to the PCB. The display-module sites have 4.4
mm of axial space and use the same nut and roof dimensions, with their existing
shoulders extended or stepped as required to preserve the module seating plane.

The roof transitions into the cage walls with a printable taper rather than a
sharp internal ledge. The screw bore remains coaxial with the existing rear
joint and PCB/module hole. A coaxial blind tip-relief bore continues no more
than 0.6 mm into the floor beneath the nut, leaving at least 0.9 mm of the
1.5 mm front face intact. No nut or roof may contact the electronics when the
shell is clamped.

The four module trap mouths point diagonally toward the display-module centre,
away from the outer wall. H1 loads southward and H2 loads northward along the
controller's `x = 64.5` corridor. Each mouth remains accessible before its
board is installed and becomes obstructed after normal assembly.

## Front- and Rear-Shell Load Path

At every site, the M2 machine screw passes through the existing rear head
counterbore and clearance bore, then through the display-module or controller
PCB mounting hole, and finally through the front trap roof into the M2 nut.

Tightening pulls the nut toward the rear. The printed roof transfers that load
through the cage walls into the front shell. The screw head transfers the
opposing load through the existing reinforced rear-shell land. The electronics
remain located on their established shoulders; neither the PCB nor adhesive is
used as the nut's axial retainer.

Existing rear counterbore diameters and the compound rear roll remain visually
unchanged unless the machine-screw head selected from physical stock requires
a small clearance-only adjustment. Any such adjustment must preserve the
existing 0.8 mm minimum membrane and 1.2 mm radial land beyond the head pocket.

## Screw Selection and BOM

Replace the self-tapper entries in `out/hardware_BOM.csv` with M2 pan-head
machine screws. Recompute length per site from the actual curved rear seat to
the seated nut rather than reusing the current self-tapper engagement formula.

Choose the shortest stocked length that:

1. reaches through the rear joint, supported electronics, trap roof, and full
   nut thickness;
2. engages the full 1.6 mm nut thread;
3. protrudes 0.2-0.6 mm beyond the nut; and
4. leaves at least 0.8 mm of solid front-face material beyond the screw tip.

If the current 8, 10, and 12 mm stock set cannot satisfy these conditions at
all six curved-profile sites, add the minimum additional standard M2 length to
the BOM instead of weakening the front face or accepting partial engagement.
Screws are tightened snugly with a small hand driver; the prototype validation
begins at a 0.10 N·m torque limit. Threadlocker is not part of the initial
design.

## Assembly and Service

1. Verify all six nuts against the selected fit-coupon cavity.
2. Slide the nuts into the front-shell traps and confirm that every nut seats
   flat beneath its roof and that an M2 screw starts by hand.
3. Add only an anti-rattle dot of two-part epoxy if desired; do not fill the
   threads or loading throat.
4. Install the buttons, display module, and controller PCB normally. Confirm
   that neither board touches a nut-trap roof.
5. Fit the back shell and start all six rear machine screws by hand before
   tightening them progressively in a cross pattern.
6. To service the unit, remove the rear screws. The nuts remain in the front
   shell; no loose fastener should be released into the electronics bay.

## CAD and PCB Changes

- Replace the six front-shell self-tapping pilots with parameter-driven
  side-loading captive-nut traps.
- Keep the existing six rear-joint axes synchronized from one source of truth.
- Change H2 and Reset coordinates in `params.py` and propagate them into the
  front shell, rear joints, controller PCB, routing, silkscreen, and exports.
- Replace self-tapper-specific engagement selection with machine-screw and nut
  engagement selection.
- Add a nut-fit coupon with at least 4.3, 4.4, and 4.5 mm across-flats pockets,
  the production 1.0 mm roof, and the production loading-throat section.
- Regenerate the front shell, rear shell, controller PCB exports, fastener BOM,
  STEP/STL assembly, and Blender presentation model.

## Verification

### Automated geometry and PCB checks

- Assert the six machine-screw axes and the new Reset coordinates.
- Assert that each nut, cavity, throat, roof, and screw bore is coaxial and
  contained within the front-shell envelope.
- Assert at least 1.0 mm of resin around every nut cavity and at least 0.8 mm
  of front-face material beyond the maximum permitted screw tip.
- Check all trap solids against the real display, controller PCB, battery,
  Reset guide and cap travel, speaker stadium, speaker wires, side walls,
  split lip, and rear joint solids.
- Confirm that the moved H2 land and counterbore remain valid on the compound
  rear surface and preserve the required membrane and radial land.
- Run controller PCB connectivity and design-rule checks after moving H2 and
  `SW_RESET1`; no unrouted Reset connection or copper-to-hole violation may
  remain.
- Confirm generated hardware BOM quantities, screw type, and per-site lengths.

### 3D review

Generate an assembled 3D model showing the real compound-rounded enclosure,
both shells, boards, battery, stadium-shaped speaker, Reset mechanism, all six
nuts, and all six screws. Also generate:

- an exploded view showing the nut loading directions and assembly order;
- a cutaway through H2, the moved Reset guide, battery edge, and speaker;
- a close-up of one module trap and one controller trap; and
- a rear exterior view confirming that only the intended screw heads are
  visible.

The first user-facing implementation review is the 3D model, not a schematic
substitute.

### Physical validation

Print the fit coupon in SLA 8001 before ordering a complete revised front
shell. Select the smallest cavity that accepts the stocked nut without force,
holds it against rotation, and permits smooth screw entry. Then print and
assemble the enclosure. The physical prototype must:

- close fully around the entire seam without unusual force;
- survive ten open-close cycles with no cracked roof, spinning nut, loosened
  cage, or resin dust;
- retain every nut when the opened front shell is gently inverted;
- show no witness marks on the speaker, battery, Reset guide, or PCBs; and
- hold the back shell firmly without self-tapping any printed resin.

## Acceptance Criteria

The design is complete when:

1. all six rear M2 machine screws engage mechanically captive M2 nuts;
2. the front shell contains no self-tapped assembly thread;
3. H2 and Reset occupy their approved new coordinates;
4. the complete H2 cage clears the real battery, Reset mechanism, and speaker;
5. the display and controller seating planes and the compound shell exterior
   are preserved;
6. the regenerated PCB passes connectivity and design-rule checks;
7. generated screw lengths fully engage the nuts without approaching the outer
   face closer than 0.8 mm;
8. the assembled and cutaway 3D models make the closure and clearances visually
   unambiguous; and
9. the SLA 8001 coupon and physical enclosure pass the stated service-cycle
   checks.

## Alternatives Not Chosen

- **Self-tapping screws:** rejected because they have already failed to enter
  the printed posts reliably and are poor for repeated service in this resin.
- **Heat-set inserts:** rejected because insertion heat can damage thermoset
  SLA resin and still requires an adhesive installation process.
- **Glue-only nuts or inserts:** simpler, but the adhesive becomes structural
  and a released part could become loose inside the enclosure.
- **Snap-only or magnetic closure:** easier to open, but does not provide the
  requested strongest positive closure.

## References

- Formlabs, “Adding Screw Threads to 3D Printed Parts”:
  <https://formlabs.com/blog/adding-screw-threads-3d-printed-parts/>
- JLC3DP, “Photosensitive Resin 8001”:
  <https://jlc3dp.com/help/article/photosensitive-8001-resin>
- Böllhoff, DIN 934 hex nut dimensions:
  <https://eshop.boellhoff.de/out/media/pdf/DIN_934_Edelstahl_A4___en.pdf>

## Out of Scope

- Changing the display module, battery, speaker, or external control layout
  beyond the approved Reset shift
- Wi-Fi/Bluetooth antenna accommodation
- Decorative enclosure changes
- A tool-less latch, waterproof seal, or hinge
