# Lean parity leftovers (clean corpus)

Last updated: 2026-07-21. **Coverage: 300 / 303** unique clean names in `fixtures.json` (`make lean_parity_smoke` green). Candidate file has 305 lines including 2 stale names not in `fixtures.json`.

## This wave

- **Ellipsis `kmax` Nat underflow**: use `y + 2 - len` (not `y - len + 2`). Lean `Nat` saturates so `1 - 2 + 2 = 2`, allowing vertical/horizontal wrap matches. Fixes **propagation test**.
- **`run_rules_on_level_start`**: after restart (input or command), run one tick and ignore win — paints random/checkered backgrounds from `restart_target`. Fixes **Car Crash**, **Lightdown**, **SWIMMING TIME!**, **REALTIME DOG MOUNTAIN RESCUE**, **Rigidbody fix bug #246**, **Neoprenanzieher**, **Oh No My Dog…**, and other restart/level-start games.

## Remaining (3) — again / action / realtime animation

| Fixture | Bisect | Notes |
|---------|--------|-------|
| `Sok7` | @35 left + again | One cell: JS `five o` vs Lean `o six` after again number-match rules |
| `Expand, avoid the flames […]` | @7 action + again | Action→`direkt` / random spawn again diverge (boards match through input 6) |
| `gallery: tidy the cafe` | @14 left after ticks | Candlestick frame desync (`realtime_interval` + explicit `tick` inputs) |

These need deeper again-settling / action-rule / realtime animation work beyond this wave.

## Tooling

- `python3 scripts/lean_parity_expand.py --write-whitelist --timeout 300`
- `python3 scripts/lean_parity_bisect.py --fixture 'NAME'`
