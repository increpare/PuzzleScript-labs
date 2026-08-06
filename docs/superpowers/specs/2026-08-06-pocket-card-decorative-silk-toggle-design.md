# Pocket Card Decorative Silkscreen Toggle

Date: 2026-08-06  
Status: approved for planning  
Related: `docs/superpowers/specs/2026-08-01-puzzlepocket-silkscreen-design.md`

## Goal

Make the routed board readable in KiCad and for engineer handoff by defaulting off dense decorative silkscreen (brick wallpaper, rule corpus, brand/logo), while keeping:

1. Functional silk UI legends (POWER / MUTE / connector titles and pin names)
2. Standard KiCad footprint `Reference` labels (`SW_UP1`, `U1`, `J_I2C1`, …)

D-pad `^V<>` glyphs count as decorative (refs name the switches).

Decorative art must remain one flag flip away for later manufacturing/visual builds.

## Non-goals

- Changing copper, placement, locks, or mechanical contract
- Redesigning label layout or fonts
- Removing footprint library silk body outlines (`fp_line` on silk)
- Changing case emboss / Blender shell art (separate from PCB silk)

## Background

Decorative silk is generated in `hardware/pocket_card/case/silk_layout.py` + `silk.py` and stamped into the native board as tens of thousands of top-level `gr_rect` primitives on `F.SilkS` / `B.SilkS`. Layout paint order is:

- L0 brick wallpaper
- L1 rules corpus
- L2 logo / brand / mascot
- L3 functional labels

Footprint `Reference` properties currently use `(hide yes)` so decorative silk owns the visual language.

## Design

### Flag

Add to `hardware/pocket_card/case/params.py`:

```python
DECORATIVE_SILK = False  # True restores brick + rules + logo
```

Default **False** (readable). Setting `True` restores the existing horror-vacui art.

### Generator behavior

When `DECORATIVE_SILK` is False:

- `build_front` / `build_back` emit only the L3 labels layer (no rules, no logo,
  no d-pad `^V<>` glyphs)
- `silk.py` paint path skips L0 brick
- `silk_sexpr()` / SVG preview emit only the remaining label ink
- front (`F.SilkS`) footprint `Reference`s are shown; back (`B.SilkS`) refs stay
  hidden so they don't duplicate generator connector titles / pin legends
- `Value` stays hidden

When `DECORATIVE_SILK` is True:

- current full stack (brick + rules + logo + labels)
- footprint `Reference` / `Value` remain hidden (current behavior)

### Board refresh

`refresh_board_silk()` continues to replace top-level F/B silk `gr_rect`s, and
additionally syncs Reference visibility: decorative hides all refs; readable
shows front refs and hides back refs. Target path for production refresh:

`hardware/pocket_card/electronics/pocket_card_controller.kicad_pcb`

Legacy `case/out/pcb/` remains noncanonical export output.

### Validation waivers

Turning decorative silk off removes most silk DRC warnings (overlap / edge clearance / over copper). After refresh, regenerate the affected silk warning-group digests in `electronics/validation_waivers.json` so `make pocket_card_kicad` still passes. Rationales should note decorative silk is optional via `DECORATIVE_SILK`.

### Operator workflow

```bash
# readable default (DECORATIVE_SILK=False)
cd hardware/pocket_card/case && .venv/bin/python -c \
  "import silk; print(silk.refresh_board_silk('../../electronics/pocket_card_controller.kicad_pcb'))"
make pocket_card_kicad

# restore decorative art later
# set DECORATIVE_SILK=True in params.py, re-run refresh + waiver regen + validate
```

## Acceptance

- With default `DECORATIVE_SILK=False`, native board silk shows UI legends + visible refdes; no brick/rules/logo rects
- Flipping to `True` and refreshing restores decorative art and hides refs again
- `make pocket_card_kicad` passes after waiver update
- Copper, locks, and mechanical contract unchanged
