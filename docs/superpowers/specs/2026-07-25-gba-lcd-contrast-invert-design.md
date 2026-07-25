# GBA LCD contrast invert (export-time)

## Problem

Unlit reflective LCDs make light-on-dark PuzzleScript palettes hard to read.
PC-oriented games often set a dark `background_color` and light
`foreground_color`; GBA cartridges for this hardware want the opposite polarity
while keeping recognisable hues.

## Goal

At GBA export time, optionally detect dark-background / light-foreground games
and invert every emitted game color with hue preserved (HSL lightness flip plus
a small saturation boost). Default **on** for GBA builds; disable via CLI /
Makefile for parity testing and authoring checks.

## Non-goals

- GBC export, desktop/SDL player, or JS runtime changes
- Per-game metadata keys / author opt-out beyond the global switch
- ABI / `gba_manifest` layout version bump (palette **values** change; struct
  layout unchanged)
- Audio / SFX / gameplay logic changes

## Trigger

When the feature is **enabled** (default):

1. Parse `background_color` and `foreground_color` to opaque RGB (same parser
   as today’s exporter).
2. Compute relative luminance on channels scaled to `[0, 1]`:
   `Y = 0.2126 R + 0.7152 G + 0.0722 B` (Rec. 709 coefficients).
3. **Apply** invert iff `Y(background) < Y(foreground)`.
4. Equal luminance → do not apply.
5. When the feature is **disabled**, never apply.

## Color transform

For each opaque RGB color that participates in the export:

1. Convert RGB → HSL.
2. `L' = 1 - L`.
3. `S' = min(1, S * 1.25)` (fixed boost constant).
4. Keep `H` unchanged.
5. Convert HSL → RGB, then existing BGR555 quantization / palette intern.

Transparent stays transparent (no transform).

### Surfaces that must transform when applied

Decide `applied` from the **original** fg/bg colors, then define
`map(c) = transform(c)` when applied else `c`. Every opaque color that enters
palette intern goes through `map`:

- Written `foreground_color` / `background_color`
- Every object sprite palette color
- Title-image path: blend **mapped** source pixels over **mapped** background
  (do not blend in original space then invert — alpha edges would mismatch)

Apply `map` **before** BGR555 packing and palette deduplication so indices stay
consistent across sprites, UI colors, and title art.

## Control surface

| Surface | Behavior |
| --- | --- |
| `puzzlescript_cpp export-gba` | `--lcd-contrast-invert` default **on**; `--no-lcd-contrast-invert` disables |
| Exporter C++ API | Boolean / enum argument defaulting to on |
| `firmware/gba/Makefile` | `LCD_INVERT ?= 1`; when off, pass `--no-lcd-contrast-invert` on the export recipe |
| Batch ROM scripts | Inherit via Make / pass-through flags (no separate policy) |

## Manifest

`gba_manifest.json` gains:

```json
"lcd_contrast_invert": {
  "enabled": true,
  "applied": false,
  "sat_boost": 1.25
}
```

- `enabled`: switch state for this export
- `applied`: whether the luminance test triggered the transform
- `sat_boost`: constant used (documentation / tooling)

## Testing

Extend `native/tests/gba_exporter.cpp` (or sibling cases):

1. Dark bg + light fg, default on → invert applied; exported bg luminance >
   fg luminance (or exact known BGR555 fixtures).
2. Light bg + dark fg → `applied: false`; colors unchanged vs baseline.
3. Dark bg + light fg with `--no-lcd-contrast-invert` → unchanged.
4. Title-image path: when applied, title pixels follow the same transform
   policy as game colors.

Update any existing exporter assertions that assume literal dark-bg palette
bytes; prefer explicit disable in those tests when they encode PC-authored
colors.

## Implementation sketch

Primary touch points:

- `native/src/gba/exporter.cpp` / `exporter.hpp` — luminance helper, HSL
  convert, gate, wire through color intern / title path
- `native/src/cli/main.cpp` — flags + help text
- `firmware/gba/Makefile` + short README note
- `native/tests/gba_exporter.cpp` — cases above

No firmware runtime palette rewrite.
