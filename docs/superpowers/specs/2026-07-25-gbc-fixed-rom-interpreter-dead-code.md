# GBC fixed ROM: strip interpreter dead code under specialized turn

Status: Landed (2026-07-25).  
Branch: `gbc-followups-batch`.

## Problem

Three `good_games` titles passed cull export and specialized emit but failed
`scripts/check_gbc_rom.py` on **fixed ROM bank** high-water (~16405–16593 B vs
16384 B). Banked specialized rule packs were not the bottleneck; `_CODE` in
bank 0 held the full interpreter rule engine even though shipping carts always
link `generated_specialized_turn*.c` and never fall back.

## Map diagnosis (head-skuller example)

| Section | Size | Top contributor |
| --- | ---: | --- |
| `_CODE` | 14204 B | `renderBoard`, `ps_gbc_load_level`, interpreter apply path |
| `_HOME` | 1689 B | GBDK runtime (`display_off`, `joypad`, …) |

Interpreter-only symbols in `core.o` (gap heuristic): `ps_gbc_apply_group` …
`ps_gbc_apply_turn_phases` ~4 KiB; `ps_gbc_won` ~605 B when specialized win is
emitted.

## Fix (chosen)

Wrap interpreter paths in `#if !defined(PS_GBC_HAS_SPECIALIZED_TURN)` in
`native/src/gbc/core.c`. Gate `ps_gbc_won` when
`PS_GBC_GENERATED_SPECIALIZED_WON`. Keep `ps_gbc_resolve_movements` **NONBANKED**
(unchanged — historical bank-switch hang risk).

Makefile follow-up: `gbc_manifest.json` export stamp before compiling objects;
link specialized objects from `specialized_sources.list` after export so
multi-pack game switches do not use stale wildcards.

Rejected for this batch: moving `ps_gbc_resolve_movements` to a banked stub;
raising `MAX_FIXED_ROM_BYTES`; interpreter fallback.

## Results

| slug | fixed ROM before | fixed ROM after |
| --- | ---: | ---: |
| an-ok-multiban-level | ~16593 | 12122 |
| head-skuller | 16405 | 12379 |
| the-red-ring-of-immortality | ~16593 | 12029 |

All three promoted to `ELIGIBLE_GAMES` with `specialized_turn: true`, ROM
≤512 KiB.
