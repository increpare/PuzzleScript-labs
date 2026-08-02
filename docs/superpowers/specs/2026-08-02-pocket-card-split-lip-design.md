# Pocket Card — Split Lip / Deeper Back Tray

Date: 2026-08-02  
Status: agreed in design session; implementing for feel print.

## What this amends

| Prior | Status |
|---|---|
| Back lid thickness = `WALL` (1.5 mm), split at rear | **Amended** — deeper tray `LID_T` |
| Rectangular rim, then `clip_to_envelope` | **Amended** — rim follows shaped envelope |
| USB-C cut in front shell | **Amended** — USB aperture owned by back tray |
| Side-arc ergonomics (outer curve) | **Unchanged** |
| Power/mute tip openings in front | **Unchanged** |

## Intent

Closed outer wall at the split and a **full-perimeter alignment lip** (goal B).
The thin rear slab sat inside the side-arc scoop, so clipping left holes and no
continuous tongue. Fix by moving the planar split forward (deeper back tray)
and building the rim as an inset of the same side-arc / bottom-fit profile.

## Decisions

1. **Approach:** deeper back tray (not side skirts, not arc fade at the lid).
2. **`LID_T ≈ 6.0 mm`** (was 1.5). Split at `z = -(BODY_T - LID_T)`.
3. **Rim:** shaped inset (`WALL + RIM_CLEAR` outer, fence thickness inner),
   height ~`RIM_H` 1.2 mm into the front cavity.
4. **USB-C:** entire window in the **back** tray; remove front USB cut.
5. **Power/mute tips:** remain wholly in the **front** shell.
6. Out of scope: gasket/IP seal, non-planar skirts, lower boss re-layout.

## Params

| Name | Role |
|---|---|
| `LID_T` | Back tray outer thickness (mm) |
| Front `SHELL_DEPTH` | `BODY_T - LID_T` |
| `RIM_H` / `RIM_CLEAR` | Lip height / radial clearance (existing spirit) |

## Verify

- Assembled STEP: continuous tray sides + rim at scoops; no daylight holes.
- USB: single opening on the back piece.
- Tips still actuate; front still owns collars/driver/tip chambers.
- Module/PCB supports still meet their planes after the split move.
