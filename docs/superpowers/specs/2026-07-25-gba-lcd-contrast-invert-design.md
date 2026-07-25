# GBA LCD contrast (export-time AGB punch-16)

## Problem

Unlit reflective LCDs wash out mild greens/blues and hide dark tones. PC
PuzzleScript palettes (often light-on-dark) need a predictable, bright,
high-separation remap for GBA cartridges aimed at that hardware.

## Goal

Default-on GBA export path `--lcd-contrast` that:

1. Forces a white clear background and transparent collision-layer-0 tiles
2. Ensures readable text (near-white `text_color` → black)
3. Prevents object whites from vanishing on white clear (→ lightgray)
4. Lifts non-black RGB into the GBA-visible 5-bit band (intensities 15–31)
5. Snaps every opaque color to a fixed **AGB punch-16** palette

## Non-goals

- GBC / desktop / JS runtime changes
- Per-game metadata overrides beyond the global switch
- ABI layout bumps
- Faithful reproduction of authored PC hues

## Control surface

| Surface | Behavior |
| --- | --- |
| `export-gba` | `--lcd-contrast` default **on**; `--no-lcd-contrast` disables |
| Exporter API | `bool lcdContrast = true` |
| `firmware/gba/Makefile` | `LCD_CONTRAST ?= 1`; when off, pass `--no-lcd-contrast` |

## AGB punch-16 palette

| # | hex | role |
| --- | --- | --- |
| 0 | `#000000` | black |
| 1 | `#FFFFFF` | white |
| 2 | `#BBBBBB` | lightgray |
| 3 | `#777777` | gray |
| 4 | `#FF2244` | red |
| 5 | `#FF6622` | orange |
| 6 | `#FFCC22` | yellow |
| 7 | `#44DD44` | green |
| 8 | `#22CCAA` | teal |
| 9 | `#22AAFF` | sky |
| 10 | `#3355FF` | blue |
| 11 | `#AA44FF` | purple |
| 12 | `#FF66CC` | pink |
| 13 | `#CC8844` | brown |
| 14 | `#99FF55` | lightgreen |
| 15 | `#FFAAAA` | peach |

## Pipeline (when enabled)

Decide nothing from authored bg/fg luminance — the path always runs when the
switch is on.

1. **Background** → `#FFFFFF` (palette white).
2. **Text (`text_color`)** → `#000000` if relative luminance ≥ 0.85; else continue
   through steps 4–5.
3. **Object / title source whites** (`white` / `#fff` / `#ffffff`, or RGB with
   all channels ≥ 250) → palette lightgray `#BBBBBB` before later steps.
4. **GBATEK visible-band lift** (non-black only): for each 8-bit channel `c`,
   5-bit `v = c >> 3`, then `v' = 15 + (v * 16) / 31`, expand back to 8-bit.
   Pure `#000000` is unchanged.
5. **Nearest punch-16** by squared RGB distance.
6. **Collision layer 0** sprites: all pixels forced transparent so the white
   clear shows through.
7. Title images: map source pixels (white→lightgray, lift, nearest), blend onto
   white background.

## Manifest

```json
"lcd_contrast": {
  "enabled": true,
  "applied": true,
  "palette": "agb_punch_16",
  "background_layer_transparent": true,
  "text_light_luminance_threshold": 0.85
}
```

When disabled, `applied` / `background_layer_transparent` are false and colors
are authored literals.

## Testing

- Default on: bg BGR555 white, layer-0 fully transparent, object white → lightgray.
- Near-white text → black; dark text remapped via lift+palette.
- Non-black dark hex (e.g. `#102030`) has all 5-bit channels ≥ 15 after lift
  (before/at palette snap).
- `--no-lcd-contrast`: prior literal-color exporter fixtures still pass.

## References

- GBATEK: GBA LCD intensities 0–14 effectively black; 15–31 visible.
- Commercial AGB titles authored bright/saturated palettes for unlit panels;
  emulator “color correction” undoes that for modern screens.
