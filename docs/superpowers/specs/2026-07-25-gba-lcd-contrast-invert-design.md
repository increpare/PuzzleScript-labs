# GBA LCD contrast (export-time)

## Problem

Unlit reflective LCDs wash out dark tones (GBATEK: 5-bit intensities 0–14 are
effectively black). PC PuzzleScript palettes often use light-on-dark UI and fine
dark shading that disappears on that hardware.

## Goal

Default-on GBA export path `--lcd-contrast` that:

1. Forces **white** clear background and **black** UI text
2. Makes collision-layer-0 tiles transparent (solid white clear shows through)
3. Prevents object whites from vanishing on white clear (→ lightgray)
4. Lifts non-black RGB into the GBA-visible 5-bit band (intensities 15–31)

Does **not** snap colors onto a fixed discrete palette.

## Non-goals

- GBC / desktop / JS runtime changes
- Per-game metadata overrides beyond the global switch
- ABI layout bumps
- Fixed punch-16 / discrete palette quantization

## Control surface

| Surface | Behavior |
| --- | --- |
| `export-gba` | `--lcd-contrast` default **on**; `--no-lcd-contrast` disables |
| Exporter API | `bool lcdContrast = true` |
| `firmware/gba/Makefile` | `LCD_CONTRAST ?= 1`; when off, pass `--no-lcd-contrast` |

## Pipeline (when enabled)

1. **Background** → `#FFFFFF`.
2. **Text (`text_color` / foreground)** → `#000000` always.
3. **Object / title source whites** (channels ≥ 250) → `#CCCCCC` before lift.
4. **GBATEK visible-band lift** (non-black only): for each 8-bit channel `c`,
   5-bit `v = c >> 3`, then `v' = 15 + (v * 16) / 31`, expand back to 8-bit.
   Pure `#000000` is unchanged. Relative hue/shading is preserved.
5. **Collision layer 0** sprites: all pixels forced transparent.
6. Title images: map source pixels (white→lightgray, lift), blend onto white,
   lift the blend result.

## Manifest

```json
"lcd_contrast": {
  "enabled": true,
  "applied": true,
  "background_layer_transparent": true
}
```

## Testing

- Default on: bg white, text black, layer-0 fully transparent, object white → lightgray (lifted).
- Shaded red games retain many distinct palette entries after lift.
- `--no-lcd-contrast`: prior literal-color exporter fixtures still pass.

## References

- GBATEK: GBA LCD intensities 0–14 effectively black; 15–31 visible.
