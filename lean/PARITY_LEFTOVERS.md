# Lean parity leftovers (clean corpus)

Last updated: 2026-07-21. **Coverage: 303 / 303** unique clean names in `fixtures.json` (`make lean_parity_smoke` green).

## Final wave

- **Again-probe RNG**: JS `processInput(dontModify)` then `DoUndo` restores objects but **not** `RandomGen`. Lean now keeps the probe tick’s RNG. Fixes **Sok7** (Five vs Six), **Expand, avoid the flames** (action/again/spawn), **gallery: tidy the cafe** (candlestick frames).

## Prior waves (landed)

- Ellipsis `kmax` Nat underflow (`y + 2 - len`)
- `run_rules_on_level_start` on restart
- `require_player_movement`, layer-coupled overlap, undo+again frames

## Tooling

- `python3 scripts/lean_parity_expand.py --write-whitelist --timeout 300`
- `python3 scripts/lean_parity_bisect.py --fixture 'NAME'`
